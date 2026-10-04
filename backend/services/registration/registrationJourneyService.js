import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import {
  normalizeRegistrationProfile,
} from '../auth/registrationProfileService.js';
import {
  WORKFLOW_PHASE,
  OCR_EXECUTION_STATUS,
  EXTRACTION_TRUST_STATUS,
  legacyStatusToPhase,
  toResponsibilityProjection,
} from '../identity/caseWorkflow.js';
import { getReasonConfig } from '../identity/reasonCodes.js';
import { getLatestVerificationSessionForUser } from '../identity/verificationSessionService.js';
import { LIFECYCLE_STATES, toSubjectIdentityStatus } from '../identity/identityLifecycleService.js';
import { getIdentityAssurance, toSubjectIdentityAssurance } from '../identity/identityAssuranceService.js';
import { CarUpError, ConflictError, ValidationError } from '../../utils/errors.js';

/**
 * O2-X2 — Registration journey, OCR autofill candidates, Progressive Trust ladder.
 * Ported by OC-5C from PR #208 (3855f250, with its X6 assurance wiring 3b4a5598), re-authored for this
 * lineage — see "OC-5C" below.
 *
 * BOUNDARY (the X2 law, enforced here and pinned by o2-x2 tests):
 *
 *   Registration data may be autofilled by AI/OCR, but nothing becomes verified merely
 *   because OCR extracted it.
 *
 * This module DESCRIBES and RECORDS; it never grants. The journey/ladder it derives is a
 * read-time projection for the applicant's own UI — authorization stays with each domain's
 * own gates (identity decisions with Phase 7C review, Seller Authority with
 * sellerAuthorityService, Dealer Compliance with dealerComplianceService, vehicle
 * registration with the vehicle domain, Vehicle Trust with canonical Trust). Nothing in
 * this module reads or writes any of those authorities, and identity approval never
 * appears here as a grant of any of them.
 *
 * The only table this module writes is `user_registration_profiles` — the confirmed
 * account/profile context store — and only with values the USER submitted. Extracted
 * values reach the profile exclusively by being presented as candidates and then
 * confirmed or corrected by the user; provenance (confirmed vs corrected vs typed) is
 * derived server-side by comparing what was submitted to what the user was shown, never
 * trusted from client labels.
 *
 * OC-5C — what changed from #208, and why:
 *   - the person's identity standing comes from identity_assurance.v1 through its SUBJECT view: a
 *     subject-safe status ('on hold', 'under security review') and the applicant guidance — never the
 *     internal state 'compromised' or a reason code, which #208's journey returned to the person;
 *   - account_kind and business_type are FIXED once a profile exists. On this lineage they open the
 *     logistics-provider marketplace and the garage onboarding context, so a self-service edit would
 *     let anyone switch themselves into either. onboarding_status is server-owned, and the signup
 *     marketing-consent record is not edited here (Communications owns consent);
 *   - autofill candidates are offered only from a reading a provider actually produced and the 7C
 *     pipeline did not distrust — #208 hard-coded "extraction_provider_recorded: true" for any reading;
 *   - the audit follows the durable write: a failed audit is reported (audit_recorded: false) and
 *     logged, never a 500 for a write that happened;
 *   - an unreadable identity standing fails the journey CLOSED (503) instead of showing a stale
 *     session as "verified".
 */

// --------------------------------------------------------------------------------------
// Candidate truth model
// --------------------------------------------------------------------------------------

export const FIELD_STATE = Object.freeze({
  MACHINE_CANDIDATE: 'machine_candidate',
  USER_CONFIRMED: 'user_confirmed',
  USER_CORRECTED: 'user_corrected',
  USER_PROVIDED: 'user_provided',
  MISSING: 'missing',
});

/**
 * Marker strings that legacy extraction paths (and imperfect providers) emit in place of
 * a real value. A marker is NOT data: it renders as `missing`, is never presented as a
 * machine candidate, and is refused outright as profile content — a person's city is
 * never the string "N/A".
 */
const FALLBACK_MARKERS = new Set(['', 'n/a', 'na', 'unknown', 'null', 'undefined', 'none', '-', '--']);

export function sanitizeCandidateValue(raw) {
  if (raw === null || raw === undefined) return { present: false };
  const value = String(raw).trim();
  if (FALLBACK_MARKERS.has(value.toLowerCase())) return { present: false };
  return { present: true, value };
}

