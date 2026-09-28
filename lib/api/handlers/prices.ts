import { tinyfishRouter } from "../_shared/tinyfishRouter";
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
  { commodity: "oil", queryTemplate: "Brent crude oil price 2026" },
  { commodity: "electricity", queryTemplate: "electricity wholesale price 2026" },
  { commodity: "water", queryTemplate: "water price per cubic meter 2026" },
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

  // Bounded live-price attempt: TinyFish search + Kilo extraction. 30s leaves
  // 30s of headroom under vercel.json's 60s maxDuration, so this abort always
  // fires before Vercel's kill.
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 30000);

  try {
    try {
      const searchResults = await getLivePricesFromTinyFish(scope, abortController.signal);

      if (searchResults.isLive) {
        await setCache(cacheKey, searchResults, SEARCH_CACHE_MS);
        return Response.json(searchResults, { status: 200 });
      }
    } catch (error) {
      console.warn("TinyFish search failed, falling back to defaults:", error);
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
  } finally {
    // Cleared ONCE, around the whole thing. It used to be cleared inside the
    // first `try`, so the deterministic fallback below ran completely unbounded.
    clearTimeout(timeoutId);
  }
}

function extractPriceFromText(text: string): number | null {
  const pricePatterns = [
    /\$(\d+(?:\.\d+)?)/g,
    /(\d+(?:\.\d+)?)\s*USD/g,
    /(\d+(?:\.\d+)?)\s*dollars?/gi,
    /(\d+(?:\.\d+)?)\s*€/g,
    /(\d+(?:\.\d+)?)\s*EUR/g,
    /(\d+(?:\.\d+)?)\s*¥/g,
    /(\d+(?:\.\d+)?)\s*元/g,
  ];

  for (const pattern of pricePatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      for (const match of matches) {
        const price = parseFloat(match[1]);
        if (price >= 0.01 && price <= 10000) {
          return price;
        }
      }
    }
  }
  return null;
}

async function getLivePricesFromTinyFish(scope: RegionId, abortSignal: AbortSignal): Promise<PricesPayload> {
  const searchResults = await Promise.all(
    COMMODITY_QUERIES.map(async ({ commodity, queryTemplate }) => {
      try {
        return await tinyfishRouter.tinyfishSearch(queryTemplate, {
          limit: 10,
          region: scope === "global" ? undefined : scope,
        }, abortSignal);
      } catch (error) {
        console.warn(`Failed to search for ${commodity}:`, error);
        return { results: [], total: 0, keyIndex: -1, aborted: abortSignal.aborted };
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
          dataSource: "Kilo AI analysis of TinyFish search results",
          isLive: true,
        };
      }
    }
  } catch (error) {
    console.warn("Kilo AI price analysis failed, falling back to deterministic extraction:", error);
  }

  const prices: Record<string, { price: number | null; source: string }> = {
    oil: { price: null, source: "" },
    electricity: { price: null, source: "" },
    water: { price: null, source: "" },
  };

  searchResults.forEach((result, index) => {
    const commodity = COMMODITY_QUERIES[index].commodity;
    for (const res of result.results ?? []) {
      const price = extractPriceFromText(`${res.title} ${res.snippet}`);
      if (price !== null) {
        prices[commodity] = { price, source: sanitizeUrl(res.url) || res.url };
        break;
      }
    }
  });

  if (Object.values(prices).every((p) => p.price !== null)) {
    return {
      oil: { price: prices.oil.price as number, unit: getCommodityUnit("oil"), source: prices.oil.source, isLive: true },
      electricity: { price: prices.electricity.price as number, unit: getCommodityUnit("electricity"), source: prices.electricity.source, isLive: true },
      water: { price: prices.water.price as number, unit: getCommodityUnit("water"), source: prices.water.source, isLive: true },
      asOf: new Date().toISOString(),
      dataSource: "TinyFish search (deterministic fallback)",
      isLive: true,
    };
  }

  return {
    oil: { price: 0, unit: "USD per barrel", source: "insufficient data", isLive: false },
    electricity: { price: 0, unit: "USD per MWh", source: "insufficient data", isLive: false },
    water: { price: 0, unit: "USD per cubic meter", source: "insufficient data", isLive: false },
    asOf: new Date().toISOString(),
    dataSource: "TinyFish search (insufficient data)",
    isLive: false,
  };
}
