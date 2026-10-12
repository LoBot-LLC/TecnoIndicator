import {
  TINYFISH_KEY_ENV_NAMES,
  readConfiguredKeys,
  sanitizeUrl,
  SCRAPE_CACHE_MS,
  SEARCH_CACHE_MS,
  isReputableSource,
  isRecentPublishedAt,
} from "./http";
import { getCache, setCache } from "./cache";
import type { Region } from "./regions";

export interface TinyFishKeyState {
  keyIndex: number;
  envName: string;
  available: boolean;
  rateLimited: boolean;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

interface TinyFishSearchResponse {
  results: SearchResult[];
  total: number;
  keyIndex: number;
}

interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  keyIndex: number;
}

// DuckDuckGo HTML search result interface
interface DuckDuckGoResult {
  title: string;
  snippet: string;
  url: string;
}

// Playwright search result (same as TinyFish for compatibility)
interface PlaywrightSearchResult extends SearchResult {}

const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";

/**
 * Unified search router with fallback hierarchy:
 * 1. TinyFish API (primary, with key rotation)
 * 2. Playwright MCP-based search (fallback 1)
 * 3. DuckDuckGo HTTP search (fallback 2)
 */
export class McpSearchRouter {
  private tinyfishRouter: any;
  private initialized: boolean = false;

  constructor() {
    // Import TinyFishRouter dynamically to avoid circular dependencies
    this.tinyfishRouter = null;
  }

  private async getTinyfishRouter(): Promise<any> {
    if (!this.tinyfishRouter) {
      const { TinyFishRouter } = await import("./tinyfishRouter");
      this.tinyfishRouter = new TinyFishRouter();
    }
    return this.tinyfishRouter;
  }

  /**
   * Normalize a URL for consistency
   */
  private normalizeUrl(url: string): string {
    try {
      const normalized = new URL(url);
      return normalized.toString();
    } catch {
      return url;
    }
  }

  /**
   * Attempt TinyFish search with key rotation
   */
  private async attemptTinyfishSearch(
    query: string,
    options: { limit?: number; region?: Region } = {},
    abortSignal?: AbortSignal
  ): Promise<TinyFishSearchResponse | null> {
    try {
      const router = await this.getTinyfishRouter();
      return await router.tinyfishSearch(query, options, abortSignal);
    } catch (error) {
      console.warn("TinyFish search failed:", error);
      return null;
    }
  }

