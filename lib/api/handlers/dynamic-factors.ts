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
import * as FactorAnalysisNS from "./factor-analysis";
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

/**
 * GET /api/dynamic-factors — curated price factors for a scope ("global" by
 * default, or a region via `?region=`). Serves the canonical
 * `dynamic-factors:{scope}` window and re-curates when the stored window is
 * older than {@link FACTORS_CACHE_MS}.
 */
async function factorsResponse<T>(lang: ApiLanguage, payload: T, init: ResponseInit, stored?: unknown): Promise<Response> {
  // Prefer stored eager translations when they cover every factor.
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
        // runFactorAnalysis already validates/repairs; trust the cached window
        return factorsResponse(lang,
          toFactorsPayload(stored.factors, scope, stored.aiCurated, { updatedAt: stored.updatedAt }),
          { status: 200 },
          stored,
        );
      }
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 55000);
    try {
      const result = await runFactorAnalysis(scope, { abortSignal: abortController.signal });
      const translations = await pretranslateBestEffort(result.factors, abortController.signal);
      const stored = await (writeFactorWindow as (
        ...args: unknown[]
      ) => Promise<{ updatedAt: string; translations?: unknown }>)(
        scope, result.factors, result.aiCurated, translations ?? undefined,
      );
      const windowWithTranslations = translations ? { ...stored, translations } : stored;
      return factorsResponse(lang,
        toFactorsPayload(result.factors, scope, result.aiCurated, { updatedAt: stored.updatedAt }),
        { status: 200 },
        windowWithTranslations,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error("Dynamic factors error:", sanitizeError(String(error)));
    // Degrade to whatever is already stored (or the static fallbacks) rather
    // than failing the request outright.
    const stored = await readFactorWindow(scope).catch(() => null);
    const factors = filterStaticFallbacks(stored?.factors.length ? stored.factors : buildFallbackFactors(scope));
    return factorsResponse(lang,
      toFactorsPayload(factors, scope, stored?.aiCurated ?? false, {
        updatedAt: stored?.updatedAt ?? new Date().toISOString(),
        error: "Dynamic factors temporarily unavailable; static fallbacks returned",
      }),
      { status: 200 },
      stored,
    );
  }
}
