/**
 * Backend authorization tests for Diaspora shipment and timeline by-id read scoping.
 *
 * Drives the REAL diaspora router + authorizeRole + services over HTTP with a mocked Supabase.
 * Proves that:
 * - owner buyer can read own shipment by id
 * - owner buyer can read own shipment timeline
 * - unrelated buyer cannot read another buyer shipment
 * - unrelated buyer cannot read another buyer timeline
 * - spoofed role cannot read protected shipment
 * - reviewer/admin can read shipment
 * - tenant admin can read same-tenant shipment
 * - tenant admin cannot read other-tenant shipment
 * - missing shipment safe error
 * - timeline missing shipment safe error
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
      'buyer-2': { id: 'buyer-2', role: 'owner', is_verified: true }, // unrelated buyer
      'reviewer-1': { id: 'reviewer-1', role: 'reviewer', is_verified: true },
      'tadminA-1': { id: 'tadminA-1', role: 'owner', is_verified: true },
      'tadminB-1': { id: 'tadminB-1', role: 'owner', is_verified: true },
    },
    tenantUsers: {
      'tenantA|tadminA-1': { role: 'admin' },
      'tenantB|tadminB-1': { role: 'admin' },
    },
    orders: {
      'order-1': { id: 'order-1', tenant_id: 'tenantA', buyer_id: 'buyer-1', created_by: 'buyer-1', status: 'DOCUMENTS_VERIFIED' }
    },
    participants: {},
    shipments: {
      'ship-1': { id: 'ship-1', tenant_id: 'tenantA', import_order_id: 'order-1', status: 'PLANNED' }
    },
    shipmentTimelineEvents: {
      'evt-1': { id: 'evt-1', shipment_id: 'ship-1', stage: 'PLANNED', notes: 'Created', event_time: '2026-06-11T12:00:00Z' }
    },
  };
}

function makeBuilder(table) {
  const state = { table, op: 'select', single: false, filters: {}, payload: undefined };
  const chain = {
    select() { return chain },
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
      try {
        return Promise.resolve(resolve_(state)).then(resolve, reject);
      } catch (e) {
        return reject ? reject(e) : Promise.reject(e);
      }
    },
  };
  return chain;
}

function resolve_(state) {
  const { table, op, single, filters, payload } = state;
  const ok = (data) => ({ data, error: null });
  const missing = (m) => ({ data: null, error: { message: m } });

  switch (table) {
    case 'user_sessions': return missing('no session');
    case 'users':
      return db.users[filters.id] ? ok(db.users[filters.id]) : missing('no user');
    case 'tenant_users':
      return db.tenantUsers[`${filters.tenant_id}|${filters.user_id}`]
        ? ok(db.tenantUsers[`${filters.tenant_id}|${filters.user_id}`])
        : missing('no membership');
    case 'diaspora_import_orders':
      return db.orders[filters.id] ? ok(db.orders[filters.id]) : missing('order not found');
    case 'diaspora_import_order_participants':
      return ok(db.participants[filters.import_order_id] || []);
    case 'diaspora_shipments':
      if (single) return db.shipments[filters.id] ? ok(db.shipments[filters.id]) : missing('shipment not found');
      return ok(Object.values(db.shipments));
    case 'diaspora_shipment_stage_events':
      return ok(Object.values(db.shipmentTimelineEvents).filter(e => e.shipment_id === filters.shipment_id));
    default:
      if (single) return ok({});
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

// --- Tests ------------------------------------------------------------------

test('owner buyer can read own shipment by id (200)', async () => {
  const { status, body } = await call('GET', '/api/diaspora/shipments/ship-1', { userId: 'buyer-1' });
  assert.equal(status, 200);
  assert.equal(body.id, 'ship-1');
});

test('owner buyer can read own shipment timeline (200)', async () => {
  const { status, body } = await call('GET', '/api/diaspora/shipments/ship-1/timeline', { userId: 'buyer-1' });
  assert.equal(status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].id, 'evt-1');
});

test('unrelated buyer cannot read another buyer shipment (403)', async () => {
  const { status } = await call('GET', '/api/diaspora/shipments/ship-1', { userId: 'buyer-2' });
  assert.equal(status, 403);
});

test('unrelated buyer cannot read another buyer timeline (403)', async () => {
  const { status } = await call('GET', '/api/diaspora/shipments/ship-1/timeline', { userId: 'buyer-2' });
  assert.equal(status, 403);
});

test('spoofed role cannot read protected shipment (403)', async () => {
  // buyer-2 trying to request 'reviewer' or 'admin' role
  const { status } = await call('GET', '/api/diaspora/shipments/ship-1', { userId: 'buyer-2', role: 'admin' });
  assert.equal(status, 403);
});

test('reviewer/admin can read shipment (200)', async () => {
  const { status, body } = await call('GET', '/api/diaspora/shipments/ship-1', { userId: 'reviewer-1' });
  assert.equal(status, 200);
  assert.equal(body.id, 'ship-1');
});

test('tenant admin can read same-tenant shipment (200)', async () => {
  const { status, body } = await call('GET', '/api/diaspora/shipments/ship-1', { userId: 'tadminA-1', tenantId: 'tenantA' });
  assert.equal(status, 200);
  assert.equal(body.id, 'ship-1');
});

test('tenant admin cannot read other-tenant shipment (403)', async () => {
  const { status } = await call('GET', '/api/diaspora/shipments/ship-1', { userId: 'tadminB-1', tenantId: 'tenantB' });
  assert.equal(status, 403);
});

test('missing shipment returns safe 404', async () => {
  const { status } = await call('GET', '/api/diaspora/shipments/ship-zzz', { userId: 'reviewer-1' });
  assert.equal(status, 404);
});

test('timeline of missing shipment returns safe 404', async () => {
  const { status } = await call('GET', '/api/diaspora/shipments/ship-zzz/timeline', { userId: 'reviewer-1' });
  assert.equal(status, 404);
});
