import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import {
  OPERATIONS_CAPABILITIES,
  hasOperationsCapability,
  isProvenSession,
} from '../operations/operationsAuthorizationService.js';
import { revokeSessionsForUser } from '../auth/sessionSecurityService.js';
import { ForbiddenError, ValidationError } from '../../utils/errors.js';

/**
 * O2-X3 — the CURRENT identity lifecycle, layered over immutable 7C history.
 *
 * Two different questions, never collapsed:
 *   · PROOFING (7C, immutable): "approved at time T, using evidence E, by reviewer R" —
 *     this module NEVER updates a verification session;
 *   · CURRENT LIFECYCLE (this module): "may this person currently exercise
 *     identity-dependent capability?" — an append-only event ledger whose latest row IS the
 *     state, with a fallback to the historical approval when no row exists.
 *
 * The transition policy is server-owned and total: an unlisted from→to pair fails by name; a
 * subject can never move themselves to verified/recovered; a revoked identity accepts only the
 * governed step back into re-verification, so an OLD approval can never resurrect it; a
 * compromised identity revokes every live session in the same governed action.
 */

export const LIFECYCLE_POLICY_VERSION = 'identity_lifecycle.v1';

export const LIFECYCLE_STATES = Object.freeze({
  NOT_ESTABLISHED: 'not_established', // derived-only: never stored in the ledger
  VERIFIED: 'verified',
  REVERIFICATION_REQUIRED: 'reverification_required',
  SUSPENDED: 'suspended',
  COMPROMISED: 'compromised',
  DISPUTED: 'disputed',
  REVOKED: 'revoked',
  RECOVERED: 'recovered',
});

/** States in which identity-gated capability is currently available. */
export const CAPABILITY_BEARING_STATES = Object.freeze([
  LIFECYCLE_STATES.VERIFIED,
  LIFECYCLE_STATES.RECOVERED,
]);

export const LIFECYCLE_TRIGGERS = Object.freeze({
  REVIEWER_ACTION: 'reviewer_action',
  VERIFICATION_APPROVED: 'verification_approved',
  ACCOUNT_RECOVERY: 'account_recovery',
  SECURITY_EVENT: 'security_event',
  MATERIAL_IDENTITY_CHANGE: 'material_identity_change',
  DOCUMENT_EXPIRY_SWEEP: 'document_expiry_sweep',
});

/**
 * Reason vocabulary. `applicantGuidance` is what the subject may safely see — it never carries
 * internal security detail that would aid abuse.
 */
export const LIFECYCLE_REASON_CODES = Object.freeze({
  VERIFICATION_APPROVED: {
    code: 'VERIFICATION_APPROVED',
    applicantGuidance: 'Your identity is verified.',
  },
  REVERIFICATION_APPROVED: {
    code: 'REVERIFICATION_APPROVED',
    applicantGuidance: 'Your identity has been re-verified.',
  },
  DOCUMENT_EXPIRED: {
    code: 'DOCUMENT_EXPIRED',
    applicantGuidance: 'The identity document you verified with has expired. Please verify with a current document.',
  },
  SUSPECTED_ACCOUNT_TAKEOVER: {
    code: 'SUSPECTED_ACCOUNT_TAKEOVER',
    applicantGuidance: 'For your security, CarUp is reviewing this account. Contact support if you need help.',
  },
  SECURITY_REVIEW: {
    code: 'SECURITY_REVIEW',
    applicantGuidance: 'For your security, CarUp is reviewing this account.',
  },
  MATERIAL_IDENTITY_CHANGE: {
    code: 'MATERIAL_IDENTITY_CHANGE',
    applicantGuidance: 'Key account details changed, so identity re-verification is required.',
  },
  IDENTITY_DISPUTE: {
    code: 'IDENTITY_DISPUTE',
    applicantGuidance: 'A dispute about this identity is being reviewed by CarUp.',
  },
  DISPUTE_RESOLVED: {
    code: 'DISPUTE_RESOLVED',
    applicantGuidance: 'The dispute on this identity has been resolved.',
  },
  GOVERNANCE_REVOCATION: {
    code: 'GOVERNANCE_REVOCATION',
    applicantGuidance: 'This identity verification has been revoked by CarUp governance.',
  },
  SUSPENSION_LIFTED: {
    code: 'SUSPENSION_LIFTED',
    applicantGuidance: 'The hold on this identity has been lifted.',
  },
  RECOVERY_COMPLETE: {
    code: 'RECOVERY_COMPLETE',
    applicantGuidance: 'Account recovery is complete and your identity is restored.',
  },
});

