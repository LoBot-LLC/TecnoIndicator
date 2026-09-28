import { kiloRouter } from "../_shared/kiloRouter";
import { tinyfishRouter } from "../_shared/tinyfishRouter";
import { getGlobalAnalytics, getRegionalAnalytics } from "../_shared/deterministicAnalytics";
import { MAX_SOLUTIONS, SOLUTIONS_CACHE_MS } from "../_shared/http";
import { getCache, setCache } from "../_shared/cache";
import { readFactorWindow } from "./factor-analysis";
import { safeParseJson } from "../_shared/validation";
import { isRegion, type Region } from "../_shared/regions";
import type { Factor, RegionId, Solution } from "../_shared/types";

/** Aligned with SCRAPE_CACHE_MS so the evidence prompt is not re-paid every 30s. */
const EVIDENCE_CACHE_MS = 5 * 60_000;

const GLOBAL_QUERIES = [
  "global oil market prices OPEC supply demand 2026",
  "global electricity power prices renewable energy grid 2026",
  "global water prices scarcity drought utilities 2026",
];

const REGION_QUERIES: Record<Region, string[]> = {
  asia: [
    "oil market prices China India demand OPEC 2026",
    "electricity power prices renewables grid China India 2026",
    "water prices scarcity drought urbanization 2026",
  ],
  europe: [
    "oil market prices Brent Russian supply sanctions 2026",
    "electricity power prices carbon ETS renewables gas 2026",
    "water prices drought scarcity Alpine hydropower 2026",
  ],
  africa: [
    "oil market prices Nigeria Angola production exports 2026",
    "electricity power prices diesel gensets grid reliability 2026",
    "water prices drought scarcity Sahel utilities 2026",
  ],
  americas: [
    "oil market prices WTI shale LNG exports 2026",
    "electricity power prices hydro drought Henry Hub 2026",
    "water prices drought California Southwest utilities 2026",
  ],
  oceania: [
    "oil market prices LNG import parity Australia 2026",
    "electricity power prices NEM NZ wholesale drought 2026",
    "water prices drought Sydney Melbourne utilities 2026",
  ],
};

const SOLUTION_PROMPT = `You are a Senior Business Strategy Advisor for commodity-driven companies. Based on the following market analytics, dynamic factors, and fresh web evidence, generate exactly 3 actionable solutions for business owners and executives to manage their logistics and business decisions better. Each solution should target a different strategic aspect: operational resilience, cost optimization, and strategic positioning.

Return strict JSON only with this schema:
{
  "solutions": [
    {
      "title": "string (max 120 chars)",
      "summary": "string (max 600 chars)",
      "actions": ["string (max 200 chars)", "string", "string", "string", "string"],
      "commodities": ["oil" | "electricity" | "water"],
      "regions": ["global" | "asia" | "europe" | "africa" | "americas" | "oceania"],
      "relatedFactors": ["factorId", ...],
      "confidence": number (0-100)
    }
  ]
}

Use only the supplied analytics, factors, and fresh web evidence with source URLs. Cite sources by including the URL in the summary when referencing specific data points. Do not invent sources or facts.`;

const VALID_REGIONS: RegionId[] = ["global", "asia", "europe", "africa", "americas", "oceania"];

interface CachedSolutions {
  solutions: Solution[];
  /** True only when ALL returned solutions were model-generated. */
  aiCurated: boolean;
  /** How many of the returned solutions were genuinely model-generated. */
  aiCount: number;
  degraded: boolean;
  reason: string | null;
}

/** Machine-readable reason the solutions list is not fully AI-generated. */
type SolutionsReason = "kilo-unavailable" | "kilo-aborted" | "unparseable-json" | "no-ai-solutions" | "threw";

/**
 * TTL for a body that was produced only because a request ran out of budget.
 * Long enough to absorb a burst of concurrent readers, short enough that one
 * timeout is not re-served to everyone for a full SOLUTIONS_CACHE_MS.
 */
const TRANSIENT_SOLUTIONS_CACHE_MS = 10_000;

