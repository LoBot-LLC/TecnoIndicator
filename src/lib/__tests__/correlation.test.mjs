// Correlation matrix pure-logic tests.
// Compile method (run from repo root):
//   npx tsc src/lib/correlation.ts src/lib/model.ts --outDir /tmp/kilo2/corr --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck
//   node /tmp/kilo2/src/lib/__tests__/correlation.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pearson,
  derivedDrift,
  factorContributionSeries,
  computeCorrelationMatrix,
  computeFactorRegionCorrelation,
  hexToRgba,
} from "../correlation.ts";
import { COMMODITIES, FACTORS } from "../model.ts";

const TINYFISH_LIKE = {
  id: "news-1",
  name: "Brent Traded Above $92 A Barrel",
  category: "Market",
  commodities: ["oil"],
  explanation: "...",
  direction: "up",
  magnitude: "High",
  source: "https://example.com",
  bias: "short",
  importanceScore: 82,
  drift: {}, // TinyFish factors ship empty drift (root cause of all-n/a bug)
};

describe("pearson", () => {
  it("returns +1 for perfectly linear series", () => {
    const r = pearson([0, 1, 2, 3], [0, 2, 4, 6]);
    assert.strictEqual(r, 1);
  });
  it("returns -1 for inverse linear series", () => {
    const r = pearson([0, 1, 2, 3], [6, 4, 2, 0]);
    assert.strictEqual(r, -1);
  });
  it("returns null for constant (zero-variance) series", () => {
    assert.strictEqual(pearson([0, 0, 0], [1, 2, 3]), null);
    assert.strictEqual(pearson([1, 2, 3], [0, 0, 0]), null);
  });
  it("returns null for arrays shorter than 2", () => {
    assert.strictEqual(pearson([1], [2]), null);
    assert.strictEqual(pearson([], []), null);
  });
  it("returns null for NaN inputs", () => {
    assert.strictEqual(pearson([1, NaN, 3], [2, 4, 6]), null);
  });
});

describe("derivedDrift", () => {
  it("preserves explicit drift", () => {
    assert.strictEqual(derivedDrift(FACTORS[0], "oil"), FACTORS[0].drift.oil);
  });
  it("derives non-zero drift for TinyFish-like factor with empty drift", () => {
    const d = derivedDrift(TINYFISH_LIKE, "oil");
    assert.ok(d !== 0, "derived drift must be non-zero for exposed commodity");
    assert.ok(Number.isFinite(d));
  });
  it("derives nexus-scaled drift for undeclared commodities (energy–water nexus)", () => {
    const oilDrift = derivedDrift(TINYFISH_LIKE, "oil");
    const elecDrift = derivedDrift(TINYFISH_LIKE, "electricity");
    const waterDrift = derivedDrift(TINYFISH_LIKE, "water");
    assert.ok(oilDrift !== 0, "oil drift must be non-zero for exposed commodity");
    assert.ok(elecDrift !== 0, "electricity drift must be non-zero via nexus");
    assert.ok(waterDrift !== 0, "water drift must be non-zero via nexus");
    assert.ok(Math.abs(elecDrift) < Math.abs(oilDrift), "electricity drift must be reduced vs oil");
    assert.ok(Math.abs(waterDrift) < Math.abs(oilDrift), "water drift must be reduced vs oil");
    assert.ok(Number.isFinite(elecDrift) && Number.isFinite(waterDrift));
  });
  it("returns 0 for mixed direction", () => {
    const mixed = { ...TINYFISH_LIKE, direction: "mixed" };
    assert.strictEqual(derivedDrift(mixed, "oil"), 0);
  });
});

describe("factorContributionSeries", () => {
  it("is non-constant for TinyFish-like factor (fixes zero-variance bug)", () => {
    const xs = factorContributionSeries(TINYFISH_LIKE, "oil", "global", 10);
    const uniq = new Set(xs);
    assert.ok(uniq.size > 1, "contribution series must vary with t");
    assert.ok(xs.some((v) => v > 0), "series must be positive for up direction");
  });
  it("is non-constant for undeclared commodities via nexus", () => {
    for (const c of ["electricity", "water"]) {
      const xs = factorContributionSeries(TINYFISH_LIKE, c, "global", 10);
      const uniq = new Set(xs);
      assert.ok(uniq.size > 1, `contribution series for ${c} must vary with t`);
      assert.ok(!xs.every((v) => v === 0), `${c} series must not be constant zero`);
    }
  });
});

describe("computeCorrelationMatrix", () => {
  it("no longer reports n/a for TinyFish-like factors on any commodity", () => {
    const out = computeCorrelationMatrix({
      prices: { oil: 104.86, electricity: 166, water: 2.5 },
      horizon: 10,
      region: "global",
      factors: [TINYFISH_LIKE],
    });
    for (const c of COMMODITIES) {
      const cell = out.rows.find((x) => x.factorId === "news-1" && x.commodity === c.id);
      assert.ok(cell != null, `cell present for ${c.id}`);
      assert.ok(cell.r != null && Number.isFinite(cell.r), `expected non-null ${c.id} correlation, got ${cell.r}`);
    }
  });
});

describe("computeFactorRegionCorrelation", () => {
  it("computes per-region correlation for TinyFish-like factor", () => {
    const out = computeFactorRegionCorrelation(TINYFISH_LIKE, ["asia", "europe"], "oil");
    assert.strictEqual(out.length, 2);
    assert.ok(out.every((d) => d.r != null && Number.isFinite(d.r)));
  });
});

describe("hexToRgba", () => {
  it("produces an rgba string", () => {
    assert.strictEqual(hexToRgba("#f5b840", 0.5), "rgba(245, 184, 64, 0.5)");
  });
});
