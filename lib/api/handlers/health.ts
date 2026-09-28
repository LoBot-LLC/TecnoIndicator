import { REGIONS, type Region } from "../_shared/regions";
import { kiloRouter } from "../_shared/kiloRouter";
import { tinyfishRouter } from "../_shared/tinyfishRouter";
import { analyticsCacheKey } from "../_shared/http";
import { peekCache } from "../_shared/cache";
import { readFactorRunStatus, readFactorWindow } from "./factor-analysis";
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
    /** Env-var NAMES in use and read. Key VALUES are never exposed or logged. */
    keyEnvNames: string[];
    keyEnvNamesRead: string[];
    /** Per-key probe outcome, so an unusable credential is diagnosable. */
    keys: Array<{
      envName: string;
      available: boolean;
      rateLimited: boolean;
      zeroCostVerified: boolean;
      lastStatus: number | null;
      lastError: string | null;
      lastCheckedAt: string | null;
      lastSuccessAt: string | null;
      reprobeAfter: string | null;
    }>;
    catalogLastRefresh: string | null;
    modelCount: number;
    zeroCostModelCount: number;
    usableModelCount: number;
  };
  tinyfish: {
    available: boolean;
    usableKeys: number;
    configuredKeys: number;
    keyEnvNames: string[];
    keyEnvNamesRead: string[];
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
    global: FactorStatus;
    regional: Record<Region, FactorStatus>;
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
type FactorStatus = {
  /** When the stored curated window was last written. */
  lastRun: string | null;
  /** When a curation run was last ATTEMPTED (successful or not). */
  lastAttempt: string | null;
  /** When an AI-curated window was last written, tracked separately. */
  lastAiRunAt: string | null;
  nextRun: string | null;
  aiCurated: boolean;
  /** True when the last attempt degraded (and was therefore not persisted). */
  degraded: boolean;
  reason: string | null;
  pollIntervalMs: number;
};

async function readAnalyticsStatus(scope: "global" | Region): Promise<AnalyticsStatus> {
  const snapshot = await peekCache<AnalyticsSnapshot | RegionalAnalyticsSnapshot>(
    analyticsCacheKey(scope),
  );
  if (!snapshot) {
    // Nothing cached yet: this scope's analytics has not been requested since
    // the last cold start. That is "not yet fetched", not "successful".
    return { lastFetch: null, success: false };
  }
  const lastFetch = typeof snapshot.timestamp === "string" ? snapshot.timestamp : null;
  return { lastFetch, success: lastFetch !== null };
}

async function readFactorStatus(scope: "global" | Region): Promise<FactorStatus> {
  // The window and the run status are stored under different keys: a degraded
  // run records its attempt/reason without touching the curated window, so
  // `lastRun` can never be re-stamped by a failure.
  const [window, status] = await Promise.all([readFactorWindow(scope), readFactorRunStatus(scope)]);
  if (!window) {
    return {
      lastRun: null,
      lastAttempt: status?.lastAttemptAt ?? null,
      lastAiRunAt: status?.lastAiRunAt ?? null,
      nextRun: nextCronRun(),
      aiCurated: false,
      degraded: status?.reason != null,
      reason: status?.reason ?? null,
      pollIntervalMs: FACTOR_POLL_INTERVAL_MS,
    };
  }
  return {
    lastRun: window.updatedAt,
    lastAttempt: status?.lastAttemptAt ?? window.updatedAt,
    lastAiRunAt: window.lastAiRunAt ?? status?.lastAiRunAt ?? null,
    nextRun: nextCronRun(),
    aiCurated: window.aiCurated,
    degraded: status?.reason != null,
    reason: status?.reason ?? null,
    pollIntervalMs: FACTOR_POLL_INTERVAL_MS,
  };
}

/**
 * GET /api/health — gateway/key availability plus the real state of the
 * analytics and factor caches. `lastFetch` / `lastRun` / `aiCurated` are derived
 * from what is actually stored; they used to be hardcoded literals that always
 * reported a successful, never-run analysis.
 */
export async function handleHealth(_req: Request): Promise<Response> {
  // The page polls this every 5 minutes, which makes it the ideal place to keep
  // the module-level router singletons warm. Both initializations are idempotent
  // and return early once warmed, so this costs a cheap boolean check on the
  // hot path while removing the catalog fetch + probe from the first user
  // request. Rejections are swallowed: a warm-up failure is not a health answer.
  try {
    void kiloRouter.initKiloRouter().catch(() => undefined);
  } catch {
    // ignored: warm-up is best-effort
  }
  try {
    void tinyfishRouter.refreshTinyfishStatus().catch(() => undefined);
  } catch {
    // ignored: warm-up is best-effort
  }

  // Health check triggers full initialization (model catalog fetch + key probing)
  // so that the returned status accurately reflects whether a live Kilo Gateway
  // connection is available.  The initialization is protected by the same
  // abortController, so a cold start that exceeds the timeout will still be
  // caught and the endpoint will return a degraded-but-informed response.
  // 20s (was 10s): the 8s catalog fetch plus the 3s probe cannot fit in 10s, so
  // this endpoint was structurally always reporting degraded. Still >=40s of
  // headroom under vercel.json's 60s maxDuration.
  const abortController = new AbortController();
  const totalTimeoutId = setTimeout(() => abortController.abort(), 20000);

  try {
    const [kiloStatus, tinyfishStatus, globalAnalytics, regionalAnalytics, globalFactors, regionalFactors] =
      await Promise.all([
        kiloRouter.getKiloStatus(abortController.signal),
        tinyfishRouter.getTinyfishStatus(abortController.signal),
        readAnalyticsStatus("global"),
        Promise.all(REGIONS.map((region) => readAnalyticsStatus(region))),
        readFactorStatus("global"),
        Promise.all(REGIONS.map((region) => readFactorStatus(region))),
      ]);

    // `zeroCostModels` is a cost preference, not an availability requirement:
    // a free model listed without usable `pricing` used to flip the whole
    // product to "unavailable" even though inference would have worked.
    const onlineModelConnected =
      kiloStatus.available &&
      kiloStatus.usableKeys > 0 &&
      tinyfishStatus.available &&
      tinyfishStatus.usableKeys > 0;

    const response: HealthResponse = {
      kiloGateway: {
        available: kiloStatus.available,
        usableKeys: kiloStatus.usableKeys,
        configuredKeys: kiloStatus.configuredKeys,
        keyFormats: kiloStatus.keyFormats,
        keyEnvNames: kiloStatus.keyEnvNames,
        keyEnvNamesRead: kiloStatus.keyEnvNamesRead,
        keys: kiloStatus.keyDetails,
        catalogLastRefresh: kiloStatus.catalogLastRefresh,
        modelCount: kiloStatus.modelCount,
        zeroCostModelCount: kiloStatus.zeroCostModelCount,
        usableModelCount: kiloStatus.usableModelCount,
      },
      tinyfish: {
        available: tinyfishStatus.available,
        usableKeys: tinyfishStatus.usableKeys,
        configuredKeys: tinyfishStatus.configuredKeys,
        keyEnvNames: tinyfishStatus.keyEnvNames,
        keyEnvNamesRead: tinyfishStatus.keyEnvNamesRead,
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
        kiloGateway: {
          available: false,
          usableKeys: 0,
          configuredKeys: 0,
          keyFormats: { jwt: 0, opaque: 0, unrecognized: 0 },
          keyEnvNames: [],
          keyEnvNamesRead: [],
          keys: [],
          catalogLastRefresh: null,
          modelCount: 0,
          zeroCostModelCount: 0,
          usableModelCount: 0,
        },
        tinyfish: { available: false, usableKeys: 0, configuredKeys: 0, keyEnvNames: [], keyEnvNamesRead: [] },
      },
      { status: 200 },
    );
  } finally {
    clearTimeout(totalTimeoutId);
  }
}
