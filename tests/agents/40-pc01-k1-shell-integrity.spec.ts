import { test, expect, type Page } from '@playwright/test';

/**
 * PC01-K1 — shell integrity at real viewport geometry (what jsdom cannot measure).
 *
 * The owner proved on a phone that the dashboard drawer's Settings / Sign Out sat under the compact
 * bottom bar, that Settings led to "Page not found", and that a signed-out phone showed no Sign In.
 * These assert the account actions are on-screen and are the top-most element at their own centre
 * (nothing covers them) on a portrait phone, a short landscape phone, a tablet and desktop.
 */

const BASE = 'http://localhost:5173';
const corsHeaders = {
  'Access-Control-Allow-Origin': BASE,
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
    const user = { id: `mock-${role}-id`, name: `Test ${role}`, email: `${role}@carup.test`, role, avatar: 'x' };
    await page.addInitScript((u) => {
      if (sessionStorage.getItem('k1-signed-out')) return;
      localStorage.setItem('carup_session', JSON.stringify({ token: 'mock-token' }));
      localStorage.setItem('carup_token', 'mock-token');
      localStorage.setItem('carup_user', JSON.stringify(u));
    }, user);
  }
}

/** On-screen and not covered: the element itself is what a tap at its centre would hit. */
async function expectReachable(page: Page, testId: string, within = page.getByTestId('dashboard-sidebar')) {
  const el = within.getByTestId(testId);
  await expect(el).toBeVisible();
  const box = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  const hit = await page.evaluate(([x, y, id]) => {
    const top = document.elementFromPoint(x, y);
    return !!top?.closest(`[data-testid="${id}"]`);
  }, [box.x + box.width / 2, box.y + box.height / 2, testId] as const);
  expect(hit, `${testId} is covered at its centre`).toBe(true);
}

const DASH = { admin: '/admin', owner: '/dashboard' } as const;
const PORTAL = { admin: 'Administrator', owner: 'Car Owner' } as const;
const COMPACT = [
  { name: 'portrait phone 390x844', viewport: { width: 390, height: 844 } },
  { name: 'short phone 390x560', viewport: { width: 390, height: 560 } },
  { name: 'short landscape 740x360', viewport: { width: 740, height: 360 } },
  { name: 'tablet 768x1024', viewport: { width: 768, height: 1024 } },
];

for (const role of ['admin', 'owner'] as const) {
  for (const { name, viewport } of COMPACT) {
    test(`${role} — ${name}: More opens one drawer whose Sign Out and portal are reachable`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await setup(page, role);
      await page.goto(`${BASE}${DASH[role]}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      const bar = page.getByTestId('compact-bottom-nav');
      await expect(bar).toBeVisible({ timeout: 30_000 });
      await bar.getByRole('button', { name: /More/ }).click();
      await expect(page.getByTestId('dashboard-sidebar')).toHaveAttribute('data-open', 'true');
      await page.waitForTimeout(350); // slide-in transition
      await expect(page.getByTestId('active-portal')).toHaveText(PORTAL[role]);
      await expectReachable(page, 'logout-button');
      await expect(page.getByTestId('dashboard-sidebar').getByRole('link', { name: /settings/i })).toHaveCount(0);
      // One surface: the bottom bar is under the overlay, not on top of the drawer.
      const barCovered = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="compact-bottom-nav"]')!.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !top?.closest('[data-testid="compact-bottom-nav"]');
      });
      expect(barCovered).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('dashboard-sidebar')).toHaveAttribute('data-open', 'false');
      if (role === 'admin' && name.startsWith('portrait')) {
        await page.screenshot({ path: 'test-results/k1/admin-mobile-closed.png' });
        await bar.getByRole('button', { name: /More/ }).click();
        await page.waitForTimeout(350);
        await page.screenshot({ path: 'test-results/k1/admin-mobile-drawer.png' });
      }
      if (role === 'admin' && name.startsWith('tablet')) {
        await bar.getByRole('button', { name: /More/ }).click();
        await page.waitForTimeout(350);
        await page.screenshot({ path: 'test-results/k1/admin-tablet-drawer.png' });
      }
    });
  }
}

test('admin desktop 1280x900: sidebar, active portal and Sign Out are visible without opening anything', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page, 'admin');
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByTestId('active-portal')).toHaveText('Administrator', { timeout: 30_000 });
  await expect(page.getByTestId('compact-bottom-nav')).toBeHidden();
  await expectReachable(page, 'logout-button');
  await expect(page.locator('aside a[href="/settings"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/k1/admin-desktop.png' });
});

test('signed-out phone home shows an explicit Sign in in the header and the bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const header = page.getByTestId('compact-signin');
  await expect(header).toBeVisible({ timeout: 30_000 });
  await expect(header).toHaveText(/Sign in/);
  await expect(header).toHaveAttribute('href', '/login');
  const barItem = page.getByTestId('compact-bottom-nav').locator('[data-label="Sign in"]');
  await expect(barItem).toBeVisible();
  await page.screenshot({ path: 'test-results/k1/signed-out-mobile-home.png' });
  await header.click();
  await expect(page).toHaveURL(/\/login$/);
});

test('Sign Out on a phone lands on the anonymous public home; Back and a direct visit do not restore the dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, 'admin');
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const bar = page.getByTestId('compact-bottom-nav');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await bar.getByRole('button', { name: /More/ }).click();
  await page.waitForTimeout(350);
  await page.evaluate(() => sessionStorage.setItem('k1-signed-out', '1')); // stop the init script re-seeding
  await page.getByTestId('dashboard-sidebar').getByTestId('logout-button').click();
  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page.getByTestId('compact-signin')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('carup_user'))).toBeNull();

  await page.goBack();
  await expect(page.getByTestId('dashboard-sidebar')).toHaveCount(0);

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin/);
  await expect(page.getByTestId('dashboard-sidebar')).toHaveCount(0);
});
