import { tinyfishRouter } from "./tinyfishRouter";
import { mcpSearchRouter } from "./mcpSearchRouter";
import type { Region } from "./regions";

export interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
  sourceType?: "tinyfish" | "playwright" | "duckduckgo";
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  keyIndex: number;
}

export interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  keyIndex: number;
}

export interface SearchStatus {
  available: boolean;
  configuredKeys: number;
  usableKeys: number;
  rateLimitedKeys: number[];
  fallbackAvailable: boolean;
  fallbackType?: "playwright" | "duckduckgo";
  tinyfishAvailable: boolean;
}

/**
 * Unified Search Router
 * 
 * Fallback hierarchy:
 * 1. TinyFish API (primary) - with key rotation
 * 2. Playwright MCP-based search (fallback 1) - when TinyFish keys exhausted OR TinyFish returns no results
 * 3. DuckDuckGo HTTP search (fallback 2) - when Playwright also fails or returns no results
 * 
 * The fallback is triggered when:
 * - All TinyFish API keys are exhausted (unavailable, rate-limited, or invalid)
 * - OR no TinyFish API keys are configured at all
 * - OR TinyFish returns no results for the query (to ensure we always get search results)
 */
export class UnifiedSearchRouter {
  private fallbackTriggered: boolean = false;
  private lastFallbackType: "playwright" | "duckduckgo" | null = null;

  /**
   * Check if all TinyFish keys are exhausted
   */
  private async areAllTinyfishKeysExhausted(): Promise<boolean> {
    const status = await tinyfishRouter.getTinyfishStatus();
    // Fallback should trigger when:
    // 1. No TinyFish keys are configured at all (configuredKeys === 0), OR
    // 2. All configured TinyFish keys are exhausted (configuredKeys > 0 but usable === 0)
    return status.configuredKeys === 0 || (status.configuredKeys > 0 && status.usableKeys === 0);
  }

  /**
   * Check if we should use fallback (all TinyFish keys exhausted OR no results)
   */
  private async shouldUseFallback(tinyfishResult?: { results: SearchResult[]; total: number }): Promise<boolean> {
    const keysExhausted = await this.areAllTinyfishKeysExhausted();
    // Also trigger fallback if TinyFish returned no results (even if keys are valid)
    const noResults = tinyfishResult ? tinyfishResult.total === 0 : false;
    return keysExhausted || noResults;
  }

  /**
   * Search with fallback hierarchy
   * Primary: TinyFish API with key rotation
   * Fallback: Playwright/DuckDuckGo when TinyFish keys exhausted OR TinyFish returns no results
   */
  async search(
    query: string,
    options: { limit?: number; region?: Region } = {},
    abortSignal?: AbortSignal
  ): Promise<SearchResponse> {
    // First, try TinyFish API (primary)
    const tinyfishResult = await tinyfishRouter.tinyfishSearch(query, options, abortSignal);

    // Check if we should fall back: keys exhausted OR TinyFish returned no results
    const shouldFallback = await this.shouldUseFallback(tinyfishResult);

    if (!shouldFallback) {
      // TinyFish keys are available AND returned results, return them
      this.fallbackTriggered = false;
      this.lastFallbackType = null;
      // Mark results as from TinyFish
      return {
        ...tinyfishResult,
        results: tinyfishResult.results.map(r => ({ ...r, sourceType: "tinyfish" as const }))
      };
    }

    // TinyFish keys exhausted OR no results - trigger fallback
    this.fallbackTriggered = true;
    if (tinyfishResult.total === 0 && !await this.areAllTinyfishKeysExhausted()) {
      console.warn("TinyFish returned no results, falling back to Playwright/DuckDuckGo");
    } else {
      console.warn("All TinyFish keys exhausted, falling back to Playwright/DuckDuckGo");
    }

    // Try Playwright first (fallback 1)
    const playwrightResult = await mcpSearchRouter.playwrightSearch(
      query,
      options.limit ?? 10,
      abortSignal
    );

    if (playwrightResult && playwrightResult.results.length > 0) {
      this.lastFallbackType = "playwright";
      return {
        ...playwrightResult,
        results: playwrightResult.results.map(r => ({ ...r, sourceType: "playwright" as const }))
      };
    }

    // Try DuckDuckGo HTTP (fallback 2)
    const duckduckgoResult = await mcpSearchRouter.duckduckgoSearch(
      query,
      options.limit ?? 10,
      abortSignal
    );

    if (duckduckgoResult && duckduckgoResult.results.length > 0) {
      this.lastFallbackType = "duckduckgo";
      return {
        ...duckduckgoResult,
        results: duckduckgoResult.results.map(r => ({ ...r, sourceType: "duckduckgo" as const }))
      };
    }

    // All fallbacks failed - return empty results (callers handle deterministic fallbacks)
    console.warn("All search methods failed, returning empty results");
    return { results: [], total: 0, keyIndex: -1 };
  }

