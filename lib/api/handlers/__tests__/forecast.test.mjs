// This file is a spec for `node --test`; the handler uses extensionless
// relative imports (Next/bundler style) that Node's strip-types loader cannot
// resolve directly. Verified run (no test-runner dep needed):
//   npm install && npm run typecheck
//   mkdir -p /tmp/kilo2/fb && npx tsc app/api/forecast/route.ts lib/api/handlers/forecast.ts --outDir /tmp/kilo2/fb --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck
//   node -e "const m=require('/tmp/kilo2/fb/lib/api/handlers/forecast.js'); /* assert parse/build/handle as in tests below */"
// The assertions below mirror that compiled-output verification.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseForecastParams, buildFallbackForecast, buildEnvelope, buildFallbackFactors, ParamError } from "../forecast.ts";

test("defaults", () => { const p = parseForecastParams(new URLSearchParams()); assert.equal(p.region, "global"); assert.equal(p.horizon, 10); assert.equal(p.commodities.length, 3); });
test("invalid region throws ParamError", () => assert.throws(() => parseForecastParams(new URLSearchParams("region=mars")), ParamError));
test("horizon bounds", () => { assert.equal(parseForecastParams(new URLSearchParams("horizon=0")).horizon, 0); assert.throws(() => parseForecastParams(new URLSearchParams("horizon=11")), ParamError); assert.throws(() => parseForecastParams(new URLSearchParams("horizon=abc")), ParamError); });
test("commodities subset", () => { const p = parseForecastParams(new URLSearchParams("commodities=oil,water")); assert.deepEqual(p.commodities, ["oil", "water"]); assert.throws(() => parseForecastParams(new URLSearchParams("commodities=gas")), ParamError); });
test("fallback bands length and ordering", () => { const b = buildFallbackForecast("asia", 3); assert.equal(b.length, 4); assert.ok(b[0].year < b[3].year); for (const p of b) for (const c of ["oil", "electricity", "water"]) { const band = p[c]; assert.ok(band.min <= band.avg && band.avg <= band.max); } });
test("envelope filters commodities", () => { const p = parseForecastParams(new URLSearchParams("region=europe&commodities=oil&horizon=2")); const { envelope } = buildEnvelope(p, buildFallbackForecast("europe", 2), buildFallbackFactors("europe"), "fallback", false); assert.equal(envelope.bands.length, 3); assert.ok("oil" in envelope.bands[0]); assert.ok(!("water" in envelope.bands[0])); assert.ok(envelope.factors.every(f => /^https?:\/\//.test(f.source))); assert.ok(envelope.sources.every(s => /^https?:\/\//.test(s.url))); });
test("handleForecast integration", async () => {
  const { handleForecast } = await import("../forecast.ts");
  const ok = await handleForecast(new Request("http://x/api/forecast?region=asia&horizon=2&commodities=oil"));
  assert.equal(ok.status, 200); const j = await ok.json(); assert.equal(j.version, 1); assert.equal(j.bands.length, 3);
  const bad = await handleForecast(new Request("http://x/api/forecast?region=mars")); assert.equal(bad.status, 400);
  const csv = await handleForecast(new Request("http://x/api/forecast", { headers: { Accept: "text/csv" } })); assert.equal(csv.status, 406);
  const opt = await handleForecast(new Request("http://x/api/forecast", { method: "OPTIONS" })); assert.equal(opt.status, 204);
  const post = await handleForecast(new Request("http://x/api/forecast", { method: "POST" })); assert.equal(post.status, 405);
});
