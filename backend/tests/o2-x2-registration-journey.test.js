/**
 * O2-X2 — Registration journey truth model (unit). Ported by OC-5C from PR #208.
 *
 * The law under test: registration data may be autofilled by AI/OCR, but nothing becomes
 * verified merely because OCR extracted it. Concretely:
 *
 *   · a fallback marker ('N/A', 'Unknown', …) is NOT data — it renders as `missing`,
 *     is never presented as a machine candidate, and is refused as profile content;
 *   · a field the document did not yield stays missing — no synthesis, no defaults;
 *   · provenance (confirmed vs corrected vs typed) is derived by comparing what the user
 *     SUBMITTED to what they were SHOWN — client labels are never trusted;
 *   · the Progressive Trust ladder DESCRIBES and never grants: identity approval reaches
 *     the identity stage and still leaves Seller Authority, Dealer Compliance, vehicle
 *     registration and Vehicle Trust locked by their own authorities;
 *   · OCR evidence is always attributed: outside the test runtime an extraction without a
 *     user id refuses to run.
 *
 * OC-5C additions: the person's standing is the identity_assurance.v1 SUBJECT view (never the internal
 * 'compromised' or a reason code); account type and business type are fixed once a profile exists;
 * candidates come only from a reading a provider produced and 7C did not distrust; the audit follows
 * the durable write and is reported, never a 500 for a saved profile. (#208's /api/ai/ocr and
 * runOcrParsing attribution cases are gone: both are retired on this lineage — OC-4C.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const {
  FIELD_STATE,
  sanitizeCandidateValue,
  isFallbackMarker,
  buildProfileAutofillCandidates,
  deriveIdentityStepState,
  deriveOnboardingJourney,
  upsertRegistrationProfile,
} = await import('../services/registration/registrationJourneyService.js');
const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
const { LIFECYCLE_REASON_CODES } = await import('../services/identity/identityLifecycleService.js');

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------------------
// Candidate sanitisation — markers are not data
// ---------------------------------------------------------------------------------------

test('X2: fallback markers and absent values are missing; real values pass through', () => {
  for (const marker of ['', '  ', 'N/A', 'n/a', 'NA', 'Unknown', 'unknown', 'null', 'undefined', 'None', '-', '--']) {
    assert.deepEqual(sanitizeCandidateValue(marker), { present: false }, `marker ${JSON.stringify(marker)}`);
  }
  assert.deepEqual(sanitizeCandidateValue(undefined), { present: false });
  assert.deepEqual(sanitizeCandidateValue(null), { present: false });
  assert.deepEqual(sanitizeCandidateValue(' Zimbabwe '), { present: true, value: 'Zimbabwe' });
  assert.equal(isFallbackMarker('N/A'), true);
  assert.equal(isFallbackMarker('Harare'), false);
});

const READ_SESSION = {
  id: 'vs-1',
  document_type: 'national_id',
  confidence_score: 0.91,
  ocr_execution_status: 'provider_succeeded',
  extraction_trust_status: 'partially_trusted',
  ocr_completed_at: '2026-09-03T10:00:00.000Z',
  ocr_result: {
    first_name: 'Tinashe',
    last_name: 'Moyo',
    national_id_number: 'N/A', // legacy marker — must present as missing
    country: 'Zimbabwe',
    // date_of_birth deliberately absent — must stay missing, never synthesised
  },
};

test('X2: candidates carry explicit per-field states; markers and absences have NO value key', () => {
  const candidates = buildProfileAutofillCandidates(deepFreeze({ ...READ_SESSION }));
  assert.equal(candidates.available, true);
  assert.deepEqual(candidates.document_fields.first_name, { state: FIELD_STATE.MACHINE_CANDIDATE, value: 'Tinashe' });
  assert.deepEqual(candidates.document_fields.national_id_number, { state: FIELD_STATE.MISSING });
  assert.deepEqual(candidates.document_fields.date_of_birth, { state: FIELD_STATE.MISSING });
  assert.equal('value' in candidates.document_fields.national_id_number, false, 'a marker must not carry a value');

  assert.deepEqual(candidates.profile_candidates.country_of_residence, {
    state: FIELD_STATE.MACHINE_CANDIDATE, value: 'Zimbabwe', extracted_from: 'country',
  });
  assert.equal(candidates.source.session_id, 'vs-1');
  assert.equal(candidates.source.confidence_score, 0.91);
  assert.equal(candidates.source.ocr_execution_status, 'provider_succeeded');
  assert.equal('extraction_provider_recorded' in candidates.source, false, 'no hard-coded provenance claim (#208 asserted it for any reading)');
});

test('X2: no session, or a session without extraction, yields no candidates', () => {
  assert.equal(buildProfileAutofillCandidates(null).available, false);
  assert.equal(buildProfileAutofillCandidates({ id: 'vs-2', ocr_result: null }).available, false);
});

test('OC-5C: a reading no provider produced, or one 7C distrusted, is never proposed', () => {
  for (const [label, overrides] of [
    ['provider failed', { ocr_execution_status: 'provider_failed' }],
    ['never run', { ocr_execution_status: 'not_run' }],
    ['legacy session, no execution record', { ocr_execution_status: null }],
    ['untrusted reading', { extraction_trust_status: 'untrusted' }],
    ['no fields', { extraction_trust_status: 'no_fields' }],
  ]) {
    const candidates = buildProfileAutofillCandidates({ ...READ_SESSION, ...overrides });
    assert.equal(candidates.available, false, label);
    assert.deepEqual(candidates.profile_candidates, {}, `${label}: nothing to confirm`);
    assert.match(candidates.reason, /enter your details yourself/, label);
  }
});

// ---------------------------------------------------------------------------------------
// Identity step state + the ladder
// ---------------------------------------------------------------------------------------

test('X2: identity step state maps every applicant-visible session status', () => {
  assert.equal(deriveIdentityStepState(null), 'not_started');
  assert.equal(deriveIdentityStepState({ status: 'draft' }), 'draft');
  assert.equal(deriveIdentityStepState({ status: 'captured' }), 'capturing');
  assert.equal(deriveIdentityStepState({ status: 'uploaded' }), 'ready_to_submit');
  assert.equal(deriveIdentityStepState({ status: 'ocr_pending' }), 'processing');
  assert.equal(deriveIdentityStepState({ status: 'pending_manual_review' }), 'in_review');
  assert.equal(deriveIdentityStepState({ status: 'ocr_failed' }), 'in_review', 'a technical failure routes to humans, not a dead end');
  assert.equal(deriveIdentityStepState({ status: 'retry_requested' }), 'action_required');
  assert.equal(deriveIdentityStepState({ status: 'verified' }), 'approved');
  assert.equal(deriveIdentityStepState({ status: 'rejected' }), 'rejected');
});

const VERIFIED_SESSION = {
  id: 'vs-9', status: 'verified', workflow_phase: 'resolved_approved',
  submitted_at: '2026-09-01T09:00:00.000Z', updated_at: '2026-09-02T09:00:00.000Z',
  uploaded_sides: { front: true, back: true, selfie: true },
};
/** identity_assurance.v1, as getIdentityAssurance builds it, for one effective state. */
function assurance(state, overrides = {}) {
  const usable = state === 'verified' || state === 'recovered';
  const guidance = {
    verified: LIFECYCLE_REASON_CODES.VERIFICATION_APPROVED.applicantGuidance,
    suspended: LIFECYCLE_REASON_CODES.SECURITY_REVIEW.applicantGuidance,
    compromised: LIFECYCLE_REASON_CODES.SUSPECTED_ACCOUNT_TAKEOVER.applicantGuidance,
    reverification_required: LIFECYCLE_REASON_CODES.MATERIAL_IDENTITY_CHANGE.applicantGuidance,
  }[state] || null;
  const whoMustAct = { suspended: 'carup_review', compromised: 'carup_review', reverification_required: 'subject_action', disputed: 'escalated' }[state] || 'none';
  return {
    policy_version: 'identity_assurance.v1',
    identity_state: state,
    assurance_level: usable ? 'established' : 'unusable',
    usable_for_identity_gated_actions: usable,
    who_must_act: whoMustAct,
    reason_code: { suspended: 'SECURITY_REVIEW', compromised: 'SUSPECTED_ACCOUNT_TAKEOVER', reverification_required: 'MATERIAL_IDENTITY_CHANGE' }[state] || null,
    applicant_guidance: guidance,
    ...overrides,
  };
}

