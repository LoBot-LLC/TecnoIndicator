import { getGlobalAnalytics, clearAnalyticsCache } from "../_shared/deterministicAnalytics";
import { ANALYTICS_CACHE_MS, analyticsCacheKey } from "../_shared/http";

export async function handleAnalytics(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url, "http://localhost");
    const forceRefresh = url.searchParams.get("force") === "true";

    if (forceRefresh) {
      await clearAnalyticsCache();
    }

    const analytics = await getGlobalAnalytics();

    return Response.json({
      ...analytics,
      cacheKey: analyticsCacheKey("global"),
      cacheExpiresAt: Date.now() + ANALYTICS_CACHE_MS,
    });
  } catch (error) {
    return Response.json({ error: "Analytics temporarily unavailable" }, { status: 503 });
  }
}
