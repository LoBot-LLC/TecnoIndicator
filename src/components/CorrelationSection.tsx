"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/context/LanguageContext";
import { useTranslatedTexts } from "@/lib/translateDynamic";
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

function formatR(r: number | null, na: string): string {
  return r === null ? na : r.toFixed(2);
}

export default function CorrelationSection(props: CorrelationSectionProps) {
  const { horizon, region, onRegion } = props;
  const { t } = useTranslation("correlation");
  const { t: tMarket } = useTranslation("market");
  const { language } = useLanguage();
  const na = t("notAvailable");
  const prices = props.prices ?? DEFAULT_PRICES;

  const pool = useMemo(() => factorPool(props), [props.globalFactors, props.regionalFactors]);

  const topFactors = useMemo(
    () =>
      [...pool]
        .sort((a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0))
        .slice(0, 8),
    [pool],
  );

  const factorNames = useTranslatedTexts(
    topFactors.map((f) => ({ id: f.id, text: f.name })),
    language,
  );

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
              {t("kicker")}
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              {t("title")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-500">
              {t("description", { horizon, region })}
            </p>
          </div>
        </Reveal>

        {horizon < 2 || topFactors.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
            {horizon < 2 ? t("increaseHorizon") : t("noFactors")}
          </p>
        ) : (
          <>
            <Reveal>
              <div className="overflow-x-auto rounded-2xl border border-line bg-panel/60">
                <div
                  role="grid"
                  aria-label={t("gridLabel")}
                  aria-rowcount={topFactors.length + 1}
                  aria-colcount={COMMODITIES.length + 1}
                  className="min-w-[560px]"
                >
                  <div role="row" className="grid grid-cols-[1.4fr_repeat(3,1fr)] border-b border-line bg-base/40">
                    <div role="columnheader" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-400">
                      {t("factor")}
                    </div>
                    {COMMODITIES.map((c) => (
                      <div
                        key={c.id}
                        role="columnheader"
                        className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: c.color }}
                      >
                        {tMarket(`commodity.${c.id}`)}
                      </div>
                    ))}
                  </div>
                  {topFactors.map((f) => (
                    <div key={f.id} role="row" className="grid grid-cols-[1.4fr_repeat(3,1fr)] border-b border-line/60 last:border-0">
                      <div role="rowheader" className="truncate px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200" title={factorNames.get(f.id) ?? f.name}>
                        {factorNames.get(f.id) ?? f.name}
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
                              aria-label={t("cellLabel", { factor: factorNames.get(f.id) ?? f.name, commodity: tMarket(`commodity.${c.id}`), r: formatR(r, na) })}
                              aria-pressed={active}
                              className={`w-full rounded-lg px-2 py-1.5 font-display text-xs font-bold tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 ${
                                active ? "ring-2 ring-teal-400/60" : "hover:brightness-110"
                              }`}
                              style={{
                                background: hexToRgba(c.color, r === null ? 0.06 : Math.abs(r)),
                                color: r === null ? undefined : Math.abs(r) > 0.5 ? "#0b1220" : undefined,
                              }}
                            >
                              {formatR(r, na)}
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
                  {t("detailTitle", { name: factorNames.get(selectedFactor.id) ?? selectedFactor.name })}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {t("vs")} {(selectedFactor.commodities[0] ?? "oil").toUpperCase()}
                  </span>
                </h3>
                <div className="mt-4 space-y-2">
                  {detail.map((d) => {
                    const meta = REGIONS.find((r) => r.id === d.regionId);
                    const pct = d.r === null ? 0 : Math.abs(d.r) * 100;
                    const regionName = meta ? tMarket(`region.${meta.id}`) : d.regionId;
                    return (
                      <button
                        key={d.regionId}
                        type="button"
                        onClick={() => scrollToRegions(d.regionId)}
                        aria-label={t("openRegion", { region: regionName, r: formatR(d.r, na) })}
                        className="group flex w-full items-center gap-3 rounded-xl border border-line bg-base/40 px-3 py-2 text-left transition-all hover:border-teal-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
                      >
                        <span className="w-28 shrink-0 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {meta?.flag} {regionName}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                          <span
                            className="block h-full rounded-full bg-teal-400"
                            style={{ width: `${Math.round(pct)}%` }}
                          />
                        </span>
                        <span className="w-14 shrink-0 text-right font-display text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatR(d.r, na)}
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
