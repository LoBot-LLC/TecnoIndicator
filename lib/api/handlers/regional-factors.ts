import { languageFromRequest, type ApiLanguage } from "../_shared/language";
import { translateStructured, attachFactorTranslations } from "../_shared/translate";
import {
  buildFallbackFactors,
  filterStaticFallbacks,
  isFreshWindow,
  readFactorWindow,
  runFactorAnalysis,
  toFactorsPayload,
  writeFactorWindow,
} from "./factor-analysis";
import { FACTORS_CACHE_MS } from "../_shared/http";
import { isRegion, type Region } from "../_shared/regions";
import { sanitizeError } from "../_shared/validation";
import type { Factor } from "../_shared/types";

async function factorsResponse<T>(lang: ApiLanguage, payload: T, init: ResponseInit): Promise<Response> {
  // When the payload carries factors, prefer their pre-translated name/explanation
  // (attached during curation) so language switching is instant. Only the
  // top-level `error` field still needs on-demand translation.
  if (payload && typeof payload === "object" && ("factors" in payload) && Array.isArray((payload as Record<string, unknown>).factors)) {
    const withFactors = payload as { factors: Factor[] };
    if (Array.isArray(withFactors.factors)) {
      const translatedFactors = withFactors.factors.map((factor) => {
        const t = factor.translations?.[lang];
        return t ? { ...factor, name: t.name, explanation: t.explanation } : factor;
      });
      const updatedPayload = { ...(payload as Record<string, unknown>), factors: translatedFactors };
      return Response.json(await translateStructured(updatedPayload, lang, ["error"]), init);
    }
  }
  return Response.json(await translateStructured(payload, lang, ["explanation", "error"]), init);
}

/**
 * GET /api/regional-factors?region=… — same payload and, importantly, the same
 * canonical `dynamic-factors:{region}` cache key as the global route. The route
 * used to write under `regional-factors:{region}` while `solutions` and
 * `regional-forecast` read `dynamic-factors:{region}`, so the reasons shown in
 * the UI were never the reasons the solutions were generated from.
 */
export async function handleRegionalFactors(req: Request): Promise<Response> {
  const lang = languageFromRequest(req);
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
        // Attach translations to cached factors if missing, then select language version
        const factorsWithTranslations = stored.factors.map((f: Factor) => ({
          ...f,
          translations: f.translations,
        }));
        return factorsResponse(lang,
          toFactorsPayload(factorsWithTranslations, region, stored.aiCurated, { updatedAt: stored.updatedAt }),
          { status: 200 },
        );
      }
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 55000);
    try {
      const result = await runFactorAnalysis(region, { abortSignal: abortController.signal });
      // Pre-translate factors to all supported languages for instant switching
      const factorsWithTranslations = await attachFactorTranslations(result.factors, { signal: abortController.signal });
      const stored = await writeFactorWindow(region, factorsWithTranslations, result.aiCurated);
      return factorsResponse(lang,
        toFactorsPayload(factorsWithTranslations, region, result.aiCurated, { updatedAt: stored.updatedAt }),
        { status: 200 },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error("Regional factors error:", sanitizeError(String(error)));
    const stored = await readFactorWindow(region).catch(() => null);
    const factors = filterStaticFallbacks(stored?.factors.length ? stored.factors : buildFallbackFactors(region));
    // Attach translations to available factors if possible
    const factorsWithTranslations = stored?.factors?.map((f: Factor) => ({
      ...f,
      translations: f.translations,
    })) ?? factors.map(f => ({
      ...f,
      translations: f.translations,
    }));
    return factorsResponse(lang,
      toFactorsPayload(factorsWithTranslations, region, stored?.aiCurated ?? false, {
        updatedAt: stored?.updatedAt ?? new Date().toISOString(),
        error: "Regional factors temporarily unavailable; static fallbacks returned",
      }),
      { status: 200 },
    );
  }
}