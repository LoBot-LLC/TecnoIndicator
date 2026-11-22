import { BarChart3, FunctionSquare, Globe2, Grid3x3, Search, ShieldAlert, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Reveal from "./Reveal";
import { useCurrency } from "../context/CurrencyContext";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslateFn } from "../i18n/LanguageContext";

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

function buildMethods(t: TranslateFn): Method[] {
  return [
    {
      icon: BarChart3,
      color: "#f5b840",
      title: t("about.m1Title"),
      text: (money) =>
        t("about.m1Text", { oil: money(105), power: money(166), water: money(2.5) }),
    },
    {
      icon: Workflow,
      color: "#2dd4bf",
      title: t("about.m2Title"),
      text: () => t("about.m2Text"),
    },
    {
      icon: FunctionSquare,
      color: "#38bdf8",
      title: t("about.m3Title"),
      text: () => t("about.m3Text"),
    },
    {
      icon: Globe2,
      color: "#a78bfa",
      title: t("about.m4Title"),
      text: (money) => t("about.m4Text", { euPower: money(0.26), asiaPower: money(0.09) }),
    },
    {
      icon: Search,
      color: "#6366f1",
      title: t("about.m5Title"),
      text: (money) => t("about.m5Text", { oil: money(105), power: money(166), water: money(2.5) }),
    },
    {
      icon: Grid3x3,
      color: "#ec4899",
      title: t("about.m6Title"),
      text: (money) => t("about.m6Text", { oil: money(105), power: money(166), water: money(2.5) }),
    },
  ];
}

export default function AboutSection() {
  const { selectedCurrency, convertPrice, getCurrencyInfo } = useCurrency();
  const { t } = useLanguage();
  const METHODS = buildMethods(t);

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
              {t("about.eyebrow")}
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              {t("about.title")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-500">
              {t("about.intro")}
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
                {t("about.sourcesTitle")}
              </h3>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-500">
              {t("about.sourcesText")}
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

        <Reveal delay={280}>
          <p className="mt-8 text-center text-sm text-slate-700 dark:text-slate-500">
            {t("about.shortcutBefore")}{" "}
            <kbd className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-xs text-teal-400 dark:text-teal-300">
              /
            </kbd>{" "}
            {t("about.shortcutAfter")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
