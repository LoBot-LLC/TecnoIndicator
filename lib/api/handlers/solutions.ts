import { kiloRouter } from "../_shared/kiloRouter";
import { tinyfishRouter } from "../_shared/tinyfishRouter";
import { getGlobalAnalytics, getRegionalAnalytics } from "../_shared/deterministicAnalytics";
import { MAX_SOLUTIONS, SOLUTIONS_CACHE_MS, isReputableSource, isRecentPublishedAt } from "../_shared/http";
import { summarizeEvidenceSentence, safeHost, COMMODITY_PATTERNS } from "../_shared/summarization";
import { getCache, setCache } from "../_shared/cache";
import { readFactorWindow } from "./factor-analysis";
import { safeParseJson } from "../_shared/validation";
import { isRegion, type Region } from "../_shared/regions";
import type { CommodityId, Factor, RegionId, Solution } from "../_shared/types";

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

const SOLUTION_PROMPT = `You are a Senior Business Strategy Advisor for commodity-driven companies. Your task is to turn the supplied DYNAMIC FACTORS into exactly 3 actionable business solutions — NOT to summarize market reports or restate statistics.

## CRITICAL RULES

1. **Every solution MUST be a concrete, executable business action.** A solution is something a CEO or logistics director can decide to DO next week. It is NOT:
   - A market statistic or forecast number
   - A restatement of a factor's explanation
   - A generic "monitor the market" suggestion
   - A list of facts or trends

2. **Each solution MUST be derived from the DYNAMIC FACTORS provided.** The factors are the REASONS the market is changing. Your job is to translate each reason into a strategic response. Every solution must reference at least 2 related factor IDs from the supplied factors array.

3. **Each solution targets a DIFFERENT strategic aspect:**
   - **Operational resilience** — how to keep operations running despite disruptions (supply chains, infrastructure, regulatory)
   - **Cost optimization** — how to reduce procurement, logistics, or energy costs
   - **Strategic positioning** — how to gain competitive advantage or capture new opportunities

4. **Each solution MUST have exactly 5 specific, numbered actions.** Each action must be:
   - A concrete step (verb + object + measurable outcome)
   - Under 200 characters
   - Something a business can actually execute

5. **Cite sources.** When referencing a specific data point, include the source URL in the summary.

## FEW-SHOT EXAMPLE (learn the format)

Input factors:
- f1: "OPEC+ supply cuts" (category: DEMAND, direction: up, magnitude: High)
- f2: "Asian demand surge" (category: DEMAND, direction: up, magnitude: High)
- f3: "Brent crude at $95/bbl" (category: TRANSITION, direction: up, magnitude: Medium)

Output solutions:
{
  "solutions": [
    {
      "title": "Lock in Q4 fuel costs with forward contracts before OPEC+ cuts tighten supply",
      "summary": "With OPEC+ supply cuts (f1) and Asian demand surge (f2) pushing Brent toward $100 (f3), secure fixed-price fuel contracts covering 60-80% of Q4 volume now. Source: https://www.opec.org",
      "actions": [
        "Negotiate 6-month forward fuel contracts with primary suppliers",
        "Identify 2 secondary suppliers outside OPEC+ affected regions",
        "Set internal trigger: lock prices if Brent exceeds $98/bbl",
        "Hedge remaining exposure via ICE Brent futures",
        "Review contract quarterly against benchmark prices"
      ],
      "commodities": ["oil"],
      "regions": ["global", "asia"],
      "relatedFactors": ["f1", "f2", "f3"],
      "confidence": 85
    },
    {
      "title": "Shift energy-intensive operations to off-peak electricity windows",
      "summary": "Rising electricity demand in Asia (f2) and grid stress from EV adoption (f4) are widening peak/off-peak spreads. Reschedule production to off-peak hours and deploy on-site solar to cut demand charges.",
      "actions": [
        "Install smart energy management system with load shifting",
        "Negotiate time-of-use contracts with tiered peak pricing",
        "Deploy on-site solar arrays for daytime peak shaving",
        "Join regional demand response program for rebates",
        "Track hourly consumption vs. tariff bands weekly"
      ],
      "commodities": ["electricity"],
      "regions": ["asia"],
      "relatedFactors": ["f2", "f4"],
      "confidence": 78
    },
    {
      "title": "Diversify water sourcing with on-site recycling to hedge drought risk",
      "summary": "Water scarcity index rising in Asia (f5) and declining dam reservoir levels (f6) threaten operational continuity. Invest in on-site water recycling and negotiate long-term supply contracts with volume guarantees.",
      "actions": [
        "Conduct water audit to identify recycling opportunities",
        "Install on-site wastewater treatment and reuse system",
        "Negotiate 3-year water supply contract with volume discount",
        "Apply for government water efficiency incentives",
        "Monitor reservoir levels and adjust intake monthly"
      ],
      "commodities": ["water"],
      "regions": ["asia"],
      "relatedFactors": ["f5", "f6"],
      "confidence": 72
    }
  ]
}

## NOW, using the supplied factors, analytics, and evidence, generate exactly 3 solutions following the format above. Each solution must be a distinct, executable business strategy — not a market report summary.`;

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

