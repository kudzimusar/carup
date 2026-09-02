import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ZIMBABWE_REGISTRATION_STATUSES,
  normalizeZimbabweRegistrationStatus,
  evaluateZimbabweRegistrationReadiness,
} from '../services/registration/zimbabweRegistrationLifecycle.js';
import { assembleDecision } from '../services/trustDecision/trustDecisionService.js';

test('registration vocabulary is explicit and legacy imported does not invent a stage', () => {
  assert.equal(ZIMBABWE_REGISTRATION_STATUSES.length, 8);
  assert.equal(normalizeZimbabweRegistrationStatus('local'), 'locally_registered');
  assert.equal(normalizeZimbabweRegistrationStatus('imported'), 'unknown');
  assert.equal(normalizeZimbabweRegistrationStatus('Current'), 'unknown');
  assert.equal(normalizeZimbabweRegistrationStatus('not-a-stage'), null);
});

test('permanent-import pending states are listable but visibly pending', () => {
  for (const status of ['import_in_transit','arrived_customs_pending','customs_cleared_cvr_pending','cvr_plate_pending','reregistration_pending']) {
    const r = evaluateZimbabweRegistrationReadiness({ status, statusSource: 'seller_declared' });
    assert.equal(r.publication_blocking, false, status);
    assert.equal(r.status, 'pending', status);
    assert.ok(r.reason_codes.includes(`registration_pending:${status}`));
  }
});

test('TIP and unknown do not masquerade as ordinary permanent-import readiness', () => {
  const tip = evaluateZimbabweRegistrationReadiness({ status: 'temporary_foreign_tip', statusSource: 'seller_declared', tempPlateId: 'TIP-1' });
  assert.equal(tip.publication_blocking, true);
  assert.ok(tip.reason_codes.includes('temporary_import_sale_review_required'));
  const unknown = evaluateZimbabweRegistrationReadiness({ status: 'unknown', statusSource: 'seller_declared' });
  assert.equal(unknown.publication_blocking, true);
  assert.equal(unknown.status, 'not_established');
  assert.equal(evaluateZimbabweRegistrationReadiness({ status: 'Current', statusSource: null }).status, 'not_recorded');
});

test('locally registered requires a Zimbabwe plate; TIP never substitutes for it', () => {
  const missing = evaluateZimbabweRegistrationReadiness({ status: 'locally_registered', statusSource: 'seller_declared', tempPlateId: 'TIP-X' });
  assert.equal(missing.publication_blocking, true);
  assert.ok(missing.reason_codes.includes('local_plate_not_recorded'));
  const present = evaluateZimbabweRegistrationReadiness({ status: 'locally_registered', statusSource: 'seller_declared', plateNumber: 'ABC 1234' });
  assert.equal(present.publication_blocking, false);
  assert.equal(present.status, 'registered');
});

test('Trust identity remains complete while registration is pending and receives no adverse registration score', () => {
  const decision = assembleDecision({
    vin: 'GFC27-027051',
    vehicle: {
      vin: 'GFC27-027051', chassis_number: 'GFC27-027051', engine_number: 'MR20961177B',
      plate_number: null, temp_plate_id: null,
      registration_status: 'customs_cleared_cvr_pending', registration_status_source: 'seller_declared',
    },
    completeness: { is_publishable: true, completeness_percent: 80, blocking_gaps: [], pending_gaps: [], publication_status: 'publishable' },
    coverage: [],
    now: '2026-09-02T00:00:00.000Z',
  });
  assert.equal(decision.dimensions.identity.status, 'complete');
  assert.equal(decision.dimensions.registration_readiness.status, 'pending');
  assert.equal(decision.dimensions.registration_readiness.value, 'customs_cleared_cvr_pending');
  assert.ok(decision.known_limitations.some((line) => line.includes('registration is still in progress')));
  assert.equal(decision.overall_trust.reason_codes.some((code) => code.includes('registration')), false);
});
