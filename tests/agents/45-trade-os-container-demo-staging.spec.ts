/**
 * Spec 45 — Trade OS Container Co-Loading client-demo certification (deployed staging, unmocked).
 *
 * Proves the P0 journey of docs/TRADE_OS_CONTAINER_COLOADING_LIVING_MASTER_PLAN.md §12 against the
 * REAL deployed exact-head preview pair with REAL staging records:
 *
 *   operator login → Trade OS navigation → create October container (UI)
 *   → participant A requests VEHICLE space (rich form, import-order link)
 *   → participant B requests HOUSEHOLD space
 *   → operator sees requests → approves vehicle → capacity updates
 *   → participant sees APPROVED → activity/communication state visible
 *   plus reject, cancel, overfill denial, anonymous denial, cross-tenant denial.
 *
 * Identity convention (own-your-identity): this gate OWNS the four synthetic
 * tradeos.*@carup-staging.test accounts; no other gate's fixture is touched. Passwords come from
 * env only (TRADEOS_UAT_*_PASSWORD) — never from the repo.
 *
 * Outbox note: staging pg_cron drains domain_events every minute AGAINST THE CANONICAL BACKEND,
 * whose code predates the container_booking subscriptions — it consumes events with zero handlers.
 * The spec therefore drains through THIS candidate's backend immediately after each mutation
 * (TRADEOS_WORKER_SECRET), which is the same governed drain endpoint the cron uses.
 *
 * Chromium runs the full journey; tablet/mobile re-verify sign-in, discovery, participant status
 * and responsive layout against the state the chromium pass created.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { stagingTest, expect, API_URL } from './staging-helpers';

const IDS = {
  operator: { email: 'tradeos.operator@carup-staging.test', envPassword: 'TRADEOS_UAT_OPERATOR_PASSWORD' },
  participantA: { email: 'tradeos.participant.a@carup-staging.test', envPassword: 'TRADEOS_UAT_PARTICIPANT_A_PASSWORD' },
  participantB: { email: 'tradeos.participant.b@carup-staging.test', envPassword: 'TRADEOS_UAT_PARTICIPANT_B_PASSWORD' },
  outsider: { email: 'tradeos.outsider@carup-staging.test', envPassword: 'TRADEOS_UAT_OUTSIDER_PASSWORD' },
} as const;
type TradeRole = keyof typeof IDS;

const OCT_DEPARTURE = '2026-10-15';
const DEC_DEPARTURE = '2026-12-10';

// Cross-test state within one project run (workers=1, ordered execution).
const runState: { octoberId?: string; vehicleReservationId?: string } = {};

function password(role: TradeRole): string {
  const value = process.env[IDS[role].envPassword];
  if (!value) throw new Error(`${IDS[role].envPassword} is not exported — provision the tradeos identities first.`);
  return value;
}

async function signIn(page: Page, role: TradeRole): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('email-input').fill(IDS[role].email);
  await page.getByTestId('password-input').fill(password(role));
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
    if (response.status() !== 429) throw new Error(`UI login failed for ${role} with HTTP ${response.status()}`);
    const retryAfter = Number(response.headers()['retry-after'] || 1);
    await page.waitForTimeout(Math.max(1000, Math.min(retryAfter * 1000, 15_000)));
    await page.getByTestId('password-input').fill(password(role));
  }
  throw new Error(`UI login remained rate-limited for ${role}`);
}

/** Navigate and let the surface finish its background reads — journeys must not outrun the page
 *  and turn in-flight dashboard fetches into aborted-fetch console noise. */
async function gotoSettled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

/** Drain the domain-event outbox through THIS candidate's backend (best-effort, bounded). */
async function drainOutbox(request: APIRequestContext): Promise<void> {
  const secret = process.env.TRADEOS_WORKER_SECRET;
  if (!secret) return;
  await request.post(`${API_URL}/internal/events/process`, {
    headers: { authorization: `Bearer ${secret}` },
  }).catch(() => undefined);
}

