import { isRegion, type Region } from "./regions";

/** Preferred factor category used when a model returns an unknown label. */
export const DEFAULT_CATEGORY = "Market";

export function safeParseJson<T = unknown>(text: string): T | null {
  if (!text || typeof text !== "string") return null;

  // Try direct parse first.
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall through to fence-stripping / extraction below.
  }

  // Strip markdown code fences (```json ... ``` or ``` ... ```).
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // Fall through.
    }
  }

  // Try to extract the first JSON object from the text.
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]) as T;
    } catch {
      // Fall through.
    }
  }

  // Try to extract the first JSON array from the text.
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]) as T;
    } catch {
      // Fall through.
    }
  }

  return null;
}

export function sanitizeError(message: string): string {
  return message.replace(/\n\s*\n/g, " ").slice(0, 500);
}

/**
 * Tolerant category resolution.
 *
 * The previous implementation threw for any category outside `VALID_CATEGORIES`,
 * which meant an otherwise valid AI response using a label such as "Supply",
 * "Demand", "Transition" or "Climate" (all of which the frontend's static
 * factors use) aborted the whole request and silently fell back to static data.
 * Unknown labels now map to the fallback category, which keeps the preferred set
 * as a ranking hint without letting a label mismatch destroy a curation.
 */
export function coerceCategory(
  value: unknown,
  validCategories: readonly string[],
  fallback: string = DEFAULT_CATEGORY,
): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const match = validCategories.find(
    (category) => category.toLowerCase() === trimmed.toLowerCase(),
  );
  return match ?? fallback;
}

export function validateRegionParam(
  searchParams: { get: (key: string) => string | null },
): { ok: true; region: Region } | { ok: false; error: string } {
  const region = searchParams.get("region");
  if (region === null || region === undefined || region === "") {
    return { ok: false, error: "Missing 'region' query parameter" };
  }
  if (!isRegion(region)) {
    return { ok: false, error: `Invalid region: ${region}. Must be one of: asia, europe, africa, americas, oceania` };
  }
  return { ok: true, region };
}
