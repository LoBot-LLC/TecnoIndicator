import { Activity, Droplets, Fuel, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { regionById, type RegionId } from "../lib/model";

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
    label: "Fuel levy",
    hint: "retail fuel vs baseline",
    icon: Fuel,
    color: "#f5b840",
  },
  {
    key: "electricityTariffAdjustmentIndex" as const,
    label: "Power tariff",
    hint: "grid-adjusted electricity",
    icon: Zap,
    color: "#2dd4bf",
  },
  {
    key: "waterScarcityAdjustedPriceIndex" as const,
    label: "Water scarcity",
    hint: "scarcity-adjusted water",
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
  const profile = regionById(scope);

  return (
    <section id="market-index" aria-label="Market index" className="border-y border-line bg-panel/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-4 sm:px-8 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex shrink-0 items-center gap-2.5">
          <Activity className="h-4 w-4 text-teal-300" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Market index · {profile.flag} {profile.name}
          </p>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3 xl:min-w-0 xl:flex-1 xl:max-w-3xl">
          {TILES.map((t) => {
            const Icon = t.icon;
            const value = analytics?.[t.key];
            const up = (value ?? 0) >= 0;
            return (
              <div
                key={t.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-base/40 px-3.5 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${t.color}18`, color: t.color }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-300">{t.label}</p>
                    <p className="truncate text-[10px] text-slate-600">{t.hint}</p>
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-0.5 font-display text-sm font-semibold tabular-nums ${
                    value === undefined
                      ? "text-slate-600"
                      : up
                        ? "text-rose-300"
                        : "text-emerald-300"
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

        <p className="shrink-0 text-[11px] text-slate-600">
          {analytics?.dataSource ?? "Loading analytics…"}
        </p>
      </div>
    </section>
  );
}
