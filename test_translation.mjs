import { translateStructured } from "./lib/api/_shared/translate.ts";
import { languageFromRequest } from "./lib/api/_shared/language.ts";

// Simulate a request with lang=es
const mockReq = new Request("http://localhost/api/dynamic-factors?lang=es");
const lang = languageFromRequest(mockReq);
console.log("Language detected:", lang);

// Sample payload mimicking factor structure
const payload = [
  { name: "Oil Supply Tightens", explanation: "Global oil supply is decreasing", error: null },
  { name: "Demand Surge", explanation: "Unexpected demand increase in Asia", error: "Data stale" }
];

console.log("Original payload:", JSON.stringify(payload, null, 2));

try {
  const translated = await translateStructured(payload, lang, ["name", "explanation", "error"]);
  console.log("Translated payload:", JSON.stringify(translated, null, 2));
  if (JSON.stringify(translated) === JSON.stringify(payload)) {
    console.log("WARNING: Translation did not change payload (likely fallback to original).");
  } else {
    console.log("SUCCESS: Payload was translated.");
  }
} catch (err) {
  console.error("Error during translation:", err);
}