function buildFallbackSolutions(
  scope: RegionId,
  analytics: Record<string, unknown>,
  factors: Factor[],
): Solution[] {
  const now = new Date().toISOString();
  const regionName = scope;

  // Extract the most relevant factor info per solution: each solution
  // targets one factor with specific content (explanation, direction, magnitude).
  // We use factor names, explanations, and properties to make solutions
  // referenceable to the displayed dynamic factors.
  const factorUuids = factors.map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    direction: f.direction,
    magnitude: f.magnitude,
    importanceScore: f.importanceScore,
    commodities: f.commodities,
    explanation: f.explanation,
  }));

  return [
    {
      id: `solution-fallback-${Date.now()}-0`,
      title:
        factorUuids[0]?.name === undefined
          ? "Lock in fuel costs via fixed-price hedging"
          : `Hedge ${factorUuids[0]?.name.toLowerCase()} exposure using fixed-price contracts`,
      summary:
        factorUuids[0]?.explanation ||
        `Based on ${regionName} market analytics (fuelLevy ${(analytics.fuelLevy as number) ?? 0 >= 0 ? "+" : ""}${analytics.fuelLevy as number ?? 0}, electricity index ${(analytics.electricityTariffAdjustmentIndex as number) ?? 0 >= 0 ? "+" : ""}${analytics.electricityTariffAdjustmentIndex as number ?? 0}), hedge exposure to ${factorUuids[0]?.direction === "up" ? "rising" : "volatile"} fuel costs using fixed-price contracts or financial swaps. Source from diversified suppliers to mitigate regional supply disruptions. Current analytics: ${analytics.dataSource ?? "benchmark data"}.`,
      actions: [
        "Secure fixed-price fuel contracts for 60-80% of Q4 2026 volume",
        "Establish secondary supplier agreements outside primary delivery corridors",
        "Monitor regional inventory levels weekly to adjust procurement timing",
        "Use futures or swaps to hedge remaining variable exposure",
        "Review hedge effectiveness monthly against factor direction change",
      ],
      commodities: factorUuids[0]?.commodities?.includes("oil")
        ? ["oil"]
        : ["oil"],
      regions: [scope],
      scope,
      relatedFactors: factors.length > 0 ? [factors[0].id] : [],
      confidence: 65,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `solution-fallback-${Date.now()}-1`,
      title:
        factorUuids[1]?.name === undefined
          ? "Reduce electricity demand during peak pricing windows"
          : `Reduce ${factorUuids[1]?.name.toLowerCase()} cost through demand response`,
      summary:
        factorUuids[1]?.explanation ||
        `Electricity tariff adjustment index is ${(analytics.electricityTariffAdjustmentIndex as number) ?? 0 >= 0 ? "+" : ""}${analytics.electricityTariffAdjustmentIndex as number ?? 0} for ${regionName}. ${factorUuids[1]?.direction === "up"
          ? "Shift energy-intensive operations to off-peak hours and invest in demand response."
          : "Lock in flexible contracts that track real-time pricing to benefit from low-demand periods."}`,
      actions: [
        "Install smart energy management systems to optimize load scheduling",
        "Negotiate time-of-use electricity contracts with tiered pricing",
        "Deploy on-site power generation (solar/diesel backup) for peak shaving",
        "Join regional demand response programs for additional revenue",
        "Track hourly consumption vs. tariff bands against factor magnitude",
      ],
      commodities: factorUuids[1]?.commodities?.includes("electricity")
        ? ["electricity"]
        : ["electricity"],
      regions: [scope],
      scope,
      relatedFactors: factors.length > 1 ? [factors[1].id] : [],
      confidence: 65,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `solution-fallback-${Date.now()}-2`,
      title:
        factorUuids[2]?.name === undefined
          ? "Secure alternative water sources before scarcity impacts operations"
          : `Implement water recycling to hedge ${factorUuids[2]?.name.toLowerCase()} risk`,
      summary:
        factorUuids[2]?.explanation ||
        `Water scarcity adjusted price index is ${(analytics.waterScarcityAdjustedPriceIndex as number) >= 0 ? "+" : ""}${analytics.waterScarcityAdjustedPriceIndex as number ?? 0} for ${regionName}. ${factorUuids[2]?.direction === "up"
          ? "Drought conditions and rising costs indicate need for immediate alternative sourcing."
          : "Modest water cost changes allow proactive investment in efficiency."} ${factorUuids[2]?.magnitude === "High"
          ? "Evaluate immediate alternative sourcing options"
          : ""}`,
      actions: [
        "Conduct water audit to identify recycling and efficiency opportunities",
        "Negotiate long-term water supply contracts with volume discounts",
        "Invest in on-site water treatment or rainwater harvesting systems",
        "Explore regulatory incentives for water conservation programs",
        "Track water scarcity index vs factor magnitude and adjust sourcing quarterly",
      ],
      commodities: factorUuids[2]?.commodities?.includes("water")
        ? ["water"]
        : ["water"],
      regions: [scope],
      scope,
      relatedFactors: factors.length > 2 ? [factors[2].id] : [],
      confidence: 65,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

interface EvidenceItem {
  title: string;
  url: string;
  snippet: string;
  text?: string;
  publishedAt?: string;
}

/**
 * Fetches fresh web evidence for a scope, examining source legitimacy (reputable
 * outlet + recent publish date) and scraping full article bodies so solutions
 * can be summarized from real text rather than one-line snippets.
 *
 * Returns [] on failure; callers then fall back to static solutions.
 */
async function fetchFreshEvidence(scope: RegionId, abortSignal: AbortSignal): Promise<EvidenceItem[]> {
  const evidenceCacheKey = `solutions:evidence:${scope}`;
  const cached = await getCache<EvidenceItem[]>(evidenceCacheKey, EVIDENCE_CACHE_MS);
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
    // Examine legitimacy: keep only reputable, recently-published sources.
    const candidates = searches
      .flatMap((r) => r.results)
      .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt))
      .slice(0, 15);

    // Scrape full article bodies so solutions can be summarized from real text.
    // Scraping failures degrade gracefully to the search snippet.
    const evidence = await Promise.all(
      candidates.map(async (r): Promise<EvidenceItem> => {
        const url = typeof r.url === "string" ? r.url : "";
        const item: EvidenceItem = {
          title: typeof r.title === "string" && r.title.trim() ? r.title.trim() : "",
          url,
          snippet: typeof r.snippet === "string" ? r.snippet.trim() : "",
          publishedAt: r.publishedAt,
        };
        if (url) {
          try {
            const scraped = await tinyfishRouter.tinyfishScrape(url, abortSignal);
            if (scraped) {
              item.text = scraped.text;
              if (!item.title && scraped.title) item.title = scraped.title;
            }
          } catch (scrapeError) {
            void scrapeError;
          }
        }
        return item;
      }),
    );

    const freshEvidence = evidence.filter((e) => e.title.length > 0 || e.snippet.length > 0);
    await setCache(evidenceCacheKey, freshEvidence, EVIDENCE_CACHE_MS);
    return freshEvidence;
  } catch (error) {
    console.error("TinyFish evidence fetch failed:", error);
    return [];
  }
}

