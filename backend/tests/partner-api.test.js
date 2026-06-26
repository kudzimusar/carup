/**
 * Workstream 9 — Partner API tests: key auth, scopes, redaction, audit, revocation,
 * tenant-safe identity, and the auth service (hash/verify/constant-time).
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
const { initSourceVerification, verifySource } = await import('../services/sourceVerification/sourceVerificationService.js');

let db;
function resetDb() {
  db = {
    vehicles: [{ vin: 'CLEANVIN00000001', make: 'Toyota', model: 'Hilux', year: 2018, tenant_id: 't1' }],
    partner_clients: [],
    partner_api_requests: [],
    source_verification_results: [],
    source_verification_coverage_public: [],
    vehicle_evidence: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, single: false, maybe: false, order: null, payload: null };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
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
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-06-26T00:0${rows.length + i}:00Z`, ...p }));
    rows.push(...ins);
    return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') {
    let u = null;
    for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u = r; }
    return ok(st.single ? u : (u ? [u] : []));
  }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.table === 'source_verification_coverage_public') {
    out = db.source_verification_results
      .filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v))
      .map((r) => ({ vin: r.vin, provider: r.provider, mode: r.mode, coverage_status: r.mode === 'sandbox' && r.result === 'match' ? 'sandbox_demonstration' : r.result, retrieved_at: r.retrieved_at }));
  }
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}

const app = (() => { const a = express(); a.use(express.json()); a.use(partnerRouter); a.use(errorHandler); return a; })();
function request(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, () => {
      const { port } = srv.address();
      const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let buf = ''; res.on('data', (c) => (buf += c));
        res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); });
      });
      req.on('error', (e) => { srv.close(); reject(e); });
      req.end();
    });
  });
}

let fullKey, identityOnlyKey;
before(async () => {
  resetDb();
  supabase.from = (t) => builder(t);
  initSourceVerification();
  const full = await auth.createPartnerClient({ name: 'Acme Insure', scopes: ['vehicle:*'] });
  fullKey = full.apiKey;
  const idOnly = await auth.createPartnerClient({ name: 'Limited', scopes: ['vehicle:identity'] });
  identityOnlyKey = idOnly.apiKey;
});

// ── auth service ────────────────────────────────────────────────────────────────
test('auth: generated key has the carup_pk_ prefix and a stored hash (no plaintext)', () => {
  assert.ok(fullKey.startsWith('carup_pk_'));
  assert.ok(db.partner_clients[0].key_hash && db.partner_clients[0].key_hash !== fullKey);
});
test('auth: verifyPartnerKey accepts a valid key, rejects a forged one', async () => {
  assert.ok(await auth.verifyPartnerKey(fullKey));
  assert.equal(await auth.verifyPartnerKey('carup_pk_forged'), null);
  assert.equal(await auth.verifyPartnerKey(''), null);
});

// ── route auth + scopes ───────────────────────────────────────────────────────
test('no key -> 401', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/CLEANVIN00000001/identity');
  assert.equal(res.status, 401);
});
test('invalid key -> 401', async () => {
  const res = await request('GET', '/api/partner/v1/ping', { 'x-api-key': 'carup_pk_nope' });
  assert.equal(res.status, 401);
});
test('valid key + ping -> 200', async () => {
  const res = await request('GET', '/api/partner/v1/ping', { 'x-api-key': fullKey });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});
test('identity scope: identity-only key can read identity', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/CLEANVIN00000001/identity', { 'x-api-key': identityOnlyKey });
  assert.equal(res.status, 200);
  assert.equal(res.body.identity.vin, 'CLEANVIN00000001');
});
test('scope enforcement: identity-only key is forbidden from trust-summary', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/CLEANVIN00000001/trust-summary', { 'x-api-key': identityOnlyKey });
  assert.equal(res.status, 403);
});
test('identity response carries no owner PII or tenant id', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/CLEANVIN00000001/identity', { 'x-api-key': fullKey });
  assert.equal(res.body.identity.owner_id, undefined);
  assert.equal(res.body.identity.tenant_id, undefined);
});
test('source-coverage exposes mode + status only (no raw, no identity_fields)', async () => {
  await verifySource('CLEANVIN00000001', 'zimra');
  const res = await request('GET', '/api/partner/v1/vehicles/CLEANVIN00000001/source-coverage', { 'x-api-key': fullKey });
  assert.equal(res.status, 200);
  assert.ok(res.body.coverage.every((c) => c.raw_payload === undefined && c.identity_fields === undefined));
  // sandbox is labelled honestly, never as a live confirmation
  assert.ok(res.body.coverage.every((c) => c.coverage_status !== 'source_connected'));
});
test('trust-summary is the redacted public decision (no finance dimension)', async () => {
  const res = await request('GET', '/api/partner/v1/vehicles/CLEANVIN00000001/trust-summary', { 'x-api-key': fullKey });
  assert.equal(res.status, 200);
  assert.equal(res.body.trust.dimensions.finance_eligibility, undefined);
  assert.ok(res.body.trust.overall_trust);
});
test('every partner request is recorded in the append-only audit', async () => {
  const before = db.partner_api_requests.length;
  await request('GET', '/api/partner/v1/ping', { 'x-api-key': fullKey });
  await new Promise((r) => setTimeout(r, 20)); // allow res.on('finish') log to flush
  assert.ok(db.partner_api_requests.length > before);
});
test('revoked client is denied', async () => {
  const { client, apiKey } = await auth.createPartnerClient({ name: 'Temp', scopes: ['vehicle:*'] });
  await auth.revokePartnerClient(client.id);
  const res = await request('GET', '/api/partner/v1/ping', { 'x-api-key': apiKey });
  assert.equal(res.status, 401);
});
