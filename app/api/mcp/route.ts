import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TIMEOUT_MS = 25_000;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = {
  name: "tecnoindicator-searxng-mcp",
  version: "1.0.0",
};

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface SearchResultItem {
  url: string;
  title: string;
  content: string;
  engine?: string;
  publishedDate?: string;
}

interface ScrapedContent {
  url: string;
  title: string;
  content: string;
  finalUrl: string;
}

function createSuccessResponse(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function createErrorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function parseJsonRpcRequest(body: unknown): JsonRpcRequest | null {
  if (!body || typeof body !== "object") return null;
  const req = body as Record<string, unknown>;
  if (req.jsonrpc !== "2.0") return null;
  if (typeof req.method !== "string") return null;
  const id = req.id === undefined ? null : req.id;
  if (id !== null && typeof id !== "number" && typeof id !== "string") return null;
  return {
    jsonrpc: "2.0",
    id,
    method: req.method,
    params: req.params,
  };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal
        ? combineAbortSignals(fetchOptions.signal, controller.signal)
        : controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function generateRandomPublicIp(): string {
  const privateRanges = [
    { start: 0x0a000000, end: 0x0affffff },      // 10.0.0.0/8
    { start: 0xac100000, end: 0xac1fffff },      // 172.16.0.0/12
    { start: 0xc0a80000, end: 0xc0a8ffff },      // 192.168.0.0/16
    { start: 0x7f000000, end: 0x7fffffff },      // 127.0.0.0/8
    { start: 0xa9fe0000, end: 0xa9feffff },      // 169.254.0.0/16
    { start: 0x64400000, end: 0x647fffff },      // 100.64.0.0/10 (CGNAT)
    { start: 0xe0000000, end: 0xffffffff },      // 224.0.0.0/4 (multicast/reserved)
    { start: 0x00000000, end: 0x00ffffff },      // 0.0.0.0/8
  ];

  while (true) {
    const ip = Math.floor(Math.random() * 0xffffffff);
    if (privateRanges.some((r) => ip >= r.start && ip <= r.end)) continue;
    return `${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`;
  }
}

function getBrowserHeaders(referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    DNT: "1",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "X-Forwarded-For": generateRandomPublicIp(),
  };
  if (referer) {
    headers.Referer = referer;
    headers["Sec-Fetch-Site"] = "cross-site";
  }
  return headers;
}

async function searchSearxng(query: string, numResults: number): Promise<SearchResultItem[]> {
  const instanceUrl = process.env.SEARXNG_INSTANCE_URL;
  if (!instanceUrl) {
    throw new Error("SEARXNG_INSTANCE_URL not configured");
  }

  const searchUrl = new URL("/search", instanceUrl);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("language", "en");
  searchUrl.searchParams.set("safesearch", "1");

  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: getBrowserHeaders(instanceUrl),
  });

  if (!response.ok) {
    throw new Error(`SearXNG search failed: ${response.status}`);
  }

  const data = await response.json();
  const results: SearchResultItem[] = [];

  if (Array.isArray(data.results)) {
    for (const item of data.results) {
      if (!item || typeof item !== "object") continue;
      const url = typeof item.url === "string" ? item.url : "";
      const title = typeof item.title === "string" ? item.title : "";
      const content =
        typeof item.content === "string"
          ? item.content
          : typeof item.snippet === "string"
            ? item.snippet
            : "";
      if (!url || !title) continue;
      results.push({
        url,
        title,
        content,
        engine: typeof item.engine === "string" ? item.engine : undefined,
        publishedDate: typeof item.publishedDate === "string" ? item.publishedDate : undefined,
      });
      if (results.length >= numResults) break;
    }
  }

  return results;
}

function parseDuckDuckGoHtml(html: string, limit: number): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  const resultRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>.*?<\/div>/gs;
  const matches = html.match(resultRegex);
  if (!matches) return results;

  for (const block of matches) {
    const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/is);
    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/is);

    if (titleMatch) {
      let url = titleMatch[1];
      const title = titleMatch[2].replace(/<[^>]*>/g, "").trim();

      if (url.startsWith("//")) url = "https:" + url;
      if (url.includes("duckduckgo.com/l/?")) {
        try {
          const u = new URL(url);
          const uddg = u.searchParams.get("uddg");
          if (uddg) url = decodeURIComponent(uddg);
        } catch {}
      }

      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "";

      results.push({ url, title, content: snippet, engine: "duckduckgo" });

      if (results.length >= limit) break;
    }
  }

  return results;
}

function parseDuckDuckGoLite(html: string, limit: number): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  const linkRegex = /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis;
  const snippetRegex = /<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>(.*?)<\/td>/gis;

  const links: { url: string; title: string }[] = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    let url = match[1];
    const title = match[2].replace(/<[^>]*>/g, "").trim();

    if (url.startsWith("//")) url = "https:" + url;
    if (url.includes("duckduckgo.com/l/?")) {
      try {
        const u = new URL(url);
        const uddg = u.searchParams.get("uddg");
        if (uddg) url = decodeURIComponent(uddg);
      } catch {}
    }

    if (url && title) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]*>/g, "").trim());
  }

  for (let i = 0; i < links.length && results.length < limit; i++) {
    results.push({
      url: links[i].url,
      title: links[i].title,
      content: snippets[i] || "",
      engine: "duckduckgo",
    });
  }

  return results;
}

