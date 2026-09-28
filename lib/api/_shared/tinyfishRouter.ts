import {
  TINYFISH_KEY_ENV_NAMES,
  readConfiguredKeys,
  sanitizeUrl,
  SCRAPE_CACHE_MS,
  SEARCH_CACHE_MS,
  STALE_SEARCH_CACHE_MS,
} from "./http";
import { getCache, setCache } from "./cache";
import type { Region } from "./regions";

export interface TinyFishKeyState {
  keyIndex: number;
  envName: string;
  /**
   * The normalized key material. Carried on the state so requests send exactly
   * what `readConfiguredKeys` validated, instead of re-reading the raw
   * `process.env[...]` value (which may carry quotes/whitespace/a `Bearer `
   * prefix and would 401).
   */
  keyValue: string;
  available: boolean;
  rateLimited: boolean;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

interface TinyFishSearchResponse {
  results: SearchResult[];
  total: number;
  keyIndex: number;
  /**
   * True when the search ended because the caller's signal was aborted.
   *
   * An aborted search previously returned the same `{results: [], total: 0}` as a
   * genuine miss, so a budget exhaustion upstream was reported to the model and
   * to the user as "no reputable sources returned by the news search".
   */
  aborted: boolean;
}

interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  keyIndex: number;
}

const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";
/**
 * Per-attempt cap for a single TinyFish call.
 *
 * This used to be `abortSignal ?? AbortSignal.timeout(10_000)`, which meant the
 * cap was DEAD whenever a route passed its own timer: one hung fetch could then
 * consume the entire route budget. The caller's signal and this per-attempt cap
 * are always combined, so neither can outlive the other.
 */
const PER_ATTEMPT_TIMEOUT_MS = 10_000;

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => {
      controller.abort(signal.reason);
    }, { once: true });
  }
  return controller.signal;
}

/** Caller signal (may be absent) AND a per-attempt cap, always both. */
function attemptSignal(abortSignal?: AbortSignal): AbortSignal {
  const perAttempt = AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS);
  return abortSignal ? combineAbortSignals(abortSignal, perAttempt) : perAttempt;
}

/**
 * Abort-aware sleep. `backoff` was the only sleep in the codebase that kept
 * sleeping through a cancelled request, burning budget after the route timer had
 * already fired.
 */
async function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    abortSignal?.addEventListener("abort", done, { once: true });
  });
}

function buildSearchUrl(query: string, limit: number): string {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return `${SEARCH_URL}?${params.toString()}`;
}

/**
 * TinyFish returns the publication date under several names depending on the
 * upstream index. Only `published_at` was read before, so most results reached
 * the model with "no date" even when a date was present.
 *
 * A value that cannot be parsed, or that is in the future (a badly populated
 * field), is reported as *no date* rather than as fresh evidence. The caller's
 * filter fails open for "no date" on purpose.
 */
const PUBLISHED_AT_FIELDS = [
  "published_at",
  "publishedAt",
  "published_date",
  "publishedDate",
  "pubDate",
  "date",
] as const;

function normalizePublishedAt(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  if (parsed > Date.now() + 24 * 60 * 60 * 1000) return undefined;
  return value;
}

/** First parseable, non-future date under any of the accepted field names. */
function firstPublishedAt(result: Record<string, unknown>): string | undefined {
  for (const field of PUBLISHED_AT_FIELDS) {
    const normalized = normalizePublishedAt(result[field]);
    if (normalized) return normalized;
  }
  return undefined;
}

export class TinyFishRouter {
  private keyStates: TinyFishKeyState[] = [];
  private initialized: boolean = false;

