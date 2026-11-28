import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { kiloRouter } from "../../_shared/kiloRouter.ts";
import { tinyfishRouter } from "../../_shared/tinyfishRouter.ts";
import { clearCache, setCache, getCache } from "../../_shared/cache.ts";
import { translateTexts, translateStructured, TranslationError, FACTOR_TRANSLATION_KEYS } from "../../_shared/translate.ts";
import { handleDynamicFactors } from "../dynamic-factors.ts";
import { handleRegionalFactors } from "../regional-factors.ts";
import { handleSolutions } from "../solutions.ts";
import { writeFactorWindow, readFactorWindow } from "../factor-analysis.ts";

const originalInfer = kiloRouter.kiloInfer;
const originalSearch = tinyfishRouter.tinyfishSearch;
const reply = (data, finish_reason = "stop") => ({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason }] });
let calls;
beforeEach(async () => {
  await clearCache();
  calls = [];
  kiloRouter.kiloInfer = async (payload) => {
    calls.push(payload);
    return reply(JSON.parse(payload.messages[1].content).map((s) => `Traducido: ${s}`));
  };
  tinyfishRouter.tinyfishSearch = async () => ({ results: [] });
});
afterEach(() => {
  kiloRouter.kiloInfer = originalInfer;
  tinyfishRouter.tinyfishSearch = originalSearch;
});

