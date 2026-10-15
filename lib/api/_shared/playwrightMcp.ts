import type { Region } from "./regions";

/**
 * Playwright MCP (Model Context Protocol) Server Wrapper
 *
 * An always-on headless browser instance that provides web search and scraping
 * capabilities as a fallback when TinyFish API keys are unavailable.
 *
 * Uses playwright-core + @sparticuz/chromium for Vercel/serverless compatibility.
 * The browser is lazily initialized on first use and kept alive for the lifetime
 * of the serverless function instance to minimize cold-start overhead.
 */

interface SearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

interface ScrapedContent {
  url: string;
  title: string;
  text: string;
}

export interface PlaywrightMcpStatus {
  available: boolean;
  initialized: boolean;
  browserType: "chromium" | "firefox" | "webkit";
  pageCount: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

const SEARCH_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_SEARCH_TIMEOUT_MS ?? 15000);
const SCRAPE_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_SCRAPE_TIMEOUT_MS ?? 20000);
const MAX_PAGES = Number(process.env.PLAYWRIGHT_MAX_PAGES ?? 4);

let _browser: import("playwright-core").Browser | null = null;
let _browserPromise: Promise<import("playwright-core").Browser> | null = null;
let _context: import("playwright-core").BrowserContext | null = null;
let _pagePool: import("playwright-core").Page[] = [];
let _status: PlaywrightMcpStatus = {
  available: false,
  initialized: false,
  browserType: "chromium",
  pageCount: 0,
  lastError: null,
  lastErrorAt: null,
};

function updateStatus(partial: Partial<PlaywrightMcpStatus>): void {
  _status = { ..._status, ...partial };
}

async function getBrowser(): Promise<import("playwright-core").Browser> {
  if (_browser) return _browser;

  if (!_browserPromise) {
    _browserPromise = (async () => {
      // CRITICAL: Set AWS_LAMBDA_JS_RUNTIME BEFORE importing @sparticuz/chromium.
      // The module checks environment variables at load time to determine
      // whether to extract Lambda-compatible libraries (al2/al2023).
      // If set after import, the detection fails and libraries aren't extracted,
      // causing "error while loading shared libraries: libnss3.so" errors.
      const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
      if (isVercel && !process.env.AWS_LAMBDA_JS_RUNTIME) {
        process.env.AWS_LAMBDA_JS_RUNTIME = "nodejs22.x";
      }

      const { chromium } = await import("playwright-core");
      const chromiumPack = await import("@sparticuz/chromium");

      if (isVercel) {
        // Disable graphics mode to prevent freezing
        if (typeof (chromiumPack as any).setGraphicsMode === "function") {
          (chromiumPack as any).setGraphicsMode(false);
        }

        const executablePath = await (chromiumPack as any).executablePath();
        const execDir = (await import("path")).dirname(executablePath);

        // CRITICAL: Set LD_LIBRARY_PATH so Chromium can find libraries
        // @sparticuz/chromium's setupLambdaEnvironment() runs at module load
        // and adds /tmp/al2023/lib to LD_LIBRARY_PATH. We must PRESERVE that
        // and ADD the executable directory and common system paths.
        const additionalPaths = [
          "/lib/x86_64-linux-gnu",
          "/usr/lib/x86_64-linux-gnu",
          "/lib64",
          "/usr/lib64",
        ];
        const existingLibPath = process.env.LD_LIBRARY_PATH ?? "";
        const newPaths = [execDir, ...additionalPaths].filter((p) => !existingLibPath.includes(p));
        process.env.LD_LIBRARY_PATH = [existingLibPath, ...newPaths].filter(Boolean).join(":");

        return chromium.launch({
          args: (chromiumPack as any).args,
          executablePath,
          headless: true,
        });
      } else {
        // Local development - use system Chromium (installed via postinstall)
        return chromium.launch({
          args: [
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
          ],
          headless: true,
        });
      }
    })();
  }

  try {
    _browser = await _browserPromise;
    if (!_context) {
      _context = await _browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
      });
    }
    updateStatus({ available: true, initialized: true, lastError: null, lastErrorAt: null });
    return _browser;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    updateStatus({ 
      available: false, 
      initialized: false, 
      lastError: err.message, 
      lastErrorAt: new Date().toISOString() 
    });
    console.error("Playwright MCP browser initialization failed:", err.message);
    // Reset the promise so we can retry on next call
    _browserPromise = null;
    throw err;
  }
}

