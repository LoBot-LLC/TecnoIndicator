#!/usr/bin/env node
/**
 * Open-WebSearch MCP server launcher (always-on primary web search provider).
 *
 * Starts the open-websearch daemon in HTTP mode so the app can connect via
 * OPEN_WEBSEARCH_MCP_URL (default: https://open-web-search.vercel.app/mcp).
 *
 * Usage:
 *   node mcp/open-websearch-mcp-server.mjs
 *   # or: npm run open-websearch:mcp
 *
 * The open-websearch daemon supports these environment variables:
 *   DEFAULT_SEARCH_ENGINE=duckduckgo  (default: bing)
 *   PORT=3000                         (default: 3000)
 *   ENABLE_CORS=true                  (default: false)
 *   CORS_ORIGIN=*                     (default: *)
 *   MODE=both                         (default: both: HTTP+STDIO)
 */
import { spawn } from "node:child_process";

const port = process.env.OPEN_WEBSEARCH_MCP_PORT ?? "3000";
const host = process.env.OPEN_WEBSEARCH_MCP_HOST ?? "0.0.0.0";
const mode = process.env.OPEN_WEBSEARCH_MCP_MODE ?? "both";

const args = [
  "open-websearch@latest",
  "serve",
  "--port",
  port,
  "--host",
  host,
  "--mode",
  mode,
];

console.log(`[open-websearch-mcp] starting on http://${host}:${port}/mcp`);
const child = spawn("npx", ["-y", ...args], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  console.error(`[open-websearch-mcp] exited code=${code} signal=${signal}`);
  process.exit(code ?? 1);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));