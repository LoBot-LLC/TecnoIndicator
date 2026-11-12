import { sanitizeUrl } from "./http";
import { getCache, setCache } from "./cache";
import type { Region } from "./regions";

export interface DuckDuckGoSearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

export interface DuckDuckGoSearchResponse {
  results: DuckDuckGoSearchResult[];
  total: number;
  keyIndex: number; // -3 indicates duckduckgo fallback
  source: "duckduckgo";
}

export interface DuckDuckGoScrapedContent {
  url: string;
  title: string;
  text: string;
  keyIndex: number;
  source: "duckduckgo";
}

const SEARCH_CACHE_MS = 60_000;
const SCRAPE_CACHE_MS = 10 * 60_000;

function buildSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query, kl: "us-en", kp: "-1" });
  return `https://html.duckduckgo.com/html/?${params.toString()}`;
}

function decodeDdgUrl(href: string): string {
  try {
    if (href.startsWith("//")) href = `https:${href}`;
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    // ignore
  }
  return href;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export async function duckDuckGoSearch(
  query: string,
  options: { limit?: number; region?: Region } = {},
  abortSignal?: AbortSignal,
): Promise<DuckDuckGoSearchResponse> {
  const limit = options.limit ?? 10;
  const region = options.region ?? "global";
  const cacheKey = `duckduckgo:search:${query}:${region}`;
  const cached = await getCache<DuckDuckGoSearchResponse>(cacheKey, SEARCH_CACHE_MS);
  if (cached) return cached;

  const regionPrefix = region !== "global" ? `[${region}] ` : "";
  const fullQuery = `${regionPrefix}${query}`;

  try {
    const res = await fetch(buildSearchUrl(fullQuery), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: abortSignal ?? AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`DuckDuckGo search failed with status ${res.status}`);
    }
    const html = await res.text();
    const results: DuckDuckGoSearchResult[] = [];
    const resultBlocks = html.split(/class="result\s/).slice(1);
    for (let i = 0; i < resultBlocks.length && results.length < limit; i++) {
      const block = resultBlocks[i];
      const linkMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/);
      if (!linkMatch) continue;
      const rawUrl = decodeDdgUrl(linkMatch[1]);
      const title = stripTags(linkMatch[2]);
      const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";
      if (!rawUrl || !title) continue;
      let siteName = "";
      try {
        siteName = new URL(rawUrl).hostname.replace(/^www\./, "");
      } catch {
        siteName = "";
      }
      results.push({
        position: results.length + 1,
        site_name: siteName,
        title,
        snippet,
        url: rawUrl,
      });
    }

    const response: DuckDuckGoSearchResponse = {
      results,
      total: results.length,
      keyIndex: -3,
      source: "duckduckgo",
    };
    await setCache(cacheKey, response, SEARCH_CACHE_MS);
    return response;
  } catch (error) {
    console.error("DuckDuckGo search failed:", error);
    return { results: [], total: 0, keyIndex: -3, source: "duckduckgo" };
  }
}

export async function duckDuckGoScrape(
  url: string,
  abortSignal?: AbortSignal,
): Promise<DuckDuckGoScrapedContent | null> {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) return null;
  const cacheKey = `duckduckgo:scrape:${safeUrl}`;
  const cached = await getCache<DuckDuckGoScrapedContent>(cacheKey, SCRAPE_CACHE_MS);
  if (cached) return cached;

  try {
    const res = await fetch(safeUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
      signal: abortSignal ?? AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text") && !contentType.includes("html") && !contentType.includes("json")) {
      return null;
    }
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : "";
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 10000);

    const result: DuckDuckGoScrapedContent = {
      url: safeUrl,
      title,
      text: bodyText,
      keyIndex: -3,
      source: "duckduckgo",
    };
    await setCache(cacheKey, result, SCRAPE_CACHE_MS);
    return result;
  } catch (error) {
    console.error("DuckDuckGo scrape failed:", error);
    return null;
  }
}

export function getDuckDuckGoStatus(): { available: boolean } {
  return { available: true };
}
