import { languageFromRequest, type ApiLanguage } from "../_shared/language";
import { translateStructured } from "../_shared/translate";
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
import * as FactorAnalysisNS from "./factor-analysis";

/** Best-effort eager pretranslation. Resolves undefined when helpers are missing, fail, or exceed ~10s. */
async function pretranslateBestEffort(
  factors: Factor[],
  signal?: AbortSignal,
): Promise<Record<string, Array<{ name: string; explanation: string }>> | undefined> {
  try {
    const fn = (FactorAnalysisNS as unknown as Record<string, unknown>)["pretranslateFactorWindow"];
    if (typeof fn !== "function") return undefined;
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 10_000));
    const result = await Promise.race([
      (fn as (f: Factor[], s?: AbortSignal) => Promise<unknown>)(factors, signal),
      timeout,
    ]);
    if (!result || typeof result !== "object") return undefined;
    return result as Record<string, Array<{ name: string; explanation: string }>>;
  } catch {
    return undefined;
  }
}

async function factorsResponse<T>(lang: ApiLanguage, payload: T, init: ResponseInit, stored?: unknown): Promise<Response> {
  if (lang !== "en" && stored && typeof stored === "object") {
    try {
      const apply = (FactorAnalysisNS as unknown as Record<string, unknown>)["applyStoredTranslations"];
      const translations = (stored as { translations?: unknown }).translations as
        | Partial<Record<string, Array<{ name: string; explanation: string }>>>
        | undefined;
      const factors = (payload as { factors?: Factor[] }).factors;
      const arr = translations?.[lang as "es" | "vi"];
      if (typeof apply === "function" && Array.isArray(arr) && Array.isArray(factors) && arr.length === factors.length) {
        const localized = (apply as (f: Factor[], t: unknown, l: string) => Factor[])(factors, translations, lang);
        if (Array.isArray(localized) && localized.length === factors.length) {
          const base = payload as Record<string, unknown>;
          return Response.json({ ...base, factors: localized, count: localized.length }, init);
        }
      }
    } catch {
      // Fall through to lazy translation.
    }
  }
  return Response.json(await translateStructured(payload, lang, ["name", "explanation", "error"]), init);
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
        // runFactorAnalysis already validates/repairs; trust the cached window
        return factorsResponse(lang,
          toFactorsPayload(stored.factors, region, stored.aiCurated, { updatedAt: stored.updatedAt }),
          { status: 200 },
          stored,
        );
      }
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 55000);
    try {
      const result = await runFactorAnalysis(region, { abortSignal: abortController.signal });
      const translations = await pretranslateBestEffort(result.factors, abortController.signal);
      const stored = await (writeFactorWindow as (...args: unknown[]) => Promise<{ updatedAt: string; translations?: unknown }>)(
        region, result.factors, result.aiCurated, translations ?? undefined,
      );
      const windowWithTranslations = translations ? { ...stored, translations } : stored;
      return factorsResponse(lang,
        toFactorsPayload(result.factors, region, result.aiCurated, { updatedAt: stored.updatedAt }),
        { status: 200 },
        windowWithTranslations,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error("Regional factors error:", sanitizeError(String(error)));
    const stored = await readFactorWindow(region).catch(() => null);
    const factors = filterStaticFallbacks(stored?.factors.length ? stored.factors : buildFallbackFactors(region));
    return factorsResponse(lang,
      toFactorsPayload(factors, region, stored?.aiCurated ?? false, {
        updatedAt: stored?.updatedAt ?? new Date().toISOString(),
        error: "Regional factors temporarily unavailable; static fallbacks returned",
      }),
      { status: 200 },
      stored,
    );
  }
}
