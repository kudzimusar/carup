/**
 * Workstream 2 — Source Verification route + authz boundary tests.
 * Verifies routes are wired, privileged-only where required, coverage is readable by any
 * authenticated user, and raw payloads never reach non-admin callers.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/sourceVerificationRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

let db;
function resetDb() {
  db = {
    users: [
      { id: 'admin-1', role: 'admin', is_verified: true },
      { id: 'reviewer-1', role: 'reviewer', is_verified: true },
      { id: 'buyer-1', role: 'buyer', is_verified: true },
    ],
    vehicles: [{ vin: 'CLEANVIN00000001', make: 'Toyota', model: 'Hilux', year: 2018, tenant_id: 't1' }],
    source_verification_results: [],
    source_verification_coverage_public: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, order: null, single: false, maybe: false, payload: null };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
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
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-06-26T00:0${rows.length + i}:00.000Z`, ...p }));
    rows.push(...ins);
    return ok(st.single ? ins[0] : ins);
  }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  // emulate the coverage view: latest per provider
  if (st.table === 'source_verification_coverage_public') {
    out = db.source_verification_results
      .filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v))
      .map((r) => ({ vin: r.vin, provider: r.provider, mode: r.mode, coverage_status: r.mode === 'sandbox' && r.result === 'match' ? 'sandbox_demonstration' : r.result, retrieved_at: r.retrieved_at }));
  }
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
  return ok(out);
}

// authorizeRole resolves identity from x-user-id (test-mode fallback) against the mocked
// users table, so we drive auth by passing that header — not by injecting userContext.
const app = (() => {
  const a = express();
  a.use(express.json());
  a.use(router);
  a.use(errorHandler);
  return a;
})();
function mount() { return app; }
function request(_app, method, path, body, userId) {
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

test('GET /api/sources lists five sandbox adapters with honest modes', async () => {
  const res = await request(mount(), 'GET', '/api/sources', null, 'reviewer-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.sources.length, 5);
  assert.ok(res.body.sources.every((s) => s.mode === 'sandbox'));
});

test('POST verify (reviewer) returns a sandbox match without raw_payload', async () => {
  resetDb();
  const res = await request(mount(), 'POST', '/api/vehicles/CLEANVIN00000001/sources/zimra/verify', null, 'reviewer-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.result.result, 'match');
  assert.equal(res.body.result.mode, 'sandbox');
  assert.equal(res.body.result.raw_payload, undefined);
});

test('POST verify is denied to a buyer (privileged trigger)', async () => {
  resetDb();
  const res = await request(mount(), 'POST', '/api/vehicles/CLEANVIN00000001/sources/zimra/verify', null, 'buyer-1');
  assert.equal(res.status, 403);
});

test('POST verify unknown provider -> 400', async () => {
  resetDb();
  const res = await request(mount(), 'POST', '/api/vehicles/CLEANVIN00000001/sources/interpol/verify', null, 'admin-1');
  assert.equal(res.status, 400);
});

test('POST verify unknown vehicle -> 404', async () => {
  resetDb();
  const res = await request(mount(), 'POST', '/api/vehicles/GHOSTVIN000000001/sources/zimra/verify', null, 'admin-1');
  assert.equal(res.status, 404);
});

test('POST manual verification (reviewer) is mode-labelled manual_verification', async () => {
  resetDb();
  const res = await request(mount(), 'POST', '/api/vehicles/CLEANVIN00000001/sources/cvr/manual', { result: 'match', reason: 'reviewed logbook' }, 'reviewer-1');
  assert.equal(res.status, 201);
  assert.equal(res.body.result.mode, 'manual_verification');
});

test('POST manual verification with bad result -> 400', async () => {
  resetDb();
  const res = await request(mount(), 'POST', '/api/vehicles/CLEANVIN00000001/sources/cvr/manual', { result: 'definitely_real' }, 'admin-1');
  assert.equal(res.status, 400);
});

test('GET coverage is readable by a buyer and exposes status only (no raw)', async () => {
  resetDb();
  await request(mount(), 'POST', '/api/vehicles/CLEANVIN00000001/sources/zimra/verify', null, 'admin-1');
  const res = await request(mount(), 'GET', '/api/vehicles/CLEANVIN00000001/sources/coverage', null, 'buyer-1');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.coverage));
  assert.ok(res.body.coverage.every((c) => c.raw_payload === undefined && c.identity_fields === undefined));
});

test('GET results (reviewer, non-admin) strips raw_payload', async () => {
  resetDb();
  await request(mount(), 'POST', '/api/vehicles/CLEANVIN00000001/sources/zimra/verify', null, 'admin-1');
  const res = await request(mount(), 'GET', '/api/vehicles/CLEANVIN00000001/sources', null, 'reviewer-1');
  assert.equal(res.status, 200);
  assert.ok(res.body.results.every((r) => r.raw_payload === undefined));
});
