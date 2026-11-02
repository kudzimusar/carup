import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * OC-4E — browser proof of the converged surfaces, on localhost, with the API mocked at the browser
 * boundary (the backend side of the same journeys is proven through the shipped app in
 * backend/tests/oc4e-product-journeys.test.js). Run with playwright.oc4e-local.config.ts.
 *
 *   - Buyer: Gutu AI answers with deterministic safe guidance and SAYS why. An anonymous visitor is
 *     told a session is needed and sends none (OC-3E-W1: no paid inference without a session); a
 *     signed-in buyer sends the session and sees the answer without a fallback badge. Both POSTs go
 *     through the real CSRF flow — a mock that skips it proves nothing about the shipped client.
 *   - Owner: PartSentry's ledger badge is derived from the server's integrity projection only —
 *     "Ledger Verified" only when the chain is intact AND every signature verified, an amber
 *     "signatures unverified" for an intact unauthenticated chain, "Tampered" for a broken one, NO
 *     badge for an empty ledger, and "Verification unavailable" (never a fake verdict) when the
 *     verification call fails (OC-3B / OC-3B-R).
 */
const VIN = 'OC4EVIN0000000001';
const CSRF = 'oc4e-csrf-token';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-session-token, x-user-id, x-stakeholder-role, x-tenant-id, x-csrf-token',
};

type Recorded = { method: string; path: string; headers: Record<string, string>; body: string | null };
type Reply = { status?: number; json: unknown };

async function mockApi(page: Page, handlers: Array<[RegExp, (url: URL) => Reply]>): Promise<Recorded[]> {
  const recorded: Recorded[] = [];
  const all: Array<[RegExp, (url: URL) => Reply]> = [
    [/\/api\/security\/csrf-token$/, () => ({ json: { csrfToken: CSRF } })],
    ...handlers,
  ];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const url = new URL(request.url());
    recorded.push({ method: request.method(), path: url.pathname, headers: request.headers(), body: request.postData() });
    const match = all.find(([pattern]) => pattern.test(url.pathname));
    const reply = match ? match[1](url) : { json: {} };
    await route.fulfill({ status: reply.status ?? 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(reply.json) });
  });
  return recorded;
}

async function signIn(page: Page, user: { id: string; name: string; role: string }, token: string) {
  await page.goto('/');
  await page.evaluate(([u, t]) => {
    window.localStorage.setItem('carup_user', JSON.stringify(u));
    window.localStorage.setItem('carup_token', t);
  }, [user, token] as const);
}

