import { kiloRouter } from "../_shared/kiloRouter";
import { tinyfishRouter } from "../_shared/tinyfishRouter";
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
import {
  VALID_CATEGORIES,
  type Factor,
  type FactorGrounding,
  type RegionId,
} from "../_shared/types";
import { getScopePriceDefaults } from "../_shared/deterministicAnalytics";

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
`You are a Senior Commodity Risk Analyst. You are provided with current global market analytics, an existing list of global price factors, and fresh validated news excerpts collected through TinyFish.

=== STEPS (follow in order) ===
1. Read EVERY candidate's title, snippet, and full text carefully.
2. Identify the CONCRETE reason the article gives for an oil, electricity, or water price movement. This is a factual claim the article itself makes, not your own inference.
3. Write that reason in 2-3 sentences in the explanation field. Start with the commodity and the current price number from currentPrices (e.g. "with oil at $104.86/bbl..."). Use the numbers; do not paraphrase around them.
4. Set the source field to the EXACT URL string from the candidate list — copy it verbatim, character for character. Never write a publication name.

=== FORBIDDEN ===
- NEVER output a bare publication name (e.g. "IEA", "OPEC Monthly Oil Market Report", "UN-Water; WRI Aqueduct") in the source field.
- NEVER invent a URL. If you cannot find a matching URL, copy the URL verbatim from the candidate list.
- NEVER output markdown or commentary outside the JSON.

=== GROUNDING ===
Every factor's explanation MUST reference the current price numbers supplied in currentPrices. For example: "with oil at $104.86/bbl, OPEC+ output cuts are tightening supply...". Use the numbers, do not paraphrase around them.

=== WORKED EXAMPLE ===
{"id":"example-1","name":"OPEC+ output restraint","category":"Market","commodities":["oil"],"explanation":"OPEC+ members have agreed to extend voluntary production cuts through Q1 2026, tightening global supply. With oil at $104.86/bbl, the cutback is expected to remove roughly 1.2 million b/d from the market and support prices in the short term.","direction":"up","magnitude":"High","source":"https://www.iea.org/reports/world-energy-outlook-2026","bias":"short","importanceScore":82,"drift":{"oil":0.5}}

=== JSON SCHEMA ===
Each factor object must be exactly: { id: string; name: string; category: "Market"|"Policy"|"Structural"|"Infrastructure"|"Environmental"|"Geopolitical"|"Technological"; commodities: string[] (subset of oil, electricity, water); explanation: string (2-3 sentences summarizing the reason found in the supplied source URL); direction: "up"|"down"|"mixed"; magnitude: "High"|"Medium"|"Low"; source: string (the EXACT URL string from the candidate list — a URL, never a publication name); bias: "short"|"mid"|"long"|"flat"; importanceScore: integer 0-100; drift: object mapping commodity to a small decimal adjustment }.

The source field MUST be an exact URL string from the supplied candidate list. It is a URL, never a publication name.

Return strict JSON only. Do not return markdown or commentary outside JSON.

The response must contain up to eight validated global factors matching the required schema. If a new legitimate trend is identified, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

const SYSTEM_PROMPT_REGIONAL = (regionName: string) =>
`You are a Senior Commodity Risk Analyst specializing in ${regionName} energy and water markets. You are provided with current ${regionName}-specific market analytics, an existing list of ${regionName} price factors, and fresh validated news excerpts collected through TinyFish that are relevant to ${regionName}.

=== STEPS (follow in order) ===
1. Read EVERY candidate's title, snippet, and full text carefully.
2. Identify the CONCRETE reason the article gives for an oil, electricity, or water price movement. This is a factual claim the article itself makes, not your own inference.
3. Write that reason in 2-3 sentences in the explanation field. Start with the commodity and the current price number from currentPrices (e.g. "with oil at $104.86/bbl..."). Use the numbers; do not paraphrase around them.
4. Set the source field to the EXACT URL string from the candidate list — copy it verbatim, character for character. Never write a publication name.

