/**
 * Full Activation — licensed INSURER provider workflow tests (canonical doc §84–99).
 *
 * Covers: consent requirement + scope; eligible / conditional / manual_review / declined /
 * unavailable outcomes via the deterministic sandbox simulator; identity + fraud gate blocks
 * (provider never called); signed webhook applies; invalid-signature rejected; replay rejected;
 * duplicate idempotency not re-applied; NO underwriting data in the public projection; and the
 * append-only insurer decision ledger. In-memory supabase mock (no DB), mirroring
 * provider-platform.test.js + eligibility.test.js conventions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const reg = await import('../services/providerPlatform/providerRegistry.js');
const wf = await import('../services/insurance/insurerWorkflow.js');

// ── in-memory supabase mock (union of the platform + eligibility mocks) ─────────
let db;
function reset() {
  db = {
    users: [{ id: 'admin-1', role: 'admin' }, { id: 'owner-1', role: 'owner' }],
    vehicles: [
      { vin: 'CLEANVIN00000001', owner_id: 'owner-1', tenant_id: 't1', make: 'Toyota', model: 'Hilux', year: 2019 },
      { vin: 'MISMATCHVIN000001', owner_id: 'owner-1', tenant_id: 't1', make: 'Nissan', model: 'NP200', year: 2018 },
      { vin: 'NORECORDVIN000001', owner_id: 'owner-1', tenant_id: 't1', make: 'Ford', model: 'Ranger', year: 2020 },
      { vin: 'STOLENVIN00000001', owner_id: 'owner-1', tenant_id: 't1', make: 'VW', model: 'Polo', year: 2017 },
      { vin: 'UNAVAILVIN0000001', owner_id: 'owner-1', tenant_id: 't1', make: 'Mazda', model: 'BT50', year: 2016 },
    ],
    provider_registry: [], provider_activation_history: [], provider_request_attempts: [],
    provider_health_checks: [], provider_incidents: [],
    insurer_profiles: [], insurance_consents: [], insurance_provider_decisions: [],
    eligibility_requests: [], eligibility_webhook_events: [],
  };
}
const UNIQUE_IDEM = new Set(['provider_request_attempts', 'eligibility_webhook_events']);
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
    for (const p of list) if (UNIQUE_IDEM.has(st.table) && p.idempotency_key && rows.some(r => r.idempotency_key === p.idempotency_key)) return { data: null, error: { message: 'duplicate key' } };
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

// Register a callable sandbox insurer + an active profile + an owner consent. Returns {profile, consentRef}.
async function onboardInsurer({ scopeFields = ['vin', 'make'], required = ['vin'] } = {}) {
  const provider = await reg.upsertProvider({ provider_key: 'insurer_sandbox', capability_type: 'insurance', display_name: 'Sandbox Insurer' }, { id: 'admin-1' });
  await reg.setActivationMode(provider.id, 'sandbox', { actor: { id: 'admin-1' } });
  await reg.setKillSwitch(provider.id, false, { actor: { id: 'admin-1' } });
  const profile = await wf.registerInsurerProfile({
    provider_id: provider.id, legal_name: 'Sandbox Insurer Ltd', active: true,
    min_data_projection: { required, optional: ['model', 'year'] },
  }, { id: 'admin-1' });
  return { provider, profile };
}
async function grantConsent(vin, profile, fields = ['vin', 'make']) {
  const c = await wf.recordConsent(vin, { userId: 'owner-1', insurerProfileId: profile.id, scope: { fields } });
  return c.id;
}
function install() { reset(); supabase.from = (t) => builder(t); }
// Phase 6 fails closed on unknown gates: dealer posture and source coverage must be stated
// server-side, never inferred from absence. See eligibilityContract.evaluateGates.
const OK_CTX = { identity_status: 'complete', fraud_block: false, publication_status: 'publishable', dealer_suspended: false, source_coverage_connected: 1, min_source_coverage: 1 };

// ── consent ─────────────────────────────────────────────────────────────────────
test('consent required: no consentRef -> manual_review, provider NOT called', async () => {
  install();
  const { profile } = await onboardInsurer();
  const r = await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: OK_CTX, insurerProfileId: profile.id, requestedBy: 'owner-1' });
  assert.equal(r.request.status, 'manual_review');
  assert.equal(r.decision.outcome, 'manual_review');
  assert.ok(r.request.conditions.includes('consent_missing'));
  assert.equal(db.provider_request_attempts.length, 0, 'provider must not be called without consent');
});

test('consent scope insufficient (missing required field) -> manual_review', async () => {
  install();
  const { profile } = await onboardInsurer({ required: ['vin', 'make'] });
  const consentRef = await grantConsent('CLEANVIN00000001', profile, ['vin']); // missing 'make'
  const r = await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef });
  assert.equal(r.request.status, 'manual_review');
  assert.ok(r.request.conditions.includes('consent_scope_insufficient'));
  assert.equal(db.provider_request_attempts.length, 0);
});

// ── outcomes via simulator ──────────────────────────────────────────────────────
test('eligible: clean VIN + consent -> eligible with confirmed provider_reference', async () => {
  install();
  const { profile } = await onboardInsurer();
  const consentRef = await grantConsent('CLEANVIN00000001', profile);
  const r = await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef });
  assert.equal(r.request.status, 'eligible');
  assert.equal(r.decision.outcome, 'eligible');
  assert.equal(r.decision.mode, 'sandbox');           // honesty label, never live
  assert.ok(r.decision.provider_reference, 'eligible requires confirmed provider evidence');
  assert.ok(r.decision.validity_until);
});

test('conditional: MISMATCH VIN -> conditional with conditions', async () => {
  install();
  const { profile } = await onboardInsurer();
  const consentRef = await grantConsent('MISMATCHVIN000001', profile);
  const r = await wf.requestInsurerEligibility('MISMATCHVIN000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef });
  assert.equal(r.request.status, 'conditionally_eligible');
  assert.equal(r.decision.outcome, 'conditional');
  assert.ok(r.decision.conditions.length > 0);
});

test('manual_review: NORECORD VIN -> manual_review', async () => {
  install();
  const { profile } = await onboardInsurer();
  const consentRef = await grantConsent('NORECORDVIN000001', profile);
  const r = await wf.requestInsurerEligibility('NORECORDVIN000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef });
  assert.equal(r.request.status, 'manual_review');
  assert.equal(r.decision.outcome, 'manual_review');
});

test('declined: high-risk (STOLEN) VIN -> declined / not_eligible', async () => {
  install();
  const { profile } = await onboardInsurer();
  const consentRef = await grantConsent('STOLENVIN00000001', profile);
  const r = await wf.requestInsurerEligibility('STOLENVIN00000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef });
  assert.equal(r.request.status, 'not_eligible');
  assert.equal(r.decision.outcome, 'declined');
});

test('unavailable: UNAVAIL VIN -> unavailable', async () => {
  install();
  const { profile } = await onboardInsurer();
  const consentRef = await grantConsent('UNAVAILVIN0000001', profile);
  const r = await wf.requestInsurerEligibility('UNAVAILVIN0000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef });
  assert.equal(r.request.status, 'unavailable');
  assert.equal(r.decision.outcome, 'unavailable');
});

test('kill-switched insurer -> unavailable (fail-closed, provider not executed)', async () => {
  install();
  const { provider, profile } = await onboardInsurer();
  await reg.setKillSwitch(provider.id, true, { actor: { id: 'admin-1' } });
  const consentRef = await grantConsent('CLEANVIN00000001', profile);
  const r = await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef });
  assert.equal(r.request.status, 'unavailable');
});

// ── gates block BEFORE the provider ─────────────────────────────────────────────
test('fraud gate blocks: fraud_block -> not_eligible, provider NOT called', async () => {
  install();
  const { profile } = await onboardInsurer();
  const consentRef = await grantConsent('CLEANVIN00000001', profile);
  const r = await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: { ...OK_CTX, fraud_block: true }, insurerProfileId: profile.id, consentRef });
  assert.equal(r.request.status, 'not_eligible');
  assert.equal(r.decision.outcome, 'declined');
  assert.equal(r.request.error_category, 'gate_failed');
  assert.equal(db.provider_request_attempts.length, 0);
});

test('identity gate blocks: identity incomplete -> not_eligible, provider NOT called', async () => {
  install();
  const { profile } = await onboardInsurer();
  const consentRef = await grantConsent('CLEANVIN00000001', profile);
  const r = await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: { identity_status: 'incomplete' }, insurerProfileId: profile.id, consentRef });
  assert.equal(r.request.status, 'not_eligible');
  assert.equal(db.provider_request_attempts.length, 0);
});

// ── webhook (async path) ────────────────────────────────────────────────────────
async function makeEligibleRequest() {
  const { profile } = await onboardInsurer();
  const consentRef = await grantConsent('CLEANVIN00000001', profile);
  const r = await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef });
  return r;
}
test('webhook: valid signed insurer decision applies + appends a decision', async () => {
  install();
  const r = await makeEligibleRequest();
  const body = { request_id: r.request.id, outcome: 'conditional', provider_reference: 'POL-2026-001', conditions: ['proof_of_no_claims'], event_type: 'insurer_decision' };
  const payload = JSON.stringify(body); const ts = String(Date.now());
  const sig = wf.signInsurerWebhook(payload, ts);
  const out = await wf.ingestInsurerWebhook({ providerId: wf.INSURER_WEBHOOK_PROVIDER, payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'iwh-1', body });
  assert.equal(out.applied, true);
  assert.equal(out.outcome, 'conditional');
  const decisions = db.insurance_provider_decisions.filter(d => d.eligibility_request_id === r.request.id);
  assert.equal(decisions.length, 2, 'sync + webhook decisions coexist (append-only)');
  assert.equal(decisions.find(d => d.source === 'webhook').outcome, 'conditional');
});

test('webhook: eligible without provider_reference is downgraded to manual_review (honesty)', async () => {
  install();
  const r = await makeEligibleRequest();
  const body = { request_id: r.request.id, outcome: 'eligible', event_type: 'insurer_decision' }; // no provider_reference
  const payload = JSON.stringify(body); const ts = String(Date.now());
  const sig = wf.signInsurerWebhook(payload, ts);
  const out = await wf.ingestInsurerWebhook({ payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'iwh-honesty', body });
  assert.equal(out.applied, true);
  assert.equal(out.outcome, 'manual_review');
});

test('webhook: invalid signature is recorded but NOT applied', async () => {
  install();
  const r = await makeEligibleRequest();
  const body = { request_id: r.request.id, outcome: 'eligible', provider_reference: 'POL-X' };
  const out = await wf.ingestInsurerWebhook({ payloadString: JSON.stringify(body), signature: 'bad', timestamp: String(Date.now()), idempotencyKey: 'iwh-bad', body });
  assert.equal(out.applied, false);
  assert.equal(out.signature_valid, false);
  assert.equal(db.eligibility_webhook_events.length, 1);
});

test('webhook: replay (stale timestamp) is rejected', async () => {
  install();
  const r = await makeEligibleRequest();
  const body = { request_id: r.request.id, outcome: 'eligible', provider_reference: 'POL-Y' };
  const payload = JSON.stringify(body); const old = String(Date.now() - 10 * 60 * 1000);
  const sig = wf.signInsurerWebhook(payload, old);
  const out = await wf.ingestInsurerWebhook({ payloadString: payload, signature: sig, timestamp: old, idempotencyKey: 'iwh-replay', body });
  assert.equal(out.applied, false);
  assert.equal(out.signature_valid, false);
});

test('webhook: duplicate idempotency key is not re-applied', async () => {
  install();
  const r = await makeEligibleRequest();
  const body = { request_id: r.request.id, outcome: 'conditional', provider_reference: 'POL-DUP' };
  const payload = JSON.stringify(body); const ts = String(Date.now());
  const sig = wf.signInsurerWebhook(payload, ts);
  await wf.ingestInsurerWebhook({ payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'dup-1', body });
  const second = await wf.ingestInsurerWebhook({ payloadString: payload, signature: sig, timestamp: ts, idempotencyKey: 'dup-1', body });
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'duplicate');
});

test('webhook: missing secret in production fails closed (no INSURANCE_WEBHOOK_SECRET)', async () => {
  install();
  const r = await makeEligibleRequest();
  const prevNode = process.env.NODE_ENV, prevSecret = process.env.INSURANCE_WEBHOOK_SECRET;
  process.env.NODE_ENV = 'production'; delete process.env.INSURANCE_WEBHOOK_SECRET;
  try {
    const body = { request_id: r.request.id, outcome: 'eligible', provider_reference: 'POL-PROD' };
    // Cannot even produce a valid signature without a secret; any signature must fail closed.
    const out = await wf.ingestInsurerWebhook({ payloadString: JSON.stringify(body), signature: 'anything', timestamp: String(Date.now()), idempotencyKey: 'iwh-prod', body });
    assert.equal(out.applied, false);
    assert.equal(out.signature_valid, false);
  } finally {
    process.env.NODE_ENV = prevNode;
    if (prevSecret === undefined) delete process.env.INSURANCE_WEBHOOK_SECRET; else process.env.INSURANCE_WEBHOOK_SECRET = prevSecret;
  }
});

// ── privacy + append-only ────────────────────────────────────────────────────────
test('public projection strips ALL underwriting / applicant / gate data', async () => {
  install();
  const { profile } = await onboardInsurer();
  const consentRef = await grantConsent('CLEANVIN00000001', profile);
  const r = await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: { ...OK_CTX, applicant_risk_score: 0.87 }, insurerProfileId: profile.id, consentRef });
  const pub = r.public;
  for (const banned of ['decision_inputs', 'gateContext', 'raw', 'applicant', 'applicant_risk_score', 'underwriting', 'provider_payload', 'scope', 'owner_id', 'tenant_id']) {
    assert.equal(Object.prototype.hasOwnProperty.call(pub, banned), false, `public projection must not expose "${banned}"`);
  }
  assert.equal(pub.status, 'eligible');
  assert.ok(pub.provider_reference);
  assert.equal(pub.mode, 'sandbox');
  // The public JSON string must not leak the private applicant score at all.
  assert.equal(JSON.stringify(pub).includes('0.87'), false);
});

test('append-only decision ledger: repeated requests accumulate immutable rows', async () => {
  install();
  const { profile } = await onboardInsurer();
  const c1 = await grantConsent('CLEANVIN00000001', profile);
  await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef: c1 });
  await wf.requestInsurerEligibility('CLEANVIN00000001', { gateContext: OK_CTX, insurerProfileId: profile.id, consentRef: c1 });
  const rows = db.insurance_provider_decisions.filter(d => d.vin === 'CLEANVIN00000001');
  assert.equal(rows.length, 2, 'each request appends a new decision (never mutates)');
  const history = await wf.getInsurerDecisionHistory('CLEANVIN00000001');
  assert.equal(history.length, 2);
});

// ── admin health board ───────────────────────────────────────────────────────────
test('admin: provider-health board reports mode + kill switch + health', async () => {
  install();
  const { profile } = await onboardInsurer();
  const board = await wf.listInsurerProviders();
  assert.equal(board.length, 1);
  assert.equal(board[0].insurer_profile_id, profile.id);
  assert.equal(board[0].activation_mode, 'sandbox');
  assert.equal(board[0].kill_switch_enabled, false);
});

// ── Phase 6: insurance gate posture is server-owned and three-state ──────────────
// Regression: insurerRoutes.gateContextFor read `d.dimensions.dealer?.suspended`, but the canonical
// trust decision emits the dimension as `dealer_compliance` (with a `status`), never `dealer`. The
// expression was therefore always false, so a SUSPENDED dealer silently cleared the insurance gate,
// and an unresolved fraud/coverage posture was likewise coerced to "clear". Phase 6 forbids reading
// absence as clearance. This mirrors issue164-phase6-lender-gate-authority for the insurance route.
test('Phase 6: insurance gate context is derived from canonical dimensions, unknown stays unknown', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../routes/insurerRoutes.js', import.meta.url), 'utf8');
  const start = src.indexOf('async function gateContextFor');
  const end = src.indexOf('// ── owner/dealer', start);
  assert.ok(start >= 0 && end > start, 'gateContextFor block must be locatable');
  const block = src.slice(start, end);

  // Reads the dimension that actually exists, not the phantom `dealer` key.
  assert.match(block, /dimensions\.dealer_compliance/);
  assert.equal(/dimensions\.dealer\?/.test(block), false, 'no such dimension: dealer');
  // Three-state: unresolved posture reaches evaluateGates as null, never an implicit false.
  assert.match(block, /dealerStatus === 'suspended'/);
  assert.match(block, /fraudStatus === 'high' \? true : fraudStatus === 'clear' \? false : null/);
  assert.equal(/connected \?\? 0/.test(block), false, 'unknown coverage must be null, not 0');
  // The browser may never assert gate truth on this route.
  assert.equal(/req\.body\?.*(dealer_suspended|fraud_block|publication_status|identity_status)/.test(block), false);
});
