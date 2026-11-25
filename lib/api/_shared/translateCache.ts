import { getCache, setCache } from "./cache";
import { translateTexts } from "./translate";
import { API_LANGUAGES, type ApiLanguage } from "./language";
import { tinyfishRouter } from "./tinyfishRouter";
import type { ScrapedContent } from "./tinyfishRouter";

/**
 * Caching key prefix for translated scraped content.
 * Format: trans:text:{url}:{lang} -> translated text
 * Format: trans:title:{url}:{lang} -> translated title
 */
const TRANSLATED_TEXT_PREFIX = "trans:text:";
const TRANSLATED_TITLE_PREFIX = "trans:title:";
const TRANSLATION_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Returns all available languages for translation.
 */
export function getAvailableLanguages(): readonly ApiLanguage[] {
  return API_LANGUAGES;
}

/**
 * Translates scraped content to all available languages and caches each translation.
 * Returns a map of language code to translated ScrapedContent.
 */
export async function translateScrapedContentAllLanguages(
  content: ScrapedContent,
): Promise<Record<ApiLanguage, ScrapedContent>> {
  const result: Record<ApiLanguage, ScrapedContent> = {
    en: content,
    es: content,
    vi: content,
  } as Record<ApiLanguage, ScrapedContent>;

  const textsToTranslate = [content.title, content.text].filter(Boolean);

  for (const lang of API_LANGUAGES) {
    if (lang === "en") continue; // English is the source language

    const translatedTitle = await translateSingleText(content.title, lang);
    const translatedText = await translateSingleText(content.text, lang);

    result[lang] = {
      ...content,
      title: translatedTitle ?? content.title,
      text: translatedText ?? content.text,
    };
  }

  return result;
}

/**
 * Translates a single text string to the target language, using cache when available.
 * Never throws.
 */
async function translateSingleText(text: string, lang: ApiLanguage): Promise<string | null> {
  if (!text || text.length === 0) return text;

  const cacheKey = `${TRANSLATED_TEXT_PREFIX}${encodeURIComponent(text)}:${lang}`;
  try {
    const cached = await getCache<string>(cacheKey, TRANSLATION_CACHE_MS);
    if (cached !== null) return cached;
  } catch {
    // Cache miss, proceed to translate
  }

  try {
    const translated = await translateTexts([text], lang);
    const result = translated.length > 0 ? translated[0] : text;
    try {
      await setCache(cacheKey, result, TRANSLATION_CACHE_MS);
    } catch {
      // Cache write is optional
    }
    return result;
  } catch (error) {
    console.error(`Translation failed for lang ${lang}:`, error);
    return null;
  }
}

/**
 * Translates a factor object's translatable fields (explanation, name) to all available languages.
 * Returns a map of language code to translated factor.
 */
export async function translateFactorAllLanguages(factor: Record<string, unknown>): Promise<Record<ApiLanguage, Record<string, unknown>>> {
  const result: Record<ApiLanguage, Record<string, unknown>> = {
    en: factor,
    es: factor,
    vi: factor,
  } as Record<ApiLanguage, Record<string, unknown>>;

  const textFields = [
    factor.explanation ? String(factor.explanation) : "",
    factor.name ? String(factor.name) : "",
    factor.source ? String(factor.source) : "",
  ].filter(Boolean);

  for (const lang of API_LANGUAGES) {
    if (lang === "en") continue;

    const translated = await translateTexts(textFields, lang);
    const cursor: number[] = [0];

    const translatedFactor = { ...factor };
    if (translatedFactor.explanation && translated.length > cursor[0]) {
      translatedFactor.explanation = translated[cursor[0]++] ?? factor.explanation;
    }
    if (translatedFactor.name && translated.length > cursor[0]) {
      translatedFactor.name = translated[cursor[0]++] ?? factor.name;
    }

    result[lang] = translatedFactor;
  }

  return result;
}

/**
 * Translates a solution object's translatable fields (title, summary, actions) to all available languages.
 * Returns a map of language code to translated solution.
 */
export async function translateSolutionAllLanguages(solution: Record<string, unknown>): Promise<Record<ApiLanguage, Record<string, unknown>>> {
  const result: Record<ApiLanguage, Record<string, unknown>> = {
    en: solution,
    es: solution,
    vi: solution,
  } as Record<ApiLanguage, Record<string, unknown>>;

  const texts: string[] = [];
  const fieldMap: Array<{ key: string; index: number }> = [];

  if (solution.title) { texts.push(String(solution.title)); fieldMap.push({ key: "title", index: texts.length - 1 }); }
  if (solution.summary) { texts.push(String(solution.summary)); fieldMap.push({ key: "summary", index: texts.length - 1 }); }
  if (Array.isArray(solution.actions)) {
    solution.actions.forEach((action: unknown) => {
      if (typeof action === "string" && action.length > 0) {
        texts.push(action);
        fieldMap.push({ key: "actions", index: texts.length - 1 });
      }
    });
  }

  for (const lang of API_LANGUAGES) {
    if (lang === "en") continue;
    if (texts.length === 0) continue;

    const translated = await translateTexts(texts, lang);
    const translatedSolution = { ...solution };

    fieldMap.forEach(({ key, index }, i) => {
      if (translated[index] !== undefined) {
        if (key === "actions") {
          const currentActions = Array.isArray(translatedSolution.actions) ? [...translatedSolution.actions] : [];
          currentActions[i] = translated[index];
          translatedSolution.actions = currentActions;
        } else {
          translatedSolution[key] = translated[index];
        }
      }
    });

    result[lang] = translatedSolution;
  }

  return result;
}
