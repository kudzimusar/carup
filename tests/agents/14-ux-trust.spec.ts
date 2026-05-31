import { test, expect } from '@playwright/test';

test.describe('Agent 14 - UX & Trust Validation Agent', () => {
  test('VALIDATE TRUST VISIBILITY', async ({ page }) => {
    await page.goto('/marketplace');

    // Trust Badges
    const verifiedBadge = page.locator('text=Verified|badge');
    if (await verifiedBadge.count() === 0) {
      console.log('Missing: Trust Badges (Verified tags) on listings');
    }

    // Safepay / Escrow security confidence
    await page.goto('/trust');
    const trustContent = page.locator('text=safest place');
    if (await trustContent.count() === 0) {
      console.log('Missing: Trust & Safety page content regarding safest place');
    }
  });
});
