import { kiloRouter } from "../_shared/kiloRouter";
import { REGION_NAMES, type Region } from "../_shared/regions";
import { getGlobalAnalytics, getRegionalAnalytics } from "../_shared/deterministicAnalytics";
import {
  FACTOR_COUNT,
  FACTORS_WINDOW_TTL_MS,
  factorCacheKey,
  isRecentPublishedAt,
  isReputableSource,
  sanitizeUrl,
} from "../_shared/http";
import { getCache, setCache } from "../_shared/cache";
import { coerceCategory, safeParseJson } from "../_shared/validation";
import { VALID_CATEGORIES, type Factor, type RegionId } from "../_shared/types";
import { searchRouter } from "../_shared/searchRouter";

/**
 * The shape stored under the canonical `dynamic-factors:{scope}` key. Every
 * producer (global route, regional route, cron) and every consumer (solutions,
 * forecasts, health) reads and writes this exact shape, so the reasons the UI
 * shows are the reasons the solutions are generated from.
 */
export interface FactorWindow {
  factors: Factor[];
  aiCurated: boolean;
  updatedAt: string;
}

export interface FactorAnalysisOptions {
  abortSignal?: AbortSignal;
}

/** Response body shared by /api/dynamic-factors and /api/regional-factors. */
export interface FactorsPayload {
  factors: Factor[];
  scope: RegionId;
  count: number;
  aiCurated: boolean;
  cacheKey: string;
  updatedAt: string;
  error?: string;
}

export function toFactorsPayload(
  factors: Factor[],
  scope: RegionId,
  aiCurated: boolean,
  extra: { updatedAt: string; error?: string } = { updatedAt: new Date().toISOString() },
): FactorsPayload {
  return {
    factors,
    scope,
    count: factors.length,
    aiCurated,
    cacheKey: factorKeyForScope(scope),
    updatedAt: extra.updatedAt,
    ...(extra.error ? { error: extra.error } : {}),
  };
}

const SYSTEM_PROMPT_GLOBAL =
  "You are a Senior Commodity Risk Analyst. You are provided with current global market analytics, an existing list of global price factors, and fresh validated news excerpts collected through web search.\n\nValidate each candidate trend against the supplied current global market conditions and source evidence.\n\nDetermine whether each candidate is a legitimate market-moving trend or noise at a global scale. Reject stale, duplicate, promotional, speculative, unsupported, irrelevant, or weakly evidenced claims.\n\nFor each legitimate trend, evaluate its expected effect on global oil, electricity, or water prices. Assign an integer importance score from 0 to 100 based on evidence quality, geographic scope, affected commodities, expected price impact, duration, and immediacy.\n\nExplain why each approved trend is legitimate and globally relevant right now. Use only the supplied analytics, factors, excerpts, and source URLs. Do not invent sources or facts.\n\nCRITICAL: Every factor's `source` field MUST be a REAL URL from the provided search results (the `source` field in each candidate). Do NOT use generic labels like \"Public market benchmarks (EIA, IEA, OPEC, UN-Water)\", \"public composite\", or any benchmark name without a URL. If you cannot find a specific source URL in the search results for a factor, omit that factor entirely.\n\nReturn strict JSON only. Do not return markdown or commentary outside JSON.\n\nThe response must contain up to eight validated global factors matching the required schema. If a new legitimate trend is identified, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.";

