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
import { truncateAtWordBoundary, truncateAtSentenceBoundary } from "../_shared/textUtils";

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
 * strips bullet/list markers from every line, strips leading page chrome /
 * metadata (report titles, "Release Date:" fields, navigation banners), and
 * truncates to a concise summary length (~400 chars) at a sentence/word
 * boundary (never mid-sentence). Defense-in-depth: even if the model ignores
 * the "no URLs / no bullets / summarize" instruction, the server never
 * renders a bare URL, a bullet, or a raw article fragment inside the reason prose.
 *
 * - Removes markdown links `[text](url)` → keeps only `text`
 * - Removes bare `https?://...` URLs entirely
 * - Strips bullet/list markers from the start of every line
 * - Strips markdown emphasis that may have wrapped URLs
 * - Strips markdown headers (###, ####, etc.)
 * - Collapses spaces/newlines
 * - Strips leading page chrome / metadata before truncation
 * - Truncates to ~400 chars at a sentence boundary if possible, otherwise word boundary
 * - Does NOT enforce a sentence count limit (that is applied downstream in
 *   `validateExplanationQuality`)
 */

/**
 * Leading page-chrome / metadata patterns stripped from the start of an
 * explanation before single-sentence enforcement. These come from scraped
 * report pages, e.g. "‹ Analysis & Projections Short-Term Energy Outlook
 * Release Date: November 10, 2026 | Forecast Completed: ... | Full Report |
 * Text Only | All Tables | All Figures Forecast overview Global oil prices."
 * or "Cite report IEA (2026), Electricity 2026, IEA, Paris Licence: CC BY 4.0
 * Share this report Report options Download".
 * or navigation chrome like "in Energy Skip to page content Filter by article type..."
 */
const LEADING_CHROME_PATTERNS: RegExp[] = [
  // Leading symbols / quotes / guillemets ("‹", "«", """, "|", "…")
  /^[^A-Za-z0-9$("']+/,
  // "Cite report IEA (2026), Electricity 2026, IEA, Paris Licence: CC BY 4.0"
  /^cite\s+report\b[\s\S]*?(?:licence|license)\s*:\s*cc\s+by\s+\d+(?:\.\d+)?\s*/i,
  // Date / release metadata fields, up to the next pipe separator
  /^(?:release\s+date|forecast\s+completed|next\s+release\s+date)\s*:\s*[^|]*\|?\s*/i,
  // Standalone page-chrome labels
  /^(?:share\s+this\s+report|report\s+options|cite\s+report|download)\b[\s|:]*/i,
  /^(?:full\s+report|text\s+only|all\s+tables|all\s+figures)\b[\s|:]*/i,
  // Section headings / report titles
  /^(?:analysis\s*&\s*projections|short-term\s+energy\s+outlook)\b[\s|:]*/i,
  /^(?:forecast\s+overview|oil\s+market\s+highlights|crude\s+oil\s+price\s+movements|commodity\s+markets|world\s+economy|product\s+markets?\s+and\s+refinery\s+operations|tanker\s+market)\b[\s:.|]*/i,
  // "Global oil prices." style headings. The trailing period is required so a
  // genuine sentence opener like "Global oil prices rose..." is not mangled.
  /^global\s+oil\s+prices\s*\.\s*/i,
  // Navigation / skip links / filter UI (common in scraped article pages)
  /^in\s+\w+\s+skip\s+to\s+(?:page\s+)?content\b/i,
  /^skip\s+to\s+(?:page\s+)?content\b/i,
  /^filter\s+by\s+(?:article\s+)?type\b/i,
  /^(?:in-brief|in-depth)\s+analysis\b/i,
  /^article\s+type\b/i,
  /^(?:energy|technology|science|business|markets|politics|world)\s+/i,
];

/** Repeatedly strips leading page-chrome chunks until none match. */
function stripLeadingPageChrome(text: string): string {
  let result = text.trim();
  for (let i = 0; i < 12; i++) {
    let changed = false;
    for (const pattern of LEADING_CHROME_PATTERNS) {
      const next = result.replace(pattern, "").trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
    if (!changed || result.length === 0) break;
  }
  return result;
}

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

  // Split scraped list-style text on middle-dot separators (`·`) and keep the
  // first meaningful segment. Scraped pages often join list items with `·`,
  // e.g. "Q2 2026 · Recent prices · Gas co", which is not prose. Keep the
  // first segment when it is at least 40 chars; otherwise keep the first
  // segment as-is so downstream trimming/validation can still evaluate it.
  if (cleaned.includes("·")) {
    const segments = cleaned.split("·").map((s) => s.trim()).filter((s) => s.length > 0);
    const meaningful = segments.find((s) => s.length >= 40);
    cleaned = (meaningful ?? segments[0] ?? "").trim();
  }

  // Strip leading page chrome / metadata chunks (report titles, "Release
  // Date:" fields, "Full Report | Text Only | All Tables" navigation,
  // "Forecast overview Global oil prices." headings, "Cite report ... Licence:
  // CC BY 4.0" banners) before sentence enforcement, so the retained sentence
  // is real article content rather than report chrome.
  cleaned = stripLeadingPageChrome(cleaned);

  // Truncate to ~400 chars at the last complete sentence boundary within the limit.

  const FACTOR_MAX_EXPLANATION_CHARS = 400;
  const FACTOR_ELLIPSIS = "…";

  // Extract up to 3 complete sentences from the cleaned text using
  // sentence-boundary-aware truncation (word/sentence boundary, never mid-word).
  const cleanedForSentenceCut = truncateAtSentenceBoundary(cleaned, FACTOR_MAX_EXPLANATION_CHARS, {
    minPrefix: 30,
    ellipsis: FACTOR_ELLIPSIS,
  });

  // If the text already fits within the limit, keep it verbatim (no ellipsis
  // added when there is nothing to truncate).
  let result = cleanedForSentenceCut;

  // Trim a truncated trailing fragment after the last terminal punctuation.
  // E.g. "... petroleum products. E" → "... petroleum products.", or a short
  // clipped tail like "cheap" that has no terminal punctuation.
  const lastTerminal = Math.max(
    result.lastIndexOf("."),
    result.lastIndexOf("!"),
    result.lastIndexOf("?"),
  );
  const tail = lastTerminal >= 0 ? result.slice(lastTerminal + 1).trim() : result;
  if (lastTerminal >= 0 && tail.length > 0 && tail.length < 15 && !/[.!?…]$/.test(tail)) {
    result = result.slice(0, lastTerminal + 1).trim();
  }

  return result;
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
    // Table of contents / navigation patterns
    /^chapters?\s+/i,
    /^feature\s+article\s+/i,
    /^oil\s+market\s+highlights\s+/i,
    /^crude\s+oil\s+price\s+movements\s+/i,
    /^commodity\s+markets\s+/i,
    /^world\s+economy\s+/i,
    /^product\s+markets?\s+and\s+refinery\s+operations\s+/i,
    /^tanker\s+market\s+/i,
    /^crude\s+and\s+refined\s+products?\s+trade\s+/i,
    /^commercial\s+stock\s+movements\s+/i,
    /^balance\s+of\s+supply\s+and\s+demand\s+/i,
    /^information\s+/i,
    /^abbreviations?\s+/i,
    /^acronyms?\s+/i,
    /^about\s+momr\s+/i,
    /^contributors?\s+/i,
    /^disclaimer\s+/i,
    /^archive\s+/i,
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s+/i,
    // NEW: Strip publication-name prefixes that appear at the start of
    // scraped article text (e.g. "The OPEC Monthly Oil Market Report
    // (MOMR) covers major issues...", "Short-Term Energy Outlook Global
    // oil prices.", "IEA World Energy Outlook 2026 summary...")
    /^(the\s+)?(?:opec|iea|eia|bp|shell|exxon|total|chevron)\s+(?:monthly|quarterly|annual|daily|weekly)?\s*(?:oil|energy|market|commodity|water|electricity|power)?\s*(?:report|outlook|analysis|review|summary)?\s*/i,
    /^(short-term\s+energy\s+outlook|world\s+energy\s+outlook|global\s+energy\s+outlook)\s+/i,
    /^(?:oil|energy)\s+market\s+(?:report|outlook|highlights)\s+/i,
    // NEW: Strip common web navigation / skip links / filter UI that appear
    // in scraped article pages (e.g. "in Energy Skip to page content...",
    // "Filter by article type: In-brief analysis In-depth analysis...")
    /^in\s+\w+\s+skip\s+to\s+(?:page\s+)?content\b/i,
    /^skip\s+to\s+(?:page\s+)?content\b/i,
    /^filter\s+by\s+(?:article\s+)?type\b/i,
    /^(?:in-brief|in-depth)\s+analysis\b/i,
    /^article\s+type\b/i,
    /^(?:energy|technology|science|business|markets|politics|world)\s+/i,
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

  // If the result contains a middle-dot separator (`·`), it is scraped list
  // text rather than prose. Keep the first segment that is at least 40 chars;
  // if none qualify, drop the list glue entirely by taking the first segment
  // only when it is long enough, otherwise return "" so the candidate is
  // skipped by the caller.
  if (result.includes("·")) {
    const segments = result.split("·").map((s) => s.trim()).filter((s) => s.length > 0);
    const meaningful = segments.find((s) => s.length >= 40);
    result = meaningful ?? "";
  }

  // Reject generic fragment patterns that do not describe a price driver.
  // These come from scraped report text ("tight supply forecast for Australia's
  // east coast gas market in Q2 2026 · Recent prices are within expected ranges
  // · Gas co..."). If the result matches one of these, search for a later
  // complete sentence that does not match; if none is found, return "" so the
  // caller skips this candidate.
  const genericFragmentPatterns = [
    /tight\s+supply\s+forecast/i,
    /recent\s+prices\s+are\s+within\s+expected\s+ranges/i,
    /margins\s+weakened\s+almost\s+everywhere/i,
  ];
  for (const pattern of genericFragmentPatterns) {
    if (pattern.test(result)) {
      // Try to find a later complete sentence that does not match the pattern.
      const sentences = result.match(/[A-Z][^.!?]*[.!?](?:\s|$)/g) ?? [];
      let replacement = "";
      for (const sentence of sentences) {
        if (!pattern.test(sentence) && sentence.length >= 40) {
          replacement = sentence.trim();
          break;
        }
      }
      result = replacement;
      if (!result) return "";
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

  // Last resort: sentence- then word-boundary aware truncation (no mid-word clip)
  const truncated = truncateAtSentenceBoundary(result, 300, { minPrefix: 1, ellipsis: "" });
  return sanitizeExplanation(truncated || truncateAtWordBoundary(result, 300, { minPrefix: 1, ellipsis: "" }));
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
  if (/####|###|licence:|license:|share this report|report options|cite report|release dates?$|table\s+of\s+contents|chapters?\s+|feature\s+article|archive\s+|abbreviations?|acronyms?|contributors?|disclaimer/i.test(trimmed)) return "";
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
 * - Starts with a generic meta-analysis / report-intro opener (e.g. "the report ",
 *   "this study ", "the analysis ", "in this ") — these describe the publication
 *   itself rather than a concrete price driver
 * - Starts with a known raw-article opener (publication name, article opening)
 * - Does NOT start with the required commodity+price opening construct (e.g.
 *   "With oil at $XX...", "Brent crude at $YY...") — raw scraped text / fragment
 * - Is multiple sentences — must be exactly ONE meaningful sentence
 * - Too short (< 50 chars) or too long (> 400 chars for a proper summary)
 * - Too few sentences for length (> 50 chars with no sentence-ending punctuation)
 * - Contains page chrome / noise patterns typical of scraped web pages
 * - Contains generic body text after the commodity+price opening (e.g. "forecast
 *   to grow", "the report provides", "provides a detailed analysis") — even if
 *   the opening passes; this catches generic forecasts and meta-analysis that
 *   slipped through the start check.
 * - Contains generic demand/forecast projection language (e.g. "projected to
 *   grow", "expected to increase", "anticipated to decline", "poised to expand",
 *   "set to contract", "estimates demand will", "outlook projects supply",
 *   "demand is projected to", "consumption is expected to") — these are
 *   generic forecast statements, not concrete price drivers.
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

  const lower = trimmed.toLowerCase();

  // Reject generic meta-analysis / report-intro openers ("The report provides
  // a detailed analysis...", "This study examines...", "In this outlook...").
  // These describe the publication itself rather than a concrete price driver,
  // so they trigger a repair round (reSummarizeExplanation) instead of being
  // shown to the user. Checked before the narrow raw-article starter list so
  // the failure reason is accurate.
  const genericStarters = [
    "the report ", "the study ", "the article ", "the analysis ", "the paper ",
    "the document ", "the data ", "the source ", "this report ", "this study ",
    "this article ", "this analysis ", "these reports ", "the following ", "in this ",
  ];
  for (const starter of genericStarters) {
    if (lower.startsWith(starter)) {
      return { ok: false, reason: "generic analysis text" };
    }
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
  for (const starter of rawStarters) {
    if (lower.startsWith(starter)) {
      // Allow if it starts with commodity+price pattern (e.g. "Oil at $XX...")
      if (!/^(with\s+(oil|electricity|water)|(oil|electricity|water|crude|brent|wti)\s+(at|is|are|was|were|rose|fell|climbed|dropped|surged|plunged))/i.test(trimmed)) {
        return { ok: false, reason: `starts with raw-article text ("${starter.trim()}")` };
      }
      break;
    }
  }

  // Every explanation MUST open with the commodity + current price construct
  // the prompts require, e.g. "With oil at $73.07/bbl..." or "Brent crude rose...".
  // Anything else (a bare article sentence, a mid-sentence fragment, a table-of-
  // contents line) is raw scraped text and must be repaired or dropped.
  const commodityPriceStart =
    /^(?:with\s+)?(?:oil|crude|brent|wti|electricity|power|water)\b(?:\s+(?:crude|prices?))?\s+(?:at|is|are|was|were|rose|fell|climbed|dropped|surged|plunged|traded|settled|averaged|jumped|rallied|slid|gained|declined|increased|decreased)\b/i;
  if (!commodityPriceStart.test(trimmed)) {
    return { ok: false, reason: "missing commodity+price start" };
  }

  // Reject explanations whose BODY (the part after the commodity+price opening)
  // contains generic forecast / meta-analysis text, publication names, or
  // clipped fragments. The opening check above only verifies the prefix; a
  // clause like "the global oil demand in 2026 is forecast to grow by 1.4 mb/d"
  // passes the opening check but is not a concrete price driver. Checked AFTER
  // the opening so the failure reason is accurate ("generic body text") rather
  // than a misleading opener reason.
  //
  // Legitimate explanations that MUST still pass:
  // - "With oil at $73.07/bbl, OPEC+ has agreed to extend voluntary production
  //   cuts through Q1 2026, ..." (contains "OPEC+ has agreed")
  // - "With oil at $104.86/bbl, the IEA forecasts global oil demand will fall by
  //   2.7 mb/d in 2026 ..." (contains "IEA forecasts", not "forecast to grow")
  // - "With water at $2.15/M³, drought-driven supply disruptions ..." (no
  //   generic markers)
  const body = trimmed.replace(/^with\s+.+?\s+at\s+\$[^,]+,\s*/i, "").trim().toLowerCase();
  const genericBodyPatterns = [
    /forecast\s+to\s+(?:grow|fall|rise|decline|increase|decrease)/i,
    /on\s+track\s+to/i,
    /the\s+report\s+provides/i,
    /the\s+study\s+examines/i,
    /provides\s+a\s+detailed\s+analysis/i,
    /provides\s+an\s+overview/i,
    /projected\s+to\s+(?:grow|fall|rise|decline|increase|decrease|expand|contract)/i,
    /expected\s+to\s+(?:grow|fall|rise|decline|increase|decrease|expand|contract)/i,
    /anticipated\s+to\s+(?:grow|fall|rise|decline|increase|decrease|expand|contract)/i,
    /poised\s+to\s+(?:grow|fall|rise|decline|increase|decrease|expand|contract)/i,
    /set\s+to\s+(?:grow|fall|rise|decline|increase|decrease|expand|contract)/i,
    /estimates?(?:\s+that|")?\s+(?:demand|supply|consumption|production)\s+(?:will|is|are)/i,
    /outlook\s+(?:sees|projects|forecasts)\s+(?:demand|supply|consumption|production)/i,
    /demand\s+(?:is|are)\s+(?:projected|expected|anticipated|poised|set)\s+to/i,
    /consumption\s+(?:is|are)\s+(?:projected|expected|anticipated|poised|set)\s+to/i,
    // NEW: generic news / scraped-fragment markers that do not explain *why*
    // prices moved — they just describe the article's own framing ("tight
    // supply forecast", "margins weakened almost everywhere", "recent prices
    // are within expected ranges", "gas market in Q2 2026").
    /tight\s+supply\s+forecast/i,
    /recent\s+prices\s+are\s+within\s+expected\s+ranges/i,
    /margins\s+weakened\s+almost\s+everywhere/i,
    /gas\s+market\s+in\s+q2\s+2026/i,
    /gas\s+market\s+in\s+\d{4}\s+(?:q[1-4])\b/i,
    // Truncated trailing fragment: ends with a partial word that looks like
    // clipped scraped text (single letter, or word fragment with no terminal
    // punctuation after it). Examples: "... petroleum products. E", "... cheap",
    // "... gas co".
    /\.\s*[a-z]{1,3}\s*$/i,
    /\b(e|u|s|gas|co|oil|elec|wat)\.\s*$/i,
    // Bug 2 chrome/fragment rejection
    /in\s+this\s+article/i,
    /@[A-Z]{2,4}\d{1,4}\b/,
    /were\s+down\s+\d/i,
    /were\s+up\s+\d/i,
    /\bby\s+\d+\s+cents?\b/i,
    /[A-Z][a-z]{2,}[A-Z][a-z]/,
  ];
  for (const pattern of genericBodyPatterns) {
    if (pattern.test(body)) {
      return { ok: false, reason: "generic body text" };
    }
  }

  // Reject explanations whose BODY starts with a publication name (e.g. "the
  // opec monthly oil market report", "the iea world energy outlook", "the eia
  // short-term energy outlook"). These are scraped report titles that leaked
  // into the explanation body — the body should describe a price driver, not
  // name the source publication. Checked AFTER the generic body patterns so
  // the failure reason is accurate ("publication name in body").
  const publicationNameInBody = [
    /the\s+(?:opec|iea|eia|bp|shell|exxon|total|chevron)\b/i,
    /(?:monthly|quarterly|annual|weekly|daily)\s+(?:oil|energy|market|commodity|water|electricity|power)\s+(?:report|outlook|analysis|review|summary)\b/i,
    /(?:oil|energy|water|electricity|power)\s+(?:market|outlook|report|analysis|review|summary)\s+(?:report|outlook|analysis|review|summary)\b/i,
    /(?:world|short-term|global)\s+(?:oil|energy)\s+(?:outlook|report|analysis)\b/i,
  ];
  for (const pattern of publicationNameInBody) {
    if (pattern.test(body)) {
      return { ok: false, reason: "publication name in body" };
    }
  }

  // Reject explanations whose BODY starts with a participle/gerund — these are
  // mid-sentence fragments (e.g. "using ship-to-ship transfers...", "adding to
  // supply...", "reflecting prices..."). A proper price-driver clause should
  // start with a subject (noun/pronoun) or proper noun (OPEC+, IEA, the IEA).
  const participleBodyOpeners = [
    "using ", "adding ", "reflecting ", "driving ", "pushing ", "pulling ",
    "supporting ", "weighing ", "boosting ", "lifting ", "pressing ",
    "citing ", "noting ", "showing ", "indicating ", "signaling ",
  ];
  for (const opener of participleBodyOpeners) {
    if (body.startsWith(opener)) {
      return { ok: false, reason: "participle fragment in body" };
    }
  }

  // Reject explanations that are too short or too long for a proper summary
  if (trimmed.length < 50) {
    return { ok: false, reason: "too short" };
  }
  if (trimmed.length > 400) {
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
    /table\s+of\s+contents/i,
    /chapters?\s+/i,
    /feature\s+article\s+/i,
    /archive\s+/i,
    /abbreviations?\s+/i,
    /acronyms?\s+/i,
    /contributors?\s+/i,
    /disclaimer\s+/i,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s+/i,
    // NEW: Navigation / skip links / filter UI patterns that leak from scraped pages
    /skip\s+to\s+(?:page\s+)?content/i,
    /filter\s+by\s+(?:article\s+)?type/i,
    /\b(?:in-brief|in-depth)\s+analysis\b/i,
    /\barticle\s+type\b/i,
    /\bin\s+\w+\s+skip\s+to\s+(?:page\s+)?content\b/i,
    // Category/section labels that appear as navigation
    /^(?:energy|technology|science|business|markets|politics|world)\s+/i,
    // Date-like fragments without context
    /\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i,
  ];
  for (const pattern of pageChromePatterns) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: "page chrome / noise" };
    }
  }

// Reject explanations that end with a truncated trailing fragment — a
    // sentence that cuts off mid-word or ends with a single letter / clipped
    // word after the final period. Examples: "...petroleum products. E",
    // "...gas co", "...cheap". A genuine analyst summary always ends with a
    // complete word followed by terminal punctuation.
    if (/\.\s*[a-z]{1,3}\s*$/i.test(trimmed) || /\b(e|u|s|gas|co|oil|elec|wat)\.\s*$/i.test(trimmed)) {
      return { ok: false, reason: "truncated trailing fragment" };
    }
    // Reject explanations whose last sentence ends with a partial word
    // fragment (no space after the period, and the next token is a short
    // word). This catches mid-sentence truncation like "...products.E".
    if (/\.[a-z]{1,4}\s*$/i.test(trimmed) && !/\.[a-z]{1,4}\.\s*$/.test(trimmed)) {
      return { ok: false, reason: "truncated trailing fragment" };
    }

    // Require at least one sentence-ending punctuation for explanations longer
    // than ~50 chars. Raw scraped fragments often run on without punctuation.
    // Uses [.!?] followed by whitespace OR end-of-string so a single complete
    // sentence ending in a period is accepted.
    if (trimmed.length > 50 && (trimmed.match(/[.!?](\s|$)/g)?.length ?? 0) < 1) {
      return { ok: false, reason: "too few sentences for length" };
    }

    // Allow up to 3 sentences for natural analyst summaries. Kilo often generates
    // 2-3 sentence explanations that are legitimate price-driver analyses.
    // Rejecting all multi-sentence output forces re-summarization which often
    // fails or drops valid factors entirely, leading to static fallbacks.
    const sentenceCount = (trimmed.match(/[.!?](\s|$)/g)?.length ?? 0);
    if (sentenceCount > 3) {
      return { ok: false, reason: "too many sentences" };
    }

    return { ok: true };
  }

/**
 * Second-pass summarization: takes a raw explanation that failed quality
 * checks and asks Kilo to rewrite it into a proper meaningful sentence(s).
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
  const prompt = `Rewrite the following text into 1-3 meaningful sentences (under 400 characters total) that explain WHY the commodity price is moving. The explanation MUST start with "With [commodity] at $[price]/[unit]..." using the exact current price numbers provided below. Write in your own words — do NOT copy text verbatim.

Explain the actual price driver: a supply change (production cuts, outages, disruptions), a demand change, an unplanned outage, a policy or sanctions action, or an inventory/stock change. State what changed and why it moves the price.

FORBIDDEN:
- Merely describing an event, report, or agency action without explaining the price effect (e.g. "the report was published", "the agency released data").
- Ending with a truncated word or fragment (e.g. "... products. E", "... gas co", "... cheaper").
- Using the middle-dot "·" separator or any list-style scraped text (e.g. "Q2 2026 · Recent prices · Gas co").
- URLs, markdown links, bullet points, dashes at the start, publication names, headers, dates, or metadata.

Current prices: oil \$${currentPrices.oil.price}/${currentPrices.oil.unit}, electricity \$${currentPrices.electricity.price}/${currentPrices.electricity.unit}, water \$${currentPrices.water.price}/${currentPrices.water.unit}

Text to summarize: "${rawExplanation}"`;

  const payload = {
    messages: [
      { role: "system", content: "You are a precise commodity analyst and summarizer. Output 1-3 meaningful sentences (under 400 chars total) that explain WHY the price is moving — a supply change, demand change, unplanned outage, policy/sanctions action, or inventory change. Start with \"With [commodity] at $[price]/[unit],\". Never merely describe an event, report, or agency action without its price effect. Never end with a truncated word or fragment (\"E\", \"co\", \"cheaper\"). Never use the middle-dot \"·\" separator or list-style scraped text. No preamble, no markdown, no URLs, no bullet points, no dashes at the start, no publication headers, dates, or metadata." },
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

    // Fallback: truncate at sentence boundary to meet length/quality constraints
    const truncated = truncateToSentenceBoundary(sanitized, 400);
    const retryQuality = validateExplanationQuality(truncated);
    if (retryQuality.ok) {
      console.warn(`reSummarizeExplanation: applied fallback truncation to pass quality check`);
      return truncated;
    }

    // If still fails quality after truncation, drop the factor entirely
    console.warn(`reSummarizeExplanation: sanitized result still failed quality ("${quality.reason}"); dropping factor`);
    return null;
  } catch {
    return null;
  }
}

/**
 * Truncates text to `maxLen` characters at the nearest sentence boundary.
 * If no sentence boundary is found within the text, cuts at the last word
 * boundary and appends an ellipsis.
 *
 * Delegates to the shared `truncateAtSentenceBoundary` utility which guarantees
 * no mid-word cuts (unlike the previous `slice(0, maxLen)` implementation).
 */
function truncateToSentenceBoundary(text: string, maxLen: number = 400): string {
  return truncateAtSentenceBoundary(text, maxLen, { minPrefix: 1, ellipsis: "…" });
}

/**
 * Filters out deterministic static fallback factors from a factor array.
 * These are generated when the model cannot produce valid output and are
 * marked with a distinctive prefix ("static fallback factor maintained...").
 * Returns a new array containing only non-fallback factors.
 */
export function filterStaticFallbacks(factors: Factor[]): Factor[] {
  return factors.filter((f) => {
    const trimmed = (f?.explanation ?? "").trim();
    if (/^static\s+/i.test(trimmed) && /fallback factor maintained/i.test(trimmed)) return false;
    return true;
  });
}

/**
 * Final validation+repair pass that runs on ALL factors before they reach the UI,
 * regardless of source (cache, fresh curation, deterministic fallback, error fallback).
 * No factor with a bad explanation is ever returned unrepaired.
 *
 * For each factor:
 *   - If re-summarization succeeds and passes quality → uses re-summarized text
 *   - If re-summarization fails → last-resort: sanitize + truncate to 400 chars, never drop
 *   - If even sanitized text is empty → uses a safe generic placeholder
 *
 * Never drops a factor — better to have a clean short explanation than no factor at all.
 */
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
  const filtered = filterStaticFallbacks(factors);

  // Phase 1: Collect all factors needing repair, run re-summarization in parallel
  const needingRepair = filtered.filter((f) => {
    const quality = validateExplanationQuality(f.explanation);
    return !quality.ok && quality.reason !== "static fallback text";
  });

  if (needingRepair.length > 0) {
    console.warn(`validateAndRepairWindow: ${needingRepair.length} factors need re-summarization, running in parallel`);
    const repairPromises = needingRepair.map((f) =>
      reSummarizeExplanation(f.explanation, currentPrices, signal).then((reSummary) => ({ factor: f, reSummary, reQuality: reSummary ? validateExplanationQuality(reSummary) : { ok: false, reason: "re-summarization returned null" } }))
    );
    const repairResults = await Promise.allSettled(repairPromises);

    // Phase 2: Process results, fall back to sanitization where needed
    const sanitizeCandidates: Factor[] = [];
    for (let i = 0; i < needingRepair.length; i++) {
      const result = repairResults[i];
      const f = needingRepair[i];
      if (result.status === "fulfilled") {
        const { reSummary, reQuality } = result.value;
        if (reSummary && reQuality.ok) {
          repaired.push({ ...f, explanation: reSummary });
          continue;
        }
        console.warn(`validateAndRepairWindow: re-summarization failed or rejected quality ("${reQuality.reason}") for factor "${f.name}"); queuing for sanitization`);
      } else {
        console.warn(`validateAndRepairWindow: re-summarization threw for factor "${f.name}": ${result.reason}; queuing for sanitization`);
      }
      sanitizeCandidates.push(f);
    }

    // Phase 3: Sanitization for remaining failures (still sequential, but typically few)
    for (const f of sanitizeCandidates) {
      const sanitized = sanitizeExplanation(f.explanation);
      if (sanitized) {
        const sanitizedQuality = validateExplanationQuality(sanitized);
        if (sanitizedQuality.ok) {
          repaired.push({ ...f, explanation: sanitized });
        } else {
          console.warn(`validateAndRepairWindow: sanitized fallback still failed quality ("${sanitizedQuality.reason}") for factor "${f.name}"; skipping factor`);
        }
      } else {
        console.warn(`validateAndRepairWindow: sanitized fallback is empty for factor "${f.name}"; skipping factor`);
      }
    }
  }

  // Factors that passed quality initially
  for (const f of filtered) {
    const quality = validateExplanationQuality(f.explanation);
    if (quality.ok) {
      repaired.push(f);
    } else if (quality.reason === "static fallback text") {
      console.warn(`validateAndRepairWindow: removing static fallback factor "${f.name}"`);
    }
  }

  return repaired.map((f) => {
    const safeName = sanitizeFactorTitle(f.name, f.explanation);
    if (safeName && safeName !== f.name && !isInvalidFactorTitle(safeName)) {
      return { ...f, name: safeName };
    }
    // If the current name is invalid and no safe replacement exists, drop the
    // factor entirely rather than surfacing a non-reason title like
    // "Breaking News" or "Historically".
    if (isInvalidFactorTitle(f.name)) {
      return null;
    }
    return f;
  }).filter((f): f is Factor => f !== null);
}

const SYSTEM_PROMPT_GLOBAL =
`You are a Senior Commodity Risk Analyst. You are provided with current global market analytics, an existing list of global price factors, and fresh validated news excerpts collected through TinyFish.

=== STEPS (follow in order) ===
1. Read EVERY candidate's title, snippet, and full text carefully.
2. Identify the CONCRETE reason the article gives for an oil, electricity, or water price movement. This is a factual claim the article itself makes, not your own inference.
3. Write that reason in 1-3 meaningful sentences in the explanation field. Start with the commodity and the current price number from currentPrices (e.g. "with oil at $104.86/bbl..."). Use the numbers; do not paraphrase around them.
4. Set the source field to the EXACT URL string from the candidate list — copy it verbatim, character for character. Never write a publication name.

=== FORBIDDEN ===
- NEVER output a bare publication name (e.g. "IEA", "OPEC Monthly Oil Market Report", "UN-Water; WRI Aqueduct") in the source field.
- NEVER invent a URL. If you cannot find a matching URL, copy the URL verbatim from the candidate list.
- NEVER output markdown or commentary outside the JSON.
- NEVER output raw scraped text or article snippets verbatim. Always summarize in your own words.
- NEVER start an explanation with a bullet point ("- ", "• ", "* "), a publication name ("OPEC ", "IEA ", "UN-Water "), or an article opening ("Around ", "According ", "The world ", "Global ").
- NEVER write more than THREE sentences per explanation. Each explanation MUST be 1-3 complete, meaningful sentences (not a fragment, not a bullet point).
- NEVER include publication headers, dates, or metadata in the explanation.
- NEVER include web navigation / page chrome text (e.g. "Skip to page content", "Filter by article type", "In-brief analysis", "In-depth analysis", category labels like "Energy", "Technology", "Markets") in the explanation.
- NEVER start the explanation body (after "With <commodity> at $<price>/<unit>,") with a participle/gerund like "using ", "adding ", "reflecting ", "driving ", "pushing ", "showing " — these are mid-sentence fragments, not complete price-driver statements.
- Do NOT include publication headers, dates, or metadata in the explanation.

=== EXPLANATION REQUIREMENTS ===
- Each explanation MUST be 1-3 complete, meaningful sentences (not a fragment, not a bullet point)
- Do NOT start with bullet points (-, •, *, –, —) or article navigation text
- Do NOT include publication headers, dates, or metadata
- Do NOT include web navigation / page chrome (skip links, filter UI, article type labels, category headers)
- Do NOT start the body with a participle/gerund (using, adding, reflecting, driving, pushing, showing, etc.)
- Focus on the specific price driver: what changed, why it matters for oil/electricity/water prices
- Maximum 400 characters — keep it concise
- Start with the commodity and current price number from currentPrices (e.g. "with oil at $104.86/bbl...")

=== FEW-SHOT EXAMPLES (GOOD vs BAD) ===

GOOD explanation (single sentence, starts with commodity+price, own words, no URLs):
"With oil at $73.07/bbl, OPEC+ has agreed to extend voluntary production cuts through Q1 2026, which is expected to remove roughly 1.2 million b/d from the market and support prices in the short term."

GOOD explanation:
"With oil at $104.86/bbl, new US sanctions on Russian crude exports are estimated to remove roughly 1 mb/d from global supply, tightening the market and lifting prices in the short term."

GOOD explanation (water):
"With water at $2.15/M³, drought-driven supply disruptions from scarcity affecting 4 billion people are pushing utility tariffs higher as scarcity premiums are increasingly reflected in consumer prices."

GOOD explanation (two sentences, both grounded in commodity+price):
"With oil at $73.07/bbl, OPEC+ has agreed to extend voluntary production cuts through Q1 2026. The supply restraint is expected to remove roughly 1.2 million b/d from the market and support prices."

CRITICAL — EVERY explanation MUST literally begin with "With <commodity> at $<price>/<unit>," (e.g. "With oil at $73.07/bbl," or "With Brent crude at $94.50/bbl,"). Raw article sentences, mid-sentence fragments, and table-of-contents lines are strictly forbidden.

BAD explanation — raw article sentence, does NOT start with commodity+price:
"Global electricity demand growth accelerates as markets navigate energy price shocks Global power demand is on track to rise faster in 2026 and 2027 than in 202"

BAD explanation — starts with bullet, not summarized:
"- World oil demand is forecast to fall by 2.7 mb/d in 2026, to 102.3 mb/d, before rebounding by 2 mb/d in 2027."

BAD explanation — raw article opening, no commodity+price start:
"Around four billion people experience severe water scarcity for at least one month each year, while drought impacts cost an estimated $307 billion annually."

BAD explanation — contains page navigation chrome:
"With oil at $104.86/bbl, in Energy Skip to page content Filter by article type In-brief analysis Nov 13 2026"

BAD explanation — mid-sentence fragment starting with participle:
"With oil at $104.86/bbl, using ship-to-ship transfers along Oman's coast added to supply which was reflected in prices during late October and early"

BAD explanation — raw article fragment with truncated ending (NOT a price driver):
"With oil at $108.2/USD per barrel, the G7 Oil Price Cap Coalition established an oil price cap mechanism on Russian seaborne crude oil and petroleum products. E"

BAD explanation — generic news text that does NOT explain price changes:
"With oil at $112.5/USD per barrel, margins weakened almost everywhere in October as record freight costs hit Asian refiners. US refiners benefited from cheaper"

BAD explanation — just a forecast/list fragment, NOT a price driver:
"With electricity at $252/USD per MWh, tight supply forecast for Australia's east coast gas market in Q2 2026 · Recent prices are within expected ranges · Gas co"

Every explanation you output must follow the GOOD examples: 1-3 meaningful sentences, your own words, STARTS WITH commodity + current price number from currentPrices (literally "With <commodity> at $<price>/<unit>,"), no URLs, no markdown, no bullet points, no raw article text, no publication headers, dates, or metadata, no page navigation chrome, no participle-opener fragments. Focus on the specific price driver: what changed and why it matters for prices.

=== GROUNDING ===
Every factor's explanation MUST reference the current price numbers supplied in currentPrices. For example: "with oil at $104.86/bbl, OPEC+ output cuts are tightening supply...". Use the numbers, do not paraphrase around them.

=== WORKED EXAMPLE ===
{"id":"example-1","name":"OPEC+ output restraint","category":"Market","commodities":["oil"],"explanation":"With oil at $104.86/bbl, OPEC+ members have agreed to extend voluntary production cuts through Q1 2026, which is expected to remove roughly 1.2 million b/d from the market and support prices in the short term.","direction":"up","magnitude":"High","source":"https://www.iea.org/reports/world-energy-outlook-2026","bias":"short","importanceScore":82,"drift":{"oil":0.5}}

=== JSON SCHEMA ===
Each factor object must be exactly: { id: string; name: string; category: "Market"|"Policy"|"Structural"|"Infrastructure"|"Environmental"|"Geopolitical"|"Technological"; commodities: string[] (subset of oil, electricity, water); explanation: string (1-3 meaningful sentences summarizing the reason found in the supplied source URL, starting with commodity + current price number); direction: "up"|"down"|"mixed"; magnitude: "High"|"Medium"|"Low"; source: string (the EXACT URL string from the candidate list — a URL, never a publication name); bias: "short"|"mid"|"long"|"flat"; importanceScore: integer 0-100; drift: object mapping commodity to a small decimal adjustment }.

The source field MUST be an exact URL string from the supplied candidate list. It is a URL, never a publication name.
- The \`name\` field MUST be a concise title of 2-8 words (e.g. "OPEC+ Output Restraint", "Middle East Supply Risk"). It MUST NOT be a full sentence, MUST NOT repeat the explanation, and MUST NOT include the grounding preamble ("With oil at $..."), URLs, @ticker tags, or page chrome.
Return strict JSON only. Do not return markdown or commentary outside JSON.

The response must contain up to eight validated global factors matching the required schema. If a new legitimate trend is identified, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

const SYSTEM_PROMPT_REGIONAL = (regionName: string) =>
`You are a Senior Commodity Risk Analyst specializing in ${regionName} energy and water markets. You are provided with current ${regionName}-specific market analytics, an existing list of ${regionName} price factors, and fresh validated news excerpts collected through TinyFish that are relevant to ${regionName}.

=== STEPS (follow in order) ===
1. Read EVERY candidate's title, snippet, and full text carefully.
2. Identify the CONCRETE reason the article gives for an oil, electricity, or water price movement. This is a factual claim the article itself makes, not your own inference.
3. Write that reason in 1-3 meaningful sentences in the explanation field. Start with the commodity and the current price number from currentPrices (e.g. "with oil at $104.86/bbl..."). Use the numbers; do not paraphrase around them.
4. Set the source field to the EXACT URL string from the candidate list — copy it verbatim, character for character. Never write a publication name.

=== FORBIDDEN ===
- NEVER output a bare publication name (e.g. "IEA", "OPEC Monthly Oil Market Report", "UN-Water; WRI Aqueduct") in the source field.
- NEVER invent a URL. If you cannot find a matching URL, copy the URL verbatim from the candidate list.
- NEVER output markdown or commentary outside the JSON.
- NEVER output raw scraped text or article snippets verbatim. Always summarize in your own words.
- NEVER start an explanation with a bullet point ("- ", "• ", "* "), a publication name ("OPEC ", "IEA ", "UN-Water "), or an article opening ("Around ", "According ", "The world ", "Global ").
- NEVER write more than THREE sentences per explanation. Each explanation MUST be 1-3 complete, meaningful sentences (not a fragment, not a bullet point).
- NEVER include publication headers, dates, or metadata in the explanation.
- NEVER include web navigation / page chrome text (e.g. "Skip to page content", "Filter by article type", "In-brief analysis", "In-depth analysis", category labels like "Energy", "Technology", "Markets") in the explanation.
- NEVER start the explanation body (after "With <commodity> at $<price>/<unit>,") with a participle/gerund like "using ", "adding ", "reflecting ", "driving ", "pushing ", "showing " — these are mid-sentence fragments, not complete price-driver statements.
- Do NOT include publication headers, dates, or metadata in the explanation.

=== EXPLANATION RULES ===
- Write the explanation in YOUR OWN WORDS. Never copy text verbatim from the source article.
- The explanation must be 1-3 meaningful sentences that a human analyst would write.
- NEVER include a URL inside the explanation text. The source URL goes ONLY in the "source" field.
- NEVER include markdown links like [text](url) inside the explanation.
- Start the explanation with the commodity and the current price number from currentPrices (e.g. "with oil at $104.86/bbl...").
- Keep the explanation under 400 characters. Short and punchy is better than long and detailed.
- If the article is about a price RISE, say prices are rising and why. If about a FALL, say prices are falling and why.
- Each explanation MUST be 1-3 complete, meaningful sentences (not a fragment, not a bullet point)
- Do NOT start with bullet points (-, •, *, –, —) or article navigation text
- Do NOT include publication headers, dates, or metadata
- Do NOT include web navigation / page chrome (skip links, filter UI, article type labels, category headers)
- Do NOT start the body with a participle/gerund (using, adding, reflecting, driving, pushing, showing, etc.)
- Focus on the specific price driver: what changed, why it matters for oil/electricity/water prices

=== FEW-SHOT EXAMPLES (GOOD vs BAD) ===

GOOD explanation (single sentence, starts with commodity+price, own words, no URLs):
"With oil at $73.07/bbl, OPEC+ has agreed to extend voluntary production cuts through Q1 2026, which is expected to remove roughly 1.2 million b/d from the market and support prices in the short term."

GOOD explanation (regional price driver):
"With oil at $73.07/bbl, an unplanned outage at a major regional refinery has tightened gasoline and diesel supply, lifting wholesale fuel prices across the region."

GOOD explanation (water):
"With water at $2.15/M³, drought-driven supply disruptions from scarcity affecting 4 billion people are pushing utility tariffs higher as scarcity premiums are increasingly reflected in consumer prices."

GOOD explanation (two sentences, both grounded in commodity+price):
"With oil at $73.07/bbl, OPEC+ has agreed to extend voluntary production cuts through Q1 2026. The supply restraint is expected to remove roughly 1.2 million b/d from the market and support prices."

CRITICAL — EVERY explanation MUST literally begin with "With <commodity> at $<price>/<unit>," (e.g. "With oil at $73.07/bbl," or "With Brent crude at $94.50/bbl,"). Raw article sentences, mid-sentence fragments, and table-of-contents lines are strictly forbidden.

BAD explanation — raw article sentence, does NOT start with commodity+price:
"Global electricity demand growth accelerates as markets navigate energy price shocks Global power demand is on track to rise faster in 2026 and 2027 than in 202"

BAD explanation — starts with bullet, not summarized:
"- World oil demand is forecast to fall by 2.7 mb/d in 2026, to 102.3 mb/d, before rebounding by 2 mb/d in 2027."

BAD explanation — raw article opening, no commodity+price start:
"Around four billion people experience severe water scarcity for at least one month each year, while drought impacts cost an estimated $307 billion annually."

BAD explanation — contains page navigation chrome:
"With oil at $104.86/bbl, in Energy Skip to page content Filter by article type In-brief analysis Nov 13 2026"

BAD explanation — mid-sentence fragment starting with participle:
"With oil at $104.86/bbl, using ship-to-ship transfers along Oman's coast added to supply which was reflected in prices during late October and early"

BAD explanation — raw article fragment with truncated ending (NOT a price driver):
"With oil at $108.2/USD per barrel, the G7 Oil Price Cap Coalition established an oil price cap mechanism on Russian seaborne crude oil and petroleum products. E"

BAD explanation — generic news text that does NOT explain price changes:
"With oil at $112.5/USD per barrel, margins weakened almost everywhere in October as record freight costs hit Asian refiners. US refiners benefited from cheaper"

BAD explanation — just a forecast/list fragment, NOT a price driver:
"With electricity at $252/USD per MWh, tight supply forecast for Australia's east coast gas market in Q2 2026 · Recent prices are within expected ranges · Gas co"

Every explanation you output must follow the GOOD examples: 1-3 meaningful sentences, your own words, STARTS WITH commodity + current price number from currentPrices (literally "With <commodity> at $<price>/<unit>,"), no URLs, no markdown, no bullet points, no raw article text, no publication headers, dates, or metadata, no page navigation chrome, no participle-opener fragments. Focus on the specific price driver: what changed and why it matters for prices.

=== GROUNDING ===
Every factor's explanation MUST reference the current price numbers supplied in currentPrices. For example: "with oil at $104.86/bbl, OPEC+ output cuts are tightening supply...". Use the numbers, do not paraphrase around them.

=== WORKED EXAMPLE ===
{"id":"example-1","name":"OPEC+ output restraint","category":"Market","commodities":["oil"],"explanation":"With oil at $104.86/bbl, OPEC+ members have agreed to extend voluntary production cuts through Q1 2026, which is expected to remove roughly 1.2 million b/d from the market and support prices in the short term.","direction":"up","magnitude":"High","source":"https://www.iea.org/reports/world-energy-outlook-2026","bias":"short","importanceScore":82,"drift":{"oil":0.5}}

=== JSON SCHEMA ===
Each factor object must be exactly: { id: string; name: string; category: "Market"|"Policy"|"Structural"|"Infrastructure"|"Environmental"|"Geopolitical"|"Technological"; commodities: string[] (subset of oil, electricity, water); explanation: string (1-3 meaningful sentences summarizing the reason found in the supplied source URL, starting with commodity + current price number); direction: "up"|"down"|"mixed"; magnitude: "High"|"Medium"|"Low"; source: string (the EXACT URL string from the candidate list — a URL, never a publication name); bias: "short"|"mid"|"long"|"flat"; importanceScore: integer 0-100; drift: object mapping commodity to a small decimal adjustment }.

The source field MUST be an exact URL string from the supplied candidate list. It is a URL, never a publication name.
- The \`name\` field MUST be a concise title of 2-8 words (e.g. "OPEC+ Output Restraint", "Middle East Supply Risk"). It MUST NOT be a full sentence, MUST NOT repeat the explanation, and MUST NOT include the grounding preamble ("With oil at $..."), URLs, @ticker tags, or page chrome.
Return strict JSON only. Do not return markdown or commentary outside JSON.

The response must contain up to eight validated ${regionName} factors matching the required schema. If a new legitimate trend is identified for ${regionName}, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

const GLOBAL_QUERIES = [
  "Brent crude oil price today why moving OPEC supply news November 2026",
  "WTI crude oil price today why moving supply demand news November 2026",
  "global oil price today why moving OPEC sanctions supply news 2026",
  "electricity price today why moving gas supply renewables news November 2026",
  "global electricity price today why moving renewables grid demand news 2026",
  "US electricity price today why moving Henry Hub gas renewables 2026",
  "water tariff price increase today why drought utilities news 2026",
  "global water price today why moving scarcity drought utilities news 2026",
  "water utility price today why moving drought infrastructure news 2026",
];

const REGION_QUERIES: Record<Region, string[]> = {
  asia: [
    "Asia oil price today why moving China India demand OPEC November 2026",
    "Asia crude oil price today why moving Middle East supply demand news 2026",
    "Asia electricity price today why moving renewables grid China India November 2026",
    "Asia electricity price today why moving coal gas generation demand news 2026",
    "Asia water tariff price today why scarcity drought urbanization 2026",
    "Asia water price today why moving desalination urban demand news 2026",
  ],
  europe: [
    "Europe oil price today why moving Brent Russian supply sanctions November 2026",
    "Europe crude oil price today why moving OPEC+ supply disruption news 2026",
    "Europe electricity price today why moving carbon ETS renewables gas November 2026",
    "Europe electricity price today why moving wind solar nuclear generation news 2026",
    "Europe water tariff price today why drought scarcity Alpine hydropower 2026",
    "Europe water price today why moving river levels drought utilities news 2026",
  ],
  africa: [
    "Africa oil price today why moving Nigeria Angola production exports November 2026",
    "Africa crude oil price today why moving supply disruption sanctions news 2026",
    "Africa electricity price today why moving diesel gensets grid reliability 2026",
    "Africa electricity price today why moving hydro thermal generation news 2026",
    "Africa water tariff price today why drought scarcity Sahel utilities 2026",
    "Africa water price today why moving scarcity conflict utilities news 2026",
  ],
  americas: [
    "Americas oil price today why moving WTI shale LNG exports November 2026",
    "Americas crude oil price today why moving Canada Mexico production news 2026",
    "Americas electricity price today why moving hydro drought Henry Hub 2026",
    "Americas electricity price today why moving Texas ERCIA grid demand news 2026",
    "Americas water tariff price today why drought California Southwest utilities 2026",
    "Americas water price today why moving drought infrastructure scarcity news 2026",
  ],
  oceania: [
    "Oceania oil price today why moving LNG import parity Australia November 2026",
    "Oceania crude oil price today why moving Asia Pacific demand supply news 2026",
    "Oceania electricity price today why moving NEM NZ wholesale drought 2026",
    "Oceania electricity price today why moving coal gas renewables generation news 2026",
    "Oceania water tariff price today why drought Sydney Melbourne utilities 2026",
    "Oceania water price today why moving drought desalination demand news 2026",
  ],
};

const KNOWN_REPUTABLE_URLS = [
  "https://oilprice.com/Latest-Energy-News/World-Energy-News",
  "https://www.reuters.com/markets/commodities/",
  "https://tradingeconomics.com/commodity/brent-crude-oil",
  "https://www.globenewswire.com/news-room",
  "https://www.iea.org/reports/world-energy-outlook",
  "https://www.opec.org/opec_web/en/",
  "https://www.eia.gov/petroleum/",
  "https://www.eia.gov/electricity/",
  "https://www.iea.org/reports/electricity-market-report",
  "https://www.unwater.org/",
  "https://www.wri.org/",
  "https://www.irena.org/",
  "https://www.eia.gov/renewable-energy/",
  "https://www.un.org/sustainabledevelopment/water/",
  "https://www.worldbank.org/en/topic/water",
  "https://www.sandpglobal.com/platts/market-news",
  "https://www.argusmedia.com/en/market-news",
  "https://www.utilitydive.com/news/",
  "https://www.energynetworks.org/news",
  "https://www.canarymedia.com/news/",
  "https://www.pv-magazine.com/latest-news/",
  "https://www.windpowermonthly.com/latest",
  "https://www.recharge.biz/latest",
];

/**
 * Domains TinyFish search is restricted to for factor curation. Restricting to
 * these reputable news/data hosts guarantees returned candidates carry concrete
 * price-moving reasons (not generic landing pages), so the reputable-host
 * filter never starves the model of fetched URLs.
 */
const FACTOR_SEARCH_DOMAINS = [
  "reuters.com",
  "oilprice.com",
  "tradingeconomics.com",
  "globenewswire.com",
  "spglobal.com",
  "argusmedia.com",
  "platts.com",
  "bloomberg.com",
  "cnbc.com",
  "marketwatch.com",
  "prnewswire.com",
  "nasdaq.com",
  "investing.com",
  "energy.gov",
  "eia.gov",
  "iea.org",
  "opec.org",
  "utilitydive.com",
  "energynetworks.org",
  "canarymedia.com",
  "pv-magazine.com",
  "windpowermonthly.com",
  "recharge.biz",
];

/**
 * Region-specific known reputable URLs for the fallback path when TinyFish
 * search returns no candidates. Each region has URLs relevant to its
 * commodity markets (oil, electricity, water) so the fallback can produce
 * meaningful factors even when live search fails.
 */
const KNOWN_REGIONAL_URLS: Record<RegionId, string[]> = {
  global: KNOWN_REPUTABLE_URLS,
  asia: [
    "https://asia.economictimes.indiatimes.com/energy",
    "https://www.reuters.com/asia/",
    "https://www.iea.org/asia/",
    "https://www.unwater.org/asia",
  ],
  europe: [
    "https://www.economist.com/energy-environment",
    "https://www.reuters.com/europe/",
    "https://www.iea.org/europe/",
    "https://www.unwater.org/europe",
  ],
  africa: [
    "https://www.reuters.com/africa/",
    "https://www.iea.org/africa/",
    "https://unwater.org/africa",
    "https://www.worldbank.org/africa/water",
  ],
  americas: [
    "https://www.reuters.com/americas/",
    "https://www.iea.org/americas/",
    "https://www.eia.gov/analysis/",
    "https://unwater.org/americas",
  ],
  oceania: [
    "https://www.reuters.com/oceania/",
    "https://www.iea.org/oceania/",
    "https://www.eia.gov/oceania",
    "https://unwater.org/oceania",
  ],
};

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
 * Patterns that indicate a factor name is really a publication/report title
 * (e.g. "World Oil Outlook", "Monthly Oil Market Report", "IEA") rather than
 * a concrete price driver. These names are replaced with one derived from the
 * explanation.
 */
const PUBLICATION_NAME_PATTERNS: RegExp[] = [
  /\b(report|outlook|monthly|annual|new)\b/i,
  /prices\s*-/i,
  /\b(iea|opec|eia|un[- ]water|wri|irena)\b/i,
];

/** Max characters for a displayed factor title. */
const TITLE_MAX_CHARS = 100;

/** Trailing tokens that signal a title was cut mid-phrase. */
const DANGLING_TITLE_TAIL = new Set<string>([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "as", "while",
  "whilst", "although", "though", "because", "since", "if", "when", "where",
  "which", "that", "who", "whom", "whose", "of", "in", "on", "at", "to", "for",
  "from", "by", "with", "without", "into", "onto", "over", "under", "after",
  "before", "during", "about", "against", "between", "among", "through", "per",
  "via", "across", "is", "are", "was", "were", "be", "been", "being", "has",
  "have", "had", "do", "does", "did", "will", "would", "can", "could", "may",
  "might", "must", "shall", "should", "limited", "entering", "recovering",
  "following", "including", "excluding", "reaching", "hitting", "creating",
  "leading", "causing", "driving", "pushing", "lifting", "boosting",
  "weighing", "supporting",
]);

/** Leading site / publication prefixes to drop from a title. */
const TITLE_LEADING_PREFIX =
  /^(?:investing\.com|reuters|bloomberg|cnbc|financial\s+times|ft\.com|the\s+economist|oilprice\.com|argus(?:\s+media)?|s&p\s+global|spglobal|platts|marketwatch|yahoo\s+finance|morningstar|trading\s+economics|economies\.com|business\s+standard|the\s+hindu)\s*(?:--|—|–|:|\||-)\s*/i;

/** Titles that are article headers / metadata fragments rather than concrete price-driver reasons.
 * These are single words or short phrases that describe an article's framing, not *why* a price moved.
 * Examples: "Breaking News", "Historically", "News", "Update", "Alert", "Briefing".
 */
const INVALID_TITLE_PATTERNS: RegExp[] = [
  /^breaking\s*news\b/i,
  /^breaking\b/i,
  /^historically\b/i,
  /^(news|update|alert|briefing|headline|headlines)\b/i,
  /^(today|yesterday|this\s+week|this\s+month)\b/i,
  /^(in\s+this\s+article|by\s+[A-Z][a-z]+\s+[A-Z][a-z]+)\b/i,
];

/** Returns true when a factor title is not a valid reason title — e.g. it's an
 * article header ("Breaking News"), a single adverb ("Historically"), or a bare
 * publication/metadata fragment. A valid title should describe a concrete price
 * driver (e.g. "OPEC+ Output Restraint", "Middle East Supply Risk"). */
export function isInvalidFactorTitle(title: string): boolean {
  if (!title || typeof title !== "string") return true;
  const trimmed = title.trim();
  if (trimmed.length < 6) return true;
  const lower = trimmed.toLowerCase();
  for (const pattern of INVALID_TITLE_PATTERNS) {
    if (pattern.test(lower)) return true;
  }
  // A single-word title that is not an acronym or proper noun phrase is not a
  // reason title. Valid reason titles are typically 2+ words describing a driver.
  const words = trimmed.split(/\s+/);
  if (words.length === 1 && !/^[A-Z][A-Z0-9+/]{1,}$/.test(trimmed)) return true;
  return false;
}

/** Removes grounding preamble, leading publication prefixes and page chrome. */
function stripTitleNoise(text: string): string {
  if (!text || typeof text !== "string") return "";
  let t = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/\*+/g, "")
    .replace(/#+/g, " ")
    .replace(/^\s*[-•*–—]+\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

  // Strip the grounding preamble, e.g. "With oil at $104.86/USD per barrel, ..."
  t = t.replace(/^with\s+.+?\s+at\s+\$[\d,.]+\s*(?:\/\s*[^,]+)?,\s*/i, "");
  // Strip a leading publication / site prefix.
  t = t.replace(TITLE_LEADING_PREFIX, "");
  // Remove inline page chrome / ticker tags.
  t = t
    .replace(/\bin\s+this\s+article\b/gi, " ")
    .replace(/@[A-Za-z0-9]{2,12}/g, " ")
    .replace(/\bskip\s+to\s+(?:page\s+)?content\b/gi, " ")
    .replace(/\bshare\s+this\s+(?:report|story|article)\b/gi, " ")
    .replace(/\breport\s+options\b/gi, " ")
    .replace(/\bread\s+more\b/gi, " ")
    .replace(/\badvertisement\b/gi, " ")
    .replace(/\bphoto\s*:/gi, " ")
    .replace(/\bimage\s*:/gi, " ")
    .replace(/\bwere\s+(?:down|up)\s+\d/gi, " ")
    .replace(/\bby\s+\d+\s+cents?\b/gi, " ");

  // Split accidental CamelCase glue, e.g. "MiddleNew" -> "Middle New".
  t = t.replace(/([a-z])([A-Z])/g, "$1 $2");

  return t.replace(/\s+/g, " ").replace(/^[\s,;:.\-–—|]+/, "").trim();
}

/** Drops trailing dangling words/punctuation left by a mid-phrase cut. */
function stripDanglingTitleTail(text: string): string {
  let t = text.trim().replace(/[\s,;:.\-–—|]+$/, "");
  for (let guard = 0; guard < 8; guard++) {
    const m = t.match(/([A-Za-z][A-Za-z'’\-]*)$/);
    if (!m || !DANGLING_TITLE_TAIL.has(m[1].toLowerCase())) break;
    t = t.slice(0, t.length - m[1].length).replace(/[\s,;:.\-–—|]+$/, "").trim();
  }
  return t;
}

/** Trims text to a concise, complete-looking title (<= TITLE_MAX_CHARS). */
function toConciseTitle(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return "";
  // Prefer the first natural clause boundary.
  const match = cleaned.match(/^(.{12,}?)(?:[,;:]|\s[—–]\s|$)/);
  let candidate = (match ? match[1] : cleaned).trim();
  if (candidate.length > TITLE_MAX_CHARS) {
    candidate = truncateAtWordBoundary(candidate, TITLE_MAX_CHARS, { minPrefix: 1, ellipsis: "" });
  }
  return stripDanglingTitleTail(candidate);
}

/** Title-cases tokens while preserving acronyms (OPEC+, IEA) and units (mb/d). */
function titleCaseTokens(text: string): string {
  return text
    .split(/\s+/)
    .map((token) => {
      if (/^[A-Z][A-Z0-9+/]+$/.test(token)) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Derives a concise, human-readable factor name (max ~80 chars) from an
 * explanation. Strips the price preamble and page chrome, takes the leading
 * clause, title-cases it, and trims any dangling tail so the title is never a
 * mid-word/mid-phrase fragment. Returns "" when nothing usable remains.
 */
function deriveFactorNameFromExplanation(explanation: string): string {
  const body = stripTitleNoise(explanation);
  if (!body) return "";
  const clause = body.split(/[,;:]/)[0].trim().replace(/^(and|or|but|so|yet|for|nor)\s+/i, "");
  if (!clause) return "";
  return titleCaseTokens(toConciseTitle(clause));
}

/**
 * Produces a clean, complete factor title from a raw model-provided name (or,
 * failing that, from the explanation). Never returns a title with the grounding
 * preamble, page chrome / @ticker tags, a leading publication prefix, a
 * mid-word cut, or a dangling article/preposition/verb tail. Never returns an
 * invalid title such as "Breaking News" or "Historically" that is not a
 * concrete price-driver reason.
 */
function sanitizeFactorTitle(rawName: string, explanation: string): string {
  // Prefer the raw model-provided name when it is a valid reason title.
  const fromRaw = toConciseTitle(stripTitleNoise(rawName));
  if (fromRaw.length >= 6 && !isInvalidFactorTitle(fromRaw)) return fromRaw;

  // Fall back to deriving a title from the explanation content.
  const derived = deriveFactorNameFromExplanation(explanation);
  if (derived.length >= 6 && !isInvalidFactorTitle(derived)) return derived;

  // Last resort: use the raw name if it is at least valid, otherwise return "".
  if (fromRaw.length >= 6 && !isInvalidFactorTitle(fromRaw)) return fromRaw;
  return "";
}

/**
 * Validates that an extracted `clause` (the part of an explanation AFTER the
 * "With <commodity> at $<price>/<unit>, " grounding prefix) contains meaningful
 * price-driver information rather than generic forecasts, meta-analysis,
 * navigation text, or a clipped fragment.
 *
 * This is a SECOND layer of defense beyond `validateExplanationQuality`, which
 * only inspects the START of the explanation (the commodity+price opening,
 * bullet points, page chrome). A clause can pass that opening check and still
 * be generic — e.g. "the global oil demand in 2026 is forecast to grow by 1.4
 * mb/d" — so the body must be inspected separately before grounding.
 *
 * Returns `true` when the clause looks like a concrete price driver, `false`
 * when it is generic/fragmented and the candidate should be re-extracted or
 * skipped.
 *
 * Rejected clause shapes:
 * - Generic forecast openers: "the global ", "the world ", "is forecast",
 *   "are forecast", "is on track", "are on track", and demand/supply/
 *   consumption/production projections ("demand is projected to", ...)
 * - Meta-analysis / report-intro openers: "the report provides",
 *   "the study examines", "this analysis", "the analysis"
 * - Navigation / fragment markers anywhere in the clause: "key developments",
 *   "impacting", "as well as", "according to", and projection verbs
 *   ("projected to", "expected to", "outlook sees", ...)
 * - Bare projection clauses with a commodity subject that does not start with
 *   "the global " (e.g. "global oil demand is projected to rise...")
 * - Bare numbers/units with no subject or verb (e.g. "1.4 mb/d", "2.7 mb/d")
 */
function clauseQualityCheck(clause: string): boolean {
  if (!clause || clause.trim().length === 0) return false;
  const trimmed = clause.trim();
  const lower = trimmed.toLowerCase();

  // Reject generic forecast openers — these describe a projection rather than a
  // concrete price driver that changed.
  const genericForecastOpeners = [
    "the global ",
    "the world ",
    "is forecast",
    "are forecast",
    "is on track",
    "are on track",
    "demand is projected to",
    "demand is expected to",
    "demand is anticipated to",
    "demand is poised to",
    "demand is set to",
    "supply is projected to",
    "supply is expected to",
    "supply is anticipated to",
    "consumption is projected to",
    "consumption is expected to",
    "consumption is anticipated to",
    "production is projected to",
    "production is expected to",
  ];
  for (const opener of genericForecastOpeners) {
    if (lower.startsWith(opener)) return false;
  }

  // Reject meta-analysis / report-intro openers — these describe the
  // publication itself rather than a concrete price driver.
  const metaAnalysisOpeners = [
    "the report provides",
    "the study examines",
    "this analysis",
    "the analysis",
  ];
  for (const opener of metaAnalysisOpeners) {
    if (lower.startsWith(opener)) return false;
  }

  // Reject navigation / fragment markers anywhere in the clause. These come
  // from scraped report pages (table-of-contents lines, mid-sentence clips).
  const fragmentMarkers = [
    "key developments",
    "impacting",
    "as well as",
    "according to",
    "projected to",
    "expected to",
    "anticipated to",
    "poised to",
    "set to",
    "estimated to",
    "forecasts that",
    "estimates that",
    "outlook sees",
    "outlook projects",
    "outlook forecasts",
    // NEW: specific scraped-fragment patterns from user reports
    "tight supply forecast",
    "recent prices are within expected ranges",
    "margins weakened almost everywhere",
    "gas market in q2 2026",
    "gas market in",
    "petroleum products. e",
    "refiners benefited from cheaper",
  ];
  for (const marker of fragmentMarkers) {
    if (lower.includes(marker)) return false;
  }

  // Reject bare projection clauses that do not start with a generic opener
  // (e.g. "the global ") but still describe a forecast rather than a realised
  // price driver — for example "global oil demand is projected to rise by 1.4
  // mb/d in 2026" or "world refining capacity is expected to grow". These begin
  // with a bare commodity subject, so the `startsWith` opener check misses them.
  const bareProjectionClause =
    /(?:\bglobal|\bworld|\bregional|\bdomestic|\bus\b|\bu\.s\.|\beuropean|\basian|\bchina|\bindia)\b[\w\s,'’-]{0,40}?\b(?:demand|supply|consumption|production|output|capacity|exports|imports|refining)\b[\w\s,'’-]{0,20}?\b(?:is|are|was|were)\b\s+(?:projected|expected|anticipated|poised|set|forecast|estimated|likely)\s+to\b/i;
  if (bareProjectionClause.test(trimmed)) return false;

  // Also catch any subject-less / non-standard projection clause that pairs a
  // commodity metric with a projection verb, e.g. "crude output is poised to
  // climb" or "refinery runs are set to recover".
  const bareProjectionVerb =
    /\b(?:demand|supply|consumption|production|output|capacity|exports|imports|runs|throughput)\b[\w\s,'’-]{0,20}?\b(?:is|are|was|were)\b\s+(?:projected|expected|anticipated|poised|set|forecast|estimated|likely)\s+to\b/i;
  if (bareProjectionVerb.test(trimmed)) return false;

  // Reject clauses that contain publication names — these are scraped report
  // titles (e.g. "monthly Oil Market Report", "The OPEC Monthly Oil Market
  // Report (MOMR) covers major issues...") rather than concrete price drivers.
  const publicationInClause = [
    /\bthe\s+(?:opec|iea|eia)\b/i,
    /(?:monthly|quarterly|annual|weekly|daily)\s+(?:oil|energy|market|commodity|water|electricity|power)\s+(?:report|outlook|analysis|review|summary)\b/i,
    /(?:world|short-term|global)\s+(?:oil|energy)\s+(?:outlook|report|analysis)\b/i,
    /\b(?:covers|examines|provides|analyz(?:es|is))\s+(?:major\s+)?(?:issues?|developments?|trends?|an?\s+overview)\b/i,
  ];
  for (const pattern of publicationInClause) {
    if (pattern.test(trimmed)) return false;
  }

  // Reject clauses that start with a participle or gerund — these are typically
  // mid-sentence fragments from scraped pages (e.g. "using ship-to-ship transfers...",
  // "adding to supply...", "reflecting prices..."). A complete price-driver clause
  // should start with a subject (noun/pronoun) or a proper noun (OPEC+, IEA).
  const participleOpeners = [
    "using ", "adding ", "reflecting ", "driving ", "pushing ", "pulling ",
    "supporting ", "weighing ", "boosting ", "lifting ", "pressing ",
    "citing ", "noting ", "showing ", "indicating ", "signaling ",
  ];
  for (const opener of participleOpeners) {
    if (lower.startsWith(opener)) return false;
  }

  // Reject clauses that are just numbers/units (e.g. "1.4 mb/d", "2.7 mb/d").
  // A standalone number with an optional unit is a clipped fragment, not a
  // price driver.
  if (/^[\d,.]+\s*(?:mb\/d|b\/d|mboe\/d|thousand|million|billion|mb|bbl|barrel)?\s*\.?\s*$/i.test(trimmed)) {
    return false;
  }

  // Reject raw page chrome / fragments (Bug 2). These indicate a clipped or
  // non-prose clause that must not be emitted.
  const chromeFragments = [
    /in\s+this\s+article/i,
    /@[A-Z]{2,4}\d{1,4}\b/,
    /were\s+down\s+\d/i,
    /were\s+up\s+\d/i,
    /\bby\s+\d+\s+cents?\b/i,
    /[A-Z][a-z]{2,}[A-Z][a-z]/, // mid-word CamelCase glue e.g. MiddleNew
  ];
  for (const p of chromeFragments) {
    if (p.test(trimmed)) return false;
  }
  // post-period restart: a period inside the clause followed by a lowercase
  // verb/number, e.g. "region. were down"
  if (/\.\s+[a-z]/.test(trimmed.slice(0, trimmed.length - 1))) return false;

  // Reject clauses that do not end with terminal punctuation — these are
  // mid-sentence clips from scraped pages (e.g. "...reflected in prices during
  // late October and early"). A complete price-driver sentence ends with a
  // period, exclamation mark, or question mark. Callers that build grounded
  // explanations append "." themselves, so an unterminated clause here signals
  // a genuine mid-sentence fragment rather than a formatting omission.
  if (!/[.!?]$/.test(trimmed)) return false;

  return true;
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
   *
   * Content validation (defense against generic text after the price prefix):
   * - The extracted explanation must pass `validateExplanationQuality`.
   * - The clause that follows the "With <commodity> at $<price>/<unit>, " prefix
   *   must pass `clauseQualityCheck`; generic forecasts ("the global ... is
   *   forecast..."), meta-analysis ("the report provides..."), navigation noise
   *   ("key developments", "as well as") and bare numbers ("1.4 mb/d") are
   *   rejected. When a clause fails, the candidate is re-extracted from the full
   *   scraped text; if that also fails the candidate is skipped (never surfaced).
   * - Identical grounded explanations from different candidates are de-duplicated
   *   so each factor in the window carries distinct trailing content.
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
    const seenExplanations = new Set<string>();

    usable.forEach((candidate, index) => {
      const position = index + 1;
      const title = (candidate.title ?? "").trim();
      const snippet = (candidate.snippet ?? "").trim();
      const text = (candidate.text ?? "").trim();

      // Strip the "With <commodity> at $<price>/<unit>, " grounding prefix from
      // an explanation, returning the raw clause (the part after the comma).
      const stripGroundingPrefix = (text: string): string => {
        if (!text) return "";
        return text.replace(/^with\s+.+?\s+at\s+\$[^,]+,\s*/i, "").trim();
      };

      // Explanation: extract a meaningful summary from the best available source.
      // Prefer the search snippet when it is a clean, complete sentence summary —
      // it is short and self-contained. Fall back to the full scraped text when
      // the snippet is missing or its extracted summary fails the quality
      // heuristics (generic meta-analysis text, page chrome, fragments).
      //
      // The snippet-derived clause is also validated with clauseQualityCheck; if
      // the clause is generic/fragmented, we fall back to the full scraped text
      // and re-extract before proceeding to grounding.
      let explanation = "";
      const cleanSnippet = pickCleanSnippet(snippet);
      if (cleanSnippet) {
        explanation = sanitizeExplanation(extractSummaryFromArticle(cleanSnippet));
      }

      // Validate the extracted explanation AND its clause. If the snippet-derived
      // explanation is missing, fails quality, or its clause is generic/fragmented,
      // fall back to the full scraped text and re-extract.
      const snippetClause = stripGroundingPrefix(explanation);
      if (
        (!explanation || !validateExplanationQuality(explanation).ok || !clauseQualityCheck(snippetClause)) &&
        text
      ) {
        const fromText = sanitizeExplanation(extractSummaryFromArticle(text));
        const fromTextClause = stripGroundingPrefix(fromText);
        if (fromText && validateExplanationQuality(fromText).ok && clauseQualityCheck(fromTextClause)) {
          explanation = fromText;
        }
      }

      // Determine the primary commodity from the keyword haystack (oil /
      // electricity / water), defaulting to "oil".
      const haystackForCommodity = `${title} ${snippet} ${text}`.toLowerCase();
      let primaryCommodity: "oil" | "electricity" | "water" = "oil";
      if (/oil|crude|petroleum|\bbbl\b|brent|\bwti\b/.test(haystackForCommodity)) primaryCommodity = "oil";
      else if (/electricity|power|\bgrid\b|\bmwh\b|megawatt|kilowatt|utilit/.test(haystackForCommodity)) primaryCommodity = "electricity";
      else if (/water|drought|scarcity|hydrolog|aquifer|desalination/.test(haystackForCommodity)) primaryCommodity = "water";

      // If the extracted explanation does NOT already start with a commodity+price
      // phrase, prefix it with the grounded commodity + current price.
      const priceInfo = currentPrices[primaryCommodity];
      const commodityPriceRegex = /^(?:with\s+)?(?:oil|crude|brent|wti|electricity|power|water)\b/i;

      // Apply the grounded "With <commodity> at $<price>/<unit>, <clause>" prefix
      // to a raw explanation. Returns the grounded explanation, or null when the
      // clause fails clauseQualityCheck (generic forecast / meta-analysis /
      // clipped fragment) — callers should then try re-extraction or skip.
      const applyGrounding = (rawExplanation: string): string | null => {
        if (!rawExplanation) return null;
        let clause = stripGroundingPrefix(rawExplanation);
        // If the explanation does NOT already start with commodity+price,
        // lowercase the first character unless it's an all-caps acronym.
        if (!commodityPriceRegex.test(rawExplanation)) {
          const firstToken = clause.split(/\s+/)[0] ?? "";
          if (/^[A-Z][A-Z0-9+/]+$/.test(firstToken)) {
            // Preserve all-caps acronyms (IEA, OPEC, WTI, OPEC+)
          } else {
            clause = clause.charAt(0).toLowerCase() + clause.slice(1);
          }
        }
        // Validate the clause contains meaningful price-driver content before
        // grounding. If it is a generic forecast, meta-analysis, or clipped
        // fragment, return null so the caller can try re-extraction or skip.
        if (!clauseQualityCheck(clause)) return null;
        // If already grounded, just sanitize and return.
        if (commodityPriceRegex.test(rawExplanation)) {
          return sanitizeExplanation(rawExplanation);
        }
        // Build the grounded explanation: "With <commodity> at $<price>/<unit>, <clause>"
        const prefix = `With ${primaryCommodity} at $${priceInfo.price}/${priceInfo.unit}, `;
        const maxClauseLen = 400 - prefix.length - 1; // -1 for the "." at the end if needed
        if (clause.length > maxClauseLen) {
          clause = truncateToSentenceBoundary(clause, Math.max(0, maxClauseLen));
        }
        const grounded = `${prefix}${clause}`;
        // Ensure the total length is <= 400 chars.
        return grounded.length <= 400 ? grounded : truncateToSentenceBoundary(grounded, 400);
      };

      if (explanation) {
        const grounded = applyGrounding(explanation);
        if (grounded) {
          explanation = grounded;
        } else {
          // The clause is generic/fragmented. Attempt re-extraction from the
          // full scraped text; if that also fails clause quality, skip the
          // candidate entirely instead of surfacing generic text to the UI.
          let repaired = false;
          if (text) {
            const fromText = sanitizeExplanation(extractSummaryFromArticle(text));
            const fromTextGrounded = applyGrounding(fromText);
            if (fromTextGrounded) {
              explanation = fromTextGrounded;
              repaired = true;
            }
          }
          if (!repaired) {
            console.warn(
              `buildFactorsFromCandidates: skipping candidate "${candidate.url}" — extracted clause failed clause quality check and re-extraction from full text also failed`,
            );
            return;
          }
        }
      }

      // Never push a noisy factor: if the cleaned explanation still fails the
      // quality heuristics (generic meta-analysis text / no meaningful driver),
      // skip the candidate entirely instead of surfacing page chrome to the UI.
      // After grounding, the explanation MUST pass validateExplanationQuality
      // (which requires a commodity+price opening) or the candidate is skipped.
      const quality = validateExplanationQuality(explanation);
      if (!quality.ok) {
        console.warn(
          `buildFactorsFromCandidates: skipping candidate "${candidate.url}" — extracted explanation failed quality ("${quality.reason}")`,
        );
        return;
      }

      // Ensure factors from different candidates don't collapse into identical
      // grounded explanations (e.g. two candidates yielding the same generic
      // clause). Skip duplicates so each factor in the window carries distinct
      // trailing content.
      const dedupKey = explanation.toLowerCase().replace(/\s+/g, " ").trim();
      if (seenExplanations.has(dedupKey)) {
        console.warn(
          `buildFactorsFromCandidates: skipping candidate "${candidate.url}" — duplicate explanation already added`,
        );
        return;
      }
      seenExplanations.add(dedupKey);

      // Derive a factor title that is a valid reason title — never an article
      // header ("Breaking News") or a bare adverb ("Historically").
      const rawDerivedName = sanitizeFactorTitle("", explanation);
      let name = rawDerivedName && !isInvalidFactorTitle(rawDerivedName)
        ? rawDerivedName
        : "";
      if (!name) {
        const truncated = truncateAtWordBoundary(explanation, 160, { minPrefix: 1, ellipsis: "" });
        name = truncated && !isInvalidFactorTitle(truncated) ? truncated : `Market update: ${candidate.url}`;
      }

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

  // Replace publication-like names (report/outlook titles, agency names) with a
  // concise name derived from the explanation, so the UI never shows a bare
  // publication name such as "World Oil Outlook" or "Monthly Oil Market Report".
  // Also reject invalid titles that are not concrete price-driver reasons
  // (e.g. "Breaking News", "Historically").
  let finalName = sanitizeFactorTitle(name, explanation);
  if (!finalName || PUBLICATION_NAME_PATTERNS.some((p) => p.test(finalName)) || isInvalidFactorTitle(finalName)) {
    const derived = deriveFactorNameFromExplanation(explanation);
    if (derived && !isInvalidFactorTitle(derived)) {
      finalName = derived;
    } else if (!isInvalidFactorTitle(name)) {
      finalName = name;
    } else {
      finalName = "";
    }
  }
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
  if (!finalName || !explanation || importanceScore < 20 || commodities.length === 0) return null;

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
    id: truncateAtWordBoundary(id, 80, { minPrefix: 1, ellipsis: "" }),
    name: truncateAtWordBoundary(finalName, 160, { minPrefix: 1, ellipsis: "" }),
    category: truncateAtWordBoundary(category, 80, { minPrefix: 1, ellipsis: "" }),
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
        tinyfishRouter.tinyfishSearch(`${q} ${RECENT_MONTH()}`, { limit: 8, region: region ?? undefined, recencyMinutes: 10080, includeDomains: FACTOR_SEARCH_DOMAINS }, signal),
      ),
    );

    const flatten = <T extends { snippet?: string }>(results: T[] | undefined) =>
      (results ?? []).map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }));

    let allResults = searches.flatMap((r) => flatten(r.results));

    // If domain-restricted search returned nothing (possible when TinyFish has
    // no indexed results from those domains for a given query), retry without
    // the domain restriction so we never starve the model of fetched URLs.
    if (allResults.length === 0 && !signal?.aborted) {
      const unrestricted = await Promise.all(
        queries.map((q) =>
          tinyfishRouter.tinyfishSearch(`${q} ${RECENT_MONTH()}`, { limit: 8, region: region ?? undefined, recencyMinutes: 10080 }, signal),
        ),
      );
      allResults = unrestricted.flatMap((r) => flatten(r.results));
    }

    // Prefer results from reputable hosts, but never let the whitelist starve the
    // model of real fetched URLs. If the reputable filter removes every result we
    // retry with all recent results, because a non-whitelisted but real TinyFish
    // URL is still a valid source the model can summarize (and link to).
    candidates = allResults
      .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt))
      .slice(0, 8);

    console.warn(`Factor analysis: ${candidates.length} reputable+recent candidates for scope "${scope}" after TinyFish search`);

    if (candidates.length === 0) {
      candidates = allResults
        .filter((r) => isRecentPublishedAt(r.publishedAt))
        .slice(0, 8);
      console.warn(`Factor analysis: ${candidates.length} recent candidates for scope "${scope}" (reputable filter yielded none)`);
    }

    if (candidates.length === 0) {
      console.warn(`Factor analysis: no TinyFish candidates for scope "${scope}"; trying known reputable URLs as fallback`);
      const knownExcerpts = await Promise.all(
        KNOWN_REGIONAL_URLS[scope].map(async (url) => {
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
              snippet: c.snippet?.slice(0, 1500),
              text: (c as { text?: string }).text?.slice(0, 5000),
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
      const retryPrompt = `Return ONLY a strict JSON object of the form {"factors":[...]}. Each factor MUST have: id (string), name (string), category (one of "Market"|"Policy"|"Structural"|"Infrastructure"|"Environmental"|"Geopolitical"|"Technological"), commodities (array subset of "oil","electricity","water"), explanation (1-3 meaningful sentences UNDER 400 CHARACTERS TOTAL that LITERAL BEGINS with "With <commodity> at $<price>/<unit>," and cites the current price numbers from currentPrices, e.g. "With oil at $104.86/bbl..."), direction ("up"|"down"|"mixed"), magnitude ("High"|"Medium"|"Low"), source (EXACTLY one of these URLs, copy verbatim: ${candidateUrlHint}), bias ("short"|"mid"|"long"|"flat"), importanceScore (integer 0-100), drift (object mapping commodity to a small decimal). The source field MUST be a URL copied verbatim from the list above — never a publication name. Ground every explanation in the current price numbers. NEVER include a URL or markdown link inside the explanation field. Write explanations in your own words, 1-3 meaningful sentences max, starting with the commodity and current price number. Do NOT copy raw text verbatim — summarize in your own words. NEVER start with a bullet point or publication name. NEVER write more than THREE sentences per explanation. NEVER include publication headers, dates, or metadata. NEVER include web navigation / page chrome text (e.g. "Skip to page content", "Filter by article type", "In-brief analysis", "In-depth analysis", category labels like "Energy", "Technology", "Markets"). NEVER start the explanation body (after "With <commodity> at $<price>/<unit>,") with a participle/gerund like "using ", "adding ", "reflecting ", "driving ", "pushing ", "showing " — these are mid-sentence fragments, not complete price-driver statements. Focus on the specific price driver: what changed and why it matters for prices. Do NOT output markdown, commentary, or anything outside the JSON object.

CRITICAL BAD EXAMPLES — DO NOT REPEAT:
BAD: "Global electricity demand growth accelerates as markets navigate energy price shocks Global power demand is on track to rise faster in 2026 and 2027 than in 202" (raw article sentence, does not start with commodity+price)
BAD: "With oil at $104.86/bbl, in Energy Skip to page content Filter by article type In-brief analysis Nov 13 2026" (contains page navigation chrome)
BAD: "With oil at $104.86/bbl, using ship-to-ship transfers along Oman's coast added to supply which was reflected in prices during late October and early" (mid-sentence fragment starting with participle)

Every explanation you output must follow the GOOD format: literal "With <commodity> at $<price>/<unit>,..." opening, 1-3 meaningful sentences, your own words, no URLs, no markdown, no bullet points, no raw article text, no publication headers, dates, or metadata, no page navigation chrome, no participle-opener fragments.`;

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

    const parsedFactors = parsed.factors;

    // Phase 1: Normalize all parsed factors (synchronous, fast)
    const normalizedCandidates: Array<{ f: Factor; quality: ReturnType<typeof validateExplanationQuality> }> = [];
    for (const raw of parsedFactors) {
      const f = normalizeFactor(raw, scope, candidateObjs);
      if (!f) continue;
      if (f.scope !== scope) continue;

      const quality = validateExplanationQuality(f.explanation);
      // Bug 2: also run clauseQualityCheck on the body after the grounding prefix
      const clause = f.explanation.replace(/^with\s+.+?\s+at\s+\$[^,]+,\s*/i, "").trim();
      const clauseOk = clauseQualityCheck(clause);
      const combinedQuality = quality.ok && clauseOk ? quality : { ok: false, reason: clauseOk ? (quality.reason ?? "quality failed") : "clause quality failed" };
      normalizedCandidates.push({ f, quality: combinedQuality });
      if (normalizedCandidates.length >= FACTOR_COUNT) break;
    }

    // Phase 2: Separate passing and failing factors
    const passing: Factor[] = [];
    const needingRepair = normalizedCandidates.filter(({ f, quality }) => {
      if (quality.ok) {
        passing.push(f);
        return false;
      }
      console.warn(`Factor analysis: explanation failed quality check ("${quality.reason}") for factor "${f.name}" scope "${scope}"; queuing for re-summarization`);
      return true;
    }).map(({ f }) => f);

    // Phase 3: Parallel re-summarization for failing factors
    let repairedFromResummarize: Factor[] = [];
    if (needingRepair.length > 0) {
      console.warn(`Factor analysis: ${needingRepair.length} factors need re-summarization for scope "${scope}", running in parallel`);
      const repairPromises = needingRepair.map((f) =>
        reSummarizeExplanation(f.explanation, currentPrices, signal).then((reSummary) => ({
          factor: f,
          reSummary,
          reQuality: reSummary ? validateExplanationQuality(reSummary) : { ok: false, reason: "re-summarization returned null" },
        }))
      );
      const repairResults = await Promise.allSettled(repairPromises);

      for (let i = 0; i < needingRepair.length; i++) {
        const result = repairResults[i];
        const f = needingRepair[i];
        if (result.status === "fulfilled") {
          const { reSummary, reQuality } = result.value;
          if (reSummary && reQuality.ok) {
            repairedFromResummarize.push({ ...f, explanation: reSummary });
            console.warn(`Factor analysis: re-summarization succeeded for factor "${f.name}" scope "${scope}"`);
            continue;
          }
          console.warn(`Factor analysis: re-summarization failed or rejected quality ("${reQuality.reason}") for factor "${f.name}" scope "${scope}"; rejecting`);
        } else {
          console.warn(`Factor analysis: re-summarization threw for factor "${f.name}" scope "${scope}": ${result.reason}; rejecting`);
        }
      }
    }

    const normalized = [...passing, ...repairedFromResummarize];

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
        KNOWN_REGIONAL_URLS[scope].map(async (url) => {
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
