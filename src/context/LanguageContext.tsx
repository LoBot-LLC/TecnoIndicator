"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  isLocale,
  LOCALE_META,
  SUPPORTED_LOCALES,
  translate,
  type Locale,
  type LocaleMeta,
} from "../lib/i18n";

const STORAGE_KEY = "tecno.language";

/** Fallback for browsers and environments without a stored preference. */
const DEFAULT_LOCALE: Locale = "en";

export interface LanguageContextValue {
  /** Currently active UI language. */
  locale: Locale;
  /**
   * Switch the UI language and persist the choice. Does not reload the page;
   * consumers re-render through context.
   */
  setLocale: (locale: Locale) => void;
  /**
   * Translate an English source string, optionally interpolating `{name}`
   * placeholders from `vars`.
   */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Every selectable language, for the settings picker. */
  locales: LocaleMeta[];
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Always start in English on both server and client so the first render is
  // identical (no hydration mismatch). The stored preference is applied after
  // hydration, in an effect.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Hydration-safe read of the persisted preference.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(stored)) setLocaleState(stored);
    } catch {
      // localStorage can be unavailable (private mode, blocked cookies) — ignore.
    }
  }, []);

  // Keep the document language in sync for a11y, SEO and correct text rendering.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting failed; the in-memory choice still applies.
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, t, locales: LOCALE_META }),
    [locale, setLocale, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}

export { STORAGE_KEY, DEFAULT_LOCALE, SUPPORTED_LOCALES };
