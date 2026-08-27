import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCarUpGold, CARUP_GOLD_POLICY_VERSION } from '../services/marketplace/carUpGoldService.js';

function trust(overrides = {}) {
  return {
    score: 94,
    band: 'high',
    evaluation_state: 'evaluated',
    confidence: 'high',
    evidence_basis: {
      governed_facts_total: 7,
      governed_facts_substantiated: 7,
      governed_facts_adverse: 0,
      connected_sources: 3,
      unbacked_legacy_claims: 0,
    },
    ...overrides,
  };
}

test('CarUp Gold qualifies only an evaluated, high-confidence, evidence-backed vehicle', () => {
  const result = projectCarUpGold(trust());
  assert.equal(result.state, 'qualified');
  assert.equal(result.tier, 'gold');
  assert.equal(result.label, 'CarUp Gold');
  assert.equal(result.policy_version, CARUP_GOLD_POLICY_VERSION);
});

test('a 90+ score alone is never enough for CarUp Gold', () => {
  for (const candidate of [
    trust({ confidence: 'low' }),
    trust({ evidence_basis: { ...trust().evidence_basis, connected_sources: 1 } }),
    trust({ evidence_basis: { ...trust().evidence_basis, governed_facts_adverse: 1 } }),
    trust({ evidence_basis: { ...trust().evidence_basis, unbacked_legacy_claims: 1 } }),
    trust({ evidence_basis: { ...trust().evidence_basis, governed_facts_substantiated: 4 } }),
  ]) {
    const result = projectCarUpGold(candidate);
    assert.equal(result.state, 'not_qualified');
    assert.equal(result.tier, null);
    assert.equal(result.label, null);
  }
});

test('Gold fails closed when canonical Trust is absent or not evaluated', () => {
  assert.equal(projectCarUpGold(null).state, 'not_evaluable');
  assert.equal(projectCarUpGold(trust({ evaluation_state: 'not_evaluated', score: null })).state, 'not_evaluable');
  assert.equal(projectCarUpGold(trust({ evaluation_state: 'stale' })).state, 'not_evaluable');
});

test('Gold refuses an evaluated record whose evidence basis is unavailable', () => {
  const result = projectCarUpGold(trust({ evidence_basis: null }));
  assert.equal(result.state, 'not_evaluable');
  assert.deepEqual(result.reason_codes, ['evidence_basis_unavailable']);
});

test('Gold qualification requires score at least 90', () => {
  const below = projectCarUpGold(trust({ score: 89 }));
  const boundary = projectCarUpGold(trust({ score: 90 }));
  assert.equal(below.state, 'not_qualified');
  assert.ok(below.reason_codes.includes('trust_score_below_90'));
  assert.equal(boundary.state, 'qualified');
});
