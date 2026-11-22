"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import { getLanguageTranslations, LANGUAGE_OPTIONS } from "@/lib/translations";

export type Language = "en" | "es" | "vi";

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  translations: Record<string, string>;
  languageOptions: typeof LANGUAGE_OPTIONS;
}

const LANGUAGE_STORAGE_KEY = "tecno.language";
const DEFAULT_LANGUAGE = "en";

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function readStoredLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && ["en", "es", "vi"].includes(stored)) return stored as Language;
  } catch {
    // ignore storage errors
  }
  return DEFAULT_LANGUAGE;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage());

  const setLanguage = (newLang: Language) => {
    setLanguageState(newLang);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, newLang);
    } catch {
      // ignore storage errors
    }
  };

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    translations: getLanguageTranslations(language),
    languageOptions: LANGUAGE_OPTIONS,
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}