/** An absence assertion is only meaningful once the response that could add the element has landed. */
async function staysAbsent(locator: Locator, ms = 750) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    expect(await locator.count()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test.describe('OC-4E converged journeys (browser)', () => {
  test('Buyer (anonymous): Gutu AI gives safe guidance and says a session is needed for AI', async ({ page }) => {
    const recorded = await mockApi(page, [
      [/\/api\/marketplace\/ai\/buyer-assistant$/, () => ({ json: {
        guidance: ['Use the verified inquiry flow before paying any deposit.'],
        ai_status: 'ai_unavailable', ai_available: false, ai_reason: 'sign_in_required',
      } })],
      [/\/api\/marketplace\/listings/, () => ({ json: { listings: [], total: 0 } })],
    ]);
    await page.goto('/');
    await page.getByTestId('home-communications').getByTestId('marketplace-ai-assistant-open').click();
    await page.getByTestId('marketplace-ai-assistant-ask').click();
    await expect(page.getByTestId('marketplace-ai-assistant-fallback')).toHaveText('Sign in for AI-assisted guidance — showing safe guidance');
    await expect(page.getByTestId('marketplace-ai-assistant-result')).toContainText('verified inquiry flow before paying any deposit');
    const ask = recorded.find((r) => r.method === 'POST' && r.path.endsWith('/marketplace/ai/buyer-assistant'));
    expect(ask, 'the drawer called the assistant route').toBeTruthy();
    expect(ask?.headers['x-csrf-token'], 'the POST went through the real CSRF flow').toBe(CSRF);
    expect(ask?.headers['x-session-token'], 'an anonymous visitor sends no session').toBeUndefined();
  });

  test('Buyer (signed in): the session is sent and an AI answer shows no fallback badge', async ({ page }) => {
    const recorded = await mockApi(page, [
      [/\/api\/marketplace\/ai\/buyer-assistant$/, () => ({ json: {
        guidance: ['A 2018 Toyota Corolla fits a USD 12,000 family budget; book an inspection first.'],
        ai_status: 'ai_answered', ai_available: true,
      } })],
      [/\/api\/marketplace\/listings/, () => ({ json: { listings: [], total: 0 } })],
    ]);
    await signIn(page, { id: 'buyer-1', name: 'Tendai Moyo', role: 'owner' }, 'oc4e-buyer-token');
    await page.goto('/');
    await page.getByTestId('home-communications').getByTestId('marketplace-ai-assistant-open').click();
    await page.getByTestId('marketplace-ai-assistant-ask').click();
    await expect(page.getByTestId('marketplace-ai-assistant-result')).toContainText('book an inspection first');
    await staysAbsent(page.getByTestId('marketplace-ai-assistant-fallback'));
    const ask = recorded.find((r) => r.method === 'POST' && r.path.endsWith('/marketplace/ai/buyer-assistant'));
    expect(ask?.headers['x-session-token'], 'a signed-in buyer sends the session').toBe('oc4e-buyer-token');
    expect(ask?.headers['x-csrf-token']).toBe(CSRF);
  });

  const LEDGER_CASES = [
    { label: 'verified + authenticated', projection: { vin: VIN, verified: true, count: 3, integrity: 'verified', authenticated: true }, badge: '🔒 Ledger Verified' },
    { label: 'intact but unauthenticated', projection: { vin: VIN, verified: true, count: 3, integrity: 'verified', authenticated: false }, badge: 'Hash chain intact — signatures unverified' },
    { label: 'broken', projection: { vin: VIN, verified: false, count: null, integrity: 'broken', failed_at_index: 1 }, badge: '⚠️ Tampered' },
  ] as const;

  for (const { label, projection, badge } of LEDGER_CASES) {
    test(`Owner: PartSentry shows the ${label} ledger state from the integrity projection alone`, async ({ page }) => {
      const recorded = await mockApi(page, [
        [/\/api\/vehicles\/me$/, () => ({ json: [{ vin: VIN, make: 'Toyota', model: 'Hilux', year: 2020, mileage: 60000, status: 'Available' }] })],
        [/\/verify-ledger$/, () => ({ json: { ...projection, verified_at: '2026-10-04T00:00:00.000Z' } })],
        [/\/api\/partsentry\//, () => ({ json: [] })],
      ]);
      await signIn(page, { id: 'owner-1', name: 'Rudo Chikore', role: 'owner' }, 'oc4e-owner-token');
      await page.goto('/dashboard/partsentry');
      await expect(page.getByTestId('parts-ledger-state')).toHaveText(badge);
      await expect(page.getByTestId('parts-ledger-state')).toHaveCount(1);
      expect(recorded.some((r) => r.path.endsWith(`/vehicles/${VIN}/verify-ledger`))).toBe(true);
    });
  }

  test('Owner: an EMPTY ledger shows no integrity badge at all', async ({ page }) => {
    await mockApi(page, [
      [/\/api\/vehicles\/me$/, () => ({ json: [{ vin: VIN, make: 'Toyota', model: 'Hilux', year: 2020, mileage: 60000, status: 'Available' }] })],
      [/\/verify-ledger$/, () => ({ json: { vin: VIN, verified: false, count: 0, integrity: 'empty', verified_at: '2026-10-04T00:00:00.000Z' } })],
      [/\/api\/partsentry\//, () => ({ json: [] })],
    ]);
    await signIn(page, { id: 'owner-1', name: 'Rudo Chikore', role: 'owner' }, 'oc4e-owner-token');
    const ledgerAnswered = page.waitForResponse((r) => r.url().endsWith(`/vehicles/${VIN}/verify-ledger`));
    await page.goto('/dashboard/partsentry');
    await ledgerAnswered;
    await expect(page.getByRole('button', { name: 'Toyota Hilux' })).toBeVisible();
    await expect(page.getByTestId('parts-ledger-empty')).toBeVisible();
    await staysAbsent(page.getByTestId('parts-ledger-state'));
    await staysAbsent(page.getByText('Verification unavailable'));
  });

  test('Owner: a failed verification says "Verification unavailable", never a verdict', async ({ page }) => {
    await mockApi(page, [
      [/\/api\/vehicles\/me$/, () => ({ json: [{ vin: VIN, make: 'Toyota', model: 'Hilux', year: 2020, mileage: 60000, status: 'Available' }] })],
      [/\/verify-ledger$/, () => ({ status: 503, json: { error: { message: 'Ledger verification unavailable', code: 'ledger_unavailable' } } })],
      [/\/api\/partsentry\//, () => ({ json: [] })],
    ]);
    await signIn(page, { id: 'owner-1', name: 'Rudo Chikore', role: 'owner' }, 'oc4e-owner-token');
    await page.goto('/dashboard/partsentry');
    await expect(page.getByText('Verification unavailable')).toBeVisible();
    await staysAbsent(page.getByTestId('parts-ledger-state'));
  });
});