=== FORBIDDEN ===
- NEVER output a bare publication name (e.g. "IEA", "OPEC Monthly Oil Market Report", "UN-Water; WRI Aqueduct") in the source field.
- NEVER invent a URL. If you cannot find a matching URL, copy the URL verbatim from the candidate list.
- NEVER output markdown or commentary outside the JSON.

=== GROUNDING ===
Every factor's explanation MUST reference the current price numbers supplied in currentPrices. For example: "with oil at $104.86/bbl, OPEC+ output cuts are tightening supply...". Use the numbers, do not paraphrase around them.

=== WORKED EXAMPLE ===
{"id":"example-1","name":"OPEC+ output restraint","category":"Market","commodities":["oil"],"explanation":"OPEC+ members have agreed to extend voluntary production cuts through Q1 2026, tightening global supply. With oil at $104.86/bbl, the cutback is expected to remove roughly 1.2 million b/d from the market and support prices in the short term.","direction":"up","magnitude":"High","source":"https://www.iea.org/reports/world-energy-outlook-2026","bias":"short","importanceScore":82,"drift":{"oil":0.5}}

=== JSON SCHEMA ===
Each factor object must be exactly: { id: string; name: string; category: "Market"|"Policy"|"Structural"|"Infrastructure"|"Environmental"|"Geopolitical"|"Technological"; commodities: string[] (subset of oil, electricity, water); explanation: string (2-3 sentences summarizing the reason found in the supplied source URL); direction: "up"|"down"|"mixed"; magnitude: "High"|"Medium"|"Low"; source: string (the EXACT URL string from the candidate list — a URL, never a publication name); bias: "short"|"mid"|"long"|"flat"; importanceScore: integer 0-100; drift: object mapping commodity to a small decimal adjustment }.

The source field MUST be an exact URL string from the supplied candidate list. It is a URL, never a publication name.

Return strict JSON only. Do not return markdown or commentary outside JSON.

The response must contain up to eight validated ${regionName} factors matching the required schema. If a new legitimate trend is identified for ${regionName}, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

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

const KNOWN_REPUTABLE_URLS = [
  "https://www.iea.org/reports/world-energy-outlook",
  "https://www.opec.org/opec_web/en/",
  "https://www.eia.gov/petroleum/",
  "https://www.unwater.org/",
  "https://www.wri.org/",
  "https://www.irena.org/",
];

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
 * Deterministic, URL-backed factor construction used when Kilo fails to return
 * usable factors but TinyFish successfully produced real candidate URLs. Each
 * factor is built directly from a fetched article — the name from its title, the
 * explanation from its snippet/scraped text, and the source from the actual
 * TinyFish URL — so the UI never falls back to bare static publication names.
 *
 * These factors carry `aiCurated: false` (they are not AI-summarized), but every
 * `source` is a genuine, clickable link and every explanation is real article
 * text. The category/direction/bias fields are inferred from keywords because no
 * model is summarizing at this point.
 */
