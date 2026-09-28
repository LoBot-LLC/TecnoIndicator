import { ANALYTICS_CACHE_MS, analyticsCacheKey } from "../_shared/http";
import { isRegion, type Region } from "../_shared/regions";
import { getRegionalAnalytics, clearAnalyticsCache } from "../_shared/deterministicAnalytics";

export async function handleRegionalAnalytics(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "http://localhost");
    const regionParam = url.searchParams.get("region");
    if (!regionParam || !isRegion(regionParam)) {
      return Response.json(
        { error: "Missing or invalid 'region' query parameter. Must be one of: asia, europe, africa, americas, oceania" },
        { status: 400 },
      );
    }
    const region = regionParam as Region;
    const forceRefresh = url.searchParams.get("force") === "true";
    if (forceRefresh) {
      await clearAnalyticsCache();
    }
    const analytics = await getRegionalAnalytics(region);
    return Response.json(
      {
        ...analytics,
        cacheKey: analyticsCacheKey(region),
        cacheExpiresAt: Date.now() + ANALYTICS_CACHE_MS,
      },
      { status: 200 },
    );
  } catch (error) {
    return Response.json({ error: "Regional analytics temporarily unavailable" }, { status: 503 });
  }
}
