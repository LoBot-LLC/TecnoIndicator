"use client";

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import {
  Type,
  Ruler,
  Settings,
  X,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useCurrency, ALL_CURRENCIES } from "../context/CurrencyContext";
import { useSettings, FONT_OPTIONS } from "../context/SettingsContext";

const TABS: Array<{
  id: "fonts" | "units";
  label: string;
  icon: ReactElement;
  description: string;
}> = [
  {
    id: "fonts",
    label: "Fonts & Themes",
    icon: <Type className="h-5 w-5" />,
    description: "Color theme and body font",
  },
  {
    id: "units",
    label: "Unit Conversion",
    icon: <Ruler className="h-5 w-5" />,
    description: "Currency, length & energy units",
  },
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
  } = useSettings();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"fonts" | "units">("fonts");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const toggle = () => setOpen((v) => !v);

  if (!open) {
    return (
      <div className={`relative ${className}`}>
        <button
          type="button"
          onClick={toggle}
          aria-label="Settings"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel/5 text-slate-800 dark:text-slate-100 transition-all duration-200 hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-200"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-[100] p-4 ${className}`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={() => setOpen(false)}
      />
      {/* Modal */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-slate-900/50 dark:shadow-black/70 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-line">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6 text-teal-400" />
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Settings</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Customize your preferences
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close settings"
            className="rounded-lg bg-base/30 p-1.5 text-slate-600 dark:text-slate-400 hover:bg-teal-400/10 hover:text-teal-600 dark:hover:bg-panel/10 dark:hover:text-teal-200 transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left nav */}
          <nav className="w-64 border-r border-line bg-base/30 flex flex-col">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-3 px-6 py-4 text-sm transition-all border-l-2 ${
                    active
                      ? "bg-teal-400/10 text-teal-600 dark:text-teal-200 border-teal-400 dark:border-teal-300"
                      : "text-slate-600 dark:text-slate-400 hover:bg-panel/5 dark:hover:bg-panel/10 hover:text-slate-900 dark:hover:text-slate-100 border-transparent"
                  }`}
                >
                  {t.icon}
                  <div className="flex-1 text-left">
                    <p className="font-medium leading-tight">{t.label}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-500 leading-tight mt-0.5">
                      {t.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Right content */}
          <div className="flex-1 overflow-y-auto px-8 py-6 bg-panel">
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
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Fonts & Themes</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Customize the appearance of the interface
        </p>
      </div>

      <section className="mb-8">
        <label className="block mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          Color Theme
        </label>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as "light" | "dark")}
          className="w-full max-w-xs rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
          Choose between light and dark mode
        </p>
      </section>

      <section>
        <label className="block mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          Body Font
        </label>
        <select
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
          Font families from GlobalFonts.pro / Google Fonts
        </p>
      </section>
    </>
  );
}

function UnitsSection({
  selectedCurrency,
  setSelectedCurrency,
  currencies,
  lengthUnit,
  setLengthUnit,
  energyUnit,
  setEnergyUnit,
}: {
  selectedCurrency: string;
  setSelectedCurrency: (code: string) => void;
  currencies: typeof ALL_CURRENCIES;
  lengthUnit: "meter" | "feet";
  setLengthUnit: (u: "meter" | "feet") => void;
  energyUnit: "MWh" | "kWh" | "joule";
  setEnergyUnit: (u: "MWh" | "kWh" | "joule") => void;
}) {
  return (
    <>
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Unit Conversion</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Configure currency and measurement units
        </p>
      </div>

      <section className="mb-8">
        <label className="block mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          Currency
        </label>
        <select
          value={selectedCurrency}
          onChange={(e) => setSelectedCurrency(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.symbol || c.code} · {c.code}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
          Exchange rates update in real time
        </p>
      </section>

      <section className="mb-8">
        <label className="block mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          Length / Volume
        </label>
        <select
          value={lengthUnit}
          onChange={(e) => setLengthUnit(e.target.value as "meter" | "feet")}
          className="w-full max-w-xs rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
        >
          <option value="meter">Meter (m³)</option>
          <option value="feet">Feet (ft³)</option>
        </select>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
          1 m³ = 35.3147 ft³
        </p>
      </section>

      <section>
        <label className="block mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          Energy
        </label>
        <select
          value={energyUnit}
          onChange={(e) => setEnergyUnit(e.target.value as "MWh" | "kWh" | "joule")}
          className="w-full max-w-xs rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
        >
          <option value="MWh">Megawatt-hour (MWh)</option>
          <option value="kWh">Kilowatt-hour (kWh)</option>
          <option value="joule">Joule (J)</option>
        </select>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
          1 MWh = 1,000 kWh = 3.6e9 J
        </p>
      </section>
    </>
  );
}
