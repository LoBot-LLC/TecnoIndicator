import { useEffect, useRef, useState } from "react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import type { ChartConfiguration, ChartDataset, TooltipItem } from "chart.js";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Droplets,
  FileText,
  Fuel,
  Image as ImageIcon,
  Info,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Waves,
  Zap,
} from "lucide-react";
import Reveal from "./Reveal";
import { useFlash } from "../hook/useFlash";
import { useCurrency } from "../context/CurrencyContext";
import {
  buildCSV,
  COMMODITIES,
  downloadFile,
  EVAL_REGIONS,
  fmtTime,
  hexToRgba,
  regionById,
  START_YEAR,
  type Commodity,
  type CommodityId,
  type ForecastPoint,
  type LiveWaterQuote,
  type RegionId,
} from "../lib/model";
import { EVENTS } from "../lib/events";

// Chart.js is only ever instantiated inside useEffect against a real canvas,
// so registering here is safe even while the tree is server-rendered.
if (typeof window !== "undefined") {
  Chart.register(
    BarController,
    BarElement,
    CategoryScale,
    Filler,
    Legend,
    LineController,
    LineElement,
    LinearScale,
    PointElement,
    Tooltip,
  );
}

type ChartKind = "line" | "bar";

const ICONS: Record<CommodityId, typeof Fuel> = {
  oil: Fuel,
  electricity: Zap,
  water: Droplets,
};

const AXIS: Record<CommodityId, string> = {
  oil: "yOil",
  electricity: "yElec",
  water: "yWater",
};

const QUICK_HORIZONS = [1, 3, 5, 7, 10];

type FancyDataset = ChartDataset<ChartKind, number[]> & {
  unit?: string;
  decimals?: number;
};

function buildDatasets(
  points: ForecastPoint[],
  type: ChartKind,
  bands: boolean,
): FancyDataset[] {
  const datasets: FancyDataset[] = [];
  for (const c of COMMODITIES) {
    datasets.push({
      label: `${c.short} avg`,
      data: points.map((p) => p[c.id].avg),
      borderColor: c.color,
      backgroundColor: type === "bar" ? hexToRgba(c.color, 0.72) : c.color,
      yAxisID: AXIS[c.id],
      unit: c.unit,
      decimals: c.decimals,
      order: 1,
      ...(type === "line"
        ? {
            type: "line" as const,
            borderWidth: 2.5,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: c.color,
            tension: 0.35,
            fill: false,
          }
        : {
            type: "bar" as const,
            borderRadius: 5,
            borderWidth: 0,
            maxBarThickness: 26,
          }),
    });

    if (type === "line" && bands) {
      for (const key of ["min", "max"] as const) {
        datasets.push({
          label: `${c.short} ${key}`,
          data: points.map((p) => p[c.id][key]),
          borderColor: hexToRgba(c.color, 0.42),
          backgroundColor: "transparent",
          yAxisID: AXIS[c.id],
          unit: c.unit,
          decimals: c.decimals,
          order: 3,
          type: "line",
          borderWidth: 1.5,
          borderDash: [6, 6],
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: false,
        });
      }
    }
  }
  return datasets;
}

