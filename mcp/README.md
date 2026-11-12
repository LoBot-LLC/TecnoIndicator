# Playwright MCP Server (Always-On)

This project uses a **24/7 always-on Playwright MCP server** as the primary web search/scrape provider for live prices and dynamic market factors. **DuckDuckGo HTTP search** is used only as a fallback when the MCP server is unavailable.

## Start the server

```bash
npm run playwright:mcp
# or
node mcp/playwright-mcp-server.mjs
```

Default endpoint:
- `http://localhost:8931/mcp` (streamable HTTP)

Configure the app with:

```env
PLAYWRIGHT_MCP_URL=http://localhost:8931/mcp
```

## Notes

- Runs headless with a shared browser context for stability in long-lived deployments.
- The application must not use DuckDuckGo by default; it is activated only if the MCP server fails to operate.
- For production, run this process under a supervisor (systemd, PM2, Docker, etc.) to keep it always-on.