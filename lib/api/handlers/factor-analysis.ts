import { kiloRouter } from "../_shared/kiloRouter";
import { tinyfishRouter } from "../_shared/tinyfishRouter";
import { REGION_NAMES, type Region } from "../_shared/regions";
import { getGlobalAnalytics, getRegionalAnalytics } from "../_shared/deterministicAnalytics";
import {
  FACTOR_COUNT,
  FACTORS_WINDOW_TTL_MS,
  TIER_C_MAX_PER_HOST,
  classifySourceTrust,
  factorCacheKey,
  isRecentPublishedAt,
  sanitizeUrl,
} from "../_shared/http";
import { getCache, setCache } from "../_shared/cache";
import { coerceCategory, safeParseJson } from "../_shared/validation";
import { VALID_CATEGORIES, type Factor, type RegionId } from "../_shared/types";

/**
 * The shape stored under the canonical `dynamic-factors:{scope}` key. Every
 * producer (global route, regional route, cron) and every consumer (solutions,
 * forecasts, health) reads and writes this exact shape, so the reasons the UI
 * shows are the reasons the solutions are generated from.
 *
 * Only a genuinely AI-curated window is ever written to this key — a fallback
 * is not persisted, so a failed run can neither re-stamp `updatedAt` nor reset
 * the 7-day TTL. Run diagnostics live under a separate `:status` key.
 */
export interface FactorWindow {
  factors: Factor[];
  aiCurated: boolean;
  updatedAt: string;
  /** Last time an AI-curated window was written for this scope; null if never. */
  lastAiRunAt?: string | null;
}

/**
 * Machine-readable reason a run degraded. Previously every early return was
 * silent, so "always static" was undiagnosable from the outside.
 */
export type FactorRunReason =
  | "no-evidence"
  | "kilo-unavailable"
  | "kilo-aborted"
  | "unparseable-json"
  | "normalized-empty"
  | "threw";

/** Counters for one curation attempt. All fields are JSON-safe primitives. */
export interface FactorDiagnostics {
  queries: number;
  rawResults: number;
  afterTrustFilter: number;
  afterDateFilter: number;
  candidatesUsed: number;
  rejectedHosts: Array<{ host: string; count: number }>;
  scrapesOk: number;
  aiFactorsReturned: number;
  normalizedDropped: number;
  elapsedMs: number;
}

export interface FactorRunOutcome {
  window: FactorWindow;
  ok: boolean;
  reason?: FactorRunReason;
  diagnostics: FactorDiagnostics;
}

/** Persisted run status, stored under `dynamic-factors:{scope}:status`. */
export interface FactorRunStatus {
  aiCurated: boolean;
  reason: string | null;
  lastAttemptAt: string;
  lastAiRunAt: string | null;
  diagnostics: FactorDiagnostics;
}

export interface FactorAnalysisOptions {
  abortSignal?: AbortSignal;
}

/** Where the factors in a response body came from. */
export type FactorsServedFrom = "cache" | "curated" | "fallback";

/** Response body shared by /api/dynamic-factors and /api/regional-factors. */
export interface FactorsPayload {
  factors: Factor[];
  scope: RegionId;
  count: number;
  aiCurated: boolean;
  cacheKey: string;
  updatedAt: string;
  /** True when the body is not the product of a successful AI curation run. */
  degraded: boolean;
  /** Machine-readable degradation reason, present only when `degraded`. */
  reason?: string;
  servedFrom: FactorsServedFrom;
  diagnostics?: FactorDiagnostics;
  error?: string;
}

