import { test, expect, type Page } from '@playwright/test';

/**
 * Milestone 2 — Desktop registry-driven mega-menus.
 *
 * Proves the Buy/Sell/Verify/Parts/More mega-menus render from the navigation
 * manifest, that active items resolve to real deep-links, that planned items
 * are shown truthfully ("Soon", not a working link), that governed-trust links
 * are not falsely activated, and that keyboard interaction works.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-session-token, x-user-id, x-stakeholder-role, x-tenant-id',
  'Access-Control-Allow-Credentials': 'true',
};

async function setupPublic(page: Page) {
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    return route.fallback();
  });
  // Coverage off → governed-trust + category links defer (no misleading filter).
  await page.route('**/api/marketplace/nav-coverage**', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify({ threshold: 3, categories: {}, tags: {} }) }),
  );
  await page.route(/\.(png|jpg|jpeg|gif|svg|ico|webp)(\?.*)?$/, async (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(1) }),
  );
}

test.describe('Milestone 2 — desktop mega-menus', () => {
  test.beforeEach(async ({ page }) => {
    await setupPublic(page);
    // Generous timeout + domcontentloaded: the Vite dev server's first cold
    // compile of /marketplace can exceed the default 30s navigation budget.
    await page.goto('http://localhost:5173/marketplace', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('public-primary-nav')).toBeVisible({ timeout: 30_000 });
  });

  test('Buy mega-menu opens and shows all four sections', async ({ page }) => {
    await page.getByTestId('nav-buy').click();
    await expect(page.getByTestId('nav-buy-menu')).toBeVisible();
    constmenu = page.getByTestId('nav-buy-menu');
    await expect(menu).toBeVisible();
    for (const section of ['Vehicles', 'Popular Categories', 'Buyer Tools', 'Trust Guide']) {
      await expect(menu.getByText(section, { exact: true })).toBeVisible();
    }
  });

  test('active Buy item navigates to its real deep-link', async ({ page }) => {
    await page.getByTestId('nav-buy').click();
    await expect(page.getByTestId('nav-buy-menu')).toBeVisible();
    consttoyota = page.getByTestId('navitem-buy.toyota');
    await expect(toyota).toBeVisible();
    await toyota.click();
    await expect(page).toHaveURL(/\/marketplace\?make=Toyota/);
  });

  test('planned items render as non-navigating "Soon" entries', async ({ page }) => {
    await page.getByTestId('nav-buy').click();
    await expect(page.getByTestId('nav-buy-menu')).toBeVisible();
    constsuvs = page.getByTestId('navitem-buy.suvs');
    await expect(suvs).toBeVisible();
    await expect(suvs).toHaveAttribute('data-planned', 'true');
    await expect(suvs).toHaveAttribute('aria-disabled', 'true');
    await expect(suvs.getByText('Soon')).toBeVisible();
  });

  test('governed-trust link defers (no fabricated tag) when coverage is off', async ({ page }) => {
    await page.getByTestId('nav-buy').click();
    await expect(page.getByTestId('nav-buy-menu')).toBeVisible();
    constpassport = page.getByTestId('navitem-buy.passport-verified');
    await expect(passport).toBeVisible();
    await passport.click();
    // Deferred to base marketplace — must NOT carry ?tag=passport_verified
    await expect(page).toHaveURL(/\/marketplace$/);
  });

  test('More menu lists registry-driven service links', async ({ page }) => {
    await page.getByTestId('nav-more').click();
    const menu = page.getByTestId('nav-more-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Insurance')).toBeVisible();
    await expect(menu.getByText('Pricing')).toBeVisible();
    await expect(menu.getByText('Diaspora Trade')).toBeVisible();
  });

  test('Escape closes an open mega-menu (keyboard)', async ({ page }) => {
    await page.getByTestId('nav-parts').click();
    await expect(page.getByTestId('nav-parts-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('nav-parts-menu')).not.toBeVisible();
  });

  test('deep-link refresh preserves marketplace query state', async ({ page }) => {
    await page.goto('http://localhost:5173/marketplace?make=Toyota&maxPrice=10000', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/make=Toyota/);
    await expect(page).toHaveURL(/maxPrice=10000/);
  });
});
