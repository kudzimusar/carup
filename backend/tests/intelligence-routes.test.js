/**
 * Milestone 3 route tests — analyze, temporal findings (role-scoped), disclosure scan +
 * conflicts (public-safe), seller response. Asserts the public allowlist: non-privileged
 * callers never see pending/unconfirmed findings, raw model output, or internal explanations.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.ALLOW_OCR_MOCK = 'true';

const express = (await import('express')).default;
const router = (await import('../routes/intelligenceRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

let db;
function resetDb() {
  db = {
    users: [{ id: 'admin-1', role: 'admin', is_verified: true }, { id: 'buyer-1', role: 'buyer', is_verified: true }, { id: 'owner-1', role: 'owner', is_verified: true }],
    vehicle_evidence: [{ id: 'ev1', vin: 'V1', verification_status: 'pending' }],
    ai_analysis_jobs: [], ai_observations: [],
    temporal_findings: [
      { id: 'tf1', vin: 'V1', finding_type: 'replaced', component: 'front_bumper', reviewer_state: 'confirmed', public_summary: 'The front bumper appears different; requires reviewer confirmation.', internal_explanation: 'SECRET internal', severity: 'high' },
      { id: 'tf2', vin: 'V1', finding_type: 'newly_damaged', component: 'bonnet', reviewer_state: 'pending_review', public_summary: 'pending', internal_explanation: 'SECRET pending', severity: 'high' },
    ],
    disclosure_claims: [], disclosure_conflicts: [],
  };
}
function builder(t) {
  const st = { t, op: 'select', filters: {}, order: null, lim: null, single: false, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; }, update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; }, neq() { return chain; }, in() { return chain; }, is() { return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; }, limit(n) { st.lim = n; return chain; }, single() { st.single = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function run(st) {
  const ok = (data) => ({ data, error: null }); const rows = (db[st.t] = db[st.t] || []);
  if (st.op === 'insert') { const list = Array.isArray(st.payload) ? st.payload : [st.payload]; const ins = list.map((p, i) => ({ id: p.id || `${st.t}-${rows.length + i + 1}`, created_at: new Date().toISOString(), ...p })); rows.push(...ins); return ok(st.single ? ins[0] : ins); }
  if (st.op === 'update') { const u = []; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u.push(r); } return ok(u); }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.lim != null) out = out.slice(0, st.lim);
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
const buyer = { 'x-user-id': 'buyer-1', 'x-stakeholder-role': 'buyer' };

test('admin can run a typed analysis task', async () => {
  const res = await fetch(`${baseUrl}/api/evidence/ev1/analyze`, { method: 'POST', headers: admin, body: JSON.stringify({ task_type: 'image_quality', vin: 'V1' }) });
  assert.equal(res.status, 202);
  const job = await res.json();
  assert.ok(['succeeded', 'manual_review_required'].includes(job.status));
});

test('temporal findings: admin sees all + internals; buyer sees only confirmed public-safe', async () => {
  const a = await (await fetch(`${baseUrl}/api/vehicles/V1/temporal-findings`, { headers: admin })).json();
  assert.equal(a.findings.length, 2);
  assert.ok('internal_explanation' in a.findings[0]);

  const b = await (await fetch(`${baseUrl}/api/vehicles/V1/temporal-findings`, { headers: buyer })).json();
  assert.equal(b.findings.length, 1); // only the confirmed one
  assert.equal(b.findings[0].finding_type, 'replaced');
  assert.equal('internal_explanation' in b.findings[0], false); // internals stripped
});

test('disclosure scan extracts claims and classifies conflicts (admin)', async () => {
  const res = await fetch(`${baseUrl}/api/vehicles/V1/disclosure-scan`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ snapshot: { id: 'L1', title: 'Clean', description: 'No accident, genuine mileage' }, evidence_context: { hasAccidentEvidence: true, accidentEvidenceIds: ['ev9'] } }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.claims_extracted >= 1);
  assert.ok(body.conflicts.length >= 1);
  assert.equal(body.conflicts[0].reviewer_state, 'pending_review');
});

test('buyer sees no pending disclosure conflicts (governed)', async () => {
  const b = await (await fetch(`${baseUrl}/api/vehicles/V1/disclosure-conflicts`, { headers: buyer })).json();
  assert.equal(b.conflicts.length, 0); // the scan-created conflicts are pending, not public
});

test('seller can respond to a conflict', async () => {
  db.disclosure_conflicts.push({ id: 'dc1', vin: 'V1', classification: 'possible_conflict', reviewer_state: 'pending_review', correction_history: [] });
  const res = await fetch(`${baseUrl}/api/disclosure-conflicts/dc1/seller-response`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': 'owner-1', 'x-stakeholder-role': 'owner' }, body: JSON.stringify({ response: 'Invoice attached' }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.seller_response, 'Invoice attached');
});
