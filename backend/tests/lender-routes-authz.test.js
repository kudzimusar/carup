/**
 * Full Activation — object-level authorization for the PRIVATE lender routes.
 *
 * Regression guard for the fix to the finding "any 'owner'-role user can read any VIN's private
 * lender decision history / file erasure against any consent ref". The private status/history and
 * the consent-deletion routes must bind to the ACTUAL vehicle/consent owner, not merely the role.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/lenderRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

let db;
function reset() {
  db = {
    users: [
      { id: 'owner-1', role: 'owner', is_verified: true },
      { id: 'owner-2', role: 'owner', is_verified: true },
      { id: 'admin-1', role: 'admin', is_verified: true },
    ],
    vehicles: [{ vin: 'VIN-OWNED-1', owner_id: 'owner-1', tenant_id: 't1' }],
    finance_consents: [{ id: 'consent-1', vin: 'VIN-OWNED-1', applicant_user_id: 'owner-1', consent_version: 'c1', revoked_at: null }],
    finance_provider_decisions: [{ id: 'dec-1', vin: 'VIN-OWNED-1', outcome: 'manual_review', conditions: [], mode: 'sandbox', created_at: '2026-07-03T00:00:00Z' }],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, single: false, maybe: false, order: null, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    limit() { return chain; },
    single() { st.single = true; return chain; }, maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') { const list = Array.isArray(st.payload) ? st.payload : [st.payload]; const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-07-03T00:00:0${rows.length + i}Z`, ...p })); rows.push(...ins); return ok(st.single ? ins[0] : ins); }
  if (st.op === 'update') { let u = null; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u = r; } return ok(st.single ? u : (u ? [u] : [])); }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}

const app = (() => { const a = express(); a.use(express.json()); a.use(router); a.use(errorHandler); return a; })();
function request(method, path, body, userId) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, () => {
      const { port } = srv.address(); const data = body ? JSON.stringify(body) : null;
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}), ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => { srv.close(); let body = null; if (b) { try { body = JSON.parse(b); } catch { body = { _raw: b }; } } resolve({ status: res.statusCode, body }); });
      });
      req.on('error', e => { srv.close(); reject(e); }); if (data) req.write(data); req.end();
    });
  });
}
before(() => { reset(); supabase.from = (t) => builder(t); });

test('private status: a NON-owning owner-role user is forbidden (403)', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('GET', '/api/vehicles/VIN-OWNED-1/finance/lender/status', null, 'owner-2');
  assert.equal(r.status, 403);
});

test('private status: the actual vehicle owner is allowed (200)', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('GET', '/api/vehicles/VIN-OWNED-1/finance/lender/status', null, 'owner-1');
  assert.equal(r.status, 200);
  assert.equal(r.body.status.outcome, 'manual_review');
});

test('private status: admin is allowed for any VIN (200)', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('GET', '/api/vehicles/VIN-OWNED-1/finance/lender/status', null, 'admin-1');
  assert.equal(r.status, 200);
});

test('consent deletion: a user cannot erase someone else\'s consent (403)', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('POST', '/api/vehicles/VIN-OWNED-1/finance/consent/consent-1/deletion', {}, 'owner-2');
  assert.equal(r.status, 403);
  // the consent must be untouched
  assert.equal(db.finance_consents[0].deletion_requested_at, undefined);
});

test('consent deletion: the consent owner can erase their own (200)', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('POST', '/api/vehicles/VIN-OWNED-1/finance/consent/consent-1/deletion', {}, 'owner-1');
  assert.equal(r.status, 200);
  assert.ok(db.finance_consents[0].deletion_requested_at);
});
