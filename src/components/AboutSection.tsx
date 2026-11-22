import { BarChart3, FunctionSquare, Globe2, Grid3x3, Search, ShieldAlert, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Reveal from "./Reveal";
import { useCurrency } from "../context/CurrencyContext";
import { useLanguage } from "../context/LanguageContext";
import { useTranslatedTexts } from "../hook/useTranslatedTexts";

/** Renders a USD amount in the selected currency, always with 2 decimals. */
type MoneyFormatter = (usd: number) => string;

/** Translate signature shared with `useLanguage()`, for plain helpers. */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

interface Method {
  icon: LucideIcon;
  color: string;
  title: string;
  text: (args: { money: MoneyFormatter; t: Translate }) => string;
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
    text: ({ money, t }) =>
      t("Each series starts from a realistic market price — Brent around {brent}/bbl, global power near {power}/MWh, and global water near {water}/m³ — then compounds at a structural CAGR of 3.8–5.0% depending on the commodity. Regional modes remap to WTI, Dubai/Oman, WAF and local retail tariffs.", {
        brent: money(105),
        power: money(166),
        water: money(2.5),
      }),
  },
  {
    icon: Workflow,
    color: "#2dd4bf",
    title: "Volatility bands",
    text: ({ t }) =>
      t("Low and high scenarios widen with the square root of time, reflecting how forecast uncertainty genuinely grows. At a 10-year horizon the bands span roughly ±22–34% around the average path, with Africa and Asia carrying higher regional vol adjustments."),
  },
  {
    icon: FunctionSquare,
    color: "#38bdf8",
    title: "Factor adjustments",
    text: ({ t }) =>
      t("Twelve researched drivers — from OPEC+ policy to water scarcity — each contribute a small drift that ramps up over the horizon, so the model stays explainable rather than being a black box."),
  },
  {
    icon: Globe2,
    color: "#a78bfa",
    title: "Five-region evaluation",
    text: ({ money, t }) =>
      t("Americas, Europe, Asia, Africa and Oceania are scored live using research-backed oil markers and 2026 retail electricity/water benchmarks (Europe & Oceania power ~{europePower}/kWh, Asia ~{asiaPower}/kWh, Americas mid-range).", {
        europePower: money(0.26),
        asiaPower: money(0.09),
      }),
  },
  {
    icon: Search,
    color: "#6366f1",
    title: "Web-grounded factor correlation",
    text: (money) =>
      `Each of the 8 key factors is sourced from live web searches via TinyFish, scraped articles, and before curation the current live spot prices (Brent, electricity, water) are injected as grounding data into the AI prompt. Every factor explanation opens with the exact live price shown in the "Live global feed" (e.g., "With oil at ${money(
        105
      )}/bbl, …"), ensuring a direct auditable link between the live market number on the dashboard and the driver narratives. Prices referenced: Brent around ${money(
        105
      )}/bbl, electricity ${money(166)}/MWh, water ${money(
        2.5
      )}/m³.`,
  },
  {
    icon: Grid3x3,
    color: "#ec4899",
    title: "Reason–price correlation",
    text: (money) =>
      `Each driver row in the Correlation matrix begins as a websearch-fetched reason (TinyFish search + scraped articles). The exact live spot prices shown in the "Live global feed" — Brent around ${money(
        105
      )}/bbl, electricity near ${money(166)}/MWh and water near ${money(
        2.5
      )}/m³ — anchor the forecast price path, while every reason is converted into a contribution series (direction × magnitude × importance, ramped across the horizon). Pearson's r then measures how tightly each reason's series tracks that live-anchored price path per commodity: +1 means it moves in lockstep, 0 means uncorrelated. A cell reads "n/a" only when the reason has no exposure or a series has zero variance, and oil/electricity/water shocks propagate through the energy–water nexus.`,
  },
];

export default function AboutSection() {
  const { t, locale } = useLanguage();
  const { selectedCurrency, convertPrice, getCurrencyInfo } = useCurrency();

  const translatedSources = useTranslatedTexts(SOURCES, locale);

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

  const [keyboardHintBefore, keyboardHintAfter] = t(
    "Want to run your own scenarios? Press {key} to jump to the horizon slider and watch the cards, chart, regions and factor grid respond in real time.",
  ).split("{key}");

  return (
    <section id="about" className="relative scroll-mt-20 border-t border-line py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-400 dark:text-teal-300/80">
              {t("Transparency")}
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              {t("About the model")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-500">
              {t("LoBot LLC is a demonstration of modern front-end data visualization: every number is computed in your browser from publicly known drivers, with no backend and no API keys. The goal is an honest, explorable illustration of how forecasters think about uncertainty — not a crystal ball.")}
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
                  <h3 className="mt-4 font-display text-lg font-semibold text-slate-900 dark:text-white">{t(m.title)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-500">{m.text({ money, t })}</p>
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
                {t("Public data & reasoning sources")}
              </h3>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-500">
              {t("Base prices, growth rates, regional differentials and driver narratives are grounded in publicly available research.")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SOURCES.map((s, i) => (
                <span
                  key={s}
                  className="rounded-full border border-line bg-base/40 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-500"
                >
                  {translatedSources[i] ?? s}
                </span>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={280}>
          <p className="mt-8 text-center text-sm text-slate-700 dark:text-slate-500">
            {keyboardHintBefore}
            <kbd className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-xs text-teal-400 dark:text-teal-300">
              /
            </kbd>
            {keyboardHintAfter ?? ""}
          </p>
        </Reveal>
      </div>
    </section>
  );
}