import { webSearchRouter } from "../_shared/webSearchRouter";
import { kiloRouter } from "../_shared/kiloRouter";
import { getCache, setCache } from "../_shared/cache";
import { SEARCH_CACHE_MS, sanitizeUrl } from "../_shared/http";
import {
  getGlobalAnalytics,
  getRegionalAnalytics,
  getScopePriceDefaults,
} from "../_shared/deterministicAnalytics";
import { isRegion, type Region } from "../_shared/regions";
import type { RegionId } from "../_shared/types";
import { safeParseJson } from "../_shared/validation";

const COMMODITY_QUERIES = [
  { commodity: "oil", queryTemplate: "Brent crude oil spot price USD per barrel today" },
  { commodity: "oil", queryTemplate: "crude oil price per barrel 2026" },
  { commodity: "oil", queryTemplate: "oil market price today USD bbl" },
  { commodity: "electricity", queryTemplate: "global average electricity price USD per MWh today wholesale" },
  { commodity: "electricity", queryTemplate: "electricity price per MWh 2026" },
  { commodity: "electricity", queryTemplate: "power market price USD per megawatt hour" },
  { commodity: "water", queryTemplate: "global average water tariff price USD per cubic meter today" },
  { commodity: "water", queryTemplate: "water price per cubic meter 2026" },
  { commodity: "water", queryTemplate: "municipal water tariff USD m3" },
];

const PRICE_EXTRACTION_PROMPT = `You are an expert financial data analyst specializing in commodity pricing. Your task is to extract precise price data from search results.

From the provided search results, identify the most recent, reliable price figures for each commodity (oil, electricity, water) with their sources.

Return strict JSON only with this schema:
{
  "prices": [
    {
      "commodity": "oil" | "electricity" | "water",
      "price": number (USD),
      "unit": "string (e.g., 'USD per barrel', 'USD per MWh', 'USD per cubic meter')",
      "source": "string (URL to the source)",
      "confidence": number (0-100)
    }
  ]
}

Search results may contain prices in various formats ($XX.XX, XX.XX USD, etc.). Extract the most plausible price from the most reliable source. Prioritize recent, authoritative sources. If a price cannot be clearly identified, set confidence to 0 and omit that commodity. Do not invent prices.

Do not include any text outside the JSON.`;

export interface CommodityQuote {
  price: number;
  unit: string;
  source: string;
  isLive: boolean;
}

export interface PricesPayload {
  oil: CommodityQuote;
  electricity: CommodityQuote;
  water: CommodityQuote;
  asOf: string;
  dataSource: string;
  isLive: boolean;
}

function getCommodityUnit(commodity: string): string {
  switch (commodity) {
    case "oil":
      return "USD per barrel";
    case "electricity":
      return "USD per MWh";
    case "water":
      return "USD per cubic meter";
    default:
      return "USD";
  }
}

export async function handlePrices(req: Request): Promise<Response> {
  try {
    return await resolvePrices(req);
  } catch (error) {
    console.error("Prices error:", error);
    return Response.json(
      {
        error: "Prices temporarily unavailable",
        oil: { price: 0, unit: "USD per barrel", source: "error", isLive: false },
        electricity: { price: 0, unit: "USD per MWh", source: "error", isLive: false },
        water: { price: 0, unit: "USD per cubic meter", source: "error", isLive: false },
        asOf: new Date().toISOString(),
        dataSource: "error",
        isLive: false,
      },
      { status: 500 },
    );
  }
}

