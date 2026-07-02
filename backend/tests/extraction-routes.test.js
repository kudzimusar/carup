/**
 * Phase 12 route tests — OCR document-extraction endpoints (HTTP + authz boundary).
 * The extraction service is unit-tested in vehicle-document-extractions.test.js; this verifies
 * the routes are wired, privileged-only, and that review updates only review_status.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/evidenceCatalogRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

let db;
function resetDb() {
  db = {
    users: [
      { id: 'admin-1', role: 'admin', is_verified: true },
      { id: 'buyer-1', role: 'buyer', is_verified: true },
    ],
    vehicles: [{ vin: 'VINX', chassis_number: 'CHSX', plate_number: 'AAA-1', normalized_plate_number: 'AAA1' }],
    vehicle_document_extractions: [
      { id: 'x1', evidence_id: 'ev1', vin: 'VINX', document_type: 'customs_entry', field_name: 'plate', raw_value: 'BBB-2', normalized_value: 'BBB2', expected_value: 'AAA1', confidence: 0.9, compared_vehicle_field: 'plate', match_status: 'mismatch', review_status: 'pending', mismatch_reason: null, reviewed_by: null },
      { id: 'x2', evidence_id: 'ev1', vin: 'VINX', document_type: 'customs_entry', field_name: 'chassis', raw_value: 'CHSX', normalized_value: 'CHSX', expected_value: 'CHSX', confidence: 0.95, compared_vehicle_field: 'chassis', match_status: 'match', review_status: 'pending', mismatch_reason: null, reviewed_by: null },
    ],
  };
}
function builder(t) {
  const st = { t, op: 'select', filters: {}, order: null, single: false, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; }, update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; }, neq() { return chain; }, in() { return chain; }, is() { return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; }, limit() { return chain; }, single() { st.single = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function run(st) {
  const ok = (data) => ({ data, error: null }); const rows = (db[st.t] = db[st.t] || []);
  if (st.op === 'insert') { const list = Array.isArray(st.payload) ? st.payload : [st.payload]; const ins = list.map((p, i) => ({ id: p.id || `${st.t}-${rows.length + i + 1}`, ...p })); rows.push(...ins); return ok(st.single ? ins[0] : ins); }
  if (st.op === 'update') { let u = null; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u = r; } return ok(st.single ? u : (u ? [u] : [])); }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}

let server; let baseUrl;
before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => builder(t) });
  const app = express(); app.use(express.json()); app.use(router); app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
const admin = { 'Content-Type': 'application/json', 'x-user-id': 'admin-1', 'x-stakeholder-role': 'admin' };

test('GET extractions (privileged) returns rows + mismatch/pending counts', async () => {
  const res = await fetch(`${baseUrl}/api/vehicles/VINX/extractions?evidence_id=ev1`, { headers: admin });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.extractions.length, 2);
  assert.equal(body.mismatch_count, 1);
  assert.equal(body.pending_review_count, 2);
});

test('GET extractions is privileged-only (buyer blocked 403)', async () => {
  const res = await fetch(`${baseUrl}/api/vehicles/VINX/extractions`, { headers: { 'x-user-id': 'buyer-1', 'x-stakeholder-role': 'buyer' } });
  assert.equal(res.status, 403);
});

test('PATCH review sets review_status (content unchanged)', async () => {
  const res = await fetch(`${baseUrl}/api/vehicles/VINX/extractions/x1/review`, {
    method: 'PATCH', headers: admin, body: JSON.stringify({ review_status: 'rejected', mismatch_reason: 'plate differs' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.extraction.review_status, 'rejected');
  assert.equal(body.extraction.raw_value, 'BBB-2'); // original content immutable
  assert.equal(body.extraction.reviewed_by, 'admin-1');
});

test('PATCH review requires review_status', async () => {
  const res = await fetch(`${baseUrl}/api/vehicles/VINX/extractions/x2/review`, { method: 'PATCH', headers: admin, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});
