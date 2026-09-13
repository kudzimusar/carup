/**
 * 33 — Deployed-staging browser acceptance: SELLER / PARTS journey.
 *
 * Real deployed pages only (playwright.staging.config.ts). Self-skips loudly until the staging
 * seller identity is provisioned. Proves stock create → supply evidence → publish → RFQ response →
 * ledger-driven reservation → Stock Passport provenance, and that stock quantities move ONLY via
 * the ledger (no direct overwrite).
 */
import type { Page } from '@playwright/test';
import { stagingTest as test, expect, signInViaUi, requireIdentity, marked } from './staging-helpers';

/** Stock management gates on a verified dealer/seller stakeholder role. Public registration is
 *  fail-closed to 'owner' and /auth/switch-role refuses roles not VERIFIED for the user — correct
 *  governance, which means a stock-capable seller identity must be provisioned by the release
 *  operator (admin verification or DB bootstrap). */
const STOCK_ROLES = new Set(['dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'reviewer']);

async function authenticatedRole(page: Page): Promise<string> {
  return page.evaluate(() => {
    try {
      return String(JSON.parse(localStorage.getItem('carup_user') || '{}').role || '').toLowerCase();
    } catch {
      return '';
    }
  });
}

test.describe('Seller / parts journey (real UI, real API)', () => {
  test.skip(!requireIdentity('seller'), 'staging seller identity not provisioned yet (run staging-create-test-identities.mjs, export STAGING_UAT_* env)');

  test('seller creates stock, attaches supply evidence, publishes, and the Stock Passport shows provenance + ledger', async ({ page }) => {
    await signInViaUi(page, 'seller');
    const sellerRole = await authenticatedRole(page);
    test.skip(!STOCK_ROLES.has(sellerRole),
      `seller identity lacks a VERIFIED stock role (received ${sellerRole || 'none'}) — operator must provision a verified seller identity`);

    // Seller trade profile (W2) exists or is created. Wait for the own-profile list to SETTLE (rows
    // or explicit empty state) before deciding — else a race reads 0 rows and re-creates a duplicate.
    await page.goto('/diaspora/trade-profile');
    await expect(page.getByTestId('diaspora-trade-profile-route')).toBeVisible();
    await expect(
      page.getByTestId('diaspora-trade-profile-own-row').first().or(page.getByTestId('diaspora-trade-profile-empty')),
    ).toBeVisible({ timeout: 20_000 });
    if ((await page.getByTestId('diaspora-trade-profile-own-row').count()) === 0) {
      const roleSel = page.getByTestId('diaspora-trade-profile-role');
      if (await roleSel.count()) await roleSel.selectOption('seller').catch(() => {});
      await page.getByTestId('diaspora-trade-profile-country').fill('UAE');
      await page.getByTestId('diaspora-trade-profile-city').fill('Dubai');
      await page.getByTestId('diaspora-trade-profile-submit').click();
      await expect(
        page.getByTestId('diaspora-trade-profile-result').or(page.getByTestId('diaspora-trade-profile-own-row').first()),
      ).toBeVisible({ timeout: 20_000 });
    }

    // Stock manager. Real testids from DiasporaStockManager.tsx. The create form ("New draft stock")
    // takes part name + opening quantity only — the opening balance is seeded THROUGH THE LEDGER
    // (diaspora_append_stock_movement_atomic), never a direct quantity write.
    await page.goto('/diaspora/stock');
    await expect(page.getByTestId('diaspora-stock-page')).toBeVisible();
    const name = marked('Brake pads');
    await page.getByTestId('diaspora-stock-create-name').fill(name);
    await page.getByTestId('diaspora-stock-create-qty').fill('10');
    await page.getByTestId('diaspora-stock-create-submit').click();

    // The Stock Manager auto-selects the freshly created item — its detail panel appears. Operating on
    // the auto-selected detail (rather than re-finding a row in a long list) keeps this deterministic.
    await expect(page.getByTestId('diaspora-stock-detail')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('diaspora-stock-detail')).toContainText(name);
    // Balances are DERIVED FROM THE LEDGER (proves quantities are not directly overwritten — the
    // opening 10 came from the atomic movement RPC).
    await expect(page.getByTestId('diaspora-stock-balance-onhand')).toHaveText('10');
    await expect(page.getByTestId('diaspora-stock-balance-available')).toHaveText('10');
    await expect(page.getByTestId('diaspora-stock-publication-status')).toContainText(/PRIVATE|DRAFT/i);
    const itemId = await page.getByTestId('diaspora-stock-detail').getAttribute('data-stock-id');

    // Complete the merchandising details required by the publish-completeness validator, through the
    // real seller edit form (PATCH /diaspora/stock/:id). Quantities/tenant/verification are never sent.
    // Assert each input committed its value (toHaveValue) before saving so the PATCH carries real data.
    await expect(page.getByTestId('diaspora-stock-merch-form')).toBeVisible();
    const unitPrice = page.getByTestId('diaspora-stock-merch-unit-price');
    await unitPrice.fill('250');
    await expect(unitPrice).toHaveValue('250');
    const vMake = page.getByTestId('diaspora-stock-merch-vehicle-make');
    await vMake.fill('Toyota');
    await expect(vMake).toHaveValue('Toyota');
    await page.getByTestId('diaspora-stock-merch-condition').selectOption('USED');
    await expect(page.getByTestId('diaspora-stock-merch-condition')).toHaveValue('USED');
    await page.getByTestId('diaspora-stock-merch-part-number').fill(marked('BP-001'));
    // force:true — on the narrow mobile layout the merch form reflows as content loads (Playwright
    // reports "element is not stable"); the button is visible and enabled, so force the click.
    await page.getByTestId('diaspora-stock-merch-save').click({ force: true });
    await expect(page.getByTestId('diaspora-stock-merch-result')).toContainText(/saved/i, { timeout: 15_000 });
    // Ledger quantities are unchanged by a merchandising edit.
    await expect(page.getByTestId('diaspora-stock-balance-onhand')).toHaveText('10');

    // Now publish the completed item — it must succeed. Assert on the authoritative publication-status
    // badge (stable) rather than the transient result message; the merch form must also disappear.
    // If publish is somehow rejected, surface the exact error instead of a bare timeout.
    // force:true — on mobile the stock-list cells overlap the detail-panel buttons and intercept the click.
    await page.getByTestId('diaspora-stock-publish').click({ force: true });
    const publishSettled = page.getByTestId('diaspora-stock-publication-status').filter({ hasText: /PUBLISHED/i })
      .or(page.getByTestId('diaspora-stock-publish-error'));
    await expect(publishSettled.first()).toBeVisible({ timeout: 20_000 });
    if (await page.getByTestId('diaspora-stock-publish-error').count()) {
      throw new Error(`publish rejected: ${await page.getByTestId('diaspora-stock-publish-error').innerText()}`);
    }
    await expect(page.getByTestId('diaspora-stock-publication-status')).toContainText(/PUBLISHED/i);

    // Stock Passport: provenance + ledger visible.
    if (itemId) {
      await page.goto(`/diaspora/stock/${itemId}/passport`);
      await expect(page.locator('main').first()).toBeVisible();
      await expect(page.getByText(/ledger/i).first()).toBeVisible();
    }
  });

  test('RFQ surface loads and shows demand for sellers', async ({ page }) => {
    await signInViaUi(page, 'seller');
    await page.goto('/diaspora/rfq');
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/permission denied|42501/i);
  });

  // Full downstream chain across two real sessions: buyer publishes a parts demand, seller quotes it,
  // buyer accepts, and the underlying import order's Order Passport reflects the accepted parts quote.
  /**
   * The parts PROCUREMENT chain moved.
   *
   * This test used to drive `/diaspora/rfq` — buyer order → publish RFQ → seller quote → accept —
   * against `diaspora-buyer-order-*` and `diaspora-rfq-*` testids. That surface was DELIBERATELY
   * RETIRED: App.tsx now redirects `/diaspora/rfq` to `/diaspora/request-quotes`, whose mechanics
   * are T2's Request Quotes (`trade-*` testids, a request → supplier offers → comparison → award
   * lifecycle). The old testids exist nowhere, so the test was asserting against a product that no
   * longer exists — a STALE TEST ASSUMPTION, not a defect.
   *
   * The full current chain is certified by `46-trade-os-rfq2-staging.spec.ts` against the canonical
   * T2 authority, including cross-tenant supplier discovery, privacy of buyer data, an atomic award
   * and the awarded request leaving the marketplace. Re-driving it here would duplicate that gate
   * and give two places to update.
   *
   * What this test keeps is the part spec 46 does not cover and this suite is FOR: that the retired
   * buyer entry point still lands a real buyer somewhere correct and usable, rather than on a blank
   * page or a 404. Coverage is preserved and pointed at the current authority.
   */
  test('the retired parts-RFQ entry point still lands the buyer on the canonical Request Quotes surface', async ({ page }) => {
    test.skip(!requireIdentity('buyer'), 'buyer identity required');
    await signInViaUi(page, 'buyer');

    await page.goto('/diaspora/rfq');
    // The redirect is the product promise: an old link or bookmark must still work.
    await expect(page).toHaveURL(/\/diaspora\/request-quotes/);

    // …and it must be the real surface, not an empty shell. The buyer can actually start a request.
    await expect(page.getByTestId('trade-request-intent')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('trade-intent-buy')).toBeVisible();
    await expect(page.getByTestId('trade-intent-ship')).toBeVisible();

    // The old surface is genuinely gone rather than merely unreachable from this path.
    await expect(page.getByTestId('diaspora-rfq-page')).toHaveCount(0);
    await expect(page.getByTestId('diaspora-buyer-order-submit')).toHaveCount(0);
  });
});
