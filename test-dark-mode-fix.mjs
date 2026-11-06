import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let failures = 0;

  function check(condition, msg) {
    if (!condition) { console.error(`FAIL: ${msg}`); failures++; }
    else console.log(`PASS: ${msg}`);
  }

  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Page loaded successfully');

    // Open settings
    const settingsTrigger = page.locator('button[aria-label="Settings"]');
    check(await settingsTrigger.count() > 0, 'Settings trigger exists');
    await settingsTrigger.click();
    await page.waitForTimeout(300);
    const settingsPanel = page.locator('[role="dialog"][aria-label="Settings"]');
    check(await settingsPanel.count() > 0, 'Settings dialog opens');

    // Switch to dark mode
    const themeSelect = settingsPanel.locator('select').first();
    await themeSelect.selectOption('dark');
    await page.waitForTimeout(500);
    const htmlClass = await page.evaluate(() => document.documentElement.className);
    check(htmlClass.includes('dark'), 'Dark mode activated');

    // Open font dropdown and verify option text is readable (not white-on-white)
    const fontSelects = settingsPanel.locator('select');
    const fontSelect = fontSelects.nth(1);
    await fontSelect.click();
    await page.waitForTimeout(500);

    // Check that font options have visible text in dark mode
    // Get computed color of an option element
    const optionColor = await page.evaluate(() => {
      const options = document.querySelectorAll('option');
      if (options.length === 0) return null;
      const opt = options[0];
      const style = getComputedStyle(opt);
      return { color: style.color, backgroundColor: style.backgroundColor };
    });
    console.log(`Option computed style: color=${optionColor?.color}, bg=${optionColor?.backgroundColor}`);
    check(optionColor?.color !== 'rgb(255, 255, 255)' || optionColor?.backgroundColor !== 'rgba(0, 0, 0, 0)',
      'Font option text is not white-on-transparent in dark mode');

    // Switch back to light mode
    await themeSelect.selectOption('light');
    await page.waitForTimeout(500);
    const htmlClassLight = await page.evaluate(() => document.documentElement.className);
    check(!htmlClassLight.includes('dark'), 'Switched back to light mode');

    // Close settings on Escape (click outside first to release focus)
    await page.click('body', { clickCount: 1, delay: 100 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check(await settingsPanel.count() === 0, 'Settings closes on Escape');

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);

  } catch (error) {
    console.error('Test error:', error.message);
    failures++;
  } finally {
    await browser.close();
    process.exit(failures > 0 ? 1 : 0);
  }
})();