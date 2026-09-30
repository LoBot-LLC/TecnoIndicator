import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useCurrency } from "../context/CurrencyContext";
import type { CurrencyInfo } from "../lib/currencies";

interface CurrencySelectorProps {
  className?: string;
}

export default function CurrencySelector({ className = "" }: CurrencySelectorProps) {
  const { selectedCurrency, setSelectedCurrency, getCurrencyInfo, currencies, rates, isLoading } =
    useCurrency();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const current = getCurrencyInfo(selectedCurrency);

  // Rates not loaded yet: assume every currency is available so the list is
  // never greyed out on first paint. Once loaded, a missing entry means the
  // provider genuinely cannot quote that currency (SVC, KPW).
  const ratesPending = rates === null || isLoading;

  const unavailableCodes = useMemo(() => {
    if (ratesPending || rates === null) return new Set<string>();
    const set = new Set<string>();
    for (const c of currencies) {
      const rate = rates[c.code];
      if (c.code === "USD") continue;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) set.add(c.code);
    }
    return set;
  }, [currencies, rates, ratesPending]);

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

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return currencies;
    return currencies.filter(
      (c: CurrencyInfo) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
  }, [currencies, query]);

  const close = () => {
    setQuery("");
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
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
        <div className="absolute right-0 mt-2 z-50 w-72 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/50">
          <div className="border-b border-line px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Select Currency
            </p>
            <div className="relative mt-2.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") close();
                }}
                placeholder="Search code or name…"
                aria-label="Search currencies"
                className="w-full rounded-lg border border-line bg-white/[0.03] py-1.5 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-600 transition-colors focus:border-teal-400/40 focus:outline-none"
              />
            </div>
            <p className="mt-2 text-[10px] tabular-nums text-slate-500">
              {results.length} of {currencies.length}
            </p>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No match</p>
            ) : (
              results.map((c: CurrencyInfo) => {
                const isActive = c.code === selectedCurrency;
                const noRate = unavailableCodes.has(c.code);
                return (
                  <button
                    key={c.code}
                    type="button"
                    disabled={noRate}
                    aria-disabled={noRate || undefined}
                    title={
                      noRate
                        ? `${c.name} (${c.code}): no exchange rate available from our rate provider, so prices cannot be converted.`
                        : undefined
                    }
                    onClick={() => {
                      if (noRate) return;
                      if (!isActive) setSelectedCurrency(c.code);
                      close();
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      noRate
                        ? "cursor-not-allowed text-slate-500 opacity-50"
                        : isActive
                          ? "bg-teal-400/15 text-teal-200"
                          : "text-slate-300 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className="w-9 shrink-0 rounded-md border border-line bg-white/[0.03] px-1 py-0.5 text-center font-mono text-[10px] uppercase tracking-wider text-slate-300">
                      {c.code}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">
                      {c.name}
                    </span>
                    {noRate ? (
                      <span className="shrink-0 rounded-full border border-slate-600/60 bg-white/5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400">
                        No rate
                      </span>
                    ) : (
                      isActive && <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
