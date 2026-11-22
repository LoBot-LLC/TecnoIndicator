import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Reveal from "./Reveal";
import { useLanguage } from "../context/LanguageContext";
import { useTranslatedTexts } from "../hook/useTranslatedTexts";
import {
  COMMODITIES,
  factorRelevance,
  relevanceTrend,
  type Direction,
  type Factor,
  type Magnitude,
} from "../lib/model";
import { truncateAtSentence } from "../lib/truncate";

const MAG_COLOR: Record<Magnitude, string> = {
  High: "text-rose-300 dark:text-rose-400 border-rose-400/30 dark:border-rose-400/40 bg-rose-400/10 dark:bg-rose-400/15",
  Medium: "text-amber-300 dark:text-amber-400 border-amber-400/30 dark:border-amber-400/40 bg-amber-400/10 dark:bg-amber-400/15",
  Low: "text-slate-600 dark:text-slate-500 border-line bg-panel/5",
};

function isNewFactor(createdAt: string): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  return diffMs <= 10 * 60 * 1000;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function DirectionIcon({ direction }: { direction: Direction }) {
  if (direction === "up") return <ArrowUpRight className="h-3.5 w-3.5 text-rose-300" />;
  if (direction === "down") return <ArrowDownRight className="h-3.5 w-3.5 text-emerald-300" />;
  return <Minus className="h-3.5 w-3.5 text-slate-600 dark:text-slate-500" />;
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
  const { t, locale } = useLanguage();
  const [translatedName, translatedExplanation, translatedCategory] =
    useTranslatedTexts([factor.name, factor.explanation, factor.category], locale);
  const name = translatedName || factor.name;
  const explanation = translatedExplanation || factor.explanation;
  const category = translatedCategory || factor.category;
  const isNew = isNewFactor(factor.createdAt);
  const [isExpanded, setIsExpanded] = useState(false);
  const MAX_CHARS = 400;
  const shouldTruncate = explanation.length > MAX_CHARS;
  const displayText = isExpanded || !shouldTruncate
    ? explanation
    : truncateAtSentence(explanation, MAX_CHARS);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/60 p-5 transition-all duration-300 hover:border-line-strong hover:bg-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line bg-base/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">
              {category}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${MAG_COLOR[factor.magnitude]}`}
            >
              <DirectionIcon direction={factor.direction} />
              {t(factor.magnitude)}
            </span>
          </div>
          <h3 className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-white">
            {name}
            {isNew && (
              <span className="ml-2 inline-flex items-center rounded-full bg-teal-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-900 dark:text-white">
                {t("New")}
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
              {t("Impact: {score}/100", { score: factor.importanceScore })}
            </span>
          )}
        </div>
      </div>

      <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-600 dark:text-slate-500">{displayText}</p>
      {shouldTruncate && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-400 dark:text-teal-300 hover:text-teal-300 dark:hover:text-teal-200 transition-colors"
          aria-expanded={isExpanded}
          aria-controls={`factor-explanation-${factor.id}`}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              {t("Show less")}
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              {t("Show more")}
            </>
          )}
        </button>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {factor.commodities.map((id) => {
          const c = COMMODITIES.find((x) => x.id === id)!;
          return (
            <span
              key={id}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ color: c.color, background: `${c.color}18` }}
            >
              {t(c.short)}
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

      {factor.grounding && factor.commodities.some((id) => factor.grounding?.[id]) && (
        <div className="mt-5 rounded-lg border border-line bg-base/50 px-3 py-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-300">
            {t("Grounded in live dashboard prices")}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {factor.commodities.map((id) => {
              const p = factor.grounding?.[id];
              if (!p) return null;
              const c = COMMODITIES.find((x) => x.id === id)!;
              return (
                <div
                  key={id}
                  className="inline-flex flex-col items-start gap-1 text-[11px] text-slate-700 dark:text-slate-300"
                >
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                    <span className="font-semibold">{t(c.short)}</span>
                    <span className="tabular-nums font-bold">
                      ${p.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 text-[10px]">
                      {p.unit.replace("USD/", "/")}
                    </span>
                  </div>
                  {p.source && (
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {p.source}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {factor.grounding?.asOf && (
            <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 italic">
              {t("Prices as of {asOf}", { asOf: factor.grounding.asOf })}
            </p>
          )}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="font-semibold text-slate-700 dark:text-slate-500">
            {t("Relevance @ {horizon}y", { horizon })}
          </span>
<span
            className={`inline-flex items-center gap-1 font-semibold ${
              trend === "rising"
                ? "text-rose-300"
                : trend === "fading"
                ? "text-emerald-300"
                : "text-slate-600 dark:text-slate-500"
            }`}
          >
            {trend === "rising" && <TrendingUp className="h-3 w-3" />}
            {trend === "fading" && <TrendingDown className="h-3 w-3" />}
            {trend === "steady" && <GitBranch className="h-3 w-3" />}
            {t(trend)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-500/80 to-teal-300 transition-all duration-500"
            style={{ width: `${width}%` }}
          />
        </div>
      </div>

      <div className="mt-3">
        <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-500 block mb-1">
          {t("Source URL")}
        </span>
        {isHttpUrl(factor.source) ? (
          <a
            href={factor.source}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[10px] text-teal-400 dark:text-teal-300 hover:underline underline-offset-4 break-all"
          >
            {factor.source}
            <ExternalLink className="ml-1 inline h-3 w-3 fill-current" aria-label={t("Open source")} />
          </a>
        ) : (
          <span className="block text-[10px] text-slate-600 dark:text-slate-500 break-all">{factor.source}</span>
        )}
      </div>
    </article>
  );
}

interface FactorsSectionProps {
  horizon: number;
  dynamicFactors?: Factor[];
  healthStatus?: "Initializing AI" | "Online Model Connected" | "Offline Model";
  aiCurated?: boolean;
  factorsLoaded?: boolean;
}

const FACTOR_COUNT = 8;

function FactorCardSkeleton() {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/60 p-5 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-5 w-16 rounded-full border border-line bg-base/50" />
            <div className="h-5 w-20 rounded-full border border-line bg-base/50" />
          </div>
          <div className="mt-3 h-5 w-3/4 rounded bg-line" />
        </div>
        <div className="h-5 w-10 rounded bg-line" />
      </div>

      <div className="mt-3 flex-1 h-16 bg-line rounded" />
      <div className="mt-2 h-6 w-1/3 bg-line rounded" />

      <div className="mt-4 flex flex-wrap gap-1.5">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-5 w-16 rounded-full border border-line bg-base/40" />
        ))}
      </div>

      <div className="mt-5 h-20 bg-line rounded-lg" />

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="h-3 w-24 bg-line rounded" />
          <div className="h-1.5 w-20 bg-line rounded-full" />
        </div>
        <div className="h-1.5 bg-line rounded-full" />
      </div>

      <div className="mt-3">
        <div className="h-3 w-16 bg-line rounded mb-1" />
        <div className="h-3 w-32 bg-line rounded" />
      </div>
    </article>
  );
}

export default function FactorsSection({
  horizon,
  dynamicFactors,
  healthStatus,
  factorsLoaded = false,
}: FactorsSectionProps) {
  const { t } = useLanguage();
  const isOnline = healthStatus === "Online Model Connected";
  const isLoading = !factorsLoaded;

  // The AI-Curated section must ONLY ever render factors genuinely backed by a
  // fetched source URL. Never fall back to hard-coded static factor arrays
  // (which carry publication names instead of URLs), so every card displays a
  // real source URL. If no URL-backed factors exist after loading, the grid
  // shows an explicit empty state. While loading, show skeletons.
  const activeFactors: Factor[] = isLoading
    ? []
    : (dynamicFactors ?? []).filter((f) => isHttpUrl(f.source)).slice(0, FACTOR_COUNT);
  const hasLiveFactors = activeFactors.length > 0;

  const isAiCurated = hasLiveFactors && isOnline;

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
              {t("Key factors & drivers")}
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              {isAiCurated ? t("AI-Curated Factors") : t("Key factors & drivers")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-500">
              {isAiCurated
                ? t("Live AI curation via Kilo Gateway. Factors update automatically every 2 minutes.")
                : !isLoading && activeFactors.length === 0
                ? t("Factors appear only when they can be traced to a fetched source URL. None are available right now.")
                : t("Relevance automatically reweights as you change the horizon — short horizons emphasize policy and inventories; longer ones highlight structural transition and scarcity.")}
            </p>
            {isOnline && healthStatus && (
              <p className="mt-2 text-xs text-teal-400 dark:text-teal-300/80">
                {t("Status: {status}", { status: t(healthStatus) })}
              </p>
            )}
            {isLoading && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t("Loading factors…")}
              </p>
            )}
          </div>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {activeFactors.length > 0 ? (
            sorted.map((f, i) => (
              <Reveal key={f.id} delay={Math.min(i * 40, 280)}>
                <FactorCard factor={f} horizon={horizon} index={i} />
              </Reveal>
            ))
          ) : isLoading ? (
            [...Array(FACTOR_COUNT)].map((_, i) => (
              <Reveal key={`skeleton-${i}`} delay={Math.min(i * 40, 280)}>
                <FactorCardSkeleton />
              </Reveal>
            ))
          ) : (
            <p className="col-span-full text-center text-sm text-slate-500 dark:text-slate-400 py-8">
              {t("No live price factors are available right now. Reasons are only shown when they can be traced to a fetched source URL.")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}