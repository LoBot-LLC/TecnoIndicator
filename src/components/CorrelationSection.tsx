"use client";

import { useMemo, useState } from "react";
import Reveal from "./Reveal";
import {
  COMMODITIES,
  EVAL_REGIONS,
  FACTORS,
  REGIONAL_FACTORS,
  hexToRgba,
  type CommodityId,
  type Factor,
  type RegionId,
} from "@/lib/model";
import {
  computeCorrelationMatrix,
  computeFactorRegionCorrelation,
  type CorrelationCell,
} from "@/lib/correlation";
import { REGIONS } from "@/lib/model";
import { useLanguage } from "../context/LanguageContext";
import { useTranslatedTexts } from "../hook/useTranslatedTexts";

/** Translate signature shared with `useLanguage()`, for plain helpers. */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

const REGION_LABELS: Record<string, string> = {
  global: "Global",
  americas: "Americas",
  europe: "Europe",
  asia: "Asia",
  africa: "Africa",
  oceania: "Oceania",
};

const COMMODITY_LABELS: Record<string, string> = {
  oil: "Oil",
  electricity: "Electricity",
  water: "Water",
};

function regionLabel(id: string, t: Translate): string {
  return t(REGION_LABELS[id] ?? id);
}

function commodityLabel(id: string, t: Translate): string {
  return t(COMMODITY_LABELS[id] ?? id);
}

interface CorrelationSectionProps {
  horizon: number;
  region: RegionId;
  onRegion: (r: RegionId) => void;
  globalFactors?: Factor[];
  regionalFactors?: Record<string, Factor[]>;
  prices?: Record<CommodityId, number>;
}

const DEFAULT_PRICES: Record<CommodityId, number> = {
  oil: 104.86,
  electricity: 166,
  water: 2.5,
};

function factorPool(props: CorrelationSectionProps): Factor[] {
  const fromState: Factor[] = [
    ...(props.globalFactors ?? []),
    ...Object.values(props.regionalFactors ?? {}).flat(),
  ];
  if (fromState.length > 0) {
    const seen = new Set<string>();
    return fromState.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  }
  return [...FACTORS, ...Object.values(REGIONAL_FACTORS).flat()];
}

function formatR(r: number | null, t: Translate): string {
  return r === null ? t("n/a") : r.toFixed(2);
}

