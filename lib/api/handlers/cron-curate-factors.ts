import { REGIONS } from "../_shared/regions";
import { runFactorAnalysis, writeFactorRunStatus, writeFactorWindow } from "./factor-analysis";
import { sanitizeError } from "../_shared/validation";
import type { RegionId } from "../_shared/types";

export interface CronCurationResult {
  success: boolean;
  count: number;
  /** False when the run degraded and nothing was persisted. */
  persisted: boolean;
  reason?: string;
  error?: string;
}

/**
 * Per-scope budget for one curation run inside the cron. The same 45s the
 * interactive routes use: it is the per-run pipeline budget, and the cron's own
 * wall-clock ceiling is managed separately by running scopes concurrently.
 */
const SCOPE_TIMEOUT_MS = 45_000;
/**
 * How many scopes are curated at once. Six sequential runs at a 45s budget is
 * 270s of vendor time against vercel.json's 300s cron `maxDuration` — one slow
 * scope and the cron is killed by the platform with nothing persisted. At 3
 * the whole cron is 2 waves x 45s = 90s worst case, comfortably inside 300s.
 */
const SCOPE_CONCURRENCY = 3;

/** GET /api/cron/curate-factors — invoked by the Vercel cron defined in
 * vercel.json (`0 2 * * *`). Refreshes the rolling factor window for the
 * global scope and every region, writing each one to the canonical
 * `dynamic-factors:{scope}` key.
 *
 * Re-curating through {@link runFactorAnalysis} is what makes the window roll:
 * the previously stored factors are read first, merged with the new ones and
 * trimmed to the newest 8, so the oldest reason is only discarded when a new
 * reason arrives. A degraded scope is reported (and never persisted) instead of
 * being reported as a success.
 */
export async function handleCurateFactorsCron(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return Response.json(
      { success: false, error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }

  try {
    const results: Record<string, CronCurationResult> = {};
    const scopes: RegionId[] = ["global", ...REGIONS];

    // Each scope gets its OWN controller/timer. The previous version called
    // `runFactorAnalysis(scope)` with no options at all, so a run was unbounded
    // and the six scopes ran strictly sequentially.
    const curateScope = async (scope: RegionId): Promise<[RegionId, CronCurationResult]> => {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), SCOPE_TIMEOUT_MS);
      try {
        const outcome = await runFactorAnalysis(scope, { abortSignal: abortController.signal });
        if (!outcome.ok) {
          // Diagnostics are recorded under a separate key; the curated window is
          // left exactly as it was so a failure cannot look like fresh curation.
          await writeFactorRunStatus(scope, {
            aiCurated: outcome.window.aiCurated,
            reason: outcome.reason ?? null,
            lastAttemptAt: new Date().toISOString(),
            lastAiRunAt: outcome.window.lastAiRunAt ?? null,
            diagnostics: outcome.diagnostics,
          });
          return [
            scope,
            {
              success: false,
              count: outcome.window.factors.length,
              persisted: false,
              ...(outcome.reason ? { reason: outcome.reason } : {}),
            },
          ];
        }
        await writeFactorWindow(scope, outcome.window.factors, outcome.window.aiCurated);
        await writeFactorRunStatus(scope, {
          aiCurated: true,
          reason: null,
          lastAttemptAt: outcome.window.updatedAt,
          lastAiRunAt: outcome.window.updatedAt,
          diagnostics: outcome.diagnostics,
        });
        return [scope, { success: true, count: outcome.window.factors.length, persisted: true }];
      } catch (error) {
        return [
          scope,
          {
            success: false,
            count: 0,
            persisted: false,
            reason: abortController.signal.aborted ? "kilo-aborted" : "threw",
            error: sanitizeError(String(error)),
          },
        ];
      } finally {
        clearTimeout(timeoutId);
      }
    };

    for (let start = 0; start < scopes.length; start += SCOPE_CONCURRENCY) {
      const wave = scopes.slice(start, start + SCOPE_CONCURRENCY);
      const settled = await Promise.all(wave.map(curateScope));
      for (const [scope, result] of settled) results[scope] = result;
    }

    const failed = Object.entries(results).filter(([, result]) => !result.success);
    return Response.json(
      {
        // The old payload always reported `success: true` even when every scope
        // had silently fallen back.
        success: failed.length === 0,
        degraded: failed.length > 0,
        failedScopes: failed.map(([scope]) => scope),
        curated: results,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Cron curation error:", sanitizeError(String(error)));
    return Response.json({ success: false, error: "Cron curation failed" }, { status: 500 });
  }
}
