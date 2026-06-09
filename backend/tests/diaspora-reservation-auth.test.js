/**
 * Backend authorization tests for Diaspora cargo reservations.
 *
 * Drives the REAL diaspora router (real authorizeRole middleware + real reservation service) over
 * HTTP with a mocked Supabase. Proves service-level authorization, not just UI gating:
 *  - unauthenticated list/create/approve/reject is rejected (401)
 *  - a buyer can list/create only for their own import order (403 otherwise)
 *  - buyers cannot approve/reject; reviewers/admins can
 *  - a spoofed x-stakeholder-role cannot escalate
 *  - tenant mismatch is rejected
 *  - safe errors for missing order/reservation, invalid/non-bookable container
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

// ---------------------------------------------------------------------------
// Mutable fixture DB
// ---------------------------------------------------------------------------
let db;
function resetDb() {
  db = {
    users: {
      'buyer-1': { id: 'buyer-1', role: 'owner', is_verified: true },
      'buyer-2': { id: 'buyer-2', role: 'owner', is_verified: true },
      'reviewer-1': { id: 'reviewer-1', role: 'reviewer', is_verified: true },
      'tadminB-1': { id: 'tadminB-1', role: 'owner', is_verified: true }, // platform role owner; tenant admin of tenantB
    },
    tenantUsers: {
      'tenantB|tadminB-1': { role: 'admin' },
    },
    orders: {
      'order-1': { id: 'order-1', tenant_id: 'tenantA', buyer_id: 'buyer-1', created_by: 'buyer-1', status: 'DOCUMENTS_VERIFIED' },
      'order-2': { id: 'order-2', tenant_id: 'tenantA', buyer_id: 'buyer-2', created_by: 'buyer-2', status: 'DOCUMENTS_VERIFIED' },
    },
    participants: {}, // importOrderId -> []
    containers: {
      'cont-open': { id: 'cont-open', tenant_id: 'tenantA', status: 'BOOKING_OPEN', total_capacity_volume: 20, used_capacity_volume: 0, available_capacity_volume: 20 },
      'cont-closed': { id: 'cont-closed', tenant_id: 'tenantA', status: 'BOOKING_CLOSED', total_capacity_volume: 20, used_capacity_volume: 0, available_capacity_volume: 20 },
    },
    reservations: {
      'res-1': { id: 'res-1', import_order_id: 'order-1', tenant_id: 'tenantA', buyer_id: 'buyer-1', created_by: 'buyer-1', container_id: 'cont-open', estimated_volume: 5, reservation_status: 'REQUESTED' },
    },
    reservationList: [{ id: 'res-1', import_order_id: 'order-1', reservation_status: 'REQUESTED' }],
  };
}

function makeBuilder(table) {
  const state = { table, op: 'select', single: false, filters: {}, payload: undefined };
  const chain = {
    select(_s, _o) { return chain },
    insert(p) { state.op = 'insert'; state.payload = p; return chain },
    update(p) { state.op = 'update'; state.payload = p; return chain },
    delete() { state.op = 'delete'; return chain },
    eq(k, v) { state.filters[k] = v; return chain },
    neq() { return chain },
    is() { return chain },
    in() { return chain },
    or() { return chain },
    order() { return chain },
    range() { return chain },
    limit() { return chain },
    single() { state.single = true; return chain },
    maybeSingle() { state.single = true; return chain },
    then(resolve, reject) {
      let result;
      try { result = resolve_(state) } catch (e) { return reject ? reject(e) : Promise.reject(e) }
      return Promise.resolve(result).then(resolve, reject)
    },
  };
  return chain;
}

function resolve_(state) {
  const { table, op, single, filters, payload } = state;
  const ok = (data) => ({ data, error: null });
  const missing = (msg) => ({ data: null, error: { message: msg } });

  switch (table) {
    case 'user_sessions':
      return missing('no session (test uses x-user-id fallback)');
    case 'users':
      return db.users[filters.id] ? ok(db.users[filters.id]) : missing('user not found');
    case 'tenant_users':
      return db.tenantUsers[`${filters.tenant_id}|${filters.user_id}`] ? ok(db.tenantUsers[`${filters.tenant_id}|${filters.user_id}`]) : missing('no tenant membership');
    case 'diaspora_import_orders':
      if (op === 'update') return ok({ ...(db.orders[filters.id] || {}), ...(payload || {}) });
      return db.orders[filters.id] ? ok(db.orders[filters.id]) : missing('order not found');
    case 'diaspora_import_order_participants':
      return ok(db.participants[filters.import_order_id] || []);
    case 'diaspora_container_shipments':
      if (op === 'update') return ok({ ...(db.containers[filters.id] || {}), ...(payload || {}) });
      return db.containers[filters.id] ? ok(db.containers[filters.id]) : missing('container not found');
    case 'diaspora_cargo_reservations':
      if (op === 'insert') return ok({ id: 'res-new', ...(payload || {}) });
      if (op === 'update') return ok({ id: filters.id, ...(payload || {}) });
      if (single) return db.reservations[filters.id] ? ok(db.reservations[filters.id]) : missing('reservation not found');
      return ok(db.reservationList);
    default:
      if (single) return ok({});
      if (op === 'insert') return ok({ id: 'mock', ...(payload || {}) });
      return ok([]);
  }
}

let server;
let baseUrl;

before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => makeBuilder(t) });

  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRouter);
  app.use(errorHandler);

  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

function headersFor(userId, { role, tenantId } = {}) {
  const h = { 'content-type': 'application/json' };
  if (userId) h['x-user-id'] = userId;
  if (role) h['x-stakeholder-role'] = role;
  if (tenantId) h['x-tenant-id'] = tenantId;
  return h;
}

async function req(method, path, { userId, role, tenantId, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: headersFor(userId, { role, tenantId }), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const RESERVATION = { container_id: 'cont-open', import_order_id: 'order-1', cargo_type: 'vehicle', estimated_volume: 5 };

// --- Unauthenticated --------------------------------------------------------

test('unauthenticated list/create/approve/reject are rejected (401)', async () => {
  assert.equal((await req('GET', '/api/diaspora/reservations?importOrderId=order-1', {})).status, 401);
  assert.equal((await req('POST', '/api/diaspora/reservations', { body: RESERVATION })).status, 401);
  assert.equal((await req('POST', '/api/diaspora/reservations/res-1/approve', {})).status, 401);
  assert.equal((await req('POST', '/api/diaspora/reservations/res-1/reject', {})).status, 401);
});

// --- Buyer list -------------------------------------------------------------

test('buyer can list reservations for their own import order', async () => {
  const { status, body } = await req('GET', '/api/diaspora/reservations?importOrderId=order-1', { userId: 'buyer-1' });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data));
});

test('buyer cannot list another buyer\'s order reservations (403)', async () => {
  const { status } = await req('GET', '/api/diaspora/reservations?importOrderId=order-2', { userId: 'buyer-1' });
  assert.equal(status, 403);
});

test('buyer must scope list by importOrderId (400 when missing)', async () => {
  const { status } = await req('GET', '/api/diaspora/reservations', { userId: 'buyer-1' });
  assert.equal(status, 400);
});

// --- Buyer create -----------------------------------------------------------

test('buyer can request a reservation for their own order (201)', async () => {
  const { status, body } = await req('POST', '/api/diaspora/reservations', { userId: 'buyer-1', body: RESERVATION });
  assert.equal(status, 201);
  assert.equal(body.reservation_status, 'REQUESTED');
  assert.equal(body.buyer_id, 'buyer-1');
});

test('buyer cannot create a reservation for another user\'s order (403)', async () => {
  const { status } = await req('POST', '/api/diaspora/reservations', { userId: 'buyer-1', body: { ...RESERVATION, import_order_id: 'order-2' } });
  assert.equal(status, 403);
});

// --- Approve / reject authorization ----------------------------------------

test('buyer cannot approve or reject reservations (403)', async () => {
  assert.equal((await req('POST', '/api/diaspora/reservations/res-1/approve', { userId: 'buyer-1' })).status, 403);
  assert.equal((await req('POST', '/api/diaspora/reservations/res-1/reject', { userId: 'buyer-1' })).status, 403);
});

test('spoofed x-stakeholder-role does not let a buyer approve (403)', async () => {
  const { status } = await req('POST', '/api/diaspora/reservations/res-1/approve', { userId: 'buyer-1', role: 'admin' });
  assert.equal(status, 403);
});

test('a trusted reviewer can approve a requested reservation (200)', async () => {
  const { status } = await req('POST', '/api/diaspora/reservations/res-1/approve', { userId: 'reviewer-1' });
  assert.equal(status, 200);
});

test('a trusted reviewer can reject a requested reservation (200)', async () => {
  const { status } = await req('POST', '/api/diaspora/reservations/res-1/reject', { userId: 'reviewer-1' });
  assert.equal(status, 200);
});

// --- Tenant scoping ---------------------------------------------------------

test('tenant mismatch is rejected: tenant-B admin cannot read tenant-A order reservations (403)', async () => {
  const { status } = await req('GET', '/api/diaspora/reservations?importOrderId=order-1', { userId: 'tadminB-1', tenantId: 'tenantB' });
  assert.equal(status, 403);
});

// --- Safe error handling ----------------------------------------------------

test('missing import order returns 404 (no leak)', async () => {
  const { status, body } = await req('GET', '/api/diaspora/reservations?importOrderId=order-zzz', { userId: 'buyer-1' });
  assert.equal(status, 404);
  assert.match(body.error?.message || body.error || '', /import order not found/i);
});

test('missing reservation on approve returns 404', async () => {
  const { status } = await req('POST', '/api/diaspora/reservations/res-zzz/approve', { userId: 'reviewer-1' });
  assert.equal(status, 404);
});

test('invalid container on create returns 404', async () => {
  const { status } = await req('POST', '/api/diaspora/reservations', { userId: 'buyer-1', body: { ...RESERVATION, container_id: 'cont-zzz' } });
  assert.equal(status, 404);
});

test('non-bookable container on create returns 400', async () => {
  const { status, body } = await req('POST', '/api/diaspora/reservations', { userId: 'buyer-1', body: { ...RESERVATION, container_id: 'cont-closed' } });
  assert.equal(status, 400);
  assert.match(body.error?.message || body.error || '', /not open for booking/i);
});
