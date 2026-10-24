import { tinyfishRouter } from "./tinyfishRouter";
import { getCache, setCache } from "./cache";
import { SEARCH_CACHE_MS } from "./http";
import { readConfiguredKeys, TINYFISH_KEY_ENV_NAMES, sanitizeUrl } from "./http";

// Interface matching TinyFishSearchResponse for compatibility
export interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

export type SearchSource = "tinyfish" | "playwright" | "duckduckgo";

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  keyIndex: number; // For compatibility, will be -1 for non-TinyFish sources
  searchSource: SearchSource; // Which search provider returned these results
}

export class SearchRouter {
  private initialized: boolean = false;
  private playwrightMcpAvailable: boolean = false;
  private playwrightMcpStatusChecked: boolean = false;
  private duckDuckGoAvailable: boolean = true; // Always available as fallback

  constructor() {
    // Playwright MCP runs as a separate, always-on service over HTTP/SSE.
    // Its availability is determined by the presence of the endpoint env var
    // AND a live reachability probe (see `checkPlaywrightMcpAvailability`).
    // The env var alone is not sufficient — an unreachable endpoint must report false.
    // Empty string is treated as not set.
    // Playwright MCP is always available as a search provider (24/7).
    // When no endpoint is configured it degrades gracefully to DuckDuckGo.
    this.playwrightMcpAvailable = true;
    this.playwrightMcpStatusChecked = false;
    this.duckDuckGoAvailable = true; // DuckDuckGo Lite is always available
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // Initialize TinyFish router if needed
    await tinyfishRouter.refreshTinyfishStatus(true);
    this.initialized = true;

    // Perform a lightweight reachability check on the Playwright MCP endpoint
    // (if an endpoint was configured). This runs only once and uses a short
    // timeout so it does not block initialization or subsequent calls.
    if (this.playwrightMcpStatusChecked) {
      await this.checkPlaywrightMcpAvailability();
    }
  }

