/**
 * CARUP-MVP-STAB-01 — the legacy container routes.
 *
 * F-023 (read privacy). `GET /api/diaspora/containers` admits ANY authenticated role and, without a
 * `status`, returned every sailing in every status — DRAFTs included — with no caller context at all.
 * `GET /api/diaspora/containers/:id` embedded `diaspora_cargo_reservations(*)`: the receiver name,
 * receiver phone and cargo details of every OTHER participant on the sailing, to anyone signed in.
 *
 * TRD-002 (legacy write). `POST /api/diaspora/reservations` checked the stored status alone, and its
 * sailing lookup ignored `deleted_at`, so a soft-deleted sailing could still be booked.
 *
 * Driven over HTTP through the real router, auth middleware and services, against an in-memory
 * Supabase. Privacy assertions walk EVERY embedded row and assert on values, not on row 0.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const diasporaRouter = (await import('../routes/diasporaRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { formatSailingDate } = await import('../services/diaspora/containerBookingEligibility.js');

const TENANT_OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_RIVAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY = 24 * 3600 * 1000;
const at = (days) => new Date(Date.now() + days * DAY).toISOString();
const CUTOFF_PASSED = at(-2);
const DEPARTED_ON = at(-5);

// Every value here is private to the participant it belongs to.
const PRIVATE = {
  'buyer-1': ['SYNTHETIC Receiver One', '+263770000001', 'Buyer one private cargo', 'Mbare, Harare'],
  'buyer-2': ['SYNTHETIC Receiver Two', '+263770000002', 'Buyer two private cargo', 'Avondale, Harare'],
};

function sailing(id, overrides = {}) {
  return {
    id, tenant_id: TENANT_OP, coordinator_id: 'op-1', status: 'BOOKING_OPEN',
    origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
    container_type: '40HC', booking_deadline: at(10), departure_date: at(20),
    total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60,
    metadata: {}, deleted_at: null, created_by: 'op-1',
    ...overrides,
  };
}

function reservation(id, buyerId, containerId, overrides = {}) {
  const [receiverName, receiverPhone, description, location] = PRIVATE[buyerId];
  return {
    id, container_id: containerId, import_order_id: `order-${buyerId}`, tenant_id: TENANT_OP,
    buyer_id: buyerId, created_by: buyerId, cargo_type: 'household', estimated_volume: 4,
    reservation_status: 'REQUESTED', receiver_name: receiverName, receiver_phone: receiverPhone,
    cargo_description: description, receiver_location: location, deleted_at: null,
    ...overrides,
  };
}

function seeded() {
  return createMockSupabase({
    users: [
      { id: 'buyer-1', name: 'SYNTHETIC Buyer One', role: 'owner', is_verified: true },
      { id: 'buyer-2', name: 'SYNTHETIC Buyer Two', role: 'owner', is_verified: true },
      { id: 'stranger-1', name: 'SYNTHETIC Stranger', role: 'owner', is_verified: true },
      { id: 'op-1', name: 'SYNTHETIC Operator', role: 'owner', is_verified: true },
      { id: 'rival-1', name: 'SYNTHETIC Rival', role: 'owner', is_verified: true },
      { id: 'coord-1', name: 'SYNTHETIC Coordinator', role: 'owner', is_verified: true },
      { id: 'rev-1', name: 'SYNTHETIC Reviewer', role: 'reviewer', is_verified: true },
      { id: 'padmin-1', name: 'SYNTHETIC Platform Admin', role: 'admin', is_verified: true },
    ],
    tenants: [
      { id: TENANT_OP, name: 'SYNTHETIC Hikari Co-Load', type: 'import', status: 'active' },
      { id: TENANT_RIVAL, name: 'SYNTHETIC Rival Freight', type: 'import', status: 'active' },
    ],
    tenant_users: [
      { tenant_id: TENANT_OP, user_id: 'op-1', role: 'admin' },
      { tenant_id: TENANT_RIVAL, user_id: 'rival-1', role: 'admin' },
    ],
    diaspora_import_orders: [
      { id: 'order-buyer-1', buyer_id: 'buyer-1', created_by: 'buyer-1', order_type: 'vehicle', status: 'DOCUMENTS_VERIFIED', deleted_at: null },
      { id: 'order-buyer-2', buyer_id: 'buyer-2', created_by: 'buyer-2', order_type: 'vehicle', status: 'DOCUMENTS_VERIFIED', deleted_at: null },
    ],
    diaspora_import_order_participants: [],
    diaspora_container_shipments: [
      sailing('sail-future'),
      sailing('sail-cutoff', { booking_deadline: CUTOFF_PASSED, departure_date: at(10) }),
      sailing('sail-departed', { booking_deadline: at(-20), departure_date: DEPARTED_ON }),
      sailing('sail-draft', { status: 'DRAFT' }),
      sailing('sail-closed', { status: 'BOOKING_CLOSED' }),
      sailing('sail-deleted', { deleted_at: '2026-10-01T00:00:00.000Z' }),
      sailing('sail-coord', { tenant_id: null, coordinator_id: 'coord-1', created_by: 'coord-1' }),
    ],
    diaspora_cargo_reservations: [
      reservation('res-b1', 'buyer-1', 'sail-future'),
      reservation('res-b2', 'buyer-2', 'sail-future', { reservation_status: 'APPROVED' }),
      reservation('res-b2-deleted', 'buyer-2', 'sail-future', { deleted_at: '2026-10-02T00:00:00.000Z' }),
      reservation('res-c1', 'buyer-2', 'sail-coord'),
    ],
    diaspora_import_audit_log: [],
    domain_events: [],
  }, { rpc: DIASPORA_RPCS });
}

let server; let baseUrl; let mock;
function installMock() {
  mock = seeded();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => mock.from(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: (n, p) => mock.rpc(n, p) });
}

before(async () => {
  installMock();
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
beforeEach(installMock);

async function call(method, path, { userId, tenantId, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, body: json, text };
}

const ids = (rows) => rows.map((row) => row.id).sort();
const reservationRows = () => mock._rows('diaspora_cargo_reservations');
const SEEDED_RESERVATIONS = 4;

/** Walk every embedded reservation: each must belong to `ownerId`; no other participant's value may appear anywhere. */
function assertOnlyOwnReservations(response, ownerId) {
  const embedded = response.body.diaspora_cargo_reservations;
  assert.ok(Array.isArray(embedded), 'the embed is still an array');
  for (const row of embedded) {
    assert.ok([row.buyer_id, row.created_by].includes(ownerId), `row ${row.id} belongs to someone else`);
  }
  for (const [owner, values] of Object.entries(PRIVATE)) {
    if (owner === ownerId) continue;
    for (const value of values) {
      assert.ok(!response.text.includes(value), `another participant's private value leaked: ${value}`);
    }
  }
  return embedded;
}

