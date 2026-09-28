export { REGIONS, REGION_LABELS, REGION_NAMES, isRegion, isCommodity } from "./regions";
export type { Region } from "./regions";
export type { RegionId } from "./types";

import type { RegionId } from "./types";

export const KILO_GATEWAY_BASE_URL = "https://api.kilo.ai/api/gateway";
export const KILO_GATEWAY_MODELS_URL = `${KILO_GATEWAY_BASE_URL}/models`;
export const KILO_GATEWAY_CHAT_URL = `${KILO_GATEWAY_BASE_URL}/chat/completions`;
export const DEFAULT_KILO_MODEL_ID = "kilo-auto/free";

// `KILO_API_KEY` / `TINYFISH_API_KEY` are the names both vendors document in
// their own quickstarts. Only the suffixed names were read before, so a
// deployer who followed the docs configured a variable this code ignored and
// the pipeline saw zero keys. Specific/suffixed names come first; `readConfiguredKeys`
// dedupes by value, so a key set under two names is still used exactly once.
export const KILO_KEY_ENV_NAMES = [
  "KILO_GATEWAY_KEY_1",
  "KILO_GATEWAY_KEY_2",
  "KILO_GATEWAY_KEY_3",
  "KILO_GATEWAY_KEY_4",
  "KILO_GATEWAY_KEY_5",
  "KILO_GATEWAY_KEY",
  "KILO_API_KEY",
] as const;

