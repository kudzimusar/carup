import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GOLDEN_A, GOLDEN_B } from '../services/golden/goldenVehicleSpecs.js';
import {
  GOLDEN_LIFECYCLE_STEPS,
  GOLDEN_CERTIFICATION_MATRIX,
  certifyGoldenVehicleLifecycle,
} from '../services/passport/passportGoldenLifecycleCertification.js';

function passedSteps(vin = GOLDEN_A.vin) {
  return Object.fromEntries(GOLDEN_LIFECYCLE_STEPS.map(({ id }) => [id, {
    state: 'pass',
    evidence: [`test:${id}`],
    proof: {},
  }]).map(([id, value]) => {
    if (id === 'communications_persisted_delivered') {
      value.proof = { domain_event_id: 'evt-1', canonical_notification_or_thread_id: 'thread-1', delivery_state: 'delivered' };
    }
    if (id === 'ownership_transfer_completed') {
      value.proof = {
        transfer_id: 'transfer-1',
        governed_authority: 'ownership_transfer_service',
        completed_at: '2026-08-28T12:00:00Z',
        new_owner_id: 'golden-a-buyer-stg',
        same_vin: vin,
      };
    }
    if (id === 'lifecycle_notification') {
      value.proof = { domain_event_id: 'evt-2', canonical_notification_or_thread_id: 'notification-2' };
    }
    if (id === 'truthful_next_best_action') {
      value.proof = { rule: 'resolve_discrepancy', evidence_fingerprint: 'fp-1', calculation_version: 'next_best_action@1' };
    }
    if (id === 'previous_owner_privacy') {
      value.proof = { previous_owner_identifier_absent: true, access_policy_checked: 'owner_access@1' };
    }
    return [id, value];
  }));
}

function passedMatrix() {
  return Object.fromEntries(GOLDEN_CERTIFICATION_MATRIX.map((id) => [id, {
    state: 'pass',
    evidence: [`receipt:${id}`],
  }]));
}

test('V16: canonical script contains exactly the documented 32 lifecycle steps', () => {
  assert.equal(GOLDEN_LIFECYCLE_STEPS.length, 32);
  assert.equal(GOLDEN_LIFECYCLE_STEPS[0].id, 'seller_start');
  assert.equal(GOLDEN_LIFECYCLE_STEPS[31].id, 'previous_owner_privacy');
});

test('V16: certification matrix contains every documented gate', () => {
  assert.deepEqual(GOLDEN_CERTIFICATION_MATRIX, [
    'api_contracts',
    'database_constraints_migrations',
    'security_rls',
    'evidence_privacy',
    'trust_invariants',
    'communications',
    'intelligence',
    'marketplace',
    'seller',
    'verify',
    'home',
    'service_partsentry',
    'ownership',
    'desktop',
    'mobile',
    'accessibility',
    'playwright_functional',
    'visual_regression',
    'exact_head_ci',
    'exact_head_staging',
    'independent_review',
    'owner_uat',
    'short_soak',
  ]);
});

test('V16: existing Golden fixtures preserve rich and sparse truth cases', () => {
  assert.equal(GOLDEN_A.publishTarget, 'published');
  assert.ok(GOLDEN_A.evidence.length > GOLDEN_B.evidence.length);
  assert.ok(GOLDEN_A.partSentry);
  assert.equal(GOLDEN_B.publishTarget, 'draft');
  assert.equal(GOLDEN_B.evidence[0].reviewOutcome, 'pending');
  assert.equal(GOLDEN_B.sourceCoverage.length, 0);
});

test('V16: a fully evidenced exact-head lifecycle can PASS', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const result = certifyGoldenVehicleLifecycle({
    vin: GOLDEN_A.vin,
    golden_vehicle_key: 'A',
    steps: passedSteps(),
    matrix: passedMatrix(),
    candidate_head: head,
    staging_head: head,
    unresolved_findings: [],
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.blockers.length, 0);
});

test('V16: missing Communications/Intelligence/owner-UAT/soak evidence blocks PASS', () => {
  const steps = passedSteps();
  steps.communications_persisted_delivered = {
    state: 'blocked',
    reason: 'communications_lane_not_reconciled',
    evidence: [],
  };
  steps.truthful_next_best_action = {
    state: 'blocked',
    reason: 'intelligence_lane_not_reconciled',
    evidence: [],
  };

  const matrix = passedMatrix();
  matrix.owner_uat = { state: 'blocked', reason: 'owner_signoff_missing', evidence: [] };
  matrix.short_soak = { state: 'blocked', reason: 'soak_not_completed', evidence: [] };

  const result = certifyGoldenVehicleLifecycle({
    vin: GOLDEN_A.vin,
    golden_vehicle_key: 'A',
    steps,
    matrix,
    candidate_head: 'head-1',
    staging_head: 'head-1',
  });

  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.some((b) => b.id === 'communications_persisted_delivered'));
  assert.ok(result.blockers.some((b) => b.id === 'truthful_next_best_action'));
  assert.ok(result.blockers.some((b) => b.id === 'owner_uat'));
  assert.ok(result.blockers.some((b) => b.id === 'short_soak'));
});