  /**
   * Scrape with fallback hierarchy
   * Primary: TinyFish scrape
   * Fallback: HTTP fetch + Playwright when TinyFish keys exhausted OR TinyFish scrape fails
   */
  async scrape(
    url: string,
    abortSignal?: AbortSignal
  ): Promise<ScrapedContent | null> {
    // First, try TinyFish scrape (primary)
    const tinyfishResult = await tinyfishRouter.tinyfishScrape(url, abortSignal);

    // Check if we should use fallback
    const shouldFallback = await this.shouldUseFallback();

    if (!shouldFallback || tinyfishResult) {
      // TinyFish keys available OR TinyFish succeeded - return result
      this.fallbackTriggered = false;
      this.lastFallbackType = null;
      return tinyfishResult;
    }

    // All TinyFish keys exhausted - trigger fallback
    this.fallbackTriggered = true;
    console.warn("All TinyFish keys exhausted, falling back to HTTP/Playwright scrape");

    // Try HTTP fetch with content extraction (fallback 1)
    const httpResult = await mcpSearchRouter.httpScrape(url, abortSignal);
    if (httpResult) {
      this.lastFallbackType = "duckduckgo"; // Using HTTP fetch as fallback
      return httpResult;
    }

    // Try Playwright-based scraping (fallback 2)
    const playwrightResult = await mcpSearchRouter.playwrightScrape(url, abortSignal);
    if (playwrightResult) {
      this.lastFallbackType = "playwright";
      return playwrightResult;
    }

    // All methods failed
    console.warn("All scrape methods failed for URL:", url);
    return null;
  }

  /**
   * Get combined search status for health checks
   */
  async getStatus(abortSignal?: AbortSignal): Promise<SearchStatus> {
    const tinyfishStatus = await tinyfishRouter.getTinyfishStatus(abortSignal, true);
    const shouldFallback = await this.shouldUseFallback();
    const mcpStatus = await mcpSearchRouter.getMcpSearchStatus(abortSignal);

    return {
      available: tinyfishStatus.available || mcpStatus.playwrightAvailable || mcpStatus.duckduckgoAvailable,
      configuredKeys: tinyfishStatus.configuredKeys,
      usableKeys: tinyfishStatus.usableKeys,
      rateLimitedKeys: tinyfishStatus.rateLimitedKeys,
      fallbackAvailable: mcpStatus.playwrightAvailable || mcpStatus.duckduckgoAvailable,
      fallbackType: shouldFallback ? (mcpStatus.playwrightAvailable ? "playwright" : "duckduckgo") : undefined,
      tinyfishAvailable: tinyfishStatus.available,
    };
  }

  /**
   * Check if fallback was triggered for the last operation
   */
  wasFallbackTriggered(): boolean {
    return this.fallbackTriggered;
  }

  /**
   * Get the type of fallback that was used
   */
  getLastFallbackType(): "playwright" | "duckduckgo" | null {
    return this.lastFallbackType;
  }
}

export const unifiedSearchRouter = new UnifiedSearchRouter();