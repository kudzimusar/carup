/**
 * Vehicle Passport V7 ownership-transfer lifecycle contract.
 *
 * Pure state machine only. It does not persist transfers or establish legal
 * ownership. Completion requires an upstream governed authority to supply the
 * registry/ownership fact that satisfies the final transition.
 */

export const PASSPORT_TRANSFER_STATES = Object.freeze({
  NOT_STARTED: 'not_started',
  INITIATED: 'initiated',
  AWAITING_PARTIES: 'awaiting_parties',
  EVIDENCE_REQUIRED: 'evidence_required',
  UNDER_REVIEW: 'under_review',
  TRANSACTION_COMPLETE: 'transaction_complete',
  REGISTRY_PENDING: 'registry_pending',
  COMPLETE: 'complete',
  DISPUTED: 'disputed',
  CANCELLED: 'cancelled',
});

const STATES = new Set(Object.values(PASSPORT_TRANSFER_STATES));

const ALLOWED = Object.freeze({
  not_started: new Set(['initiated']),
  initiated: new Set(['awaiting_parties', 'evidence_required', 'under_review', 'cancelled', 'disputed']),
  awaiting_parties: new Set(['evidence_required', 'under_review', 'cancelled', 'disputed']),
  evidence_required: new Set(['under_review', 'cancelled', 'disputed']),
  under_review: new Set(['transaction_complete', 'registry_pending', 'complete', 'evidence_required', 'disputed', 'cancelled']),
  transaction_complete: new Set(['registry_pending', 'complete', 'disputed']),
  registry_pending: new Set(['complete', 'disputed']),
  complete: new Set(['disputed']),
  disputed: new Set(['under_review', 'complete', 'cancelled']),
  cancelled: new Set(['initiated']),
});

export function assertPassportTransferState(state) {
  if (!STATES.has(state)) throw new Error(`Unsupported Passport transfer state: ${state}`);
  return state;
}

export function canTransitionPassportTransfer(from, to, {
  previouslyCompleted = false,
} = {}) {
  assertPassportTransferState(from);
  assertPassportTransferState(to);
  if (previouslyCompleted && to === PASSPORT_TRANSFER_STATES.CANCELLED) return false;
  return ALLOWED[from].has(to);
}

export function transitionPassportTransfer(from, to, {
  actorId = null,
  reason = null,
  registryAuthorityConfirmed = false,
  previouslyCompleted = false,
  occurredAt = new Date().toISOString(),
} = {}) {
  if (!canTransitionPassportTransfer(from, to, { previouslyCompleted })) {
    throw new Error(`Illegal Passport transfer transition: ${from} -> ${to}`);
  }
  if (!actorId) throw new Error('Passport transfer transition requires an authenticated actor');
  if (to === PASSPORT_TRANSFER_STATES.DISPUTED && !reason) {
    throw new Error('Passport transfer dispute requires a reason');
  }
  if (to === PASSPORT_TRANSFER_STATES.COMPLETE && registryAuthorityConfirmed !== true) {
    throw new Error('Passport transfer completion requires governed ownership/registry confirmation');
  }

  return {
    event_type: 'passport_ownership_transfer_state_changed',
    from,
    to,
    actor_id: actorId,
    reason,
    registry_authority_confirmed: registryAuthorityConfirmed === true,
    occurred_at: occurredAt,
  };
}

export function transferAccessState({
  transferState,
  relationship,
} = {}) {
  assertPassportTransferState(transferState);

  if (relationship === 'governance') {
    return { passport_owner_access: true, transfer_action_access: true };
  }

  if (transferState === PASSPORT_TRANSFER_STATES.COMPLETE) {
    return {
      passport_owner_access: relationship === 'new_owner',
      transfer_action_access: relationship === 'new_owner',
    };
  }

  if (transferState === PASSPORT_TRANSFER_STATES.DISPUTED) {
    return {
      passport_owner_access: relationship === 'current_owner',
      transfer_action_access: relationship === 'current_owner' || relationship === 'incoming_owner',
    };
  }

  return {
    passport_owner_access: relationship === 'current_owner',
    transfer_action_access: relationship === 'current_owner' || relationship === 'incoming_owner',
  };
}