function axisRange(points: ForecastPoint[], id: CommodityId) {
  const vals = points.flatMap((p) => [p[id].min, p[id].max]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.14 || 1;
  return { min: Math.max(0, lo - pad), max: hi + pad };
}

type PriceFormatter = (value: number, currency: string) => string;

function getChartColors(isDark: boolean) {
  if (isDark) {
    return {
      legendLabel: "rgba(219,228,240,0.75)",
      tooltipBg: "rgba(10,17,34,0.95)",
      tooltipBorder: "#1b2740",
      tooltipTitle: "#f1f5f9",
      tooltipBody: "#dbe4f0",
      xGrid: "rgba(148,163,184,0.06)",
      xBorder: "#1b2740",
      xTicks: "rgba(219,228,240,0.6)",
      yGrid: "rgba(148,163,184,0.07)",
    };
  }
  return {
    legendLabel: "rgba(30,41,59,0.75)",
    tooltipBg: "rgba(255,255,255,0.95)",
    tooltipBorder: "#e2e8f0",
    tooltipTitle: "#0f172a",
    tooltipBody: "#334155",
    xGrid: "rgba(148,163,184,0.1)",
    xBorder: "#e2e8f0",
    xTicks: "rgba(30,41,59,0.6)",
    yGrid: "rgba(148,163,184,0.1)",
  };
}

function buildConfig(
  type: ChartKind,
  points: ForecastPoint[],
  bands: boolean,
  fmt: PriceFormatter,
  currencyCode: string,
  isDark?: boolean,
): ChartConfiguration<ChartKind, number[], string> {
  const theme = isDark ?? (typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const colors = getChartColors(theme);
  const axisOpts = (id: CommodityId, title: string, color: string) => ({
    position: (id === "oil" ? "left" : "right") as "left" | "right",
    weight: id === "water" ? 2 : 1,
    border: { display: false },
    grid: {
      color: id === "oil" ? colors.yGrid : "transparent",
      drawOnChartArea: id === "oil",
    },
    ticks: {
      color: hexToRgba(color, 0.8),
      font: { family: "Inter", size: 10 },
      maxTicksLimit: 6,
    },
    title: {
      display: true,
      text: title,
      color: hexToRgba(color, 0.55),
      font: { family: "Inter", size: 10, weight: 600 as const },
    },
    ...axisRange(points, id),
  });

  return {
    type,
    data: {
      labels: points.map((p) => p.label),
      datasets: buildDatasets(points, type, bands) as ChartDataset<ChartKind, number[]>[],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 420, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: colors.legendLabel,
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: true,
            pointStyle: "circle",
            padding: 16,
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
          titleFont: { family: "Space Grotesk", size: 13, weight: 600 as const },
          bodyFont: { family: "Inter", size: 12 },
          callbacks: {
            label: (ctx: TooltipItem<ChartKind>) => {
              const ds = ctx.dataset as FancyDataset;
              const parsed = ctx.parsed as { y?: number } | number;
              const v = typeof parsed === "object" ? (parsed.y ?? 0) : parsed;
              return ` ${ds.label}: ${fmt(Number(v), currencyCode)} / ${ds.unit?.replace("USD", currencyCode) ?? ""}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: colors.xGrid },
          border: { color: colors.xBorder },
          ticks: {
            color: colors.xTicks,
            font: { family: "Inter", size: 11 },
          },
        },
        yOil: axisOpts("oil", `Oil ${currencyCode}/bbl`, "#f5b840"),
        yElec: axisOpts("electricity", `Power ${currencyCode}/MWh`, "#2dd4bf"),
        yWater: axisOpts("water", `Water ${currencyCode}/m³`, "#38bdf8"),
      },
    },
  } as unknown as ChartConfiguration<ChartKind, number[], string>;
}

/* ------------------------------------------------------------------ */

interface CommodityCardProps {
  commodity: Commodity;
  today: ForecastPoint;
  horizonBand: ForecastPoint;
  live: LiveWaterQuote | null;
  fetching: boolean;
  onFetchWater: () => void;
  regionLabel: string;
}

function CommodityCard({
  commodity,
  today,
  horizonBand,
  live,
  fetching,
  onFetchWater,
  regionLabel,
}: CommodityCardProps) {
  const { selectedCurrency, formatPrice } = useCurrency();
  const Icon = ICONS[commodity.id];
  const band = horizonBand[commodity.id];
  const todayBand = today[commodity.id];
  const delta = band.avg - todayBand.avg;
  const deltaPct = (delta / todayBand.avg) * 100;
  const up = delta >= 0;
  const isWater = commodity.id === "water";
  const flashCls = useFlash(band.avg);
  const spotFlash = useFlash(todayBand.avg);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-panel/70 p-5 transition-all duration-300 hover:border-line-strong hover:bg-panel">
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-30 blur-2xl transition-opacity group-hover:opacity-50"
        style={{ background: commodity.color }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200/5 dark:border-white/5"
            style={{ background: `${commodity.color}18`, color: commodity.color }}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{commodity.name}</p>
            <p className="text-[11px] text-slate-700 dark:text-slate-500">
              {commodity.unit.replace("USD", selectedCurrency)} · {regionLabel}
            </p>
          </div>
        </div>
        {isWater && live && (
          <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
            Live
          </span>
        )}
      </div>

      <p className={`relative mt-5 font-display text-3xl font-bold tabular-nums text-slate-900 dark:text-white ${flashCls}`}>
        {formatPrice(band.avg, selectedCurrency)}
      </p>
      <p className="mt-1 text-xs text-slate-700 dark:text-slate-500">
        Average forecast · {horizonBand.year} · spot{" "}
        <span className={`font-semibold text-slate-600 dark:text-slate-700 ${spotFlash}`}>
          {formatPrice(todayBand.avg, selectedCurrency)}
        </span>
      </p>

      <div className="relative mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-line bg-base/40 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">Low</p>
          <p className="mt-0.5 font-display text-sm font-semibold text-slate-800 dark:text-slate-100">
            {formatPrice(band.min, selectedCurrency)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-base/40 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-500">High</p>
          <p className="mt-0.5 font-display text-sm font-semibold text-slate-800 dark:text-slate-100">
            {formatPrice(band.max, selectedCurrency)}
          </p>
        </div>
      </div>

      <div className="relative mt-4 flex items-center justify-between gap-2 text-xs">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${
            up
              ? "bg-rose-400/10 text-rose-300"
              : "bg-emerald-400/10 text-emerald-300"
          }`}
        >
          {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {up ? "+" : "−"}
          {Math.abs(deltaPct).toFixed(1)}% vs today
        </span>
        <span className="text-slate-600">±{(commodity.maxVol * 100).toFixed(0)}% vol @10y</span>
      </div>

      {isWater && (
        <div className="relative mt-4 border-t border-line pt-4">
          <button
            type="button"
            onClick={onFetchWater}
            disabled={fetching}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2.5 text-xs font-semibold text-sky-200 transition-all hover:bg-sky-400/15 disabled:opacity-60"
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Waves className="h-3.5 w-3.5" />
            )}
            {fetching
              ? "Fetching live quote…"
              : live
                ? "Re-fetch Live Water Price"
                : "Fetch Live Water Price"}
          </button>
          {live && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-700 dark:text-slate-500">
              <span className="font-semibold text-sky-300">{formatPrice(live.price, selectedCurrency)}/m³</span> ·{" "}
              {live.asOf} · {live.source} · {live.range}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface ForecastToolProps {
  horizon: number;
  onHorizon: (h: number) => void;
  prices: Record<CommodityId, number>;
  points: ForecastPoint[];
  lastUpdated: Date;
  onRefresh: () => void;
  onFetchWater: () => void;
  waterFetching: boolean;
  waterLive: LiveWaterQuote | null;
  isLive: boolean;
  streaming: boolean;
  onToggleLive: () => void;
  region: RegionId;
  onRegion: (r: RegionId) => void;
}

export default function ForecastTool({
  horizon,
  onHorizon,
  prices,
  points,
  lastUpdated,
  onRefresh,
  onFetchWater,
  waterFetching,
  waterLive,
  isLive,
  streaming,
  onToggleLive,
  region,
  onRegion,
}: ForecastToolProps) {
  const { selectedCurrency, formatPrice } = useCurrency();
  const [chartType, setChartType] = useState<ChartKind>("line");
  const [showBands, setShowBands] = useState(true);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [spin, setSpin] = useState(false);
  const [exportFlash, setExportFlash] = useState(false);
  const [announce, setAnnounce] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Chart.js generics are strict across mixed line/bar configs — keep loose.
  const chartRef = useRef<Chart | null>(null);
  const sliderRef = useRef<HTMLInputElement>(null);

  const today = points[0];
  const horizonBand = points[points.length - 1];
  const regionProfile = regionById(region);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    chartRef.current?.destroy();
    chartRef.current = null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const isDark = document.documentElement.classList.contains("dark");
    chartRef.current = new Chart(ctx, buildConfig(chartType, points, showBands, formatPrice, selectedCurrency, isDark));
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType, formatPrice, selectedCurrency]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = points.map((p) => p.label);
    chart.data.datasets = buildDatasets(points, chartType, showBands);
    // Refresh axis ranges
    const isDark = document.documentElement.classList.contains("dark");
    const cfg = buildConfig(chartType, points, showBands, formatPrice, selectedCurrency, isDark);
    if (chart.options.scales) {
      chart.options.scales = cfg.options?.scales;
    }
    chart.update();
  }, [points, chartType, showBands, formatPrice, selectedCurrency]);

  useEffect(() => {
    setAnnounce(
      `Forecast updated for ${regionProfile.name}, ${horizon}-year horizon, ${START_YEAR} to ${START_YEAR + horizon}.`,
    );
  }, [horizon, regionProfile.name]);

  useEffect(() => {
    const onPng = () => {
      const chart = chartRef.current;
      if (!chart) return;
      const url = chart.toBase64Image("image/png", 1);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tecnoindicator-forecast-${region}-${horizon}y.png`;
      a.click();
      setExportFlash(true);
      window.setTimeout(() => setExportFlash(false), 1800);
    };
    const onCsv = () =>
      downloadFile(
        `tecnoindicator-forecast-${region}-${horizon}y.csv`,
        buildCSV(points, region),
        "text/csv;charset=utf-8",
      );
    window.addEventListener(EVENTS.EXPORT_PNG, onPng);
    window.addEventListener(EVENTS.EXPORT_CSV, onCsv);
    return () => {
      window.removeEventListener(EVENTS.EXPORT_PNG, onPng);
      window.removeEventListener(EVENTS.EXPORT_CSV, onCsv);
    };
  }, [points, horizon, region]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return;
      e.preventDefault();
      document.getElementById("forecast")?.scrollIntoView({ behavior: "smooth" });
      window.setTimeout(() => sliderRef.current?.focus(), 450);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleRefresh = () => {
    setSpin(true);
    onRefresh();
    window.setTimeout(() => setSpin(false), 750);
  };

  const exportPng = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.toBase64Image("image/png", 1);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tecnoindicator-forecast-${region}-${horizon}y.png`;
    a.click();
    setExportFlash(true);
    window.setTimeout(() => setExportFlash(false), 1800);
  };

  const exportCsv = () =>
    downloadFile(
      `tecnoindicator-forecast-${region}-${horizon}y.csv`,
      buildCSV(points, region),
      "text/csv;charset=utf-8",
    );

  const fillPct = ((horizon - 1) / 9) * 100;

  return (
    <section id="forecast" className="relative scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* heading */}
        <Reveal>
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-400 dark:text-teal-300/80">
                Forecast studio
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
                Interactive price forecasts
              </h2>
            </div>
          </div>
        </Reveal>

        {/* live bar */}
        <Reveal delay={60}>
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-panel/60 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  streaming
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : "border-line bg-panel/5 text-slate-600 dark:text-slate-500"
                }`}
              >
                {streaming && (
                  <span className="relative flex h-2 w-2">
                    <span className="ping-ring absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 pulse-dot" />
                  </span>
                )}
                {streaming ? "Live" : "Paused"}
              </span>
              <span className="text-xs text-slate-700 dark:text-slate-500">
                <span suppressHydrationWarning>{fmtTime(now)}</span> · upd{" "}
                <span suppressHydrationWarning>{fmtTime(lastUpdated)}</span>
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onToggleLive}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel/5 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors hover:border-line-strong"
              >
                {isLive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isLive ? "Pause feed" : "Resume feed"}
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel/5 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors hover:border-line-strong"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${spin ? "spin-once" : ""}`} />
                Refresh data
              </button>
              <button
                type="button"
                onClick={onFetchWater}
                disabled={waterFetching}
                className="inline-flex items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-400/15 disabled:opacity-60"
              >
                {waterFetching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Waves className="h-3.5 w-3.5" />
                )}
                {waterFetching ? "Fetching…" : "Fetch live water price"}
              </button>
            </div>
          </div>
        </Reveal>

        {/* region + horizon controls */}
        <Reveal delay={90}>
          <div className="mb-6 rounded-2xl border border-line bg-panel/60 p-5 sm:p-6">
            <div className="mb-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Evaluation region</p>
                <p className="text-xs text-slate-700 dark:text-slate-500">{regionProfile.blurb}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onRegion("global")}
                  aria-pressed={region === "global"}
                  className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
                    region === "global"
                      ? "border-teal-400/50 bg-teal-400/15 text-teal-200"
                      : "border-line bg-panel/3 text-slate-600 dark:text-slate-100 hover:border-line-strong hover:text-slate-800 dark:text-slate-100"
                  }`}
                >
                  🌐 Global
                </button>
                {EVAL_REGIONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onRegion(r.id)}
                    aria-pressed={region === r.id}
                    className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
                      region === r.id
                        ? "border-teal-400/50 bg-teal-400/15 text-teal-200"
                        : "border-line bg-panel/3 text-slate-600 dark:text-slate-100 hover:border-line-strong hover:text-slate-800 dark:text-slate-100"
                    }`}
                  >
                    {r.flag} {r.short}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Forecast horizon</p>
                <p className="mt-1 text-xs text-slate-700 dark:text-slate-500">
                  <span className="font-display text-2xl font-bold text-teal-400 dark:text-teal-300">{horizon}</span>{" "}
                  {horizon === 1 ? "year" : "years"} · {START_YEAR} → {START_YEAR + horizon}
                </p>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-500">
                Press <kbd className="rounded border border-line bg-base px-1.5 py-0.5 font-mono text-slate-600 dark:text-slate-500">/</kbd>{" "}
                to focus the slider
              </p>
            </div>

            <input
              ref={sliderRef}
              type="range"
              min={1}
              max={10}
              step={1}
              value={horizon}
              onChange={(e) => onHorizon(Number(e.target.value))}
              className="slider mt-4"
              style={{ ["--fill" as string]: `${fillPct}%` }}
              aria-label="Forecast horizon in years"
              aria-valuetext={`${horizon} years, ${START_YEAR} to ${START_YEAR + horizon}`}
            />

            <div className="mt-2 flex justify-between px-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-500">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => onHorizon(y)}
                  aria-label={`Set horizon to ${y} years`}
                  className={`transition-colors ${
                    y === horizon ? "text-teal-400 dark:text-teal-300" : "hover:text-slate-600 dark:text-slate-500"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {QUICK_HORIZONS.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => onHorizon(y)}
                  aria-pressed={horizon === y}
                  className={`rounded-lg border px-4 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    horizon === y
                      ? "border-teal-400/50 bg-teal-400/15 text-teal-200"
                      : "border-line bg-panel/3 text-slate-600 dark:text-slate-100 hover:border-line-strong hover:text-slate-800 dark:text-slate-100"
                  }`}
                >
                  {y}y
                </button>
              ))}
            </div>
          </div>
        </Reveal>

        {/* commodity cards */}
        <div className="grid gap-4 md:grid-cols-3">
          {COMMODITIES.map((c, i) => (
            <Reveal key={c.id} delay={100 + i * 60}>
              <CommodityCard
                commodity={{
                  ...c,
                  name:
                    region === "global"
                      ? c.name
                      : c.id === "oil"
                        ? `${regionProfile.oilMarker} Oil`
                        : `${regionProfile.short} ${c.short}`,
                }}
                today={today}
                horizonBand={horizonBand}
                live={waterLive}
                fetching={waterFetching}
                onFetchWater={onFetchWater}
                regionLabel={regionProfile.short}
              />
            </Reveal>
          ))}
        </div>

        {/* chart */}
        <Reveal delay={160}>
          <div
            className={`mt-6 rounded-2xl border border-line bg-panel/60 p-5 sm:p-6 ${exportFlash ? "export-pulse" : ""}`}
          >
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                  Price trajectories · {regionProfile.flag} {regionProfile.name}
                </h3>
                <p className="mt-1 text-xs text-slate-700 dark:text-slate-500">
                  {chartType === "line" && showBands
                    ? "Solid lines = average · dashed = low/high scenario bands"
                    : chartType === "line"
                      ? "Average price path per commodity"
                      : "Average price per year per commodity"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-line bg-base/50 p-0.5">
                  {(["line", "bar"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setChartType(t)}
                      aria-pressed={chartType === t}
                      className={`rounded-md px-3.5 py-1.5 text-xs font-semibold capitalize transition-all duration-200 ${
                        chartType === t
                          ? "bg-teal-400 text-slate-950 shadow-[0_0_16px_rgba(45,212,191,0.35)]"
                          : "text-slate-600 dark:text-slate-100 hover:text-slate-800 dark:text-slate-100"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowBands((v) => !v)}
                  disabled={chartType === "bar"}
                  className="flex items-center gap-2 rounded-lg border border-line bg-panel/5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-500 transition-colors hover:border-line-strong disabled:opacity-40"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${showBands ? "bg-teal-400" : "bg-slate-600"}`}
                  />
                  Bands
                </button>
                <button
                  type="button"
                  onClick={exportPng}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel/5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-500 transition-colors hover:border-oil/40 hover:text-oil"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  PNG
                </button>
              </div>
            </div>
            <div className="h-[340px] w-full sm:h-[400px]">
              <canvas ref={canvasRef} aria-label="Commodity price forecast chart" />
            </div>
          </div>
        </Reveal>

        {/* table */}
        <Reveal delay={200}>
          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel/60">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">Forecast table</h3>
                <p className="mt-0.5 text-xs text-slate-700 dark:text-slate-500">
                  Yearly average / low / high scenarios in {selectedCurrency} · {regionProfile.name}
                </p>
              </div>
              <button
                type="button"
                onClick={exportCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel/5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-500 transition-colors hover:border-water/40 hover:text-water"
              >
                <FileText className="h-3.5 w-3.5" />
                CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-base/40 text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-500">
                    <th className="px-5 py-3 font-semibold sm:px-6" rowSpan={2}>
                      Year
                    </th>
                    <th
                      className="px-3 py-2 text-center font-semibold"
                      colSpan={3}
                      style={{ color: "#f5b840" }}
                    >
                      Oil {selectedCurrency}/bbl
                    </th>
                    <th
                      className="px-3 py-2 text-center font-semibold"
                      colSpan={3}
                      style={{ color: "#2dd4bf" }}
                    >
                      Electricity {selectedCurrency}/MWh
                    </th>
                    <th
                      className="px-3 py-2 text-center font-semibold"
                      colSpan={3}
                      style={{ color: "#38bdf8" }}
                    >
                      Water {selectedCurrency}/m³
                    </th>
                  </tr>
                  <tr className="border-b border-line bg-base/20 text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-500">
                    {["Avg", "Low", "High", "Avg", "Low", "High", "Avg", "Low", "High"].map(
                      (h, i) => (
                        <th key={`${h}-${i}`} className="px-3 py-2 text-center font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {points.map((p, idx) => (
                    <tr
                      key={p.year}
                      className={`border-b border-line/60 transition-colors hover:bg-panel/3 ${
                        idx === 0 ? "bg-teal-400/10" : ""
                      }`}
                    >
                      <td className="px-5 py-3 font-display font-semibold text-slate-900 dark:text-slate-100 sm:px-6">
                        {p.year}
                        {idx === 0 && (
                          <span className="ml-2 rounded-full border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-400 dark:text-teal-300">
                            Today
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-800 dark:text-slate-100">
                        {formatPrice(p.oil.avg, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-700 dark:text-slate-500">
                        {formatPrice(p.oil.min, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-700 dark:text-slate-500">
                        {formatPrice(p.oil.max, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-800 dark:text-slate-100">
                        {formatPrice(p.electricity.avg, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-700 dark:text-slate-500">
                        {formatPrice(p.electricity.min, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-700 dark:text-slate-500">
                        {formatPrice(p.electricity.max, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-800 dark:text-slate-100">
                        {formatPrice(p.water.avg, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-700 dark:text-slate-500">
                        {formatPrice(p.water.min, selectedCurrency)}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-700 dark:text-slate-500">
                        {formatPrice(p.water.max, selectedCurrency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>

        {/* assumptions */}
        <Reveal delay={220}>
          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel/50">
            <button
              type="button"
              onClick={() => setAssumptionsOpen((v) => !v)}
              aria-expanded={assumptionsOpen}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-panel/3 sm:px-7"
            >
              <span className="flex items-center gap-3">
                <Info className="h-4 w-4 text-teal-400 dark:text-teal-300" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Show underlying assumptions
                </span>
              </span>
              <ChevronRight
                className={`h-4 w-4 text-slate-700 dark:text-slate-100 transition-transform ${assumptionsOpen ? "rotate-90" : ""}`}
              />
            </button>
            {assumptionsOpen && (
              <div className="border-t border-line px-6 py-6 text-sm leading-relaxed text-slate-600 dark:text-slate-500 sm:px-7">
                <p>
                  Every forecast is generated entirely in your browser using a transparent three-part
                  model — a compounding base trend, horizon-scaled volatility bands, and small drift
                  adjustments from the key drivers listed in the Factors section. Regional modes
                  remap spot anchors to research-backed markers (WTI, Dated Brent, Dubai/Oman, WAF,
                  import-parity) and retail power/water tariff levels.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  {[
                    {
                      t: "1 · Base trend",
                      f: "avg(t) = base × (1+CAGR)^t",
                      d: "Compounds today's market price at a structural annual growth rate, with a small cyclical sine term so paths are not perfectly straight lines.",
                    },
                    {
                      t: "2 · Volatility bands",
                      f: "band(t) = avg(t) × (1 ± σ·√(t/10))",
                      d: "Uncertainty widens with the square root of time — low/high scenarios stay tight near today and fan out over the decade.",
                    },
                    {
                      t: "3 · Factor adjustments",
                      f: "adj(t) = 1 + Σ driftᵢ × (t/10)",
                      d: "Each key driver contributes a small cumulative drift that ramps up over the horizon, clamped to ±18%.",
                    },
                  ].map((b) => (
                    <div key={b.t} className="rounded-xl border border-line bg-base/40 p-4">
                      <p className="text-xs font-semibold text-teal-400 dark:text-teal-300">{b.t}</p>
                      <p className="mt-2 font-mono text-[11px] text-slate-600 dark:text-slate-500">{b.f}</p>
                      <p className="mt-2 text-xs text-slate-700 dark:text-slate-500">{b.d}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-xs">
<thead>
                      <tr className="border-b border-line text-slate-700 dark:text-slate-500">
                        <th className="py-2 pr-4 font-semibold">Commodity</th>
                        <th className="py-2 pr-4 font-semibold">Base (today)</th>
                        <th className="py-2 pr-4 font-semibold">CAGR</th>
                        <th className="py-2 pr-4 font-semibold">σ @ 10y</th>
                        <th className="py-2 font-semibold">Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COMMODITIES.map((c) => (
                        <tr key={c.id} className="border-b border-line/50 text-slate-600 dark:text-slate-500">
                          <td className="py-2.5 pr-4 font-medium">{c.name}</td>
                          <td className="py-2.5 pr-4 tabular-nums">
                            {formatPrice(prices[c.id], selectedCurrency)} / {c.unit.replace("USD", selectedCurrency)}
                          </td>
                          <td className="py-2.5 pr-4">+{(c.cagr * 100).toFixed(1)}%</td>
                          <td className="py-2.5 pr-4">±{(c.maxVol * 100).toFixed(0)}%</td>
                          <td className="py-2.5 text-slate-700 dark:text-slate-500">
                            {c.id === "oil"
                              ? "EIA · ICE Brent"
                              : c.id === "electricity"
                              ? "GlobalPetrolPrices · IEA"
                              : "UN-Water · GWI"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                  <p className="mt-5 text-xs text-slate-700 dark:text-slate-500">
                   The live feed polls /api/prices every 60 seconds, so spot prices,
                   cards, chart, table and regional evaluation update automatically —
                   no clicking required. It auto-pauses when the browser tab is hidden
                   and can be paused manually. The Refresh action re-fetches prices with
                   force=true from the API.
                 </p>
              </div>
            )}
          </div>
        </Reveal>

        {/* disclaimer */}
        <div className="mt-6 flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p>
            <span className="font-semibold text-amber-200">Disclaimer.</span>
            Real commodity markets are influenced by many unpredictable factors, and actual prices
            may differ materially from any scenario shown here.
          </p>
        </div>

        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        <p className="mt-4 text-center text-[11px] text-slate-600">
          Last updated <span suppressHydrationWarning>{fmtTime(lastUpdated)}</span>. Model uses
          publicly available drivers.
        </p>
      </div>
    </section>
  );
}
