/**
 * Lightweight, dependency-free evidence summarization helpers.
 *
 * These are used by the evidence-based fallback paths (the ones taken when the
 * Kilo Gateway AI is unavailable). They replace the previous behaviour of
 * dumping raw article titles / multi-kilobyte text blocks into factor and
 * solution fields, which produced "scrambled" — uncurated, markup-heavy —
 * output. The helpers extract a single concise, commodity-relevant sentence,
 * clean headlines, and infer a sensible category so the fallback still reads as
 * intentionally curated research rather than raw scraped text.
 */
import type { CommodityId } from "./types";

/**
 * Truncate a sentence to `max` characters, breaking on a word boundary so we
 * never surface a half-cut word.
 */
export function truncateSentence(sentence: string, max = 280): string {
  if (sentence.length <= max) return sentence;
  return sentence.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, "").trimEnd() + "...";
}

/**
 * Strip HTML/script/style markup and collapse whitespace from scraped article
 * text so it reads as normal prose.
 */
export function stripHtmlCollapse(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split text into sentences using common terminator punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/^[\s.,;:-]+/, ""))
    .filter((s) => s.length > 0);
}

/** Per-commodity keyword pattern shared by the evidence summarizers. */
export const COMMODITY_PATTERNS: Record<CommodityId, RegExp> = {
  oil: /\b(oil|crude|opec|gasoline|diesel|lng|shale|petroleum)\b/i,
  electricity: /\b(electricity|electric|power|grid|renewable|wind|solar|generation|wholesale)\b/i,
  water: /\b(water|drought|scarcity|desalination|reservoir|hydro|utility|tariff|irrigation|groundwater)\b/i,
};

/**
 * Pick the single most relevant sentence from an article body (falling back to
 * the snippet) to use as a factor/solution explanation. Preference order:
 *   1. sentences that mention the commodity keyword,
 *   2. sentences of a reasonable length (10–34 words),
 *   3. earlier sentences (headline context),
 * with verbose sentences penalised.
 */
export function summarizeEvidenceSentence(
  text: string | undefined,
  snippet: string | undefined,
  pattern?: RegExp,
): string {
  const raw = (text ?? snippet ?? "").trim();
  if (!raw) return "No detailed evidence available for this factor.";

  const stripped = stripHtmlCollapse(raw);
  if (!stripped) return "No readable evidence available for this factor.";

  const sentences = splitSentences(stripped);
  if (sentences.length === 0) return truncateSentence(stripped, 280);

  let best = sentences[0];
  let bestScore = -1;
  sentences.forEach((s, i) => {
    const words = s.split(/\s+/).length;
    let score = 0;
    if (pattern && pattern.test(s)) score += 4; // commodity-relevant
    if (words >= 10 && words <= 34) score += 2; // reasonable length
    if (s.length > 420) score -= 1; // avoid verbose sentences
    score += Math.max(0, 0.6 - i * 0.06); // mild preference for earlier context
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  });

  return truncateSentence(best, 280);
}

/**
 * Clean a raw news headline into a tidy factor name: strip trailing outlet
 * suffixes and source tags, collapse whitespace, and cap length.
 */
export function summarizeFactorName(
  title: string | undefined,
  snippet: string | undefined,
  commodity?: CommodityId,
): string {
  let raw = (title ?? snippet ?? "").trim();
  if (!raw) return commodity ? `${commodity} market factor` : "Market factor";

  raw = raw
    .replace(
      /\s*[-|]\s*(Reuters|Associated Press|AP|Bloomberg|AFP|CNBC|BBC|WSJ|MarketWatch|Nikkei|Yahoo Finance)\s*$/i,
      "",
    )
    .replace(/\s*\[[^\]]+\]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (raw.length > 100) raw = raw.slice(0, 97).replace(/\s+\S*$/, "").trimEnd() + "...";
  if (!raw) return commodity ? `${commodity} market factor` : "Market factor";

  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Best-effort hostname extraction that never throws on a bad URL. */
export function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web news source";
  }
}

const CATEGORY_KEYWORDS: Record<string, RegExp> = {
  Policy: /\b(policy|sanction|regulat|subsidy|tax|tariff|government|fed|ecb|central bank|legislation|parliament|ministry)\b/i,
  Geopolitical: /\b(war|conflict|diplomacy|embargo|supply route|houthi|red sea|geopolit|strategic reserve)\b/i,
  Environmental: /\b(drought|climate|carbon|emission|renewable|clean energy|weather|extreme|environment)\b/i,
  Structural: /\b(capacity|infrastructure|investment|transition|decarbon|deficit|surplus|production cut|deal|agreement)\b/i,
  Infrastructure: /\b(grid|pipeline|terminal|port|refinery|plant|facility|storage|transmission)\b/i,
  Technological: /\b(technology|innovation|battery|artificial intelligence|\bAI\b|digital|software)\b/i,
};

/**
 * Very light keyword-based category inference so evidence factors carry variety
 * instead of every one defaulting to "Market".
 */
export function inferCategory(text: string): string {
  for (const [cat, pat] of Object.entries(CATEGORY_KEYWORDS)) {
    if (pat.test(text)) return cat;
  }
  return "Market";
}
