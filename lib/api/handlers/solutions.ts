import { kiloRouter } from "../_shared/kiloRouter";
import { tinyfishRouter } from "../_shared/tinyfishRouter";
import { getGlobalAnalytics, getRegionalAnalytics } from "../_shared/deterministicAnalytics";
import { MAX_SOLUTIONS, SOLUTIONS_CACHE_MS } from "../_shared/http";
import { getCache, setCache } from "../_shared/cache";
import { readFactorWindow } from "./factor-analysis";
import { safeParseJson } from "../_shared/validation";
import { isRegion, type Region } from "../_shared/regions";
import type { Factor, RegionId, Solution } from "../_shared/types";
import { getLanguageName, type Language } from "@/lib/translations";

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

const SOLUTION_PROMPT = `You are a Senior Business Strategy Advisor for commodity-driven companies. Your task is to generate exactly 3 actionable, differentiated strategy recommendations for business owners and executives managing commodity-dependent logistics and procurement decisions.

INPUT DATA (all real — do not invent sources or facts):
- Market analytics: fuel levy index, electricity tariff index, water scarcity index for the requested scope/region
- Dynamic factors: curated price drivers with explanations, grounding prices (oil/electricity/water), source URLs, direction/magnitude/importance scores
- Fresh web evidence: search results from TinyFish with titles, snippets, and URLs about oil/electricity/water markets for this scope

INSTRUCTIONS:
1. Generate EXACTLY 3 solutions. Each must target a different strategic aspect: (1) operational resilience, (2) cost optimization, (3) strategic positioning.
2. Base every recommendation on the real analytics, dynamic factors, and web evidence supplied above. Reference specific factor names, prices, and trends where relevant.
3. Cite sources by including source URLs in summaries when referencing specific data points.
4. Do not fabricate sources, prices, or facts. If a data point is uncertain, qualify it rather than inventing it.

Return strict JSON only with this schema:
{
  "solutions": [
    {
      "title": "string (max 120 chars, concise, action-oriented)",
      "summary": "string (max 600 chars, explains the strategy and cites sources where relevant)",
      "actions": ["string (max 200 chars each)", "string", "string", "string", "string"],
      "commodities": ["oil" | "electricity" | "water", ...] (must be subset of oil, electricity, water),
      "regions": ["global" | "asia" | "europe" | "africa" | "americas" | "oceania", ...] (must match scope),
      "relatedFactors": ["factorId", ...] (reference factor IDs from the dynamic factors list),
      "confidence": number (0-100, based on evidence strength)
    }
  ]
}

Do not include markdown code fences. Output only raw JSON.`;

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

