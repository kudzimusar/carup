/**
 * Workstreams C/D/E — Eligibility framework + insurance + finance tests.
 * Gates (fail-closed), sandbox scenarios, idempotency, append-only decisions, webhook
 * signature/replay/duplicate, finance consent requirement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const contract = await import('../services/eligibility/eligibilityContract.js');
const websec = await import('../services/eligibility/webhookSecurity.js');
const { supabase } = await import('../db/supabase.js');
const svc = await import('../services/eligibility/eligibilityService.js');

let db;
function reset() {
  db = {
    vehicles: [
      { vin: 'ELIGOKVIN00000001', tenant_id: 't1', owner_id: 'u1' },
      { vin: 'ELIGCONDVIN000001', tenant_id: 't1', owner_id: 'u1' },
      { vin: 'ELIGNOVIN00000001', tenant_id: 't1', owner_id: 'u1' },
    ],
    eligibility_requests: [], eligibility_decisions: [], eligibility_webhook_events: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, single: false, maybe: false, order: null, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
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
    // emulate UNIQUE(idempotency_key) on webhook events
    for (const p of list) if (st.table === 'eligibility_webhook_events' && p.idempotency_key && rows.some(r => r.idempotency_key === p.idempotency_key)) return { data: null, error: { message: 'duplicate key' } };
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-06-26T00:${String(rows.length + i).padStart(2, '0')}:00Z`, ...p }));
    rows.push(...ins); return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') { let u = null; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u = r; } return ok(st.single ? u : (u ? [u] : [])); }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}
function install() { reset(); supabase.from = (t) => builder(t); svc.initEligibility(); }

// Every dimension is stated EXPLICITLY. Phase 6 (bd23975b) fails closed on unknown gates: an
// omitted fraud/dealer/source fact is 'unknown', never 'clear'. A fixture that leaves
// dealer_suspended out is asserting the pre-hardening defect, so the clear case must say false.
const OK_CTX = { identity_status: 'complete', fraud_block: false, publication_status: 'publishable', dealer_suspended: false, source_coverage_connected: 1, min_source_coverage: 1 };

// ── gates (pure) ────────────────────────────────────────────────────────────────
test('gates: identity unresolved -> not_eligible', () => {
  const g = contract.evaluateGates('insurance', { identity_status: 'incomplete' });
  assert.equal(g.allowed, false); assert.equal(g.route, 'not_eligible');
});
test('gates: fraud block -> not_eligible', () => {
  assert.equal(contract.evaluateGates('insurance', { ...OK_CTX, fraud_block: true }).route, 'not_eligible');
});
test('gates: invalid publication -> not_eligible', () => {
  assert.equal(contract.evaluateGates('insurance', { ...OK_CTX, publication_status: 'draft' }).route, 'not_eligible');
});
test('gates: finance without consent -> manual_review', () => {
  assert.equal(contract.evaluateGates('finance', { ...OK_CTX }).route, 'manual_review');
});
test('gates: insufficient source coverage -> manual_review', () => {
  assert.equal(contract.evaluateGates('insurance', { ...OK_CTX, source_coverage_connected: 0, min_source_coverage: 2 }).route, 'manual_review');
});
test('gates: all clear -> allowed', () => {
  assert.equal(contract.evaluateGates('insurance', OK_CTX).allowed, true);
});
// Phase 6: absence is not clearance. Omitting a server-owned fact must never be read as a pass.
test('gates: omitted dealer posture -> manual_review (never implicit clear)', () => {
  const { dealer_suspended, ...noDealer } = OK_CTX;
  const g = contract.evaluateGates('insurance', noDealer);
  assert.equal(g.allowed, false);
  assert.equal(g.route, 'manual_review');
  assert.ok(g.reasons.includes('dealer_status_unknown'));
});
test('gates: omitted fraud posture -> manual_review (never implicit clear)', () => {
  const { fraud_block, ...noFraud } = OK_CTX;
  const g = contract.evaluateGates('insurance', noFraud);
  assert.equal(g.allowed, false);
  assert.equal(g.route, 'manual_review');
  assert.ok(g.reasons.includes('fraud_status_unknown'));
});
test('gates: omitted source coverage -> manual_review (never implicit clear)', () => {
  const { source_coverage_connected, ...noCoverage } = OK_CTX;
  const g = contract.evaluateGates('insurance', noCoverage);
  assert.equal(g.allowed, false);
  assert.equal(g.route, 'manual_review');
  assert.ok(g.reasons.includes('source_coverage_unknown'));
});
test('gates: omitted identity/publication -> not_eligible (hard prerequisite)', () => {
  assert.equal(contract.evaluateGates('insurance', {}).route, 'not_eligible');
  const { publication_status, ...noPub } = OK_CTX;
  assert.equal(contract.evaluateGates('insurance', noPub).route, 'not_eligible');
});

// ── webhook security ──────────────────────────────────────────────────────────
test('webhook: valid signature verifies', () => {
  const ts = String(Date.now()); const payload = '{"a":1}';
  const sig = websec.sign('insurance_sandbox', payload, ts);
  assert.equal(websec.verifyWebhook('insurance_sandbox', payload, sig, ts).valid, true);
});
test('webhook: tampered payload fails', () => {
  const ts = String(Date.now()); const sig = websec.sign('insurance_sandbox', '{"a":1}', ts);
  assert.equal(websec.verifyWebhook('insurance_sandbox', '{"a":2}', sig, ts).valid, false);
});
test('webhook: stale timestamp is a replay', () => {
  const old = String(Date.now() - 10 * 60 * 1000); const sig = websec.sign('insurance_sandbox', '{}', old);
  const v = websec.verifyWebhook('insurance_sandbox', '{}', sig, old);
  assert.equal(v.valid, false); assert.equal(v.replay, true);
});

// ── sandbox scenarios + service ───────────────────────────────────────────────
test('insurance: clean VIN -> eligible, sandbox mode, decision recorded', async () => {
  install();
  const r = await svc.requestEligibility('insurance', 'ELIGOKVIN00000001', { gateContext: OK_CTX, requestedBy: 'u1' });
  assert.equal(r.status, 'eligible'); assert.equal(r.mode, 'sandbox');
  assert.equal(db.eligibility_decisions.length, 1);
});
test('insurance: ELIGCOND VIN -> conditionally_eligible with conditions + validity', async () => {
  install();
  const r = await svc.requestEligibility('insurance', 'ELIGCONDVIN000001', { gateContext: OK_CTX });
  assert.equal(r.status, 'conditionally_eligible'); assert.ok(r.conditions.length > 0); assert.ok(r.validity_until);
});
test('finance: ELIGCOND VIN with consent -> potentially_eligible', async () => {
  install();
  const r = await svc.requestEligibility('finance', 'ELIGCONDVIN000001', { gateContext: { ...OK_CTX }, consentReference: 'consent-1' });
  assert.equal(r.status, 'potentially_eligible');
});
test('finance: without consent routes to manual_review (gate, provider not called)', async () => {
  install();
  const r = await svc.requestEligibility('finance', 'ELIGOKVIN00000001', { gateContext: OK_CTX });
  assert.equal(r.status, 'manual_review');
});
test('idempotency: same key returns the same request, no duplicate', async () => {
  install();
  const a = await svc.requestEligibility('insurance', 'ELIGOKVIN00000001', { gateContext: OK_CTX, idempotencyKey: 'idem-1' });
  const b = await svc.requestEligibility('insurance', 'ELIGOKVIN00000001', { gateContext: OK_CTX, idempotencyKey: 'idem-1' });
  assert.equal(a.id, b.id);
  assert.equal(db.eligibility_requests.length, 1);
});
test('not_eligible gate produces gate_failed error category', async () => {
  install();
  const r = await svc.requestEligibility('insurance', 'ELIGOKVIN00000001', { gateContext: { ...OK_CTX, fraud_block: true } });
  assert.equal(r.status, 'not_eligible'); assert.equal(r.error_category, 'gate_failed');
});
test('webhook ingest: valid signed event applies the new status', async () => {
  install();
  const r = await svc.requestEligibility('insurance', 'ELIGOKVIN00000001', { gateContext: OK_CTX });
  const body = { request_id: r.id, status: 'eligible', event_type: 'decision' };
  const payload = JSON.stringify(body); const ts = String(Date.now());
  const sig = websec.sign('insurance_sandbox', payload, ts);
  const out = await svc.ingestWebhook('insurance', { providerId: 'insurance_sandbox', payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'wh-1', body });
  assert.equal(out.applied, true);
});
test('webhook ingest: invalid signature is recorded but not applied', async () => {
  install();
  const out = await svc.ingestWebhook('insurance', { providerId: 'insurance_sandbox', payloadString: '{}', signature: 'bad', timestamp: String(Date.now()), idempotencyKey: 'wh-2', body: { request_id: 'x', status: 'eligible' } });
  assert.equal(out.applied, false); assert.equal(out.signature_valid, false);
  assert.equal(db.eligibility_webhook_events.length, 1);
});
test('webhook ingest: duplicate idempotency key not re-applied', async () => {
  install();
  const r = await svc.requestEligibility('insurance', 'ELIGOKVIN00000001', { gateContext: OK_CTX });
  const body = { request_id: r.id, status: 'conditionally_eligible' };
  const payload = JSON.stringify(body); const ts = String(Date.now());
  const sig = websec.sign('insurance_sandbox', payload, ts);
  await svc.ingestWebhook('insurance', { providerId: 'insurance_sandbox', payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'dup', body });
  const second = await svc.ingestWebhook('insurance', { providerId: 'insurance_sandbox', payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'dup', body });
  assert.equal(second.applied, false); assert.equal(second.reason, 'duplicate');
});
test('disabled capability in production fails closed to unavailable', async () => {
  reset(); supabase.from = (t) => builder(t);
  svc.initEligibility({ insurance: () => false });
  const r = await svc.requestEligibility('insurance', 'ELIGOKVIN00000001', { gateContext: OK_CTX });
  assert.equal(r.mode, 'unavailable'); assert.equal(r.status, 'unavailable');
});
