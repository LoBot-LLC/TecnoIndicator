export type TranslateLanguage = "en" | "es" | "vi";

export interface TranslateRequestItem {
  id: string;
  explanation: string;
  commodities: string[];
}

const TIMEOUT_MS = 20000;

/** Returns id -> explanation in the requested language; falls back to originals on any error. */
export async function fetchTranslatedExplanations(
  items: TranslateRequestItem[],
  language: TranslateLanguage,
): Promise<Map<string, string>> {
  const fallback = new Map(items.map((item) => [item.id, item.explanation]));
  if (language === "en" || items.length === 0) return fallback;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/translate-factors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, language }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { items?: Array<{ id: string; explanation: string }> };
    const map = new Map(fallback);
    for (const item of data.items ?? []) {
      if (typeof item.id === "string" && typeof item.explanation === "string" && item.explanation) {
        map.set(item.id, item.explanation);
      }
    }
    return map;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
