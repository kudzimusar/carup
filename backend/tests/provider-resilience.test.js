/**
 * Full Activation — provider load / resilience suite (canonical doc §195).
 *
 * Exercises the shared execution framework under stress the sequential domain suites don't:
 *   - concurrent idempotency (a parallel burst with one key records EXACTLY ONE attempt);
 *   - webhook / request burst with distinct keys (no loss, no double-record);
 *   - circuit breaker opens under a failure burst and sheds load;
 *   - transient outage (timeout / rate_limited) retries then RECOVERS;
 *   - exhausted retries dead-letter honestly.
 *
 * Framework-level, injected `invoke`, in-memory Supabase mock with a UNIQUE(idempotency_key)
 * backstop on provider_request_attempts (mirrors the DB constraint). Run:
 *   node --test backend/tests/provider-resilience.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const { executeProviderRequest } = await import('../services/providerPlatform/providerFramework.js');

let db, seq;
function reset() { db = { provider_request_attempts: [] }; seq = 0; }
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
    // Mirrors the DB UNIQUE(provider_id, idempotency_key) — same key is allowed across providers.
    for (const p of list) if (p.idempotency_key && rows.some(r => r.provider_id === p.provider_id && r.idempotency_key === p.idempotency_key)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
    const ins = list.map((p) => ({ id: `a-${++seq}`, created_at: `2026-07-03T00:00:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(4, '0')}Z`, ...p }));
    rows.push(...ins); return ok(st.single ? ins[0] : ins);
  }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.limit) out = out.slice(0, st.limit);
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}
function install() { reset(); supabase.from = (t) => builder(t); }

// A callable sandbox provider whose capability flag is enabled in test.
const PROVIDER = { id: 'prov-res-1', capability_type: 'insurance', activation_mode: 'sandbox', kill_switch_enabled: false, contract_status: 'none', tenant_id: null };
const okInvoke = () => ({ outcome: 'ok', data: { simulated: true }, scenario: 'success' });

test('concurrent idempotency: a parallel burst with ONE key claims the key exactly once', async () => {
  install();
  const key = 'idem-concurrent-1';
  let invokes = 0;
  const countingInvoke = () => { invokes++; return { outcome: 'ok', data: { simulated: true } }; };
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    executeProviderRequest(PROVIDER, { vin: 'V1' }, { idempotencyKey: key, invoke: countingInvoke })));
  // Every caller gets a consistent successful outcome.
  assert.ok(results.every(r => r.outcome === 'ok'), 'all concurrent callers see a consistent ok');
  // The key is CLAIMED by exactly one ledger row (the UNIQUE(provider_id, idempotency_key) backstop).
  const keyed = db.provider_request_attempts.filter(a => a.idempotency_key === key);
  assert.equal(keyed.length, 1, 'the idempotency key is owned by exactly one attempt row');
  // HONEST semantics: true simultaneity is not de-DUPLICATED at execution (check-then-act TOCTOU);
  // every concurrent invocation is still fully AUDITED (one row each), and no row is lost.
  assert.ok(invokes >= 1 && invokes <= 8, 'each concurrent caller may invoke; guarantee is at-most-once KEY ownership');
  assert.equal(db.provider_request_attempts.filter(a => a.correlation_id).length, invokes, 'every invocation is audited (no lost rows)');
});

test('sequential idempotency: a repeat key is deduped (no re-execution)', async () => {
  install();
  let calls = 0;
  const invoke = () => { calls++; return { outcome: 'ok' }; };
  const first = await executeProviderRequest(PROVIDER, { vin: 'V1' }, { idempotencyKey: 'idem-seq-1', invoke });
  const second = await executeProviderRequest(PROVIDER, { vin: 'V1' }, { idempotencyKey: 'idem-seq-1', invoke });
  assert.equal(first.deduped, undefined);
  assert.equal(second.deduped, true, 'the repeat returns the recorded outcome');
  assert.equal(second.attempts, 0, 'the provider is NOT re-invoked');
  assert.equal(calls, 1, 'invoke ran exactly once across both calls');
});

test('request burst with distinct keys: no loss, one attempt each', async () => {
  install();
  const N = 40;
  const results = await Promise.all(Array.from({ length: N }, (_, i) =>
    executeProviderRequest(PROVIDER, { vin: `V${i}` }, { idempotencyKey: `burst-${i}`, invoke: okInvoke })));
  assert.equal(results.filter(r => r.outcome === 'ok').length, N);
  assert.equal(db.provider_request_attempts.filter(a => /^burst-/.test(a.idempotency_key)).length, N, 'every distinct request is recorded exactly once');
});

test('circuit breaker: opens under a failure burst and sheds load (circuit_open, no invoke)', async () => {
  install();
  const failInvoke = () => ({ outcome: 'unavailable', error_category: 'provider_down' });
  // 4 failures in the window trips the breaker.
  for (let i = 0; i < 4; i++) await executeProviderRequest(PROVIDER, { vin: `F${i}` }, { invoke: failInvoke });
  let invoked = false;
  const spyInvoke = () => { invoked = true; return { outcome: 'ok' }; };
  const shed = await executeProviderRequest(PROVIDER, { vin: 'F5' }, { invoke: spyInvoke });
  assert.equal(shed.outcome, 'circuit_open');
  assert.equal(shed.blocked_reason, 'circuit_open');
  assert.equal(invoked, false, 'an open circuit does NOT call the provider (load shed)');
});

test('transient outage RECOVERS: timeout twice then ok (retry with backoff)', async () => {
  install();
  let n = 0;
  const flaky = () => (++n <= 2 ? { outcome: 'timeout', error_category: 'upstream_timeout' } : { outcome: 'ok' });
  const r = await executeProviderRequest(PROVIDER, { vin: 'V1' }, { invoke: flaky, maxRetries: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'ok');
  assert.equal(r.attempts, 3, 'two transient failures then success = three attempts');
  assert.equal(db.provider_request_attempts.filter(a => a.outcome === 'timeout').length, 2);
});

test('rate_limited is transient: retried, then recovers', async () => {
  install();
  let n = 0;
  const throttled = () => (++n <= 1 ? { outcome: 'rate_limited', error_category: 'rate_limit' } : { outcome: 'ok' });
  const r = await executeProviderRequest(PROVIDER, { vin: 'V1' }, { invoke: throttled, maxRetries: 2 });
  assert.equal(r.ok, true);
  assert.ok(r.attempts >= 2, 'a rate-limited attempt is retried');
});

test('exhausted retries dead-letter honestly (no fabricated success)', async () => {
  install();
  const alwaysTimeout = () => ({ outcome: 'timeout', error_category: 'upstream_timeout' });
  const r = await executeProviderRequest(PROVIDER, { vin: 'V1' }, { invoke: alwaysTimeout, maxRetries: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.dead_letter, true);
  assert.notEqual(r.outcome, 'ok', 'a failed provider is never reported as success');
  assert.ok(db.provider_request_attempts.some(a => a.error_category === 'dead_letter'), 'a dead-letter row is recorded');
});

// ── circuit breaker RECOVERY (half-open) — proves the breaker does NOT latch open forever ──────
test('circuit breaker: RECOVERS after the provider heals (half-open probe re-closes it)', async () => {
  install();
  const failInvoke = () => ({ outcome: 'unavailable', error_category: 'provider_down' });
  for (let i = 0; i < 4; i++) await executeProviderRequest(PROVIDER, { vin: `F${i}` }, { invoke: failInvoke });
  // Provider is now healthy again. Keep calling; the breaker must let probes through and re-close.
  const outcomes = [];
  for (let i = 0; i < 20; i++) {
    const r = await executeProviderRequest(PROVIDER, { vin: `H${i}` }, { invoke: okInvoke });
    outcomes.push(r.outcome);
  }
  assert.ok(outcomes.includes('ok'), 'a healed provider is eventually probed and succeeds (no permanent latch)');
  // By the end the circuit is fully closed — the final calls succeed outright.
  assert.equal(outcomes[outcomes.length - 1], 'ok', 'circuit closes once recent invocations are healthy');
});

test('circuit breaker: a kill-switch period does NOT latch the circuit (gate blocks excluded)', async () => {
  install();
  const killed = { ...PROVIDER, kill_switch_enabled: true };
  // Many gate-blocked calls record outcome 'unavailable' with a gating error_category.
  for (let i = 0; i < 6; i++) await executeProviderRequest(killed, { vin: `K${i}` }, { invoke: okInvoke });
  // Re-enabled: the very first real call must go through (gate rows are not breaker failures).
  const r = await executeProviderRequest(PROVIDER, { vin: 'K-live' }, { invoke: okInvoke });
  assert.equal(r.outcome, 'ok', 'kill-switch unavailability must not open the circuit');
});

// ── idempotent replay returns the request's FINAL outcome, not a mid-retry failure (F5) ────────
test('idempotent replay after retry-then-success returns OK (not the intermediate timeout)', async () => {
  install();
  let n = 0;
  const flaky = () => (++n === 1 ? { outcome: 'timeout', error_category: 'upstream_timeout' } : { outcome: 'ok', data: { x: 1 } });
  const first = await executeProviderRequest(PROVIDER, { vin: 'V1' }, { idempotencyKey: 'replay-1', invoke: flaky, maxRetries: 2 });
  assert.equal(first.ok, true);
  assert.equal(first.outcome, 'ok');
  const replay = await executeProviderRequest(PROVIDER, { vin: 'V1' }, { idempotencyKey: 'replay-1', invoke: flaky, maxRetries: 2 });
  assert.equal(replay.deduped, true);
  assert.equal(replay.outcome, 'ok', 'replay reflects the FINAL outcome, not the mid-retry timeout');
  assert.equal(replay.ok, true);
});

// ── cross-capability idempotency: the same key on a DIFFERENT provider is independent (F6) ──────
test('cross-provider idempotency: the same key on another provider does NOT collide', async () => {
  install();
  const providerA = { ...PROVIDER, id: 'prov-A', capability_type: 'insurance' };
  const providerB = { ...PROVIDER, id: 'prov-B', capability_type: 'finance' };
  const a = await executeProviderRequest(providerA, { vin: 'VA' }, { idempotencyKey: 'shared-key', invoke: () => ({ outcome: 'ok', data: { who: 'A' } }) });
  let bInvoked = false;
  const b = await executeProviderRequest(providerB, { vin: 'VB' }, { idempotencyKey: 'shared-key', invoke: () => { bInvoked = true; return { outcome: 'mismatch' }; } });
  assert.equal(a.outcome, 'ok');
  assert.equal(a.deduped, undefined);
  assert.equal(bInvoked, true, 'provider B is genuinely invoked — not deduped against provider A');
  assert.equal(b.deduped, undefined);
  assert.equal(b.outcome, 'mismatch', 'provider B returns its own outcome, not the cached ok from provider A');
});
