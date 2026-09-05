import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import { COMMUNICATION_EVENT_TYPES } from '../services/communication/communicationEventListeners.js';
import { NOTIFICATION_POLICIES } from '../services/communication/communicationNotificationService.js';
import { CommunicationTemplateService } from '../services/communication/communicationTemplateService.js';
import {
  ruleFor,
  evaluateRule,
  RECOMMENDATION_VERSION,
  ABSTAIN,
} from '../services/intelligence/recommendationService.js';
import { AVAILABILITY } from '../services/intelligence/intelligenceProjectionService.js';
import { GOLDEN_A, GOLDEN_B } from '../services/golden/goldenVehicleSpecs.js';
import {
  GOLDEN_LIFECYCLE_STEPS,
  GOLDEN_CERTIFICATION_MATRIX,
  certifyGoldenVehicleLifecycle,
} from '../services/passport/passportGoldenLifecycleCertification.js';

const OWNERSHIP_EVENTS = [
  'vehicle.ownership.transfer_started',
  'vehicle.ownership.transfer_action_required',
  'vehicle.ownership.transfer_state_changed',
  'vehicle.ownership.transfer_completed',
];

const value = (n) => ({ availability: AVAILABILITY.VALUE, value: n, unit: 'count' });
const unavailable = () => ({ availability: AVAILABILITY.UNAVAILABLE, value: null, reason: 'read_failed' });

function stepsFor(vin) {
  const out = Object.fromEntries(GOLDEN_LIFECYCLE_STEPS.map(({ id }) => [id, {
    state: 'pass',
    evidence: [`runtime-contract:${id}`],
    proof: {},
  }]));
  out.communications_persisted_delivered.proof = {
    domain_event_id: 'evt-inquiry',
    canonical_notification_or_thread_id: 'thread-inquiry',
    delivery_state: 'delivered',
  };
  out.ownership_transfer_completed.proof = {
    transfer_id: 'transfer-runtime',
    governed_authority: 'passport_transition_ownership_transfer_atomic',
    completed_at: '2026-08-28T14:00:00Z',
    new_owner_id: 'new-owner',
    same_vin: vin,
  };
  out.lifecycle_notification.proof = {
    domain_event_id: 'evt-transfer',
    canonical_notification_or_thread_id: 'notification-transfer',
  };
  const rec = evaluateRule(
    ruleFor('unanswered_leads'),
    'seller-runtime',
    { unanswered_leads: value(2), oldest_lead_age_days: value(4) },
  );
  out.truthful_next_best_action.proof = {
    rule: rec.rule,
    evidence_fingerprint: rec.evidence_fingerprint,
    calculation_version: rec.calculation_version,
  };
  out.previous_owner_privacy.proof = {
    previous_owner_identifier_absent: true,
    access_policy_checked: 'passportOwnershipTransferService:getOwnershipTransfer',
  };
  return out;
}

function matrixPass() {
  return Object.fromEntries(GOLDEN_CERTIFICATION_MATRIX.map((id) => [id, {
    state: 'pass',
    evidence: [`runtime-contract:${id}`],
  }]));
}

