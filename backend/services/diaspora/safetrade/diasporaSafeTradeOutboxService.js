/**
 * SafeTrade transactional-outbox drainer (ST-3 item #1 — Issue #127).
 *
 * The outbox is written inside the same transaction as the state change it describes, so an event in
 * it is a fact: the transition definitely committed. This module is the other half — it takes those
 * facts and delivers them to their downstream handlers, exactly once each, with retries, backoff and
 * a dead-letter terminus.
 *
 * Three properties matter and none of them are optional:
 *
 *   · **No duplicate delivery under concurrency.** Claiming uses FOR UPDATE SKIP LOCKED plus a
 *     visibility lease (ledger #23), so two drainers partition the queue rather than both delivering
 *     the same event. A plain `SELECT ... WHERE status='pending'` would hand the same row to both.
 *
 *   · **No silent loss.** A handler that throws does not drop the event; it goes back with
 *     exponential backoff, and after the attempt ceiling it is dead-lettered where an operator can
 *     see it. "Failed and forgotten" is the failure mode the outbox exists to prevent, so it is the
 *     one thing this must never do.
 *
 *   · **No infinite retry.** A permanently poisonous event would otherwise consume the drainer
 *     forever and starve everything behind it.
 *
 * The drainer never moves money and never mutates domain state. It notifies. Anything with a money
 * effect goes through the authoritative transition RPC, not through here.
 */
import { resolveClient } from '../diasporaServiceUtils.js';

export const SAFETRADE_OUTBOX_TABLE = 'diaspora_safetrade_outbox';

export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  DISPATCHED: 'dispatched',
  FAILED: 'failed',
  DEAD_LETTERED: 'dead_lettered',
});

/** After this many attempts an event is dead-lettered rather than retried again. */
export const OUTBOX_MAX_ATTEMPTS = 5;
/** How long a claimed event stays invisible to other drainers. */
export const OUTBOX_LEASE_SECONDS = 60;

// ── Handler registry ─────────────────────────────────────────────────────────
// Handlers are registered by event type. An event with no registered handler is NOT an error and NOT
// a dead letter: it is dispatched as a no-op. Treating "nobody is listening yet" as a failure would
// fill the dead-letter queue with events that are working exactly as intended.
const handlers = new Map();

export function registerOutboxHandler(eventType, handler) {
  if (typeof handler !== 'function') throw new Error('An outbox handler must be a function');
  const list = handlers.get(eventType) || [];
  list.push(handler);
  handlers.set(eventType, list);
  return () => {
    const current = handlers.get(eventType) || [];
    handlers.set(eventType, current.filter((h) => h !== handler));
  };
}

/** Test seam — clears the registry between cases. */
export function __resetOutboxHandlers() {
  handlers.clear();
}

export function registeredEventTypes() {
  return Array.from(handlers.keys());
}

/**
 * Claim up to `limit` due events. Returns the claimed rows with their attempt count already
 * incremented, so an event that keeps crashing the drainer still walks toward its dead-letter
 * terminus instead of being retried forever.
 */
