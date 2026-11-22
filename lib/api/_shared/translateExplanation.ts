import { kiloRouter } from "./kiloRouter";
import { sanitizeError } from "./validation";

export type TranslationTarget = "es" | "vi";

const OPENING_PATTERNS: Record<TranslationTarget, RegExp> = {
  // Optional article/connector ("El petróleo", "Con el brent") before the commodity word.
  es: /^(?:(?:con\s+)?(?:el|la|los|las)\s+)?(?:petróleo|crudo|brent|wti|electricidad|energía|agua|precio)(?=[\s,:/(.]|$)/i,
  // Vietnamese has no article; "Giá dầu" / "Dầu thô" / "Điện" / "Nước" / "Brent".
  vi: /^(?:(?:với)\s+)?(?:dầu thô|dầu|brent|wti|điện|nước|giá)(?=[\s,:/(.]|$)/i,
};

export const OPENING_WORDS: Record<TranslationTarget, string[]> = {
  es: ["petróleo", "crudo", "brent", "wti", "electricidad", "energía", "agua", "precio"],
  vi: ["dầu", "dầu thô", "brent", "wti", "điện", "nước", "giá"],
};

export interface TranslationResult {
  text: string;
  translated: boolean;
  reason?: string;
}

/** Pure check of the commodity+price opening rule in the target language. */
export function checkTranslatedOpening(
  text: string,
  lang: TranslationTarget,
): { ok: true } | { ok: false; reason: string } {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty translation" };
  const pattern = OPENING_PATTERNS[lang];
  if (!pattern) return { ok: false, reason: `unsupported language: ${lang}` };
  if (!pattern.test(trimmed)) {
    return { ok: false, reason: `missing ${lang} commodity+price start` };
  }
  return { ok: true };
}

function checkLength(original: string, translated: string): { ok: true } | { ok: false; reason: string } {
  if (translated.length > original.length * 1.6 + 40) {
    return { ok: false, reason: "translation too long" };
  }
  return { ok: true };
}

function buildPrompt(text: string, target: TranslationTarget, commodities: string[]): { system: string; user: string } {
  const langName = target === "es" ? "Spanish" : "Vietnamese";
  const example = target === "es"
    ? "El petróleo/precio ... (e.g. \"El petróleo Brent se sitúa en 82 USD/barril...\")"
    : "Giá dầu ... (e.g. \"Giá dầu Brent ở mức 82 USD/thùng...\")";
  const system =
    `You are a professional translator. Translate the user's text into ${langName}. ` +
    "Output ONLY the translated text: no preamble, quotes, markdown, or notes. " +
    "The translation MUST begin with the commodity name in the target language followed by its price statement, " +
    `for example: ${example}. ` +
    "Keep every number, unit, currency symbol/code, percentage, date, proper noun, and URL exactly as in the source. " +
    "Do not add or remove facts. Keep the length close to the original.";
  const user = `Commodities: ${commodities.join(", ") || "none"}\n\nText:\n${text}`;
  return { system, user };
}

async function callOnce(
  text: string,
  target: TranslationTarget,
  commodities: string[],
): Promise<string> {
  const { system, user } = buildPrompt(text, target, commodities);
  const response = await kiloRouter.kiloInfer({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 300,
    temperature: 0,
  });
  return (response.choices?.[0]?.message?.content ?? "").trim();
}

/**
 * Translate a factor explanation, keeping the commodity+price opening rule.
 * Never throws: on failure (after one retry) returns the English original with translated=false.
 */
export async function translateExplanation(
  text: string,
  target: TranslationTarget,
  commodities: string[],
): Promise<TranslationResult> {
  const original = (text ?? "").trim();
  if (!original) return { text, translated: false, reason: "empty source" };

  let reason = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const candidate = await callOnce(original, target, commodities);
      const opening = checkTranslatedOpening(candidate, target);
      if (!opening.ok) {
        reason = opening.reason;
        continue;
      }
      const length = checkLength(original, candidate);
      if (!length.ok) {
        reason = length.reason;
        continue;
      }
      return { text: candidate, translated: true };
    } catch (error) {
      reason = sanitizeError(String(error));
    }
  }
  return { text, translated: false, reason };
}
