import { kiloRouter } from "../_shared/kiloRouter";
import { unifiedSearchRouter, type SearchResult } from "../_shared/unifiedSearchRouter";
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

interface ScrapedSearchResult extends SearchResult {
  text?: string;
}

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
  "You are a Senior Commodity Risk Analyst. You are provided with current global market analytics, an existing list of global price factors, and fresh validated news excerpts collected through TinyFish.\n\nValidate each candidate trend against the supplied current global market conditions and source evidence.\n\nDetermine whether each candidate is a legitimate market-moving trend or noise at a global scale. Reject stale, duplicate, promotional, speculative, unsupported, irrelevant, or weakly evidenced claims.\n\nFor each legitimate trend, evaluate its expected effect on global oil, electricity, or water prices. Assign an integer importance score from 0 to 100 based on evidence quality, geographic scope, affected commodities, expected price impact, duration, and immediacy.\n\nExplain why each approved trend is legitimate and globally relevant right now. Use only the supplied analytics, factors, excerpts, and source URLs. Do not invent sources or facts.\n\nReturn strict JSON only. Do not return markdown or commentary outside JSON.\n\nThe response must contain up to eight validated global factors matching the required schema. If a new legitimate trend is identified, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.";

const SYSTEM_PROMPT_REGIONAL = (regionName: string) =>
  `You are a Senior Commodity Risk Analyst specializing in ${regionName} energy and water markets. You are provided with current ${regionName}-specific market analytics, an existing list of ${regionName} price factors, and fresh validated news excerpts collected through TinyFish that are relevant to ${regionName}.\n\nValidate each candidate trend against the supplied current ${regionName} market conditions and source evidence.\n\nDetermine whether each candidate is a legitimate market-moving trend or noise within ${regionName}. Reject stale, duplicate, promotional, speculative, unsupported, irrelevant, or weakly evidenced claims. Reject any trend that is purely global with no demonstrated ${regionName}-specific price impact.\n\nFor each legitimate trend, evaluate its expected effect on ${regionName} oil, electricity, or water prices specifically. Assign an integer importance score from 0 to 100 based on evidence quality, ${regionName} geographic scope, affected commodities, expected regional price impact, duration, and immediacy within ${regionName}.\n\nExplain why each approved trend is legitimate and relevant to ${regionName} right now. Use only the supplied analytics, factors, excerpts, and source URLs. Do not invent sources or facts.\n\nReturn strict JSON only. Do not return markdown or commentary outside JSON.\n\nThe response must contain up to eight validated ${regionName} factors matching the required schema. If a new legitimate trend is identified for ${regionName}, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

const GLOBAL_QUERIES = [
  "global oil market prices OPEC supply demand 2026",
  "global electricity power prices renewable energy grid 2026",
  "global water prices scarcity drought utilities 2026",
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

/**
 * Build dynamic fallback factors from search results when AI inference is unavailable.
 * Uses the actual search result titles/snippets to create meaningful factor names and explanations.
 */
export function buildDynamicFallbackFactors(
  scope: RegionId,
  candidates: ScrapedSearchResult[],
  analytics: Awaited<ReturnType<typeof getGlobalAnalytics>> | Awaited<ReturnType<typeof getRegionalAnalytics>>
): Factor[] {
  const now = new Date().toISOString();
  const label = scopeLabel(scope);
  const source =
    scope === "global"
      ? "Public market benchmarks (EIA, IEA, OPEC, UN-Water) + live search evidence"
      : `${label} regional energy authorities and public benchmarks + live search evidence`;
  const commodities: Factor["commodities"] = ["oil", "electricity", "water"];
  
  // If we have candidates, use them to generate factor names
  const factorNames: string[] = [];
  const usedTitles = new Set<string>();
  
  for (const candidate of candidates) {
    if (factorNames.length >= FACTOR_COUNT) break;
    
    // Extract key terms from title/snippet to create a factor name
    const title = candidate.title || "";
    const snippet = candidate.snippet || "";
    const combined = `${title} ${snippet}`.toLowerCase();
    
    // Map common terms to factor categories
    let factorName = "";
    if (combined.includes("opec") || combined.includes("production") || combined.includes("supply")) {
      factorName = "OPEC+ Production Decisions";
    } else if (combined.includes("geopolitical") || combined.includes("tension") || combined.includes("conflict") || combined.includes("sanction")) {
      factorName = "Geopolitical Tensions & Supply Disruptions";
    } else if (combined.includes("china") || combined.includes("india") || combined.includes("demand growth")) {
      factorName = "Demand Growth in China & India";
    } else if (combined.includes("renewable") || combined.includes("solar") || combined.includes("wind") || combined.includes("clean energy")) {
      factorName = "Renewable Energy Buildout";
    } else if (combined.includes("weather") || combined.includes("temperature") || combined.includes("extreme") || combined.includes("storm")) {
      factorName = "Weather & Temperature Extremes";
    } else if (combined.includes("water") || combined.includes("drought") || combined.includes("scarcity")) {
      factorName = "Water Scarcity & Drought";
    } else if (combined.includes("desalination") || combined.includes("reuse") || combined.includes("recycling")) {
      factorName = "Desalination & Reuse Technology";
    } else if (combined.includes("grid") || combined.includes("infrastructure") || combined.includes("investment")) {
      factorName = "Grid & Water Infrastructure Investment";
    } else if (combined.includes("coal") && combined.includes("gas")) {
      factorName = "Coal-to-Gas Switching";
    } else if (combined.includes("urbanization") || combined.includes("desalination")) {
      factorName = "Urbanization & Desalination";
    } else if (combined.includes("monsoon") || combined.includes("hydro")) {
      factorName = "Monsoon & Hydropower Variability";
    } else if (combined.includes("ev") || combined.includes("battery") || combined.includes("storage")) {
      factorName = "EV Adoption & Battery Storage";
    } else if (combined.includes("ets") || combined.includes("carbon price")) {
      factorName = "EU ETS Carbon Price";
    } else if (combined.includes("russian") || combined.includes("displacement")) {
      factorName = "Russian Supply Displacement";
    } else if (combined.includes("curtailment")) {
      factorName = "Renewables Curtailment Risk";
    } else if (combined.includes("nuclear") || combined.includes("gas generation")) {
      factorName = "Nuclear & Gas Generation Mix";
    } else if (combined.includes("efficiency")) {
      factorName = "Energy Efficiency Mandates";
    } else if (combined.includes("offshore wind")) {
      factorName = "Offshore Wind Expansion";
    } else if (combined.includes("heat pump")) {
      factorName = "Heat Pump Electrification";
    } else if (combined.includes("nigeria") || combined.includes("angola")) {
      factorName = "Nigeria & Angola Production";
    } else if (combined.includes("diesel genset")) {
      factorName = "Diesel Genset Dependence";
    } else if (combined.includes("subsidy")) {
      factorName = "Subsidy Reform Pressure";
    } else if (combined.includes("hydroelectric")) {
      factorName = "Hydroelectric Reliance";
    } else if (combined.includes("solar mini-grid")) {
      factorName = "Solar Mini-Grid Deployment";
    } else if (combined.includes("copper") || combined.includes("critical mineral")) {
      factorName = "Copper & Critical Minerals Demand";
    } else if (combined.includes("diesel import")) {
      factorName = "Diesel Import Parity Pricing";
    } else if (combined.includes("shale")) {
      factorName = "US Shale Productivity";
    } else if (combined.includes("henry hub")) {
      factorName = "Henry Hub Gas to Power";
    } else if (combined.includes("latam") || combined.includes("hydrology")) {
      factorName = "LatAm Hydrology & Drought";
    } else if (combined.includes("pipeline") || combined.includes("export capacity")) {
      factorName = "Pipeline & Export Capacity";
    } else if (combined.includes("california water")) {
      factorName = "California Water Stress";
    } else if (combined.includes("grid resilience")) {
      factorName = "Grid Resilience Investment";
    } else if (combined.includes("lng export")) {
      factorName = "LNG Export Growth";
    } else if (combined.includes("lng export") || combined.includes("linkage")) {
      factorName = "LNG Export Linkage";
    } else if (combined.includes("nem") || combined.includes("nz wholesale")) {
      factorName = "NEM & NZ Wholesale Spikes";
    } else if (combined.includes("millennium drought")) {
      factorName = "Millennium Drought Legacy";
    } else if (combined.includes("remote island") || combined.includes("fuel premium")) {
      factorName = "Remote Island Fuel Premiums";
    } else if (combined.includes("renewable energy zone")) {
      factorName = "Renewable Energy Zones";
    } else if (combined.includes("coal plant retirement")) {
      factorName = "Coal Plant Retirements";
    } else if (combined.includes("water tariff")) {
      factorName = "Urban Water Tariff Reform";
    } else {
      // Generic fallback based on title
      const words = title.split(/\s+/).filter(w => w.length > 3);
      if (words.length >= 2) {
        factorName = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
    }
    
    // Normalize and deduplicate
    const normalized = factorName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (normalized && !usedTitles.has(normalized) && factorName.length > 5) {
      usedTitles.add(normalized);
      factorNames.push(factorName);
    }
  }
  
  // Fill remaining slots with static fallbacks
  const staticNames = FALLBACK_NAMES[scope].filter(name => 
    !factorNames.some(f => f.toLowerCase() === name.toLowerCase())
  );
  for (const name of staticNames) {
    if (factorNames.length >= FACTOR_COUNT) break;
    factorNames.push(name);
  }
  
  return factorNames.slice(0, FACTOR_COUNT).map((name, i) => ({
    id: `dynamic-fallback-${scope}-${i + 1}`,
    name,
    category: i % 3 === 0 ? "Policy" : i % 3 === 1 ? "Market" : "Structural",
    commodities,
    explanation: `Derived from live search evidence (${candidates.length} sources) when AI curation was unavailable. Search sources: ${candidates.slice(0, 3).map(c => c.site_name).join(", ")}. ${scope === "global" ? "Global" : label} market analytics: fuelLevy ${analytics.fuelLevy >= 0 ? "+" : ""}${analytics.fuelLevy}, electricity index ${analytics.electricityTariffAdjustmentIndex >= 0 ? "+" : ""}${analytics.electricityTariffAdjustmentIndex}.`,
    direction: i % 3 === 2 ? "mixed" : i % 2 === 0 ? "up" : "down",
    magnitude: (["High", "Medium", "Low"] as const)[i % 3],
    source,
    bias: (["short", "mid", "long", "flat"] as const)[i % 4],
    drift: {},
    regions: scope === "global" ? ["global"] : [scope],
    scope,
    importanceScore: 65 - i * 2,
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
  const importanceScore =
    typeof f.importanceScore === "number" && Number.isFinite(f.importanceScore)
      ? Math.max(0, Math.min(100, Math.round(f.importanceScore)))
      : 0;
  const commodities = Array.isArray(f.commodities)
    ? (f.commodities as unknown[]).filter(
        (c): c is Factor["commodities"][number] => c === "oil" || c === "electricity" || c === "water",
      )
    : [];
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

  if (!name || !explanation || !sourceUrl || importanceScore < 20 || commodities.length === 0) return null;

  const now = new Date().toISOString();
  const driftRaw = (f.drift ?? {}) as Record<string, unknown>;

  return {
    id: id.slice(0, 80),
    name: name.slice(0, 160),
    category: category.slice(0, 80),
    commodities: Array.from(new Set(commodities)) as Factor["commodities"],
    explanation: explanation.slice(0, 1200),
    direction,
    magnitude,
    source: sourceUrl,
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
    importanceScore,
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
  // The previously stored factors are the rolling window; the static fallbacks
  // are only used when nothing has been curated yet.
  const existing = previous?.factors.length ? previous.factors : buildFallbackFactors(scope);
  const carriedAiCurated = previous?.aiCurated ?? false;

  const analytics =
    scope === "global" ? await getGlobalAnalytics() : await getRegionalAnalytics(scope as Region);

  const now = new Date().toISOString();
  const returnExisting = () => ({ factors: existing, aiCurated: carriedAiCurated, updatedAt: now });

  let candidates: ScrapedSearchResult[] = [];
  try {
    const queries = scope === "global" ? GLOBAL_QUERIES : REGION_QUERIES[scope as Region];
    console.log(`[FactorAnalysis] Starting curation for scope: ${scope}, queries: ${queries.length}`);
    const searches = await Promise.all(
      queries.map((q) =>
        unifiedSearchRouter.search(`${q} ${RECENT_MONTH()}`, { limit: 10, region: region ?? undefined }, signal),
      ),
    );
    console.log(`[FactorAnalysis] Search completed for ${scope}, got ${searches.length} search results`);

    let totalResults = 0;
    searches.forEach((s, i) => {
      console.log(`[FactorAnalysis] Query ${i}: ${s.results.length} results, source: ${s.results[0]?.sourceType || 'unknown'}`);
      totalResults += s.results.length;
    });
    console.log(`[FactorAnalysis] Total raw search results: ${totalResults}`);

    candidates = searches
      .flatMap((r) => r.results)
      .map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }))
      .filter((r) => {
        // Allow fallback search results (Playwright/DuckDuckGo) to bypass reputable source filter
        // since they come from web search which may include newer/lesser-known sources
        const isFallbackSource = r.sourceType === "playwright" || r.sourceType === "duckduckgo";
        const passesReputableFilter = isFallbackSource || isReputableSource(r.url);
        const passesDateFilter = isRecentPublishedAt(r.publishedAt);
        // Track filtered-out results for diagnostics
        if (!passesReputableFilter) {
          console.warn(`[FactorAnalysis] Filtered out non-reputable/non-fallback result: ${r.title.slice(0, 80)} (${r.url}) source=${r.sourceType}`);
        }
        if (!passesDateFilter) {
          console.warn(`[FactorAnalysis] Filtered out stale result: ${r.title.slice(0, 80)} (${r.url}) publishedAt=${r.publishedAt}`);
        }
        return passesReputableFilter && passesDateFilter;
      })
      .slice(0, 15);

    console.log(`[FactorAnalysis] After filtering: ${candidates.length} candidates for ${scope}`);
    if (candidates.length > 0) {
      console.log(`[FactorAnalysis] Top candidate: ${candidates[0].title} (source: ${candidates[0].sourceType})`);
    }

    if (candidates.length === 0) {
      console.warn(`[FactorAnalysis] No valid candidates for ${scope}, using static fallback factors`);
      return returnExisting();
    }

    const excerpts: ScrapedSearchResult[] = await Promise.all(
      candidates.map(async (r): Promise<ScrapedSearchResult> => {
        try {
          const scraped = await unifiedSearchRouter.scrape(r.url, signal);
          return scraped ? { ...r, text: scraped.text, title: scraped.title || r.title } : r;
        } catch {
          return r;
        }
      }),
    );

    console.log(`[FactorAnalysis] Scraped ${excerpts.filter(e => e.text).length}/${excerpts.length} articles for ${scope}`);

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
    };

    console.log(`[FactorAnalysis] Calling Kilo AI inference for ${scope}...`);
    let response;
    let aiFailed = false;
    try {
      response = await kiloRouter.kiloInfer(payload, signal);
    } catch (aiError) {
      console.warn(`[FactorAnalysis] Kilo AI inference failed for ${scope}: ${aiError instanceof Error ? aiError.message : String(aiError)}. Using dynamic fallback from search results.`);
      aiFailed = true;
    }
    
    if (!aiFailed && response) {
      const content = response.choices?.[0]?.message?.content ?? "";
      console.log(`[FactorAnalysis] Kilo AI response length: ${content.length} chars for ${scope}`);
      
      if (!content) {
        console.warn(`[FactorAnalysis] Empty AI response for ${scope}, using dynamic fallback from search results`);
      } else {
        const parsed = safeParseJson<{ factors?: unknown[] }>(content);
        if (!parsed?.factors || !Array.isArray(parsed.factors)) {
          console.warn(`[FactorAnalysis] Invalid AI response format for ${scope}, using dynamic fallback from search results`);
        } else {
          console.log(`[FactorAnalysis] AI returned ${parsed.factors.length} raw factors for ${scope}`);

          const normalized = parsed.factors
            .map((f) => normalizeFactor(f, scope))
            .filter((f): f is Factor => f !== null)
            .filter((f) => f.scope === scope)
            .slice(0, FACTOR_COUNT);

          console.log(`[FactorAnalysis] Normalized to ${normalized.length} valid factors for ${scope}`);

          if (normalized.length > 0) {
            return {
              factors: mergeRollingWindow(existing, normalized),
              aiCurated: true,
              updatedAt: new Date().toISOString(),
            };
          }
          console.warn(`[FactorAnalysis] No valid normalized factors for ${scope}, using dynamic fallback from search results`);
        }
      }
    }
    
    // AI failed or returned invalid results - use dynamic fallback from search candidates
    console.log(`[FactorAnalysis] Generating dynamic fallback factors from ${excerpts.length} search excerpts for ${scope}`);
    const dynamicFallbacks = buildDynamicFallbackFactors(scope, excerpts, analytics);
    return {
      factors: mergeRollingWindow(existing, dynamicFallbacks),
      aiCurated: false,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Never throw: the callers (route handlers, cron) must always be able to
    // write a window so the health endpoint can report a real `lastRun`.
    console.error(`[FactorAnalysis] Factor analysis failed for scope "${scope}":`, error);
    // If we have candidates, try dynamic fallback even on unexpected errors
    if (candidates.length > 0) {
      try {
        const dynamicFallbacks = buildDynamicFallbackFactors(scope, candidates, analytics);
        return {
          factors: mergeRollingWindow(existing, dynamicFallbacks),
          aiCurated: false,
          updatedAt: new Date().toISOString(),
        };
      } catch {
        // Fall through to static fallback
      }
    }
    return returnExisting();
  }
}
