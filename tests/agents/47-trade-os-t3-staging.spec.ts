import type { Page } from '@playwright/test';
import { stagingTest, expect, API_URL } from './staging-helpers';

/**
 * Spec 47 — Trade OS T3 (Logistics RFQ / "Ship something") certification on deployed staging.
 *
 * The claim under test is that T3 is a DIFFERENT product from T2 procurement, and that its truth
 * boundaries survive a real database rather than a mock:
 *
 *   - a requester who already owns cargo publishes a shipping request without freight knowledge;
 *   - a qualified logistics provider in another organisation discovers it through the SAFE
 *     projection and never learns who asked;
 *   - the provider sends a transparent offer with its charge components stated separately;
 *   - the requester sees WHO the offer is from, compares it, and awards atomically;
 *   - and the award creates NO container reservation, because a quote is not a booking.
 *
 * Provider eligibility here is deliberately NOT a platform role: the fixture is an ordinary
 * `owner` account whose registration profile says `logistics_provider`. If that ever silently
 * became a role grant, this spec still passes for the wrong reason — so the backend suite pins the
 * eligibility rule separately.
 */

const IDS = {
  requester: { email: process.env.TRADEOS_T3_REQUESTER_EMAIL || '', envPassword: 'TRADEOS_T3_REQUESTER_PASSWORD' },
  provider: { email: process.env.TRADEOS_T3_PROVIDER_EMAIL || '', envPassword: 'TRADEOS_T3_PROVIDER_PASSWORD' },
} as const;
type Who = keyof typeof IDS;

/** Unique per run so repeated certifications never collide or read each other's rows. */
const RUN_TAG = process.env.STAGING_RUN_ID || 't3';

/**
 * A sailing operated by a DIFFERENT organisation. Overridable so the spec is not welded to one
 * staging fixture. It must be a real, open sailing the provider does not operate — a fabricated id
 * would be refused as not-found, which proves nothing about authorization.
 */
const FOREIGN_CONTAINER_ID = process.env.TRADEOS_T3_FOREIGN_CONTAINER_ID
  || 'bbbb2222-cccc-4ddd-8eee-999900002222';

/** The volume the conversion test reserves; capacity must move by exactly this, and only on approval. */
const RESERVED_CBM = 3;

/**
 * The dedicated conversion sailing's total capacity, which is UNIQUE across staging's sailings so
 * the spec can identify its own card. Taking `.first()` silently read a different operator's
 * container and compared it against itself — the before/after assertions passed while measuring
 * nothing. A test that reads the wrong row and still goes green is worse than one that fails.
 */
const FIXTURE_TOTAL_CBM = Number(process.env.TRADEOS_T3_FIXTURE_TOTAL_CBM || 47);

/** The sailing the provider attaches. Pinned by id for the same reason as the card above. */
const FIXTURE_CONTAINER_ID = process.env.TRADEOS_T3_CONTAINER_ID
  || 'aaaa1111-bbbb-4ccc-8ddd-999900001111';
const CARGO = `SYNTHETIC T3 ${RUN_TAG} household cartons`;

function password(who: Who): string {
  const value = process.env[IDS[who].envPassword];
  if (!value) throw new Error(`${IDS[who].envPassword} is not exported — provision the T3 identities first.`);
  return value;
}

function provisioned(): boolean {
  return Boolean(IDS.requester.email && IDS.provider.email
    && process.env[IDS.requester.envPassword] && process.env[IDS.provider.envPassword]);
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
      return;
    }
    if (response.status() !== 429) throw new Error(`UI login failed for ${who} with HTTP ${response.status()}`);
    const retryAfter = Number(response.headers()['retry-after'] || 1);
    await page.waitForTimeout(Math.max(1000, Math.min(retryAfter * 1000, 15_000)));
    await page.getByTestId('password-input').fill(password(who));
  }
  throw new Error(`UI login remained rate-limited for ${who}`);
}

/** Sign out completely so the next actor is a genuinely separate session, not a leaked one. */
async function switchActor(page: Page, who: Who): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear()).catch(() => undefined);
  await signIn(page, who);
}

