/**
 * Backend authorization tests for Diaspora logistics lifecycle mutations
 * (container create/transition, shipment create, shipment stage update).
 *
 * Drives the REAL diaspora router + authorizeRole + services over HTTP with a mocked Supabase.
 * Proves buyers cannot perform logistics mutations, spoofed roles cannot escalate, tenant mismatch
 * is rejected, trusted admin/reviewer can mutate, and errors are safe (403/404/400).
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

let db;
function resetDb() {
  db = {
    users: {
      'buyer-1': { id: 'buyer-1', role: 'owner', is_verified: true },
      'reviewer-1': { id: 'reviewer-1', role: 'reviewer', is_verified: true },
      'tadminB-1': { id: 'tadminB-1', role: 'owner', is_verified: true },
    },
    tenantUsers: { 'tenantB|tadminB-1': { role: 'admin' } },
    orders: { 'order-1': { id: 'order-1', tenant_id: 'tenantA', buyer_id: 'buyer-1', created_by: 'buyer-1', status: 'DOCUMENTS_VERIFIED' } },
    participants: {},
    containers: { 'cont-A': { id: 'cont-A', tenant_id: 'tenantA', status: 'DRAFT', total_capacity_volume: 30, used_capacity_volume: 0, available_capacity_volume: 30 } },
    shipments: { 'ship-1': { id: 'ship-1', tenant_id: 'tenantA', import_order_id: 'order-1', status: 'PLANNED' } },
  };
}

function makeBuilder(table) {
  const state = { table, op: 'select', single: false, filters: {}, payload: undefined };
  const chain = {
    select() { return chain }, insert(p) { state.op = 'insert'; state.payload = p; return chain },
    update(p) { state.op = 'update'; state.payload = p; return chain }, delete() { state.op = 'delete'; return chain },
    eq(k, v) { state.filters[k] = v; return chain }, neq() { return chain }, is() { return chain }, in() { return chain }, or() { return chain },
    order() { return chain }, range() { return chain }, limit() { return chain },
    single() { state.single = true; return chain }, maybeSingle() { state.single = true; return chain },
    then(resolve, reject) { try { return Promise.resolve(resolve_(state)).then(resolve, reject) } catch (e) { return reject ? reject(e) : Promise.reject(e) } },
  };
  return chain;
}

function resolve_(state) {
  const { table, op, single, filters, payload } = state;
  const ok = (data) => ({ data, error: null });
  const missing = (m) => ({ data: null, error: { message: m } });
  switch (table) {
    case 'user_sessions': return missing('no session');
    case 'users': return db.users[filters.id] ? ok(db.users[filters.id]) : missing('no user');
    case 'tenant_users': return db.tenantUsers[`${filters.tenant_id}|${filters.user_id}`] ? ok(db.tenantUsers[`${filters.tenant_id}|${filters.user_id}`]) : missing('no membership');
    case 'diaspora_import_orders':
      if (op === 'update') return ok({ ...(db.orders[filters.id] || {}), ...(payload || {}) });
      return db.orders[filters.id] ? ok(db.orders[filters.id]) : missing('order not found');
    case 'diaspora_import_order_participants': return ok(db.participants[filters.import_order_id] || []);
    case 'diaspora_container_shipments':
      if (op === 'insert') return ok({ id: 'cont-new', status: 'DRAFT', ...(payload || {}) });
      if (op === 'update') return ok({ ...(db.containers[filters.id] || {}), ...(payload || {}) });
      return db.containers[filters.id] ? ok(db.containers[filters.id]) : missing('container not found');
    case 'diaspora_shipments':
      if (op === 'insert') return ok({ id: 'ship-new', ...(payload || {}) });
      if (op === 'update') return ok({ ...(db.shipments[filters.id] || {}), ...(payload || {}) });
      if (single) return db.shipments[filters.id] ? ok(db.shipments[filters.id]) : missing('shipment not found');
      return ok(Object.values(db.shipments).filter((s) => !filters.import_order_id || s.import_order_id === filters.import_order_id));
    case 'diaspora_shipment_stage_events': return ok({ id: 'evt-1', ...(payload || {}) });
    default:
      if (single) return ok({});
      if (op === 'insert') return ok({ id: 'mock', ...(payload || {}) });
      return ok([]);
  }
}

let server; let baseUrl;
before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => makeBuilder(t) });
  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

function hdr(userId, { role, tenantId } = {}) {
  const h = { 'content-type': 'application/json' };
  if (userId) h['x-user-id'] = userId;
  if (role) h['x-stakeholder-role'] = role;
  if (tenantId) h['x-tenant-id'] = tenantId;
  return h;
}
async function call(method, path, { userId, role, tenantId, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: hdr(userId, { role, tenantId }), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const CONTAINER = { origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare', departure_date: '2026-07-01', booking_deadline: '2026-06-20', container_type: '40ft', total_capacity_volume: 30 };

// --- Buyer cannot perform logistics mutations -------------------------------

test('buyer cannot create a container (403)', async () => {
  assert.equal((await call('POST', '/api/diaspora/containers', { userId: 'buyer-1', body: CONTAINER })).status, 403);
});

test('buyer cannot transition a container (403)', async () => {
  assert.equal((await call('POST', '/api/diaspora/containers/cont-A/open-booking', { userId: 'buyer-1' })).status, 403);
});

test('buyer cannot create a shipment, even for their own order (403)', async () => {
  assert.equal((await call('POST', '/api/diaspora/shipments', { userId: 'buyer-1', body: { import_order_id: 'order-1' } })).status, 403);
});

test('buyer cannot update shipment stage (403)', async () => {
  assert.equal((await call('PATCH', '/api/diaspora/shipments/ship-1/stage', { userId: 'buyer-1', body: { stage: 'IN_TRANSIT' } })).status, 403);
});

// --- Spoofed role -----------------------------------------------------------

test('spoofed x-stakeholder-role does not grant logistics authority (403)', async () => {
  assert.equal((await call('POST', '/api/diaspora/containers', { userId: 'buyer-1', role: 'admin', body: CONTAINER })).status, 403);
  assert.equal((await call('PATCH', '/api/diaspora/shipments/ship-1/stage', { userId: 'buyer-1', role: 'admin', body: { stage: 'IN_TRANSIT' } })).status, 403);
});

// --- Trusted reviewer/admin can mutate --------------------------------------

test('a trusted reviewer can create a container (201)', async () => {
  assert.equal((await call('POST', '/api/diaspora/containers', { userId: 'reviewer-1', body: CONTAINER })).status, 201);
});

test('a trusted reviewer can transition a container (200)', async () => {
  const { status } = await call('POST', '/api/diaspora/containers/cont-A/open-booking', { userId: 'reviewer-1' });
  assert.equal(status, 200);
});

test('a trusted reviewer can create a shipment for an order (201)', async () => {
  assert.equal((await call('POST', '/api/diaspora/shipments', { userId: 'reviewer-1', body: { import_order_id: 'order-1' } })).status, 201);
});

test('a trusted reviewer can update shipment stage (200)', async () => {
  const { status } = await call('PATCH', '/api/diaspora/shipments/ship-1/stage', { userId: 'reviewer-1', body: { stage: 'IN_TRANSIT' } });
  assert.equal(status, 200);
});

// --- Tenant scoping ---------------------------------------------------------

test('tenant mismatch is rejected: tenant-B admin cannot transition a tenant-A container (403)', async () => {
  const { status } = await call('POST', '/api/diaspora/containers/cont-A/open-booking', { userId: 'tadminB-1', tenantId: 'tenantB' });
  assert.equal(status, 403);
});

// --- Safe errors ------------------------------------------------------------

test('transition of a missing container returns 404', async () => {
  assert.equal((await call('POST', '/api/diaspora/containers/cont-zzz/open-booking', { userId: 'reviewer-1' })).status, 404);
});

test('stage update of a missing shipment returns 404', async () => {
  assert.equal((await call('PATCH', '/api/diaspora/shipments/ship-zzz/stage', { userId: 'reviewer-1', body: { stage: 'IN_TRANSIT' } })).status, 404);
});

test('create shipment for a missing order returns 404', async () => {
  assert.equal((await call('POST', '/api/diaspora/shipments', { userId: 'reviewer-1', body: { import_order_id: 'order-zzz' } })).status, 404);
});

test('an illegal container transition returns 400', async () => {
  // cont-A is DRAFT; DRAFT -> SHIPPED (mark-shipped) is not allowed.
  const { status } = await call('POST', '/api/diaspora/containers/cont-A/mark-shipped', { userId: 'reviewer-1' });
  assert.equal(status, 400);
});

test('an invalid shipment stage returns 400', async () => {
  const { status } = await call('PATCH', '/api/diaspora/shipments/ship-1/stage', { userId: 'reviewer-1', body: { stage: 'NOT_A_STAGE' } });
  assert.equal(status, 400);
});
