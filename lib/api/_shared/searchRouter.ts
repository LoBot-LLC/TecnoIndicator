import { tinyfishRouter } from "./tinyfishRouter";
import { getCache, setCache } from "./cache";
import { SEARCH_CACHE_MS } from "./http";
import { readConfiguredKeys, TINYFISH_KEY_ENV_NAMES } from "./http";

// Interface matching TinyFishSearchResponse for compatibility
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
  keyIndex: number; // For compatibility, will be -1 for non-TinyFish sources
}

export class SearchRouter {
  private initialized: boolean = false;
  private playwrightMcpAvailable: boolean = false;
  private duckDuckGoAvailable: boolean = true; // Always available as fallback

  constructor() {
    // Check if Playwright MCP is configured via environment variable
    this.playwrightMcpAvailable = !!process.env.PLAYWRIGHT_MCP_ENDPOINT;
    this.duckDuckGoAvailable = true; // DuckDuckGo Lite is always available
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // Initialize TinyFish router if needed
    if (!tinyfishRouter.initialized) {
      await tinyfishRouter.refreshTinyfishStatus(true);
    }
    this.initialized = true;
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
      return { results: [], total: 0, keyIndex: -1 };
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
      keyIndex: -1 // Indicates non-TinyFish source
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

    // Use DuckDuckGo Lite for simpler HTML parsing
    const searchQuery = options.region ? `[${options.region}] ${query}` : query;
    const url = `https://html.duckduckgo.com/lite/?q=${encodeURIComponent(searchQuery)}&kl=us-en`;

    const response = await fetch(url, {
      signal: abortSignal ?? AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TecnoIndicator/1.0; +https://tecnoindicator.vercel.app)"
      }
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo HTTP error: ${response.status}`);
    }

    const html = await response.text();
    const results = this.parseDuckDuckGoLiteHtml(html, options.limit ?? 10);

    return {
      results,
      total: results.length,
      keyIndex: -1 // Indicates non-TinyFish source
    };
  }

  private parseDuckDuckGoLiteHtml(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];
    
    // DuckDuckGo Lite result pattern
    const resultPattern = /<tr[^>]*class="result[^"]*"[^>]*>[\s\S]*?<\/tr>/g;
    let match;
    
    while ((match = resultPattern.exec(html)) && results.length < limit) {
      const trHtml = match[0];
      
      // Extract URL and title
      const urlMatch = trHtml.match(/<a[^>]*class="result__url"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*class="result__snippet"/);
      const titleMatch = trHtml.match(/<a[^>]*class="result__snippet"[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/);
      const snippetMatch = trHtml.match(/<a[^>]*class="result__snippet"[^>]*>[^<]*<\/a>[\s\S]*?<\/tr>/i);
      
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