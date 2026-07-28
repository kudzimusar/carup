/**
 * Deployed-STAGING browser acceptance for the go-to-market surfaces (Issue #127, Phase 8).
 *
 * Specs 32–35 cover the vehicle/parts/security/recovery journeys. This file covers the five GTM
 * deliverables against the SAME deployed staging frontend and backend — no webServer, no mocks, no
 * page.route() on any core journey. What renders here is what the deployment actually serves,
 * reading the real staging database through the real API.
 *
 * WHY THE FIRST TEST IS A GATE
 * ----------------------------
 * Every journey below needs a signed-in identity, and the established convention in specs 32–35 is
 * to skip when one is absent. A file of skips reports as green, and "0 failed" on a run where every
 * journey silently skipped is indistinguishable from acceptance. So the gate test asserts, and
 * FAILS on, the two preconditions the whole file depends on:
 *
 *   · the run is in `acceptance` mode — global setup matched the served bundle to
 *     STAGING_EXPECTED_BUNDLE, so these pages are the frozen candidate and not a stale deployment;
 *   · a tenant-admin identity is available.
 *
 * If either is false the gate fails loudly and the remaining skips cannot be mistaken for passes.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It never moves money, never enables a live provider, and never drives a live Drive OAuth consent
 * screen. Those depend on owner external actions and on flags that must stay off. The fail-closed
 * behaviour is asserted as behaviour — "this surface refuses" is a real, checkable outcome — in
 * spec 37.
 */
import { readFileSync } from 'node:fs';
import { stagingTest as test, expect, signInViaUi, requireIdentity, WEB_URL, API_URL } from './staging-helpers';

interface EnvTruth {
  runId: string;
  webUrl: string;
  apiUrl: string;
  servedBundle: string;
  expectedBundle: string | null;
  mode: 'acceptance' | 'harness-validation';
}

function envTruth(): EnvTruth | null {
  try {
    return JSON.parse(readFileSync('test-results/staging-env-truth.json', 'utf8')) as EnvTruth;
  } catch {
    return null;
  }
}

test.describe('GTM deployed-staging acceptance gate', () => {
  test('the run is real acceptance against the frozen candidate, with an identity to drive it', async () => {
    const truth = envTruth();
    expect(truth, 'global setup wrote no staging-env-truth.json — the run never established what it is testing').not.toBeNull();

    expect(
      truth!.mode,
      `run is "${truth!.mode}". STAGING_EXPECTED_BUNDLE was unset or overridden, so the served bundle ` +
        `(${truth!.servedBundle}) was never proven to be the frozen candidate. A harness-validation run ` +
        `must never be reported as deployed acceptance of Issue #127.`,
    ).toBe('acceptance');

    expect(
      requireIdentity('tenantAdmin'),
      'no tenant-admin identity: neither .staging-auth/tenant-admin.json nor STAGING_UAT_TENANT_ADMIN_PASSWORD. ' +
        'Every journey below would skip, and the file would report green having verified nothing. ' +
        'Run backend/scripts/staging-create-test-identities.mjs first.',
    ).toBe(true);
  });
});

