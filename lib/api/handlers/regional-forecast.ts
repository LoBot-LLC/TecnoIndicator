import { kiloRouter } from "../_shared/kiloRouter";
import { tinyfishRouter } from "../_shared/tinyfishRouter";
import { REGION_NAMES, isRegion, type Region } from "../_shared/regions";
import { getRegionalAnalytics, getScopePriceDefaults } from "../_shared/deterministicAnalytics";
import { FORECAST_CACHE_MS, factorCacheKey, sanitizeUrl } from "../_shared/http";
import { getCache, setCache } from "../_shared/cache";
import { readFactorWindow } from "./factor-analysis";
import { safeParseJson } from "../_shared/validation";
import type { Factor, RegionalForecastPoint } from "../_shared/types";

const START_YEAR = new Date().getFullYear();

const SYSTEM_PROMPT_REGIONAL = (regionName: string) =>
  `You are a quantitative commodities forecasting system specializing in ${regionName} energy and water markets. Use the supplied ${regionName} analytics snapshot, ${regionName} dynamic factors, and any available ${regionName}-specific historical price series to produce 1–10 year regional forecasts for oil, electricity, and water within ${regionName}.\n\nEmulate LSTM-style sequence continuation, Temporal Fusion Transformer-style multi-horizon attention, XGBoost-style feature-importance reasoning, and Bayesian Neural Network-style uncertainty bands.\n\nRespect the current ${regionName}-specific analytics values as the year-zero anchors. Do not use global averages as year-zero anchors. Avoid unrealistic discontinuities unless they are supported by supplied high-importance ${regionName} factors.\n\nReturn strict JSON only matching the required RegionalForecastPoint[] schema. Do not include markdown or commentary outside JSON.`;

/**
 * Deterministic fallback anchored on the region's own price levels. It used to
 * return the same global numbers (104.86 / 166 / 2.5) for every region.
 */
function buildRegionalForecastFallback(region: Region): RegionalForecastPoint[] {
  const defaults = getScopePriceDefaults(region);
  const points: RegionalForecastPoint[] = [];
  for (let t = 0; t <= 10; t++) {
    points.push({
      region,
      year: START_YEAR + t,
      label: String(START_YEAR + t),
      oil: {
        avg: defaults.oil.price * Math.pow(1.038, t),
        min: Math.round(defaults.oil.price * 0.85),
        max: Math.round(defaults.oil.price * 1.25),
      },
      electricity: {
        avg: defaults.electricity.price * Math.pow(1.046, t),
        min: Math.round(defaults.electricity.price * 0.72),
        max: Math.round(defaults.electricity.price * 1.33),
      },
      water: {
        avg: defaults.water.price * Math.pow(1.05, t),
        min: Number((defaults.water.price * 0.8).toFixed(2)),
        max: Number((defaults.water.price * 1.6).toFixed(2)),
      },
    });
  }
  return points;
}

/** GET /api/regional-forecast?region=… — 11-year region-specific forecast band. */
export async function handleRegionalForecast(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://localhost");
  const regionParam = url.searchParams.get("region");
  if (!regionParam || !isRegion(regionParam)) {
    return Response.json({ error: "Missing or invalid 'region' query parameter" }, { status: 400 });
  }
  const region = regionParam as Region;
  const cacheKey = `regional-forecast:${region}`;

  try {
    const forceRefresh = url.searchParams.get("force") === "true";
    const cached = forceRefresh ? null : await getCache<RegionalForecastPoint[]>(cacheKey, FORECAST_CACHE_MS);
    if (cached) {
      return Response.json(cached, { status: 200 });
    }

    const kiloStatus = await kiloRouter.getKiloStatus();

    if (!kiloStatus.available || kiloStatus.zeroCostModels.length === 0) {
      const fallback = buildRegionalForecastFallback(region);
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    const analytics = await getRegionalAnalytics(region);
    const search = await tinyfishRouter.tinyfishSearch(`${REGION_NAMES[region]} oil electricity water prices 2026`, {
      region,
    });
    const regionalWindow = await readFactorWindow(region);
    const factors: Factor[] = regionalWindow?.factors ?? (await readFactorWindow("global"))?.factors ?? [];

    const payload = {
      model: kiloStatus.activeModel ?? kiloStatus.zeroCostModels[0] ?? "kilo-auto/free",
      messages: [
        { role: "system", content: SYSTEM_PROMPT_REGIONAL(REGION_NAMES[region]) },
        {
          role: "user",
          content: JSON.stringify({
            analytics,
            factors,
            factorsCacheKey: factorCacheKey(region),
            region,
            search: search.results?.map((r) => ({
              title: r.title,
              url: sanitizeUrl(r.url) ?? "",
              snippet: r.snippet?.slice(0, 500),
            })),
            request: `Generate 11-year ${region} forecast for oil, electricity, and water with avg/min/max bands anchored to current regional price levels.`,
          }),
        },
      ],
      max_tokens: 4096,
      temperature: 0.3,
    };

    let response: Awaited<ReturnType<typeof kiloRouter.kiloInfer>>;
    try {
      response = await kiloRouter.kiloInfer(payload);
    } catch {
      const fallback = buildRegionalForecastFallback(region);
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    const content = response.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson<Array<RegionalForecastPoint>>(content);

    if (!Array.isArray(parsed)) {
      const fallback = buildRegionalForecastFallback(region);
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    const validated = parsed
      .filter((p) => p && typeof p === "object")
      .map((p) => {
        const point = p as unknown as Record<string, any>;
        const oil = point.oil as Record<string, unknown> | undefined;
        const electricity = point.electricity as Record<string, unknown> | undefined;
        const water = point.water as Record<string, unknown> | undefined;
        return {
          region,
          year: Number(point.year ?? 0),
          label: String(point.label ?? ""),
          oil: { avg: Number(oil?.avg ?? 0), min: Number(oil?.min ?? 0), max: Number(oil?.max ?? 0) },
          electricity: {
            avg: Number(electricity?.avg ?? 0),
            min: Number(electricity?.min ?? 0),
            max: Number(electricity?.max ?? 0),
          },
          water: { avg: Number(water?.avg ?? 0), min: Number(water?.min ?? 0), max: Number(water?.max ?? 0) },
        } as RegionalForecastPoint;
      })
      .filter((p) => p.year >= START_YEAR && p.year <= START_YEAR + 10);

    if (validated.length === 0) {
      const fallback = buildRegionalForecastFallback(region);
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    await setCache(cacheKey, validated, FORECAST_CACHE_MS);
    return Response.json(validated, { status: 200 });
  } catch (error) {
    console.error("Regional forecast error:", error);
    const fallback = buildRegionalForecastFallback(region);
    return Response.json(fallback, { status: 503 });
  }
}
