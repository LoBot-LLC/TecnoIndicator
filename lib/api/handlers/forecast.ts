import { FORECAST_CACHE_MS, sanitizeUrl, isReputableSource } from "../_shared/http";
import { getCache, setCache } from "../_shared/cache";
import type { Factor, ForecastPoint, RegionId, CommodityId } from "../_shared/types";
import { generateForecast, FACTORS as MODEL_FACTORS, REGIONS as MODEL_REGIONS, COMMODITIES as MODEL_COMMODITIES } from "../../../src/lib/model";

export const VALID_REGIONS: RegionId[] = ["global", "asia", "europe", "africa", "americas", "oceania"];
export const VALID_COMMODITIES: CommodityId[] = ["oil", "electricity", "water"];
export const UNITS = { oil: "USD/bbl", electricity: "USD/MWh", water: "USD/m³" } as const;
const KNOWN_SOURCES = [
  { title: "IEA", url: "https://www.iea.org/" },
  { title: "EIA", url: "https://www.eia.gov/" },
  { title: "OPEC", url: "https://www.opec.org/" },
  { title: "World Bank", url: "https://www.worldbank.org/" },
  { title: "IRENA", url: "https://www.irena.org/" },
  { title: "UN Water", url: "https://www.unwater.org/" },
];

export interface ForecastParams { region: RegionId; commodities: CommodityId[]; horizon: number; fresh: boolean; format: string; }
export class ParamError extends Error { param: string; constructor(param: string, message: string) { super(message); this.param = param; } }

export function parseForecastParams(search: URLSearchParams): ForecastParams {
  const regionRaw = (search.get("region") ?? "global").toLowerCase();
  if (!VALID_REGIONS.includes(regionRaw as RegionId)) throw new ParamError("region", `Invalid region: ${regionRaw}. Must be one of ${VALID_REGIONS.join(",")}`);
  let commodities: CommodityId[] = [...VALID_COMMODITIES];
  const cRaw = search.get("commodities");
  if (cRaw) {
    const parts = cRaw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length === 0) throw new ParamError("commodities", "commodities must not be empty");
    for (const p of parts) if (!VALID_COMMODITIES.includes(p as CommodityId)) throw new ParamError("commodities", `Invalid commodity: ${p}`);
    commodities = VALID_COMMODITIES.filter(c => parts.includes(c));
  }
  let horizon = 10;
  const hRaw = search.get("horizon");
  if (hRaw !== null) {
    if (!/^\d+$/.test(hRaw.trim())) throw new ParamError("horizon", "horizon must be an integer 0-10");
    horizon = Number(hRaw);
    if (horizon < 0 || horizon > 10) throw new ParamError("horizon", "horizon must be an integer 0-10");
  }
  const format = (search.get("format") ?? "json").toLowerCase();
  if (format !== "json" && format !== "csv") throw new ParamError("format", "format must be json");
  const fresh = ["true", "1", "yes"].includes((search.get("fresh") ?? "").toLowerCase());
  return { region: regionRaw as RegionId, commodities, horizon, fresh, format };
}

export function hashString(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); }
export function forecastCacheKey(p: ForecastParams): string { return `forecast:${p.region}:${p.commodities.join(",")}:${p.horizon}`; }
export function buildETag(p: ForecastParams, generatedAt: string): string { return `"${hashString(`1|${p.region}|${p.commodities.join(",")}|${p.horizon}|${generatedAt}`)}"`; }

