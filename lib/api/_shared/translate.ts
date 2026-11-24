import { kiloRouter } from "./kiloRouter";
import { getCache, setCache } from "./cache";
import { API_LANGUAGES, LANGUAGE_NAMES, type ApiLanguage } from "./language";
import { safeParseJson } from "./validation";
import type { Factor } from "./types";

export interface TranslateOptions {
  /** Abort the upstream call; defaults to a 15s timeout. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

const TRANSLATE_CACHE_MS = 24 * 60 * 60 * 1000;
const MEMO_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 15_000;
const memo = new Map<string, string[]>();

const SYSTEM_PROMPT = (lang: ApiLanguage) =>
  `You are a professional translator. Translate each string in the JSON array the user sends into ${LANGUAGE_NAMES[lang]}.\n\n` +
  "Rules:\n" +
  "- Return ONLY a JSON array of strings with exactly the same length and order as the input.\n" +
  "- Keep numbers, units, currency codes (USD, EUR, VND), percentages, dates, tickers, and symbols exactly as written.\n" +
  "- Keep URLs, email addresses, and proper nouns (organization names such as IEA, OPEC, EIA) unchanged.\n" +
  "- Do not add commentary, explanations, or markdown.\n" +
  "- If a string is already in the target language or is not translatable, return it unchanged.";

function hashStrings(texts: string[]): string {
  const s = JSON.stringify(texts);
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = (Math.imul(h2, 33) ^ c) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}${s.length.toString(36)}`;
}

function numericTokens(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((t) => t.replace(/,/g, "."));
}

/** Rejects translations that dropped or altered any number from the source. */
function preservesNumbers(source: string, translated: string): boolean {
  const out = numericTokens(translated);
  return numericTokens(source).every((t) => out.includes(t));
}

function needsTranslation(text: string): boolean {
  return /\p{L}/u.test(text);
}

/**
 * Translates a batch of strings in one Kilo Gateway call. Returns the input
 * unchanged for `en`, for empty input, or on any failure. Never throws.
 */
export async function translateTexts(
  texts: string[],
  lang: ApiLanguage,
  opts: TranslateOptions = {},
): Promise<string[]> {
  if (lang === "en" || texts.length === 0) return texts;

  const indexes = texts.flatMap((t, i) => (needsTranslation(t) ? [i] : []));
  if (indexes.length === 0) return texts;
  const pending = indexes.map((i) => texts[i]);

  const key = `translate:${lang}:${hashStrings(pending)}`;
  try {
    const memoized = memo.get(key) ?? (await getCache<string[]>(key, TRANSLATE_CACHE_MS));
    if (Array.isArray(memoized) && memoized.length === pending.length) {
      return applyTranslations(texts, indexes, memoized);
    }
  } catch {
    // Cache is optional.
  }

  try {
    const response = await kiloRouter.kiloInfer(
      {
        messages: [
          { role: "system", content: SYSTEM_PROMPT(lang) },
          { role: "user", content: JSON.stringify(pending) },
        ],
        max_tokens: Math.min(4096, 256 + pending.join("").length * 2),
        temperature: 0,
      },
      opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    );
    const content = response.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson<unknown>(content);
    if (!Array.isArray(parsed) || parsed.length !== pending.length) return texts;
    if (!parsed.every((v) => typeof v === "string")) return texts;

    const translated = (parsed as string[]).map((out, i) =>
      out.trim() && preservesNumbers(pending[i], out) ? out : pending[i],
    );

    memo.set(key, translated);
    if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
    try {
      await setCache(key, translated, TRANSLATE_CACHE_MS);
    } catch {
      // Cache is optional.
    }
    return applyTranslations(texts, indexes, translated);
  } catch (error) {
    console.error("translateTexts failed; returning original text:", error);
    return texts;
  }
}

function applyTranslations(texts: string[], indexes: number[], translated: string[]): string[] {
  const out = [...texts];
  indexes.forEach((idx, j) => {
    out[idx] = translated[j];
  });
  return out;
}

/**
 * Translates the string leaves of a structured payload whose property name is
 * listed in `keys`, in one batched call. Everything else (numbers, ids, keys,
 * URLs, non-listed fields) is returned as-is. Never throws.
 */
export async function translateStructured<T>(
  value: T,
  lang: ApiLanguage,
  keys: readonly string[],
  opts: TranslateOptions = {},
): Promise<T> {
  if (lang === "en" || value === null || value === undefined) return value;
  const keySet = new Set(keys);
  const collected: string[] = [];

  const collect = (node: unknown, key: string | null): void => {
    if (typeof node === "string") {
      if (key !== null && keySet.has(key) && node.length > 0) collected.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) collect(item, key);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) collect(v, k);
    }
  };
  collect(value, null);
  if (collected.length === 0) return value;

  const translated = await translateTexts(collected, lang, opts);
  let cursor = 0;
  const rebuild = (node: unknown, key: string | null): unknown => {
    if (typeof node === "string") {
      if (key !== null && keySet.has(key) && node.length > 0) return translated[cursor++];
      return node;
    }
    if (Array.isArray(node)) return node.map((item) => rebuild(item, key));
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = rebuild(v, k);
      return out;
    }
    return node;
  };
  return rebuild(value, null) as T;
}

/**
 * Pre-translates every factor's `name` and `explanation` into all supported
 * languages and stores them on `factor.translations`, so the UI can switch
 * languages instantly without another network round-trip.
 *
 * Batched per language: one Kilo call for all names and one for all
 * explanations per target language (same cache + number-preservation guards as
 * `translateTexts`). Never throws; untranslatable strings fall back to the
 * original English.
 */
export async function attachFactorTranslations(
  factors: Factor[],
  opts: TranslateOptions = {},
): Promise<Factor[]> {
  if (factors.length === 0) return factors;

  for (const lang of API_LANGUAGES) {
    if (lang === "en") continue;
    const names = factors.map((f) => f.name);
    const explanations = factors.map((f) => f.explanation);
    const [translatedNames, translatedExplanations] = await Promise.all([
      translateTexts(names, lang, opts),
      translateTexts(explanations, lang, opts),
    ]);
    factors.forEach((factor, i) => {
      if (!factor.translations) factor.translations = {};
      factor.translations[lang] = {
        name: translatedNames[i] ?? factor.name,
        explanation: translatedExplanations[i] ?? factor.explanation,
      };
    });
  }
  return factors;
}
