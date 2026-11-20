import {
  COMMODITIES,
  EVAL_REGIONS,
  FACTORS,
  REGIONAL_FACTORS,
  REGIONS,
  generateForecast,
  hexToRgba,
  type CommodityId,
  type Factor,
  type RegionId,
} from "./model";

export { hexToRgba };

export interface CorrelationCell {
  factorId: string;
  commodity: CommodityId;
  r: number | null;
  n: number;
}

export interface CorrelationMatrixInput {
  prices: Record<CommodityId, number>;
  horizon: number;
  region: RegionId;
  factors?: Factor[];
}

export interface CorrelationMatrix {
  rows: CorrelationCell[];
  byFactor: Record<string, Partial<Record<CommodityId, number | null>>>;
}

function regionWeight(factor: Factor, regionId: RegionId): number {
  if (factor.scope === "global") return 1;
  if (factor.regions?.includes(regionId)) return 1;
  return 0.35;
}

/**
 * Drift magnitude anchors (10-yr cumulative) used by the static model factors.
 * TinyFish-curated factors frequently ship `drift: {}` (see
 * `lib/api/handlers/factor-analysis.ts:1278,1885`), which previously produced a
 * constant-zero contribution series → zero variance → Pearson `r` undefined →
 * "n/a" for every commodity and region. Derive a comparable drift from the
 * factor's own signal when the explicit drift is missing.
 */
const DRIFT_MAGNITUDE: Record<Factor["magnitude"], number> = {
  High: 0.02,
  Medium: 0.012,
  Low: 0.006,
};

/** Resolve a factor's drift for a commodity, deriving it from factor signals when absent. */
export function derivedDrift(factor: Factor, commodity: CommodityId): number {
  const existing = factor.drift[commodity];
  if (typeof existing === "number" && Number.isFinite(existing)) return existing;
  if (!factor.commodities.includes(commodity)) return 0;
  const sign = factor.direction === "up" ? 1 : factor.direction === "down" ? -1 : 0;
  if (sign === 0) return 0; // mixed direction → no consistent signed drift
  const mag = DRIFT_MAGNITUDE[factor.magnitude] ?? DRIFT_MAGNITUDE.Medium;
  const imp = (factor.importanceScore ?? 60) / 100;
  return sign * mag * imp;
}

/** Contribution of a factor to a commodity price over t=0..horizon. */
export function factorContributionSeries(
  factor: Factor,
  commodity: CommodityId,
  regionId: RegionId,
  horizon: number,
): number[] {
  const out: number[] = [];
  const drift = derivedDrift(factor, commodity);
  const w = regionWeight(factor, regionId);
  for (let t = 0; t <= horizon; t++) {
    out.push(drift * (t / 10) * w);
  }
  return out;
}

/** Avg price series for a commodity via generateForecast. */
export function priceSeries(
  prices: Record<CommodityId, number>,
  commodity: CommodityId,
  horizon: number,
  regionId: RegionId,
): number[] {
  const pts = generateForecast(prices, horizon, 0, regionId);
  return pts.map((p) => p[commodity].avg);
}

/** Pearson correlation; null on zero-variance or len<2. Result clamped to [-1,1]. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const xa = xs.slice(0, n);
  const ya = ys.slice(0, n);
  if (xa.some((v) => !Number.isFinite(v)) || ya.some((v) => !Number.isFinite(v))) return null;
  const mx = xa.reduce((a, b) => a + b, 0) / n;
  const my = ya.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xa[i] - mx;
    const b = ya[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (!Number.isFinite(num) || dx === 0 || dy === 0 || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    return null;
  }
  const r = num / Math.sqrt(dx * dy);
  return Math.min(1, Math.max(-1, r));
}

function defaultFactorsForRegion(regionId: RegionId): Factor[] {
  const regional = regionId === "global" ? [] : (REGIONAL_FACTORS[regionId] ?? []);
  return [...regional, ...FACTORS];
}

export function computeCorrelationMatrix(input: CorrelationMatrixInput): CorrelationMatrix {
  const { prices, horizon, region } = input;
  const rows: CorrelationCell[] = [];
  const byFactor: CorrelationMatrix["byFactor"] = {};
  if (horizon < 2) return { rows, byFactor };
  const factors = input.factors ?? defaultFactorsForRegion(region);
  const n = horizon + 1;
  for (const f of factors) {
    const row: Partial<Record<CommodityId, number | null>> = {};
    for (const c of COMMODITIES) {
      const xs = factorContributionSeries(f, c.id, region, horizon);
      const ys = priceSeries(prices, c.id, horizon, region);
      const r = pearson(xs, ys);
      rows.push({ factorId: f.id, commodity: c.id, r, n });
      row[c.id] = r;
    }
    byFactor[f.id] = row;
  }
  return { rows, byFactor };
}

export interface FactorRegionCorrelation {
  regionId: RegionId;
  r: number | null;
  n: number;
}

/**
 * Per-region correlation of one factor against one commodity (default: first
 * listed commodity). Used for click-through detail.
 */
export function computeFactorRegionCorrelation(
  factorOrId: string | Factor,
  regions: RegionId[] = EVAL_REGIONS.map((r) => r.id),
  commodity?: CommodityId,
  prices?: Record<CommodityId, number>,
  horizon = 10,
): FactorRegionCorrelation[] {
  const factor =
    typeof factorOrId === "string"
      ? [...FACTORS, ...Object.values(REGIONAL_FACTORS).flat()].find((f) => f.id === factorOrId) ?? null
      : factorOrId;
  if (!factor) return regions.map((regionId) => ({ regionId, r: null, n: 0 }));
  const comm = commodity ?? factor.commodities[0] ?? "oil";
  const spots: Record<CommodityId, number> =
    prices ?? {
      oil: 104.86,
      electricity: 166,
      water: 2.5,
    };
  if (horizon < 2) return regions.map((regionId) => ({ regionId, r: null, n: 0 }));
  return regions.map((regionId) => {
    const xs = factorContributionSeries(factor, comm, regionId, horizon);
    const regionProfile = REGIONS.find((r) => r.id === regionId);
    const scaled: Record<CommodityId, number> = regionProfile
      ? {
          oil: spots.oil * (regionProfile.bases.oil / 104.86),
          electricity: spots.electricity * (regionProfile.bases.electricity / 166),
          water: spots.water * (regionProfile.bases.water / 2.5),
        }
      : spots;
    const ys = priceSeries(scaled, comm, horizon, regionId);
    return { regionId, r: pearson(xs, ys), n: horizon + 1 };
  });
}
