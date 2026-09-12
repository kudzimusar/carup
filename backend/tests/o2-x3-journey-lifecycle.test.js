/**
 * O2-X3 — Progressive Trust now respects the CURRENT identity lifecycle.
 *
 * Held here:
 *   · historically approved + lifecycle verified → identity-approved capability available;
 *   · historically approved + reverification_required → safe low-risk capability remains,
 *     identity-gated capability locks with the lifecycle's applicant-safe reason;
 *   · compromised/suspended/revoked → identity-gated capability fails closed, the review
 *     team owns the next step, and safe stage-1 capability still stands;
 *   · the journey exposes ONLY applicant-safe lifecycle fields (state, guidance, actor) —
 *     no trigger sources, actor ids or internal notes travel to the subject;
 *   · lifecycle changes nothing about the domain-authority locks: seller/dealer/vehicle
 *     rows stay locked by their own authorities in every state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { deriveOnboardingJourney } = await import('../services/registration/registrationJourneyService.js');

const APPROVED_SESSION = Object.freeze({
  id: 'vs-1', status: 'verified', workflow_phase: 'resolved_approved',
  submitted_at: 'T1', updated_at: 'T2',
  uploaded_sides: { front: true, back: true, selfie: true },
});

function lifecycleFixture(effectiveState, overrides = {}) {
  return {
    effective_state: effectiveState,
    state: effectiveState,
    reason_code: overrides.reason_code || null,
    applicant_guidance: overrides.applicant_guidance || null,
    who_must_act: overrides.who_must_act || 'none',
    capability_bearing: ['verified', 'recovered'].includes(effectiveState),
    // Internal fields a real lifecycle read carries — the journey must NOT forward these.
    ledger_event_id: 'evt-internal-1',
    latest_approved_session_id: 'vs-1',
    historically_approved: true,
    policy_version: 'identity_lifecycle.v1',
  };
}

function lockedBy(journey) {
  return Object.fromEntries(journey.locked_capabilities.map((l) => [l.capability, l.locked_by]));
}

test('X3: verified lifecycle keeps the X2 behaviour — identity-approved capability available, domain locks unchanged', () => {
  const journey = deriveOnboardingJourney({
    user: {}, profile: { account_kind: 'individual' },
    latestSession: APPROVED_SESSION,
    lifecycle: lifecycleFixture('verified'),
  });
  assert.equal(journey.steps.identity.state, 'approved');
  assert.equal(journey.capability_ladder.find((s) => s.stage === 'identity_approved').reached, true);
  assert.equal(journey.who_must_act, 'none');
  const locks = lockedBy(journey);
  assert.equal(locks.sell_vehicle_publicly, 'seller_authority');
  assert.equal(locks.dealer_tools, 'dealer_compliance');
});

test('X3: reverification_required — safe capability remains, identity-gated capability locks with the applicant-safe reason, subject acts next', () => {
  const journey = deriveOnboardingJourney({
    user: {}, profile: { account_kind: 'individual' },
    latestSession: APPROVED_SESSION,
    lifecycle: lifecycleFixture('reverification_required', {
      reason_code: 'DOCUMENT_EXPIRED',
      applicant_guidance: 'The identity document you verified with has expired. Please verify with a current document.',
      who_must_act: 'subject_action',
    }),
  });

  assert.equal(journey.capability_ladder[0].reached, true, 'safe stage-1 capability survives');
  assert.equal(journey.capability_ladder.find((s) => s.stage === 'identity_approved').reached, false);
  assert.equal(journey.steps.identity.state, 'reverification_required');
  assert.equal(journey.who_must_act, 'subject_action');

  const identityLock = journey.locked_capabilities.find((l) => l.capability === 'present_as_identity_verified');
  assert.equal(identityLock.locked_by, 'identity_lifecycle');
  assert.match(identityLock.reason, /expired/i);
  assert.match(journey.steps.identity.guidance, /expired/i);
});

test('X3: compromised/suspended/revoked fail closed — review owns the next step, safe capability still stands', () => {
  for (const [state, actor] of [['compromised', 'carup_review'], ['suspended', 'carup_review'], ['revoked', 'none']]) {
    const journey = deriveOnboardingJourney({
      user: {}, profile: { account_kind: 'individual' },
      latestSession: APPROVED_SESSION,
      lifecycle: lifecycleFixture(state, {
        applicant_guidance: 'For your security, CarUp is reviewing this account.',
        who_must_act: actor,
      }),
    });
    assert.equal(journey.capability_ladder.find((s) => s.stage === 'identity_approved').reached, false, state);
    assert.equal(journey.steps.identity.state, state);
    assert.equal(journey.capability_ladder[0].reached, true, `${state}: browsing/saving stays available`);
    const identityLock = journey.locked_capabilities.find((l) => l.capability === 'sensitive_financial_actions');
    assert.equal(identityLock.locked_by, 'identity_lifecycle', state);
    if (actor !== 'none') {
      assert.equal(journey.who_must_act, actor, `${state}: the review team owns the next step`);
    }
  }
});

test('X3: the journey forwards ONLY applicant-safe lifecycle fields', () => {
  const journey = deriveOnboardingJourney({
    user: {}, profile: null,
    latestSession: APPROVED_SESSION,
    lifecycle: lifecycleFixture('suspended', { who_must_act: 'carup_review', applicant_guidance: 'For your security, CarUp is reviewing this account.' }),
  });
  const exposed = journey.steps.identity.lifecycle;
  assert.deepEqual(Object.keys(exposed).sort(), [
    'applicant_guidance', 'capability_bearing', 'effective_state', 'reason_code', 'who_must_act',
  ], 'no ledger ids, actor identities, triggers or policy internals reach the subject');
});

test('X3: without a lifecycle input, pure derivation keeps the historical X2 behaviour', () => {
  const journey = deriveOnboardingJourney({ user: {}, profile: null, latestSession: APPROVED_SESSION });
  assert.equal(journey.capability_ladder.find((s) => s.stage === 'identity_approved').reached, true);
  assert.equal(journey.steps.identity.lifecycle, null);
});