export function toFactorsPayload(
  factors: Factor[],
  scope: RegionId,
  options: {
    aiCurated: boolean;
    updatedAt: string;
    degraded?: boolean;
    reason?: string;
    servedFrom: FactorsServedFrom;
    diagnostics?: FactorDiagnostics;
    error?: string;
  },
): FactorsPayload {
  const degraded = options.degraded ?? false;
  return {
    factors,
    scope,
    count: factors.length,
    aiCurated: options.aiCurated,
    cacheKey: factorKeyForScope(scope),
    updatedAt: options.updatedAt,
    degraded,
    ...(degraded && options.reason ? { reason: options.reason } : {}),
    servedFrom: options.servedFrom,
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
    ...(options.error ? { error: options.error } : {}),
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
 * Diagnostics for the last attempt live under a SEPARATE key so a degraded run
 * can be reported without ever touching the curated window's value, `updatedAt`
 * or 7-day TTL.
 */
export function factorStatusKeyForScope(scope: RegionId): string {
  return `${factorCacheKey(scope)}:status`;
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
    return { factors, aiCurated: true, updatedAt, lastAiRunAt: updatedAt };
  }
  if (typeof raw !== "object") return null;
  const entry = raw as Partial<FactorWindow>;
  const factors = Array.isArray(entry.factors) ? entry.factors.filter(isFactorLike) : [];
  if (factors.length === 0) return null;
  const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString();
  return {
    factors,
    aiCurated: entry.aiCurated === true,
    updatedAt,
    lastAiRunAt: typeof entry.lastAiRunAt === "string" ? entry.lastAiRunAt : null,
  };
}

/**
 * Persists a window. Callers MUST only invoke this for a run that genuinely
 * produced AI-curated factors — writing a fallback here is what made stale
 * static content look freshly curated for a week.
 */
export async function writeFactorWindow(
  scope: RegionId,
  factors: Factor[],
  aiCurated: boolean,
): Promise<FactorWindow> {
  const now = new Date().toISOString();
  const window: FactorWindow = { factors, aiCurated, updatedAt: now, lastAiRunAt: aiCurated ? now : null };
  await setCache(factorKeyForScope(scope), window, FACTORS_WINDOW_TTL_MS);
  return window;
}

export async function readFactorRunStatus(scope: RegionId): Promise<FactorRunStatus | null> {
  const raw = await getCache<FactorRunStatus>(factorStatusKeyForScope(scope), FACTORS_WINDOW_TTL_MS);
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

export async function writeFactorRunStatus(scope: RegionId, status: FactorRunStatus): Promise<void> {
  await setCache(factorStatusKeyForScope(scope), status, FACTORS_WINDOW_TTL_MS);
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
    provenance: "static" as const,
    createdAt: now,
    updatedAt: now,
  }));
}

/** Neutral score used when the model omitted `importanceScore` entirely. */
const DEFAULT_IMPORTANCE_SCORE = 50;

export function normalizeFactor(
  raw: unknown,
  scope: RegionId,
  options: { candidateUrls?: string[] } = {},
): Factor | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const name = typeof f.name === "string" ? f.name.trim() : "";
  const explanation = typeof f.explanation === "string" ? f.explanation.trim() : "";
  // `source` is free text from the model ("IEA Oil Market Report"), so it is no
  // longer required to parse as a URL — requiring that dropped every factor
  // whose evidence was cited by name instead of by link.
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
  const declaredUrl = sanitizeUrl(typeof f.sourceUrl === "string" ? f.sourceUrl : source) ?? null;
  // Backfill the URL from the matched evidence candidate when the model gave
  // only free text.
  const sourceUrl = declaredUrl ?? findCandidateUrl(source, options.candidateUrls);
  // Only a score the model actually supplied is used for the rejection check;
  // a missing score defaults to neutral instead of defaulting to 0 (which
  // failed `< 20` and discarded the whole run).
  const suppliedScore =
    typeof f.importanceScore === "number" && Number.isFinite(f.importanceScore)
      ? f.importanceScore
      : typeof f.importanceScore === "string" && f.importanceScore.trim() !== ""
        ? Number(f.importanceScore)
        : null;
  const hasScore = suppliedScore !== null && Number.isFinite(suppliedScore);
  const importanceScore = hasScore
    ? Math.max(0, Math.min(100, Math.round(suppliedScore as number)))
    : DEFAULT_IMPORTANCE_SCORE;
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

  // Reject only a factor with no usable substance at all.
  if (!name && !explanation && commodities.length === 0) return null;
  if (hasScore && importanceScore < 20) return null;

  const now = new Date().toISOString();
  const driftRaw = (f.drift ?? {}) as Record<string, unknown>;

  return {
    id: id.slice(0, 80),
    name: (name || explanation).slice(0, 160),
    category: category.slice(0, 80),
    commodities: (Array.from(new Set(commodities)) as Factor["commodities"]).length > 0
      ? (Array.from(new Set(commodities)) as Factor["commodities"])
      : (["oil", "electricity", "water"] as Factor["commodities"]),
    explanation: (explanation || name).slice(0, 1200),
    direction,
    magnitude,
    source: (sourceUrl ?? source ?? "unspecified").slice(0, 300),
    ...(sourceUrl ? { sourceUrl } : {}),
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
    provenance: "ai" as const,
    createdAt: now,
    updatedAt: now,
  };
}

/** Host labels too generic to identify a publisher on their own. */
const GENERIC_HOST_LABELS = new Set([
  "com", "net", "org", "edu", "gov", "ac", "co", "io", "info", "biz", "us", "uk", "news", "www",
  "media", "online", "site", "int", "dev", "app", "ai",
]);

