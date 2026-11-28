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

test("empty and non-text values need no network", async () => {
  assert.deepEqual(await translateTexts([], "en"), []);
  assert.deepEqual(await translateTexts(["123", "", "5%"], "es"), ["123", "", "5%"]);
  const input = { id: "f1", value: 12 };
  assert.equal(await translateStructured(input, "vi", ["explanation"]), input);
});
