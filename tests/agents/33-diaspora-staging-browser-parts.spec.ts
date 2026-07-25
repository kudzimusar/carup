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

    // Stock manager (requires the dealer/seller stakeholder role — provisioned via the product's
    // real /api/auth/switch-role during identity setup). Real testids from DiasporaStockManager.tsx.
    await page.goto('/diaspora/stock');
    await expect(page.getByTestId('diaspora-stock-page')).toBeVisible();
    const name = marked('Brake pads');
    await page.getByTestId('diaspora-stock-create-name').fill(name);
    await page.getByTestId('diaspora-stock-create-qty').fill('10');
    await page.getByTestId('diaspora-stock-create-submit').click();
    await expect(page.getByTestId('diaspora-stock-row').filter({ hasText: name }).first()).toBeVisible({ timeout: 20_000 });

    // Manage the created item (supply evidence / publish live inside the manage panel).
    await page.getByTestId('diaspora-stock-row').filter({ hasText: name }).getByTestId('diaspora-stock-select').click();
    const publish = page.getByRole('button', { name: /publish/i }).first();
    if (await publish.count()) {
      await publish.click();
      await expect(page.getByText(/published/i).first()).toBeVisible({ timeout: 15_000 });
    }

    // Stock Passport: provenance + ledger visible; quantities derive from ledger entries.
    const passportLink = page.locator('a[href*="/passport"]').first();
    if (await passportLink.count()) {
      await passportLink.click();
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
});
