"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ALL_CURRENCIES,
  DEFAULT_CURRENCY,
  getCurrencyInfo,
  type CurrencyInfo,
} from "../lib/currencies";

const STORAGE_KEY = "tecno.currency";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/** Set of every currency code we actually know about. */
const VALID_CODES = new Set<string>(ALL_CURRENCIES.map((c) => c.code));

export interface CurrencyContextValue {
  selectedCurrency: string;
  setSelectedCurrency: (code: string) => void;
  rates: Record<string, number> | null;
  isLoading: boolean;
  error: string | null;
  convertPrice: (usd: number, code: string) => number;
  formatPrice: (usd: number, code: string) => string;
  getCurrencyInfo: (code: string) => CurrencyInfo;
  currencies: CurrencyInfo[];
  /**
   * True when the currently selected currency has no usable USD rate, so
   * prices silently degrade to raw USD numbers. Consumers can use this to warn
   * the user instead of showing a USD amount stamped with a foreign symbol.
   *
   * Always false while `rates` is still null (not loaded yet) so the UI does
   * not flash a warning on every page load.
   */
  rateUnavailable: boolean;
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

interface RatesResponse {
  base?: string;
  rates?: Record<string, number>;
  timestamp?: string;
  source?: string;
  stale?: boolean;
}

function isValidCode(code: string): boolean {
  return VALID_CODES.has(code.toUpperCase());
}

/**
 * Whether a usable USD rate exists for `code`.
 *
 * When `rates` is still null (not loaded yet) we optimistically return true so
 * consumers do not grey out or warn during the initial load. Only once rates
 * have actually been fetched does a missing entry mean "this provider cannot
 * quote this currency" (e.g. SVC, KPW).
 */
export function hasUsableRate(code: string, rates: Record<string, number> | null): boolean {
  if (code === "USD") return true;
  if (rates == null) return true;
  const rate = rates[code];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/**
 * Pull only the rates for currencies we have a definition for, so we never
 * expose a rate that cannot be formatted.
 */
function sanitizeRates(raw: Record<string, number> | undefined | null): Record<string, number> {
  const clean: Record<string, number> = { USD: 1 };
  if (!raw || typeof raw !== "object") return clean;
  for (const [code, rate] of Object.entries(raw)) {
    if (!isValidCode(code)) continue;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) continue;
    clean[code.toUpperCase()] = rate;
  }
  return clean;
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  // Always start from the default on both server and client so the very first
  // render is identical (no hydration mismatch). The stored preference is
  // applied in an effect, after hydration.
  const [selectedCurrency, setSelectedCurrencyState] = useState<string>(DEFAULT_CURRENCY);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Hydration-safe read of the persisted preference.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && isValidCode(stored)) {
        setSelectedCurrencyState(stored.toUpperCase());
      }
    } catch {
      // localStorage can be unavailable (private mode, blocked cookies) — ignore.
    }
  }, []);

  // Rates come from our own API route, which handles caching/fallbacks.
  useEffect(() => {
    let cancelled = false;

    const loadRates = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch("/api/rates", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to load exchange rates (HTTP ${response.status})`);
        }
        const data = (await response.json()) as RatesResponse;
        if (cancelled) return;
        setRates(sanitizeRates(data?.rates));
      } catch (err) {
        if (cancelled) return;
        // Keep rates as-is (null on first load) and degrade to USD pricing.
        setRates(null);
        setError(err instanceof Error ? err.message : "Failed to fetch exchange rates");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadRates();
    const interval = setInterval(() => {
      void loadRates();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const convertPrice = useCallback(
    (usd: number, code: string): number => {
      if (!Number.isFinite(usd)) return usd;
      if (code === DEFAULT_CURRENCY) return usd;
      const rate = rates?.[code];
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return usd;
      return usd * rate;
    },
    [rates]
  );

  const formatPrice = useCallback(
    (usd: number, code: string): string => {
      const info = getCurrencyInfo(code);
      const value = convertPrice(usd, code);

      if (!Number.isFinite(value)) return "—";

      const formatted = value.toLocaleString("en-US", {
        minimumFractionDigits: info.decimals,
        maximumFractionDigits: info.decimals,
      });

      const symbol = info.symbol && info.symbol.length > 0 ? info.symbol : `${info.code}\u00A0`;
      return `${symbol}${formatted}`;
    },
    [convertPrice]
  );

  const setSelectedCurrency = useCallback(
    (code: string) => {
      if (!code || !isValidCode(code)) return;

      const normalized = code.toUpperCase();

      // Re-picking the current currency must not trigger a reload loop.
      if (normalized === selectedCurrency) return;

      setSelectedCurrencyState(normalized);

      try {
        window.localStorage.setItem(STORAGE_KEY, normalized);
      } catch {
        // Persisting failed; still reload so the in-memory choice applies.
      }

      // The user asked for the site to reload so all content re-renders in
      // the newly chosen currency.
      window.location.reload();
    },
    [selectedCurrency]
  );

  const rateUnavailable = !hasUsableRate(selectedCurrency, rates);

  const value = useMemo<CurrencyContextValue>(
    () => ({
      selectedCurrency,
      setSelectedCurrency,
      rates,
      isLoading,
      error,
      convertPrice,
      formatPrice,
      getCurrencyInfo,
      currencies: ALL_CURRENCIES,
      rateUnavailable,
    }),
    [
      selectedCurrency,
      setSelectedCurrency,
      rates,
      isLoading,
      error,
      convertPrice,
      formatPrice,
      rateUnavailable,
    ]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyContextValue {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}

export { ALL_CURRENCIES, DEFAULT_CURRENCY };
