import { isRegion, type Region } from "./regions";

/** Preferred factor category used when a model returns an unknown label. */
export const DEFAULT_CATEGORY = "Market";

export function safeParseJson<T = unknown>(text: string): T | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;

  const direct = tryParse<T>(text);
  if (direct !== undefined) return direct;

  // Tolerate the common LLM failure mode of wrapping JSON in markdown code
  // fences (```json ... ```) or adding leading/trailing prose. Previously any
  // such wrapper made JSON.parse fail and silently fell back to static factors.
  const withoutFence = text
    .replace(/^\s*```(?:json|JSON)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  const fenced = tryParse<T>(withoutFence);
  if (fenced !== undefined) return fenced;

  const extracted = extractFirstJsonValue(withoutFence);
  if (extracted) {
    const parsed = tryParse<T>(extracted);
    if (parsed !== undefined) return parsed;
  }

  return null;
}

function tryParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Scans for the first balanced top-level JSON object (`{...}`) or array (`[...]`)
 * in a string, respecting string literals and escapes. Returns null if none is
 * found. Used to recover JSON from a model response that appends commentary.
 */
function extractFirstJsonValue(text: string): string | null {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  let open = "";
  let close = "";
  if (startObj === -1 && startArr === -1) return null;
  if (startObj !== -1 && (startArr === -1 || startObj < startArr)) {
    start = startObj;
    open = "{";
    close = "}";
  } else {
    start = startArr;
    open = "[";
    close = "]";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
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
