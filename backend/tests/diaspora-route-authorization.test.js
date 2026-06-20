/**
 * H4 — backend route authorization. Drives the REAL diaspora router (real authorizeRole middleware)
 * over HTTP with a mocked Supabase, proving the Phase 3-7 route allowlists: disallowed authenticated
 * roles get 403, allowed roles pass the gate, spoofed x-stakeholder-role cannot escalate, and a
 * cross-tenant x-tenant-id is rejected.
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
      'seller-1': { id: 'seller-1', role: 'dealer', is_verified: true },
      'reviewer-1': { id: 'reviewer-1', role: 'reviewer', is_verified: true },
      'mech-1': { id: 'mech-1', role: 'mechanic', is_verified: true },
    },
    tenantUsers: {}, // no memberships → any x-tenant-id is rejected by the middleware
  };
}

function makeBuilder(table) {
  const state = { table, op: 'select', single: false, filters: {}, payload: undefined };
  const chain = {
    select() { return chain }, insert(p) { state.op = 'insert'; state.payload = p; return chain },
    update(p) { state.op = 'update'; state.payload = p; return chain }, delete() { state.op = 'delete'; return chain },
    eq(k, v) { state.filters[k] = v; return chain }, neq() { return chain }, is() { return chain },
    in() { return chain }, or() { return chain }, order() { return chain }, range() { return chain },
    limit() { return chain }, gte() { return chain }, lte() { return chain }, not() { return chain },
    single() { state.single = true; return chain }, maybeSingle() { state.single = true; return chain },
    then(resolve, reject) {
      try { return Promise.resolve(resolve_(state)).then(resolve, reject) } catch (e) { return reject ? reject(e) : Promise.reject(e) }
    },
  };
  return chain;
}

function resolve_(state) {
  const ok = (data) => ({ data, error: null });
  const missing = (msg) => ({ data: null, error: { message: msg, code: 'PGRST116' } });
  switch (state.table) {
    case 'user_sessions': return missing('no session (test uses x-user-id fallback)');
    case 'users': return db.users[state.filters.id] ? ok(db.users[state.filters.id]) : missing('user not found');
    case 'tenant_users': {
      const key = `${state.filters.tenant_id}|${state.filters.user_id}`;
      return db.tenantUsers[key] ? ok(db.tenantUsers[key]) : missing('no membership');
    }
    default:
      if (state.op === 'insert') return ok({ id: `mock-${state.table}`, metadata: {}, ...(state.payload || {}) });
      if (state.single) return ok({ id: 'mock', metadata: {} });
      return ok([]);
  }
}

let server; let baseUrl;
before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => makeBuilder(t) });
  // RPC routes pass the gate then return a sanitized 4xx (proves the route gate, not service success).
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: async () => ({ data: null, error: { message: 'DIASPORA_TEST/GATE_PASSED' } }) });
  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRouter);
  app.use(errorHandler);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

async function req(method, path, { userId, role, tenantId, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (role) headers['x-stakeholder-role'] = role;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status };
}
const notForbidden = (s) => s !== 401 && s !== 403;

test('unauthenticated requests are rejected (401)', async () => {
  assert.equal((await req('POST', '/api/diaspora/stock', { body: { part_name: 'x' } })).status, 401);
  assert.equal((await req('GET', '/api/diaspora/buyer-orders', {})).status, 401);
});

test('stock routes are seller-scoped: owner/mechanic denied, dealer allowed', async () => {
  assert.equal((await req('POST', '/api/diaspora/stock', { userId: 'buyer-1', body: { part_name: 'x' } })).status, 403);
  assert.equal((await req('POST', '/api/diaspora/stock', { userId: 'mech-1', body: { part_name: 'x' } })).status, 403);
  assert.ok(notForbidden((await req('POST', '/api/diaspora/stock', { userId: 'seller-1', body: { part_name: 'x' } })).status));
});

test('buyer-order routes are buyer-scoped: dealer denied, owner allowed', async () => {
  assert.equal((await req('POST', '/api/diaspora/buyer-orders', { userId: 'seller-1', body: { order_type: 'parts', origin_country: 'Japan' } })).status, 403);
  assert.ok(notForbidden((await req('POST', '/api/diaspora/buyer-orders', { userId: 'buyer-1', body: { order_type: 'parts', origin_country: 'Japan' } })).status));
  // accept-quote is buyer-only
  assert.equal((await req('POST', '/api/diaspora/buyer-orders/ord-1/accept-quote', { userId: 'seller-1', body: { quoteId: 'q1' } })).status, 403);
});

test('rfq/quote routes are seller-scoped: owner denied, dealer allowed', async () => {
  assert.equal((await req('GET', '/api/diaspora/rfqs', { userId: 'buyer-1' })).status, 403);
  assert.ok(notForbidden((await req('GET', '/api/diaspora/rfqs', { userId: 'seller-1' })).status));
});

test('container create/approve are reviewer-only', async () => {
  assert.equal((await req('POST', '/api/diaspora/container-marketplace/containers', { userId: 'buyer-1', body: { total_capacity_volume: 10 } })).status, 403);
  assert.ok(notForbidden((await req('POST', '/api/diaspora/container-marketplace/containers', { userId: 'reviewer-1', body: { total_capacity_volume: 10 } })).status));
  assert.equal((await req('POST', '/api/diaspora/container-marketplace/reservations/res-1/approve', { userId: 'buyer-1' })).status, 403);
  assert.equal((await req('POST', '/api/diaspora/container-marketplace/reservations/res-1/approve', { userId: 'seller-1' })).status, 403);
  assert.ok(notForbidden((await req('POST', '/api/diaspora/container-marketplace/reservations/res-1/approve', { userId: 'reviewer-1' })).status));
  // participants may still browse + request
  assert.ok(notForbidden((await req('GET', '/api/diaspora/container-marketplace/containers', { userId: 'buyer-1' })).status));
});

test('ai-command approve is reviewer-only; participants may create', async () => {
  assert.equal((await req('POST', '/api/diaspora/ai-commands/cmd-1/approve', { userId: 'seller-1' })).status, 403);
  assert.ok(notForbidden((await req('POST', '/api/diaspora/ai-commands/cmd-1/approve', { userId: 'reviewer-1' })).status));
  assert.ok(notForbidden((await req('POST', '/api/diaspora/ai-commands', { userId: 'seller-1', body: { rawCommand: 'add note hi' } })).status));
});

test('a spoofed x-stakeholder-role cannot escalate a dealer to a reviewer route', async () => {
  const { status } = await req('POST', '/api/diaspora/container-marketplace/containers', { userId: 'seller-1', role: 'admin', body: { total_capacity_volume: 10 } });
  assert.equal(status, 403);
});

test('a cross-tenant x-tenant-id (non-member) is rejected', async () => {
  assert.equal((await req('GET', '/api/diaspora/buyer-orders', { userId: 'buyer-1', tenantId: 'tenantX' })).status, 403);
});
