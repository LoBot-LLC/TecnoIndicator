import { getCache, setCache } from "./cache";
import { SEARCH_CACHE_MS, SCRAPE_CACHE_MS, sanitizeUrl } from "./http";
import type { Region } from "./regions";

export interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

export interface WebSearchResponse {
  results: SearchResult[];
  total: number;
  source: "mcp" | "duckduckgo";
}

export interface ScrapedContent {
  url: string;
  title: string;
  text: string;
  source: "mcp" | "duckduckgo" | "direct";
}

export interface WebSearchStatus {
  available: boolean;
  mcpAvailable: boolean;
  mcpUrl: string | null;
  duckDuckGoAvailable: boolean;
  fallbackUsed: boolean;
}

const MCP_TIMEOUT_MS = 25000;
const DUCKDUCKGO_TIMEOUT_MS = 15000;
const DUCKDUCKGO_RETRY_ATTEMPTS = 2;
const DUCKDUCKGO_RETRY_BACKOFF_MS = 2000;

const DDG_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
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

export class WebSearchRouter {
  private mcpUrl: string | null;
  private mcpSessionId: string | null = null;
  private mcpInitialized: boolean = false;

  constructor() {
    // Always-on Playwright MCP server is the primary search provider.
    // DuckDuckGo HTTP search is used only when the MCP server is unavailable.
    this.mcpUrl = process.env.PLAYWRIGHT_MCP_URL ?? "http://localhost:8931/mcp";
  }

  /** Reset MCP session state so the next call re-initializes from scratch. */
  private resetMcpState(): void {
    this.mcpSessionId = null;
    this.mcpInitialized = false;
  }

  private async mcpInitialize(abortSignal?: AbortSignal): Promise<boolean> {
    if (this.mcpInitialized && this.mcpSessionId) return true;
    if (!this.mcpUrl) return false;

    const controller = new AbortController();
    const combinedSignal = abortSignal
      ? combineAbortSignals(abortSignal, controller.signal)
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);

