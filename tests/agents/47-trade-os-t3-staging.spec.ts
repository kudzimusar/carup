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

/**
 * Unique per run so repeated certifications never collide or read each other's rows. Falls back to
 * a clock-derived tag locally, because two local runs are still two runs.
 */
const RUN_TAG = process.env.STAGING_RUN_ID || `local-${Date.now().toString(36)}`;

/**
 * The volume the conversion test reserves; capacity must move by exactly this, and only on approval.
 */
const RESERVED_CBM = 3;

/**
 * Total capacity of the sailing THIS RUN creates. Comfortably above RESERVED_CBM, and deliberately
 * small enough to be obviously a fixture rather than a plausible real sailing.
 */
const RUN_SAILING_TOTAL_CBM = Number(process.env.TRADEOS_T3_RUN_SAILING_CBM || 24);

/**
 * The run-owned sailing's human reference. It is written to `origin_city` — a free-text field the
 * matcher ignores (only COUNTRIES are matched) — so anyone looking at staging's operator surface
 * can see at a glance that the sailing is certification scaffolding and which run owns it.
 */
const sailingReferenceFor = (project: string) => `golden.t3.sailing.${RUN_TAG}.${project}`;

/**
 * A sailing operated by a DIFFERENT organisation, used to prove the server refuses a cross-operator
 * attach. It is deliberately NOT run-scoped: a refused attach writes nothing, so this container
 * accumulates no capacity and cannot drift. The spec asserts it is genuinely foreign rather than
 * assuming it — a fabricated id would be refused as not-found, which proves nothing about authority.
 */
const FOREIGN_CONTAINER_ID = process.env.TRADEOS_T3_FOREIGN_CONTAINER_ID
  || 'bbbb2222-cccc-4ddd-8eee-999900002222';

/**
 * The cargo description doubles as this run's identifier on shared surfaces (the opportunity feed,
 * the operator manifest), so it must be unique per PROJECT as well as per run. All three viewport
 * projects execute the same spec; with only the run tag in the string, tablet and mobile matched
 * chromium's rows as well as their own.
 */
const cargoFor = (project: string) => `SYNTHETIC T3 ${RUN_TAG} ${project} household cartons`;

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
    // The tenant header is what turns a membership into an authority: `authorizeRole` only reads
    // tenant_users when `x-tenant-id` is present, so without it an operator is treated as having
    // no tenant role at all and creating a sailing is refused 403. Sent exactly as the app sends
    // it — from the stored user's active_tenant_id — so this helper carries no privilege the UI
    // does not already have.
    if (user.active_tenant_id) auth['x-tenant-id'] = String(user.active_tenant_id)
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

const CONTAINER_API = '/diaspora/container-marketplace';
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type RunSailing = { id: string; reference: string; tenantId: string | null; coordinatorId: string | null };

/**
 * Create the sailing THIS RUN will fill, through the governed operator API, signed in as the
 * provider.
 *
 * This replaces a long-lived shared fixture. Every certification used to approve ~3 CBM into the
 * same container, so used capacity ratcheted upward run after run (measured at 9.000/47 across
 * three runs) until a healthy run finally failed at 45.296/47 — the container product correctly
 * refusing to overfill. That was never a product defect; it was the certification depending on
 * capacity that earlier runs had consumed, and on someone periodically resetting it by hand.
 *
 * A sailing created inside the run cannot inherit capacity, because it did not exist when the
 * previous run ran. Isolation is therefore structural, not a cleanup that has to succeed.
 *
 * `createContainer` sets `coordinator_id` to the creator, and `assertProviderMayOfferContainer`
 * admits the coordinator — so the provider is authorised to attach the sailing it just created,
 * through exactly the same authority check a real operator passes. Nothing is bypassed.
 */
