/**
 * V2 ownership-claim state contract.
 *
 * This is a pure workflow contract only. It owns no persistence and does not
 * establish legal ownership. A verified Passport claim means the governed
 * CarUp claim workflow was approved; external registry ownership remains a
 * separate authoritative fact/source.
 */

export const PASSPORT_CLAIM_STATES = Object.freeze({
  NOT_CLAIMED: 'not_claimed',
  PENDING: 'pending',
  EVIDENCE_REQUIRED: 'evidence_required',
  UNDER_REVIEW: 'under_review',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  DISPUTED: 'disputed',
  REVOKED: 'revoked',
});

const ALL_STATES = new Set(Object.values(PASSPORT_CLAIM_STATES));

const ALLOWED = Object.freeze({
  [PASSPORT_CLAIM_STATES.NOT_CLAIMED]: new Set([
    PASSPORT_CLAIM_STATES.PENDING,
  ]),
  [PASSPORT_CLAIM_STATES.PENDING]: new Set([
    PASSPORT_CLAIM_STATES.EVIDENCE_REQUIRED,
    PASSPORT_CLAIM_STATES.UNDER_REVIEW,
    PASSPORT_CLAIM_STATES.REJECTED,
  ]),
  [PASSPORT_CLAIM_STATES.EVIDENCE_REQUIRED]: new Set([
    PASSPORT_CLAIM_STATES.PENDING,
    PASSPORT_CLAIM_STATES.UNDER_REVIEW,
    PASSPORT_CLAIM_STATES.REJECTED,
  ]),
  [PASSPORT_CLAIM_STATES.UNDER_REVIEW]: new Set([
    PASSPORT_CLAIM_STATES.VERIFIED,
    PASSPORT_CLAIM_STATES.REJECTED,
    PASSPORT_CLAIM_STATES.DISPUTED,
  ]),
  [PASSPORT_CLAIM_STATES.VERIFIED]: new Set([
    PASSPORT_CLAIM_STATES.DISPUTED,
    PASSPORT_CLAIM_STATES.REVOKED,
  ]),
  [PASSPORT_CLAIM_STATES.REJECTED]: new Set([
    PASSPORT_CLAIM_STATES.PENDING,
  ]),
  [PASSPORT_CLAIM_STATES.DISPUTED]: new Set([
    PASSPORT_CLAIM_STATES.UNDER_REVIEW,
    PASSPORT_CLAIM_STATES.VERIFIED,
    PASSPORT_CLAIM_STATES.REVOKED,
  ]),
  [PASSPORT_CLAIM_STATES.REVOKED]: new Set([
    PASSPORT_CLAIM_STATES.PENDING,
  ]),
});

const REVIEW_DECISIONS = new Set([
  PASSPORT_CLAIM_STATES.VERIFIED,
  PASSPORT_CLAIM_STATES.REJECTED,
  PASSPORT_CLAIM_STATES.REVOKED,
]);

export function assertPassportClaimState(state) {
  if (!ALL_STATES.has(state)) throw new Error(`Unsupported Passport claim state: ${state}`);
  return state;
}

export function canTransitionPassportClaim(from, to) {
  assertPassportClaimState(from);
  assertPassportClaimState(to);
  return ALLOWED[from].has(to);
}

export function transitionPassportClaim(from, to, {
  actorId = null,
  reviewAuthority = false,
  reason = null,
  occurredAt = new Date().toISOString(),
} = {}) {
  assertPassportClaimState(from);
  assertPassportClaimState(to);

  if (!canTransitionPassportClaim(from, to)) {
    throw new Error(`Illegal Passport claim transition: ${from} -> ${to}`);
  }
  if (!actorId) {
    throw new Error('Passport claim transition requires an authenticated actor');
  }
  if (REVIEW_DECISIONS.has(to) && reviewAuthority !== true) {
    throw new Error(`Passport claim transition to ${to} requires review authority`);
  }
  if (to === PASSPORT_CLAIM_STATES.DISPUTED && !reason) {
    throw new Error('Passport claim dispute requires a reason');
  }

  return {
    event_type: 'passport_claim_state_changed',
    from,
    to,
    actor_id: actorId,
    reason,
    occurred_at: occurredAt,
    review_authority: reviewAuthority === true,
  };
}
