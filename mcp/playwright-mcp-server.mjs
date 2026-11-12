#!/usr/bin/env node
/**
 * Always-on Playwright MCP server launcher (24/7 primary web search provider).
 *
 * Starts @playwright/mcp in streamable HTTP mode so the app can connect via
 * PLAYWRIGHT_MCP_URL (default: http://localhost:8931/mcp).
 *
 * Usage:
 *   node mcp/playwright-mcp-server.mjs
 *   # or: npm run playwright:mcp
 */
import { spawn } from "node:child_process";

const port = process.env.PLAYWRIGHT_MCP_PORT ?? "8931";
const host = process.env.PLAYWRIGHT_MCP_HOST ?? "0.0.0.0";

const args = [
  "@playwright/mcp@latest",
  "--port",
  port,
  "--host",
  host,
  "--headless",
  "--shared-browser-context",
];

console.log(`[playwright-mcp] starting on http://${host}:${port}/mcp`);
const child = spawn("npx", ["-y", ...args], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  console.error(`[playwright-mcp] exited code=${code} signal=${signal}`);
  process.exit(code ?? 1);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));