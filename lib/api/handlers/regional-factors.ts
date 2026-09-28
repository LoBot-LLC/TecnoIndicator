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
          toFactorsPayload(stored.factors, region, stored.aiCurated, { updatedAt: stored.updatedAt }),
          { status: 200 },
        );
      }
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 25000);
    try {
      const result = await runFactorAnalysis(region, { abortSignal: abortController.signal });
      const stored = await writeFactorWindow(region, result.factors, result.aiCurated);
      return Response.json(
        toFactorsPayload(stored.factors, region, stored.aiCurated, {
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
    console.error("Regional factors error:", sanitizeError(String(error)));
    const stored = await readFactorWindow(region).catch(() => null);
    const factors = stored?.factors.length ? stored.factors : buildFallbackFactors(region);
    return Response.json(
      toFactorsPayload(factors, region, stored?.aiCurated ?? false, {
        updatedAt: stored?.updatedAt ?? new Date().toISOString(),
        error: "Regional factors temporarily unavailable; static fallbacks returned",
        aiCurationFailed: true,
      }),
      { status: 200 },
    );
  }
}
