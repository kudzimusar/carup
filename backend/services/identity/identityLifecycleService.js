import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { logAuditEvent } from '../auditLogger.js';
import {
  OPERATIONS_CAPABILITIES,
  hasOperationsCapability,
  isProvenSession,
} from '../operations/operationsAuthorizationService.js';
import { revokeSessionsForUser } from '../auth/sessionSecurityService.js';
import { ForbiddenError, ValidationError } from '../../utils/errors.js';

/**
 * O2-X3 (ported by OC-5C from PR #208) — the CURRENT identity lifecycle, layered over immutable 7C
 * history.
 *
 * OC-5C changes to the #208 version, each a defect it carried:
 *   - document expiry is an OBSERVATION only. It came from `ocr_result.additional_fields.expiry` —
 *     OCR output stored unconfirmed — and silently took identity capability away. Document
 *     Intelligence observes; the identity domain decides. Restrictive use of an OCR-read expiry is a
 *     recorded owner decision, not a default.
 *   - an approval lifts a restriction (suspended / disputed / compromised / reverification
 *     required) only with evidence SUBMITTED AFTER that restriction. #208 let approving any pending
 *     session — including one filed before the suspension — lift it.
 *   - a compromise revokes every live session BEFORE it is recorded. #208 recorded first, so a
 *     failed revocation left the sessions live and the transition table refused the retry.
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

/** States a verification approval may lift only with evidence submitted after the restriction. */
const RESTRICTED_STATES = new Set([
  LIFECYCLE_STATES.REVERIFICATION_REQUIRED,
  LIFECYCLE_STATES.SUSPENDED,
  LIFECYCLE_STATES.COMPROMISED,
  LIFECYCLE_STATES.DISPUTED,
]);

export function isLifecycleTransitionAllowed(fromState, nextState) {
  const allowed = TRANSITIONS[fromState];
  return Boolean(allowed && allowed.has(nextState));
}

/**
 * O2-X6 (OC-5C) — what the PERSON is told their identity status is. Subject-safe on purpose: the
 * internal state 'compromised' and reason codes such as SUSPECTED_ACCOUNT_TAKEOVER never reach them
 * (they would aid abuse, and they are CarUp's working hypotheses, not findings).
 */
export const SUBJECT_STATUS_LABELS = Object.freeze({
  [LIFECYCLE_STATES.VERIFIED]: 'verified',
  [LIFECYCLE_STATES.REVERIFICATION_REQUIRED]: 'needs re-verification',
  [LIFECYCLE_STATES.SUSPENDED]: 'on hold',
  [LIFECYCLE_STATES.COMPROMISED]: 'under security review',
  [LIFECYCLE_STATES.DISPUTED]: 'under review',
  [LIFECYCLE_STATES.REVOKED]: 'no longer verified',
  [LIFECYCLE_STATES.RECOVERED]: 'restored',
});

/**
 * O2-X2 (OC-5C) — the subject-facing status CODE that pairs with SUBJECT_STATUS_LABELS, for surfaces
 * that branch on a state (the applicant's own onboarding journey). The same rule: 'compromised' is never
 * shown to the person, and neither is a reason code.
 */
export const SUBJECT_STATUS_CODES = Object.freeze({
  [LIFECYCLE_STATES.VERIFIED]: 'verified',
  [LIFECYCLE_STATES.REVERIFICATION_REQUIRED]: 'reverification_required',
  [LIFECYCLE_STATES.SUSPENDED]: 'on_hold',
  [LIFECYCLE_STATES.COMPROMISED]: 'security_review',
  [LIFECYCLE_STATES.DISPUTED]: 'disputed',
  [LIFECYCLE_STATES.REVOKED]: 'revoked',
  [LIFECYCLE_STATES.RECOVERED]: 'restored',
});

/** { code, label } the person may see for a lifecycle state, or null for a state with no subject status. */
export function toSubjectIdentityStatus(state) {
  if (!state || !SUBJECT_STATUS_CODES[state]) return null;
  return { code: SUBJECT_STATUS_CODES[state], label: SUBJECT_STATUS_LABELS[state] };
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

/** A timestamp as epoch milliseconds, whether the client hands back an ISO string or a Date. */
function epochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (value === null || value === undefined || value === '') return Number.NaN;
  return Date.parse(String(value));
}

