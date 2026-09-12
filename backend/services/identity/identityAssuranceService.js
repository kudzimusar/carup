/**
 * O2-X6 — the canonical identity-assurance projection (`identity_assurance.v1`).
 *
 * ONE consumer-safe answer to: "how strongly and how recently has CarUp
 * established this person's identity, and is that assurance currently
 * usable?" — DERIVED at read time from the authoritative X3 lifecycle
 * (`getCurrentIdentityLifecycle`, the single deriver of state + document-expiry
 * overlay) composed with the active verification-session phase. Nothing is
 * copied into domain tables; no `identity_verified` flag exists anywhere.
 *
 * LAWS (pinned by o2-x6 suites):
 *  - assurance ≠ authentication — X3 step-up still gates each action;
 *  - assurance grants NOTHING: not Seller Authority, not Dealer Compliance,
 *    not Vehicle Trust, not workbook eligibility;
 *  - history ≠ present: `historically_verified`/`verified_at` coexist with a
 *    current `reverification_required`;
 *  - freshness is honest: unknown stays unknown (`no_expiry_recorded`);
 *  - no raw identity artifacts leave this projection; `users.is_verified`
 *    (the EMAIL flag) is never read.
 */
import { supabase } from '../../db/supabase.js';
import { ValidationError } from '../../utils/errors.js';
import {
  getCurrentIdentityLifecycle,
  LIFECYCLE_STATES,
} from './identityLifecycleService.js';

export const IDENTITY_ASSURANCE_POLICY_VERSION = 'identity_assurance.v1';

export const ASSURANCE_LEVELS = Object.freeze({
  NOT_ESTABLISHED: 'not_established',
  PENDING: 'pending',
  ESTABLISHED: 'established',
  REVERIFICATION_REQUIRED: 'reverification_required',
  UNUSABLE: 'unusable',
});

export const FRESHNESS_STATES = Object.freeze({
  NOT_APPLICABLE: 'not_applicable',
  NO_EXPIRY_RECORDED: 'no_expiry_recorded',
  WITHIN_RECORDED_VALIDITY: 'within_recorded_validity',
  EXPIRED: 'expired',
});

// A session the PLATFORM currently owes an answer on. Subject-side phases
// (draft/captured/uploaded/retry_requested) are the journey's guidance, not a
// pending review.
export const PENDING_REVIEW_SESSION_STATUSES = Object.freeze([
  'ocr_pending', 'ocr_failed', 'pending_manual_review',
]);

const UNUSABLE_STATES = Object.freeze([
  LIFECYCLE_STATES.SUSPENDED,
  LIFECYCLE_STATES.COMPROMISED,
  LIFECYCLE_STATES.DISPUTED,
  LIFECYCLE_STATES.REVOKED,
]);

async function hasPendingReviewSession(client, userId) {
  // Plain eq + JS filter — the same chain shape every lifecycle read uses, so every
  // existing harness (and PostgREST) serves it identically.
  const { data, error } = await client
    .from('verification_sessions')
    .select('id, status')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data || []).some((row) => PENDING_REVIEW_SESSION_STATUSES.includes(String(row.status || '')));
}

function deriveAssuranceLevel(lifecycle, pendingReview) {
  const effective = lifecycle.effective_state;
  if (lifecycle.capability_bearing) return ASSURANCE_LEVELS.ESTABLISHED;
  if (effective === LIFECYCLE_STATES.REVERIFICATION_REQUIRED) return ASSURANCE_LEVELS.REVERIFICATION_REQUIRED;
  if (UNUSABLE_STATES.includes(effective)) return ASSURANCE_LEVELS.UNUSABLE;
  if (pendingReview) return ASSURANCE_LEVELS.PENDING;
  return ASSURANCE_LEVELS.NOT_ESTABLISHED;
}

function deriveFreshness(lifecycle) {
  if (!lifecycle.historically_approved) return FRESHNESS_STATES.NOT_APPLICABLE;
  const expiry = lifecycle.document_expiry || { recorded: false, expired: false };
  if (!expiry.recorded) return FRESHNESS_STATES.NO_EXPIRY_RECORDED;
  return expiry.expired ? FRESHNESS_STATES.EXPIRED : FRESHNESS_STATES.WITHIN_RECORDED_VALIDITY;
}

/**
 * The canonical projection. Consumers receive THIS shape and nothing more.
 */
export async function getIdentityAssurance(client = supabase, userId) {
  if (!userId) throw new ValidationError('userId is required.');
  const [lifecycle, pendingReview] = await Promise.all([
    getCurrentIdentityLifecycle(client, userId),
    hasPendingReviewSession(client, userId),
  ]);

  const assuranceLevel = deriveAssuranceLevel(lifecycle, pendingReview);
  return {
    subject_user_id: userId,
    policy_version: IDENTITY_ASSURANCE_POLICY_VERSION,
    evaluated_at: new Date().toISOString(),
    assurance_level: assuranceLevel,
    identity_state: lifecycle.effective_state,
    current_lifecycle_state: lifecycle.state,
    historically_verified: lifecycle.historically_approved,
    verified_at: lifecycle.approved_at || null,
    freshness_state: deriveFreshness(lifecycle),
    document_expiry: {
      recorded: Boolean(lifecycle.document_expiry?.recorded),
      expires_at: lifecycle.document_expiry?.expires_at || null,
    },
    reverification_required: lifecycle.effective_state === LIFECYCLE_STATES.REVERIFICATION_REQUIRED,
    usable_for_identity_gated_actions: lifecycle.capability_bearing === true,
    who_must_act: lifecycle.who_must_act,
    reason_code: lifecycle.reason_code || null,
    applicant_guidance: lifecycle.applicant_guidance || null,
    pending_review: pendingReview,
  };
}
