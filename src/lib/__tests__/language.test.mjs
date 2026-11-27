// Tests for languageInstruction.
//
// Exercises the pure helper added for language-aware AI content:
//   - languageInstruction(lang) in lib/api/_shared/language.ts
//
// Written as plain JS so it can run under `node --test` without a TS loader.
// language.ts is self-contained (no imports), so it resolves directly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { languageInstruction, DEFAULT_API_LANGUAGE } from "../../../lib/api/_shared/language.ts";

describe("languageInstruction", () => {
  it("returns an empty string for English (the source/default language)", () => {
    assert.strictEqual(languageInstruction("en"), "");
  });

  it("returns a non-empty instruction naming the target language for Spanish", () => {
    const result = languageInstruction("es");
    assert.ok(result.length > 0);
    assert.ok(result.includes("Spanish"));
    assert.ok(result.includes("English"));
  });

  it("returns a non-empty instruction naming the target language for Vietnamese", () => {
    const result = languageInstruction("vi");
    assert.ok(result.length > 0);
    assert.ok(result.includes("Vietnamese"));
  });

  it("always preserves the numbers/units guardrail for non-English languages", () => {
    for (const lang of ["es", "vi"]) {
      assert.ok(languageInstruction(lang).includes("numbers"));
    }
  });

  it("exposes English as the default API language", () => {
    assert.strictEqual(DEFAULT_API_LANGUAGE, "en");
  });
});