async function sessionToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('carup_token'));
  if (!token) throw new Error('no carup_token in localStorage after sign-in');
  return token;
}

/**
 * Open the container whose card carries the given departure date, and WAIT for its booking manifest
 * to finish loading — a screenshot or assertion taken mid-flight would read the honest
 * "Loading bookings…" state as if it were the settled manifest.
 */
async function openContainerByDeparture(page: Page, departure: string): Promise<void> {
  const card = page.getByTestId('diaspora-container-card').filter({ hasText: departure }).first();
  await expect(card).toBeVisible();
  await card.getByTestId('diaspora-container-open').click();
  await expect(page.getByTestId('diaspora-container-detail')).toBeVisible();
  await expect(page.getByTestId('diaspora-container-counts')).not.toContainText(/Counting bookings/i, { timeout: 15_000 });
}

stagingTest.describe('Trade OS container co-loading — client demo (deployed staging)', () => {
  stagingTest.describe.configure({ mode: 'serial' });

  stagingTest('anonymous caller is denied by the marketplace API', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    const res = await anon.get(`${API_URL}/diaspora/container-marketplace/containers`);
    expect(res.status()).toBe(401);
    await anon.dispose();
  });

  stagingTest('operator: normal navigation → create the October container through the UI', async ({ page, cap }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    await signIn(page, 'operator');

    // Discoverability (D1): the dashboard sidebar carries Container Co-Loading — no hidden URL.
    await gotoSettled(page, '/dashboard');
    const navLink = page.getByRole('link', { name: /Container Co-Loading/i }).first();
    await expect(navLink).toBeVisible();
    await navLink.click();
    await expect(page).toHaveURL(/\/diaspora\/containers/);

    // Owner UAT #1/#3/#7: the operational workspace shell — real trade identity, no marketing
    // chrome, no security-role label masquerading as commercial identity.
    await expect(page.getByTestId('tradeos-workspace')).toBeVisible();
    await expect(page.getByTestId('tradeos-identity-org')).toContainText('Hikari Co-Load');
    await expect(page.getByTestId('tradeos-identity')).toContainText(/Logistics provider/i);
    await expect(page.getByTestId('tradeos-identity')).toContainText(/Organisation administrator/i);
    await expect(page.getByText('Car Owner', { exact: true })).toHaveCount(0);
    await expect(page.locator('footer')).toHaveCount(0);
    await expect(page.getByText(/© 2026 CarUp Zimbabwe/)).toHaveCount(0);

    // D2/D3: the tenant operator (plain 'owner' + verified tenant-admin membership) sees the form.
    await expect(page.getByTestId('diaspora-container-create-section')).toBeVisible();
    await page.getByTestId('diaspora-container-create-toggle').click();
    await page.getByTestId('create-origin-city').fill('Yokohama');
    await page.getByTestId('create-origin-port').fill('Port of Yokohama');
    await page.getByTestId('create-destination-city').fill('Harare');
    await page.getByTestId('create-destination-port').fill('via Beira · Harare Dry Port');
    await page.getByTestId('create-departure-date').fill(OCT_DEPARTURE);
    await page.getByTestId('create-booking-deadline').fill('2026-10-08');
    await page.getByTestId('create-loading-window').fill('10–12 Oct, Yokohama warehouse');
    await page.getByTestId('create-expected-arrival').fill('2026-11-20');
    await page.getByTestId('create-total-cbm').fill('60');
    await page.getByTestId('create-max-weight').fill('26000');
    await page.getByTestId('create-carrier').fill('SYNTHETIC demo forwarder');
    await page.getByTestId('create-booking-reference').fill('HKL-OCT-2026-01');
    await page.getByTestId('create-documentation-notes').fill('Packing list and commercial invoice required per participant.');
    await page.getByTestId('create-participant-notes').fill('SYNTHETIC demo sailing. Vehicles, parts, household and general eligible cargo accepted. No hazardous goods.');
    const createResponse = page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/container-marketplace\/containers$/.test(new URL(r.url()).pathname));
    await page.getByTestId('diaspora-container-create-submit').click();
    const created = await createResponse;
    expect(created.status()).toBe(201);
    runState.octoberId = (await created.json())?.data?.id;
    expect(runState.octoberId, 'created container id').toBeTruthy();

    // The new container is selected: truthful zero-capacity state + the international shipment
    // identity the organiser actually supplied (owner UAT #8).
    await expect(page.getByTestId('diaspora-container-capacity-line')).toContainText('Used 0/60');
    await expect(page.getByTestId('diaspora-container-counts')).toContainText('0 approved · 0 pending');
    const facts = page.getByTestId('diaspora-container-shipment-facts');
    await expect(facts).toContainText('Hikari Co-Load');
    await expect(facts).toContainText('Port of Yokohama');
    await expect(facts).toContainText('HKL-OCT-2026-01');
    await expect(facts).toContainText('2026-11-20');
    expect(cap.consoleErrors).toEqual([]);
  });

  stagingTest('participant A: discover container, request VEHICLE space with import-order link', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    await signIn(page, 'participantA');
    await gotoSettled(page, '/diaspora/containers');
    await openContainerByDeparture(page, OCT_DEPARTURE);

    await page.getByTestId('diaspora-container-reserve-category').selectOption('vehicle');
    await page.getByTestId('diaspora-container-reserve-description').fill('Toyota Aqua 2018 hybrid, running, keys in hand');
    await page.getByTestId('diaspora-container-reserve-volume').fill('22');
    await page.getByTestId('diaspora-container-reserve-weight').fill('1200');
    // The selector lists only the participant's OWN orders (server-scoped).
    const orderSelect = page.getByTestId('diaspora-container-reserve-order');
    await expect(orderSelect).toBeVisible();
    await expect(orderSelect.locator('option', { hasText: /Toyota Aqua/i })).toHaveCount(1);
    await orderSelect.selectOption({ index: 1 });
    const reserveResponse = page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/reservations$/.test(new URL(r.url()).pathname));
    await page.getByTestId('diaspora-container-reserve-submit').click();
    const reserved = await reserveResponse;
    expect(reserved.status()).toBe(201);
    const body = await reserved.json();
    runState.vehicleReservationId = body?.data?.id;
    expect(body?.data?.cargo_type).toBe('vehicle');
    expect(body?.data?.import_order_id).toBeTruthy();

    await expect(page.getByTestId('diaspora-container-reservation-row').first()).toContainText('REQUESTED');
    await drainOutbox(request);
  });

  stagingTest('participant B: request HOUSEHOLD space (non-vehicle eligible cargo)', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    await signIn(page, 'participantB');
    await gotoSettled(page, '/diaspora/containers');
    await openContainerByDeparture(page, OCT_DEPARTURE);

    // The service explains its breadth BEFORE the form (owner UAT #4).
    await expect(page.getByTestId('diaspora-container-purpose')).toContainText(/vehicles and other eligible goods/i);
    await expect(page.getByTestId('diaspora-container-eligible-examples')).toContainText('Household & personal effects');

    await page.getByTestId('diaspora-container-reserve-category').selectOption('household');
    await page.getByTestId('diaspora-container-reserve-description').fill('Household effects: 14 boxed cartons, bedding, kitchenware');
    // Guided measurement (owner UAT #5): B does NOT know CBM — the workspace calculates it.
    await page.getByTestId('diaspora-container-measure-calc').check();
    await page.getByTestId('measure-item-description').fill('Boxed cartons');
    await page.getByTestId('measure-item-quantity').fill('14');
    await page.getByTestId('measure-item-length').fill('60');
    await page.getByTestId('measure-item-width').fill('45');
    await page.getByTestId('measure-item-height').fill('40');
    // 0.6 × 0.45 × 0.4 × 14 = 1.512 CBM
    await expect(page.getByTestId('diaspora-container-computed-cbm')).toContainText('1.512 CBM');
    const reserveResponse = page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/reservations$/.test(new URL(r.url()).pathname));
    await page.getByTestId('diaspora-container-reserve-submit').click();
    const reserved = await reserveResponse;
    expect(reserved.status()).toBe(201);
    expect((await reserved.json())?.data?.estimated_volume).toBe(1.512);
    // Participant-safe visibility: B sees only B's own reservation, marked REQUESTED.
    await expect(page.getByTestId('diaspora-container-reservation-row')).toHaveCount(1);
    await expect(page.getByTestId('diaspora-container-reservation-row').first()).toContainText('household');
    await expect(page.getByTestId('diaspora-container-reservation-row').first()).toContainText('REQUESTED');
    await drainOutbox(request);
  });

  stagingTest('operator: sees both requests with cargo context, approves the vehicle — capacity updates', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    await signIn(page, 'operator');
    await gotoSettled(page, '/diaspora/containers');
    await openContainerByDeparture(page, OCT_DEPARTURE);

    const rows = page.getByTestId('diaspora-container-reservation-row');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('diaspora-container-counts')).toContainText('0 approved · 2 pending');

    // Owner UAT #6: the manifest tells the organiser WHO each booking belongs to,
    // and the booking detail spells out the whole relationship.
    const vehicleRow = rows.filter({ hasText: 'Toyota Aqua' });
    await expect(vehicleRow).toHaveCount(1);
    await expect(vehicleRow.getByTestId('diaspora-container-participant-name')).toContainText('Tapiwa');
    await expect(vehicleRow.getByTestId('diaspora-container-linked-order')).toContainText('Toyota Aqua');
    await vehicleRow.getByTestId('diaspora-container-open-booking').click();
    const detail = page.getByTestId('diaspora-container-booking-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Hikari Co-Load');           // organiser
    await expect(detail).toContainText('Tapiwa');                    // participant
    await expect(detail).toContainText(/Communications/i);           // contact path
    await vehicleRow.getByTestId('diaspora-container-open-booking').click(); // close detail

    await vehicleRow.getByTestId('diaspora-container-approve').click();
    await expect(vehicleRow.getByText('APPROVED')).toBeVisible();
    await expect(page.getByTestId('diaspora-container-capacity-line')).toContainText('Used 22/60');
    await expect(page.getByTestId('diaspora-container-counts')).toContainText('1 approved · 1 pending');
    await drainOutbox(request);
  });

  stagingTest('overfill is atomically denied at approval and capacity is unchanged', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    // B requests 50 CBM (individually valid: ≤ 60 total) …
    await signIn(page, 'participantB');
    await gotoSettled(page, '/diaspora/containers');
    await openContainerByDeparture(page, OCT_DEPARTURE);
    await page.getByTestId('diaspora-container-reserve-category').selectOption('general');
    await page.getByTestId('diaspora-container-reserve-description').fill('Overfill probe — general cargo pallets');
    await page.getByTestId('diaspora-container-reserve-volume').fill('50');
    await page.getByTestId('diaspora-container-reserve-submit').click();
    await expect(page.getByTestId('diaspora-container-reservation-row')).toHaveCount(2);

    // … but approving it must fail atomically: 22 approved + 50 = 72 > 60.
    await page.context().clearCookies();
    await signIn(page, 'operator');
    await gotoSettled(page, '/diaspora/containers');
    await openContainerByDeparture(page, OCT_DEPARTURE);
    const probeRow = page.getByTestId('diaspora-container-reservation-row').filter({ hasText: 'Overfill probe' });
    await probeRow.getByTestId('diaspora-container-approve').click();
    await expect(page.getByTestId('diaspora-container-reserve-error')).toContainText(/overfill/i);
    await expect(page.getByTestId('diaspora-container-capacity-line')).toContainText('Used 22/60');

    // Operator rejects the probe; capacity stays truthful, request leaves the pending set.
    await probeRow.getByTestId('diaspora-container-reject').click();
    await expect(probeRow.getByText('REJECTED')).toBeVisible();
    await expect(page.getByTestId('diaspora-container-counts')).toContainText('1 approved · 1 pending');
    await drainOutbox(request);
  });

  stagingTest('participant A: sees APPROVED state, can cancel a second request, and has activity/communication state', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    await signIn(page, 'participantA');
    await gotoSettled(page, '/diaspora/containers');
    await openContainerByDeparture(page, OCT_DEPARTURE);
    const mine = page.getByTestId('diaspora-container-reservation-row');
    await expect(mine.filter({ hasText: 'APPROVED' })).toHaveCount(1);

    // Cancel path: a second small request, cancelled by its owner.
    await page.getByTestId('diaspora-container-reserve-category').selectOption('parts');
    await page.getByTestId('diaspora-container-reserve-description').fill('Spare bumper + filters (cancel-path proof)');
    await page.getByTestId('diaspora-container-reserve-volume').fill('2');
    await page.getByTestId('diaspora-container-reserve-submit').click();
    const partsRow = mine.filter({ hasText: 'cancel-path proof' });
    await expect(partsRow).toHaveCount(1);
    await partsRow.getByTestId('diaspora-container-cancel').click();
    await expect(partsRow.getByText('CANCELLED')).toBeVisible();
    await drainOutbox(request);

    // Activity/communication state (D7) — UNCONDITIONAL (owner UAT #10B): the certification fails
    // unless the participant's canonical in-app notification actually exists AND is visible in the
    // deployed Communications surface. TRADEOS_WORKER_SECRET must be exported; a run without it is
    // not a certification.
    expect(process.env.TRADEOS_WORKER_SECRET, 'TRADEOS_WORKER_SECRET must be set — D7 cannot be proven without draining the candidate runtime').toBeTruthy();
    const token = await sessionToken(page);
    await expect.poll(async () => {
      await drainOutbox(request);
      const res = await request.get(`${API_URL}/communications/notifications`, {
        headers: { 'x-session-token': token },
      });
      if (!res.ok()) return 'unreadable';
      const payload = await res.json().catch(() => ({}));
      const rows = payload?.data || payload?.notifications || [];
      return Array.isArray(rows) && rows.some((n: { notification_type?: string }) => n.notification_type === 'container_booking')
        ? 'present' : 'absent';
    }, { timeout: 45_000, intervals: [2_000] }).toBe('present');

    // …and the human can SEE it: the canonical Communications surface renders the booking thread.
    await gotoSettled(page, '/dashboard/communications');
    await expect(page.getByText(/Container booking RES-/i).first()).toBeVisible({ timeout: 15_000 });
  });

  stagingTest('operator receives the organiser-directed booking notification (D7 direction)', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    expect(process.env.TRADEOS_WORKER_SECRET, 'TRADEOS_WORKER_SECRET must be set').toBeTruthy();
    await signIn(page, 'operator');
    const token = await sessionToken(page);
    await expect.poll(async () => {
      await drainOutbox(request);
      const res = await request.get(`${API_URL}/communications/notifications`, {
        headers: { 'x-session-token': token, 'x-tenant-id': 'c0106a0e-1a11-4a6a-9e01-000000000a01' },
      });
      if (!res.ok()) return 'unreadable';
      const payload = await res.json().catch(() => ({}));
      const rows = payload?.data || payload?.notifications || [];
      return Array.isArray(rows) && rows.some((n: { notification_type?: string }) => n.notification_type === 'container_booking')
        ? 'present' : 'absent';
    }, { timeout: 45_000, intervals: [2_000] }).toBe('present');
  });

  stagingTest('cross-tenant denial: a rival tenant admin cannot see, approve or close this container', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    await signIn(page, 'outsider');
    await gotoSettled(page, '/diaspora/containers');
    await openContainerByDeparture(page, OCT_DEPARTURE);

    // Participant visibility boundary: the rival admin holds tenant authority over ANOTHER tenant,
    // so the reservation list is participant-scoped for them — none of the real reservations leak.
    await expect(page.getByTestId('diaspora-container-reservation-row')).toHaveCount(0);

    // Direct API approval attempt with the outsider's real session + their own verified tenant:
    // the atomic RPC denies on tenant mismatch (403), and the reservation stays APPROVED-by-A's
    // operator — never re-writable by a rival tenant.
    const token = await sessionToken(page);
    expect(runState.vehicleReservationId, 'vehicle reservation id from earlier step').toBeTruthy();
    const approveRes = await request.post(
      `${API_URL}/diaspora/container-marketplace/reservations/${runState.vehicleReservationId}/approve`,
      { headers: { 'x-session-token': token, 'x-tenant-id': 'c0106a0e-1a11-4a6a-9e01-000000000b02' } },
    );
    expect(approveRes.status()).toBe(403);

    // Cross-tenant close attempt through the UI: server-denied, container stays open.
    await page.getByTestId('diaspora-container-close-booking').click();
    await expect(page.getByTestId('diaspora-container-reserve-error')).toBeVisible();
    await expect(page.getByTestId('diaspora-container-status').first()).toContainText(/BOOKING[ _]OPEN/);
  });

  stagingTest('operator: December container + booking-close semantics on a proof container', async ({ page, request }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    await signIn(page, 'operator');
    await gotoSettled(page, '/diaspora/containers');

    // December sailing (left OPEN for the client demo).
    await page.getByTestId('diaspora-container-create-toggle').click();
    await page.getByTestId('create-origin-city').fill('Yokohama');
    await page.getByTestId('create-destination-city').fill('Harare');
    await page.getByTestId('create-departure-date').fill(DEC_DEPARTURE);
    await page.getByTestId('create-booking-deadline').fill('2026-12-01');
    await page.getByTestId('create-total-cbm').fill('66');
    await page.getByTestId('diaspora-container-create-submit').click();
    await expect(page.getByTestId('diaspora-container-capacity-line')).toContainText('Used 0/66');
    // Truthful absence (owner UAT #8): facts the organiser did not supply say so — never guessed.
    await expect(page.getByTestId('diaspora-container-shipment-facts').getByText('Not recorded yet').first()).toBeVisible();

    // Close-semantics proof on a separate throwaway container: closing stops requests and is
    // NOT presented as departed/shipped/cleared/paid. BOOKING_CLOSED leaves the open list.
    await page.getByTestId('diaspora-container-create-toggle').click();
    await page.getByTestId('create-origin-city').fill('Yokohama');
    await page.getByTestId('create-destination-city').fill('Harare');
    await page.getByTestId('create-departure-date').fill('2026-11-05');
    await page.getByTestId('create-booking-deadline').fill('2026-11-01');
    await page.getByTestId('create-total-cbm').fill('10');
    await page.getByTestId('diaspora-container-create-submit').click();
    await expect(page.getByTestId('diaspora-container-capacity-line')).toContainText('Used 0/10');
    await expect(page.getByText(/Closing stops new requests/i)).toBeVisible();
    await page.getByTestId('diaspora-container-close-booking').click();
    await expect(page.getByTestId('diaspora-container-detail').getByText(/BOOKING[ _]CLOSED/).first()).toBeVisible();
    await expect(page.getByTestId('diaspora-container-card').filter({ hasText: '2026-11-05' })).toHaveCount(0);
    await drainOutbox(request);
  });

  stagingTest('order passport carries the linked cargo reservation (D9)', async ({ page }) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'full journey runs once on desktop');
    await signIn(page, 'participantA');
    await gotoSettled(page, '/diaspora/imports/d0106a0e-1a11-4a6a-9e01-00000000c001/passport');
    await expect(page.getByText(/Cargo reservation/i).first()).toBeVisible();
    await expect(page.getByText('APPROVED').first()).toBeVisible();
  });

  stagingTest('HARD GEOMETRY GATE: no horizontal document overflow across desktop classes (owner UAT #2)', async ({ page }, testInfo) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'geometry sweep runs once, resizing a desktop browser');
    await signIn(page, 'operator');
    // Element-existence can pass while the document is wider than the viewport — this gate cannot.
    const WIDTHS: Array<[number, number]> = [[393, 852], [820, 1180], [1024, 768], [1280, 800], [1366, 768], [1440, 900], [1536, 864]];
    for (const [width, height] of WIDTHS) {
      await page.setViewportSize({ width, height });
      await gotoSettled(page, '/diaspora/containers');
      await openContainerByDeparture(page, OCT_DEPARTURE);
      // Manifest + booking detail open = the widest state of the page.
      await page.getByTestId('diaspora-container-open-booking').first().click();
      await expect(page.getByTestId('diaspora-container-booking-detail')).toBeVisible();
      const geometry = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
        workspace: (() => {
          const el = document.querySelector('[data-testid="tradeos-workspace"]');
          return el ? el.scrollWidth - window.innerWidth : 0;
        })(),
      }));
      expect(geometry.doc, `document overflows by ${geometry.doc}px at ${width}×${height}`).toBeLessThanOrEqual(1);
      expect(geometry.body, `body overflows by ${geometry.body}px at ${width}×${height}`).toBeLessThanOrEqual(1);
      expect(geometry.workspace, `workspace overflows by ${geometry.workspace}px at ${width}×${height}`).toBeLessThanOrEqual(1);
      const shot = await page.screenshot({ fullPage: true });
      await testInfo.attach(`geometry-${width}x${height}.png`, { body: shot, contentType: 'image/png' });
    }
  });

  stagingTest('full-page visual evidence: operator and participant desktop + narrow desktop', async ({ page }, testInfo) => {
    stagingTest.skip(stagingTest.info().project.name !== 'chromium', 'visual sweep runs once on desktop');
    await signIn(page, 'operator');
    for (const [name, width, height] of [['operator-desktop-1440', 1440, 900], ['operator-narrow-1024', 1024, 768]] as Array<[string, number, number]>) {
      await page.setViewportSize({ width, height });
      await gotoSettled(page, '/diaspora/containers');
      await openContainerByDeparture(page, OCT_DEPARTURE);
      await testInfo.attach(`${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
    await page.context().clearCookies();
    await signIn(page, 'participantA');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoSettled(page, '/diaspora/containers');
    await openContainerByDeparture(page, OCT_DEPARTURE);
    await testInfo.attach('participant-desktop-1440.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  stagingTest('responsive: participant journey state on this viewport', async ({ page }, testInfo) => {
    stagingTest.skip(stagingTest.info().project.name === 'chromium', 'chromium already ran the full journey');
    await signIn(page, 'participantA');
    await gotoSettled(page, '/diaspora/containers');
    await openContainerByDeparture(page, OCT_DEPARTURE);
    await expect(page.getByTestId('diaspora-container-capacity-line')).toContainText('Used 22/60');
    await expect(page.getByTestId('diaspora-container-reservation-row').filter({ hasText: 'APPROVED' })).toHaveCount(1);
    // The request form remains usable on small viewports.
    await expect(page.getByTestId('diaspora-container-reserve-volume')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `document overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    await testInfo.attach(`participant-${testInfo.project.name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  stagingTest('responsive: operator view on this viewport', async ({ page }, testInfo) => {
    stagingTest.skip(stagingTest.info().project.name === 'chromium', 'chromium already ran the full journey');
    await signIn(page, 'operator');
    await gotoSettled(page, '/diaspora/containers');
    await expect(page.getByTestId('diaspora-container-create-section')).toBeVisible();
    await openContainerByDeparture(page, OCT_DEPARTURE);
    await expect(page.getByTestId('diaspora-container-counts')).toContainText('1 approved · 1 pending');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `document overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    await testInfo.attach(`operator-${testInfo.project.name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
