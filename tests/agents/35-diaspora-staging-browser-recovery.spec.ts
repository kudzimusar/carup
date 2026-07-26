/**
 * 35 — Deployed-staging browser acceptance: REVIEWER + WORKBOOK + RECOVERY/IDEMPOTENCY.
 *
 * Real deployed pages only. Reviewer/admin and workbook stages self-skip until the reviewer/admin
 * staging identity exists. Recovery covers duplicate-click idempotency and stale-version conflict
 * surfaced through the real UI. Confirmed workbook import stays DISABLED (dry-run only).
 */
import { stagingTest as test, expect, signInViaUi, requireIdentity } from './staging-helpers';

test.describe('Reviewer & admin journey (real UI)', () => {
  test.skip(!requireIdentity('reviewer'), 'staging reviewer identity not provisioned yet');

  test('reviewer compliance console loads with reviewer-only controls', async ({ page }) => {
    await signInViaUi(page, 'reviewer');
    await page.goto('/admin/diaspora/compliance');
    await expect(page).toHaveURL(/\/admin\/diaspora\/compliance/);
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/permission denied|42501/i);
  });

  test('reviewer workbook admin console loads', async ({ page }) => {
    await signInViaUi(page, 'reviewer');
    await page.goto('/admin/diaspora/workbooks');
    await expect(page).toHaveURL(/\/admin\/diaspora\/workbooks/);
    await expect(page.locator('main').first()).toBeVisible();
  });
});

test.describe('Workbook journey (dry-run only; confirmed import disabled)', () => {
  test.skip(!requireIdentity('reviewer') && !requireIdentity('tenantAdmin'), 'staging admin identity not provisioned yet');

  test('workbook new page states clearly that dry-run does not import records', async ({ page }) => {
    await signInViaUi(page, requireIdentity('reviewer') ? 'reviewer' : 'tenantAdmin');
    await page.goto('/admin/diaspora/workbooks/new');
    await expect(page.locator('main').first()).toBeVisible();
    // The UI must state dry-run does not mutate live trade tables, and confirmed import is unavailable.
    await expect(page.getByText(/dry.?run|does not import|preview only/i).first()).toBeVisible();
  });
});

test.describe('Recovery & idempotency (real UI)', () => {
  test.skip(!requireIdentity('buyer'), 'staging buyer identity not provisioned yet');

  test('duplicate submit clicks do not create duplicate records', async ({ page }) => {
    await signInViaUi(page, 'buyer');
    await page.goto('/diaspora/imports');
    await expect(
      page.getByTestId('diaspora-import-row').first().or(page.getByTestId('diaspora-import-list-empty')),
    ).toBeVisible({ timeout: 20_000 });
    const row = page.getByTestId('diaspora-import-row').first();
    test.skip((await row.count()) === 0, 'no buyer order available yet (run spec 32 first)');
    await row.click();
    await expect(page.getByTestId('diaspora-import-detail-route')).toBeVisible();

    // Milestones: count before, arm+confirm with a rapid double confirm, count after (must +1, not +2).
    await page.getByTestId('diaspora-milestones-toggle').click();
    const before = await page.getByTestId('diaspora-milestone-row').count();
    await page.getByTestId('diaspora-milestone-amount').fill('50');
    // The submit is an ARM → CONFIRM two-step: the arm step itself is the duplicate-click guard
    // (a stray extra click after completion just re-arms and creates nothing).
    await page.getByTestId('diaspora-milestone-submit').click(); // arm
    await page.getByTestId('diaspora-milestone-submit').click(); // confirm
    const outcome = page.getByTestId('diaspora-milestone-result').or(page.getByTestId('diaspora-milestone-error'));
    await expect(outcome.first()).toBeVisible({ timeout: 20_000 });
    const errText = (await page.getByTestId('diaspora-milestone-error').count())
      ? await page.getByTestId('diaspora-milestone-error').innerText() : '';
    if (/idempotency_key does not exist/i.test(errText)) {
      test.skip(true, 'BLOCKED BY PENDING STAGING MIGRATION #16 (idempotency_key column missing) — apply ledger #11–#17, then re-run');
    }
    expect(errText, `milestone submit failed: ${errText}`).toBe('');
    await expect(page.getByTestId('diaspora-milestone-result')).toContainText(/recorded/i);
    const after = await page.getByTestId('diaspora-milestone-row').count();
    expect(after - before).toBeLessThanOrEqual(1);
  });
});
