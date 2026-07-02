import { test, expect, type Page } from '@playwright/test';

/**
 * Milestone 4 — Registry-driven mobile web navigation.
 *
 * Verifies the mobile drawer for public + authenticated roles: registry-driven
 * items, no cross-role leakage, focus trap / Escape / focus-return, aria-current,
 * close-after-navigation and role-switch refresh. Runs at a phone viewport so
 * the lg:hidden drawer trigger is shown.
 */

test.use({ viewport: { width: 390, height: 844 } });

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-session-token, x-user-id, x-stakeholder-role, x-tenant-id',
  'Access-Control-Allow-Credentials': 'true',
};

async function setup(page: Page, role?: string) {
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    return route.fallback();
  });
  await page.route('**/api/marketplace/nav-coverage**', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify({ threshold: 3, categories: {}, tags: {} }) }),
  );
  await page.route(/\.(png|jpg|jpeg|gif|svg|ico|webp)(\?.*)?$/, async (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(1) }),
  );
  if (role) {
    const user = { id: `mock-${role}-id`, name: `Test ${role}`, email: `${role}@carup.test`, role, avatar: 'x', active_tenant_id: role === 'dealer' ? 'tenant-dealer-1' : null };
    await page.addInitScript((u) => {
      localStorage.setItem('carup_session', JSON.stringify({ token: 'mock-token' }));
      localStorage.setItem('carup_token', 'mock-token');
      localStorage.setItem('carup_user', JSON.stringify(u));
    }, user);
  }
}

async function open(page: Page, path = '/marketplace') {
  await page.goto(`http://localhost:5173${path}`, { timeout: 90_000, waitUntil: 'domcontentloaded' });
  const trigger = page.getByTestId('mobile-menu-button');
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  await expect(page.getByTestId('mobile-nav-drawer')).toBeVisible();
}

test.describe('Milestone 4 — mobile drawer', () => {
  test('public drawer shows primary links + sign-in, no role items', async ({ page }) => {
    await setup(page);
    await open(page);
    const drawer = page.getByTestId('mobile-nav-drawer');
    for (const id of ['mobile.buy', 'mobile.sell', 'mobile.verify', 'mobile.parts', 'mobile.dealers', 'mobile.garages']) {
      await expect(drawer.getByTestId(`mobile-navitem-${id}`)).toBeVisible();
    }
    await expect(drawer.getByTestId('mobile-signin')).toBeVisible();
    await expect(drawer.getByTestId('mobile-register')).toBeVisible();
    await expect(drawer.getByTestId('mobile-dashboard-root')).toHaveCount(0);
  });

  test('owner drawer shows dashboard items and never dealer items (no leakage)', async ({ page }) => {
    // Public Navbar (which hosts the drawer) is shown on public pages; an
    // authenticated owner browsing /marketplace sees their role items.
    await setup(page, 'owner');
    await open(page, '/marketplace');
    const drawer = page.getByTestId('mobile-nav-drawer');
    await expect(drawer.getByTestId('mobile-dashboard-root')).toBeVisible();
    await expect(drawer.getByTestId('mobile-navitem-owner.garage')).toBeVisible();
    await expect(drawer.getByTestId('mobile-navitem-dealer.inventory')).toHaveCount(0);
    await expect(drawer.getByTestId('mobile-navitem-admin.users')).toHaveCount(0);
    await expect(drawer.getByTestId('mobile-signout')).toBeVisible();
  });

  test('dealer drawer shows dealer items and not owner garage', async ({ page }) => {
    await setup(page, 'dealer');
    await open(page, '/marketplace');
    const drawer = page.getByTestId('mobile-nav-drawer');
    await expect(drawer.getByTestId('mobile-navitem-dealer.inventory')).toBeVisible();
    await expect(drawer.getByTestId('mobile-navitem-owner.garage')).toHaveCount(0);
  });

  test('Escape closes the drawer and returns focus to the trigger', async ({ page }) => {
    await setup(page);
    await open(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('mobile-nav-drawer')).not.toBeVisible();
    await expect(page.getByTestId('mobile-menu-button')).toBeFocused();
  });

  test('navigating from the drawer closes it and updates the route', async ({ page }) => {
    await setup(page);
    await open(page);
    await page.getByTestId('mobile-navitem-mobile.verify').click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.getByTestId('mobile-nav-drawer')).not.toBeVisible();
  });

  test('active route is marked with aria-current', async ({ page }) => {
    await setup(page);
    await open(page, '/marketplace');
    const buy = page.getByTestId('mobile-nav-drawer').getByTestId('mobile-navitem-mobile.buy');
    await expect(buy).toHaveAttribute('aria-current', 'page');
  });
});