  async refreshTinyfishStatus(force: boolean = false, abortSignal?: AbortSignal): Promise<void> {
    if (!force && this.initialized && this.keyStates.length > 0) return;

    const keys = readConfiguredKeys(TINYFISH_KEY_ENV_NAMES);
    if (keys.length === 0) {
      this.keyStates = [];
      this.initialized = false;
      return;
    }
    this.keyStates = keys.map((key, index) => ({
      keyIndex: index,
      envName: key.envName,
      keyValue: key.value,
      available: false, // Will be verified on first use
      rateLimited: false,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastCheckedAt: null,
      lastSuccessAt: null,
    }));

    // Probe all keys in PARALLEL with a short timeout to avoid Vercel function timeouts.
    // Sequential probing with 10s timeouts each would take too long with many keys.
    const controller = new AbortController();
    const combinedSignal = abortSignal
      ? combineAbortSignals(abortSignal, controller.signal)
      : controller.signal;
    const overallTimeout = setTimeout(() => controller.abort(), 3000);
    try {
      const probeResults = await Promise.all(
        this.keyStates.map(async (keyState) => {
          const testKey = keyState.keyValue;
          if (!testKey) return { keyIndex: keyState.keyIndex, ok: false, status: 0, headers: null as Headers | null };

          try {
            const response = await fetch(buildSearchUrl("test", 1), {
              headers: {
                "X-API-Key": testKey,
              },
              signal: combinedSignal,
            });
            return { keyIndex: keyState.keyIndex, ok: true, status: response.status, headers: response.headers };
          } catch {
            return { keyIndex: keyState.keyIndex, ok: false, status: 0, headers: null as Headers | null };
          }
        }),
      );

      for (const result of probeResults) {
        const keyState = this.keyStates[result.keyIndex];
        if (!keyState) continue;

        if (!result.ok) {
          keyState.available = false;
          keyState.lastCheckedAt = new Date().toISOString();
          continue;
        }

        if (result.status === 200) {
          keyState.available = true;
          keyState.lastCheckedAt = new Date().toISOString();
          keyState.lastSuccessAt = keyState.lastCheckedAt;
          const remaining = result.headers?.get("x-ratelimit-remaining");
          if (remaining) {
            const parsed = Number(remaining);
            if (Number.isFinite(parsed)) keyState.rateLimitRemaining = parsed;
          }
        } else if (result.status === 401 || result.status === 403) {
          keyState.available = false;
          keyState.lastCheckedAt = new Date().toISOString();
        } else if (result.status === 429) {
          keyState.rateLimited = true;
          keyState.lastCheckedAt = new Date().toISOString();
          if (result.headers) this.parseRateLimitHeaders(keyState, result.headers);
        }
      }
    } finally {
      clearTimeout(overallTimeout);
      controller.abort();
    }

    this.initialized = true;
  }

