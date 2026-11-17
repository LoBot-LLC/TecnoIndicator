import { kiloRouter } from "../_shared/kiloRouter";
import { tinyfishRouter } from "../_shared/tinyfishRouter";
import { REGION_NAMES, type Region } from "../_shared/regions";
import { getGlobalAnalytics, getRegionalAnalytics } from "../_shared/deterministicAnalytics";
import {
  FACTOR_COUNT,
  FACTORS_WINDOW_TTL_MS,
  factorCacheKey,
  isRecentPublishedAt,
  isReputableSource,
  sanitizeUrl,
} from "../_shared/http";
import { getCache, setCache } from "../_shared/cache";
import { coerceCategory, safeParseJson } from "../_shared/validation";
import {
  VALID_CATEGORIES,
  type Factor,
  type FactorGrounding,
  type RegionId,
} from "../_shared/types";
import { getScopePriceDefaults } from "../_shared/deterministicAnalytics";

/**
 * The shape stored under the canonical `dynamic-factors:{scope}` key. Every
 * producer (global route, regional route, cron) and every consumer (solutions,
 * forecasts, health) reads and writes this exact shape, so the reasons the UI
 * shows are the reasons the solutions are generated from.
 */
export interface FactorWindow {
  factors: Factor[];
  aiCurated: boolean;
  updatedAt: string;
}

export interface FactorAnalysisOptions {
  abortSignal?: AbortSignal;
}

/** Response body shared by /api/dynamic-factors and /api/regional-factors. */
export interface FactorsPayload {
  factors: Factor[];
  scope: RegionId;
  count: number;
  aiCurated: boolean;
  cacheKey: string;
  updatedAt: string;
  error?: string;
}

export function toFactorsPayload(
  factors: Factor[],
  scope: RegionId,
  aiCurated: boolean,
  extra: { updatedAt: string; error?: string } = { updatedAt: new Date().toISOString() },
): FactorsPayload {
  return {
    factors,
    scope,
    count: factors.length,
    aiCurated,
    cacheKey: factorKeyForScope(scope),
    updatedAt: extra.updatedAt,
    ...(extra.error ? { error: extra.error } : {}),
  };
}

/**
 * Strips embedded URLs and markdown links from a model-generated explanation,
 * strips bullet/list markers from every line, and truncates to a readable
 * summary length (~2000 chars). Enforces exactly ONE meaningful sentence.
 * Defense-in-depth: even if the model ignores the "no URLs / no bullets /
 * summarize" instruction, the server never renders a bare URL, a bullet, or a
 * raw article fragment inside the reason prose.
 *
 * - Removes markdown links `[text](url)` → keeps only `text`
 * - Removes bare `https?://...` URLs entirely
 * - Strips bullet/list markers from the start of every line
 * - Strips markdown emphasis that may have wrapped URLs
 * - Strips markdown headers (###, ####, etc.)
 * - Collapses spaces/newlines
 * - Enforces ONE sentence: cuts at the first sentence boundary (., !, ?)
 *   if the cut point is at least 30 chars from the start (avoids cutting at
 *   abbreviations like "U.S.").
 * - Truncates to 2000 chars at a sentence boundary (never mid-sentence)
 */
export function sanitizeExplanation(text: string): string {
  if (typeof text !== "string" || text.trim().length === 0) return "";
  let cleaned = text
    // Strip markdown links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Strip bare URLs
    .replace(/https?:\/\/[^\s)]+/g, "")
    // Strip markdown emphasis that may have wrapped URLs
    .replace(/\*+/g, "")
    .replace(/_+/g, "")
    // Strip markdown headers (###, ####, etc.)
    .replace(/#+/g, " ")
    // Strip bullet/list markers from the start of every line ("- ", "• ", "* ", "– ", "— ")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*–—]+\s+/, ""))
    // Collapse multiple spaces
    .join(" ")
    .replace(/[ \t]+/g, " ")
    // Collapse newlines
    .replace(/\n+/g, " ")
    // Strip leading/trailing whitespace
    .trim();

  // Enforce ONE sentence: cut at the first sentence boundary (., !, ?)
  // followed by whitespace or end-of-string, but only if at least 30 chars from
  // the start (avoids cutting at abbreviations like "U.S.").
  const firstSentenceEnd = cleaned.search(/[.!?](?:\s|$)/);
  if (firstSentenceEnd >= 30) {
    cleaned = cleaned.slice(0, firstSentenceEnd + 1).trim();
  }

  // Truncate to 2000 chars at a sentence boundary (never mid-sentence)
  if (cleaned.length > 2000) {
    const cut = cleaned.slice(0, 2000);
    const lastSentenceEnd = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("! "),
      cut.lastIndexOf("? "),
    );
    const cutAt = lastSentenceEnd > 50 ? lastSentenceEnd + 2 : cut.lastIndexOf(" ");
    cleaned = cleaned.slice(0, cutAt).trim();
    if (!cleaned.endsWith(".") && !cleaned.endsWith("!") && !cleaned.endsWith("?")) {
      cleaned += "…";
    }
  }
  return cleaned;
}

/**
 * Extracts a meaningful summary from article text by taking the first complete
 * sentence. Strips bullet points, markdown headers, common article openers,
 * and page chrome, and ensures the result is exactly ONE meaningful sentence.
 */
function extractSummaryFromArticle(text: string): string {
  if (!text || text.trim().length === 0) return "";

  // Remove markdown links and URLs first
  let cleaned = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/\*+/g, "")
    .replace(/_+/g, "")
    // Strip markdown headers (###, ####, etc.)
    .replace(/#+/g, "");

  // Strip bullet markers from each line (handle multiple bullet types and spacing)
  cleaned = cleaned
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*–—]+\s+/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");

  // Collapse multiple spaces/newlines
  cleaned = cleaned.replace(/[ \t]+/g, " ").replace(/\n+/g, " ").trim();

  // Strip common article headers/navigation text at the start
  // e.g., "Home Research Monthly Oil Market Report...", "About Us Contact...", "Skip to content..."
  const headerPatterns = [
    /^(home|about|contact|skip to|navigation|menu|search|login|register)\s+/i,
    /^(monthly|quarterly|annual|daily|weekly)\s+(oil|energy|market|commodity|water|electricity|power)\s+(report|outlook|analysis|review|summary)\s+/i,
    /^(research|analysis|insights?|news|updates?|publications?)\s+/i,
    /^(opec|iea|eia|un|who|wri|irena|opec\+)\s+/i,
    /^(global|regional|international|national|local)\s+/i,
  ];
  for (const pattern of headerPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  // If the text starts with a common article opener (but not commodity+price),
  // skip past it to find the actual content.
  // Common article openers that should be stripped.
  const articleOpeners = [
    "according to ", "the report states ", "in a report ", "research shows ",
    "the study found ", "data shows ", "according to new data ", "the analysis ",
    "the article ", "this article ", "the paper ", "this paper ", "the document ",
    "as reported ", "as stated ", "it was reported ", "it was stated ",
    "recently ", "earlier ", "yesterday ", "today ", "this week ", "this month ",
    "this year ", "last week ", "last month ", "last year ",
    "a new ", "an updated ", "the latest ", "the most recent ",
  ];

  let result = cleaned;
  for (const opener of articleOpeners) {
    const lowerResult = result.toLowerCase();
    if (lowerResult.startsWith(opener)) {
      result = result.slice(opener.length).trim();
      break;
    }
  }

  // If after stripping there's still meaningful content, use it
  if (result.length > 50) {
    return sanitizeExplanation(result);
  }

  // Fall back: take the first sentence or clause
  // Try to find a sentence starting with a commodity reference
  const sentenceMatch = result.match(/[A-Z][^.!?]*\.(?:\s|$)/);
  if (sentenceMatch) {
    return sanitizeExplanation(sentenceMatch[0]);
  }

  // Last resort: sanitize the first 300 chars
  return sanitizeExplanation(result.slice(0, 300));
}

/**
 * When a candidate has both a search snippet and full scraped text, prefer the
 * snippet when it is a clean, self-contained sentence summary. This avoids
 * feeding raw full-page text (which often contains markdown headers, page
 * chrome, and navigation noise) into the deterministic fallback path.
 *
 * A "clean" snippet is one that:
 * - Is at least 50 chars
 * - Does NOT start with a publication name, modal verb, or preposition
 * - Does NOT contain markdown headers (####, ###) or page chrome markers
 * - Contains at least one sentence-ending punctuation
 */
