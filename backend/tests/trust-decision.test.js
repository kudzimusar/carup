/**
 * Workstream 10 — Unified Trust Decision Model tests (pure aggregation core).
 * Verifies dimensions stay SEPARATE, the score is transparent (no flattering baseline,
 * sandbox contributes 0), conflicts/fraud subtract, not-evaluated modules are honest,
 * and the public projection strips private dimensions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { assembleDecision, toPublicDecision, CALCULATION_VERSION } =
  await import('../services/trustDecision/trustDecisionService.js');

const completeVehicle = { vin: 'V1', chassis_number: 'C', engine_number: 'E', plate_number: 'P' };

test('insufficient evidence scores 0 (no flattering baseline)', () => {
  const d = assembleDecision({ vin: 'V1', vehicle: {}, completeness: null, coverage: [] });
  assert.equal(d.overall_trust.value, 0);
  assert.equal(d.overall_trust.status, 'insufficient_evidence');
});

test('dimensions are kept separate (not collapsed into one number)', () => {
  const d = assembleDecision({ vin: 'V1', vehicle: completeVehicle, completeness: null, coverage: [] });
  const keys = Object.keys(d.dimensions);
  for (const k of ['identity', 'evidence_completeness', 'source_coverage', 'source_conflicts',
    'fraud_risk', 'dealer_compliance', 'publication_eligibility', 'insurance_eligibility',
    'finance_eligibility', 'escrow_eligibility']) {
    assert.ok(keys.includes(k), `missing dimension ${k}`);
  }
});

test('sandbox source coverage contributes 0 to the trust score', () => {
  const coverage = [{ provider: 'zimra', mode: 'sandbox', coverage_status: 'sandbox_demonstration' }];
  const d = assembleDecision({ vin: 'V1', vehicle: completeVehicle,
    completeness: { completeness_percent: 0, is_publishable: false, publication_status: 'draft', blocking_gaps: [], pending_gaps: [] },
    coverage });
  assert.ok(d.overall_trust.value <= 10, 'sandbox must not inflate the score');
  assert.ok(d.dimensions.source_coverage.reason_codes.some((r) => r.startsWith('sandbox_demonstration')));
  assert.ok(d.known_limitations.some((l) => /SANDBOX/.test(l)));
});

test('connected live sources add to the score; identity_complete adds', () => {
  const coverage = [
    { provider: 'zimra', mode: 'live', coverage_status: 'source_connected' },
    { provider: 'cvr', mode: 'live', coverage_status: 'source_connected' },
  ];
  const d = assembleDecision({ vin: 'V1', vehicle: completeVehicle,
    completeness: { completeness_percent: 100, is_publishable: true, publication_status: 'publishable', blocking_gaps: [], pending_gaps: [] },
    coverage });
  // 100% completeness (+50) + 2 connected (+16) + identity_complete (+10) = 76 -> high
  assert.ok(d.overall_trust.value >= 70);
  assert.equal(d.overall_trust.status, 'high');
  assert.equal(d.dimensions.source_coverage.connected, 2);
});

test('source conflict downgrades identity and subtracts from score', () => {
  const coverage = [{ provider: 'cvr', mode: 'sandbox', coverage_status: 'conflict_under_review' }];
  const d = assembleDecision({ vin: 'V1', vehicle: completeVehicle,
    completeness: { completeness_percent: 100, is_publishable: true, publication_status: 'publishable', blocking_gaps: [], pending_gaps: [] },
    coverage });
  assert.equal(d.dimensions.identity.status, 'conflict');
  assert.equal(d.dimensions.source_conflicts.status, 'conflicts_present');
  assert.ok(d.overall_trust.value < 100);
});

test('high-risk source flags fraud high and subtracts heavily', () => {
  const coverage = [{ provider: 'cid', mode: 'sandbox', coverage_status: 'risk_flagged' }];
  const d = assembleDecision({ vin: 'V1', vehicle: completeVehicle,
    completeness: { completeness_percent: 100, is_publishable: true, publication_status: 'publishable', blocking_gaps: [], pending_gaps: [] },
    coverage });
  assert.equal(d.dimensions.fraud_risk.status, 'high');
  assert.ok(d.dimensions.fraud_risk.reason_codes.some((r) => r.includes('cid')));
});

test('not-evaluated modules are explicit, never reported clear/eligible', () => {
  const d = assembleDecision({ vin: 'V1', vehicle: completeVehicle, completeness: null, coverage: [] });
  for (const k of ['dealer_compliance', 'insurance_eligibility', 'finance_eligibility', 'escrow_eligibility']) {
    assert.equal(d.dimensions[k].status, 'not_evaluated');
  }
});

test('publication eligibility reflects completeness gate', () => {
  const blocked = assembleDecision({ vin: 'V1', vehicle: completeVehicle,
    completeness: { completeness_percent: 20, is_publishable: false, publication_status: 'draft', blocking_gaps: ['ownership_document'], pending_gaps: [] },
    coverage: [] });
  assert.equal(blocked.dimensions.publication_eligibility.status, 'blocked');
  assert.ok(blocked.dimensions.publication_eligibility.reason_codes.some((r) => r.includes('ownership_document')));
});

/**
 * REWRITTEN — Issue #164 Phase 3. The last assertion previously read:
 *
 *   assert.equal(pub.overall_trust.reason_codes, undefined, 'public overall trust hides score reason internals');
 *
 * That encoded the OLD shape: the public decision restated the score and merely hid the reason
 * codes behind it. The public decision now carries NO `overall_trust` at all, because the single
 * public statement of a trust position is the canonical projection
 * (canonicalTrustService.toPublicTrust) and a second, live-recomputed score in the same response
 * body is the defect this phase exists to remove.
 *
 * The guarantee is NOT weakened. "No score is published here" strictly implies "no score internals
 * are published here" — the old assertion's subject cannot leak if the subject does not exist. The
 * final assertion adds what the old test never checked: the full decision still carries
 * `overall_trust` for the privileged path (/trust-decision/full) and for canonicalTrustService,
 * which is the ONE consumer allowed to turn it into a published position.
 */
test('public projection strips private dimensions (finance) and states no trust position of its own', () => {
  const d = assembleDecision({ vin: 'V1', vehicle: completeVehicle, completeness: null, coverage: [] });
  const pub = toPublicDecision(d);
  assert.equal(pub.dimensions.finance_eligibility, undefined, 'finance is private and must be stripped');
  assert.ok(pub.dimensions.identity, 'identity is public');
  assert.equal(pub.overall_trust, undefined, 'the public decision explains a position, it never restates one');
  assert.ok(d.overall_trust, 'the full decision keeps it for the privileged path and the canonical service');
});

test('decision carries a calculation_version for explainability', () => {
  const d = assembleDecision({ vin: 'V1', vehicle: completeVehicle, completeness: null, coverage: [] });
  assert.equal(d.calculation_version, CALCULATION_VERSION);
});