export function isFallbackMarker(raw) {
  if (raw === null || raw === undefined) return false;
  return FALLBACK_MARKERS.has(String(raw).trim().toLowerCase());
}

/** Identity-document fields the applicant may be shown from their own session. */
const DOCUMENT_FIELDS = Object.freeze(['first_name', 'last_name', 'national_id_number', 'date_of_birth', 'country']);

/** Extraction field → registration-profile column it may PROPOSE a value for. */
const PROFILE_CANDIDATE_MAP = Object.freeze({ country: 'country_of_residence' });

/** A reading the 7C pipeline did not distrust. 'untrusted' / 'no_fields' readings are never proposed. */
const PROPOSABLE_EXTRACTION_TRUST = new Set([EXTRACTION_TRUST_STATUS.TRUSTED, EXTRACTION_TRUST_STATUS.PARTIALLY_TRUSTED]);

function noCandidates(reason) {
  return { available: false, reason, document_fields: {}, profile_candidates: {} };
}

/**
 * Build the applicant-facing autofill candidates from THEIR latest (sanitized) session.
 * Every field carries an explicit state; absent or marker values are `missing` with no
 * value key at all, so a fallback can never be rendered — or confirmed — as data.
 */
export function buildProfileAutofillCandidates(latestSession) {
  if (!latestSession) return noCandidates('No identity verification session exists yet.');
  if (!latestSession.ocr_result || typeof latestSession.ocr_result !== 'object') {
    return noCandidates('Extraction has not completed for your current verification session.');
  }
  // OC-5C: only a reading a provider actually produced, and that 7C did not distrust, is proposed.
  if (latestSession.ocr_execution_status !== OCR_EXECUTION_STATUS.PROVIDER_SUCCEEDED
    || !PROPOSABLE_EXTRACTION_TRUST.has(latestSession.extraction_trust_status)) {
    return noCandidates('Your document could not be read reliably, so nothing is suggested — enter your details yourself.');
  }

  const extracted = latestSession.ocr_result;
  const documentFields = {};
  for (const field of DOCUMENT_FIELDS) {
    const candidate = sanitizeCandidateValue(extracted[field]);
    documentFields[field] = candidate.present
      ? { state: FIELD_STATE.MACHINE_CANDIDATE, value: candidate.value }
      : { state: FIELD_STATE.MISSING };
  }

  const profileCandidates = {};
  for (const [sourceField, profileColumn] of Object.entries(PROFILE_CANDIDATE_MAP)) {
    const candidate = sanitizeCandidateValue(extracted[sourceField]);
    profileCandidates[profileColumn] = candidate.present
      ? { state: FIELD_STATE.MACHINE_CANDIDATE, value: candidate.value, extracted_from: sourceField }
      : { state: FIELD_STATE.MISSING, extracted_from: sourceField };
  }

  return {
    available: true,
    source: {
      session_id: latestSession.id,
      document_type: latestSession.document_type || null,
      ocr_execution_status: latestSession.ocr_execution_status,
      extraction_trust_status: latestSession.extraction_trust_status,
      confidence_score: latestSession.confidence_score ?? null,
      extracted_at: latestSession.ocr_completed_at || null,
    },
    document_fields: documentFields,
    profile_candidates: profileCandidates,
  };
}

// --------------------------------------------------------------------------------------
// Progressive Trust ladder (derived, advisory, grants NOTHING)
// --------------------------------------------------------------------------------------

const TERMINAL_PHASES = new Set([
  WORKFLOW_PHASE.RESOLVED_APPROVED,
  WORKFLOW_PHASE.RESOLVED_REJECTED,
  WORKFLOW_PHASE.CANCELLED,
]);

/** A current lifecycle that withdraws or questions the identity — it overrides a historical approval. */
const NON_RESTRICTIVE_LIFECYCLE = new Set([
  LIFECYCLE_STATES.VERIFIED,
  LIFECYCLE_STATES.RECOVERED,
  LIFECYCLE_STATES.NOT_ESTABLISHED,
]);

function sessionPhase(session) {
  if (!session) return null;
  return session.workflow_phase || legacyStatusToPhase(session.status) || null;
}

