import { tinyfishRouter } from "../_shared/tinyfishRouter";
import { kiloRouter } from "../_shared/kiloRouter";
import { getCache, setCache } from "../_shared/cache";
import { SEARCH_CACHE_MS, sanitizeUrl, isReputableSource } from "../_shared/http";
import {
  getGlobalAnalytics,
  getRegionalAnalytics,
  getScopePriceDefaults,
} from "../_shared/deterministicAnalytics";
import { isRegion, type Region } from "../_shared/regions";
import type { RegionId } from "../_shared/types";
import { safeParseJson } from "../_shared/validation";

const COMMODITY_QUERIES = [
  { commodity: "oil", queryTemplate: "Brent crude oil price today USD per barrel live" },
  { commodity: "electricity", queryTemplate: "wholesale electricity price today EUR per MWh live" },
  { commodity: "water", queryTemplate: "global water price per cubic meter USD 2026 tariff" },
];

/**
 * Known, stable price pages per commodity. Used as a scrape fallback only when
 * TinyFish search returns no usable URLs, so the "Re-fetch Live" buttons can
 * still resolve a real source instead of dropping straight to static defaults.
 */
const KNOWN_PRICE_URLS: Record<string, string[]> = {
  oil: [
    "https://tradingeconomics.com/commodity/brent-crude-oil",
    "https://www.economies.com/commodities/brent-oil",
    "https://fueldataportal.com/data/brent-crude-price",
    "https://worldoilmonitor.com/brent",
  ],
  electricity: [
    "https://electricity-spot.com/",
    "https://euroenergy.live/en/prices",
    "https://euenergy.live/",
  ],
  water: [
    "https://www.globalwaterintel.com/documents/the-global-water-tariff-survey-2026",
    "https://data360.worldbank.org/en/indicator/WB_CLEAR_AVWB",
  ],
};