async function getPage(): Promise<import("playwright-core").Page> {
  await getBrowser();
  if (!_context) throw new Error("Browser context not initialized");

  // Reuse an existing page if available and not closed
  while (_pagePool.length > 0) {
    const page = _pagePool.shift()!;
    if (!page.isClosed()) {
      return page;
    }
  }

  // Create new page if under limit
  if (_pagePool.length < MAX_PAGES) {
    const page = await _context.newPage();
    page.setDefaultTimeout(Math.max(SEARCH_TIMEOUT_MS, SCRAPE_TIMEOUT_MS));
    return page;
  }

  // Wait for a page to become available (with timeout)
  const waitStart = Date.now();
  while (Date.now() - waitStart < 5000) {
    while (_pagePool.length > 0) {
      const page = _pagePool.shift()!;
      if (!page.isClosed()) return page;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Fallback: create a new page even if over limit (emergency)
  const page = await _context.newPage();
  page.setDefaultTimeout(Math.max(SEARCH_TIMEOUT_MS, SCRAPE_TIMEOUT_MS));
  return page;
}

function releasePage(page: import("playwright-core").Page): void {
  if (!page.isClosed() && _pagePool.length < MAX_PAGES) {
    _pagePool.push(page);
  } else {
    page.close().catch(() => {});
  }
  updateStatus({ pageCount: _pagePool.length });
}

function buildDuckDuckGoSearchUrl(query: string, region?: Region): string {
  const params = new URLSearchParams({
    q: query,
    kl: regionToDuckDuckGoRegion(region),
    df: "2026-01..2026-12", // date filter for 2026
    ia: "web",
  });
  return `https://html.duckduckgo.com/html/?${params.toString()}`;
}

function regionToDuckDuckGoRegion(region?: Region): string {
  switch (region) {
    case "asia":
      return "jp-jp"; // Japan as representative
    case "europe":
      return "de-de"; // Germany as representative
    case "africa":
      return "za-za"; // South Africa
    case "americas":
      return "us-en"; // US English
    case "oceania":
      return "au-au"; // Australia
    default:
      return "us-en";
  }
}

async function extractSearchResults(
  page: import("playwright-core").Page,
  limit: number
): Promise<SearchResult[]> {
  // Current DuckDuckGo HTML structure (as of 2025-2026):
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

  const selectors = [
    ".result.results_links",  // Current DDG structure
    ".web-result",            // Alternative class
    "#links .result",         // Classic structure
    "[data-testid='result']", // New DDG
    "article[data-layout='organic']",
  ];

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      const results = await page.$$eval(selector, (els, limit) => {
        return els.slice(0, limit).map((el, index) => {
          // Try multiple possible selectors for title, snippet, URL
          const titleSelectors = [
            "h2.result__title a.result__a",
            ".result__title a",
            "h2 a",
            "[data-testid='result-title-a']",
            "h3 a",
            "a[data-testid='result-title']",
          ];
          const snippetSelectors = [
            "a.result__snippet",
            ".result__snippet",
            ".snippet",
            "[data-testid='result-snippet']",
            ".result__snippet__text",
          ];
          const urlSelectors = [
            ".result__url",
            ".url",
            "[data-testid='result-url']",
          ];

          let titleEl: Element | null = null;
          let snippetEl: Element | null = null;
          let urlEl: Element | null = null;

          for (const sel of titleSelectors) {
            titleEl = el.querySelector(sel);
            if (titleEl) break;
          }
          for (const sel of snippetSelectors) {
            snippetEl = el.querySelector(sel);
            if (snippetEl) break;
          }
          for (const sel of urlSelectors) {
            urlEl = el.querySelector(sel);
            if (urlEl) break;
          }

          const href = titleEl?.getAttribute("href") ?? urlEl?.textContent?.trim() ?? "";
          let site_name = "";
          try {
            site_name = new URL(href).hostname.replace("www.", "");
          } catch {
            site_name = "";
          }

          return {
            position: index + 1,
            title: titleEl?.textContent?.trim() ?? "",
            url: href,
            snippet: snippetEl?.textContent?.trim() ?? "",
            site_name,
          };
        });
      }, limit);

      if (results.length > 0) {
        return results;
      }
    } catch {
      // Selector not found or error, try next
      continue;
    }
  }

  return [];
}