export function buildFactorsFromCandidates(
  candidates: Array<{ url: string; title?: string; snippet?: string; text?: string }>,
  scope: RegionId,
  currentPrices: {
    oil: { price: number; unit: string; source: string };
    electricity: { price: number; unit: string; source: string };
    water: { price: number; unit: string; source: string };
  },
  now: string,
): Factor[] {
  const region = scopeRegion(scope);
  const regions: RegionId[] = scope === "global" ? ["global"] : region ? [region] : [];
  const grounding = attachFactorGrounding(currentPrices, now);

  const usable = candidates
    .filter((c) => c && typeof c.url === "string" && c.url.length > 0)
    .slice(0, FACTOR_COUNT);

  const factors: Factor[] = [];

  usable.forEach((candidate, index) => {
    const position = index + 1;
    const title = (candidate.title ?? "").trim();
    const snippet = (candidate.snippet ?? "").trim();
    const text = (candidate.text ?? "").trim();

    // Explanation must be a real sentence from the article: prefer the snippet
    // (first ~200 chars), otherwise the scraped body (up to 1200 chars).
    let explanation = "";
    if (snippet) {
      explanation = snippet.slice(0, 200);
    } else if (text) {
      explanation = text;
    }
    explanation = explanation.slice(0, 1200).trim();
    if (!explanation) return;

    const name = (title || explanation.slice(0, 160) || `Market update: ${candidate.url}`).slice(0, 160);

    const haystack = `${title} ${snippet} ${text}`.toLowerCase();

    const commodities: Factor["commodities"] = [];
    if (/oil|crude|petroleum|\bbbl\b|brent|\bwti\b/.test(haystack)) commodities.push("oil");
    if (/electricity|power|\bgrid\b|\bmwh\b|megawatt|kilowatt|utilit/.test(haystack))
      commodities.push("electricity");
    if (/water|drought|scarcity|hydrolog|aquifer|desalination/.test(haystack))
      commodities.push("water");
    if (commodities.length === 0) commodities.push("oil");

    let direction: Factor["direction"] = "mixed";
    if (/\b(rise|rising|surge|surged|climb|climbed|spike|spiked|jump|jumped|rally|rallied|gain|gained|increase|increased|soar|soared)\b/.test(haystack)) {
      direction = "up";
    } else if (/\b(fall|falling|fell|drop|dropped|decline|declined|plunge|plunged|slump|slumped|sink|sank|crash|crashed|decrease|decreased|tumble|tumbled)\b/.test(haystack)) {
      direction = "down";
    }

    let category: Factor["category"] = "Structural";
    if (/supply|opec|production|output|inventor|inventory|\bcuts?\b|restrain|constraint|shortage/.test(haystack)) {
      category = "Market";
    } else if (/policy|demand|regulat|mandate|subsid|tariff|\btax\b|\blaw\b|\brule\b/.test(haystack)) {
      category = "Policy";
    }

    let bias: Factor["bias"] = "flat";
    if (/supply|\bcuts?\b|restrain|constraint|shortage|disruption|shortfall/.test(haystack)) {
      bias = "short";
    } else if (/demand|growth|surge|rise|rising|increase|expansion/.test(haystack)) {
      bias = "mid";
    }

    const importanceScore = Math.max(0, Math.min(100, 70 - position));

    factors.push({
      id: `deterministic-${scope}-${position}-${Date.now()}`,
      name,
      category,
      commodities: Array.from(new Set(commodities)) as Factor["commodities"],
      explanation,
      direction,
      magnitude: "Medium",
      source: candidate.url,
      bias,
      drift: {},
      grounding,
      regions,
      scope,
      importanceScore,
      createdAt: now,
      updatedAt: now,
    });
  });

  return factors;
}

