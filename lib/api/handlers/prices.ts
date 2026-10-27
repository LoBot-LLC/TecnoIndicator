import { searchRouter } from "../_shared/searchRouter";
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
  searchSource?: "tinyfish" | "playwright" | "duckduckgo";
}

export interface PricesPayload {
  oil: CommodityQuote;
  electricity: CommodityQuote;
  water: CommodityQuote;
  asOf: string;
  dataSource: string;
  isLive: boolean;
  searchSource: "tinyfish" | "playwright" | "duckduckgo";
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

  // Bounded live-price attempt: search + Kilo extraction.
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 25000);

  try {
    const searchResults = await getLivePricesFromSearch(scope, abortController.signal);

    if (searchResults.isLive) {
      await setCache(cacheKey, searchResults, SEARCH_CACHE_MS);
      return Response.json(searchResults, { status: 200 });
    }
  } catch (error) {
    console.warn("TinyFish search failed, falling back to defaults:", error);
  } finally {
    clearTimeout(timeoutId);
  }

  // Deterministic fallbacks. Oil is quoted per barrel from its own benchmark;
  // the retail diesel figure (USD per litre) is used for the fuel levy only and
  // must never be served as a per-barrel price.
  const analytics = scope === "global" ? await getGlobalAnalytics() : await getRegionalAnalytics(scope as Region);
  const defaults = getScopePriceDefaults(scope === "global" ? "global" : (scope as Region));

  const fallbackResult: PricesPayload = {
    oil: { ...defaults.oil, isLive: false, searchSource: "duckduckgo" },
    electricity: { ...defaults.electricity, isLive: false, searchSource: "duckduckgo" },
    water: { ...defaults.water, isLive: false, searchSource: "duckduckgo" },
    asOf: new Date().toISOString(),
    dataSource: analytics.dataSource,
    isLive: false,
    searchSource: "duckduckgo",
  };

  await setCache(cacheKey, fallbackResult, SEARCH_CACHE_MS);
  return Response.json(fallbackResult, { status: 200 });
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
    /£(\d+(?:\.\d+)?)/g,
    /(\d+(?:\.\d+)?)\s*GBP/g,
    /(\d+(?:\.\d+)?)\s*pounds?/gi,
    /₱(\d+(?:\.\d+)?)/g,
    /(\d+(?:\.\d+)?)\s*PHP/g,
    /(\d+(?:\.\d+)?)\s*pesos?/gi,
    /₹(\d+(?:\.\d+)?)/g,
    /(\d+(?:\.\d+)?)\s*INR/g,
    /R(\d+(?:\.\d+)?)/g,
    /(\d+(?:\.\d+)?)\s*ZAR/g,
    /kr\s*(\d+(?:\.\d+)?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:SEK|NOK|DKK)/gi,
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

