import { test, expect, type Page } from '@playwright/test';

/**
 * Milestone 5 — Shared route boundaries & direct-access enforcement.
 *
 * Direct URL access uses the SAME decision as navigation: unauthenticated
 * access to a protected route redirects to login with a sanitized return-to;
 * a wrong-role user is sent to their own dashboard; unknown routes render the
 * not-found page (previously blank); public routes render normally.
 */

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

const go = (page: Page, path: string) =>
  page.goto(`http://localhost:5173${path}`, { timeout: 90_000, waitUntil: 'domcontentloaded' });

test.describe('Milestone 5 — route boundaries', () => {
  test('unauthenticated → protected route redirects to login with sanitized return-to', async ({ page }) => {
    await setup(page);
    await go(page, '/dashboard/garage');
    await page.waitForURL(/\/login\?returnTo=/, { timeout: 30_000 });
    expect(page.url()).toContain('returnTo=%2Fdashboard%2Fgarage');
  });

  test('wrong-role user is redirected to their own dashboard', async ({ page }) => {
    await setup(page, 'dealer');
    await go(page, '/dashboard'); // owner route
    await page.waitForURL(/\/dealer$/, { timeout: 30_000 });
  });

  test('correct-role user renders the protected route', async ({ page }) => {
    await setup(page, 'owner');
    await go(page, '/dashboard/garage');
    // stays on the route (no redirect away)
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/dashboard/garage');
  });

  test('unknown route renders the not-found page (no longer blank)', async ({ page }) => {
    await setup(page);
    await go(page, '/this/route/does/not/exist');
    await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 30_000 });
  });

  test('public route renders normally', async ({ page }) => {
    await setup(page);
    await go(page, '/marketplace');
    await expect(page.getByTestId('public-primary-nav')).toBeVisible({ timeout: 30_000 });
  });
});