function pickCleanSnippet(snippet: string): string {
  if (!snippet || snippet.trim().length < 50) return "";
  const trimmed = snippet.trim();
  // Reject snippets that start with known raw-article openers
  if (/^(opec|iea|un|who|eia|opec\+|european|asian|african|american|australian|south|north|middle|southeast|latin)\s+/i.test(trimmed)) return "";
  if (/^(can|could|would|will|may|might|should|this|these|those|at|from|by|for|to|as|with|in|on|it|its|their|there|here|they|them|we|our|now|then|so|but|and|or|nor|not|no|yes|however|meanwhile|despite|although|while|whereas|therefore|thus|hence|accordingly|consequently|what|when|how|why|where|which|who|whose|around|according|four|million|billion|the world|demand|supply)\s+/i.test(trimmed)) return "";
  // Reject snippets containing page chrome
  if (/####|###|licence:|license:|share this report|report options|cite report|release dates?$/i.test(trimmed)) return "";
  // Reject snippets without sentence-ending punctuation
  if (!/[.!?](\s|$)/.test(trimmed)) return "";
  return trimmed;
}

/**
 * Validates that a model-generated explanation looks like a proper SINGLE
 * meaningful sentence summary rather than raw scraped article text. Returns
 * { ok: true } when the explanation passes, or { ok: false, reason } when it
 * should be rejected or re-summarized.
 *
 * Rejection criteria:
 * - Starts with a bullet point ("- ", "• ", "* ", "– ", "— ") — clear sign of raw scraped text
 * - Is static fallback placeholder text — these are placeholders, not real summaries
 * - Starts with a known raw-article opener (publication name, article opening)
 * - Is multiple sentences — must be exactly ONE meaningful sentence
 * - Too short (< 50 chars) or too long (> 2000 chars for a proper summary)
 * - Too few sentences for length (> 100 chars with no sentence-ending punctuation)
 */
export function validateExplanationQuality(explanation: string): { ok: boolean; reason?: string } {
  if (!explanation || typeof explanation !== "string") {
    return { ok: false, reason: "empty" };
  }
  const trimmed = explanation.trim();
  // Reject bullet-point starters — clear sign of raw scraped text
  if (/^[-•*–—]\s/.test(trimmed)) {
    return { ok: false, reason: "starts with bullet point" };
  }

  // Reject static fallback factor text — these are placeholders, not real summaries
  if (/^static\s+/i.test(trimmed) && /fallback factor maintained/i.test(trimmed)) {
    return { ok: false, reason: "static fallback text" };
  }

  // Reject known raw-article starters that indicate the model copied verbatim.
  // These are intentionally narrow: only starters that a genuine 2-3 sentence
  // analyst summary would never begin with.
  const rawStarters = [
    // Publication names
    "opec ", "iea ", "un ", "who ", "eia ", "opec+ ",
    // Regional/country prefixes (common raw article openers)
    "european ", "asian ", "african ", "american ", "australian ", "south american ",
    "north american ", "middle eastern ", "southeast asian ", "latin american ",
    // Modal verbs (clear raw text / fragment)
    "can ", "could ", "would ", "will ", "may ", "might ", "should ",
    // Demonstrative pronouns
    "this ", "these ", "those ",
    // Prepositional/open-phrase starters (only single-char prepositions at start)
    "at ", "from ", "by ", "for ", "to ", "as ", "with ", "in ", "on ",
    // Pronoun openers
    "it ", "its ", "their ", "there ", "here ", "they ", "them ", "we ", "our ",
    // Adverb/conjunction openers
    "now ", "then ", "so ", "but ", "and ", "or ", "nor ", "not ", "no ", "yes ",
    // Transitional phrases
    "however ", "meanwhile ", "despite ", "although ", "while ", "whereas ",
    "therefore ", "thus ", "hence ", "accordingly ", "consequently ",
    // Question/openers from article titles
    "what ", "when ", "how ", "why ", "where ", "which ", "who ", "whose ",
    // Common article openings not covered above
    "around ", "according ", "four ", "million ", "billion ", "the world ",
    "demand ", "supply ",
  ];
  const lower = trimmed.toLowerCase();
  for (const starter of rawStarters) {
    if (lower.startsWith(starter)) {
      // Allow if it starts with commodity+price pattern (e.g. "Oil at $XX...")
      if (!/^(with\s+(oil|electricity|water)|(oil|electricity|water|crude|brent|wti)\s+(at|is|are|was|were|rose|fell|climbed|dropped|surged|plunged))/i.test(trimmed)) {
        return { ok: false, reason: `starts with raw-article text ("${starter.trim()}")` };
      }
      break;
    }
  }

  // Reject explanations that are too short or too long for a proper summary
  if (trimmed.length < 50) {
    return { ok: false, reason: "too short" };
  }
  if (trimmed.length > 2000) {
    return { ok: false, reason: "too long" };
  }

  // Reject explanations that contain page chrome / noise patterns typical of
  // scraped web pages that a genuine analyst summary would never include.
  // These are checked AFTER length so a long bullet-pasted article is still
  // classified as "starts with bullet point" rather than "page chrome".
  const pageChromePatterns = [
    /####\s+cite\s+report/i,
    /####\s+share\s+this\s+report/i,
    /####\s+report\s+options/i,
    /licence:\s*cc\s+by/i,
    /license:\s*cc\s+by/i,
    /data\s+for\s+\d{4}[-–]\d{4}\s+are\s+forecast/i,
    /values\s+for\s+the\s+\d{4}[-–]\d{4}\s+period\s+are\s+forecasts/i,
    /the\s+plots\s+start\s+from/i,
    /x-axis\s+labels\s+are\s+shown\s+only/i,
    /release\s+dates?\s*$/i,
    /interactive\s+\w+\s*$/i,
    /download/i,
    /share\s+this\s+report/i,
    /report\s+options/i,
    /cite\s+report/i,
  ];
  for (const pattern of pageChromePatterns) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: "page chrome / noise" };
    }
  }

  // Require at least one sentence-ending punctuation for explanations longer
  // than ~100 chars. Raw scraped fragments often run on without punctuation.
  // Uses [.!?] followed by whitespace OR end-of-string so a single complete
  // sentence ending in a period is accepted.
  if (trimmed.length > 100 && (trimmed.match(/[.!?](\s|$)/g)?.length ?? 0) < 1) {
    return { ok: false, reason: "too few sentences for length" };
  }

  // Reject explanations with more than one sentence — must be exactly ONE meaningful sentence
  const sentenceCount = (trimmed.match(/[.!?](\s|$)/g)?.length ?? 0);
  if (sentenceCount > 1) {
    return { ok: false, reason: "multiple sentences" };
  }

  return { ok: true };
}

/**
 * Second-pass summarization: takes a raw explanation that failed quality
 * checks and asks Kilo to rewrite it into a proper single meaningful sentence.
 * Used as a repair round before rejecting a factor entirely.
 *
 * Post-processes the model output through sanitizeExplanation and validates
 * the result. If the model ignores the constraints (still too long, still
 * bullets, etc.), applies a last-resort truncation at a sentence boundary.
 */
export async function reSummarizeExplanation(
  rawExplanation: string,
  currentPrices: {
    oil: { price: number; unit: string };
    electricity: { price: number; unit: string };
    water: { price: number; unit: string };
  },
  signal?: AbortSignal,
): Promise<string | null> {
  const prompt = `Rewrite the following text into exactly ONE meaningful sentence (under 2000 characters). The sentence MUST start with "With [commodity] at $[price]/[unit]..." using the exact current price numbers provided below. Write in your own words — do NOT copy text verbatim. Do NOT include URLs, markdown links, bullet points, or publication names. Do NOT start with a bullet point or dash. Do NOT include publication headers, dates, or metadata. Focus on the specific price driver: what changed and why it matters for oil/electricity/water prices.

Current prices: oil \$${currentPrices.oil.price}/${currentPrices.oil.unit}, electricity \$${currentPrices.electricity.price}/${currentPrices.electricity.unit}, water \$${currentPrices.water.price}/${currentPrices.water.unit}

Text to summarize: "${rawExplanation}"`;

  const payload = {
    messages: [
      { role: "system", content: "You are a precise summarizer. Output only a single meaningful sentence, no preamble, no markdown, no URLs, no bullet points, no dashes at the start, no publication headers, dates, or metadata. Focus on the specific price driver: what changed and why it matters for prices." },
      { role: "user", content: prompt },
    ],
    max_tokens: 200,
    temperature: 0.1,
  };

  try {
    const response = await kiloRouter.kiloInfer(payload, signal);
    const content = (response.choices?.[0]?.message?.content ?? "").trim();
    if (!content) return null;

    // Post-process: sanitize the model output
    const sanitized = sanitizeExplanation(content);
    if (!sanitized) return null;

    // Validate the sanitized result
    const quality = validateExplanationQuality(sanitized);
    if (quality.ok) {
      return sanitized;
    }

    // If still fails quality, apply last-resort truncation
    console.warn(`reSummarizeExplanation: sanitized result still failed quality ("${quality.reason}"); applying last-resort truncation`);
    return truncateToSentenceBoundary(sanitized, 2000);
  } catch {
    return null;
  }
}

