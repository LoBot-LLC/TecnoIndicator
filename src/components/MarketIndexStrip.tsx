import { Activity, Droplets, Fuel, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { regionById, type RegionId } from "../lib/model";
import { useLanguage } from "../i18n/LanguageContext";
import { localizeRegion } from "../i18n/regionText";
import type { TranslationKey } from "../i18n/dictionaries";

/** Shape returned by /api/analytics and /api/regional-analytics. */
export interface AnalyticsSnapshot {
  fuelLevy: number;
  electricityTariffAdjustmentIndex: number;
  waterScarcityAdjustedPriceIndex: number;
  dataSource: string;
  isLive: boolean;
  timestamp: string;
  region?: RegionId;
}

const TILES = [
  {
    key: "fuelLevy" as const,
    labelKey: "marketIndex.fuelLabel" as TranslationKey,
    hintKey: "marketIndex.fuelHint" as TranslationKey,
    icon: Fuel,
    color: "#f5b840",
  },
  {
    key: "electricityTariffAdjustmentIndex" as const,
    labelKey: "marketIndex.powerLabel" as TranslationKey,
    hintKey: "marketIndex.powerHint" as TranslationKey,
    icon: Zap,
    color: "#2dd4bf",
  },
  {
    key: "waterScarcityAdjustedPriceIndex" as const,
    labelKey: "marketIndex.waterLabel" as TranslationKey,
    hintKey: "marketIndex.waterHint" as TranslationKey,
    icon: Droplets,
    color: "#38bdf8",
  },
];

function formatIndex(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}

interface MarketIndexStripProps {
  scope: RegionId;
  analytics?: AnalyticsSnapshot;
}

/**
 * Slim strip that surfaces the real /api/analytics (and regional analytics)
 * indices for the currently selected scope. Rendered between the hero ticker
 * and the forecast studio.
 */
export default function MarketIndexStrip({ scope, analytics }: MarketIndexStripProps) {
  const { t, language } = useLanguage();
  const profile = regionById(scope);

  return (
    <section id="market-index" aria-label={t("marketIndex.aria")} className="border-y border-line bg-panel/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-4 sm:px-8 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex shrink-0 items-center gap-2.5">
          <Activity className="h-4 w-4 text-teal-400 dark:text-teal-300" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-700 dark:text-slate-500">
            {t("marketIndex.title", { region: `${profile.flag} ${localizeRegion(profile, language).name}` })}
          </p>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3 xl:min-w-0 xl:flex-1 xl:max-w-3xl">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            const value = analytics?.[tile.key];
            const up = (value ?? 0) >= 0;
            return (
              <div
                key={tile.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-base/40 px-3.5 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${tile.color}18`, color: tile.color }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate sm:overflow-visible sm:whitespace-normal sm:text-clip text-xs font-semibold text-slate-600 dark:text-slate-500">{t(tile.labelKey)}</p>
                    <p className="truncate sm:overflow-visible sm:whitespace-normal sm:text-clip text-[10px] text-slate-600 dark:text-slate-500">{t(tile.hintKey)}</p>
                  </div>
                </div>
<span
                  className={`inline-flex shrink-0 items-center gap-0.5 font-display text-sm font-semibold tabular-nums ${
                    value === undefined
                      ? "text-slate-600 dark:text-slate-500"
                      : up
                      ? "text-rose-300 dark:text-rose-400"
                      : "text-emerald-300 dark:text-emerald-400"
                  }`}
                >
                  {value !== undefined &&
                    (up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
                  {formatIndex(value)}
                </span>
              </div>
            );
          })}
        </div>

        <p className="shrink-0 text-[11px] text-slate-600 dark:text-slate-500">
          {analytics?.dataSource ?? t("marketIndex.loading")}
        </p>
      </div>
    </section>
  );
}