test('X2: the ladder describes and never grants — identity approval leaves every domain authority locked by its own decider', () => {
  const journey = deriveOnboardingJourney(deepFreeze({
    user: { join_date: '2026-09-01T08:00:00.000Z' },
    profile: { account_kind: 'business', created_at: '2026-09-01T08:05:00.000Z' },
    latestSession: VERIFIED_SESSION,
    assurance: assurance('verified'),
  }));

  const reached = Object.fromEntries(journey.capability_ladder.map((s) => [s.stage, s.reached]));
  assert.deepEqual(reached, {
    basic_account: true,
    contact_context_established: true,
    identity_pending: true,
    identity_approved: true,
  });

  const lockedBy = Object.fromEntries(journey.locked_capabilities.map((l) => [l.capability, l.locked_by]));
  assert.equal(lockedBy.sell_vehicle_publicly, 'seller_authority');
  assert.equal(lockedBy.dealer_tools, 'dealer_compliance');
  assert.equal(lockedBy.vehicle_registration_truth, 'vehicle_registration_lifecycle');
  assert.equal(lockedBy.vehicle_trust, 'canonical_trust_service');
  assert.equal(lockedBy.privileged_staff_administration, 'platform_role_governance');
  assert.equal('present_as_identity_verified' in lockedBy, false, 'the identity-gated lock lifts on approval');

  assert.equal(journey.who_must_act, 'none');
  assert.equal(journey.steps.identity.state, 'approved');
  assert.equal(journey.time_to_safe_action.safe_capabilities_available_at, '2026-09-01T08:00:00.000Z');
  assert.equal(journey.time_to_safe_action.identity_decided_at, '2026-09-02T09:00:00.000Z');
});

