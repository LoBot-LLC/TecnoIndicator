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

IMPORTANT: You must extract REAL URLs from the search results as the source for each price. Look at the "URL:" field in each search result. Do NOT use generic labels like "Global crude oil benchmark (public composite)" or "public composite" — you must use the actual URL from the search results. The URL should be a real, specific webpage (e.g., "https://www.iea.org/reports/oil-market-report" or "https://tradingeconomics.com/energy/oil"). If you cannot find a specific URL in the search results, omit that commodity.

Return strict JSON only with this schema:
{
  "prices": [
    {
      "commodity": "oil" | "electricity" | "water",
      "price": number (USD),
      "unit": "string (e.g., 'USD per barrel', 'USD per MWh', 'USD per cubic meter')",
      "source": "string (REAL URL from search results, must be an actual webpage URL)",
      "confidence": number (0-100)
    }
  ]
}

Search results may contain prices in various formats ($XX.XX, XX.XX USD, etc.). Extract the most plausible price from the most reliable source. Prioritize recent, authoritative sources. If a price cannot be clearly identified, set confidence to 0 and omit that commodity. Do not invent prices.

For oil: Look for Brent crude, WTI, or OPEC prices. Typical range: $60-$150 per barrel.
For electricity: Look for wholesale/day-ahead electricity prices. Typical range: $20-$300 per MWh.
For water: Look for municipal water tariffs. Typical range: $0.50-$10 per cubic meter.

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

function extractPriceFromText(text: string, commodity?: string): number | null {
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

  const candidates: { price: number; text: string }[] = [];

  for (const pattern of pricePatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      for (const match of matches) {
        const price = parseFloat(match[1]);
        if (price >= 0.01 && price <= 10000) {
          candidates.push({ price, text: match[0] });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Sort by confidence: prefer prices that appear in the title, in currency symbols
  candidates.sort((a, b) => {
    const aTitleMatch = a.text.includes("$") || a.text.includes("USD");
    const bTitleMatch = b.text.includes("$") || b.text.includes("USD");
    if (aTitleMatch && !bTitleMatch) return -1;
    if (!aTitleMatch && bTitleMatch) return 1;

    // Then sort by proximity to commodity-appropriate range
    if (commodity) {
      const getCommodityRange = (c: string): { min: number; max: number } => {
        switch (c) {
          case "oil": return { min: 50, max: 150 };   // $50-$150/barrel
          case "electricity": return { min: 20, max: 300 }; // $20-$300/MWh
          case "water": return { min: 0.5, max: 10 }; // $0.50-$10/m³
          default: return { min: 0.01, max: 10000 };
        }
      };
      const range = getCommodityRange(commodity);
      const aInRange = a.price >= range.min && a.price <= range.max;
      const bInRange = b.price >= range.min && b.price <= range.max;
      if (aInRange && !bInRange) return -1;
      if (!aInRange && bInRange) return 1;
    }

    // Then sort by descending value (higher prices often more significant)
    return b.price - a.price;
  });

  return candidates[0].price;
}

async function getLivePricesFromSearch(scope: RegionId, abortSignal: AbortSignal): Promise<PricesPayload> {
  const regionalScope = scope === "global" ? undefined : scope;

  // Attempt search via the primary search chain (Playwright MCP → DuckDuckGo)
  // and TinyFish concurrently. DDG is frequently bot-blocked; running TinyFish
  // in parallel ensures we don't wait for DDG to fail before trying TinyFish.
  const searchResults = await Promise.all(
    COMMODITY_QUERIES.map(async ({ commodity, queryTemplate }) => {
      try {
        const [primaryResult, tinyfishResult] = await Promise.all([
          searchRouter.search(queryTemplate, {
            limit: 10,
            region: regionalScope,
          }, abortSignal).catch(() => ({ results: [], total: 0, keyIndex: -1, searchSource: "duckduckgo" as const })),
          tinyfishRouter.tinyfishSearch(queryTemplate, {
            limit: 10,
            region: regionalScope,
          }, abortSignal).catch(() => ({ results: [], total: 0, keyIndex: -1, searchSource: "tinyfish" as const })),
        ]);

        // Prefer primary results if available, otherwise fall back to TinyFish.
        if (primaryResult.results.length > 0) return primaryResult;
        if (tinyfishResult.results.length > 0) return tinyfishResult;

        // Both returned no results — return primary (empty) result.
        return primaryResult;
      } catch (error) {
        console.warn(`Failed to search for ${commodity}:`, error);
        return { results: [], total: 0, keyIndex: -1, searchSource: "duckduckgo" as const };
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

      // Note: we intentionally do NOT return early when all three commodities
      // are extracted by AI. Falling through to deterministic extraction allows
      // partial AI results to be combined with deterministic fallback values for
      // any commodity the AI missed. This is especially important for water
      // prices, which are harder to extract from search results.
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
      const price = extractPriceFromText(`${res.title} ${res.snippet}`, commodity);
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

  // Retry water price extraction if not live — water prices are the most
  // volatile and often require multiple search attempts to acquire a source.
  // The Kilo Gateway AI models sometimes fail to utilize TinyFish, Playwright
  // and DuckDuckGo HTML search properly for water; retrying with alternative
  // queries increases the chance of obtaining an accurate source.
  if (!result.water.isLive && !abortSignal?.aborted) {
    const waterRetryQueries = [
      "municipal water tariff price per cubic meter 2026",
      "water utility rates price 2026",
    ];
    for (const retryQuery of waterRetryQueries) {
      if (abortSignal?.aborted) break;
      try {
        console.warn(`Water price not live, retrying with query: ${retryQuery}`);

        // Try searchRouter (Playwright → DDG) and TinyFish in parallel
        const [searchResult, tinyfishResult] = await Promise.all([
          searchRouter.search(retryQuery, { limit: 10, region: regionalScope }, abortSignal)
            .catch(() => ({ results: [], total: 0, keyIndex: -1, searchSource: "duckduckgo" as const })),
          tinyfishRouter.tinyfishSearch(retryQuery, { limit: 10, region: regionalScope }, abortSignal)
            .catch(() => ({ results: [], total: 0, keyIndex: -1, searchSource: "tinyfish" as const })),
        ]);

        // Try searchRouter results first, then TinyFish
        for (const resultSet of [searchResult, tinyfishResult]) {
          if (result.water.isLive) break;
          if (resultSet.results.length === 0) continue;

          for (const res of resultSet.results) {
            const price = extractPriceFromText(`${res.title} ${res.snippet}`, "water");
            if (price !== null && price > 0 && price <= 100) {
              // Water prices are typically in the $0.50-$10/m³ range
              result.water = {
                price,
                unit: "USD per cubic meter",
                source: sanitizeUrl(res.url) || res.url,
                isLive: true,
                searchSource: resultSet.searchSource,
              };
              result.isLive = true;
              result.dataSource = "Kilo AI analysis of search results (water retry)";
              break;
            }
          }
        }

        if (result.water.isLive) break;
      } catch (retryError) {
        console.warn(`Water retry failed for "${retryQuery}":`, retryError);
      }
    }
  }

  return result;
}
