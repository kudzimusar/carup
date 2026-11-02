/**
 * OC-5R-PROV-01 A1 — the Trust authority boundary.
 *
 * "Connected authoritative source" means AUTHENTICATED authority evidence: an approved live
 * provider transport returned the verdict (coverage_status `source_connected`). Partner-file
 * imports and CarUp manual reviews are legitimate evidence whose provenance is retained, but they
 * must not silently satisfy that contract, and an AUTOMATED government call must never mint them.
 *
 * Before trust-decision-1.1.0 two things combined into one defect:
 *   1. Trust counted `partner_file_reviewed` and `carup_manual_reviewed` as connected — +8 each on
 *      the score, the connected-source count, the confidence ceiling, CarUp Gold (>= 2) and the
 *      insurer/eligibility source floor (>= 1).
 *   2. makeGovernmentInvoke returned the SANDBOX synthetic payload for partner_file/manual
 *      providers, persisted under partner_file/manual_verification provenance. The registry
 *      refuses `sandbox` mode in a deployed runtime, so those two modes were the way synthetic
 *      fixtures reached deployed Trust as "connected sources".
 *
 * This suite pins both halves and proves legitimate reviewed evidence is kept, not deleted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const reg = await import('../services/providerPlatform/providerRegistry.js');
const gov = await import('../services/sourceVerification/governmentActivation.js');
const { recordManualVerification } = await import('../services/sourceVerification/sourceVerificationService.js');
const {
  assembleDecision, CALCULATION_VERSION, CONNECTED_COVERAGE_STATUSES, REVIEWED_COVERAGE_STATUSES,
} = await import('../services/trustDecision/trustDecisionService.js');
const { canonicalFromDecision, toPublicTrust, classifyCache, TRUST_CACHE_STATUS } =
  await import('../services/trustDecision/canonicalTrustService.js');
const { projectCarUpGold } = await import('../services/marketplace/carUpGoldService.js');
const { evaluateGates } = await import('../services/eligibility/eligibilityContract.js');

const NOW = '2026-10-07T00:00:00.000Z';
const VIN = 'JTDBR32E870JJ00001';
const vehicle = { vin: VIN, chassis_number: 'CH-0001', engine_number: 'EN-0001', plate_number: 'ABC1234' };
const fullCompleteness = {
  completeness_percent: 100, is_publishable: true, publication_status: 'publishable', blocking_gaps: [], pending_gaps: [],
};
const decide = (coverage) => assembleDecision({ vin: VIN, vehicle, completeness: fullCompleteness, coverage, now: NOW });
const row = (provider, coverage_status) => ({ provider, coverage_status });
const PROVIDERS = ['zimra', 'cvr', 'zinara', 'vid', 'cid'];

// ── Trust: the classification contract ─────────────────────────────────────────────────────────

test('A1: only source_connected is connected authority; partner-file and manual review are reviewed', () => {
  assert.deepEqual([...CONNECTED_COVERAGE_STATUSES], ['source_connected']);
  assert.deepEqual([...REVIEWED_COVERAGE_STATUSES].sort(), ['carup_manual_reviewed', 'partner_file_reviewed']);
});

for (const reviewed of ['partner_file_reviewed', 'carup_manual_reviewed']) {
  test(`A1: ${reviewed} is retained and disclosed but is not a connected source and adds nothing`, () => {
    const d = decide([row('vid', reviewed)]);
    const cov = d.dimensions.source_coverage;
    assert.equal(cov.connected, 0, 'reviewed evidence must not count as connected');
    assert.equal(cov.reviewed, 1, 'reviewed evidence is counted, not dropped');
    assert.equal(cov.status, 'reviewed_only');
    assert.equal(cov.value, '0/5');
    assert.deepEqual(cov.by_status, { [reviewed]: 1 }, 'its provenance stays visible');
    assert.ok(cov.reason_codes.includes('reviewed_not_connected:1'));
    assert.ok(!cov.reason_codes.some((c) => c.startsWith('connected:')));

    const reasons = d.overall_trust.reason_codes;
    assert.ok(reasons.includes('reviewed_not_connected:+0'));
    assert.ok(!reasons.some((c) => c.startsWith('sources_connected')), 'no connected-source credit');
    // completeness 100% (+50) + identity complete (+10); the reviewed row adds nothing.
    assert.equal(d.overall_trust.value, 60);
    assert.equal(d.overall_trust.value, decide([]).overall_trust.value, 'identical to having no source at all');

    assert.ok(d.known_limitations.some((l) => /partner-file import or a CarUp manual review/.test(l)
      && /not connected authoritative sources/.test(l)), 'the limitation is disclosed in plain words');
    assert.ok(d.known_limitations.includes('No live government/partner source is connected for this vehicle yet.'));
  });
}

test('A1: authenticated live evidence still contributes exactly as before (+8 per source)', () => {
  const d = decide([row('zimra', 'source_connected')]);
  assert.equal(d.dimensions.source_coverage.connected, 1);
  assert.equal(d.dimensions.source_coverage.status, 'partial_coverage');
  assert.equal(d.dimensions.source_coverage.value, '1/5');
  assert.ok(d.overall_trust.reason_codes.includes('sources_connected:+8'));
  assert.equal(d.overall_trust.value, 68);
  assert.ok(!d.known_limitations.includes('No live government/partner source is connected for this vehicle yet.'));
});

test('A1: the pre-1.1.0 Phase 3 fixture — its partner-file row no longer earns the +8 it used to', () => {
  // The coverage the Phase 3 suite used to call "three connected sources" under 1.0.0.
  const legacyFixture = [row('zimra', 'source_connected'), row('cid', 'source_connected'),
    row('vid', 'partner_file_reviewed'), row('cvr', 'sandbox_demonstration')];
  const d = decide(legacyFixture);
  assert.equal(d.dimensions.source_coverage.connected, 2);
  assert.equal(d.dimensions.source_coverage.reviewed, 1);
  assert.equal(d.dimensions.source_coverage.sandbox, 1);
  assert.equal(d.overall_trust.value, 76, '50 + 2 x 8 + 10 — 1.0.0 scored this 84');
  const authenticated = decide([row('zimra', 'source_connected'), row('cid', 'source_connected'),
    row('vid', 'source_connected'), row('cvr', 'sandbox_demonstration')]);
  assert.equal(authenticated.overall_trust.value - d.overall_trust.value, 8, 'the whole difference is the reclassified row');
});

test('A1: no quantity of reviewed evidence moves the score, the connected count or the band', () => {
  const base = decide([]);
  for (const reviewed of REVIEWED_COVERAGE_STATUSES) {
    const all = decide(PROVIDERS.map((p) => row(p, reviewed)));
    assert.equal(all.dimensions.source_coverage.connected, 0);
    assert.equal(all.dimensions.source_coverage.reviewed, 5);
    assert.equal(all.overall_trust.value, base.overall_trust.value);
    assert.equal(all.overall_trust.status, base.overall_trust.status);
  }
});

test('A1: the canonical evidence basis reports authenticated sources only', () => {
  const reviewedOnly = toPublicTrust(canonicalFromDecision(decide(PROVIDERS.map((p) => row(p, 'carup_manual_reviewed')))));
  assert.equal(reviewedOnly.evidence_basis.connected_sources, 0);
  const live = toPublicTrust(canonicalFromDecision(decide([row('zimra', 'source_connected'), row('cid', 'carup_manual_reviewed')])));
  assert.equal(live.evidence_basis.connected_sources, 1);
});

test('A1: CarUp Gold cannot be reached on reviewed evidence — the >= 2 connected floor reads authenticated sources', () => {
  // Every other Gold criterion is held at a qualifying value so the source floor alone decides.
  const goldWith = (coverage) => {
    const basis = toPublicTrust(canonicalFromDecision(decide(coverage))).evidence_basis;
    return projectCarUpGold({
      evaluation_state: 'evaluated', score: 95, confidence: 'high',
      evidence_basis: { ...basis, governed_facts_total: 7, governed_facts_substantiated: 7, governed_facts_adverse: 0, unbacked_legacy_claims: 0 },
    });
  };
  // One live source plus four reviewed rows: 1.0.0 reported five connected sources here.
  const reviewedHeavy = goldWith([row('zimra', 'source_connected'),
    ...['cvr', 'zinara', 'vid', 'cid'].map((p) => row(p, 'partner_file_reviewed'))]);
  assert.equal(reviewedHeavy.state, 'not_qualified');
  assert.deepEqual(reviewedHeavy.reason_codes, ['connected_sources_below_2']);
  const twoLive = goldWith([row('zimra', 'source_connected'), row('cid', 'source_connected')]);
  assert.equal(twoLive.state, 'qualified', 'two authenticated sources still meet the floor');
});

test('A1: the insurer/eligibility source floor is not satisfied by reviewed evidence', () => {
  const d = decide(PROVIDERS.map((p) => row(p, 'partner_file_reviewed')));
  // The same projection insurerRoutes/eligibilityRoutes build from the decision.
  const ctx = {
    identity_status: d.dimensions.identity.status,
    publication_status: 'publishable',
    fraud_block: false,
    dealer_suspended: false,
    source_coverage_connected: d.dimensions.source_coverage.connected ?? null,
    min_source_coverage: 1,
  };
  const out = evaluateGates('insurance', ctx);
  assert.equal(out.allowed, false);
  assert.ok(out.reasons.includes('insufficient_source_coverage'), JSON.stringify(out));
  const live = evaluateGates('insurance', { ...ctx, source_coverage_connected: decide([row('zimra', 'source_connected')]).dimensions.source_coverage.connected });
  assert.equal(live.allowed, true, 'authenticated evidence still satisfies the floor');
});

test('A1: the rules change is versioned — a 1.0.0 stamp is stale and never published as current', () => {
  assert.equal(CALCULATION_VERSION, 'trust-decision-1.1.0');
  const stamped = {
    vin: VIN, trust_score: 84, trust_calculation_version: 'trust-decision-1.0.0', trust_evaluated_at: NOW,
    trust_band: 'high', trust_confidence: 'medium', trust_known_limitations: [], trust_evidence_basis: {},
  };
  assert.equal(classifyCache(stamped), TRUST_CACHE_STATUS.STALE);
  assert.equal(classifyCache({ ...stamped, trust_calculation_version: CALCULATION_VERSION }) === TRUST_CACHE_STATUS.STALE, false);
});

// ── Provenance is retained: classification changed, history did not ────────────────────────────

test('A1: the coverage view still labels partner-file and manual evidence honestly (no history rewritten)', () => {
  const sql = readFileSync(new URL('../../database/migrations/20260626120000_source_verification_network.sql', import.meta.url), 'utf8');
  assert.match(sql, /WHEN result = 'match' AND mode = 'live'\s+THEN 'source_connected'/);
  assert.match(sql, /WHEN result = 'match' AND mode = 'partner_file'\s+THEN 'partner_file_reviewed'/);
  assert.match(sql, /mode = 'manual_verification' THEN 'carup_manual_reviewed'/);
});

// ── the in-memory store used by the government-path tests (mirrors government-activation.test.js) ──
let db;
let seq = 0;
function reset() {
  db = {
    users: [{ id: 'admin-1', role: 'admin', is_verified: true }],
    vehicles: [], provider_registry: [], provider_activation_history: [], provider_request_attempts: [],
    source_verification_results: [], fraud_signals: [], fraud_cases: [], fraud_case_events: [],
  };
}
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p) => ({ id: p.id || `${st.table}-${++seq}`, created_at: p.created_at || `2026-10-07T00:00:${String(seq % 60).padStart(2, '0')}Z`, ...p }));
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
function builder(table) {
  const st = { table, op: 'select', filters: {}, single: false, maybe: false, order: null, limit: null, payload: null };
  const chain = {
    select() { return chain; }, insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; }, in() { return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    limit(n) { st.limit = n; return chain; },
    single() { st.single = true; return chain; }, maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function install() { seq = 0; reset(); supabase.from = (t) => builder(t); }
function seedVehicle(vin) {
  db.vehicles.push({ vin, make: 'Toyota', model: 'Hilux', year: 2018, plate_number: 'ADZ-1', chassis_number: null, engine_number: null, temp_plate_id: null, owner_id: 'owner-1', tenant_id: null });
  return vin;
}
async function registerInMode(sourceKey, mode) {
  const p = await reg.upsertProvider({ provider_key: sourceKey, capability_type: 'government_source', display_name: sourceKey.toUpperCase() }, { id: 'admin-1' });
  await reg.setActivationMode(p.id, mode, { actor: { id: 'admin-1', role: 'admin' } });
  await reg.setKillSwitch(p.id, false, { actor: { id: 'admin-1' } });
  return db.provider_registry.find((x) => x.id === p.id);
}

// ── Government: the automated path never mints reviewed provenance ─────────────────────────────

for (const mode of ['partner_file', 'manual']) {
  test(`A1: makeGovernmentInvoke(${mode}) is not automated — it fails closed instead of returning the sandbox payload`, async () => {
    for (const src of gov.SOURCE_KEYS) {
      const out = await gov.makeGovernmentInvoke(src)({ activation_mode: mode }, { vin: `${src.toUpperCase()}CLEANVIN` });
      assert.equal(out.outcome, 'unavailable', src);
      assert.equal(out.error_category, `mode_${mode}_not_automated`, src);
      assert.equal(out.data.tag, 'NOT_AUTOMATED', src);
      assert.equal('fields' in out.data, false, `${src}: no synthetic registry fields`);
      assert.equal(out.confidence, null);
    }
  });

  for (const scenarioVin of ['CLEANVIN', 'STOLENVIN', 'MISMATCHVIN']) {
    test(`A1: runGovernmentCheck under ${mode} for a ${scenarioVin} persists an honest unavailable — never reviewed provenance, never a verdict`, async () => {
      for (const src of gov.SOURCE_KEYS) {
        install();
        await registerInMode(src, mode);
        const vin = seedVehicle(`${src.toUpperCase()}${scenarioVin}`);
        const { result, review } = await gov.runGovernmentCheck(src, vin, { requestedBy: 'admin-1', actorRole: 'admin' });
        assert.equal(result.result, 'unavailable', src);
        assert.equal(result.mode, 'unavailable', src);
        assert.equal(result.error_class, 'not_contracted', src);
        assert.deepEqual(result.identity_fields, {}, `${src}: no synthetic identity fields`);
        assert.equal(review, null, `${src}: nothing fabricated reaches fraud review`);
        assert.equal(db.source_verification_results.length, 1);
        for (const r of db.source_verification_results) {
          assert.ok(!['partner_file', 'manual_verification'].includes(r.mode), `${src}: persisted ${r.mode}`);
        }
        const attempt = db.provider_request_attempts.at(-1);
        assert.equal(attempt.error_category, `mode_${mode}_not_automated`, src);
      }
    });
  }
}

test('A1: resolvePersistableVerdict — only sandbox and live survive, and a SANDBOX payload is only ever sandbox', () => {
  const v = gov.resolvePersistableVerdict;
  const SANDBOX = { tag: 'SANDBOX', fields: { customs_ref_number: 'ZIMRA-CE-SANDBOX-1' } };
  const refused = [
    { outcome: 'ok', mode: 'partner_file', data: SANDBOX },
    { outcome: 'ok', mode: 'manual', data: SANDBOX },
    { outcome: 'ok', mode: 'partner_file', data: null },
    { outcome: 'ok', mode: 'manual', data: { tag: 'REVIEW' } },
    { outcome: 'mismatch', mode: 'manual', data: SANDBOX },
    { outcome: 'high_risk', mode: 'partner_file', data: SANDBOX },
    { outcome: 'ok', mode: 'live', data: SANDBOX },
    { outcome: 'ok', mode: 'pilot_live', data: SANDBOX },
    { outcome: 'ok', mode: 'unknown_mode', data: null },
  ];
  for (const fw of refused) {
    assert.deepEqual(v(fw), { svrMode: 'unavailable', result: 'unavailable', error_class: 'not_contracted' }, JSON.stringify(fw));
  }
  assert.deepEqual(v({ outcome: 'ok', mode: 'sandbox', data: SANDBOX }), { svrMode: 'sandbox', result: 'match', error_class: null });
  assert.deepEqual(v({ outcome: 'mismatch', mode: 'sandbox', data: SANDBOX }), { svrMode: 'sandbox', result: 'mismatch', error_class: null });
  // The seam a real live transport will use keeps its mode.
  assert.deepEqual(v({ outcome: 'ok', mode: 'live', data: { tag: 'LIVE' } }), { svrMode: 'live', result: 'match', error_class: null });
  assert.deepEqual(v({ outcome: 'unavailable', mode: 'manual', data: { tag: 'NOT_AUTOMATED' } }),
    { svrMode: 'unavailable', result: 'unavailable', error_class: 'not_contracted' });
});

test('A1: legitimate manually submitted evidence is still recorded with its provenance and actor', async () => {
  install();
  const vin = seedVehicle('CVRREVIEWEDVIN');
  const saved = await recordManualVerification(vin, 'cvr', { result: 'match', reason: 'logbook sighted by reviewer' }, { id: 'reviewer-1' });
  assert.equal(saved.mode, 'manual_verification');
  assert.equal(saved.manual_verified_by, 'reviewer-1');
  assert.match(saved.legal_basis, /manual document review/);
  assert.equal(db.source_verification_results.length, 1, 'retained, not deleted or rewritten');
});
