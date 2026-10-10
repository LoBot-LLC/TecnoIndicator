import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
    console.log('✓ Page loaded successfully');

    const htmlClass = await page.evaluate(() => document.documentElement.className);
    console.log('Initial html class:', htmlClass);

    const themeToggle = page.locator('button[aria-label*="theme" i], button[aria-label*="dark" i], button[aria-label*="light" i], [data-theme-toggle], button:has(svg.lucide-sun), button:has(svg.lucide-moon)').first();
    const toggleExists = await themeToggle.count() > 0;
    console.log('Theme toggle exists:', toggleExists);

    // Ensure dark mode is active
    if (!htmlClass.includes('dark')) {
      if (toggleExists) {
        await themeToggle.click();
        await page.waitForTimeout(600);
        console.log('Toggled to dark mode');
      } else {
        console.log('No theme toggle found; checking existing theme class...');
      }
    }

    // Wait for page to reflect dark mode
    await page.waitForTimeout(500);

    // Navigate to Regions section
    let regionsSection = page.locator('section#regions');
    const regionsCount = await regionsSection.count();
    console.log('Regions section found:', regionsCount > 0);

    if (regionsCount > 0) {
      await regionsSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
    }

    const canvas = page.locator('canvas');
    const canvasExists = await canvas.count() > 0;
    console.log('Canvas found on page:', canvasExists);

    const canvasCount = await canvas.count();
    if (canvasCount > 1) {
      console.log('Multiple canvases found; using the one near the cross-region comparison chart');
      const chartCanvas = await canvas.nth(1);
      const boundingBox = await chartCanvas.boundingBox();
      console.log('Chart canvas bounding box:', JSON.stringify(boundingBox));
    }

    // Wait for chart to be drawn
    await page.waitForTimeout(1000);

    // Read canvas pixel data to verify chart elements are rendered and visible
    const chartPixelInfo = await page.evaluate(async () => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const { width, height } = canvas;
      const imageData = ctx.getImageData(0, 0, width, height);
      const px = imageData.data;
      const colors = new Map();
      for (let i = 0; i < px.length; i += 4 * 80) {
        const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
        if (a >= 230) {
          const key = `${r},${g},${b}`;
          colors.set(key, (colors.get(key) || 0) + 1);
        }
      }
      const bright = new Map();
      colors.forEach((count, key) => {
        const [r, g, b] = key.split(',').map(Number);
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        bright.set(brightness, (bright.get(brightness) || 0) + count);
      });
      return {
        width,
        height,
        colors: [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
        brightColors: [...bright.entries()].sort((a, b) => b[1] - b[1]).slice(0, 10),
        chartElement: canvas,
      };
    });

    console.log('Chart pixel info:', JSON.stringify(chartPixelInfo, null, 2));

    // Verify dark mode is active and chart colors are dark (readable in dark mode)
    const darkModeActive = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    console.log('Dark mode active:', darkModeActive);

    // Take screenshot of the chart region in dark mode
    await page.locator('section#regions').screenshot({ path: '/workspace/app/chart-dark-mode.png', fullPage: false });
    console.log('✓ Screenshot saved to /workspace/app/chart-dark-mode.png');

    // Also take full-page screenshot
    await page.screenshot({ path: '/workspace/app/fullpage-dark-mode.png', fullPage: true });
    console.log('✓ Full page screenshot saved to /workspace/app/fullpage-dark-mode.png');

    console.log('Chart cross-region comparison dark-mode readability test complete');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();