/**
 * Full Activation — shared provider platform tests: simulator matrix, registry (fail-closed
 * defaults, append-only activation history, no-secret guard, live gating), and the execution
 * framework (kill-switch/mode/flag gating, idempotency, retries, circuit breaker, dead-letter).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const sim = await import('../services/providerPlatform/simulators.js');
const { supabase } = await import('../db/supabase.js');
const reg = await import('../services/providerPlatform/providerRegistry.js');
const fw = await import('../services/providerPlatform/providerFramework.js');

// ── in-memory supabase mock ──────────────────────────────────────────────────
let db;
function reset() { db = { users: [{ id: 'admin-1', role: 'admin' }], provider_registry: [], provider_activation_history: [], provider_request_attempts: [], provider_health_checks: [], provider_incidents: [] }; }
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
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    for (const p of list) if (st.table === 'provider_request_attempts' && p.idempotency_key && rows.some(r => r.idempotency_key === p.idempotency_key)) return { data: null, error: { message: 'dup idempotency' } };
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-07-03T00:00:${String(rows.length + i).padStart(2, '0')}Z`, ...p }));
    rows.push(...ins); return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') { let u = null; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u = r; } return ok(st.single ? u : (u ? [u] : [])); }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.limit) out = out.slice(0, st.limit);
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}
function install() { reset(); supabase.from = (t) => builder(t); }

// ── simulators ────────────────────────────────────────────────────────────────
test('simulator: all 11 scenarios resolve + map to an outcome', () => {
  for (const s of sim.SIM_SCENARIOS) {
    const r = sim.simulateProvider('government_source', { scenario: s });
    assert.equal(r.scenario, s);
    assert.ok(r.outcome, `no outcome for ${s}`);
  }
});
test('simulator: VIN-driven scenario selection is deterministic', () => {
  assert.equal(sim.resolveScenario({ vin: 'MISMATCHVIN' }), 'mismatch');
  assert.equal(sim.resolveScenario({ vin: 'STOLENVIN' }), 'high_risk');
  assert.equal(sim.resolveScenario({ vin: 'TIMEOUTVIN' }), 'timeout');
  assert.equal(sim.resolveScenario({ vin: 'CLEANVIN' }), 'success');
});
test('simulator: transient scenarios are retryable, terminal are not', () => {
  assert.equal(sim.simulateProvider('insurance', { scenario: 'timeout' }).retryable, true);
  assert.equal(sim.simulateProvider('insurance', { scenario: 'rate_limit' }).retryable, true);
  assert.equal(sim.simulateProvider('insurance', { scenario: 'high_risk' }).retryable, false);
});
test('simulator: data is honestly tagged SIMULATED (never official)', () => {
  const r = sim.simulateProvider('government_source', { scenario: 'success' });
  assert.equal(r.data.tag, 'SIMULATED');
});

// ── registry ──────────────────────────────────────────────────────────────────
test('registry: new provider is fail-closed (kill switch on, not_configured)', async () => {
  install();
  const p = await reg.upsertProvider({ provider_key: 'zimra', capability_type: 'government_source', display_name: 'ZIMRA' }, { id: 'admin-1' });
  assert.equal(p.kill_switch_enabled, true);
  assert.equal(p.activation_mode, 'not_configured');
});
test('registry: refuses to store an apparent secret in credential_ref', async () => {
  install();
  await assert.rejects(() => reg.upsertProvider({ provider_key: 'x', capability_type: 'insurance', credential_ref: 'sbp_abcdefghijklmnopqrstuv' }), /secret/);
});
test('registry: setActivationMode records append-only history', async () => {
  install();
  const p = await reg.upsertProvider({ provider_key: 'cvr', capability_type: 'government_source' }, { id: 'admin-1' });
  await reg.setActivationMode(p.id, 'sandbox', { reason: 'staging', actor: { id: 'admin-1', role: 'admin' } });
  assert.equal(db.provider_activation_history.length, 1);
  assert.equal(db.provider_activation_history[0].to_mode, 'sandbox');
});
test('registry: live requires signed contract + credential_ref', async () => {
  install();
  const p = await reg.upsertProvider({ provider_key: 'ins', capability_type: 'insurance' }, { id: 'admin-1' });
  await assert.rejects(() => reg.setActivationMode(p.id, 'live', { actor: { id: 'admin-1' } }), /requires contract_status=signed/);
});
test('registry: isCallable is fail-closed', () => {
  assert.equal(reg.isCallable(null).callable, false);
  assert.equal(reg.isCallable({ kill_switch_enabled: true, activation_mode: 'sandbox' }).callable, false);
  assert.equal(reg.isCallable({ kill_switch_enabled: false, activation_mode: 'not_configured' }).callable, false);
  assert.equal(reg.isCallable({ kill_switch_enabled: false, activation_mode: 'sandbox' }).callable, true);
});

// ── framework ───────────────────────────────────────────────────────────────
async function callableProvider(cap = 'government_source') {
  const p = await reg.upsertProvider({ provider_key: 'p_' + cap, capability_type: cap }, { id: 'admin-1' });
  await reg.setActivationMode(p.id, 'sandbox', { actor: { id: 'admin-1' } });
  await reg.setKillSwitch(p.id, false, { actor: { id: 'admin-1' } });
  return db.provider_registry.find(x => x.id === p.id);
}
test('framework: kill switch blocks the call (fail-closed, recorded)', async () => {
  install();
  const p = await reg.upsertProvider({ provider_key: 'k', capability_type: 'government_source' }, { id: 'admin-1' });
  const r = await fw.executeProviderRequest(db.provider_registry.find(x => x.id === p.id), { vin: 'CLEANVIN' });
  assert.equal(r.ok, false); assert.equal(r.blocked_reason, 'kill_switch');
});
test('framework: callable sandbox provider returns ok for a clean VIN', async () => {
  install();
  const p = await callableProvider();
  const r = await fw.executeProviderRequest(p, { vin: 'CLEANVIN' });
  assert.equal(r.ok, true); assert.equal(r.outcome, 'ok'); assert.equal(r.mode, 'sandbox');
});
test('framework: high-risk VIN returns high_risk (no retry)', async () => {
  install();
  const p = await callableProvider();
  const r = await fw.executeProviderRequest(p, { vin: 'STOLENVIN' });
  assert.equal(r.outcome, 'high_risk'); assert.equal(r.attempts, 1);
});
test('framework: timeout retries then dead-letters', async () => {
  install();
  const p = await callableProvider();
  const r = await fw.executeProviderRequest(p, { vin: 'TIMEOUTVIN' }, { maxRetries: 2 });
  assert.ok(r.attempts >= 3); // 1 + 2 retries
  assert.ok(db.provider_request_attempts.filter(a => a.outcome === 'timeout').length >= 1);
});
test('framework: idempotency key dedupes a repeat call', async () => {
  install();
  const p = await callableProvider();
  const a = await fw.executeProviderRequest(p, { vin: 'CLEANVIN' }, { idempotencyKey: 'idem-1' });
  const b = await fw.executeProviderRequest(p, { vin: 'CLEANVIN' }, { idempotencyKey: 'idem-1' });
  assert.equal(b.deduped, true); assert.equal(b.outcome, a.outcome);
});
test('framework: circuit opens after repeated failures', async () => {
  install();
  const p = await callableProvider();
  // drive 4 unavailable attempts into the log
  for (let i = 0; i < 4; i++) db.provider_request_attempts.push({ provider_id: p.id, outcome: 'unavailable', created_at: `2026-07-03T01:0${i}:00Z` });
  const r = await fw.executeProviderRequest(p, { vin: 'CLEANVIN' });
  assert.equal(r.outcome, 'circuit_open');
});
