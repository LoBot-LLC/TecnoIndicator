import { useMemo } from "react";
import { ArrowUpRight, Info, Shield, Truck, Zap } from "lucide-react";
import Reveal from "./Reveal";
import { describeReason, isAiFactor, type PayloadMeta } from "../lib/aiStatus";
import type { Factor, RegionId, Solution } from "../lib/model";

const MAX_SOLUTIONS = 3;

const STRATEGY_ICONS: Record<string, typeof Shield> = {
  resilience: Shield,
  cost: Truck,
  strategy: Zap,
};

/**
 * Where a displayed card's content came from. `"ai"` is model output; `"reference"`
 * is either a deterministic server template or the hand-authored set below, and
 * is never presented as model output.
 */
type CardOrigin = "ai" | "reference";

interface StrategyCard {
  solution: Solution;
  origin: CardOrigin;
}

/**
 * Client-authored strategies, used when the API returns nothing. These are
 * written here rather than borrowed from a factor explanation so the section
 * stays populated with honest content instead of leaking the server's static
 * fallback prose into the solutions UI.
 */
const REFERENCE_STRATEGIES: Array<
  Omit<Solution, "id" | "createdAt" | "updatedAt" | "scope" | "regions" | "relatedFactors">
> = [
  {
    title: "Hedge near-term fuel exposure",
    summary:
      "Lock in a share of the next two quarters' fuel volume with fixed-price contracts or swaps, and diversify suppliers outside the primary delivery corridor. This is a standing playbook item, not a market call — it bounds the cost of an adverse move in crude and refined products.",
    actions: [
      "Cover 60-80% of near-term fuel volume with fixed-price contracts or swaps",
      "Qualify at least one secondary supplier outside the primary corridor",
      "Reassess the covered share whenever the forward curve moves more than 10%",
    ],
    commodities: ["oil"],
    confidence: 65,
  },
  {
    title: "Shift flexible load to cheaper hours",
    summary:
      "Power costs are dominated by a small number of peak hours. Move schedulable load — pumping, storage charging, batch processing — into cheaper windows, and pair it with a demand-response contract so the avoided consumption is paid for rather than simply curtailed.",
    actions: [
      "Install metering and scheduling for the top energy-intensive loads",
      "Negotiate time-of-use tariffs with demand-response settlement",
      "Set peak-shaving targets and review them monthly against realised bills",
    ],
    commodities: ["electricity"],
    confidence: 65,
  },
  {
    title: "Reduce water intensity before tariffs move",
    summary:
      "Water tariffs track scarcity, and scarcity moves slowly enough to act on. Baseline consumption by site, then fund recycling, reuse and metering where the payback is shortest, so a dry-year tariff step-up is absorbed rather than passed straight through.",
    actions: [
      "Run a per-site water audit and rank the highest-return reduction measures",
      "Invest in recycling, rainwater capture and leak detection at the top sites",
      "Track cost per unit of output so intensity improvements stay visible",
    ],
    commodities: ["water"],
    confidence: 65,
  },
];

/** Deterministic server templates are recognisable by their id prefix. */
function isServerTemplate(solution: Solution): boolean {
  return solution.id.startsWith("solution-fallback-");
}

function referenceStrategy(index: number, scope: RegionId, now: string): Solution {
  const base = REFERENCE_STRATEGIES[index];
  return {
    ...base,
    id: `solution-reference-${scope}-${index}`,
    regions: [scope],
    scope,
    relatedFactors: [],
    createdAt: now,
    updatedAt: now,
  };
}

function StrategyIcon({ strategy }: { strategy: string }) {
  const Icon = STRATEGY_ICONS[strategy] ?? Shield;
  return <Icon className="h-4 w-4" />;
}

