// Playwright MCP Router for fallback when TinyFish API keys are unavailable
import { sanitizeUrl } from "./http";
import { getCache, setCache } from "./cache";
import { playwrightMcpClient } from "./mcpClient";

export interface PlaywrightMcpState {
  available: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

export interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

export interface TinyFishSearchResponse {
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

export class PlaywrightMcpRouter {
  private state: PlaywrightMcpState = {
    available: false,
    lastCheckedAt: null,
    lastSuccessAt: null,
  };
  private initialized: boolean = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Initialize the MCP client
      await playwrightMcpClient.initialize();
      this.state.available = true;
      this.state.lastCheckedAt = new Date().toISOString();
      this.state.lastSuccessAt = this.state.lastCheckedAt;
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize Playwright MCP:", error);
      this.state.available = false;
      this.state.lastCheckedAt = new Date().toISOString();
      this.initialized = true;
    }
  }

  /**
   * Check if Playwright MCP is available
   */
  async getPlaywrightMcpStatus(): Promise<{
    available: boolean;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }
    return {
      available: this.state.available,
    };
  }

  /**
   * Search using Playwright MCP by navigating to search engines and extracting results
   */
  async playwrightMcpSearch(
    query: string,
    options: { limit?: number } = {},
    abortSignal?: AbortSignal
  ): Promise<TinyFishSearchResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.state.available) {
      return { results: [], total: 0, keyIndex: -1 };
    }

    try {
      const result = await playwrightMcpClient.playwrightMcpSearch(query, options, abortSignal);
      
      if (result.results.length > 0) {
        this.state.lastSuccessAt = new Date().toISOString();
      }
      
      return result;
    } catch (error) {
      console.error("Playwright MCP search failed:", error);
      this.state.available = false;
      this.state.lastCheckedAt = new Date().toISOString();
      
      return { results: [], total: 0, keyIndex: -1 };
    }
  }

  /**
   * Scrape content using Playwright MCP by navigating to URL and extracting text
   */
  async playwrightMcpScrape(
    url: string,
    abortSignal?: AbortSignal
  ): Promise<ScrapedContent | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.state.available) {
      return null;
    }

    try {
      const result = await playwrightMcpClient.playwrightMcpScrape(url, abortSignal);
      
      if (result && result.text.length > 0) {
        this.state.lastSuccessAt = new Date().toISOString();
      }
      
      return result;
    } catch (error) {
      console.error("Playwright MCP scrape failed:", error);
      this.state.available = false;
      this.state.lastCheckedAt = new Date().toISOString();
      
      return null;
    }
  }

  /**
   * Clear caches (useful for testing or when forcing fresh data)
   */
  clearCaches(): void {
    playwrightMcpClient.clearCaches();
  }
}

// Export a singleton instance
export const playwrightMcpRouter = new PlaywrightMcpRouter();