async function getLivePricesFromSearch(scope: RegionId, abortSignal: AbortSignal): Promise<PricesPayload> {
  const regionalScope = scope === "global" ? undefined : scope;

  // Attempt search via the primary search chain (Playwright MCP → DuckDuckGo)
  // then fall back to TinyFish for each commodity when no results are returned.
  const searchResults = await Promise.all(
    COMMODITY_QUERIES.map(async ({ commodity, queryTemplate }) => {
      try {
        const result = await searchRouter.search(queryTemplate, {
          limit: 10,
          region: regionalScope,
        }, abortSignal);
        if (result.results.length > 0) return result;

        // Primary search chain returned no results — try TinyFish directly.
        console.warn(`Primary search returned no results for ${commodity}, trying TinyFish...`);
        return await tinyfishRouter.tinyfishSearch(queryTemplate, {
          limit: 10,
          region: regionalScope,
        }, abortSignal);
      } catch (error) {
        console.warn(`Failed to search for ${commodity}:`, error);
        // As a last resort, try TinyFish directly even if the primary search threw.
        try {
          return await tinyfishRouter.tinyfishSearch(queryTemplate, {
            limit: 10,
            region: regionalScope,
          }, abortSignal);
        } catch (tinyfishError) {
          console.warn(`TinyFish fallback also failed for ${commodity}:`, tinyfishError);
          return { results: [], total: 0, keyIndex: -1, searchSource: "duckduckgo" as const };
        }
      }
    }),
  );

  // Determine the search source from the first result set that has results
  const firstWithResults = searchResults.find((r) => r.results.length > 0);
  const searchSource = firstWithResults?.searchSource ?? "duckduckgo";

  // Check if we got any results at all — if all fallbacks failed, use deterministic defaults
  const hasAnyResults = searchResults.some(r => r.results.length > 0);
  if (!hasAnyResults) {
    return {
      oil: { price: 0, unit: "USD per barrel", source: "no search results", isLive: false },
      electricity: { price: 0, unit: "USD per MWh", source: "no search results", isLive: false },
      water: { price: 0, unit: "USD per cubic meter", source: "no search results", isLive: false },
      asOf: new Date().toISOString(),
      dataSource: "No search results available (all providers failed)",
      isLive: false,
      searchSource,
    };
  }

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

  // AI-extracted prices, hoisted so they can be merged with deterministic
  // extraction results below when the AI only returns a subset of commodities.
  let aiPrices: Record<string, { price: number; unit: string; source: string }> | null = null;

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

      aiPrices = {};
      for (const item of extracted) {
        if (item.commodity === "oil" || item.commodity === "electricity" || item.commodity === "water") {
          aiPrices[item.commodity] = { price: item.price as number, unit: item.unit, source: item.source };
        }
      }

      if (aiPrices.oil && aiPrices.electricity && aiPrices.water) {
        return {
          oil: { ...aiPrices.oil, isLive: true, searchSource },
          electricity: { ...aiPrices.electricity, isLive: true, searchSource },
          water: { ...aiPrices.water, isLive: true, searchSource },
          asOf: new Date().toISOString(),
          dataSource: "Kilo AI analysis of search results",
          isLive: true,
          searchSource,
        };
      }
    }
  } catch (error) {
    console.warn("Kilo AI price analysis failed, falling back to deterministic extraction:", error);
  }

  const deterministicPrices: Record<string, { price: number | null; source: string }> = {
    oil: { price: null, source: "" },
    electricity: { price: null, source: "" },
    water: { price: null, source: "" },
  };

  searchResults.forEach((result, index) => {
    const commodity = COMMODITY_QUERIES[index].commodity;
    // Skip commodities already covered by AI extraction.
    if (aiPrices?.[commodity]) return;
    for (const res of result.results ?? []) {
      const price = extractPriceFromText(`${res.title} ${res.snippet}`);
      if (price !== null) {
        deterministicPrices[commodity] = { price, source: sanitizeUrl(res.url) || res.url };
        break;
      }
    }
  });

  // Build per-commodity result: AI prices take priority, deterministic fills gaps.
  const result: PricesPayload = {
    oil: { price: 0, unit: "USD per barrel", source: "insufficient data", isLive: false, searchSource },
    electricity: { price: 0, unit: "USD per MWh", source: "insufficient data", isLive: false, searchSource },
    water: { price: 0, unit: "USD per cubic meter", source: "insufficient data", isLive: false, searchSource },
    asOf: new Date().toISOString(),
    dataSource: aiPrices ? "Kilo AI analysis of search results" : "Search (deterministic fallback)",
    isLive: false,
    searchSource,
  };

  let anyLive = false;
  for (const commodity of ["oil", "electricity", "water"] as const) {
    if (aiPrices?.[commodity]) {
      result[commodity] = {
        ...aiPrices[commodity],
        isLive: true,
        searchSource,
      };
      anyLive = true;
    } else if (deterministicPrices[commodity].price !== null) {
      result[commodity] = {
        price: deterministicPrices[commodity].price as number,
        unit: getCommodityUnit(commodity),
        source: deterministicPrices[commodity].source,
        isLive: true,
        searchSource,
      };
      anyLive = true;
    }
  }

  result.isLive = anyLive;
  return result;
}
