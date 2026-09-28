import { useMemo } from "react";
import { ArrowUpRight, Shield, Truck, Zap } from "lucide-react";
import Reveal from "./Reveal";
import type { Factor, Solution } from "../lib/model";

const MAX_SOLUTIONS = 3;

const STRATEGY_ICONS: Record<string, typeof Shield> = {
  resilience: Shield,
  cost: Truck,
  strategy: Zap,
};

function StrategyIcon({ strategy }: { strategy: string }) {
  const Icon = STRATEGY_ICONS[strategy] ?? Shield;
  return <Icon className="h-4 w-4" />;
}

function SolutionCard({
  solution,
  index,
}: {
  solution: Solution;
  index: number;
}) {
  const strategy = index === 0 ? "resilience" : index === 1 ? "cost" : "strategy";

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
        </div>
        <span className="font-display text-xs font-bold text-teal-300">
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
  /** Reasons for the active scope — used to derive strategies when the API has none. */
  fallbackFactors: Factor[];
  healthStatus: "Initializing AI" | "Online Model Connected" | "Offline Model";
  /** Solutions returned by /api/solutions for the active scope. */
  solutions: Solution[];
}

export default function SolutionsSection({
  fallbackFactors,
  healthStatus,
  solutions,
}: SolutionsSectionProps) {
  const allSolutions = useMemo(() => {
    if (solutions.length > 0) return solutions;
    return fallbackFactors.slice(0, MAX_SOLUTIONS).map((f) => ({
      id: `solution-${f.id}`,
      title: f.name,
      summary: f.explanation,
      actions: [`Monitor ${f.name} impact on supply chain costs`, `Evaluate ${f.direction} trend for ${f.commodities.join(", ")} markets`],
      commodities: f.commodities,
      relatedFactors: [f.id],
      confidence: f.importanceScore,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      scope: f.scope,
    }));
  }, [solutions, fallbackFactors]);

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
                AI-generated solutions adapted from current dynamic reasons to help
                business owners and executives make better logistical and business
                decisions. Solutions update automatically as market factors change.
              </p>
            </div>
            <span className="text-[11px] text-slate-600">
              {healthStatus === "Online Model Connected"
                ? "AI-generated"
                : "Static fallback"}
            </span>
          </div>
        </Reveal>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {allSolutions.slice(0, MAX_SOLUTIONS).map((solution, i) => (
            <Reveal key={solution.id} delay={60 + i * 80}>
              <SolutionCard solution={solution} index={i} />
            </Reveal>
          ))}
          {allSolutions.length === 0 && (
            <div className="col-span-full rounded-2xl border border-line bg-panel/60 p-8 text-center text-sm text-slate-500">
              No solutions available yet. AI curation in progress.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