const PRICE_EXTRACTION_PROMPT = `You are an expert financial data analyst specializing in commodity pricing. Your task is to extract precise, current price data for Brent crude oil, electricity and water from web search snippets AND scraped web page text.

Each commodity block below contains:
- Search snippets (title, snippet, URL)
- Scraped page text from the most relevant sources

Identify the most recent, reliable price figure for each commodity (oil, electricity, water). Prefer the scraped page text over the snippets when both are present, because the scraped page carries the full price table. Prioritise the freshest, most authoritative source and ignore historical averages, yearly archives and forecasts.

Return strict JSON only with this schema:
{
  "prices": [
    {
      "commodity": "oil" | "electricity" | "water",
      "price": number (USD),
      "unit": "string (e.g., 'USD per barrel', 'USD per MWh', 'USD per cubic meter')",
      "source": "string (exact URL the price came from)",
      "confidence": number (0-100)
    }
  ]
}

Rules:
- Prices may appear in various formats: $92.64, 92.64 USD, 153.4 EUR/MWh, 3.47 USD per cubic metre.
- If a price is quoted in EUR, convert it to USD using 1 EUR = 1.08 USD and note the original currency in the unit string (e.g. 'USD per MWh (from EUR)').
- The source must be the real URL of the page the price came from, never a bare publication name.
- Do not invent prices. If a commodity has no clear current price, set confidence to 0 and omit that commodity.
- Do not include any text outside the JSON.`;

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

  // Bounded live-price attempt: TinyFish search + scrape + Kilo extraction.
  // Scraping adds latency, so the budget is larger than the old search-only path.
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 55000);

  try {
    const searchResults = await getLivePricesFromTinyFish(scope, abortController.signal);

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

interface CommodityEvidence {
  commodity: string;
  snippets: Array<{ title: string; snippet: string; url: string; publishedAt?: string }>;
  pages: Array<{ url: string; title: string; text: string }>;
}

/**
 * Resolve live commodity prices from TinyFish search **plus** scraped pages.
 *
 * The old implementation relied on search snippets alone, which are usually
 * news headlines without a price figure, so every fetch fell through to the
 * static benchmark defaults. Scraping the top candidate URLs gives the model
 * the full price table (e.g. "$92.64", "153.4 EUR/MWh", "3.47 USD per m3").
 */
async function getLivePricesFromTinyFish(scope: RegionId, abortSignal: AbortSignal): Promise<PricesPayload> {
  // 1. Search every commodity in parallel.
  const searchResults = await Promise.all(
    COMMODITY_QUERIES.map(async ({ commodity, queryTemplate }) => {
      try {
        return await tinyfishRouter.tinyfishSearch(
          queryTemplate,
          {
            limit: 10,
            region: scope === "global" ? undefined : scope,
            purpose: "Find live price pages showing the current price in USD with a dated figure.",
          },
          abortSignal,
        );
      } catch (error) {
        console.warn(`Failed to search for ${commodity}:`, error);
        return { results: [], total: 0, keyIndex: -1 };
      }
    }),
  );

  // 2. Scrape the top candidate URLs per commodity in parallel.
  const evidence: CommodityEvidence[] = await Promise.all(
    COMMODITY_QUERIES.map(async ({ commodity }, index) => {
      const results = searchResults[index].results ?? [];
      const snippets = results.map((r) => ({
        title: r.title,
        snippet: r.snippet,
        url: r.url,
        publishedAt: r.publishedAt,
      }));

      // Prefer reputable hosts, then any other URL. Dedupe and cap at 5.
      const reputable = results.map((r) => r.url).filter((u) => u && isReputableSource(u));
      const others = results.map((r) => r.url).filter((u) => u && !isReputableSource(u));
      const candidates = [...new Set([...reputable, ...others])].slice(0, 5);
      const urlsToScrape = candidates.length > 0 ? candidates : KNOWN_PRICE_URLS[commodity] ?? [];

      let pages: Array<{ url: string; title: string; text: string }> = [];
      if (urlsToScrape.length > 0) {
        try {
          const batch = await tinyfishRouter.tinyfishScrapeBatch(
            urlsToScrape,
            abortSignal,
            {
              purpose:
                "Extract the current price figure, unit, currency and publication date for this commodity.",
            },
          );
          pages = batch.results
            .filter((p) => typeof p.text === "string" && p.text.trim().length > 0)
            .map((p) => ({ url: p.url, title: p.title, text: p.text }));
        } catch (error) {
          console.warn(`Failed to scrape ${commodity} pages:`, error);
        }
      }

      return { commodity, snippets, pages };
    }),
  );

  // 3. Build the model prompt from snippets and scraped page text.
  const evidenceText = evidence
    .map(({ commodity, snippets, pages }) => {
      const snippetLines =
        snippets
          .map(
            (r) =>
              `- ${r.title}\n  Snippet: ${r.snippet}\n  URL: ${r.url}${
                r.publishedAt ? `\n  Published: ${r.publishedAt}` : ""
              }`,
          )
          .join("\n") || "(no snippets)";
      const pageLines =
        pages
          .slice(0, 3)
          .map((p) => `- ${p.title || p.url}\n  URL: ${p.url}\n  Text: ${p.text.slice(0, 3000)}`)
          .join("\n\n") || "(no scraped pages)";
      return `Commodity: ${commodity}\n\nSearch snippets:\n${snippetLines}\n\nScraped pages:\n${pageLines}`;
    })
    .join("\n\n---\n\n");

  const payload = {
    messages: [
      { role: "system", content: PRICE_EXTRACTION_PROMPT },
      { role: "user", content: `Scope: ${scope}\n\n${evidenceText}` },
    ],
    max_tokens: 2048,
    temperature: 0.1,
  };

  // 4. Tier 1: Kilo AI extraction over snippets + scraped text.
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
          dataSource: "Kilo AI analysis of TinyFish search + scraped pages",
          isLive: true,
        };
      }
    }
  } catch (error) {
    console.warn("Kilo AI price analysis failed, falling back to deterministic extraction:", error);
  }

  // 5. Tier 2: deterministic extraction — scraped page text first, then snippets.
  const deterministic: Record<
    "oil" | "electricity" | "water",
    { price: number | null; source: string }
  > = {
    oil: { price: null, source: "" },
    electricity: { price: null, source: "" },
    water: { price: null, source: "" },
  };

  for (const { commodity, snippets, pages } of evidence) {
    if (commodity !== "oil" && commodity !== "electricity" && commodity !== "water") continue;

    for (const page of pages) {
      const price = extractPriceFromText(`${page.title} ${page.text}`);
      if (price !== null) {
        deterministic[commodity] = { price, source: sanitizeUrl(page.url) || page.url };
        break;
      }
    }
    if (deterministic[commodity].price !== null) continue;

    for (const res of snippets) {
      const price = extractPriceFromText(`${res.title} ${res.snippet}`);
      if (price !== null) {
        deterministic[commodity] = { price, source: sanitizeUrl(res.url) || res.url };
        break;
      }
    }
  }

  if (
    deterministic.oil.price !== null &&
    deterministic.electricity.price !== null &&
    deterministic.water.price !== null
  ) {
    return {
      oil: { price: deterministic.oil.price, unit: getCommodityUnit("oil"), source: deterministic.oil.source, isLive: true },
      electricity: { price: deterministic.electricity.price, unit: getCommodityUnit("electricity"), source: deterministic.electricity.source, isLive: true },
      water: { price: deterministic.water.price, unit: getCommodityUnit("water"), source: deterministic.water.source, isLive: true },
      asOf: new Date().toISOString(),
      dataSource: "TinyFish scrape (deterministic fallback)",
      isLive: true,
    };
  }

  // 6. Tier 3: insufficient data — the caller serves static benchmark defaults.
  return {
    oil: { price: 0, unit: "USD per barrel", source: "insufficient data", isLive: false },
    electricity: { price: 0, unit: "USD per MWh", source: "insufficient data", isLive: false },
    water: { price: 0, unit: "USD per cubic meter", source: "insufficient data", isLive: false },
    asOf: new Date().toISOString(),
    dataSource: "TinyFish search + scrape (insufficient data)",
    isLive: false,
  };
}
