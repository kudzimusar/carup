/**
 * Trade OS T9.4 — telling the customer their cargo arrived.
 *
 * The CONSUMER half only, exactly like `containerBookingNotifier`, `logisticsLifecycleNotifier` and
 * `shipmentExceptionNotifier`. It runs after the authoritative intake row has committed and been
 * audited:
 *
 *   authorized receiving action → intake row → audit → outbox event → governed template → notice
 *
 * The direction is one-way and load-bearing. **A notification never creates warehouse state.**
 * Nothing here writes an intake, a condition or a measurement, and a delivery failure can no more
 * un-receive cargo than a successful one can receive it. If the outbox is down, the cargo is still
 * in the warehouse and the record still says so.
 *
 * Idempotency lives upstream, where it belongs: `receiveIntake` returns early on an already-received
 * intake without calling any of this, so a retried HTTP request produces one arrival and one notice.
 * The outbox dedupe key carries the intake id as a second line of defence.
 *
 * Privacy: the payload carries the reference, the outcome and — where the customer needs it to act —
 * the receiver's stated reason. It never carries warehouse staff identities, internal notes,
 * evidence paths, tenant identifiers, or anything about another participant's cargo.
 */
import { emitDomainEvent } from '../eventBus/eventBusService.js';

export const WAREHOUSE_EVENTS = Object.freeze({
  RECEIVED: 'diaspora.warehouse.cargo_received',
  CONDITION: 'diaspora.warehouse.condition_issue',
  DISCREPANCY: 'diaspora.warehouse.measurement_discrepancy',
});

/**
 * What the customer is told about the outcome, in the customer's terms.
 *
 * "Conditionally received" is warehouse language. What a person needs to know is that their goods
 * are in the building and somebody wrote something down about them.
 */
const OUTCOME_SENTENCE = Object.freeze({
  RECEIVED: 'Your cargo has been received at the warehouse.',
  CONDITIONALLY_RECEIVED: 'Your cargo has been received, with something noted about its condition.',
  REFUSED: 'The warehouse was not able to take your cargo in.',
});

function subjectLabel(subject) {
  return subject?.type === 'cargo_reservation' ? 'container booking' : 'shipping request';
}

/**
 * Send one notice per distinct owner.
 *
 * The event type is passed as a LITERAL at each call site below rather than threaded through here as
 * a variable. That is deliberate: `communication-event-coverage` scans for
 * `emit…Event(null, '<type>', …)` and a subscription whose emitter it cannot see is a subscription
 * that looks alive and is dead. The same shape bit T7. Keep the literals.
 *
 * De-duplicating the recipients matters for the ordinary case, not an exotic one: buyer_id and
 * created_by are usually the same person, and telling them twice about one arrival is wrong.
 */
async function forEachOwner(recipients, send) {
  const unique = [...new Set((recipients || []).filter(Boolean).map(String))];
  const sent = [];
  for (const recipientUserId of unique) {
    try {
      // Best-effort by design: the intake is already durable and audited, and an outbox failure must
      // never roll it back or mask it.
      sent.push(await send(recipientUserId));
    } catch (err) {
      console.warn('[warehouse-intake] outbox emit failed:', err.message);
    }
  }
  return sent;
}

/** Cargo arrived (or did not). One notice per owner, per physical receipt. */
export async function notifyCargoReceived({ intake, subject, recipients, outcome, reason = null, emitEvent = emitDomainEvent }) {
  if (!intake?.id) return [];
  return forEachOwner(recipients, (recipientUserId) => emitEvent(null, 'diaspora.warehouse.cargo_received', {
    recipientUserId,
    intakeId: intake.id,
    reference: intake.reference,
    subjectType: subject?.type || intake.subject_type,
    subjectId: subject?.id || intake.subject_id,
    outcome: String(outcome || intake.status).toUpperCase(),
    headline: OUTCOME_SENTENCE[String(outcome || intake.status).toUpperCase()] || OUTCOME_SENTENCE.RECEIVED,
    // The receiver's own words, when they gave any. Never invented, and only present when the
    // outcome was something the customer has to act on.
    reason: reason || null,
    subject_label: subjectLabel(subject),
    subject_type: 'diaspora_warehouse_intake',
  }, intake.tenant_id ?? null));
}

/**
 * Something was wrong with the cargo.
 *
 * Carries the receiver's bounded observation and nothing more. It makes no insurance claim, no
 * liability finding and no Trust judgement — T14 owns Trust and no phase owns the first two.
 */
export async function notifyConditionIssue({ intake, subject, recipients, condition, emitEvent = emitDomainEvent }) {
  if (!intake?.id || !condition || condition === 'good') return [];
  return forEachOwner(recipients, (recipientUserId) => emitEvent(null, 'diaspora.warehouse.condition_issue', {
    recipientUserId,
    intakeId: intake.id,
    reference: intake.reference,
    subjectType: subject?.type || intake.subject_type,
    subjectId: subject?.id || intake.subject_id,
    condition,
    headline: 'The warehouse noted the condition of your cargo when it arrived.',
    // Said in the payload so no template can turn an observation into a verdict.
    observation_only: true,
    subject_type: 'diaspora_warehouse_intake',
  }, intake.tenant_id ?? null));
}

/**
 * The cargo is not the size it was booked as.
 *
 * A FACT and only a fact. There is no amount in this payload and no adjustment: T9 says the cargo is
 * 0.8 CBM larger than the estimate, and whether that costs anything is a T6 commercial action a
 * person has to actually take.
 */
export async function notifyMeasurementDiscrepancy({ intake, subject, recipients, discrepancy, emitEvent = emitDomainEvent }) {
  if (!intake?.id || discrepancy?.status !== 'DIFFERS') return [];
  return forEachOwner(recipients, (recipientUserId) => emitEvent(null, 'diaspora.warehouse.measurement_discrepancy', {
    recipientUserId,
    intakeId: intake.id,
    reference: intake.reference,
    subjectType: subject?.type || intake.subject_type,
    subjectId: subject?.id || intake.subject_id,
    volume: discrepancy.volume || null,
    weight: discrepancy.weight || null,
    headline: 'The warehouse measured your cargo and it differs from the estimate.',
    commercial_effect: 'none',
    advisory_only: true,
    subject_type: 'diaspora_warehouse_intake',
  }, intake.tenant_id ?? null));
}
