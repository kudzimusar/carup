/**
 * Workstream B — Dealer Compliance route + authz boundary tests.
 *
 * Verifies routes are wired, dealer self-service is scoped to the caller's OWN profile
 * (a dealer cannot read another dealer's full profile), admin can record a governance
 * decision, the buyer summary is readable by any authenticated user without private fields,
 * and a suspend decision blocks publication via evaluateCompliance.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/dealerRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const svc = await import('../services/dealer/dealerComplianceService.js');

let db;
function resetDb() {
  db = {
    users: [
      { id: 'dealer-1', role: 'dealer', is_verified: true },
      { id: 'dealer-2', role: 'dealer', is_verified: true },
      { id: 'admin-1', role: 'admin', is_verified: true },
      { id: 'buyer-1', role: 'buyer', is_verified: true },
    ],
    dealer_profiles: [],
    dealer_branches: [],
    dealer_compliance_documents: [],
    dealer_compliance_requirements: [],
    dealer_compliance_decisions: [],
  };
}
const APPEND_ONLY = new Set(['dealer_compliance_decisions']);
let seq = 0;
function builder(table) {
  const st = { table, op: 'select', filters: {}, order: null, single: false, maybe: false, payload: null };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    delete() { st.op = 'delete'; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p) => ({ id: p.id || `${st.table}-${++seq}`, created_at: `2026-06-26T00:00:${String(seq % 60).padStart(2, '0')}.000Z`, ...p }));
    rows.push(...ins);
    return ok(st.single ? ins[0] : ins);
  }
  const match = (r) => Object.entries(st.filters).every(([k, v]) => r[k] === v);
  if (st.op === 'update') {
    if (APPEND_ONLY.has(st.table)) return { data: null, error: { message: `Append-only table ${st.table}: UPDATE is not permitted` } };
    const hit = rows.filter(match);
    hit.forEach((r) => Object.assign(r, st.payload));
    return ok(st.single ? hit[0] : hit);
  }
  if (st.op === 'delete') {
    if (APPEND_ONLY.has(st.table)) return { data: null, error: { message: `Append-only table ${st.table}: DELETE is not permitted` } };
    db[st.table] = rows.filter((r) => !match(r));
    return ok([]);
  }
  let out = rows.filter(match);
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
  return ok(out);
}

// authorizeRole resolves identity from x-user-id (test-mode fallback) against the mocked
// users table, so we drive auth by passing that header.
const app = (() => {
  const a = express();
  a.use(express.json());
  a.use(router);
  a.use(errorHandler);
  return a;
})();
function request(method, path, body, userId) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, () => {
      const { port } = srv.address();
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}), ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); });
      });
      req.on('error', (e) => { srv.close(); reject(e); });
      if (data) req.write(data);
      req.end();
    });
  });
}

before(() => { resetDb(); supabase.from = (t) => builder(t); });

test('dealer creates own profile (201) then reads it back', async () => {
  resetDb();
  const create = await request('POST', '/api/dealer/profile', { legal_name: 'Acme Motors', tenant_id: 't1' }, 'dealer-1');
  assert.equal(create.status, 201);
  assert.equal(create.body.profile.user_id, 'dealer-1');
  const read = await request('GET', '/api/dealer/profile', null, 'dealer-1');
  assert.equal(read.status, 200);
  assert.equal(read.body.profile.legal_name, 'Acme Motors');
});

test('dealer self-service is denied to a buyer (403)', async () => {
  resetDb();
  const res = await request('POST', '/api/dealer/profile', { legal_name: 'X' }, 'buyer-1');
  assert.equal(res.status, 403);
});

test('a dealer cannot read another dealer\'s full profile (cross-tenant isolation)', async () => {
  resetDb();
  // dealer-1 onboards; dealer-2 has NO profile.
  await request('POST', '/api/dealer/profile', { legal_name: 'Acme Motors', tenant_id: 't1' }, 'dealer-1');
  // dealer-2 hits the self-service profile route — it resolves by THEIR userId, so they get
  // their own (absent) profile, never dealer-1's. There is no dealer-facing route that takes
  // another dealer's id, so dealer-1's full profile is unreachable to dealer-2.
  const res = await request('GET', '/api/dealer/profile', null, 'dealer-2');
  assert.equal(res.status, 404);
  assert.equal(db.dealer_profiles.length, 1);
});

test('admin records a governance decision (suspend) and it appears in the ledger', async () => {
  resetDb();
  await request('POST', '/api/dealer/profile', { legal_name: 'Acme Motors', tenant_id: 't1' }, 'dealer-1');
  const dealerId = db.dealer_profiles[0].id;
  const res = await request('PATCH', `/api/admin/dealers/${dealerId}/decision`, { decision: 'suspend', reason: 'fraud' }, 'admin-1');
  assert.equal(res.status, 201);
  assert.equal(res.body.decision.decision, 'suspend');
  assert.equal(res.body.profile.suspension_state, 'suspended');
  assert.equal(db.dealer_compliance_decisions.length, 1);
});

test('admin decision with an invalid decision -> 400', async () => {
  resetDb();
  await request('POST', '/api/dealer/profile', { legal_name: 'Acme' }, 'dealer-1');
  const dealerId = db.dealer_profiles[0].id;
  const res = await request('PATCH', `/api/admin/dealers/${dealerId}/decision`, { decision: 'nuke' }, 'admin-1');
  assert.equal(res.status, 400);
});

test('admin decision is denied to a dealer (403)', async () => {
  resetDb();
  await request('POST', '/api/dealer/profile', { legal_name: 'Acme' }, 'dealer-1');
  const dealerId = db.dealer_profiles[0].id;
  const res = await request('PATCH', `/api/admin/dealers/${dealerId}/decision`, { decision: 'suspend' }, 'dealer-2');
  assert.equal(res.status, 403);
});

test('buyer summary returns 200 to a buyer and exposes NO private fields', async () => {
  resetDb();
  await request('POST', '/api/dealer/profile', { legal_name: 'Acme', responsible_person: 'Jane Private', physical_address: '42 Secret St' }, 'dealer-1');
  const dealerId = db.dealer_profiles[0].id;
  Object.assign(db.dealer_profiles[0], { active_state: 'active' });
  const res = await request('GET', `/api/dealers/${dealerId}/summary`, null, 'buyer-1');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.summary).sort(), ['compliance_review_date', 'evidence_completeness_band', 'status', 'unresolved_serious_complaints']);
  const blob = JSON.stringify(res.body.summary);
  for (const secret of ['Jane Private', '42 Secret St', 'responsible_person', 'physical_address']) {
    assert.ok(!blob.includes(secret), `buyer summary must not expose "${secret}"`);
  }
});

test('suspend blocks publication via evaluateCompliance', async () => {
  resetDb();
  await request('POST', '/api/dealer/profile', { legal_name: 'Acme' }, 'dealer-1');
  const dealerId = db.dealer_profiles[0].id;
  // Make it otherwise publishable, then suspend.
  Object.assign(db.dealer_profiles[0], { identity_status: 'verified', compliance_review_state: 'passed', active_state: 'active' });
  const before = await svc.evaluateCompliance(dealerId);
  assert.equal(before.can_publish, true);

  const res = await request('PATCH', `/api/admin/dealers/${dealerId}/decision`, { decision: 'suspend', reason: 'fraud' }, 'admin-1');
  assert.equal(res.status, 201);
  const after = await svc.evaluateCompliance(dealerId);
  assert.equal(after.can_publish, false);
  assert.equal(after.suspension_state, 'suspended');
});

test('admin reads a dealer\'s full privileged view with compliance evaluation', async () => {
  resetDb();
  await request('POST', '/api/dealer/profile', { legal_name: 'Acme', tenant_id: 't1' }, 'dealer-1');
  const dealerId = db.dealer_profiles[0].id;
  const res = await request('GET', `/api/admin/dealers/${dealerId}`, null, 'admin-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.legal_name, 'Acme');
  assert.ok(res.body.compliance);
  assert.equal(typeof res.body.compliance.can_publish, 'boolean');
});
