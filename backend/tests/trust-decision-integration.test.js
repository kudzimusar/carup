/**
 * Workstream H — unified decision integration: fraud cases, dealer compliance, insurance/
 * finance/escrow eligibility dimensions render from real inputs; publication ANDs fraud +
 * dealer suspension; finance stays private; dimensions carry policy_version metadata.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { assembleDecision, toPublicDecision } = await import('../services/trustDecision/trustDecisionService.js');

const vehicle = { vin: 'V1', chassis_number: 'C', engine_number: 'E', plate_number: 'P' };
const publishableCompleteness = { completeness_percent: 100, is_publishable: true, publication_status: 'publishable', blocking_gaps: [], pending_gaps: [] };

test('fraud case input -> fraud high + publication blocked', () => {
  const d = assembleDecision({
    vin: 'V1', vehicle, completeness: publishableCompleteness, coverage: [],
    fraudInput: { open_cases: 1, highest_severity: 'critical', blocks_publication: true },
  });
  assert.equal(d.dimensions.fraud_risk.status, 'high');
  assert.equal(d.dimensions.fraud_risk.open_cases, 1);
  assert.equal(d.dimensions.publication_eligibility.status, 'blocked');
  assert.ok(d.dimensions.publication_eligibility.reason_codes.includes('fraud_block'));
});

test('dealer suspended -> dealer dimension suspended + publication blocked', () => {
  const d = assembleDecision({
    vin: 'V1', vehicle, completeness: publishableCompleteness, coverage: [],
    dealerCompliance: { suspension_state: 'suspended', identity_status: 'verified', can_publish: false },
  });
  assert.equal(d.dimensions.dealer_compliance.status, 'suspended');
  assert.ok(d.dimensions.publication_eligibility.reason_codes.includes('dealer_suspended'));
});

test('compliant dealer -> compliant, publication not blocked by dealer', () => {
  const d = assembleDecision({
    vin: 'V1', vehicle, completeness: publishableCompleteness, coverage: [],
    dealerCompliance: { suspension_state: 'none', restriction_state: 'none', identity_status: 'verified', compliance_review_state: 'passed', can_publish: true },
  });
  assert.equal(d.dimensions.dealer_compliance.status, 'compliant');
  assert.equal(d.dimensions.publication_eligibility.status, 'publishable');
});

test('insurance eligible renders with conditions + mode', () => {
  const d = assembleDecision({
    vin: 'V1', vehicle, completeness: publishableCompleteness, coverage: [],
    insurance: { status: 'conditionally_eligible', conditions: ['valid_vid_required'], mode: 'sandbox', validity_until: '2026-07-26' },
  });
  assert.equal(d.dimensions.insurance_eligibility.status, 'conditionally_eligible');
  assert.ok(d.dimensions.insurance_eligibility.reason_codes.includes('condition:valid_vid_required'));
  assert.equal(d.dimensions.insurance_eligibility.mode, 'sandbox');
});

test('finance dimension is private and stripped from public projection', () => {
  const d = assembleDecision({
    vin: 'V1', vehicle, completeness: publishableCompleteness, coverage: [],
    finance: { status: 'manual_review', conditions: ['proof_of_income_required'] },
  });
  assert.equal(d.dimensions.finance_eligibility.status, 'manual_review');
  assert.equal(d.dimensions.finance_eligibility.visibility, 'private');
  const pub = toPublicDecision(d);
  assert.equal(pub.dimensions.finance_eligibility, undefined);
});

test('escrow dimension renders from a session status', () => {
  const d = assembleDecision({
    vin: 'V1', vehicle, completeness: publishableCompleteness, coverage: [],
    escrow: { status: 'eligible', created_at: '2026-06-26T00:00:00Z' },
  });
  assert.equal(d.dimensions.escrow_eligibility.status, 'eligible');
});

test('every dimension carries policy_version metadata', () => {
  const d = assembleDecision({ vin: 'V1', vehicle, completeness: publishableCompleteness, coverage: [] });
  for (const [k, dim] of Object.entries(d.dimensions)) {
    assert.ok(dim.policy_version, `${k} missing policy_version`);
  }
});

test('null inputs keep modules honestly not_evaluated (no fabricated clear)', () => {
  const d = assembleDecision({ vin: 'V1', vehicle, completeness: publishableCompleteness, coverage: [] });
  for (const k of ['dealer_compliance', 'insurance_eligibility', 'finance_eligibility', 'escrow_eligibility']) {
    assert.equal(d.dimensions[k].status, 'not_evaluated');
  }
});