    try {
      const initPayload = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "lobot-tecnoindicator", version: "1.0.0" },
        },
      };

      const response = await fetch(this.mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
        },
        body: JSON.stringify(initPayload),
        signal: combinedSignal,
      });

      if (!response.ok) {
        this.resetMcpState();
        console.warn(`MCP initialize failed: ${response.status}`);
        return false;
      }

      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) {
        this.mcpSessionId = sessionId;
        this.mcpInitialized = true;
        return true;
      }

      // If no session ID, try to parse SSE response
      const text = await response.text();
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.result?.protocolVersion) {
              this.mcpInitialized = true;
              return true;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      this.resetMcpState();
      return false;
    } catch (error) {
      this.resetMcpState();
      console.warn("MCP initialize error:", error);
      return false;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private async mcpCallTool(
    toolName: string,
    args: Record<string, unknown>,
    abortSignal?: AbortSignal
  ): Promise<unknown> {
    if (!this.mcpInitialized || !this.mcpSessionId) {
      const ok = await this.mcpInitialize(abortSignal);
      if (!ok) throw new Error("MCP not initialized");
    }

    const controller = new AbortController();
    const combinedSignal = abortSignal
      ? combineAbortSignals(abortSignal, controller.signal)
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);

    try {
      const callPayload = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      };

      const response = await fetch(this.mcpUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
          "MCP-Session-Id": this.mcpSessionId!,
        },
        body: JSON.stringify(callPayload),
        signal: combinedSignal,
      });

      if (!response.ok) {
        this.resetMcpState();
        throw new Error(`MCP tool call failed: ${response.status}`);
      }

      // Parse SSE response
      const text = await response.text();
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error.message ?? "MCP tool error");
            if (data.result) return data.result;
          } catch (e) {
            if (e instanceof Error && e.message.startsWith("MCP tool")) throw e;
          }
        }
      }

      throw new Error("No valid MCP response");
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private async mcpSearch(
    query: string,
    options: { limit?: number; region?: Region } = {},
    abortSignal?: AbortSignal
  ): Promise<WebSearchResponse> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const limit = options.limit ?? 10;

    // Navigate to DuckDuckGo HTML results
    await this.mcpCallTool("browser_navigate", { url: searchUrl }, abortSignal);

    // Extract results using browser_run_code
    const extractScript = `
      (() => {
        const results = [];
        // Try multiple selector patterns DuckDuckGo uses
        const items = document.querySelectorAll('.result, .web-result, .links_main .result__body, .results__item');
        for (const item of items) {
          const titleEl = item.querySelector('.result__a, .result__title, .snippet__title, a[class*="title"], .result__link');
          const urlEl = item.querySelector('.result__url, .result__snippet a, .snippet__url, a[class*="url"]');
          const snippetEl = item.querySelector('.result__snippet, .snippet__text, .snippet__desc, [class*="snippet"]');
          
          const title = titleEl?.textContent?.trim() ?? "";
          let url = urlEl?.textContent?.trim() ?? (titleEl?.getAttribute?.('href') ?? "");
          const snippet = snippetEl?.textContent?.trim() ?? "";
          
          // DuckDuckGo html uses redirect links like //duckduckgo.com/l/?uddg=...
          if (url.startsWith("//")) url = "https:" + url;
          if (url.includes("duckduckgo.com/l/?")) {
            try {
              const u = new URL(url);
              const uddg = u.searchParams.get("uddg");
              if (uddg) url = decodeURIComponent(uddg);
            } catch {}
          }
          
          if (title && url) {
            results.push({ title, url, snippet });
            if (results.length >= ${limit}) break;
          }
        }
        return results;
      })()
    `;

    const runResult = await this.mcpCallTool("browser_run_code", { script: extractScript }, abortSignal);

    let extracted: Array<{ title: string; url: string; snippet: string }> = [];
    if (runResult && typeof runResult === "object") {
      const content = runResult as { content?: unknown[] };
      if (Array.isArray(content.content)) {
        for (const item of content.content) {
          if (item && typeof item === "object" && "text" in item) {
            try {
              extracted = JSON.parse(String(item.text));
              break;
            } catch {
              // Not JSON, continue
            }
          }
        }
      }
    }

    const results: SearchResult[] = extracted.map((r, i) => ({
      position: i + 1,
      site_name: new URL(r.url).hostname,
      title: r.title,
      snippet: r.snippet,
      url: sanitizeUrl(r.url) ?? r.url,
      publishedAt: undefined,
    }));

    return { results, total: results.length, source: "mcp" };
  }

  private async mcpScrape(url: string, abortSignal?: AbortSignal): Promise<ScrapedContent | null> {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return null;

    await this.mcpCallTool("browser_navigate", { url: safeUrl }, abortSignal);

    const extractScript = `
      (() => {
        const cloned = document.cloneNode(true) as Document;
        const toRemove = cloned.querySelectorAll('script, style, nav, footer, header, aside, .ad, .ads, [class*="advert"], [id*="advert"]');
        toRemove.forEach(el => el.remove());
        
        const title = cloned.title ?? "";
        const text = cloned.body?.innerText?.slice(0, 10000) ?? "";
        return { title, text };
      })()
    `;

    const runResult = await this.mcpCallTool("browser_run_code", { script: extractScript }, abortSignal);

    let title = "";
    let text = "";
    if (runResult && typeof runResult === "object") {
      const content = runResult as { content?: unknown[] };
      if (Array.isArray(content.content)) {
        for (const item of content.content) {
          if (item && typeof item === "object" && "text" in item) {
            try {
              const parsed = JSON.parse(String(item.text));
              title = parsed.title ?? "";
              text = parsed.text ?? "";
              break;
            } catch {
              // Not JSON
            }
          }
        }
      }
    }

    if (!text) return null;

    return { url: safeUrl, title, text, source: "mcp" };
  }

  /** Build DuckDuckGo headers that look like a real browser. */
  private ddgHeaders(): Record<string, string> {
    return {
      "User-Agent": DDG_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://duckduckgo.com/",
    };
  }

  /** Parse DuckDuckGo lite.duckduckgo.com table-based HTML results. */
  private parseDuckDuckGoLite(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Find the results table
    const tableMatches = html.match(/<table[^>]*>.*?<\/table>/gs);
    if (!tableMatches) return results;

    for (const table of tableMatches) {
      const rowMatches = table.match(/<tr[^>]*>.*?<\/tr>/gs);
      if (!rowMatches) continue;

      for (const row of rowMatches) {
        const cellMatches = row.match(/<td[^>]*>(.*?)<\/td>/gs);
        if (!cellMatches || cellMatches.length < 2) continue;

        const linkMatch = cellMatches[0].match(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/i);
        const snippet = cellMatches[1].replace(/<[^>]*>/g, "").trim();

        if (linkMatch) {
          let url = linkMatch[1];
          const title = linkMatch[2].replace(/<[^>]*>/g, "").trim();

          // DuckDuckGo lite redirect URLs
          if (url.includes("duckduckgo.com/l/?")) {
            try {
              const u = new URL(url);
              const uddg = u.searchParams.get("uddg");
              if (uddg) url = decodeURIComponent(uddg);
            } catch {}
          }

          const cleanUrl = sanitizeUrl(url) ?? url;

          results.push({
            position: results.length + 1,
            site_name: new URL(cleanUrl).hostname,
            title,
            snippet,
            url: cleanUrl,
            publishedAt: undefined,
          });

          if (results.length >= limit) break;
        }
      }
      if (results.length >= limit) break;
    }

    return results;
  }

  /** Parse DuckDuckGo html.duckduckgo.com results. */
  private parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Match result blocks
    const resultRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>.*?<\/div>/gs;
    const matches = html.match(resultRegex);
    if (!matches) return results;

    for (const block of matches) {
      const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/is);
      const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/is);

      if (titleMatch) {
        let url = titleMatch[1];
        const title = titleMatch[2].replace(/<[^>]*>/g, "").trim();

        // DuckDuckGo html redirect URLs
        if (url.startsWith("//")) url = "https:" + url;
        if (url.includes("duckduckgo.com/l/?")) {
          try {
            const u = new URL(url);
            const uddg = u.searchParams.get("uddg");
            if (uddg) url = decodeURIComponent(uddg);
          } catch {}
        }

        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "";
        const cleanUrl = sanitizeUrl(url) ?? url;

        results.push({
          position: results.length + 1,
          site_name: new URL(cleanUrl).hostname,
          title,
          snippet,
          url: cleanUrl,
          publishedAt: undefined,
        });

        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /** Try DuckDuckGo lite endpoint with retry. */
  private async duckDuckGoLiteSearch(
    query: string,
    limit: number
  ): Promise<WebSearchResponse> {
    const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < DUCKDUCKGO_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, DUCKDUCKGO_RETRY_BACKOFF_MS * attempt));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DUCKDUCKGO_TIMEOUT_MS);

      try {
        const response = await fetch(searchUrl, {
          headers: this.ddgHeaders(),
          signal: controller.signal,
        });

        if (!response.ok) {
          lastError = new Error(`DuckDuckGo lite failed: ${response.status}`);
          continue;
        }

        const html = await response.text();
        const results = this.parseDuckDuckGoLite(html, limit);
        return { results, total: results.length, source: "duckduckgo" };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    }

    throw lastError ?? new Error("DuckDuckGo lite search failed");
  }

  /** Try DuckDuckGo html endpoint with retry. */
  private async duckDuckGoHtmlSearch(
    query: string,
    limit: number
  ): Promise<WebSearchResponse> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < DUCKDUCKGO_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, DUCKDUCKGO_RETRY_BACKOFF_MS * attempt));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DUCKDUCKGO_TIMEOUT_MS);

      try {
        const response = await fetch(searchUrl, {
          headers: this.ddgHeaders(),
          signal: controller.signal,
        });

        if (!response.ok) {
          lastError = new Error(`DuckDuckGo html failed: ${response.status}`);
          continue;
        }

        const html = await response.text();
        const results = this.parseDuckDuckGoHtml(html, limit);
        return { results, total: results.length, source: "duckduckgo" };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    }

    throw lastError ?? new Error("DuckDuckGo html search failed");
  }

  private async duckDuckGoSearch(
    query: string,
    options: { limit?: number; region?: Region } = {}
  ): Promise<WebSearchResponse> {
    const limit = options.limit ?? 10;

    // Try html.duckduckgo.com first (full HTML, more reliable), then lite.duckduckgo.com
    try {
      return await this.duckDuckGoHtmlSearch(query, limit);
    } catch (htmlError) {
      console.warn("DuckDuckGo html search failed:", htmlError);
    }

    try {
      return await this.duckDuckGoLiteSearch(query, limit);
    } catch (liteError) {
      console.warn("DuckDuckGo lite search failed:", liteError);
    }

    // Last resort: instant answer API
    return this.duckDuckGoInstantAnswer(query, limit);
  }

  private async duckDuckGoInstantAnswer(
    query: string,
    limit: number
  ): Promise<WebSearchResponse> {
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    try {
      const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
      if (!response.ok) return { results: [], total: 0, source: "duckduckgo" };

      const data = await response.json();
      const results: SearchResult[] = [];

      if (data.AbstractText && data.AbstractURL) {
        results.push({
          position: 1,
          site_name: data.AbstractSource ?? new URL(data.AbstractURL).hostname,
          title: data.Heading ?? query,
          snippet: data.AbstractText,
          url: sanitizeUrl(data.AbstractURL) ?? data.AbstractURL,
          publishedAt: undefined,
        });
      }

      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics) {
          if (topic.FirstURL && topic.Text) {
            results.push({
              position: results.length + 1,
              site_name: new URL(topic.FirstURL).hostname,
              title: topic.Text.split(" - ")[0] ?? query,
              snippet: topic.Text,
              url: sanitizeUrl(topic.FirstURL) ?? topic.FirstURL,
              publishedAt: undefined,
            });
            if (results.length >= limit) break;
          }
        }
      }

      return { results, total: results.length, source: "duckduckgo" };
    } catch {
      return { results: [], total: 0, source: "duckduckgo" };
    }
  }

  private async duckDuckGoScrape(url: string): Promise<ScrapedContent | null> {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DUCKDUCKGO_TIMEOUT_MS);

    try {
      const response = await fetch(safeUrl, {
        headers: this.ddgHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) return null;

      const html = await response.text();

      // Extract title
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : new URL(safeUrl).hostname;

      // Strip scripts, styles, extract body text
      let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 10000);

      if (!text) return null;

      return { url: safeUrl, title, text, source: "duckduckgo" };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  async webSearch(
    query: string,
    options: { limit?: number; region?: Region } = {},
    abortSignal?: AbortSignal
  ): Promise<WebSearchResponse> {
    const cacheKey = `websearch:search:${query}:${options.region ?? "global"}`;
    const cached = await getCache<WebSearchResponse>(cacheKey, SEARCH_CACHE_MS);
    if (cached) return cached;

    // Primary: Playwright MCP
    if (this.mcpUrl) {
      try {
        const result = await this.mcpSearch(query, options, abortSignal);
        await setCache(cacheKey, result, SEARCH_CACHE_MS);
        return result;
      } catch (error) {
        console.warn("MCP search failed, falling back to DuckDuckGo:", error);
        this.resetMcpState();
      }
    }

    // Fallback: DuckDuckGo (only when MCP fails)
    // Try html endpoint first, then lite, then instant answer
    const result = await this.duckDuckGoSearch(query, options);
    await setCache(cacheKey, result, SEARCH_CACHE_MS);
    return result;
  }

  async webScrape(url: string, abortSignal?: AbortSignal): Promise<ScrapedContent | null> {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return null;

    const cacheKey = `websearch:scrape:${safeUrl}`;
    const cached = await getCache<ScrapedContent>(cacheKey, SCRAPE_CACHE_MS);
    if (cached) return cached;

    // Primary: Playwright MCP
    if (this.mcpUrl) {
      try {
        const result = await this.mcpScrape(safeUrl, abortSignal);
        if (result) {
          await setCache(cacheKey, result, SCRAPE_CACHE_MS);
          return result;
        }
      } catch (error) {
        console.warn("MCP scrape failed, falling back to DuckDuckGo:", error);
        this.resetMcpState();
      }
    }

    // Fallback: DuckDuckGo direct fetch
    const result = await this.duckDuckGoScrape(safeUrl);
    if (result) {
      await setCache(cacheKey, result, SCRAPE_CACHE_MS);
    }
    return result;
  }

  async getWebSearchStatus(abortSignal?: AbortSignal): Promise<WebSearchStatus> {
    let mcpAvailable = false;
    let duckDuckGoAvailable = false;

    // Check MCP availability
    if (this.mcpUrl) {
      const controller = new AbortController();
      const combinedSignal = abortSignal
        ? combineAbortSignals(abortSignal, controller.signal)
        : controller.signal;
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const initPayload = {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "lobot-tecnoindicator", version: "1.0.0" },
          },
        };

        const response = await fetch(this.mcpUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-06-18",
          },
          body: JSON.stringify(initPayload),
          signal: combinedSignal,
        });

        mcpAvailable = response.ok;
        if (mcpAvailable) {
          const sessionId = response.headers.get("mcp-session-id");
          if (sessionId) {
            this.mcpSessionId = sessionId;
            this.mcpInitialized = true;
          }
        } else {
          this.resetMcpState();
        }
      } catch {
        mcpAvailable = false;
        this.resetMcpState();
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    }

    // Actually test DuckDuckGo availability with a lightweight request
    try {
      const ddgController = new AbortController();
      const ddgTimeout = setTimeout(() => ddgController.abort(), 8000);
      const ddgResponse = await fetch("https://duckduckgo.com/", {
        headers: this.ddgHeaders(),
        signal: ddgController.signal,
      });
      duckDuckGoAvailable = ddgResponse.ok;
      clearTimeout(ddgTimeout);
      ddgController.abort();
    } catch {
      duckDuckGoAvailable = false;
    }

    return {
      available: mcpAvailable || duckDuckGoAvailable,
      mcpAvailable,
      mcpUrl: this.mcpUrl,
      duckDuckGoAvailable,
      fallbackUsed: !mcpAvailable,
    };
  }
}

export const webSearchRouter = new WebSearchRouter();

// Backward compatibility aliases (will be removed after migration)
export const tinyfishRouter = {
  tinyfishSearch: webSearchRouter.webSearch.bind(webSearchRouter),
  tinyfishScrape: webSearchRouter.webScrape.bind(webSearchRouter),
  getTinyfishStatus: webSearchRouter.getWebSearchStatus.bind(webSearchRouter),
};