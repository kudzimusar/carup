/**
 * O2 — K5: the workbook execute authority under a REAL VALIDATED SESSION.
 *
 * `o2-j-round-workbook-route.test.js` genuinely crosses the Express router, but it authenticates
 * with the `NODE_ENV=test` `x-user-id` fallback. That proves `router + authorizeRole under the test
 * fallback` — not the production identity derivation. The missing link is the one that actually
 * runs in production: a `user_sessions` token is looked up, validated for `is_valid` and
 * `expires_at`, and only then becomes `req.userContext`.
 *
 * This suite supplies that. Every case below authenticates with `x-session-token` against a real
 * session row; the fallback is exercised only to prove where policy forbids it.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const workbookRouter = (await import('../routes/workbookRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { authorizeSessionRole } = await import('../middleware/authMiddleware.js');

const DEALERSHIP = 'tenant-moyo-motors';
const GARAGE = 'tenant-garage-1';
const BATCH = 'batch-k5';
const HOUR = 3600 * 1000;

let db;
function resetDb() {
  const future = new Date(Date.now() + HOUR).toISOString();
  const past = new Date(Date.now() - HOUR).toISOString();
  db = {
    sessions: {
      'tok-owner': { user_id: 'u-owner', is_valid: true, expires_at: future },
      'tok-dealer': { user_id: 'u-dealer', is_valid: true, expires_at: future },
      'tok-dealer-garage': { user_id: 'u-dealer-garage', is_valid: true, expires_at: future },
      'tok-expired': { user_id: 'u-dealer', is_valid: true, expires_at: past },
      'tok-revoked': { user_id: 'u-dealer', is_valid: false, expires_at: future },
    },
    users: {
      'u-owner': { id: 'u-owner', role: 'owner', is_verified: true },
      'u-dealer': { id: 'u-dealer', role: 'dealer', is_verified: true },
      'u-dealer-garage': { id: 'u-dealer-garage', role: 'dealer', is_verified: true },
    },
    tenantUsers: {
      [`${DEALERSHIP}|u-dealer`]: { role: 'admin' },
      [`${GARAGE}|u-dealer-garage`]: { role: 'admin' },
    },
    tenants: {
      [DEALERSHIP]: { id: DEALERSHIP, type: 'dealership', status: 'active' },
      [GARAGE]: { id: GARAGE, type: 'garage', status: 'active' },
    },
    dealerProfiles: [],
  };
}

function makeBuilder(table) {
  const f = {};
  let single = false;
  const chain = {
    select() { return chain; }, insert() { return chain; }, update() { return chain; }, delete() { return chain; },
    eq(k, v) { f[k] = v; return chain; }, neq() { return chain; }, is() { return chain; }, in() { return chain; },
    or() { return chain; }, order() { return chain; }, range() { return chain; }, limit() { return chain; },
    gte() { return chain; }, lte() { return chain; }, not() { return chain; },
    single() { single = true; return chain; }, maybeSingle() { single = true; return chain; },
    then(resolve, reject) {
      try { return Promise.resolve(resolve_(table, f, single)).then(resolve, reject); }
      catch (e) { return reject ? reject(e) : Promise.reject(e); }
    },
  };
  return chain;
}

function resolve_(table, f, single) {
  const ok = (data) => ({ data, error: null });
  const missing = (msg) => ({ data: null, error: { message: msg, code: 'PGRST116' } });
  switch (table) {
    // THE PRODUCTION IDENTITY PATH. This is the row `authorizeRole` actually reads.
    case 'user_sessions': return db.sessions[f.token] ? ok(db.sessions[f.token]) : missing('no such session');
    case 'users': return db.users[f.id] ? ok(db.users[f.id]) : missing('user not found');
    case 'tenant_users': {
      const hit = db.tenantUsers[`${f.tenant_id}|${f.user_id}`];
      return hit ? ok(hit) : missing('no membership');
    }
    case 'dealer_profiles': {
      const hit = db.dealerProfiles.find((p) => p.user_id === f.user_id);
      return hit ? ok(hit) : ok(null);
    }
    case 'tenants': return ok(db.tenants[f.id] || null);
    case 'diaspora_workbook_import_batches': {
      if (f.id !== BATCH) return ok([]);
      const batch = { id: BATCH, uploaded_by: f.uploaded_by, template_type: 'seller_vehicles', import_status: 'VALIDATED', tenant_id: null };
      return single ? ok(batch) : ok([batch]);
    }
    case 'diaspora_workbook_import_rows': return ok([]);
    default:
      if (single) return ok({ id: 'mock', metadata: {} });
      return ok([]);
  }
}

let server; let baseUrl;
before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => makeBuilder(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: async () => ({ data: null, error: null }) });
  const app = express();
  app.use(express.json());
  app.use(workbookRouter);
  // A route that refuses the x-user-id fallback, mounted the way a consequential action is.
  app.post('/api/k5/session-only', authorizeSessionRole(), (req, res) => res.json({ ok: true, id: req.userContext.id }));
  app.use(errorHandler);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

async function post(path, { token, userId, tenantId, body = { confirm: true } } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-session-token'] = token;
  if (userId) headers['x-user-id'] = userId;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  let parsed = {};
  try { parsed = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, body: parsed };
}
const execute = (opts) => post(`/api/workbook/import-batches/${BATCH}/execute`, opts);
const noSubject = (r) => r.status === 400 && /no_listing_subject/.test(JSON.stringify(r.body));

test('K5: an OWNER with a VALID SESSION reaches execute', async () => {
  const r = await execute({ token: 'tok-owner' });
  assert.equal(r.status, 200, `got ${r.status} ${JSON.stringify(r.body)}`);
});

test('K5: a legitimate DEALER with a valid session + its dealership tenant reaches execute', async () => {
  const r = await execute({ token: 'tok-dealer', tenantId: DEALERSHIP });
  assert.equal(r.status, 200, `got ${r.status} ${JSON.stringify(r.body)}`);
});

test('K5: the SAME session against a NON-dealership tenant has no listing subject', async () => {
  const r = await execute({ token: 'tok-dealer-garage', tenantId: GARAGE });
  assert.ok(noSubject(r), `a garage is not a dealership; got ${r.status} ${JSON.stringify(r.body)}`);
});

test('K5: the same valid session sending a tenant it does not belong to is refused (403)', async () => {
  const r = await execute({ token: 'tok-dealer', tenantId: GARAGE });
  assert.equal(r.status, 403, 'membership is re-verified per request, not carried by the session');
});

test('K5: an EXPIRED session is refused (401) — the session, not the header, is the identity', async () => {
  const r = await execute({ token: 'tok-expired', tenantId: DEALERSHIP });
  assert.equal(r.status, 401);
});

test('K5: a REVOKED session (is_valid=false) is refused (401)', async () => {
  const r = await execute({ token: 'tok-revoked', tenantId: DEALERSHIP });
  assert.equal(r.status, 401);
});

test('K5: an UNKNOWN session token is refused (401)', async () => {
  const r = await execute({ token: 'tok-does-not-exist' });
  assert.equal(r.status, 401);
});

test('K5: an asserted x-user-id CANNOT replace a session where policy forbids it', async () => {
  // The same identity that works as a session must NOT work as a bare assertion on a route that
  // requires a proven one — otherwise the session check is decorative.
  const asserted = await post('/api/k5/session-only', { userId: 'u-dealer' });
  assert.equal(asserted.status, 401, 'x-user-id must not satisfy a session-only route');
  const withSession = await post('/api/k5/session-only', { token: 'tok-dealer' });
  assert.equal(withSession.status, 200, 'and the real session must still work — proving the negative is meaningful');
  assert.equal(withSession.body.id, 'u-dealer');
});

test('K5: a valid session cannot be escalated by a spoofed stakeholder role', async () => {
  const res = await fetch(`${baseUrl}/api/workbook/import-batches/${BATCH}/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-session-token': 'tok-dealer-garage',
      'x-tenant-id': GARAGE,
      'x-stakeholder-role': 'dealer',
    },
    body: JSON.stringify({ confirm: true }),
  });
  let body = {}; try { body = await res.json(); } catch { /* ignore */ }
  assert.ok(res.status === 400 || res.status === 403,
    `asking for a role cannot manufacture a dealership; got ${res.status} ${JSON.stringify(body)}`);
});
