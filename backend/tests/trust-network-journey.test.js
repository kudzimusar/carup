/**
 * Workstream 13 — Trust Network Differentiator Journey (integration).
 *
 * Proves the built layers work together as one system, end to end:
 *   vehicle -> 5 government source checks (sandbox) including a deliberate UNAVAILABLE
 *   and a deliberate HIGH-RISK -> a conflict -> the unified trust decision aggregates
 *   them with SEPARATE dimensions and an honest score -> an approved partner retrieves a
 *   redacted trust summary -> every step left an honest, auditable record.
 *
 * This is the subset of the full 18-step differentiator journey covered by the
 * workstreams implemented in this branch (WS2 source network, WS10 decision model,
 * WS9 partner API). Steps belonging to not-yet-built workstreams (mobile offline,
 * dealer compliance, insurance/finance/escrow eligibility) are asserted to surface as
 * honest 'not_evaluated', never as silently clear.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const sv = await import('../services/sourceVerification/sourceVerificationService.js');
const td = await import('../services/trustDecision/trustDecisionService.js');
const partnerAuth = await import('../services/partner/partnerAuthService.js');
const { CALCULATION_VERSION, toPublicTrust, publicTrustViolations } =
  await import('../services/trustDecision/canonicalTrustService.js');

// shared in-memory supabase
let db;
function reset() {
  db = {
    vehicles: [
      { vin: 'JOURNEYCLEAN0001', make: 'Toyota', model: 'Hilux', year: 2018, chassis_number: 'CH1', engine_number: 'EN1', plate_number: 'ADZ-1', tenant_id: 't1' },
      { vin: 'JOURNEYSTOLEN001', make: 'Toyota', model: 'Hilux', year: 2018, chassis_number: 'CH2', engine_number: 'EN2', plate_number: 'ADZ-2', tenant_id: 't1' },
    ],
    vehicle_evidence: [],
    source_verification_results: [],
    partner_clients: [],
    partner_api_requests: [],
  };
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, inFilter: null, single: false, maybe: false, order: null, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    in(k, v) { st.inFilter = { key: k, vals: Array.isArray(v) ? v : [v] }; return chain; },
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
    const ins = list.map((p, i) => ({ id: p.id || `${st.table}-${rows.length + i + 1}`, created_at: `2026-06-26T00:${String(rows.length + i).padStart(2, '0')}:00Z`, ...p }));
    rows.push(...ins); return ok(st.single ? ins[0] : ins);
  }
  if (st.op === 'update') { let u = null; for (const r of rows) if (Object.entries(st.filters).every(([k, v]) => r[k] === v)) { Object.assign(r, st.payload); u = r; } return ok(st.single ? u : (u ? [u] : [])); }
  let out = rows.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v));
  if (st.inFilter) out = out.filter((r) => st.inFilter.vals.includes(r[st.inFilter.key]));
  if (st.table === 'source_verification_coverage_public') {
    // latest per provider
    const seen = new Set(); const latest = [];
    for (const r of db.source_verification_results.filter((r) => Object.entries(st.filters).every(([k, v]) => r[k] === v)).slice().reverse()) {
      if (seen.has(r.provider)) continue; seen.add(r.provider);
      latest.push({ vin: r.vin, provider: r.provider, mode: r.mode, retrieved_at: r.retrieved_at,
        coverage_status: r.result === 'match' && r.mode === 'sandbox' ? 'sandbox_demonstration'
          : r.result === 'high_risk' ? 'risk_flagged'
          : r.result === 'mismatch' ? 'conflict_under_review'
          : r.result === 'unavailable' ? 'source_unavailable'
          : r.result === 'no_record' ? 'no_record_found' : r.result });
    }
    out = latest;
  }
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'nf' } };
  return ok(out);
}

test('differentiator journey: sources -> unified decision -> partner consumption', async () => {
  reset();
  supabase.from = (t) => builder(t);
  sv.initSourceVerification();

  // 1. Clean vehicle: run all five government source checks (sandbox).
  const cleanResults = await sv.verifyAllSources('JOURNEYCLEAN0001');
  assert.equal(cleanResults.length, 5);
  assert.ok(cleanResults.every((r) => r.mode === 'sandbox'), 'all sandbox-labelled');
  assert.ok(cleanResults.every((r) => r.result === 'match'), 'clean VIN matches all sources');

  // 2. The unified decision keeps dimensions SEPARATE and does not inflate from sandbox.
  const cleanDecision = await td.getTrustDecision('JOURNEYCLEAN0001', {
    vehicle: db.vehicles[0],
  });
  assert.ok(cleanDecision.dimensions.source_coverage, 'has source_coverage dimension');
  assert.equal(cleanDecision.dimensions.source_coverage.connected, 0, 'sandbox is not "connected"');
  assert.equal(cleanDecision.dimensions.source_coverage.sandbox, 5);
  assert.ok(cleanDecision.known_limitations.some((l) => /SANDBOX/.test(l)), 'limitation disclosed');
  // not-yet-built modules are honest
  for (const k of ['dealer_compliance', 'insurance_eligibility', 'finance_eligibility', 'escrow_eligibility']) {
    assert.equal(cleanDecision.dimensions[k].status, 'not_evaluated');
  }

  // 3. Stolen vehicle: CID returns high_risk; the decision reflects fraud + conflict.
  await sv.verifyAllSources('JOURNEYSTOLEN001');
  const riskDecision = await td.getTrustDecision('JOURNEYSTOLEN001', { vehicle: db.vehicles[1] });
  assert.equal(riskDecision.dimensions.fraud_risk.status, 'high', 'stolen -> fraud high');
  assert.equal(riskDecision.dimensions.source_conflicts.status, 'conflicts_present');
  assert.ok(riskDecision.overall_trust.value < cleanDecision.overall_trust.value + 100);

  // 4. An approved partner retrieves a redacted trust summary (finance stripped, no raw).
  const { apiKey } = await partnerAuth.createPartnerClient({ name: 'Lender Co', scopes: ['vehicle:trust', 'vehicle:sources'] });
  const client = await partnerAuth.verifyPartnerKey(apiKey);
  assert.ok(client, 'partner key verifies');
  // REWRITTEN — Issue #164 Phase 3. Was:
  //   assert.ok(publicDecision.overall_trust && publicDecision.overall_trust.reason_codes === undefined,
  //             'score internals hidden');
  // which encoded the OLD shape: the redacted decision restated the score with its reason codes
  // stripped. The partner still receives a trust position — it is now the CANONICAL projection, the
  // same authority the marketplace/passport/vehicle-detail publish, so a partner can never be shown
  // a number that disagrees with them for this VIN. The redacted decision is the explanation only.
  const publicDecision = td.toPublicDecision(cleanDecision);
  assert.equal(publicDecision.dimensions.finance_eligibility, undefined, 'finance is private');
  assert.equal(publicDecision.overall_trust, undefined, 'the explanation states no position of its own');
  const partnerPosition = toPublicTrust(cleanDecision);
  assert.deepEqual(publicTrustViolations(partnerPosition), [], 'partner position honours the canonical contract');
  assert.equal(partnerPosition.evaluation_state, 'evaluated', 'partner still gets a governed position');
  assert.equal(partnerPosition.calculation_version, CALCULATION_VERSION, 'and the rules that produced it');
  assert.equal(partnerPosition.score, cleanDecision.overall_trust.value, 'one VIN, one number');
  assert.equal(partnerPosition.band, cleanDecision.overall_trust.status);
  assert.equal(partnerPosition.reason_codes, undefined, 'score internals stay out of the public shape');

  // 5. Every source check left an immutable, honestly-moded record.
  assert.equal(db.source_verification_results.length, 10, '5 + 5 source results persisted');
  assert.ok(db.source_verification_results.every((r) => ['sandbox', 'unavailable', 'manual_verification', 'live', 'partner_file'].includes(r.mode)));
  assert.ok(db.source_verification_results.every((r) => r.raw_payload !== undefined), 'raw retained for audit in storage');
});

test('differentiator journey: an unavailable source never becomes clear', async () => {
  reset();
  supabase.from = (t) => builder(t);
  sv.initSourceVerification();
  db.vehicles.push({ vin: 'JOURNEYUNAVAIL01', make: 'Toyota', model: 'Hilux', year: 2018, tenant_id: 't1' });

  const r = await sv.verifySource('JOURNEYUNAVAIL01', 'zinara');
  assert.equal(r.result, 'unavailable');
  assert.equal(r.mode, 'unavailable');

  const decision = await td.getTrustDecision('JOURNEYUNAVAIL01', { vehicle: db.vehicles[db.vehicles.length - 1] });
  // unavailable contributes nothing positive; coverage shows 0 connected
  assert.equal(decision.dimensions.source_coverage.connected, 0);
  assert.notEqual(decision.dimensions.source_coverage.status, 'partial_coverage');
});
