import { test, expect } from '@playwright/test';

test.describe('Agent 12 - Admin Command Center Validation Agent', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept and mock switch role API (handles wildcard)
    await page.route('**/api/auth/switch-role*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'u1', name: 'Tendai Moyo', email: 'tendai@email.co.zw', role: 'admin' },
          token: 'mock-admin-token-123'
        })
      });
    });

    // Mock auth login response (handles wildcard)
    await page.route('**/api/auth/login*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'u1', name: 'Tendai Moyo', email: 'tendai@email.co.zw', role: 'owner' },
          token: 'mock-owner-token-123'
        })
      });
    });
  });

  test('Admin Dashboard Loads via Stakeholder Role Switcher', async ({ page }) => {
    // Go to login page
    await page.goto('/login');

    // Click quick demo login as Buyer (Tendai Moyo)
    const demoBuyerBtn = page.getByRole('button', { name: /Browse as Buyer/i });
    await expect(demoBuyerBtn).toBeVisible();
    await demoBuyerBtn.click();

    // Verify automatic redirect to /dashboard (Owner Dashboard loads)
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Owner Dashboard/i })).toBeVisible();

    // Locating the stakeholder selector dropdown in sidebar
    const roleSelect = page.locator('select');
    await expect(roleSelect).toBeVisible();

    // Switch role to Administrator (value: admin)
    await roleSelect.selectOption('admin');

    // Verify automatic redirection to /admin (Admin Dashboard loads)
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole('heading', { name: /Ecosystem Governance/i })).toBeVisible();
    await expect(page.getByText('System metrics, stakeholder organizations')).toBeVisible();
  });
});