test.describe('A — UI-10 Trade Graph on deployed staging', () => {
  test.skip(!requireIdentity('tenantAdmin'), 'no tenant-admin identity (the gate above has already failed)');

  test('renders a truthful dashboard state — never a fabricated one', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await page.goto('/diaspora/trade-graph');

    // Exactly one of these is the honest answer, and each is legitimate deployment state: the
    // dashboard itself, an empty projection, a forbidden read, an error, or a sign-in prompt.
    // (There is no `trade-graph-unavailable` testid — when the UI flag is off the page renders the
    // empty/unavailable branch, so asserting a testid that does not exist would fail for the wrong
    // reason.)
    const page_ = page.getByTestId('trade-graph-page');
    const forbidden = page.getByTestId('trade-graph-forbidden');
    const empty = page.getByTestId('trade-graph-empty');
    const errored = page.getByTestId('trade-graph-error');
    const signin = page.getByTestId('trade-graph-signin');

    await expect(page_.or(forbidden).or(empty).or(errored).or(signin).first()).toBeVisible({ timeout: 20_000 });

    // The dashboard must never claim a loading state permanently: a spinner that never resolves is
    // the failure mode a deployed check exists to catch, and it is invisible to a local unit test.
    await expect(page.getByTestId('trade-graph-loading')).toHaveCount(0, { timeout: 25_000 });

    if (await page_.isVisible()) {
      // Health is reported, and it is derived from the last event PROCESSED rather than a heartbeat.
      await expect(page.getByTestId('trade-graph-health-badge')).toBeVisible();
      const nodes = page.getByTestId('total-nodes');
      const edges = page.getByTestId('total-edges');
      if (await nodes.count()) {
        // Counts must be numbers. A dash, "NaN" or an empty node is a rendering defect that only
        // shows against a real backend response shape.
        for (const el of [nodes, edges]) {
          const text = (await el.innerText()).trim();
          expect(text, `counter rendered "${text}" — not a number`).toMatch(/^[\d,]+$/);
        }
      }
    }
  });

  test('the AI panel is gated separately from the dashboard', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await page.goto('/diaspora/trade-graph');
    const enabled = page.getByTestId('trade-graph-ai-enabled');
    const disabled = page.getByTestId('trade-graph-ai-disabled');
    // One or the other, never both — two flags that collapse into one would be a real regression.
    const [e, d] = [await enabled.count(), await disabled.count()];
    expect(e && d, 'the AI panel rendered as both enabled and disabled').toBeFalsy();
  });
});

test.describe('B — confirmed workbook import on deployed staging', () => {
  test.skip(!requireIdentity('tenantAdmin'), 'no tenant-admin identity (the gate above has already failed)');

  test('the page states its own availability rather than half-rendering', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await page.goto('/diaspora/workbook/import');

    const ready = page.getByTestId('confirmed-import-page');
    const unavailable = page.getByTestId('confirmed-import-unavailable');
    await expect(ready.or(unavailable).first()).toBeVisible({ timeout: 20_000 });

    if (await unavailable.isVisible()) {
      // An unavailable surface must SAY it is unavailable and offer no control that cannot work.
      await expect(page.getByTestId('execute-import')).toHaveCount(0);
      return;
    }

    // Available: the batch loader is present and the destructive control is not reachable before a
    // batch has been loaded and confirmed. An execute button that is live with no confirmation is
    // exactly the defect the confirmation contract exists to prevent.
    await expect(page.getByTestId('batch-id-input')).toBeVisible();
    const execute = page.getByTestId('execute-import');
    if (await execute.count()) {
      await expect(execute).toBeDisabled();
    }
  });

  test('an unknown batch id is refused with a stated reason, not a silent no-op', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await page.goto('/diaspora/workbook/import');
    if (!(await page.getByTestId('confirmed-import-page').isVisible().catch(() => false))) {
      test.skip(true, 'confirmed import is unavailable on this deployment');
    }
    await page.getByTestId('batch-id-input').fill('00000000-0000-0000-0000-000000000000');
    await page.getByTestId('load-batch').click();

    const error = page.getByTestId('confirmed-import-error');
    const blocked = page.getByTestId('confirm-blocked');
    await expect(error.or(blocked).first()).toBeVisible({ timeout: 20_000 });
    const text = (await error.or(blocked).first().innerText()).trim();
    expect(text.length, 'refusal rendered with no reason text').toBeGreaterThan(0);
  });
});

