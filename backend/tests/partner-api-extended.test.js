/**
 * Workstream I — Partner API extension: dealer/insurance/finance/escrow/decision scopes,
 * scope enforcement, finance status-only redaction (no applicant data).
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const partnerRouter = (await import('../routes/partnerApiRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const auth = await import('../services/partner/partnerAuthService.js');
const { initEligibility } = await import('../services/eligibility/eligibilityService.js');

let db;
function reset() {
  db = {
    vehicles: [{ vin: 'PARTNERVIN0000001', make: 'Toyota', model: 'Hilux', year: 2018, chassis_number: 'C', engine_number: 'E', plate_number: 'P', tenant_id: 't1' }],
    partner_clients: [], partner_api_requests: [],
    eligibility_requests: [], eligibility_decisions: [],
    escrow_trust_sessions: [], fraud_cases: [],
    dealer_profiles: [{ id: 'dealer-1', user_id: 'du1', identity_status: 'verified', compliance_review_state: 'passed', suspension_state: 'none', restriction_state: 'none' }],
    vehicle_evidence: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, inFilter: null, single: false, maybe: false, order: null, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    in(k, v) { st.inFilter = { key: k, vals: Array.isArray(v) ? v : [v] }; return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    single() { st.single = true; return chain; }, maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-06-26T00:${String(rows.length + i).padStart(2, '0')}:00Z`, ...p }));
    rows.push(...ins); return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') { let u = null; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u = r; } return ok(st.single ? u : (u ? [u] : [])); }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.inFilter) out = out.filter((r) => st.inFilter.vals.includes(r[st.inFilter.key]));
  if (st.table === 'source_verification_coverage_public') out = [];
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}

const app = (() => { const a = express(); a.use(express.json()); a.use(partnerRouter); a.use(errorHandler); return a; })();
function request(method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, () => {
      const { port } = srv.address();
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...headers, ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
        let buf = ''; res.on('data', (c) => (buf += c));
        res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); });
      });
      req.on('error', (e) => { srv.close(); reject(e); });
      if (data) req.write(data); req.end();
    });
  });
}

let fullKey, narrowKey;
before(async () => {
  reset(); supabase.from = (t) => builder(t); initEligibility();
  fullKey = (await auth.createPartnerClient({ name: 'Full', scopes: ['vehicle:*'] })).apiKey;
  narrowKey = (await auth.createPartnerClient({ name: 'Narrow', scopes: ['vehicle:identity'] })).apiKey;
});

test('trust:read decision returns redacted public projection (no finance dim)', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/PARTNERVIN0000001/decision', { 'x-api-key': fullKey });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision.dimensions.finance_eligibility, undefined);
});
test('dealer:read_summary returns buyer-safe dealer summary', async () => {
  const res = await request('GET', '/api/partner/v1/dealers/dealer-1/summary', { 'x-api-key': fullKey });
  assert.equal(res.status, 200);
  assert.ok(res.body.dealer);
  // no private fields
  const blob = JSON.stringify(res.body.dealer);
  assert.ok(!/responsible_person|physical_address|tax_id|file_ref/.test(blob));
});
test('narrow key (identity only) is forbidden from decision', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/PARTNERVIN0000001/decision', { 'x-api-key': narrowKey });
  assert.equal(res.status, 403);
});
test('insurance:request creates a request and returns status (no PII)', async () => {
  const res = await request('POST', '/api/partner/v1/vehicles/PARTNERVIN0000001/insurance', { 'x-api-key': fullKey });
  assert.equal(res.status, 201);
  assert.ok(res.body.request.status);
  assert.equal(res.body.request.applicant, undefined);
});
test('insurance:read returns status', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/PARTNERVIN0000001/insurance', { 'x-api-key': fullKey });
  assert.equal(res.status, 200);
  assert.ok('status' in res.body.insurance);
});
test('finance:read returns STATUS ONLY (no conditions, no applicant data)', async () => {
  await request('POST', '/api/partner/v1/vehicles/PARTNERVIN0000001/finance', { 'x-api-key': fullKey }, { consent_reference: 'c1' });
  const res = await request('GET', '/api/partner/v1/vehicles/PARTNERVIN0000001/finance', { 'x-api-key': fullKey });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.finance).sort(), ['status', 'vin']);
});
test('escrow:read returns latest session status', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/PARTNERVIN0000001/escrow', { 'x-api-key': fullKey });
  assert.equal(res.status, 200);
  assert.ok('status' in res.body.escrow);
});
test('no key -> 401 on a new endpoint', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/PARTNERVIN0000001/decision');
  assert.equal(res.status, 401);
});
