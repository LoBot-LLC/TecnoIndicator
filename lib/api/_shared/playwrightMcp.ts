/**
 * PlaywrightMcpClient
 *
 * Embeds the Playwright MCP server (https://playwright.dev/docs/getting-started-mcp)
 * as a program-matically-spawned subprocess and connects to it via the
 * `@modelcontextprotocol/sdk` StdioClientTransport.
 *
 * The MCP server is spawned with `--headless` so the browser always runs in
 * headless mode. The client is a singleton: it lazily initialises the first
 * time a tool is invoked and reuses the same browser session for subsequent
 * calls within the same function invocation.
 *
 * This module provides two capabilities that mirror the TinyFish API:
 *   - `search(query, limit)` — performs a web search via DuckDuckGo and returns
 *     results in the same shape TinyFish returns.
 *   - `scrape(url)` — navigates to a URL and extracts the page title + body text,
 *     matching TinyFish's scrape response shape.
 *
 * It is used by `tinyfishRouter` as an automatic fallback whenever ALL configured
 * TinyFish API keys are unavailable (exhausted, rate-limited, or invalid).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** Sentinel keyIndex used for results that came from the Playwright MCP fallback. */
export const PLAYWRIGHT_MCP_KEY_INDEX = -2;

interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

export interface PlaywrightSearchResponse {
  results: SearchResult[];
  total: number;
  /** Always {@link PLAYWRIGHT_MCP_KEY_INDEX} to signal MCP fallback in the cache key. */
  keyIndex: number;
}

export interface PlaywrightScrapedContent {
  url: string;
  title: string;
  text: string;
  keyIndex: number;
}

/**
 * Extracts a string from a CallToolResult content block.
 * Handles TextContent, resource-link content, and embedded-resource content.
 */
function extractTextFromContentBlock(block: unknown): string {
  if (typeof block !== "object" || block === null) return "";
  const entry = block as Record<string, unknown>;
  if (entry.type === "text" && typeof entry.text === "string") {
    return entry.text;
  }
  // resource_link -> { uri, name, ... }
  if (entry.type === "resource_link") {
    return JSON.stringify({ uri: entry.uri, name: entry.name });
  }
  // resource (embedded) -> { resource: { text, ... } }
  if (entry.type === "resource" && entry.resource && typeof entry.resource === "object") {
    const res = entry.resource as Record<string, unknown>;
    if (typeof res.text === "string") return res.text;
  }
  return "";
}

class PlaywrightMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private cleanupScheduled: boolean = false;

  /** Lazily starts the Playwright MCP subprocess in headless mode. */
  private async ensureInit(): Promise<void> {
    if (this.initialized && this.client) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      try {
        this.transport = new StdioClientTransport({
          command: "npx",
          args: ["@playwright/mcp@latest", "--headless"],
          env: {
            ...process.env,
            // Ensure headless mode is enforced even if env vars are set.
            PLAYWRIGHT_MCP_HEADLESS: "1",
          },
          stderr: "pipe",
        });

        this.client = new Client(
          { name: "tecnoindicator-mcp-client", version: "1.0.0" },
          {
            capabilities: {
              sampling: {},
              roots: { listChanged: true },
            },
          },
        );
        if (this.transport.stderr) {
          this.transport.stderr.on("data", (line: Buffer) => {
            // Suppress verbose browser-launch noise, but surface errors.
            const text = line.toString("utf8").toLowerCase();
            if (text.includes("error") || text.includes("fail")) {
              console.error("[PlaywrightMcpClient]", line.toString("utf8").trim());
            }
          });
        }
        this.transport.onclose = () => {
          console.warn("[PlaywrightMcpClient] MCP transport closed");
          this.initialized = false;
          this.client = null;
          this.transport = null;
        };
        this.transport.onerror = (err: Error) => {
          console.error("[PlaywrightMcpClient] MCP transport error:", err);
        };

        await this.client.connect(this.transport);
        this.initialized = true;
      } catch (error) {
        this.initPromise = null;
        console.error("[PlaywrightMcpClient] Failed to initialise:", error);
        throw error;
      }
    })();

    await this.initPromise;
  }

  /** Returns true if the MCP client is ready to accept tool calls. */
  isAvailable(): boolean {
    return this.initialized && this.client !== null;
  }

  /** Returns true if we can at least attempt to initialise the client. */
  canInit(): boolean {
    return !this.initPromise;
  }

  /**
   * Searches the web using DuckDuckGo HTML and extracts result snippets.
   * Returns results in the same shape TinyFish returns.
   */
  async search(query: string, limit: number = 10): Promise<PlaywrightSearchResponse> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 25000);

    try {
      await this.ensureInit();
      if (!this.client) throw new Error("MCP client not initialised");

      const client = this.client;

      // Navigate to DuckDuckGo HTML search page (no JavaScript required for results).
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      await client.callTool({
        name: "browser_navigate",
        arguments: { url: searchUrl },
      });

      // Wait for results to load.
      await client.callTool({
        name: "browser_wait_for",
        arguments: { time: 2000 },
      });

      // Use browser_evaluate to extract search results as JSON.
      // DuckDuckGo HTML page puts results in <div class="result ..."> elements.
      const evalResult = (await client.callTool({
        name: "browser_evaluate",
        arguments: {
          script: `
            (function() {
              // DuckDuckGo HTML results
              var results = [];
              var resultEls = document.querySelectorAll('div.result, div.result__body');
              resultEls.forEach(function(el, i) {
                if (results.length >= ${limit}) return;
                var titleEl = el.querySelector('a.result__a, h3, a');
                var snippetEl = el.querySelector('.result__snippet, p.result__snippet, .snippet');
                var urlEl = el.querySelector('a.result__a, a');
                var title = titleEl ? titleEl.textContent.trim() : '';
                var snippet = snippetEl ? snippetEl.textContent.trim() : '';
                var url = urlEl ? urlEl.href : '';
                if (url && title) {
                  try {
                    var siteName = new URL(url).hostname.replace(/^www\\./, '');
                  } catch(e) {
                    var siteName = '';
                  }
                  results.push({
                    position: i,
                    site_name: siteName || '',
                    title: title,
                    snippet: snippet || title,
                    url: url,
                  });
                }
              });
              // If DuckDuckGo selectors didn't match, try generic result extraction
              if (results.length === 0) {
                var genericEls = document.querySelectorAll('a[href*="http"]');
                var seen = new Set();
                genericEls.forEach(function(a, i) {
                  if (results.length >= ${limit}) return;
                  var href = a.href;
                  if (!href || seen.has(href)) return;
                  if (href.includes('duckduckgo') || href.includes('google') || href.includes('bing')) return;
                  seen.add(href);
                  var title = a.textContent.trim();
                  if (title && title.length > 10) {
                    var siteName = '';
                    try { siteName = new URL(href).hostname.replace(/^www\\./, ''); } catch(e) {}
                    results.push({
                      position: i,
                      site_name: siteName,
                      title: title,
                      snippet: title,
                      url: href,
                    });
                  }
                });
              }
              return JSON.stringify({ results: results, total: results.length });
            })()
          `,
        },
      })) as { content?: unknown[] };

      const text = Array.isArray(evalResult?.content)
        ? evalResult!.content.map((b) => extractTextFromContentBlock(b)).join("\n")
        : "";

      let parsed: { results?: SearchResult[]; total?: number } | null = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      const results: SearchResult[] = Array.isArray(parsed?.results) ? parsed.results : [];
      return {
        results,
        total: parsed?.total ?? results.length,
        keyIndex: PLAYWRIGHT_MCP_KEY_INDEX,
      };
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new Error("Playwright MCP search timed out");
      }
      console.error("[PlaywrightMcpClient] search failed:", error);
      return { results: [], total: 0, keyIndex: PLAYWRIGHT_MCP_KEY_INDEX };
    } finally {
      clearTimeout(timeoutId);
      this.scheduleCleanup();
    }
  }

  /**
   * Scrapes a URL and extracts the page title + body text.
   * Returns content in the same shape TinyFish's `tinyfishScrape` returns.
   */
  async scrape(url: string): Promise<PlaywrightScrapedContent | null> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 25000);

    try {
      await this.ensureInit();
      if (!this.client) throw new Error("MCP client not initialised");

      const client = this.client;

      await client.callTool({
        name: "browser_navigate",
        arguments: { url },
      });

      // Wait for page content to load.
      await client.callTool({
        name: "browser_wait_for",
        arguments: { time: 2000 },
      });

      // Evaluate JavaScript to extract title and main text.
      const evalResult = (await client.callTool({
        name: "browser_evaluate",
        arguments: {
          script: `
            (function() {
              var title = document.title || '';
              // Try to find main content element
              var mainEl = document.querySelector('main, article, .content, .post-content, #content, .entry-content, .article-body');
              var textEl = mainEl || document.body;
              var text = textEl ? textEl.innerText || textEl.textContent || '' : '';
              // Trim and limit to 10000 chars (matches TinyFish scrape limit)
              text = text.trim().slice(0, 10000);
              return JSON.stringify({ title: title, text: text });
            })()
          `,
        },
      })) as { content?: unknown[] };

      const text = Array.isArray(evalResult?.content)
        ? evalResult!.content.map((b) => extractTextFromContentBlock(b)).join("\n")
        : "";

      let parsed: { title?: string; text?: string } | null = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      if (!parsed) return null;

      return {
        url,
        title: parsed.title || "",
        text: parsed.text || "",
        keyIndex: PLAYWRIGHT_MCP_KEY_INDEX,
      };
    } catch (error) {
      console.error("[PlaywrightMcpClient] scrape failed:", error);
      return null;
    } finally {
      clearTimeout(timeoutId);
      this.scheduleCleanup();
    }
  }

  /**
   * Schedules a soft cleanup after the current operation. In serverless
   * environments, the process may be frozen between invocations (warm starts),
   * so we keep the browser alive within a single invocation but close it
   * after a period of inactivity.
   */
  private scheduleCleanup(): void {
    if (this.cleanupScheduled) return;
    this.cleanupScheduled = true;
    setTimeout(() => {
      this.close().catch(() => {
        /* ignore — process may already be torn down */
      });
    }, 30_000).unref();
  }

  /** Shuts down the MCP client and underlying browser process. */
  async close(): Promise<void> {
    this.cleanupScheduled = false;
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        /* ignore close errors */
      }
    }
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        /* ignore close errors */
      }
    }
    this.initialized = false;
    this.client = null;
    this.transport = null;
    this.initPromise = null;
  }
}

/**
 * Singleton instance. Always "enabled" — the client lazily spawns the MCP
 * subprocess on first use and runs it in headless mode.
 */
export const playwrightMcpClient = new PlaywrightMcpClient();