// ── TRD-002: the legacy reservation path ────────────────────────────────────

const LEGACY_REQUEST = { import_order_id: 'order-buyer-1', cargo_type: 'vehicle', estimated_volume: 5 };

test('NEGATIVE (legacy): a BOOKING_OPEN sailing past its cut-off is refused before any write', async () => {
  const res = await call('POST', '/api/diaspora/reservations', { userId: 'buyer-1', body: { ...LEGACY_REQUEST, container_id: 'sail-cutoff' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'DIASPORA_CONTAINER/BOOKING_DEADLINE_PASSED');
  assert.equal(res.body.error.message, `Booking for this sailing closed on ${formatSailingDate(CUTOFF_PASSED)}.`);
  assert.equal(reservationRows().length, SEEDED_RESERVATIONS, 'no reservation row was written');
  assert.equal(mock._rows('diaspora_import_audit_log').length, 0, 'no audit row claims a reservation was created');
  assert.equal(mock._rows('domain_events').length, 0, 'no requested-event was emitted');
  assert.equal(mock._rows('diaspora_container_shipments').find((row) => row.id === 'sail-cutoff').status, 'BOOKING_OPEN');
});

test('NEGATIVE (legacy): a departed sailing is refused before any write', async () => {
  const res = await call('POST', '/api/diaspora/reservations', { userId: 'buyer-1', body: { ...LEGACY_REQUEST, container_id: 'sail-departed' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'DIASPORA_CONTAINER/SAILING_DEPARTED');
  assert.equal(res.body.error.message, `This sailing departed on ${formatSailingDate(DEPARTED_ON)} and no longer takes bookings.`);
  assert.equal(reservationRows().length, SEEDED_RESERVATIONS);
});

test('POSITIVE CONTROL (legacy): a future sailing still takes the request', async () => {
  const res = await call('POST', '/api/diaspora/reservations', { userId: 'buyer-1', body: { ...LEGACY_REQUEST, container_id: 'sail-future' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.reservation_status, 'REQUESTED');
  assert.equal(reservationRows().length, SEEDED_RESERVATIONS + 1);
});

test('legacy: a soft-deleted sailing cannot be booked — the lookup honours deleted_at', async () => {
  const res = await call('POST', '/api/diaspora/reservations', { userId: 'buyer-1', body: { ...LEGACY_REQUEST, container_id: 'sail-deleted' } });
  assert.equal(res.status, 404);
  assert.match(res.body.error.message, /container shipment not found/i);
  assert.equal(reservationRows().length, SEEDED_RESERVATIONS);
});

test('legacy: the not-open refusal is kept exactly as it was', async () => {
  const res = await call('POST', '/api/diaspora/reservations', { userId: 'buyer-1', body: { ...LEGACY_REQUEST, container_id: 'sail-closed' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  assert.equal(res.body.error.message, 'This container is not open for booking.');
});

// ── F-023: GET /api/diaspora/containers ─────────────────────────────────────

test('F-023: a participant lists only open, live, bookable sailings — never a DRAFT, a closed, a departed, an expired or a deleted one', async () => {
  const all = await call('GET', '/api/diaspora/containers', { userId: 'stranger-1' });
  assert.equal(all.status, 200);
  assert.deepEqual(ids(all.body.data), ['sail-coord', 'sail-future']);
  assert.ok(all.body.data.every((row) => row.status === 'BOOKING_OPEN' && row.booking_eligibility?.bookable === true));
  assert.ok(!all.text.includes('sail-draft'), 'a DRAFT never reaches a participant');

  for (const status of ['DRAFT', 'BOOKING_CLOSED', 'LOADING', 'CANCELLED']) {
    const filtered = await call('GET', `/api/diaspora/containers?status=${status}`, { userId: 'stranger-1' });
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body.data, [], `?status=${status} must not reopen the operator's working state`);
  }
});

test('F-023: the existing callers keep working — the web booking picker and the native count', async () => {
  // web/src/hooks/useCarUpApi.ts fetchDiasporaOpenContainers
  const picker = await call('GET', '/api/diaspora/containers?status=BOOKING_OPEN', { userId: 'buyer-1' });
  assert.equal(picker.status, 200);
  assert.deepEqual(ids(picker.body.data), ['sail-coord', 'sail-future']);
  // mobile/utils/tradeApi.ts getTradeGatewaySnapshot — reads the array for a count
  const native = await call('GET', '/api/diaspora/containers?limit=20', { userId: 'buyer-1' });
  assert.equal(native.status, 200);
  assert.ok(Array.isArray(native.body.data));
  assert.equal(native.body.data.length, 2);
});

test('F-023: a tenant admin gets the participant list here too — operator working state lives in the marketplace', async () => {
  const res = await call('GET', '/api/diaspora/containers', { userId: 'op-1', tenantId: TENANT_OP });
  assert.equal(res.status, 200);
  assert.deepEqual(ids(res.body.data), ['sail-coord', 'sail-future']);
  const drafts = await call('GET', '/api/diaspora/containers?status=DRAFT', { userId: 'op-1', tenantId: TENANT_OP });
  assert.deepEqual(drafts.body.data, []);
});

test('F-023: a platform reviewer keeps the full operator view, annotated', async () => {
  const res = await call('GET', '/api/diaspora/containers', { userId: 'rev-1' });
  assert.equal(res.status, 200);
  assert.deepEqual(ids(res.body.data), ['sail-closed', 'sail-coord', 'sail-cutoff', 'sail-departed', 'sail-draft', 'sail-future'],
    'every non-deleted sailing, any status');
  const byId = new Map(res.body.data.map((row) => [row.id, row]));
  assert.equal(byId.get('sail-departed').booking_eligibility.state, 'departed');
  assert.equal(byId.get('sail-cutoff').booking_eligibility.state, 'deadline_passed');
  assert.equal(byId.get('sail-draft').booking_eligibility.state, 'not_open');
  const drafts = await call('GET', '/api/diaspora/containers?status=DRAFT', { userId: 'padmin-1' });
  assert.deepEqual(ids(drafts.body.data), ['sail-draft']);
});

// ── F-023: GET /api/diaspora/containers/:id ─────────────────────────────────

test('F-023: a stranger reading a sailing sees NO participant\'s reservation', async () => {
  const res = await call('GET', '/api/diaspora/containers/sail-future', { userId: 'stranger-1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'sail-future');
  assert.deepEqual(res.body.diaspora_cargo_reservations, []);
  for (const values of Object.values(PRIVATE)) {
    for (const value of values) assert.ok(!res.text.includes(value), `private value leaked to a stranger: ${value}`);
  }
});

test('F-023: a participant sees only their OWN reservation on a shared sailing — every row checked', async () => {
  const one = await call('GET', '/api/diaspora/containers/sail-future', { userId: 'buyer-1' });
  assert.equal(one.status, 200);
  assert.deepEqual(assertOnlyOwnReservations(one, 'buyer-1').map((row) => row.id), ['res-b1']);

  const two = await call('GET', '/api/diaspora/containers/sail-future', { userId: 'buyer-2' });
  assert.deepEqual(assertOnlyOwnReservations(two, 'buyer-2').map((row) => row.id), ['res-b2'],
    'a soft-deleted reservation is not embedded either');
});

test('F-023: the sailing\'s operators see the whole manifest — and a rival organisation does not', async () => {
  for (const [userId, tenantId] of [['op-1', TENANT_OP], ['padmin-1', null], ['rev-1', null]]) {
    const res = await call('GET', '/api/diaspora/containers/sail-future', { userId, tenantId });
    assert.equal(res.status, 200, userId);
    assert.deepEqual(ids(res.body.diaspora_cargo_reservations), ['res-b1', 'res-b2'], `${userId} operates this sailing`);
  }
  const coordinator = await call('GET', '/api/diaspora/containers/sail-coord', { userId: 'coord-1' });
  assert.deepEqual(ids(coordinator.body.diaspora_cargo_reservations), ['res-c1'], 'the coordinator runs its own sailing');

  const rival = await call('GET', '/api/diaspora/containers/sail-future', { userId: 'rival-1', tenantId: TENANT_RIVAL });
  assert.equal(rival.status, 200);
  assert.deepEqual(rival.body.diaspora_cargo_reservations, [], 'another organisation is a stranger to this manifest');
});

test('F-023: a DRAFT does not exist for a participant; a deleted sailing does not exist for anyone', async () => {
  assert.equal((await call('GET', '/api/diaspora/containers/sail-draft', { userId: 'stranger-1' })).status, 404);
  assert.equal((await call('GET', '/api/diaspora/containers/sail-draft', { userId: 'op-1', tenantId: TENANT_OP })).status, 200);
  assert.equal((await call('GET', '/api/diaspora/containers/sail-deleted', { userId: 'padmin-1' })).status, 404);
});

test('F-023: the single read carries the booking window too', async () => {
  const res = await call('GET', '/api/diaspora/containers/sail-cutoff', { userId: 'stranger-1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.booking_eligibility.state, 'deadline_passed');
  assert.equal(res.body.booking_eligibility.bookable, false);
});

test('the legacy lifecycle transitions still read the sailing they move', async () => {
  const opened = await call('POST', '/api/diaspora/containers/sail-draft/open-booking', { userId: 'rev-1' });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.status, 'BOOKING_OPEN');
  assert.equal((await call('POST', '/api/diaspora/containers/sail-draft/open-booking', { userId: 'stranger-1' })).status, 403);
});
