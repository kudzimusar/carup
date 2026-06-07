import { test, expect } from '@playwright/test';

test.describe('Agent 1 - Buyer Journey Validation', () => {
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

    // Intercept and mock vehicle details API (handles details with wildcard)
    await page.route('**/api/vehicles/*/details*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        })
      });
    });
  });

  test('Homepage Loads', async ({ page }) => {
    await page.goto('/');
    // Hard assertion that marketplace-first homepage is visible
    await expect(page.getByRole('heading', { name: /Find Verified Cars\. Sell With Confidence\./i })).toBeVisible();
    await expect(page.locator('[data-testid="home-buy-search"]')).toBeVisible();
  });

  test('Marketplace Loads', async ({ page }) => {
    await page.goto('/marketplace');
    // Hard assertion that the title and search input are visible
    await expect(page.getByRole('heading', { name: /Vehicle Marketplace/i })).toBeVisible();
    const searchInput = page.getByPlaceholder(/search make, model, location/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Toyota Hilux');
  });

  test('Vehicle Detail Page Loads', async ({ page }) => {
    await page.goto('/marketplace/1');
    // Hard assertion that details and trust indicators are visible
    await expect(page.getByRole('heading', { name: /Toyota Hilux/i })).toBeVisible();
    await expect(page.getByText('Croco Motors')).toBeVisible();
    await expect(page.getByText('Harare Province')).toBeVisible();
  });
});