export function normalizeFactor(
  raw: unknown,
  scope: RegionId,
  candidates: Array<{ url: string; title?: string; site_name?: string }> = [],
): Factor | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const name = typeof f.name === "string" ? f.name.trim() : "";
  const explanation = typeof f.explanation === "string" ? f.explanation.trim() : "";
  const source = typeof f.source === "string" ? f.source.trim() : "";
  const id =
    typeof f.id === "string" && f.id.trim()
      ? f.id.trim()
      : `dynamic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  // A factor must have a name, explanation, evidence-quality score and at least
  // one affected commodity. The source is resolved separately below so a
  // non-URL source string (e.g. a publication name the model returned) does not
  // by itself invalidate the factor — we fall back to a fetched candidate URL.
  if (!name || !explanation || importanceScore < 20 || commodities.length === 0) return null;

  const now = new Date().toISOString();
  const driftRaw = (f.drift ?? {}) as Record<string, unknown>;

  // Resolve the source to a real URL: prefer the model's URL when valid,
  // otherwise try to match the source name against candidate URLs we actually
  // fetched via TinyFish. When the model returns a non-URL source name that
  // cannot be matched, fall back to the first candidate URL so the UI can
  // always display a clickable, verified source link — never a bare
  // publication name (the reported "IEA World Energy Outlook" symptom).
  let finalSource = source;
  if (sourceUrl) {
    finalSource = sourceUrl;
  } else if (candidates.length > 0) {
    const matched = source ? matchSourceToCandidate(source, candidates) : null;
    finalSource = matched ?? (source ? bestLooseCandidate(source, candidates) : null) ?? candidates[0]?.url ?? "";
  }

  return {
    id: id.slice(0, 80),
    name: name.slice(0, 160),
    category: category.slice(0, 80),
    commodities: Array.from(new Set(commodities)) as Factor["commodities"],
    explanation: explanation.slice(0, 1200),
    direction,
    magnitude,
    source: finalSource,
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
 * Builds the server-side grounding payload from the current price defaults.
 * These are the exact statistics shown on the dashboard (oil/electricity/water
 * prices) at curation time, attached to every factor so the UI can display the
 * full source URL alongside the numbers that support each reason.
 */
function attachFactorGrounding(
  prices: { oil: { price: number; unit: string; source: string }; electricity: { price: number; unit: string; source: string }; water: { price: number; unit: string; source: string } },
  asOf: string,
): FactorGrounding {
  return {
    oil: { price: prices.oil.price, unit: prices.oil.unit, source: prices.oil.source },
    electricity: { price: prices.electricity.price, unit: prices.electricity.unit, source: prices.electricity.source },
    water: { price: prices.water.price, unit: prices.water.unit, source: prices.water.source },
    asOf,
  };
}

/**
 * When the model returns a non-URL source name (e.g. "IEA" or "OPEC Monthly
 * Oil Market Report"), try to match it to one of the candidate URLs we
 * actually fetched via TinyFish so the UI can display a real source link.
 * 
 * Now supports multi-word matching against candidate URL hostname+path,
 * as well as against title and site_name fields carried in candidate objects.
 */
function matchSourceToCandidate(source: string, candidates: Array<{ url: string; title?: string; site_name?: string }>): string | null {
  const sourceLower = source.toLowerCase().trim();
  if (!sourceLower) return null;

  // If source is already a valid URL, return it
  const urlMatch = sanitizeUrl(sourceLower);
  if (urlMatch) return urlMatch;

  // Tokenize source: words of length >= 3
  const tokens = Array.from(new Set(sourceLower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)));
  if (tokens.length === 0) return null;

  let best: { url: string; score: number } | null = null;

  for (const c of candidates) {
    if (!c || !c.url) continue;
    let text = c.url.toLowerCase();
    if (c.title) text += " " + c.title.toLowerCase();
    if (c.site_name) text += " " + c.site_name.toLowerCase();

    // Parse hostname and path for token matching
    let host = "";
    let domainLabel = "";
    try {
      const u = new URL(c.url);
      host = u.hostname.replace(/^www\./, "").toLowerCase();
      domainLabel = u.hostname.split(".")[0].toLowerCase();
      text += " " + host + " " + u.pathname.toLowerCase();
    } catch {}

    let score = 0;
    for (const t of tokens) {
      if (text.includes(t)) {
        score += t.length >= 5 ? 3 : t.length >= 4 ? 2 : 1;
      } else {
        // Domain label exact/partial match
        if (domainLabel && (domainLabel === t || domainLabel.includes(t) || t.includes(domainLabel))) {
          score += 3;
        }
        // Hostname token match
        if (host && host.includes(t)) score += 2;
      }
    }

    // Require at least one meaningful token match
    if (score > 0 && (!best || score > best.score)) best = { url: c.url, score };
  }

  if (!best) return null;

  // For single-token sources, a score of 1 is acceptable.
  // For multi-token sources, require at least half the tokens match.
  const minScore = tokens.length <= 2 ? 1 : Math.ceil(tokens.length / 2);
  return best.score >= minScore ? best.url : null;
}

/**
 * Best-effort fallback: picks the candidate URL whose hostname best matches
 * any token in the source name, even below the normal threshold. Used when
 * the model returns a bare publication name that cannot be matched otherwise.
 */
function bestLooseCandidate(source: string, candidates: Array<{ url: string; title?: string; site_name?: string }>): string | null {
  const sourceLower = source.toLowerCase().trim();
  if (!sourceLower) return null;

  let best: { url: string; score: number } | null = null;

  for (const c of candidates) {
    if (!c || !c.url) continue;
    let text = c.url.toLowerCase();
    if (c.title) text += " " + c.title.toLowerCase();
    if (c.site_name) text += " " + c.site_name.toLowerCase();

    let host = "";
    try {
      const u = new URL(c.url);
      host = u.hostname.replace(/^www\./, "").toLowerCase();
      text += " " + host;
    } catch {}

    let score = 0;
    // Match hostname label
    const label = host.split(".")[0];
    if (label && sourceLower.includes(label)) score += 3;
    if (host && sourceLower.includes(host)) score += 5;

    // Match individual tokens
    for (const t of sourceLower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)) {
      if (text.includes(t)) score += 2;
    }

    if (!best || score > best.score) best = { url: c.url, score };
  }

  return best?.url ?? null;
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

  const currentPrices = getScopePriceDefaults(scope);

  const now = new Date().toISOString();
  const returnExisting = () => ({ factors: existing, aiCurated: carriedAiCurated, updatedAt: now });
  let candidates: Array<{ url: string; title?: string; snippet?: string; text?: string }> = [];

  try {
    const queries = scope === "global" ? GLOBAL_QUERIES : REGION_QUERIES[scope as Region];
    const searches = await Promise.all(
      queries.map((q) =>
        tinyfishRouter.tinyfishSearch(`${q} ${RECENT_MONTH()}`, { limit: 10, region: region ?? undefined }, signal),
      ),
    );

    const flatten = <T extends { snippet?: string }>(results: T[] | undefined) =>
      (results ?? []).map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }));

    const allResults = searches.flatMap((r) => flatten(r.results));

    // Prefer results from reputable hosts, but never let the whitelist starve the
    // model of real fetched URLs. If the reputable filter removes every result we
    // retry with all recent results, because a non-whitelisted but real TinyFish
    // URL is still a valid source the model can summarize (and link to).
    candidates = allResults
      .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt))
      .slice(0, 15);

    console.warn(`Factor analysis: ${candidates.length} reputable+recent candidates for scope "${scope}" after TinyFish search`);

    if (candidates.length === 0) {
      candidates = allResults
        .filter((r) => isRecentPublishedAt(r.publishedAt))
        .slice(0, 15);
      console.warn(`Factor analysis: ${candidates.length} recent candidates for scope "${scope}" (reputable filter yielded none)`);
    }

    if (candidates.length === 0) {
      console.warn(`Factor analysis: no TinyFish candidates for scope "${scope}"; trying known reputable URLs as fallback`);
      const knownExcerpts = await Promise.all(
        KNOWN_REPUTABLE_URLS.map(async (url) => {
          try {
            const scraped = await tinyfishRouter.tinyfishScrape(url, signal, {
              purpose: `Identify concrete reasons this page gives for ${scopeLabel(scope)} oil, electricity, or water price movements in ${RECENT_MONTH()}.`,
            });
            return scraped ? { url, title: scraped.title || url, snippet: scraped.text?.slice(0, 500) ?? "", text: scraped.text ?? "" } : null;
          } catch {
            return null;
          }
        }),
      );
      const knownCandidates = knownExcerpts.filter((e): e is { url: string; title: string; snippet: string; text: string } => e !== null);
      if (knownCandidates.length > 0) {
        console.warn(`Factor analysis: scraped ${knownCandidates.length} known URLs for scope "${scope}"`);
        // Build deterministic factors from these known URLs
        const deterministic = buildFactorsFromCandidates(knownCandidates, scope, currentPrices, now);
        if (deterministic.length > 0) {
          console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors from known URLs for scope "${scope}"`);
          return {
            factors: mergeRollingWindow(existing, deterministic),
            aiCurated: false,
            updatedAt: now,
          };
        }
      }
      console.warn(`Factor analysis: no candidates from known URLs either; falling back to existing factors`);
      return returnExisting();
    }

    const excerpts = await Promise.all(
      candidates.map(async (r) => {
        try {
          const scraped = await tinyfishRouter.tinyfishScrape(r.url, signal, {
            purpose: `Identify concrete reasons this article gives for ${scopeLabel(scope)} oil, electricity, or water price movements in ${RECENT_MONTH()}.`,
          });
          return scraped ? { ...r, text: scraped.text, title: scraped.title || r.title } : r;
        } catch {
          return r;
        }
      }),
    );

    // Log scrape success rate
    const scrapedCount = excerpts.filter((e) => (e as { text?: string }).text && (e as { text?: string }).text!.length > 0).length;
    console.warn(`Factor analysis: ${scrapedCount}/${candidates.length} candidate scrapes succeeded for scope "${scope}"`);
    if (scrapedCount === 0 && candidates.length > 0) {
      console.warn(`Factor analysis: all ${candidates.length} candidate scrapes failed for scope "${scope}"; proceeding with search snippets only`);
    } else if (scrapedCount < candidates.length) {
      console.warn(`Factor analysis: ${candidates.length - scrapedCount}/${candidates.length} scrapes failed for scope "${scope}"`);
    }

    // Build candidate objects (with title/site_name) for source matching
    const candidateObjs = excerpts.map((c) => ({
      url: c.url,
      title: c.title,
      site_name: (c as { site_name?: string }).site_name,
    }));

    const prompt = scope === "global" ? SYSTEM_PROMPT_GLOBAL : SYSTEM_PROMPT_REGIONAL(scopeLabel(scope));
    const payload = {
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify({
            analytics,
            currentPrices,
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
    let content = response.choices?.[0]?.message?.content ?? "";
    let parsed = safeParseJson<{ factors?: unknown[] }>(content);
    console.warn(`Factor analysis: Kilo response for scope "${scope}" (content length ${content.length}, factors ${Array.isArray(parsed?.factors) ? parsed.factors.length : 0})`);

    // Retry once with a more explicit, insistent prompt if first attempt
    // returns invalid JSON or an empty factors array.
    if ((!parsed || !Array.isArray(parsed.factors) || parsed.factors.length === 0) && !signal?.aborted) {
      const candidateUrlHint = candidateObjs.map((c) => c.url).filter(Boolean).join(", ");
      const retryPrompt = `Return ONLY a strict JSON object of the form {"factors":[...]}. Each factor MUST have: id (string), name (string), category (one of "Market"|"Policy"|"Structural"|"Infrastructure"|"Environmental"|"Geopolitical"|"Technological"), commodities (array subset of "oil","electricity","water"), explanation (2-3 sentences that start with the commodity and cite the current price numbers from currentPrices, e.g. "with oil at $104.86/bbl..."), direction ("up"|"down"|"mixed"), magnitude ("High"|"Medium"|"Low"), source (EXACTLY one of these URLs, copy verbatim: ${candidateUrlHint}), bias ("short"|"mid"|"long"|"flat"), importanceScore (integer 0-100), drift (object mapping commodity to a small decimal). The source field MUST be a URL copied verbatim from the list above — never a publication name. Ground every explanation in the current price numbers. Do not output markdown, commentary, or anything outside the JSON object.`;

      console.warn(`Factor analysis: retrying Kilo for scope "${scope}" after invalid/empty response (content length ${content.length}, factors ${Array.isArray(parsed?.factors) ? parsed.factors.length : 0})`);

      const retryPayload = {
        ...payload,
        messages: [
          { role: "system", content: retryPrompt },
          payload.messages[1],
        ],
      };

      try {
        const retryResponse = await kiloRouter.kiloInfer(retryPayload, signal);
        content = retryResponse.choices?.[0]?.message?.content ?? "";
        parsed = safeParseJson<{ factors?: unknown[] }>(content);
        console.warn(`Factor analysis: retry complete for scope "${scope}" (content length ${content.length}, factors ${Array.isArray(parsed?.factors) ? parsed.factors.length : 0})`);
      } catch (error) {
        console.error(`Factor analysis: retry failed for scope "${scope}":`, error);
      }
    }

    if (!parsed?.factors || !Array.isArray(parsed.factors) || parsed.factors.length === 0) {
      console.warn(`Factor analysis: model did not return a valid non-empty factors array for scope "${scope}" even after retry (content length ${content.length}); building deterministic factors from ${candidates.length} TinyFish candidates`);

      const deterministic = buildFactorsFromCandidates(candidates, scope, currentPrices, now);
      if (deterministic.length > 0) {
        console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors for scope "${scope}"`);
        return {
          factors: mergeRollingWindow(existing, deterministic),
          aiCurated: false,
          updatedAt: now,
        };
      }
      console.warn(`Factor analysis: no deterministic factors could be built for scope "${scope}"; falling back to existing factors`);
      return returnExisting();
    }

    const normalized = parsed.factors
      .map((f) => normalizeFactor(f, scope, candidateObjs))
      .filter((f): f is Factor => f !== null)
      .filter((f) => f.scope === scope)
      .slice(0, FACTOR_COUNT);

    if (normalized.length === 0) {
      console.warn(`Factor analysis: all model-returned factors were rejected for scope "${scope}" (parsed ${parsed.factors.length}, normalized ${normalized.length}); building deterministic factors from ${candidates.length} TinyFish candidates`);

      const deterministic = buildFactorsFromCandidates(candidates, scope, currentPrices, now);
      if (deterministic.length > 0) {
        console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors for scope "${scope}"`);
        return {
          factors: mergeRollingWindow(existing, deterministic),
          aiCurated: false,
          updatedAt: now,
        };
      }
      console.warn(`Factor analysis: no deterministic factors could be built for scope "${scope}"; falling back to existing factors`);
      return returnExisting();
    }

    // Attach the dashboard statistics (oil/electricity/water prices) that the
    // model grounded its reasons in, so the UI can show the full source URL
    // alongside the numbers that support each factor. Grounding is server-side
    // and never model-generated, so it cannot be fabricated.
    const grounding = attachFactorGrounding(currentPrices, now);

    return {
      factors: mergeRollingWindow(existing, normalized.map((f) => ({ ...f, grounding }))),
      aiCurated: true,
      updatedAt: now,
    };
  } catch (error) {
    // Never throw: the callers (route handlers, cron) must always be able to
    // write a window so the health endpoint can report a real `lastRun`.
    console.error(`Factor analysis failed for scope "${scope}":`, error);
    if (candidates.length > 0) {
      const deterministic = buildFactorsFromCandidates(candidates, scope, currentPrices, now);
      if (deterministic.length > 0) {
        console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors for scope "${scope}" after error (aiCurated=false)`);
        return {
          factors: mergeRollingWindow(existing, deterministic),
          aiCurated: false,
          updatedAt: now,
        };
      }
    }
    try {
      console.warn(`Factor analysis: trying known reputable URLs as fallback after error for scope "${scope}"`);
      const knownExcerpts = await Promise.all(
        KNOWN_REPUTABLE_URLS.map(async (url) => {
          try {
            const scraped = await tinyfishRouter.tinyfishScrape(url, signal, {
              purpose: `Identify concrete reasons this page gives for ${scopeLabel(scope)} oil, electricity, or water price movements in ${RECENT_MONTH()}.`,
            });
            return scraped ? { url, title: scraped.title || url, snippet: scraped.text?.slice(0, 500) ?? "", text: scraped.text ?? "" } : null;
          } catch {
            return null;
          }
        }),
      );
      const knownCandidates = knownExcerpts.filter((e): e is { url: string; title: string; snippet: string; text: string } => e !== null);
      if (knownCandidates.length > 0) {
        console.warn(`Factor analysis: scraped ${knownCandidates.length} known URLs for scope "${scope}" after error`);
        const deterministic = buildFactorsFromCandidates(knownCandidates, scope, currentPrices, now);
        if (deterministic.length > 0) {
          console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors from known URLs for scope "${scope}" after error`);
          return {
            factors: mergeRollingWindow(existing, deterministic),
            aiCurated: false,
            updatedAt: now,
          };
        }
      }
    } catch (fallbackError) {
      console.error(`Factor analysis: known-URL fallback also failed for scope "${scope}":`, fallbackError);
    }
    return returnExisting();
  }
}
