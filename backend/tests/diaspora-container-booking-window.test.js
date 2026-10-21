/**
 * CARUP-MVP-STAB-01 F-022 / TRD-002 — the container marketplace respects a sailing's booking window.
 *
 * Staging (2026-10-21): 68 sailings stored BOOKING_OPEN, 36 of them with BOTH the cut-off and the
 * departure in the past; 24 reservations had been made after their sailing's cut-off and 26 REQUESTED
 * reservations sat on departed sailings. The marketplace read the stored status alone and nothing
 * closes a sailing automatically.
 *
 * What these tests pin, against the real marketplace service (and, at the end, the real router):
 *   - a participant never sees a departed sailing; a past-cut-off sailing is shown, but NOT bookable;
 *   - every NEW booking on a non-bookable sailing is refused before any write, with a stable code;
 *   - an operator still sees its own expired open sailings, annotated — that is operations work;
 *   - the rule never changes a stored status; closing stays the operator's audited act;
 *   - the code reaches a client in a production-like runtime as `error.code`, never only `details`.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT = 'false';

const express = (await import('express')).default;
const diasporaRouter = (await import('../routes/diasporaRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const m = await import('../services/diaspora/diasporaContainerMarketplaceService.js');
const { formatSailingDate } = await import('../services/diaspora/containerBookingEligibility.js');

const TENANT_OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_RIVAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY = 24 * 3600 * 1000;
const at = (days) => new Date(Date.now() + days * DAY).toISOString();

// Fixed for the whole file so expected copy can be computed once.
const CUTOFF_PASSED = at(-2);
const DEPARTED_ON = at(-5);

const buyer = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: null, tenantRole: null };
const operator = { id: 'op-1', userId: 'op-1', role: 'owner', platformRole: 'owner', tenantId: TENANT_OP, tenantRole: 'admin' };
const rival = { id: 'rival-1', userId: 'rival-1', role: 'owner', platformRole: 'owner', tenantId: TENANT_RIVAL, tenantRole: 'admin' };
const coordinator = { id: 'coord-1', userId: 'coord-1', role: 'owner', platformRole: 'owner', tenantId: null, tenantRole: null };
const reviewer = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null, tenantRole: null };

function sailing(id, overrides = {}) {
  return {
    id, tenant_id: TENANT_OP, coordinator_id: 'op-1', status: 'BOOKING_OPEN',
    origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
    container_type: '40HC', booking_deadline: at(10), departure_date: at(20),
    total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60,
    metadata: {}, deleted_at: null, created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function world(extra = {}) {
  return createMockSupabase({
    users: [
      { id: 'buyer-1', name: 'SYNTHETIC Buyer', role: 'owner', is_verified: true },
      { id: 'op-1', name: 'SYNTHETIC Operator', role: 'owner', is_verified: true },
      { id: 'rival-1', name: 'SYNTHETIC Rival', role: 'owner', is_verified: true },
      { id: 'coord-1', name: 'SYNTHETIC Coordinator', role: 'owner', is_verified: true },
      { id: 'rev-1', name: 'SYNTHETIC Reviewer', role: 'reviewer', is_verified: true },
    ],
    tenants: [
      { id: TENANT_OP, name: 'SYNTHETIC Hikari Co-Load', type: 'import', status: 'active' },
      { id: TENANT_RIVAL, name: 'SYNTHETIC Rival Freight', type: 'import', status: 'active' },
    ],
    tenant_users: [
      { tenant_id: TENANT_OP, user_id: 'op-1', role: 'admin' },
      { tenant_id: TENANT_RIVAL, user_id: 'rival-1', role: 'admin' },
    ],
    diaspora_container_shipments: [
      sailing('sail-future', { created_at: '2026-09-06T00:00:00.000Z' }),
      sailing('sail-cutoff', { booking_deadline: CUTOFF_PASSED, departure_date: at(10), created_at: '2026-09-05T00:00:00.000Z' }),
      sailing('sail-departed', { booking_deadline: at(-20), departure_date: DEPARTED_ON, created_at: '2026-09-04T00:00:00.000Z' }),
      sailing('rival-departed', { tenant_id: TENANT_RIVAL, coordinator_id: 'rival-1', booking_deadline: at(-20), departure_date: DEPARTED_ON, created_at: '2026-09-03T00:00:00.000Z' }),
      sailing('coord-departed', { tenant_id: null, coordinator_id: 'coord-1', booking_deadline: at(-20), departure_date: DEPARTED_ON, created_at: '2026-09-02T00:00:00.000Z' }),
      sailing('sail-closed', { status: 'BOOKING_CLOSED' }),
      sailing('sail-draft', { status: 'DRAFT' }),
    ],
    diaspora_cargo_reservations: [],
    diaspora_import_audit_log: [],
    diaspora_import_orders: [],
    diaspora_import_order_participants: [],
    ...extra,
  }, { rpc: DIASPORA_RPCS });
}

const ids = (rows) => rows.map((row) => row.id).sort();
const storedStatus = (c, id) => c._rows('diaspora_container_shipments').find((row) => row.id === id).status;
const cutoffCopy = `Booking for this sailing closed on ${formatSailingDate(CUTOFF_PASSED)}.`;
const departedCopy = `This sailing departed on ${formatSailingDate(DEPARTED_ON)} and no longer takes bookings.`;

// ── the required negative: marketplace path ─────────────────────────────────

test('NEGATIVE (marketplace): a BOOKING_OPEN sailing past its cut-off is listed to a participant as NOT bookable, and a request is refused before any write', async () => {
  const c = world();
  const listed = await m.listOpenContainers({}, buyer, { supabaseClient: c });
  const row = listed.find((x) => x.id === 'sail-cutoff');
  assert.ok(row, 'past its cut-off but not departed: still shown, so a participant with a pending booking can find it');
  assert.deepEqual(row.booking_eligibility, { state: 'deadline_passed', bookable: false, reason: cutoffCopy });

  await assert.rejects(() => m.requestReservation('sail-cutoff', { estimated_volume: 5, cargo_type: 'household' }, buyer, { supabaseClient: c }), (err) => {
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'DIASPORA_CONTAINER/BOOKING_DEADLINE_PASSED');
    assert.equal(err.message, cutoffCopy);
    return true;
  });
  assert.equal(c._rows('diaspora_cargo_reservations').length, 0, 'no reservation row was written');
  assert.equal(c._rows('diaspora_import_audit_log').length, 0, 'no audit row claims a request happened');
  assert.equal(storedStatus(c, 'sail-cutoff'), 'BOOKING_OPEN', 'the refusal does not quietly close the sailing');
});

test('a departed sailing never appears in a participant\'s list, and a request on it is refused before any write', async () => {
  const c = world();
  const listed = await m.listOpenContainers({}, buyer, { supabaseClient: c });
  for (const departed of ['sail-departed', 'rival-departed', 'coord-departed']) {
    assert.ok(!listed.some((x) => x.id === departed), `${departed} must never look presently bookable`);
  }
  await assert.rejects(() => m.requestReservation('sail-departed', { estimated_volume: 5 }, buyer, { supabaseClient: c }), (err) => {
    assert.equal(err.code, 'DIASPORA_CONTAINER/SAILING_DEPARTED');
    assert.equal(err.message, departedCopy);
    return true;
  });
  assert.equal(c._rows('diaspora_cargo_reservations').length, 0);
  assert.equal(storedStatus(c, 'sail-departed'), 'BOOKING_OPEN');
});

test('POSITIVE CONTROL: a future sailing is listed as bookable and takes a request', async () => {
  const c = world();
  const listed = await m.listOpenContainers({}, buyer, { supabaseClient: c });
  assert.deepEqual(ids(listed), ['sail-cutoff', 'sail-future'], 'the participant list: the live sailing and the past-cut-off one, nothing departed');
  assert.deepEqual(listed.find((x) => x.id === 'sail-future').booking_eligibility, { state: 'open', bookable: true, reason: null });
  const reservation = await m.requestReservation('sail-future', { estimated_volume: 5, cargo_type: 'household' }, buyer, { supabaseClient: c });
  assert.equal(reservation.reservation_status, 'REQUESTED');
  assert.equal(c._rows('diaspora_cargo_reservations').length, 1);
});

// ── operators keep their operations work ────────────────────────────────────

test('an operator still sees its OWN expired open sailings, annotated — and nobody else\'s departed ones', async () => {
  const c = world();
  const own = await m.listOpenContainers({}, operator, { supabaseClient: c });
  assert.deepEqual(ids(own), ['sail-cutoff', 'sail-departed', 'sail-future']);
  assert.equal(own.find((x) => x.id === 'sail-departed').booking_eligibility.state, 'departed');
  assert.equal(own.find((x) => x.id === 'sail-cutoff').booking_eligibility.state, 'deadline_passed');

  const rivalView = await m.listOpenContainers({}, rival, { supabaseClient: c });
  assert.deepEqual(ids(rivalView), ['rival-departed', 'sail-cutoff', 'sail-future'],
    'a tenant admin is a participant on another organisation\'s sailing');

  const coordinatorView = await m.listOpenContainers({}, coordinator, { supabaseClient: c });
  assert.deepEqual(ids(coordinatorView), ['coord-departed', 'sail-cutoff', 'sail-future'],
    'the coordinator operates its sailing exactly as T5.8 already treats it');

  const platform = await m.listOpenContainers({}, reviewer, { supabaseClient: c });
  assert.deepEqual(ids(platform), ['coord-departed', 'rival-departed', 'sail-cutoff', 'sail-departed', 'sail-future']);
  assert.ok(platform.every((row) => row.booking_eligibility && typeof row.booking_eligibility.bookable === 'boolean'));

  for (const id of ['sail-future', 'sail-cutoff', 'sail-departed', 'rival-departed', 'coord-departed']) {
    assert.equal(storedStatus(c, id), 'BOOKING_OPEN', `${id}: listing never mutates a stored status`);
  }
});

test('the operator can act on it: closeBooking still closes an expired open sailing, which then leaves the open list', async () => {
  const c = world();
  const closed = await m.closeBooking('sail-cutoff', operator, { supabaseClient: c });
  assert.equal(closed.status, 'BOOKING_CLOSED');
  assert.ok(c._rows('diaspora_import_audit_log').some((row) => row.action === 'CONTAINER_BOOKING_CLOSED' && row.resource_id === 'sail-cutoff'),
    'closing stays the operator\'s audited act');
  const listed = await m.listOpenContainers({}, buyer, { supabaseClient: c });
  assert.ok(!listed.some((x) => x.id === 'sail-cutoff'));
});

test('non-open listings keep the T5.8 scoping and carry the same annotation', async () => {
  const c = world();
  assert.deepEqual(await m.listOpenContainers({ status: 'DRAFT' }, buyer, { supabaseClient: c }), []);
  const drafts = await m.listOpenContainers({ status: 'DRAFT' }, operator, { supabaseClient: c });
  assert.deepEqual(ids(drafts), ['sail-draft']);
  assert.equal(drafts[0].booking_eligibility.state, 'not_open');
});

test('the per-sailing capacity read carries the same eligibility — the booking screen refreshes from it', async () => {
  const c = world();
  const expired = await m.getContainerCapacity('sail-cutoff', buyer, { supabaseClient: c });
  assert.deepEqual(expired.container.booking_eligibility, { state: 'deadline_passed', bookable: false, reason: cutoffCopy });
  const live = await m.getContainerCapacity('sail-future', buyer, { supabaseClient: c });
  assert.equal(live.container.booking_eligibility.state, 'open');
});

// ── capacity: T5's "Full" semantics ─────────────────────────────────────────

test('full (T5 semantics): a sailing its APPROVED reservations fill is listed full and a new request is refused', async () => {
  const c = world({
    diaspora_container_shipments: [sailing('sail-full', {
      used_capacity_volume: 59, available_capacity_volume: 1,
      metadata: { capacity: { fillPercent: 0.983, readyToClose: true, full: true } },
    })],
    diaspora_cargo_reservations: [
      { id: 'approved-1', container_id: 'sail-full', buyer_id: 'buyer-2', reservation_status: 'APPROVED', estimated_volume: 59, deleted_at: null },
    ],
  });
  const [row] = await m.listOpenContainers({}, buyer, { supabaseClient: c });
  assert.equal(row.booking_eligibility.state, 'full');
  assert.equal(row.booking_eligibility.bookable, false);
  await assert.rejects(() => m.requestReservation('sail-full', { estimated_volume: 1 }, buyer, { supabaseClient: c }),
    (err) => err.code === 'DIASPORA_CONTAINER/SAILING_FULL' && err.statusCode === 400);
  assert.equal(c._rows('diaspora_cargo_reservations').length, 1, 'only the seeded approval exists');
});

test('a stale cached "full" never refuses space the APPROVED reservations say is free', async () => {
  // The cached figures are a projection; the legacy cancel route, for one, does not re-sync them.
  // A request is judged on the authoritative capacity, so a stale cache cannot block real space.
  const c = world({
    diaspora_container_shipments: [sailing('sail-stale', {
      used_capacity_volume: 60, available_capacity_volume: 0,
      metadata: { capacity: { fillPercent: 1, readyToClose: true, full: true } },
    })],
  });
  const reservation = await m.requestReservation('sail-stale', { estimated_volume: 5 }, buyer, { supabaseClient: c });
  assert.equal(reservation.reservation_status, 'REQUESTED');
});

// ── over HTTP: the code a client actually receives ──────────────────────────

let server; let baseUrl; let mock;
function installMock() {
  mock = world();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => mock.from(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: (n, p) => mock.rpc(n, p) });
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  delete supabase.from;
  delete supabase.rpc;
});

async function call(method, path, { userId, tenantId, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Run `fn` as a production-like runtime would: errorMiddleware then hides `details`. */
async function productionLike(env, fn) {
  const keys = ['VERCEL_ENV', 'CARUP_ENV', 'CARUP_ALLOW_X_USER_ID_FALLBACK'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  // The x-user-id harness identity is refused in a deployment unless explicitly opted in; the
  // opt-in changes who the caller is, not what errorMiddleware is allowed to expose.
  Object.assign(process.env, env, { CARUP_ALLOW_X_USER_ID_FALLBACK: 'true' });
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
}

const BASE = '/api/diaspora/container-marketplace';

test('HTTP, production-like runtime: the refusal reaches the client as error.code, and details stay hidden', async () => {
  for (const env of [{ VERCEL_ENV: 'preview' }, { CARUP_ENV: 'staging' }]) {
    installMock();
    await productionLike(env, async () => {
      const cutoff = await call('POST', `${BASE}/containers/sail-cutoff/reservations`, { userId: 'buyer-1', body: { estimated_volume: 5, cargo_type: 'household' } });
      assert.equal(cutoff.status, 400, JSON.stringify(env));
      assert.equal(cutoff.body.error.code, 'DIASPORA_CONTAINER/BOOKING_DEADLINE_PASSED');
      assert.equal(cutoff.body.error.message, cutoffCopy);
      assert.equal(cutoff.body.error.details, undefined, 'a production-like runtime hides details — the code must not live only there');

      const departed = await call('POST', `${BASE}/containers/sail-departed/reservations`, { userId: 'buyer-1', body: { estimated_volume: 5 } });
      assert.equal(departed.status, 400);
      assert.equal(departed.body.error.code, 'DIASPORA_CONTAINER/SAILING_DEPARTED');
      assert.equal(departed.body.error.message, departedCopy);
      assert.equal(departed.body.error.details, undefined);

      // The pre-F-022 refusal is kept exactly as it was.
      const closed = await call('POST', `${BASE}/containers/sail-closed/reservations`, { userId: 'buyer-1', body: { estimated_volume: 5 } });
      assert.equal(closed.status, 400);
      assert.equal(closed.body.error.code, 'VALIDATION_FAILED');
      assert.equal(closed.body.error.message, 'Container is not open for booking');
    });
    assert.equal(mock._rows('diaspora_cargo_reservations').length, 0, 'no refused request wrote anything');
  }
});

test('HTTP: the participant list carries booking_eligibility and never a departed sailing; the operator list keeps its own', async () => {
  installMock();
  const participant = await call('GET', `${BASE}/containers`, { userId: 'buyer-1' });
  assert.equal(participant.status, 200);
  assert.deepEqual(ids(participant.body.data), ['sail-cutoff', 'sail-future']);
  assert.deepEqual(participant.body.data.find((x) => x.id === 'sail-cutoff').booking_eligibility,
    { state: 'deadline_passed', bookable: false, reason: cutoffCopy });

  const operatorList = await call('GET', `${BASE}/containers`, { userId: 'op-1', tenantId: TENANT_OP });
  assert.equal(operatorList.status, 200);
  assert.deepEqual(ids(operatorList.body.data), ['sail-cutoff', 'sail-departed', 'sail-future']);
  assert.equal(operatorList.body.data.find((x) => x.id === 'sail-departed').booking_eligibility.state, 'departed');
});
