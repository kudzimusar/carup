/**
 * 34 — Deployed-staging browser acceptance: SECURITY & ISOLATION.
 *
 * Public isolation runs unauthenticated against the real deployed pages. Cross-tenant / role checks
 * self-skip until the corresponding staging identities exist. No mocks; direct API mutation attempts
 * use the REAL deployed API (they must be rejected by the server, proving the DB/service boundary).
 */
import { stagingTest as test, expect, signInViaUi, requireIdentity, API_URL, IDENTITIES } from './staging-helpers';

test.describe('Public users cannot access private Diaspora records', () => {
  test('unauthenticated /diaspora/imports redirects to login (no data leak)', async ({ page }) => {
    await page.goto('/diaspora/imports');
    await page.waitForURL(/\/login/);
    await expect(page.getByTestId('email-input')).toBeVisible();
  });

  test('unauthenticated admin consoles are inaccessible', async ({ page }) => {
    for (const path of ['/admin/diaspora/compliance', '/admin/diaspora/workbooks']) {
      await page.goto(path);
      // The SPA may redirect to /login OR keep the URL while rendering no console (route-guarded or
      // unknown route). The security property: no admin console content is reachable anonymously.
      const redirected = /\/login/.test(page.url());
      if (!redirected) {
        await expect(page.getByTestId('diaspora-compliance-console').or(page.getByTestId('diaspora-workbook-console'))).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(/compliance review queue|workbook batches/i);
      }
    }
  });

  test('anonymous direct API reads of private diaspora records are denied', async ({ request }) => {
    const probes = ['/diaspora/import-orders', '/diaspora/trade-profiles/me', '/diaspora/stock'];
    for (const p of probes) {
      const res = await request.get(`${API_URL}${p}`);
      // 401/403 = denied; 404 = route absent (stale build) — acceptable ONLY with no record payload.
      expect([401, 403, 404], `${p} must deny anonymous access, got ${res.status()}`).toContain(res.status());
      const body = await res.text();
      expect(body, `${p} must not leak record data`).not.toMatch(/import_order_id|tenant_id|buyer_id|stock_items/);
    }
  });
});

test.describe('Cross-tenant and role isolation (authenticated)', () => {
  test.skip(!requireIdentity('buyer') || !requireIdentity('outsider'), 'staging identities not provisioned yet');

  test('URL id substitution does not reveal another tenant\'s order or passport', async ({ page }) => {
    // Buyer creates/finds an order id…
    await signInViaUi(page, 'buyer');
    await page.goto('/diaspora/imports');
    // Wait for the async list to SETTLE (rows or explicit empty state) before branching.
    await expect(
      page.getByTestId('diaspora-import-row').first().or(page.getByTestId('diaspora-import-list-empty')),
    ).toBeVisible({ timeout: 20_000 });
    const row = page.getByTestId('diaspora-import-row').first();
    test.skip((await row.count()) === 0, 'no buyer order available yet (run spec 32 first)');
    await row.click();
    const orderId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;
    await page.context().clearCookies();

    // …outsider substitutes the id directly.
    await signInViaUi(page, 'outsider');
    await page.goto(`/diaspora/imports/${orderId}`);
    await expect(page.getByTestId('diaspora-import-detail-error').or(page.getByText(/not found|access|denied/i)).first()).toBeVisible();
    await page.goto(`/diaspora/imports/${orderId}/passport`);
    await expect(page.getByText(/not found|access|denied|unable/i).first()).toBeVisible();
  });

  test('buyer cannot perform reviewer actions (UI hidden AND API denies)', async ({ page, request }) => {
    await signInViaUi(page, 'buyer');
    await page.goto('/diaspora/trade-profile');
    await expect(page.getByTestId('diaspora-trade-profile-review-console')).toHaveCount(0);

    const token = await page.evaluate(() => localStorage.getItem('carup_token'));
    const user = JSON.parse(await page.evaluate(() => localStorage.getItem('carup_user') || '{}'));
    // Direct API attempt to verify a profile (reviewer-only) must be denied by the SERVER.
    const res = await request.post(`${API_URL}/diaspora/trade-profiles/00000000-0000-0000-0000-000000000000/verify`, {
      headers: { 'x-session-token': token || '', 'x-user-id': user.id || '', 'x-stakeholder-role': 'reviewer', 'content-type': 'application/json' },
      data: {},
    });
    expect([401, 403, 404]).toContain(res.status());
    expect(res.status(), 'spoofed x-stakeholder-role must not grant reviewer power').not.toBe(200);
  });

  test('outsider sees an empty imports list (no cross-tenant rows)', async ({ page }) => {
    await signInViaUi(page, 'outsider');
    await page.goto('/diaspora/imports');
    // Wait for the loaded empty state explicitly — a still-loading list also has 0 rows.
    await expect(page.getByTestId('diaspora-import-list-empty')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('diaspora-import-row')).toHaveCount(0);
  });
});

test.describe('Flag-gated surfaces report a stated outcome, whichever way the flag is set', () => {
  test('SafeTrade renders EITHER its unavailable notice OR the real surface — never a blank page', async ({ page }) => {
    test.skip(!requireIdentity('buyer'), 'staging identities not provisioned yet');
    await signInViaUi(page, 'buyer');
    await page.goto('/diaspora/safetrade');

    // This test used to assert the unavailable notice unconditionally, while its name said "with
    // flags off" — but it never CHECKED the flag, it assumed it. That made it a test of one
    // deployment's configuration rather than of the product's behaviour, and it failed the moment
    // Issue #127's Phase 8 turned VITE_DIASPORA_SAFETRADE_UI_ENABLED on in order to exercise
    // SafeTrade at all. Two specs cannot both be right about a flag that has one value.
    //
    // The invariant that holds in BOTH configurations, and the one actually worth protecting, is
    // that the page states its outcome: off -> it says so; on -> it renders the real surface, its
    // loaded-empty state, or a stated error. What must never happen is a blank page, a permanent
    // spinner, or a fabricated surface that implies data the flag has not enabled.
    const unavailable = page.getByTestId('safetrade-unavailable');
    const listPage = page.getByTestId('safetrade-list-page');
    const empty = page.getByTestId('safetrade-list-empty');
    const errored = page.getByTestId('safetrade-list-error');

    await expect(unavailable.or(listPage).or(empty).or(errored).first()).toBeVisible({ timeout: 20_000 });

    // Whichever branch rendered, it must have SETTLED. A surface stuck loading is the failure a
    // deployed check exists to catch and is invisible to a local unit test.
    await expect(page.getByTestId('safetrade-list-loading')).toHaveCount(0, { timeout: 25_000 });

    // And the two branches are mutually exclusive: "unavailable" alongside a rendered list would
    // mean the gate is decorative.
    if (await unavailable.isVisible()) {
      await expect(listPage).toHaveCount(0);
    }
    void IDENTITIES;
  });
});
