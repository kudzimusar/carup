/**
 * Full Activation — regulated REAL-MONEY escrow PROVIDER extension tests (canonical doc §115–130).
 *
 * In-memory Supabase mock (same convention as provider-platform.test.js). Covers: transaction-cap
 * enforcement, pilot allowlist, KYC/KYB gate, trust-gate fail-closed, provider lifecycle FSM (valid
 * + invalid), dual-control TWO-DISTINCT-approver enforcement, signed webhook (valid/invalid/replay/
 * duplicate), reconciliation match + mismatch queuing, kill switch (blocks new creation, history
 * intact) and the sandbox/live honesty guarantee (sandbox funds are NEVER labelled real money).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
delete process.env.ESCROW_GLOBAL_KILL_SWITCH;
delete process.env.CAPABILITY_KILL_SWITCH;

const { supabase } = await import('../db/supabase.js');
const reg = await import('../services/providerPlatform/providerRegistry.js');
const svc = await import('../services/escrow/escrowProviderService.js');

// ── in-memory supabase mock ──────────────────────────────────────────────────
let db;
function reset() {
  db = {
    users: [{ id: 'admin-1', role: 'admin' }, { id: 'buyer-1', role: 'buyer' }, { id: 'seller-1', role: 'seller' },
      { id: 'appr-1', role: 'admin' }, { id: 'appr-2', role: 'admin' }],
    vehicles: [{ vin: 'CLEANVIN' }],
    provider_registry: [], provider_activation_history: [], provider_request_attempts: [],
    escrow_provider_config: [], escrow_kyc_kyb_states: [], escrow_trust_sessions: [], escrow_trust_events: [],
    escrow_trust_webhook_events: [], escrow_reconciliation_ledger: [], escrow_dual_control_approvals: [],
    reconciliation_jobs: [], reconciliation_mismatches: [],
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
// Tables with a UNIQUE idempotency_key (dedupe on insert).
const IDEM_TABLES = new Set(['provider_request_attempts', 'escrow_trust_webhook_events']);
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    for (const p of list) if (IDEM_TABLES.has(st.table) && p.idempotency_key && rows.some(r => r.idempotency_key === p.idempotency_key)) return { data: null, error: { message: 'dup idempotency' } };
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

// ── fixtures ──────────────────────────────────────────────────────────────────
async function callableEscrowProvider(mode = 'sandbox') {
  const p = await reg.upsertProvider({ provider_key: 'escrow_acme', capability_type: 'escrow', display_name: 'Acme Escrow' }, { id: 'admin-1' });
  // set mode directly (live requires signed contract; sandbox does not)
  const row = db.provider_registry.find(x => x.id === p.id);
  row.activation_mode = mode;
  row.kill_switch_enabled = false;
  return row;
}
function addConfig(providerId, over = {}) {
  const cfg = {
    id: 'cfg-1', provider_id: providerId, jurisdiction: 'ZW', currency: 'USD',
    min_amount_cents: 1000, max_amount_cents: 100000000,
    fee_schedule: {}, settlement_terms: {}, kyc_kyb_required: true,
    pilot_allowlist: [], sandbox_live_separation: true, kill_switch_enabled: false, active: true, ...over,
  };
  db.escrow_provider_config.push(cfg);
  return cfg;
}
function addSession(over = {}) {
  const s = { id: 'sess-1', vin: 'CLEANVIN', tenant_id: null, buyer_id: 'buyer-1', seller_id: 'seller-1', status: 'eligible', ...over };
  db.escrow_trust_sessions.push(s);
  return s;
}
function approveKyc(providerId, subjects = [['buyer', 'buyer-1'], ['seller', 'seller-1']]) {
  for (const [type, id] of subjects) db.escrow_kyc_kyb_states.push({ id: `kyc-${type}-${id}`, subject_type: type, subject_id: id, provider_id: providerId, status: 'approved' });
}
// Phase 6 (Issue #164) hardened evaluateEscrowGates to FAIL CLOSED on unmeasured evidence: an
// absent seller-suspension / participant-authorization / document / listing-snapshot fact is
// `*_unknown`, not a pass. A clean fixture must therefore state every gate as a MEASURED clear
// result. The previous three-field fixture silently relied on "unknown == clear" and would now
// (correctly) block every escrow with trust_gate:seller_status_unknown,...
const CLEAN_GATE = {
  identity_status: 'complete',
  publication_status: 'published',
  fraud_block: false,
  seller_suspended: false,
  participant_authorized: true,
  required_documents_present: true,
  listing_snapshot_changed: false,
};

async function setupInitiated(over = {}) {
  install();
  const p = await callableEscrowProvider();
  const cfg = addConfig(p.id, over.config);
  const s = addSession(over.session);
  approveKyc(p.id);
  const r = await svc.initiateProviderEscrow(s.id, {
    providerKey: 'escrow_acme', amountCents: over.amount ?? 500000, currency: 'USD',
    gateContext: CLEAN_GATE, actor: { id: 'buyer-1', role: 'buyer' },
  });
  return { p, cfg, s, r };
}

// ── 1. happy path (baseline) ───────────────────────────────────────────────────
test('initiate: valid escrow reaches funding, sandbox-labelled', async () => {
  const { r } = await setupInitiated();
  assert.equal(r.ok, true);
  assert.equal(r.state, 'funding');
  assert.equal(r.fund_label, 'sandbox');
  assert.equal(r.is_real_money, false);
});

// ── 2. transaction cap exceeded blocked ────────────────────────────────────────
test('initiate: amount over the cap is blocked (cap_exceeded)', async () => {
  install();
  const p = await callableEscrowProvider();
  addConfig(p.id, { max_amount_cents: 100000 });
  const s = addSession();
  approveKyc(p.id);
  const r = await svc.initiateProviderEscrow(s.id, { providerKey: 'escrow_acme', amountCents: 500000, currency: 'USD', gateContext: CLEAN_GATE });
  assert.equal(r.ok, false);
  assert.equal(r.blocked_reason, 'cap_exceeded');
  assert.equal((await svc.getProviderState(s.id)).state, null); // never initiated
});

// ── 3. not on pilot allowlist blocked ──────────────────────────────────────────
test('initiate: participant not on the pilot allowlist is blocked', async () => {
  install();
  const p = await callableEscrowProvider();
  addConfig(p.id, { pilot_allowlist: ['someone-else'] });
  const s = addSession();
  approveKyc(p.id);
  const r = await svc.initiateProviderEscrow(s.id, { providerKey: 'escrow_acme', amountCents: 500000, currency: 'USD', gateContext: CLEAN_GATE });
  assert.equal(r.ok, false);
  assert.equal(r.blocked_reason, 'not_on_pilot_allowlist');
});

// ── 4. KYC/KYB pending blocks funding ──────────────────────────────────────────
test('initiate: KYC/KYB not approved blocks funding', async () => {
  install();
  const p = await callableEscrowProvider();
  addConfig(p.id); // kyc_kyb_required = true
  const s = addSession();
  db.escrow_kyc_kyb_states.push({ id: 'kyc-b', subject_type: 'buyer', subject_id: 'buyer-1', provider_id: p.id, status: 'pending' });
  approveKyc(p.id, [['seller', 'seller-1']]);
  const r = await svc.initiateProviderEscrow(s.id, { providerKey: 'escrow_acme', amountCents: 500000, currency: 'USD', gateContext: CLEAN_GATE });
  assert.equal(r.ok, false);
  assert.equal(r.blocked_reason, 'kyc_kyb_not_approved');
});

// ── 5. trust gate fail-closed ──────────────────────────────────────────────────
test('initiate: failing trust gate is fail-closed (identity unresolved)', async () => {
  install();
  const p = await callableEscrowProvider();
  addConfig(p.id);
  const s = addSession();
  approveKyc(p.id);
  const r = await svc.initiateProviderEscrow(s.id, {
    providerKey: 'escrow_acme', amountCents: 500000, currency: 'USD',
    gateContext: { ...CLEAN_GATE, identity_status: 'incomplete' },
  });
  assert.equal(r.ok, false);
  assert.match(r.blocked_reason, /^trust_gate:/);
  assert.match(r.blocked_reason, /identity_unresolved/);
  // Every other gate is measured clear, so identity is provably the sole blocking reason.
  assert.equal(r.blocked_reason, 'trust_gate:identity_unresolved');
});

// ── 6. valid + invalid lifecycle transitions ───────────────────────────────────
test('lifecycle: valid transitions advance; invalid transition rejected', async () => {
  const { s } = await setupInitiated();
  await svc.transitionProviderEscrow(s.id, 'inspection', { actor: { id: 'admin-1' } });
  assert.equal((await svc.getProviderState(s.id)).state, 'inspection');
  await svc.transitionProviderEscrow(s.id, 'release', { actor: { id: 'admin-1' } });
  await svc.transitionProviderEscrow(s.id, 'payout', { actor: { id: 'admin-1' } });
  await svc.transitionProviderEscrow(s.id, 'reconciliation', { actor: { id: 'admin-1' } });
  assert.equal((await svc.getProviderState(s.id)).state, 'reconciliation');
});
test('lifecycle: illegal jump (funding -> payout) is rejected', async () => {
  const { s } = await setupInitiated();
  await assert.rejects(() => svc.transitionProviderEscrow(s.id, 'payout', { actor: { id: 'admin-1' } }), /invalid provider escrow transition/);
});
test('lifecycle: transition before initiation is rejected', async () => {
  install();
  addSession();
  await assert.rejects(() => svc.transitionProviderEscrow('sess-1', 'inspection', {}), /not initiated/);
});

// ── 7. dual-control requires two DISTINCT approvers ─────────────────────────────
test('dual-control: same approver twice is rejected', async () => {
  const { s } = await setupInitiated();
  await svc.transitionProviderEscrow(s.id, 'inspection', { actor: { id: 'admin-1' } });
  await assert.rejects(() => svc.requireDualControl(s.id, 'release', { id: 'appr-1' }, { id: 'appr-1' }), /DISTINCT/);
});
test('dual-control: two distinct approvers records approval + performs release', async () => {
  const { s } = await setupInitiated();
  await svc.transitionProviderEscrow(s.id, 'inspection', { actor: { id: 'admin-1' } });
  const out = await svc.requireDualControl(s.id, 'release', { id: 'appr-1' }, { id: 'appr-2' }, { reason: 'inspection passed' });
  assert.equal(out.approval.approver_1_id, 'appr-1');
  assert.equal(out.approval.approver_2_id, 'appr-2');
  assert.equal(out.transition.state, 'release');
  assert.equal(db.escrow_dual_control_approvals.length, 1);
});

// ── 8. signed webhook: valid / invalid-sig / replay / duplicate ─────────────────
test('webhook: valid signature applies the transition', async () => {
  const { s } = await setupInitiated();
  const body = { session_id: s.id, to_status: 'inspection' };
  const payloadString = JSON.stringify(body);
  const ts = String(Date.now());
  const sig = svc.signEscrowWebhook(payloadString, ts);
  const r = await svc.ingestEscrowProviderWebhook({ payloadString, signature: sig, timestamp: ts, idempotencyKey: 'wh-1', body });
  assert.equal(r.applied, true);
  assert.equal(r.state, 'inspection');
});
test('webhook: invalid signature is rejected (fail-closed)', async () => {
  const { s } = await setupInitiated();
  const body = { session_id: s.id, to_status: 'inspection' };
  const payloadString = JSON.stringify(body);
  const ts = String(Date.now());
  const r = await svc.ingestEscrowProviderWebhook({ payloadString, signature: 'ab'.repeat(32), timestamp: ts, idempotencyKey: 'wh-bad', body });
  assert.equal(r.applied, false);
  assert.equal(r.signature_valid, false);
});
test('webhook: stale timestamp is a replay and rejected', async () => {
  const { s } = await setupInitiated();
  const body = { session_id: s.id, to_status: 'inspection' };
  const payloadString = JSON.stringify(body);
  const ts = String(Date.now() - 10 * 60 * 1000);
  const sig = svc.signEscrowWebhook(payloadString, ts);
  const r = await svc.ingestEscrowProviderWebhook({ payloadString, signature: sig, timestamp: ts, idempotencyKey: 'wh-replay', body });
  assert.equal(r.applied, false);
  assert.equal(db.escrow_trust_webhook_events.some(w => w.replay_detected), true);
});
test('webhook: duplicate idempotency key is not re-applied', async () => {
  const { s } = await setupInitiated();
  const body = { session_id: s.id, to_status: 'inspection' };
  const payloadString = JSON.stringify(body);
  const ts = String(Date.now());
  const sig = svc.signEscrowWebhook(payloadString, ts);
  const first = await svc.ingestEscrowProviderWebhook({ payloadString, signature: sig, timestamp: ts, idempotencyKey: 'wh-dup', body });
  const second = await svc.ingestEscrowProviderWebhook({ payloadString, signature: sig, timestamp: ts, idempotencyKey: 'wh-dup', body });
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'duplicate');
});
test('webhook: fail-closed when the secret is missing in production', async () => {
  install();
  const prevNode = process.env.NODE_ENV, prevSecret = process.env.ESCROW_PROVIDER_WEBHOOK_SECRET;
  process.env.NODE_ENV = 'production'; delete process.env.ESCROW_PROVIDER_WEBHOOK_SECRET;
  try {
    const r = await svc.ingestEscrowProviderWebhook({ payloadString: '{}', signature: 'ab'.repeat(32), timestamp: String(Date.now()), idempotencyKey: 'wh-nosecret', body: { session_id: 'x', to_status: 'inspection' } });
    assert.equal(r.applied, false);
    assert.equal(r.reason, 'missing_secret');
  } finally { process.env.NODE_ENV = prevNode; if (prevSecret) process.env.ESCROW_PROVIDER_WEBHOOK_SECRET = prevSecret; }
});

// ── 9. reconciliation: match + mismatch queued ─────────────────────────────────
test('reconciliation: matches book matched=true; mismatches are queued', async () => {
  install();
  const p = await callableEscrowProvider();
  const out = await svc.runEscrowReconciliation(p.id, {
    external: [
      { external_txn_ref: 'X1', amount_cents: 5000, session_id: 'sess-1' },
      { external_txn_ref: 'X2', amount_cents: 5000, session_id: 'sess-1' },
    ],
    internal: [
      { external_txn_ref: 'X1', amount_cents: 5000, session_id: 'sess-1' },
      { external_txn_ref: 'X2', amount_cents: 6000, session_id: 'sess-1' }, // amount mismatch
      { external_txn_ref: 'X3', amount_cents: 7000, session_id: 'sess-1' }, // no external
    ],
  });
  assert.equal(out.matched, 1);
  assert.equal(out.mismatch_count, 2); // amount_mismatch + missing_external
  assert.equal(out.job.status, 'partial');
  assert.equal(db.escrow_reconciliation_ledger.some(l => l.matched === true), true);
  assert.equal(db.reconciliation_mismatches.length, 2);
  assert.equal(db.reconciliation_mismatches.every(m => m.resolution === 'open'), true);
});
test('reconciliation: all-matched window succeeds with no mismatches', async () => {
  install();
  const p = await callableEscrowProvider();
  const out = await svc.runEscrowReconciliation(p.id, {
    external: [{ external_txn_ref: 'Y1', amount_cents: 9000, session_id: 'sess-1' }],
    internal: [{ external_txn_ref: 'Y1', amount_cents: 9000, session_id: 'sess-1' }],
  });
  assert.equal(out.matched, 1);
  assert.equal(out.mismatch_count, 0);
  assert.equal(out.job.status, 'succeeded');
});

// ── 10. kill switch: stops new creation, history intact ─────────────────────────
test('kill switch: blocks NEW escrow but leaves existing history intact', async () => {
  const { p, cfg, s } = await setupInitiated();
  const eventsBefore = db.escrow_trust_events.filter(e => e.session_id === s.id).length;
  const initiationBefore = (await svc.getProviderState(s.id)).initiation;
  assert.ok(initiationBefore); // funding recorded

  await svc.setEscrowKillSwitch(cfg.id, true, { actor: { id: 'admin-1', role: 'admin' } });

  const s2 = addSession({ id: 'sess-2' });
  approveKyc(p.id);
  const r = await svc.initiateProviderEscrow(s2.id, { providerKey: 'escrow_acme', amountCents: 500000, currency: 'USD', gateContext: CLEAN_GATE });
  assert.equal(r.ok, false);
  assert.equal(r.blocked_reason, 'provider_kill_switch');

  // History for the original session is untouched.
  const eventsAfter = db.escrow_trust_events.filter(e => e.session_id === s.id).length;
  assert.equal(eventsAfter, eventsBefore);
  assert.deepEqual((await svc.getProviderState(s.id)).initiation, initiationBefore);
});

// ── 11. sandbox funds are never labelled real money ─────────────────────────────
test('sandbox/live: sandbox funds are never labelled real money', async () => {
  assert.equal(svc.fundLabel({ activation_mode: 'sandbox' }).is_real_money, false);
  assert.equal(svc.fundLabel({ activation_mode: 'pilot_live' }).is_real_money, false);
  assert.equal(svc.fundLabel({ activation_mode: 'live' }).is_real_money, true);
  const { r } = await setupInitiated();
  assert.equal(r.record.sandbox, true);
  assert.equal(r.record.is_real_money, false);
  assert.notEqual(r.record.fund_label, 'live');
});
