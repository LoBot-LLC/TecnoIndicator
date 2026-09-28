import {
  buildFallbackFactors,
  isFreshWindow,
  readFactorWindow,
  runFactorAnalysis,
  toFactorsPayload,
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
          toFactorsPayload(stored.factors, scope, stored.aiCurated, { updatedAt: stored.updatedAt }),
          { status: 200 },
        );
      }
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 25000);
    try {
      const result = await runFactorAnalysis(scope, { abortSignal: abortController.signal });
      const stored = await writeFactorWindow(scope, result.factors, result.aiCurated);
      return Response.json(
        toFactorsPayload(stored.factors, scope, stored.aiCurated, {
          updatedAt: stored.updatedAt,
          error: result.aiCurationFailed ? "AI curation unavailable; static fallbacks returned" : undefined,
          aiCurationFailed: result.aiCurationFailed,
        }),
        { status: 200 },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error("Dynamic factors error:", sanitizeError(String(error)));
    // Degrade to whatever is already stored (or the static fallbacks) rather
    // than failing the request outright.
    const stored = await readFactorWindow(scope).catch(() => null);
    const factors = stored?.factors.length ? stored.factors : buildFallbackFactors(scope);
    return Response.json(
      toFactorsPayload(factors, scope, stored?.aiCurated ?? false, {
        updatedAt: stored?.updatedAt ?? new Date().toISOString(),
        error: "Dynamic factors temporarily unavailable; static fallbacks returned",
        aiCurationFailed: true,
      }),
      { status: 200 },
    );
  }
}