/** Applicant-step state for the identity leg of the journey. */
export function deriveIdentityStepState(session) {
  if (!session) return 'not_started';
  const status = String(session.status || '').toLowerCase();
  if (status === 'draft') return 'draft';
  if (status === 'captured') return 'capturing';
  if (status === 'uploaded') return 'ready_to_submit';
  if (status === 'ocr_pending') return 'processing';
  if (status === 'retry_requested') return 'action_required';
  if (status === 'verified') return 'approved';
  if (status === 'rejected') return 'rejected';
  // ocr_failed and pending_manual_review both sit with the review team (7C routes a
  // technical failure to a human rather than bouncing the applicant).
  return 'in_review';
}

function applicantGuidance(session) {
  if (!session) {
    return 'Upload an identity document and selfie to start verification when you are ready.';
  }
  const state = deriveIdentityStepState(session);
  if (state === 'action_required') {
    const reason = session.primary_reason_code ? getReasonConfig(session.primary_reason_code) : null;
    const guidance = reason?.defaultApplicantGuidance || 'Your reviewer asked you to resubmit your documents.';
    // retry_reason is what the reviewer wrote TO the applicant (the decision's applicant message).
    return session.retry_reason ? `${guidance} Message from your reviewer: ${session.retry_reason}` : guidance;
  }
  if (state === 'processing') return 'CarUp is processing your documents. You can keep using safe features meanwhile.';
  if (state === 'in_review') return 'A CarUp reviewer will check your documents. No action is needed from you right now.';
  if (state === 'approved') return 'Your identity is verified.';
  if (state === 'rejected') {
    return session.failure_reason
      || 'Your verification was closed by a reviewer. Contact CarUp support to reopen it.';
  }
  if (state === 'ready_to_submit') return 'Required identity evidence and selfie are uploaded — submit them for verification.';
  if (state === 'capturing' || state === 'draft') return 'Finish uploading your identity document evidence and selfie.';
  return 'Continue your identity verification when you are ready.';
}

/**
 * The Progressive Trust ladder. Purely derived from authoritative states already owned
 * elsewhere; performing NO reads of Seller Authority, Dealer Compliance, vehicle
 * registration or Trust — those stages are always reported as locked-by-their-own-
 * authority from here, because this surface cannot and must not answer for them.
 *
 * `assurance` is the identity_assurance.v1 projection (the ONE identity interpretation, O2-X6). Its
 * internal state is read here only to decide; what the person is SHOWN is the subject-safe status.
 */