  private parseRateLimitHeaders(
    keyState: TinyFishKeyState,
    headers: Headers
  ): void {
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) {
        keyState.rateLimitResetAt = new Date(Date.now() + seconds * 1000).toISOString();
      }
    }
    const remaining = headers.get("x-ratelimit-remaining");
    if (remaining) {
      const parsed = Number(remaining);
      if (Number.isFinite(parsed)) keyState.rateLimitRemaining = parsed;
    }
  }

  private selectKey(): TinyFishKeyState | null {
    const available = this.keyStates.filter(
      k => k.available && !k.rateLimited
    );

    if (available.length === 0) return null;

    const maxRemaining = Math.max(
      ...available.map(k => k.rateLimitRemaining ?? 0)
    );
    const topQuota = available.filter(
      k => (k.rateLimitRemaining ?? 0) === maxRemaining
    );

    return topQuota[0];
  }

  private rotateKey(failedKey: TinyFishKeyState): TinyFishKeyState | null {
    failedKey.rateLimited = true;
    failedKey.lastCheckedAt = new Date().toISOString();
    return this.selectKey();
  }

  async tinyfishSearch(
    query: string,
    options: { limit?: number; region?: Region } = {},
    abortSignal?: AbortSignal
  ): Promise<TinyFishSearchResponse> {
    if (!this.initialized) {
      await this.refreshTinyfishStatus(true, abortSignal);
    }

    const cacheKey = `tinyfish:search:${query}:${options.region ?? "global"}`;
    const cached = await getCache<TinyFishSearchResponse>(cacheKey, SEARCH_CACHE_MS);
    // A cache entry written before `aborted` existed is normalized here so
    // callers can rely on the field being present.
    if (cached) return { ...cached, aborted: false };

    let keyState = this.selectKey();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      // Guarded at the TOP as well as at the bottom: a request that arrives with
      // an already-expired budget must not spend one more vendor call on it.
      if (abortSignal?.aborted) break;
      if (!keyState) {
        await this.backoff(attempt, abortSignal);
        keyState = this.selectKey();
        if (!keyState) break;
      }

      try {
        // The normalized value carried on the key state, not the raw env value:
        // a raw `Bearer x` / quoted value would be sent verbatim and 401.
        const testKey = keyState.keyValue;
        if (!testKey) {
          keyState = this.rotateKey(keyState);
          continue;
        }

        const region = options.region ?? "global";
        const regionPrefix = region !== "global" ? `[${region}] ` : "";

         const response = await fetch(buildSearchUrl(`${regionPrefix}${query}`, options.limit ?? 10), {
           headers: {
             "X-API-Key": testKey,
           },
           signal: attemptSignal(abortSignal),
         });

        const status = response.status;

        if (status === 200) {
          const data = await response.json();
          const results: SearchResult[] = Array.isArray(data.results)
            ? data.results.map((r: any) => ({
                position: r.position ?? 0,
                site_name: r.site_name ?? "",
                title: r.title ?? "",
                snippet: r.snippet ?? "",
                url: r.url ?? "",
                publishedAt: firstPublishedAt(r),
              }))
            : [];
           const result: TinyFishSearchResponse = {
             results,
             total: data.total_results ?? 0,
             keyIndex: keyState.keyIndex,
             aborted: false,
           };

          keyState.lastCheckedAt = new Date().toISOString();
          keyState.lastSuccessAt = keyState.lastCheckedAt;
          const remaining = response.headers.get("x-ratelimit-remaining");
          if (remaining) {
            const parsed = Number(remaining);
            if (Number.isFinite(parsed)) keyState.rateLimitRemaining = parsed;
          }

          await setCache(cacheKey, result, SEARCH_CACHE_MS);
          // Distinct, longer-lived copy so a later failed search still has
          // evidence to fall back on (the primary entry lives
          // SEARCH_CACHE_MS).
          if (result.results.length > 0) {
            await setCache(`${cacheKey}:stale`, result, STALE_SEARCH_CACHE_MS);
          }
          return result;
        }

        if (status === 401 || status === 403) {
          keyState.available = false;
          keyState.lastCheckedAt = new Date().toISOString();
          keyState = this.rotateKey(keyState);
          continue;
        }

        if (status === 429) {
          this.parseRateLimitHeaders(keyState, response.headers);
          keyState = this.rotateKey(keyState);
          lastError = new Error("Rate limited");
          continue;
        }

        lastError = new Error(`TinyFish search failed with status ${status}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // If the abort signal has been fired, stop retrying
      if (abortSignal && abortSignal.aborted) {
        break;
      }

      keyState = this.selectKey();
    }

    // A stale-but-usable copy of the last good result, kept under its own key.
    // The old code re-read the *same* key with a 1h TTL argument, but
    // `getCache` ignores its TTL argument and trusts the stored 60s
    // `expiresAt`, so the "fallback" was always null (a silent no-op).
    const stale = await getCache<TinyFishSearchResponse>(`${cacheKey}:stale`, STALE_SEARCH_CACHE_MS);
    if (stale && Array.isArray(stale.results) && stale.results.length > 0) {
      return { ...stale, aborted: false };
    }

    console.error("TinyFish search failed:", lastError?.message);
    return { results: [], total: 0, keyIndex: -1, aborted: Boolean(abortSignal?.aborted) };
  }

  async tinyfishScrape(url: string, abortSignal?: AbortSignal): Promise<ScrapedContent | null> {
    if (!this.initialized) {
      await this.refreshTinyfishStatus(true, abortSignal);
    }

    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return null;
    const cacheKey = `tinyfish:scrape:${safeUrl}`;
    const cached = await getCache<ScrapedContent>(cacheKey, SCRAPE_CACHE_MS);
    if (cached) return cached;

    if (abortSignal?.aborted) return null;

    let keyState = this.selectKey();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      // Guarded at the TOP as well as at the bottom: a request that arrives with
      // an already-expired budget must not spend one more vendor call on it.
      if (abortSignal?.aborted) break;
      if (!keyState) {
        await this.backoff(attempt, abortSignal);
        keyState = this.selectKey();
        if (!keyState) break;
      }

      try {
        // The normalized value carried on the key state, not the raw env value:
        // a raw `Bearer x` / quoted value would be sent verbatim and 401.
        const testKey = keyState.keyValue;
        if (!testKey) {
          keyState = this.rotateKey(keyState);
          continue;
        }

        const response = await fetch(FETCH_URL, {
          method: "POST",
          headers: {
            "X-API-Key": testKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            urls: [safeUrl],
          }),
          signal: attemptSignal(abortSignal),
        });

        const status = response.status;

        if (status === 200) {
          const data = await response.json();
          const firstResult = Array.isArray(data.results) && data.results.length > 0
            ? data.results[0]
            : null;
          // TinyFish answers HTTP 200 *with* a per-URL `errors[]` list when an
          // individual scrape fails. Caching that empty body for
          // SCRAPE_CACHE_MS poisoned the excerpts fed to the model, so an empty
          // result is reported but never cached.
          const errors = Array.isArray(data.errors)
            ? data.errors.filter((e: unknown) => typeof e === "string" || (e && typeof e === "object"))
            : [];
          const text = typeof firstResult?.text === "string" ? firstResult.text.slice(0, 10000) : "";
          const result: ScrapedContent = {
            url: safeUrl,
            title: firstResult?.title ?? "",
            text,
            keyIndex: keyState.keyIndex,
          };

          keyState.lastCheckedAt = new Date().toISOString();
          keyState.lastSuccessAt = keyState.lastCheckedAt;
          this.parseRateLimitHeaders(keyState, response.headers);

          if (errors.length > 0 || (!result.text && !result.title)) {
            console.error(
              `TinyFish scrape returned no content for ${safeUrl}:`,
              JSON.stringify(errors).slice(0, 300),
            );
            lastError = new Error(`TinyFish scrape reported ${errors.length} error(s) for ${safeUrl}`);
            continue;
          }

          // Written with the same TTL the read path uses; the shorter
          // SEARCH_CACHE_MS write used to evict the scrape almost immediately,
          // so every run re-scraped (and re-billed) each article.
          await setCache(cacheKey, result, SCRAPE_CACHE_MS);
          return result;
        }

        if (status === 401 || status === 403) {
          keyState.available = false;
          keyState.lastCheckedAt = new Date().toISOString();
          keyState = this.rotateKey(keyState);
          continue;
        }

        if (status === 429) {
          this.parseRateLimitHeaders(keyState, response.headers);
          keyState = this.rotateKey(keyState);
          lastError = new Error("Rate limited");
          continue;
        }

        lastError = new Error(`TinyFish scrape failed with status ${status}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // If the abort signal has been fired, stop retrying
      if (abortSignal && abortSignal.aborted) {
        break;
      }

      keyState = this.selectKey();
    }

    console.error("TinyFish scrape failed:", lastError?.message);
    return null;
  }

  async getTinyfishStatus(abortSignal?: AbortSignal, quick: boolean = false): Promise<{
    available: boolean;
    configuredKeys: number;
    usableKeys: number;
    rateLimitedKeys: number[];
    /** Env-var NAMES holding a configured key. Values are never exposed. */
    keyEnvNames: string[];
    keyEnvNamesRead: string[];
  }> {
    if (!quick && !this.initialized) {
      await this.refreshTinyfishStatus(true, abortSignal);
    }

    // In quick mode, ensure keyStates is populated at least with configured keys
    if (!this.initialized && this.keyStates.length === 0) {
      const keys = readConfiguredKeys(TINYFISH_KEY_ENV_NAMES);
      this.keyStates = keys.map((key, index) => ({
        keyIndex: index,
        envName: key.envName,
        keyValue: key.value,
        available: false,
        rateLimited: false,
        rateLimitRemaining: null,
        rateLimitResetAt: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
      }));
    }

    if (!this.initialized) {
      // Quick mode: return basic status even if not initialized
      const usableKeys = this.keyStates.filter(k => k.available && !k.rateLimited).length;
      const rateLimitedKeys = this.keyStates
        .map((k, i) => (k.rateLimited ? i : -1))
        .filter(i => i >= 0);

      return {
        available: false,
        configuredKeys: this.keyStates.length,
        usableKeys,
        rateLimitedKeys,
        keyEnvNames: this.keyStates.map((k) => k.envName),
        keyEnvNamesRead: [...TINYFISH_KEY_ENV_NAMES],
      };
    }

    return {
      available: this.keyStates.some(k => k.available && !k.rateLimited),
      configuredKeys: this.keyStates.length,
      usableKeys: this.keyStates.filter(k => k.available && !k.rateLimited).length,
      rateLimitedKeys: this.keyStates
        .map((k, i) => (k.rateLimited ? i : -1))
        .filter(i => i >= 0),
      keyEnvNames: this.keyStates.map((k) => k.envName),
      keyEnvNamesRead: [...TINYFISH_KEY_ENV_NAMES],
    };
  }

  private async backoff(attempt: number, abortSignal?: AbortSignal): Promise<void> {
    const delays = [500, 1000, 2000];
    const delay = delays[Math.min(attempt, delays.length - 1)] ?? 2000;
    await sleep(delay, abortSignal);
  }
}

export const tinyfishRouter = new TinyFishRouter();

/**
 * Warms the TinyFish key probe once per instance, at module load, off the
 * request path. The probe used to run lazily inside the first search of the
 * first request that needed it, competing with the very request it was serving.
 * Guarded so it happens exactly once per instance, and any rejection is
 * swallowed: a failed warm-up must not take the module down.
 */
(function warmTinyfishRouterOnce(): void {
  try {
    void tinyfishRouter.refreshTinyfishStatus().catch((error: unknown) => {
      console.warn("TinyFish router warm-up failed:", error instanceof Error ? error.message : String(error));
    });
  } catch (error) {
    console.warn("TinyFish router warm-up could not start:", error);
  }
})();