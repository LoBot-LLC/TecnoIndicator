import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useCurrency } from "../context/CurrencyContext";
import type { CurrencyInfo } from "../lib/currencies";

interface CurrencySelectorProps {
  className?: string;
}

export default function CurrencySelector({ className = "" }: CurrencySelectorProps) {
  const { selectedCurrency, setSelectedCurrency, getCurrencyInfo, currencies } = useCurrency();
  const [open, setOpen] = useState(false);

  const current = getCurrencyInfo(selectedCurrency);

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Select currency"
        className="flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-teal-400/40 hover:text-white"
      >
        <span className="text-base" title={current.name}>
          {current.symbol || current.code}
        </span>
        <span className="hidden sm:inline text-xs text-slate-400">{current.code}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-64 max-h-96 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/50 z-50"
          role="menu"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Select Currency
            </p>
          </div>
          <div className="overflow-y-auto max-h-80">
            {currencies.map((c: CurrencyInfo) => {
              const isActive = c.code === selectedCurrency;
              return (
                <button
                  key={c.code}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSelectedCurrency(c.code);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-teal-400/15 text-teal-200"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span className="w-6 text-center text-base" title={c.name}>
                    {c.symbol || c.code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-[10px] text-slate-500">
                      {c.code} · {c.countries.length} {c.countries.length === 1 ? "country" : "countries"}
                    </p>
                  </div>
                  {isActive && (
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}