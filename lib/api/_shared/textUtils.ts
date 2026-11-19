/**
 * Shared text utilities for factor explanations and UI display.
 *
 * All truncation in the codebase must go through `truncateAtWordBoundary` so
 * no factor explanation ever cuts a word in half. The previous pattern of
 * `text.slice(0, MAX_CHARS) + "…"` produced broken fragments like
 * "...incomes and infl" and "...cost-competi" that look like extraction errors
 * rather than intentional truncation.
 */

/**
 * Truncates `text` to at most `maxChars` characters, cutting at the last word
 * boundary (space) before the limit. If no space exists within the first
 * `minPrefix` characters, falls back to a hard cut at `maxChars` (the word is
 * too long to fit). Always appends an ellipsis when truncation occurs.
 *
 * Examples:
 *   truncateAtWordBoundary("With electricity at $252/USD per MWh, affordability remains a concern, as household electricity prices in many countries have risen faster than incomes and infl", 400)
 *   → "With electricity at $252/USD per MWh, affordability remains a concern, as household electricity prices in many countries have risen faster than incomes…"
 *
 *   truncateAtWordBoundary("short text", 400) → "short text" (no truncation)
 */
export function truncateAtWordBoundary(
  text: string,
  maxChars: number,
  options: { minPrefix?: number; ellipsis?: string } = {},
): string {
  if (text.length <= maxChars) return text;

  const { minPrefix = 1, ellipsis = "…" } = options;
  const budget = maxChars - ellipsis.length;
  if (budget <= 0) return ellipsis;

  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(" ");

  // If there is a space after the minimum prefix, cut there so no word is split.
  if (lastSpace >= minPrefix) {
    return cut.slice(0, lastSpace).trim() + ellipsis;
  }

  // No space found — the first word is longer than the budget. Hard-cut at the
  // budget and append ellipsis so the result is at least consistent.
  return cut.trim() + ellipsis;
}

/**
 * Truncates text to `maxChars` at the nearest sentence boundary (., !, ?)
 * followed by a space or end-of-string. Falls back to `truncateAtWordBoundary`
 * when no sentence boundary exists. Preserves terminal punctuation when present.
 */
export function truncateAtSentenceBoundary(
  text: string,
  maxChars: number,
  options: { minPrefix?: number; ellipsis?: string } = {},
): string {
  if (text.length <= maxChars) return text;

  const { minPrefix = 1, ellipsis = "…" } = options;
  const budget = maxChars - ellipsis.length;
  if (budget <= 0) return ellipsis;

  const cut = text.slice(0, budget);
  const lastSentenceEnd = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("?"),
  );

  if (lastSentenceEnd >= minPrefix) {
    const result = cut.slice(0, lastSentenceEnd + 1).trim();
    // Already ends with terminal punctuation — no ellipsis needed.
    if (/[.!?…]$/.test(result)) return result;
    return result + ellipsis;
  }

  // No sentence boundary found — fall back to word-boundary truncation.
  return truncateAtWordBoundary(text, maxChars, options);
}