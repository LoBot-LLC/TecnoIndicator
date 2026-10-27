"use client";

import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Droplets,
  Fuel,
  Globe2,
  Radio,
  Zap,
} from "lucide-react";
import Reveal from "./Reveal";
import Ticker from "./Ticker";
import { useFlash } from "../hook/useFlash";
import { useCurrency } from "../context/CurrencyContext";
import { useSettings } from "../context/SettingsContext";
import {
  COMMODITIES,
  fmtFullDate,
  generateForecast,
  START_YEAR,
  type CommodityId,
  type ForecastPoint,
} from "../lib/model";

function forecastPath(
  points: ForecastPoint[],
  id: CommodityId,
  width: number,
  height: number,
  yMin: number,
  yMax: number,
): string {
  const padTop = height * 0.12;
  const padBottom = height * 0.14;
  const plotHeight = height - padTop - padBottom;
  const range = yMax - yMin || 1;
  const last = Math.max(points.length - 1, 1);
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const x = (i / last) * width;
    const y = height - padBottom - ((points[i][id].avg - yMin) / range) * plotHeight;
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function LivePrice({ value, convert }: { value: number; convert?: (v: number) => number }) {
  const flash = useFlash(value);
  const { selectedCurrency, formatPrice } = useCurrency();
  const displayValue = convert ? convert(value) : value;
  return (
    <span className={`font-display text-lg font-semibold tabular-nums text-slate-900 dark:text-white ${flash}`}>
      {formatPrice(displayValue, selectedCurrency)}
    </span>
  );
}

const STATS = [
  { value: "3", label: "Commodities" },
  { value: "5", label: "World regions" },
  { value: "10", label: "Year horizon" },
  { value: "12", label: "Key drivers" },
];

interface HeroProps {
  prices: Record<CommodityId, number>;
  deltas: Record<CommodityId, number>;
  /** Optional pre-computed forecast series; when omitted a default 10-year series is generated. */
  points?: ForecastPoint[];
  /** Forecast horizon in years; drives the x-axis extent and trajectory label. */
  horizon?: number;
}

export default function Hero({
  prices,
  deltas,
  points: pointsProp,
  horizon: horizonProp,
}: HeroProps) {
  const { selectedCurrency } = useCurrency();
  const { convertEnergy, convertLengthVolume, energyUnitLabel, lengthUnitLabel } = useSettings();

  const today = new Date();
  const horizon = horizonProp ?? 10;
  const forecastPoints =
    pointsProp ?? generateForecast(prices, horizon, 0, "global");
  const allAvgs: number[] = [];
  for (const p of forecastPoints) {
    for (const c of COMMODITIES) {
      const avg = p[c.id].avg;
      if (Number.isFinite(avg)) {
        allAvgs.push(avg);
      }
    }
  }
  const yMin = allAvgs.length ? Math.min(...allAvgs) : 0;
  const yMax = allAvgs.length ? Math.max(...allAvgs) : 1;
  const hasData = allAvgs.length > 0 && Number.isFinite(yMin) && Number.isFinite(yMax);

  const commodityRows: Array<{
    id: CommodityId;
    name: string;
    unit: string;
    icon: typeof Fuel;
    color: string;
    decimals: number;
    convert?: (v: number) => number;
  }> = [
    { id: "oil", name: "Brent Crude", unit: `${selectedCurrency}/bbl`, icon: Fuel, color: "#f5b840", decimals: 2 },
    {
      id: "electricity",
      name: "Electricity",
      unit: `${selectedCurrency}/${energyUnitLabel()}`,
      icon: Zap,
      color: "#2dd4bf",
      decimals: 1,
      convert: convertEnergy,
    },
    {
      id: "water",
      name: "Water",
      unit: `${selectedCurrency}/${lengthUnitLabel()}`,
      icon: Droplets,
      color: "#38bdf8",
      decimals: 2,
      convert: convertLengthVolume,
    },
  ];

  return (
    <section className="relative overflow-hidden">
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-grid mask-fade-y opacity-70 dark:opacity-50" />
        <div className="glow-teal absolute -left-24 top-10 h-72 w-72" />
        <div className="glow-amber absolute right-0 top-32 h-80 w-80" />
        <div className="glow-water absolute bottom-0 left-1/3 h-64 w-64" />
      </div>

      <div className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[1.15fr_0.95fr] lg:gap-10 lg:pb-20 lg:pt-20">
        {/* Copy */}
        <div>
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-200">
              <span className="relative flex h-2 w-2">
                <span className="ping-ring absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-400 pulse-dot" />
              </span>
              Live · Global commodity intelligence
            </div>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight text-slate-900 dark:text-white sm:text-5xl lg:text-[3.35rem]">
              Tecno
              <span className="text-teal-600 dark:text-teal-300">Indicator</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 dark:text-slate-500 sm:text-lg">
              Real-time 10-year forecasts for global{" "}
              <span className="font-medium text-oil">oil</span>,{" "}
              <span className="font-medium text-elec">electricity</span> &{" "}
              <span className="font-medium text-water">water</span> prices — with scenario bands,
              five-region evaluation, driver analysis and exportable analytics.
            </p>
          </Reveal>

<Reveal delay={140}>
            <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-500">
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-slate-600 dark:text-slate-500" />
                <span suppressHydrationWarning>{fmtFullDate(today)}</span>
              </span>
              <span className="hidden h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600 sm:inline-block" />
                <span className="inline-flex items-center gap-2">
                  <Globe2 className="h-4 w-4 text-slate-600 dark:text-slate-500" />
                  All figures in {selectedCurrency} · 5 regions
                </span>
            </div>
          </Reveal>

          <Reveal delay={180}>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#forecast"
                className="inline-flex items-center gap-2 rounded-xl bg-teal-400 px-5 py-3 text-sm font-semibold text-slate-900 shadow-[0_0_28px_rgba(45,212,191,0.35)] transition-all hover:bg-teal-300"
              >
                Start Forecast
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#regions"
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel/5 px-5 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100 transition-all hover:border-line-strong hover:bg-panel/10"
              >
                Evaluate Regions
              </a>
              <a
                href="#factors"
                className="inline-flex items-center gap-2 rounded-xl border border-transparent px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:text-teal-600 dark:text-slate-500 dark:hover:text-teal-200"
              >
                Explore Drivers
                <ChevronDown className="h-4 w-4" />
              </a>
            </div>
          </Reveal>

          <Reveal delay={220}>
            <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STATS.map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl border border-line bg-panel/50 px-4 py-4"
                >
                  <p className="font-display text-2xl font-bold text-slate-900 dark:text-white">{s.value}</p>
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-600 dark:text-slate-500">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        {/* Dashboard preview */}
        <Reveal delay={120} className="lg:pt-4">
          <div className="relative float-y rounded-3xl border border-line bg-panel/80 p-5 shadow-2xl shadow-slate-900/40 dark:shadow-slate-900/40 dark:shadow-black/40 backdrop-blur sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-500">
                  Market snapshot
                </p>
                <p className="mt-1 font-display text-lg font-semibold text-slate-900 dark:text-white">
                  Live global feed
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                <Radio className="h-3 w-3" />
                Live
              </div>
            </div>

            {/* projected chart */}
            <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-base/60 p-3">
              <svg viewBox="0 0 560 180" className="h-36 w-full" aria-hidden="true">
                {[36, 72, 108, 144].map((gy) => (
                  <line
                    key={gy}
                    x1="0"
                    x2="560"
                    y1={gy}
                    y2={gy}
                    stroke="rgba(148,163,184,0.08)"
                    className="dark:stroke-slate-700/20"
                  />
                ))}
                {hasData && (
                  <>
                    <path
                      d={forecastPath(forecastPoints, "oil", 560, 180, yMin, yMax)}
                      fill="none"
                      stroke="#f5b840"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                    <path
                      d={forecastPath(forecastPoints, "electricity", 560, 180, yMin, yMax)}
                      fill="none"
                      stroke="#2dd4bf"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      opacity="0.9"
                    />
                    <path
                      d={forecastPath(forecastPoints, "water", 560, 180, yMin, yMax)}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="2"
                      strokeLinecap="round"
                      opacity="0.85"
                    />
                  </>
                )}
              </svg>
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-500">
                <span suppressHydrationWarning>{START_YEAR}</span>
                <span>{horizon}-year trajectory</span>
                <span suppressHydrationWarning>{START_YEAR + horizon}</span>
              </div>
            </div>

            {/* rows */}
            <div className="mt-4 space-y-2.5">
              {commodityRows.map((r) => {
                const Icon = r.icon;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/3 px-3.5 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200/5 dark:border-slate-600/5"
                        style={{ background: `${r.color}18`, color: r.color }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{r.name}</p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-500">{r.unit}</p>
                      </div>
                    </div>
                    <LivePrice value={prices[r.id]} convert={r.convert} />
                  </div>
                );
              })}
            </div>

            {/* floating badge */}
            <div className="absolute -bottom-3 left-6 rounded-full border border-line bg-panel px-3 py-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-500 shadow-lg">
              Model runs 100% in-browser · Americas → Oceania
            </div>
          </div>
        </Reveal>
      </div>

      <Ticker prices={prices} deltas={deltas} />
    </section>
  );
}
