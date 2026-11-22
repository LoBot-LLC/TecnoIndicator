import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Shield, Truck, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import Reveal from "./Reveal";
import { useLanguage } from "../context/LanguageContext";
import type { Factor, Solution } from "../lib/model";
import { fetchTranslatedExplanations } from "../lib/translateFactors";

const MAX_SOLUTIONS = 3;

const EMPTY_TRANSLATIONS = new Map<string, string>();

function useTranslatedExplanations(factors: Factor[]): Map<string, string> {
  const { language } = useLanguage();
  const key = `${language}\u0003` + factors.map((f) => `${f.id}\u0001${f.explanation}`).join("\u0002");
  const [result, setResult] = useState<{ key: string; map: Map<string, string> } | null>(null);

  useEffect(() => {
    if (language === "en" || factors.length === 0) return;
    let cancelled = false;
    const items = factors.map((f) => ({ id: f.id, explanation: f.explanation, commodities: f.commodities }));
    fetchTranslatedExplanations(items, language).then((map) => {
      if (!cancelled) setResult({ key, map });
    });
    return () => {
      cancelled = true;
    };
    // `key` encodes the factor ids, explanations and language that `factors` derives from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (language === "en" || !result || result.key !== key) return EMPTY_TRANSLATIONS;
  return result.map;
}

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
  const { t } = useTranslation("solutions");
  const strategy = index === 0 ? "resilience" : index === 1 ? "cost" : "strategy";

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/60 p-5 transition-all duration-300 hover:border-teal-400/40 hover:bg-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-base/50 text-teal-400 dark:text-teal-300">
            <StrategyIcon strategy={strategy} />
          </span>
          <span className="rounded-full border border-line bg-base/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">
            {t(`strategy.${strategy}`)}
          </span>
        </div>
        <span className="font-display text-xs font-bold text-teal-400 dark:text-teal-300">
          {t("confidence", { value: solution.confidence })}
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
            {t("aiBadge")}
          </p>
        </div>
      )}
      {solution.sources && solution.sources.length > 0 && (
        <div className="mt-3 border-t border-teal-200/30 pt-2 bg-teal-50 dark:bg-teal-800/30">
          <p className="text-[8px] font-semibold text-teal-400 dark:text-teal-300">
            {t("sources", { list: solution.sources.slice(0, 3).map((s, i) => `${i + 1}. ${s.slice(0, 40)}...`).join(" ") })}
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
            {t("linkedFactors")}
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
  const { t } = useTranslation("solutions");

  // Select the 3 most strategically relevant factors as fallback solutions
  // (only when the API returned none).
  const strategicFactors = useMemo(() => {
    if (solutions.length > 0 || fallbackFactors.length === 0) return [];
    return [...fallbackFactors]
      .sort((a, b) => {
        // Prioritize by importance score and strategic relevance
        const aScore = a.importanceScore * (a.magnitude === "High" ? 1.2 : 1.0);
        const bScore = b.importanceScore * (b.magnitude === "High" ? 1.2 : 1.0);
        return bScore - aScore;
      })
      .slice(0, MAX_SOLUTIONS);
  }, [solutions, fallbackFactors]);

  const translations = useTranslatedExplanations(strategicFactors);

  const allSolutions = useMemo(() => {
    if (solutions.length > 0) return solutions;

    // If no AI solutions are available, create intelligent fallback solutions
    // that are more meaningful than just mapping factors directly
    return strategicFactors.map((factor, index) => {
      const name = factor.name.toLowerCase();
      const highMagnitude = factor.magnitude === "High";
      // Generate different strategic focus based on the factor
      let strategyTitle: string;
      let strategyActions: string[];

      if (index === 0) {
        // Strategic focus: Operational resilience
        strategyTitle = factor.direction === "up"
          ? t("fallback.secureSupply", { factor: name })
          : t("fallback.optimizeEfficiency", { factor: name });
        strategyActions = [
          t("fallback.diversify", { commodity: factor.commodities[0] }),
          t("fallback.inventory", { days: highMagnitude ? t("fallback.days.high") : t("fallback.days.low") }),
          t("fallback.monitorWeekly", { factor: name }),
          t("fallback.negotiate", { term: highMagnitude ? t("fallback.terms.high") : t("fallback.terms.low") }),
        ];
      } else if (index === 1) {
        // Strategic focus: Cost optimization
        const commodities = factor.commodities.join(", ");
        strategyTitle = factor.direction === "down"
          ? t("fallback.captureSavings", { factor: name })
          : t("fallback.manageCosts", { factor: name });
        strategyActions = [
          t("fallback.demand", {
            mode: factor.direction === "down" ? t("fallback.modes.down") : t("fallback.modes.up"),
            commodities,
          }),
          t("fallback.altSources", { commodities }),
          t("fallback.trackPricing", { factor: name }),
          t("fallback.utilize", { method: highMagnitude ? t("fallback.methods.high") : t("fallback.methods.low") }),
        ];
      } else {
        // Strategic focus: Long-term positioning
        const commodities = factor.commodities.join(", ");
        strategyTitle = t("fallback.longTerm", { factor: name });
        strategyActions = [
          t("fallback.efficiencyTech", { commodities }),
          t("fallback.regulatory", { factor: name }),
          t("fallback.scenarios", { bias: factor.bias || "mid", factor: name }),
          t("fallback.stakeholders", { category: factor.category.toLowerCase() }),
        ];
      }

      // Extract a concise, impactful explanation
      const explanation = translations.get(factor.id) ?? factor.explanation;
      const conciseExplanation = explanation.length > 200
        ? `${explanation.slice(0, 200)}...`
        : explanation;

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
  }, [solutions, strategicFactors, translations, t]);

  return (
    <section id="solutions" className="relative scroll-mt-20 border-t border-line py-16 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 mask-fade-y" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
<Reveal>
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-400 dark:text-teal-300/80">
                {t("eyebrow")}
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
                {t("title")}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-500">
                {t("description")}
              </p>
            </div>
            <span className="text-[11px] text-slate-600 dark:text-slate-500">
              {healthStatus === "Online Model Connected"
                ? t("statusAi")
                : t("statusFallback")}
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
              {t("empty")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
