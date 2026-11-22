import { getCache, setCache } from "../_shared/cache";
import { translateExplanation, type TranslationTarget } from "../_shared/translateExplanation";
import { sanitizeError } from "../_shared/validation";

const MAX_ITEMS = 30;
const MAX_EXPLANATION_LENGTH = 2000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LANGUAGES = ["en", "es", "vi"] as const;

export type TranslateLanguage = (typeof LANGUAGES)[number];

export interface TranslateItemInput {
  id: string;
  explanation: string;
  commodities: string[];
}

export interface TranslateItemOutput {
  id: string;
  explanation: string;
  translated: boolean;
  language: TranslateLanguage;
}

export class TranslateParamError extends Error {}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function parseTranslateBody(body: unknown): { items: TranslateItemInput[]; language: TranslateLanguage } {
  if (!body || typeof body !== "object") throw new TranslateParamError("Body must be a JSON object");
  const { items, language } = body as Record<string, unknown>;
  if (typeof language !== "string" || !(LANGUAGES as readonly string[]).includes(language)) {
    throw new TranslateParamError("'language' must be one of: en, es, vi");
  }
  if (!Array.isArray(items)) throw new TranslateParamError("'items' must be an array");
  if (items.length > MAX_ITEMS) throw new TranslateParamError(`At most ${MAX_ITEMS} items allowed`);
  const parsed: TranslateItemInput[] = items.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new TranslateParamError(`items[${i}] must be an object`);
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id) throw new TranslateParamError(`items[${i}].id must be a non-empty string`);
    if (typeof item.explanation !== "string") throw new TranslateParamError(`items[${i}].explanation must be a string`);
    if (item.explanation.length > MAX_EXPLANATION_LENGTH) {
      throw new TranslateParamError(`items[${i}].explanation exceeds ${MAX_EXPLANATION_LENGTH} characters`);
    }
    if (!Array.isArray(item.commodities) || !item.commodities.every((c) => typeof c === "string")) {
      throw new TranslateParamError(`items[${i}].commodities must be an array of strings`);
    }
    return { id: item.id, explanation: item.explanation, commodities: item.commodities as string[] };
  });
  return { items: parsed, language: language as TranslateLanguage };
}

/** POST /api/translate-factors — translate factor explanations to es/vi, with English fallback. */
export async function handleTranslateFactors(req: Request): Promise<Response> {
  let parsed: { items: TranslateItemInput[]; language: TranslateLanguage };
  try {
    parsed = parseTranslateBody(await req.json());
  } catch (error) {
    const message = error instanceof TranslateParamError ? error.message : "Invalid JSON body";
    return Response.json({ error: message }, { status: 400 });
  }

  const { items, language } = parsed;
  try {
    const out: TranslateItemOutput[] = await Promise.all(
      items.map(async (item): Promise<TranslateItemOutput> => {
        if (language === "en") {
          return { id: item.id, explanation: item.explanation, translated: false, language };
        }
        const key = `translate-factor:${hash(`${language}|${item.id}|${item.explanation}`)}`;
        const cached = await getCache<string>(key, CACHE_TTL_MS);
        if (cached) return { id: item.id, explanation: cached, translated: true, language };

        const result = await translateExplanation(item.explanation, language as TranslationTarget, item.commodities);
        if (result.translated) await setCache(key, result.text, CACHE_TTL_MS);
        return { id: item.id, explanation: result.text, translated: result.translated, language };
      }),
    );
    return Response.json({ items: out }, { status: 200 });
  } catch (error) {
    console.error("Translate factors error:", sanitizeError(String(error)));
    return Response.json(
      { error: "Failed to translate explanations" },
      { status: 500 },
    );
  }
}