export function getLifecycleReasonConfig(code) {
  return LIFECYCLE_REASON_CODES[code] || null;
}

/**
 * The governed transition table — total and closed. `from` includes the derived states a
 * ledgerless user can be in (not_established / verified-by-history). An unlisted pair is
 * refused BY NAME. Revoked deliberately allows only the step back into re-verification:
 * verification_approved is NOT accepted from revoked, so an old approval cannot resurrect it.
 */
const TRANSITIONS = Object.freeze({
  [LIFECYCLE_STATES.NOT_ESTABLISHED]: new Set([LIFECYCLE_STATES.VERIFIED]),
  [LIFECYCLE_STATES.VERIFIED]: new Set([
    LIFECYCLE_STATES.REVERIFICATION_REQUIRED,
    LIFECYCLE_STATES.SUSPENDED,
    LIFECYCLE_STATES.COMPROMISED,
    LIFECYCLE_STATES.DISPUTED,
    LIFECYCLE_STATES.REVOKED,
  ]),
  [LIFECYCLE_STATES.RECOVERED]: new Set([
    LIFECYCLE_STATES.REVERIFICATION_REQUIRED,
    LIFECYCLE_STATES.SUSPENDED,
    LIFECYCLE_STATES.COMPROMISED,
    LIFECYCLE_STATES.DISPUTED,
    LIFECYCLE_STATES.REVOKED,
  ]),
  [LIFECYCLE_STATES.REVERIFICATION_REQUIRED]: new Set([
    LIFECYCLE_STATES.VERIFIED,
    LIFECYCLE_STATES.RECOVERED,
    LIFECYCLE_STATES.SUSPENDED,
    LIFECYCLE_STATES.COMPROMISED,
    LIFECYCLE_STATES.REVOKED,
  ]),
  [LIFECYCLE_STATES.SUSPENDED]: new Set([
    LIFECYCLE_STATES.VERIFIED,
    LIFECYCLE_STATES.REVERIFICATION_REQUIRED,
    LIFECYCLE_STATES.REVOKED,
  ]),
  [LIFECYCLE_STATES.COMPROMISED]: new Set([
    LIFECYCLE_STATES.REVERIFICATION_REQUIRED,
    LIFECYCLE_STATES.RECOVERED,
    LIFECYCLE_STATES.SUSPENDED,
    LIFECYCLE_STATES.REVOKED,
  ]),
  [LIFECYCLE_STATES.DISPUTED]: new Set([
    LIFECYCLE_STATES.VERIFIED,
    LIFECYCLE_STATES.REVERIFICATION_REQUIRED,
    LIFECYCLE_STATES.REVOKED,
  ]),
  [LIFECYCLE_STATES.REVOKED]: new Set([
    LIFECYCLE_STATES.REVERIFICATION_REQUIRED,
  ]),
});

/**
 * States only the identity domain itself may enter, via the governed approval hook — a human
 * transition endpoint cannot mint them, and the SUBJECT can never reach them at all.
 */
const APPROVAL_ONLY_STATES = new Set([LIFECYCLE_STATES.VERIFIED, LIFECYCLE_STATES.RECOVERED]);

export function isLifecycleTransitionAllowed(fromState, nextState) {
  const allowed = TRANSITIONS[fromState];
  return Boolean(allowed && allowed.has(nextState));
}

/** who_must_act projection for lifecycle states — ADR vocabulary, derived, never persisted. */
export function lifecycleToResponsibilityProjection(state) {
  switch (state) {
    case LIFECYCLE_STATES.REVERIFICATION_REQUIRED: return 'subject_action';
    case LIFECYCLE_STATES.DISPUTED: return 'escalated';
    case LIFECYCLE_STATES.SUSPENDED:
    case LIFECYCLE_STATES.COMPROMISED: return 'carup_review';
    default: return 'none';
  }
}