async function createRunSailing(page: Page, project: string): Promise<RunSailing> {
  const reference = sailingReferenceFor(project);
  const created = await apiAs(page, 'POST', `${CONTAINER_API}/containers`, {
    origin_country: 'Japan',
    origin_city: reference,
    destination_country: 'Zimbabwe',
    destination_city: 'Harare',
    departure_date: days(45),
    booking_deadline: days(30),
    container_type: '40HC',
    total_capacity_volume: RUN_SAILING_TOTAL_CBM,
    metadata: { certification: 'trade-os-t3-spec-47', run_reference: reference, synthetic: true },
  });
  expect(created.status,
    `run-scoped sailing was not created (api=${created.api} as=${created.sentUserId}): ${JSON.stringify(created.body)}`)
    .toBe(201);

  const container = (created.body as { data?: Record<string, unknown> })?.data || {};
  const id = String(container.id || '');
  expect(id, 'container creation returned no id').toBeTruthy();

  // ── Drift guard, asserted at the moment of creation ──────────────────────
  // If any of these ever fails, the spec has drifted back onto a pre-existing shared sailing.
  expect(Number(container.total_capacity_volume), 'run sailing has the wrong total')
    .toBe(RUN_SAILING_TOTAL_CBM);
  expect(Number(container.used_capacity_volume), 'a freshly created sailing must consume nothing')
    .toBe(0);
  expect(Number(container.available_capacity_volume), 'a fresh sailing must offer its whole capacity')
    .toBe(RUN_SAILING_TOTAL_CBM);
  expect(String(container.origin_city), 'the sailing is not tagged to this run').toBe(reference);

  const inherited = await apiAs(page, 'GET', `${CONTAINER_API}/containers/${id}/reservations`);
  expect(inherited.status, 'could not read the new sailing\'s manifest').toBe(200);
  expect(((inherited.body as { data?: unknown[] })?.data || []).length,
    'a run-owned sailing inherited reservations from an earlier run').toBe(0);

  return {
    id,
    reference,
    tenantId: container.tenant_id ? String(container.tenant_id) : null,
    coordinatorId: container.coordinator_id ? String(container.coordinator_id) : null,
  };
}

/**
 * Retire this run's sailing so it stops accepting bookings. Best effort by design: the NEXT run
 * creates its own sailing, so it never depends on this having succeeded. Cleanup touches only the
 * container this run created.
 */
async function retireRunSailing(page: Page, sailing: RunSailing): Promise<string> {
  try {
    const closed = await apiAs(page, 'POST', `${CONTAINER_API}/containers/${sailing.id}/close-booking`);
    return closed.status === 200 ? 'BOOKING_CLOSED' : `not closed (HTTP ${closed.status})`;
  } catch {
    return 'not closed (request failed)';
  }
}

/**
 * Capacity straight from the governed capacity endpoint, which is the authority: it derives used
 * volume from APPROVED reservations only (`available = total - sum(APPROVED)`).
 */
async function capacityOf(page: Page, containerId: string): Promise<{ used: number; available: number; total: number }> {
  const res = await apiAs(page, 'GET', `${CONTAINER_API}/containers/${containerId}/capacity`);
  expect(res.status, `capacity read failed: ${JSON.stringify(res.body)}`).toBe(200);
  const capacity = (res.body as { data?: { capacity?: Record<string, number> } })?.data?.capacity || {};
  return {
    used: Number(capacity.usedVolume),
    available: Number(capacity.availableVolume),
    total: Number(capacity.totalVolume),
  };
}

/** This run's own card, addressed by container id — never `.first()`, never a capacity string. */
function runCard(page: Page, containerId: string) {
  return page.locator(`[data-testid="diaspora-container-card"][data-container-id="${containerId}"]`);
}

/** What the operator surface SAYS about this run's sailing, to check the UI against the authority. */
async function capacityFromCard(page: Page, containerId: string): Promise<{ used: number; available: number }> {
  const card = runCard(page, containerId);
  await expect(card, `this run's sailing card (${containerId}) is not on the operator surface`).toHaveCount(1);
  const text = await card.innerText();
  const m = text.match(/Used\s+([\d.]+)\s*\/\s*([\d.]+)\s*CBM\s*·\s*available\s+([\d.]+)/i);
  if (!m) throw new Error(`could not read capacity from card: ${text}`);
  expect(Number(m[2]), 'read a card for the wrong sailing').toBe(RUN_SAILING_TOTAL_CBM);
  return { used: Number(m[1]), available: Number(m[3]) };
}