const SYSTEM_PROMPT_REGIONAL = (regionName: string) =>
  `You are a Senior Commodity Risk Analyst specializing in ${regionName} energy and water markets. You are provided with current ${regionName}-specific market analytics, an existing list of ${regionName} price factors, and fresh validated news excerpts collected through web search that are relevant to ${regionName}.\n\nValidate each candidate trend against the supplied current ${regionName} market conditions and source evidence.\n\nDetermine whether each candidate is a legitimate market-moving trend or noise within ${regionName}. Reject stale, duplicate, promotional, speculative, unsupported, irrelevant, or weakly evidenced claims. Reject any trend that is purely global with no demonstrated ${regionName}-specific price impact.\n\nFor each legitimate trend, evaluate its expected effect on ${regionName} oil, electricity, or water prices specifically. Assign an integer importance score from 0 to 100 based on evidence quality, ${regionName} geographic scope, affected commodities, expected regional price impact, duration, and immediacy within ${regionName}.\n\nExplain why each approved trend is legitimate and relevant to ${regionName} right now. Use only the supplied analytics, factors, excerpts, and source URLs. Do not invent sources or facts.\n\nCRITICAL: Every factor's `source` field MUST be a REAL URL from the provided search results (the `source` field in each candidate). Do NOT use generic labels like "Public market benchmarks (EIA, IEA, OPEC, UN-Water)", "public composite", or any benchmark name without a URL. If you cannot find a specific source URL in the search results for a factor, omit that factor entirely.\n\nReturn strict JSON only. Do not return markdown or commentary outside JSON.\n\nThe response must contain up to eight validated ${regionName} factors matching the required schema. If a new legitimate trend is identified for ${regionName}, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

const GLOBAL_QUERIES = [
  "global oil market prices OPEC supply demand 2026",
  "global electricity power prices renewable energy grid 2026",
  "global water prices scarcity drought utilities 2026",
];

// Alternative query formulations used as a retry when the primary queries
// return zero candidates (e.g. when search providers are bot-blocked).
// These are deliberately simpler and broader to maximise the chance of
// surfacing at least some usable evidence for the AI to reason from.
const GLOBAL_QUERIES_RETRY = [
  "oil prices today OPEC supply",
  "electricity power prices renewable energy",
  "water scarcity drought prices utilities",
];

const REGION_QUERIES: Record<Region, string[]> = {
  asia: [
    "Asia oil market prices China India demand OPEC 2026",
    "Asia electricity power prices renewables grid China India 2026",
    "Asia water prices scarcity drought urbanization 2026",
  ],
  europe: [
    "Europe oil market prices Brent Russian supply sanctions 2026",
    "Europe electricity power prices carbon ETS renewables gas 2026",
    "Europe water prices drought scarcity Alpine hydropower 2026",
  ],
  africa: [
    "Africa oil market prices Nigeria Angola production exports 2026",
    "Africa electricity power prices diesel gensets grid reliability 2026",
    "Africa water prices drought scarcity Sahel utilities 2026",
  ],
  americas: [
    "Americas oil market prices WTI shale LNG exports 2026",
    "Americas electricity power prices hydro drought Henry Hub 2026",
    "Americas water prices drought California Southwest utilities 2026",
  ],
  oceania: [
    "Oceania oil market prices LNG import parity Australia 2026",
    "Oceania electricity power prices NEM NZ wholesale drought 2026",
    "Oceania water prices drought Sydney Melbourne utilities 2026",
  ],
};

const REGION_QUERIES_RETRY: Record<Region, string[]> = {
  asia: [
    "oil prices China India demand",
    "electricity power prices Asia renewables",
    "water scarcity drought Asia urbanization",
  ],
  europe: [
    "oil prices Brent Russia sanctions",
    "electricity power prices Europe carbon ETS",
    "water drought Europe Alpine hydropower",
  ],
  africa: [
    "oil prices Nigeria Angola production",
    "electricity power prices Africa diesel gensets",
    "water drought scarcity Africa Sahel",
  ],
  americas: [
    "oil prices WTI shale LNG exports",
    "electricity power prices Americas hydro drought",
    "water drought California Southwest utilities",
  ],
  oceania: [
    "oil prices LNG import parity Australia",
    "electricity power prices NEM NZ wholesale",
    "water drought Sydney Melbourne utilities",
  ],
};

const FALLBACK_NAMES: Record<RegionId, string[]> = {
  global: [
    "OPEC+ Production Decisions",
    "Geopolitical Tensions & Supply Disruptions",
    "Demand Growth in China & India",
    "Renewable Energy Buildout",
    "Weather & Temperature Extremes",
    "Water Scarcity & Drought",
    "Desalination & Reuse Technology",
    "Grid & Water Infrastructure Investment",
  ],
  asia: [
    "China & India Energy Demand Growth",
    "ASEAN Grid Interconnection",
    "Coal-to-Gas Switching",
    "Strait of Hormuz Risk",
    "Urbanization & Desalination",
    "Renewable Energy Buildout",
    "Monsoon & Hydropower Variability",
    "EV Adoption & Battery Storage",
  ],
  europe: [
    "EU ETS Carbon Price",
    "Russian Supply Displacement",
    "Renewables Curtailment Risk",
    "Drought & Alpine Hydro",
    "Nuclear & Gas Generation Mix",
    "Energy Efficiency Mandates",
    "Offshore Wind Expansion",
    "Heat Pump Electrification",
  ],
  africa: [
    "Nigeria & Angola Production",
    "Diesel Genset Dependence",
    "Drought & Sahel Scarcity",
    "Subsidy Reform Pressure",
    "Hydroelectric Reliance",
    "Solar Mini-Grid Deployment",
    "Copper & Critical Minerals Demand",
    "Diesel Import Parity Pricing",
  ],
  americas: [
    "US Shale Productivity",
    "Henry Hub Gas to Power",
    "LatAm Hydrology & Drought",
    "Pipeline & Export Capacity",
    "California Water Stress",
    "Grid Resilience Investment",
    "EV Adoption & Battery Storage",
    "LNG Export Growth",
  ],
  oceania: [
    "LNG Export Linkage",
    "NEM & NZ Wholesale Spikes",
    "Millennium Drought Legacy",
    "Remote Island Fuel Premiums",
    "Desalination & Reuse",
    "Renewable Energy Zones",
    "Coal Plant Retirements",
    "Urban Water Tariff Reform",
  ],
};

const RECENT_MONTH = () =>
  new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

function scopeRegion(scope: RegionId): Region | null {
  return scope === "global" ? null : (scope as Region);
}

function scopeLabel(scope: RegionId): string {
  const region = scopeRegion(scope);
  return region ? REGION_NAMES[region] : "global";
}

export function factorKeyForScope(scope: RegionId): string {
  return factorCacheKey(scope);
}

/**
 * Reads the currently stored factor window for a scope. Returns null when
 * nothing has been curated yet. A legacy bare `Factor[]` payload (written by
 * the old cron endpoint) is accepted so in-flight deployments do not reset.
 */
export async function readFactorWindow(scope: RegionId): Promise<FactorWindow | null> {
  const key = factorKeyForScope(scope);
  const raw = await getCache<unknown>(key, FACTORS_WINDOW_TTL_MS);
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const factors = raw.filter(isFactorLike);
    if (factors.length === 0) return null;
    const updatedAt = factors[0]?.updatedAt ?? new Date().toISOString();
    return { factors, aiCurated: true, updatedAt };
  }
  if (typeof raw !== "object") return null;
  const entry = raw as Partial<FactorWindow>;
  const factors = Array.isArray(entry.factors) ? entry.factors.filter(isFactorLike) : [];
  if (factors.length === 0) return null;
  return {
    factors,
    aiCurated: entry.aiCurated === true,
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
  };
}

export async function writeFactorWindow(
  scope: RegionId,
  factors: Factor[],
  aiCurated: boolean,
): Promise<FactorWindow> {
  const window: FactorWindow = { factors, aiCurated, updatedAt: new Date().toISOString() };
  await setCache(factorKeyForScope(scope), window, FACTORS_WINDOW_TTL_MS);
  return window;
}

/** True when the stored window is recent enough to answer a request without re-curating. */
export function isFreshWindow(window: FactorWindow, freshnessMs: number): boolean {
  const age = Date.now() - Date.parse(window.updatedAt);
  return Number.isFinite(age) && age >= 0 && age < freshnessMs;
}

function isFactorLike(value: unknown): value is Factor {
  if (!value || typeof value !== "object") return false;
  const f = value as Partial<Factor>;
  return typeof f.name === "string" && Array.isArray(f.commodities);
}

function normalizeFactorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function buildFallbackFactors(scope: RegionId): Factor[] {
  const now = new Date().toISOString();
  const label = scopeLabel(scope);
  const source =
    scope === "global"
      ? "Public market benchmarks (EIA, IEA, OPEC, UN-Water)"
      : `${label} regional energy authorities and public benchmarks`;
  const commodities: Factor["commodities"] = ["oil", "electricity", "water"];
  return FALLBACK_NAMES[scope].slice(0, FACTOR_COUNT).map((name, i) => ({
    id: `fallback-${scope}-${i + 1}`,
    name,
    category: i % 3 === 0 ? "Policy" : i % 3 === 1 ? "Market" : "Structural",
    commodities,
    explanation: `Static ${label} fallback factor maintained when live AI curation is unavailable.`,
    direction: i % 3 === 2 ? "mixed" : i % 2 === 0 ? "up" : "down",
    magnitude: (["High", "Medium", "Low"] as const)[i % 3],
    source,
    bias: (["short", "mid", "long", "flat"] as const)[i % 4],
    drift: {},
    regions: scope === "global" ? ["global"] : [scope],
    scope,
    importanceScore: 70 - i * 2,
    createdAt: now,
    updatedAt: now,
  }));
}

export function normalizeFactor(raw: unknown, scope: RegionId): Factor | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const name = typeof f.name === "string" ? f.name.trim() : "";
  const explanation = typeof f.explanation === "string" ? f.explanation.trim() : "";
  const source = typeof f.source === "string" ? f.source.trim() : "";
  const id =
    typeof f.id === "string" && f.id.trim()
      ? f.id.trim()
      : `dynamic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Tolerant: an unknown label falls back to the safe default instead of
  // aborting the entire curation run.
  const category = coerceCategory(f.category, VALID_CATEGORIES);
  const direction =
    f.direction === "up" || f.direction === "down" || f.direction === "mixed" ? f.direction : "mixed";
  const magnitude =
    f.magnitude === "High" || f.magnitude === "Medium" || f.magnitude === "Low" ? f.magnitude : "Medium";
  const bias = f.bias === "short" || f.bias === "mid" || f.bias === "long" || f.bias === "flat" ? f.bias : "flat";
  const sourceUrl = sanitizeUrl(source);

  // Defensive: reject factors whose source is not a valid URL.  This prevents
  // the AI from emitting generic labels like "Public market benchmarks" when
  // candidate search results with real URLs were provided in the prompt.
  // The system prompt already instructs the model to omit such factors, but
  // this server-side check provides a hard guarantee that only URL-sourced
  // factors are ever stored and displayed.
  if (!sourceUrl) {
    return null;
  }

  const resolvedSource = sourceUrl;
  const importanceScore =
    typeof f.importanceScore === "number" && Number.isFinite(f.importanceScore)
      ? Math.max(0, Math.min(100, Math.round(f.importanceScore)))
      : 0;
  const commodities = Array.isArray(f.commodities)
    ? (f.commodities as unknown[]).filter(
        (c): c is Factor["commodities"][number] => c === "oil" || c === "electricity" || c === "water",
      )
    : [];
  // Default to all commodities if none specified.
  const resolvedCommodities = commodities.length > 0 ? commodities : (["oil", "electricity", "water"] as Factor["commodities"]);

  if (!name || !explanation) return null;

  // Accept factors with importanceScore >= 0 (was >= 20).
  const resolvedImportance = Math.max(0, importanceScore);
  const region = scopeRegion(scope);
  const regions =
    f.regions && Array.isArray(f.regions)
      ? (f.regions as unknown[]).filter(
          (r): r is RegionId => r === "global" || (typeof r === "string" && r in REGION_NAMES),
        )
      : scope === "global"
        ? ["global"]
        : region
          ? [region]
          : [];

  if (!name || !explanation || resolvedCommodities.length === 0) return null;

  const now = new Date().toISOString();
  const driftRaw = (f.drift ?? {}) as Record<string, unknown>;

  return {
    id: id.slice(0, 80),
    name: name.slice(0, 160),
    category: category.slice(0, 80),
    commodities: Array.from(new Set(resolvedCommodities)) as Factor["commodities"],
    explanation: explanation.slice(0, 1200),
    direction,
    magnitude,
    source: resolvedSource,
    bias,
    drift: {
      ...(typeof driftRaw.oil === "number" && Number.isFinite(driftRaw.oil) ? { oil: driftRaw.oil } : {}),
      ...(typeof driftRaw.electricity === "number" && Number.isFinite(driftRaw.electricity)
        ? { electricity: driftRaw.electricity }
        : {}),
      ...(typeof driftRaw.water === "number" && Number.isFinite(driftRaw.water) ? { water: driftRaw.water } : {}),
    },
    regions: Array.from(new Set(regions)) as Factor["regions"],
    scope,
    importanceScore: resolvedImportance,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Merges a previously stored window with freshly curated factors and keeps the
 * newest {@link FACTOR_COUNT} by `createdAt`.
 *
 * A factor that is re-curated under the same name keeps its original `id` and
 * `createdAt`, so its age stays meaningful; only genuinely new reasons push the
 * oldest ones out of the window.
 */
export function mergeRollingWindow(existing: Factor[], incoming: Factor[]): Factor[] {
  const priorByName = new Map<string, Factor>();
  for (const factor of existing) {
    const key = normalizeFactorName(factor.name);
    if (key && !priorByName.has(key)) priorByName.set(key, factor);
  }

  const carried = incoming.map((factor) => {
    const prior = priorByName.get(normalizeFactorName(factor.name));
    if (!prior) return factor;
    return { ...factor, id: prior.id, createdAt: prior.createdAt, updatedAt: new Date().toISOString() };
  });

  // Freshly curated factors always rank ahead of the carried-over window, so a
  // same-millisecond tie can never let a static fallback displace a live reason.
  const ranked: Array<{ factor: Factor; rank: number }> = [
    ...carried.map((factor) => ({ factor, rank: 0 })),
    ...existing.map((factor) => ({ factor, rank: 1 })),
  ];
  ranked.sort(
    (a, b) => a.rank - b.rank || Date.parse(b.factor.createdAt) - Date.parse(a.factor.createdAt),
  );

  const seen = new Set<string>();
  const out: Factor[] = [];
  for (const { factor } of ranked) {
    const key = normalizeFactorName(factor.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(factor);
    if (out.length >= FACTOR_COUNT) break;
  }
  return out;
}

/**
 * Single implementation of the factor-curation pipeline used by the global
 * route, the regional route and the cron endpoint.
 */
export async function runFactorAnalysis(
  scope: RegionId,
  options: FactorAnalysisOptions = {},
): Promise<FactorWindow> {
  const signal = options.abortSignal;
  const region = scopeRegion(scope);
  const previous = await readFactorWindow(scope);
  const existing = previous?.factors.length ? previous.factors : buildFallbackFactors(scope);
  const carriedAiCurated = previous?.aiCurated ?? false;

  const analytics =
    scope === "global" ? await getGlobalAnalytics() : await getRegionalAnalytics(scope as Region);

  const now = new Date().toISOString();
  const returnExisting = () => ({ factors: existing, aiCurated: carriedAiCurated, updatedAt: now });

  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      // On retry (attempt > 0) switch to simpler, broader alternative queries
      const actualRegionQueries = scope === "global" ? null : REGION_QUERIES[scope as Region];
      const actualRetryQueries = scope === "global" ? null : REGION_QUERIES_RETRY[scope as Region];
      const effectiveQueries = attempt === 0
        ? (scope === "global" ? GLOBAL_QUERIES : actualRegionQueries!)
        : (scope === "global" ? GLOBAL_QUERIES_RETRY : actualRetryQueries!);
      const searches = await Promise.all(
        effectiveQueries.map((q) =>
          searchRouter.search(`${q} ${RECENT_MONTH()}`, { limit: 10, region: region ?? undefined }, signal),
        ),
      );

      const rawTotal = searches.reduce((sum, r) => sum + r.results.length, 0);
      const reputableCount = searches
        .flatMap((r) => r.results)
        .filter((r) => isReputableSource(r.url)).length;
      const recentCount = searches
        .flatMap((r) => r.results)
        .filter((r) => isRecentPublishedAt(r.publishedAt)).length;
      const bothCount = searches
        .flatMap((r) => r.results)
        .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt)).length;

      const strictCandidates = searches
        .flatMap((r) => r.results)
        .map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }))
        .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt))
        .slice(0, 15);

      let candidates = strictCandidates;

      if (candidates.length === 0) {
        const fallbackCandidates = searches
          .flatMap((r) => r.results)
          .filter((r) => r.url && r.title)
          .map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }))
          .slice(0, 15);

        if (fallbackCandidates.length === 0) {
          console.warn(
            `Factor analysis for scope "${scope}" found 0 curated candidates. ` +
              `Searches attempted: ${effectiveQueries.length}; raw results returned: ${rawTotal}; ` +
              `passing isReputableSource: ${reputableCount}; passing isRecentPublishedAt: ${recentCount}; ` +
              `passing both: ${bothCount}. Retrying with alternative queries.`,
          );
          candidates = [];
        } else {
          console.info(
            `Factor analysis for scope "${scope}" using lenient candidate fallback ` +
              `(${fallbackCandidates.length} candidates after reputation filter yielded 0).`,
          );
          candidates = fallbackCandidates;
        }
      } else {
        console.info(
          `Factor analysis for scope "${scope}" using ${strictCandidates.length} strict-candidate matches.`,
        );
      }

      // If no candidates found, attempt retry with alternative queries on first attempt
      // or relaxed reputation filter on subsequent attempts
      if (candidates.length === 0) {
          if (attempt === 0) {
            // Retry with alternative (simpler/broader) queries
            console.info(
              `Factor analysis for scope "${scope}" attempting retry with alternative queries...`,
            );
            const retryQueries = scope === "global" ? GLOBAL_QUERIES_RETRY : REGION_QUERIES_RETRY[scope as Region];
            const retrySearches = await Promise.all(
              retryQueries.map((q) =>
                searchRouter.search(`${q} ${RECENT_MONTH()}`, { limit: 10, region: region ?? undefined }, signal),
              ),
            );
            const retryRawTotal = retrySearches.reduce((sum, r) => sum + r.results.length, 0);
            const retryReputableCount = retrySearches
              .flatMap((r) => r.results)
              .filter((r) => isReputableSource(r.url)).length;
            const retryRecentCount = retrySearches
              .flatMap((r) => r.results)
              .filter((r) => isRecentPublishedAt(r.publishedAt)).length;
            const retryBothCount = retrySearches
              .flatMap((r) => r.results)
              .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt)).length;

            let retryStrictCandidates = retrySearches
              .flatMap((r) => r.results)
              .map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }))
              .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt))
              .slice(0, 15);

            let retryFallbackCandidates = retrySearches
              .flatMap((r) => r.results)
              .filter((r) => r.url && r.title)
              .map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }))
              .slice(0, 15);

            if (retryStrictCandidates.length > 0) {
              candidates = retryStrictCandidates;
              console.info(
                `Factor analysis for scope "${scope}" retry found ${retryStrictCandidates.length} strict candidates from alternative queries.`,
              );
            } else if (retryFallbackCandidates.length > 0) {
              candidates = retryFallbackCandidates;
              console.info(
                `Factor analysis for scope "${scope}" retry found ${retryFallbackCandidates.length} lenient candidates from alternative queries.`,
              );
            } else {
              console.warn(
                `Factor analysis for scope "${scope}" retry also yielded 0 candidates. ` +
                  `Attempting relaxed reputation filter as last resort.`,
              );
            }
          }

          // Last resort: relaxed reputation filter (accept any URL + title)
          if (candidates.length === 0) {
            const relaxedCandidates = searches
              .flatMap((r) => r.results)
              .filter((r) => r.url && r.title)
              .map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }))
              .slice(0, 15);

            if (relaxedCandidates.length > 0) {
              candidates = relaxedCandidates;
              console.info(
                `Factor analysis for scope "${scope}" used ${relaxedCandidates.length} relaxed candidates (reputation filter skipped).`,
              );
            } else if (attempt > 0) {
              // If we've already retried with alternative queries and still no candidates,
              // give up and return existing factors
              console.error(
                `Factor analysis for scope "${scope}" exhausted all search sources with 0 candidates after ${maxRetries + 1} attempts. ` +
                  `Returning existing fallback factors.`,
              );
              return returnExisting();
            }
          }
        }

      const excerpts = await Promise.all(
        candidates.map(async (r) => {
          try {
            const scraped = await searchRouter.scrapeUrl(r.url, signal);
            return scraped ? { ...r, text: scraped.text, title: scraped.title || r.title } : r;
          } catch {
            return r;
          }
        }),
      );

      const prompt = scope === "global" ? SYSTEM_PROMPT_GLOBAL : SYSTEM_PROMPT_REGIONAL(scopeLabel(scope));
       const payload = {
         messages: [
           { role: "system", content: prompt },
           {
             role: "user",
             content: JSON.stringify({
               analytics,
               existingFactors: existing,
               candidates: excerpts.map((c) => ({
                 title: c.title,
                 source: c.url,
                 snippet: c.snippet?.slice(0, 2500),
                 text: (c as { text?: string }).text?.slice(0, 8000),
               })),
               region,
               month: RECENT_MONTH(),
             }),
           },
         ],
         max_tokens: 4096,
         temperature: 0.2,
         response_format: { type: "json_object" },
       };

      const response = await kiloRouter.kiloInfer(payload, signal);
      const content = response.choices?.[0]?.message?.content ?? "";
       const parsed = safeParseJson<{ factors?: unknown[] }>(content);
       if (!parsed?.factors || !Array.isArray(parsed.factors)) {
         if (attempt < maxRetries) {
           attempt++;
           const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
           console.warn(`Factor analysis kiloInfer returned no valid factors for scope "${scope}", retrying in ${backoffMs}ms (attempt ${attempt}/${maxRetries})`);
           await new Promise((resolve) => setTimeout(resolve, backoffMs));
           continue;
         }
        // Kilo inference succeeded (returned valid JSON response) but produced
        // no factors array after all retries. Do not mark as curated — the
        // factors returned are fallback/static, not AI-curated.
        return {
          factors: existing,
          aiCurated: false,
          updatedAt: new Date().toISOString(),
        };
       }

      const normalized = parsed.factors
        .map((f) => normalizeFactor(f, scope))
        .filter((f): f is Factor => f !== null)
        .filter((f) => f.scope === scope)
        .slice(0, FACTOR_COUNT);

      if (normalized.length === 0) {
        if (attempt < maxRetries) {
          attempt++;
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.warn(`Factor analysis normalized 0 factors for scope "${scope}", retrying in ${backoffMs}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        // Kilo inference succeeded but produced no valid factors after retries.
        // Do not mark as curated — the factors returned are fallback/static,
        // not AI-curated.
        return {
          factors: existing,
          aiCurated: false,
          updatedAt: new Date().toISOString(),
        };
      }

      return {
        factors: mergeRollingWindow(existing, normalized),
        aiCurated: true,
        updatedAt: new Date().toISOString(),
      };
     } catch (error) {
       if (attempt < maxRetries) {
         attempt++;
         const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
         console.error(`Factor analysis failed for scope "${scope}" (attempt ${attempt}/${maxRetries}):`, error);
         await new Promise((resolve) => setTimeout(resolve, backoffMs));
         continue;
       }
       console.error(`Factor analysis failed for scope "${scope}" after ${maxRetries} retries:`, error);
       // Return existing factors but mark as not curated since the AI failed.
       return returnExisting();
     }
  }

  return returnExisting();
}
