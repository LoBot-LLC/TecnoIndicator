#!/usr/bin/env node
/**
 * SearXNG MCP server launcher (always-on primary web search provider).
 *
 * Starts the mcp-searxng server in Streamable HTTP mode so the app can connect
 * via SEARXNG_MCP_URL (default local: http://localhost:3000/mcp).
 *
 * Prerequisites:
 *   - A running SearXNG instance with JSON search enabled.
 *   - Set SEARXNG_URL to the SearXNG instance base URL for the MCP server.
 *
 * Usage:
 *   SEARXNG_URL=http://localhost:8080 npm run searxng:mcp
 *   # or: node mcp/searxng-mcp-server.mjs
 *
 * Environment:
 *   SEARXNG_URL            (required by mcp-searxng) SearXNG instance URL
 *   SEARXNG_MCP_PORT       HTTP port for mcp-searxng (default: 3000)
 *   SEARXNG_MCP_HOST       Bind host (default: 0.0.0.0)
 */
import { spawn } from "node:child_process";

const port = process.env.SEARXNG_MCP_PORT ?? "3000";
const host = process.env.SEARXNG_MCP_HOST ?? "0.0.0.0";

if (!process.env.SEARXNG_URL) {
  console.warn(
    "[searxng-mcp] SEARXNG_URL is not set. The mcp-searxng server requires a SearXNG instance. " +
      "Set SEARXNG_URL (e.g. http://localhost:8080) before starting."
  );
}

const env = {
  ...process.env,
  MCP_HTTP_PORT: port,
  MCP_HTTP_HOST: host,
};

console.log(`[searxng-mcp] starting mcp-searxng HTTP server on http://${host}:${port}/mcp`);
const child = spawn("npx", ["-y", "mcp-searxng@latest"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  console.error(`[searxng-mcp] exited code=${code} signal=${signal}`);
  process.exit(code ?? 1);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