/**
 * Generates a strategic, action-oriented title from evidence content.
 * Transforms market report headlines into business strategy titles.
 */
function generateEvidenceStrategyTitle(
  commodity: CommodityId | undefined,
  summary: string,
  url: string
): string {
  const host = safeHost(url);
  const hostUpper = host.toUpperCase();

  // Action-oriented titles based on commodity and evidence content
  const actionTitles: Record<CommodityId, string[]> = {
    oil: [
      `Secure fuel supply against ${hostUpper} supply disruption signals`,
      `Lock in fuel hedging before price escalation from ${hostUpper}`,
      `Diversify crude sourcing in response to ${hostUpper} market shifts`,
      `Optimize fuel procurement timing using ${hostUpper} signals`,
      `Hedge exposure to ${hostUpper} crude supply volatility`,
    ],
    electricity: [
      `Deploy demand response to offset ${hostUpper} peak pricing`,
      `Shift load scheduling using ${hostUpper} grid signal data`,
      `Secure flexible PPAs before ${hostUpper} capacity constraints`,
      `Invest in on-site generation to hedge ${hostUpper} outage risk`,
      `Negotiate time-of-use contracts from ${hostUpper} tariff data`,
    ],
    water: [
      `Implement water recycling to counter ${hostUpper} scarcity risk`,
      `Secure long-term water rights using ${hostUpper} allocation data`,
      `Diversify water sourcing against ${hostUpper} drought signals`,
      `Optimize water efficiency based on ${hostUpper} cost trends`,
      `Invest in on-site treatment to reduce ${hostUpper} supply risk`,
    ],
  };

  if (commodity && actionTitles[commodity]) {
    const titles = actionTitles[commodity];
    // Pick title based on summary content for variety
    const hash = summary.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
    return titles[hash % titles.length].slice(0, 120);
  }

  // Fallback: create from summary
  const words = summary.split(" ").slice(0, 8).join(" ");
  return `Strategic response to ${commodity || "market"} signals: ${words}`.slice(0, 120);
}

