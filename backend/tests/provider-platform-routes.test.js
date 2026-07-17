/**
 * Full Activation — reconciliation service + provider admin/health console routes.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const router = (await import('../routes/providerPlatformRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const recon = await import('../services/providerPlatform/reconciliationService.js');

let db;
function reset() {
  db = {
    users: [{ id: 'admin-1', role: 'admin', is_verified: true }, { id: 'buyer-1', role: 'owner', is_verified: true }],
    provider_registry: [{ id: 'prov-1', provider_key: 'zimra', capability_type: 'government_source', activation_mode: 'sandbox', kill_switch_enabled: true, contract_status: 'none' }],
    provider_activation_history: [], provider_health_checks: [], provider_incidents: [],
    provider_request_attempts: [], reconciliation_jobs: [], reconciliation_mismatches: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, single: false, maybe: false, order: null, limit: null, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    limit(n) { st.limit = n; return chain; },
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
  if (st.limit) out = out.slice(0, st.limit);
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}

// ── reconciliation service ────────────────────────────────────────────────────
test('reconciliation: all matched -> succeeded', async () => {
  reset(); supabase.from = (t) => builder(t);
  const ext = [{ external_ref: 'a', amount_cents: 100 }, { external_ref: 'b', amount_cents: 200 }];
  const job = await recon.runReconciliation('prov-1', 'escrow', ext, async (r) => ({ ref: r.external_ref, amount_cents: r.amount_cents }));
  assert.equal(job.status, 'succeeded'); assert.equal(job.matched_count, 2); assert.equal(job.mismatch_count, 0);
});
test('reconciliation: missing internal + amount mismatch -> partial + queued', async () => {
  reset(); supabase.from = (t) => builder(t);
  const ext = [{ external_ref: 'a', amount_cents: 100 }, { external_ref: 'b', amount_cents: 200 }];
  const job = await recon.runReconciliation('prov-1', 'escrow', ext, async (r) => r.external_ref === 'a' ? null : ({ ref: 'b', amount_cents: 999 }));
  assert.equal(job.status, 'partial'); assert.equal(job.mismatch_count, 2);
  const open = await recon.listOpenMismatches('prov-1');
  assert.equal(open.length, 2);
  assert.ok(open.some(m => m.mismatch_type === 'missing_internal'));
  assert.ok(open.some(m => m.mismatch_type === 'amount_mismatch'));
});
test('reconciliation: resolveMismatch validates + updates', async () => {
  reset(); supabase.from = (t) => builder(t);
  await recon.runReconciliation('prov-1', 'escrow', [{ external_ref: 'a' }], async () => null);
  const [m] = await recon.listOpenMismatches('prov-1');
  const r = await recon.resolveMismatch(m.id, 'resolved', { actor: { id: 'admin-1' } });
  assert.equal(r.resolution, 'resolved');
  await assert.rejects(() => recon.resolveMismatch(m.id, 'bogus'), /invalid resolution/);
});

// ── admin routes ──────────────────────────────────────────────────────────────
const app = (() => { const a = express(); a.use(express.json()); a.use(router); a.use(errorHandler); return a; })();
function request(method, path, body, userId) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, () => {
      const { port } = srv.address(); const data = body ? JSON.stringify(body) : null;
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}), ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }); });
      });
      req.on('error', e => { srv.close(); reject(e); }); if (data) req.write(data); req.end();
    });
  });
}
before(() => { reset(); supabase.from = (t) => builder(t); });

test('GET /api/admin/providers (admin) lists providers + modes', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('GET', '/api/admin/providers', null, 'admin-1');
  assert.equal(r.status, 200); assert.ok(Array.isArray(r.body.providers)); assert.ok(r.body.modes.includes('live'));
});
test('provider admin routes deny a non-admin (403)', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('GET', '/api/admin/providers', null, 'buyer-1');
  assert.equal(r.status, 403);
});
test('PATCH activation to live without contract -> 400', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('PATCH', '/api/admin/providers/prov-1/activation', { mode: 'live' }, 'admin-1');
  assert.equal(r.status, 400);
});
test('PATCH kill-switch off is recorded', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('PATCH', '/api/admin/providers/prov-1/kill-switch', { enabled: false, reason: 'staging enable' }, 'admin-1');
  assert.equal(r.status, 200); assert.equal(r.body.provider.kill_switch_enabled, false);
  assert.ok(db.provider_activation_history.length >= 1);
});
test('reject storing a secret in a provider credential_ref (400)', async () => {
  reset(); supabase.from = (t) => builder(t);
  const r = await request('POST', '/api/admin/providers', { provider_key: 'x', capability_type: 'insurance', credential_ref: 'sbp_secretsecretsecret123' }, 'admin-1');
  assert.equal(r.status, 400);
});