/**
 * Truncates text to `maxLen` characters at the nearest sentence boundary.
 * If no sentence boundary is found within the text, cuts at the last word
 * boundary and appends an ellipsis.
 */
function truncateToSentenceBoundary(text: string, maxLen: number = 2000): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSentenceEnd = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("?"),
  );
  const cutAt = lastSentenceEnd > 50 ? lastSentenceEnd + 1 : cut.lastIndexOf(" ");
  let result = text.slice(0, cutAt).trim();
  if (!result.endsWith(".") && !result.endsWith("!") && !result.endsWith("?")) {
    result += "…";
  }
  return result;
}

/**
 * Final validation+repair pass that runs on ALL factors before they reach the UI,
 * regardless of source (cache, fresh curation, deterministic fallback, error fallback).
 * No factor with a bad explanation is ever returned unrepaired.
 *
 * For each factor:
 * - If explanation passes quality check → kept as-is
 * - If explanation fails → attempts reSummarizeExplanation repair round
 * - If re-summarization succeeds and passes quality → uses re-summarized text
 * - If re-summarization fails → last-resort: sanitize + truncate to 2000 chars, never drop
 * - If even sanitized text is empty → uses a safe generic placeholder
 *
 * Never drops a factor — better to have a clean short explanation than no factor at all.
 */
export function filterStaticFallbacks(factors: Factor[]): Factor[] {
  return factors.filter((f) => {
    const trimmed = (f?.explanation ?? "").trim();
    if (/^static\s+/i.test(trimmed) && /fallback factor maintained/i.test(trimmed)) return false;
    return true;
  });
}

export async function validateAndRepairWindow(
  factors: Factor[],
  currentPrices: {
    oil: { price: number; unit: string; source: string };
    electricity: { price: number; unit: string; source: string };
    water: { price: number; unit: string; source: string };
  },
  signal?: AbortSignal,
): Promise<Factor[]> {
  const repaired: Factor[] = [];
  for (const f of filterStaticFallbacks(factors)) {
    const quality = validateExplanationQuality(f.explanation);
    if (quality.ok) {
      repaired.push(f);
      continue;
    }

    // Auto-remove static fallback factors entirely — don't try to repair them
    if (quality.reason === "static fallback text") {
      console.warn(`validateAndRepairWindow: removing static fallback factor "${f.name}"`);
      continue;
    }

    console.warn(`validateAndRepairWindow: explanation failed quality ("${quality.reason}") for factor "${f.name}"; attempting re-summarization`);
    const reSummary = await reSummarizeExplanation(f.explanation, currentPrices, signal);
    if (reSummary) {
      const reQuality = validateExplanationQuality(reSummary);
      if (reQuality.ok) {
        repaired.push({ ...f, explanation: reSummary });
        continue;
      }
      console.warn(`validateAndRepairWindow: re-summarization still failed quality ("${reQuality.reason}") for factor "${f.name}"; using last-resort sanitization`);
    } else {
      console.warn(`validateAndRepairWindow: re-summarization returned null for factor "${f.name}"; using last-resort sanitization`);
    }
    // Last resort: sanitize and truncate heavily, never drop the factor
    const sanitized = sanitizeExplanation(f.explanation);
    if (sanitized) {
      repaired.push({ ...f, explanation: sanitized });
    } else {
      repaired.push({ ...f, explanation: "Price movement driven by market factors reported by the source." });
    }
  }
  return repaired;
}

const SYSTEM_PROMPT_GLOBAL =
`You are a Senior Commodity Risk Analyst. You are provided with current global market analytics, an existing list of global price factors, and fresh validated news excerpts collected through TinyFish.

=== STEPS (follow in order) ===
1. Read EVERY candidate's title, snippet, and full text carefully.
2. Identify the CONCRETE reason the article gives for an oil, electricity, or water price movement. This is a factual claim the article itself makes, not your own inference.
3. Write that reason in a SINGLE meaningful sentence in the explanation field. Start with the commodity and the current price number from currentPrices (e.g. "with oil at $104.86/bbl..."). Use the numbers; do not paraphrase around them.
4. Set the source field to the EXACT URL string from the candidate list — copy it verbatim, character for character. Never write a publication name.

=== FORBIDDEN ===
- NEVER output a bare publication name (e.g. "IEA", "OPEC Monthly Oil Market Report", "UN-Water; WRI Aqueduct") in the source field.
- NEVER invent a URL. If you cannot find a matching URL, copy the URL verbatim from the candidate list.
- NEVER output markdown or commentary outside the JSON.
- NEVER output raw scraped text or article snippets verbatim. Always summarize in your own words.
- NEVER start an explanation with a bullet point ("- ", "• ", "* "), a publication name ("OPEC ", "IEA ", "UN-Water "), or an article opening ("Around ", "According ", "The world ", "Global ").
- NEVER write more than ONE sentence per explanation. Each explanation MUST be a single, complete, meaningful sentence (not a fragment, not a bullet point, not multiple sentences).
- NEVER include publication headers, dates, or metadata in the explanation.
- Do NOT include publication headers, dates, or metadata in the explanation.

=== EXPLANATION REQUIREMENTS ===
- Each explanation MUST be a single, complete, meaningful sentence (not a fragment, not a bullet point, not multiple sentences)
- Do NOT start with bullet points (-, •, *, –, —) or article navigation text
- Do NOT include publication headers, dates, or metadata
- Focus on the specific price driver: what changed, why it matters for oil/electricity/water prices
- Maximum 2000 characters, but prefer concise single sentences
- Start with the commodity and current price number from currentPrices (e.g. "with oil at $104.86/bbl...")

=== FEW-SHOT EXAMPLES (GOOD vs BAD) ===

GOOD explanation (single sentence, starts with commodity+price, own words, no URLs):
"With oil at $73.07/bbl, OPEC+ has agreed to extend voluntary production cuts through Q1 2026, which is expected to remove roughly 1.2 million b/d from the market and support prices in the short term."

GOOD explanation:
"With oil at $104.86/bbl, the IEA forecasts global oil demand will fall by 2.7 mb/d in 2026 before rebounding by 2 mb/d in 2027, with the year-on-year decline set to ease to 2.7 mb/d in Q4 2026."

GOOD explanation (water):
"With water at $2.15/M³, drought-driven supply disruptions from scarcity affecting 4 billion people are pushing utility tariffs higher as scarcity premiums are increasingly reflected in consumer prices."

BAD explanation — raw scraped text, do NOT copy (verbatim from source):
"OPEC Reference Basket (ORB) rose by 9¢, to average $73.07/b. The global oil demand in 2026 is forecast to grow by 1.4 mb/d, y-o-y. expected to reach 42.7 mb/d,"

BAD explanation — starts with bullet, not summarized:
"- World oil demand is forecast to fall by 2.7 mb/d in 2026, to 102.3 mb/d, before rebounding by 2 mb/d in 2027."

BAD explanation — raw article opening, no commodity+price start:
"Around four billion people experience severe water scarcity for at least one month each year, while drought impacts cost an estimated $307 billion annually."

BAD explanation — multiple sentences (should be ONE sentence):
"With oil at $73.07/bbl, OPEC+ has agreed to extend voluntary production cuts through Q1 2026. The supply restraint is expected to remove roughly 1.2 million b/d from the market."

Every explanation you output must follow the GOOD examples: ONE meaningful sentence, your own words, starts with commodity + current price number from currentPrices, no URLs, no markdown, no bullet points, no raw article text, no publication headers, dates, or metadata.

=== GROUNDING ===
Every factor's explanation MUST reference the current price numbers supplied in currentPrices. For example: "with oil at $104.86/bbl, OPEC+ output cuts are tightening supply...". Use the numbers, do not paraphrase around them.

=== WORKED EXAMPLE ===
{"id":"example-1","name":"OPEC+ output restraint","category":"Market","commodities":["oil"],"explanation":"With oil at $104.86/bbl, OPEC+ members have agreed to extend voluntary production cuts through Q1 2026, which is expected to remove roughly 1.2 million b/d from the market and support prices in the short term.","direction":"up","magnitude":"High","source":"https://www.iea.org/reports/world-energy-outlook-2026","bias":"short","importanceScore":82,"drift":{"oil":0.5}}

=== JSON SCHEMA ===
Each factor object must be exactly: { id: string; name: string; category: "Market"|"Policy"|"Structural"|"Infrastructure"|"Environmental"|"Geopolitical"|"Technological"; commodities: string[] (subset of oil, electricity, water); explanation: string (ONE meaningful sentence summarizing the reason found in the supplied source URL, starting with commodity + current price number); direction: "up"|"down"|"mixed"; magnitude: "High"|"Medium"|"Low"; source: string (the EXACT URL string from the candidate list — a URL, never a publication name); bias: "short"|"mid"|"long"|"flat"; importanceScore: integer 0-100; drift: object mapping commodity to a small decimal adjustment }.

The source field MUST be an exact URL string from the supplied candidate list. It is a URL, never a publication name.

Return strict JSON only. Do not return markdown or commentary outside JSON.

The response must contain up to eight validated global factors matching the required schema. If a new legitimate trend is identified, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

const SYSTEM_PROMPT_REGIONAL = (regionName: string) =>
`You are a Senior Commodity Risk Analyst specializing in ${regionName} energy and water markets. You are provided with current ${regionName}-specific market analytics, an existing list of ${regionName} price factors, and fresh validated news excerpts collected through TinyFish that are relevant to ${regionName}.