export async function claimOutboxEvents({
  limit = 20,
  leaseSeconds = OUTBOX_LEASE_SECONDS,
  now = null,
  supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase.rpc('diaspora_safetrade_outbox_claim_atomic', {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
    p_now: now,
  });
  if (error) throw new Error(`Failed to claim SafeTrade outbox events: ${error.message}`);
  return data || [];
}

/** Settle one claimed event: dispatched, backed off, or dead-lettered. */
export async function settleOutboxEvent({
  id,
  succeeded,
  error: failureReason = null,
  maxAttempts = OUTBOX_MAX_ATTEMPTS,
  now = null,
  supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase.rpc('diaspora_safetrade_outbox_settle_atomic', {
    p_id: id,
    p_succeeded: Boolean(succeeded),
    // Sanitized: a handler stack trace can carry payload fragments.
    p_error: failureReason ? String(failureReason).slice(0, 500) : null,
    p_max_attempts: maxAttempts,
    p_now: now,
  });
  if (error) throw new Error(`Failed to settle SafeTrade outbox event: ${error.message}`);
  return data || null;
}

/**
 * Drain one batch. Returns a summary rather than throwing on handler failure — one poisonous event
 * must not abort the batch and strand everything behind it.
 */
export async function drainOutboxBatch({
  limit = 20,
  leaseSeconds = OUTBOX_LEASE_SECONDS,
  maxAttempts = OUTBOX_MAX_ATTEMPTS,
  now = null,
  supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const claimed = await claimOutboxEvents({ limit, leaseSeconds, now, supabaseClient: supabase });

  const summary = { claimed: claimed.length, dispatched: 0, failed: 0, deadLettered: 0, noHandler: 0, results: [] };

  for (const event of claimed) {
    const registered = handlers.get(event.event_type) || [];
    try {
      if (registered.length === 0) {
        summary.noHandler += 1;
      } else {
        for (const handler of registered) {
          await handler(event);
        }
      }
      await settleOutboxEvent({ id: event.id, succeeded: true, maxAttempts, now, supabaseClient: supabase });
      summary.dispatched += 1;
      summary.results.push({ id: event.id, eventType: event.event_type, outcome: 'dispatched' });
    } catch (e) {
      const settled = await settleOutboxEvent({
        id: event.id, succeeded: false, error: e?.message, maxAttempts, now, supabaseClient: supabase,
      });
      const deadLettered = settled?.status === OUTBOX_STATUS.DEAD_LETTERED;
      if (deadLettered) summary.deadLettered += 1; else summary.failed += 1;
      summary.results.push({
        id: event.id,
        eventType: event.event_type,
        outcome: deadLettered ? 'dead_lettered' : 'retry_scheduled',
        // Sanitized for the operator view; never a raw stack.
        error: String(e?.message || 'handler failed').slice(0, 300),
      });
    }
  }
  return summary;
}

/**
 * Operator view of the outbox dead letters.
 *
 * The stored payload is deliberately NOT returned. It is written by the emitting transaction and can
 * carry references an operator console has no business exporting; the event type, timing, attempt
 * count and sanitized error are enough to triage and replay.
 */
export async function listOutboxDeadLetters({ tenantId = null, limit = 50, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(SAFETRADE_OUTBOX_TABLE)
    .select('id, tenant_id, transaction_id, milestone_id, event_type, status, attempts, last_error, created_at, next_attempt_at')
    .eq('status', OUTBOX_STATUS.DEAD_LETTERED)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200));
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list SafeTrade outbox dead letters: ${error.message}`);
  return (data || []).map((row) => ({
    ...row,
    payloadWithheld: true,
    payloadWithheldReason: 'Outbox payloads may reference participant data and are never returned to the console.',
  }));
}

/**
 * Operator backlog summary. `oldestPendingAgeSeconds` is the number that actually matters: a queue of
 * 3 events where the oldest is four hours old is a stalled drainer, and a count alone hides that.
 */
export async function outboxBacklogSummary({ tenantId = null, now = null, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(SAFETRADE_OUTBOX_TABLE)
    .select('id, status, attempts, created_at')
    .in('status', [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.FAILED, OUTBOX_STATUS.DEAD_LETTERED]);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to summarize the SafeTrade outbox: ${error.message}`);

  const rows = data || [];
  const clock = now ? Date.parse(now) : Date.now();
  const unsettled = rows.filter((r) => r.status !== OUTBOX_STATUS.DEAD_LETTERED);
  let oldest = null;
  for (const r of unsettled) {
    const t = Date.parse(r.created_at);
    if (!Number.isNaN(t) && (oldest === null || t < oldest)) oldest = t;
  }
  return {
    pending: rows.filter((r) => r.status === OUTBOX_STATUS.PENDING).length,
    retrying: rows.filter((r) => r.status === OUTBOX_STATUS.FAILED).length,
    deadLettered: rows.filter((r) => r.status === OUTBOX_STATUS.DEAD_LETTERED).length,
    oldestPendingAgeSeconds: oldest === null ? null : Math.max(0, Math.round((clock - oldest) / 1000)),
  };
}

/**
 * Replay a dead letter: reset it to pending so the next drain picks it up.
 *
 * Attempts are reset to zero deliberately. An operator replaying a dead letter has usually fixed the
 * underlying cause, and leaving the count at the ceiling would dead-letter it again on the first
 * transient blip.
 */
export async function replayDeadLetter({ id, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(SAFETRADE_OUTBOX_TABLE)
    .update({ status: OUTBOX_STATUS.PENDING, attempts: 0, next_attempt_at: null, last_error: null })
    .eq('id', id)
    .eq('status', OUTBOX_STATUS.DEAD_LETTERED)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to replay SafeTrade outbox event: ${error.message}`);
  return data || null;
}

// ── Aux-event builders ───────────────────────────────────────────────────────
// Callers pass these to the atomic RPCs. Keeping the shapes here means the emitting side and the
// draining side cannot drift apart, and every payload stays free of participant data by construction.

export const SAFETRADE_AUX_EVENTS = Object.freeze({
  DISPUTE_HOLD_PLACED: 'SAFETRADE_DISPUTE_HOLD_PLACED',
  DISPUTE_HOLD_FAILED: 'SAFETRADE_DISPUTE_HOLD_FAILED',
  DELIVERY_WINDOW_CLOSED: 'SAFETRADE_DELIVERY_WINDOW_CLOSED',
  DELIVERY_WINDOW_CHECK_BLOCKED: 'SAFETRADE_DELIVERY_WINDOW_CHECK_BLOCKED',
  REPUTATION_ELIGIBLE: 'SAFETRADE_REPUTATION_ELIGIBLE',
});

export function buildAuxEvent(eventType, payload = {}) {
  return { eventType, payload: sanitizeAuxPayload(payload) };
}

/**
 * Aux payloads carry operational facts, never identities. Ids of *our own* rows are fine — they are
 * meaningless without an authorized read. Participant identifiers, contact details and free text are
 * not, so only this allowlist survives.
 */
const AUX_PAYLOAD_ALLOWLIST = Object.freeze([
  'milestoneId', 'disputeId', 'confirmationId', 'holdReference', 'sandbox', 'alreadyHeld',
  'reasons', 'eligible', 'emittedAt', 'errorCode', 'idempotentReplay', 'windowEndsAt',
]);

export function sanitizeAuxPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const out = {};
  for (const key of AUX_PAYLOAD_ALLOWLIST) {
    if (payload[key] !== undefined && payload[key] !== null) out[key] = payload[key];
  }
  return out;
}