const START_YEAR = new Date().getFullYear();
export function buildFallbackForecast(region: RegionId, horizon: number): ForecastPoint[] {
  const profile = MODEL_REGIONS.find(r => r.id === region) ?? MODEL_REGIONS[0];
  const prices = { oil: profile.bases.oil, electricity: profile.bases.electricity, water: profile.bases.water };
  try { return generateForecast(prices, horizon, 0, region); } catch {
    const pts: ForecastPoint[] = [];
    for (let t = 0; t <= horizon; t++) { const y = START_YEAR + t; pts.push({ year: y, label: String(y), oil: { avg: prices.oil * Math.pow(1.038, t), min: prices.oil * Math.pow(1.038, t) * 0.85, max: prices.oil * Math.pow(1.038, t) * 1.2 }, electricity: { avg: prices.electricity * Math.pow(1.046, t), min: prices.electricity * 0.8, max: prices.electricity * 1.3 }, water: { avg: prices.water * Math.pow(1.05, t), min: prices.water * 0.8, max: prices.water * 1.5 } }); }
    return pts;
  }
}
export function buildFallbackFactors(region: RegionId): Factor[] {
  const all = [...MODEL_FACTORS];
  const regional = region !== "global" ? all.filter(f => !f.regions || f.regions.includes(region) || f.regions.includes("global")) : all;
  return regional.slice(0, 8);
}
export function mapFactor(f: Factor) {
  const url = sanitizeUrl(f.source);
  return { id: f.id, name: f.name, category: f.category, commodities: f.commodities, direction: f.direction, magnitude: f.magnitude, importanceScore: f.importanceScore, source: url ?? "https://www.iea.org/", bias: f.bias, drift: f.drift };
}
export function buildSources(factors: Factor[]) {
  const m = new Map<string, string>();
  for (const f of factors) { const u = sanitizeUrl(f.source); if (u && isReputableSource(u)) m.set(u, f.name); }
  for (const s of KNOWN_SOURCES) m.set(s.url, s.title);
  return Array.from(m.entries()).map(([url, title]) => ({ title, url }));
}
export function filterBands(points: ForecastPoint[], commodities: CommodityId[]): Record<string, unknown>[] {
  return points.map(p => { const o: Record<string, unknown> = { year: p.year, label: p.label }; for (const c of commodities) o[c] = p[c]; return o; });
}
export function buildEnvelope(params: ForecastParams, bandsAll: ForecastPoint[], factors: Factor[], servedFrom: "model" | "fallback", cached: boolean, generatedAt = new Date().toISOString()) {
  const sorted = [...bandsAll].sort((a, b) => a.year - b.year);
  const envelope = {
    version: 1 as const, region: params.region, generatedAt, horizonYears: params.horizon, units: UNITS,
    bands: filterBands(sorted, params.commodities), factors: factors.map(mapFactor), sources: buildSources(factors),
    meta: { cached, servedFrom, cacheKey: forecastCacheKey(params) },
  };
  return { envelope, etag: buildETag(params, generatedAt) };
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "Accept,If-None-Match", "Access-Control-Max-Age": "86400" };
function headers(etag?: string) { return { "Content-Type": "application/json", "Cache-Control": "public,max-age=300,stale-while-revalidate=60", ...CORS, "X-API-Version": "1", ...(etag ? { ETag: etag } : {}) }; }
function err(status: number, code: string, message: string, param?: string) { const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()); return Response.json({ error: { code, message, ...(param ? { param } : {}), requestId } }, { status, headers: headers() }); }

export async function handleForecast(req: Request): Promise<Response> {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "GET") { const r = err(405, "METHOD_NOT_ALLOWED", "Only GET and OPTIONS are allowed"); r.headers.set("Allow", "GET,OPTIONS"); return r; }
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("text/csv")) return err(406, "NOT_ACCEPTABLE", "CSV format is not supported; use application/json");
    const url = new URL(req.url, "http://localhost");
    let params: ForecastParams;
    try { params = parseForecastParams(url.searchParams); } catch (e) { if (e instanceof ParamError) return err(400, "INVALID_PARAM", e.message, e.param); throw e; }
    if (params.format === "csv") return err(406, "NOT_ACCEPTABLE", "CSV format is not supported; use application/json");
    const key = forecastCacheKey(params);
    if (!params.fresh) {
      try { const cached = await getCache<ReturnType<typeof buildEnvelope>["envelope"]>(key, FORECAST_CACHE_MS); if (cached?.bands) { const etag = buildETag(params, cached.generatedAt); if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: headers(etag) }); return Response.json({ ...cached, meta: { ...cached.meta, cached: true } }, { status: 200, headers: headers(etag) }); } } catch {}
    }
    let bands: ForecastPoint[] | null = null; let factors: Factor[] = []; let servedFrom: "model" | "fallback" = "fallback";
    try {
      const [{ getScopePriceDefaults }, { readFactorWindow }] = await Promise.all([import("../_shared/deterministicAnalytics"), import("./factor-analysis")]);
      const defaults = getScopePriceDefaults(params.region as never) as unknown as Record<string, { price: number }>;
      const prices = { oil: defaults.oil?.price ?? 104.86, electricity: defaults.electricity?.price ?? 166, water: defaults.water?.price ?? 2.5 };
      const win = await readFactorWindow(params.region).catch(() => null);
      factors = win?.factors?.length ? win.factors : buildFallbackFactors(params.region);
      bands = generateForecast(prices, params.horizon, 0, params.region);
      servedFrom = win?.factors?.length ? "model" : "fallback";
    } catch { bands = null; }
    if (!bands || bands.length !== params.horizon + 1) { bands = buildFallbackForecast(params.region, params.horizon); if (!factors.length) factors = buildFallbackFactors(params.region); servedFrom = "fallback"; }
    const { envelope, etag } = buildEnvelope(params, bands, factors, servedFrom, false);
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: headers(etag) });
    try { await setCache(key, envelope, FORECAST_CACHE_MS); } catch {}
    return Response.json(envelope, { status: 200, headers: headers(etag) });
  } catch (e) {
    try { const p = parseForecastParams(new URL(req.url, "http://localhost").searchParams); const { envelope, etag } = buildEnvelope(p, buildFallbackForecast(p.region, p.horizon), buildFallbackFactors(p.region), "fallback", false); return Response.json(envelope, { status: 200, headers: headers(etag) }); } catch { return err(500, "INTERNAL", "Internal error"); }
  }
}
export { MODEL_COMMODITIES };
