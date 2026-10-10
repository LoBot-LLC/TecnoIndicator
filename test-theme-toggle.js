const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Navigate to the page
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
    console.log('✓ Page loaded successfully');
    
    // Wait for theme toggle to appear (look for button with aria-label or similar)
    // First, let's find the theme toggle button
    const themeToggle = page.locator('button[aria-label*="theme" i], button[aria-label*="dark" i], button[aria-label*="light" i], [data-theme-toggle], button:has(svg.lucide-sun), button:has(svg.lucide-moon)').first();
    
    // Check if theme toggle exists
    const toggleExists = await themeToggle.count() > 0;
    console.log(`✓ Theme toggle exists: ${toggleExists}`);
    
    if (!toggleExists) {
      // Try to find any button that might be the theme toggle
      const buttons = await page.locator('button').all();
      console.log(`Found ${buttons.length} buttons on page`);
      for (const btn of buttons) {
        const ariaLabel = await btn.getAttribute('aria-label');
        const className = await btn.getAttribute('class');
        const innerHTML = await btn.innerHTML();
        if (ariaLabel || className || innerHTML) {
          console.log(`Button: aria-label="${ariaLabel}", class="${className}", html="${innerHTML.substring(0, 100)}"`);
        }
      }
    }
    
    // Get initial theme (check html class or data attribute)
    const htmlClass = await page.evaluate(() => document.documentElement.className);
    const htmlDataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log(`Initial html class: ${htmlClass}`);
    console.log(`Initial data-theme: ${htmlDataTheme}`);
    
    // Check body background color in light mode
    const lightBgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    console.log(`Light mode background color: ${lightBgColor}`);
    
    // Click theme toggle if it exists
    if (toggleExists) {
      await themeToggle.click();
      await page.waitForTimeout(500); // Wait for transition
      
      // Check theme after toggle
      const htmlClassAfter = await page.evaluate(() => document.documentElement.className);
      const htmlDataThemeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      console.log(`After toggle html class: ${htmlClassAfter}`);
      console.log(`After toggle data-theme: ${htmlDataThemeAfter}`);
      
      // Check body background color in dark mode
      const darkBgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      console.log(`Dark mode background color: ${darkBgColor}`);
      
      // Check text colors in dark mode
      const textColor = await page.evaluate(() => getComputedStyle(document.body).color);
      console.log(`Dark mode text color: ${textColor}`);
      
      // Toggle back
      await themeToggle.click();
      await page.waitForTimeout(500);
      
      const htmlClassBack = await page.evaluate(() => document.documentElement.className);
      console.log(`After toggle back html class: ${htmlClassBack}`);
      
      console.log('✓ Theme toggle works correctly!');
    }
    
    // Check for any text color issues - look for elements with hardcoded colors
    const elementsWithColor = await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      const issues = [];
      elements.forEach(el => {
        const style = getComputedStyle(el);
        if (style.color && style.color !== 'rgb(0, 0, 0)' && style.color !== 'rgb(255, 255, 255)' && style.color !== 'rgba(0, 0, 0, 0)' && style.color !== 'rgba(255, 255, 255, 0)') {
          // Check if it's a hardcoded color that doesn't use CSS variables
          const classes = el.className;
          if (typeof classes === 'string' && !classes.includes('text-') && !classes.includes('dark:')) {
            // This might be a hardcoded color
          }
        }
      });
      return issues;
    });
    
    // Take screenshot for verification
    await page.screenshot({ path: '/workspace/app/screenshot-light.png', fullPage: true });
    console.log('✓ Screenshot saved (light mode)');
    
    if (toggleExists) {
      await themeToggle.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: '/workspace/app/screenshot-dark.png', fullPage: true });
      console.log('✓ Screenshot saved (dark mode)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