function recentMonth(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function isValidRegionId(value: string): value is RegionId {
  return value === "global" || isRegion(value);
}

function buildSolution(s: unknown, scope: RegionId, validRegions: RegionId[]): Solution | null {
  if (!s || typeof s !== "object") return null;
  const obj = s as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 120) : "";
  const summary = typeof obj.summary === "string" ? obj.summary.trim().slice(0, 600) : "";
  const actions = Array.isArray(obj.actions)
    ? obj.actions
        .filter((a: unknown) => typeof a === "string")
        .map((a: string) => a.trim().slice(0, 200))
        .filter((a: string) => a.length > 0)
        .slice(0, 5)
    : [];
  if (!title || !summary || actions.length === 0) return null;
  const rawRegions = Array.isArray(obj.regions)
    ? (obj.regions as unknown[]).filter((r): r is RegionId => typeof r === "string" && validRegions.includes(r as RegionId))
    : [];
  const commodities: ("oil" | "electricity" | "water")[] = Array.isArray(obj.commodities)
    ? (obj.commodities as unknown[]).filter(
        (c): c is "oil" | "electricity" | "water" => c === "oil" || c === "electricity" || c === "water",
      )
    : ["oil", "electricity", "water"];
  const relatedFactors = Array.isArray(obj.relatedFactors)
    ? (obj.relatedFactors as unknown[]).filter((f): f is string => typeof f === "string").slice(0, 8)
    : [];
  const confidence =
    typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
      ? Math.max(0, Math.min(100, Math.round(obj.confidence)))
      : 70;

  return {
    id: `solution-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    summary,
    actions,
    commodities,
    regions: rawRegions.length > 0 ? rawRegions : scope === "global" ? ["global"] : [scope],
    scope,
    relatedFactors,
    confidence,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function buildFallbackSolutions(
  scope: RegionId,
  analytics: Record<string, unknown>,
  factors: Factor[],
): Solution[] {
  const now = new Date().toISOString();
  const regionName = scope;
  const fuelLevy = (analytics.fuelLevy as number) ?? 0;
  const elecIdx = (analytics.electricityTariffAdjustmentIndex as number) ?? 0;
  const waterIdx = (analytics.waterScarcityAdjustedPriceIndex as number) ?? 0;

  return [
    {
      id: `solution-fallback-${Date.now()}-0`,
      title: fuelLevy > 0 ? "Lock in fuel costs via fixed-price hedging" : "Optimize fuel procurement with dynamic sourcing",
      summary: `Based on ${regionName} market analytics (fuelLevy ${fuelLevy >= 0 ? "+" : ""}${fuelLevy}, electricity index ${elecIdx >= 0 ? "+" : ""}${elecIdx}), hedge exposure to ${fuelLevy > 0 ? "rising" : "volatile"} fuel costs using fixed-price contracts or financial swaps. Source from diversified suppliers to mitigate regional supply disruptions. Current analytics: ${analytics.dataSource ?? "benchmark data"}.`,
      actions: [
        "Secure fixed-price fuel contracts for 60-80% of Q4 2026 volume",
        "Establish secondary supplier agreements outside primary delivery corridors",
        "Monitor regional inventory levels weekly to adjust procurement timing",
        "Use futures or swaps to hedge remaining variable exposure",
      ],
      commodities: ["oil"],
      regions: [scope],
      scope,
      relatedFactors: factors.slice(0, 4).map((f) => f.id),
      confidence: 65,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `solution-fallback-${Date.now()}-1`,
      title: elecIdx > 0 ? "Reduce electricity demand during peak pricing windows" : "Stabilize electricity procurement with flexible contracts",
      summary: `Electricity tariff adjustment index is ${elecIdx >= 0 ? "+" : ""}${elecIdx} for ${regionName}. ${elecIdx > 0 ? "Shift energy-intensive operations to off-peak hours and invest in demand response." : "Lock in flexible contracts that track real-time pricing to benefit from low-demand periods."}`,
      actions: [
        "Install smart energy management systems to optimize load scheduling",
        "Negotiate time-of-use electricity contracts with tiered pricing",
        "Deploy on-site power generation (solar/diesel backup) for peak shaving",
        "Join regional demand response programs for additional revenue",
      ],
      commodities: ["electricity"],
      regions: [scope],
      scope,
      relatedFactors: factors.slice(4, 8).map((f) => f.id),
      confidence: 65,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `solution-fallback-${Date.now()}-2`,
      title:
        waterIdx > 0.5
          ? "Secure alternative water sources before scarcity impacts operations"
          : "Implement water recycling to reduce long-term supply risk",
      summary: `Water scarcity adjusted price index is ${waterIdx >= 0 ? "+" : ""}${waterIdx} for ${regionName}. ${waterIdx > 0.5 ? "Drought conditions and rising costs indicate need for immediate alternative sourcing." : "Modest water cost changes allow proactive investment in efficiency."} ${factors.length > 0 ? `Key factors: ${factors.map((f) => f.name).join(", ")}.` : ""}`,
      actions: [
        "Conduct water audit to identify recycling and efficiency opportunities",
        "Negotiate long-term water supply contracts with volume discounts",
        "Invest in on-site water treatment or rainwater harvesting systems",
        "Explore regulatory incentives for water conservation programs",
      ],
      commodities: ["water"],
      regions: [scope],
      scope,
      relatedFactors: factors.slice(0, 4).map((f) => f.id),
      confidence: 65,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

async function fetchFreshEvidence(scope: RegionId, abortSignal: AbortSignal): Promise<unknown[]> {
  const evidenceCacheKey = `solutions:evidence:${scope}`;
  const cached = await getCache<unknown[]>(evidenceCacheKey, EVIDENCE_CACHE_MS);
  if (cached) return cached;

  const queries = scope === "global" ? GLOBAL_QUERIES : REGION_QUERIES[scope as Region];
  try {
    const searches = await Promise.all(
      queries.map((q) =>
        tinyfishRouter.tinyfishSearch(
          `${q} ${recentMonth()}`,
          { limit: 10, region: scope === "global" ? undefined : (scope as Region) },
          abortSignal,
        ),
      ),
    );
    const freshEvidence = searches.flatMap((r) => r.results).slice(0, 15);
    await setCache(evidenceCacheKey, freshEvidence, EVIDENCE_CACHE_MS);
    return freshEvidence;
  } catch (error) {
    console.error("TinyFish evidence fetch failed:", error);
    return [];
  }
}

/**
 * GET /api/solutions[?region=…] — up to {@link MAX_SOLUTIONS} strategy
 * recommendations for a scope, grounded in the canonical factor window so the
 * reasons the UI shows are the reasons the solutions were generated from.
 */
export async function handleSolutions(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://localhost");
  const force = url.searchParams.get("force") === "true";
  const regionParam = url.searchParams.get("region");
  const isGlobal = regionParam === null || regionParam === "";
  const scope: RegionId = isGlobal ? "global" : isValidRegionId(regionParam) ? regionParam : "global";
  const cacheKey = `solutions:${scope}`;

  if (!force) {
    const cached = await getCache<CachedSolutions>(cacheKey, SOLUTIONS_CACHE_MS);
    if (cached) {
      return Response.json(
        {
          solutions: cached.solutions,
          scope,
          count: cached.solutions.length,
          aiCurated: cached.aiCurated,
          aiCount: cached.aiCount,
          degraded: cached.degraded,
          ...(cached.reason ? { reason: cached.reason } : {}),
          cacheKey,
          updatedAt: new Date().toISOString(),
          servedFrom: "cache" as const,
        },
        { status: 200 },
      );
    }
  }

  const abortController = new AbortController();
  // 45s with >=10s of headroom under vercel.json's 60s maxDuration: our abort
  // always fires before Vercel's kill, so a slow gateway degrades to the
  // deterministic solutions instead of an HTTP 504.
  const timeoutId = setTimeout(() => abortController.abort(), 45000);

  let analytics: Record<string, unknown>;
  let factors: Factor[] = [];

  try {
    analytics = (scope === "global"
      ? await getGlobalAnalytics()
      : await getRegionalAnalytics(scope as Region)) as unknown as Record<string, unknown>;
    factors = (await readFactorWindow(scope))?.factors ?? [];
  } catch (error) {
    console.error("Analytics/factors fetch failed:", error);
    analytics = {
      dataSource: "Static fallback (services unavailable)",
      fuelLevy: 0,
      electricityTariffAdjustmentIndex: 0,
      waterScarcityAdjustedPriceIndex: 0,
    };
  }

  try {
    let freshEvidence: unknown[] = [];
    try {
      freshEvidence = await fetchFreshEvidence(scope, abortController.signal);
    } catch (error) {
      console.error("fetchFreshEvidence error:", error);
      freshEvidence = [];
    }

    const payload = {
      messages: [
        { role: "system", content: SOLUTION_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            analytics,
            factors,
            scope,
            region: isGlobal ? null : scope,
            evidence: freshEvidence,
          }),
        },
      ],
      max_tokens: 2048,
      temperature: 0.25,
      // Keeps the answer parseable as a bare JSON object.
      response_format: { type: "json_object" },
    };

    let aiSolutions: Solution[] = [];
    let reason: SolutionsReason | null = null;
    try {
      const response = await kiloRouter.kiloInfer(payload, abortController.signal);
      const content = response.choices?.[0]?.message?.content ?? "";
      const parsed = safeParseJson<{ solutions?: unknown[] }>(content);
      // Tolerant: a short but valid AI response is kept and backfilled below.
      aiSolutions = (Array.isArray(parsed?.solutions) ? parsed.solutions : [])
        .map((s: unknown) => buildSolution(s, scope, VALID_REGIONS))
        .filter((s): s is Solution => s !== null)
        .slice(0, MAX_SOLUTIONS);
      if (aiSolutions.length === 0) reason = "unparseable-json";
    } catch (error) {
      // Previously only console.error'd, so a failed Kilo call was reported as a
      // perfectly healthy response of three deterministic solutions.
      const message = String((error as Error)?.message ?? error);
      if (abortController.signal.aborted) {
        reason = "kilo-aborted";
      } else if (/no kilo gateway key|no available kilo|no kilo gateway model/i.test(message)) {
        reason = "kilo-unavailable";
      } else {
        reason = "threw";
      }
      console.error("Kilo inference failed, using deterministic fallback:", message);
    }
    if (aiSolutions.length === 0 && reason === null) reason = "no-ai-solutions";

    const fallback = buildFallbackSolutions(scope, analytics, factors);
    const solutions = [...aiSolutions, ...fallback].slice(0, MAX_SOLUTIONS);
    // The list is always padded to MAX_SOLUTIONS, so `aiCurated` may only be
    // true when nothing deterministic had to be added.
    const aiCount = aiSolutions.length;
    const aiCurated = aiCount === solutions.length;
    const degraded = aiCount < solutions.length;

    // Caching a degraded body for the full SOLUTIONS_CACHE_MS re-served one
    // timeout to every reader for a minute. A genuinely good body still uses the
    // full TTL; an aborted/threw body is written with a 10s TTL so the very next
    // request can recover immediately.
    const transient = reason === "kilo-aborted" || reason === "threw";
    await setCache(
      cacheKey,
      { solutions, aiCurated, aiCount, degraded, reason } satisfies CachedSolutions,
      transient ? TRANSIENT_SOLUTIONS_CACHE_MS : SOLUTIONS_CACHE_MS,
    );

    return Response.json(
      {
        solutions,
        scope,
        count: solutions.length,
        aiCurated,
        aiCount,
        degraded,
        ...(reason ? { reason } : {}),
        cacheKey,
        updatedAt: new Date().toISOString(),
        servedFrom: degraded ? ("fallback" as const) : ("curated" as const),
        ...(degraded ? { error: "Some solutions are deterministic padding; AI generation degraded" } : {}),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Solutions error:", error);
    const fallback = buildFallbackSolutions(scope, analytics, factors);
    return Response.json(
      {
        solutions: fallback,
        scope,
        count: fallback.length,
        aiCurated: false,
        aiCount: 0,
        degraded: true,
        reason: "threw" as const,
        cacheKey: "solutions:error",
        updatedAt: new Date().toISOString(),
        servedFrom: "fallback" as const,
        error: "Solutions temporarily unavailable; static fallbacks returned",
      },
      { status: 200 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
