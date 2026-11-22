"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LANGUAGE,
  dictionaries,
  type Language,
  LANGUAGES,
  type TranslationKey,
} from "./dictionaries";

const STORAGE_KEY = "tecno.language";

export type TranslateFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslateFn;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}

function readStoredLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // ignore storage errors
  }
  return DEFAULT_LANGUAGE;
}

export function getTranslator(lang: Language): TranslateFn {
  const dict = dictionaries[lang] ?? dictionaries[DEFAULT_LANGUAGE];
  const fallback = dictionaries[DEFAULT_LANGUAGE];
  return (key, vars) => {
    const template: string = dict[key] ?? fallback[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
    );
  };
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  // Read the stored language after mount to avoid hydration mismatches.
  useEffect(() => {
    setLanguageState(readStoredLanguage());
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    if (!isLanguage(lang)) return;
    setLanguageState(lang);
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore storage errors
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t: getTranslator(language) }),
    [language, setLanguage],
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
