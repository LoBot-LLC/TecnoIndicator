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
  {
    commodity: "oil",
    queryTemplate: "Brent crude oil price today USD per barrel",
    alternateQuery: "Brent crude oil price per barrel",
    domains: ["tradingeconomics.com", "oilprice.com", "worldoilmonitor.com", "investing.com", "markets.businessinsider.com"],
  },
  {
    commodity: "electricity",
    queryTemplate: "wholesale electricity price today EUR per MWh day ahead",
    alternateQuery: "electricity day ahead spot price per MWh",
    domains: ["euenergy.live", "electricity-spot.com", "energymix.uk", "progrunners.com", "gridstatus.io"],
  },
  {
    commodity: "water",
    queryTemplate: "global water price per cubic metre 2026 tariff survey",
    alternateQuery: "water tariff average price per m3",
    domains: ["globalwaterintel.com", "globenewswire.com", "markets.businessinsider.com", "finance.yahoo.com"],
  },
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
    "https://euenergy.live/",
    "https://electricity-spot.com/",
    "https://energymix.uk/",
    "https://progrunners.com/european-electricity-prices/",
    "https://www.gridstatus.io/live",
  ],
  water: [
    "https://www.globenewswire.com/news-release/2026/10/29/3391565/0/en/global-water-prices-rose-5-6-in-2026-as-the-regional-gap-continues-to-widen-finds-global-water-intelligence-s-global-water-tariff-survey.html",
    "https://markets.businessinsider.com/news/stocks/global-water-prices-rose-5-6-in-2026-as-the-regional-gap-continues-to-widen-finds-global-water-intelligence-s-global-water-tariff-survey-1036685856",
    "https://finance.yahoo.com/economy/articles/global-water-prices-rose-5-152200588.html",
    "https://www.globalwaterintel.com/documents/the-global-water-tariff-survey-2026",
    "https://www.globenewswire.com/news-release/2026/11/06/3397420/0/en/asia-s-water-prices-trail-the-5-6-global-rise-but-bishkek-s-jump-44-7-finds-global-water-intelligence-s-global-water-tariff-survey-2026.html",
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
  // The Vercel function maxDuration for this route is 120s, so the scrape+extract
  // budget is set to 100s to leave headroom for the fallback tier.
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 100000);

  try {
    const searchResults = await getLivePricesFromTinyFish(scope, abortController.signal, force);

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

/**
 * Plausible per-unit ranges for each commodity. Extracted figures outside these
 * bounds are treated as mis-parsed (e.g. an annual water bill "2,026" or a
 * per-kWh electricity tariff) and rejected so they never reach the live feed.
 */
const PLAUSIBLE_RANGES: Record<string, { min: number; max: number }> = {
  oil: { min: 40, max: 200 },
  electricity: { min: 30, max: 300 },
  water: { min: 0.5, max: 15 },
};

/** Unit qualifiers used to prefer the number actually quoted per unit. */
const UNIT_QUALIFIERS: Record<string, RegExp> = {
  oil: /(?:per\s+barrel|a\s+barrel|\/\s*bbl|\bbbl\b)/i,
  electricity: /(?:per\s+mwh|per\s+megawatt|\/\s*mwh|per\s+kwh|\/\s*kwh|\bmwh\b)/i,
  water: /(?:per\s+cubic\s+met(?:er|re)|cubic\s+met(?:er|re)|\/\s*m3|per\s+gallon|\/\s*gal)/i,
};

/** Annual / monthly bill wording that signals a total, not a per-unit price. */
const BILL_PERIOD =
  /(?:per\s+year|a\s+year|annual|annually|\/\s*year|per\s+month|a\s+month|monthly|\/\s*month)/i;

function parsePriceNumber(raw: string): number {
  return Number.parseFloat(raw.replace(/,/g, ""));
}

/**
 * Normalize an extracted figure into the pipeline's canonical per-unit value.
 * - Electricity quoted in USD/kWh is converted to USD/MWh.
 * - Figures outside the commodity's plausible range are rejected (return null).
 */
function normalizeCommodityPrice(commodity: string, rawPrice: number, unit?: string): number | null {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
  let price = rawPrice;
  if (commodity === "electricity") {
    const unitSaysKwh = typeof unit === "string" && /kwh/i.test(unit);
    if (unitSaysKwh || (price > 0 && price < 1)) price = price * 1000;
  }
  const range = PLAUSIBLE_RANGES[commodity];
  if (range && (price < range.min || price > range.max)) return null;
  return price;
}

function extractPriceFromText(text: string, commodity?: string): number | null {
  // Prefer "from $X to $Y" → Y (the current/updated figure), e.g. GWI's
  // "lifts the average price from $2.97 to $3.47 per cubic metre".
  const rangeMatch = text.match(/from\s+\$([\d,]+(?:\.\d+)?)\s*(?:to|→|-|–)\s*\$([\d,]+(?:\.\d+)?)/i);
  if (rangeMatch) {
    const rangePrice = parsePriceNumber(rangeMatch[2]);
    if (Number.isFinite(rangePrice) && rangePrice >= 0.01 && rangePrice <= 100000) return rangePrice;
  }

  const pricePatterns = [
    /\$([\d,]+(?:\.\d+)?)/g,
    /([\d,]+(?:\.\d+)?)\s*USD/gi,
    /([\d,]+(?:\.\d+)?)\s*dollars?/gi,
    /([\d,]+(?:\.\d+)?)\s*€/g,
    /([\d,]+(?:\.\d+)?)\s*EUR/gi,
    /([\d,]+(?:\.\d+)?)\s*¥/g,
    /([\d,]+(?:\.\d+)?)\s*元/g,
  ];

  const qualifier = commodity ? UNIT_QUALIFIERS[commodity] : undefined;
  const candidates: Array<{ price: number; score: number }> = [];

  for (const pattern of pricePatterns) {
    for (const match of text.matchAll(pattern)) {
      const price = parsePriceNumber(match[1]);
      if (!Number.isFinite(price) || price < 0.01 || price > 100000) continue;
      const index = match.index ?? 0;
      const context = text.slice(Math.max(0, index - 48), index + match[0].length + 48);
      let score = 0;
      // Prefer a figure quoted next to the commodity's per-unit qualifier.
      if (qualifier && qualifier.test(context)) score += 10;
      // Penalize annual/monthly bill totals so a per-unit figure wins instead.
      if (BILL_PERIOD.test(context)) score -= 10;
      candidates.push({ price, score });
    }
    // A qualifier-tagged candidate is the strongest signal; stop scanning.
    if (candidates.some((candidate) => candidate.score >= 10)) break;
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].price;
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
async function getLivePricesFromTinyFish(
  scope: RegionId,
  abortSignal: AbortSignal,
  force: boolean = false,
): Promise<PricesPayload> {
  // 1. Search every commodity in parallel. A forced refetch bypasses the 60s
  // search cache so the "Re-fetch Live … Price" buttons actually re-hit TinyFish.
  const searchResults = await Promise.all(
    COMMODITY_QUERIES.map(async ({ commodity, queryTemplate, domains }) => {
      try {
        return await tinyfishRouter.tinyfishSearch(
          queryTemplate,
          {
            limit: 10,
            region: scope === "global" ? undefined : scope,
            purpose: "Find live price pages showing the current price in USD with a dated figure.",
            recencyMinutes: 1440,
            includeDomains: domains,
            bypassCache: force,
          },
          abortSignal,
        );
      } catch (error) {
        console.warn(`Failed to search for ${commodity}:`, error);
        return { results: [], total: 0, keyIndex: -1 };
      }
    }),
  );

  // 1b. Fallback search: if a commodity returned nothing, retry once with its
  // alternate query, broadened (no include_domains, no recency restriction).
  const fallbackSearches = await Promise.all(
    COMMODITY_QUERIES.map(async ({ commodity, alternateQuery }, idx) => {
      const primary = searchResults[idx];
      const hadResults = primary && primary.results && primary.results.length > 0;
      if (hadResults) return null;
      try {
        return await tinyfishRouter.tinyfishSearch(
          alternateQuery,
          {
            limit: 10,
            region: scope === "global" ? undefined : scope,
            purpose: "Find live price pages showing the current price in USD with a dated figure.",
            bypassCache: force,
          },
          abortSignal,
        );
      } catch (error) {
        console.warn(`Failed to fallback-search for ${commodity}:`, error);
        return null;
      }
    }),
  );

  // 2. Scrape the top candidate URLs per commodity in parallel.
  const evidence: CommodityEvidence[] = await Promise.all(
    COMMODITY_QUERIES.map(async ({ commodity }, index) => {
      const primary = searchResults[index];
      const fallback = fallbackSearches[index];
      const results = [
        ...((primary && primary.results) ?? []),
        ...((fallback && fallback.results) ?? []),
      ];
      const snippets = results.map((r) => ({
        title: r.title,
        snippet: r.snippet,
        url: r.url,
        publishedAt: r.publishedAt,
      }));

      // Always merge the known stable price pages so a thin or irrelevant
      // search never strands the pipeline on news URLs. Reputable hits first,
      // then other hits, then KNOWN_PRICE_URLS, deduped and capped at 8 (under
      // TinyFish's 10-URL batch limit).
      const reputable = results.map((r) => r.url).filter((u) => u && isReputableSource(u));
      const others = results.map((r) => r.url).filter((u) => u && !isReputableSource(u));
      const candidates = [...new Set([...reputable, ...others, ...(KNOWN_PRICE_URLS[commodity] ?? [])])].slice(0, 8);
      const urlsToScrape = candidates;

      let pages: Array<{ url: string; title: string; text: string }> = [];
      if (urlsToScrape.length > 0) {
        try {
          const batch = await tinyfishRouter.tinyfishScrapeBatch(
            urlsToScrape,
            abortSignal,
            {
              purpose:
                "Extract the current price figure, unit, currency and publication date for this commodity.",
              bypassCache: force,
            },
          );
          if (batch.errors && batch.errors.length > 0) {
            console.warn(`[prices] scrape errors for ${commodity}`, batch.errors);
          }
          pages = batch.results
            .filter((p) => typeof p.text === "string" && p.text.trim().length > 0)
            .map((p) => ({ url: p.url, title: p.title, text: p.text }));

          // Bounded single-URL retry: if the batch yielded no usable page text,
          // try the first known price pages directly.
          if (pages.length === 0) {
            const known = KNOWN_PRICE_URLS[commodity] ?? [];
            for (let i = 0; i < known.length && pages.length === 0; i++) {
              try {
                const single = await tinyfishRouter.tinyfishScrape(
                  known[i],
                  abortSignal,
                  { purpose: "Extract the current price figure for this commodity." },
                );
                if (single && typeof single.text === "string" && single.text.trim().length > 0) {
                  pages = [{ url: single.url, title: single.title, text: single.text }];
                }
              } catch (error) {
                console.warn(`[prices] single-URL retry failed for ${known[i]}:`, error);
              }
            }
          }
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
          const commodity = typeof item.commodity === "string" ? item.commodity : "";
          const rawPrice = typeof item.price === "number" ? item.price : null;
          const unit = typeof item.unit === "string" ? item.unit : getCommodityUnit(commodity);
          return {
            commodity,
            // Reject mis-parsed figures (annual bills, per-kWh tariffs) before use.
            price: rawPrice !== null ? normalizeCommodityPrice(commodity, rawPrice, unit) : null,
            source: typeof item.source === "string" ? sanitizeUrl(item.source) ?? item.source : "",
            confidence: typeof item.confidence === "number" ? item.confidence : 0,
          };
        })
        .filter((p) => p.commodity && p.price !== null && p.confidence >= 30);

      const prices: Record<string, { price: number; unit: string; source: string }> = {};
      for (const item of extracted) {
        if (item.commodity === "oil" || item.commodity === "electricity" || item.commodity === "water") {
          prices[item.commodity] = {
            price: item.price as number,
            unit: getCommodityUnit(item.commodity),
            source: item.source,
          };
        }
      }

      const liveCount = [prices.oil, prices.electricity, prices.water].filter(Boolean).length;
      if (liveCount >= 1) {
        return {
          oil: prices.oil
            ? { ...prices.oil, isLive: true }
            : { price: 0, unit: getCommodityUnit("oil"), source: "insufficient data", isLive: false },
          electricity: prices.electricity
            ? { ...prices.electricity, isLive: true }
            : { price: 0, unit: getCommodityUnit("electricity"), source: "insufficient data", isLive: false },
          water: prices.water
            ? { ...prices.water, isLive: true }
            : { price: 0, unit: getCommodityUnit("water"), source: "insufficient data", isLive: false },
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
      const rawPrice = extractPriceFromText(`${page.title} ${page.text}`, commodity);
      const price = rawPrice !== null ? normalizeCommodityPrice(commodity, rawPrice) : null;
      if (price !== null) {
        deterministic[commodity] = { price, source: sanitizeUrl(page.url) || page.url };
        break;
      }
    }
    if (deterministic[commodity].price !== null) continue;

    for (const res of snippets) {
      const rawPrice = extractPriceFromText(`${res.title} ${res.snippet}`, commodity);
      const price = rawPrice !== null ? normalizeCommodityPrice(commodity, rawPrice) : null;
      if (price !== null) {
        deterministic[commodity] = { price, source: sanitizeUrl(res.url) || res.url };
        break;
      }
    }
  }

  if (
    deterministic.oil.price !== null ||
    deterministic.electricity.price !== null ||
    deterministic.water.price !== null
  ) {
    const liveCount = [deterministic.oil, deterministic.electricity, deterministic.water].filter((d) => d.price !== null).length;
    return {
      oil: deterministic.oil.price !== null
        ? { price: deterministic.oil.price, unit: getCommodityUnit("oil"), source: deterministic.oil.source, isLive: true }
        : { price: 0, unit: getCommodityUnit("oil"), source: "insufficient data", isLive: false },
      electricity: deterministic.electricity.price !== null
        ? { price: deterministic.electricity.price, unit: getCommodityUnit("electricity"), source: deterministic.electricity.source, isLive: true }
        : { price: 0, unit: getCommodityUnit("electricity"), source: "insufficient data", isLive: false },
      water: deterministic.water.price !== null
        ? { price: deterministic.water.price, unit: getCommodityUnit("water"), source: deterministic.water.source, isLive: true }
        : { price: 0, unit: getCommodityUnit("water"), source: "insufficient data", isLive: false },
      asOf: new Date().toISOString(),
      dataSource: "TinyFish scrape (deterministic fallback)",
      isLive: liveCount >= 1,
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
