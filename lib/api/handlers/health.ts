import { REGIONS, type Region } from "../_shared/regions";
import { kiloRouter } from "../_shared/kiloRouter";
import { webSearchRouter } from "../_shared/webSearchRouter";
import { analyticsCacheKey, PLAYWRIGHT_MCP_URL } from "../_shared/http";
import { peekCache } from "../_shared/cache";
import { readFactorWindow } from "./factor-analysis";
import { getGlobalAnalytics, getRegionalAnalytics } from "../_shared/deterministicAnalytics";
import type { AnalyticsSnapshot, RegionalAnalyticsSnapshot } from "../_shared/types";

/** Matches the schedule in vercel.json (`0 2 * * *`, UTC). */
const CRON_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CRON_HOUR_UTC = 2;
const FACTOR_POLL_INTERVAL_MS = 120_000;

interface HealthResponse {
  kiloGateway: {
    available: boolean;
    usableKeys: number;
    configuredKeys: number;
    keyFormats?: { jwt: number; opaque: number; unrecognized: number };
  };
  webSearch: {
    available: boolean;
    mcpAvailable: boolean;
    mcpUrl: string | null;
    duckDuckGoAvailable: boolean;
    fallbackUsed: boolean;
  };
  onlineModelConnected: boolean;
  analytics: {
    global: {
      lastFetch: string | null;
      success: boolean;
    };
    regional: Record<
      Region,
      {
        lastFetch: string | null;
        success: boolean;
      }
    >;
  };
  dynamicFactors: {
    global: {
      lastRun: string | null;
      nextRun: string | null;
      aiCurated: boolean;
      pollIntervalMs: number;
    };
    regional: Record<
      Region,
      {
        lastRun: string | null;
        nextRun: string | null;
        aiCurated: boolean;
        pollIntervalMs: number;
      }
    >;
  };
}

/** Next 02:00 UTC boundary, matching the Vercel cron schedule. */
function nextCronRun(now: Date = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(CRON_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setTime(next.getTime() + CRON_INTERVAL_MS);
  }
  return next.toISOString();
}

type AnalyticsStatus = { lastFetch: string | null; success: boolean };
type FactorStatus = { lastRun: string | null; nextRun: string | null; aiCurated: boolean; pollIntervalMs: number };

async function readAnalyticsStatus(scope: "global" | Region): Promise<AnalyticsStatus> {
  const snapshot = await peekCache<AnalyticsSnapshot | RegionalAnalyticsSnapshot>(
    analyticsCacheKey(scope),
  );
  if (!snapshot) {
    // Cache is empty (never fetched or TTL expired). The analytics data is
    // deterministic and cheap to compute, so populate the cache on the fly
    // rather than reporting a false "not fetched" to callers. This keeps the
    // health endpoint informative without requiring a separate warmup cron.
    try {
      const analytics =
        scope === "global"
          ? await getGlobalAnalytics()
          : await getRegionalAnalytics(scope as Region);
      const lastFetch = typeof analytics.timestamp === "string" ? analytics.timestamp : null;
      return { lastFetch, success: lastFetch !== null };
    } catch {
      return { lastFetch: null, success: false };
    }
  }
  const lastFetch = typeof snapshot.timestamp === "string" ? snapshot.timestamp : null;
  return { lastFetch, success: lastFetch !== null };
}

async function readFactorStatus(scope: "global" | Region): Promise<FactorStatus> {
  const window = await readFactorWindow(scope);
  if (!window) {
    return { lastRun: null, nextRun: nextCronRun(), aiCurated: false, pollIntervalMs: FACTOR_POLL_INTERVAL_MS };
  }
  return {
    lastRun: window.updatedAt,
    nextRun: nextCronRun(),
    aiCurated: window.aiCurated,
    pollIntervalMs: FACTOR_POLL_INTERVAL_MS,
  };
}

/**
 * GET /api/health — gateway/key availability plus the real state of the
 * analytics, factor caches, and web search providers. `lastFetch` / `lastRun`
 * / `aiCurated` are derived from what is actually stored.
 *
 * Web search uses an always-on Playwright MCP server (primary) with DuckDuckGo
 * HTTP search as fallback when the MCP server is unavailable.
 */
export async function handleHealth(_req: Request): Promise<Response> {
  const abortController = new AbortController();
  // Must exceed MCP_TIMEOUT_MS (25s) so the MCP availability probe in
  // webSearchRouter can finish its initialize handshake before aborting.
  const totalTimeoutId = setTimeout(() => abortController.abort(), 30000);

  try {
    const [kiloStatus, webSearchStatus, globalAnalytics, regionalAnalytics, globalFactors, regionalFactors] =
      await Promise.all([
        kiloRouter.getKiloStatus(abortController.signal),
        webSearchRouter.getWebSearchStatus(abortController.signal),
        readAnalyticsStatus("global"),
        Promise.all(REGIONS.map((region) => readAnalyticsStatus(region))),
        readFactorStatus("global"),
        Promise.all(REGIONS.map((region) => readFactorStatus(region))),
      ]);

    // Online model is "connected" when Kilo Gateway is usable and web search
    // (MCP primary or DuckDuckGo fallback) is available for live data.
    const onlineModelConnected =
      kiloStatus.available &&
      kiloStatus.usableKeys > 0 &&
      kiloStatus.zeroCostModels.length > 0 &&
      webSearchStatus.available;

    const response: HealthResponse = {
      kiloGateway: {
        available: kiloStatus.available,
        usableKeys: kiloStatus.usableKeys,
        configuredKeys: kiloStatus.configuredKeys,
        keyFormats: kiloStatus.keyFormats,
      },
      webSearch: {
        available: webSearchStatus.available,
        mcpAvailable: webSearchStatus.mcpAvailable,
        mcpUrl: webSearchStatus.mcpUrl,
        duckDuckGoAvailable: webSearchStatus.duckDuckGoAvailable,
        fallbackUsed: webSearchStatus.fallbackUsed,
      },
      onlineModelConnected,
      analytics: {
        global: globalAnalytics,
        regional: Object.fromEntries(
          REGIONS.map((region, i) => [region, regionalAnalytics[i]]),
        ) as Record<Region, AnalyticsStatus>,
      },
      dynamicFactors: {
        global: globalFactors,
        regional: Object.fromEntries(
          REGIONS.map((region, i) => [region, regionalFactors[i]]),
        ) as Record<Region, FactorStatus>,
      },
    };

    return Response.json(response);
  } catch (error) {
    console.error("Health check failed:", error);
    return Response.json(
      {
        error: "Health check temporarily unavailable",
        onlineModelConnected: false,
        kiloGateway: { available: false, usableKeys: 0, configuredKeys: 0, keyFormats: { jwt: 0, opaque: 0, unrecognized: 0 } },
      webSearch: {
        available: false,
        mcpAvailable: false,
        mcpUrl: PLAYWRIGHT_MCP_URL,
        duckDuckGoAvailable: true,
        fallbackUsed: true,
      },
      },
      { status: 200 },
    );
  } finally {
    clearTimeout(totalTimeoutId);
  }
}
