import { test, expect } from '@playwright/test';

test.describe('Agent 7 - Authentication & Role Switching Agent', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept and mock register API response (handles wildcard)
    await page.route('**/api/auth/register*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'u1', name: 'Tendai Moyo', email: 'tendai@email.co.zw', role: 'owner' },
          token: 'mock-owner-token-123'
        })
      });
    });

    // Intercept and mock login API response (handles wildcard)
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

  test('Register User Flow', async ({ page }) => {
    await page.goto('/register');
    
    // Step 1 Form
    await page.getByPlaceholder('Tendai', { exact: true }).fill('Tendai');
    await page.getByPlaceholder('Moyo', { exact: true }).fill('Moyo');
    await page.getByPlaceholder('tendai@email.co.zw', { exact: true }).fill('tendai@email.co.zw');
    await page.getByPlaceholder('+263 7XX XXX XXX').fill('+263773345678');
    
    // Select role "Car Owner"
    await page.locator('button:has-text("Select your role")').click();
    await page.getByRole('option', { name: 'Car Owner' }).click();

    // Click Continue to go to Step 2
    await page.getByRole('button', { name: /continue/i }).click();

    // Step 2 Form
    await page.getByPlaceholder('e.g. Harare').fill('Harare');
    await page.getByPlaceholder('Min 8 characters').fill('password123');
    await page.getByPlaceholder('Repeat password').fill('password123');
    await page.locator('input[type="checkbox"]').check();

    // Submit registration
    await page.getByRole('button', { name: /create account/i }).click();

    // Assert that we are redirected to /dashboard (Owner Dashboard loads)
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Owner Dashboard/i })).toBeVisible();
  });

  test('Login, Owner Dashboard, and Logout Flow', async ({ page }) => {
    await page.goto('/login');

    // Fill credentials
    await page.getByPlaceholder('tendai@email.co.zw or +263...').fill('tendai@email.co.zw');
    await page.getByPlaceholder('Enter your password').fill('password123');

    // Click Login
    await page.getByTestId('login-button').click();

    // Assert redirect to /dashboard and correct role dashboard loads
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Owner Dashboard/i })).toBeVisible();
    await expect(page.getByText('Tendai Moyo').first()).toBeVisible();

    // Check if we are in a mobile viewport (Tailwind lg breakpoint is 1024px)
    const viewport = page.viewportSize();
    const isMobile = viewport && viewport.width < 1024;

    if (isMobile) {
      // Open sidebar on mobile before logging out
      const mobileMenuToggle = page.locator('header button').first();
      await expect(mobileMenuToggle).toBeVisible();
      await mobileMenuToggle.click({ force: true });
      // Wait for the slide-in transition to complete
      await page.waitForTimeout(500);
    }

    // Perform logout
    const logoutBtn = page.getByTestId('logout-button');
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.dispatchEvent('click');

    // Assert redirect back to homepage or login page after logout
    await expect(page).toHaveURL(/\/$/);
  });
});
