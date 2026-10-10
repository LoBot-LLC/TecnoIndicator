import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import type { ChartConfiguration, TooltipItem } from "chart.js";
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Droplets,
  Fuel,
  Gauge,
  Globe2,
  TrendingUp,
  Zap,
} from "lucide-react";
import Reveal from "./Reveal";
import { useFlash } from "../hook/useFlash";
import { useCurrency } from "../context/CurrencyContext";
import {
  buildRegionalCSV,
  COMMODITIES,
  downloadFile,
  evaluateRegions,
  hexToRgba,
  START_YEAR,
  type CommodityId,
  type RegionEvaluation,
  type RegionId,
  type Factor,
} from "../lib/model";

// Registered on the client only; the Chart instance is built in useEffect.
if (typeof window !== "undefined") {
  Chart.register(BarController, BarElement, CategoryScale, Legend, LinearScale, Tooltip);
}

function getChartColors(isDark: boolean) {
  if (isDark) {
    return {
      legendLabel: "rgba(219,228,240,0.75)",
      tooltipBg: "rgba(10,17,34,0.95)",
      tooltipBorder: "#1b2740",
      tooltipTitle: "#f1f5f9",
      tooltipBody: "#dbe4f0",
      xBorder: "#1b2740",
      xTicks: "rgba(219,228,240,0.65)",
      yGrid: "rgba(148,163,184,0.07)",
      yTicks: "rgba(219,228,240,0.55)",
    };
  }
  return {
    legendLabel: "rgba(30,41,59,0.75)",
    tooltipBg: "rgba(255,255,255,0.95)",
    tooltipBorder: "#e2e8f0",
    tooltipTitle: "#0f172a",
    tooltipBody: "#334155",
    xBorder: "#e2e8f0",
    xTicks: "rgba(30,41,59,0.65)",
    yGrid: "rgba(148,163,184,0.1)",
    yTicks: "rgba(30,41,59,0.55)",
  };
}

const COMM_META: Record<
  CommodityId,
  { label: string; icon: typeof Fuel; color: string; decimals: number; unit: string }
> = {
  oil: { label: "Oil", icon: Fuel, color: "#f5b840", decimals: 1, unit: `bbl` },
  electricity: { label: "Power", icon: Zap, color: "#2dd4bf", decimals: 0, unit: "MWh" },
  water: { label: "Water", icon: Droplets, color: "#38bdf8", decimals: 2, unit: "m³" },
};

function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--color-line)" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display text-sm font-bold text-slate-900 dark:text-white">{score}</span>
      </div>
    </div>
  );
}

function DeltaBadge({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
        up ? "text-rose-300 dark:text-rose-400" : "text-emerald-300 dark:text-emerald-400"
      }`}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {up ? "+" : "−"}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function RegionCard({
  ev,
  selected,
  onSelect,
  rank,
}: {
  ev: RegionEvaluation;
  selected: boolean;
  onSelect: () => void;
  rank: number;
}) {
  const { selectedCurrency, formatPrice } = useCurrency();
  const oilFlash = useFlash(ev.spots.oil);
  const elecFlash = useFlash(ev.spots.electricity);
  const waterFlash = useFlash(ev.spots.water);
  const flashes: Record<CommodityId, string> = {
    oil: oilFlash,
    electricity: elecFlash,
    water: waterFlash,
  };

const outlookColor =
    ev.outlook === "bullish"
      ? "text-rose-300 dark:text-rose-400 border-rose-400/30 dark:border-rose-400/40 bg-rose-400/10 dark:bg-rose-400/15"
      : ev.outlook === "bearish"
      ? "text-emerald-300 dark:text-emerald-400 border-emerald-400/30 dark:border-emerald-400/40 bg-emerald-400/10 dark:bg-emerald-400/15"
      : "text-slate-600 dark:text-slate-500 border-line bg-panel/5";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group w-full rounded-2xl border p-5 text-left transition-all duration-300 ${
        selected
          ? "border-teal-400/45 bg-teal-400/[0.07] shadow-[0_0_32px_rgba(45,212,191,0.12)]"
          : "border-line bg-panel/60 hover:border-line-strong hover:bg-panel"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-base/50 text-xl">
            {ev.region.flag}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {ev.region.name}
              </h3>
              <span className="rounded-full border border-line bg-base/40 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-500">
                #{rank}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-700 dark:text-slate-500">{ev.region.oilMarker}</p>
          </div>
        </div>
        <ScoreRing score={ev.score} color={ev.region.accent} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-700 dark:text-slate-500 line-clamp-2">{ev.region.blurb}</p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {COMMODITIES.map((c) => {
          const meta = COMM_META[c.id];
          return (
            <div
              key={c.id}
              className="rounded-xl border border-line bg-base/40 px-2.5 py-2.5"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">
                {meta.label}
              </p>
              <p
                className={`mt-1 font-display text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 ${flashes[c.id]}`}
              >
                {formatPrice(ev.spots[c.id], selectedCurrency)}
              </p>
              <div className="mt-1">
                <DeltaBadge value={ev.deltaPct[c.id]} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${outlookColor}`}
        >
          {ev.outlook} outlook
        </span>
        <span className="text-[11px] text-slate-600 dark:text-slate-500">
          vs global power{" "}
          <span className="font-semibold text-slate-600 dark:text-slate-500">
            {ev.vsGlobalPct.electricity >= 0 ? "+" : ""}
            {ev.vsGlobalPct.electricity.toFixed(0)}%
          </span>
        </span>
      </div>
    </button>
  );
}

