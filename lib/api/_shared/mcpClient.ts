// MCP Client for connecting to Playwright MCP server
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ReadResourceResult, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { sanitizeUrl } from "./http";

/**
 * Result format matching TinyFish API responses
 */
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

export class PlaywrightMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | null = null;
  private initialized: boolean = false;
  private initializingPromise: Promise<void> | null = null;
  
  private readonly SEARCH_CACHE_MS = 60_000; // 1 minute
  private readonly SCRAPE_CACHE_MS = 10 * 60_000; // 10 minutes
  
  // Cache for responses to avoid repeated MCP calls
  private searchCache: Map<string, { result: TinyFishSearchResponse; timestamp: number }> = new Map();
  private scrapeCache: Map<string, { result: ScrapedContent | null; timestamp: number }> = new Map();

  /**
   * Initialize the MCP client connection
   * @param host Optional SSE host (if not provided, uses stdio transport)
   */
  async initialize(host?: string): Promise<void> {
    if (this.initialized) return;
    
    if (this.initializingPromise) {
      await this.initializingPromise;
      return;
    }
    
    this.initializingPromise = this._doInitialize(host);
    await this.initializingPromise;
  }
  
  private async _doInitialize(host?: string): Promise<void> {
    try {
      if (host) {
        // Use SSE transport (connect to existing MCP server)
        console.log(`Connecting to Playwright MCP server at ${host}`);
        this.transport = new SSEClientTransport(new URL(`${host}/messages`));
      } else {
        // Use stdio transport (spawn MCP server as child process)
        console.log("Starting Playwright MCP server via stdio");
        this.transport = new StdioClientTransport({
          command: "npx",
          args: ["@playwright/mcp@latest"],
        });
      }
      
      this.client = new Client({ 
        name: "tecnoindicator-mcp-client", 
        version: "0.0.0" 
      });
      
      await this.client.connect(this.transport);
      this.initialized = true;
      
      console.log("Successfully connected to Playwright MCP server");
    } catch (error) {
      console.error("Failed to initialize Playwright MCP client:", error);
      this.initialized = false;
      throw error;
    } finally {
      this.initializingPromise = null;
    }
  }
  
  /**
   * Check if the MCP client is initialized and connected
   */
  async isAvailable(): Promise<boolean> {
    if (!this.initialized) {
      try {
        await this.initialize();
      } catch (error) {
        return false;
      }
    }
    return this.client !== null && this.transport !== null;
  }
  
  /**
   * Search using Playwright MCP via browser navigation and content extraction
   * This simulates a search by navigating to a search engine and extracting results
   */
  async playwrightMcpSearch(
    query: string,
    options: { limit?: number } = {},
    abortSignal?: AbortSignal
  ): Promise<TinyFishSearchResponse> {
    if (!this.initialized) {
      try {
        await this.initialize();
      } catch (error) {
        console.error("Failed to initialize MCP client for search:", error);
        return { results: [], total: 0, keyIndex: -1 };
      }
    }
    
    // Check cache first
    const cacheKey = `playwright:search:${query}:${options.limit ?? 10}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.SEARCH_CACHE_MS) {
      return cached.result;
    }
    
    if (!this.client || !this.transport) {
      return { results: [], total: 0, keyIndex: -1 };
    }
    
    try {
      // Navigate to DuckDuckGo search
      await this.client.callTool({
        name: "browser_navigate",
        arguments: {
          url: `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        }
      });
      
      // Wait a bit for page to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get page content
      const pageContentResult = await this.client.callTool({
        name: "browser_get_page_content",
        arguments: {}
      }) as CallToolResult;
      
      const pageContent = typeof pageContentResult.content[0] === "object" && "text" in pageContentResult.content[0] 
        ? pageContentResult.content[0].text 
        : "";
      
      // Parse search results from HTML (simplified)
      const results: SearchResult[] = this.parseSearchResults(pageContent, options.limit ?? 10);
      
      const result: TinyFishSearchResponse = {
        results,
        total: results.length,
        keyIndex: -1, // Indicates this came from Playwright MCP
      };
      
      // Cache the result
      this.searchCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.error("Playwright MCP search failed:", error);
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
      try {
        await this.initialize();
      } catch (error) {
        console.error("Failed to initialize MCP client for scrape:", error);
        return null;
      }
    }
    
    // Check cache first
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return null;
    
    const cacheKey = `playwright:scrape:${safeUrl}`;
    const cached = this.scrapeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.SCRAPE_CACHE_MS) {
      return cached.result;
    }
    
    if (!this.client || !this.transport) {
      return null;
    }
    
    try {
      // Navigate to the URL
      await this.client.callTool({
        name: "browser_navigate",
        arguments: {
          url: safeUrl
        }
      });
      
      // Wait a bit for page to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get page title
      const titleResult = await this.client.callTool({
        name: "browser_evaluate",
        arguments: {
          function: "() => document.title"
        }
      }) as CallToolResult;
      const title = typeof titleResult.content[0] === "object" && "text" in titleResult.content[0] 
        ? titleResult.content[0].text 
        : "";
      
      // Get page text content (simplified - get body text)
      const textResult = await this.client.callTool({
        name: "browser_evaluate",
        arguments: {
          function: "() => document.body.innerText.slice(0, 10000)"
        }
      }) as CallToolResult;
      const text = typeof textResult.content[0] === "object" && "text" in textResult.content[0] 
        ? textResult.content[0].text 
        : "";
      
      const result: ScrapedContent = {
        url: safeUrl,
        title: title || "",
        text: text || "",
        keyIndex: -1, // Indicates this came from Playwright MCP
      };
      
      // Cache the result
      this.scrapeCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.error("Playwright MCP scrape failed:", error);
      return null;
    }
  }
  
  /**
   * Parse search results from DuckDuckGo HTML (simplified implementation)
   */
  private parseSearchResults(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];
    
    // Simple regex-based parsing for DuckDuckGo results
    // This is a simplified implementation - in production you'd want more robust parsing
    const resultPattern = /<a[^>]*class="result__url"[^>]*>([^<]+)<\/a>[^<]*<a[^>]*class="result__snippet"[^>]*>([^<]+)<\/a>/g;
    let match;
    let position = 0;
    
    while ((match = resultPattern.exec(html)) && results.length < limit) {
      const siteName = match[1].trim() || "Unknown";
      const snippet = match[2].trim() || "";
      
      // Try to extract URL (simplified)
      const urlMatch = html.slice(0, match.index).match(/https?:\/\/[^\s"'>]+/);
      const url = urlMatch ? urlMatch[0] : "https://duckduckgo.com";
      
      results.push({
        position: ++position,
        site_name: siteName,
        title: siteName, // Simplified - in reality we'd extract the actual title
        snippet,
        url,
        publishedAt: undefined,
      });
    }
    
    // If we didn't get enough results with the above pattern, try another approach
    if (results.length === 0) {
      // Fallback: look for any links that might be results
      const linkPattern = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
      let linkMatch;
      while ((linkMatch = linkPattern.exec(html)) && results.length < limit) {
        const url = linkMatch[1];
        const text = linkMatch[2].trim();
        
        // Skip navigation links, ads, etc.
        if (!url.includes("duckduckgo.com") && text.length > 10) {
          results.push({
            position: ++position,
            site_name: new URL(url).hostname || "Unknown",
            title: text,
            snippet: text.substring(0, Math.min(100, text.length)),
            url,
            publishedAt: undefined,
          });
        }
      }
    }
    
    return results;
  }
  
  /**
   * Get the status of the MCP connection
   */
  async getStatus(): Promise<{
    available: boolean;
  }> {
    try {
      const available = await this.isAvailable();
      return { available };
    } catch (error) {
      return { available: false };
    }
  }
  
  /**
   * Clear caches (useful for testing or when forcing fresh data)
   */
  clearCaches(): void {
    this.searchCache.clear();
    this.scrapeCache.clear();
  }
  
  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
      }
      if (this.transport) {
        // StdioClientTransport and SSEClientTransport don't have a close method in the SDK
        // They are cleaned up when the client closes
      }
    } catch (error) {
      console.error("Error disconnecting from MCP server:", error);
    } finally {
      this.client = null;
      this.transport = null;
      this.initialized = false;
    }
  }
}

// Export a singleton instance
export const playwrightMcpClient = new PlaywrightMcpClient();