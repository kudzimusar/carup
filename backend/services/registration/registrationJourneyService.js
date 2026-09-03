import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import {
  normalizeRegistrationProfile,
} from '../auth/registrationProfileService.js';
import {
  WORKFLOW_PHASE,
  legacyStatusToPhase,
  toResponsibilityProjection,
} from '../identity/caseWorkflow.js';
import { getReasonConfig } from '../identity/reasonCodes.js';
import { getLatestVerificationSessionForUser } from '../identity/verificationSessionService.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * O2-X2 — Registration journey, OCR autofill candidates, Progressive Trust ladder.
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
 * trusted from client labels. OCR provenance itself stays where 7C keeps it
 * (`verification_ocr_provenance` + the session), separate from confirmed profile data.
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

/**
 * Build the applicant-facing autofill candidates from THEIR latest (sanitized) session.
 * Every field carries an explicit state; absent or marker values are `missing` with no
 * value key at all, so a fallback can never be rendered — or confirmed — as data.
 */
export function buildProfileAutofillCandidates(latestSession) {
  if (!latestSession || !latestSession.ocr_result || typeof latestSession.ocr_result !== 'object') {
    return {
      available: false,
      reason: latestSession
        ? 'Extraction has not completed for your current verification session.'
        : 'No identity verification session exists yet.',
      document_fields: {},
      profile_candidates: {},
    };
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
      extraction_provider_recorded: true, // full provenance lives in verification_ocr_provenance
      confidence_score: latestSession.confidence_score ?? null,
      extraction_trust_status: latestSession.extraction_trust_status || null,
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
  if (status === 'ocr_failed' || status === 'pending_manual_review') return 'in_review';
  const phase = sessionPhase(session);
  if (phase === WORKFLOW_PHASE.ESCALATED) return 'in_review';
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
    return session.retry_reason ? `${guidance} Reviewer note: ${session.retry_reason}` : guidance;
  }
  if (state === 'processing') return 'CarUp is processing your documents. You can keep using safe features meanwhile.';
  if (state === 'in_review') return 'A CarUp reviewer will check your documents. No action is needed from you right now.';
  if (state === 'approved') return 'Your identity is verified.';
  if (state === 'rejected') {
    return session.failure_reason
      || 'Your verification was closed by a reviewer. Contact CarUp support to reopen it.';
  }
  if (state === 'ready_to_submit') return 'All images are uploaded — submit them for verification.';
  if (state === 'capturing' || state === 'draft') return 'Finish uploading your document images and selfie.';
  return 'Continue your identity verification when you are ready.';
}

/**
 * The Progressive Trust ladder. Purely derived from authoritative states already owned
 * elsewhere; performing NO reads of Seller Authority, Dealer Compliance, vehicle
 * registration or Trust — those stages are always reported as locked-by-their-own-
 * authority from here, because this surface cannot and must not answer for them.
 */
export function deriveOnboardingJourney({ user = {}, profile = null, latestSession = null } = {}) {
  const identityState = deriveIdentityStepState(latestSession);
  const identityApproved = identityState === 'approved';
  const identityActive = Boolean(latestSession) && !TERMINAL_PHASES.has(sessionPhase(latestSession)) && identityState !== 'rejected';
  const contextEstablished = Boolean(profile);

  const phase = sessionPhase(latestSession);
  const identityWhoMustAct = latestSession
    ? toResponsibilityProjection(phase)
    : 'subject_action';

  // Journey-level responsibility: the applicant's outstanding step, else the review
  // team's, else none. Uses ONLY the ADR vocabulary, derived at read time (P2 law).
  let whoMustAct = 'none';
  if (!contextEstablished || !latestSession || identityWhoMustAct === 'subject_action') {
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
    locked.push({
      capability: 'present_as_identity_verified',
      locked_by: 'identity_decision',
      reason: 'A governed reviewer decision is required; OCR extraction alone never verifies.',
    });
    locked.push({
      capability: 'sensitive_financial_actions',
      locked_by: 'identity_decision',
      reason: 'Requires verified identity, then each service’s own checks.',
    });
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
        who_must_act: latestSession ? identityWhoMustAct : 'subject_action',
        guidance: applicantGuidance(latestSession),
      },
    },
    who_must_act: whoMustAct,
    next_actor: nextActorByProjection[whoMustAct] || 'none',
    required_action: applicantGuidance(latestSession),
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
    .select('id, name, email, phone, location, is_verified, join_date')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function getRegistrationJourney(client = supabase, actor = {}) {
  const userId = requireUserId(actor);
  const [user, profile, latestSession] = await Promise.all([
    fetchOwnUserRow(client, userId),
    fetchOwnProfile(client, userId),
    getLatestVerificationSessionForUser(client, { id: userId }),
  ]);

  const journey = deriveOnboardingJourney({ user: user || {}, profile, latestSession });
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

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Registration audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

/**
 * Create or update the caller's OWN registration profile with USER-SUBMITTED values.
 *
 * Refusals (fail-closed):
 *  - any submitted text field equal to a fallback marker — a marker is not data;
 *  - unknown candidate field names or oversized candidate values;
 *  - the signup contract's own validation (vocabularies, acknowledgements, business rules).
 *
 * Preservation on update: the ORIGINAL terms/privacy acknowledgement instants survive
 * (they are a legal record of when the person agreed), and a business profile's
 * onboarding_status never regresses from a reviewed state back to 'requested'.
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
  const timestamp = new Date().toISOString();

  const row = { ...profile, user_id: userId, updated_at: timestamp };
  if (existing) {
    // The original acknowledgement instants are the legal record; an update never
    // re-stamps them.
    row.terms_acknowledged_at = existing.terms_acknowledged_at;
    row.privacy_acknowledged_at = existing.privacy_acknowledged_at;
    if (
      existing.account_kind === 'business' && profile.account_kind === 'business'
      && existing.onboarding_status && existing.onboarding_status !== 'not_required'
    ) {
      row.onboarding_status = existing.onboarding_status;
    }
  }

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

  await writeAudit(client, {
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
      field_provenance: fieldProvenance,
      candidate_fields_shown: Object.keys(candidatesSeen),
    },
  });

  return { profile: saved, field_provenance: fieldProvenance };
}

export default {
  FIELD_STATE,
  sanitizeCandidateValue,
  isFallbackMarker,
  buildProfileAutofillCandidates,
  deriveIdentityStepState,
  deriveOnboardingJourney,
  getRegistrationJourney,
  getProfileAutofillCandidates,
  upsertRegistrationProfile,
};