test('X2: fresh account — safe capabilities immediately, everything else honestly pending on the subject', () => {
  const journey = deriveOnboardingJourney(deepFreeze({ user: { join_date: '2026-09-03T07:00:00.000Z' }, assurance: assurance('not_established') }));
  assert.equal(journey.capability_ladder[0].reached, true);
  assert.ok(journey.capability_ladder[0].unlocks.includes('browse_marketplace'));
  assert.equal(journey.capability_ladder[1].reached, false);
  assert.equal(journey.steps.identity.state, 'not_started');
  assert.equal(journey.who_must_act, 'subject_action');
  assert.equal(journey.next_actor, 'applicant');
  const lockedBy = Object.fromEntries(journey.locked_capabilities.map((l) => [l.capability, l.locked_by]));
  assert.equal(lockedBy.present_as_identity_verified, 'identity_decision');
  assert.equal(lockedBy.sensitive_financial_actions, 'identity_decision');
});

test('X2: in-review and retry states carry the right actor and applicant guidance', () => {
  const inReview = deriveOnboardingJourney(deepFreeze({
    user: {}, profile: { account_kind: 'individual' },
    latestSession: { id: 'v', status: 'pending_manual_review', workflow_phase: 'reviewer_action_required' },
  }));
  assert.equal(inReview.who_must_act, 'carup_review');
  assert.equal(inReview.next_actor, 'carup_review');

  const retry = deriveOnboardingJourney(deepFreeze({
    user: {}, profile: { account_kind: 'individual' },
    latestSession: {
      id: 'v', status: 'retry_requested', workflow_phase: 'applicant_action_required',
      primary_reason_code: 'DOCUMENT_NOT_VISIBLE', retry_reason: 'Please retake the front photo in daylight.',
    },
  }));
  assert.equal(retry.who_must_act, 'subject_action');
  assert.equal(retry.steps.identity.state, 'action_required');
  assert.match(retry.required_action, /No identity document could be seen/);
  assert.match(retry.required_action, /Message from your reviewer: Please retake the front photo in daylight/);
});