/** Resolves free-text `source` ("IEA Oil Market Report") to a candidate URL. */
function findCandidateUrl(source: string, candidateUrls: string[] = []): string | null {
  const needle = source.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!needle || candidateUrls.length === 0) return null;
  for (const url of candidateUrls) {
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue;
    }
    for (const token of [host, ...host.split(".")]) {
      const clean = token.replace(/[^a-z0-9]/g, "");
      if (clean.length < 3 || GENERIC_HOST_LABELS.has(clean)) continue;
      if (needle.includes(clean)) return url;
    }
  }
  return null;
}

/**
 * Merges a previously stored window with freshly curated factors and keeps the
 * newest {@link FACTOR_COUNT} by `createdAt`.
 *
 * A factor that is re-curated under the same name keeps its original `id` and
 * `createdAt`, so its age stays meaningful; only genuinely new reasons push the
 * oldest ones out of the window.
 *
 * Once a live (AI) factor is present, carried-over STATIC factors are dropped
 * entirely: otherwise a partial AI success (1-7 factors) still left 7-1 rows
 * carrying the "Static global fallback factor…" string on screen.
 */
export function mergeRollingWindow(existing: Factor[], incoming: Factor[]): Factor[] {
  const hasLive = incoming.some((factor) => factor.provenance !== "static");
  const priorPool = hasLive ? existing.filter((factor) => factor.provenance !== "static") : existing;

  const priorByName = new Map<string, Factor>();
  for (const factor of priorPool) {
    const key = normalizeFactorName(factor.name);
    if (key && !priorByName.has(key)) priorByName.set(key, factor);
  }

  const carried = incoming.map((factor) => {
    const prior = priorByName.get(normalizeFactorName(factor.name));
    // Never inherit identity from a static/fallback factor: that would give a
    // live factor a `fallback-*` id and a `createdAt` that is actually the
    // moment the static set was materialised.
    if (!prior || prior.provenance === "static" || factor.provenance === "static") return factor;
    return { ...factor, id: prior.id, createdAt: prior.createdAt, updatedAt: new Date().toISOString() };
  });

  // Freshly curated factors always rank ahead of the carried-over window, so a
  // same-millisecond tie can never let a static fallback displace a live reason.
  const ranked: Array<{ factor: Factor; rank: number }> = [
    ...carried.map((factor) => ({ factor, rank: 0 })),
    ...priorPool.map((factor) => ({ factor, rank: 1 })),
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

/* ------------------------------------------------------------------ */
/* Evidence gathering                                                   */
/* ------------------------------------------------------------------ */

interface EvidenceCandidate {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  text?: string;
}

/** Below this many Tier A/B candidates, unknown hosts are used to backfill. */
const MIN_TRUSTED_CANDIDATES = 3;
/** Upper bound on articles fed to the model, applied BEFORE the scrape fan-out. */
const MAX_CANDIDATES = 15;
/** Concurrent article scrapes; unbounded fan-out exhausted the 25s budget. */
const SCRAPE_CONCURRENCY = 5;
/** A snippet at least this long is already enough evidence; skip the scrape. */
const MIN_SNIPPET_CHARS_FOR_SKIP = 400;
const MAX_REJECTED_HOSTS_REPORTED = 5;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "(unparseable)";
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  for (let start = 0; start < items.length; start += limit) {
    const batch = items.slice(start, start + limit);
    const settled = await Promise.all(batch.map((item, i) => fn(item, start + i)));
    settled.forEach((value, i) => {
      results[start + i] = value;
    });
  }
  return results;
}

/**
 * Single implementation of the factor-curation pipeline used by the global
 * route, the regional route and the cron endpoint.
 *
 * Every degraded exit returns a machine-readable `reason` and a diagnostics
 * block instead of silently returning the static set.
 */
export async function runFactorAnalysis(
  scope: RegionId,
  options: FactorAnalysisOptions = {},
): Promise<FactorRunOutcome> {
  const startedAt = Date.now();
  const signal = options.abortSignal;
  const region = scopeRegion(scope);
  const previous = await readFactorWindow(scope);
  // The previously stored factors are the rolling window; the static fallbacks
  // are only used when nothing has been curated yet.
  const existing = previous?.factors.length ? previous.factors : buildFallbackFactors(scope);
  const carriedAiCurated = previous?.aiCurated ?? false;
  // A degraded run must NOT re-stamp the window timestamp: stale content has to
  // keep looking stale to `isFreshWindow` and /api/health.
  const degradedUpdatedAt = previous?.updatedAt ?? existing[0]?.createdAt ?? new Date().toISOString();

  const diagnostics: FactorDiagnostics = {
    queries: 0,
    rawResults: 0,
    afterTrustFilter: 0,
    afterDateFilter: 0,
    candidatesUsed: 0,
    rejectedHosts: [],
    scrapesOk: 0,
    aiFactorsReturned: 0,
    normalizedDropped: 0,
    elapsedMs: 0,
  };

  const finish = (ok: boolean, reason?: FactorRunReason): FactorRunOutcome => {
    diagnostics.elapsedMs = Date.now() - startedAt;
    const outcome: FactorRunOutcome = {
      window: {
        factors: existing,
        aiCurated: carriedAiCurated,
        updatedAt: degradedUpdatedAt,
        lastAiRunAt: previous?.lastAiRunAt ?? null,
      },
      ok,
      ...(reason ? { reason } : {}),
      diagnostics,
    };
    console.log(
      `[factors:${scope}] ${ok ? "ok" : "degraded"}${reason ? ` reason=${reason}` : ""} ` +
        JSON.stringify(diagnostics),
    );
    return outcome;
  };

  const analytics =
    scope === "global" ? await getGlobalAnalytics() : await getRegionalAnalytics(scope as Region);

  const queries = scope === "global" ? GLOBAL_QUERIES : REGION_QUERIES[scope as Region];
  diagnostics.queries = queries.length;
  const searches = await Promise.all(
    queries.map((q) =>
      tinyfishRouter.tinyfishSearch(`${q} ${RECENT_MONTH()}`, { limit: 10, region: region ?? undefined }, signal),
    ),
  );

  const rawResults = searches.flatMap((r) => r.results);
  diagnostics.rawResults = rawResults.length;

  // Only http(s) results are usable evidence at all.
  const webResults: EvidenceCandidate[] = rawResults
    .map((r) => ({
      title: typeof r.title === "string" ? r.title : "",
      url: sanitizeUrl(typeof r.url === "string" ? r.url : "") ?? "",
      snippet: typeof r.snippet === "string" ? r.snippet : "",
      ...(r.publishedAt ? { publishedAt: r.publishedAt } : {}),
    }))
    .filter((r) => r.url !== "");

  // Tiered trust: A (curated list) + B (trade press / institutional shapes)
  // first, then C (unknown hosts, capped per host) only to backfill a thin set.
  const rejectedHosts = new Map<string, number>();
  const tierAB = webResults.filter((r) => {
    const tier = classifySourceTrust(r.url);
    if (tier === "c") {
      const host = hostOf(r.url);
      rejectedHosts.set(host, (rejectedHosts.get(host) ?? 0) + 1);
      return false;
    }
    return true;
  });
  diagnostics.afterTrustFilter = tierAB.length;
  // The date filter fails open for missing/unparseable dates; that is correct.
  const dated = tierAB.filter((r) => isRecentPublishedAt(r.publishedAt));
  diagnostics.afterDateFilter = dated.length;
  diagnostics.rejectedHosts = Array.from(rejectedHosts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_REJECTED_HOSTS_REPORTED)
    .map(([host, count]) => ({ host, count }));

  const seenUrls = new Set<string>();
  const pushUnique = (list: EvidenceCandidate[], candidate: EvidenceCandidate) => {
    if (seenUrls.has(candidate.url)) return;
    seenUrls.add(candidate.url);
    list.push(candidate);
  };

  const trusted: EvidenceCandidate[] = [];
  for (const candidate of dated) {
    if (trusted.length >= MAX_CANDIDATES) break;
    pushUnique(trusted, candidate);
  }

  // Relaxed second pass: unknown hosts may backfill a thin candidate set, but
  // only up to TIER_C_MAX_PER_HOST per host so one domain cannot take over.
  if (trusted.length < MIN_TRUSTED_CANDIDATES) {
    const perHost = new Map<string, number>();
    for (const candidate of webResults) {
      if (trusted.length >= MAX_CANDIDATES) break;
      if (!isRecentPublishedAt(candidate.publishedAt)) continue;
      const host = hostOf(candidate.url);
      const used = perHost.get(host) ?? 0;
      if (used >= TIER_C_MAX_PER_HOST) continue;
      perHost.set(host, used + 1);
      pushUnique(trusted, candidate);
    }
  }

  const candidates = trusted;
  diagnostics.candidatesUsed = candidates.length;

  if (candidates.length === 0) {
    return finish(false, "no-evidence");
  }

  // Scrape only what the snippet does not already answer, at most
  // SCRAPE_CONCURRENCY at a time.
  const scraped = await mapWithConcurrency(candidates, SCRAPE_CONCURRENCY, async (candidate) => {
    if ((candidate.snippet ?? "").length >= MIN_SNIPPET_CHARS_FOR_SKIP) return candidate;
    try {
      const content = await tinyfishRouter.tinyfishScrape(candidate.url, signal);
      if (!content || (!content.text && !content.title)) return candidate;
      diagnostics.scrapesOk += 1;
      return {
        ...candidate,
        text: content.text,
        title: content.title || candidate.title,
      };
    } catch {
      return candidate;
    }
  });

  const excerpts = scraped;

  const prompt = scope === "global" ? SYSTEM_PROMPT_GLOBAL : SYSTEM_PROMPT_REGIONAL(scopeLabel(scope));
  const baseMessages = [
    { role: "system", content: prompt },
    {
      role: "user",
      content: JSON.stringify({
        analytics,
        existingFactors: existing,
        candidates: excerpts.map((c) => ({
          title: c.title,
          source: c.url,
          sourceName: c.title,
          publishedAt: c.publishedAt ?? null,
          snippet: c.snippet?.slice(0, 2500),
          text: c.text?.slice(0, 6000),
        })),
        region,
        month: RECENT_MONTH(),
      }),
    },
  ];
  const payload = {
    messages: baseMessages,
    // 8 factors with explanations can exceed 4096 tokens; the old cap produced
    // `finish_reason: "length"` and an unparseable answer.
    max_tokens: 8192,
    temperature: 0.2,
    // Without this the model may wrap JSON in prose or rename keys, which
    // `safeParseJson` then rejects.
    response_format: { type: "json_object" },
  };

  const candidateUrls = candidates.map((c) => c.url);

  let response;
  try {
    response = await kiloRouter.kiloInfer(payload, signal);
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (signal?.aborted) return finish(false, "kilo-aborted");
    if (/no kilo gateway key|no available kilo|no kilo gateway model/i.test(message)) {
      console.error(`[factors:${scope}] Kilo unavailable: ${message}`);
      return finish(false, "kilo-unavailable");
    }
    console.error(`[factors:${scope}] Kilo inference failed: ${message}`);
    return finish(false, "threw");
  }

  const content = response.choices?.[0]?.message?.content ?? "";
  let parsed = safeParseJson<{ factors?: unknown[] }>(content);

  if (!parsed?.factors || !Array.isArray(parsed.factors)) {
    // One repair attempt: models frequently wrap the object in a code fence or
    // preamble on the first try.
    console.warn(`[factors:${scope}] unparseable model output; retrying once with a repair instruction`);
    try {
      const repaired = await kiloRouter.kiloInfer(
        {
          ...payload,
          messages: [
            ...baseMessages,
            {
              role: "user",
              content:
                "Your previous reply was not a single valid JSON object. Reply again with ONLY the JSON object " +
                '(starting with {"factors": [ ... ]}) and nothing else — no prose, no markdown fences.',
            },
          ],
        },
        signal,
      );
      const repairedContent = repaired.choices?.[0]?.message?.content ?? "";
      parsed = safeParseJson<{ factors?: unknown[] }>(repairedContent);
    } catch (error) {
      console.error(`[factors:${scope}] JSON repair attempt failed: ${String((error as Error)?.message ?? error)}`);
    }
  }

  diagnostics.aiFactorsReturned = Array.isArray(parsed?.factors) ? parsed.factors.length : 0;
  if (!parsed?.factors || !Array.isArray(parsed.factors)) {
    return finish(false, "unparseable-json");
  }

  const normalized = parsed.factors
    .map((f) => normalizeFactor(f, scope, { candidateUrls }))
    .filter((f): f is Factor => f !== null)
    .filter((f) => f.scope === scope)
    .slice(0, FACTOR_COUNT);
  diagnostics.normalizedDropped = Math.max(0, parsed.factors.length - normalized.length);

  if (normalized.length === 0) {
    return finish(false, "normalized-empty");
  }

  const now = new Date().toISOString();
  diagnostics.elapsedMs = Date.now() - startedAt;
  console.log(
    `[factors:${scope}] ok factors=${normalized.length} ` + JSON.stringify(diagnostics),
  );
  return {
    window: {
      factors: mergeRollingWindow(existing, normalized),
      aiCurated: true,
      updatedAt: now,
      lastAiRunAt: now,
    },
    ok: true,
    diagnostics,
  };
}
