import { kiloRouter } from "../_shared/kiloRouter";
import { search as webSearch, scrape as webScrape } from "../_shared/webSearch";
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
import { coerceCategory } from "../_shared/validation";
import { VALID_CATEGORIES, type Factor, type RegionId } from "../_shared/types";

/**
 * Robust JSON parsing for LLM responses.
 * Handles markdown code fences, trailing commas, single quotes, and embedded JSON.
 */
function parseLLMJson<T = unknown>(text: string): T | null {
  if (!text || typeof text !== "string") return null;
  
  let cleaned = text.trim();
  
  // Strategy 1: Direct parse
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Continue to other strategies
  }
  
  // Strategy 2: Extract from markdown code blocks (```json ... ``` or ``` ... ```)
  // Handle multiple code blocks, take the first one that looks like JSON
  const markdownMatches = cleaned.matchAll(/```(?:json|js|javascript)?\s*\n?([\s\S]*?)\n?```/g);
  for (const match of markdownMatches) {
    const candidate = match[1].trim();
    if (candidate) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // Try next match
      }
    }
  }
  
  // Strategy 3: Find JSON object/array by balanced braces/brackets
  // This handles JSON embedded in prose: "Here is the result: {...} hope that helps!"
  const braceResult = extractByBalancedBraces(cleaned);
  if (braceResult) {
    try {
      return JSON.parse(braceResult) as T;
    } catch {
      // Continue
    }
  }
  
  // Strategy 4: Repair common JSON issues and retry
  const repaired = repairCommonJsonIssues(cleaned);
  if (repaired !== cleaned) {
    try {
      return JSON.parse(repaired) as T;
    } catch {
      // Continue
    }
    
    // Try brace extraction on repaired text
    const repairedBraceResult = extractByBalancedBraces(repaired);
    if (repairedBraceResult) {
      try {
        return JSON.parse(repairedBraceResult) as T;
      } catch {
        // Continue
      }
    }
  }
  
  // Strategy 5: If the response looks like it might be a JSON array directly
  // (some models return just the array without wrapper object)
  const arrayMatch = cleaned.match(/^\s*\[[\s\S]*\]\s*$/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]) as T;
    } catch {
      // Continue
    }
  }
  
  return null;
}

/**
 * Extract JSON by finding balanced braces/brackets.
 * Returns the first complete JSON object or array found.
 */
function extractByBalancedBraces(text: string): string | null {
  let bestCandidate: string | null = null;
  let bestScore = -1;
  
  // Look for both objects { } and arrays [ ]
  const openChars = ['{', '['];
  const closeChars = ['}', ']'];
  
  for (let i = 0; i < text.length; i++) {
    const openChar = text[i];
    const openIndex = openChars.indexOf(openChar);
    if (openIndex === -1) continue;
    
    const closeChar = closeChars[openIndex];
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let j = i; j < text.length; j++) {
      const char = text[j];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (char === openChar) {
        depth++;
      } else if (char === closeChar) {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(i, j + 1);
          // Score candidates: prefer objects with "factors" key, then longer valid JSON
          let score = candidate.length;
          if (candidate.includes('"factors"')) score += 10000;
          if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
          }
          break;
        }
      }
    }
  }
  
  return bestCandidate;
}

/**
 * Repair common JSON issues from LLM outputs.
 */
function repairCommonJsonIssues(text: string): string {
  let result = text;
  
  // Remove trailing commas before } or ]
  result = result.replace(/,\s*}/g, '}');
  result = result.replace(/,\s*]/g, ']');
  
  // Replace single quotes with double quotes (for keys and string values)
  // This is aggressive - only do it for likely JSON structures
  result = result.replace(/'([^']*)':/g, '"$1":');  // unquoted keys with single quotes
  result = result.replace(/: '([^']*)'/g, ': "$1"'); // single-quoted values
  
  // Fix unquoted keys (simple case: {key: "value"} -> {"key": "value"})
  result = result.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  
  // Remove JavaScript comments
  result = result.replace(/\/\/.*$/gm, '');
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Fix smart quotes
  result = result.replace(/[\u201C\u201D]/g, '"');
  result = result.replace(/[\u2018\u2019]/g, "'");
  
  // Fix em dashes in strings (replace with regular dashes)
  // This is risky, so only do it inside apparent string values
  // Skip for now to avoid corrupting valid JSON
  
  // Remove trailing content after complete JSON (e.g., "Here is the result: {...} hope that helps!")
  // This is handled by extractByBalancedBraces, but we can also try to trim here
  
  return result;
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
  searchProvider?: string;
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
  searchProvider?: string;
  error?: string;
}

export function toFactorsPayload(
  factors: Factor[],
  scope: RegionId,
  aiCurated: boolean,
  extra: { updatedAt: string; error?: string; searchProvider?: string } = { updatedAt: new Date().toISOString() },
): FactorsPayload {
  return {
    factors,
    scope,
    count: factors.length,
    aiCurated,
    cacheKey: factorKeyForScope(scope),
    updatedAt: extra.updatedAt,
    ...(extra.searchProvider ? { searchProvider: extra.searchProvider } : {}),
    ...(extra.error ? { error: extra.error } : {}),
  };
}