/**
 * Call the deployed API as the signed-in user, exactly the way the app does: identity headers from
 * localStorage plus a CSRF token bound to that identity, with credentials. Used for the assertions
 * that are about what the SERVER refuses — those must not be made through a UI that simply never
 * offers the option, or they prove nothing.
 */
async function apiAs(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(async ({ api, method, path, body }) => {
    const user = JSON.parse(window.localStorage.getItem('carup_user') || '{}')
    const token = window.localStorage.getItem('carup_token') || ''
    const auth: Record<string, string> = { 'x-user-id': user.id || '', 'x-session-token': token }
    // CSRF is bound to the identity, so it must be fetched with the SAME headers the mutation uses.
    const csrfRes = await fetch(`${api}/security/csrf-token`, { credentials: 'include', headers: auth })
    const { csrfToken } = await csrfRes.json()
    const res = await fetch(`${api}${path}`, {
      method,
      credentials: 'include',
      headers: { ...auth, 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let payload: unknown = null
    try { payload = await res.json() } catch { payload = null }
    return { status: res.status, body: payload, api, sentUserId: auth['x-user-id'] }
  }, { api: API_URL, method, path, body })
}

/** The conversion fixture's own card, identified by its unique total capacity. */
function fixtureCard(page: Page) {
  return page.getByTestId('diaspora-container-card')
    .filter({ hasText: new RegExp(`/\\s*${FIXTURE_TOTAL_CBM}\\s*CBM`) })
}

/** Read the fixture container's stated capacity straight off the operator surface. */
async function capacityFromCard(page: Page): Promise<{ used: number; available: number }> {
  const card = fixtureCard(page)
  await expect(card, `no sailing card with a ${FIXTURE_TOTAL_CBM} CBM total`).toHaveCount(1)
  const text = await card.innerText()
  const m = text.match(/Used\s+([\d.]+)\s*\/\s*([\d.]+)\s*CBM\s*·\s*available\s+([\d.]+)/i)
  if (!m) throw new Error(`could not read capacity from card: ${text}`)
  expect(Number(m[2]), 'read the wrong sailing card').toBe(FIXTURE_TOTAL_CBM)
  return { used: Number(m[1]), available: Number(m[3]) }
}

stagingTest.describe('Trade OS T3 — Shipping requests (deployed staging, unmocked)', () => {
  stagingTest.skip(!provisioned(),
    'T3 staging identities are not provisioned (TRADEOS_T3_{REQUESTER,PROVIDER}_{EMAIL,PASSWORD}).');

  stagingTest('requester publishes, provider offers safely, requester awards — and nothing is booked', async ({ page }) => {
    stagingTest.setTimeout(300_000);

    // ── Requester: describe cargo without knowing CBM, then publish ────────
    await signIn(page, 'requester');
    await page.goto('/diaspora/containers?view=mine');
    await expect(page.getByTestId('trade-shipping-workspace')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: /New shipping request/i }).click();
    await page.getByTestId('logistics-cargo-description').fill(CARGO);
    await page.locator('[data-testid="logistics-request-wizard"] input[type="number"]').first().fill('14');
    await page.getByRole('button', { name: /^Continue/i }).click();

    // Guided measurement: the person supplies a box size, CarUp computes the volume.
    await page.getByLabel(/Help me calculate it/i).check();
    const nums = page.locator('[data-testid="logistics-request-wizard"] input[type="number"]');
    await nums.nth(0).fill('60');
    await nums.nth(1).fill('45');
    await nums.nth(2).fill('40');
    await page.getByRole('button', { name: /^Continue/i }).click();   // → Route
    await page.getByRole('button', { name: /^Continue/i }).click();   // → Review
    await page.getByRole('button', { name: /Publish shipping request/i }).click();

    const detail = page.getByTestId('logistics-request-detail');
    await expect(detail).toBeVisible({ timeout: 60_000 });
    await expect(detail).toContainText(/Waiting for offers/i);
    const reference = (await detail.innerText()).match(/SHIP-[A-Z0-9]+/)?.[0];
    expect(reference, 'a published request must carry a reference').toBeTruthy();

    // ── Provider: safe discovery, then a transparent offer ────────────────
    await switchActor(page, 'provider');
    await page.goto('/diaspora/containers?view=provider');
    await expect(page.getByTestId('logistics-provider-workspace')).toBeVisible({ timeout: 60_000 });

    const card = page.getByTestId('logistics-opportunity').filter({ hasText: CARGO });
    await expect(card).toBeVisible({ timeout: 60_000 });

    // The whole point of the projection: the cargo crosses, the requester does not.
    const cardText = await card.innerText();
    expect(cardText, 'provider must not see the requester email').not.toContain(IDS.requester.email);
    expect(cardText, 'provider must not see the requester name').not.toContain('Requester');

    await card.getByRole('button', { name: /Prepare offer/i }).click();
    const composer = page.getByTestId('logistics-quote-composer');
    await composer.getByLabel(/Freight charge/i).fill('700');
    await composer.getByLabel(/Handling/i).fill('100');
    await composer.getByLabel(/Offer total/i).fill('800');
    await composer.getByRole('button', { name: /Review offer/i }).click();
    await expect(composer).toContainText(/Exactly what the customer will compare/i);
    // Components the provider did not state stay unknown — never folded into an "all-in" total.
    await expect(composer).toContainText(/Not provided/i);
    await composer.getByRole('button', { name: /Submit offer/i }).click();
    await expect(composer).toBeHidden({ timeout: 60_000 });

    // ── Requester: compare, see who it is from, and award ─────────────────
    await switchActor(page, 'requester');
    await page.goto('/diaspora/containers?view=mine');
    await page.getByText(CARGO).first().click();
    await expect(detail).toBeVisible({ timeout: 60_000 });
    await expect(detail).toContainText('800');
    // The requester DOES see the provider identity — that is what makes comparison possible.
    await expect(detail.getByTestId('logistics-offer-card')).toBeVisible();

    await detail.getByRole('button', { name: /Choose this provider/i }).first().click();
    await expect(detail).toContainText(/Provider selected/i, { timeout: 60_000 });

    // An award is a chosen offer and nothing more. It must not read as booked space.
    await expect(detail).not.toContainText(/Space approved|Booking approved/i);
  });

  stagingTest('a shared-container offer converts to a REQUESTED reservation that consumes nothing until the organiser approves', async ({ page }) => {
    stagingTest.setTimeout(300_000);
    const cargo = `${CARGO} container-space`;

    // ── Requester publishes ───────────────────────────────────────────────
    await signIn(page, 'requester');
    await page.goto('/diaspora/containers?view=mine');
    await page.getByRole('button', { name: /New shipping request/i }).click();
    await page.getByTestId('logistics-cargo-description').fill(cargo);
    await page.locator('[data-testid="logistics-request-wizard"] input[type="number"]').first().fill('4');
    await page.getByRole('button', { name: /^Continue/i }).click();
    await page.getByLabel(/I know the total volume/i).check();
    await page.locator('[data-testid="logistics-request-wizard"] input[type="number"]').first().fill(String(RESERVED_CBM));
    await page.getByRole('button', { name: /^Continue/i }).click();   // → Route
    await page.getByRole('button', { name: /^Continue/i }).click();   // → Review

    // Capture the real request id from the publish response — the reference on screen (SHIP-XXXX)
    // is a display string, not the identifier the API takes.
    const published = page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/logistics-requests\/[^/]+\/publish$/.test(new URL(r.url()).pathname),
      { timeout: 60_000 });
    await page.getByRole('button', { name: /Publish shipping request/i }).click();
    const requestId = (await (await published).json())?.data?.id as string;
    expect(requestId, 'publish did not return a request id').toBeTruthy();
    await expect(page.getByTestId('logistics-request-detail')).toBeVisible({ timeout: 60_000 });

    // ── Provider attaches a sailing it actually operates ──────────────────
    await switchActor(page, 'provider');
    await page.goto('/diaspora/containers?view=provider');
    const card = page.getByTestId('logistics-opportunity').filter({ hasText: cargo });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole('button', { name: /Prepare offer/i }).click();

    const composer = page.getByTestId('logistics-quote-composer');
    const sailing = composer.getByLabel(/CarUp sailing/i);
    // Pinned by id, not by index: the provider administers several sailings and attaching an
    // arbitrary one would make the capacity assertions below measure a container this journey
    // never touched. Only a sailing this provider coordinates or tenant-administers may be
    // offered, and the server re-checks that regardless of what the select contains.
    await sailing.selectOption(FIXTURE_CONTAINER_ID);
    await composer.getByLabel(/Offer total/i).fill('650');
    await composer.getByRole('button', { name: /Review offer/i }).click();
    await composer.getByRole('button', { name: /Submit offer/i }).click();
    await expect(composer).toBeHidden({ timeout: 60_000 });

    // ── Requester awards, then explicitly asks for space ──────────────────
    await switchActor(page, 'requester');
    await page.goto('/diaspora/containers?view=mine');
    await page.getByText(cargo).first().click();
    const detail = page.getByTestId('logistics-request-detail');
    await expect(detail).toBeVisible({ timeout: 60_000 });
    await detail.getByRole('button', { name: /Choose this provider/i }).first().click();
    await expect(detail).toContainText(/Provider selected/i, { timeout: 60_000 });

    // The award alone must NOT read as a booking — space is a separate, deliberate act.
    await expect(detail).toContainText(/organiser still has to approve/i);

    // Capacity BEFORE any space request, read off the operator surface rather than assumed.
    await page.goto('/diaspora/containers?view=containers');
    const before = await capacityFromCard(page);

    await page.goto('/diaspora/containers?view=mine');
    await page.getByText(cargo).first().click();
    await detail.getByRole('button', { name: /Request container space/i }).click();
    await expect(detail).toContainText(/Container-space request recorded/i, { timeout: 60_000 });

    // A REQUESTED reservation consumes NOTHING. This is the invariant the whole product rests on.
    await page.goto('/diaspora/containers?view=containers');
    const afterRequest = await capacityFromCard(page);
    expect(afterRequest.used, 'a REQUESTED reservation consumed capacity').toBe(before.used);
    expect(afterRequest.available, 'a REQUESTED reservation reduced availability').toBe(before.available);

    // Replaying the space request must not book the same cargo twice. Driven at the API, because
    // the UI hides the button once recorded — which would prove only that the button is hidden.
    const replay = await apiAs(page, 'POST', `/diaspora/logistics-requests/${requestId}/request-space`);
    expect(replay.status, `replayed space request rejected: api=${replay.api} as=${replay.sentUserId} body=${JSON.stringify(replay.body)}`).toBe(200);
    const replayBody = replay.body as { data?: { idempotentReplay?: boolean; reservation?: { id?: string } } };
    expect(replayBody?.data?.idempotentReplay, 'replay created a SECOND reservation').toBe(true);

    // A provider may not attach a sailing another organisation operates. Asserted at the API: the
    // composer only lists the provider's own sailings, so a UI-only check proves nothing.
    await switchActor(page, 'provider');
    await page.goto('/diaspora/containers?view=provider');
    const foreign = await apiAs(page, 'POST', `/diaspora/logistics-opportunities/${requestId}/quotes`, {
      service_mode: 'shared_container', total_amount: 500, currency: 'USD',
      compatible_container_id: FOREIGN_CONTAINER_ID, submit: true,
    });
    expect([400, 403], `foreign container attach returned ${foreign.status}`).toContain(foreign.status);

    // ── Organiser approves, through the EXISTING container authority ──────
    await page.goto('/diaspora/containers?view=containers');
    await fixtureCard(page).getByTestId('diaspora-container-open').click();
    await page.getByTestId('diaspora-container-approve').first().click();
    await expect(page.getByTestId('diaspora-container-reservation-row').getByText('APPROVED')).toBeVisible({ timeout: 60_000 });

    // …and ONLY now does capacity move, by exactly the reserved volume.
    await page.goto('/diaspora/containers?view=containers');
    const afterApproval = await capacityFromCard(page);
    expect(afterApproval.used, 'approval did not consume exactly the reserved volume')
      .toBeCloseTo(before.used + RESERVED_CBM, 3);
    expect(afterApproval.available, 'availability did not fall by exactly the reserved volume')
      .toBeCloseTo(before.available - RESERVED_CBM, 3);
  });
});