function SolutionCard({
  card,
  index,
}: {
  card: StrategyCard;
  index: number;
}) {
  const { solution, origin } = card;
  const strategy = index === 0 ? "resilience" : index === 1 ? "cost" : "strategy";
  const isAi = origin === "ai";

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/60 p-5 transition-all duration-300 hover:border-teal-400/40 hover:bg-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-base/50 text-teal-300">
            <StrategyIcon strategy={strategy} />
          </span>
          <span className="rounded-full border border-line bg-base/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {strategy}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              isAi
                ? "border-teal-400/30 bg-teal-400/10 text-teal-300"
                : "border-line bg-base/40 text-slate-500"
            }`}
            title={
              isAi
                ? "Generated by the AI model"
                : "Deterministic template — not generated by the AI model"
            }
          >
            {isAi ? "AI" : "Reference"}
          </span>
        </div>
        <span
          className={`font-display text-xs font-bold ${isAi ? "text-teal-300" : "text-slate-500"}`}
        >
          {solution.confidence}% confidence
        </span>
      </div>
      <h3 className="mt-3 font-display text-base font-semibold text-white">
        {solution.title}
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-400 line-clamp-3">
        {solution.summary}
      </p>
      <div className="mt-3 space-y-1.5">
        {solution.actions.map((action, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
            <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-teal-300" />
            <span>{action}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {solution.commodities.map((c) => (
          <span
            key={c}
            className="rounded-full border border-line bg-base/50 px-1.5 py-0.5 text-[9px] font-semibold capitalize text-slate-500"
          >
            {c}
          </span>
        ))}
      </div>
      {solution.relatedFactors.length > 0 && (
        <div className="mt-3 border-t border-line/50 pt-2">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">
            Linked factors
          </p>
          <p className="mt-1 text-[10px] text-slate-500 line-clamp-2">
            {solution.relatedFactors.join(", ")}
          </p>
        </div>
      )}
    </article>
  );
}

interface SolutionsSectionProps {
  /** Reasons for the active scope — used to link strategies to their reasons. */
  fallbackFactors: Factor[];
  healthStatus: "Initializing AI" | "Online Model Connected" | "Offline Model";
  /** Solutions returned by /api/solutions for the active scope. */
  solutions: Solution[];
  /** Honesty fields from the same /api/solutions body. */
  meta?: PayloadMeta;
}

export default function SolutionsSection({
  fallbackFactors,
  healthStatus,
  solutions,
  meta,
}: SolutionsSectionProps) {
  const scope: RegionId = solutions[0]?.scope ?? fallbackFactors[0]?.scope ?? "global";
  const aiCount = meta?.aiCount ?? 0;
  const allAi = meta?.aiCurated === true && meta?.degraded === false;
  const degraded = meta?.degraded === true;

  const cards = useMemo<StrategyCard[]>(() => {
    const now = new Date().toISOString();
    const served: StrategyCard[] =
      solutions.length > 0
        ? // The API pads its list as [...aiSolutions, ...deterministic], so both
          // the count and the id say which cards are model output.
          solutions.slice(0, MAX_SOLUTIONS).map((solution, i) => ({
            solution,
            origin: !isServerTemplate(solution) && i < aiCount ? ("ai" as const) : ("reference" as const),
          }))
        : // Nothing from the API: derive from AI-curated factors only. Static
          // factor explanations are never reused as solution copy.
          fallbackFactors
            .filter(isAiFactor)
            .slice(0, MAX_SOLUTIONS)
            .map((f) => ({
              origin: "ai" as const,
              solution: {
                id: `solution-${f.id}`,
                title: f.name,
                summary: f.explanation,
                actions: [
                  `Monitor ${f.name} impact on supply chain costs`,
                  `Evaluate the ${f.direction} trend across ${f.commodities.join(", ")} markets`,
                ],
                commodities: f.commodities,
                regions: [f.scope],
                scope: f.scope,
                relatedFactors: [f.id],
                confidence: f.importanceScore,
                createdAt: f.createdAt,
                updatedAt: f.updatedAt,
              },
            }));

    // The section always shows three strategies; any shortfall is filled with
    // the client's own authored content rather than invented AI output.
    const filled = [...served];
    for (let i = filled.length; i < MAX_SOLUTIONS; i += 1) {
      filled.push({ origin: "reference", solution: referenceStrategy(i, scope, now) });
    }
    return filled;
  }, [solutions, fallbackFactors, aiCount, scope]);

  const statusLabel = allAi
    ? "AI-generated"
    : aiCount > 0
      ? `AI-generated (${aiCount} of ${MAX_SOLUTIONS})`
      : "Reference strategies";

  return (
    <section id="solutions" className="relative scroll-mt-20 border-t border-line py-16 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 mask-fade-y" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-300/80">
                AI solutions
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
                3 actionable strategies
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
                {allAi
                  ? "AI-generated solutions adapted from current dynamic reasons to help business owners and executives make better logistical and business decisions. Solutions update automatically as market factors change."
                  : "Three strategies adapted from current dynamic reasons to help business owners and executives make better logistical and business decisions. The cards marked \"Reference\" are fixed playbooks, not AI output."}
              </p>
              {degraded && (
                <p
                  className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-200/90"
                  title={meta?.error}
                >
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <span>
                    Partly AI-generated: {describeReason(meta?.reason)}
                    {meta?.servedFrom ? ` · served from ${meta.servedFrom}` : ""}
                    {healthStatus === "Online Model Connected" ? "" : " · gateway offline"}.
                  </span>
                </p>
              )}
            </div>
            <span className="text-[11px] text-slate-600">{statusLabel}</span>
          </div>
        </Reveal>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.slice(0, MAX_SOLUTIONS).map((card, i) => (
            <Reveal key={card.solution.id} delay={60 + i * 80}>
              <SolutionCard card={card} index={i} />
            </Reveal>
          ))}
          {cards.length === 0 && (
            <div className="col-span-full rounded-2xl border border-line bg-panel/60 p-8 text-center text-sm text-slate-500">
              No solutions available yet. AI curation in progress.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
