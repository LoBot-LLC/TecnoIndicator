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

/**
 * GET /api/regional-factors?region=… — same payload and, importantly, the same
 * canonical `dynamic-factors:{region}` cache key as the global route. The route
 * used to write under `regional-factors:{region}` while `solutions` and
 * `regional-forecast` read `dynamic-factors:{region}`, so the reasons shown in
 * the UI were never the reasons the solutions were generated from.
 */
export async function handleRegionalFactors(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://localhost");
  const regionParam = url.searchParams.get("region");
  if (!regionParam || !isRegion(regionParam)) {
    return Response.json(
      { error: "Missing or invalid 'region' query parameter. Must be one of: asia, europe, africa, americas, oceania" },
      { status: 400 },
    );
  }
  const region = regionParam as Region;
  const force = url.searchParams.get("force") === "true";

  try {
    if (!force) {
      const stored = await readFactorWindow(region);
      if (stored && isFreshWindow(stored, FACTORS_CACHE_MS)) {
        return Response.json(
          toFactorsPayload(stored.factors, region, {
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
    // 45s, mirroring /api/dynamic-factors: >=10s of headroom under vercel.json's
    // 60s maxDuration, so this abort always fires first and the response stays
    // a graceful JSON fallback rather than a 504.
    const timeoutId = setTimeout(() => abortController.abort(), 45000);
    try {
      const outcome = await runFactorAnalysis(region, { abortSignal: abortController.signal });
      if (!outcome.ok) {
        // A degraded run is reported but never persisted into the curated key,
        // and the stored `updatedAt` is returned unchanged.
        await writeFactorRunStatus(region, {
          aiCurated: outcome.window.aiCurated,
          reason: outcome.reason ?? null,
          lastAttemptAt: new Date().toISOString(),
          lastAiRunAt: outcome.window.lastAiRunAt ?? null,
          diagnostics: outcome.diagnostics,
        });
        return Response.json(
          toFactorsPayload(outcome.window.factors, region, {
            aiCurated: outcome.window.aiCurated,
            updatedAt: outcome.window.updatedAt,
            degraded: true,
            reason: outcome.reason,
            servedFrom: "fallback",
            diagnostics: outcome.diagnostics,
            error: "Regional factors temporarily unavailable; static fallbacks returned",
          }),
          { status: 200 },
        );
      }
      const stored = await writeFactorWindow(region, outcome.window.factors, outcome.window.aiCurated);
      await writeFactorRunStatus(region, {
        aiCurated: true,
        reason: null,
        lastAttemptAt: stored.updatedAt,
        lastAiRunAt: stored.updatedAt,
        diagnostics: outcome.diagnostics,
      });
      return Response.json(
        toFactorsPayload(stored.factors, region, {
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
    console.error("Regional factors error:", sanitizeError(String(error)));
    const stored = await readFactorWindow(region).catch(() => null);
    const status = await readFactorRunStatus(region).catch(() => null);
    const factors = stored?.factors.length ? stored.factors : buildFallbackFactors(region);
    return Response.json(
      toFactorsPayload(factors, region, {
        aiCurated: stored?.aiCurated ?? false,
        updatedAt: stored?.updatedAt ?? new Date().toISOString(),
        degraded: true,
        reason: "threw",
        servedFrom: "fallback",
        error: "Regional factors temporarily unavailable; static fallbacks returned",
        ...(status?.diagnostics ? { diagnostics: status.diagnostics } : {}),
      }),
      { status: 200 },
    );
  }
}
