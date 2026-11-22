// Run: npx tsx lib/api/_shared/__tests__/translateExplanation.test.mjs
import assert from "node:assert/strict";
import { checkTranslatedOpening } from "../translateExplanation.ts";

const ok = (t, l) => assert.equal(checkTranslatedOpening(t, l).ok, true, `${l} should accept: ${t}`);
const bad = (t, l) => assert.equal(checkTranslatedOpening(t, l).ok, false, `${l} should reject: ${t}`);

ok("El petróleo Brent se sitúa en 82 USD/barril por recortes de la OPEP.", "es");
ok("Con el crudo en 80 USD, los inventarios cayeron.", "es");
ok("El precio de la electricidad subió un 5%.", "es");
bad("Los inventarios cayeron y el petróleo subió.", "es");
bad("La OPEP recortó la producción.", "es");
bad("", "es");
bad("   ", "es");

ok("Giá dầu Brent ở mức 82 USD/thùng do OPEC cắt giảm sản lượng.", "vi");
ok("Dầu thô WTI tăng lên 78 USD/thùng.", "vi");
ok("Điện tăng 5% do thiếu nguồn cung.", "vi");
bad("OPEC cắt giảm sản lượng khiến giá dầu tăng.", "vi");
bad("", "vi");

console.log("translateExplanation tests passed");
