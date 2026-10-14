import type { Region } from "./regions";

/**
 * DuckDuckGo HTTP Search
 *
 * A simple HTTP-based web search using DuckDuckGo's HTML endpoint.
 * Used as the final fallback when both TinyFish API and Playwright MCP fail.
 *
 * No browser required - pure HTTP requests with HTML parsing.
 */

interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

export interface DuckDuckGoStatus {
  available: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
}

// Use DuckDuckGo Lite endpoint - more scraper-tolerant and lightweight
const DUCKDUCKGO_LITE_URL = "https://lite.duckduckgo.com/lite/";
const SEARCH_TIMEOUT_MS = Number(process.env.DUCKDUCKGO_SEARCH_TIMEOUT_MS ?? 10000);

let _status: DuckDuckGoStatus = {
  available: true,
  lastError: null,
  lastErrorAt: null,
};

function updateStatus(partial: Partial<DuckDuckGoStatus>): void {
  _status = { ..._status, ...partial };
}

function buildSearchUrl(query: string, region?: Region): string {
  const params = new URLSearchParams({
    q: query,
    kl: regionToDuckDuckGoRegion(region),
    df: "2026-01..2026-12",
    // Note: lite endpoint doesn't use 'ia' parameter
  });
  return `${DUCKDUCKGO_LITE_URL}?${params.toString()}`;
}

function regionToDuckDuckGoRegion(region?: Region): string {
  switch (region) {
    case "asia":
      return "jp-jp";
    case "europe":
      return "de-de";
    case "africa":
      return "za-za";
    case "americas":
      return "us-en";
    case "oceania":
      return "au-au";
    default:
      return "us-en";
  }
}

async function fetchHtml(url: string, abortSignal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  const combinedSignal = abortSignal
    ? combineAbortSignals([abortSignal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: combinedSignal,
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
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

function resolveDuckDuckGoUrl(href: string): string {
  // DuckDuckGo Lite wraps targets in a redirect like
  // //duckduckgo.com/l/?uddg=<percent-encoded-url>&rut=...
  // We pull the uddg parameter back out.
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    // Protocol-relative URLs (//example.com) get https: prefix
    if (href.startsWith("//")) {
      return "https:" + href;
    }
    return href;
  } catch {
    return href;
  }
}

function parseSearchResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo Lite HTML structure (as of 2025-2026):
  // <table>
  //   <tr><td colspan="2"><b><a href="DDG-REDIRECT">Title</a></b></td></tr>
  //   <tr>
  //     <td valign="top">&nbsp;</td>
  //     <td valign="top">Snippet text. <span class="link-text">display.url</span></td>
  //   </tr>
  //   <tr><td colspan="2"><hr/></td></tr>
  // </table>
  //
  // Title links: <b><a href="...">Title</a></b>
  // Snippets: <td valign="top"> with substantial content (filter out &nbsp; padding cells)

  const tagRegex = /<[^>]*>/g;
  const entityRegex = /&[a-z]+;/gi;
  const nbspRegex = /\u00a0/g;

  // Extract all title links (inside <b><a href="...">)
  const titleLinkRegex = /<b>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/b>/gi;
  const titleMatches: Array<{ href: string; title: string }> = [];
  let match;
  while ((match = titleLinkRegex.exec(html)) !== null) {
    const href = match[1];
    const title = match[2].replace(tagRegex, "").replace(entityRegex, "").replace(nbspRegex, " ").trim();
    if (title) {
      titleMatches.push({ href, title });
    }
  }

  // Extract all snippet cells (td[valign="top"] with substantial content)
  const snippetRegex = /<td[^>]*valign=["']top["'][^>]*>([\s\S]*?)<\/td>/gi;
  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    const content = match[1].replace(tagRegex, "").replace(entityRegex, "").replace(nbspRegex, " ").trim();
    // Filter out padding cells (only &nbsp; or empty)
    if (content.length > 2 && content !== "\u00a0") {
      snippets.push(content);
    }
  }

  // Pair titles with snippets (they appear in document order: title, then snippet)
  const maxPairs = Math.min(titleMatches.length, snippets.length, limit);
  for (let i = 0; i < maxPairs; i++) {
    const { href, title } = titleMatches[i];
    const snippet = snippets[i] ?? "";
    const resolvedUrl = resolveDuckDuckGoUrl(href);

    let site_name = "";
    try {
      site_name = new URL(resolvedUrl).hostname.replace("www.", "");
    } catch {
      site_name = "";
    }

    results.push({
      position: i + 1,
      site_name,
      title,
      snippet,
      url: resolvedUrl,
    });
  }

  return results;
}

export class DuckDuckGoSearch {
  private static instance: DuckDuckGoSearch;

  private constructor() {}

  static getInstance(): DuckDuckGoSearch {
    if (!DuckDuckGoSearch.instance) {
      DuckDuckGoSearch.instance = new DuckDuckGoSearch();
    }
    return DuckDuckGoSearch.instance;
  }

  /**
   * Performs a web search using DuckDuckGo's Lite HTML endpoint.
   * Returns results in the same format as TinyFish for compatibility.
   */
  async search(
    query: string,
    options: { limit?: number; region?: Region } = {}
  ): Promise<{ results: SearchResult[]; total: number; source: "duckduckgo" }> {
    const limit = options.limit ?? 10;
    const searchUrl = buildSearchUrl(query, options.region);

    try {
      const html = await fetchHtml(searchUrl);
      const results = parseSearchResults(html, limit);

      // Check for challenge page (bot detection)
      if (results.length === 0 && html.includes("bots use DuckDuckGo")) {
        throw new Error("DuckDuckGo challenge page detected (bot detection)");
      }

      updateStatus({ lastError: null, lastErrorAt: null });
      return { results, total: results.length, source: "duckduckgo" };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      updateStatus({ lastError: err.message, lastErrorAt: new Date().toISOString() });
      console.error("DuckDuckGo search failed:", err.message);
      return { results: [], total: 0, source: "duckduckgo" };
    }
  }

  /**
   * Gets the current status of DuckDuckGo search.
   */
  getStatus(): DuckDuckGoStatus {
    return { ..._status };
  }

  /**
   * Checks if the service is healthy.
   */
  isHealthy(): boolean {
    return _status.available && !_status.lastError;
  }
}

export const duckDuckGo = DuckDuckGoSearch.getInstance();