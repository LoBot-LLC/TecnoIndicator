import { useEffect, useState } from "react";

export type TranslateLanguage = "en" | "es" | "vi";

const TIMEOUT_MS = 20000;

/** A dynamic string to translate, keyed by its originating entity id. */
export interface TranslateTextItem {
  id: string;
  text: string;
}

/**
 * Translates arbitrary dynamic strings (titles, factor names, driver notes,
 * solution copy, …) via /api/translate-text for es/vi; English passes through.
 * Returns an id -> translation map that falls back to the originals on error.
 */
export async function fetchTranslatedTexts(
  items: { id: string; text: string }[],
  language: TranslateLanguage,
): Promise<Map<string, string>> {
  const fallback = new Map(items.map((item) => [item.id, item.text]));
  if (language === "en" || items.length === 0) return fallback;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/translate-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: items.map((i) => i.text), language }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { items?: Array<{ text: string; translated?: boolean }> };
    const map = new Map(fallback);
    const responses = data.items ?? [];
    for (let i = 0; i < responses.length && i < items.length; i++) {
      const response = responses[i];
      if (response.translated && typeof response.text === "string" && response.text) {
        map.set(items[i].id, response.text);
      }
    }
    return map;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

const EMPTY_TRANSLATIONS = new Map<string, string>();

function originalsMap(items: { id: string; text: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) map.set(item.id, item.text);
  return map;
}

/**
 * Client hook: loads runtime translations for dynamic strings via
 * /api/translate-text. No-ops for English and while loading (originals are
 * returned); refetches when the language or the translated content changes.
 */
export function useTranslatedTexts(
  items: { id: string; text: string }[],
  language: TranslateLanguage,
): Map<string, string> {
  const key = `${language}\u0003` + items.map((i) => `${i.id}\u0001${i.text}`).join("\u0002");
  const [result, setResult] = useState<{ key: string; map: Map<string, string> } | null>(null);

  useEffect(() => {
    if (language === "en" || items.length === 0) return;
    let cancelled = false;
    fetchTranslatedTexts(items, language).then((map) => {
      if (!cancelled) setResult({ key, map });
    });
    return () => {
      cancelled = true;
    };
    // `key` encodes the language, ids, and texts that `items` derives from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (language === "en" || !result || result.key !== key) {
    // Originals while loading / for English.
    return originalsMap(items);
  }
  return result.map;
}

export { EMPTY_TRANSLATIONS };