function parseDuckDuckGoInstant(query: string, limit: number, data: unknown): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  if (!data || typeof data !== "object") return results;

  const d = data as Record<string, unknown>;

  const abstractText = typeof d.AbstractText === "string" ? d.AbstractText : "";
  const abstractSource = typeof d.AbstractSource === "string" ? d.AbstractSource : "";
  const abstractUrl = typeof d.AbstractURL === "string" ? d.AbstractURL : "";

  if (abstractUrl && abstractText) {
    results.push({
      url: abstractUrl,
      title: abstractSource || query,
      content: abstractText,
      engine: "duckduckgo",
    });
  }

  const relatedTopics = Array.isArray(d.RelatedTopics) ? d.RelatedTopics : [];
  for (const topic of relatedTopics) {
    if (results.length >= limit) break;
    if (!topic || typeof topic !== "object") continue;
    const t = topic as Record<string, unknown>;

    if (typeof t.Text === "string" && typeof t.FirstURL === "string") {
      results.push({
        url: t.FirstURL as string,
        title: (t.Text as string).split(" - ")[0] || query,
        content: typeof t.Text === "string" ? t.Text as string : "",
        engine: "duckduckgo",
      });
      continue;
    }

    const subTopics = Array.isArray(t.SubTopics) ? t.SubTopics : [];
    for (const sub of subTopics) {
      if (results.length >= limit) break;
      if (!sub || typeof sub !== "object") continue;
      const s = sub as Record<string, unknown>;
      if (typeof s.Text === "string" && typeof s.FirstURL === "string") {
        results.push({
          url: s.FirstURL as string,
          title: (s.Text as string).split(" - ")[0] || query,
          content: typeof s.Text === "string" ? s.Text as string : "",
          engine: "duckduckgo",
        });
      }
    }
  }

  return results;
}

