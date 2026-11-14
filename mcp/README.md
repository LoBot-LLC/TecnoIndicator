# MCP Servers (Embedded /api/mcp primary, DuckDuckGo fallback)

This project embeds a **Streamable HTTP MCP server** at `/api/mcp` (see `app/api/mcp/route.ts`) as the primary web search/scrape provider in production. When `SEARXNG_MCP_URL` is unset, the app uses this embedded server which proxies to a SearXNG instance (`SEARXNG_INSTANCE_URL`) and falls back to DuckDuckGo HTTP search internally. **DuckDuckGo HTTP search** is used ONLY as a fallback when the embedded MCP server is unavailable/fails (never by default).

## Embedded MCP server (`/api/mcp`, production primary)

The embedded Streamable HTTP MCP server at `/api/mcp` (see `app/api/mcp/route.ts`) exposes MCP tools including `searxng_web_search` and `web_url_read` over Streamable HTTP. It proxies to a SearXNG instance (`SEARXNG_INSTANCE_URL`) for multi-engine, privacy-respecting web search/scrape, and falls back to DuckDuckGo HTTP search internally when the instance is unavailable.

### Key points
- **Primary in production:** When `SEARXNG_MCP_URL` is unset, the app automatically uses the embedded `/api/mcp` route.
- **External override:** Set `SEARXNG_MCP_URL` to point at an external MCP server instead of using the embedded one.
- **Kilo Gateway AI models** can use search directly through this MCP server.
- Fallback to DuckDuckGo HTTP search is automatic at runtime when SearXNG is unavailable.

### Prerequisites (for external MCP server only)
- A running **SearXNG instance** with JSON search enabled. You operate or trust this instance.
- Node.js 22+ (for `mcp-searxng` via npx) or Docker.

### Start the embedded server (no setup needed)

The embedded MCP server at `/api/mcp` requires no separate startup — it is always available as part of the app. Ensure a SearXNG instance URL is configured via `SEARXNG_INSTANCE_URL` if you want it to proxy to SearXNG instead of falling back to DuckDuckGo:

```bash
SEARXNG_INSTANCE_URL=http://localhost:8080
```

### External MCP server (local development only, optional)

Use `mcp/searxng-mcp-server.mjs` to start an external MCP server for local development only. This is **not used by default in production**.

```bash
# 1) Start/ensure your SearXNG instance is running (example: http://localhost:8080)
# 2) Start mcp-searxng HTTP server pointing at it:
SEARXNG_URL=http://localhost:8080 node mcp/searxng-mcp-server.mjs
# or via npm script:
SEARXNG_URL=http://localhost:8080 npm run searxng:mcp
```

Default endpoint: `http://localhost:3000/mcp` (streamable HTTP) — for external use only.

Configure the app with:

```env
SEARXNG_MCP_URL=http://localhost:3000/mcp
```

For cloud/Vercel deployments, host `mcp-searxng` + a SearXNG instance on reachable infrastructure and set `SEARXNG_MCP_URL` to that remote MCP endpoint. Do not rely on localhost in cloud environments.

## Playwright MCP server (optional, legacy)

```bash
npm run playwright:mcp
# Default endpoint: http://localhost:8931/mcp
```

The primary web search provider is the embedded MCP server at `/api/mcp` (`SEARXNG_MCP_URL` unset). Playwright MCP is optional and not used by default for search.

## Fallback behavior

- **Primary:** Embedded MCP server at `/api/mcp` (`searxng_web_search`, `web_url_read`) for current prices and 8 dynamic FIFO factors.
- **Fallback:** DuckDuckGo HTTP search (html/lite/instant-answer + direct fetch) ONLY when the embedded MCP server is unavailable or fails.
- The app does not use fallback options by default when the embedded MCP server is operating normally.