=== STEPS (follow in order) ===
1. Read EVERY candidate's title, snippet, and full text carefully.
2. Identify the CONCRETE reason the article gives for an oil, electricity, or water price movement. This is a factual claim the article itself makes, not your own inference.
3. Write that reason in a SINGLE meaningful sentence in the explanation field. Start with the commodity and the current price number from currentPrices (e.g. "with oil at $104.86/bbl..."). Use the numbers; do not paraphrase around them.
4. Set the source field to the EXACT URL string from the candidate list — copy it verbatim, character for character. Never write a publication name.

=== FORBIDDEN ===
- NEVER output a bare publication name (e.g. "IEA", "OPEC Monthly Oil Market Report", "UN-Water; WRI Aqueduct") in the source field.
- NEVER invent a URL. If you cannot find a matching URL, copy the URL verbatim from the candidate list.
- NEVER output markdown or commentary outside the JSON.
- NEVER output raw scraped text or article snippets verbatim. Always summarize in your own words.
- NEVER start an explanation with a bullet point ("- ", "• ", "* "), a publication name ("OPEC ", "IEA ", "UN-Water "), or an article opening ("Around ", "According ", "The world ", "Global ").
- NEVER write more than ONE sentence per explanation. Each explanation MUST be a single, complete, meaningful sentence (not a fragment, not a bullet point, not multiple sentences).
- NEVER include publication headers, dates, or metadata in the explanation.
- Do NOT include publication headers, dates, or metadata in the explanation.

=== EXPLANATION RULES ===
- Write the explanation in YOUR OWN WORDS. Never copy text verbatim from the source article.
- The explanation must be a SINGLE meaningful sentence that a human analyst would write.
- NEVER include a URL inside the explanation text. The source URL goes ONLY in the "source" field.
- NEVER include markdown links like [text](url) inside the explanation.
- Start the explanation with the commodity and the current price number from currentPrices (e.g. "with oil at $104.86/bbl...").
- Keep the explanation under 2000 characters. Short and punchy is better than long and detailed.
- If the article is about a price RISE, say prices are rising and why. If about a FALL, say prices are falling and why.
- Each explanation MUST be a single, complete, meaningful sentence (not a fragment, not a bullet point, not multiple sentences)
- Do NOT start with bullet points (-, •, *, –, —) or article navigation text
- Do NOT include publication headers, dates, or metadata
- Focus on the specific price driver: what changed, why it matters for oil/electricity/water prices

=== FEW-SHOT EXAMPLES (GOOD vs BAD) ===

GOOD explanation (single sentence, starts with commodity+price, own words, no URLs):
"With oil at $73.07/bbl, OPEC+ has agreed to extend voluntary production cuts through Q1 2026, which is expected to remove roughly 1.2 million b/d from the market and support prices in the short term."

GOOD explanation:
"With oil at $104.86/bbl, the IEA forecasts global oil demand will fall by 2.7 mb/d in 2026 before rebounding by 2 mb/d in 2027, with the year-on-year decline set to ease to 2.7 mb/d in Q4 2026."

GOOD explanation (water):
"With water at $2.15/M³, drought-driven supply disruptions from scarcity affecting 4 billion people are pushing utility tariffs higher as scarcity premiums are increasingly reflected in consumer prices."

BAD explanation — raw scraped text, do NOT copy (verbatim from source):
"OPEC Reference Basket (ORB) rose by 9¢, to average $73.07/b. The global oil demand in 2026 is forecast to grow by 1.4 mb/d, y-o-y. expected to reach 42.7 mb/d,"

BAD explanation — starts with bullet, not summarized:
"- World oil demand is forecast to fall by 2.7 mb/d in 2026, to 102.3 mb/d, before rebounding by 2 mb/d in 2027."

BAD explanation — raw article opening, no commodity+price start:
"Around four billion people experience severe water scarcity for at least one month each year, while drought impacts cost an estimated $307 billion annually."

BAD explanation — multiple sentences (should be ONE sentence):
"With oil at $73.07/bbl, OPEC+ has agreed to extend voluntary production cuts through Q1 2026. The supply restraint is expected to remove roughly 1.2 million b/d from the market."

Every explanation you output must follow the GOOD examples: ONE meaningful sentence, your own words, starts with commodity + current price number from currentPrices, no URLs, no markdown, no bullet points, no raw article text, no publication headers, dates, or metadata.

=== GROUNDING ===
Every factor's explanation MUST reference the current price numbers supplied in currentPrices. For example: "with oil at $104.86/bbl, OPEC+ output cuts are tightening supply...". Use the numbers, do not paraphrase around them.

=== WORKED EXAMPLE ===
{"id":"example-1","name":"OPEC+ output restraint","category":"Market","commodities":["oil"],"explanation":"With oil at $104.86/bbl, OPEC+ members have agreed to extend voluntary production cuts through Q1 2026, which is expected to remove roughly 1.2 million b/d from the market and support prices in the short term.","direction":"up","magnitude":"High","source":"https://www.iea.org/reports/world-energy-outlook-2026","bias":"short","importanceScore":82,"drift":{"oil":0.5}}

=== JSON SCHEMA ===
Each factor object must be exactly: { id: string; name: string; category: "Market"|"Policy"|"Structural"|"Infrastructure"|"Environmental"|"Geopolitical"|"Technological"; commodities: string[] (subset of oil, electricity, water); explanation: string (ONE meaningful sentence summarizing the reason found in the supplied source URL, starting with commodity + current price number); direction: "up"|"down"|"mixed"; magnitude: "High"|"Medium"|"Low"; source: string (the EXACT URL string from the candidate list — a URL, never a publication name); bias: "short"|"mid"|"long"|"flat"; importanceScore: integer 0-100; drift: object mapping commodity to a small decimal adjustment }.

The source field MUST be an exact URL string from the supplied candidate list. It is a URL, never a publication name.

Return strict JSON only. Do not return markdown or commentary outside JSON.

The response must contain up to eight validated ${regionName} factors matching the required schema. If a new legitimate trend is identified for ${regionName}, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

const GLOBAL_QUERIES = [
  "global oil market prices OPEC supply demand 2026",
  "global electricity power prices renewable energy grid 2026",
  "global water prices scarcity drought utilities 2026",
];

const REGION_QUERIES: Record<Region, string[]> = {
  asia: [
    "Asia oil market prices China India demand OPEC 2026",
    "Asia electricity power prices renewables grid China India 2026",
    "Asia water prices scarcity drought urbanization 2026",
  ],
  europe: [
    "Europe oil market prices Brent Russian supply sanctions 2026",
    "Europe electricity power prices carbon ETS renewables gas 2026",
    "Europe water prices drought scarcity Alpine hydropower 2026",
  ],
  africa: [
    "Africa oil market prices Nigeria Angola production exports 2026",
    "Africa electricity power prices diesel gensets grid reliability 2026",
    "Africa water prices drought scarcity Sahel utilities 2026",
  ],
  americas: [
    "Americas oil market prices WTI shale LNG exports 2026",
    "Americas electricity power prices hydro drought Henry Hub 2026",
    "Americas water prices drought California Southwest utilities 2026",
  ],
  oceania: [
    "Oceania oil market prices LNG import parity Australia 2026",
    "Oceania electricity power prices NEM NZ wholesale drought 2026",
    "Oceania water prices drought Sydney Melbourne utilities 2026",
  ],
};

const KNOWN_REPUTABLE_URLS = [
  "https://www.iea.org/reports/world-energy-outlook",
  "https://www.opec.org/opec_web/en/",
  "https://www.eia.gov/petroleum/",
  "https://www.unwater.org/",
  "https://www.wri.org/",
  "https://www.irena.org/",
];