async function searchDuckDuckGo(query: string, numResults: number): Promise<SearchResultItem[]> {
  const encodedQuery = encodeURIComponent(query);
  const errors: string[] = [];

  const referer = "https://duckduckgo.com/";

  // Endpoint 1: html.duckduckgo.com/html/
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
    const response = await fetchWithTimeout(searchUrl, {
      headers: getBrowserHeaders(referer),
    });

    if (response.status === 202) {
      console.warn("[DDG] html endpoint returned 202 (anomaly challenge), trying lite endpoint");
      errors.push("html: 202 anomaly challenge");
    } else if (response.ok) {
      const html = await response.text();
      const results = parseDuckDuckGoHtml(html, numResults);
      if (results.length > 0) return results;
      errors.push("html: no results found");
    } else {
      errors.push(`html: HTTP ${response.status}`);
    }
  } catch (error) {
    errors.push(`html: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  // Endpoint 2: lite.duckduckgo.com/lite/
  try {
    const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;
    const response = await fetchWithTimeout(searchUrl, {
      headers: getBrowserHeaders(referer),
    });

    if (response.status === 202) {
      console.warn("[DDG] lite endpoint returned 202 (anomaly challenge), trying instant answer API");
      errors.push("lite: 202 anomaly challenge");
    } else if (response.ok) {
      const html = await response.text();
      const results = parseDuckDuckGoLite(html, numResults);
      if (results.length > 0) return results;
      errors.push("lite: no results found");
    } else {
      errors.push(`lite: HTTP ${response.status}`);
    }
  } catch (error) {
    errors.push(`lite: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  // Endpoint 3: DuckDuckGo Instant Answer API
  try {
    const searchUrl = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetchWithTimeout(searchUrl, {
      headers: getBrowserHeaders(referer),
    });

    if (response.ok) {
      const data = await response.json();
      const results = parseDuckDuckGoInstant(query, numResults, data);
      if (results.length > 0) return results;
      errors.push("instant: no results found");
    } else {
      errors.push(`instant: HTTP ${response.status}`);
    }
  } catch (error) {
    errors.push(`instant: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  throw new Error(`All DuckDuckGo endpoints failed: ${errors.join("; ")}`);
}

async function searchWeb(
  query: string,
  numResults: number
): Promise<{ results: SearchResultItem[]; source: string }> {
  try {
    const results = await searchSearxng(query, numResults);
    if (results.length > 0) {
      return { results, source: "searxng" };
    }
  } catch (error) {
    console.warn("SearXNG search failed, falling back to DuckDuckGo:", error);
  }

  const results = await searchDuckDuckGo(query, numResults);
  return { results, source: "duckduckgo" };
}

async function readUrl(url: string, maxLength = 20000): Promise<ScrapedContent> {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) {
    throw new Error("Invalid URL");
  }

  const response = await fetchWithTimeout(safeUrl, {
    headers: getBrowserHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }

  const html = await response.text();
  const finalUrl = response.url;

  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(safeUrl).hostname;

  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  if (!text) {
    throw new Error("No content extracted");
  }

  return { url: finalUrl, title, content: text, finalUrl };
}

function sanitizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function getToolsList() {
  return [
    {
      name: "searxng_web_search",
      description:
        "Search the web using SearXNG (multi-engine: Google, Bing, DuckDuckGo, Brave, etc.). Returns structured results with URLs, titles, snippets, source engine, and publication dates.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query string" },
          num_results: { type: "number", description: "Number of results to return (default: 10)", default: 10 },
          response_format: { type: "string", description: "Response format (default: json)", default: "json" },
          result_detail: { type: "string", description: "Result detail level (default: full)", default: "full" },
        },
        required: ["query"],
      },
    },
    {
      name: "web_url_read",
      description: "Fetch and extract text content from a web page. Returns title, extracted text, and final URL after redirects.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch and read" },
          maxLength: { type: "number", description: "Maximum characters to return (default: 20000)", default: 20000 },
        },
        required: ["url"],
      },
    },
  ];
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: "ok",
    service: "tecnoindicator-searxng-mcp",
    transport: "streamable-http",
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const protocolVersion = request.headers.get("MCP-Protocol-Version");
  const sessionId = request.headers.get("MCP-Session-Id");

  if (protocolVersion) {
    console.log(`[MCP] Protocol version: ${protocolVersion}`);
  }
  if (sessionId) {
    console.log(`[MCP] Session ID: ${sessionId}`);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(null, -32700, "Parse error"),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const rpcRequest = parseJsonRpcRequest(body);
  if (!rpcRequest) {
    return NextResponse.json(
      createErrorResponse(null, -32600, "Invalid Request"),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let response: JsonRpcResponse;

  try {
    switch (rpcRequest.method) {
      case "initialize": {
        const params = rpcRequest.params as Record<string, unknown> | undefined;
        const clientProtocolVersion = params?.protocolVersion as string | undefined;
        const acceptedVersion = clientProtocolVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(clientProtocolVersion)
          ? clientProtocolVersion
          : "2025-06-18";

        response = createSuccessResponse(rpcRequest.id, {
          protocolVersion: acceptedVersion,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        break;
      }

      case "notifications/initialized": {
        response = createSuccessResponse(rpcRequest.id, {});
        break;
      }

      case "tools/list": {
        response = createSuccessResponse(rpcRequest.id, { tools: getToolsList() });
        break;
      }

      case "tools/call": {
        const params = rpcRequest.params as Record<string, unknown> | undefined;
        const toolName = params?.name as string | undefined;
        const args = params?.arguments as Record<string, unknown> | undefined;

        if (!toolName) {
          response = createErrorResponse(rpcRequest.id, -32602, "Invalid params: missing tool name");
          break;
        }

        if (toolName === "searxng_web_search") {
          const query = args?.query as string | undefined;
          const numResults = (args?.num_results as number) ?? 10;

          if (!query || typeof query !== "string") {
            response = createErrorResponse(rpcRequest.id, -32602, "Invalid params: query is required");
            break;
          }

          const { results, source } = await searchWeb(query, Math.min(numResults, 50));

          const formattedResults = results.map((r, i) => ({
            position: i + 1,
            url: r.url,
            title: r.title,
            snippet: r.content,
            source: r.engine ?? source,
            publishedDate: r.publishedDate,
          }));

          response = createSuccessResponse(rpcRequest.id, {
            content: [{ type: "text", text: JSON.stringify(formattedResults) }],
            structuredContent: { results: formattedResults, source, query },
          });
        } else if (toolName === "web_url_read") {
          const url = args?.url as string | undefined;
          const maxLength = (args?.maxLength as number) ?? 20000;

          if (!url || typeof url !== "string") {
            response = createErrorResponse(rpcRequest.id, -32602, "Invalid params: url is required");
            break;
          }

          const scraped = await readUrl(url, maxLength);

          response = createSuccessResponse(rpcRequest.id, {
            content: [{ type: "text", text: JSON.stringify(scraped) }],
            structuredContent: scraped,
          });
        } else {
          response = createErrorResponse(rpcRequest.id, -32601, `Method not found: tool '${toolName}' not available`);
        }
        break;
      }

      default: {
        response = createErrorResponse(rpcRequest.id, -32601, `Method not found: ${rpcRequest.method}`);
      }
    }
  } catch (error) {
    console.error("[MCP] Tool execution error:", error);
    response = createErrorResponse(
      rpcRequest.id,
      -32603,
      error instanceof Error ? error.message : "Internal error"
    );
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionId) headers["MCP-Session-Id"] = sessionId;

  return NextResponse.json(response, { headers });
}