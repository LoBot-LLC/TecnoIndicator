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

function factorName(id: string, factors: Factor[]): string {
  const found = factors.find((f) => f.id === id);
  return found ? found.name : id;
}

function SolutionCard({
  solution,
  index,
  fallbackFactors,
}: {
  solution: Solution;
  index: number;
  fallbackFactors: Factor[];
}) {
  const strategy = index === 0 ? "resilience" : index === 1 ? "cost" : "strategy";

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/60 p-5 transition-all duration-300 hover:border-teal-400/40 hover:bg-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-base/50 text-teal-400 dark:text-teal-300">
            <StrategyIcon strategy={strategy} />
          </span>
          <span className="rounded-full border border-line bg-base/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">
            {strategy}
          </span>
        </div>
        <span className="font-display text-xs font-bold text-teal-400 dark:text-teal-300">
          {solution.confidence}% confidence
        </span>
      </div>
      <h3 className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-white">
        {solution.title}
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-500 line-clamp-3">
        {solution.summary}
      </p>
      <div className="mt-3 space-y-1.5">
        {solution.actions.map((action, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-500">
            <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-teal-400 dark:text-teal-300" />
            <span>{action}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {solution.commodities.map((c) => (
          <span
            key={c}
            className="rounded-full border border-line bg-base/50 px-1.5 py-0.5 text-[9px] font-semibold capitalize text-slate-700 dark:text-slate-500"
          >
            {c}
          </span>
        ))}
      </div>
      {solution.relatedFactors.length > 0 && (
        <div className="mt-3 border-t border-line/50 pt-2">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
            Linked factors
          </p>
          <p className="mt-1 text-[10px] text-slate-700 dark:text-slate-500 line-clamp-2">
            {solution.relatedFactors.map((id) => factorName(id, fallbackFactors)).join(", ")}
          </p>
        </div>
      )}
    </article>
  );
}

interface SolutionsSectionProps {
  /** Factors for the active scope — used to look up human-readable factor names for linked factors. */
  fallbackFactors: Factor[];
  /** Solutions returned by /api/solutions for the active scope. */
  solutions: Solution[];
  /** Whether the API curated these solutions with AI (vs. a reason-derived, non-AI path). */
  aiCurated: boolean;
}

export default function SolutionsSection({
  fallbackFactors,
  solutions,
  aiCurated,
}: SolutionsSectionProps) {
  return (
    <section id="solutions" className="relative scroll-mt-20 border-t border-line py-16 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 mask-fade-y" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
<Reveal>
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-400 dark:text-teal-300/80">
                AI solutions
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
                3 actionable strategies
              </h2>
               <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-500">
                 AI-curated solutions derived from analyzed dynamic reasons to help
                 business owners and executives make better logistical and business
                 decisions. Solutions update automatically as market factors change.
               </p>
            </div>
             <span className="text-[11px] text-slate-600 dark:text-slate-500">
               {aiCurated ? "AI-generated" : "Reason-derived"}
             </span>
          </div>
        </Reveal>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {solutions.slice(0, MAX_SOLUTIONS).map((solution, i) => (
            <Reveal key={solution.id} delay={60 + i * 80}>
              <SolutionCard solution={solution} index={i} fallbackFactors={fallbackFactors} />
            </Reveal>
          ))}
          {solutions.length === 0 && (
            <div className="col-span-full rounded-2xl border border-line bg-panel/60 p-8 text-center text-sm text-slate-700 dark:text-slate-500">
              No solutions available.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
