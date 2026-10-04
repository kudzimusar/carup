/**
 * Ledger intents — how a domain mutation that has ALREADY committed gets its event onto the hash-chained
 * ledger exactly once (OC-5A, RC1 residual finding D).
 *
 * A domain writes `ledger_event_intents` in the same transaction as its own change (for PartSentry:
 * `partsentry_record_service`). This module turns an intent into a ledger event through the ONE
 * canonical writer, `blockchainService.addEvent`, and nothing else. It never writes a ledger table
 * itself and never changes how the ledger hashes, signs or orders.
 *
 * Exactly once, without changing the ledger writer. `addEvent` is deliberately not idempotent for
 * ordinary events (Issue #158 persists an operation identity only at the terminal instant), so the
 * guarantee is built on the intent side:
 *   1. a claim is exclusive (`ledger_event_intents_claim`: SKIP LOCKED + a status change + a token);
 *   2. before writing, the claimant looks for an event whose payload already carries this intent's id
 *      — so a claimant that died AFTER writing the event but BEFORE marking the intent cannot cause a
 *      second event when the stale claim is taken over;
 *   3. completion and release are conditional on the claim token, so a superseded claimant cannot
 *      overwrite the state of the claimant that replaced it.
 * A failure is recorded on the intent (last_error, attempts, next_attempt_at with backoff) and the
 * intent stays pending. It is never dropped and never marked recorded without an event.
 */
import crypto from 'crypto';
import { supabase as defaultClient } from '../../db/supabase.js';
import { addEvent as canonicalAddEvent } from './blockchainService.js';
import { logger } from '../../utils/logger.js';

/** Must exceed the longest invocation that could hold a claim (Vercel caps a function well below this). */
export const LEDGER_INTENT_STALE_AFTER_SECONDS = 900;
const MAX_BACKOFF_SECONDS = 3600;

export function ledgerIntentBackoffSeconds(attempts) {
  return Math.min(MAX_BACKOFF_SECONDS, 30 * 2 ** Math.max(0, Number(attempts || 1) - 1));
}

