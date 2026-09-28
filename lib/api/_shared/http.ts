export { REGIONS, REGION_LABELS, REGION_NAMES, isRegion, isCommodity } from "./regions";
export type { Region } from "./regions";
export type { RegionId } from "./types";

import type { RegionId } from "./types";

export const KILO_GATEWAY_BASE_URL = "https://api.kilo.ai/api/gateway";
export const KILO_GATEWAY_MODELS_URL = `${KILO_GATEWAY_BASE_URL}/models`;
export const KILO_GATEWAY_CHAT_URL = `${KILO_GATEWAY_BASE_URL}/chat/completions`;
export const DEFAULT_KILO_MODEL_ID = "kilo-auto/free";

export const KILO_KEY_ENV_NAMES = [
  "KILO_GATEWAY_KEY_1",
  "KILO_GATEWAY_KEY_2",
  "KILO_GATEWAY_KEY_3",
  "KILO_GATEWAY_KEY_4",
  "KILO_GATEWAY_KEY_5",
  "KILO_GATEWAY_KEY",
] as const;

export const TINYFISH_KEY_ENV_NAMES = [
  "TINYFISH_KEY_1",
  "TINYFISH_KEY_2",
  "TINYFISH_KEY_3",
  "TINYFISH_KEY_4",
  "TINYFISH_KEY_5",
] as const;

export const FACTOR_COUNT = 8;
export const ANALYTICS_CACHE_MS = 60_000;
/** How long a freshly curated factor window counts as "fresh" for request-level short-circuiting. */
export const FACTORS_CACHE_MS = 60_000;
/**
 * How long the curated factor window itself is retained. The window has to
 * outlive `FACTORS_CACHE_MS`, otherwise the rolling "newest 8 reasons" would be
 * thrown away between cron runs and the oldest reason could never be evicted.
 */
export const FACTORS_WINDOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SEARCH_CACHE_MS = 60_000;
/** Read AND write TTL for scraped article bodies — they must agree. */
export const SCRAPE_CACHE_MS = 10 * 60_000;
export const MODEL_CACHE_MS = 60_000;
export const ACCESS_PROBE_CACHE_MS = 5 * 60_000;
export const FORECAST_CACHE_MS = 5 * 60_000;
export const SOLUTIONS_CACHE_MS = 60_000;
export const MAX_SOLUTIONS = 3;
export const GLOBAL_RATE_LIMIT_BACKOFF_MS = [1000, 2000, 4000];

/**
 * The single canonical cache key for curated price factors.
 *
 * Every producer (global route, regional route, cron) and every consumer
 * (solutions, forecasts) uses this scheme, so the reasons the UI shows are
 * exactly the reasons the solutions are generated from. `scope` is "global" or
 * a region id.
 */
export function factorCacheKey(scope: RegionId): string {
  return `dynamic-factors:${scope}`;
}

/** Canonical cache key for the analytics snapshot of a scope. */
export function analyticsCacheKey(scope: RegionId): string {
  return scope === "global" ? "analytics:global" : `analytics:regional:${scope}`;
}

export interface ConfiguredKey {
  envName: string;
  value: string;
}

// base64url of {"alg":"HS256","typ":"JWT"} - the Kilo Gateway key header segment.
export const KILO_GATEWAY_JWT_PREFIX = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

/**
 * Normalizes a raw environment-variable API key.
 * Env values pasted into dashboards frequently carry a trailing newline, wrapping
 * quotes, or zero-width characters. Those survive the "non-empty" check but make the
 * outgoing `Authorization: Bearer ...` header invalid, so the gateway answers 401.
 */
export function normalizeApiKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  // Strip zero-width / BOM characters, then any remaining whitespace.
  return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, "");
}

/** True when the key is a JWT: the known HS256 header prefix plus 2 more segments. */
export function isJwtApiKey(value: unknown): boolean {
  const key = normalizeApiKey(value);
  if (!key.startsWith(KILO_GATEWAY_JWT_PREFIX)) return false;
  return key.split(".").length === 3;
}

/** True for the legacy opaque `sk-`/`sk_` key form. */
export function isOpaqueApiKey(value: unknown): boolean {
  return /^sk[-_][A-Za-z0-9._-]{8,}$/.test(normalizeApiKey(value));
}