test('V16 runtime: ownership transfer routes require proven session identity and idempotency', () => {
  const route = readFileSync('backend/routes/passportOwnershipTransferRoutes.js', 'utf8');
  const server = readFileSync('backend/server.js', 'utf8');
  assert.match(route, /authorizeSessionRole\(\[\]\)/);
  assert.match(route, /x-idempotency-key/);
  assert.match(route, /beginOwnershipTransfer/);
  assert.match(route, /transitionOwnershipTransfer/);
  assert.match(route, /getOwnershipTransfer/);
  assert.match(server, /app\.use\(passportOwnershipTransferRouter\)/);
  assert.doesNotMatch(route, /authorizeRole\(/, 'ownership transfer routes must not accept x-user-id fallback');
});

test('V16 runtime: every ownership event is subscribed, governed and renderable', () => {
  const templates = new CommunicationTemplateService().listTemplates();
  assert.ok(templates.includes('ownership_transfer_v1'));
  for (const eventType of OWNERSHIP_EVENTS) {
    assert.ok(COMMUNICATION_EVENT_TYPES.includes(eventType), `${eventType} must be subscribed`);
    const policy = NOTIFICATION_POLICIES[eventType];
    assert.ok(policy, `${eventType} must have policy`);
    assert.equal(policy.templateKey, 'ownership_transfer_v1');
    assert.equal(policy.classification, 'transactional');
    assert.equal(policy.threadType, 'account');
    assert.deepEqual(policy.channels, ['in_app']);
    assert.equal(policy.policyChannelsOnly, true);
  }

  const migration = readFileSync('database/migrations/20260828220000_passport_ownership_transfer_communications.sql', 'utf8');
  assert.match(migration, /ownership_transfer_v1/);
  assert.match(migration, /approval_status/);
  assert.match(migration, /'approved'/);
  assert.match(migration, /'transactional'/);
});

test('V16 runtime: governed Intelligence recommendation fires only from measured evidence', () => {
  const rule = ruleFor('unanswered_leads');
  const fired = evaluateRule(rule, 'seller-runtime', {
    unanswered_leads: value(2),
    oldest_lead_age_days: value(4),
  });
  assert.equal(fired.fired, true);
  assert.equal(fired.rule, 'unanswered_leads');
  assert.equal(fired.calculation_version, RECOMMENDATION_VERSION);
  assert.ok(fired.evidence_fingerprint);
  assert.deepEqual(fired.evidence, { unanswered_leads: 2, oldest_lead_age_days: 4 });

  const abstained = evaluateRule(rule, 'seller-runtime', {
    unanswered_leads: unavailable(),
    oldest_lead_age_days: value(4),
  });
  assert.equal(abstained.fired, false);
  assert.equal(abstained.abstained, ABSTAIN.INPUT_UNAVAILABLE);
  assert.deepEqual(abstained.missing_inputs, ['unanswered_leads']);
});

test('V16 Golden A source-runtime case can satisfy all evidence semantics on one exact head', () => {
  const head = 'integration-candidate';
  const result = certifyGoldenVehicleLifecycle({
    vin: GOLDEN_A.vin,
    golden_vehicle_key: 'A',
    steps: stepsFor(GOLDEN_A.vin),
    matrix: matrixPass(),
    candidate_head: head,
    staging_head: head,
    unresolved_findings: [],
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.exact_head_aligned, true);
  assert.equal(result.summary.lifecycle.pass, 32);
  assert.equal(result.summary.matrix.pass, 23);
});

test('V16 Golden B sparse-truth case remains blocked instead of fabricating publication readiness', () => {
  assert.equal(GOLDEN_B.publishTarget, 'draft');
  assert.equal(GOLDEN_B.sourceCoverage.length, 0);
  const steps = stepsFor(GOLDEN_B.vin);
  steps.vehicle_published = {
    state: 'blocked',
    evidence: ['golden-b:publish-target=draft'],
    reason: 'sparse_truth_not_publishable',
  };
  steps.marketplace_found = {
    state: 'blocked',
    evidence: ['golden-b:not-public'],
    reason: 'publication_not_authorized',
  };
  const result = certifyGoldenVehicleLifecycle({
    vin: GOLDEN_B.vin,
    golden_vehicle_key: 'B',
    steps,
    matrix: matrixPass(),
    candidate_head: 'head-b',
    staging_head: 'head-b',
  });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.some((b) => b.id === 'vehicle_published'));
  assert.ok(result.blockers.some((b) => b.id === 'marketplace_found'));
});

test('V16 adverse case: unresolved P1 or provenance mismatch cannot be papered over by passing steps', () => {
  const result = certifyGoldenVehicleLifecycle({
    vin: GOLDEN_A.vin,
    golden_vehicle_key: 'A-adverse',
    steps: stepsFor(GOLDEN_A.vin),
    matrix: matrixPass(),
    candidate_head: 'candidate-A',
    staging_head: 'different-head',
    unresolved_findings: [{ severity: 'P1', id: 'P1-adverse', summary: 'adverse lifecycle defect' }],
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.summary.p0_p1, 1);
  assert.ok(result.blockers.some((b) => b.kind === 'exact_head'));
  assert.ok(result.blockers.some((b) => b.id === 'P1-adverse'));
});
