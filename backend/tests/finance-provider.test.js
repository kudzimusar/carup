/**
 * Full Activation — regulated-lender (finance) provider workflow tests (canonical §101-113).
 *
 * Covers: consent requirement (no consent -> gated, lender NOT called); the finance outcome
 * matrix (potentially_eligible/conditional/manual_review/declined/unavailable/failed) driven
 * through the provider framework + simulator; fraud & publication gates blocking the call;
 * webhook valid / invalid-signature / replay / duplicate; the privacy invariant (applicant /
 * credit / decision data NEVER in the public/partner projection, forbidden keys stripped from
 * the gate snapshot); append-only decisions; and applicant deletion/retention recording.
 *
 * In-memory Supabase mock (mirrors provider-platform.test.js / eligibility.test.js). Run:
 *   node --test backend/tests/finance-provider.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const reg = await import('../services/providerPlatform/providerRegistry.js');
const websec = await import('../services/eligibility/webhookSecurity.js');
const wf = await import('../services/finance/lenderWorkflow.js');

// ── in-memory supabase mock ──────────────────────────────────────────────────
let db;
function reset() {
  db = {
    users: [{ id: 'admin-1', role: 'admin' }, { id: 'u1', role: 'owner' }],
    vehicles: [{ vin: 'FINCLEANVIN000001', owner_id: 'u1', tenant_id: 't1' }],
    provider_registry: [], provider_activation_history: [], provider_request_attempts: [],
    provider_health_checks: [], provider_incidents: [],
    eligibility_requests: [], eligibility_webhook_events: [],
    finance_consents: [], finance_provider_decisions: [], lender_profiles: [],
  };
}
// tables with a UNIQUE(idempotency_key) constraint the mock enforces.
const UNIQ_IDEM = new Set(['provider_request_attempts', 'eligibility_webhook_events']);
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
    for (const p of list) if (UNIQ_IDEM.has(st.table) && p.idempotency_key && rows.some(r => r.idempotency_key === p.idempotency_key)) return { data: null, error: { message: 'dup idempotency' } };
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

// Phase 6 fails closed on unknown gates: an omitted dealer_suspended is 'unknown', not 'clear'.
const OK_CTX = { identity_status: 'complete', fraud_block: false, publication_status: 'publishable', dealer_suspended: false, source_coverage_connected: 1, min_source_coverage: 1 };

// Register a callable sandbox finance lender + return the loaded registry row.
async function registerLender() {
  const p = await reg.upsertProvider({ provider_key: 'lender_sandbox', capability_type: 'finance', display_name: 'Regulated Lender (sandbox)' }, { id: 'admin-1' });
  await reg.setActivationMode(p.id, 'sandbox', { actor: { id: 'admin-1' } });
  await reg.setKillSwitch(p.id, false, { actor: { id: 'admin-1' } });
  // Onboard the matching active lender_profile (drives coarse public availability).
  db.lender_profiles.push({ id: 'lp-1', provider_id: p.id, legal_name: 'Regulated Lender (sandbox)', contract_status: 'signed', active: true });
  return db.provider_registry.find(x => x.id === p.id);
}
async function seedVehicle(vin) { db.vehicles.push({ vin, owner_id: 'u1', tenant_id: 't1' }); }
async function grantConsent(vin) { const c = await wf.recordApplicantConsent(vin, 'u1', { consentVersion: 'consent-v1', scope: { share_trust: true } }); return c.id; }

// ── consent requirement ─────────────────────────────────────────────────────
test('consent required: no consent -> gated to manual_review, lender NOT called', async () => {
  install(); await registerLender();
  const out = await wf.requestLenderEligibility('FINCLEANVIN000001', { gateContext: OK_CTX, requestedBy: 'u1' });
  assert.equal(out.decision.outcome, 'manual_review');
  assert.equal(out.providerCalled, false);
  assert.ok(out.reasons.includes('consent_missing'));
  assert.equal(db.provider_request_attempts.length, 0); // provider framework never invoked
});

test('consent revoked -> treated as missing (gated, lender not called)', async () => {
  install(); await registerLender();
  const consentRef = await grantConsent('FINCLEANVIN000001');
  await wf.requestApplicantDeletion(consentRef); // stamps revoked + deletion_requested
  const out = await wf.requestLenderEligibility('FINCLEANVIN000001', { applicantConsentRef: consentRef, gateContext: OK_CTX, requestedBy: 'u1' });
  assert.equal(out.providerCalled, false);
  assert.equal(out.decision.outcome, 'manual_review');
});

// ── finance outcome matrix (through the provider framework + simulator) ───────
const MATRIX = [
  ['FINCLEANVIN000001', 'potentially_eligible'],
  ['MISMATCHFINVIN01', 'conditional'],
  ['NORECORDFINVIN01', 'manual_review'],
  ['STOLENFINVIN0001', 'declined'],
  ['UNAVAILFINVIN001', 'unavailable'],
];
for (const [vin, expected] of MATRIX) {
  test(`outcome: ${vin} -> ${expected}`, async () => {
    install(); await registerLender(); if (vin !== 'FINCLEANVIN000001') await seedVehicle(vin);
    const consentRef = await grantConsent(vin);
    const out = await wf.requestLenderEligibility(vin, { applicantConsentRef: consentRef, gateContext: OK_CTX, requestedBy: 'u1' });
    assert.equal(out.decision.outcome, expected);
    assert.equal(out.providerCalled, true);
  });
}

test('outcome: timeout VIN retries then fails (dead-letter)', async () => {
  install(); await registerLender(); await seedVehicle('TIMEOUTFINVIN001');
  const consentRef = await grantConsent('TIMEOUTFINVIN001');
  const out = await wf.requestLenderEligibility('TIMEOUTFINVIN001', { applicantConsentRef: consentRef, gateContext: OK_CTX, requestedBy: 'u1' });
  assert.equal(out.decision.outcome, 'failed');
  assert.ok(db.provider_request_attempts.filter(a => a.outcome === 'timeout').length >= 1);
});

// ── gates block the call ─────────────────────────────────────────────────────
test('gate: fraud block -> declined, lender NOT called', async () => {
  install(); await registerLender();
  const consentRef = await grantConsent('FINCLEANVIN000001');
  const out = await wf.requestLenderEligibility('FINCLEANVIN000001', { applicantConsentRef: consentRef, gateContext: { ...OK_CTX, fraud_block: true }, requestedBy: 'u1' });
  assert.equal(out.decision.outcome, 'declined');
  assert.equal(out.providerCalled, false);
  assert.equal(db.provider_request_attempts.length, 0);
});
test('gate: invalid publication -> declined, lender NOT called', async () => {
  install(); await registerLender();
  const consentRef = await grantConsent('FINCLEANVIN000001');
  const out = await wf.requestLenderEligibility('FINCLEANVIN000001', { applicantConsentRef: consentRef, gateContext: { ...OK_CTX, publication_status: 'draft' }, requestedBy: 'u1' });
  assert.equal(out.decision.outcome, 'declined');
  assert.equal(out.providerCalled, false);
});

// ── unavailable when lender is not callable (fail-closed) ─────────────────────
test('unavailable: no registered lender -> unavailable, fail-closed', async () => {
  install(); // no lender registered
  const consentRef = await grantConsent('FINCLEANVIN000001');
  const out = await wf.requestLenderEligibility('FINCLEANVIN000001', { applicantConsentRef: consentRef, gateContext: OK_CTX, requestedBy: 'u1' });
  assert.equal(out.decision.outcome, 'unavailable');
  assert.equal(out.providerCalled, false);
});

// ── webhook security ─────────────────────────────────────────────────────────
async function makeRequest() {
  const consentRef = await grantConsent('FINCLEANVIN000001');
  const out = await wf.requestLenderEligibility('FINCLEANVIN000001', { applicantConsentRef: consentRef, gateContext: OK_CTX, requestedBy: 'u1' });
  return out.request.id;
}
test('webhook: valid signed event appends a decision + updates the request', async () => {
  install(); await registerLender();
  const reqId = await makeRequest();
  const before = db.finance_provider_decisions.length;
  const body = { request_id: reqId, outcome: 'conditional', conditions: ['proof_of_income_required'], event_type: 'lender_decision' };
  const payload = JSON.stringify(body); const ts = String(Date.now());
  const sig = websec.sign('finance_sandbox', payload, ts);
  const res = await wf.ingestLenderWebhook({ providerId: 'finance_sandbox', payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'wh-1', body });
  assert.equal(res.applied, true);
  assert.equal(db.finance_provider_decisions.length, before + 1); // appended, not mutated
  assert.equal(db.eligibility_requests.find(r => r.id === reqId).status, 'conditionally_eligible');
});
test('webhook: invalid signature recorded but not applied', async () => {
  install(); await registerLender();
  const res = await wf.ingestLenderWebhook({ providerId: 'finance_sandbox', payloadString: '{}', signature: 'bad', timestamp: String(Date.now()), idempotencyKey: 'wh-2', body: { request_id: 'x', outcome: 'declined' } });
  assert.equal(res.applied, false);
  assert.equal(res.signature_valid, false);
  assert.equal(db.eligibility_webhook_events.length, 1); // audit recorded
});
test('webhook: stale timestamp is a replay (rejected)', async () => {
  install(); await registerLender();
  const body = { request_id: 'x', outcome: 'declined' };
  const payload = JSON.stringify(body); const old = String(Date.now() - 10 * 60 * 1000);
  const sig = websec.sign('finance_sandbox', payload, old);
  const res = await wf.ingestLenderWebhook({ providerId: 'finance_sandbox', payloadString: payload, signature: sig, timestamp: old, idempotencyKey: 'wh-3', body });
  assert.equal(res.applied, false);
  assert.equal(res.reason, 'timestamp_drift');
});
test('webhook: duplicate idempotency key not re-applied', async () => {
  install(); await registerLender();
  const reqId = await makeRequest();
  const body = { request_id: reqId, outcome: 'declined' };
  const payload = JSON.stringify(body); const ts = String(Date.now());
  const sig = websec.sign('finance_sandbox', payload, ts);
  await wf.ingestLenderWebhook({ providerId: 'finance_sandbox', payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'dup', body });
  const second = await wf.ingestLenderWebhook({ providerId: 'finance_sandbox', payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'dup', body });
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'duplicate');
});
test('webhook: fail-closed on missing secret in production', async () => {
  install();
  const prev = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try {
    const body = { request_id: 'x', outcome: 'declined' };
    const payload = JSON.stringify(body); const ts = String(Date.now());
    const res = await wf.ingestLenderWebhook({ providerId: 'finance_sandbox', payloadString: payload, signature: 'anything', timestamp: ts, idempotencyKey: 'wh-fc', body });
    assert.equal(res.applied, false);
    assert.equal(res.signature_valid, false); // no usable secret -> cannot verify
  } finally { process.env.NODE_ENV = prev; }
});

// ── privacy invariant ────────────────────────────────────────────────────────
test('privacy: public projection exposes ONLY coarse availability (no applicant/credit/decision data)', async () => {
  install(); await registerLender();
  const consentRef = await grantConsent('FINCLEANVIN000001');
  await wf.requestLenderEligibility('FINCLEANVIN000001', { applicantConsentRef: consentRef, gateContext: OK_CTX, requestedBy: 'u1' });
  const pub = await wf.financeAvailabilityPublic('FINCLEANVIN000001');
  assert.deepEqual(Object.keys(pub).sort(), ['detail', 'finance', 'vin']);
  assert.equal(pub.finance, 'available');
  const s = JSON.stringify(pub);
  for (const k of ['outcome', 'provider_reference', 'income', 'credit_score', 'affordability', 'decision_inputs', 'applicant']) {
    assert.ok(!s.includes(k), `public projection must not contain '${k}'`);
  }
});
test('privacy: forbidden keys are stripped from the gate snapshot (never persisted)', async () => {
  install(); await registerLender();
  const consentRef = await grantConsent('FINCLEANVIN000001');
  // A caller maliciously/accidentally passes sensitive fields — they must NOT be stored.
  const dirty = { ...OK_CTX, income: 9000, credit_score: 720, affordability: { dti: 0.2 }, monthly_debts: 500 };
  const out = await wf.requestLenderEligibility('FINCLEANVIN000001', { applicantConsentRef: consentRef, gateContext: dirty, requestedBy: 'u1' });
  const snap = out.decision.decision_inputs_snapshot;
  for (const k of ['income', 'credit_score', 'affordability', 'monthly_debts']) assert.ok(!(k in snap), `snapshot must not contain ${k}`);
  assert.equal(snap.identity_status, 'complete'); // gate context retained
});

// ── append-only decisions ────────────────────────────────────────────────────
test('append-only: each request persists a new decision row', async () => {
  install(); await registerLender();
  const consentRef = await grantConsent('FINCLEANVIN000001');
  await wf.requestLenderEligibility('FINCLEANVIN000001', { applicantConsentRef: consentRef, gateContext: OK_CTX, requestedBy: 'u1' });
  await wf.requestLenderEligibility('FINCLEANVIN000001', { applicantConsentRef: consentRef, gateContext: OK_CTX, requestedBy: 'u1' });
  assert.equal(db.finance_provider_decisions.length, 2);
});

// ── applicant deletion / retention control ───────────────────────────────────
test('retention: applicant deletion request is recorded (stamps + audit)', async () => {
  install();
  const consentRef = await grantConsent('FINCLEANVIN000001');
  const out = await wf.requestApplicantDeletion(consentRef, { actor: 'u1' });
  assert.ok(out.deletion_requested_at);
  const consent = db.finance_consents.find(c => c.id === consentRef);
  assert.ok(consent.deletion_requested_at);
  assert.ok(consent.revoked_at);
});
