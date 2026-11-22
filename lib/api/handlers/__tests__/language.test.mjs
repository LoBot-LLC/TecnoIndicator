// Spec for `node --test`. translate.ts imports the Kilo router with
// extensionless relative imports, which Node's strip-types loader cannot
// resolve directly, so run the assertions against compiled output instead:
//   tsc lib/api/_shared/language.ts lib/api/_shared/translate.ts --outDir /tmp/kilo2/lang --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck --lib es2022,dom
//   then require('/tmp/kilo2/lang/language.js') / require('/tmp/kilo2/lang/translate.js') and run these assertions.
// The en short-circuit is exercised without network: no Kilo call is made for lang=en.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLanguage, LANGUAGE_NAMES, languageFromRequest } from "../../_shared/language.ts";
import { translateTexts, translateStructured } from "../../_shared/translate.ts";

test("parseLanguage accepts supported codes", () => {
  assert.equal(parseLanguage("en"), "en");
  assert.equal(parseLanguage("es"), "es");
  assert.equal(parseLanguage("vi"), "vi");
});

test("parseLanguage normalizes case, whitespace and region suffixes", () => {
  assert.equal(parseLanguage(" ES "), "es");
  assert.equal(parseLanguage("vi-VN"), "vi");
  assert.equal(parseLanguage("en_US"), "en");
});

test("parseLanguage defaults to en for unsupported or non-string input", () => {
  assert.equal(parseLanguage("fr"), "en");
  assert.equal(parseLanguage(""), "en");
  assert.equal(parseLanguage(undefined), "en");
  assert.equal(parseLanguage(null), "en");
  assert.equal(parseLanguage(42), "en");
});

test("LANGUAGE_NAMES covers every supported language", () => {
  assert.equal(LANGUAGE_NAMES.en, "English");
  assert.equal(LANGUAGE_NAMES.es, "Spanish");
  assert.equal(LANGUAGE_NAMES.vi, "Vietnamese");
});

test("languageFromRequest reads query then body, defaulting to en", () => {
  assert.equal(languageFromRequest(new Request("http://x/api/solutions?lang=vi")), "vi");
  assert.equal(languageFromRequest(new Request("http://x/api/solutions"), { lang: "es" }), "es");
  assert.equal(languageFromRequest(new Request("http://x/api/solutions")), "en");
});

test("translateTexts short-circuits for en without network", async () => {
  const input = ["Oil supply tightens", "Rate 5%"];
  const out = await translateTexts(input, "en");
  assert.equal(out, input);
});

test("translateStructured short-circuits for en without network", async () => {
  const input = { factors: [{ id: "f1", explanation: "Demand rises 3%" }] };
  const out = await translateStructured(input, "en", ["explanation"]);
  assert.equal(out, input);
});