export function deriveOnboardingJourney({ user = {}, profile = null, latestSession = null, assurance = null } = {}) {
  let identityState = deriveIdentityStepState(latestSession);
  const identityActive = Boolean(latestSession) && !TERMINAL_PHASES.has(sessionPhase(latestSession)) && identityState !== 'rejected';
  const contextEstablished = Boolean(profile);

  const effectiveState = assurance?.identity_state || null;
  const identityApproved = assurance
    ? assurance.usable_for_identity_gated_actions === true
    : identityState === 'approved';

  // A restrictive current lifecycle overrides the historical step label — unless the person is
  // mid-way through a NEW evidence journey, which stays visible so they can finish it.
  const restrictiveLifecycle = Boolean(effectiveState) && !NON_RESTRICTIVE_LIFECYCLE.has(effectiveState);
  const subjectStatus = restrictiveLifecycle ? toSubjectIdentityStatus(effectiveState) : null;
  if (subjectStatus && (identityState === 'approved' || identityState === 'not_started')) {
    identityState = subjectStatus.code;
  }
  const lifecycleGuidance = assurance?.applicant_guidance || 'CarUp is reviewing this account.';

  const phase = sessionPhase(latestSession);
  const identityWhoMustAct = restrictiveLifecycle
    ? (assurance?.who_must_act || 'carup_review')
    : (latestSession ? toResponsibilityProjection(phase) : 'subject_action');

  // Journey-level responsibility: the applicant's outstanding step, else the review
  // team's, else none. Uses ONLY the ADR vocabulary, derived at read time (P2 law).
  let whoMustAct = 'none';
  if (restrictiveLifecycle && identityWhoMustAct !== 'subject_action') {
    whoMustAct = identityWhoMustAct;
  } else if (!contextEstablished || !latestSession || identityWhoMustAct === 'subject_action') {
    whoMustAct = identityApproved && contextEstablished ? 'none' : 'subject_action';
  } else {
    whoMustAct = identityWhoMustAct;
  }

  const nextActorByProjection = {
    subject_action: 'applicant',
    carup_review: 'carup_review',
    platform_processing: 'carup_system',
    escalated: 'carup_review',
    external_authority: 'external_authority',
    none: 'none',
  };

  const stages = [
    {
      stage: 'basic_account',
      reached: true,
      unlocks: [
        'browse_marketplace',
        'save_vehicles',
        'create_safe_drafts',
        'start_registration_profile',
        'upload_identity_documents',
      ],
    },
    {
      stage: 'contact_context_established',
      reached: contextEstablished,
      unlocks: [
        'continue_draft_workflows',
        'prepare_seller_onboarding',
        ...(profile?.account_kind === 'business' ? ['prepare_dealer_onboarding'] : []),
      ],
    },
    {
      stage: 'identity_pending',
      reached: identityActive || identityApproved,
      unlocks: ['continue_safe_preparation_work'],
    },
    {
      stage: 'identity_approved',
      reached: identityApproved,
      unlocks: [
        'consume_identity_assurance',
        'proceed_to_identity_gated_workflows',
      ],
    },
  ];

  // Locked capabilities, each naming the authority that unlocks it. Identity approval
  // deliberately unlocks NONE of the domain authorities below — separate owners,
  // separate decisions (the canonical ≠ chain).
  const locked = [];
  if (!identityApproved) {
    const identityLockReason = restrictiveLifecycle
      ? lifecycleGuidance
      : 'A governed reviewer decision is required; OCR extraction alone never verifies.';
    for (const capability of ['present_as_identity_verified', 'sensitive_financial_actions']) {
      locked.push({
        capability,
        locked_by: restrictiveLifecycle ? 'identity_lifecycle' : 'identity_decision',
        reason: identityLockReason,
      });
    }
  }
  locked.push({
    capability: 'sell_vehicle_publicly',
    locked_by: 'seller_authority',
    reason: 'Seller Authority is decided per vehicle by its own governed review — identity verification never grants it.',
  });
  locked.push({
    capability: 'dealer_tools',
    locked_by: 'dealer_compliance',
    reason: 'Dealer Compliance is its own governed decision — identity verification never grants it.',
  });
  locked.push({
    capability: 'vehicle_registration_truth',
    locked_by: 'vehicle_registration_lifecycle',
    reason: 'Zimbabwe registration is a vehicle/passport state, never a person state.',
  });
  locked.push({
    capability: 'vehicle_trust',
    locked_by: 'canonical_trust_service',
    reason: 'Vehicle Trust has one writer; no person-side state changes it.',
  });
  locked.push({
    capability: 'privileged_staff_administration',
    locked_by: 'platform_role_governance',
    reason: 'Never reachable through registration or identity verification.',
  });

  // One guidance for the person: a restrictive lifecycle's guidance wins everywhere (#208 kept the
  // session's "Your identity is verified." as the required action of a suspended person).
  const guidance = restrictiveLifecycle && identityState === subjectStatus?.code
    ? lifecycleGuidance
    : applicantGuidance(latestSession);

  return {
    steps: {
      account_created: true,
      context_established: contextEstablished,
      identity: {
        state: identityState,
        session_id: latestSession?.id || null,
        uploaded_sides: latestSession?.uploaded_sides || { front: false, back: false, selfie: false },
        double_sided: latestSession?.double_sided ?? null,
        document_type: latestSession?.document_type || null,
        who_must_act: identityWhoMustAct,
        guidance,
        // The CURRENT identity standing, subject-safe: a status the person may see, the guidance, the
        // actor — never the internal state name or the reason code.
        lifecycle: assurance
          ? {
            status: toSubjectIdentityStatus(effectiveState)?.code ?? null,
            status_label: toSubjectIdentityStatus(effectiveState)?.label ?? null,
            applicant_guidance: assurance.applicant_guidance || null,
            who_must_act: assurance.who_must_act,
            capability_bearing: assurance.usable_for_identity_gated_actions === true,
          }
          : null,
      },
    },
    who_must_act: whoMustAct,
    next_actor: nextActorByProjection[whoMustAct] || 'none',
    required_action: guidance,
    capability_ladder: stages,
    locked_capabilities: locked,
    // Time to Safe Action measurement points. Safe capability exists from account
    // creation — the KPI measures how quickly a legitimate user can do the first safe
    // useful thing, not how quickly they become fully verified.
    time_to_safe_action: {
      account_created_at: user.join_date || null,
      safe_capabilities_available_at: user.join_date || null,
      context_established_at: profile?.created_at || null,
      identity_submitted_at: latestSession?.submitted_at || null,
      identity_extraction_completed_at: latestSession?.ocr_completed_at || null,
      identity_decided_at: TERMINAL_PHASES.has(sessionPhase(latestSession)) ? latestSession?.updated_at || null : null,
    },
  };
}

