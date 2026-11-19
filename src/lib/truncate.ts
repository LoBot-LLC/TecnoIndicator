/**
 * Truncate text at a sentence boundary when it exceeds `maxChars`.
 *
 * - If the text is short enough, it is returned unchanged.
 * - Otherwise we look for the last sentence-ending punctuation (`.`, `!`, `?`)
 *   at or before `maxChars`. If found, the cut happens right after that punctuation
 *   and a single ellipsis "…" is appended.
 * - If no sentence boundary exists within the limit, we fall back to the last
 *   whitespace (word boundary) before `maxChars`.
 * - The result never ends on a comma, colon, semicolon, or mid-word.
 */
export function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const candidate = text.slice(0, maxChars);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("!"),
    candidate.lastIndexOf("?"),
  );

  if (sentenceEnd > 0) {
    return candidate.slice(0, sentenceEnd + 1) + "…";
  }

  const lastSpace = candidate.lastIndexOf(" ");
  if (lastSpace > 0) {
    return candidate.slice(0, lastSpace) + "…";
  }

  return candidate + "…";
}