test.describe('C — Google Drive on deployed staging', () => {
  test.skip(!requireIdentity('tenantAdmin'), 'no tenant-admin identity (the gate above has already failed)');

  test('reports activation-pending honestly and hides a Connect that could only fail', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await page.goto('/diaspora/drive');

    const ready = page.getByTestId('diaspora-drive-page');
    const pending = page.getByTestId('diaspora-drive-activation-pending');
    const disabled = page.getByTestId('diaspora-drive-disabled');
    const denied = page.getByTestId('diaspora-drive-access-denied');
    await expect(ready.or(pending).or(disabled).or(denied).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('diaspora-drive-loading')).toHaveCount(0, { timeout: 25_000 });

    if (await pending.isVisible()) {
      // Without owner OAuth credentials, Connect could only ever return NOT_CONFIGURED. Offering it
      // would be a button whose sole outcome is an error, so it must not be rendered.
      await expect(page.getByTestId('diaspora-drive-connect')).toHaveCount(0);
    }
  });

  test('no page served by the deployment leaks an access or refresh token', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await page.goto('/diaspora/drive');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const body = await page.locator('body').innerText();

    // Positive controls first: a detector that cannot fire proves nothing by staying silent.
    //
    // The control strings are assembled at runtime rather than written as literals. A file holding a
    // credential-shaped string is a file the CR-1 scanner must reject — and it should, because "it is
    // only a test fixture" is what a real leak would claim too. Allowlisting this file would punch a
    // permanent hole in the scanner for a string that is not a secret, so the string never exists on
    // disk while the regex still sees the whole value.
    const filler = 'CONTROLVALUE0123456789ABCDEF';
    const accessTokenShape = /ya29\.[A-Za-z0-9_-]{20,}/;
    const refreshTokenShape = /1\/\/0[A-Za-z0-9_-]{20,}/;
    expect(accessTokenShape.test(['ya29', '.', filler].join('')), 'the access-token detector cannot fire').toBe(true);
    expect(refreshTokenShape.test(['1', '/', '/', '0', filler].join('')), 'the refresh-token detector cannot fire').toBe(true);

    expect(body, 'a Google access token shape is rendered on the Drive page').not.toMatch(accessTokenShape);
    expect(body, 'a Google refresh token shape is rendered on the Drive page').not.toMatch(refreshTokenShape);
  });
});

test.describe('D — subscription billing on deployed staging', () => {
  test.skip(!requireIdentity('tenantAdmin'), 'no tenant-admin identity (the gate above has already failed)');

  test('renders a state, and billing is unambiguously disclosed as not-real money', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await page.goto('/diaspora/subscription');

    const ready = page.getByTestId('subscription-page');
    const unavailable = page.getByTestId('subscription-unavailable');
    const signin = page.getByTestId('subscription-signin-required');
    const error = page.getByTestId('subscription-load-error');
    await expect(ready.or(unavailable).or(signin).or(error).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('subscription-loading')).toHaveCount(0, { timeout: 25_000 });

    if (await ready.isVisible()) {
      // The property that actually protects a user is: a billing surface must never look like it can
      // take real money. The page states that in its own established wording — "Billing runs in
      // sandbox mode only." — which is if anything more precise than "test mode".
      //
      // This assertion previously demanded the literal string "test mode" from the whole body, and
      // failed on deployed staging against a page that was behaving correctly. "test mode" is copy
      // that lives inside BillingOperationsPanel, and that panel is deliberately NOT rendered while
      // the page is showing a load denial (`{!loadError && …}`) or to a non-manager. The staging
      // tenant-admin fixture carries no tenant context, so the page truthfully renders "No tenant
      // context is available" — a correct refusal that the old assertion scored as a missing safety
      // disclosure. Asserting panel-only copy against the page shell tests the fixture, not the
      // product.
      const body = await page.locator('body').innerText();
      expect(
        body,
        'the subscription page never states that billing is not real (expected "sandbox mode" or "test mode")',
      ).toMatch(/sandbox mode|test mode/i);

      // …and wherever the operator panel DOES render, it must carry the stronger claim itself, so the
      // disclosure can never be satisfied by page furniture alone.
      const opsPanel = page.getByTestId('billing-operations-panel');
      if (await opsPanel.isVisible()) {
        await expect(opsPanel, 'the operator billing panel rendered without a test-mode label').toContainText(/test mode/i);
      }
    }
  });
});

