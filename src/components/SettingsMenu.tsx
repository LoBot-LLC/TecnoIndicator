"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Palette, Ruler, Search, SlidersHorizontal, X, Zap } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useCurrency } from "../context/CurrencyContext";
import { useUnit } from "../context/UnitContext";
import { useFont } from "../context/FontContext";
import { ENERGY_UNITS, LENGTH_UNITS, type EnergyUnit, type LengthUnit } from "../lib/units";

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [currencyQuery, setCurrencyQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { theme, setTheme } = useTheme();
  const { selectedCurrency, setSelectedCurrency, currencies, rates, isLoading } = useCurrency();
  const { lengthUnit, setLengthUnit, energyUnit, setEnergyUnit } = useUnit();
  const { fontKey, setFontKey, fonts, current } = useFont();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
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

  const filteredCurrencies = useMemo(() => {
    const q = currencyQuery.trim().toLowerCase();
    if (!q) return currencies;
    return currencies.filter(
      (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [currencies, currencyQuery]);

  const ratesPending = rates === null || isLoading;

  const panel =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Settings"
            className="fixed right-4 top-[72px] z-50 w-[min(380px,calc(100vw-2rem))] max-h-[80vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-4 py-3">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">Settings</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel/5 text-slate-600 hover:text-teal-600 dark:text-slate-300 dark:hover:text-teal-200"
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              {/* Appearance */}
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">
                  Fonts &amp; themes
                </h3>
              </div>

              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Color theme</span>
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as "light" | "dark")}
                    className="w-full rounded-lg border border-line bg-panel/5 px-3 py-2 text-sm text-slate-800 focus:border-teal-400/40 focus:outline-none dark:text-slate-100"
                  >
                    <option value="light" className="text-slate-800 dark:text-slate-100 dark:bg-slate-800">
                      Light
                    </option>
                    <option value="dark" className="text-slate-800 dark:text-slate-100 dark:bg-slate-800">
                      Dark
                    </option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Font</span>
                  <select
                    value={fontKey}
                    onChange={(e) => setFontKey(e.target.value)}
                    className="w-full rounded-lg border border-line bg-panel/5 px-3 py-2 text-sm text-slate-800 focus:border-teal-400/40 focus:outline-none dark:text-slate-100"
                  >
                    {fonts.map((f) => (
                      <option key={f.key} value={f.key} className="text-slate-800 dark:text-slate-100 dark:bg-slate-800">
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <p
                    className="mt-1.5 text-xs text-slate-600 dark:text-slate-400"
                    style={{ fontFamily: current.family }}
                  >
                    Preview: The quick brown fox — 012345
                  </p>
                </label>
              </div>

              <hr className="my-4 border-line" />

              {/* Unit conversion */}
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4 text-teal-600 dark:text-teal-300" />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">
                  Unit conversion
                </h3>
              </div>

              <div className="mt-3 space-y-3">
                <div className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Currency</span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={currencyQuery}
                      onChange={(e) => setCurrencyQuery(e.target.value)}
                      placeholder="Search currency…"
                      aria-label="Search currencies"
                      className="w-full rounded-lg border border-line bg-panel/5 py-1.5 pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-500 focus:border-teal-400/40 focus:outline-none dark:text-slate-100"
                    />
                  </div>
                  <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-line">
                    {filteredCurrencies.map((c) => {
                      const active = c.code === selectedCurrency;
                      const noRate =
                        !ratesPending &&
                        rates !== null &&
                        c.code !== "USD" &&
                        !(typeof rates[c.code] === "number" && Number.isFinite(rates[c.code]) && rates[c.code] > 0);
                      return (
                        <button
                          key={c.code}
                          type="button"
                          disabled={noRate}
                          onClick={() => {
                            if (noRate || active) return;
                            // CurrencyContext.setSelectedCurrency triggers a reload by design.
                            setSelectedCurrency(c.code);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                            noRate
                              ? "cursor-not-allowed opacity-50"
                              : active
                                ? "bg-teal-400/15 text-teal-700 dark:text-teal-200"
                                : "text-slate-700 hover:bg-slate-100/50 dark:text-slate-200 dark:hover:bg-panel/10"
                          }`}
                        >
                          <span className="w-9 font-mono text-[10px] uppercase text-slate-500">{c.code}</span>
                          <span className="flex-1 truncate">{c.name}</span>
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Length / volume</span>
                  <select
                    value={lengthUnit}
                    onChange={(e) => setLengthUnit(e.target.value as LengthUnit)}
                    className="w-full rounded-lg border border-line bg-panel/5 px-3 py-2 text-sm text-slate-800 focus:border-teal-400/40 focus:outline-none dark:text-slate-100"
                  >
                    {LENGTH_UNITS.map((u) => (
                      <option key={u.id} value={u.id} className="text-slate-800 dark:text-slate-100 dark:bg-slate-800">
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <Zap className="h-3.5 w-3.5" /> Energy
                  </span>
                  <select
                    value={energyUnit}
                    onChange={(e) => setEnergyUnit(e.target.value as EnergyUnit)}
                    className="w-full rounded-lg border border-line bg-panel/5 px-3 py-2 text-sm text-slate-800 focus:border-teal-400/40 focus:outline-none dark:text-slate-100"
                  >
                    {ENERGY_UNITS.map((u) => (
                      <option key={u.id} value={u.id} className="text-slate-800 dark:text-slate-100 dark:bg-slate-800">
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className="mt-4 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                Unit conversions update in real time. Currency selection reloads to apply across all data.
              </p>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel/5 text-slate-800 transition-all duration-200 hover:border-teal-400/40 hover:text-teal-600 dark:text-slate-100 dark:hover:text-teal-200"
      >
        <SlidersHorizontal className="h-4.5 w-4.5" />
      </button>
      {panel}
    </>
  );
}
