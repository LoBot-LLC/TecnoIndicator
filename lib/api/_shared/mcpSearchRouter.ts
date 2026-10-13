import {
  SCRAPE_CACHE_MS,
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
  public async duckduckgoSearch(
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
        
        // Set sourceType on all results
        const resultsWithSource = results.map(r => ({ ...r, sourceType: "duckduckgo" as const }));
        
        return {
          results: resultsWithSource,
          total: resultsWithSource.length,
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
   * Handles both old (class-based) and new (data-testid-based) DuckDuckGo HTML structures
   */
  private parseDuckDuckGoResults(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];
    
    // Try to extract results using the NEW data-testid-based structure first
    // New DDG structure (2024+): <div data-testid="result"> <h2> <a data-testid="result-title-a" href="URL">Title</a> </h2> <div data-result="snippet">Snippet</div> </div>
    const newContainerRegex = /<div\s[^>]*data-testid=["']result["'][^>]*>([\s\S]*?)<\/div>/gi;
    let containerMatch;
    let count = 0;
    
    while ((containerMatch = newContainerRegex.exec(html)) && count < limit && results.length < limit) {
      const containerHtml = containerMatch[1];
      
      // Extract title link using data-testid="result-title-a" (new style)
      const titleMatch = containerHtml.match(/<a\s[^>]*data-testid=["']result-title-a["'][^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleMatch) {
        // Try fallback: <a> tag with title text in h2 (another new style)
        const titleFallback = containerHtml.match(/<h2><a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i);
        if (titleFallback) {
          const url = titleFallback[1];
          const title = titleFallback[2].replace(/<[^>]*>/g, ' ').trim();
          const snippet = title; // No snippet in this case
          
          if (!url || url.includes('duckduckgo.com')) continue;
          if (title.length < 10 || title.length > 200) continue;
          
          const cleanUrl = this.normalizeUrl(url);
          const siteName = cleanUrl ? this.extractSiteName(cleanUrl) : '';
          
          if (!results.some(r => r.url === cleanUrl)) {
            results.push({
              position: results.length + 1,
              site_name: siteName,
              title: title,
              snippet: snippet,
              url: cleanUrl,
              publishedAt: undefined
            });
            count++;
          }
          continue;
        }
        // Also try the old style: <a class="result__title">, <a class="result__a">
        const oldTitleMatch = containerHtml.match(/<(a\.(?:result__title|result__a))[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
        if (oldTitleMatch) {
          const url = oldTitleMatch[2];
          const title = oldTitleMatch[3].replace(/<[^>]*>/g, ' ').trim();
          const snippet = title;
          
          if (!url || url.includes('duckduckgo.com')) continue;
          if (title.length < 10 || title.length > 200) continue;
          
          const cleanUrl = this.normalizeUrl(url);
          const siteName = cleanUrl ? this.extractSiteName(cleanUrl) : '';
          
          if (!results.some(r => r.url === cleanUrl)) {
            results.push({
              position: results.length + 1,
              site_name: siteName,
              title: title,
              snippet: snippet,
              url: cleanUrl,
              publishedAt: undefined
            });
            count++;
          }
          continue;
        }
        // Still no valid title, skip this container
        continue;
      }
      
      const url = titleMatch[1];
      const title = titleMatch[2].replace(/<[^>]*>/g, ' ').trim();
      if (title.length < 10 || title.length > 200) continue;
      
      const cleanUrl = this.normalizeUrl(url);
      const siteName = cleanUrl ? this.extractSiteName(cleanUrl) : '';
      
      // Extract snippet using data-result="snippet" (new style)
      let snippet = title; // Default to title if no snippet found
      const snippetMatch = containerHtml.match(/<div\s[^>]*data-result=["']snippet["'][^>]*>([\s\S]*?)<\/div>/i);
      if (snippetMatch) {
        snippet = snippetMatch[1].replace(/<[^>]*>/g, ' ').trim().substring(0, 200);
      } else {
        // Try fallback: .result__snippet (old style)
        const oldSnippetMatch = containerHtml.match(/<(?:div|span)\s[^>]*class=["']?result__snippet["'][^>]*>([\s\S]*?)<\/div>/i);
        if (oldSnippetMatch) {
          snippet = oldSnippetMatch[1].replace(/<[^>]*>/g, ' ').trim().substring(0, 200);
        }
      }
      
      const isDuplicate = results.some(r => r.url === cleanUrl);
      if (!isDuplicate) {
        results.push({
          position: results.length + 1,
          site_name: siteName,
          title: title,
          snippet: snippet,
          url: cleanUrl,
          publishedAt: undefined
        });
        count++;
      }
    }
    
    // Fallback: generic link extraction for old DDG structure
    if (results.length === 0) {
      // Extract all <a> tags
      const linkRegex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let linkMatch;
      let linkCount = 0;
      
      while ((linkMatch = linkRegex.exec(html)) && linkCount < limit && results.length < limit) {
        try {
          const url = linkMatch[1];
          if (!url || url.includes('duckduckgo.com')) continue;
          
          const rawTitle = linkMatch[2];
          let title = rawTitle
            .replace(/<[^>]*>/g, ' ')
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/'/g, "'")
            .replace(/"/g, '"')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 200);
          
          // Skip if title is too short (likely navigation) or too long
          if (title.length < 10 || title.length > 200) continue;
          
          // Skip titles that are clearly not search results
          const lowerTitle = title.toLowerCase();
          if (lowerTitle.includes('duckduckgo') || 
              lowerTitle.includes('privacy') ||
              lowerTitle.includes('settings') ||
              lowerTitle.includes('preferences') ||
              lowerTitle.includes('terms') ||
              lowerTitle.includes('feedback') ||
              lowerTitle.includes('help')) continue;
          
          const cleanUrl = this.normalizeUrl(url);
          const siteName = cleanUrl ? this.extractSiteName(cleanUrl) : '';
          
          if (!results.some(r => r.url === cleanUrl)) {
            results.push({
              position: results.length + 1,
              site_name: siteName,
              title: title,
              snippet: title, // Use title as snippet fallback
              url: cleanUrl,
              publishedAt: undefined
            });
            linkCount++;
          }
        } catch (e) {
          continue;
        }
      }
    }
    
    return results.slice(0, limit);
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
  public async playwrightSearch(
    query: string,
    limit: number = 10,
    _abortSignal?: AbortSignal
  ): Promise<TinyFishSearchResponse | null> {
    try {
      // Get Playwright chromium - works for both CommonJS and ESM
      let chromium;
      if (typeof require !== 'undefined') {
        const { chromium: cjsChromium } = require('playwright');
        chromium = cjsChromium;
      } else {
        const { chromium: esmChromium } = await import('playwright');
        chromium = esmChromium;
      }

      if (!chromium) {
        console.warn("Playwright not available in this environment");
        return null;
      }

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
        
        // Set sourceType on all results
        const resultsWithSource = (results as SearchResult[]).map(r => ({ ...r, sourceType: "playwright" as const }));
        
        return {
          results: resultsWithSource,
          total: resultsWithSource.length,
          keyIndex: -3 // Indicates Playwright source
        };
      } catch (error) {
        await browser.close();
        throw error;
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
                  textContent = (element as HTMLElement).innerText || element.textContent || '';
                  if (textContent.length > 100) break; // Prefer substantive content
                }
              }
              
              // Fallback to body if nothing found
              if (!textContent || textContent.length < 100) {
                textContent = (document.body as HTMLElement).innerText || document.body.textContent || '';
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
   * HTTP fetch-based scrape with content extraction
   * Fallback method when TinyFish keys are exhausted
   */
  public async httpScrape(
    url: string,
    abortSignal?: AbortSignal
  ): Promise<ScrapedContent | null> {
    // Normalize and validate URL
    const safeUrl = this.normalizeUrl(url);
    if (!safeUrl || !/^https?:\/\//i.test(safeUrl)) {
      return null;
    }

    const cacheKey = `mcp:http-scrape:${safeUrl}`;
    const cached = await getCache<ScrapedContent>(cacheKey, SCRAPE_CACHE_MS);
    if (cached) return cached;

    // Check if already in progress (avoid concurrent fetches)
    const inProgressKey = `mcp:http-scrape-in-progress:${safeUrl}`;
    const inProgress = await getCache<string | null>(inProgressKey, 1000);
    if (inProgress) {
      // Return cached partial result while another fetch is in progress
      return null;
    }
    await setCache(inProgressKey, '1', 1000);

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
        // Remove in-progress marker
        await setCache(inProgressKey, null, 1000);
      }
    } catch (error) {
      console.warn("HTTP fetch scrape failed:", error);
      return null;
    }
  }

  /**
   * Playwright-based scrape
   * Fallback method when TinyFish keys are exhausted and HTTP also fails
   */
  public async playwrightScrape(
    url: string,
    _abortSignal?: AbortSignal
  ): Promise<ScrapedContent | null> {
    try {
      let playwright;
      if (typeof require !== 'undefined') {
        const { chromium } = require('playwright');
        playwright = { chromium };
      } else {
        // ESM environment - dynamic import
        const { chromium } = await import('playwright');
        playwright = { chromium };
      }
      
      if (!playwright?.chromium) {
        console.warn("Playwright not available in this environment");
        return null;
      }
      
      const { chromium } = playwright;
      
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
        
        await page.goto(url, {
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
            '#main',
            '.article-body',
            '.story-body'
          ];
          
          let textContent = '';
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              textContent = (element as HTMLElement).innerText || element.textContent || '';
              if (textContent.length > 100) break; // Prefer substantive content
            }
          }
          
          // Fallback to body if nothing found
          if (!textContent || textContent.length < 100) {
            textContent = (document.body as HTMLElement).innerText || document.body.textContent || '';
          }
          
          return {
            title: title.substring(0, 200),
            text: textContent.substring(0, 10000)
          };
        });
        
        await browser.close();
        
        const result: ScrapedContent = {
          url: url,
          title: scrapedData.title,
          text: scrapedData.text,
          keyIndex: -3 // Indicates Playwright source
        };
        
        await setCache(`mcp:playwright-scrape:${url}`, result, SCRAPE_CACHE_MS);
        return result;
      } catch (error) {
        await browser.close();
        throw error;
      }
    } catch (error) {
      console.warn("Playwright scrape failed:", error);
      return null;
    }
  }

/**
 * Extract title and text content from HTML
 * Uses regex-based parsing to avoid DOM APIs (which don't exist in Node.js)
 */
private extractContentFromHtml(html: string): { title: string; text: string } {
  try {
    // Extract title from HTML
    let title = '';
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1]
        .replace(/<[^>]*>/g, '') // Remove any HTML tags
        .replace(/\s*[-–—]\s*(.+)?$/, '$1').trim() // Remove common suffixes
        .substring(0, 200);
    }
    
    // Extract main content text
    let text = '';
    
    // Try to find content in common semantic elements
    const contentPatterns = [
      // Try to find article content
      /<article[^>]*>([\s\S]*?)<\/article>/i,
      // Try to find main content
      /<main[^>]*>([\s\S]*?)<\/main>/i,
      // Try to find content div
      /<div[^>]*\sclass=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      // Try to find post-content
      /<div[^>]*\sclass=["'][^"']*post-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      // Try to find entry-content
      /<div[^>]*\sclass=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      // Try to find element by id
      /<div[^>]*\s(id=["']content["']|id=["']main["'])(?:[^>]*)>([\s\S]*?)<\/div>/i,
      // Fallback to body content
      /<body[^>]*>([\s\S]*?)<\/body>/i
    ];
    
    for (const pattern of contentPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        // Extract text from the matched content
        let content = match[1];
        
        // Remove script and style elements
        content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
        content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
        
        // Extract text (remove HTML tags, normalize whitespace)
        text = content
          .replace(/<[^>]*>/g, ' ') // Replace HTML tags with spaces
          .replace(/\s+/g, ' ') // Normalize whitespace
          .replace(/[\n\r\t]+/g, ' ') // Replace line breaks/tabs with spaces
          .trim();
        
        // If we got substantive content, use it
        if (text.length > 50) {
          break;
        }
      }
    }
    
    // If still no good content, try to get text from the whole HTML
    if (!text || text.length < 50) {
      // Remove script and style elements
      let cleanHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      cleanHtml = cleanHtml.replace(/<style[\s\S]*?<\/style>/gi, '');
      
      // Extract text from remaining HTML
      text = cleanHtml
        .replace(/<[^>]*>/g, ' ') // Replace HTML tags with spaces
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/[\n\r\t]+/g, ' ') // Replace line breaks/tabs with spaces
        .trim();
    }
    
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