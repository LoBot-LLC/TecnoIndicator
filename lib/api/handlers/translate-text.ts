import { getCache, setCache } from "../_shared/cache";
import { translatePlainText } from "../_shared/translateText";
import { sanitizeError } from "../_shared/validation";

const MAX_TEXTS = 40;
const MAX_TEXT_LENGTH = 1500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LANGUAGES = ["en", "es", "vi"] as const;

export type TranslateLanguage = (typeof LANGUAGES)[number];

export interface TranslateTextItemOutput {
  text: string;
  translated: boolean;
  language: TranslateLanguage;
}

export class TranslateTextParamError extends Error {}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function parseTranslateTextBody(body: unknown): { texts: string[]; language: TranslateLanguage } {
  if (!body || typeof body !== "object") throw new TranslateTextParamError("Body must be a JSON object");
  const { texts, language } = body as Record<string, unknown>;
  if (typeof language !== "string" || !(LANGUAGES as readonly string[]).includes(language)) {
    throw new TranslateTextParamError("'language' must be one of: en, es, vi");
  }
  if (!Array.isArray(texts)) throw new TranslateTextParamError("'texts' must be an array");
  if (texts.length > MAX_TEXTS) throw new TranslateTextParamError(`At most ${MAX_TEXTS} texts allowed`);
  const parsed: string[] = texts.map((raw, i) => {
    if (typeof raw !== "string") throw new TranslateTextParamError(`texts[${i}] must be a string`);
    if (raw.length > MAX_TEXT_LENGTH) {
      throw new TranslateTextParamError(`texts[${i}] exceeds ${MAX_TEXT_LENGTH} characters`);
    }
    return raw;
  });
  return { texts: parsed, language: language as TranslateLanguage };
}

/** POST /api/translate-text — translate arbitrary plain texts to es/vi, with English passthrough. */
export async function handleTranslateText(req: Request): Promise<Response> {
  let parsed: { texts: string[]; language: TranslateLanguage };
  try {
    parsed = parseTranslateTextBody(await req.json());
  } catch (error) {
    const message = error instanceof TranslateTextParamError ? error.message : "Invalid JSON body";
    return Response.json({ error: message }, { status: 400 });
  }

  const { texts, language } = parsed;
  try {
    const items: TranslateTextItemOutput[] = await Promise.all(
      texts.map(async (text): Promise<TranslateTextItemOutput> => {
        if (language === "en" || text.length === 0) {
          return { text, translated: false, language };
        }
        const key = `translate-text:${hash(`${language}|${text}`)}`;
        const cached = await getCache<string>(key, CACHE_TTL_MS);
        if (cached) return { text: cached, translated: true, language };
        const result = await translatePlainText(text, language);
        if (result.translated) await setCache(key, result.text, CACHE_TTL_MS);
        return { text: result.text, translated: result.translated, language };
      }),
    );
    return Response.json({ items }, { status: 200 });
  } catch (error) {
    console.error("Translate text error:", sanitizeError(String(error)));
    return Response.json(
      { error: "Failed to translate texts" },
      { status: 500 },
    );
  }
}
