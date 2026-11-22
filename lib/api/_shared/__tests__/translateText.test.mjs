// Run: npx tsx lib/api/_shared/__tests__/translateText.test.mjs
import assert from "node:assert/strict";
import { isUsableTranslation } from "../translateText.ts";

const ok = (original, candidate) =>
  assert.equal(isUsableTranslation(original, candidate).ok, true, `should accept: "${candidate}"`);
const bad = (original, candidate) =>
  assert.equal(isUsableTranslation(original, candidate).ok, false, `should reject: "${candidate}"`);

// Empty candidates are rejected (empty and whitespace-only).
bad("Oil prices", "");
bad("Oil prices", "   ");

// Candidates far beyond the allowed bound are rejected.
// original "Gas" (3 chars) allows at most 3*3+60 = 69 chars.
bad("Gas", "This candidate string is deliberately long enough to bust the length bound for the source.");
// original "Hi" (2 chars) allows at most 2*3+60 = 66 chars.
bad("Hi", "A reasonably long candidate string that exceeds sixty-six characters for sure yes indeed.");

// Normal translations are accepted.
ok("Gas prices", "Los precios del gas suben.");
ok("WTI crude settled at 82 USD/bbl.", "El crudo WTI cerró en 82 USD/bbl.");
ok("Solution: expand LNG capacity", "Solución: ampliar la capacidad de GNL");

console.log("translateText tests passed");
