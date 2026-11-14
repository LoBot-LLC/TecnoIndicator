import { getCache, setCache } from "./cache";
import { SEARCH_CACHE_MS, SCRAPE_CACHE_MS, sanitizeUrl, OPEN_WEBSEARCH_MCP_URL } from "./http";
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
    // Always-on Open-WebSearch MCP server is the primary search provider.
    // DuckDuckGo HTTP search is used only when the Open-WebSearch MCP server is
    // unavailable or misconfigured.
    //
    // - Set OPEN_WEBSEARCH_MCP_URL to a remote MCP server URL for cloud/deployed
    //   environments (e.g. http://localhost:3000/mcp for a local `open-websearch` daemon).
    // - Set OPEN_WEBSEARCH_MCP_URL to an empty string to explicitly disable MCP
    //   and use DuckDuckGo fallback only.
    // - If unset, defaults to the public hosted instance:
    //   https://open-web-search.vercel.app/mcp (recommended for production/Edge).
    this.mcpUrl = OPEN_WEBSEARCH_MCP_URL;
  }

  /** Reset MCP session state so the next call re-initializes from scratch. */
  private resetMcpState(): void {
    this.mcpSessionId = null;
    this.mcpInitialized = false;
  }

  /** Initialize/Open a new MCP session with the Open-WebSearch server. */
  /** Parse a JSON-RPC payload from either SSE text or plain JSON. */
  private parseRpcMessages(text: string): unknown[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    // Plain JSON response
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // fall through to SSE parsing
      }
    }

    // SSE: collect data: lines (may be multi-event)
    const messages: unknown[] = [];
    const blocks = trimmed.split(/\n\n+/);
    for (const block of blocks) {
      const dataLines = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n").trim();
      if (!data || data === "[DONE]") continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        // ignore malformed event
      }
    }
    return messages;
  }

  private async mcpPost(
    payload: Record<string, unknown>,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<{ ok: boolean; status: number; sessionId: string | null; messages: unknown[]; text: string }> {
    if (!this.mcpUrl) {
      return { ok: false, status: 0, sessionId: null, messages: [], text: "" };
    }

    const controller = new AbortController();
    const combinedSignal = abortSignal
      ? combineAbortSignals(abortSignal, controller.signal)
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      };
      if (this.mcpSessionId) headers["MCP-Session-Id"] = this.mcpSessionId;

      const response = await fetch(this.mcpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: combinedSignal,
      });

      const sessionId = response.headers.get("mcp-session-id");
      const text = response.ok ? await response.text() : await response.text().catch(() => "");
      const messages = response.ok ? this.parseRpcMessages(text) : [];
      return { ok: response.ok, status: response.status, sessionId, messages, text };
    } catch (error) {
      console.warn("Open-WebSearch MCP request error:", error);
      return { ok: false, status: 0, sessionId: null, messages: [], text: "" };
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  /** Initialize/Open a new MCP session with the Open-WebSearch server. */
  private async mcpInitialize(abortSignal?: AbortSignal): Promise<boolean> {
    if (this.mcpInitialized) return true;
    if (!this.mcpUrl) return false;

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

      const res = await this.mcpPost(initPayload, MCP_TIMEOUT_MS, abortSignal);
      if (!res.ok) {
        this.resetMcpState();
        console.warn(`Open-WebSearch MCP initialize failed: ${res.status} ${res.text?.slice(0, 200) ?? ""}`);
        return false;
      }

      if (res.sessionId) this.mcpSessionId = res.sessionId;

      const initMsg = res.messages.find((m) => {
        const msg = m as { id?: unknown; result?: { protocolVersion?: string } };
        return msg && (msg.id === 1 || msg.result?.protocolVersion);
      }) as { result?: { protocolVersion?: string } } | undefined;

      if (initMsg?.result?.protocolVersion || res.sessionId || res.messages.length > 0) {
        this.mcpInitialized = true;
        // Send notifications/initialized (best-effort, some servers require it)
        try {
          await this.mcpPost(
            { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
            5000,
            abortSignal
          );
        } catch {
          // ignore
        }
        return true;
      }

      this.resetMcpState();
      return false;
    } catch (error) {
      this.resetMcpState();
      console.warn("Open-WebSearch MCP initialize error:", error);
      return false;
    }
  }

  /** Extract tool call result payload from MCP tools/call response. */
  private extractToolResult(messages: unknown[], id: number): unknown {
    const msg = messages.find((m) => (m as { id?: unknown }).id === id) as
      | { result?: unknown; error?: { message?: string } }
      | undefined;
    if (!msg) return null;
    if (msg.error) throw new Error(msg.error.message ?? "Open-WebSearch MCP tool error");

    const result = msg.result as {
      content?: Array<{ type?: string; text?: string }>;
      structuredContent?: unknown;
      isError?: boolean;
    } | undefined;
    if (!result) return null;

    // Prefer structuredContent if present
    if (result.structuredContent !== undefined && result.structuredContent !== null) {
      return result.structuredContent;
    }

    // Otherwise try to parse JSON from text content blocks
    if (Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item?.type === "text" && typeof item.text === "string") {
          const t = item.text.trim();
          if (t.startsWith("{") || t.startsWith("[")) {
            try {
              return JSON.parse(t);
            } catch {
              // return raw text as fallback
            }
          }
          return item.text;
        }
      }
    }

    // Some servers may return the payload directly as result
    return result;
  }

  private async mcpSearch(
    query: string,
    options: { limit?: number; region?: Region } = {},
    abortSignal?: AbortSignal
  ): Promise<WebSearchResponse> {
    const limit = options.limit ?? 10;
    // Prefer engines likely to return price-relevant results
    const engines = ["duckduckgo", "bing", "brave", "exa"];

    const initialized = await this.mcpInitialize(abortSignal);
    if (!initialized) throw new Error("Open-WebSearch MCP not initialized");

    const callId = Date.now();
    const callPayload = {
      jsonrpc: "2.0",
      id: callId,
      method: "tools/call",
      params: {
        name: "search",
        arguments: {
          query,
          limit,
          engines,
          searchMode: "auto",
        },
      },
    };

    const res = await this.mcpPost(callPayload, MCP_TIMEOUT_MS, abortSignal);
    if (!res.ok) {
      this.resetMcpState();
      throw new Error(`Open-WebSearch MCP search failed: ${res.status}`);
    }

    const toolResult = this.extractToolResult(res.messages, callId);
    let rawResults: unknown[] = [];
    if (Array.isArray(toolResult)) {
      rawResults = toolResult;
    } else if (toolResult && typeof toolResult === "object") {
      const obj = toolResult as Record<string, unknown>;
      if (Array.isArray(obj.results)) rawResults = obj.results;
      else if (Array.isArray(obj.content)) rawResults = obj.content;
    }

    const results: SearchResult[] = rawResults
      .map((item, i) => {
        if (!item || typeof item !== "object") return null;
        const r = item as Record<string, unknown>;
        const title = typeof r.title === "string" ? r.title : "";
        const rawUrl = typeof r.url === "string" ? r.url : "";
        const snippet =
          typeof r.description === "string"
            ? r.description
            : typeof r.snippet === "string"
              ? r.snippet
              : typeof r.content === "string"
                ? r.content
                : "";
        const url = sanitizeUrl(rawUrl) ?? rawUrl;
        if (!title || !url) return null;
        let siteName = "web";
        try {
          siteName = new URL(url).hostname;
        } catch {}
        return {
          position: i + 1,
          site_name: siteName,
          title,
          snippet,
          url,
          publishedAt: typeof r.publishedAt === "string" ? r.publishedAt : undefined,
        } as SearchResult;
      })
      .filter((r): r is SearchResult => r !== null)
      .slice(0, limit);

    return { results, total: results.length, source: "mcp" };
  }

  private async mcpScrape(url: string, abortSignal?: AbortSignal): Promise<ScrapedContent | null> {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return null;

    const initialized = await this.mcpInitialize(abortSignal);
    if (!initialized) throw new Error("Open-WebSearch MCP not initialized");

    const callId = Date.now();
    const callPayload = {
      jsonrpc: "2.0",
      id: callId,
      method: "tools/call",
      params: {
        name: "fetchWebContent",
        arguments: {
          url: safeUrl,
          maxChars: 20000,
          renderMode: "auto",
          readability: true,
          includeLinks: false,
        },
      },
    };

    const res = await this.mcpPost(callPayload, MCP_TIMEOUT_MS, abortSignal);
    if (!res.ok) {
      this.resetMcpState();
      throw new Error(`Open-WebSearch MCP scrape failed: ${res.status}`);
    }

    const toolResult = this.extractToolResult(res.messages, callId);
    let title = "";
    let textContent = "";
    let finalUrl = safeUrl;

    if (toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)) {
      const obj = toolResult as Record<string, unknown>;
      title = typeof obj.title === "string" ? obj.title : "";
      textContent = typeof obj.content === "string" ? obj.content : "";
      if (typeof obj.finalUrl === "string") finalUrl = sanitizeUrl(obj.finalUrl) ?? safeUrl;
      if (typeof obj.url === "string" && !textContent) finalUrl = sanitizeUrl(obj.url) ?? finalUrl;
    } else if (typeof toolResult === "string") {
      textContent = toolResult;
    }

    if (!textContent) return null;
    return { url: finalUrl, title, text: textContent, source: "mcp" };
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

    // Primary: Open-WebSearch MCP
    if (this.mcpUrl) {
      try {
        const result = await this.mcpSearch(query, options, abortSignal);
        await setCache(cacheKey, result, SEARCH_CACHE_MS);
        return result;
      } catch (error) {
        console.warn("Open-WebSearch MCP search failed, falling back to DuckDuckGo:", error);
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

    // Primary: Open-WebSearch MCP
    if (this.mcpUrl) {
      try {
        const result = await this.mcpScrape(safeUrl, abortSignal);
        if (result) {
          await setCache(cacheKey, result, SCRAPE_CACHE_MS);
          return result;
        }
      } catch (error) {
        console.warn("Open-WebSearch MCP scrape failed, falling back to DuckDuckGo:", error);
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

    // Check Open-WebSearch MCP availability (primary provider)
    if (this.mcpUrl) {
      try {
        // Try a fresh initialize probe
        this.resetMcpState();
        mcpAvailable = await this.mcpInitialize(abortSignal);
      } catch {
        mcpAvailable = false;
        this.resetMcpState();
      }
    }

    // Actually test DuckDuckGo availability with a lightweight request to the search endpoint
    try {
      const ddgController = new AbortController();
      const ddgTimeout = setTimeout(() => ddgController.abort(), 8000);
      const combined = abortSignal
        ? combineAbortSignals(abortSignal, ddgController.signal)
        : ddgController.signal;
      // Test the html endpoint we actually use for search
      const ddgResponse = await fetch("https://html.duckduckgo.com/html/?q=test", {
        headers: this.ddgHeaders(),
        signal: combined,
      });
      duckDuckGoAvailable = ddgResponse.ok || ddgResponse.status === 202;
      clearTimeout(ddgTimeout);
      ddgController.abort();
    } catch {
      // DuckDuckGo is always available as a fallback (no API key needed)
      // Even if the health check fails, we'll try it at runtime
      duckDuckGoAvailable = true;
    }

    return {
      // Available if Open-WebSearch MCP is up OR DuckDuckGo is reachable (fallback)
      available: mcpAvailable || duckDuckGoAvailable,
      mcpAvailable,
      mcpUrl: this.mcpUrl,
      duckDuckGoAvailable,
      fallbackUsed: !mcpAvailable,
    };
  }
}

export const webSearchRouter = new WebSearchRouter();