/**
 * Recognized = a key shape we know the gateway issues. Used for diagnostics and
 * optional filtering; it is deliberately NOT a hard gate, so an unknown future key
 * format still works.
 */
export function isRecognizedKiloGatewayKeyFormat(value: unknown): boolean {
  return isJwtApiKey(value) || isOpaqueApiKey(value);
}

/** Detects unfilled template values so they are not reported as "configured". */
export function isPlaceholderApiKey(value: unknown): boolean {
  const key = normalizeApiKey(value).toLowerCase();
  if (!key) return true;
  return (
    /^your[-_ ]?(api[-_ ]?)?key/.test(key) ||
    /^<.*>$/.test(key) ||
    /^\$\{.*\}$/.test(key) ||
    /^\{\{.*\}\}$/.test(key) ||
    /^(xxx+|changeme|change[-_]?me|placeholder|todo|replace[-_ ]?me|unset|none|null)$/.test(key)
  );
}

export interface ReadConfiguredKeysOptions {
  /** Return false to reject a candidate key. Omit to accept any non-placeholder key. */
  validator?: (normalizedValue: string) => boolean;
  /** When true, only keys with a recognized format are returned. Defaults to false. */
  requireRecognizedFormat?: boolean;
}

export function readConfiguredKeys(
  envNames: readonly string[],
  options: ReadConfiguredKeysOptions = {},
): ConfiguredKey[] {
  const keys: ConfiguredKey[] = [];
  // The same key may be set under several env names (for example both the bare
  // KILO_GATEWAY_KEY and a numbered KILO_GATEWAY_KEY_N alias). Track the values
  // already accepted so one credential never produces two key states, which would
  // otherwise double-count `configuredKeys` and duplicate probe work.
  const seenValues = new Set<string>();
  for (const envName of envNames) {
    const value = normalizeApiKey(process.env[envName]);
    if (!value) continue;
    if (isPlaceholderApiKey(value)) continue;
    if (seenValues.has(value)) continue;
    if (options.requireRecognizedFormat && !isRecognizedKiloGatewayKeyFormat(value)) continue;
    if (options.validator && !options.validator(value)) continue;
    seenValues.add(value);
    keys.push({ envName, value });
  }
  return keys;
}

export function parsePositiveNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

export function parseBooleanFlag(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function sanitizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isGlobalRateLimitStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 504;
}

export function isAccessDeniedStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export const REPUTABLE_HOSTS = [
  "opec.org",
  "iea.org",
  "eia.gov",
  "worldbank.org",
  "un.org",
  "unep.org",
  "wri.org",
  "wrm.org",
  "oecd.org",
  "imf.org",
  "reuters.com",
  "apnews.com",
  "ft.com",
  "bloomberg.com",
  "energy.gov",
  "eurostat.europa.eu",
  "afdb.org",
  "adb.org",
  "asean.org",
  "europa.eu",
  "gov.au",
  "govt.nz",
  "gov.za",
  "gov.ng",
  "gov.in",
  "gov.cn",
  "gov.br",
  "gov.mx",
  "gov.ar",
  "gov.eg",
  "gov.ae",
  "gov.sa",
  "gov.qa",
  "gov.tr",
  "gov.id",
  "gov.my",
  "gov.ph",
  "gov.vn",
  "ieeewrc.org",
  "irena.org",
  "cdn.irena.org",
  "globalpetrolprices.com",
  "waterplaza.nl",
  "waterworld.com",
  "wateronline.com",
  "energyinst.org",
  "enerdata.net",
  "platts.com",
  "gulfnews.com",
  "thenationalnews.com",
  "thegazette.co.jm",
  "businessday.ng",
  "allafrica.com",
  "africanews.com",
  "screendaily.com",
];

export function isReputableSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return REPUTABLE_HOSTS.some((prefix) => host === prefix || host.endsWith(`.${prefix}`));
  } catch {
    return false;
  }
}

export function isRecentPublishedAt(value: string | undefined): boolean {
  if (!value) return true;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return true;
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  return date >= cutoff;
}