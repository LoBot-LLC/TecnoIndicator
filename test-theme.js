const { chromium } = require('playwright');

async function testTheme() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Navigate to the page
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
  
  // Wait for hydration
  await page.waitForTimeout(1000);
  
  // Check initial theme (should be dark by default)
  const htmlClass = await page.getAttribute('html', 'class');
  console.log('Initial HTML class:', htmlClass);
  console.log('Initial theme is dark:', htmlClass?.includes('dark'));
  
  // Find and click the theme toggle button
  const themeToggle = page.locator('button[aria-label*="Switch to"]');
  await themeToggle.click();
  
  // Wait for theme to change
  await page.waitForTimeout(500);
  
  // Check theme after toggle
  const htmlClassAfter = await page.getAttribute('html', 'class');
  console.log('After toggle HTML class:', htmlClassAfter);
  console.log('After toggle theme is dark:', htmlClassAfter?.includes('dark'));
  
  // Click again to toggle back
  await themeToggle.click();
  await page.waitForTimeout(500);
  
  const htmlClassAfter2 = await page.getAttribute('html', 'class');
  console.log('After second toggle HTML class:', htmlClassAfter2);
  console.log('After second toggle theme is dark:', htmlClassAfter2?.includes('dark'));
  
  await browser.close();
  
  const success = htmlClass?.includes('dark') && !htmlClassAfter?.includes('dark') && htmlClassAfter2?.includes('dark');
  console.log('\nTheme toggle works:', success);
  process.exit(success ? 0 : 1);
}

testTheme().catch(console.error);
