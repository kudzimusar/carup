/**
 * Native Mobile Certification service tests (canonical §132-154, §167).
 *
 * Run with:  node --test backend/tests/mobile-certification.test.js
 *
 * Proves the backend that persists device-certification evidence, using an in-memory Supabase
 * mock (same style as escrow-trust.test.js) so no real database is needed:
 *   - recordRun creates a run and validates the CHECK-constrained columns
 *   - recordResult appends per-check outcomes
 *   - results are APPEND-ONLY (service exposes no update/delete; repeated appends accumulate;
 *     the mock enforces the append-only trigger to prove a mutation would be rejected)
 *   - getRunMatrix aggregates per-run counts + a program summary and derives status
 *   - RLS-shape: reads are gated to admin/government/service_role and refused otherwise
 *   - evidence_ref must be a Storage path, never a URL/inline-bytes
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const svc = await import('../services/mobileCertification/certificationService.js');
const { supabase } = await import('../db/supabase.js');

// Tables append-only guarded at the DB layer (mirrors the migration trigger). The mock rejects
// UPDATE/DELETE against them so an accidental mutation path would surface as a test failure.
const APPEND_ONLY = new Set(['mobile_certification_results']);

let db;
function reset() {
  db = { mobile_certification_runs: [], mobile_certification_results: [] };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, single: false, payload: null };
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
  if ((st.op === 'update' || st.op === 'delete') && APPEND_ONLY.has(st.table)) {
    // Simulate governance_block_mutation(): append-only tables reject UPDATE/DELETE.
    return { data: null, error: { message: `Append-only table ${st.table}: ${st.op.toUpperCase()} is not permitted` } };
  }
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p, i) => ({
      id: p.id || `${st.table}-${rows.length + i + 1}`,
      created_at: `2026-07-03T17:00:${String(rows.length + i).padStart(2, '0')}Z`,
      ...p,
    }));
    rows.push(...ins);
    return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') {
    let u = null;
    for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u = r; }
    return ok(st.single ? u : (u ? [u] : []));
  }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}
function install() { reset(); supabase.from = (t) => builder(t); }

const ANDROID = { platform: 'android', device_model: 'Pixel 6a', os_version: 'Android 14', build_type: 'release' };
const LOWEND = { platform: 'android', device_model: 'Galaxy A14', os_version: 'Android 13', build_type: 'release' };
const ADMIN = { role: 'admin' };
const SERVICE = { role: 'service_role' };

test('recordRun creates a run with a generated id and defaults status to running', async () => {
  install();
  const run = await svc.recordRun(ANDROID);
  assert.ok(run.id);
  assert.equal(run.platform, 'android');
  assert.equal(run.status, 'running');
  assert.ok(run.started_at);
  assert.equal(db.mobile_certification_runs.length, 1);
});

test('recordRun rejects an invalid platform / build_type / status (CHECK-shape parity)', async () => {
  install();
  await assert.rejects(() => svc.recordRun({ ...ANDROID, platform: 'windows' }), /invalid platform/);
  await assert.rejects(() => svc.recordRun({ ...ANDROID, build_type: 'staging' }), /invalid build_type/);
  await assert.rejects(() => svc.recordRun({ ...ANDROID, status: 'green' }), /invalid status/);
  await assert.rejects(() => svc.recordRun({ ...ANDROID, device_model: '' }), /device_model required/);
});

test('recordResult appends per-check outcomes to the ledger', async () => {
  install();
  const run = await svc.recordRun(ANDROID);
  await svc.recordResult(run.id, { check_key: 'offline_queue_persist_restart', result: 'pass', detail: 'survived restart' });
  await svc.recordResult(run.id, { check_key: 'idempotency_dedupe', result: 'pass' });
  assert.equal(db.mobile_certification_results.length, 2);
  assert.equal(db.mobile_certification_results[0].run_id, run.id);
});

test('recordResult rejects an invalid result value and a non-storage evidence_ref', async () => {
  install();
  const run = await svc.recordRun(ANDROID);
  await assert.rejects(() => svc.recordResult(run.id, { check_key: 'x', result: 'maybe' }), /invalid result/);
  await assert.rejects(
    () => svc.recordResult(run.id, { check_key: 'x', result: 'pass', evidence_ref: 'https://leak.example/shot.png' }),
    /Storage path/,
  );
  await assert.rejects(
    () => svc.recordResult(run.id, { check_key: 'x', result: 'pass', evidence_ref: 'data:image/png;base64,AAAA' }),
    /Storage path/,
  );
  // A bare private-bucket path is accepted.
  const r = await svc.recordResult(run.id, { check_key: 'x', result: 'pass', evidence_ref: 'mobile-cert/run-1/x.png' });
  assert.equal(r.evidence_ref, 'mobile-cert/run-1/x.png');
});

test('results are APPEND-ONLY: no update/delete export, and a mutation is rejected at the DB layer', async () => {
  install();
  const run = await svc.recordRun(ANDROID);
  await svc.recordResult(run.id, { check_key: 'k1', result: 'pass' });
  // The service surfaces no way to rewrite a result.
  assert.equal(typeof svc.updateResult, 'undefined');
  assert.equal(typeof svc.deleteResult, 'undefined');
  // Re-recording the same check_key appends a SECOND row rather than overwriting the first.
  await svc.recordResult(run.id, { check_key: 'k1', result: 'fail', detail: 'later attempt' });
  const k1Rows = db.mobile_certification_results.filter((r) => r.check_key === 'k1');
  assert.equal(k1Rows.length, 2);
  // Proof the DB layer would reject a mutation (mirrors governance_block_mutation trigger).
  const mutate = supabase.from('mobile_certification_results').update({ result: 'skip' }).eq('check_key', 'k1');
  const res = await mutate;
  assert.ok(res.error && /Append-only/.test(res.error.message));
});

test('finalizeRun sets terminal status + completed_at on the (mutable) runs table', async () => {
  install();
  const run = await svc.recordRun(ANDROID);
  const done = await svc.finalizeRun(run.id, 'passed');
  assert.equal(done.status, 'passed');
  assert.ok(done.completed_at);
});

test('getRunMatrix aggregates per-run counts, derived status and a program summary', async () => {
  install();
  const a = await svc.recordRun(ANDROID);
  const b = await svc.recordRun(LOWEND);
  await svc.recordResult(a.id, { check_key: 'offline_queue_persist_restart', result: 'pass' });
  await svc.recordResult(a.id, { check_key: 'idempotency_dedupe', result: 'pass' });
  await svc.recordResult(a.id, { check_key: 'ios_only_check', result: 'skip' });
  await svc.recordResult(b.id, { check_key: 'low_storage_quota', result: 'fail', detail: 'quota error not surfaced' });

  const matrix = await svc.getRunMatrix({ actor: ADMIN });
  assert.equal(matrix.summary.total_runs, 2);
  assert.equal(matrix.summary.by_platform.android, 2);
  assert.deepEqual(matrix.summary.totals, { pass: 2, fail: 1, skip: 1 });

  const runA = matrix.runs.find((r) => r.id === a.id);
  assert.deepEqual(runA.results, { total: 3, pass: 2, fail: 0, skip: 1 });
  assert.equal(runA.derived_status, 'passed'); // passes, no fails

  const runB = matrix.runs.find((r) => r.id === b.id);
  assert.equal(runB.derived_status, 'failed'); // any fail => failed
});

test('getRunMatrix supports platform filtering', async () => {
  install();
  await svc.recordRun(ANDROID);
  await svc.recordRun({ platform: 'ios', device_model: 'iPhone 13', os_version: 'iOS 17.5', build_type: 'release' });
  const androidOnly = await svc.getRunMatrix({ actor: SERVICE, platform: 'android' });
  assert.equal(androidOnly.runs.length, 1);
  assert.equal(androidOnly.runs[0].platform, 'android');
});

test('RLS-shape: getRunMatrix refuses a non-admin actor and permits admin/service_role', async () => {
  install();
  await svc.recordRun(ANDROID);
  await assert.rejects(() => svc.getRunMatrix({ actor: { role: 'owner' } }), /forbidden/);
  await assert.rejects(() => svc.getRunMatrix({ actor: {} }), /forbidden/);
  // Allowed roles do not throw.
  await svc.getRunMatrix({ actor: ADMIN });
  await svc.getRunMatrix({ actor: SERVICE });
  await svc.getRunMatrix({ actor: { role: 'government' } });
});

test('deriveStatus: fail dominates, then pass, then skip-only=blocked, else pending', () => {
  assert.equal(svc.deriveStatus({ pass: 3, fail: 1, skip: 0 }), 'failed');
  assert.equal(svc.deriveStatus({ pass: 3, fail: 0, skip: 2 }), 'passed');
  assert.equal(svc.deriveStatus({ pass: 0, fail: 0, skip: 2 }), 'blocked');
  assert.equal(svc.deriveStatus({ pass: 0, fail: 0, skip: 0 }), 'pending');
});
