import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Feature Registry & Navigation Map Phase 2 — E2E & Guard Alignment Tests
 */

test.describe('Feature Registry Phase 2 — Public Navigation & Access Guard', () => {
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
      active_tenant_id: role === 'dealer' ? 'tenant-dealer-1' : null,
    };
  }

  async function setupMocksForRole(page: any, role: string) {
    await page.route('**/api/**', async (route: any) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: corsHeaders });
      }
      return route.fallback();
    });

    await page.route('**/api/auth/verify', async (route: any) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ user: mockUser(role), session: { token: 'mock-token' } }),
      });
    });

    await page.route('**/api/marketplace/nav-coverage**', async (route: any) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ threshold: 3, categories: {}, tags: {}, governed_deferred: [] }),
      });
    });

    await page.route(/\.(png|jpg|jpeg|gif|svg|ico|webp)(\?.*)?$/, async (route: any) => {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(1) });
    });

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

  // ─── 1. Public UI Surfaces Tests ──────────────────────────────────────────

  test('Navbar primary public links render dynamically', async ({ page }) => {
    await setupMocksForRole(page, 'owner');
    await page.goto('http://localhost:5173/marketplace');
    await page.waitForLoadState('networkidle');

    // Dealers and Garages links should be rendered
    const primaryNav = page.locator('[data-testid="public-primary-nav"]');
    await expect(primaryNav.getByTestId('nav-dealers')).toBeVisible();
    await expect(primaryNav.getByTestId('nav-garages')).toBeVisible();
  });

  test('Navbar More menu dropdown renders', async ({ page }) => {
    await setupMocksForRole(page, 'owner');
    await page.goto('http://localhost:5173/marketplace');
    await page.waitForLoadState('networkidle');

    // Click More menu dropdown trigger
    const moreMenuTrigger = page.getByTestId('nav-more');
    await expect(moreMenuTrigger).toBeVisible();
    await moreMenuTrigger.click();

    // Verify dropdown content renders
    const dropdownMenu = page.getByTestId('nav-more-menu');
    await expect(dropdownMenu).toBeVisible();
    await expect(dropdownMenu.getByText('Insurance')).toBeVisible();
    await expect(dropdownMenu.getByText('Pricing')).toBeVisible();
    await expect(dropdownMenu.getByText('Diaspora Trade')).toBeVisible();
  });

  test('Footer renders dynamically and includes Banker', async ({ page }) => {
    await setupMocksForRole(page, 'owner');
    await page.goto('http://localhost:5173/marketplace');
    await page.waitForLoadState('networkidle');

    const footer = page.locator('footer');
    await expect(footer).toBeVisible();

    // Check categories
    await expect(footer.getByText('Product')).toBeVisible();
    await expect(footer.getByText('Company')).toBeVisible();
    await expect(footer.getByText('Resources')).toBeVisible();
    await expect(footer.getByText('Stakeholders')).toBeVisible();

    // Check Product links
    await expect(footer.locator('a[href="/marketplace"]')).toBeVisible();
    await expect(footer.locator('a[href="/search"]').first()).toBeVisible();
    await expect(footer.locator('a[href="/dealers"]')).toBeVisible();
    await expect(footer.locator('a[href="/garages"]')).toBeVisible();

    // Check Stakeholders links (including the newly added Banker)
    await expect(footer.locator('a[href="/dashboard"]')).toBeVisible();
    await expect(footer.locator('a[href="/dealer"]')).toBeVisible();
    await expect(footer.locator('a[href="/mechanic"]')).toBeVisible();
    await expect(footer.locator('a[href="/insurance-dash"]')).toBeVisible();
    await expect(footer.locator('a[href="/government"]')).toBeVisible();
    await expect(footer.locator('a[href="/bank"]')).toBeVisible();
  });

  // ─── 2. Access Guard Helpers Evaluation ───────────────────────────────────

  test('Access guard helpers return correct classifications', async ({ page }) => {
    await setupMocksForRole(page, 'owner');
    await page.goto('http://localhost:5173/dashboard');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      // @ts-ignore
      const {
        isPublicRoute,
        isProtectedRoute,
        getAllowedRolesForRoute,
        canRoleAccessRoute,
        getDefaultRouteForRole
      } = await import('/src/config/featureRegistry.ts');

      return {
        // Public Route classification
        homeIsPublic: isPublicRoute('/'),
        marketplaceIsPublic: isPublicRoute('/marketplace'),
        marketplaceDetailIsPublic: isPublicRoute('/marketplace/vin-123'),
        loginIsPublic: isPublicRoute('/login'),

        // Protected Route classification
        dashboardIsProtected: isProtectedRoute('/dashboard'),
        garageDetailIsProtected: isProtectedRoute('/dashboard/garage/vin-123'),
        dealerIsProtected: isProtectedRoute('/dealer'),
        bankIsProtected: isProtectedRoute('/bank'),

        // Allowed Roles
        ownerAllowedOnGarage: getAllowedRolesForRoute('/dashboard/garage'),
        bankAllowedOnRisk: getAllowedRolesForRoute('/bank/risk'),
        allAllowedOnPublic: getAllowedRolesForRoute('/marketplace'),

        // Role Access check
        ownerCanGarageDetail: canRoleAccessRoute('owner', '/dashboard/garage/vin-123'),
        dealerCanGarageDetail: canRoleAccessRoute('dealer', '/dashboard/garage/vin-123'),
        bankCanLending: canRoleAccessRoute('bank', '/bank/applications'),
        ownerCanLending: canRoleAccessRoute('owner', '/bank/applications'),

        // Default Route
        ownerDefaultRoute: getDefaultRouteForRole('owner'),
        bankDefaultRoute: getDefaultRouteForRole('bank'),
      };
    });

    // Classifications
    expect(result.homeIsPublic).toBe(true);
    expect(result.marketplaceIsPublic).toBe(true);
    expect(result.marketplaceDetailIsPublic).toBe(true);
    expect(result.loginIsPublic).toBe(true);

    expect(result.dashboardIsProtected).toBe(true);
    expect(result.garageDetailIsProtected).toBe(true);
    expect(result.dealerIsProtected).toBe(true);
    expect(result.bankIsProtected).toBe(true);

    // Allowed Roles
    expect(result.ownerAllowedOnGarage).toContain('owner');
    expect(result.ownerAllowedOnGarage).not.toContain('dealer');
    expect(result.bankAllowedOnRisk).toContain('bank');
    expect(result.bankAllowedOnRisk).not.toContain('owner');
    expect(result.allAllowedOnPublic).toContain('owner');
    expect(result.allAllowedOnPublic).toContain('bank');

    // Role Access checks
    expect(result.ownerCanGarageDetail).toBe(true);
    expect(result.dealerCanGarageDetail).toBe(false);
    expect(result.bankCanLending).toBe(true);
    expect(result.ownerCanLending).toBe(false);

    // Default routes
    expect(result.ownerDefaultRoute).toBe('/dashboard');
    expect(result.bankDefaultRoute).toBe('/bank');
  });

  // ─── 3. App.tsx Route Consistency Verification ──────────────────────────

  test('all registered routes exist in App.tsx', async ({ page }) => {
    // Read and extract path routes from App.tsx in Node.js context
    const appPath = path.resolve(process.cwd(), 'web/src/App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf-8');
    const routeRegex = /<Route\s+[^>]*path=["']([^"']+)["']/g;
    const declaredRoutes: string[] = [];
    let match;
    while ((match = routeRegex.exec(appContent)) !== null) {
      declaredRoutes.push(match[1]);
    }

    // Go to dashboard to load browser environment
    await setupMocksForRole(page, 'owner');
    await page.goto('http://localhost:5173/dashboard');
    await page.waitForLoadState('networkidle');

    // Compare with registry routes
    const result = await page.evaluate(async (appRoutes) => {
      const mod = await import('/src/config/featureRegistry.ts');
      const registryRoutes = mod.FEATURE_REGISTRY.filter((f: any) => !f.isPlanned && !f.isHidden).map((f: any) => f.route);
      const missingRoutes = registryRoutes.filter((r: string) => !appRoutes.includes(r));
      return { registryRoutes, missingRoutes };
    }, declaredRoutes);

    expect(result.missingRoutes).toEqual([]);
  });
});
