import { kiloRouter } from "./kiloRouter";
import { getCache, setCache } from "./cache";
import { LANGUAGE_NAMES, type ApiLanguage } from "./language";
import { safeParseJson } from "./validation";

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

function preservesNumbers(source: string, translated: string): boolean {
  const out = numericTokens(translated);
  return numericTokens(source).every((t) => out.includes(t));
}

function needsTranslation(text: string): boolean {
  return /\p{L}/u.test(text);
}

function applyTranslations(texts: string[], indexes: number[], translated: string[]): string[] {
  const out = [...texts];
  indexes.forEach((idx, j) => {
    out[idx] = translated[j];
  });
  return out;
}

async function translateChunk(
  chunk: string[],
  lang: ApiLanguage,
  opts: TranslateOptions,
): Promise<string[] | null> {
  const joinedLength = chunk.join("").length;
  const maxTokens = Math.min(8192, 256 + joinedLength * 3);
  const signal = opts.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const response = await kiloRouter.kiloInfer(
        {
          messages: [
            { role: "system", content: SYSTEM_PROMPT(lang) },
            { role: "user", content: JSON.stringify(chunk) },
          ],
          max_tokens: maxTokens,
          temperature: 0,
        },
        signal,
      );
      
      const content = response.choices?.[0]?.message?.content ?? "";
      const parsed = safeParseJson<unknown>(content);
      
      if (!Array.isArray(parsed) || parsed.length !== chunk.length) {
        throw new Error(`chunk length mismatch: expected ${chunk.length}, got ${Array.isArray(parsed) ? parsed.length : "non-array"}`);
      }
      if (!parsed.every((v) => typeof v === "string")) {
        throw new Error("chunk contained non-string items");
      }
      
      return parsed as string[];
    } catch (error) {
      console.error(`translateTexts chunk attempt ${attempt + 1} failed:`, error);
      if (attempt === 2) {
        // Exhausted all retries
        return null;
      }
    }
  }
  return null;
}

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

  // Chunk pending into chunks of up to 6 strings
  const chunks: string[][] = [];
  for (let i = 0; i < pending.length; i += 6) {
    chunks.push(pending.slice(i, i + 6));
  }

  const translatedPending: string[] = [];
  for (const chunk of chunks) {
    const chunkResult = await translateChunk(chunk, lang, opts);
    if (chunkResult === null) {
      // Chunk failed after all retries; return original texts
      console.error("translateTexts chunk failed after retries; returning original texts");
      return texts;
    }
    translatedPending.push(...chunkResult);
  }

  if (translatedPending.length !== pending.length) {
    console.error("translateTexts translatedPending length mismatch; returning original texts");
    return texts;
  }

  // Build per-string result: out.trim() && preservesNumbers(src, out) ? out : src
  const translated = pending.map((src, i) => {
    const out = translatedPending[i];
    return out.trim() && preservesNumbers(src, out) ? out : src;
  });

  memo.set(key, translated);
  if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
  try {
    await setCache(key, translated, TRANSLATE_CACHE_MS);
  } catch {
    // Cache is optional.
  }
  return applyTranslations(texts, indexes, translated);
}

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