/**
 * Generates strategic, executable actions from evidence (not just "track/monitor").
 * Each action is a concrete business step with measurable outcome.
 */
function generateEvidenceStrategicActions(
  primaryCommodity: CommodityId | undefined,
  matchedCommodities: CommodityId[]
): string[] {
  const actionsByCommodity: Record<CommodityId, string[]> = {
    oil: [
      "Negotiate 6-12 month fixed-price fuel contracts with primary suppliers",
      "Qualify 2 secondary suppliers outside affected delivery corridors",
      "Set internal price trigger: hedge 80% volume if benchmark exceeds $X",
      "Purchase ICE Brent futures or swaps for remaining variable exposure",
      "Review contract terms quarterly against OPEC+/inventory benchmarks",
    ],
    electricity: [
      "Install smart energy management with automated load shifting",
      "Execute time-of-use electricity contracts with tiered peak pricing",
      "Deploy on-site solar + storage for peak demand shaving",
      "Enroll in regional demand response programs for capacity payments",
      "Track hourly consumption vs tariff bands; optimize weekly",
    ],
    water: [
      "Conduct water audit to identify top 3 recycling opportunities",
      "Negotiate 3-year supply contracts with volume discount clauses",
      "Install on-site wastewater treatment for process water reuse",
      "Apply for government water efficiency incentive programs",
      "Monitor reservoir levels monthly; trigger contingency at 30% capacity",
    ],
  };

  if (primaryCommodity && actionsByCommodity[primaryCommodity]) {
    return actionsByCommodity[primaryCommodity].slice(0, 5);
  }

  // Generic strategic actions (better than "track/monitor")
  return [
    `Secure supply agreements with 2+ diversified ${matchedCommodities.join("/")} providers`,
    `Implement real-time price monitoring with automated hedge triggers`,
    `Diversify sourcing across ${matchedCommodities.length > 1 ? "multiple" : "alternative"} regions`,
    `Optimize inventory buffers to absorb ${matchedCommodities[0] || "commodity"} volatility`,
    `Review and renegotiate contracts with volume-flexibility clauses quarterly`,
  ];
}

/**
 * Generates solutions from fresh web evidence when Kilo Gateway AI is
 * unavailable. Each solution is derived from a search result excerpt,
 * extracting the most relevant commodity and creating actionable guidance.
 *
 * This ensures the system uses live web data from TinyFish API keys or
 * Playwright MCP even when the AI model is down.
 */
