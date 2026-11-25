import { REGIONS } from "../_shared/regions";
import { runFactorAnalysis, writeFactorWindow } from "./factor-analysis";
import * as FactorAnalysisNS from "./factor-analysis";
import { sanitizeError } from "../_shared/validation";
import type { Factor, RegionId } from "../_shared/types";

export interface CronCurationResult {
  success: boolean;
  count: number;
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
 * reason arrives.
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
        const result = await runFactorAnalysis(scope);
        // Best-effort eager pretranslation; never fail the cron scope on translation errors.
        let translations: unknown;
        try {
          const fn = (FactorAnalysisNS as unknown as Record<string, unknown>)["pretranslateFactorWindow"];
          if (typeof fn === "function") {
            const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 10_000));
            const raced = await Promise.race([
              (fn as (f: Factor[]) => Promise<unknown>)(result.factors),
              timeout,
            ]);
            if (raced && typeof raced === "object") translations = raced;
          }
        } catch {
          translations = undefined;
        }
        await (writeFactorWindow as (...args: unknown[]) => Promise<unknown>)(
          scope, result.factors, result.aiCurated, translations ?? undefined,
        );
        results[scope] = { success: true, count: result.factors.length };
      } catch (error) {
        results[scope] = {
          success: false,
          count: 0,
          error: sanitizeError(String(error)),
        };
      }
    }

    return Response.json(
      { success: true, curated: results, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (error) {
    console.error("Cron curation error:", sanitizeError(String(error)));
    return Response.json({ success: false, error: "Cron curation failed" }, { status: 500 });
  }
}
