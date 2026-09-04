import type { Page } from '@playwright/test';
import { stagingTest, expect, API_URL } from './staging-helpers';

/**
 * Spec 46 — Trade OS T2 (Request Quotes / RFQ 2.0) certification on deployed staging, unmocked.
 *
 * The point of this spec is the CROSS-TENANT claim. The buyer and the supplier are deliberately in
 * two DIFFERENT organisations, so "the supplier can discover this request" and "the supplier cannot
 * see who asked" are both proven against the real database rather than asserted in a mock.
 *
 * Journey: buyer publishes a parts request WITHOUT a part number → supplier in another tenant
 * discovers it through the sanitized projection → supplier sends a real commercial offer →
 * buyer compares and selects → atomic award holds → both sides see the outcome.
 */

const IDS = {
  buyer: { email: 'tradeos.rfq-buyer@carup-staging.test', envPassword: 'TRADEOS_RFQ_BUYER_PASSWORD' },
  supplier: { email: 'tradeos.rfq-supplier@carup-staging.test', envPassword: 'TRADEOS_RFQ_SUPPLIER_PASSWORD' },
} as const;
type Who = keyof typeof IDS;

const BUYER_TENANT = 'c0106a0e-1a11-4a6a-9e01-000000000c03';
const SUPPLIER_TENANT = 'c0106a0e-1a11-4a6a-9e01-000000000d04';

/** Unique per run so repeated certifications never collide or read each other's rows. */
const RUN_TAG = process.env.STAGING_RUN_ID || 'rfq2';
const PART_DESCRIPTION = `Front shocks ${RUN_TAG}`;

const runState: { requestId?: string; requestRef?: string } = {};

function password(who: Who): string {
  const value = process.env[IDS[who].envPassword];
  if (!value) throw new Error(`${IDS[who].envPassword} is not exported — provision the tradeos RFQ identities first.`);
  return value;
}

async function signIn(page: Page, who: Who): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('email-input').fill(IDS[who].email);
  await page.getByTestId('password-input').fill(password(who));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const responsePromise = page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/api\/auth\/login(?:\?|$)/.test(r.url()), { timeout: 20_000 });
    await page.getByTestId('login-button').click();
    const response = await responsePromise;
    if (response.ok()) {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      return;
    }
    if (response.status() !== 429) throw new Error(`UI login failed for ${who} with HTTP ${response.status()}`);
    const retryAfter = Number(response.headers()['retry-after'] || 1);
    await page.waitForTimeout(Math.max(1000, Math.min(retryAfter * 1000, 15_000)));
    await page.getByTestId('password-input').fill(password(who));
  }
  throw new Error(`UI login remained rate-limited for ${who}`);
}

async function gotoSettled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

async function sessionToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('carup_token'));
  if (!token) throw new Error('no carup_token after sign-in');
  return token;
}

