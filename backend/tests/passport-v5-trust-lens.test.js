import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PUBLIC_TRUST_FIELDS,
} from '../services/trustDecision/canonicalTrustService.js';
import {
  assertCanonicalTrustProjection,
  buildPassportTrustLens,
} from '../services/passport/passportTrustLens.js';

function trust(overrides = {}) {
  return {
    vin: 'CARUPPASSPORT0001',
    score: 52,
    band: 'moderate',
    evaluation_state: 'evaluated',
    confidence: 'medium',
    evidence_basis: {
      governed_facts_total: 7,
      governed_facts_substantiated: 4,
      governed_facts_adverse: 1,
      connected_sources: 2,
      unbacked_legacy_claims: 0,
    },
    calculation_version: 'trust-decision-test',
    evaluated_at: '2026-08-28T10:00:00Z',
    known_limitations: ['One source is unavailable.'],
    source: 'computed',
    ...overrides,
  };
}

test('V5: canonical evaluated Trust is relayed without rebucketing', () => {
  const lens = buildPassportTrustLens(trust({ score: 99, band: 'moderate' }));
  assert.equal(lens.canonical.score, 99);
  assert.equal(lens.canonical.band, 'moderate');
  assert.equal(lens.label, 'Moderate');
});

test('V5: a genuine evaluated zero remains zero', () => {
  const lens = buildPassportTrustLens(trust({
    score: 0,
    band: 'insufficient_evidence',
    confidence: 'low',
  }));
  assert.equal(lens.canonical.score, 0);
  assert.equal(lens.score_visible, true);
  assert.equal(lens.label, 'Insufficient evidence');
});

test('V5: not-evaluated Trust stays null rather than becoming zero', () => {
  const lens = buildPassportTrustLens(trust({
    score: null,
    band: null,
    evaluation_state: 'not_evaluated',
    confidence: 'not_evaluated',
    evidence_basis: null,
    calculation_version: null,
    evaluated_at: null,
    source: 'none',
  }));

  assert.equal(lens.canonical.score, null);
  assert.equal(lens.canonical.band, null);
  assert.equal(lens.score_visible, false);
  assert.equal(lens.label, 'Not evaluated');
});

test('V5: stale/unavailable Trust cannot carry a publishable score', () => {
  assert.throws(
    () => assertCanonicalTrustProjection(trust({
      evaluation_state: 'stale',
      score: 80,
      band: 'high',
    })),
    /withhold score and band/i,
  );
});

test('V5: confidence is presented as an independent axis', () => {
  const lens = buildPassportTrustLens(trust({
    score: 80,
    band: 'high',
    confidence: 'low',
  }));

  assert.equal(lens.canonical.score, 80);
  assert.equal(lens.evidence_context.confidence, 'low');
  assert.equal(lens.semantic_guards.confidence_is_not_score, true);
});

test('V5: Passport canonical sub-object contains only the canonical public Trust fields', () => {
  const lens = buildPassportTrustLens(trust({ internal_dimension: 'must-not-project' }));
  assert.deepEqual(Object.keys(lens.canonical).sort(), [...PUBLIC_TRUST_FIELDS].sort());
  assert.equal(lens.canonical.internal_dimension, undefined);
});

test('V5: malformed evidence basis fails closed rather than inventing counts', () => {
  assert.throws(
    () => buildPassportTrustLens(trust({
      evidence_basis: { governed_facts_total: 7 },
    })),
    /evidence_basis missing/i,
  );
});

test('V5 anti-fork: Trust Lens owns no scoring engine, threshold or database read', () => {
  const src = readFileSync('backend/services/passport/passportTrustLens.js', 'utf8');
  assert.match(src, /canonicalTrustService\.js/);
  assert.doesNotMatch(src, /trustDecisionService|trustGraphService/);
  assert.doesNotMatch(src, /score\s*[><=]+\s*\d+/);
  assert.doesNotMatch(src, /\.from\s*\(|supabase/i);
  assert.doesNotMatch(src, /trust_score/);
});