function isNewFactor(createdAt: string): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  return diffMs <= 10 * 60 * 1000;
}

function RegionalFactorCard({
  factor,
  index,
}: {
  factor: Factor;
  index: number;
}) {
  const isNew = isNewFactor(factor.createdAt);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/60 p-4 transition-all duration-300 hover:border-line-strong hover:bg-panel">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-line bg-base/50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">
              {factor.category}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold text-amber-300 border-amber-400/30 bg-amber-400/10">
              {factor.magnitude}
            </span>
          </div>
          <h4 className="mt-2 font-display text-sm font-semibold text-slate-900 dark:text-white leading-snug">
            {factor.name}
            {isNew && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-teal-500 px-1.5 py-0.5 text-[9px] font-semibold text-slate-900 dark:text-white">
                New
              </span>
            )}
          </h4>
        </div>
        <span className="shrink-0 font-display text-[11px] font-bold text-slate-600 dark:text-slate-500">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-500 line-clamp-3">
        {factor.explanation}
      </p>

      <div className="mt-2 flex flex-wrap gap-1">
        {factor.commodities.map((id) => {
          const c = COMMODITIES.find((x) => x.id === id)!;
          return (
            <span
              key={id}
              className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ color: c.color, background: `${c.color}18` }}
            >
              {c.short}
            </span>
          );
        })}
        {factor.regions
          ?.filter((r) => r !== "global")
          .slice(0, 2)
          .map((r) => (
            <span
              key={r}
              className="rounded-full border border-line bg-base/40 px-1.5 py-0.5 text-[9px] font-medium capitalize text-slate-700 dark:text-slate-500"
            >
              {r}
            </span>
          ))}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px]">
        <span className="font-semibold text-teal-400 dark:text-teal-300">Impact: {factor.importanceScore}/100</span>
        <span className="font-semibold text-slate-700 dark:text-slate-500 capitalize">
          {factor.direction} · {factor.bias}
        </span>
      </div>

      <p className="mt-1 text-[9px] text-slate-600 dark:text-slate-500 line-clamp-1">Source: {factor.source}</p>
    </article>
  );
}

interface RegionalEvaluationProps {
  prices: Record<CommodityId, number>;
  horizon: number;
  jitter: number;
  region: RegionId;
  onRegion: (r: RegionId) => void;
  dynamicFactors: Record<string, Factor[]>;
  healthStatus: "Initializing AI" | "Online Model Connected" | "Offline Model";
}