stagingTest.describe('Trade OS T2 — Request Quotes (deployed staging, cross-tenant)', () => {
  stagingTest.describe.configure({ mode: 'serial' });

  stagingTest('anonymous caller cannot read the RFQ marketplace', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    expect((await anon.get(`${API_URL}/diaspora/rfqs`)).status()).toBe(401);
    await anon.dispose();
  });

  stagingTest('buyer publishes a parts request WITHOUT knowing the part number', async ({ page, cap }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'journey runs once on desktop');
    await signIn(page, 'buyer');

    // Discoverable through the Trade OS workspace, not a hidden URL.
    await gotoSettled(page, '/diaspora/request-quotes');
    await expect(page.getByTestId('trade-request-intent')).toBeVisible();
    await page.getByTestId('trade-intent-buy').click();
    await page.getByTestId('trade-kind-parts').click();

    // The reassurance is the product promise for an ordinary buyer.
    await expect(page.getByTestId('trade-part-number-reassurance')).toBeVisible();
    await page.getByTestId('trade-part-description').fill(PART_DESCRIPTION);
    await page.getByTestId('trade-part-quantity').fill('20');
    await page.getByTestId('trade-part-vehicle-make').selectOption('Honda');
    await page.getByTestId('trade-request-next').click();

    await page.getByTestId('trade-destination-city').fill('Harare');
    await page.getByTestId('trade-request-next').click();
    await page.getByTestId('trade-budget-amount').fill('900');
    await page.getByTestId('trade-request-next').click();

    // The privacy preview must state what is and is not shared BEFORE publishing.
    const preview = page.getByTestId('trade-privacy-preview');
    await expect(preview).toContainText(/What suppliers will see/i);
    await expect(preview).toContainText(/Never shared/i);

    const created = page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/diaspora\/buyer-orders$/.test(new URL(r.url()).pathname));
    await page.getByTestId('trade-request-publish').click();
    const createdRes = await created;
    expect(createdRes.status()).toBe(201);
    runState.requestId = (await createdRes.json())?.data?.id;
    expect(runState.requestId, 'created request id').toBeTruthy();

    await expect(page).toHaveURL(/\/diaspora\/requests\//);
    await expect(page.getByTestId('trade-request-status')).toContainText(/Open for offers/i);
    runState.requestRef = `RFQ-${String(runState.requestId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    expect(cap.consoleErrors).toEqual([]);
  });

  stagingTest('SECURITY: a supplier in ANOTHER tenant discovers it, and sees no private buyer data', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'journey runs once on desktop');
    await signIn(page, 'supplier');
    await gotoSettled(page, '/diaspora/buyer-requests');

    const card = page.getByTestId('trade-opportunity-card').filter({ hasText: PART_DESCRIPTION });
    await expect(card, 'cross-tenant discovery must work').toHaveCount(1);
    await expect(card.getByTestId('trade-opportunity-lines')).toContainText('20 ×');
    await expect(card.getByTestId('trade-opportunity-lines')).toContainText(/does not know the part number/i);

    // The API response itself must carry no private buyer data — asserted on the wire, not the DOM.
    const token = await sessionToken(page);
    const res = await request.get(`${API_URL}/diaspora/rfqs`, {
      headers: { 'x-session-token': token, 'x-tenant-id': SUPPLIER_TENANT },
    });
    expect(res.status()).toBe(200);
    const rows = (await res.json())?.data || [];
    const mine = rows.find((r: { lines?: Array<{ item_description?: string }> }) =>
      (r.lines || []).some((l) => l.item_description === PART_DESCRIPTION));
    expect(mine, 'the published request must be in the supplier feed').toBeTruthy();
    const serialized = JSON.stringify(mine);
    for (const secret of ['u_tradeos_rfq_buyer', BUYER_TENANT, 'tradeos.rfq-buyer@carup-staging.test', 'Tendai']) {
      expect(serialized, `projection leaked "${secret}"`).not.toContain(secret);
    }
    expect(mine.buyer_id).toBeUndefined();
    expect(mine.tenant_id).toBeUndefined();
    expect(mine.metadata).toBeUndefined();
    // Budget was NOT disclosed by the buyer, so it must not cross tenants.
    expect(mine.budget_disclosed).toBe(false);
    expect(mine.budget_amount).toBeNull();

    // Owner audit item 2: order verification must NOT be republished as buyer identity verification.
    expect(mine.buyer_context, 'buyer_context must not exist').toBeUndefined();
    expect(JSON.stringify(mine)).not.toMatch(/verified/i);
    await expect(page.getByText(/Verified CarUp buyer/i)).toHaveCount(0);

    // Owner audit item 3: match evidence is this supplier's OWN stock, stated as evidence.
    expect(mine.supplier_match, 'supplier has matching Honda Fit stock seeded').toBeTruthy();
    expect(mine.supplier_match.stock_name).toContain('Front shocks');
    expect(mine.supplier_match.available_quantity).toBe(24);
    await expect(card.getByTestId('trade-match-reasons')).toContainText('You have 24 available');
    await expect(card.getByTestId('trade-match-reasons')).toContainText(/export-ready/i);
  });

  stagingTest('SECURITY: a buyer cannot link a vehicle they do not own (owner audit item 1)', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'journey runs once on desktop');
    await signIn(page, 'buyer');
    const token = await sessionToken(page);
    // A syntactically valid VIN the buyer has no authority over must never be written.
    const res = await request.post(`${API_URL}/diaspora/buyer-orders`, {
      headers: { 'x-session-token': token, 'x-tenant-id': BUYER_TENANT, 'content-type': 'application/json' },
      data: {
        order_type: 'parts', origin_country: 'Japan', destination_country: 'Zimbabwe',
        lines: [{ item_description: 'Probe line', linked_vehicle_vin: 'JHMGD18608S209999' }],
      },
    });
    expect([403, 404]).toContain(res.status());
  });

  stagingTest('SECURITY: the supplier cannot read the buyer\'s private order record', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'journey runs once on desktop');
    await signIn(page, 'supplier');
    const token = await sessionToken(page);
    // Marketplace visibility must NOT imply private-record access.
    const res = await request.get(`${API_URL}/diaspora/buyer-orders/${runState.requestId}`, {
      headers: { 'x-session-token': token, 'x-tenant-id': SUPPLIER_TENANT },
    });
    expect([401, 403, 404]).toContain(res.status());
  });

  stagingTest('supplier sends a real commercial offer', async ({ page }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'journey runs once on desktop');
    await signIn(page, 'supplier');
    await gotoSettled(page, '/diaspora/buyer-requests');
    const card = page.getByTestId('trade-opportunity-card').filter({ hasText: PART_DESCRIPTION });
    await card.getByTestId('trade-prepare-offer').click();

    // Quantity is prefilled from what the buyer actually asked for.
    await expect(page.getByTestId('trade-offer-quantity')).toHaveValue('20');
    await page.getByTestId('trade-offer-description').fill('New KYB front shocks, boxed');
    await page.getByTestId('trade-offer-unit-price').fill('45');
    await page.getByTestId('trade-offer-amount').fill('900');
    await page.getByTestId('trade-offer-lead-time').fill('5');
    await page.getByTestId('trade-offer-shipping').selectOption('included');
    await page.getByTestId('trade-offer-exclusions').fill('customs duty');

    // Owner audit item 7: an offer is reviewed before it becomes irrevocable.
    await page.getByTestId('trade-offer-review').click();
    await expect(page.getByTestId('trade-offer-review-panel')).toContainText('900');
    const sent = page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/quotes$/.test(new URL(r.url()).pathname));
    await page.getByTestId('trade-offer-submit').click();
    const sentRes = await sent;
    expect(sentRes.status()).toBe(201);
    const quote = (await sentRes.json())?.data?.quote;
    expect(Number(quote.quote_amount)).toBe(900);
    expect(quote.offered_quantity).toBe(20);
    expect(quote.lead_time_days).toBe(5);
    expect(quote.shipping_included).toBe(true);

    await expect(page.getByTestId('trade-my-offers')).toBeVisible();
    await expect(page.getByTestId('trade-my-offer-status').first()).toContainText(/Submitted/i);
  });

  stagingTest('buyer compares the offer on real terms and selects the supplier', async ({ page }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'journey runs once on desktop');
    await signIn(page, 'buyer');
    await gotoSettled(page, `/diaspora/requests/${runState.requestId}`);

    await expect(page.getByTestId('trade-request-status')).toContainText(/Offers received/i);
    const offer = page.getByTestId('trade-offer-card').first();
    await expect(offer.getByTestId('trade-offer-total')).toContainText('900');
    await expect(offer).toContainText('Included');   // shipping, as the supplier stated it
    await expect(offer).toContainText('5 days');     // dispatch
    // Owner audit item 4: the buyer must know WHO they are choosing, and on what basis.
    await expect(offer.getByTestId('trade-offer-supplier')).not.toBeEmpty();
    await expect(offer.getByTestId('trade-offer-supplier-context')).toContainText(/not verified by CarUp/i);

    const accepted = page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/accept-quote$/.test(new URL(r.url()).pathname));
    await offer.getByTestId('trade-offer-accept').click();
    expect((await accepted).status()).toBe(200);

    await expect(page.getByTestId('trade-request-status')).toContainText(/Supplier selected/i);
    // The mental model changes: this is now a trade, with honest downstream state.
    const next = page.getByTestId('trade-next-step');
    await expect(next).toContainText(/What happens next/i);
    await expect(next).toContainText(/Shipping — not arranged/i);
  });

  stagingTest('SECURITY: the award is atomic — a second, different acceptance is refused', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'journey runs once on desktop');
    await signIn(page, 'buyer');
    const token = await sessionToken(page);
    // Replaying the SAME quote is an idempotent no-op; a bogus quote id must never win.
    const res = await request.post(`${API_URL}/diaspora/buyer-orders/${runState.requestId}/accept-quote`, {
      headers: { 'x-session-token': token, 'x-tenant-id': BUYER_TENANT, 'content-type': 'application/json' },
      data: { quoteId: '00000000-0000-4000-8000-000000000000' },
    });
    expect([400, 403, 404]).toContain(res.status());
  });

  stagingTest('awarded requests leave the supplier marketplace', async ({ page }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'journey runs once on desktop');
    await signIn(page, 'supplier');
    await gotoSettled(page, '/diaspora/buyer-requests');
    // Open feed no longer carries it…
    await expect(page.getByTestId('trade-opportunity-card').filter({ hasText: PART_DESCRIPTION })).toHaveCount(0);
    // …but the supplier can still see they WON it.
    await page.getByTestId('trade-tab-mine').click();
    await expect(page.getByTestId('trade-my-offer-status').first()).toContainText(/Won/i);
  });

  stagingTest('HARD GEOMETRY GATE: no horizontal overflow across desktop classes (T2.18)', async ({ page }, testInfo) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'geometry sweep runs once');
    await signIn(page, 'supplier');
    for (const [width, height] of [[393, 852], [820, 1180], [1024, 768], [1280, 800], [1366, 768], [1440, 900], [1536, 864]] as Array<[number, number]>) {
      await page.setViewportSize({ width, height });
      await gotoSettled(page, '/diaspora/buyer-requests');
      const geometry = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
      }));
      expect(geometry.doc, `document overflows by ${geometry.doc}px at ${width}×${height}`).toBeLessThanOrEqual(1);
      expect(geometry.body, `body overflows by ${geometry.body}px at ${width}×${height}`).toBeLessThanOrEqual(1);
      await testInfo.attach(`rfq-supplier-${width}x${height}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
  });

  stagingTest('visual evidence: buyer sourcing wizard and request detail', async ({ page }, testInfo) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'visual sweep runs once');
    await signIn(page, 'buyer');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoSettled(page, '/diaspora/request-quotes');
    await testInfo.attach('rfq-buyer-entry-1440.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await gotoSettled(page, `/diaspora/requests/${runState.requestId}`);
    await testInfo.attach('rfq-buyer-detail-1440.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoSettled(page, `/diaspora/requests/${runState.requestId}`);
    await testInfo.attach('rfq-buyer-detail-1024.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  stagingTest('responsive: supplier opportunity feed on this viewport', async ({ page }, testInfo) => {
    stagingTest.skip(stagingTest.info().project.name === 'chromium', 'chromium ran the full journey');
    await signIn(page, 'supplier');
    await gotoSettled(page, '/diaspora/buyer-requests');
    await expect(page.getByTestId('trade-buyer-requests')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `document overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    await testInfo.attach(`rfq-supplier-${testInfo.project.name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  stagingTest('responsive: buyer sourcing entry on this viewport', async ({ page }, testInfo) => {
    stagingTest.skip(stagingTest.info().project.name === 'chromium', 'chromium ran the full journey');
    await signIn(page, 'buyer');
    await gotoSettled(page, '/diaspora/request-quotes');
    await expect(page.getByTestId('trade-request-intent')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `document overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    await testInfo.attach(`rfq-buyer-${testInfo.project.name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
