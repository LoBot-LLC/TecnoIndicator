import {
  TINYFISH_KEY_ENV_NAMES,
  readConfiguredKeys,
  sanitizeUrl,
  SCRAPE_CACHE_MS,
  SEARCH_CACHE_MS,
} from "./http";
import { getCache, setCache } from "./cache";
import type { Region } from "./regions";

export interface TinyFishKeyState {
  keyIndex: number;
  envName: string;
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
}

interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  keyIndex: number;
}

const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";

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

function buildSearchUrl(query: string, limit: number): string {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return `${SEARCH_URL}?${params.toString()}`;
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
          const testKey = process.env[keyState.envName];
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
    if (cached) return cached;

    let keyState = this.selectKey();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      if (!keyState) {
        if (attempt > 0) await this.backoff(attempt - 1);
        keyState = this.selectKey();
        if (!keyState) break;
      }

      try {
        const testKey = process.env[keyState.envName];
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
           signal: abortSignal ?? AbortSignal.timeout(10000),
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
                publishedAt: r.published_at ?? undefined,
              }))
            : [];
          const result: TinyFishSearchResponse = {
            results,
            total: data.total_results ?? 0,
            keyIndex: keyState.keyIndex,
          };

          keyState.lastCheckedAt = new Date().toISOString();
          keyState.lastSuccessAt = keyState.lastCheckedAt;
          const remaining = response.headers.get("x-ratelimit-remaining");
          if (remaining) {
            const parsed = Number(remaining);
            if (Number.isFinite(parsed)) keyState.rateLimitRemaining = parsed;
          }

          await setCache(cacheKey, result, SEARCH_CACHE_MS);
          return result;
        }

        if (status === 401 || status === 403) {
          keyState.available = false;
          keyState.lastCheckedAt = new Date().toISOString();
          keyState = this.rotateKey(keyState);
          if (keyState) await this.backoff(attempt);
          continue;
        }

        if (status === 429) {
          this.parseRateLimitHeaders(keyState, response.headers);
          keyState = this.rotateKey(keyState);
          lastError = new Error("Rate limited");
          if (keyState) await this.backoff(attempt);
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
      if (keyState) await this.backoff(attempt);
    }

    const cachedFallback = await getCache<TinyFishSearchResponse>(
      cacheKey,
      60 * 60 * 1000
    );
    if (cachedFallback) return cachedFallback;

    console.error("TinyFish search failed:", lastError?.message);
    return { results: [], total: 0, keyIndex: -1 };
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

    let keyState = this.selectKey();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      if (!keyState) {
        if (attempt > 0) await this.backoff(attempt - 1);
        keyState = this.selectKey();
        if (!keyState) break;
      }

      try {
        const testKey = process.env[keyState.envName];
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
          signal: abortSignal ?? AbortSignal.timeout(10000),
        });

        const status = response.status;

        if (status === 200) {
          const data = await response.json();
          const firstResult = Array.isArray(data.results) && data.results.length > 0
            ? data.results[0]
            : null;
          const result: ScrapedContent = {
            url: safeUrl,
            title: firstResult?.title ?? "",
            text: typeof firstResult?.text === "string" ? firstResult.text.slice(0, 10000) : "",
            keyIndex: keyState.keyIndex,
          };

          keyState.lastCheckedAt = new Date().toISOString();
          keyState.lastSuccessAt = keyState.lastCheckedAt;
          this.parseRateLimitHeaders(keyState, response.headers);

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
          if (keyState) await this.backoff(attempt);
          continue;
        }

        if (status === 429) {
          this.parseRateLimitHeaders(keyState, response.headers);
          keyState = this.rotateKey(keyState);
          lastError = new Error("Rate limited");
          if (keyState) await this.backoff(attempt);
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
      if (keyState) await this.backoff(attempt);
    }

    console.error("TinyFish scrape failed:", lastError?.message);
    return null;
  }

  async getTinyfishStatus(abortSignal?: AbortSignal, quick: boolean = false): Promise<{
    available: boolean;
    configuredKeys: number;
    usableKeys: number;
    rateLimitedKeys: number[];
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
      };
    }

    return {
      available: this.keyStates.some(k => k.available && !k.rateLimited),
      configuredKeys: this.keyStates.length,
      usableKeys: this.keyStates.filter(k => k.available && !k.rateLimited).length,
      rateLimitedKeys: this.keyStates
        .map((k, i) => (k.rateLimited ? i : -1))
        .filter(i => i >= 0),
    };
  }

  private async backoff(attempt: number): Promise<void> {
    // Exponential backoff with jitter: base = 500ms, max = 5s, factor = 2x
    const baseDelay = 500;
    const maxDelay = 5000;
    const exponential = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    // Add jitter (±20% to avoid thundering herd)
    const jitter = exponential * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(100, exponential + jitter);
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export const tinyfishRouter = new TinyFishRouter();