import { test, expect } from '@playwright/test';

test.describe('Agent 2 - Seller & Dealer Validation Agent', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept and mock vehicles list API (handles query params with wildcard)
    await page.route('**/api/vehicles*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            vin: '1',
            make: 'Toyota',
            model: 'Hilux',
            year: 2022,
            price: 35000,
            trustScore: 95,
            status: 'available',
            location: 'Harare',
            images: ['https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?q=80&w=1000'],
            tenant: { name: 'Croco Motors', phone: '+263772100200', logo_url: null },
            created_at: new Date().toISOString()
          }
        ])
      });
    });

    // Mock auth login response (handles wildcard)
    await page.route('**/api/auth/login*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'u3', name: 'Croco Motors', email: 'dealer@crocomoto.co.zw', role: 'dealer' },
          token: 'mock-dealer-token-123'
        })
      });
    });
  });

  test('Dealer Dashboard Loads', async ({ page }) => {
    // Go to login page
    await page.goto('/login');
    
    // Perform Demo Dealer login
    const demoDealerBtn = page.getByRole('button', { name: /Demo: Dealer/i });
    await expect(demoDealerBtn).toBeVisible();
    await demoDealerBtn.click();

    // Verify automatic redirect to /dealer
    await expect(page).toHaveURL(/\/dealer/);

    // Assert key dashboard elements are visible
    await expect(page.getByRole('heading', { name: /Dealer Dashboard/i })).toBeVisible();
    await expect(page.getByText('Croco Motors Group • Harare Headquarters')).toBeVisible();
    await expect(page.getByText('Branch Location:')).toBeVisible();
  });
});
