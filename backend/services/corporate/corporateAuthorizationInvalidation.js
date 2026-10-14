/**
 * CA-K3-AUTH-03 (Phase B core) — OD-CARBAC-020: a Corporate membership change invalidates any Corporate authorization decision or
 * cache derived from the previous state.
 *
 * Today nothing caches a Corporate decision (the Phase-A resolver reads corporate_memberships on every call, and the legacy bridge
 * does not consult it for admission), so this is a SEAM, not a cache: any future cache, session projection or shadow evaluator
 * subscribes here — and, for belt and braces, can key itself on `authorization_epoch`, the per-account count of lifecycle events
 * (view corporate_membership_authorization_epoch), which changes on every accepted mutation whether or not this process saw it.
 *
 * Semantics (frozen by tests):
 *  - fired once per ACCEPTED membership lifecycle mutation, after the database commit — never for a refused call, a recorded
 *    request, an approval, a cancellation or a refusal;
 *  - a listener that throws or rejects never undoes a committed mutation and never blocks the others; it is COUNTED and reported
 *    in the mutation result (failed > 0), so a caller can see that an invalidation did not land;
 *  - the event carries identity of the change only — no reason text, no token, no decision snapshot.
 */
export const AUTHORIZATION_INVALIDATION_CONTRACT = 'carup.corporate_authorization_invalidation.v1';

const listeners = new Set();

/** Subscribe. Returns the unsubscribe function. */
export function onCorporateAuthorizationInvalidated(listener) {
  if (typeof listener !== 'function') throw new TypeError('A listener must be a function.');
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test seam: remove every listener. */
export function clearCorporateAuthorizationListeners() { listeners.clear(); }

export function buildInvalidationEvent({ subjectUserId, membershipId, orgNodeId, operation, fromState, toState, requestId, eventSeq, authorizationEpoch, occurredAt = new Date().toISOString() }) {
  return Object.freeze({
    contract: AUTHORIZATION_INVALIDATION_CONTRACT,
    subject_user_id: subjectUserId,
    membership_id: membershipId,
    org_node_id: orgNodeId,
    operation,
    from_state: fromState ?? null,
    to_state: toState,
    request_id: requestId,
    event_seq: eventSeq,
    authorization_epoch: authorizationEpoch ?? null,
    // Suspension and end revoke Corporate authority at once; PENDING / ACTIVE grant none (a membership carries zero capability).
    authority_effect: toState === 'SUSPENDED' || toState === 'ENDED' ? 'DENY_IMMEDIATELY' : 'NO_CAPABILITY_GRANTED',
    occurred_at: occurredAt,
  });
}

/** Fan out to every listener. Never throws. Resolves { notified, failed }. */
export async function invalidateCorporateAuthorization(event) {
  let notified = 0;
  let failed = 0;
  for (const listener of [...listeners]) {
    try {
      await listener(event);
      notified += 1;
    } catch {
      failed += 1;
    }
  }
  return Object.freeze({ notified, failed });
}