export default function RegionalEvaluation({
  prices,
  horizon,
  jitter,
  region,
  onRegion,
  dynamicFactors,
  healthStatus,
}: RegionalEvaluationProps) {
  const { selectedCurrency, formatPrice } = useCurrency();
  const evals = useMemo(
    () => evaluateRegions(prices, horizon, jitter),
    [prices, horizon, jitter],
  );
  const [focusCommodity, setFocusCommodity] = useState<CommodityId>("electricity");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"bar", number[], string> | null>(null);
  const horizonYear = START_YEAR + horizon;

  const selected = evals.find((e) => e.region.id === region) ?? evals[0];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const labels = evals.map((e) => e.region.short);
    const spotData = evals.map((e) => e.spots[focusCommodity]);
    const horizonData = evals.map((e) => e.horizon[focusCommodity].avg);
    const color = COMM_META[focusCommodity].color;
    const isDark = document.documentElement.classList.contains("dark");
    const colors = getChartColors(isDark);

    const config: ChartConfiguration<"bar", number[], string> = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: `Spot ${START_YEAR}`,
            data: spotData,
            backgroundColor: hexToRgba(color, 0.35),
            borderColor: hexToRgba(color, 0.55),
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 28,
          },
          {
            label: `Forecast ${horizonYear}`,
            data: horizonData,
            backgroundColor: hexToRgba(color, 0.85),
            borderRadius: 6,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 420, easing: "easeOutQuart" },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: colors.legendLabel,
              boxWidth: 12,
              usePointStyle: true,
              pointStyle: "rectRounded",
              padding: 14,
              font: { family: "Inter", size: 11 },
            },
          },
          tooltip: {
            backgroundColor: colors.tooltipBg,
            borderColor: colors.tooltipBorder,
            borderWidth: 1,
            titleColor: colors.tooltipTitle,
            bodyColor: colors.tooltipBody,
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (ctx: TooltipItem<"bar">) => {
                return ` ${ctx.dataset.label}: ${formatPrice(Number(ctx.parsed.y), selectedCurrency)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: colors.xBorder },
            ticks: {
              color: colors.xTicks,
              font: { family: "Inter", size: 11 },
            },
          },
          y: {
            grid: { color: colors.yGrid },
            border: { display: false },
            ticks: {
              color: colors.yTicks,
              font: { family: "Inter", size: 10 },
            },
          },
        },
      },
    };

    if (!chartRef.current) {
      chartRef.current = new Chart(canvas, config);
    } else {
      chartRef.current.data = config.data;
      chartRef.current.update();
    }

    return () => {
      // keep chart instance across commodity toggles; destroy on unmount only
    };
  }, [evals, focusCommodity, horizonYear, formatPrice, selectedCurrency]);

  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  const exportRegional = () => {
    downloadFile(
      `tecnoindicator-regions-${horizon}y.csv`,
      buildRegionalCSV(evals, horizonYear),
      "text/csv;charset=utf-8",
    );
  };

  const cheapestPower = [...evals].sort(
    (a, b) => a.spots.electricity - b.spots.electricity,
  )[0];
  const dearestWater = [...evals].sort((a, b) => b.spots.water - a.spots.water)[0];
  const topScore = evals[0];

  return (
    <section id="regions" className="relative scroll-mt-20 border-t border-line py-16 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 mask-fade-y" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-400 dark:text-teal-300/80">
                Regional intelligence
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
                Evaluate 5 world regions
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-500">
                Live oil, electricity and water prices mapped to Americas, Europe, Asia, Africa and
                Oceania using research-backed regional markers — WTI, Dated Brent, Dubai/Oman, West
                African sweet and import-parity crude, plus retail power and municipal water
                tariffs. Scores update automatically with the live feed.
              </p>
            </div>
            <button
              type="button"
              onClick={exportRegional}
              className="inline-flex items-center gap-2 self-start rounded-xl border border-line bg-panel/5 px-4 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-all hover:border-teal-400/40 hover:text-slate-900 dark:text-white"
            >
              <Download className="h-3.5 w-3.5 text-teal-400 dark:text-teal-300" />
              Export region CSV
            </button>
          </div>
        </Reveal>

        {/* insight chips */}
        <Reveal delay={60}>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-line bg-panel/60 p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">
                <Gauge className="h-3.5 w-3.5 text-teal-400 dark:text-teal-300" />
                Best composite score
              </div>
              <p className="mt-2 font-display text-lg font-semibold text-slate-900 dark:text-white">
                {topScore.region.flag} {topScore.region.name}{" "}
                <span className="text-teal-400 dark:text-teal-300">{topScore.score}/100</span>
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-panel/60 p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">
                <Zap className="h-3.5 w-3.5 text-elec" />
                Lowest power tariff
              </div>
              <p className="mt-2 font-display text-lg font-semibold text-slate-900 dark:text-white">
                {cheapestPower.region.flag} {cheapestPower.region.name}{" "}
               <span className="text-elec">
                   {formatPrice(cheapestPower.spots.electricity, selectedCurrency)}/{COMM_META.electricity.unit}
                 </span>
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-panel/60 p-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">
                <Droplets className="h-3.5 w-3.5 text-water" />
                Highest water tariff
              </div>
              <p className="mt-2 font-display text-lg font-semibold text-slate-900 dark:text-white">
                {dearestWater.region.flag} {dearestWater.region.name}{" "}
                <span className="text-water">{formatPrice(dearestWater.spots.water, selectedCurrency)}/{COMM_META.water.unit}</span>
              </p>
            </div>
          </div>
        </Reveal>

        {/* region cards */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {evals.map((ev, i) => (
            <Reveal key={ev.region.id} delay={80 + i * 50}>
              <RegionCard
                ev={ev}
                rank={i + 1}
                selected={region === ev.region.id || (region === "global" && i === 0)}
                onSelect={() => onRegion(ev.region.id)}
              />
            </Reveal>
          ))}
        </div>

        {/* comparison chart + detail */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Reveal delay={140}>
            <div className="rounded-2xl border border-line bg-panel/60 p-5 sm:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                    Cross-region comparison
                  </h3>
                  <p className="mt-1 text-xs text-slate-700 dark:text-slate-500">
                    Spot vs {horizon}-year average forecast by region
                  </p>
                </div>
                <div className="flex rounded-lg border border-line bg-base/50 p-0.5">
                  {(Object.keys(COMM_META) as CommodityId[]).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFocusCommodity(id)}
                      aria-pressed={focusCommodity === id}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                        focusCommodity === id
                          ? "bg-teal-400 text-slate-950 shadow-[0_0_16px_rgba(45,212,191,0.35)]"
                          : "text-slate-600 dark:text-slate-100 hover:text-slate-800 dark:text-slate-100"
                      }`}
                    >
                      {COMM_META[id].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[300px] w-full sm:h-[340px]">
                <canvas ref={canvasRef} aria-label="Regional price comparison chart" />
              </div>
            </div>
          </Reveal>

          <Reveal delay={180}>
            <div className="flex h-full flex-col rounded-2xl border border-line bg-panel/60 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-base/50 text-2xl">
                  {selected.region.flag}
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-500">
                    Deep dive
                  </p>
                  <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                    {selected.region.name}
                  </h3>
                </div>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-500">{selected.region.blurb}</p>

              <div className="mt-5 space-y-3">
                {COMMODITIES.map((c) => {
                  const meta = COMM_META[c.id];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={c.id}
                      className="rounded-xl border border-line bg-base/40 px-3.5 py-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-500">
                          <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                          {meta.label}
                          <span className="font-normal text-slate-600 dark:text-slate-500">
                            {selectedCurrency}/{meta.unit}
                          </span>
                        </span>
                        <DeltaBadge value={selected.deltaPct[c.id]} />
                      </div>
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-500">
                            Spot
                          </p>
                          <p className="font-display text-base font-bold tabular-nums text-slate-900 dark:text-white">
                            {formatPrice(selected.spots[c.id], selectedCurrency)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-500">
                            {horizonYear} avg
                          </p>
                          <p className="font-display text-base font-bold tabular-nums text-slate-800 dark:text-slate-100">
                            {formatPrice(selected.horizon[c.id].avg, selectedCurrency)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-500">
                            vs world
                          </p>
                          <p className="font-display text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-500">
                            {selected.vsGlobalPct[c.id] >= 0 ? "+" : ""}
                            {selected.vsGlobalPct[c.id].toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-500">
                  Key regional drivers
                </p>
                <ul className="mt-2 space-y-1.5">
                  {selected.region.drivers.map((d) => (
                    <li
                      key={d}
                      className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-500"
                    >
                      <TrendingUp
                        className="mt-0.5 h-3 w-3 shrink-0"
                        style={{ color: selected.region.accent }}
                      />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>

{/* AI-curated regional factors */}
               <div id="regional-factors" className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-500">
                    {healthStatus === "Online Model Connected"
                      ? "AI Factors"
                      : "Regional factors"}
                  </p>
                  <span className="text-[11px] text-slate-600 dark:text-slate-500">
                    8 factors per region
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(dynamicFactors[selected.region.id] ?? []).map((f, i) => (
                    <RegionalFactorCard key={f.id} factor={f} index={i} />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onRegion(selected.region.id);
                  document.getElementById("forecast")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 py-2.5 text-xs font-semibold text-slate-950 transition-all hover:bg-teal-300"
              >
                <Globe2 className="h-3.5 w-3.5" />
                Open {selected.region.short} in forecast studio
              </button>
            </div>
          </Reveal>
        </div>

        {/* comparison table */}
        <Reveal delay={200}>
          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel/60">
            <div className="border-b border-line px-5 py-4 sm:px-6">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                Regional scoreboard
              </h3>
              <p className="mt-0.5 text-xs text-slate-700 dark:text-slate-500">
                Live spots, {horizon}-year averages and premium/discount vs global · ranked by
                composite affordability score
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-base/40 text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-500">
                    <th className="px-5 py-3 font-semibold sm:px-6">Region</th>
                    <th className="px-3 py-3 text-center font-semibold text-oil">Oil spot</th>
                    <th className="px-3 py-3 text-center font-semibold text-oil">
                      Oil {horizonYear}
                    </th>
                    <th className="px-3 py-3 text-center font-semibold text-elec">Power spot</th>
                    <th className="px-3 py-3 text-center font-semibold text-elec">
                      Power {horizonYear}
                    </th>
                    <th className="px-3 py-3 text-center font-semibold text-water">Water spot</th>
                    <th className="px-3 py-3 text-center font-semibold text-water">
                      Water {horizonYear}
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">Score</th>
                    <th className="px-5 py-3 text-center font-semibold sm:px-6">Outlook</th>
                  </tr>
                </thead>
                <tbody>
                  {evals.map((e, idx) => (
                    <tr
                      key={e.region.id}
                      className={`border-b border-line/60 transition-colors hover:bg-panel/3 ${
                        region === e.region.id ? "bg-teal-400/10" : ""
                      }`}
                    >
                      <td className="px-5 py-3 sm:px-6">
                        <button
                          type="button"
                          onClick={() => onRegion(e.region.id)}
                          className="flex items-center gap-2.5 text-left"
                        >
                          <span className="text-lg">{e.region.flag}</span>
<span>
                             <span className="block font-display font-semibold text-slate-900 dark:text-slate-100">
                               {e.region.name}
                             </span>
<span className="text-[11px] text-slate-600 dark:text-slate-500">
                               #{idx + 1} · {e.region.oilMarker}
                             </span>
                           </span>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-800 dark:text-slate-200">
                        {formatPrice(e.spots.oil, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-600 dark:text-slate-500">
                        {formatPrice(e.horizon.oil.avg, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-800 dark:text-slate-200">
                        {formatPrice(e.spots.electricity, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-600 dark:text-slate-500">
                        {formatPrice(e.horizon.electricity.avg, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-800 dark:text-slate-200">
                        {formatPrice(e.spots.water, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-600 dark:text-slate-500">
                        {formatPrice(e.horizon.water.avg, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className="inline-flex min-w-[2.5rem] justify-center rounded-full px-2 py-0.5 font-display text-sm font-bold"
                          style={{
                            color: e.region.accent,
                            background: `${e.region.accent}18`,
                          }}
                        >
                          {e.score}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center capitalize text-xs font-semibold text-slate-600 dark:text-slate-500 sm:px-6">
                        {e.outlook}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