export class PlaywrightMcpServer {
  private static instance: PlaywrightMcpServer;
  private _initializationPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): PlaywrightMcpServer {
    if (!PlaywrightMcpServer.instance) {
      PlaywrightMcpServer.instance = new PlaywrightMcpServer();
    }
    return PlaywrightMcpServer.instance;
  }

  /**
   * Proactively initializes the browser instance.
   * Call this during application startup or health checks to ensure
   * the browser is warm and ready for the fallback chain.
   */
  async initialize(abortSignal?: AbortSignal): Promise<void> {
    if (this._initializationPromise) {
      await this._initializationPromise;
      return;
    }

    this._initializationPromise = (async () => {
      try {
        await getBrowser();
        // Browser is now initialized, status updated in getBrowser()
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        updateStatus({ 
          lastError: `Initialization failed: ${err.message}`, 
          lastErrorAt: new Date().toISOString(),
          available: false,
          initialized: false
        });
        console.error("Playwright MCP initialization failed:", err.message);
        throw err;
      }
    })();

    // Also respect abort signal
    if (abortSignal) {
      try {
        await Promise.race([
          this._initializationPromise,
          new Promise((_, reject) => {
            abortSignal.addEventListener("abort", () => reject(new Error("Initialization aborted")));
          })
        ]);
      } catch (error) {
        if (error instanceof Error && error.message === "Initialization aborted") {
          throw error;
        }
        // Other errors already handled above
      }
    } else {
      await this._initializationPromise;
    }
  }

  /**
   * Performs a web search using DuckDuckGo via Playwright.
   * Returns results in the same format as TinyFish for compatibility.
   */
  async search(
    query: string,
    options: { limit?: number; region?: Region } = {}
  ): Promise<{ results: SearchResult[]; total: number; source: "playwright-mcp" }> {
    const limit = options.limit ?? 10;
    const page = await getPage();
    const searchUrl = buildDuckDuckGoSearchUrl(query, options.region);

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: SEARCH_TIMEOUT_MS });
      const results = await extractSearchResults(page, limit);

      updateStatus({ lastError: null, lastErrorAt: null });
      return { results, total: results.length, source: "playwright-mcp" };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      updateStatus({ lastError: err.message, lastErrorAt: new Date().toISOString() });
      console.error("Playwright MCP search failed:", err.message);
      return { results: [], total: 0, source: "playwright-mcp" };
    } finally {
      releasePage(page);
    }
  }

  /**
   * Scrapes a URL and extracts title and main text content.
   */
  async scrape(url: string): Promise<ScrapedContent | null> {
    const page = await getPage();

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: SCRAPE_TIMEOUT_MS });

      // Wait a bit for dynamic content
      await page.waitForTimeout(1000);

      const result = await page.evaluate(() => {
        // Remove script, style, nav, footer, header elements
        const toRemove = document.querySelectorAll("script, style, nav, footer, header, aside, .ads, .advertisement");
        toRemove.forEach((el) => el.remove());

        // Try to find main content
        const main = document.querySelector("main, article, [role=main], .content, .post, .entry-content");
        const text = (main ?? document.body).textContent ?? "";
        const title = document.title ?? "";

        return { title, text: text.slice(0, 10000) };
      });

      updateStatus({ lastError: null, lastErrorAt: null });
      return {
        url,
        title: result.title,
        text: result.text,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      updateStatus({ lastError: err.message, lastErrorAt: new Date().toISOString() });
      console.error("Playwright MCP scrape failed:", err.message);
      return null;
    } finally {
      releasePage(page);
    }
  }

  /**
   * Gets the current status of the Playwright MCP server.
   */
  getStatus(): PlaywrightMcpStatus {
    return { ..._status };
  }

  /**
   * Checks if the server is healthy and can accept requests.
   */
  isHealthy(): boolean {
    return _status.available && _status.initialized && !_status.lastError;
  }

  /**
   * Gracefully shuts down the browser and cleans up resources.
   */
  async shutdown(): Promise<void> {
    for (const page of _pagePool) {
      await page.close().catch(() => {});
    }
    _pagePool = [];

    if (_context) {
      await _context.close().catch(() => {});
      _context = null;
    }

    if (_browser) {
      await _browser.close().catch(() => {});
      _browser = null;
      _browserPromise = null;
    }

    updateStatus({ available: false, initialized: false, pageCount: 0 });
  }
}

export const playwrightMcp = PlaywrightMcpServer.getInstance();