const SYSTEM_PROMPT_GLOBAL =
  `You are a Senior Commodity Risk Analyst. You are provided with current global market analytics, an existing list of global price factors, and fresh validated news excerpts collected through TinyFish.\n\nValidate each candidate trend against the supplied current global market conditions and source evidence.\n\nDetermine whether each candidate is a legitimate market-moving trend or noise at a global scale. Reject stale, duplicate, promotional, speculative, unsupported, irrelevant, or weakly evidenced claims.\n\nFor each legitimate trend, evaluate its expected effect on global oil, electricity, or water prices. Assign an integer importance score from 0 to 100 based on evidence quality, geographic scope, affected commodities, expected price impact, duration, and immediacy.\n\nExplain why each approved trend is legitimate and globally relevant right now. Use only the supplied analytics, factors, excerpts, and source URLs. Do not invent sources or facts.\n\nReturn valid JSON only, with no text before, after, or around it. The response must be parseable JSON with a "factors" array containing up to eight factor objects.\n\nEach factor object MUST have these fields:\n  "name": string (non-empty)\n  "explanation": string (non-empty)\n  "source": https://URL\n  "commodities": ["oil", "electricity", "water"] (at least one)\n  "category": "Market" | "Policy" | "Structural" | "Infrastructure" | "Environmental" | "Geopolitical" | "Technological"\n  "direction": "up" | "down" | "mixed"\n  "magnitude": "High" | "Medium" | "Low"\n  "bias": "short" | "mid" | "long" | "flat"\n  "importanceScore": integer 0-100\n\nInclude drift scores for oil/electricity/water when available.\nThe deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

const SYSTEM_PROMPT_REGIONAL = (regionName: string) =>
  `You are a Senior Commodity Risk Analyst specializing in ${regionName} energy and water markets. You are provided with current ${regionName}-specific market analytics, an existing list of ${regionName} price factors, and fresh validated news excerpts collected through TinyFish that are relevant to ${regionName}.\n\nValidate each candidate trend against the supplied current ${regionName} market conditions and source evidence.\n\nDetermine whether each candidate is a legitimate market-moving trend or noise within ${regionName}. Reject stale, duplicate, promotional, speculative, unsupported, irrelevant, or weakly evidenced claims. Reject any trend that is purely global with no demonstrated ${regionName}-specific price impact.\n\nFor each legitimate trend, evaluate its expected effect on ${regionName} oil, electricity, or water prices specifically. Assign an integer importance score from 0 to 100 based on evidence quality, ${regionName} geographic scope, affected commodities, expected regional price impact, duration, and immediacy within ${regionName}.\n\nExplain why each approved trend is legitimate and relevant to ${regionName} right now. Use only the supplied analytics, factors, excerpts, and source URLs. Do not invent sources or facts.\n\nReturn valid JSON only, with no text before, after, or around it. The response must be parseable JSON with a "factors" array containing up to eight factor objects.\n\nEach factor object MUST have these fields:\n  \"name\": string (non-empty)\n  \"explanation\": string (non-empty)\n  \"source\": https://URL\n  \"commodities\": [\"oil\", \"electricity\", \"water\"] (at least one)\n  \"category\": \"Market\" | \"Policy\" | \"Structural\" | \"Infrastructure\" | \"Environmental\" | \"Geopolitical\" | \"Technological\"\n  \"direction\": \"up\" | \"down\" | \"mixed\"\n  \"magnitude\": \"High\" | \"Medium\" | \"Low\"\n  \"bias\": \"short\" | \"mid\" | \"long\" | \"flat\"\n  \"importanceScore\": integer 0-100\n\nInclude drift scores for oil/electricity/water when available.\nThe deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

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
    ...(entry.searchProvider ? { searchProvider: entry.searchProvider } : {}),
  };
}

