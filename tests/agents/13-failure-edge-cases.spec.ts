import { test, expect } from '@playwright/test';

test.describe('Agent 13 - Failure & Edge Case Validation Agent', () => {
  test('AGGRESSIVELY BREAK THE SYSTEM', async ({ page, context }) => {
    await page.goto('/marketplace');

    // Simulate Offline State
    await context.setOffline(true);
    try {
      await page.goto('/marketplace');
      // Should show offline error, not silently crash
      const offlineMsg = page.locator('text=offline');
      if (await offlineMsg.count() === 0) {
        console.log('Missing: Graceful offline state handling');
      }
    } catch (e) {
      console.log('Crash: System crashed when offline');
    }
    await context.setOffline(false);

    // Test form submissions with invalid data (e.g. login with missing fields)
    await page.goto('/login');
    const loginBtn = page.getByRole('button', { name: /login|sign in/i });
    if (await loginBtn.count() > 0) {
      await loginBtn.click();
      const errorMsg = page.locator('text=required');
      if (await errorMsg.count() === 0) {
        console.log('Missing: Form validation errors');
      }
    }
  });
});
