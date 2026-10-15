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
// Also try the HTML endpoint as fallback
const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const SEARCH_TIMEOUT_MS = Number(process.env.DUCKDUCKGO_SEARCH_TIMEOUT_MS ?? 10000);

// Rotating user agents to avoid bot detection
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

let _status: DuckDuckGoStatus = {
  available: true,
  lastError: null,
  lastErrorAt: null,
};

function updateStatus(partial: Partial<DuckDuckGoStatus>): void {
  _status = { ..._status, ...partial };
}

function extractPublishedAt(snippet: string): string | undefined {
  // Try to extract publication date from snippet text
  // Patterns: "Feb 10, 2025 -", "January 15, 2024", "2 days ago", "3 hours ago", etc.
  const datePatterns = [
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i,  // "Jan 15, 2024"
    /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i,  // "15 January 2024"
    /(?:\d+)\s+(?:days?|hours?|weeks?|months?|years?)\s+ago/i,  // "3 days ago", "2 hours ago"
  ];

  for (const pattern of datePatterns) {
    const match = snippet.match(pattern);
    if (match) {
      return match[0];
    }
  }

  // Try to find a date in ISO format or other common formats
  const isoMatch = snippet.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) {
    return isoMatch[0];
  }

  return undefined;
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

function buildHtmlSearchUrl(query: string, region?: Region): string {
  const params = new URLSearchParams({
    q: query,
    kl: regionToDuckDuckGoRegion(region),
    df: "2026-01..2026-12",
    ia: "web",
  });
  return `${DUCKDUCKGO_HTML_URL}?${params.toString()}`;
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
        "User-Agent": getRandomUserAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
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
      publishedAt: extractPublishedAt(snippet),
    });
  }

  return results;
}

// Parse classic DuckDuckGo HTML structure (https://html.duckduckgo.com/html/)
function parseClassicDuckDuckGo(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Classic DuckDuckGo HTML structure:
  // <div class="result results_links results_links_deep web-result">
  //   <div class="result__body">
  //     <h2 class="result__title">
  //       <a class="result__a" href="REDIRECT_URL">Title Text</a>
  //     </h2>
  //     <div class="result__extras">
  //       <span class="result__url">display.url.com</span>
  //     </div>
  //     <a class="result__snippet">Snippet text...</a>
  //   </div>
  // </div>

  const tagRegex = /<[^>]*>/g;
  const entityRegex = /&[a-z]+;/gi;
  const nbspRegex = /\u00a0/g;

  // Extract result containers
  const resultRegex = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="result|$)/g;
  const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  let match;
  let position = 0;

  while ((match = resultRegex.exec(html)) !== null && position < limit) {
    const resultHtml = match[1];

    const titleMatch = titleRegex.exec(resultHtml);
    const snippetMatch = snippetRegex.exec(resultHtml);

    if (titleMatch) {
      const rawUrl = titleMatch[1];
      const title = titleMatch[2].replace(tagRegex, "").replace(entityRegex, "").replace(nbspRegex, " ").trim();
      const snippet = snippetMatch?.[1]?.replace(tagRegex, "").replace(entityRegex, "").replace(nbspRegex, " ").trim() ?? "";

      const resolvedUrl = resolveDuckDuckGoUrl(rawUrl);

      let site_name = "";
      try {
        site_name = new URL(resolvedUrl).hostname.replace("www.", "");
      } catch {
        site_name = "";
      }

      results.push({
        position: ++position,
        site_name,
        title,
        snippet,
        url: resolvedUrl,
        publishedAt: extractPublishedAt(snippet),
      });
    }
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

    // Try both endpoints: Lite first (lighter), then HTML as fallback
    const endpoints = [
      { name: "lite", url: buildSearchUrl(query, options.region) },
      { name: "html", url: buildHtmlSearchUrl(query, options.region) },
    ];

    let lastError: Error | null = null;

    for (const endpoint of endpoints) {
      try {
        const html = await fetchHtml(endpoint.url);
        const results = endpoint.name === "lite"
          ? parseSearchResults(html, limit)
          : parseClassicDuckDuckGo(html, limit);

        // Check for challenge page (bot detection)
        const isChallenge = results.length === 0 && (
          html.includes("bots use DuckDuckGo") ||
          html.includes("challenge") ||
          html.includes("captcha") ||
          html.includes("Please verify you are human")
        );

        if (isChallenge) {
          lastError = new Error(`DuckDuckGo ${endpoint.name} challenge page detected (bot detection)`);
          continue; // Try next endpoint
        }

        if (results.length > 0) {
          updateStatus({ lastError: null, lastErrorAt: null });
          return { results, total: results.length, source: "duckduckgo" };
        }
        // No results but not a challenge - try next endpoint
        lastError = new Error(`DuckDuckGo ${endpoint.name} returned 0 results`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // All endpoints failed
    const err = lastError ?? new Error("DuckDuckGo search failed: all endpoints exhausted");
    updateStatus({ lastError: err.message, lastErrorAt: new Date().toISOString() });
    console.error("DuckDuckGo search failed:", err.message);
    return { results: [], total: 0, source: "duckduckgo" };
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