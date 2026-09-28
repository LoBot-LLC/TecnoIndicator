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
 * GET /api/cron/curate-factors — invoked by the Vercel cron defined in
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

    for (const scope of scopes) {
      try {
        const outcome = await runFactorAnalysis(scope);
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
          results[scope] = {
            success: false,
            count: outcome.window.factors.length,
            persisted: false,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
          };
          continue;
        }
        await writeFactorWindow(scope, outcome.window.factors, outcome.window.aiCurated);
        await writeFactorRunStatus(scope, {
          aiCurated: true,
          reason: null,
          lastAttemptAt: outcome.window.updatedAt,
          lastAiRunAt: outcome.window.updatedAt,
          diagnostics: outcome.diagnostics,
        });
        results[scope] = {
          success: true,
          count: outcome.window.factors.length,
          persisted: true,
        };
      } catch (error) {
        results[scope] = {
          success: false,
          count: 0,
          persisted: false,
          reason: "threw",
          error: sanitizeError(String(error)),
        };
      }
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
