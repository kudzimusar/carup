import { test, expect } from '@playwright/test';

test.describe('Agent 9 - Mobile Experience Validation Agent', () => {
  // Playwright configuration handles mobile viewports for the "Mobile Chrome" project.
  test('VALIDATE MOBILE UX', async ({ page }) => {
    await page.goto('/');

    // Bottom Navigation check
    const bottomNav = page.locator('nav.bottom-nav, div[class*="bottom-nav"]');
    if (await bottomNav.count() === 0) {
      console.log('Missing: Mobile Bottom Navigation');
    }

    // Touch targets size verification (heuristics)
    const buttons = await page.getByRole('button').all();
    for (const btn of buttons) {
      const box = await btn.boundingBox();
      if (box && (box.width < 44 || box.height < 44)) {
        // According to mobile guidelines, touch targets should be at least 44x44
        console.log(`Warning: Small touch target detected. Width: ${box.width}, Height: ${box.height}`);
      }
    }
  });
});