const factor = (scope = "global") => ({
  id: "news-1", name: "Oil supply tightens", category: "Market", explanation: "Demand rises 3% at USD 92.",
  commodities: ["oil"], direction: "up", magnitude: "High", source: "https://www.eia.gov/news",
  bias: "short", drift: { oil: 0.02 }, scope, regions: [scope], importanceScore: 82,
  grounding: { oil: { price: 92, unit: "USD/bbl", source: "https://www.eia.gov" } },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

test("all factor display fields translate; machine data and canonical window stay unchanged", async () => {
  const input = { factors: [factor()] };
  const output = await translateStructured(input, "es", FACTOR_TRANSLATION_KEYS, { required: true });
  for (const key of ["name", "category", "explanation"]) assert.equal(output.factors[0][key], `Traducido: ${input.factors[0][key]}`);
  for (const key of ["id", "commodities", "direction", "magnitude", "source", "drift", "grounding", "scope", "regions", "createdAt"]) {
    assert.deepEqual(output.factors[0][key], input.factors[0][key]);
  }
  assert.equal(input.factors[0].name, "Oil supply tightens");
  assert.match(calls[0].messages[0].content, /Spanish/);
});

test("English target translates non-English evidence instead of bypassing Kilo", async () => {
  kiloRouter.kiloInfer = async (payload) => {
    assert.match(payload.messages[0].content, /English/);
    return reply(["Oil demand increases"]);
  };
  assert.deepEqual(await translateTexts(["La demanda de petróleo aumenta"], "en", { required: true }), ["Oil demand increases"]);
});

test("translation caches are language-specific, deduplicate strings, and expire", async () => {
  let now = Date.now();
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await translateTexts(["Demand rises", "Demand rises"], "es");
    assert.equal(JSON.parse(calls[0].messages[1].content).length, 1);
    await translateTexts(["Demand rises", "Demand rises"], "es");
    assert.equal(calls.length, 1);
    await translateTexts(["Demand rises", "Demand rises"], "vi");
    assert.match(calls[1].messages[0].content, /Vietnamese/);
    now += 24 * 60 * 60 * 1000 + 1;
    await translateTexts(["Demand rises", "Demand rises"], "es");
    assert.equal(calls.length, 3);
  } finally { Date.now = originalNow; }
});

test("large factor payloads use bounded batches instead of a truncated response", async () => {
  const input = Array.from({ length: 30 }, (_, i) => `Headline ${i}: ${"market demand ".repeat(55)}`);
  const output = await translateTexts(input, "vi", { required: true });
  assert.ok(calls.length > 1);
  for (const call of calls) assert.ok(JSON.parse(call.messages[1].content).join("").length <= 4000);
  assert.deepEqual(output, input.map((s) => `Traducido: ${s}`));
});

test("malformed/truncated and fact-changing translations retry and are never cached", async () => {
  for (const invalid of [reply({}), reply(["" ]), reply(["Demanda 4% https://example.org"]), reply(["Demanda 3% 3% https://example.com"]), reply(["Demanda 3% https://example.com"], "length")]) {
    await clearCache();
    let count = 0;
    kiloRouter.kiloInfer = async () => { count++; return invalid; };
    await assert.rejects(translateTexts(["Demand 3% https://example.com"], "es", { required: true }), TranslationError);
    assert.equal(count, 2);
    kiloRouter.kiloInfer = async () => { count++; return reply(["Demanda 3% https://example.com"]); };
    assert.deepEqual(await translateTexts(["Demand 3% https://example.com"], "es", { required: true }), ["Demanda 3% https://example.com"]);
    assert.equal(count, 3);
  }
});

test("transient failure retries; required failure rejects while best-effort remains compatible", async () => {
  let count = 0;
  kiloRouter.kiloInfer = async () => { if (++count === 1) throw Error("offline"); return reply(["Demanda"]); };
  assert.deepEqual(await translateTexts(["Demand"], "es", { required: true }), ["Demanda"]);
  kiloRouter.kiloInfer = async () => { throw Error("offline"); };
  await assert.rejects(translateTexts(["Supply"], "vi", { required: true }), TranslationError);
  assert.deepEqual(await translateTexts(["Supply"], "vi"), ["Supply"]);
  await assert.rejects(translateTexts(["Supply"], "es", { required: true, signal: AbortSignal.abort() }), TranslationError);
});

test("global factors (also correlation labels) and all five regional routes localize cached evidence", async () => {
  for (const scope of ["global", "asia", "europe", "africa", "americas", "oceania"]) {
    await writeFactorWindow(scope, [factor(scope)], true);
    const response = scope === "global"
      ? await handleDynamicFactors(new Request("http://x/api/dynamic-factors?lang=es"))
      : await handleRegionalFactors(new Request(`http://x/api/regional-factors?region=${scope}&lang=vi`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.factors[0].name, "Traducido: Oil supply tightens");
    assert.equal(body.factors[0].category, "Traducido: Market");
    assert.equal((await readFactorWindow(scope)).factors[0].name, "Oil supply tightens");
  }
});

test("failed required factor translations do not leak source language", async () => {
  kiloRouter.kiloInfer = async () => { throw Error("offline"); };
  for (const scope of ["global", "asia"]) {
    await writeFactorWindow(scope, [factor(scope)], true);
    const response = scope === "global"
      ? await handleDynamicFactors(new Request("http://x/api/dynamic-factors?lang=es"))
      : await handleRegionalFactors(new Request("http://x/api/regional-factors?region=asia&lang=es"));
    assert.equal(response.status, 503);
    assert.deepEqual((await response.json()).factors, []);
  }
});

test("strategies translate titles, summaries and actions before caching, including cache hits", async () => {
  await writeFactorWindow("global", [factor()], true);
  kiloRouter.kiloInfer = async (payload) => {
    calls.push(payload);
    if (payload.messages[0].content.startsWith("You are a Senior")) {
      assert.match(payload.messages[0].content, /Spanish/);
      return reply({ solutions: [] }); // Exercise deterministic backfill too.
    }
    return reply(JSON.parse(payload.messages[1].content).map((s) => `Traducido: ${s}`));
  };
  const request = () => new Request("http://x/api/solutions?region=global&lang=es");
  const response = await handleSolutions(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.solutions.length > 0);
  for (const solution of body.solutions) {
    assert.match(solution.title, /^Traducido:/);
    assert.match(solution.summary, /^Traducido:/);
    assert.ok(solution.actions.every((s) => s.startsWith("Traducido:")));
  }
  const count = calls.length;
  assert.deepEqual((await (await handleSolutions(request())).json()).solutions, body.solutions);
  assert.equal(calls.length, count);
});

test("legacy strategy caches are ignored and failed localization is not cached", async () => {
  await setCache("solutions:es:global", { solutions: [{ title: "Wrong language" }], aiCurated: true }, 60000);
  kiloRouter.kiloInfer = async () => { throw Error("offline"); };
  const response = await handleSolutions(new Request("http://x/api/solutions?lang=es"));
  assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).solutions, []);
  assert.equal(await getCache("solutions:v2:es:global", 60000), null);
});
