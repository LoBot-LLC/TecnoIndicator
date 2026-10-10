import { AlertTriangle, BarChart3, FunctionSquare, Globe2, ShieldAlert, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Reveal from "./Reveal";
import { useCurrency } from "../context/CurrencyContext";

/** Renders a USD amount in the selected currency, always with 2 decimals. */
type MoneyFormatter = (usd: number) => string;

interface Method {
  icon: LucideIcon;
  color: string;
  title: string;
  text: (money: MoneyFormatter) => string;
}

const SOURCES = [
  "EIA Short-Term Energy Outlook",
  "IEA World Energy Outlook",
  "OPEC Market Reports",
  "GlobalPetrolPrices (Q1 2026)",
  "IRENA",
  "UN-Water",
  "FAO AQUASTAT",
  "World Bank",
  "WRI Aqueduct",
  "ICE Brent / NYMEX WTI / Dubai-Oman",
];

const METHODS: Method[] = [
  {
    icon: BarChart3,
    color: "#f5b840",
    title: "Base trend",
    text: (money) =>
      `Each series starts from a realistic market price — Brent around ${money(105)}/bbl, global power near ${money(166)}/MWh, and global water near ${money(2.5)}/m³ — then compounds at a structural CAGR of 3.8–5.0% depending on the commodity. Regional modes remap to WTI, Dubai/Oman, WAF and local retail tariffs.`,
  },
  {
    icon: Workflow,
    color: "#2dd4bf",
    title: "Volatility bands",
    text: () =>
      "Low and high scenarios widen with the square root of time, reflecting how forecast uncertainty genuinely grows. At a 10-year horizon the bands span roughly ±22–34% around the average path, with Africa and Asia carrying higher regional vol adjustments.",
  },
  {
    icon: FunctionSquare,
    color: "#38bdf8",
    title: "Factor adjustments",
    text: () =>
      "Twelve researched drivers — from OPEC+ policy to water scarcity — each contribute a small drift that ramps up over the horizon, so the model stays explainable rather than being a black box.",
  },
  {
    icon: Globe2,
    color: "#a78bfa",
    title: "Five-region evaluation",
    text: (money) =>
      `Americas, Europe, Asia, Africa and Oceania are scored live using research-backed oil markers and 2026 retail electricity/water benchmarks (Europe & Oceania power ~${money(0.26)}/kWh, Asia ~${money(0.09)}/kWh, Americas mid-range).`,
  },
];

export default function AboutSection() {
  const { selectedCurrency, convertPrice, getCurrencyInfo } = useCurrency();

  /**
   * Prices in the prose above must not collapse to 0 for zero-decimal
   * currencies (e.g. JPY rendering 0.09 as "¥0"), so they always keep two
   * decimals regardless of the currency's own minor unit.
   */
  const money: MoneyFormatter = (usd) => {
    const info = getCurrencyInfo(selectedCurrency);
    const value = convertPrice(usd, selectedCurrency);
    if (!Number.isFinite(value)) return "—";
    const symbol = info.symbol && info.symbol.length > 0 ? info.symbol : `${info.code}\u00A0`;
    return `${symbol}${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  return (
    <section id="about" className="relative scroll-mt-20 border-t border-line py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-400 dark:text-teal-300/80">
              Transparency
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              About the model
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-500">
              TecnoIndicator is a demonstration of modern front-end data visualization: every number
              is computed in your browser from publicly known drivers, with no backend and no API
              keys. The goal is an honest, explorable illustration of how forecasters think about
              uncertainty — not a crystal ball.
            </p>
          </div>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {METHODS.map((m, i) => {
            const Icon = m.icon;
            return (
              <Reveal key={m.title} delay={i * 70}>
                <div className="h-full rounded-2xl border border-line bg-panel/60 p-5 sm:p-6">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200/5 dark:border-white/5"
                    style={{ background: `${m.color}18`, color: m.color }}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-semibold text-slate-900 dark:text-white">{m.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-500">{m.text(money)}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={200}>
          <div className="mt-8 rounded-2xl border border-line bg-panel/50 p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-teal-400 dark:text-teal-300" />
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Public data & reasoning sources
              </h3>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-500">
              Base prices, growth rates, regional differentials and driver narratives are grounded
              in publicly available research.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SOURCES.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-line bg-base/40 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-500"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={240}>
          <div className="mt-6 flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p>
              <span className="font-semibold text-amber-200">Important.</span>
              The live water quote is a simulated client-side feed within a realistic global price
              band — always verify against licensed data providers before making decisions.
            </p>
          </div>
        </Reveal>

        <Reveal delay={280}>
          <p className="mt-8 text-center text-sm text-slate-700 dark:text-slate-500">
            Want to run your own scenarios? Press{" "}
            <kbd className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-xs text-teal-400 dark:text-teal-300">
              /
            </kbd>{" "}
            to jump to the horizon slider and watch the cards, chart, regions and factor grid respond
            in real time.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
