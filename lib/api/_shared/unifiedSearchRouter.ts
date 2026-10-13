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
 * 2. Playwright MCP-based search (fallback 1) - ONLY when ALL TinyFish keys exhausted OR no keys configured
 * 3. DuckDuckGo HTTP search (fallback 2) - ONLY when Playwright also fails
 * 
 * The fallback is ONLY triggered when:
 * - All TinyFish API keys are exhausted (unavailable, rate-limited, or invalid)
 * - OR no TinyFish API keys are configured at all
 * - Not when a query simply returns no results
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
   * Check if we should use fallback (all TinyFish keys exhausted)
   */
  private async shouldUseFallback(): Promise<boolean> {
    return await this.areAllTinyfishKeysExhausted();
  }

  /**
   * Search with fallback hierarchy
   * Primary: TinyFish API with key rotation
   * Fallback: Playwright/DuckDuckGo ONLY when all TinyFish keys exhausted
   */
  async search(
    query: string,
    options: { limit?: number; region?: Region } = {},
    abortSignal?: AbortSignal
  ): Promise<SearchResponse> {
    // First, try TinyFish API (primary)
    const tinyfishResult = await tinyfishRouter.tinyfishSearch(query, options, abortSignal);

    // If TinyFish returned results (even empty results from a successful query), return them
    // We only fall back when TinyFish keys are EXHAUSTED (all keys failed), not when query returns no results
    const shouldFallback = await this.shouldUseFallback();

    if (!shouldFallback) {
      // TinyFish keys are available, return whatever TinyFish returned
      // (could be empty results for this specific query, but that's correct behavior)
      this.fallbackTriggered = false;
      this.lastFallbackType = null;
      return tinyfishResult;
    }

    // All TinyFish keys exhausted - trigger fallback
    this.fallbackTriggered = true;
    console.warn("All TinyFish keys exhausted, falling back to Playwright/DuckDuckGo");

    // Try Playwright first (fallback 1)
    const playwrightResult = await mcpSearchRouter.playwrightSearch(
      query,
      options.limit ?? 10,
      abortSignal
    );

    if (playwrightResult && playwrightResult.results.length > 0) {
      this.lastFallbackType = "playwright";
      return playwrightResult;
    }

    // Try DuckDuckGo HTTP (fallback 2)
    const duckduckgoResult = await mcpSearchRouter.duckduckgoSearch(
      query,
      options.limit ?? 10,
      abortSignal
    );

    if (duckduckgoResult && duckduckgoResult.results.length > 0) {
      this.lastFallbackType = "duckduckgo";
      return duckduckgoResult;
    }

    // All fallbacks failed - return empty results (callers handle deterministic fallbacks)
    console.warn("All search methods failed, returning empty results");
    return { results: [], total: 0, keyIndex: -1 };
  }

  /**
   * Scrape with fallback hierarchy
   * Primary: TinyFish scrape
   * Fallback: HTTP fetch + Playwright ONLY when all TinyFish keys exhausted
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