function resolveLanguage(value: string | null): Language {
  const v = value ?? "en";
  if (v === "en" || v === "es" || v === "vi") return v;
  return "en";
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
  const regionName = scope.charAt(0).toUpperCase() + scope.slice(1);
  const fuelLevy = (analytics.fuelLevy as number) ?? 0;
  const elecIdx = (analytics.electricityTariffAdjustmentIndex as number) ?? 0;
  const waterIdx = (analytics.waterScarcityAdjustedPriceIndex as number) ?? 0;

  // Sort factors by importance to pick the most relevant ones for fallback strategies
  const topFactors = [...factors].sort((a, b) => b.importanceScore - a.importanceScore);

  const buildSolution = (
    index: number,
    title: string,
    summary: string,
    actions: string[],
    commodities: ("oil" | "electricity" | "water")[],
    relatedFactorIds: string[],
    confidence: number,
  ): Solution => ({
    id: `solution-fallback-${Date.now()}-${index}`,
    title,
    summary,
    actions,
    commodities,
    regions: [scope],
    scope,
    relatedFactors: relatedFactorIds.slice(0, 8),
    confidence,
    createdAt: now,
    updatedAt: now,
  });

  // Solution 1: Operational resilience — based on the most impactful supply/disruption factor
  const resilienceFactor = topFactors.find(
    (f) => f.direction === "up" && f.magnitude === "High",
  );
  const resilienceSummary =
    resilienceFactor && resilienceFactor.commodities.includes("oil")
      ? `With oil price pressure driven by ${resilienceFactor.name.toLowerCase()}, secure supply continuity by diversifying suppliers and building inventory buffers. ${resilienceFactor.explanation.slice(0, 200)} Source: ${resilienceFactor.source}.`
      : `Operational resilience for ${regionName}: current fuel levy index is ${fuelLevy >= 0 ? "+" : ""}${fuelLevy}. Secure supply continuity through diversified sourcing and inventory buffers. Market analytics source: ${analytics.dataSource ?? "benchmark data"}.`;

  // Solution 2: Cost optimization — based on electricity/water cost factors
  const costFactor = topFactors.find(
    (f) => (f.commodities.includes("electricity") || f.commodities.includes("water")) && f.direction === "down",
  ) ?? topFactors.find((f) => f.commodities.includes("electricity") || f.commodities.includes("water"));
  const costSummary =
    costFactor
      ? `Cost optimization for ${regionName}: ${costFactor.name.toLowerCase()} — ${costFactor.explanation.slice(0, 200)} Source: ${costFactor.source}.`
      : `Cost optimization for ${regionName}: electricity tariff index ${elecIdx >= 0 ? "+" : ""}${elecIdx}, water scarcity index ${waterIdx >= 0 ? "+" : ""}${waterIdx}. Focus on demand management and efficiency investments. Source: ${analytics.dataSource ?? "benchmark data"}.`;

  // Solution 3: Strategic positioning — based on long-term trends
  const strategicFactor = topFactors.find((f) => f.bias === "long") ?? topFactors[0];
  const strategicSummary =
    strategicFactor
      ? `Strategic positioning for ${regionName}: ${strategicFactor.name.toLowerCase()} — ${strategicFactor.explanation.slice(0, 200)} Source: ${strategicFactor.source}.`
      : `Strategic positioning for ${regionName}: monitor long-term commodity trends across oil, electricity, and water markets. Source: ${analytics.dataSource ?? "benchmark data"}.`;

  return [
    buildSolution(
      0,
      "Secure supply continuity via diversified sourcing",
      resilienceSummary,
      [
        "Identify at least two secondary suppliers outside your primary delivery corridor",
        "Build 30-60 days of inventory buffer for critical commodities",
        "Monitor regional inventory levels weekly to adjust procurement timing",
        "Negotiate force majeure clauses covering supply disruptions",
      ],
      resilienceFactor?.commodities ?? ["oil", "electricity", "water"],
      resilienceFactor ? [resilienceFactor.id] : topFactors.slice(0, 2).map((f) => f.id),
      resilienceFactor ? Math.min(80, resilienceFactor.importanceScore + 5) : 65,
    ),
    buildSolution(
      1,
      "Optimize costs through demand and tariff management",
      costSummary,
      [
        "Shift energy-intensive operations to off-peak pricing windows",
        "Negotiate time-of-use contracts with tiered pricing structures",
        "Deploy on-site generation or storage for peak shaving",
        "Join demand response programs for additional revenue streams",
      ],
      costFactor?.commodities ?? ["electricity", "water"],
      costFactor ? [costFactor.id] : topFactors.slice(2, 4).map((f) => f.id),
      costFactor ? Math.min(80, costFactor.importanceScore + 5) : 60,
    ),
    buildSolution(
      2,
      "Position for long-term commodity market transitions",
      strategicSummary,
      [
        "Map your exposure to long-term structural shifts across oil, electricity, and water",
        "Invest in efficiency and alternative supply before tariffs rise further",
        "Track regulatory changes affecting commodity pricing in your region",
        "Build scenario plans for 3-5 year commodity price trajectories",
      ],
      strategicFactor?.commodities ?? ["oil", "electricity", "water"],
      strategicFactor ? [strategicFactor.id] : topFactors.slice(4, 6).map((f) => f.id),
      strategicFactor ? Math.min(80, strategicFactor.importanceScore + 5) : 55,
    ),
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
    const allResults = searches.flatMap((r) => r.results);
    // De-duplicate URLs across all queries
    const seen = new Set<string>();
    const uniqueResults = allResults.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
    // Scrape the top 8 URLs so Kilo analyzes actual source content, not just snippets
    const topUrls = uniqueResults.slice(0, 8).map((r) => r.url);
    const scraped = await tinyfishRouter.tinyfishScrapeBatch(topUrls, abortSignal, {
      purpose: "Extract the key price drivers and strategic context for oil, electricity, and water markets to generate actionable business strategies.",
    });
    const freshEvidence = scraped.results.map((r) => ({
      url: r.url,
      title: r.title,
      text: r.text,
    }));
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
  const language = resolveLanguage(url.searchParams.get("lang"));

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

    const languageInstruction =
      language === "en"
        ? ""
        : `LANGUAGE INSTRUCTION: The user is currently viewing this app in ${getLanguageName(language)}. Write ALL user-facing text (solution titles, summaries, action items) in ${getLanguageName(language)}. Keep numbers, sources/URLs, and JSON field names as-is.`;
    const systemContent = SOLUTION_PROMPT + (languageInstruction ? `\n\n${languageInstruction}` : "");

    const payload = {
      messages: [
        { role: "system", content: systemContent },
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
    const fallback = buildFallbackSolutions(scope, analytics, factors);
    const solutions = [...aiSolutions, ...fallback].slice(0, MAX_SOLUTIONS);

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
    const fallback = buildFallbackSolutions(scope, analytics, factors);
    return Response.json(
      {
        solutions: fallback,
        scope,
        count: fallback.length,
        aiCurated: false,
        cacheKey: "solutions:error",
        updatedAt: new Date().toISOString(),
        error: "Solutions temporarily unavailable; static fallbacks returned",
      },
      { status: 200 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
