# MCP Servers (SearXNG primary, DuckDuckGo fallback)

This project uses an **always-on SearXNG MCP server** ([`mcp-searxng`](https://github.com/ihor-sokoliuk/mcp-searxng)) as the primary web search/scrape provider for live commodity prices and the 8 dynamic FIFO factors. **DuckDuckGo HTTP search** is used ONLY as a fallback when the SearXNG MCP server is unavailable/fails (never by default).

## SearXNG MCP server (primary)

The SearXNG MCP server brokers requests to a SearXNG instance (multi-engine, privacy-respecting). It exposes MCP tools including `searxng_web_search` and `web_url_read` over Streamable HTTP.

### Prerequisites
- A running **SearXNG instance** with JSON search enabled. You operate or trust this instance.
- Node.js 22+ (for `mcp-searxng` via npx) or Docker.

### Start the server

```bash
# 1) Start/ensure your SearXNG instance is running (example: http://localhost:8080)
# 2) Start mcp-searxng HTTP server pointing at it:
SEARXNG_URL=http://localhost:8080 npm run searxng:mcp
# or
SEARXNG_URL=http://localhost:8080 node mcp/searxng-mcp-server.mjs
```

Default endpoint: `http://localhost:3000/mcp` (streamable HTTP)

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

The primary web search provider is SearXNG MCP (`SEARXNG_MCP_URL`). Playwright MCP is optional and not used by default for search.

## Fallback behavior

- **Primary:** SearXNG MCP (`searxng_web_search`, `web_url_read`) for current prices and 8 dynamic FIFO factors.
- **Fallback:** DuckDuckGo HTTP search (html/lite/instant-answer + direct fetch) ONLY when SearXNG MCP fails or is unreachable.
- The app does not use fallback options by default when SearXNG MCP is operating normally.
