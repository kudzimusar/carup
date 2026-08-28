import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PASSPORT_AUDIENCES } from '../services/passport/passportContract.js';
import {
  buildPassportVerificationSection,
  projectPassportDiscrepancy,
  projectPassportSourceVerification,
} from '../services/passport/passportVerificationProjection.js';

test('V4: no_record remains no_record and never becomes a clearance', () => {
  const result = projectPassportSourceVerification({
    provider: 'cid',
    mode: 'live',
    result: 'no_record',
    confidence: 0.2,
    retrieved_at: '2026-08-28T10:00:00Z',
  });

  assert.equal(result.state, 'no_record');
  assert.equal(result.result, 'no_record');
  assert.notEqual(result.state, 'match');
});

test('V4: unavailable remains unavailable', () => {
  const result = projectPassportSourceVerification({
    provider: 'zimra',
    mode: 'unavailable',
    result: 'unavailable',
    confidence: null,
  });

  assert.equal(result.state, 'unavailable');
  assert.equal(result.mode, 'unavailable');
});

test('V4: sandbox match remains visibly sandbox and source confidence is not Trust', () => {
  const result = projectPassportSourceVerification({
    provider: 'vid',
    mode: 'sandbox',
    result: 'match',
    confidence: 0.9,
  });

  assert.equal(result.state, 'match');
  assert.equal(result.mode, 'sandbox');
  assert.equal(result.source_confidence, 0.9);
  assert.equal(result.source_confidence_is_not_trust, true);
});

test('V4: public cannot see unresolved discrepancy', () => {
  const result = projectPassportDiscrepancy({
    id: 'conflict-1',
    vin: 'VIN-1',
    conflict_type: 'genuine_mileage',
    reviewer_state: 'pending_review',
    severity: 'high',
    public_summary: 'Mileage records require review.',
    internal_explanation: 'internal detail',
  }, { audience: PASSPORT_AUDIENCES.PUBLIC });

  assert.equal(result, null);
});

test('V4: owner sees unresolved discrepancy as action-required without internal explanation', () => {
  const result = projectPassportDiscrepancy({
    id: 'conflict-1',
    conflict_type: 'genuine_mileage',
    reviewer_state: 'pending_review',
    severity: 'high',
    public_summary: 'Mileage records require review.',
    internal_explanation: 'internal detail',
    evidence_ids: ['evidence-1'],
  }, { audience: PASSPORT_AUDIENCES.OWNER });

  assert.equal(result.state, 'pending_review');
  assert.equal(result.action_required, true);
  assert.deepEqual(result.evidence_ids, ['evidence-1']);
  assert.equal(result.internal_explanation, undefined);
});

test('V4: confirmed discrepancy can project publicly with only public summary', () => {
  const result = projectPassportDiscrepancy({
    id: 'conflict-2',
    conflict_type: 'no_accident_history',
    reviewer_state: 'confirmed',
    severity: 'high',
    public_summary: 'Historical evidence conflicts with the seller statement.',
    internal_explanation: 'reviewer-only reasoning',
    evidence_ids: ['evidence-private'],
  }, { audience: PASSPORT_AUDIENCES.PUBLIC });

  assert.equal(result.public_state, 'confirmed_public');
  assert.equal(result.summary, 'Historical evidence conflicts with the seller statement.');
  assert.equal(result.evidence_ids, undefined);
  assert.equal(result.internal_explanation, undefined);
});

test('V4: disputed discrepancy is not confirmed-public', () => {
  const publicResult = projectPassportDiscrepancy({
    id: 'conflict-3',
    reviewer_state: 'disputed',
    public_summary: 'Should not publish while disputed.',
  }, { audience: PASSPORT_AUDIENCES.PUBLIC });
  assert.equal(publicResult, null);

  const ownerResult = projectPassportDiscrepancy({
    id: 'conflict-3',
    reviewer_state: 'disputed',
    public_summary: 'Under dispute.',
  }, { audience: PASSPORT_AUDIENCES.OWNER });
  assert.equal(ownerResult.disputed, true);
  assert.equal(ownerResult.action_required, true);
});

test('V4: verification section preserves an explicit unavailable collection state', () => {
  const section = buildPassportVerificationSection({
    sourceResults: [],
    discrepancies: [],
    collectionState: 'unavailable',
  });
  assert.equal(section.state, 'unavailable');
});

test('V4 anti-fork: Passport consumes source-verification and governance contracts without writes', () => {
  const src = readFileSync('backend/services/passport/passportVerificationProjection.js', 'utf8');
  assert.match(src, /verificationContract\.js/);
  assert.match(src, /governanceService\.js/);
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|supabase/i);
  assert.doesNotMatch(src, /calculateVehicleTrustScore|computeVehicleTrustScore|trust_score/i);
});
