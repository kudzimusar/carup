import { test, expect } from '@playwright/test';

/**
 * Feature Governance Console (Milestone 7) — Admin E2E.
 *
 * Exercises the admin Feature Governance Console at /admin/features. Because CI
 * has no real backend, the governance API is fully mocked with page.route and
 * auth is injected via addInitScript (carup_session / carup_token / carup_user),
 * mirroring the mocking conventions in 28-feature-registry-public-nav-access.spec.ts.
 */

test.describe('Feature Governance Console — admin governance surface', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-session-token, x-user-id, x-stakeholder-role, x-tenant-id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };

  function mockUser(role: string) {
    return {
      id: `mock-${role}-id`,
      name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)}`,
      email: `${role}@carup.test`,
      role,
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100',
      active_tenant_id: null,
    };
  }

  // A FeatureOverrideRow (version 2) attached to one of the rows so the reset
  // path (DELETE) and the "overridden" badge can be exercised.
  function overrideRow() {
    return {
      id: 'override-uuid-1',
      feature_id: 'owner.garage',
      environment: 'staging',
      lifecycle_state: 'beta',
      enabled: true,
      allowed_roles: ['owner'],
      allowed_tenant_ids: [],
      denied_tenant_ids: [],
      starts_at: null,
      ends_at: null,
      beta_message: 'Garage beta rollout',
      reason: 'Staged rollout for owners',
      created_by: 'mock-admin-id',
      updated_by: 'mock-admin-id',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-10T00:00:00.000Z',
      version: 2,
    };
  }

  // Two AdminFeatureRow records keyed off REAL registry feature ids:
  //  - product.insurance: no override (override:null)
  //  - owner.garage:      override present (version 2)
  function adminFeatures() {
    return [
      {
        id: 'product.insurance',
        label: 'Insurance',
        route: '/insurance',
        domain: 'insurance',
        defaultLifecycle: 'active',
        defaultRoles: [],
        immutableRoles: [],
        requiresAuth: false,
        override: null,
        effective: {
          featureId: 'product.insurance',
          state: 'active',
          enabled: true,
          visible: true,
          accessible: true,
          beta: false,
          overridden: false,
          allowedRoles: [],
        },
      },
      {
        id: 'owner.garage',
        label: 'My Garage',
        route: '/dashboard/garage',
        domain: 'commerce',
        defaultLifecycle: 'active',
        defaultRoles: ['owner'],
        immutableRoles: ['owner'],
        requiresAuth: true,
        override: overrideRow(),
        effective: {
          featureId: 'owner.garage',
          state: 'beta',
          enabled: true,
          visible: true,
          accessible: true,
          beta: true,
          betaMessage: 'Garage beta rollout',
          overridden: true,
          allowedRoles: ['owner'],
        },
      },
    ];
  }

  /**
   * Wires the governance API mocks. Returns a `calls` object the tests can read
   * to assert that PATCH (updateRollout) and DELETE (resetRollout) were invoked.
   */
  async function setupGovernanceMocks(page: any) {
    const calls = { patched: false, deleted: false };

    // Blanket OPTIONS preflight handler + image stubbing.
    await page.route('**/api/**', async (route: any) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: corsHeaders });
      }
      return route.fallback();
    });

    await page.route(/\.(png|jpg|jpeg|gif|svg|ico|webp)(\?.*)?$/, async (route: any) => {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(1) });
    });

    await page.route('**/api/auth/verify', async (route: any) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ user: mockUser('admin'), session: { token: 'mock-token' } }),
      });
    });

    // CSRF token — apiRequest fetches this before any unsafe (PATCH/DELETE)
    // governance mutation. Without it the mutation throws before firing.
    await page.route('**/api/security/csrf-token**', async (route: any) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
      });
    });

    // PATCH/DELETE on the rollout endpoint must be matched BEFORE the generic
    // list route, since the list glob would otherwise swallow these requests.
    await page.route('**/api/admin/features/*/rollout', async (route: any) => {
      const method = route.request().method();
      if (method === 'PATCH') {
        calls.patched = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ ok: true, override: { ...overrideRow(), version: 3 } }),
        });
      }
      if (method === 'DELETE') {
        calls.deleted = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ ok: true, reset: true, alreadyDefault: false }),
        });
      }
      return route.fallback();
    });

    await page.route('**/api/admin/features/*/audit', async (route: any) => {
      const url = new URL(route.request().url());
      const parts = url.pathname.split('/');
      const featureId = decodeURIComponent(parts[parts.indexOf('features') + 1] || '');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ featureId, audit: [] }),
      });
    });

    // List of features (GET /api/admin/features?environment=...). The trailing
    // glob also matches the query string.
    await page.route('**/api/admin/features?**', async (route: any) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ environment: 'staging', features: adminFeatures() }),
      });
    });
    await page.route('**/api/admin/features', async (route: any) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ environment: 'staging', features: adminFeatures() }),
      });
    });

    // Effective-state context provider used by the dashboard shell.
    await page.route('**/api/features/effective**', async (route: any) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ environment: 'staging', features: [] }),
      });
    });

    return calls;
  }

  async function authenticateAs(page: any, role: string) {
    await page.addInitScript((mockRole: string) => {
      const user = {
        id: `mock-${mockRole}-id`,
        name: `Test ${mockRole.charAt(0).toUpperCase() + mockRole.slice(1)}`,
        email: `${mockRole}@carup.test`,
        role: mockRole,
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100',
        active_tenant_id: null,
      };
      localStorage.setItem('carup_session', JSON.stringify({ token: 'mock-token' }));
      localStorage.setItem('carup_token', 'mock-token');
      localStorage.setItem('carup_user', JSON.stringify(user));
    }, role);
  }

  async function gotoConsole(page: any) {
    await page.goto('http://localhost:5173/admin/features', {
      timeout: 90000,
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('feature-governance-console')).toBeVisible({ timeout: 30000 });
  }

  test('admin opens the console and sees the feature table', async ({ page }) => {
    await setupGovernanceMocks(page);
    await authenticateAs(page, 'admin');
    await gotoConsole(page);

    await expect(page.getByTestId('fg-table')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('fg-row-product.insurance')).toBeVisible();
    await expect(page.getByTestId('fg-row-owner.garage')).toBeVisible();
  });

  test('search filters the visible rows', async ({ page }) => {
    await setupGovernanceMocks(page);
    await authenticateAs(page, 'admin');
    await gotoConsole(page);

    await expect(page.getByTestId('fg-row-owner.garage')).toBeVisible({ timeout: 30000 });

    // Filter down to the insurance feature only.
    await page.getByTestId('fg-search').fill('insurance');

    await expect(page.getByTestId('fg-row-product.insurance')).toBeVisible();
    await expect(page.getByTestId('fg-row-owner.garage')).toHaveCount(0);
  });

  test('clicking Manage opens the detail dialog showing the feature id', async ({ page }) => {
    await setupGovernanceMocks(page);
    await authenticateAs(page, 'admin');
    await gotoConsole(page);

    await expect(page.getByTestId('fg-open-product.insurance')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('fg-open-product.insurance').click();

    const dialog = page.getByTestId('fg-detail-dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByText('product.insurance', { exact: false })).toBeVisible();

    // Roles outside the immutable bound render disabled checkboxes (an override
    // can never broaden access). The checkboxes live under the tri-state
    // "Specific roles" mode; product.insurance has no immutable roles, so a
    // stakeholder role like 'dealer' must be disabled.
    await dialog.getByTestId('fg-edit-roles-mode').selectOption('custom');
    await expect(dialog.getByTestId('fg-edit-role-dealer')).toBeDisabled();
  });

  test('creating an override: save → confirm → accept calls the PATCH endpoint', async ({ page }) => {
    const calls = await setupGovernanceMocks(page);
    await authenticateAs(page, 'admin');
    await gotoConsole(page);

    await expect(page.getByTestId('fg-open-product.insurance')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('fg-open-product.insurance').click();

    const dialog = page.getByTestId('fg-detail-dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });

    await dialog.getByTestId('fg-edit-reason').fill('Enable insurance rollout for staging');
    await dialog.getByTestId('fg-edit-save').click();

    const confirm = page.getByTestId('fg-confirm-dialog');
    await expect(confirm).toBeVisible({ timeout: 15000 });
    await confirm.getByTestId('fg-confirm-accept').click();

    await expect.poll(() => calls.patched, { timeout: 15000 }).toBe(true);
  });

  test('reset: a row with an override can be reset → confirm calls the DELETE endpoint', async ({ page }) => {
    const calls = await setupGovernanceMocks(page);
    await authenticateAs(page, 'admin');
    await gotoConsole(page);

    // owner.garage carries an override (version 2), so Reset is enabled.
    await expect(page.getByTestId('fg-open-owner.garage')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('fg-open-owner.garage').click();

    const dialog = page.getByTestId('fg-detail-dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });

    const reset = dialog.getByTestId('fg-edit-reset');
    await expect(reset).toBeEnabled();
    await reset.click();

    const confirm = page.getByTestId('fg-confirm-dialog');
    await expect(confirm).toBeVisible({ timeout: 15000 });
    await confirm.getByTestId('fg-confirm-accept').click();

    await expect.poll(() => calls.deleted, { timeout: 15000 }).toBe(true);
  });

  test('non-admin (owner) is redirected away from /admin/features', async ({ page }) => {
    await setupGovernanceMocks(page);
    await authenticateAs(page, 'owner');

    await page.goto('http://localhost:5173/admin/features', {
      timeout: 90000,
      waitUntil: 'domcontentloaded',
    });

    // The registry route boundary redirects a non-admin to their own dashboard.
    // Assert the URL is no longer the admin governance route and the console
    // never renders for the owner.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 30000 })
      .not.toBe('/admin/features');
    await expect(page.getByTestId('feature-governance-console')).toHaveCount(0);
  });
});
