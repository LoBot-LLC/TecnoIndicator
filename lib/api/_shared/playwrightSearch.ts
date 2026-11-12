import { chromium, type Browser, type Page } from "playwright";
import { sanitizeUrl } from "./http";
import { getCache, setCache } from "./cache";
import type { Region } from "./regions";

export interface PlaywrightSearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

export interface PlaywrightSearchResponse {
  results: PlaywrightSearchResult[];
  total: number;
  keyIndex: number; // -2 indicates playwright fallback
  source: "playwright";
}

export interface PlaywrightScrapedContent {
  url: string;
  title: string;
  text: string;
  keyIndex: number;
  source: "playwright";
}

const SEARCH_CACHE_MS = 60_000;
const SCRAPE_CACHE_MS = 10 * 60_000;

let browserPromise: Promise<Browser> | null = null;
let browserInstance: Browser | null = null;
let lastUsedAt = 0;
const BROWSER_IDLE_TTL_MS = 5 * 60_000;

async function getBrowser(): Promise<Browser> {
  const now = Date.now();
  if (browserInstance && browserInstance.isConnected()) {
    lastUsedAt = now;
    return browserInstance;
  }
  if (browserPromise) return browserPromise;

  browserPromise = chromium
    .launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    })
    .then((browser) => {
      browserInstance = browser;
      lastUsedAt = Date.now();
      browser.on("disconnected", () => {
        browserInstance = null;
        browserPromise = null;
      });
      return browser;
    })
    .catch((err) => {
      browserPromise = null;
      browserInstance = null;
      throw err;
    });

  return browserPromise;
}

async function withPage<T>(fn: (page: Page) => Promise<T>, abortSignal?: AbortSignal): Promise<T> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await context.newPage();
  try {
    if (abortSignal?.aborted) throw new Error("Playwright operation aborted");
    const onAbort = () => {
      void page.close().catch(() => {});
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await fn(page);
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

function buildSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query, ia: "web" });
  return `https://html.duckduckgo.com/html/?${params.toString()}`;
}

export async function playwrightSearch(
  query: string,
  options: { limit?: number; region?: Region } = {},
  abortSignal?: AbortSignal,
): Promise<PlaywrightSearchResponse> {
  const limit = options.limit ?? 10;
  const region = options.region ?? "global";
  const cacheKey = `playwright:search:${query}:${region}`;
  const cached = await getCache<PlaywrightSearchResponse>(cacheKey, SEARCH_CACHE_MS);
  if (cached) return cached;

  const regionPrefix = region !== "global" ? `[${region}] ` : "";
  const fullQuery = `${regionPrefix}${query}`;

  try {
    const results = await withPage(async (page) => {
      await page.goto(buildSearchUrl(fullQuery), {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      if (abortSignal?.aborted) throw new Error("Aborted");

      const items = await page.$$eval(".result", (nodes, max) => {
        return nodes.slice(0, max).map((node, idx) => {
          const link = node.querySelector("a.result__a") as HTMLAnchorElement | null;
          const snippetEl = node.querySelector(".result__snippet");
          const href = link?.getAttribute("href") || "";
          let resolved = href;
          try {
            if (href.startsWith("//")) resolved = `https:${href}`;
            const u = new URL(resolved, "https://duckduckgo.com");
            const uddg = u.searchParams.get("uddg");
            if (uddg) resolved = decodeURIComponent(uddg);
          } catch {
            // keep href
          }
          let siteName = "";
          try {
            siteName = new URL(resolved).hostname.replace(/^www\./, "");
          } catch {
            siteName = "";
          }
          return {
            position: idx + 1,
            site_name: siteName,
            title: link?.textContent?.trim() || "",
            snippet: snippetEl?.textContent?.trim() || "",
            url: resolved,
          };
        });
      }, limit);

      return items.filter((r) => r.url && r.title);
    }, abortSignal);

    const response: PlaywrightSearchResponse = {
      results,
      total: results.length,
      keyIndex: -2,
      source: "playwright",
    };
    await setCache(cacheKey, response, SEARCH_CACHE_MS);
    return response;
  } catch (error) {
    console.error("Playwright search failed:", error);
    return { results: [], total: 0, keyIndex: -2, source: "playwright" };
  }
}

export async function playwrightScrape(
  url: string,
  abortSignal?: AbortSignal,
): Promise<PlaywrightScrapedContent | null> {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) return null;
  const cacheKey = `playwright:scrape:${safeUrl}`;
  const cached = await getCache<PlaywrightScrapedContent>(cacheKey, SCRAPE_CACHE_MS);
  if (cached) return cached;

  try {
    const data = await withPage(async (page) => {
      await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      if (abortSignal?.aborted) throw new Error("Aborted");
      // Remove obvious noise
      await page.evaluate(() => {
        const selectors = ["script", "style", "noscript", "nav", "footer", "header", "aside"];
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        }
      });
      const title = await page.title();
      const text = await page.evaluate(() => {
        const body = document.body;
        return (body?.innerText || body?.textContent || "").replace(/\s+/g, " ").trim();
      });
      return { title, text: text.slice(0, 10000) };
    }, abortSignal);

    const result: PlaywrightScrapedContent = {
      url: safeUrl,
      title: data.title || "",
      text: data.text || "",
      keyIndex: -2,
      source: "playwright",
    };
    await setCache(cacheKey, result, SCRAPE_CACHE_MS);
    return result;
  } catch (error) {
    console.error("Playwright scrape failed:", error);
    return null;
  }
}

export async function getPlaywrightStatus(): Promise<{ available: boolean; mode: "always-on" }> {
  // Always-on by design; we report available optimistically. Actual availability is
  // determined when a search/scrape is attempted.
  return { available: true, mode: "always-on" };
}

// Best-effort cleanup for idle browser instances (serverless-safe no-op if unused).
export async function cleanupIdleBrowser(): Promise<void> {
  if (browserInstance && Date.now() - lastUsedAt > BROWSER_IDLE_TTL_MS) {
    try {
      await browserInstance.close();
    } catch {
      // ignore
    } finally {
      browserInstance = null;
      browserPromise = null;
    }
  }
}