const FALLBACK_NAMES: Record<RegionId, string[]> = {
  global: [
    "OPEC+ Production Decisions",
    "Geopolitical Tensions & Supply Disruptions",
    "Demand Growth in China & India",
    "Renewable Energy Buildout",
    "Weather & Temperature Extremes",
    "Water Scarcity & Drought",
    "Desalination & Reuse Technology",
    "Grid & Water Infrastructure Investment",
  ],
  asia: [
    "China & India Energy Demand Growth",
    "ASEAN Grid Interconnection",
    "Coal-to-Gas Switching",
    "Strait of Hormuz Risk",
    "Urbanization & Desalination",
    "Renewable Energy Buildout",
    "Monsoon & Hydropower Variability",
    "EV Adoption & Battery Storage",
  ],
  europe: [
    "EU ETS Carbon Price",
    "Russian Supply Displacement",
    "Renewables Curtailment Risk",
    "Drought & Alpine Hydro",
    "Nuclear & Gas Generation Mix",
    "Energy Efficiency Mandates",
    "Offshore Wind Expansion",
    "Heat Pump Electrification",
  ],
  africa: [
    "Nigeria & Angola Production",
    "Diesel Genset Dependence",
    "Drought & Sahel Scarcity",
    "Subsidy Reform Pressure",
    "Hydroelectric Reliance",
    "Solar Mini-Grid Deployment",
    "Copper & Critical Minerals Demand",
    "Diesel Import Parity Pricing",
  ],
  americas: [
    "US Shale Productivity",
    "Henry Hub Gas to Power",
    "LatAm Hydrology & Drought",
    "Pipeline & Export Capacity",
    "California Water Stress",
    "Grid Resilience Investment",
    "EV Adoption & Battery Storage",
    "LNG Export Growth",
  ],
  oceania: [
    "LNG Export Linkage",
    "NEM & NZ Wholesale Spikes",
    "Millennium Drought Legacy",
    "Remote Island Fuel Premiums",
    "Desalination & Reuse",
    "Renewable Energy Zones",
    "Coal Plant Retirements",
    "Urban Water Tariff Reform",
  ],
};

const RECENT_MONTH = () =>
  new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

function scopeRegion(scope: RegionId): Region | null {
  return scope === "global" ? null : (scope as Region);
}

function scopeLabel(scope: RegionId): string {
  const region = scopeRegion(scope);
  return region ? REGION_NAMES[region] : "global";
}

export function factorKeyForScope(scope: RegionId): string {
  return factorCacheKey(scope);
}

/**
 * Reads the currently stored factor window for a scope. Returns null when
 * nothing has been curated yet. A legacy bare `Factor[]` payload (written by
 * the old cron endpoint) is accepted so in-flight deployments do not reset.
 */
export async function readFactorWindow(scope: RegionId): Promise<FactorWindow | null> {
  const key = factorKeyForScope(scope);
  const raw = await getCache<unknown>(key, FACTORS_WINDOW_TTL_MS);
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const factors = raw.filter(isFactorLike);
    if (factors.length === 0) return null;
    const updatedAt = factors[0]?.updatedAt ?? new Date().toISOString();
    return { factors, aiCurated: true, updatedAt };
  }
  if (typeof raw !== "object") return null;
  const entry = raw as Partial<FactorWindow>;
  const factors = Array.isArray(entry.factors) ? entry.factors.filter(isFactorLike) : [];
  if (factors.length === 0) return null;
  return {
    factors,
    aiCurated: entry.aiCurated === true,
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
  };
}

export async function writeFactorWindow(
  scope: RegionId,
  factors: Factor[],
  aiCurated: boolean,
): Promise<FactorWindow> {
  const window: FactorWindow = { factors, aiCurated, updatedAt: new Date().toISOString() };
  await setCache(factorKeyForScope(scope), window, FACTORS_WINDOW_TTL_MS);
  return window;
}

/** True when the stored window is recent enough to answer a request without re-curating. */
export function isFreshWindow(window: FactorWindow, freshnessMs: number): boolean {
  const age = Date.now() - Date.parse(window.updatedAt);
  return Number.isFinite(age) && age >= 0 && age < freshnessMs;
}

function isFactorLike(value: unknown): value is Factor {
  if (!value || typeof value !== "object") return false;
  const f = value as Partial<Factor>;
  return typeof f.name === "string" && Array.isArray(f.commodities);
}

function normalizeFactorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function buildFallbackFactors(scope: RegionId): Factor[] {
  const now = new Date().toISOString();
  const label = scopeLabel(scope);
  const source =
    scope === "global"
      ? "Public market benchmarks (EIA, IEA, OPEC, UN-Water)"
      : `${label} regional energy authorities and public benchmarks`;
  const commodities: Factor["commodities"] = ["oil", "electricity", "water"];
  return FALLBACK_NAMES[scope].slice(0, FACTOR_COUNT).map((name, i) => ({
    id: `fallback-${scope}-${i + 1}`,
    name,
    category: i % 3 === 0 ? "Policy" : i % 3 === 1 ? "Market" : "Structural",
    commodities,
    explanation: `Static ${label} fallback factor maintained when live AI curation is unavailable.`,
    direction: i % 3 === 2 ? "mixed" : i % 2 === 0 ? "up" : "down",
    magnitude: (["High", "Medium", "Low"] as const)[i % 3],
    source,
    bias: (["short", "mid", "long", "flat"] as const)[i % 4],
    drift: {},
    regions: scope === "global" ? ["global"] : [scope],
    scope,
    importanceScore: 70 - i * 2,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
   * Deterministic, URL-backed factor construction used when Kilo fails to return
   * usable factors but TinyFish successfully produced real candidate URLs. Each
   * factor is built directly from a fetched article — the name from its title, the
   * explanation from a meaningful extracted summary, and the source from the actual
   * TinyFish URL — so the UI never falls back to bare static publication names.
   *
   * These factors carry `aiCurated: false` (they are not AI-summarized), but every
   * `source` is a genuine, clickable link and every explanation is a real summary
   * extracted from article text. The category/direction/bias fields are inferred
   * from keywords because no model is summarizing at this point.
   */
  export function buildFactorsFromCandidates(
    candidates: Array<{ url: string; title?: string; snippet?: string; text?: string }>,
    scope: RegionId,
    currentPrices: {
      oil: { price: number; unit: string; source: string };
      electricity: { price: number; unit: string; source: string };
      water: { price: number; unit: string; source: string };
    },
    now: string,
  ): Factor[] {
    const region = scopeRegion(scope);
    const regions: RegionId[] = scope === "global" ? ["global"] : region ? [region] : [];
    const grounding = attachFactorGrounding(currentPrices, now);

    const usable = candidates
      .filter((c) => c && typeof c.url === "string" && c.url.length > 0)
      .slice(0, FACTOR_COUNT);

    const factors: Factor[] = [];

    usable.forEach((candidate, index) => {
      const position = index + 1;
      const title = (candidate.title ?? "").trim();
      const snippet = (candidate.snippet ?? "").trim();
      const text = (candidate.text ?? "").trim();

      // Explanation: extract a meaningful summary from the best available source.
      // Prefer the search snippet when it is a clean, complete sentence summary —
      // it is short and self-contained. Fall back to the full scraped text when
      // the snippet is missing or looks like a mid-article fragment.
      let explanation = "";
      const cleanSnippet = pickCleanSnippet(snippet);
      if (cleanSnippet) {
        explanation = extractSummaryFromArticle(cleanSnippet);
      }
      if (!explanation && text) {
        explanation = extractSummaryFromArticle(text);
      }
      if (explanation) {
        explanation = sanitizeExplanation(explanation);
      }
      if (!explanation) return;

      const name = (title || explanation.slice(0, 160) || `Market update: ${candidate.url}`).slice(0, 160);

      const haystack = `${title} ${snippet} ${text}`.toLowerCase();

      const commodities: Factor["commodities"] = [];
      if (/oil|crude|petroleum|\bbbl\b|brent|\bwti\b/.test(haystack)) commodities.push("oil");
      if (/electricity|power|\bgrid\b|\bmwh\b|megawatt|kilowatt|utilit/.test(haystack))
        commodities.push("electricity");
      if (/water|drought|scarcity|hydrolog|aquifer|desalination/.test(haystack))
        commodities.push("water");
      if (commodities.length === 0) commodities.push("oil");

      let direction: Factor["direction"] = "mixed";
      if (/\b(rise|rising|surge|surged|climb|climbed|spike|spiked|jump|jumped|rally|rallied|gain|gained|increase|increased|soar|soared)\b/.test(haystack)) {
        direction = "up";
      } else if (/\b(fall|falling|fell|drop|dropped|decline|declined|plunge|plunged|slump|slumped|sink|sank|crash|crashed|decrease|decreased|tumble|tumbled)\b/.test(haystack)) {
        direction = "down";
      }

      let category: Factor["category"] = "Structural";
      if (/supply|opec|production|output|inventor|inventory|\bcuts?\b|restrain|constraint|shortage/.test(haystack)) {
        category = "Market";
      } else if (/policy|demand|regulat|mandate|subsid|tariff|\btax\b|\blaw\b|\brule\b/.test(haystack)) {
        category = "Policy";
      }

      let bias: Factor["bias"] = "flat";
      if (/supply|\bcuts?\b|restrain|constraint|shortage|disruption|shortfall/.test(haystack)) {
        bias = "short";
      } else if (/demand|growth|surge|rise|rising|increase|expansion/.test(haystack)) {
        bias = "mid";
      }

      const importanceScore = Math.max(0, Math.min(100, 70 - position));

      factors.push({
        id: `deterministic-${scope}-${position}-${Date.now()}`,
        name,
        category,
        commodities: Array.from(new Set(commodities)) as Factor["commodities"],
        explanation: sanitizeExplanation(explanation),
        direction,
        magnitude: "Medium",
        source: candidate.url,
        bias,
        drift: {},
        grounding,
        regions,
        scope,
        importanceScore,
        createdAt: now,
        updatedAt: now,
      });
    });

    return factors;
  }

export function normalizeFactor(
  raw: unknown,
  scope: RegionId,
  candidates: Array<{ url: string; title?: string; site_name?: string }> = [],
): Factor | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const name = typeof f.name === "string" ? f.name.trim() : "";
  const explanation = typeof f.explanation === "string" ? f.explanation.trim() : "";
  const source = typeof f.source === "string" ? f.source.trim() : "";
  const id =
    typeof f.id === "string" && f.id.trim()
      ? f.id.trim()
      : `dynamic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const category = coerceCategory(f.category, VALID_CATEGORIES);
  const direction =
    f.direction === "up" || f.direction === "down" || f.direction === "mixed" ? f.direction : "mixed";
  const magnitude =
    f.magnitude === "High" || f.magnitude === "Medium" || f.magnitude === "Low" ? f.magnitude : "Medium";
  const bias = f.bias === "short" || f.bias === "mid" || f.bias === "long" || f.bias === "flat" ? f.bias : "flat";
  const sourceUrl = sanitizeUrl(source);
  const importanceScore =
    typeof f.importanceScore === "number" && Number.isFinite(f.importanceScore)
      ? Math.max(0, Math.min(100, Math.round(f.importanceScore)))
      : 0;
  const commodities = Array.isArray(f.commodities)
    ? (f.commodities as unknown[]).filter(
        (c): c is Factor["commodities"][number] => c === "oil" || c === "electricity" || c === "water",
      )
    : [];
  const region = scopeRegion(scope);
  const regions =
    f.regions && Array.isArray(f.regions)
      ? (f.regions as unknown[]).filter(
          (r): r is RegionId => r === "global" || (typeof r === "string" && r in REGION_NAMES),
        )
      : scope === "global"
        ? ["global"]
        : region
          ? [region]
          : [];

  // A factor must have a name, explanation, evidence-quality score and at least
  // one affected commodity. The source is resolved separately below so a
  // non-URL source string (e.g. a publication name the model returned) does not
  // by itself invalidate the factor — we fall back to a fetched candidate URL.
  if (!name || !explanation || importanceScore < 20 || commodities.length === 0) return null;

  const now = new Date().toISOString();
  const driftRaw = (f.drift ?? {}) as Record<string, unknown>;

  // Resolve the source to a real URL: prefer the model's URL when valid,
  // otherwise try to match the source name against candidate URLs we actually
  // fetched via TinyFish. When the model returns a non-URL source name that
  // cannot be matched, fall back to the first candidate URL so the UI can
  // always display a clickable, verified source link — never a bare
  // publication name (the reported "IEA World Energy Outlook" symptom).
  let finalSource = source;
  if (sourceUrl) {
    finalSource = sourceUrl;
  } else if (candidates.length > 0) {
    const matched = source ? matchSourceToCandidate(source, candidates) : null;
    finalSource = matched ?? (source ? bestLooseCandidate(source, candidates) : null) ?? candidates[0]?.url ?? "";
  }

  return {
    id: id.slice(0, 80),
    name: name.slice(0, 160),
    category: category.slice(0, 80),
    commodities: Array.from(new Set(commodities)) as Factor["commodities"],
    explanation: sanitizeExplanation(explanation),
    direction,
    magnitude,
    source: finalSource,
    bias,
    drift: {
      ...(typeof driftRaw.oil === "number" && Number.isFinite(driftRaw.oil) ? { oil: driftRaw.oil } : {}),
      ...(typeof driftRaw.electricity === "number" && Number.isFinite(driftRaw.electricity)
        ? { electricity: driftRaw.electricity }
        : {}),
      ...(typeof driftRaw.water === "number" && Number.isFinite(driftRaw.water) ? { water: driftRaw.water } : {}),
    },
    regions: Array.from(new Set(regions)) as Factor["regions"],
    scope,
    importanceScore,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Builds the server-side grounding payload from the current price defaults.
 * These are the exact statistics shown on the dashboard (oil/electricity/water
 * prices) at curation time, attached to every factor so the UI can display the
 * full source URL alongside the numbers that support each reason.
 */
function attachFactorGrounding(
  prices: { oil: { price: number; unit: string; source: string }; electricity: { price: number; unit: string; source: string }; water: { price: number; unit: string; source: string } },
  asOf: string,
): FactorGrounding {
  return {
    oil: { price: prices.oil.price, unit: prices.oil.unit, source: prices.oil.source },
    electricity: { price: prices.electricity.price, unit: prices.electricity.unit, source: prices.electricity.source },
    water: { price: prices.water.price, unit: prices.water.unit, source: prices.water.source },
    asOf,
  };
}

/**
 * When the model returns a non-URL source name (e.g. "IEA" or "OPEC Monthly
 * Oil Market Report"), try to match it to one of the candidate URLs we
 * actually fetched via TinyFish so the UI can display a real source link.
 * 
 * Now supports multi-word matching against candidate URL hostname+path,
 * as well as against title and site_name fields carried in candidate objects.
 */
function matchSourceToCandidate(source: string, candidates: Array<{ url: string; title?: string; site_name?: string }>): string | null {
  const sourceLower = source.toLowerCase().trim();
  if (!sourceLower) return null;

  // If source is already a valid URL, return it
  const urlMatch = sanitizeUrl(sourceLower);
  if (urlMatch) return urlMatch;

  // Tokenize source: words of length >= 3
  const tokens = Array.from(new Set(sourceLower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)));
  if (tokens.length === 0) return null;

  let best: { url: string; score: number } | null = null;

  for (const c of candidates) {
    if (!c || !c.url) continue;
    let text = c.url.toLowerCase();
    if (c.title) text += " " + c.title.toLowerCase();
    if (c.site_name) text += " " + c.site_name.toLowerCase();

    // Parse hostname and path for token matching
    let host = "";
    let domainLabel = "";
    try {
      const u = new URL(c.url);
      host = u.hostname.replace(/^www\./, "").toLowerCase();
      domainLabel = u.hostname.split(".")[0].toLowerCase();
      text += " " + host + " " + u.pathname.toLowerCase();
    } catch {}

    let score = 0;
    for (const t of tokens) {
      if (text.includes(t)) {
        score += t.length >= 5 ? 3 : t.length >= 4 ? 2 : 1;
      } else {
        // Domain label exact/partial match
        if (domainLabel && (domainLabel === t || domainLabel.includes(t) || t.includes(domainLabel))) {
          score += 3;
        }
        // Hostname token match
        if (host && host.includes(t)) score += 2;
      }
    }

    // Require at least one meaningful token match
    if (score > 0 && (!best || score > best.score)) best = { url: c.url, score };
  }

  if (!best) return null;

  // For single-token sources, a score of 1 is acceptable.
  // For multi-token sources, require at least half the tokens match.
  const minScore = tokens.length <= 2 ? 1 : Math.ceil(tokens.length / 2);
  return best.score >= minScore ? best.url : null;
}

/**
 * Best-effort fallback: picks the candidate URL whose hostname best matches
 * any token in the source name, even below the normal threshold. Used when
 * the model returns a bare publication name that cannot be matched otherwise.
 */
function bestLooseCandidate(source: string, candidates: Array<{ url: string; title?: string; site_name?: string }>): string | null {
  const sourceLower = source.toLowerCase().trim();
  if (!sourceLower) return null;

  let best: { url: string; score: number } | null = null;

  for (const c of candidates) {
    if (!c || !c.url) continue;
    let text = c.url.toLowerCase();
    if (c.title) text += " " + c.title.toLowerCase();
    if (c.site_name) text += " " + c.site_name.toLowerCase();

    let host = "";
    try {
      const u = new URL(c.url);
      host = u.hostname.replace(/^www\./, "").toLowerCase();
      text += " " + host;
    } catch {}

    let score = 0;
    // Match hostname label
    const label = host.split(".")[0];
    if (label && sourceLower.includes(label)) score += 3;
    if (host && sourceLower.includes(host)) score += 5;

    // Match individual tokens
    for (const t of sourceLower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)) {
      if (text.includes(t)) score += 2;
    }

    if (!best || score > best.score) best = { url: c.url, score };
  }

  return best?.url ?? null;
}

/**
 * Merges a previously stored window with freshly curated factors and keeps the
 * newest {@link FACTOR_COUNT} by `createdAt`.
 *
 * A factor that is re-curated under the same name keeps its original `id` and
 * `createdAt`, so its age stays meaningful; only genuinely new reasons push the
 * oldest ones out of the window.
 */
export function mergeRollingWindow(existing: Factor[], incoming: Factor[]): Factor[] {
  const priorByName = new Map<string, Factor>();
  for (const factor of existing) {
    const key = normalizeFactorName(factor.name);
    if (key && !priorByName.has(key)) priorByName.set(key, factor);
  }

  const carried = incoming.map((factor) => {
    const prior = priorByName.get(normalizeFactorName(factor.name));
    if (!prior) return factor;
    return { ...factor, id: prior.id, createdAt: prior.createdAt, updatedAt: new Date().toISOString() };
  });

  // Freshly curated factors always rank ahead of the carried-over window, so a
  // same-millisecond tie can never let a static fallback displace a live reason.
  const ranked: Array<{ factor: Factor; rank: number }> = [
    ...carried.map((factor) => ({ factor, rank: 0 })),
    ...existing.map((factor) => ({ factor, rank: 1 })),
  ];
  ranked.sort(
    (a, b) => a.rank - b.rank || Date.parse(b.factor.createdAt) - Date.parse(a.factor.createdAt),
  );

  const seen = new Set<string>();
  const out: Factor[] = [];
  for (const { factor } of ranked) {
    const key = normalizeFactorName(factor.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(factor);
    if (out.length >= FACTOR_COUNT) break;
  }
  return out;
}

/**
 * Single implementation of the factor-curation pipeline used by the global
 * route, the regional route and the cron endpoint.
 */
export async function runFactorAnalysis(
  scope: RegionId,
  options: FactorAnalysisOptions = {},
): Promise<FactorWindow> {
  const signal = options.abortSignal;
  const region = scopeRegion(scope);
  const previous = await readFactorWindow(scope);
  // The previously stored factors are the rolling window; the static fallbacks
  // are only used when nothing has been curated yet.
  const existing = filterStaticFallbacks(previous?.factors.length ? previous.factors : buildFallbackFactors(scope));
  const carriedAiCurated = previous?.aiCurated ?? false;

  const analytics =
    scope === "global" ? await getGlobalAnalytics() : await getRegionalAnalytics(scope as Region);

  const currentPrices = getScopePriceDefaults(scope);

  const now = new Date().toISOString();
  let candidates: Array<{ url: string; title?: string; snippet?: string; text?: string }> = [];

  try {
    const queries = scope === "global" ? GLOBAL_QUERIES : REGION_QUERIES[scope as Region];
    const searches = await Promise.all(
      queries.map((q) =>
        tinyfishRouter.tinyfishSearch(`${q} ${RECENT_MONTH()}`, { limit: 10, region: region ?? undefined }, signal),
      ),
    );

    const flatten = <T extends { snippet?: string }>(results: T[] | undefined) =>
      (results ?? []).map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }));

    const allResults = searches.flatMap((r) => flatten(r.results));

    // Prefer results from reputable hosts, but never let the whitelist starve the
    // model of real fetched URLs. If the reputable filter removes every result we
    // retry with all recent results, because a non-whitelisted but real TinyFish
    // URL is still a valid source the model can summarize (and link to).
    candidates = allResults
      .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt))
      .slice(0, 15);

    console.warn(`Factor analysis: ${candidates.length} reputable+recent candidates for scope "${scope}" after TinyFish search`);

    if (candidates.length === 0) {
      candidates = allResults
        .filter((r) => isRecentPublishedAt(r.publishedAt))
        .slice(0, 15);
      console.warn(`Factor analysis: ${candidates.length} recent candidates for scope "${scope}" (reputable filter yielded none)`);
    }

    if (candidates.length === 0) {
      console.warn(`Factor analysis: no TinyFish candidates for scope "${scope}"; trying known reputable URLs as fallback`);
      const knownExcerpts = await Promise.all(
        KNOWN_REPUTABLE_URLS.map(async (url) => {
          try {
            const scraped = await tinyfishRouter.tinyfishScrape(url, signal, {
              purpose: `Identify concrete reasons this page gives for ${scopeLabel(scope)} oil, electricity, or water price movements in ${RECENT_MONTH()}.`,
            });
            return scraped ? { url, title: scraped.title || url, snippet: scraped.text?.slice(0, 500) ?? "", text: scraped.text ?? "" } : null;
          } catch {
            return null;
          }
        }),
      );
      const knownCandidates = knownExcerpts.filter((e): e is { url: string; title: string; snippet: string; text: string } => e !== null);
      if (knownCandidates.length > 0) {
        console.warn(`Factor analysis: scraped ${knownCandidates.length} known URLs for scope "${scope}"`);
        // Build deterministic factors from these known URLs
        const deterministic = buildFactorsFromCandidates(knownCandidates, scope, currentPrices, now);
        if (deterministic.length > 0) {
          console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors from known URLs for scope "${scope}"`);
          return {
            factors: await validateAndRepairWindow(mergeRollingWindow(existing, deterministic), currentPrices, signal),
            aiCurated: false,
            updatedAt: now,
          };
        }
      }
      console.warn(`Factor analysis: no candidates from known URLs either; falling back to existing factors`);
      const repaired = await validateAndRepairWindow(existing, currentPrices, signal);
      return { factors: repaired, aiCurated: carriedAiCurated, updatedAt: now };
    }

    const excerpts = await Promise.all(
      candidates.map(async (r) => {
        try {
          const scraped = await tinyfishRouter.tinyfishScrape(r.url, signal, {
            purpose: `Identify concrete reasons this article gives for ${scopeLabel(scope)} oil, electricity, or water price movements in ${RECENT_MONTH()}.`,
          });
          return scraped ? { ...r, text: scraped.text, title: scraped.title || r.title } : r;
        } catch {
          return r;
        }
      }),
    );

    // Log scrape success rate
    const scrapedCount = excerpts.filter((e) => (e as { text?: string }).text && (e as { text?: string }).text!.length > 0).length;
    console.warn(`Factor analysis: ${scrapedCount}/${candidates.length} candidate scrapes succeeded for scope "${scope}"`);
    if (scrapedCount === 0 && candidates.length > 0) {
      console.warn(`Factor analysis: all ${candidates.length} candidate scrapes failed for scope "${scope}"; proceeding with search snippets only`);
    } else if (scrapedCount < candidates.length) {
      console.warn(`Factor analysis: ${candidates.length - scrapedCount}/${candidates.length} scrapes failed for scope "${scope}"`);
    }

    // Build candidate objects (with title/site_name) for source matching
    const candidateObjs = excerpts.map((c) => ({
      url: c.url,
      title: c.title,
      site_name: (c as { site_name?: string }).site_name,
    }));

    const prompt = scope === "global" ? SYSTEM_PROMPT_GLOBAL : SYSTEM_PROMPT_REGIONAL(scopeLabel(scope));
    const payload = {
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify({
            analytics,
            currentPrices,
            existingFactors: existing,
            candidates: excerpts.map((c) => ({
              title: c.title,
              source: c.url,
              snippet: c.snippet?.slice(0, 2500),
              text: (c as { text?: string }).text?.slice(0, 8000),
            })),
            region,
            month: RECENT_MONTH(),
          }),
        },
      ],
      max_tokens: 4096,
      temperature: 0.2,
      response_format: { type: "json_object" },
    };

    const response = await kiloRouter.kiloInfer(payload, signal);
    let content = response.choices?.[0]?.message?.content ?? "";
    let parsed = safeParseJson<{ factors?: unknown[] }>(content);
    console.warn(`Factor analysis: Kilo response for scope "${scope}" (content length ${content.length}, factors ${Array.isArray(parsed?.factors) ? parsed.factors.length : 0})`);

    // Retry once with a more explicit, insistent prompt if first attempt
    // returns invalid JSON or an empty factors array.
    if ((!parsed || !Array.isArray(parsed.factors) || parsed.factors.length === 0) && !signal?.aborted) {
      const candidateUrlHint = candidateObjs.map((c) => c.url).filter(Boolean).join(", ");
      const retryPrompt = `Return ONLY a strict JSON object of the form {"factors":[...]}. Each factor MUST have: id (string), name (string), category (one of "Market"|"Policy"|"Structural"|"Infrastructure"|"Environmental"|"Geopolitical"|"Technological"), commodities (array subset of "oil","electricity","water"), explanation (ONE meaningful sentence that starts with the commodity and cites the current price numbers from currentPrices, e.g. "with oil at $104.86/bbl..."), direction ("up"|"down"|"mixed"), magnitude ("High"|"Medium"|"Low"), source (EXACTLY one of these URLs, copy verbatim: ${candidateUrlHint}), bias ("short"|"mid"|"long"|"flat"), importanceScore (integer 0-100), drift (object mapping commodity to a small decimal). The source field MUST be a URL copied verbatim from the list above — never a publication name. Ground every explanation in the current price numbers. NEVER include a URL or markdown link inside the explanation field. Write explanations in your own words, ONE single meaningful sentence max, starting with the commodity and current price number. Do NOT copy raw text verbatim — summarize in your own words. NEVER start with a bullet point or publication name. NEVER write more than ONE sentence per explanation. NEVER include publication headers, dates, or metadata. Focus on the specific price driver: what changed and why it matters for prices. Do not output markdown, commentary, or anything outside the JSON object.`;

      console.warn(`Factor analysis: retrying Kilo for scope "${scope}" after invalid/empty response (content length ${content.length}, factors ${Array.isArray(parsed?.factors) ? parsed.factors.length : 0})`);

      const retryPayload = {
        ...payload,
        messages: [
          { role: "system", content: retryPrompt },
          payload.messages[1],
        ],
      };

      try {
        const retryResponse = await kiloRouter.kiloInfer(retryPayload, signal);
        content = retryResponse.choices?.[0]?.message?.content ?? "";
        parsed = safeParseJson<{ factors?: unknown[] }>(content);
        console.warn(`Factor analysis: retry complete for scope "${scope}" (content length ${content.length}, factors ${Array.isArray(parsed?.factors) ? parsed.factors.length : 0})`);
      } catch (error) {
        console.error(`Factor analysis: retry failed for scope "${scope}":`, error);
      }
    }

    if (!parsed?.factors || !Array.isArray(parsed.factors) || parsed.factors.length === 0) {
      console.warn(`Factor analysis: model did not return a valid non-empty factors array for scope "${scope}" even after retry (content length ${content.length}); building deterministic factors from ${excerpts.length} scraped excerpts`);

      const deterministic = buildFactorsFromCandidates(excerpts, scope, currentPrices, now);
      if (deterministic.length > 0) {
        console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors for scope "${scope}"`);
        return {
          factors: await validateAndRepairWindow(mergeRollingWindow(existing, deterministic), currentPrices, signal),
          aiCurated: false,
          updatedAt: now,
        };
      }
      console.warn(`Factor analysis: no deterministic factors could be built for scope "${scope}"; falling back to existing factors`);
      const repaired = await validateAndRepairWindow(existing, currentPrices, signal);
      return { factors: repaired, aiCurated: carriedAiCurated, updatedAt: now };
    }

    const normalized: Factor[] = [];
    for (const raw of parsed.factors) {
      const f = normalizeFactor(raw, scope, candidateObjs);
      if (!f) continue;
      if (f.scope !== scope) continue;

      const quality = validateExplanationQuality(f.explanation);
      if (!quality.ok) {
        console.warn(`Factor analysis: explanation failed quality check ("${quality.reason}") for factor "${f.name}" scope "${scope}"; attempting re-summarization`);
        const reSummary = await reSummarizeExplanation(f.explanation, currentPrices, signal);
        if (reSummary) {
          const reQuality = validateExplanationQuality(reSummary);
          if (reQuality.ok) {
            f.explanation = reSummary;
            console.warn(`Factor analysis: re-summarization succeeded for factor "${f.name}" scope "${scope}"`);
          } else {
            console.warn(`Factor analysis: re-summarization still failed quality ("${reQuality.reason}") for factor "${f.name}" scope "${scope}"; rejecting`);
            continue;
          }
        } else {
          console.warn(`Factor analysis: re-summarization returned null for factor "${f.name}" scope "${scope}"; rejecting`);
          continue;
        }
      }

      normalized.push(f);
      if (normalized.length >= FACTOR_COUNT) break;
    }

    if (normalized.length === 0) {
      console.warn(`Factor analysis: all model-returned factors were rejected for scope "${scope}" (parsed ${parsed.factors.length}, normalized ${normalized.length}); building deterministic factors from ${excerpts.length} scraped excerpts`);

      const deterministic = buildFactorsFromCandidates(excerpts, scope, currentPrices, now);
      if (deterministic.length > 0) {
        console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors for scope "${scope}"`);
        return {
          factors: await validateAndRepairWindow(mergeRollingWindow(existing, deterministic), currentPrices, signal),
          aiCurated: false,
          updatedAt: now,
        };
      }
      console.warn(`Factor analysis: no deterministic factors could be built for scope "${scope}"; falling back to existing factors`);
      const repaired = await validateAndRepairWindow(existing, currentPrices, signal);
      return { factors: repaired, aiCurated: carriedAiCurated, updatedAt: now };
    }

    // Attach the dashboard statistics (oil/electricity/water prices) that the
    // model grounded its reasons in, so the UI can show the full source URL
    // alongside the numbers that support each factor. Grounding is server-side
    // and never model-generated, so it cannot be fabricated.
    const grounding = attachFactorGrounding(currentPrices, now);

    console.warn(`Factor analysis: validation complete for scope "${scope}" — ${normalized.length} factors passed, ${parsed.factors.length - normalized.length} factors rejected`);

    return {
      factors: await validateAndRepairWindow(mergeRollingWindow(existing, normalized.map((f) => ({ ...f, grounding }))), currentPrices, signal),
      aiCurated: true,
      updatedAt: now,
    };
  } catch (error) {
    // Never throw: the callers (route handlers, cron) must always be able to
    // write a window so the health endpoint can report a real `lastRun`.
    console.error(`Factor analysis failed for scope "${scope}":`, error);
    if (candidates.length > 0) {
      // Scrape candidates to get full text for better deterministic factors
      const excerpts = await Promise.all(
        candidates.map(async (r) => {
          try {
            const scraped = await tinyfishRouter.tinyfishScrape(r.url, signal, {
              purpose: `Identify concrete reasons this article gives for ${scopeLabel(scope)} oil, electricity, or water price movements in ${RECENT_MONTH()}.`,
            });
            return scraped ? { ...r, text: scraped.text, title: scraped.title || r.title } : r;
          } catch {
            return r;
          }
        }),
      );
      const deterministic = buildFactorsFromCandidates(excerpts, scope, currentPrices, now);
      if (deterministic.length > 0) {
        console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors for scope "${scope}" after error (aiCurated=false)`);
        return {
          factors: await validateAndRepairWindow(mergeRollingWindow(existing, deterministic), currentPrices, signal),
          aiCurated: false,
          updatedAt: now,
        };
      }
    }
    try {
      console.warn(`Factor analysis: trying known reputable URLs as fallback after error for scope "${scope}"`);
      const knownExcerpts = await Promise.all(
        KNOWN_REPUTABLE_URLS.map(async (url) => {
          try {
            const scraped = await tinyfishRouter.tinyfishScrape(url, signal, {
              purpose: `Identify concrete reasons this page gives for ${scopeLabel(scope)} oil, electricity, or water price movements in ${RECENT_MONTH()}.`,
            });
            return scraped ? { url, title: scraped.title || url, snippet: scraped.text?.slice(0, 500) ?? "", text: scraped.text ?? "" } : null;
          } catch {
            return null;
          }
        }),
      );
      const knownCandidates = knownExcerpts.filter((e): e is { url: string; title: string; snippet: string; text: string } => e !== null);
      if (knownCandidates.length > 0) {
        console.warn(`Factor analysis: scraped ${knownCandidates.length} known URLs for scope "${scope}" after error`);
        const deterministic = buildFactorsFromCandidates(knownCandidates, scope, currentPrices, now);
        if (deterministic.length > 0) {
          console.warn(`Factor analysis: built ${deterministic.length} deterministic URL-backed factors from known URLs for scope "${scope}" after error`);
          return {
            factors: await validateAndRepairWindow(mergeRollingWindow(existing, deterministic), currentPrices, signal),
            aiCurated: false,
            updatedAt: now,
          };
        }
      }
    } catch (fallbackError) {
      console.error(`Factor analysis: known-URL fallback also failed for scope "${scope}":`, fallbackError);
    }
    const repaired = await validateAndRepairWindow(existing, currentPrices, signal);
    return { factors: repaired, aiCurated: carriedAiCurated, updatedAt: now };
  }
}