// ---------------------------------------------------------------------------------------
// OC-5C — the person's CURRENT standing, subject-safe
// ---------------------------------------------------------------------------------------

test('OC-5C: a suspended identity overrides the historical approval — "on hold", its guidance everywhere, the locks back on', () => {
  const journey = deriveOnboardingJourney(deepFreeze({
    user: {}, profile: { account_kind: 'individual' }, latestSession: VERIFIED_SESSION, assurance: assurance('suspended'),
  }));
  assert.equal(journey.steps.identity.state, 'on_hold');
  assert.equal(journey.steps.identity.guidance, LIFECYCLE_REASON_CODES.SECURITY_REVIEW.applicantGuidance);
  assert.equal(journey.required_action, LIFECYCLE_REASON_CODES.SECURITY_REVIEW.applicantGuidance,
    'never the session\'s "Your identity is verified." (#208 showed that to a suspended person)');
  assert.equal(journey.who_must_act, 'carup_review');
  assert.equal(journey.capability_ladder.find((s) => s.stage === 'identity_approved').reached, false);
  const lock = journey.locked_capabilities.find((l) => l.capability === 'present_as_identity_verified');
  assert.equal(lock.locked_by, 'identity_lifecycle');
  assert.deepEqual({ ...journey.steps.identity.lifecycle }, {
    status: 'on_hold', status_label: 'on hold',
    applicant_guidance: LIFECYCLE_REASON_CODES.SECURITY_REVIEW.applicantGuidance,
    who_must_act: 'carup_review', capability_bearing: false,
  });
  assert.doesNotMatch(JSON.stringify(journey), /suspended|SECURITY_REVIEW/, 'no internal state name, no reason code');
});

test('OC-5C: a COMPROMISED identity reads as "under security review" — the person never sees "compromised" or a takeover hypothesis', () => {
  const journey = deriveOnboardingJourney(deepFreeze({
    user: {}, profile: { account_kind: 'individual' }, latestSession: VERIFIED_SESSION, assurance: assurance('compromised'),
  }));
  assert.equal(journey.steps.identity.state, 'security_review');
  assert.equal(journey.steps.identity.lifecycle.status_label, 'under security review');
  assert.doesNotMatch(JSON.stringify(journey), /compromised|TAKEOVER/i);
});

test('OC-5C: re-verification required is the person\'s move; a NEW evidence journey in progress stays visible to finish', () => {
  const required = deriveOnboardingJourney(deepFreeze({
    user: {}, profile: { account_kind: 'individual' }, latestSession: VERIFIED_SESSION, assurance: assurance('reverification_required'),
  }));
  assert.equal(required.steps.identity.state, 'reverification_required');
  assert.equal(required.who_must_act, 'subject_action');

  const resubmitting = deriveOnboardingJourney(deepFreeze({
    user: {}, profile: { account_kind: 'individual' },
    latestSession: { id: 'vs-new', status: 'uploaded', workflow_phase: 'applicant_action_required', uploaded_sides: { front: true, back: false, selfie: true } },
    assurance: assurance('reverification_required'),
  }));
  assert.equal(resubmitting.steps.identity.state, 'ready_to_submit', 'the person can finish the new evidence journey');
  assert.match(resubmitting.required_action, /submit them for verification/);
});

// ---------------------------------------------------------------------------------------
// Profile upsert rules (mock client)
// ---------------------------------------------------------------------------------------

function makeClient(state) {
  const builder = (table) => {
    const q = { op: 'select', payload: undefined, filters: {} };
    const api = {
      select() { return api; },
      insert(payload) { q.op = 'insert'; q.payload = payload; return api; },
      update(payload) { q.op = 'update'; q.payload = payload; return api; },
      eq(k, v) { q.filters[k] = v; return api; },
      order() { return api; },
      single() { return api; },
      maybeSingle() { return api; },
      then(resolve, reject) {
        try {
          state.calls.push({ table, op: q.op, payload: q.payload, filters: { ...q.filters } });
          if (table === 'user_registration_profiles') {
            if (q.op === 'select') return resolve({ data: state.profile, error: null });
            if (q.op === 'insert') { state.profile = { ...q.payload, created_at: 'T-created' }; return resolve({ data: state.profile, error: null }); }
            if (q.op === 'update') { state.profile = { ...state.profile, ...q.payload }; return resolve({ data: state.profile, error: null }); }
          }
          if (table === 'trust_audit_events') {
            return resolve(state.failAudit ? { data: null, error: { message: 'audit store unavailable' } } : { data: null, error: null });
          }
          return resolve({ data: null, error: null });
        } catch (err) { return reject ? reject(err) : Promise.reject(err); }
      },
    };
    return api;
  };
  return { from: builder };
}