function now() {
  return new Date().toISOString();
}

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Identity lifecycle audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

async function latestLedgerEvent(client, userId) {
  const { data, error } = await client
    .from('identity_lifecycle_events')
    .select('*')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  // seq is the ledger's monotonic order; created_at is a display fact. Two events can share a
  // millisecond, so "latest" must never fall back to a random-uuid tie-break.
  const rows = (data || []).slice().sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
  return rows[0] || null;
}

async function latestApprovedSession(client, userId) {
  const { data, error } = await client
    .from('verification_sessions')
    .select('id, status, document_type, ocr_result, reviewed_at, updated_at, created_at')
    .eq('user_id', userId)
    .eq('status', 'verified');
  if (error) throw new Error(error.message);
  const rows = (data || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows[0] || null;
}

function parseExpiry(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The CURRENT lifecycle for a user, derived: latest ledger row wins; a ledgerless user with a
 * historical approval is 'verified'; a ledgerless user without one is 'not_established'.
 *
 * `effective_state` additionally applies the DOCUMENT-EXPIRY overlay: where the approving
 * evidence carries a real, parseable expiry that has passed, a capability-bearing state
 * presents as reverification_required. This is derived truth — where no expiry exists none is
 * fabricated, and the ledger is untouched.
 */
export async function getCurrentIdentityLifecycle(client = supabase, userId) {
  if (!userId) throw new ValidationError('userId is required.');

  const [ledger, approved] = await Promise.all([
    latestLedgerEvent(client, userId),
    latestApprovedSession(client, userId),
  ]);

  const historicallyApproved = Boolean(approved);
  const state = ledger
    ? ledger.next_state
    : (historicallyApproved ? LIFECYCLE_STATES.VERIFIED : LIFECYCLE_STATES.NOT_ESTABLISHED);

  let effectiveState = state;
  let derivedReasonCode = null;
  if (CAPABILITY_BEARING_STATES.includes(state)) {
    const expiryMs = parseExpiry(approved?.ocr_result?.additional_fields?.expiry);
    if (expiryMs !== null && expiryMs < Date.now()) {
      effectiveState = LIFECYCLE_STATES.REVERIFICATION_REQUIRED;
      derivedReasonCode = LIFECYCLE_REASON_CODES.DOCUMENT_EXPIRED.code;
    }
  }

  const reasonCode = derivedReasonCode || ledger?.reason_code || null;
  const reason = reasonCode ? getLifecycleReasonConfig(reasonCode) : null;

  return {
    user_id: userId,
    state,
    effective_state: effectiveState,
    derived_reason_code: derivedReasonCode,
    reason_code: reasonCode,
    applicant_guidance: reason?.applicantGuidance
      || (effectiveState === LIFECYCLE_STATES.VERIFIED ? LIFECYCLE_REASON_CODES.VERIFICATION_APPROVED.applicantGuidance : null),
    who_must_act: lifecycleToResponsibilityProjection(effectiveState),
    capability_bearing: CAPABILITY_BEARING_STATES.includes(effectiveState),
    historically_approved: historicallyApproved,
    latest_approved_session_id: approved?.id || null,
    since: ledger?.created_at || approved?.reviewed_at || approved?.updated_at || null,
    ledger_event_id: ledger?.id || null,
    policy_version: LIFECYCLE_POLICY_VERSION,
  };
}

/** The full ledger for a user (governed reader — routes gate on capability). */
export async function listIdentityLifecycleEvents(client = supabase, userId) {
  const { data, error } = await client
    .from('identity_lifecycle_events')
    .select('*')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data || []).slice().sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
}

function assertReasonCode(reasonCode) {
  if (!reasonCode || !LIFECYCLE_REASON_CODES[reasonCode]) {
    throw new ValidationError(`Unknown identity lifecycle reason code: ${reasonCode || '(missing)'}.`);
  }
}

/**
 * Governed transition. Refusals, each by name:
 *  - unknown next state / reason code;
 *  - a from→to pair outside the policy table (incl. anything out of `revoked` except
 *    re-verification);
 *  - verified/recovered via this human endpoint at all — those are minted ONLY by the
 *    verification-approval hook, so no reviewer can hand-verify without evidence;
 *  - the subject acting on their own lifecycle;
 *  - an actor without the identity-lifecycle capability on a proven session.
 *
 * Ledger write → mandatory side effects (compromised ⇒ every live session revoked) → audit
 * (fail-closed, same discipline as the 7C writers).
 */
export async function transitionIdentityLifecycle(client = supabase, actor = {}, {
  userId,
  nextState,
  reasonCode,
  note = '',
  evidenceReference = null,
} = {}, options = {}) {
  if (!userId) throw new ValidationError('userId is required.');
  if (!Object.values(LIFECYCLE_STATES).includes(nextState) || nextState === LIFECYCLE_STATES.NOT_ESTABLISHED) {
    throw new ValidationError(`Unknown identity lifecycle state: ${nextState || '(missing)'}.`);
  }
  assertReasonCode(reasonCode);

  if (APPROVAL_ONLY_STATES.has(nextState)) {
    throw new ForbiddenError(
      `'${nextState}' is minted only by a governed verification approval — it cannot be set directly.`,
    );
  }

  const actorId = actor.id || actor.userId;
  if (!actorId) throw new ValidationError('Authenticated actor context is required.');
  if (String(actorId) === String(userId)) {
    throw new ForbiddenError('IDENTITY_LIFECYCLE_SELF_ACTION: you cannot change your own identity lifecycle.');
  }
  if (!isProvenSession(actor)) {
    throw new ForbiddenError('Identity lifecycle transitions require a proven session.');
  }
  if (!hasOperationsCapability(actor, OPERATIONS_CAPABILITIES.IDENTITY_LIFECYCLE)) {
    throw new ForbiddenError(`This action requires the '${OPERATIONS_CAPABILITIES.IDENTITY_LIFECYCLE}' capability.`);
  }

  const current = await getCurrentIdentityLifecycle(client, userId);
  if (!isLifecycleTransitionAllowed(current.state, nextState)) {
    throw new ValidationError(
      `IDENTITY_LIFECYCLE_INVALID_TRANSITION: ${current.state} → ${nextState} is not permitted by ${LIFECYCLE_POLICY_VERSION}.`,
    );
  }

  const row = {
    user_id: userId,
    previous_state: current.state,
    next_state: nextState,
    reason_code: reasonCode,
    trigger_source: LIFECYCLE_TRIGGERS.REVIEWER_ACTION,
    actor_kind: 'user',
    actor_user_id: actorId,
    actor_role: actor.platformRole || actor.baseRole || actor.role || null,
    policy_version: LIFECYCLE_POLICY_VERSION,
    evidence_reference: evidenceReference,
    note: String(note || '').slice(0, 2000) || null,
    created_at: now(),
  };

  const { data: inserted, error } = await client
    .from('identity_lifecycle_events')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Mandatory containment: a compromised identity must not leave privileged old sessions
  // usable. Same governed action, same audit trail, no token material recorded.
  let revokedSessions = 0;
  if (nextState === LIFECYCLE_STATES.COMPROMISED) {
    const revocation = await revokeSessionsForUser(client, actor, {
      userId,
      scope: 'all',
      reason: `identity_lifecycle:${reasonCode}`,
      lifecycleEventId: inserted.id,
    }, { ...options, skipAudit: false });
    revokedSessions = revocation.revoked_count;
  }

  await writeAudit(client, {
    req: options.req,
    event_type: 'IDENTITY_LIFECYCLE_TRANSITION',
    actor_user_id: actorId,
    actor_role: row.actor_role,
    actor_tenant_id: actor.tenantId,
    source_route: options.sourceRoute || '/api/admin/identity/lifecycle/:userId/transition',
    targetType: 'identity_lifecycle',
    targetId: userId,
    previous_value: { state: current.state },
    new_value: {
      state: nextState,
      reason_code: reasonCode,
      trigger_source: row.trigger_source,
      policy_version: LIFECYCLE_POLICY_VERSION,
      ledger_event_id: inserted.id,
      revoked_sessions: revokedSessions,
    },
    reason: reasonCode,
  });

  return { event: inserted, revoked_sessions: revokedSessions };
}

/**
 * The ONLY way verified/recovered are minted: the identity domain's own approval. Called by the
 * decision recorder after a durable APPROVE. From `compromised` the approval lands as
 * `recovered`; from `revoked` it is REFUSED — the governed path is revoked →
 * reverification_required (reviewer_action) first, so an old approval can never silently
 * resurrect a revoked identity (the recorder treats that refusal as best-effort: the historical
 * approval itself stands untouched either way).
 */
export async function onVerificationApproved(client = supabase, {
  userId,
  sessionId,
  reviewerId,
  reviewerRole = null,
} = {}, options = {}) {
  if (!userId || !sessionId || !reviewerId) {
    throw new ValidationError('userId, sessionId and reviewerId are required.');
  }

  const current = await getCurrentIdentityLifecycle(client, userId);
  const nextState = current.state === LIFECYCLE_STATES.COMPROMISED
    ? LIFECYCLE_STATES.RECOVERED
    : LIFECYCLE_STATES.VERIFIED;

  if (!isLifecycleTransitionAllowed(current.state, nextState)) {
    throw new ForbiddenError(
      `IDENTITY_LIFECYCLE_APPROVAL_REFUSED: a verification approval cannot move ${current.state} → ${nextState}; `
      + 'a revoked identity re-enters only through the governed reverification_required step.',
    );
  }
  // A no-op re-approval on an already capability-bearing state appends nothing.
  if (CAPABILITY_BEARING_STATES.includes(current.state) && !current.derived_reason_code) {
    return { event: null, state: current.state, noop: true };
  }

  const reasonCode = current.state === LIFECYCLE_STATES.NOT_ESTABLISHED
    ? LIFECYCLE_REASON_CODES.VERIFICATION_APPROVED.code
    : (nextState === LIFECYCLE_STATES.RECOVERED
      ? LIFECYCLE_REASON_CODES.RECOVERY_COMPLETE.code
      : LIFECYCLE_REASON_CODES.REVERIFICATION_APPROVED.code);

  const row = {
    user_id: userId,
    previous_state: current.state,
    next_state: nextState,
    reason_code: reasonCode,
    trigger_source: LIFECYCLE_TRIGGERS.VERIFICATION_APPROVED,
    actor_kind: 'user',
    actor_user_id: reviewerId,
    actor_role: reviewerRole,
    policy_version: LIFECYCLE_POLICY_VERSION,
    evidence_reference: sessionId,
    note: null,
    created_at: now(),
  };

  const { data: inserted, error } = await client
    .from('identity_lifecycle_events')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await writeAudit(client, {
    req: options.req,
    event_type: 'IDENTITY_LIFECYCLE_TRANSITION',
    actor_user_id: reviewerId,
    actor_role: reviewerRole,
    source_route: options.sourceRoute || `/api/admin/identity/verification-sessions/${sessionId}/review`,
    targetType: 'identity_lifecycle',
    targetId: userId,
    previous_value: { state: current.state },
    new_value: {
      state: nextState,
      reason_code: reasonCode,
      trigger_source: row.trigger_source,
      policy_version: LIFECYCLE_POLICY_VERSION,
      ledger_event_id: inserted.id,
      evidence_reference: sessionId,
    },
    reason: reasonCode,
  });

  return { event: inserted, state: nextState, noop: false };
}

export default {
  LIFECYCLE_POLICY_VERSION,
  LIFECYCLE_STATES,
  CAPABILITY_BEARING_STATES,
  LIFECYCLE_TRIGGERS,
  LIFECYCLE_REASON_CODES,
  getLifecycleReasonConfig,
  isLifecycleTransitionAllowed,
  lifecycleToResponsibilityProjection,
  getCurrentIdentityLifecycle,
  listIdentityLifecycleEvents,
  transitionIdentityLifecycle,
  onVerificationApproved,
};
