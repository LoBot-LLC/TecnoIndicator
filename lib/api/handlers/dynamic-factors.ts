import {
  buildFallbackFactors,
  isFreshWindow,
  readFactorRunStatus,
  readFactorWindow,
  runFactorAnalysis,
  toFactorsPayload,
  writeFactorRunStatus,
  writeFactorWindow,
} from "./factor-analysis";
import { FACTORS_CACHE_MS } from "../_shared/http";
import { isRegion, type Region } from "../_shared/regions";
import { sanitizeError } from "../_shared/validation";
import type { RegionId } from "../_shared/types";

function resolveScope(url: URL): { ok: true; scope: RegionId } | { ok: false; response: Response } {
  const regionParam = url.searchParams.get("region");
  if (regionParam === null || regionParam === "") return { ok: true, scope: "global" };
  if (!isRegion(regionParam)) {
    return {
      ok: false,
      response: Response.json(
        { error: "Invalid region. Must be one of: asia, europe, africa, americas, oceania" },
        { status: 400 },
      ),
    };
  }
  return { ok: true, scope: regionParam as Region };
}

/**
 * GET /api/dynamic-factors — curated price factors for a scope ("global" by
 * default, or a region via `?region=`). Serves the canonical
 * `dynamic-factors:{scope}` window and re-curates when the stored window is
 * older than {@link FACTORS_CACHE_MS}.
 *
 * A run that degraded is reported (`degraded`, `reason`, `servedFrom`) but is
 * NOT written to the curated cache key, and the stored `updatedAt` is returned
 * unchanged so a failure can never make stale content look freshly curated.
 */
export async function handleDynamicFactors(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://localhost");
  const scopeResult = resolveScope(url);
  if (!scopeResult.ok) return scopeResult.response;
  const scope = scopeResult.scope;
  const force = url.searchParams.get("force") === "true";

  try {
    if (!force) {
      const stored = await readFactorWindow(scope);
      if (stored && isFreshWindow(stored, FACTORS_CACHE_MS)) {
        return Response.json(
          toFactorsPayload(stored.factors, scope, {
            aiCurated: stored.aiCurated,
            updatedAt: stored.updatedAt,
            degraded: !stored.aiCurated,
            servedFrom: "cache",
          }),
          { status: 200 },
        );
      }
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 25000);
    try {
      const outcome = await runFactorAnalysis(scope, { abortSignal: abortController.signal });
      if (!outcome.ok) {
        await writeFactorRunStatus(scope, {
          aiCurated: outcome.window.aiCurated,
          reason: outcome.reason ?? null,
          lastAttemptAt: new Date().toISOString(),
          lastAiRunAt: outcome.window.lastAiRunAt ?? null,
          diagnostics: outcome.diagnostics,
        });
        return Response.json(
          toFactorsPayload(outcome.window.factors, scope, {
            aiCurated: outcome.window.aiCurated,
            updatedAt: outcome.window.updatedAt,
            degraded: true,
            reason: outcome.reason,
            servedFrom: "fallback",
            diagnostics: outcome.diagnostics,
            error: "Dynamic factors temporarily unavailable; static fallbacks returned",
          }),
          { status: 200 },
        );
      }
      const stored = await writeFactorWindow(scope, outcome.window.factors, outcome.window.aiCurated);
      await writeFactorRunStatus(scope, {
        aiCurated: true,
        reason: null,
        lastAttemptAt: stored.updatedAt,
        lastAiRunAt: stored.updatedAt,
        diagnostics: outcome.diagnostics,
      });
      return Response.json(
        toFactorsPayload(stored.factors, scope, {
          aiCurated: stored.aiCurated,
          updatedAt: stored.updatedAt,
          servedFrom: "curated",
          diagnostics: outcome.diagnostics,
        }),
        { status: 200 },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error("Dynamic factors error:", sanitizeError(String(error)));
    // Degrade to whatever is already stored (or the static fallbacks) rather
    // than failing the request outright. The stored timestamp is preserved and
    // nothing is written to the curated key.
    const stored = await readFactorWindow(scope).catch(() => null);
    const status = await readFactorRunStatus(scope).catch(() => null);
    const factors = stored?.factors.length ? stored.factors : buildFallbackFactors(scope);
    return Response.json(
      toFactorsPayload(factors, scope, {
        aiCurated: stored?.aiCurated ?? false,
        updatedAt: stored?.updatedAt ?? new Date().toISOString(),
        degraded: true,
        reason: "threw",
        servedFrom: "fallback",
        error: "Dynamic factors temporarily unavailable; static fallbacks returned",
        ...(status?.diagnostics ? { diagnostics: status.diagnostics } : {}),
      }),
      { status: 200 },
    );
  }
}
