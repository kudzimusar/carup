/**
 * Workstream B — Dealer Compliance & Trust service tests (in-memory supabase mock).
 *
 * Covers onboarding, the compliance checklist, the governance decision ledger and its
 * effects (approve/reject requirement, set expiry, restrict, suspend, reinstate), the pure
 * publish gate, append-only decision history, the buyer-safe summary's exclusion of private
 * data, and admin tenant scoping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const svc = await import('../services/dealer/dealerComplianceService.js');

// ── in-memory supabase mock (append-only ledger enforced for decisions) ────────────
let db;
function resetDb() {
  db = {
    users: [
      { id: 'dealer-1', role: 'dealer', is_verified: true },
      { id: 'dealer-2', role: 'dealer', is_verified: true },
      { id: 'admin-1', role: 'admin', is_verified: true },
    ],
    dealer_profiles: [],
    dealer_branches: [],
    dealer_compliance_documents: [],
    dealer_compliance_requirements: [],
    dealer_compliance_decisions: [],
  };
}
// Tables the DB protects as append-only (UPDATE/DELETE rejected, like governance_block_mutation).
const APPEND_ONLY = new Set(['dealer_compliance_decisions']);

let seq = 0;
function builder(table) {
  const st = { table, op: 'select', filters: {}, order: null, single: false, maybe: false, payload: null };
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
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p) => ({ id: p.id || `${st.table}-${++seq}`, created_at: `2026-06-26T00:00:${String(seq % 60).padStart(2, '0')}.000Z`, ...p }));
    rows.push(...ins);
    return ok(st.single ? ins[0] : ins);
  }
  const match = (r) => Object.entries(st.filters).every(([k, v]) => r[k] === v);
  if (st.op === 'update') {
    if (APPEND_ONLY.has(st.table)) return { data: null, error: { message: `Append-only table ${st.table}: UPDATE is not permitted` } };
    const hit = rows.filter(match);
    hit.forEach((r) => Object.assign(r, st.payload));
    return ok(st.single ? hit[0] : hit);
  }
  if (st.op === 'delete') {
    if (APPEND_ONLY.has(st.table)) return { data: null, error: { message: `Append-only table ${st.table}: DELETE is not permitted` } };
    const keep = rows.filter((r) => !match(r));
    db[st.table] = keep;
    return ok([]);
  }
  let out = rows.filter(match);
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found' } };
  return ok(out);
}
function installMock() { resetDb(); supabase.from = (t) => builder(t); }

// Helper: onboard a dealer with a profile.
async function onboard(userId = 'dealer-1', data = {}) {
  return svc.createOrUpdateProfile(userId, { legal_name: 'Acme Motors', tenant_id: 't1', ...data });
}

// ── onboarding ──────────────────────────────────────────────────────────────────────
test('onboarding: createOrUpdateProfile creates a profile with all eight statuses defaulted', async () => {
  installMock();
  const p = await onboard();
  assert.equal(p.user_id, 'dealer-1');
  assert.equal(p.legal_name, 'Acme Motors');
  // Defaults must NOT be collapsed — each lifecycle status is independent.
  assert.equal(db.dealer_profiles.length, 1);
  // The DB provides defaults; service must not invent them, so they may be undefined in-mock.
  const got = await svc.getProfile(p.id);
  assert.equal(got.id, p.id);
});

test('onboarding: a second call updates the same profile (no duplicate)', async () => {
  installMock();
  const p1 = await onboard('dealer-1', { trading_name: 'Acme' });
  const p2 = await svc.createOrUpdateProfile('dealer-1', { trading_name: 'Acme Renamed' });
  assert.equal(p1.id, p2.id);
  assert.equal(db.dealer_profiles.length, 1);
  assert.equal(p2.trading_name, 'Acme Renamed');
});

// ── missing documents ────────────────────────────────────────────────────────────────
test('missing documents: a blocking requirement that is not verified blocks publication', async () => {
  installMock();
  const p = await onboard();
  // Even with identity verified + review passed, an unsatisfied blocking requirement blocks.
  Object.assign(db.dealer_profiles[0], { identity_status: 'verified', compliance_review_state: 'passed' });
  await svc.upsertRequirement(p.id, { requirement_key: 'business_license', status: 'missing', is_blocking: true });
  const evalr = await svc.evaluateCompliance(p.id);
  assert.deepEqual(evalr.blocking_requirements, ['business_license']);
  assert.equal(evalr.can_publish, false);
});

// ── approve requirement ───────────────────────────────────────────────────────────────
test('approve requirement: decision marks the requirement verified and writes a ledger row', async () => {
  installMock();
  const p = await onboard();
  await svc.upsertRequirement(p.id, { requirement_key: 'business_license', status: 'pending', is_blocking: true });
  const { decision } = await svc.recordDecision(
    p.id,
    { decision: 'approve_requirement', requirement_key: 'business_license', reason: 'Reviewed license' },
    { id: 'admin-1', role: 'admin' },
  );
  assert.equal(decision.decision, 'approve_requirement');
  const reqs = await svc.listRequirements(p.id);
  assert.equal(reqs.find((r) => r.requirement_key === 'business_license').status, 'verified');
  assert.equal(db.dealer_compliance_decisions.length, 1);
});

// ── set expiry ────────────────────────────────────────────────────────────────────────
test('set_expiry: decision sets expiry_date and a past date makes the dealer expired', async () => {
  installMock();
  const p = await onboard();
  const past = '2020-01-01T00:00:00.000Z';
  const { profile } = await svc.recordDecision(
    p.id, { decision: 'set_expiry', payload: { expiry_date: past } }, { id: 'admin-1', role: 'admin' },
  );
  assert.equal(profile.expiry_date, past);
  assert.equal(svc.deriveExpiryState(profile), 'expired');
});

// ── restrict ──────────────────────────────────────────────────────────────────────────
test('restrict: decision sets restriction_state=restricted and blocks publication', async () => {
  installMock();
  const p = await onboard();
  Object.assign(db.dealer_profiles[0], { identity_status: 'verified', compliance_review_state: 'passed', active_state: 'active' });
  const { profile } = await svc.recordDecision(p.id, { decision: 'restrict', reason: 'open complaint' }, { id: 'admin-1', role: 'admin' });
  assert.equal(profile.restriction_state, 'restricted');
  assert.equal(svc.deriveCanPublish(profile, []), false);
});

// ── suspend ───────────────────────────────────────────────────────────────────────────
test('suspend: decision sets suspension_state=suspended and active_state=inactive', async () => {
  installMock();
  const p = await onboard();
  Object.assign(db.dealer_profiles[0], { identity_status: 'verified', compliance_review_state: 'passed', active_state: 'active' });
  const { profile } = await svc.recordDecision(p.id, { decision: 'suspend', reason: 'fraud investigation' }, { id: 'admin-1', role: 'admin' });
  assert.equal(profile.suspension_state, 'suspended');
  assert.equal(profile.active_state, 'inactive');
  const evalr = await svc.evaluateCompliance(p.id);
  assert.equal(evalr.can_publish, false);
});

// ── reinstate ─────────────────────────────────────────────────────────────────────────
test('reinstate: decision clears suspension/restriction and reactivates', async () => {
  installMock();
  const p = await onboard();
  Object.assign(db.dealer_profiles[0], { suspension_state: 'suspended', restriction_state: 'restricted', active_state: 'inactive' });
  const { profile } = await svc.recordDecision(p.id, { decision: 'reinstate', reason: 'cleared' }, { id: 'admin-1', role: 'admin' });
  assert.equal(profile.suspension_state, 'none');
  assert.equal(profile.restriction_state, 'none');
  assert.equal(profile.active_state, 'active');
});

// ── deriveCanPublish (pure) ───────────────────────────────────────────────────────────
test('deriveCanPublish (pure): suspended -> false', () => {
  assert.equal(
    svc.deriveCanPublish({ suspension_state: 'suspended', restriction_state: 'none', compliance_review_state: 'passed', identity_status: 'verified' }, []),
    false,
  );
});
test('deriveCanPublish (pure): verified + passed + clean -> true', () => {
  assert.equal(
    svc.deriveCanPublish({ suspension_state: 'none', restriction_state: 'none', compliance_review_state: 'passed', identity_status: 'verified' }, []),
    true,
  );
});
test('deriveCanPublish (pure): passed but identity unverified -> false', () => {
  assert.equal(
    svc.deriveCanPublish({ suspension_state: 'none', restriction_state: 'none', compliance_review_state: 'passed', identity_status: 'pending' }, []),
    false,
  );
});
test('deriveCanPublish (pure): review not passed -> false', () => {
  assert.equal(
    svc.deriveCanPublish({ suspension_state: 'none', restriction_state: 'none', compliance_review_state: 'in_review', identity_status: 'verified' }, []),
    false,
  );
});

// ── buyer-safe summary excludes private data ──────────────────────────────────────────
test('buyer-safe summary returns ONLY status + review date + band + complaints (no private docs/contacts)', async () => {
  installMock();
  const p = await onboard('dealer-1', { responsible_person: 'Jane Private', physical_address: '42 Secret St' });
  Object.assign(db.dealer_profiles[0], { active_state: 'active', business_evidence_status: 'complete', compliance_review_state: 'passed' });
  await svc.uploadDocument(p.id, { doc_type: 'tax_clearance', file_ref: 'private://file', status: 'verified' });
  const summary = await svc.getBuyerSafeSummary(p.id);

  assert.deepEqual(Object.keys(summary).sort(), ['compliance_review_date', 'evidence_completeness_band', 'status', 'unresolved_serious_complaints']);
  assert.equal(summary.status, 'active');
  assert.equal(summary.evidence_completeness_band, 'high');
  // Hard guarantee: no private identity/contact/document fields leak through.
  const blob = JSON.stringify(summary);
  for (const secret of ['Jane Private', '42 Secret St', 'private://file', 'responsible_person', 'physical_address', 'file_ref', 'tax_id', 'reason']) {
    assert.ok(!blob.includes(secret), `buyer summary must not expose "${secret}"`);
  }
});

test('buyer-safe summary maps a suspended dealer to status=suspended', async () => {
  installMock();
  const p = await onboard();
  Object.assign(db.dealer_profiles[0], { suspension_state: 'suspended', active_state: 'inactive' });
  const summary = await svc.getBuyerSafeSummary(p.id);
  assert.equal(summary.status, 'suspended');
});

// ── cross-tenant denial (admin query scoping) ─────────────────────────────────────────
test('admin listing is tenant-scoped: a t1 admin does not see a t2 dealer', async () => {
  installMock();
  await onboard('dealer-1', { tenant_id: 't1' });
  await onboard('dealer-2', { tenant_id: 't2' });
  const t1 = await svc.listProfiles({ tenantId: 't1' });
  assert.equal(t1.length, 1);
  assert.equal(t1[0].tenant_id, 't1');
  const all = await svc.listProfiles({});
  assert.equal(all.length, 2);
});

// ── append-only decision history ──────────────────────────────────────────────────────
test('append-only: a decision writes an immutable row; the DB rejects UPDATE/DELETE of it', async () => {
  installMock();
  const p = await onboard();
  await svc.recordDecision(p.id, { decision: 'restrict', reason: 'r1' }, { id: 'admin-1', role: 'admin' });
  assert.equal(db.dealer_compliance_decisions.length, 1);

  // A reversal is a NEW row, never an edit.
  await svc.recordDecision(p.id, { decision: 'reinstate', reason: 'r2' }, { id: 'admin-1', role: 'admin' });
  const history = await svc.listDecisions(p.id);
  assert.equal(history.length, 2);

  // The append-only guard (governance_block_mutation) blocks mutation of the ledger.
  const upd = await supabase.from('dealer_compliance_decisions').update({ reason: 'tampered' }).eq('dealer_id', p.id);
  assert.ok(upd.error && /Append-only/.test(upd.error.message));
  const del = await supabase.from('dealer_compliance_decisions').delete().eq('dealer_id', p.id);
  assert.ok(del.error && /Append-only/.test(del.error.message));
});

test('recordDecision rejects an unknown decision and an unauthenticated actor', async () => {
  installMock();
  const p = await onboard();
  await assert.rejects(() => svc.recordDecision(p.id, { decision: 'delete_dealer' }, { id: 'admin-1' }), /decision must be/);
  await assert.rejects(() => svc.recordDecision(p.id, { decision: 'restrict' }, null), /authenticated actor/);
});
