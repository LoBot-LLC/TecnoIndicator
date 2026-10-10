import { useMemo } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  GitBranch,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Reveal from "./Reveal";
import {
  COMMODITIES,
  FACTORS,
  factorRelevance,
  relevanceTrend,
  type Direction,
  type Factor,
  type Magnitude,
} from "../lib/model";

const MAG_COLOR: Record<Magnitude, string> = {
  High: "text-rose-300 dark:text-rose-400 border-rose-400/30 dark:border-rose-400/40 bg-rose-400/10 dark:bg-rose-400/15",
  Medium: "text-amber-300 dark:text-amber-400 border-amber-400/30 dark:border-amber-400/40 bg-amber-400/10 dark:bg-amber-400/15",
  Low: "text-slate-600 dark:text-slate-300 border-line bg-panel/5",
};

function isNewFactor(createdAt: string): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  return diffMs <= 10 * 60 * 1000;
}

function DirectionIcon({ direction }: { direction: Direction }) {
  if (direction === "up") return <ArrowUpRight className="h-3.5 w-3.5 text-rose-300" />;
  if (direction === "down") return <ArrowDownRight className="h-3.5 w-3.5 text-emerald-300" />;
  return <Minus className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />;
}

function FactorCard({
  factor,
  horizon,
  index,
}: {
  factor: Factor;
  horizon: number;
  index: number;
}) {
  const relevance = factorRelevance(factor.bias, horizon);
  const trend = relevanceTrend(factor.bias, horizon);
  const width = Math.min(100, Math.round((relevance / 2.0) * 100));
  const isNew = isNewFactor(factor.createdAt);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/60 p-5 transition-all duration-300 hover:border-line-strong hover:bg-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line bg-base/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">
              {factor.category}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${MAG_COLOR[factor.magnitude]}`}
            >
              <DirectionIcon direction={factor.direction} />
              {factor.magnitude}
            </span>
          </div>
          <h3 className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-white">
            {factor.name}
            {isNew && (
              <span className="ml-2 inline-flex items-center rounded-full bg-teal-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-900 dark:text-white">
                New
              </span>
            )}
          </h3>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-display text-xs font-bold text-slate-600">
            {String(index + 1).padStart(2, "0")}
          </span>
          {factor.importanceScore >= 0 && (
            <span className="text-[11px] font-semibold text-teal-400 dark:text-teal-300">
              Impact: {factor.importanceScore}/100
            </span>
          )}
        </div>
      </div>

      <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{factor.explanation}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {factor.commodities.map((id) => {
          const c = COMMODITIES.find((x) => x.id === id)!;
          return (
            <span
              key={id}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ color: c.color, background: `${c.color}18` }}
            >
              {c.short}
            </span>
          );
        })}
        {factor.regions
          ?.filter((r) => r !== "global")
          .slice(0, 3)
          .map((r) => (
            <span
              key={r}
              className="rounded-full border border-line bg-base/40 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-700 dark:text-slate-500"
            >
              {r}
            </span>
          ))}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="font-semibold text-slate-700 dark:text-slate-500">Relevance @ {horizon}y</span>
          <span
            className={`inline-flex items-center gap-1 font-semibold ${
              trend === "rising"
                ? "text-rose-300"
                : trend === "fading"
                  ? "text-emerald-300"
                  : "text-slate-600 dark:text-slate-400"
            }`}
          >
            {trend === "rising" && <TrendingUp className="h-3 w-3" />}
            {trend === "fading" && <TrendingDown className="h-3 w-3" />}
            {trend === "steady" && <GitBranch className="h-3 w-3" />}
            {trend}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-500/80 to-teal-300 transition-all duration-500"
            style={{ width: `${width}%` }}
          />
        </div>
      </div>

      <p className="mt-3 text-[10px] text-slate-600">Source: {factor.source}</p>
    </article>
  );
}

interface FactorsSectionProps {
  horizon: number;
  dynamicFactors?: Factor[];
  healthStatus?: "Initializing AI" | "Online Model Connected" | "Offline Model";
}

export default function FactorsSection({
  horizon,
  dynamicFactors,
  healthStatus,
}: FactorsSectionProps) {
  const hasDynamicFactors = dynamicFactors && dynamicFactors.length === 8;
  const activeFactors = hasDynamicFactors ? dynamicFactors : FACTORS;
  const isOnline = healthStatus === "Online Model Connected";
  const aiCurated = hasDynamicFactors && isOnline;

  const sorted = useMemo(
    () =>
      [...activeFactors].sort(
        (a, b) => factorRelevance(b.bias, horizon) - factorRelevance(a.bias, horizon),
      ),
    [activeFactors, horizon],
  );

  return (
    <section id="factors" className="relative scroll-mt-20 border-t border-line py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <div className="mb-10 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-400 dark:text-teal-300/80">
              Key factors & drivers
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              {isOnline ? "AI-Curated Factors" : "Key factors & drivers"}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {aiCurated
                ? "Live AI curation via Kilo Gateway. Factors update automatically every 2 minutes."
                : "Twelve researched drivers shape the forecast paths. Relevance automatically reweights as you change the horizon — short horizons emphasize policy and inventories; longer ones highlight structural transition and scarcity."}
            </p>
            {isOnline && (
              <p className="mt-2 text-xs text-teal-400 dark:text-teal-300/80">
                Status: {healthStatus}
              </p>
            )}
          </div>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((f, i) => (
            <Reveal key={f.id} delay={Math.min(i * 40, 280)}>
              <FactorCard factor={f} horizon={horizon} index={i} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}