async function resolvePrices(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://localhost");
  const force = url.searchParams.get("force") === "true";
  const regionParam = url.searchParams.get("region");
  const isGlobal = regionParam === null || regionParam === "";
  const scope: RegionId = isGlobal ? "global" : isRegion(regionParam) ? (regionParam as Region) : "global";
  const cacheKey = `live-prices:${scope}`;

  if (!force) {
    const cached = await getCache<PricesPayload>(cacheKey, SEARCH_CACHE_MS);
    if (cached) {
      return Response.json(cached, { status: 200 });
    }
  }

  // Bounded live-price attempt: SearXNG MCP search + Kilo extraction.
  // DuckDuckGo is used only as fallback when the SearXNG MCP server fails.
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 25000);

  try {
    const searchResults = await getLivePricesFromWebSearch(scope, abortController.signal);

    if (searchResults.isLive) {
      await setCache(cacheKey, searchResults, SEARCH_CACHE_MS);
      return Response.json(searchResults, { status: 200 });
    }
  } catch (error) {
    console.warn("Web search failed, falling back to defaults:", error);
  } finally {
    clearTimeout(timeoutId);
  }

  // Deterministic fallbacks. Oil is quoted per barrel from its own benchmark;
  // the retail diesel figure (USD per litre) is used for the fuel levy only and
  // must never be served as a per-barrel price.
  const analytics = scope === "global" ? await getGlobalAnalytics() : await getRegionalAnalytics(scope as Region);
  const defaults = getScopePriceDefaults(scope === "global" ? "global" : (scope as Region));

  const fallbackResult: PricesPayload = {
    oil: { ...defaults.oil, isLive: false },
    electricity: { ...defaults.electricity, isLive: false },
    water: { ...defaults.water, isLive: false },
    asOf: new Date().toISOString(),
    dataSource: analytics.dataSource,
    isLive: false,
  };

  await setCache(cacheKey, fallbackResult, SEARCH_CACHE_MS);
  return Response.json(fallbackResult, { status: 200 });
}

const COMMODITY_PRICE_BOUNDS = {
  oil: { min: 30, max: 200 },
  electricity: { min: 20, max: 500 },
  water: { min: 0.5, max: 10 },
};

const PRICE_PATTERNS: RegExp[] = [
  /(?:US\$|USD\s*\$?)\s*(\d+(?:\.\d+)?)/gi,
  /\$\s*(\d+(?:\.\d+)?)(?:\s*(?:\/|per)\s*(?:bbl|barrel|MWh|kWh|m3|m³|cubic\s*met(?:er|re)|lit(?:er|re)))?/gi,
  /(\d+(?:\.\d+)?)\s*(?:US\s*dollars?|USD|dollars?)(?:\s*(?:\/|per)\s*(?:bbl|barrel|MWh|kWh|m3|m³|cubic\s*met(?:er|re)|lit(?:er|re)))?/gi,
  /(?:price|cost|trading\s+at|at)\s*(?:of\s*)?(?:US\$|USD|\$)?\s*(\d+(?:\.\d+)?)/gi,
  /per\s+barrel\s+(?:of\s*)?(?:US\$|USD|\$)?\s*(\d+(?:\.\d+)?)/gi,
  /barrel\s+(?:at\s*)?(?:US\$|USD|\$)?\s*(\d+(?:\.\d+)?)/gi,
  /(?:USD|US\$|\$)\s*(\d+(?:\.\d+)?)\s*per\s+(?:barrel|MWh|cubic)/gi,
  /(\d+(?:\.\d+)?)\s*(?:per\s+)?(?:barrel|bbl|MWh|megawatt|cubic\s*meter|m3)/gi,
  /(?:spot|market|current)\s+(?:price|rate)\s+(?:of\s*)?(?:US\$|USD|\$)?\s*(\d+(?:\.\d+)?)/gi,
];