function buildEvidenceSolutions(
  scope: RegionId,
  analytics: Record<string, unknown>,
  factors: Factor[],
  evidence: unknown[],
): Solution[] {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return buildFallbackSolutions(scope, analytics, factors);
  }

  const now = new Date().toISOString();
  const solutions: Solution[] = [];

  // Take up to MAX_SOLUTIONS most relevant evidence items
  for (let i = 0; i < Math.min(MAX_SOLUTIONS, evidence.length); i++) {
    const item = evidence[i] as EvidenceItem | Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") continue;

    const ev = item as EvidenceItem;
    const rawTitle = typeof ev.title === "string" ? ev.title.trim() : "";
    const rawSnippet = typeof ev.snippet === "string" ? ev.snippet.trim() : "";
    const rawText = typeof ev.text === "string" ? ev.text : "";
    const url = typeof ev.url === "string" ? ev.url : "";

    // Determine which commodities this evidence relates to
    const combinedText = `${rawTitle} ${rawSnippet} ${rawText}`.toLowerCase();
    const matchedCommodities: CommodityId[] = [];
    for (const [commodity, pattern] of Object.entries(COMMODITY_PATTERNS)) {
      if (pattern.test(combinedText)) matchedCommodities.push(commodity as CommodityId);
    }
    if (matchedCommodities.length === 0) matchedCommodities.push("oil", "electricity", "water");

    const primaryCommodity = matchedCommodities[0];
    const primaryPattern = primaryCommodity ? COMMODITY_PATTERNS[primaryCommodity] : undefined;
    const host = safeHost(url);
    const summary = summarizeEvidenceSentence(rawText, rawSnippet, primaryPattern);
    const confidence = Math.min(85, 60 + matchedCommodities.length * 10 + summary.length / 20);

    // Generate more strategic, actionable titles and actions based on the evidence
    // Instead of "OIL insight: [news headline]" which looks like market reports,
    // create business-impacting strategic insights
    const strategicTitle = generateEvidenceStrategyTitle(primaryCommodity, summary, url);
    const strategicActions = generateEvidenceStrategicActions(primaryCommodity, matchedCommodities);

    solutions.push({
      id: `evidence-solution-${Date.now()}-${i}`,
      title: strategicTitle,
      summary: `${summary} — Evidence: ${host}.`,
      actions: strategicActions,
      commodities: matchedCommodities,
      regions: scope === "global" ? ["global"] : [scope],
      scope,
      relatedFactors: factors.slice(i * 2, i * 2 + 4).map((f) => f.id),
      confidence: Math.round(Math.max(30, Math.min(85, confidence))),
      createdAt: now,
      updatedAt: now,
    });
  }

  // If we couldn't generate from evidence, fall back to static solutions
  if (solutions.length === 0) {
    return buildFallbackSolutions(scope, analytics, factors);
  }

  return solutions;
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

    // Ensure the Kilo Gateway router has been initialized (probed keys and models)
    // before checking availability. On a cold start without this call,
    // isInferAvailable would see an empty keyStates array and always return
    // false — meaning AI inference is never attempted even when valid keys
    // are configured.
    try {
      await kiloRouter.initKiloRouter(abortController.signal);
    } catch (initError) {
      console.warn("Kilo Gateway router init failed; proceeding with availability check:", initError);
    }

    // If Kilo Gateway AI is not available, use evidence-based fallback
    // solutions from the freshly fetched web data instead of static fallbacks.
    const kiloAvailable = kiloRouter.isInferAvailable(false);
    
    let aiSolutions: Solution[] = [];
    if (kiloAvailable) {
      try {
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

        const response = await kiloRouter.kiloInfer(payload, abortController.signal);
        const content = response.choices?.[0]?.message?.content ?? "";
        const parsed = safeParseJson<{ solutions?: unknown[] }>(content);
        // Tolerant: a short but valid AI response is kept and backfilled below.
        aiSolutions = (Array.isArray(parsed?.solutions) ? parsed.solutions : [])
          .map((s: unknown) => buildSolution(s, scope, VALID_REGIONS))
          .filter((s): s is Solution => s !== null)
          .slice(0, MAX_SOLUTIONS);
      } catch (error) {
        console.error("Kilo inference failed, falling back to evidence-based solutions:", error);
      }
    } else {
      console.warn("Kilo Gateway AI unavailable; using evidence-based solutions from web data");
    }

    const aiCurated = aiSolutions.length > 0;
    
    // When AI is not available, generate evidence-based solutions from web data
    // instead of using static fallbacks. This ensures live TinyFish/Playwright MCP
    // evidence is always utilized.
    if (!aiCurated && freshEvidence.length > 0) {
      const evidenceSolutions = buildEvidenceSolutions(scope, analytics, factors, freshEvidence);
      const combined = [...aiSolutions, ...evidenceSolutions].slice(0, MAX_SOLUTIONS);
      // These solutions are derived from live web evidence, NOT AI inference
      // (Kilo Gateway AI was unavailable), so they are NOT ai-curated.
      const allSolutions = combined;
      
      await setCache(cacheKey, { solutions: allSolutions, aiCurated: false } satisfies CachedSolutions, SOLUTIONS_CACHE_MS);

      return Response.json(
        {
          solutions: allSolutions,
          scope,
          count: allSolutions.length,
          aiCurated: false,
          cacheKey,
          updatedAt: new Date().toISOString(),
        },
        { status: 200 },
      );
    }

    // AI solutions available, or no evidence-based fallback possible
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
