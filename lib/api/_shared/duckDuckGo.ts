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

const DUCKDUCKGO_HTML_URL = "https://lite.duckduckgo.com/lite/";
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

function parseSearchResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  
  // DuckDuckGo Lite HTML structure: table rows with links
  // Each result is in a table row: <tr> <td> <a href="...">Title</a> </td> <td>Snippet</td> </tr>
  const rowRegex = /<tr>\s*<td[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  const tagRegex = /<[^>]*>/g;
  const entityRegex = /&[a-z]+;/gi;

  let match;
  let position = 0;
  
  while ((match = rowRegex.exec(html)) !== null && position < limit) {
    const rawUrl = match[1];
    const title = match[2].replace(tagRegex, "").replace(entityRegex, "").trim();
    const snippet = match[3].replace(tagRegex, "").replace(entityRegex, "").trim();
    
    if (!title) continue;
    
    let site_name = "";
    try {
      site_name = new URL(rawUrl).hostname.replace("www.", "");
    } catch {
      site_name = "";
    }
    
    results.push({
      position: ++position,
      site_name,
      title,
      snippet,
      url: rawUrl,
    });
  }
  
  // Fallback: try to parse classic DuckDuckGo HTML if lite returns no results
  if (results.length === 0) {
    return parseClassicDuckDuckGo(html, limit);
  }
  
  return results;
}

function parseClassicDuckDuckGo(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  
  // Classic DuckDuckGo HTML structure
  const resultRegex = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="result|$)/g;
  const titleRegex = /<a[^>]*class="result__title"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;
  const tagRegex = /<[^>]*>/g;
  const entityRegex = /&[a-z]+;/gi;

  let match;
  let position = 0;
  
  while ((match = resultRegex.exec(html)) !== null && position < limit) {
    const resultHtml = match[1];
    
    const titleMatch = titleRegex.exec(resultHtml);
    const snippetMatch = snippetRegex.exec(resultHtml);
    if (titleMatch) {
      const rawUrl = titleMatch[1];
      const title = titleMatch[2].replace(tagRegex, "").replace(entityRegex, "").trim();
      const snippet = snippetMatch?.[1]?.replace(tagRegex, "").replace(entityRegex, "").trim() ?? "";
      
      let site_name = "";
      try {
        site_name = new URL(rawUrl).hostname.replace("www.", "");
      } catch {
        site_name = "";
      }
      
      results.push({
        position: ++position,
        site_name,
        title,
        snippet,
        url: rawUrl,
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
   * Performs a web search using DuckDuckGo's HTML endpoint.
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