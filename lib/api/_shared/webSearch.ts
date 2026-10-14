import type { RegionId, Region } from "./types";
import { tinyfishRouter } from "./tinyfishRouter";
import { playwrightMcp } from "./playwrightMcp";
import { duckDuckGo } from "./duckDuckGo";
import type { PlaywrightMcpStatus } from "./playwrightMcp";
import type { DuckDuckGoStatus } from "./duckDuckGo";

export interface WebSearchOptions {
  limit?: number;
  region?: RegionId;
  abortSignal?: AbortSignal;
}

export interface WebScrapeOptions {
  url?: string;
  abortSignal?: AbortSignal;
}

/**
 * Unified Web Search with fallback chain:
 * TinyFish API (primary) → Playwright MCP (first fallback) → DuckDuckGo HTTP (second fallback)
 * 
 * The fallback is only used when the primary provider fails (no usable keys or errors).
 * Software does NOT use fallbacks by default - only when all primary options are exhausted.
 */

/**
 * Searches the web using the fallback chain.
 * Tries TinyFish first, then Playwright MCP, then DuckDuckGo.
 * Returns results from the first successful provider.
 */
export async function search(
  query: string,
  options: WebSearchOptions = {}
): Promise<{
  results: { position: number; site_name: string; title: string; snippet: string; url: string }[];
  total: number;
  dataSource: string;
  provider: string;
}> {
  const { limit = 10, region = "global", abortSignal } = options;
  const regionNormalized = region === "global" ? undefined : (region as Region);

  // Step 1: Try TinyFish (primary - should always be tried first, not a fallback by default)
  try {
    const tinyfishResult = await tinyfishRouter.tinyfishSearch(`${query} ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`, {
      limit,
      region: regionNormalized,
    }, abortSignal);

    // Return TinyFish results if it has usable keys (keyIndex >= 0 means keys are configured)
    // If keyIndex === -1, it means no keys configured, so fall back to next provider
    if (tinyfishResult.keyIndex >= 0) {
      return {
        results: tinyfishResult.results.map((r) => ({
          position: r.position ?? 0,
          site_name: r.site_name ?? "",
          title: r.title ?? "",
          snippet: r.snippet ?? "",
          url: r.url ?? "",
        })),
        total: tinyfishResult.total,
        dataSource: "TinyFish API",
        provider: "tinyfish",
      };
    }
    console.warn("TinyFish has no configured keys, falling back to Playwright MCP");
  } catch (error) {
    console.warn("TinyFish search failed, falling back:", error instanceof Error ? error.message : String(error));
  }

  // Step 2: Try Playwright MCP (first fallback - used when TinyFish has no usable keys)
  try {
    const ppResult = await playwrightMcp.search(query, { limit, region: regionNormalized });
    if (ppResult.total > 0) {
      return {
        results: ppResult.results.map((r) => ({
          position: r.position,
          site_name: r.site_name,
          title: r.title,
          snippet: r.snippet,
          url: r.url,
        })),
        total: ppResult.total,
        dataSource: "Playwright MCP",
        provider: "playwright-mcp",
      };
    }
  } catch (error) {
    console.warn("Playwright MCP search failed, falling back to DuckDuckGo:", error instanceof Error ? error.message : String(error));
  }

  // Step 3: Try DuckDuckGo HTTP (second fallback - used only when both TinyFish and Playwright MCP fail)
  try {
    const ddgResult = await duckDuckGo.search(query, { limit, region: regionNormalized });
    if (ddgResult.total > 0) {
      return {
        results: ddgResult.results.map((r) => ({
          position: r.position,
          site_name: r.site_name,
          title: r.title,
          snippet: r.snippet,
          url: r.url,
        })),
        total: ddgResult.total,
        dataSource: "DuckDuckGo HTTP",
        provider: "duckduckgo",
      };
    }
  } catch (error) {
    console.error("DuckDuckGo search failed:", error instanceof Error ? error.message : String(error));
  }

  // All providers failed - return empty results
  return {
    results: [],
    total: 0,
    dataSource: "No search provider available",
    provider: "none",
  };
}

/**
 * Scrapes a URL using the fallback chain:
 * TinyFish first, then Playwright MCP.
 */
export async function scrape(
  url: string,
  options: WebScrapeOptions = {}
): Promise<{
  data: { url: string; title: string; text: string } | null;
  dataSource: string;
  provider: string;
}> {
  const { abortSignal } = options;

  // Step 1: Try TinyFish (primary)
  try {
    const scraped = await tinyfishRouter.tinyfishScrape(url, abortSignal);
    if (scraped) {
      return {
        data: {
          url: scraped.url,
          title: scraped.title,
          text: scraped.text,
        },
        dataSource: "TinyFish API",
        provider: "tinyfish",
      };
    }
  } catch (error) {
    console.warn("TinyFish scrape failed, falling back:", error instanceof Error ? error.message : String(error));
  }

  // Step 2: Try Playwright MCP (first fallback)
  try {
    const scraped = await playwrightMcp.scrape(url);
    if (scraped) {
      return {
        data: {
          url: scraped.url,
          title: scraped.title,
          text: scraped.text,
        },
        dataSource: "Playwright MCP",
        provider: "playwright-mcp",
      };
    }
  } catch (error) {
    console.warn("Playwright MCP scrape failed, falling back to DuckDuckGo:", error instanceof Error ? error.message : String(error));
  }

  // No provider could scrape the URL
  return {
    data: null,
    dataSource: "No scrape provider available",
    provider: "none",
  };
}

/**
 * Gets the status of all search providers in the fallback chain.
 */
export async function getSearchStatus(): Promise<{
  tinyfish: {
    available: boolean;
    usableKeys: number;
    configuredKeys: number;
  };
  playwrightMcp: PlaywrightMcpStatus;
  duckDuckGo: DuckDuckGoStatus;
}> {
  const tinyfishStatus = await tinyfishRouter.getTinyfishStatus();

  return {
    tinyfish: {
      available: tinyfishStatus.available,
      usableKeys: tinyfishStatus.usableKeys,
      configuredKeys: tinyfishStatus.configuredKeys,
    },
    playwrightMcp: playwrightMcp.getStatus(),
    duckDuckGo: duckDuckGo.getStatus(),
  };
}

/**
 * Checks if any provider in the fallback chain is healthy and available.
 * Returns true only if TinyFish is available OR (Playwright MCP is available AND TinyFish has no keys)
 * OR (DuckDuckGo is available AND both TinyFish and Playwright MCP have no keys).
 * 
 * This ensures fallbacks are NOT used by default - only when primary options are exhausted.
 */
export async function isFallbackNeeded(): Promise<boolean> {
  const tfStatus = await tinyfishRouter.getTinyfishStatus();
  const ppStatus = playwrightMcp.getStatus();
  const ddgStatus = duckDuckGo.getStatus();

  // TinyFish is available - no fallbacks needed
  if (tfStatus.available && tfStatus.usableKeys > 0) {
    return false;
  }

  // TinyFish has no usable keys, try Playwright MCP
  if (!ppStatus.lastError && ppStatus.initialized) {
    return false; // Playwright MCP is healthy, but only use if TinyFish has no keys
  }

  // Both TinyFish and Playwright MCP failed, DuckDuckGo is the last resort
  return !ddgStatus.lastError;
}

export type { Region, RegionId };