export const TINYFISH_KEY_ENV_NAMES = [
  "TINYFISH_KEY_1",
  "TINYFISH_KEY_2",
  "TINYFISH_KEY_3",
  "TINYFISH_KEY_4",
  "TINYFISH_KEY_5",
  "TINYFISH_KEY",
  "TINYFISH_API_KEY",
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
/**
 * TTL for the `dynamic-factors:{scope}:status` diagnostics key only.
 *
 * It used to reuse {@link FACTORS_WINDOW_TTL_MS}, which pinned a single timed-out
 * run's `kilo-aborted` reason into /api/health for seven days. The curated
 * window's 7-day retention is a product requirement and is untouched; a run
 * STATUS is only interesting until the next attempt, so an hour is plenty.
 */
export const FACTOR_STATUS_TTL_MS = 60 * 60_000;
/**
 * 10 minutes, not 60s: the identical query was re-issued (and re-billed) every
 * minute by every request, which is exactly the vendor time the route budget
 * cannot afford.
 */
export const SEARCH_CACHE_MS = 10 * 60_000;
/** Longer-lived copy of the last good search result, used only when a search fails. */
export const STALE_SEARCH_CACHE_MS = 60 * 60 * 1000;
/** Read AND write TTL for scraped article bodies — they must agree. */
export const SCRAPE_CACHE_MS = 10 * 60_000;
/**
 * 30 minutes. The catalog is a ~481KB payload; re-downloading it twice a minute
 * burned both bandwidth and several seconds of a cold request's budget.
 */
export const MODEL_CACHE_MS = 30 * 60_000;
export const ACCESS_PROBE_CACHE_MS = 5 * 60_000;
export const FORECAST_CACHE_MS = 5 * 60_000;
export const SOLUTIONS_CACHE_MS = 60_000;
export const MAX_SOLUTIONS = 3;

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
 *
 * Env values pasted into dashboards frequently carry a trailing newline, wrapping
 * quotes, zero-width characters, or a leftover `Bearer ` / `Token ` scheme
 * prefix copied out of an example `curl` command. Those survive the
 * "non-empty" check but make the outgoing `Authorization: Bearer ...` header
 * invalid (`Bearer Bearer eyJ...` -> 401), so the scheme prefix is stripped here.
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
  // Strip a pasted auth scheme; the header builder adds the prefix itself.
  value = value.replace(/^(bearer|token)\s+/i, "").trim();
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

/**
 * True only for a genuine *global* rate limit (429).
 *
 * 503/504 used to be folded in here, which made the Kilo router latch every
 * key and every model as `rateLimited` on the first upstream hiccup. Upstream
 * 503 means "provider temporarily unavailable" (the gateway even remaps an
 * upstream 402 to 503), so it is handled by {@link isRetryableUpstreamStatus}
 * and retried per key/model combination instead.
 */
export function isGlobalRateLimitStatus(status: number): boolean {
  return status === 429;
}

/**
 * Transient upstream failures: worth retrying against a different key/model
 * (and honouring `Retry-After`), but never a verdict on the credential.
 */
export function isRetryableUpstreamStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || status === 408;
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

/**
 * Tier A — the curated host list. Exact/subdomain match, unchanged.
 *
 * A single hardcoded gate over this list used to be the *only* admission rule,
 * which excluded every general newswire and most energy/water trade press; when
 * nothing survived, the factor route silently returned the static set.
 */
export function isReputableSource(url: string): boolean {
  return classifySourceTrust(url) === "a";
}

/**
 * Tier B — trade press and national/institutional publishers that the Tier A
 * list never covered (energy + water commodities specifically). Same
 * exact/subdomain matching.
 */
export const TRUSTED_TRADE_HOSTS = [
  "oilprice.com",
  "spglobal.com",
  "argusmedia.com",
  "utilitydive.com",
  "offshore-energy.biz",
  "naturalgasintel.com",
  "tradingeconomics.com",
  "pv-magazine.com",
  "hydrocarbonprocessing.com",
  "rigzone.com",
  "renewablesnow.com",
  "solarpowermagazineonline.com",
  "hydro-review.com",
  "watertechnology.org",
  "wateronline.com",
  "banquedeltaresearch.com",
  "capacitymarket.com",
  "ainenergy.com",
  "hydrogeninsight.com",
  "nuclearpowerinternational.com",
  "afr.com",
  "mining.com",
  "mysteel.net",
  "financialtimes.com",
  "nikkei.com",
  "japantimes.co.jp",
  "scmp.com",
  "channelnewsasia.com",
  "straitstimes.com",
  "abc.net.au",
  "aljazeera.com",
  "dw.com",
  "rfi.fr",
  "aa.com.tr",
  "thehindu.com",
  "timesofindia.indiatimes.com",
  "bnef.com",
  "woodmac.com",
  "ieefa.org",
  "carbonbrief.org",
  "nationalgrid.com",
  "edp.com",
  "iberdrola.com",
  "enel.com",
  "engie.com",
  "shell.com",
  "bp.com",
  "totalenergies.com",
] as const;

/**
 * Tier B structural pattern: any institutional suffix (`*.gov`, `*.gov.<cc>`,
 * `*.edu`, `*.ac.<cc>`). A national regulator, ministry or public utility
 * publisher is as trustworthy as a hand-listed one, and the shape of the
 * domain is a stronger signal than our ability to enumerate every ccTLD.
 */
function isInstitutionalHost(host: string): boolean {
  const labels = host.split(".");
  if (labels.length < 2) return false;
  for (let i = 1; i < labels.length; i++) {
    const label = labels[i];
    if (label !== "gov" && label !== "edu" && label !== "ac") continue;
    if (i === labels.length - 1) return true;
    // `gov`/`edu`/`ac` followed by a ccTLD, e.g. `ofgem.gov.uk`, `imperial.ac.uk`.
    const suffix = labels.slice(i + 1);
    if (suffix.length > 0 && suffix.every((part) => /^[a-z]{2}$/.test(part))) return true;
  }
  return false;
}

export type SourceTrustTier = "a" | "b" | "c";

/**
 * Classifies a URL into the trust tier used to admit it as a curation
 * candidate:
 *  - "a" the curated host list,
 *  - "b" trusted trade press or an institutional domain shape,
 *  - "c" anything else (admitted only to backfill a thin candidate set, and
 *    capped per host by the caller so one domain cannot fill the window).
 */
export function classifySourceTrust(url: string): SourceTrustTier {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "c";
  }
  if (!host) return "c";
  const matches = (list: readonly string[]) =>
    list.some((entry) => host === entry || host.endsWith(`.${entry}`));
  if (matches(REPUTABLE_HOSTS)) return "a";
  if (isInstitutionalHost(host) || matches(TRUSTED_TRADE_HOSTS)) return "b";
  return "c";
}

/** Per-host cap for Tier C backfill candidates. */
export const TIER_C_MAX_PER_HOST = 2;

export function isRecentPublishedAt(value: string | undefined): boolean {
  if (!value) return true;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return true;
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  return date >= cutoff;
}