const VALID_PROFILE = Object.freeze({
  account_kind: 'individual',
  market_relationship: 'diaspora',
  country_of_residence: 'United Kingdom',
  city: 'Leeds',
  intended_use: 'buy_sell',
  terms_acknowledged: true,
  privacy_acknowledged: true,
});

test('X2: provenance is derived from what was shown vs what was submitted — never from client labels', async () => {
  const state = { profile: null, calls: [] };
  const confirmed = await upsertRegistrationProfile(makeClient(state), { id: 'u-9' }, {
    profile: { ...VALID_PROFILE, country_of_residence: 'Zimbabwe' },
    candidates_seen: { country_of_residence: 'Zimbabwe' },
  });
  assert.equal(confirmed.field_provenance.country_of_residence, FIELD_STATE.USER_CONFIRMED);
  assert.equal(confirmed.field_provenance.city, FIELD_STATE.USER_PROVIDED);
  assert.equal(confirmed.audit_recorded, true);

  const state2 = { profile: null, calls: [] };
  const corrected = await upsertRegistrationProfile(makeClient(state2), { id: 'u-9' }, {
    profile: { ...VALID_PROFILE, country_of_residence: 'Botswana' },
    candidates_seen: { country_of_residence: 'Zimbabwe' },
  });
  assert.equal(corrected.field_provenance.country_of_residence, FIELD_STATE.USER_CORRECTED);

  // The audit row carries the provenance — the confirmed store itself stays plain values.
  const audit = state2.calls.find((c) => c.table === 'trust_audit_events' && c.op === 'insert');
  assert.equal(audit.payload.new_value.field_provenance.country_of_residence, FIELD_STATE.USER_CORRECTED);
  assert.deepEqual(audit.payload.new_value.candidate_fields_shown, ['country_of_residence']);
  assert.equal('field_provenance' in state2.profile, false, 'provenance never becomes a profile column');
});

test('X2: a fallback marker is refused as profile data by name', async () => {
  const state = { profile: null, calls: [] };
  await assert.rejects(
    () => upsertRegistrationProfile(makeClient(state), { id: 'u-9' }, {
      profile: { ...VALID_PROFILE, city: 'N/A' },
    }),
    /placeholder, not a real city/,
  );
  assert.equal(state.profile, null, 'nothing may be written after a refusal');
});

test('X2: unknown candidate fields are refused — the confirmable surface is deliberate', async () => {
  await assert.rejects(
    () => upsertRegistrationProfile(makeClient({ profile: null, calls: [] }), { id: 'u-9' }, {
      profile: { ...VALID_PROFILE },
      candidates_seen: { national_id_number: '63-123456-A-42' },
    }),
    /Unknown autofill candidate field/,
  );
});

const BUSINESS = Object.freeze({
  user_id: 'u-9', account_kind: 'business', market_relationship: 'zimbabwe_local',
  country_of_residence: 'Zimbabwe', city: 'Harare', intended_use: 'professional_services',
  organization_name: 'Moyo Motors', business_type: 'garage', onboarding_status: 'in_review', marketing_consent: false,
  terms_acknowledged_at: '2026-08-29T12:00:00.000Z', privacy_acknowledged_at: '2026-08-29T12:00:00.000Z',
  created_at: '2026-08-29T12:00:00.000Z',
});
const BUSINESS_SUBMISSION = Object.freeze({
  account_kind: 'business', market_relationship: 'zimbabwe_local',
  country_of_residence: 'Zimbabwe', city: 'Bulawayo', intended_use: 'professional_services',
  organization_name: 'Moyo Motors & Sons', business_type: 'garage',
  terms_acknowledged: true, privacy_acknowledged: true, marketing_consent: true,
});