export async function writeFactorWindow(
  scope: RegionId,
  factors: Factor[],
  aiCurated: boolean,
  searchProvider?: string,
): Promise<FactorWindow> {
  const window: FactorWindow = { factors, aiCurated, updatedAt: new Date().toISOString(), ...(searchProvider ? { searchProvider } : {}) };
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
  let searchProvider: string | undefined = previous?.searchProvider;
  const returnExisting = () => ({
    factors: existing,
    aiCurated: carriedAiCurated,
    updatedAt: now,
    ...(searchProvider ? { searchProvider } : {}),
  });

  try {
    const queries = scope === "global" ? GLOBAL_QUERIES : REGION_QUERIES[scope as Region];
    const searches = await Promise.all(
      queries.map((q) =>
        webSearch(`${q} ${RECENT_MONTH()}`, {
          limit: 10,
          region: region ?? undefined,
          abortSignal: signal,
        }).then(result => {
          // Convert webSearch result to TinyFish-like format for compatibility
          return {
            results: result.results.map((r, idx) => ({
              position: r.position ?? idx + 1,
              site_name: r.site_name ?? "",
              title: r.title ?? "",
              snippet: r.snippet ?? "",
              url: r.url ?? "",
              publishedAt: r.publishedAt,
            })),
            total: result.total,
            keyIndex: -1,
            provider: result.provider,
          };
        }),
      ),
    );
    const providersUsed = searches
      .map((s) => s.provider)
      .filter((p): p is string => !!p && p !== "none");
    if (providersUsed.length > 0) {
      const counts = new Map<string, number>();
      for (const p of providersUsed) {
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      searchProvider = [...counts.entries()].reduce((a, b) => (a[1] > b[1] ? a : b))[0];
      console.warn(`[dynamic-factors] search provider used: ${searchProvider} (queries: ${queries.length})`);
    }
    // Log search results summary for debugging
    const totalResults = searches.reduce((sum, s) => sum + s.total, 0);
    console.warn(`[dynamic-factors] scope="${scope}" total search results: ${totalResults}, providers: ${providersUsed.join(", ")}`);
    // First, try to filter by reputable sources
    let candidates = searches
      .flatMap((r) => r.results)
      .map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }))
      .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt))
      .slice(0, 15);

    // Fallback: if no reputable sources found, use top recent results anyway
    // This ensures AI curation can still run with available sources
    if (candidates.length === 0) {
      console.warn(`[dynamic-factors] No reputable sources found for scope "${scope}", falling back to top recent results`);
      candidates = searches
        .flatMap((r) => r.results)
        .map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }))
        .filter((r) => isRecentPublishedAt(r.publishedAt))
        .slice(0, 15);
    }

    if (candidates.length === 0) {
      return returnExisting();
    }

     const excerpts = await Promise.all(
       candidates.map(async (r) => {
         try {
           const scrapeResult = await webScrape(r.url, { url: r.url, abortSignal: signal });
           if (scrapeResult.data) {
             // Use scraped text if available, otherwise fall back to title or snippet
             const text = scrapeResult.data.text?.trim() 
                 || scrapeResult.data.title?.trim() 
                 || r.title?.trim() 
                 || r.snippet?.trim() 
                 || "";
             return { ...r, text: text, title: scrapeResult.data.title || r.title };
           } else {
             // Fallback: use snippet or title as text when scrape fails completely
             const text = r.title?.trim() || r.snippet?.trim() || "";
             return { ...r, text: text, title: r.title };
           }
         } catch {
           // Fallback on error: use snippet or title as text
           const text = r.title?.trim() || r.snippet?.trim() || "";
           return { ...r, text: text, title: r.title };
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
    };

    let response;
    try {
      response = await kiloRouter.kiloInfer(payload, signal);
    } catch (inferError) {
      console.error(`Kilo inference failed for scope "${scope}":`, inferError instanceof Error ? inferError.message : String(inferError));
      return returnExisting();
    }

    const content = response.choices?.[0]?.message?.content ?? "";
    
    // Use robust LLM JSON parser with multiple fallback strategies
    const parsed = parseLLMJson<{ factors?: unknown[] }>(content);
    
    if (!parsed?.factors || !Array.isArray(parsed.factors)) {
      // Log the raw response for debugging (truncated)
      console.warn(`AI returned invalid/unparseable JSON for scope "${scope}". Response preview:`, content.slice(0, 1000));
      return returnExisting();
    }

    return buildFactorsFromParsed(parsed, scope, existing, searchProvider);
  } catch (error) {
    // Never throw: the callers (route handlers, cron) must always be able to
    // write a window so the health endpoint can report a real `lastRun`.
    console.error(`Factor analysis failed for scope "${scope}":`, error);
    return returnExisting();
  }
}

function buildFactorsFromParsed(
  parsed: { factors?: unknown[] },
  scope: RegionId,
  existing: Factor[],
  searchProvider?: string
): FactorWindow {
  if (!parsed.factors || !Array.isArray(parsed.factors)) {
    return {
      factors: existing,
      aiCurated: false,
      updatedAt: new Date().toISOString(),
      ...(searchProvider ? { searchProvider } : {}),
    };
  }
  const normalized = parsed.factors
    .map((f) => normalizeFactor(f, scope))
    .filter((f): f is Factor => f !== null)
    .filter((f) => f.scope === scope)
    .slice(0, FACTOR_COUNT);

  if (normalized.length === 0) {
    return {
      factors: existing,
      aiCurated: false,
      updatedAt: new Date().toISOString(),
      ...(searchProvider ? { searchProvider } : {}),
    };
  }

  return {
    factors: mergeRollingWindow(existing, normalized),
    aiCurated: true,
    updatedAt: new Date().toISOString(),
    ...(searchProvider ? { searchProvider } : {}),
  };
}
