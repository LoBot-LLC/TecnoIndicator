// Start the production or development server before running npm run test:e2e.
// APIs are mocked: no credentials or live upstream access required.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let delaySpanish = false;
    let spanishRequests = 0;
    let releaseSpanish;
    const spanishGate = new Promise((resolve) => { releaseSpanish = resolve; });
    const labels = { en: "Oil supply tightens", es: "La oferta de petróleo se reduce", vi: "Nguồn cung dầu thắt chặt" };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const lang = url.searchParams.get("lang") || "en";
      const scope = url.searchParams.get("region") || "global";
      const name = labels[lang];
      const factor = {
        id: `news-${scope}`, name, category: { en: "Market", es: "Mercado", vi: "Thị trường" }[lang],
        explanation: name, commodities: ["oil"], direction: "up", magnitude: "High", source: "https://www.eia.gov/news",
        bias: "short", drift: { oil: 0.02 }, scope, regions: [scope], importanceScore: 82,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      let body = {};
      if (url.pathname.includes("factors")) body = { factors: [factor], aiCurated: true };
      else if (url.pathname.includes("solutions")) body = { solutions: [{ id: "strategy", title: name, summary: name, actions: [name], commodities: ["oil"], regions: ["global"], relatedFactors: [factor.id], confidence: 80 }] };
      else if (url.pathname.includes("health")) body = { onlineModelConnected: true };
      else if (url.pathname.includes("analytics")) body = { fuelLevy: 0.1, electricityTariffAdjustmentIndex: 0.2, waterScarcityAdjustedPriceIndex: 0.3, dataSource: name, isLive: true, timestamp: new Date().toISOString() };
      else if (url.pathname.includes("prices")) body = { oil: { price: 92 }, electricity: { price: 100 }, water: { price: 2.5 }, asOf: new Date().toISOString(), isLive: true };
      else if (url.pathname.includes("rates")) body = { rates: { USD: 1 }, base: "USD" };
      if (delaySpanish && lang === "es" && /factors|solutions/.test(url.pathname)) {
        spanishRequests++;
        await spanishGate;
      }
      await route.fulfill({ json: body }).catch(() => {}); // Aborted stale requests are expected.
    });
    // Fonts/telemetry aren't needed for deterministic offline browser tests.
    await page.route(/^https:\/\/(?!localhost|127\.0\.0\.1).*/, (route) => route.abort());
    await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000");
    const assertSections = async (lang) => {
      for (const section of ["#solutions", "#factors", "#correlations", "#regional-factors"]) {
        await page.locator(section).getByText(labels[lang], { exact: true }).first().waitFor({ state: "attached" });
        const text = await page.locator(section).textContent();
        for (const other of Object.keys(labels).filter((key) => key !== lang)) assert.ok(!text.includes(labels[other]), `${section} contains stale ${other} text`);
      }
    };
    await assertSections("en");
    if (viewport.width < 768) await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("radio", { name: "Español", exact: true }).click();
    await assertSections("es");
    assert.equal(await page.locator("html").getAttribute("lang"), "es");
    // English -> delayed Spanish -> Vietnamese: old responses must not win.
    await page.getByRole("radio", { name: "English", exact: true }).click();
    await assertSections("en");
    delaySpanish = true;
    await page.getByRole("radio", { name: "Español", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.lang === "es");
    assert.ok(spanishRequests > 0);
    await page.getByRole("radio", { name: "Tiếng Việt", exact: true }).click();
    await assertSections("vi");
    releaseSpanish();
    // A browser request round trip lets the released stale responses settle.
    await page.evaluate(() => fetch("/api/health"));
    await assertSections("vi");
    assert.equal(await page.evaluate(() => localStorage.getItem("tecno.language")), "vi");
    assert.deepEqual(errors, []);
    console.log(`PASS localization, all four sections and stale-response race (${viewport.width}px)`);
    await page.close();
  }
} finally {
  await browser.close();
}
