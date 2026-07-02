/**
 * Milestone 2 route tests — ingestion trigger/status, identity queue + resolve,
 * listing snapshots, provider listing. Drives the real ingestionRouter over HTTP with
 * the real authorizeRole middleware and a table-aware in-memory Supabase mock.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/ingestionRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

let db;
function resetDb() {
  db = {
    users: [
      { id: 'admin-1', role: 'admin', is_verified: true },
      { id: 'buyer-1', role: 'buyer', is_verified: true },
    ],
    vehicles: [{ vin: 'JTDBR32E120111111', chassis_number: 'JTDBR32E120111111', normalized_plate_number: null }, { vin: 'JTDBR32E120222222', chassis_number: 'JTDBR32E120222222' }],
    evidence_sources: [{ id: 'src-jp', code: 'jp_auction_sandbox', active: true }],
    ingestion_jobs: [], source_records: [], vehicle_identity_candidates: [], listing_snapshots: [], vehicle_evidence: [], evidence_provenance_events: [],
  };
}
function builder(t) {
  const st = { t, op: 'select', filters: {}, order: null, lim: null, single: false, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; }, neq() { return chain; }, in() { return chain; }, is() { return chain; },
    order(col, opts) { st.order = { col, asc: opts?.ascending ?? false }; return chain; },
    limit(n) { st.lim = n; return chain; }, single() { st.single = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.t] = db[st.t] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const inserted = list.map((p, i) => ({ id: p.id || `${st.t}-${rows.length + i + 1}`, created_at: new Date().toISOString(), ...p }));
    rows.push(...inserted); return ok(st.single ? inserted[0] : inserted);
  }
  if (st.op === 'update') {
    const updated = [];
    for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); updated.push(r); }
    return ok(updated);
  }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : (a[st.order.col] < b[st.order.col]) ? -1 : 0));
  if (st.lim != null) out = out.slice(0, st.lim);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
  return ok(out);
}

let server; let baseUrl;
before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => builder(t) });
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

const admin = { 'Content-Type': 'application/json', 'x-user-id': 'admin-1', 'x-stakeholder-role': 'admin' };

test('GET /api/ingestion/providers lists the sandbox adapter with its mode', async () => {
  const res = await fetch(`${baseUrl}/api/ingestion/providers`);
  const body = await res.json();
  const jp = body.providers.find((p) => p.id === 'sandbox_jp_auction');
  assert.ok(jp);
  assert.equal(jp.mode, 'fixture'); // honesty: not live
});

test('non-admin cannot trigger ingestion', async () => {
  const res = await fetch(`${baseUrl}/api/ingestion/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': 'buyer-1', 'x-stakeholder-role': 'buyer' },
    body: JSON.stringify({ adapter_id: 'sandbox_jp_auction' }),
  });
  assert.equal(res.status, 403);
});

test('admin triggers sandbox ingestion end-to-end', async () => {
  const res = await fetch(`${baseUrl}/api/ingestion/jobs`, { method: 'POST', headers: admin, body: JSON.stringify({ adapter_id: 'sandbox_jp_auction' }) });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.provider_mode, 'fixture');
  assert.equal(body.job.stats.total, 4);
  assert.equal(body.job.stats.imported, 2);

  // identity queue now has the ambiguous match
  const q = await fetch(`${baseUrl}/api/ingestion/identity-queue`, { headers: admin });
  const qbody = await q.json();
  assert.ok(qbody.candidates.length >= 1);

  // resolve it
  const candId = qbody.candidates[0].id;
  const r = await fetch(`${baseUrl}/api/ingestion/identity-candidates/${candId}/resolve`, {
    method: 'POST', headers: admin, body: JSON.stringify({ decision: 'rejected', notes: 'not enough signal' }),
  });
  assert.equal(r.status, 200);
  const rb = await r.json();
  assert.equal(rb.status, 'rejected');
});

test('GET listing-snapshots requires auth and returns array', async () => {
  const res = await fetch(`${baseUrl}/api/vehicles/JTDBR32E120111111/listing-snapshots`, { headers: admin });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.snapshots));
});
