import { getCache, setCache } from "../_shared/cache";
import { kiloRouter } from "../_shared/kiloRouter";
import { safeParseJson, sanitizeError } from "../_shared/validation";
import type { Locale } from "../../../src/lib/i18n/types";

/** Locales this endpoint actually translates into. */
type TargetLocale = Exclude<Locale, "en">;

/** Per-text translation cache lifetime (24 hours). */
const TRANSLATE_CACHE_MS = 86_400_000;
const MAX_TEXTS = 40;
const MAX_TEXT_CHARS = 600;
const MAX_TOTAL_CHARS = 12_000;
const TRANSLATE_TIMEOUT_MS = 30_000;

const LANGUAGE_NAMES: Record<TargetLocale, string> = {
  es: "Spanish",
  vi: "Vietnamese",
};

interface TranslateRequestBody {
  locale?: unknown;
  texts?: unknown;
}

interface TranslateResponseBody {
  locale: Locale;
  translations: string[];
  translated: boolean;
}

function isTargetLocale(value: unknown): value is TargetLocale {
  return value === "es" || value === "vi";
}

/**
 * Deterministic 32-bit FNV-1a hash of the UTF-8 bytes of `input`.
 * Used only for cache keys, never for security.
 */
function fnv1aHash(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function translationCacheKey(locale: TargetLocale, text: string): string {
  return `translate:${locale}:${fnv1aHash(text)}`;
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function validateTexts(
  value: unknown,
): { ok: true; texts: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value)) {
    return { ok: false, message: "'texts' must be an array of strings" };
  }
  if (value.length < 1 || value.length > MAX_TEXTS) {
    return { ok: false, message: `'texts' must contain between 1 and ${MAX_TEXTS} items` };
  }

  const texts: string[] = [];
  let totalChars = 0;
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    if (typeof item !== "string" || item.trim().length === 0) {
      return { ok: false, message: `'texts[${i}]' must be a non-empty string` };
    }
    if (item.length > MAX_TEXT_CHARS) {
      return {
        ok: false,
        message: `'texts[${i}]' must be at most ${MAX_TEXT_CHARS} characters`,
      };
    }
    totalChars += item.length;
    texts.push(item);
  }

  if (totalChars > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      message: `'texts' must total at most ${MAX_TOTAL_CHARS} characters`,
    };
  }

  return { ok: true, texts };
}

function buildSystemPrompt(locale: TargetLocale, count: number): string {
  const language = LANGUAGE_NAMES[locale];
  return `You are a professional translator for a commodity-market analytics product. Translate each English string into ${language}.

Rules:
- Preserve numbers, currency symbols, units, URLs, ticker symbols, acronyms, and brand names exactly.
- Preserve the structure "With <commodity> at $<price>/<unit>," (translate only the surrounding words).
- Do not add commentary, notes, or explanations.
- Return only JSON of the form {"translations":["...","..."]} containing exactly ${count} strings in the same order as the input.`;
}

/**
 * POST /api/translate — translates curated/web-searched English strings into a
 * supported locale via the Kilo Gateway.
 *
 * Body: `{ locale: "es" | "vi" | "en", texts: string[] }` with 1–40 non-empty
 * strings of at most 600 chars each and 12,000 chars total. Returns
 * `{ locale, translations: string[], translated: boolean }` where
 * `translations` always matches the input length and order. `locale: "en"`
 * echoes the originals with `translated: false`.
 *
 * Cache hits are served per text for 24h; misses are translated in a single
 * batched inference call. Inference failures degrade gracefully to the
 * originals (HTTP 200, `translated: false`); only malformed input returns 400.
 */
export async function handleTranslate(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    const response = errorResponse(405, "method_not_allowed", "Only POST is allowed");
    response.headers.set("Allow", "POST");
    return response;
  }

  let body: TranslateRequestBody;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return errorResponse(400, "invalid_parameter", "Request body must be a JSON object");
    }
    body = parsed as TranslateRequestBody;
  } catch {
    return errorResponse(400, "invalid_parameter", "Request body must be valid JSON");
  }

  const validated = validateTexts(body.texts);
  if (!validated.ok) {
    return errorResponse(400, "invalid_parameter", validated.message);
  }
  const texts = validated.texts;

  if (body.locale === "en") {
    const payload: TranslateResponseBody = {
      locale: "en",
      translations: [...texts],
      translated: false,
    };
    return Response.json(payload, { status: 200 });
  }

  if (!isTargetLocale(body.locale)) {
    return errorResponse(
      400,
      "invalid_parameter",
      "'locale' must be one of: es, vi, en",
    );
  }
  const locale: TargetLocale = body.locale;

  // Resolve cache hits in parallel; keep misses for a single batched inference.
  const cacheResults = await Promise.all(
    texts.map((text) => getCache<string>(translationCacheKey(locale, text), TRANSLATE_CACHE_MS)),
  );

  const translations: string[] = [...texts];
  const misses: Array<{ index: number; text: string }> = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = cacheResults[i];
    if (typeof cached === "string" && cached.trim().length > 0) {
      translations[i] = cached;
    } else {
      misses.push({ index: i, text: texts[i] });
    }
  }

  let translated = true;

  if (misses.length > 0) {
    let resolved = 0;
    try {
      const payload = {
        messages: [
          { role: "system", content: buildSystemPrompt(locale, misses.length) },
          { role: "user", content: JSON.stringify(misses.map((miss) => miss.text)) },
        ],
        temperature: 0.1,
        max_tokens: Math.min(6000, Math.max(512, texts.length * 350)),
        response_format: { type: "json_object" },
      };

      const response = await kiloRouter.kiloInfer(
        payload,
        AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
      );
      const content = response.choices?.[0]?.message?.content ?? "";
      const parsed = safeParseJson<{ translations?: unknown[] }>(content);
      const incoming = Array.isArray(parsed?.translations) ? parsed.translations : [];

      const writes: Array<Promise<void>> = [];
      for (let i = 0; i < misses.length; i++) {
        const candidate: unknown = incoming[i];
        if (typeof candidate !== "string" || candidate.trim().length === 0) continue;
        const miss = misses[i];
        translations[miss.index] = candidate;
        resolved++;
        writes.push(
          setCache(translationCacheKey(locale, miss.text), candidate, TRANSLATE_CACHE_MS),
        );
      }
      if (writes.length > 0) {
        await Promise.all(writes);
      }
    } catch (error) {
      console.error(
        "Translation inference failed; returning originals:",
        sanitizeError(error instanceof Error ? error.message : String(error)),
      );
    }

    // Partial results are kept; `translated` only reports a full success.
    if (resolved !== misses.length) {
      translated = false;
    }
  }

  const result: TranslateResponseBody = { locale, translations, translated };
  return Response.json(result, { status: 200 });
}