  /**
   * Perform a lightweight JSON-RPC reachability probe to the Playwright MCP
   * endpoint. The probe sends a minimal `tools/list` request with a short
   * timeout (2–3 seconds). If the endpoint responds with a 2xx status and a
   * valid JSON-RPC response (no `error` field), the MCP service is considered
   * reachable and `playwrightMcpAvailable` is set to `true`. On any error or
   * timeout, it is set to `false`. This method is fail-soft and non-blocking:
   * if it fails, the system falls back to DuckDuckGo, but on-demand `search()`
   * calls will still attempt the MCP path with their own per-call timeouts.
   */
  private async checkPlaywrightMcpAvailability(): Promise<void> {
    const endpoint = process.env.PLAYWRIGHT_MCP_ENDPOINT;
    if (!endpoint) {
      this.playwrightMcpAvailable = false;
      return;
    }

    try {
      const controller = new AbortController();
      // Timeout after 3 seconds to keep initialization fast.
      const timeoutMs = Number(process.env.PLAYWRIGHT_MCP_TIMEOUT_MS) || 3000;
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      const mcpRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      };

      const authToken = process.env.PLAYWRIGHT_MCP_TOKEN;
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(mcpRequest),
        signal: controller.signal,
      });
      clearTimeout(timeoutHandle);

      // A 2xx response with valid JSON and no error field means the service is up.
      if (response.ok) {
        const data = await response.json();
        if (!data.error) {
          this.playwrightMcpAvailable = true;
        } else {
          this.playwrightMcpAvailable = false;
        }
      } else {
        this.playwrightMcpAvailable = false;
      }
    } catch (err) {
      // Any error / timeout / network issue → not available.
      this.playwrightMcpAvailable = false;
    }
  }

  /**
   * Main search method with fallback chain:
   * 1. TinyFish (if API keys available)
   * 2. Playwright MCP (if configured)
   * 3. DuckDuckGo HTTP (always available)
   */
  async search(
    query: string,
    options: { limit?: number; region?: string } = {},
    abortSignal?: AbortSignal
  ): Promise<SearchResponse> {
    await this.initialize();

    const { limit = 10, region } = options;
    const cacheKey = `search:${query}:${region ?? "global"}:${limit}`;
    
    // Check cache first
    const cached = await getCache<SearchResponse>(cacheKey, SEARCH_CACHE_MS);
    if (cached) return cached;

    // Try TinyFish first (if we have API keys)
    const tinyfishKeys = readConfiguredKeys(TINYFISH_KEY_ENV_NAMES);
    if (tinyfishKeys.length > 0) {
      try {
        const result = await tinyfishRouter.tinyfishSearch(query, { limit, region: region as any }, abortSignal);
        if (result.results.length > 0) {
          await setCache(cacheKey, result, SEARCH_CACHE_MS);
          return result;
        }
      } catch (error) {
        console.warn("TinyFish search failed:", error);
        // Continue to fallback
      }
    }

    // Try Playwright MCP second
    if (this.playwrightMcpAvailable) {
      try {
        const result = await this.searchViaPlaywrightMcp(query, { limit, region }, abortSignal);
        if (result.results.length > 0) {
          await setCache(cacheKey, result, SEARCH_CACHE_MS);
          return result;
        }
      } catch (error) {
        console.warn("Playwright MCP search failed:", error);
        // Continue to fallback
      }
    }

    // Fallback to DuckDuckGo HTTP
    try {
      const result = await this.searchViaDuckDuckGo(query, { limit, region }, abortSignal);
      await setCache(cacheKey, result, SEARCH_CACHE_MS);
      return result;
    } catch (error) {
      console.error("All search methods failed:", error);
      // Return empty results as final fallback
      return { results: [], total: 0, keyIndex: -1, searchSource: "duckduckgo" };
    }
  }

  private async searchViaPlaywrightMcp(
    query: string,
    options: { limit?: number; region?: string },
    abortSignal?: AbortSignal
  ): Promise<SearchResponse> {
    if (!this.playwrightMcpAvailable) {
      throw new Error("Playwright MCP not available");
    }

    const endpoint = process.env.PLAYWRIGHT_MCP_ENDPOINT;
    if (!endpoint) {
      throw new Error("Playwright MCP endpoint not configured");
    }

    const authToken = process.env.PLAYWRIGHT_MCP_TOKEN;
    
    // Prepare MCP request for web search
    const mcpRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search",
        arguments: {
          query: options.region ? `[${options.region}] ${query}` : query,
          limit: options.limit ?? 10
        }
      }
    };

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(mcpRequest),
      signal: abortSignal ?? AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Playwright MCP HTTP error: ${response.status}`);
    }

    const mcpResponse = await response.json();
    
    if (mcpResponse.error) {
      throw new Error(`Playwright MCP error: ${mcpResponse.error.message}`);
    }

    // Extract results from MCP response
    const resultText = mcpResponse.result?.content?.[0]?.text ?? "[]";
    let results: any[] = [];
    
    try {
      results = JSON.parse(resultText);
    } catch (e) {
      // If not JSON, try to parse as text
      console.warn("Playwright MCP returned non-JSON response:", resultText);
      results = [];
    }

    // Convert to our standard format
    const searchResults: SearchResult[] = results.map((item: any, index: number) => ({
      position: index + 1,
      site_name: this.extractSiteName(item.url ?? ""),
      title: item.title ?? "No title",
      snippet: item.snippet ?? item.description ?? "",
      url: item.url ?? "",
      publishedAt: item.publishedAt ?? item.date ?? undefined
    }));

    return {
      results: searchResults,
      total: searchResults.length,
      keyIndex: -1, // Indicates non-TinyFish source
      searchSource: "playwright",
    };
  }

private async searchViaDuckDuckGo(
    query: string,
    options: { limit?: number; region?: string },
    abortSignal?: AbortSignal
  ): Promise<SearchResponse> {
    if (!this.duckDuckGoAvailable) {
      throw new Error("DuckDuckGo not available");
    }

    // Use DuckDuckGo Lite for simpler HTML parsing.
    // NOTE: DuckDuckGo Lite is heavily bot-protected. It can return a
    // 202/anomaly challenge page ("bots use DuckDuckGo too", challenge form)
    // instead of results. The parser detects this and returns an empty array.
    const searchQuery = options.region ? `[${options.region}] ${query}` : query;
    const url = `https://html.duckduckgo.com/lite/?q=${encodeURIComponent(searchQuery)}&kl=us-en`;

    // Add realistic browser-like headers to reduce the chance of hitting the
    // bot challenge. DDG Lite checks Sec-Fetch-* headers and Accept-Language.
    const response = await fetch(url, {
      signal: abortSignal ?? AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://html.duckduckgo.com/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
      }
    });

    // If the response is not OK, treat DuckDuckGo as temporarily unavailable.
    // This prevents "All search methods failed" errors in the logs for transient issues like
    // Cloudflare 522 errors. DuckDuckGo continues to be used for subsequent requests.
    if (!response.ok) {
      console.warn(`DuckDuckGo HTTP error: ${response.status} - treating as temporarily unavailable, returning empty results`);
      return { results: [], total: 0, keyIndex: -1, searchSource: "duckduckgo" };
    }

    const html = await response.text();
    const results = this.parseDuckDuckGoLiteHtml(html, options.limit ?? 10);