test('V16: seeded ownership history can never certify transfer completion', () => {
  const steps = passedSteps();
  steps.ownership_transfer_completed.proof.governed_authority = 'fixture_seed';

  assert.throws(
    () => certifyGoldenVehicleLifecycle({
      vin: GOLDEN_A.vin,
      golden_vehicle_key: 'A',
      steps,
      matrix: passedMatrix(),
      candidate_head: 'head',
      staging_head: 'head',
    }),
    /seeded history row/i,
  );
});

test('V16: transfer completion must preserve the same VIN/Passport identity', () => {
  const steps = passedSteps();
  steps.ownership_transfer_completed.proof.same_vin = 'DIFFERENTVIN000000';

  assert.throws(
    () => certifyGoldenVehicleLifecycle({
      vin: GOLDEN_A.vin,
      golden_vehicle_key: 'A',
      steps,
      matrix: passedMatrix(),
      candidate_head: 'head',
      staging_head: 'head',
    }),
    /same VIN\/Passport identity/i,
  );
});

test('V16: Communications PASS requires durable canonical identities', () => {
  const steps = passedSteps();
  delete steps.communications_persisted_delivered.proof.domain_event_id;

  assert.throws(
    () => certifyGoldenVehicleLifecycle({
      vin: GOLDEN_A.vin,
      golden_vehicle_key: 'A',
      steps,
      matrix: passedMatrix(),
      candidate_head: 'head',
      staging_head: 'head',
    }),
    /domain_event_id/i,
  );
});

test('V16: Intelligence PASS requires rule, evidence fingerprint and calculation version', () => {
  const steps = passedSteps();
  delete steps.truthful_next_best_action.proof.evidence_fingerprint;

  assert.throws(
    () => certifyGoldenVehicleLifecycle({
      vin: GOLDEN_A.vin,
      golden_vehicle_key: 'A',
      steps,
      matrix: passedMatrix(),
      candidate_head: 'head',
      staging_head: 'head',
    }),
    /evidence_fingerprint/i,
  );
});

test('V16: previous-owner privacy is a proof, not a claim', () => {
  const steps = passedSteps();
  steps.previous_owner_privacy.proof.previous_owner_identifier_absent = false;

  assert.throws(
    () => certifyGoldenVehicleLifecycle({
      vin: GOLDEN_A.vin,
      golden_vehicle_key: 'A',
      steps,
      matrix: passedMatrix(),
      candidate_head: 'head',
      staging_head: 'head',
    }),
    /previous-owner identifier absence/i,
  );
});

test('V16: P0/P1 or staging-head mismatch independently blocks certification', () => {
  const result = certifyGoldenVehicleLifecycle({
    vin: GOLDEN_A.vin,
    golden_vehicle_key: 'A',
    steps: passedSteps(),
    matrix: passedMatrix(),
    candidate_head: 'candidate',
    staging_head: 'different',
    unresolved_findings: [{ severity: 'P1', id: 'P1-1', summary: 'critical journey defect' }],
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.summary.p0_p1, 1);
  assert.ok(result.blockers.some((b) => b.kind === 'exact_head'));
});

test('V16: a PASS gate without evidence is invalid', () => {
  const matrix = passedMatrix();
  matrix.visual_regression = { state: 'pass', evidence: [] };

  assert.throws(
    () => certifyGoldenVehicleLifecycle({
      vin: GOLDEN_A.vin,
      golden_vehicle_key: 'A',
      steps: passedSteps(),
      matrix,
      candidate_head: 'head',
      staging_head: 'head',
    }),
    /requires evidence/i,
  );
});

test('V16 anti-fork: certification engine owns no fixture writes, Trust, communications, Intelligence or DB', () => {
  const src = readFileSync('backend/services/passport/passportGoldenLifecycleCertification.js', 'utf8');
  assert.doesNotMatch(src, /bootstrap\s*\(|refreshCanonicalTrust|queueNotification|recommendationService/);
  assert.doesNotMatch(src, /\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|supabase/i);
});
