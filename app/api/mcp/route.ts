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

function getBrowserHeaders(referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (referer) headers.Referer = referer;
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

async function searchDuckDuckGo(query: string, numResults: number): Promise<SearchResultItem[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetchWithTimeout(searchUrl, {
    headers: getBrowserHeaders("https://duckduckgo.com/"),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: ${response.status}`);
  }

  const html = await response.text();
  return parseDuckDuckGoHtml(html, numResults);
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