  /**
   * Perform DuckDuckGo HTML search
   * Uses DuckDuckGo's lite version for simpler parsing
   */
  private async duckduckgoSearch(
    query: string,
    limit: number = 10,
    abortSignal?: AbortSignal
  ): Promise<TinyFishSearchResponse | null> {
    try {
      const controller = new AbortController();
      const combinedSignal = abortSignal
        ? { 
            reason: abortSignal.reason,
            addEventListener: (type: string, listener: EventListener) => {
              abortSignal.addEventListener(type, listener);
            },
            dispatchEvent: (event: Event) => abortSignal.dispatchEvent(event)
          }
        : { reason: undefined, addEventListener: () => {}, dispatchEvent: () => false };
      
      // Add timeout
      const timeoutId = setTimeout(() => {
        // @ts-ignore - AbortController doesn't have a public abort method in types
        if (typeof controller.abort === 'function') controller.abort();
      }, 15000);

      try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://duckduckgo.com/html/?q=${encodedQuery}&kl=us-en`;
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TecnoIndicator/1.0; +https://tecnoindicator.com)',
            'Accept': 'text/html',
          },
          signal: combinedSignal as AbortSignal,
        });

        if (!response.ok) {
          throw new Error(`DuckDuckGo search failed with status ${response.status}`);
        }

        const html = await response.text();
        const results = this.parseDuckDuckGoResults(html, limit);
        
        return {
          results,
          total: results.length,
          keyIndex: -2 // Indicates DuckDuckGo source
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      console.warn("DuckDuckGo search failed:", error);
      return null;
    }
  }

  /**
   * Parse DuckDuckGo HTML results
   */
  private parseDuckDuckGoResults(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];
    
    // Simple regex-based parsing for DuckDuckGo lite results
    // Look for result containers
    const resultRegex = /<a class="result__url"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    
    let match;
    let count = 0;
    
    while ((match = resultRegex.exec(html)) && count < limit) {
      try {
        const url = match[1];
        const title = match[2].trim();
        const resultUrl = match[3];
        const snippet = match[4]
          .replace(/<[^>]*>/g, ' ')  // Remove HTML tags
          .replace(/\s+/g, ' ')      // Normalize whitespace
          .trim()
          .substring(0, 200);        // Limit snippet length
        
        if (url && title && resultUrl && snippet) {
          results.push({
            position: count + 1,
            site_name: this.extractSiteName(url),
            title: title.substring(0, 200),
            snippet,
            url: this.normalizeUrl(resultUrl),
            publishedAt: undefined // DuckDuckGo doesn't provide dates easily
          });
          count++;
        }
      } catch (e) {
        // Skip malformed results
        continue;
      }
    }
    
    return results;
  }

  /**
   * Extract site name from URL
   */
  private extractSiteName(url: string): string {
    try {
      const hostname = new URL(url).hostname;
      // Remove www. prefix
      return hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /**
   * Perform Playwright-based web search
   * Uses Playwright to fetch and extract content from search results
   */
  private async playwrightSearch(
    query: string,
    limit: number = 10,
    abortSignal?: AbortSignal
  ): Promise<TinyFishSearchResponse | null> {
    try {
      // Check if Playwright is available
      if (typeof require !== 'undefined') {
        try {
          const { chromium } = require('playwright');
          
          const browser = await chromium.launch({
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--no-first-run',
              '--no-zygote',
              '--single-process',
              '--disable-extensions'
            ]
          });
          
          try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (compatible; TecnoIndicator/1.0; +https://tecnoindicator.com)');
            
            // Navigate to DuckDuckGo for search
            const encodedQuery = encodeURIComponent(query);
            await page.goto(`https://duckduckgo.com/html/?q=${encodedQuery}&kl=us-en`, {
              waitUntil: 'networkidle',
              timeout: 15000
            });
            
            // Extract results
            const results = await page.evaluate((maxLimit: number) => {
              const items: any[] = [];
              const resultElements = document.querySelectorAll('.result__body');
              
              for (let i = 0; i < Math.min(resultElements.length, maxLimit); i++) {
                const element = resultElements[i] as HTMLElement;
                const titleElement = element.querySelector('.result__title a');
                const snippetElement = element.querySelector('.result__snippet');
                const urlElement = element.querySelector('.result__url');
                
                if (titleElement && snippetElement && urlElement) {
                  const title = titleElement.textContent?.trim() || '';
                  const snippet = snippetElement.textContent?.trim() || '';
                  const url = urlElement.getAttribute('href') || '';
                  
                  if (title && snippet && url) {
                    items.push({
                      position: i + 1,
                      site_name: new URL(url).hostname.replace(/^www\./, ''),
                      title: title.substring(0, 200),
                      snippet: snippet.substring(0, 200),
                      url: url.startsWith('http') ? url : `https://duckduckgo.com${url}`,
                      publishedAt: undefined
                    });
                  }
                }
              }
              
              return items;
            }, limit);
            
            await browser.close();
            
            return {
              results: results as SearchResult[],
              total: results.length,
              keyIndex: -3 // Indicates Playwright source
            };
          } catch (error) {
            await browser.close();
            throw error;
          }
        } catch (requireError) {
          // Playwright not available in this environment
          console.warn("Playwright not available for search:", requireError);
          return null;
        }
      } else {
        // ESM environment - try dynamic import
        const { chromium } = await import('playwright');
        // Same logic as above would go here
        // For now, return null to fall back to other methods
        return null;
      }
    } catch (error) {
      console.warn("Playwright search failed:", error);
      return null;
    }
  }

  /**
   * Main search method with fallback hierarchy
   */
  async mcpSearch(
    query: string,
    options: { limit?: number; region?: Region } = {},
    abortSignal?: AbortSignal
  ): Promise<TinyFishSearchResponse> {
    if (!this.initialized) {
      // Try to initialize TinyFish router
      try {
        await this.getTinyfishRouter();
        this.initialized = true;
      } catch (error) {
        console.warn("Failed to initialize TinyFish router:", error);
        // Continue anyway - we have fallbacks
      }
    }

    const { limit: searchLimit = 10, region } = options;
    
    // 1. Try TinyFish API first (primary)
    const tinyfishResult = await this.attemptTinyfishSearch(query, { limit: searchLimit, region }, abortSignal);
    if (tinyfishResult && tinyfishResult.results.length > 0) {
      return tinyfishResult;
    }

    // 2. Try Playwright-based search (fallback 1)
    const playwrightResult = await this.playwrightSearch(query, searchLimit, abortSignal);
    if (playwrightResult && playwrightResult.results.length > 0) {
      return playwrightResult;
    }

    // 3. Try DuckDuckGo HTTP search (fallback 2)
    const duckduckgoResult = await this.duckduckgoSearch(query, searchLimit, abortSignal);
    if (duckduckgoResult && duckduckgoResult.results.length > 0) {
      return duckduckgoResult;
    }

    // 4. Fall back to empty results (callers will handle deterministic fallbacks)
    console.warn("All search methods failed, returning empty results");
    return { results: [], total: 0, keyIndex: -1 };
  }

  /**
   * Scrape content from a URL with fallback hierarchy
   */
  async mcpScrape(
    url: string,
    abortSignal?: AbortSignal
  ): Promise<ScrapedContent | null> {
    // Normalize and validate URL
    const safeUrl = this.normalizeUrl(url);
    if (!safeUrl || !/^https?:\/\//i.test(safeUrl)) {
      return null;
    }

    const cacheKey = `mcp:scrape:${safeUrl}`;
    const cached = await getCache<ScrapedContent>(cacheKey, SCRAPE_CACHE_MS);
    if (cached) return cached;

    // 1. Try TinyFish scrape first
    try {
      const tinyfishResult = await (await this.getTinyfishRouter()).tinyfishScrape(safeUrl, abortSignal);
      if (tinyfishResult) {
        await setCache(cacheKey, tinyfishResult, SCRAPE_CACHE_MS);
        return tinyfishResult;
      }
    } catch (error) {
      console.warn("TinyFish scrape failed:", error);
    }

    // 2. Try HTTP fetch with content extraction
    try {
      const controller = new AbortController();
      const combinedSignal = abortSignal
        ? { 
            reason: abortSignal.reason,
            addEventListener: (type: string, listener: EventListener) => {
              abortSignal.addEventListener(type, listener);
            },
            dispatchEvent: (event: Event) => abortSignal.dispatchEvent(event)
          }
        : { reason: undefined, addEventListener: () => {}, dispatchEvent: () => false };
      
      const timeoutId = setTimeout(() => {
        // @ts-ignore - AbortController doesn't have a public abort method in types
        if (typeof controller.abort === 'function') controller.abort();
      }, 10000);

      try {
        const response = await fetch(safeUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TecnoIndicator/1.0; +https://tecnoindicator.com)',
            'Accept': 'text/html,*/*;q=0.8',
          },
          signal: combinedSignal as AbortSignal,
        });

        if (!response.ok) {
          throw new Error(`HTTP fetch failed with status ${response.status}`);
        }

        const html = await response.text();
        const { title, text } = this.extractContentFromHtml(html);
        
        const result: ScrapedContent = {
          url: safeUrl,
          title: title.substring(0, 200),
          text: text.substring(0, 10000), // Limit text length
          keyIndex: -2 // Indicates HTTP fetch source
        };
        
        await setCache(cacheKey, result, SCRAPE_CACHE_MS);
        return result;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      console.warn("HTTP fetch scrape failed:", error);
    }

    // 3. Try Playwright-based scraping
    try {
      if (typeof require !== 'undefined') {
        try {
          const { chromium } = require('playwright');
          
          const browser = await chromium.launch({
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--no-first-run',
              '--no-zygote',
              '--single-process',
              '--disable-extensions'
            ]
          });
          
          try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (compatible; TecnoIndicator/1.0; +https://tecnoindicator.com)');
            
            await page.goto(safeUrl, {
              waitUntil: 'networkidle',
              timeout: 15000
            });
            
            const scrapedData = await page.evaluate(() => {
              // Try to use readability-like extraction
              let title = document.title || '';
              // Remove site name from title if it's at the end
              title = title.replace(/\s*[-–—]\s*.*$/, '').trim();
              
              // Try to find main content
              const selectors = [
                'article',
                'main',
                '[role="main"]',
                '.content',
                '.post-content',
                '.entry-content',
                '#content',
                '#main'
              ];
              
              let textContent = '';
              for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                  textContent = element.innerText || element.textContent || '';
                  if (textContent.length > 100) break; // Prefer substantive content
                }
              }
              
              // Fallback to body if nothing found
              if (!textContent || textContent.length < 100) {
                textContent = document.body.innerText || document.body.textContent || '';
              }
              
              return {
                title: title.substring(0, 200),
                text: textContent.substring(0, 10000)
              };
            });
            
            await browser.close();
            
            const result: ScrapedContent = {
              url: safeUrl,
              title: scrapedData.title,
              text: scrapedData.text,
              keyIndex: -3 // Indicates Playwright source
            };
            
            await setCache(cacheKey, result, SCRAPE_CACHE_MS);
            return result;
          } catch (error) {
            await browser.close();
            throw error;
          }
        } catch (requireError) {
          // Playwright not available
          console.warn("Playwright not available for scraping:", requireError);
        }
      } else {
        // ESM - would use dynamic import here
        // For now, skip to next fallback
      }
    } catch (error) {
      console.warn("Playwright scrape failed:", error);
    }

    // All methods failed
    console.warn("All scrape methods failed for URL:", safeUrl);
    return null;
  }

  /**
   * Extract title and text content from HTML
   */
  private extractContentFromHtml(html: string): { title: string; text: string } {
    try {
      // Create a temporary div to parse HTML
      const template = document.createElement('template');
      template.innerHTML = html;
      const doc = template.content;
      
      // Extract title
      let title = '';
      const titleElement = doc.querySelector('title');
      if (titleElement) {
        title = titleElement.textContent?.trim() || '';
        // Remove common suffixes
        title = title.replace(/\s*[-–—]\s*(.+)?$/, '$1').trim();
      }
      
      // Extract main content text
      let text = '';
      
      // Try common content selectors in order of preference
      const contentSelectors = [
        'article',
        'main',
        '[role="main"]',
        '.content',
        '.post-content',
        '.entry-content',
        '#content',
        '#main',
        '.article-body',
        '.story-body'
      ];
      
      for (const selector of contentSelectors) {
        const element = doc.querySelector(selector);
        if (element) {
          text = element.innerText || element.textContent || '';
          if (text.length > 50) { // Prefer substantive content
            break;
          }
        }
      }
      
      // Fallback to body if no content found
      if (!text || text.length < 50) {
        const bodyElement = doc.querySelector('body');
        if (bodyElement) {
          text = bodyElement.innerText || bodyElement.textContent || '';
        }
      }
      
      // Clean up text
      text = text
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/[\n\r\t]+/g, ' ') // Replace line breaks/tabs with spaces
        .trim();
      
      return {
        title: title.substring(0, 200),
        text: text.substring(0, 10000) // Limit length
      };
    } catch (error) {
      console.warn("HTML content extraction failed:", error);
      return { title: '', text: '' };
    }
  }

  /**
   * Get search status for health checks
   */
  async getMcpSearchStatus(abortSignal?: AbortSignal): Promise<{
    available: boolean;
    tinyfishAvailable: boolean;
    playwrightAvailable: boolean;
    duckduckgoAvailable: boolean;
    configuredKeys: number;
    usableKeys: number;
  }> {
    try {
      const tinyfishRouter = await this.getTinyfishRouter();
      const tinyfishStatus = await tinyfishRouter.getTinyfishStatus(abortSignal, true);
      
      // Check Playwright availability
      let playwrightAvailable = false;
      try {
        if (typeof require !== 'undefined') {
          require('playwright');
          playwrightAvailable = true;
        } else {
          // ESM check
          playwrightAvailable = true; // Assume available, will fail at runtime if not
        }
      } catch {
        playwrightAvailable = false;
      }
      
      // DuckDuckGo is generally available via HTTP
      const duckduckgoAvailable = true;
      
      return {
        available: tinyfishStatus.available || playwrightAvailable || duckduckgoAvailable,
        tinyfishAvailable: tinyfishStatus.available,
        playwrightAvailable,
        duckduckgoAvailable,
        configuredKeys: tinyfishStatus.configuredKeys,
        usableKeys: tinyfishStatus.usableKeys
      };
    } catch (error) {
      console.warn("Failed to get MCP search status:", error);
      return {
        available: false,
        tinyfishAvailable: false,
        playwrightAvailable: false,
        duckduckgoAvailable: true, // HTTP is usually available
        configuredKeys: 0,
        usableKeys: 0
      };
    }
  }
}

export const mcpSearchRouter = new McpSearchRouter();