stagingTest.describe('Trade OS T3 — Shipping requests (deployed staging, unmocked)', () => {
  stagingTest.skip(!provisioned(),
    'T3 staging identities are not provisioned (TRADEOS_T3_{REQUESTER,PROVIDER}_{EMAIL,PASSWORD}).');

  stagingTest('requester publishes, provider offers safely, requester awards — and nothing is booked', async ({ page }, testInfo) => {
    stagingTest.setTimeout(300_000);
    const CARGO = cargoFor(testInfo.project.name);

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

  stagingTest('a shared-container offer converts to a REQUESTED reservation that consumes nothing until the organiser approves', async ({ page }, testInfo) => {
    stagingTest.setTimeout(300_000);
    const cargo = `${cargoFor(testInfo.project.name)} container-space`;

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

    // ── Provider creates THIS RUN's sailing, then attaches it ─────────────
    await switchActor(page, 'provider');
    await page.goto('/diaspora/containers?view=provider');

    // Created inside the run, so it starts empty by construction and no later run can inherit it.
    const runSailing = await createRunSailing(page, testInfo.project.name);
    testInfo.annotations.push({ type: 'run-sailing', description: `${runSailing.reference} (${runSailing.id})` });

    // The refusal proof is only a proof if the other container really is another operator's.
    const foreignRead = await apiAs(page, 'GET', `${CONTAINER_API}/containers/${FOREIGN_CONTAINER_ID}/capacity`);
    const foreignContainer = (foreignRead.body as { data?: { container?: Record<string, unknown> } })?.data?.container || {};
    expect(String(foreignContainer.coordinator_id || ''), 'the "foreign" sailing is coordinated by this provider')
      .not.toBe(String(runSailing.coordinatorId || ''));
    expect(String(foreignContainer.tenant_id || ''), 'the "foreign" sailing belongs to this provider\'s tenant')
      .not.toBe(String(runSailing.tenantId || ''));

    const card = page.getByTestId('logistics-opportunity').filter({ hasText: cargo });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole('button', { name: /Prepare offer/i }).click();

    const composer = page.getByTestId('logistics-quote-composer');
    const sailing = composer.getByLabel(/CarUp sailing/i);
    // Pinned to the sailing THIS RUN created, by id. Attaching an arbitrary one would make the
    // capacity assertions below measure a container this journey never touched, and attaching a
    // shared one would make them measure capacity earlier runs had already consumed. Only a
    // sailing this provider coordinates or tenant-administers may be offered, and the server
    // re-checks that regardless of what the select contains.
    await sailing.selectOption(runSailing.id);
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

    // Capacity BEFORE any space request. The governed capacity endpoint is the authority; the
    // operator card is checked against it so the UI cannot quietly disagree with the ledger.
    // On a run-owned sailing this is 0 used by construction, not a value inherited from a
    // previous certification — so the assertions below can be exact rather than relative.
    await page.goto('/diaspora/containers?view=containers');
    const before = await capacityOf(page, runSailing.id);
    expect(before.used, 'this run\'s sailing started with capacity already consumed').toBe(0);
    expect(before.available, 'this run\'s sailing did not offer its whole capacity').toBe(RUN_SAILING_TOTAL_CBM);
    expect(await capacityFromCard(page, runSailing.id), 'the operator card disagrees with the capacity ledger')
      .toEqual({ used: before.used, available: before.available });

    await page.goto('/diaspora/containers?view=mine');
    await page.getByText(cargo).first().click();
    await detail.getByRole('button', { name: /Request container space/i }).click();
    await expect(detail).toContainText(/Container-space request recorded/i, { timeout: 60_000 });

    // A REQUESTED reservation consumes NOTHING. This is the invariant the whole product rests on.
    await page.goto('/diaspora/containers?view=containers');
    const afterRequest = await capacityOf(page, runSailing.id);
    expect(afterRequest.used, 'a REQUESTED reservation consumed capacity').toBe(0);
    expect(afterRequest.available, 'a REQUESTED reservation reduced availability').toBe(RUN_SAILING_TOTAL_CBM);

    // Exactly ONE reservation exists on this run's sailing, and it is this run's own. On a shared
    // sailing this could only ever be a "greater than before" check.
    const manifest = await apiAs(page, 'GET', `${CONTAINER_API}/containers/${runSailing.id}/reservations`);
    const rows = (manifest.body as { data?: Array<Record<string, unknown>> })?.data || [];
    expect(rows.length, 'the run-owned sailing carries a reservation this run did not create').toBe(1);
    expect(String(rows[0]?.reservation_status), 'the reservation is not REQUESTED').toBe('REQUESTED');

    // Replaying the space request must not book the same cargo twice. Driven at the API, because
    // the UI hides the button once recorded — which would prove only that the button is hidden.
    const replay = await apiAs(page, 'POST', `/diaspora/logistics-requests/${requestId}/request-space`);
    expect(replay.status, `replayed space request rejected: api=${replay.api} as=${replay.sentUserId} body=${JSON.stringify(replay.body)}`).toBe(200);
    const replayBody = replay.body as { data?: { idempotentReplay?: boolean; reservation?: { id?: string } } };
    expect(replayBody?.data?.idempotentReplay, 'replay created a SECOND reservation').toBe(true);

    const afterReplay = await apiAs(page, 'GET', `${CONTAINER_API}/containers/${runSailing.id}/reservations`);
    expect(((afterReplay.body as { data?: unknown[] })?.data || []).length, 'replay added a second reservation').toBe(1);

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
    await runCard(page, runSailing.id).getByTestId('diaspora-container-open').click();

    // Scope to THIS run's reservation by cargo. On a run-owned sailing there is only one row, but
    // the filter stays: approving `.first()` once approved a stranger's booking and then asserted
    // on whichever APPROVED badge happened to render — green while proving nothing.
    const row = page.getByTestId('diaspora-container-reservation-row').filter({ hasText: cargo });
    await expect(row, 'this run\'s reservation is not on the manifest').toHaveCount(1);
    await row.getByTestId('diaspora-container-approve').click();
    await expect(row.getByText('APPROVED')).toBeVisible({ timeout: 60_000 });

    // …and ONLY now does capacity move, by exactly the reserved volume. Absolute, because the
    // sailing began this run empty: available = total - sum(APPROVED).
    await page.goto('/diaspora/containers?view=containers');
    const afterApproval = await capacityOf(page, runSailing.id);
    expect(afterApproval.used, 'approval did not consume exactly the reserved volume')
      .toBeCloseTo(RESERVED_CBM, 3);
    expect(afterApproval.available, 'availability did not fall by exactly the reserved volume')
      .toBeCloseTo(RUN_SAILING_TOTAL_CBM - RESERVED_CBM, 3);
    expect(await capacityFromCard(page, runSailing.id), 'the operator card disagrees with the capacity ledger after approval')
      .toEqual({ used: afterApproval.used, available: afterApproval.available });

    // Approval is not repeatable capacity. Re-approving must not consume a second time.
    const reApprove = await apiAs(page, 'POST', `${CONTAINER_API}/reservations/${String(rows[0]?.id)}/approve`);
    const afterReApproval = await capacityOf(page, runSailing.id);
    expect(afterReApproval.used, `re-approval (HTTP ${reApprove.status}) consumed capacity a second time`)
      .toBeCloseTo(RESERVED_CBM, 3);

    // Retire this run's sailing. Best effort — the next run creates its own and never depends on it.
    const disposition = await retireRunSailing(page, runSailing);
    testInfo.annotations.push({ type: 'run-sailing-cleanup', description: disposition });
  });
});
