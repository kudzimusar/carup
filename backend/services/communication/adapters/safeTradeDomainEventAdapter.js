/**
 * C1 — the one place where the SafeTrade emitter dialect becomes the canonical Communications
 * contract, and the one place that knows who a SafeTrade event is FOR.
 *
 * THE DEFECT THIS CLOSES
 *
 * Ten SafeTrade event types were subscribed in G9. All ten were emitted, none was ever delivered.
 * `queueFromDomainEvent` resolves a recipient from the payload and returns `[]` when it finds none,
 * and the two live SQL emitters build payloads that contain no principal at all:
 *
 *   issue164_transition_session_atomic   -> { transactionIntentId, vin, fromStatus, toStatus }
 *   issue164_record_payment_state_atomic -> { transactionIntentId, vin, paymentState, provider,
 *                                             settlementOperationKey }
 *
 * Staging proves it rather than implies it: 33 MARKETPLACE_* events exist and 0 SafeTrade
 * notifications have ever been queued. Worse, the drop is SILENT — the handler returns `[]` without
 * throwing, so the event worker marks the event `processed` and nothing is retried or dead-lettered.
 *
 * WHY THE WORK HAPPENS HERE AND NOWHERE ELSE
 *
 * A pure payload mapper cannot fix this, for two independent reasons:
 *
 *   1. The recipient is not in the payload and cannot be derived from it. It has to be READ from the
 *      canonical transaction session, which means a database lookup — something a rename table
 *      cannot do.
 *   2. For the payment-state events the canonical status is not in the payload either. The SQL
 *      computes `v_next_status` (captured -> funds_held, released -> settled) and then emits
 *      `p_normalized_status`, the PROVIDER dialect. `captured` and `released` are not describable
 *      SafeTrade stages; R4 refuses them, correctly.
 *
 * So this module is the single normalization boundary. Everything downstream — `referencePayloadFor`,
 * the policy table, the renderer, R4 — keeps speaking exactly one dialect and is unchanged.
 */

/** The ten subscribed R4 event types. Anything not in here is not ours and passes through. */
export const SAFETRADE_ADAPTED_EVENT_TYPES = Object.freeze(new Set([
  'MARKETPLACE_PAYMENT_INITIATED',
  'MARKETPLACE_INSPECTION_PENDING',
  'MARKETPLACE_RELEASE_APPROVED',
  'MARKETPLACE_TRANSACTION_DISPUTED',
  'MARKETPLACE_TRANSACTION_CANCELLED',
  'MARKETPLACE_TRANSACTION_FAILED',
  'MARKETPLACE_FUNDS_HELD',
  'MARKETPLACE_TRANSACTION_SETTLED',
  'MARKETPLACE_TRANSACTION_REFUNDED',
  'MARKETPLACE_PAYMENT_FAILED',
]));

/**
 * Provider payment dialect -> canonical SafeTrade session status.
 *
 * FROZEN AND PINNED. These five pairs are transcribed from the live
 * `issue164_record_payment_state_atomic` CASE, read out of the running database with
 * `pg_get_functiondef`, not inferred from the names:
 *
 *     v_next_status := CASE p_normalized_status
 *       WHEN 'captured'  THEN 'funds_held'
 *       WHEN 'released'  THEN 'settled'
 *       WHEN 'refunded'  THEN 'refunded'
 *       WHEN 'cancelled' THEN 'cancelled'
 *       WHEN 'failed'    THEN 'failed'
 *       ELSE v_from_status
 *     END;
 *
 * The ELSE branch performs no transition and produces MARKETPLACE_PAYMENT_RECONCILED, which is
 * deliberately not subscribed — so a subscribed payment event always carries one of these five.
 * A value outside the map is therefore a contract change in the SQL, and this adapter REFUSES it
 * rather than guessing a stage to describe. A test pins this map against the migration text so a
 * future divergence is a build failure, not a wrong Email.
 */
export const PROVIDER_PAYMENT_STATE_TO_SESSION_STATUS = Object.freeze({
  captured: 'funds_held',
  released: 'settled',
  refunded: 'refunded',
  cancelled: 'cancelled',
  failed: 'failed',
});

/** Why an event produced no canonical inputs. Named so a caller can log a fact, not a shrug. */
export const SAFETRADE_ADAPTER_REFUSALS = Object.freeze({
  NO_TRANSACTION_ID: 'safetrade_transaction_id_missing',
  SESSION_UNRESOLVED: 'safetrade_session_unresolved',
  STATUS_UNRESOLVED: 'safetrade_status_unresolved',
  NO_PARTICIPANTS: 'safetrade_no_canonical_participant',
});

const ROLES = Object.freeze({ BUYER: 'buyer', SELLER: 'seller' });

