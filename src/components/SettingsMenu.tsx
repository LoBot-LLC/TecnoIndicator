"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  FontSizes,
  Moon,
  Ruler,
  Settings,
  Sun,
  Zap,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useCurrency, ALL_CURRENCIES } from "../context/CurrencyContext";
import { useSettings, FONT_OPTIONS } from "../context/SettingsContext";

const TABS: Array<{ id: "fonts" | "units"; label: string; icon: JSX.Element }> = [
  { id: "fonts", label: "Fonts & Themes", icon: <FontSizes className="h-4 w-4" /> },
  { id: "units", label: "Unit Conversion", icon: <Ruler className="h-4 w-4" /> },
];

export default function SettingsMenu({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { selectedCurrency, setSelectedCurrency, currencies } = useCurrency();
  const {
    fontFamily,
    setFontFamily,
    lengthUnit,
    setLengthUnit,
    energyUnit,
    setEnergyUnit,
    energyUnitLabel,
    lengthUnitLabel,
  } = useSettings();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"fonts" | "units">("fonts");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => setOpen((v) => !v);

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label="Settings"
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel/5 text-slate-800 dark:text-slate-100 transition-all duration-200 hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-200"
      >
        <Settings className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-50 w-80 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-slate-900/50 dark:shadow-black/50">
          <div className="border-b border-line px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
              Settings
            </p>
            <div className="flex gap-1 mt-2">
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      active
                        ? "bg-teal-400/15 text-teal-600 dark:text-teal-200"
                        : "text-slate-600 hover:bg-slate-100/50 dark:text-slate-400 dark:hover:bg-panel/10 dark:hover:text-teal-200"
                    }`}
                  >
                    {t.icon} <span className="hidden sm:inline">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-4 py-3 space-y-5">
            {tab === "fonts" ? (
              <FontsSection
                theme={theme}
                setTheme={setTheme}
                fontFamily={fontFamily}
                setFontFamily={setFontFamily}
              />
            ) : (
              <UnitsSection
                selectedCurrency={selectedCurrency}
                setSelectedCurrency={setSelectedCurrency}
                currencies={currencies}
                lengthUnit={lengthUnit}
                setLengthUnit={setLengthUnit}
                energyUnit={energyUnit}
                setEnergyUnit={setEnergyUnit}
                energyUnitLabel={energyUnitLabel}
                lengthUnitLabel={lengthUnitLabel}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Fonts & Themes section ---------------- */

function FontsSection({
  theme,
  setTheme,
  fontFamily,
  setFontFamily,
}: {
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  fontFamily: string;
  setFontFamily: (f: string) => void;
}) {
  return (
    <>
      <section className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
          Color theme
        </p>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as "light" | "dark")}
          className="w-full rounded-lg border border-line bg-panel/5 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-teal-400/40 focus:outline-none"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          Choose the site color theme.
        </p>
      </section>

      <section className="mt-4 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
          Body font
        </p>
        <select
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          className="w-full rounded-lg border border-line bg-panel/5 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-teal-400/40 focus:outline-none"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          Font families sourced from GlobalFonts.pro / Google Fonts.
        </p>
      </section>
    </>
  );
}

/* ---------------- Unit Conversion section ---------------- */

function UnitsSection({
  selectedCurrency,
  setSelectedCurrency,
  currencies,
  lengthUnit,
  setLengthUnit,
  energyUnit,
  setEnergyUnit,
  energyUnitLabel,
  lengthUnitLabel,
}: {
  selectedCurrency: string;
  setSelectedCurrency: (code: string) => void;
  currencies: typeof ALL_CURRENCIES;
  lengthUnit: "meter" | "feet";
  setLengthUnit: (u: "meter" | "feet") => void;
  energyUnit: "MWh" | "kWh" | "joule";
  setEnergyUnit: (u: "MWh" | "kWh" | "joule") => void;
  energyUnitLabel: () => string;
  lengthUnitLabel: () => string;
}) {
  return (
    <>
      <section className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
          Currency
        </p>
        <select
          value={selectedCurrency}
          onChange={(e) => setSelectedCurrency(e.target.value)}
          className="w-full rounded-lg border border-line bg-panel/5 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-teal-400/40 focus:outline-none"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.symbol || c.code} · {c.code}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          Exchange rates update in real time.
        </p>
      </section>

      <section className="mt-4 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
          Length / volume
        </p>
        <select
          value={lengthUnit}
          onChange={(e) => setLengthUnit(e.target.value as "meter" | "feet")}
          className="w-full rounded-lg border border-line bg-panel/5 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-teal-400/40 focus:outline-none"
        >
          <option value="meter">Meter (m³)</option>
          <option value="feet">Feet (ft³)</option>
        </select>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          Water volume unit (1 m³ = 35.3147 ft³).
        </p>
      </section>

      <section className="mt-4 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
          Energy
        </p>
        <select
          value={energyUnit}
          onChange={(e) => setEnergyUnit(e.target.value as "MWh" | "kWh" | "joule")}
          className="w-full rounded-lg border border-line bg-panel/5 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-teal-400/40 focus:outline-none"
        >
          <option value="MWh">Megawatt-hour (MWh)</option>
          <option value="kWh">Kilowatt-hour (kWh)</option>
          <option value="joule">Joule (J)</option>
        </select>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          Electricity energy unit (1 MWh = 1,000 kWh = 3.6e9 J).
        </p>
      </section>
    </>
  );
}