/** A stored payload may arrive as an object, a JSON string, or (PostgREST JSONB of a string) a doubly encoded one. */
export function parseLedgerPayload(raw) {
  let value = raw;
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * The ledger event already written for this intent, if any. A read failure throws: "could not look"
 * must never be taken for "not there", or a re-claim would write a duplicate.
 */
export async function findRecordedLedgerEvent(client, intent) {
  const { data, error } = await client
    .from('blockchain_events')
    .select('id, payload')
    .eq('vin', intent.vin)
    .eq('event_type', intent.event_type);
  if (error) throw new Error(`ledger lookup failed: ${error.message}`);
  const hit = (data || []).find((row) => parseLedgerPayload(row.payload)?.ledgerIntentId === intent.id);
  return hit ? hit.id : null;
}

async function recordClaimedIntent(client, intent, claimToken, addEvent) {
  try {
    let ledgerEventId = await findRecordedLedgerEvent(client, intent);
    if (ledgerEventId == null) {
      const payload = parseLedgerPayload(intent.payload);
      if (!payload || payload.ledgerIntentId !== intent.id) {
        throw new Error('intent payload does not carry its own ledgerIntentId; refusing to write an untraceable event');
      }
      const written = await addEvent(intent.vin, intent.event_type, payload, 'SYSTEM_SIGNATURE', {
        operationId: intent.operation_id,
        signerId: intent.signer_id,
        client,
      });
      ledgerEventId = written?.id ?? null;
      if (ledgerEventId == null) throw new Error('the ledger writer returned no event id');
    }
    const { data: marked, error: markError } = await client
      .from('ledger_event_intents')
      .update({ status: 'recorded', ledger_event_id: ledgerEventId, recorded_at: new Date().toISOString(), claim_token: null, claimed_at: null, last_error: null })
      .eq('id', intent.id)
      .eq('claim_token', claimToken)
      .select('id');
    if (markError) {
      // The event exists; only the mark failed. The claim goes stale and the next claimant finds the
      // event (step 2) and marks it — so this is reported as recorded, which it is.
      logger.error('LEDGER', 'ledger intent recorded but its mark failed; a later drain will mark it', { intent_id: intent.id, code: markError.code || null });
    }
    return { id: intent.id, status: 'recorded', ledgerEventId, marked: Boolean(marked?.length) };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    const nextAttemptAt = new Date(Date.now() + ledgerIntentBackoffSeconds(intent.attempts) * 1000).toISOString();
    const { error: releaseError } = await client
      .from('ledger_event_intents')
      .update({ status: 'pending', claim_token: null, claimed_at: null, last_error: message, next_attempt_at: nextAttemptAt })
      .eq('id', intent.id)
      .eq('claim_token', claimToken);
    if (releaseError) {
      // Still not lost: the claim goes stale and is re-claimed after LEDGER_INTENT_STALE_AFTER_SECONDS.
      logger.error('LEDGER', 'ledger intent release failed; it will be re-claimed when its claim goes stale', { intent_id: intent.id, code: releaseError.code || null });
    }
    return { id: intent.id, status: 'pending', error: message, nextAttemptAt };
  }
}

/**
 * Claim and record due intents (or one named intent). Sequential on purpose: the ledger is a chain
 * per vin, and the canonical writer reads the tail before it appends.
 *
 * @returns {Promise<{ claimed: number, results: Array<{id: string, status: 'recorded'|'pending', ledgerEventId?: number, error?: string}> }>}
 */
export async function drainLedgerIntents({ client = defaultClient, intentId = null, limit = 10, addEvent = canonicalAddEvent } = {}) {
  const claimToken = crypto.randomUUID();
  const { data, error } = await client.rpc('ledger_event_intents_claim', {
    p_claim_token: claimToken,
    p_limit: limit,
    p_intent_id: intentId,
    p_stale_after_seconds: LEDGER_INTENT_STALE_AFTER_SECONDS,
  });
  if (error) throw new Error(`ledger intent claim failed: ${error.message}`);
  const intents = Array.isArray(data) ? data : (data ? [data] : []);
  const results = [];
  for (const intent of intents) {
    results.push(await recordClaimedIntent(client, intent, claimToken, addEvent));
  }
  return { claimed: intents.length, results };
}

/** The caller-facing state of one intent: 'recorded' (with its event) or 'pending'. Never a guess. */
export function ledgerStateOf(intent, attempt = null) {
  if (attempt?.status === 'recorded') return { status: 'recorded', intentId: intent.id, eventId: attempt.ledgerEventId };
  if (intent?.status === 'recorded' && intent.ledger_event_id != null) {
    return { status: 'recorded', intentId: intent.id, eventId: intent.ledger_event_id };
  }
  return { status: 'pending', intentId: intent?.id ?? null, ...(attempt?.error ? { lastError: attempt.error } : {}) };
}

/**
 * Record one intent now if it is not recorded yet — the inline path after a commit, and the retry path
 * when a client repeats a request. A failure here leaves the intent pending; it never fails the caller.
 */
export async function recordIntentNow(intent, { client = defaultClient, addEvent = canonicalAddEvent } = {}) {
  if (!intent?.id) return { status: 'pending', intentId: null };
  if (intent.status === 'recorded') return ledgerStateOf(intent);
  try {
    const { results } = await drainLedgerIntents({ client, intentId: intent.id, limit: 1, addEvent });
    if (results.length) return ledgerStateOf(intent, results[0]);
    // Not claimable right now: another claimant holds it, or it was recorded in the meantime.
    const { data: current } = await client.from('ledger_event_intents').select('id, status, ledger_event_id').eq('id', intent.id).maybeSingle();
    return ledgerStateOf(current || intent);
  } catch (error) {
    logger.error('LEDGER', 'inline ledger recording could not run; the intent stays pending', { intent_id: intent.id, message: String(error?.message || error).slice(0, 200) });
    return { status: 'pending', intentId: intent.id };
  }
}

/** How many intents are not yet on the ledger — for health/operations. `null` when unreadable. */
export async function countUnrecordedLedgerIntents(client = defaultClient) {
  try {
    const { count, error } = await client
      .from('ledger_event_intents')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'recorded');
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

export default {
  LEDGER_INTENT_STALE_AFTER_SECONDS,
  ledgerIntentBackoffSeconds,
  parseLedgerPayload,
  findRecordedLedgerEvent,
  drainLedgerIntents,
  ledgerStateOf,
  recordIntentNow,
  countUnrecordedLedgerIntents,
};