function trimmed(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

/**
 * The canonical transaction identifier.
 *
 * Both live emitters call it `transactionIntentId` and it is `escrow_trust_sessions.id` — NOT
 * `diaspora_safetrade_transactions.id`, which is a different entity with no `vin` column. The
 * snake_case spellings are accepted because a future emitter may use them; nothing else is guessed.
 */
export function safeTradeTransactionId(payload = {}) {
  return trimmed(payload.transactionIntentId)
    || trimmed(payload.transaction_intent_id)
    || trimmed(payload.transactionId)
    || trimmed(payload.transaction_id);
}

/**
 * The canonical session status this event represents, or null if it cannot be established.
 *
 * `toStatus` is already a canonical `escrow_trust_sessions.status` and is taken VERBATIM — it must
 * not be re-derived, because the session authority already decided it. `paymentState` is the
 * provider dialect and is translated through the frozen map above. `fromStatus` is deliberately
 * ignored: R4 states what is true now, and a "from" state invites a narrative nobody approved.
 */
export function canonicalSafeTradeStatus(payload = {}) {
  const toStatus = trimmed(payload.toStatus) || trimmed(payload.to_status);
  if (toStatus) return toStatus;

  const paymentState = trimmed(payload.paymentState) || trimmed(payload.payment_state);
  if (!paymentState) return null;
  return PROVIDER_PAYMENT_STATE_TO_SESSION_STATUS[paymentState.toLowerCase()] || null;
}

/**
 * Read the canonical participants from the transaction session.
 *
 * This is the ONLY permitted source. Not the VIN owner, not a listing seller fallback, not an email
 * address, not notification history, not message participants, not tenant membership. If the
 * session cannot be read, that is a refusal, not an invitation to substitute a weaker signal.
 */
async function readSessionParticipants(transactionId, repository) {
  if (!transactionId || !repository?.findOne) return null;
  const session = await repository
    .findOne('escrow_trust_sessions', { id: transactionId })
    .catch(() => null);
  if (!session) return null;
  return {
    vin: trimmed(session.vin),
    status: trimmed(session.status),
    tenantId: trimmed(session.tenant_id),
    buyerId: trimmed(session.buyer_id),
    sellerId: trimmed(session.seller_id),
  };
}

/**
 * Build the canonical, audience-safe payload for ONE recipient.
 *
 * `provider` and `settlementOperationKey` are DROPPED, not renamed. They are payment-provider and
 * internal settlement identifiers; `referencePayloadFor` exists to keep exactly that class of value
 * out of a forwardable Email, and today they are persisted verbatim inside
 * `notification_queue.payload.safe_payload`. Carrying them further because the emitter happened to
 * include them would be the opposite of the rule.
 *
 * `recipientUserId` is a ROUTING fact. It addresses a person and must never become content — the
 * same rule R5 follows for `vehicles.owner_id`.
 */
function canonicalPayloadFor({ recipientUserId, role, transactionId, vin, status }) {
  return {
    recipientUserId,
    // The recipient's role in the journey. Routing/audit only — R4 renders the stage, not the role.
    safetrade_recipient_role: role,
    // The shape `referencePayloadFor` already reads first, so nothing downstream learns a dialect.
    session: { transaction_intent_id: transactionId, vin, status },
    // Top-level fields `variablesForEvent` reads. Without these the in-app copy and the governed
    // template degrade to status:'updated', reference:'CarUp', escrow_id:'escrow'.
    status,
    currentStatus: status,
    publicReference: transactionId,
    escrowId: transactionId,
    vin,
  };
}

/**
 * Normalize one SafeTrade domain event into zero or more recipient-specific canonical inputs.
 *
 * Returns `null` when the event is not a SafeTrade event — the caller passes those through
 * untouched, so the other five subscribed families are bit-identical.
 *
 * Returns `{ events: [...], refused }` otherwise. An empty `events` array with a `refused` reason is
 * a deliberate, explicable non-delivery — never a guess and never a silent drop.
 */
export async function normalizeSafeTradeDomainEvent({ eventType, payload = {}, repository } = {}) {
  if (!SAFETRADE_ADAPTED_EVENT_TYPES.has(eventType)) return null;

  const transactionId = safeTradeTransactionId(payload);
  if (!transactionId) {
    return { events: [], refused: SAFETRADE_ADAPTER_REFUSALS.NO_TRANSACTION_ID, transactionId: null };
  }

  const session = await readSessionParticipants(transactionId, repository);
  if (!session) {
    return { events: [], refused: SAFETRADE_ADAPTER_REFUSALS.SESSION_UNRESOLVED, transactionId };
  }

  // The event's own status wins: it describes the transition that just happened. The session row is
  // only a fallback for a payload that carried none, and may already have moved on.
  const status = canonicalSafeTradeStatus(payload) || session.status;
  if (!status) {
    return { events: [], refused: SAFETRADE_ADAPTER_REFUSALS.STATUS_UNRESOLVED, transactionId };
  }

  const vin = trimmed(payload.vin) || session.vin;

  // Every one of the ten is a change of state on a journey both principals are party to, so both are
  // told. Where only one participant exists, only that one is addressed — the other is not invented.
  const recipients = [
    { recipientUserId: session.buyerId, role: ROLES.BUYER },
    { recipientUserId: session.sellerId, role: ROLES.SELLER },
  ].filter((r) => r.recipientUserId);

  if (!recipients.length) {
    return { events: [], refused: SAFETRADE_ADAPTER_REFUSALS.NO_PARTICIPANTS, transactionId };
  }

  // The same person may hold both roles on a test or self-dealing session. One human gets one
  // Email; sending twice because they occupy two slots would be a defect, not thoroughness.
  const seen = new Set();
  const events = [];
  for (const { recipientUserId, role } of recipients) {
    if (seen.has(recipientUserId)) continue;
    seen.add(recipientUserId);
    events.push({
      recipientUserId,
      role,
      tenantId: session.tenantId,
      payload: canonicalPayloadFor({ recipientUserId, role, transactionId, vin, status }),
    });
  }

  return { events, refused: null, transactionId, status };
}

export default normalizeSafeTradeDomainEvent;
