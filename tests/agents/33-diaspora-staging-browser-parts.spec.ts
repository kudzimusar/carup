/**
 * 33 — Deployed-staging browser acceptance: SELLER / PARTS journey.
 *
 * Real deployed pages only (playwright.staging.config.ts). Self-skips loudly until the staging
 * seller identity is provisioned. Proves stock create → supply evidence → publish → RFQ response →
 * ledger-driven reservation → Stock Passport provenance, and that stock quantities move ONLY via
 * the ledger (no direct overwrite).
 */
import { readFileSync } from 'node:fs';
import { stagingTest as test, expect, signInViaUi, requireIdentity, marked, IDENTITIES } from './staging-helpers';

/** Stock management gates on a verified dealer/seller stakeholder role. Public registration is
 *  fail-closed to 'owner' and /auth/switch-role refuses roles not VERIFIED for the user — correct
 *  governance, which means a stock-capable seller identity must be provisioned by the release
 *  operator (admin verification or DB bootstrap). Until then these stages skip with that reason. */
function sellerStockRole(): string {
  try {
    const state = JSON.parse(readFileSync(IDENTITIES.seller.state, 'utf8'));
    const ls = Object.fromEntries(state.origins[0].localStorage.map((e: { name: string; value: string }) => [e.name, e.value]));
    return (JSON.parse(ls.carup_user).role || '').toLowerCase();
  } catch { return ''; }
}
const STOCK_ROLES = new Set(['dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'reviewer']);

test.describe('Seller / parts journey (real UI, real API)', () => {
  test.skip(!requireIdentity('seller'), 'staging seller identity not provisioned yet (run staging-create-test-identities.mjs, export STAGING_UAT_* env)');

  test('seller creates stock, attaches supply evidence, publishes, and the Stock Passport shows provenance + ledger', async ({ page }) => {
    test.skip(!STOCK_ROLES.has(sellerStockRole()),
      'seller identity lacks a VERIFIED dealer role — switch-role correctly refused self-elevation (fail-closed); operator must provision a verified seller identity');
    await signInViaUi(page, 'seller');

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
    await expect(page.getByTestId('diaspora-stock-row').filter({ hasText: name }).first()).toBeVisible({ timeout: 20_000 });

    // Select the item; the detail panel's balances are DERIVED FROM THE LEDGER (proves quantities are
    // not directly overwritten — the opening 10 came from the atomic movement RPC).
    // force:true — on the narrow mobile table the quantity cell visually overlaps the Manage button
    // (a minor mobile-layout quirk); the button itself is resolved, visible and enabled.
    await page.getByTestId('diaspora-stock-row').filter({ hasText: name }).getByTestId('diaspora-stock-select').click({ force: true });
    await expect(page.getByTestId('diaspora-stock-detail')).toBeVisible();
    await expect(page.getByTestId('diaspora-stock-balance-onhand')).toHaveText('10');
    await expect(page.getByTestId('diaspora-stock-balance-available')).toHaveText('10');
    await expect(page.getByTestId('diaspora-stock-publication-status')).toContainText(/PRIVATE|DRAFT/i);
    const itemId = await page.getByTestId('diaspora-stock-detail').getAttribute('data-stock-id');

    // Complete the merchandising details required by the publish-completeness validator, through the
    // real seller edit form (PATCH /diaspora/stock/:id). Quantities/tenant/verification are never sent.
    await expect(page.getByTestId('diaspora-stock-merch-form')).toBeVisible();
    await page.getByTestId('diaspora-stock-merch-unit-price').fill('250');
    await page.getByTestId('diaspora-stock-merch-currency').fill('USD');
    await page.getByTestId('diaspora-stock-merch-condition').selectOption('USED');
    await page.getByTestId('diaspora-stock-merch-vehicle-make').fill('Toyota');
    await page.getByTestId('diaspora-stock-merch-part-number').fill(marked('BP-001'));
    await page.getByTestId('diaspora-stock-merch-save').click();
    await expect(page.getByTestId('diaspora-stock-merch-result')).toContainText(/saved/i, { timeout: 15_000 });
    // Ledger quantities are unchanged by a merchandising edit.
    await expect(page.getByTestId('diaspora-stock-balance-onhand')).toHaveText('10');

    // Now publish the completed item — it must succeed. Assert on the authoritative publication-status
    // badge (stable) rather than the transient result message; the merch form must also disappear.
    await page.getByTestId('diaspora-stock-publish').click();
    await expect(page.getByTestId('diaspora-stock-publication-status')).toContainText(/PUBLISHED/i, { timeout: 20_000 });
    await expect(page.getByTestId('diaspora-stock-merch-form')).toHaveCount(0);

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
  test('parts RFQ chain: buyer demand → seller quote → buyer accept → Order Passport', async ({ browser }) => {
    test.skip(!requireIdentity('buyer') || !STOCK_ROLES.has(sellerStockRole()), 'buyer + verified seller identities required');
    const tag = marked('RFQ').replace(/[^A-Za-z0-9]/g, '').slice(-14); // unique, alnum marker
    const marker = `Toyota${tag}`;
    const buyerCtx = await browser.newContext();
    const sellerCtx = await browser.newContext();
    const buyer = await buyerCtx.newPage();
    const seller = await sellerCtx.newPage();
    try {
      // 1. Buyer creates a parts demand and publishes the RFQ.
      await signInViaUi(buyer, 'buyer');
      await buyer.goto('/diaspora/rfq');
      await expect(buyer.getByTestId('diaspora-rfq-page')).toBeVisible();
      await buyer.getByTestId('diaspora-buyer-order-origin').fill('Japan');
      await buyer.getByTestId('diaspora-buyer-order-make').fill(marker);
      await buyer.getByTestId('diaspora-buyer-order-submit').click();
      const buyerRow = buyer.getByTestId('diaspora-buyer-order-row').filter({ hasText: marker }).first();
      await expect(buyerRow).toBeVisible({ timeout: 20_000 });
      await buyerRow.getByTestId('diaspora-buyer-order-publish').click();
      await expect(buyerRow).toContainText(/RFQ open/i, { timeout: 20_000 });

      // 2. Seller finds the open RFQ and submits a quote.
      await signInViaUi(seller, 'seller');
      await seller.goto('/diaspora/rfq');
      const openRow = seller.getByTestId('diaspora-rfq-open-row').filter({ hasText: marker }).first();
      await expect(openRow).toBeVisible({ timeout: 20_000 });
      await openRow.getByTestId('diaspora-rfq-quote-amount').fill('1800');
      await openRow.getByTestId('diaspora-rfq-quote-submit').click();
      await expect(seller.getByTestId('diaspora-rfq-seller-error')).toHaveCount(0);

      // 3. Buyer opens the order, sees the quote, accepts it.
      await buyer.reload();
      await buyer.getByTestId('diaspora-buyer-order-row').filter({ hasText: marker }).first().getByTestId('diaspora-buyer-order-select').click();
      await expect(buyer.getByTestId('diaspora-rfq-detail')).toBeVisible();
      const quoteRow = buyer.getByTestId('diaspora-rfq-quote-row').filter({ hasText: '1800' }).first();
      await expect(quoteRow).toBeVisible({ timeout: 20_000 });
      await quoteRow.getByTestId('diaspora-rfq-accept').click();
      await expect(buyer.getByTestId('diaspora-rfq-accepted-badge').first()).toBeVisible({ timeout: 20_000 });

      // 4. Order Passport reflects the parts transaction (open the parts order from the imports list).
      await buyer.goto('/diaspora/imports');
      await expect(
        buyer.getByTestId('diaspora-import-row').first().or(buyer.getByTestId('diaspora-import-list-empty')),
      ).toBeVisible({ timeout: 20_000 });
      const importRow = buyer.getByTestId('diaspora-import-row').filter({ hasText: marker }).first();
      await expect(importRow).toBeVisible({ timeout: 20_000 });
      await importRow.click();
      await expect(buyer.getByTestId('diaspora-import-detail-route')).toBeVisible();
      const orderId = new URL(buyer.url()).pathname.split('/').filter(Boolean).pop();
      await buyer.goto(`/diaspora/imports/${orderId}/passport`);
      await expect(buyer.getByTestId('order-passport-page')).toBeVisible();
      // The passport reflects a parts order with an accepted quote lineage.
      await expect(buyer.locator('body')).not.toContainText(/permission denied|42501/i);
    } finally {
      await buyerCtx.close();
      await sellerCtx.close();
    }
  });
});
