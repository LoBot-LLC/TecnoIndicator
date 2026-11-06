"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_FONT_KEY, FONTS, getFont, type FontOption } from "../lib/fonts";

const STORAGE_KEY = "tecno.font";

export interface FontContextValue {
  fontKey: string;
  setFontKey: (k: string) => void;
  fonts: FontOption[];
  current: FontOption;
}
const FontContext = createContext<FontContextValue | undefined>(undefined);

function loadGoogleFont(googleFamily: string, key: string) {
  if (typeof document === "undefined") return;
  const id = `gf-${key}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${googleFamily}&display=swap`;
  document.head.appendChild(link);
}

export function FontProvider({ children }: { children: React.ReactNode }) {
  const [fontKey, setFontKeyState] = useState<string>(DEFAULT_FONT_KEY);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && FONTS.some((f) => f.key === stored)) setFontKeyState(stored);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const font = getFont(fontKey);
    loadGoogleFont(font.googleFamily, font.key);
    document.documentElement.style.setProperty("--font-sans", font.family);
    document.documentElement.style.setProperty("--font-display", font.family);
    try {
      window.localStorage.setItem(STORAGE_KEY, fontKey);
    } catch {
      /* ignore */
    }
  }, [fontKey]);

  const setFontKey = useCallback((k: string) => {
    if (FONTS.some((f) => f.key === k)) setFontKeyState(k);
  }, []);

  const value = useMemo<FontContextValue>(
    () => ({ fontKey, setFontKey, fonts: FONTS, current: getFont(fontKey) }),
    [fontKey, setFontKey],
  );
  return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

export function useFont(): FontContextValue {
  const ctx = useContext(FontContext);
  if (!ctx) throw new Error("useFont must be used within a FontProvider");
  return ctx;
}