async function verificationSessionSubmittedAt(client, sessionId) {
  const { data, error } = await client
    .from('verification_sessions')
    .select('id, user_id, created_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
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
 * `effective_state` equals `state` (OC-5C): the #208 document-expiry overlay is reported as an
 * observation (`document_expiry`) and no longer moves the state — see the module header.
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

  // O2-X6: expiry facts are surfaced once, here — this service stays the ONLY deriver of
  // document-expiry truth (the assurance projection composes it). OC-5C: an OBSERVATION. The value
  // is OCR output that no reviewer confirmed, so it is reported as such and changes no state; an
  // expiry a reviewer confirms is the only kind that may one day restrict capability.
  const expiryMs = approved ? parseExpiry(approved?.ocr_result?.additional_fields?.expiry) : null;
  const documentExpiry = {
    recorded: expiryMs !== null,
    expires_at: expiryMs !== null ? new Date(expiryMs).toISOString() : null,
    expired: expiryMs !== null && expiryMs < Date.now(),
    source: expiryMs !== null ? 'ocr_observation' : null,
    reviewer_confirmed: false,
    affects_state: false,
  };

  const effectiveState = state;
  const derivedReasonCode = null;

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
    approved_at: approved?.reviewed_at || approved?.updated_at || null,
    document_expiry: documentExpiry,
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

  // Mandatory containment FIRST (OC-5C): a compromised identity must not leave privileged old
  // sessions usable. Revoking before recording means a failed revocation records nothing and the
  // transition can simply be retried; the reverse order left live sessions behind a recorded state
  // the transition table then refused to re-enter. Same governed action, audited, no token material.
  let revokedSessions = 0;
  if (nextState === LIFECYCLE_STATES.COMPROMISED) {
    const revocation = await revokeSessionsForUser(client, actor, {
      userId,
      scope: 'all',
      reason: `identity_lifecycle:${reasonCode}`,
      lifecycleEventId: null,
    }, { ...options, skipAudit: false });
    revokedSessions = revocation.revoked_count;
  }

  const { data: inserted, error } = await client
    .from('identity_lifecycle_events')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);

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

  // O2-X6 (ported by OC-5C) — the person is told, through Communications (which owns delivery).
  // Best-effort after the durable ledger row and its audit; a SAFE payload: a subject-facing status
  // label and the reason's applicant guidance. The internal state, the reason code and the
  // reviewer's note stay in the ledger.
  const reasonConfig = getLifecycleReasonConfig(reasonCode);
  await emitDomainEvent(null, 'identity.lifecycle.changed', {
    userId,
    recipientUserId: userId,
    status: SUBJECT_STATUS_LABELS[nextState] || 'updated',
    summary: reasonConfig?.applicantGuidance || '',
    whoMustAct: lifecycleToResponsibilityProjection(nextState),
    occurredAt: inserted?.created_at || new Date().toISOString(),
    schemaVersion: 'o2_event.v1',
  }, null).catch((err) => {
    console.warn('identity.lifecycle.changed outbox emit failed:', err.message);
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

  // Nothing to append when the identity already bears capability. Checked FIRST (OC-5C): the decision
  // recorder marks the session verified before it calls this hook, so a first approval already derives
  // 'verified' from that history — #208 checked the verified → verified transition before this rule
  // and so reported every first approval as a refusal.
  if (CAPABILITY_BEARING_STATES.includes(current.state) && !current.derived_reason_code) {
    return { event: null, state: current.state, noop: true };
  }

  // OC-5C: a restriction is lifted only by evidence submitted AFTER it was imposed. Otherwise
  // approving any pending session — one filed before a suspension, a dispute or a compromise —
  // silently undid that restriction.
  if (RESTRICTED_STATES.has(current.state)) {
    const [restriction, approvedSession] = await Promise.all([
      latestLedgerEvent(client, userId),
      verificationSessionSubmittedAt(client, sessionId),
    ]);
    if (!approvedSession || String(approvedSession.user_id) !== String(userId)) {
      throw new ForbiddenError('IDENTITY_LIFECYCLE_APPROVAL_REFUSED: the approved session belongs to someone else.');
    }
    const restrictedAt = epochMs(restriction?.created_at);
    const submittedAt = epochMs(approvedSession.created_at);
    if (!Number.isFinite(restrictedAt) || !Number.isFinite(submittedAt) || submittedAt <= restrictedAt) {
      throw new ForbiddenError(
        `IDENTITY_LIFECYCLE_APPROVAL_REFUSED: the approved evidence predates the '${current.state}' restriction; `
        + 'only evidence submitted after it can lift it.',
      );
    }
  }

  if (!isLifecycleTransitionAllowed(current.state, nextState)) {
    throw new ForbiddenError(
      `IDENTITY_LIFECYCLE_APPROVAL_REFUSED: a verification approval cannot move ${current.state} → ${nextState}; `
      + 'a revoked identity re-enters only through the governed reverification_required step.',
    );
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
  SUBJECT_STATUS_LABELS,
  SUBJECT_STATUS_CODES,
  toSubjectIdentityStatus,
  getLifecycleReasonConfig,
  isLifecycleTransitionAllowed,
  lifecycleToResponsibilityProjection,
  getCurrentIdentityLifecycle,
  listIdentityLifecycleEvents,
  transitionIdentityLifecycle,
  onVerificationApproved,
};
