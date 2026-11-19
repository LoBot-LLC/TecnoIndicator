import { kiloRouter } from "../_shared/kiloRouter";
import { tinyfishRouter } from "../_shared/tinyfishRouter";
import { getGlobalAnalytics, getRegionalAnalytics } from "../_shared/deterministicAnalytics";
import { MAX_SOLUTIONS, SOLUTIONS_CACHE_MS } from "../_shared/http";
import { getCache, setCache } from "../_shared/cache";
import { readFactorWindow } from "./factor-analysis";
import { safeParseJson } from "../_shared/validation";
import { isRegion, type Region } from "../_shared/regions";
import type { Factor, RegionId, Solution } from "../_shared/types";

const EVIDENCE_CACHE_MS = 30_000;

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

Generate solutions DIRECTLY from the supplied factors (their name, explanation, commodities, direction, magnitude) and analytics, citing specific factor reasons. Each solution must reference at least one factor by its name or explanation. Do not output generic templates unrelated to the supplied factors. Use only the supplied analytics, factors, and fresh web evidence with source URLs. Cite sources by including the URL in the summary when referencing specific data points. Do not invent sources or facts.`;

const VALID_REGIONS: RegionId[] = ["global", "asia", "europe", "africa", "americas", "oceania"];

interface CachedSolutions {
  solutions: Solution[];
  aiCurated: boolean;
}

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

function buildReasonDerivedSolutions(
  scope: RegionId,
  factors: Factor[],
): Solution[] {
  if (factors.length === 0) return [];

  const now = new Date().toISOString();
  const solutions: Solution[] = [];

  // Helper: derive title from factor
  const deriveTitle = (f: Factor): string => {
    const commodity = f.commodities[0] ?? "commodity";
    const directionVerb = f.direction === "up" ? "Hedge" : f.direction === "down" ? "Capitalize" : "Manage";
    const term = f.name.split(" ").find(w => w.length > 2) ?? f.category;
    const title = `${directionVerb} ${commodity} ${term}`.slice(0, 120);
    return title;
  };

  // Helper: derive summary from factor
  const deriveSummary = (f: Factor): string => {
    const directionText = f.direction === "up" ? "rising" : f.direction === "down" ? "falling" : "mixed";
    const magnitudeText = f.magnitude.charAt(0).toLowerCase() + f.magnitude.slice(1).toLowerCase();
    return `With ${f.commodities.join("/")} ${directionText} ${magnitudeText} trends (${f.name}), address impacts through ${f.explanation.toLowerCase()}`;
  };

  // Helper: derive actions from factor context
  const deriveActions = (f: Factor): string[] => {
    const actions: string[] = [];
    const commodity = f.commodities[0] ?? "commodity";
    const directionText = f.direction === "up" ? "increasing" : f.direction === "down" ? "decreasing" : "volatile";
    
    // Generate concrete actions based on factor category and direction
    if (f.category === "Market") {
      if (f.direction === "up") {
        actions.push(`Secure forward contracts for ${commodity} to lock in prices before further increases`);
        actions.push(`Diversify suppliers to reduce exposure to single-source price volatility`);
        actions.push(`Implement price monitoring systems with automated alerts for ${directionText} trends`);
        if (f.importanceScore > 70) {
          actions.push(`Negotiate volume discounts with key suppliers to offset price pressure`);
        }
      } else if (f.direction === "down") {
        actions.push(`Increase procurement volumes to benefit from favorable market pricing`);
        actions.push(`Consolidate purchasing with fewer strategic suppliers for better terms`);
        actions.push(`Invest in hedging instruments to protect against future price increases`);
        if (f.magnitude === "High") {
          actions.push(`Consider strategic storage to capitalize on current market conditions`);
        }
      }
    } else if (f.category === "Policy") {
      actions.push(`Monitor policy developments and adjust procurement strategies accordingly`);
      actions.push(`Engage with local authorities to influence favorable policy outcomes`);
      actions.push(`Develop contingency plans for policy changes affecting ${commodity} availability`);
    } else {
      actions.push(`Invest in efficiency improvements to reduce ${commodity} dependency`);
      actions.push(`Explore alternative sources or substitute materials for ${commodity}`);
      actions.push(`Implement predictive analytics to anticipate ${directionText} ${commodity} availability`);
      if (f.drift?.[commodity]) {
        actions.push(`Adjust procurement timing based on seasonal price patterns for ${commodity}`);
      }
    }

    if (actions.length < 3) {
      actions.push(`Maintain regular supplier relationships to ensure ${commodity} availability`);
      actions.push(`Track market indicators to inform strategic decisions`);
    }

    return actions.slice(0, 5);
  };

  // Primary solutions from each factor
  for (const factor of factors) {
    if (solutions.length >= MAX_SOLUTIONS) break;
    
    const title = deriveTitle(factor);
    const summary = deriveSummary(factor);
    const actions = deriveActions(factor);
    
    solutions.push({
      id: `solution-${Date.now()}-${solutions.length}`, // Ensure unique IDs
      title,
      summary,
      actions,
      commodities: factor.commodities,
      regions: scope === "global" ? ["global"] : [scope],
      scope,
      relatedFactors: [factor.id],
      confidence: factor.importanceScore,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Pad solutions when fewer than 3, using factor explanations for each strategic angle
  if (solutions.length < MAX_SOLUTIONS && factors.length > 0) {
    const padded: Solution[] = [];
    
    // Operational resilience angle
    if (solutions.length < MAX_SOLUTIONS) {
      const f = factors[0];
      padded.push({
        id: `solution-${Date.now()}-pad-op-res`,
        title: `Strengthen ${f.commodities[0] ?? "commodity"} operational resilience`,
        summary: `Based on ${f.name}, build operational resilience by ${f.explanation.toLowerCase()}. This addresses supply chain continuity and business continuity needs.`,
        actions: [
          `Develop backup supply contracts for ${f.commodities[0] ?? "commodity"}`, 
          `Implement inventory buffers for ${f.commodities[0] ?? "commodity"} shortages`,
          `Create emergency response protocols for ${f.commodities[0] ?? "commodity"} disruptions`,
        ],
        commodities: f.commodities,
        regions: scope === "global" ? ["global"] : [scope],
        scope,
        relatedFactors: [f.id],
        confidence: Math.max(50, f.importanceScore - 20),
        createdAt: now,
        updatedAt: now,
      });
    }

    // Cost optimization angle  
    if (solutions.length < MAX_SOLUTIONS) {
      const f = factors[1] ?? factors[0];
      padded.push({
        id: `solution-${Date.now()}-pad-cost-opt`,
        title: `Optimize ${f.commodities[0] ?? "commodity"} cost structure`,
        summary: `From ${f.name}, optimize costs by ${f.explanation.toLowerCase()}. This focuses on reducing total cost of ownership and improving margin efficiency.`,
        actions: [
          `Analyze ${f.commodities[0] ?? "commodity"} usage patterns for waste reduction`,
          `Negotiate better terms with existing suppliers based on ${f.name.toLowerCase()}`,
          `Implement performance metrics to track ${f.commodities[0] ?? "commodity"} cost efficiency`,
        ],
        commodities: f.commodities,
        regions: scope === "global" ? ["global"] : [scope],
        scope,
        relatedFactors: [f.id],
        confidence: Math.max(50, f.importanceScore - 20),
        createdAt: now,
        updatedAt: now,
      });
    }

    // Strategic positioning angle
    if (solutions.length < MAX_SOLUTIONS) {
      const f = factors[factors.length - 1];
      padded.push({
        id: `solution-${Date.now()}-pad-strat-pos`,
        title: `Position strategically for ${f.commodities[0] ?? "commodity"} opportunities`,
        summary: `Leveraging ${f.name}, create strategic positioning advantages by ${f.explanation.toLowerCase()}. This enables competitive differentiation and market leadership.`,
        actions: [
          `Invest in capabilities to capitalize on ${f.name.toLowerCase()}`,
          `Build partnerships to enhance ${f.commodities[0] ?? "commodity"} market presence`,
          `Develop specialized expertise in ${f.commodities[0] ?? "commodity"} markets`,
        ],
        commodities: f.commodities,
        regions: scope === "global" ? ["global"] : [scope],
        scope,
        relatedFactors: [f.id],
        confidence: Math.max(50, f.importanceScore - 20),
        createdAt: now,
        updatedAt: now,
      });
    }

    solutions.push(...padded);
  }

  return solutions.slice(0, MAX_SOLUTIONS);
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
          cacheKey,
          updatedAt: new Date().toISOString(),
        },
        { status: 200 },
      );
    }
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 30000);

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
    };

    let aiSolutions: Solution[] = [];
    try {
      const response = await kiloRouter.kiloInfer(payload, abortController.signal);
      const content = response.choices?.[0]?.message?.content ?? "";
      const parsed = safeParseJson<{ solutions?: unknown[] }>(content);
      // Tolerant: a short but valid AI response is kept and backfilled below.
      aiSolutions = (Array.isArray(parsed?.solutions) ? parsed.solutions : [])
        .map((s: unknown) => buildSolution(s, scope, VALID_REGIONS))
        .filter((s): s is Solution => s !== null)
        .slice(0, MAX_SOLUTIONS);
    } catch (error) {
      console.error("Kilo inference failed, using deterministic fallback:", error);
    }

    const aiCurated = aiSolutions.length > 0;
    let reasonDerivedSolutions: Solution[] = [];

    // When AI fails to return any solutions but factors exist, return reason-derived solutions
    if (!aiCurated && factors.length > 0) {
      reasonDerivedSolutions = buildReasonDerivedSolutions(scope, factors);
    }
    
    // Build final solutions array: if AI solutions exist, return only those (no padding); otherwise use reason-derived or empty
    const solutions = aiCurated ? aiSolutions.slice(0, MAX_SOLUTIONS) : reasonDerivedSolutions;

    await setCache(cacheKey, { solutions, aiCurated } satisfies CachedSolutions, SOLUTIONS_CACHE_MS);

    return Response.json(
      {
        solutions,
        scope,
        count: solutions.length,
        aiCurated,
        cacheKey,
        updatedAt: new Date().toISOString(),
        ...(aiCurated
          ? {}
          : { error: "No AI-curated solutions; static fallbacks returned" }),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Solutions error:", error);
    const reasonDerived = buildReasonDerivedSolutions(scope, factors);
    return Response.json(
      {
        solutions: reasonDerived,
        scope,
        count: reasonDerived.length,
        aiCurated: false,
        cacheKey: "solutions:error",
        updatedAt: new Date().toISOString(),
        error: "Solutions temporarily unavailable; reason-derived fallbacks returned",
      },
      { status: 200 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