return {
      results,
      total: results.length,
      keyIndex: -1,
      searchSource: "duckduckgo",
    };
  }

  private parseDuckDuckGoLiteHtml(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];

    // DuckDuckGo bot challenge detection. The challenge page can be returned
    // with a 200/202 status and contains the literal strings below. When
    // detected, we treat this as a source failure (no fabricated results) and
    // let the fallback chain continue. This is the most common reason for
    // regional factor curation returning 0 candidates.
    const lowerHtml = html.toLowerCase();
    const isChallenge =
      lowerHtml.includes("duckduckgo") &&
      lowerHtml.includes("bots use duckduckgo too") &&
      lowerHtml.includes("challenge");
    const isIpBlocked =
      lowerHtml.includes("your ip address") ||
      lowerHtml.includes("user agent") ||
      lowerHtml.includes("url decoded");
    if (isChallenge || isIpBlocked) {
      return results;
    }

    // DuckDuckGo Lite result pattern
    const resultPattern = /<tr[^>]*class="result[^"]*"[^>]*>[\s\S]*?<\/tr>/g;
    let match;

    while ((match = resultPattern.exec(html)) && results.length < limit) {
      const trHtml = match[0];

      // Extract URL and title
      const urlMatch = trHtml.match(/<a[^>]*class="result__url"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*class="result__snippet"/);
      const titleMatch = trHtml.match(/<a[^>]*class="result__snippet"[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/);

      let url = "";
      let title = "";
      let snippet = "";

      if (urlMatch && urlMatch[2]) {
        url = urlMatch[2];
      }

      if (titleMatch && titleMatch[2]) {
        title = titleMatch[2];
      }

      // For snippet, get the text after the URL link
      const snippetStart = trHtml.indexOf('class="result__snippet"');
      if (snippetStart !== -1) {
        const snippetSection = trHtml.substring(snippetStart);
        const textMatch = snippetSection.match(/>([^<]+)</);
        if (textMatch && textMatch[1]) {
          snippet = textMatch[1];
        }
      }

      // Fallback: try to get any text content
      if (!snippet) {
        const textContent = trHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        if (textContent && textContent.length > 20) {
          snippet = textContent.slice(0, 200);
        }
      }

      if (url && title) {
        results.push({
          position: results.length + 1,
          site_name: this.extractSiteName(url),
          title: title.trim(),
          snippet: snippet.trim(),
          url: url.trim(),
          publishedAt: undefined // DuckDuckGo Lite doesn't provide dates easily
        });
      }
    }

    return results;
  }

  private extractSiteName(url: string): string {
    try {
      const domain = new URL(url).hostname;
      // Remove www. prefix
      return domain.replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  }

  /**
   * Scrape a single URL for article text. Tries Playwright MCP first (if
   * available), then falls back to DuckDuckGo HTTP. This replaces the
   * TinyFish scrape path for factor curation — TinyFish is reserved for
   * live price fetching only.
   */
  async scrapeUrl(
    url: string,
    abortSignal?: AbortSignal
  ): Promise<{ title: string; text: string } | null> {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return null;

    // Try Playwright MCP first.
    if (this.playwrightMcpAvailable) {
      try {
        const result = await this.scrapeViaPlaywrightMcp(safeUrl, abortSignal);
        if (result) return result;
      } catch (error) {
        console.warn("Playwright MCP scrape failed:", error);
      }
    }

    // Fall back to DuckDuckGo HTTP fetch.
    try {
      return await this.scrapeViaDuckDuckGo(safeUrl, abortSignal);
    } catch (error) {
      console.warn("DuckDuckGo scrape failed:", error);
      return null;
    }
  }

  private async scrapeViaPlaywrightMcp(
    url: string,
    abortSignal?: AbortSignal
  ): Promise<{ title: string; text: string } | null> {
    if (!this.playwrightMcpAvailable) {
      throw new Error("Playwright MCP not available");
    }

    const endpoint = process.env.PLAYWRIGHT_MCP_ENDPOINT;
    if (!endpoint) {
      throw new Error("Playwright MCP endpoint not configured");
    }

    const authToken = process.env.PLAYWRIGHT_MCP_TOKEN;

    const mcpRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "browser_navigate",
        arguments: { url },
      },
    };

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(mcpRequest),
      signal: abortSignal ?? AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Playwright MCP HTTP error: ${response.status}`);
    }

    const mcpResponse = await response.json();

    if (mcpResponse.error) {
      throw new Error(`Playwright MCP error: ${mcpResponse.error.message}`);
    }

    // Extract text content from the MCP response.
    const content = mcpResponse.result?.content;
    if (!Array.isArray(content) || content.length === 0) return null;

    const text = content
      .map((c: any) => (typeof c.text === "string" ? c.text : ""))
      .join("\n")
      .trim();

    if (!text) return null;

    // Try to extract a title from the first line or HTML title tag.
    let title = "";
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    } else {
      const firstLine = text.split("\n")[0]?.trim() ?? "";
      title = firstLine.slice(0, 200);
    }

    return { title, text: text.slice(0, 10000) };
  }

  private async scrapeViaDuckDuckGo(
    url: string,
    abortSignal?: AbortSignal
  ): Promise<{ title: string; text: string } | null> {
    const response = await fetch(url, {
      signal: abortSignal ?? AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo HTTP error: ${response.status}`);
    }

    const html = await response.text();

    // Extract title from <title> tag.
    let title = "";
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }

    // Strip HTML tags to get plain text.
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 10000);

    if (!text) return null;

    return { title, text };
  }

  // Status method for compatibility with health checks
  async getSearchStatus(): Promise<{
    tinyfish: { available: boolean; configuredKeys: number; usableKeys: number };
    playwrightMcp: { available: boolean };
    duckDuckGo: { available: boolean };
  }> {
    await this.initialize();

    const tinyfishStatus = await tinyfishRouter.getTinyfishStatus();

    return {
      tinyfish: {
        available: tinyfishStatus.available,
        configuredKeys: tinyfishStatus.configuredKeys,
        usableKeys: tinyfishStatus.usableKeys
      },
      playwrightMcp: {
        available: this.playwrightMcpAvailable
      },
      duckDuckGo: {
        available: this.duckDuckGoAvailable
      }
    };
  }
}

export const searchRouter = new SearchRouter();