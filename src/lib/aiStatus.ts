/**
 * Shared client-side view of the curation contract implemented server-side in
 * lib/api/handlers/{dynamic-factors,regional-factors,solutions}.ts.
 *
 * The API now reports honestly whether a body is the product of a successful
 * AI run, so the UI can distinguish live curation from the static reference
 * set instead of presenting the fallback text as model output.
 */
import type { Factor } from "./model";

/** Where the factors/solutions in a response body came from. */
export type ServedFrom = "cache" | "curated" | "fallback";

/**
 * The honesty fields every /api/dynamic-factors, /api/regional-factors and
 * /api/solutions body carries. Kept optional at the call sites so a failed or
 * never-answered request simply reads as "unknown" rather than "AI".
 */
export interface PayloadMeta {
  /** True only when every item in the body was model-generated. */
  aiCurated?: boolean;
  /** True when the body is NOT the product of a successful AI run. */
  degraded?: boolean;
  /** Machine-readable degradation reason, present only when `degraded`. */
  reason?: string;
  servedFrom?: ServedFrom;
  updatedAt?: string;
  error?: string;
  /** /api/solutions only: how many of the returned items are model-generated. */
  aiCount?: number;
}

const REASON_TEXT: Record<string, string> = {
  "no-evidence": "no reputable sources returned by the news search",
  // A search that was cut short by the request's time budget, as opposed to one
  // that ran and genuinely found nothing (`no-evidence`).
  "search-aborted": "the news search ran out of time",
  "kilo-unavailable": "the AI gateway key is not usable",
  "kilo-aborted": "the request timed out",
  "unparseable-json": "the AI response could not be parsed",
  "normalized-empty": "the AI response contained no usable reasons",
  threw: "an unexpected error occurred",
  // Emitted by /api/solutions rather than the factor pipeline.
  "no-ai-solutions": "the AI returned no usable solutions",
};

const UNKNOWN_REASON = "the curation pipeline reported an unknown failure";

/** Plain-language rendering of a machine-readable `reason` code. */
export function describeReason(reason?: string): string {
  if (!reason) return UNKNOWN_REASON;
  return REASON_TEXT[reason] ?? UNKNOWN_REASON;
}

/**
 * True when this particular factor is model output.
 *
 * The server stamps `provenance: "ai"` on curated factors and
 * `provenance: "static"` on fallbacks; hand-authored client factors have no
 * provenance at all and are therefore never treated as AI content.
 */
export function isAiFactor(factor: Factor): boolean {
  return factor.provenance === "ai";
}

/**
 * True when the whole payload may be presented as live AI curation: the
 * server says so, and it did not flag the run as degraded.
 */
export function isLiveCuration(meta?: PayloadMeta): boolean {
  return meta?.aiCurated === true && meta?.degraded !== true;
}

/**
 * True when a factor row may carry AI-only decorations (the "New" badge and
 * the impact score). Both are suppressed unless the row itself is model
 * output and the payload it came from was not degraded.
 */
export function allowsAiDecorations(factor: Factor, meta?: PayloadMeta): boolean {
  return isAiFactor(factor) && meta?.degraded !== true;
}
