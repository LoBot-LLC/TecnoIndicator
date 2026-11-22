import { kiloRouter } from "./kiloRouter";
import { sanitizeError } from "./validation";

/** Target languages for plain text translation. */
export type TranslationTarget = "es" | "vi";

/** Result shape returned by translatePlainText. */
export type TranslationResult = { text: string; translated: boolean; reason?: string };

/** Prompt built for the Kilo Gateway LLM. */
function buildSystemPrompt(target: TranslationTarget): string {
  const langName = target === "es" ? "Spanish" : "Vietnamese";
  return (
    `You are a professional translator. Translate the following text into ${langName}. ` +
    "Output ONLY the translated text: no preamble, quotation marks, markdown code fences, bullets, or explanatory notes. " +
    "Keep numbers, units, currency symbols and codes, percentages, dates, proper nouns, brand names (LoBot, TecnoIndicator), URLs, and acronyms (WTI, Brent, CSV, PNG, MD) exactly as they appear in the source. " +
    "Do not add, remove, or rephrase facts. Preserve meaning and tone without expanding the text."
  );
}

/** Single Kilo-inference call. Never throws call-site; caller handles try/catch. */
async function callOnce(
  text: string,
  target: TranslationTarget,
  maxTokens: number,
): Promise<string> {
  const response = await kiloRouter.kiloInfer({
    messages: [
      { role: "system", content: buildSystemPrompt(target) },
      { role: "user", content: `Text:\n${text}` },
    ],
    max_tokens: maxTokens,
    temperature: 0,
  });
  return (response.choices?.[0]?.message?.content ?? "").trim();
}

/** Pure check of translation usability: non-empty and length within bound. */
export function isUsableTranslation(
  original: string,
  candidate: string,
): { ok: true } | { ok: false; reason: string } {
  const orig = (original ?? "").trim();
  const cand = (candidate ?? "").trim();
  if (!cand) return { ok: false, reason: "empty translation" };
  if (cand.length > orig.length * 3 + 60) {
    return { ok: false, reason: "translation too long" };
  }
  return { ok: true };
}

/** Translate a single plain text string into Spanish or Vietnamese.
 *  Never throws: on failure (after one retry) returns the original text
 *  with translated:false.
 */
export async function translatePlainText(
  text: string,
  target: TranslationTarget,
): Promise<TranslationResult> {
  const original = (text ?? "").trim();
  if (!original) return { text, translated: false, reason: "empty source" };

  const maxTokens = Math.min(800, Math.max(120, Math.round(original.length)));
  let reason = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const candidate = await callOnce(original, target, maxTokens);
      const isValid = isUsableTranslation(original, candidate);
      if (isValid.ok) {
        return { text: candidate, translated: true };
      }
      reason = isValid.reason ?? reason;
    } catch (error) {
      reason = sanitizeError(String(error));
    }
  }
  return { text, translated: false, reason };
}

/** Bounded-concurrency mapping over translatePlainText, preserving order.
 *  Failures fall back to the original string.
 */
export async function translatePlainBatch(
  items: string[],
  target: TranslationTarget,
  concurrency = 4,
): Promise<Array<{ text: string; translated: boolean }>> {
  if (items.length === 0) return [];

  const count = Math.max(1, Math.min(concurrency, items.length));
  const results: Array<{ text: string; translated: boolean }> = new Array(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const result = await translatePlainText(items[i], target);
      results[i] = { text: result.text, translated: result.translated };
    }
  };

  await Promise.all(Array.from({ length: count }, worker));
  return results;
}