// --------------------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------------------

function requireUserId(actor = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  return userId;
}

async function fetchOwnProfile(client, userId) {
  const { data, error } = await client
    .from('user_registration_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function fetchOwnUserRow(client, userId) {
  const { data, error } = await client
    .from('users')
    .select('id, name, email, phone, is_verified, join_date')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/** "We could not read your identity standing" must never render as a stale session's "verified". */
async function readIdentityAssurance(client, userId) {
  try {
    return await getIdentityAssurance(client, userId);
  } catch (cause) {
    const err = new CarUpError('Your identity status could not be read right now. Please try again shortly.', 503, 'IDENTITY_STATUS_UNAVAILABLE');
    err.cause = cause;
    throw err;
  }
}

export async function getRegistrationJourney(client = supabase, actor = {}) {
  const userId = requireUserId(actor);
  const [user, profile, latestSession, assurance] = await Promise.all([
    fetchOwnUserRow(client, userId),
    fetchOwnProfile(client, userId),
    getLatestVerificationSessionForUser(client, { id: userId }),
    readIdentityAssurance(client, userId),
  ]);

  const journey = deriveOnboardingJourney({ user: user || {}, profile, latestSession, assurance });
  return {
    user: user
      ? {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || null,
        // Email-lane flag, displayed as itself — never conflated with identity.
        email_verified: user.is_verified === true,
      }
      : null,
    profile,
    identity_session: latestSession,
    journey,
    // O2-X6 — the canonical projection, through its SUBJECT view (OC-5C).
    identity_assurance: toSubjectIdentityAssurance(assurance),
  };
}

export async function getProfileAutofillCandidates(client = supabase, actor = {}) {
  const userId = requireUserId(actor);
  const latestSession = await getLatestVerificationSessionForUser(client, { id: userId });
  return buildProfileAutofillCandidates(latestSession);
}

// --------------------------------------------------------------------------------------
// Confirmed-profile write (the ONLY write this module performs)
// --------------------------------------------------------------------------------------

const CONFIRMABLE_PROFILE_FIELDS = new Set([
  'country_of_residence', 'city', 'province', 'organization_name',
]);
/** Profile columns a candidate may relate to; extend deliberately, never implicitly. */
const CANDIDATE_FIELD_NAMES = new Set(['country_of_residence']);

/**
 * Fixed at registration (OC-5C). On this lineage they are consequential: business_type
 * 'logistics_provider' opens the provider marketplace (diasporaLogisticsRfqService) and 'garage' the
 * garage onboarding context (garageApplicationService). A change is a support/governance action.
 */
export const REGISTRATION_FIXED_FIELDS = Object.freeze({
  account_kind: 'account type',
  business_type: 'business type',
});

/** Editable context, compared to record WHICH fields an update changed (names only in the audit). */
const CONTEXT_FIELDS = Object.freeze([
  'market_relationship', 'country_of_residence', 'city', 'province', 'intended_use', 'organization_name',
]);

function classifyFieldProvenance(profileFields, candidatesSeen) {
  const provenance = {};
  for (const [field, submitted] of Object.entries(profileFields)) {
    if (submitted === null || submitted === undefined || submitted === '') continue;
    const seen = candidatesSeen[field];
    if (seen === undefined) {
      provenance[field] = FIELD_STATE.USER_PROVIDED;
    } else if (String(seen) === String(submitted)) {
      provenance[field] = FIELD_STATE.USER_CONFIRMED;
    } else {
      provenance[field] = FIELD_STATE.USER_CORRECTED;
    }
  }
  return provenance;
}

function normalizeCandidatesSeen(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('candidates_seen must be an object of field → shown value.');
  }
  const seen = {};
  for (const [field, value] of Object.entries(raw)) {
    if (!CANDIDATE_FIELD_NAMES.has(field)) {
      throw new ValidationError(`Unknown autofill candidate field: ${field}.`);
    }
    if (typeof value !== 'string' || value.length > 200) {
      throw new ValidationError(`Candidate value for ${field} must be a string of at most 200 characters.`);
    }
    seen[field] = value;
  }
  return seen;
}

/**
 * Create or update the caller's OWN registration profile with USER-SUBMITTED values.
 *
 * Refusals (fail-closed, nothing written):
 *  - any submitted text field equal to a fallback marker — a marker is not data;
 *  - unknown candidate field names or oversized candidate values;
 *  - the signup contract's own validation (vocabularies, acknowledgements, business rules);
 *  - an update that would change a field fixed at registration (409 REGISTRATION_FIELD_FIXED).
 *
 * Preserved on update: the ORIGINAL terms/privacy acknowledgement instants (the legal record of when
 * the person agreed), the server-owned onboarding_status, and the signup marketing-consent record.
 *
 * The audit follows the durable write. If it cannot be written, the result says so
 * (audit_recorded: false) and the failure is logged — the saved profile is never reported as a 500.
 */
export async function upsertRegistrationProfile(client = supabase, actor = {}, payload = {}, options = {}) {
  const userId = requireUserId(actor);
  const rawProfile = payload.profile ?? null;
  if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
    throw new ValidationError('profile is required: submit your registration context as an object.');
  }

  const normalized = normalizeRegistrationProfile(rawProfile, { fallbackLocation: '' });
  if (!normalized.ok) throw new ValidationError(normalized.error);
  const profile = normalized.profile;

  for (const field of CONFIRMABLE_PROFILE_FIELDS) {
    if (profile[field] !== null && profile[field] !== undefined && isFallbackMarker(profile[field])) {
      throw new ValidationError(
        `"${profile[field]}" is a placeholder, not a real ${field.replace(/_/g, ' ')} — leave the field blank or enter the actual value.`,
      );
    }
  }

  const candidatesSeen = normalizeCandidatesSeen(payload.candidates_seen);
  const fieldProvenance = classifyFieldProvenance(profile, candidatesSeen);

  const existing = await fetchOwnProfile(client, userId);
  if (existing) {
    for (const [field, label] of Object.entries(REGISTRATION_FIXED_FIELDS)) {
      if ((existing[field] ?? null) !== (profile[field] ?? null)) {
        throw new ConflictError(
          `REGISTRATION_FIELD_FIXED: your ${label} was set when you registered and cannot be changed here. Contact CarUp support to change it.`,
        );
      }
    }
  }
  const timestamp = new Date().toISOString();

  const row = { ...profile, user_id: userId, updated_at: timestamp };
  if (existing) {
    row.terms_acknowledged_at = existing.terms_acknowledged_at;
    row.privacy_acknowledged_at = existing.privacy_acknowledged_at;
    row.onboarding_status = existing.onboarding_status;
    row.marketing_consent = existing.marketing_consent;
  }
  const changedFields = existing
    ? CONTEXT_FIELDS.filter((field) => (existing[field] ?? null) !== (row[field] ?? null))
    : null;

  let saved;
  if (existing) {
    const { data, error } = await client
      .from('user_registration_profiles')
      .update(row)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    saved = data;
  } else {
    const { data, error } = await client
      .from('user_registration_profiles')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    saved = data;
  }

  const audit = await logAuditEvent(client, {
    req: options.req,
    event_type: existing ? 'REGISTRATION_PROFILE_UPDATED' : 'REGISTRATION_PROFILE_SUBMITTED',
    actor_user_id: userId,
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: '/api/registration/profile',
    targetType: 'user_registration_profile',
    targetId: userId,
    previous_value: existing
      ? { account_kind: existing.account_kind, market_relationship: existing.market_relationship, onboarding_status: existing.onboarding_status }
      : null,
    new_value: {
      account_kind: saved.account_kind,
      market_relationship: saved.market_relationship,
      onboarding_status: saved.onboarding_status,
      changed_fields: changedFields,
      field_provenance: fieldProvenance,
      candidate_fields_shown: Object.keys(candidatesSeen),
    },
  });
  const auditRecorded = audit?.success === true;
  if (!auditRecorded) {
    console.error('[registration] profile saved but its audit was not recorded:', audit?.error || audit?.fallbackError || 'unknown error');
  }

  return { profile: saved, field_provenance: fieldProvenance, audit_recorded: auditRecorded };
}

export default {
  FIELD_STATE,
  REGISTRATION_FIXED_FIELDS,
  sanitizeCandidateValue,
  isFallbackMarker,
  buildProfileAutofillCandidates,
  deriveIdentityStepState,
  deriveOnboardingJourney,
  getRegistrationJourney,
  getProfileAutofillCandidates,
  upsertRegistrationProfile,
};