test('X2: an update preserves the acknowledgement instants, the server-owned onboarding status and the consent record', async () => {
  const state = { calls: [], profile: { ...BUSINESS } };
  const result = await upsertRegistrationProfile(makeClient(state), { id: 'u-9' }, { profile: { ...BUSINESS_SUBMISSION } });
  assert.equal(result.profile.city, 'Bulawayo');
  assert.equal(result.profile.organization_name, 'Moyo Motors & Sons', 'context stays editable');
  assert.equal(result.profile.terms_acknowledged_at, '2026-08-29T12:00:00.000Z', 'the legal record survives updates');
  assert.equal(result.profile.onboarding_status, 'in_review', 'a reviewed business never silently drops back to requested');
  assert.equal(result.profile.marketing_consent, false, 'consent is Communications\' to change, not this form\'s');
  const audit = state.calls.find((c) => c.table === 'trust_audit_events' && c.op === 'insert');
  assert.deepEqual(audit.payload.new_value.changed_fields, ['city', 'organization_name'], 'the audit names what changed (names only)');
});

test('OC-5C: account type and business type are FIXED once a profile exists — no self-service switch into another context', async () => {
  for (const [label, change] of [
    ['a garage applicant becomes a logistics provider', { business_type: 'logistics_provider' }],
    ['a garage applicant becomes a dealer', { business_type: 'dealer' }],
    ['a business becomes an individual', { account_kind: 'individual', organization_name: null, business_type: null }],
  ]) {
    const state = { calls: [], profile: { ...BUSINESS } };
    await assert.rejects(
      () => upsertRegistrationProfile(makeClient(state), { id: 'u-9' }, { profile: { ...BUSINESS_SUBMISSION, ...change } }),
      (err) => err.statusCode === 409 && /REGISTRATION_FIELD_FIXED/.test(err.message),
      label,
    );
    assert.deepEqual(state.calls.filter((c) => c.op !== 'select'), [], `${label}: nothing written`);
    assert.equal(state.profile.business_type, 'garage');
  }
  // An individual cannot become a business either.
  const individual = { calls: [], profile: { user_id: 'u-9', ...VALID_PROFILE, organization_name: null, business_type: null, onboarding_status: 'not_required' } };
  await assert.rejects(
    () => upsertRegistrationProfile(makeClient(individual), { id: 'u-9' }, { profile: { ...BUSINESS_SUBMISSION, business_type: 'logistics_provider' } }),
    /REGISTRATION_FIELD_FIXED/,
  );
});

test('OC-5C: the audit follows the durable write — a failed audit is reported and logged, never a 500 for a saved profile', async () => {
  const state = { profile: null, calls: [], failAudit: true };
  const errors = [];
  const saved = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const result = await upsertRegistrationProfile(makeClient(state), { id: 'u-9' }, { profile: { ...VALID_PROFILE } });
    assert.equal(result.audit_recorded, false);
    assert.equal(result.profile.city, 'Leeds', 'the profile was saved and is returned');
    assert.equal(state.profile.city, 'Leeds');
  } finally {
    console.error = saved;
  }
  assert.ok(errors.some((line) => /audit was not recorded/.test(line)), 'the lost audit is logged as an error');
});

// ---------------------------------------------------------------------------------------
// Attribution guard (the X1 'u1' residual, closed)
// ---------------------------------------------------------------------------------------

test('X2: outside the test runtime, extraction without a user id refuses to run', async () => {
  const savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(
      () => DocumentIntelligenceService.extractDocumentData('national_id', 'data:image/png;base64,QUJD'),
      /requires the authenticated user id/,
    );
  } finally {
    process.env.NODE_ENV = savedEnv;
  }
});

test('X2: the 7C submit path attributes extraction to the session owner (source pin)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../services/identity/verificationSessionService.js', import.meta.url), 'utf8');
  assert.match(source, /extractDocumentData\(session\.document_type, frontDataUri, session\.user_id\)/);
});
