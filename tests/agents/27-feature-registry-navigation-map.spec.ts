import { test, expect } from '@playwright/test';

/**
 * Feature Registry & Navigation Map — E2E Tests
 *
 * Validates that the centralized feature registry correctly drives
 * navigation across all 7 roles: owner, dealer, mechanic, insurance,
 * government, admin, bank.
 */

test.describe('Feature Registry & Navigation Map', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-session-token, x-user-id, x-stakeholder-role, x-tenant-id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };

  /** Build a mock user for a given role */
  function mockUser(role: string) {
    return {
      id: `mock-${role}-id`,
      name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)}`,
      email: `${role}@carup.test`,
      role,
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100',
      active_tenant_id: role === 'dealer' ? 'tenant-dealer-1' : null,
    };
  }

  /** Intercept API calls and mock auth state for a given role */
  async function setupMocksForRole(page: any, role: string) {
    // CORS preflight
    await page.route('**/api/**', async (route: any) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: corsHeaders });
      }
      return route.fallback();
    });

    // Auth verify
    await page.route('**/api/auth/verify', async (route: any) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ user: mockUser(role), session: { token: 'mock-token' } }),
      });
    });

    // Nav coverage
    await page.route('**/api/marketplace/nav-coverage**', async (route: any) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ threshold: 3, categories: {}, tags: {}, governed_deferred: [] }),
      });
    });

    // Intercept image/favicon requests to prevent failures
    await page.route(/\.(png|jpg|jpeg|gif|svg|ico|webp)(\?.*)?$/, async (route: any) => {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(1) });
    });

    // Set auth state
    await page.addInitScript((mockRole: string) => {
      const user = {
        id: `mock-${mockRole}-id`,
        name: `Test ${mockRole.charAt(0).toUpperCase() + mockRole.slice(1)}`,
        email: `${mockRole}@carup.test`,
        role: mockRole,
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100',
        active_tenant_id: mockRole === 'dealer' ? 'tenant-dealer-1' : null,
      };
      localStorage.setItem('carup_session', JSON.stringify({ token: 'mock-token' }));
      localStorage.setItem('carup_token', 'mock-token');
      localStorage.setItem('carup_user', JSON.stringify(user));
    }, role);
  }

  // ─── Registry Integrity Tests ────────────────────────────────────────

  test.describe('Registry Integrity (unit-style via page evaluation)', () => {
    test('all 7 roles have dashboard sidebar items', async ({ page }) => {
      await setupMocksForRole(page, 'owner');
      await page.goto('http://localhost:5173/dashboard');
      await page.waitForLoadState('networkidle');

      // Evaluate the registry in the browser context
      const result = await page.evaluate(async () => {
        // @ts-ignore — dynamic import in browser context
        const { getDashboardItems, getAllRoles, getDashboardRoute } = await import('/src/config/featureRegistry.ts');
        const roles = getAllRoles();
        const roleItemCounts: Record<string, number> = {};
        const roleDashboardRoutes: Record<string, string> = {};

        for (const role of roles) {
          roleItemCounts[role] = getDashboardItems(role).length;
          roleDashboardRoutes[role] = getDashboardRoute(role);
        }

        return { roles, roleItemCounts, roleDashboardRoutes };
      });

      // All 7 roles must be present
      expect(result.roles).toHaveLength(7);
      expect(result.roles).toContain('owner');
      expect(result.roles).toContain('dealer');
      expect(result.roles).toContain('mechanic');
      expect(result.roles).toContain('insurance');
      expect(result.roles).toContain('government');
      expect(result.roles).toContain('admin');
      expect(result.roles).toContain('bank');

      // Each role has at least 1 sidebar item
      for (const role of result.roles) {
        expect(result.roleItemCounts[role]).toBeGreaterThan(0);
      }

      // Expected dashboard-sidebar item counts per role.
      // Reconciled 2026-07-04 by recomputing getDashboardItems(role).length against the MERGED
      // PR#90 registry: main's Trust OS cutover + Agent 8 Communications + Phase 7C Identity
      // Verification, ON TOP OF the full Diaspora Trade OS program surface (Trade Profile, Stock
      // Manager, Reverse RFQ, AI Command Center, Container Co-Loading, Drive, Subscription,
      // SafeTrade, Workbook consoles). Higher than the PR#81 base (owner 16 / admin 23) because
      // PR#90 registers the Phase 8/9/10 diaspora tools too. Always recompute from the live
      // registry, never hand-add.
      // Recomputed 2026-07-27 (Issue #127, UI-10): `diaspora.trade-graph` adds ONE dashboard_sidebar
      // entry for roles owner / dealer / admin / government, so those four counts each rise by 1;
      // mechanic, insurance and bank are unchanged.
      //
      // getDashboardItems() is the RAW registry selector — it deliberately does not filter by
      // lifecycle, so a flag-hidden entry still counts here. Nav VISIBILITY is a separate concern:
      // isHidden maps to lifecycle 'hidden', and isLifecycleVisible('hidden') is false, so the entry
      // does not appear in any navigation surface while VITE_DIASPORA_TRADE_GRAPH_UI_ENABLED is off.
      // (isLifecycleAccessible('hidden') is true, which is why the page renders its own explicit
      // unavailable state rather than 404ing.)
      // Recomputed 2026-07-28 (Issue #127, ST-3): `diaspora.safetrade-operations` adds ONE
      // dashboard_sidebar entry for roles admin / government, so those two rise by 1 again.
      // Recomputed 2026-07-28 (Issue #127, Deliverable B): `diaspora.workbook-import` adds ONE
      // dashboard_sidebar entry for roles admin / dealer.
      // Recomputed 2026-08-31 (V16 convergence): the Seller lane registers ONE new feature,
      // `owner.intelligence` ("Seller Intelligence", route /dashboard/intelligence), with
      // placements ['dashboard_sidebar', 'user_menu'], roles ['owner'] and lifecycle 'active'.
      // Owner therefore rises 20 -> 21 and NO other role moves. Verified against the joined
      // registry rather than hand-added: it is the only entry added versus main, and the registry
      // carries no duplicate feature id, so this is one new surface and not a second registration
      // of an existing one.
      // Recomputed 2026-09-03 (Operations Control Plane M6): Fraud Queue, Dealer
      // Compliance and Governance Review were REAL admin consoles with
      // placements: [] — reachable only by typing the URL. M6 restores their
      // dashboard_sidebar placement (admin 29 -> 32). The new Vehicle Operations
      // workspace registers with placements: [] on purpose (a parameterized
      // /admin/vehicles/:vin/review route cannot be a sidebar link) so it does
      // not move this count. No other role moves.
      expect(result.roleItemCounts['owner']).toBe(21);
      // Recomputed 2026-09-05 (Trade OS T2): `diaspora.buyer-requests` — the supplier's opportunity
      // marketplace — is a NEW sidebar destination registered with roles ['dealer', 'admin'], so it
      // moves BOTH of those counts (dealer 16 -> 17, admin 32 -> 33) and no others. The relabelled
      // `diaspora.reverse-rfq` ("Request Quotes") kept its id, roles and placement, so it moves none.
      expect(result.roleItemCounts['dealer']).toBe(17);
      expect(result.roleItemCounts['mechanic']).toBe(5);
      expect(result.roleItemCounts['insurance']).toBe(4);
      expect(result.roleItemCounts['government']).toBe(14);
      expect(result.roleItemCounts['admin']).toBe(33);
      expect(result.roleItemCounts['bank']).toBe(4);

      // Dashboard routes are valid
      expect(result.roleDashboardRoutes['owner']).toBe('/dashboard');
      expect(result.roleDashboardRoutes['dealer']).toBe('/dealer');
      expect(result.roleDashboardRoutes['mechanic']).toBe('/mechanic');
      expect(result.roleDashboardRoutes['insurance']).toBe('/insurance-dash');
      expect(result.roleDashboardRoutes['government']).toBe('/government');
      expect(result.roleDashboardRoutes['admin']).toBe('/admin');
      expect(result.roleDashboardRoutes['bank']).toBe('/bank');
    });

    test('canAccessFeature returns correct values', async ({ page }) => {
      await setupMocksForRole(page, 'owner');
      await page.goto('http://localhost:5173/dashboard');
      await page.waitForLoadState('networkidle');

      const result = await page.evaluate(async () => {
        // @ts-ignore
        const { canAccessFeature } = await import('/src/config/featureRegistry.ts');
        return {
          ownerCanGarage: canAccessFeature('owner.garage', 'owner'),
          dealerCanGarage: canAccessFeature('owner.garage', 'dealer'),
          adminCanEvidence: canAccessFeature('admin.evidence', 'admin'),
          bankCanRisk: canAccessFeature('bank.risk', 'bank'),
          ownerCanBankRisk: canAccessFeature('bank.risk', 'owner'),
          nonexistent: canAccessFeature('fake.feature', 'owner'),
        };
      });

      expect(result.ownerCanGarage).toBe(true);
      expect(result.dealerCanGarage).toBe(false);
      expect(result.adminCanEvidence).toBe(true);
      expect(result.bankCanRisk).toBe(true);
      expect(result.ownerCanBankRisk).toBe(false);
      expect(result.nonexistent).toBe(false);
    });
  });

  // ─── Owner Dashboard Sidebar ─────────────────────────────────────────

  test.describe('Owner Dashboard Sidebar', () => {
    test('renders all expected sidebar items', async ({ page }) => {
      await setupMocksForRole(page, 'owner');
      await page.goto('http://localhost:5173/dashboard');
      await page.waitForLoadState('networkidle');

      // Check specific testid-based items
      await expect(page.locator('[data-testid="nav-dashboard"]')).toBeVisible();
      await expect(page.locator('[data-testid="nav-garage"]')).toBeVisible();
      await expect(page.locator('[data-testid="nav-diaspora-imports"]')).toBeVisible();

      // Check key sidebar links exist by text
      const sidebar = page.locator('aside');
      await expect(sidebar.getByText('My Garage')).toBeVisible();
      await expect(sidebar.getByText('Evidence Vault')).toBeVisible();
      await expect(sidebar.getByText('Service History')).toBeVisible();
      await expect(sidebar.getByText('Gutu AI')).toBeVisible();
      await expect(sidebar.getByText('My Listings')).toBeVisible();
    });

    test('Evidence Vault shows Upload badge', async ({ page }) => {
      await setupMocksForRole(page, 'owner');
      await page.goto('http://localhost:5173/dashboard');
      await page.waitForLoadState('networkidle');

      const evidenceVault = page.locator('aside').getByText('Evidence Vault').locator('..');
      await expect(evidenceVault).toBeVisible();
      await expect(evidenceVault.getByText('Upload')).toBeVisible();
    });
  });

  // ─── Bank Role Consistency ───────────────────────────────────────────

  test.describe('Bank Role Consistency', () => {
    test('bank dashboard renders sidebar items', async ({ page }) => {
      await setupMocksForRole(page, 'bank');

      // Intercept any bank-specific API routes
      await page.route('**/api/**', async (route: any) => {
        if (route.request().method() === 'OPTIONS') {
          return route.fulfill({ status: 204, headers: corsHeaders });
        }
        if (route.request().url().includes('/api/auth/verify')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: corsHeaders,
            body: JSON.stringify({ user: mockUser('bank'), session: { token: 'mock-token' } }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ data: [] }),
        });
      });

      await page.goto('http://localhost:5173/bank');
      await page.waitForLoadState('networkidle');

      const sidebar = page.locator('aside');
      await expect(sidebar.getByText('Lending Queue')).toBeVisible();
      await expect(sidebar.getByText('Collateral Map')).toBeVisible();
      await expect(sidebar.getByText('Credit Risk Analysis')).toBeVisible();
    });

    test('bank role appears in Navbar role switcher', async ({ page }) => {
      await setupMocksForRole(page, 'owner');
      await page.goto('http://localhost:5173/marketplace');
      await page.waitForLoadState('networkidle');

      // Open user dropdown
      const userAvatar = page.locator('header button img[alt=""]').first();
      if (await userAvatar.isVisible()) {
        await userAvatar.click();

        // Look for the role switcher section
        const roleSwitcher = page.getByText('Switch Portal Role');
        if (await roleSwitcher.isVisible()) {
          // Bank should now appear as a role option
          await expect(page.getByText('Change to Banker')).toBeVisible();
        }
      }
    });
  });

  // ─── Dashboard Role Switcher ─────────────────────────────────────────

  test.describe('Dashboard Role Switcher', () => {
    test('role selector lists all 7 roles', async ({ page }) => {
      await setupMocksForRole(page, 'owner');
      await page.goto('http://localhost:5173/dashboard');
      await page.waitForLoadState('networkidle');

      // The sidebar should have a <select> with all role options
      const roleSelect = page.locator('aside select');
      await expect(roleSelect).toBeVisible();

      const options = roleSelect.locator('option');
      const count = await options.count();
      expect(count).toBe(7);

      // Verify each role label is present
      const optionTexts = await options.allTextContents();
      expect(optionTexts).toContain('Car Owner');
      expect(optionTexts).toContain('Dealer');
      expect(optionTexts).toContain('Mechanic');
      expect(optionTexts).toContain('Insurance');
      expect(optionTexts).toContain('Government');
      expect(optionTexts).toContain('Administrator');
      expect(optionTexts).toContain('Banker');
    });
  });

  test.describe('TASK 2 — dashboard sidebar honors effective visibility', () => {
    test('a disabled override removes the item from the sidebar (sidebar ⇄ direct access agree)', async ({ page }) => {
      await setupMocksForRole(page, 'owner');
      // Disable owner.garage via the effective-state hydration endpoint.
      await page.route('**/api/features/effective**', async (route: any) => {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({
            environment: 'staging',
            features: [{ featureId: 'owner.garage', state: 'disabled', enabled: false, visible: false, accessible: false, beta: false }],
          }),
        });
      });
      await page.goto('http://localhost:5173/dashboard', { timeout: 90_000, waitUntil: 'domcontentloaded' });
      // Overview remains; the disabled My Garage link is removed after hydration.
      await expect(page.getByTestId('nav-dashboard')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('nav-garage')).toHaveCount(0);
      // Direct access to the disabled route shows the unavailable state (agreement).
      await page.goto('http://localhost:5173/dashboard/garage', { timeout: 90_000, waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('feature-disabled-page')).toBeVisible({ timeout: 30_000 });
    });
  });
});