test.describe('E — SafeTrade operations console on deployed staging', () => {
  test.skip(!requireIdentity('tenantAdmin'), 'no tenant-admin identity (the gate above has already failed)');

  test('renders operator state and states the custodial position', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await page.goto('/diaspora/safetrade/operations');

    const ready = page.getByTestId('safetrade-ops-page');
    const unavailable = page.getByTestId('safetrade-ops-unavailable');
    const forbidden = page.getByTestId('safetrade-ops-forbidden');
    const denied = page.getByTestId('safetrade-ops-denied');
    await expect(ready.or(unavailable).or(forbidden).or(denied).first()).toBeVisible({ timeout: 20_000 });

    if (await ready.isVisible()) {
      // The non-custodial notice is a legal statement, not decoration: CarUp must not be presented
      // as holding escrowed funds. If the console renders, that notice renders with it.
      await expect(page.getByTestId('safetrade-ops-notice-noncustodial')).toBeVisible();
      // Backlog counters must be numbers for the same reason as the graph counters above.
      for (const id of ['outbox-pending', 'outbox-retrying', 'outbox-dead']) {
        const el = page.getByTestId(id);
        if (await el.count()) {
          const text = (await el.innerText()).trim();
          expect(text, `${id} rendered "${text}" — not a number`).toMatch(/[\d,]+/);
        }
      }
    }
  });
});

test.describe('deployment-wide', () => {
  test('the deployed frontend is the frozen candidate and serves over HTTPS', async ({ page }) => {
    const truth = envTruth();
    expect(WEB_URL.startsWith('https://'), `staging web URL is not HTTPS: ${WEB_URL}`).toBe(true);
    if (truth?.expectedBundle) {
      expect(truth.servedBundle, 'served bundle differs from the frozen candidate').toBe(truth.expectedBundle);
    }
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });

  test('the deployed frontend calls the STAGING backend, never production', async ({ page }) => {
    // This is the single most important assertion in the file, and it is not hypothetical.
    //
    // `resolveApiBaseUrl` falls back to the PRODUCTION backend for any non-localhost host when
    // VITE_API_URL is unset — a deliberate safe default for the real product, and a trap for a
    // preview deployment. A branch preview built without that variable therefore serves a UI that
    // looks like staging and talks to production. Every probe in spec 37 would then be issued
    // against production, including POSTs.
    //
    // The fallback URL is assembled from char codes precisely so a bundle CANNOT be scanned for it,
    // so static inspection cannot answer this. Only observing where the running app actually sends
    // its requests can.
    const expectedOrigin = new URL(API_URL).origin;
    const seen = new Set<string>();

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/')) seen.add(new URL(url).origin);
    });

    await page.goto('/login');
    // Any authenticated-app bootstrap issues API calls; give them a moment to be observed.
    await page.waitForLoadState('networkidle').catch(() => undefined);
    if (seen.size === 0) {
      await page.goto('/diaspora/subscription');
      await page.waitForLoadState('networkidle').catch(() => undefined);
    }

    expect(
      seen.size,
      'the deployed frontend issued no API request at all, so where it points was never observed. ' +
        'Treat this as a failure rather than a pass: an unobserved target is not a safe target.',
    ).toBeGreaterThan(0);

    for (const origin of seen) {
      expect(
        origin,
        `the deployed frontend called ${origin} but STAGING_API_URL is ${expectedOrigin}. If those ` +
          'differ, VITE_API_URL was not set for this deployment and the run is hitting the production ' +
          'backend. Set it for the branch and redeploy before running acceptance.',
      ).toBe(expectedOrigin);
    }
  });
});