function extractPriceFromText(text: string, bounds?: { min: number; max: number }): number | null {
  const normalized = text.replace(/,/g, "");
  const candidates: number[] = [];

  for (const pattern of PRICE_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      const price = Number.parseFloat(match[1]);
      if (!Number.isFinite(price)) continue;
      const min = bounds?.min ?? 0.01;
      const max = bounds?.max ?? 10000;
      if (price < min || price > max) continue;
      candidates.push(price);
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const sorted = [...candidates].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function pickMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function getLivePricesFromWebSearch(scope: RegionId, abortSignal: AbortSignal): Promise<PricesPayload> {
  const searchResults = await Promise.all(
    COMMODITY_QUERIES.map(async ({ commodity, queryTemplate }) => {
      try {
        return await webSearchRouter.webSearch(queryTemplate, {
          limit: 10,
          region: scope === "global" ? undefined : scope,
        }, abortSignal);
      } catch (error) {
        console.warn(`Failed to search for ${commodity}:`, error);
        return { results: [], total: 0, source: "mcp" as const };
      }
    }),
  );

  const searchResultsText = searchResults
    .map((result, index) => {
      const commodity = COMMODITY_QUERIES[index].commodity;
      const resultLines = (result.results ?? [])
        .map((r) => `- ${r.title}\n  Snippet: ${r.snippet}\n  URL: ${r.url}\n  Published: ${r.publishedAt}\n`)
        .join("\n");
      return `Commodity: ${commodity}\n${resultLines}`;
    })
    .join("\n\n");

  const payload = {
    messages: [
      { role: "system", content: PRICE_EXTRACTION_PROMPT },
      {
        role: "user",
        content: `Scope: ${scope}\n\n${searchResultsText}`,
      },
    ],
    max_tokens: 2048,
    temperature: 0.1,
  };

  try {
    const response = await kiloRouter.kiloInfer(payload, abortSignal);
    const content = response.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson<{ prices?: unknown[] }>(content);
    if (parsed?.prices && Array.isArray(parsed.prices)) {
      const extracted = parsed.prices
        .map((p) => {
          const item = (p ?? {}) as Record<string, unknown>;
          const commodity = item.commodity;
          return {
            commodity: typeof commodity === "string" ? commodity : "",
            price: typeof item.price === "number" ? item.price : null,
            unit: typeof item.unit === "string" ? item.unit : getCommodityUnit(String(commodity)),
            source: typeof item.source === "string" ? sanitizeUrl(item.source) ?? item.source : "",
            confidence: typeof item.confidence === "number" ? item.confidence : 0,
          };
        })
        .filter((p) => p.commodity && p.price !== null && p.price > 0 && p.confidence >= 50);

      const prices: Record<string, { price: number; unit: string; source: string }> = {};
      for (const item of extracted) {
        if (item.commodity === "oil" || item.commodity === "electricity" || item.commodity === "water") {
          prices[item.commodity] = { price: item.price as number, unit: item.unit, source: item.source };
        }
      }

      if (prices.oil && prices.electricity && prices.water) {
        return {
          oil: { ...prices.oil, isLive: true },
          electricity: { ...prices.electricity, isLive: true },
          water: { ...prices.water, isLive: true },
          asOf: new Date().toISOString(),
          dataSource: "Kilo AI analysis of SearXNG MCP / DuckDuckGo search results",
          isLive: true,
        };
      }
    }
  } catch (error) {
    console.warn("Kilo AI price analysis failed, falling back to deterministic extraction:", error);
  }

  const commodityCandidates: Record<string, number[]> = {
    oil: [],
    electricity: [],
    water: [],
  };
  const commoditySources: Record<string, string> = {
    oil: "",
    electricity: "",
    water: "",
  };

  // Try extracting from ALL result snippets, trying multiple patterns per result,
  // and keep the best price within commodity-specific bounds.
  searchResults.forEach((result, index) => {
    const commodity = COMMODITY_QUERIES[index].commodity as "oil" | "electricity" | "water";
    const bounds = COMMODITY_PRICE_BOUNDS[commodity];
    if (!bounds) return;

    for (const res of result.results ?? []) {
      const price = extractPriceFromText(`${res.title} ${res.snippet}`, bounds);
      if (price === null) continue;
      commodityCandidates[commodity].push(price);
      if (!commoditySources[commodity]) {
        commoditySources[commodity] = sanitizeUrl(res.url) || res.url;
      }
    }
  });

  // Apply median selection per commodity
  const finalPrices: Record<string, { price: number | null; source: string }> = {
    oil: { price: null, source: "" },
    electricity: { price: null, source: "" },
    water: { price: null, source: "" },
  };

  for (const commodity of ["oil", "electricity", "water"]) {
    const median = pickMedian(commodityCandidates[commodity]);
    if (median !== null) {
      finalPrices[commodity] = { price: median, source: commoditySources[commodity] || "" };
    }
  }

  if (Object.values(finalPrices).every((p) => p.price !== null)) {
    return {
      oil: { price: finalPrices.oil.price as number, unit: getCommodityUnit("oil"), source: finalPrices.oil.source, isLive: true },
      electricity: { price: finalPrices.electricity.price as number, unit: getCommodityUnit("electricity"), source: finalPrices.electricity.source, isLive: true },
      water: { price: finalPrices.water.price as number, unit: getCommodityUnit("water"), source: finalPrices.water.source, isLive: true },
      asOf: new Date().toISOString(),
      dataSource: "SearXNG MCP / DuckDuckGo search (deterministic fallback)",
      isLive: true,
    };
  }

  return {
    oil: { price: 0, unit: "USD per barrel", source: "insufficient data", isLive: false },
    electricity: { price: 0, unit: "USD per MWh", source: "insufficient data", isLive: false },
    water: { price: 0, unit: "USD per cubic meter", source: "insufficient data", isLive: false },
    asOf: new Date().toISOString(),
    dataSource: "SearXNG MCP / DuckDuckGo search (insufficient data)",
    isLive: false,
  };
}