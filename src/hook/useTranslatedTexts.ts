"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/types";

const MAX_TEXTS_PER_REQUEST = 40;
const MAX_TEXT_CHARS = 600;
const MAX_TOTAL_CHARS = 12_000;

/** Translated strings shared across hook instances for this session. */
const translationCache = new Map<string, string>();
/** Batches already on the wire, keyed by locale + source texts. */
const inFlightBatches = new Map<string, Promise<void>>();

function cacheKey(locale: Locale, text: string): string {
  return `${locale}:${text}`;
}

function uniqueTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const text of texts) {
    if (text.length === 0 || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

/** Greedy chunking that respects both the item and character budgets. */
function chunkTexts(texts: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const text of texts) {
    if (
      current.length > 0 &&
      (current.length >= MAX_TEXTS_PER_REQUEST || currentChars + text.length > MAX_TOTAL_CHARS)
    ) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(text);
    currentChars += text.length;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

interface TranslateApiResponse {
  translations?: unknown;
}

/**
 * Returns `texts` translated into `locale` for display.
 *
 * Web-searched/AI-curated content is translated on demand by the server
 * (`/api/translate` via the Kilo Gateway) and cached per text for 24h. This
 * hook keeps a session-level cache, dedupes in-flight batches, and falls back
 * to the original English string for any text that cannot be translated.
 * `locale === "en"` returns the input unchanged without fetching.
 */
export function useTranslatedTexts(texts: string[], locale: Locale): string[] {
  // Snapshot of the module cache; updating it re-renders with new translations.
  const [snapshot, setSnapshot] = useState<ReadonlyMap<string, string>>(
    () => new Map(translationCache),
  );
  const textsRef = useRef(texts);
  textsRef.current = texts;

  // Stable dependency key: new array identities with identical content do not
  // retrigger the effect.
  const requestKey = useMemo(() => {
    if (locale === "en") return "en";
    return `${locale}:${uniqueTexts(texts).join("\u0001")}`;
  }, [texts, locale]);

  useEffect(() => {
    if (locale === "en") return;

    const sources = uniqueTexts(textsRef.current);
    const pending = sources.filter(
      (text) =>
        text.length <= MAX_TEXT_CHARS && !translationCache.has(cacheKey(locale, text)),
    );
    if (pending.length === 0) {
      // Pick up translations cached by another hook instance since mount.
      setSnapshot((current) =>
        current.size === translationCache.size ? current : new Map(translationCache),
      );
      return;
    }

    let active = true;
    const syncSnapshot = (): void => {
      if (active) setSnapshot(new Map(translationCache));
    };

    const requestChunk = async (chunk: string[]): Promise<void> => {
      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale, texts: chunk }),
        });
        if (!response.ok) return;

        const data = (await response.json()) as TranslateApiResponse;
        if (!Array.isArray(data.translations)) return;
        const translations: unknown[] = data.translations;

        translations.forEach((value, index) => {
          if (index >= chunk.length) return;
          if (typeof value !== "string" || value.trim().length === 0) return;
          translationCache.set(cacheKey(locale, chunk[index]), value);
        });
      } catch {
        // Graceful degradation: untranslated strings stay in English.
      }
    };

    for (const chunk of chunkTexts(pending)) {
      const batchKey = `${locale}:${chunk.join("\u0001")}`;
      const existing = inFlightBatches.get(batchKey);
      if (existing) {
        void existing.then(syncSnapshot);
        continue;
      }

      const promise = requestChunk(chunk).finally(() => {
        inFlightBatches.delete(batchKey);
      });
      inFlightBatches.set(batchKey, promise);

      void promise.then(syncSnapshot);
    }

    return () => {
      active = false;
    };
  }, [requestKey, locale]);

  return useMemo(
    () => texts.map((text) => snapshot.get(cacheKey(locale, text)) ?? text),
    [texts, locale, snapshot],
  );
}

export default useTranslatedTexts;
