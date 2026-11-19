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
      {solution.aiCurated && (
        <div className="mt-3 border-t border-teal-200/30 pt-2 bg-teal-50 dark:bg-teal-800/30">
          <p className="text-[8px] font-semibold text-teal-400 dark:text-teal-300">
            AI-generated from live factor window + TinyFish evidence
          </p>
        </div>
      )}
      {solution.sources && solution.sources.length > 0 && (
        <div className="mt-3 border-t border-teal-200/30 pt-2 bg-teal-50 dark:bg-teal-800/30">
          <p className="text-[8px] font-semibold text-teal-400 dark:text-teal-300">
            Sources: {solution.sources.slice(0, 3).map((s, i) => `${i + 1}. ${s.slice(0, 40)}...`).join(" ")}
          </p>
        </div>
      )}
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
    
    // If no AI solutions are available, create intelligent fallback solutions
    // that are more meaningful than just mapping factors directly
    if (fallbackFactors.length === 0) return [];
    
    // Select the 3 most strategically relevant factors as fallback solutions
    const strategicFactors = [...fallbackFactors]
      .sort((a, b) => {
        // Prioritize by importance score and strategic relevance
        const aScore = a.importanceScore * (a.magnitude === "High" ? 1.2 : 1.0);
        const bScore = b.importanceScore * (b.magnitude === "High" ? 1.2 : 1.0);
        return bScore - aScore;
      })
      .slice(0, MAX_SOLUTIONS);
    
    return strategicFactors.map((factor, index) => {
      // Generate different strategic focus based on the factor
      let strategyTitle: string;
      let strategyActions: string[];
      
      if (index === 0) {
        // Strategic focus: Operational resilience
        strategyTitle = factor.direction === "up" 
          ? `Secure supply against ${factor.name.toLowerCase()}` 
          : `Optimize efficiency for ${factor.name.toLowerCase()}`;
        strategyActions = [
          `Diversify ${factor.commodities[0]} sources to mitigate supply risk`,
          `Build ${factor.magnitude === "High" ? "30-60 days" : "15-30 days"} inventory buffers`,
          `Monitor ${factor.name.toLowerCase()} trends weekly`,
          `Negotiate flexible contracts with ${factor.magnitude === "High" ? "price protection" : "tiered pricing"}`,
        ];
      } else if (index === 1) {
        // Strategic focus: Cost optimization
        strategyTitle = factor.direction === "down"
          ? `Capture savings through ${factor.name.toLowerCase()}`
          : `Manage ${factor.name.toLowerCase()} costs strategically`;
        strategyActions = [
          `Implement demand ${factor.direction === "down" ? "shifting" : "optimization"} for ${factor.commodities.join(", ")}`,
          `Explore alternative sources for ${factor.commodities.join(", ")}`,
          `Track ${factor.name.toLowerCase()} pricing and adjust purchasing accordingly`,
          `Utilize ${factor.magnitude === "High" ? "financial hedging" : "spot market timing"}`,
        ];
      } else {
        // Strategic focus: Long-term positioning
        strategyTitle = `Position for long-term ${factor.name.toLowerCase()} trends`;
        strategyActions = [
          `Invest in ${factor.commodities.join(", ")} efficiency technologies`,
          `Monitor regulatory changes affecting ${factor.name.toLowerCase()}`,
          `Develop scenario plans for ${factor.bias || "mid"}-term ${factor.name.toLowerCase()} outlook`,
          `Engage with ${factor.category.toLowerCase()} stakeholders for early insights`,
        ];
      }
      
      // Extract a concise, impactful explanation
      const conciseExplanation = factor.explanation.length > 200
        ? `${factor.explanation.slice(0, 200)}...`
        : factor.explanation;
      
      return {
        id: `solution-fallback-${factor.id}-${index}`, // Better ID
        title: strategyTitle,
        summary: conciseExplanation,
        actions: strategyActions,
        commodities: factor.commodities,
        relatedFactors: [factor.id],
        confidence: Math.min(85, factor.importanceScore + (index * 5)),
        createdAt: factor.createdAt,
        updatedAt: factor.updatedAt,
        scope: factor.scope,
      };
    });
  }, [solutions, fallbackFactors]);

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
                AI-generated solutions adapted from current dynamic reasons to help
                business owners and executives make better logistical and business
                decisions. Solutions update automatically as market factors change.
              </p>
            </div>
            <span className="text-[11px] text-slate-600 dark:text-slate-500">
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
            <div className="col-span-full rounded-2xl border border-line bg-panel/60 p-8 text-center text-sm text-slate-700 dark:text-slate-500">
              No solutions available yet. AI curation in progress.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
