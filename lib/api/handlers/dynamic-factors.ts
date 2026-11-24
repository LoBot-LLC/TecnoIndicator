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
import type { Factor, RegionId } from "../_shared/types";

export const maxDuration = 58;

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
async function factorsResponse<T>(lang: ApiLanguage, payload: T, init: ResponseInit): Promise<Response> {
  // If payload contains Factor objects with translations, use pre-translated values
  // Otherwise fall back to translateStructured for explanations and error fields
  if (payload && typeof payload === 'object' && 'factors' in payload) {
    const withFactors = payload as { factors: Factor[] };
    if (withFactors.factors) {
      // Replace explanations with pre-translated versions if available
      const translatedFactors = withFactors.factors.map(factor => {
        if (factor.translations && factor.translations[lang]) {
          return {
            ...factor,
            explanation: factor.translations[lang].explanation,
            name: factor.translations[lang].name,
          };
        }
        return factor; // fallback to original if no translation available
      });
      
      // Update payload with translated factors
      const updatedPayload = {
        ...payload,
        factors: translatedFactors,
      };
      
      return Response.json(await translateStructured(updatedPayload, lang, ["error"]), init);
    }
  }
  
  return Response.json(await translateStructured(payload, lang, ["error"]), init);
}

export async function handleDynamicFactors(req: Request): Promise<Response> {
  const lang = languageFromRequest(req);
  const url = new URL(req.url, "http://localhost");
  const scopeResult = resolveScope(url);
  if (!scopeResult.ok) return scopeResult.response;
  const scope = scopeResult.scope;
  const force = url.searchParams.get("force") === "true";

  try {
    if (!force) {
      const stored = await readFactorWindow(scope);
      if (stored && isFreshWindow(stored, FACTORS_CACHE_MS)) {
        // Attach translations to cached factors if missing, then select language version
        const factorsWithTranslations = stored.factors.map((f: Factor) => ({
          ...f,
          translations: f.translations,
        }));
        // Write back to cache if translations were present (ensures fresh translations persist)
        if (factorsWithTranslations.some(f => f.translations)) {
          await writeFactorWindow(scope, factorsWithTranslations, stored.aiCurated);
        }
        return factorsResponse(lang,
          toFactorsPayload(stored.factors.map(f => ({
            ...f,
            explanation: f.translations?.[lang]?.explanation ?? f.explanation,
            name: f.translations?.[lang]?.name ?? f.name,
          })), scope, stored.aiCurated, { updatedAt: stored.updatedAt }),
          { status: 200 },
        );
      }
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 55000);
    try {
      const result = await runFactorAnalysis(scope, { abortSignal: abortController.signal });
      // Pre-translate factors to all supported languages so language switching is instant
      const factorsWithTranslations = await attachFactorTranslations(result.factors, { signal: abortController.signal });
      const stored = await writeFactorWindow(scope, factorsWithTranslations, result.aiCurated);
      return factorsResponse(lang,
        toFactorsPayload(factorsWithTranslations.map(f => ({
          ...f,
          explanation: f.translations?.[lang]?.explanation ?? f.explanation,
          name: f.translations?.[lang]?.name ?? f.name,
        })), scope, result.aiCurated, { updatedAt: stored.updatedAt }),
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
    let factors = filterStaticFallbacks(stored?.factors.length ? stored.factors : buildFallbackFactors(scope));
    // Attach translations to available factors if possible
    if (stored?.factors && stored.factors.length) {
      factors = stored.factors.map((f: Factor) => ({
        ...f,
        translations: f.translations,
      }));
    }
    return factorsResponse(lang,
      toFactorsPayload(factors.map(f => ({
        ...f,
        explanation: f.translations?.[lang]?.explanation ?? f.explanation,
        name: f.translations?.[lang]?.name ?? f.name,
      })), scope, stored?.aiCurated ?? false, {
        updatedAt: stored?.updatedAt ?? new Date().toISOString(),
        error: "Dynamic factors temporarily unavailable; static fallbacks returned",
      }),
      { status: 200 },
    );
  }
}
