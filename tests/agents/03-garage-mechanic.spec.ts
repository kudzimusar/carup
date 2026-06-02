import { test, expect } from '@playwright/test';

test.describe('Agent 3 - Garage & Mechanic Validation Agent', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth login response (handles wildcard)
    await page.route('**/api/auth/login*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'u2', name: 'Simba Mechanic', email: 'simba@garage.co.zw', role: 'mechanic' },
          token: 'mock-mechanic-token-123'
        })
      });
    });
  });

  test('Mechanic Dashboard Loads', async ({ page }) => {
    // Go to login page
    await page.goto('/login');
    
    // Perform Demo Mechanic login
    const demoMechanicBtn = page.getByRole('button', { name: /Demo: Mechanic/i });
    await expect(demoMechanicBtn).toBeVisible();
    await demoMechanicBtn.click();

    // Verify automatic redirect to /mechanic
    await expect(page).toHaveURL(/\/mechanic/);

    // Assert key dashboard elements are visible
    await expect(page.getByRole('heading', { name: /Mechanic Dashboard/i })).toBeVisible();
    await expect(page.getByText('Simbisa Garages Ltd')).toBeVisible();
    await expect(page.getByText('Active Orders')).toBeVisible();
  });
});