export default function CorrelationSection(props: CorrelationSectionProps) {
  const { t, locale } = useLanguage();
  const { horizon, region, onRegion } = props;
  const prices = props.prices ?? DEFAULT_PRICES;

  const pool = useMemo(() => factorPool(props), [props.globalFactors, props.regionalFactors]);

  const topFactors = useMemo(
    () =>
      [...pool]
        .sort((a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0))
        .slice(0, 8),
    [pool],
  );

  const factorNameTexts = topFactors.map((f) => f.name);
  const translatedFactorNames = useTranslatedTexts(factorNameTexts, locale);

  const matrix = useMemo<CorrelationCell[]>(
    () =>
      horizon < 2
        ? []
        : computeCorrelationMatrix({ prices, horizon, region, factors: topFactors }).rows,
    [prices, horizon, region, topFactors],
  );

  const cellFor = (factorId: string, commodity: CommodityId): CorrelationCell | undefined =>
    matrix.find((c) => c.factorId === factorId && c.commodity === commodity);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedFactor: Factor | undefined =
    topFactors.find((f) => f.id === selectedId) ?? topFactors[0];
  const selectedFactorIndex = topFactors.findIndex((f) => f.id === selectedFactor?.id);
  const translatedSelectedFactorName =
    selectedFactorIndex !== -1 ? translatedFactorNames[selectedFactorIndex] ?? selectedFactor?.name : selectedFactor?.name;

  const detail = useMemo(() => {
    if (!selectedFactor) return [];
    const comm = selectedFactor.commodities[0] ?? "oil";
    return computeFactorRegionCorrelation(
      selectedFactor,
      EVAL_REGIONS.map((r) => r.id),
      comm,
      prices,
      Math.max(horizon, 2),
    );
  }, [selectedFactor, prices, horizon]);

  const scrollToRegions = (r: RegionId) => {
    onRegion(r);
    document.getElementById("regions")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="correlations" className="relative scroll-mt-20 border-t border-line py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <div className="mb-8 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-400 dark:text-teal-300/80">
              {t("Factor–price correlation")}
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              {t("Correlation matrix")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-500">
              {t("Pearson correlation between each top factor's contribution series and the forecasted price path, for {horizon}-year horizon in {region}. Select a factor to see per-region detail.", {
                horizon,
                region: regionLabel(region, t),
              })}
            </p>
          </div>
        </Reveal>

        {horizon < 2 || topFactors.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
            {horizon < 2
              ? t("Increase the horizon to at least 2 years to compute correlations.")
              : t("No factors available for correlation right now.")}
          </p>
        ) : (
          <>
            <Reveal>
              <div className="overflow-x-auto rounded-2xl border border-line bg-panel/60">
                <div
                  role="grid"
                  aria-label={t("Factor price correlation matrix")}
                  aria-rowcount={topFactors.length + 1}
                  aria-colcount={COMMODITIES.length + 1}
                  className="min-w-[560px]"
                >
                  <div role="row" className="grid grid-cols-[1.4fr_repeat(3,1fr)] border-b border-line bg-base/40">
                    <div role="columnheader" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-400">
                      {t("Factor")}
                    </div>
                    {COMMODITIES.map((c) => (
                      <div
                        key={c.id}
                        role="columnheader"
                        className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: c.color }}
                      >
                        {t(c.short)}
                      </div>
                    ))}
                  </div>
                  {topFactors.map((f, i) => (
                    <div key={f.id} role="row" className="grid grid-cols-[1.4fr_repeat(3,1fr)] border-b border-line/60 last:border-0">
                      <div role="rowheader" className="truncate px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200" title={f.name}>
                        {translatedFactorNames[i] ?? f.name}
                      </div>
                      {COMMODITIES.map((c) => {
                        const cell = cellFor(f.id, c.id);
                        const r = cell?.r ?? null;
                        const active = selectedFactor?.id === f.id;
                        return (
                          <div key={c.id} role="gridcell" className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => setSelectedId(f.id)}
                              aria-label={t("{factor} vs {commodity}: {r}", {
                                factor: translatedFactorNames[i] ?? f.name,
                                commodity: commodityLabel(c.id, t),
                                r: formatR(r, t),
                              })}
                              aria-pressed={active}
                              className={`w-full rounded-lg px-2 py-1.5 font-display text-xs font-bold tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 ${
                                active ? "ring-2 ring-teal-400/60" : "hover:brightness-110"
                              }`}
                              style={{
                                background: hexToRgba(c.color, r === null ? 0.06 : Math.abs(r)),
                                color: r === null ? undefined : Math.abs(r) > 0.5 ? "#0b1220" : undefined,
                              }}
                            >
                              {formatR(r, t)}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            {selectedFactor && (
              <div className="mt-6 rounded-2xl border border-line bg-panel/60 p-5 sm:p-6" aria-live="polite">
                <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                  {t("{factor} — per-region correlation", { factor: translatedSelectedFactorName })}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {t("vs {commodity}", {
                      commodity: commodityLabel(selectedFactor.commodities[0] ?? "oil", t).toUpperCase(),
                    })}
                  </span>
                </h3>
                <div className="mt-4 space-y-2">
                  {detail.map((d) => {
                    const meta = REGIONS.find((r) => r.id === d.regionId);
                    const pct = d.r === null ? 0 : Math.abs(d.r) * 100;
                    return (
                      <button
                        key={d.regionId}
                        type="button"
                        onClick={() => scrollToRegions(d.regionId)}
                        aria-label={t("Open {region} in regions (correlation {r})", {
                          region: regionLabel(d.regionId, t),
                          r: formatR(d.r, t),
                        })}
                        className="group flex w-full items-center gap-3 rounded-xl border border-line bg-base/40 px-3 py-2 text-left transition-all hover:border-teal-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
                      >
                        <span className="w-28 shrink-0 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {meta?.flag} {regionLabel(d.regionId, t)}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                          <span
                            className="block h-full rounded-full bg-teal-400"
                            style={{ width: `${Math.round(pct)}%` }}
                          />
                        </span>
                        <span className="w-14 shrink-0 text-right font-display text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatR(d.r, t)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
