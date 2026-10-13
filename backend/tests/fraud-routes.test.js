/**
 * Workstream A — Fraud route + authz boundary tests.
 * Verifies the fraud endpoints are wired, privileged-only (buyer 403, reviewer 200),
 * that evaluate creates a case, that resolve writes a resolution, and that an unknown
 * vehicle 404s. authorizeRole resolves identity from the x-user-id header (test-mode
 * fallback) against the mocked users table.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/fraudRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

let db;
function resetDb() {
  db = {
    users: [
      { id: 'admin-1', role: 'admin', is_verified: true },
      { id: 'reviewer-1', role: 'reviewer', is_verified: true },
      { id: 'gov-1', role: 'government', is_verified: true },
      { id: 'buyer-1', role: 'buyer', is_verified: true },
      // The vehicles' owners, product-shaped (PC01-K2B: the queue counts a case as operational only
      // when its vehicle's creator is evidenced; an owner with no users row is "needs review").
      { id: 'u_0a1b2c3d4e5f6071', role: 'owner', is_verified: true, email: 'tendai.owner@mail.co.zw', name: 'Tendai Moyo' },
      { id: 'u_1b2c3d4e5f607182', role: 'owner', is_verified: true, email: 'rudo.owner@mail.co.zw', name: 'Rudo Ncube' },
      { id: 'u_oc5rproof_k2b0001', role: 'owner', is_verified: true, email: 'proof@carup.test', name: 'Proof Owner' },
    ],
    vehicles: [
      // a clean vehicle (no peers) and a vehicle that duplicates it via chassis slot
      { vin: 'CLEANVIN00000001', make: 'Toyota', model: 'Hilux', year: 2018, normalized_plate_number: 'ABC123', chassis_number: 'CH-1', engine_number: 'EN-1', temp_plate_id: null, owner_id: 'u_0a1b2c3d4e5f6071', tenant_id: 't1', status: 'active' },
      { vin: 'CLONEVIN000000002', make: 'Toyota', model: 'Hilux', year: 2018, normalized_plate_number: 'ABC123', chassis_number: 'CLEANVIN00000001', engine_number: 'EN-2', temp_plate_id: null, owner_id: 'u_1b2c3d4e5f607182', tenant_id: 't1', status: 'active' },
    ],
    fraud_signals: [],
    fraud_cases: [],
    fraud_case_events: [],
    fraud_case_resolutions: [],
    vehicle_evidence: [],
    source_verification_results: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, inFilter: null, order: null, single: false, maybe: false, payload: null, updates: null };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.updates = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    in(k, vals) { st.inFilter = { k, vals }; return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function matches(r, st) {
  if (!Object.entries(st.filters).every(([k, v]) => r[k] === v)) return false;
  if (st.inFilter && !st.inFilter.vals.includes(r[st.inFilter.k])) return false;
  return true;
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-06-26T00:0${rows.length + i}:00.000Z`, updated_at: `2026-06-26T00:0${rows.length + i}:00.000Z`, ...p }));
    rows.push(...ins);
    return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') {
    const updated = [];
    for (const r of rows) {
      if (matches(r, st)) { Object.assign(r, st.updates, { updated_at: '2026-06-26T00:05:00.000Z' }); updated.push(r); }
    }
    if (st.single) return updated[0] ? ok(updated[0]) : { data: null, error: { message: 'not found' } };
    return ok(updated);
  }
  let out = rows.filter((r) => matches(r, st));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
  return ok(out);
}

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

test('POST evaluate is denied to a buyer (403)', async () => {
  resetDb();
  const res = await request('POST', '/api/vehicles/CLEANVIN00000001/fraud/evaluate', {}, 'buyer-1');
  assert.equal(res.status, 403);
});

test('POST evaluate (reviewer) creates a case for a duplicated vehicle (200)', async () => {
  resetDb();
  const res = await request('POST', '/api/vehicles/CLEANVIN00000001/fraud/evaluate', {}, 'reviewer-1');
  assert.equal(res.status, 200);
  assert.ok(res.body.case, 'a fraud case was opened');
  assert.equal(res.body.case.status, 'open');
  assert.equal(res.body.block.blocked, true);
  assert.ok(res.body.signals.length > 0);
  assert.ok(res.body.signals.some((s) => s.signal_code === 'duplicate_vin'));
  // persisted
  assert.equal(db.fraud_cases.length, 1);
  assert.ok(db.fraud_case_events.some((e) => e.event_type === 'evaluated'));
});

test('POST evaluate unknown vehicle -> 404', async () => {
  resetDb();
  const res = await request('POST', '/api/vehicles/GHOSTVIN000000001/fraud/evaluate', {}, 'admin-1');
  assert.equal(res.status, 404);
});

test('GET /api/fraud/cases (reviewer) lists the open queue', async () => {
  resetDb();
  await request('POST', '/api/vehicles/CLEANVIN00000001/fraud/evaluate', {}, 'reviewer-1');
  const res = await request('GET', '/api/fraud/cases', null, 'reviewer-1');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.cases));
  assert.equal(res.body.cases.length, 1);
});

test('GET /api/fraud/cases sets aside a case on a certification vehicle and counts it (PC01-K2B)', async () => {
  resetDb();
  db.vehicles.push({ vin: 'PROOFVIN00000003', make: 'Toyota', model: 'Hilux', year: 2018, normalized_plate_number: 'ABC123', chassis_number: 'CH-1', engine_number: 'EN-3', temp_plate_id: null, owner_id: 'u_oc5rproof_k2b0001', tenant_id: 't1', status: 'active' });
  await request('POST', '/api/vehicles/CLEANVIN00000001/fraud/evaluate', {}, 'reviewer-1');
  await request('POST', '/api/vehicles/PROOFVIN00000003/fraud/evaluate', {}, 'reviewer-1');
  const raw = db.fraud_cases.length;
  const res = await request('GET', '/api/fraud/cases', null, 'reviewer-1');
  assert.equal(res.status, 200);
  assert.ok(res.body.cases.every((c) => c.vin !== 'PROOFVIN00000003'), 'proof vehicle case is not in the operational queue');
  assert.equal(res.body.provenance.raw, raw);
  assert.equal(res.body.provenance.operational + res.body.provenance.excluded_non_operational + res.body.provenance.unknown_requires_review, raw);
  assert.equal(res.body.provenance.view, 'operational_only');
  const all = await request('GET', '/api/fraud/cases?view=all', null, 'reviewer-1');
  assert.equal(all.body.cases.length, raw, 'view=all returns every case, nothing deleted');
  assert.equal(all.body.provenance.view, 'all_records');
});

test('GET /api/fraud/cases is denied to a buyer (403)', async () => {
  resetDb();
  const res = await request('GET', '/api/fraud/cases', null, 'buyer-1');
  assert.equal(res.status, 403);
});

test('GET /api/fraud/cases (government) is allowed (200)', async () => {
  resetDb();
  const res = await request('GET', '/api/fraud/cases', null, 'gov-1');
  assert.equal(res.status, 200);
});

test('GET /api/fraud/cases/:id returns the case with signals + events', async () => {
  resetDb();
  const ev = await request('POST', '/api/vehicles/CLEANVIN00000001/fraud/evaluate', {}, 'reviewer-1');
  const id = ev.body.case.id;
  const res = await request('GET', `/api/fraud/cases/${id}`, null, 'reviewer-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.case.id, id);
  assert.ok(res.body.case.signals.length > 0);
  assert.ok(res.body.case.events.some((e) => e.event_type === 'evaluated'));
});

test('GET /api/fraud/cases/:id unknown -> 404', async () => {
  resetDb();
  const res = await request('GET', '/api/fraud/cases/does-not-exist', null, 'admin-1');
  assert.equal(res.status, 404);
});

test('PATCH resolve writes a resolution + event and updates status', async () => {
  resetDb();
  const ev = await request('POST', '/api/vehicles/CLEANVIN00000001/fraud/evaluate', {}, 'reviewer-1');
  const id = ev.body.case.id;
  const res = await request('PATCH', `/api/fraud/cases/${id}/resolve`, { resolution: 'confirmed_duplicate', reason: 'verified clone' }, 'admin-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.case.status, 'resolved');
  assert.equal(res.body.resolution.resolution, 'confirmed_duplicate');
  assert.equal(db.fraud_case_resolutions.length, 1);
  assert.ok(db.fraud_case_events.some((e) => e.event_type === 'resolved'));
});

test('PATCH resolve with an invalid resolution -> 400', async () => {
  resetDb();
  const ev = await request('POST', '/api/vehicles/CLEANVIN00000001/fraud/evaluate', {}, 'reviewer-1');
  const id = ev.body.case.id;
  const res = await request('PATCH', `/api/fraud/cases/${id}/resolve`, { resolution: 'nope' }, 'admin-1');
  assert.equal(res.status, 400);
});

test('PATCH resolve is denied to a buyer (403)', async () => {
  resetDb();
  const res = await request('PATCH', '/api/fraud/cases/whatever/resolve', { resolution: 'released' }, 'buyer-1');
  assert.equal(res.status, 403);
});

test('PATCH resolve unknown case -> 404', async () => {
  resetDb();
  const res = await request('PATCH', '/api/fraud/cases/ghost-case/resolve', { resolution: 'released' }, 'admin-1');
  assert.equal(res.status, 404);
});
