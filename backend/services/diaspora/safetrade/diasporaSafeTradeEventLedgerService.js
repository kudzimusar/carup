/**
 * SafeTrade durable provider-event ledger (ST-3 item 4 — Issue #127).
 *
 * Replaces the process-memory `new Set()` de-duplication that used to live in
 * diasporaSafeTradeRoutes.js. That set was per-process and per-deploy: on Vercel's Fluid Compute every
 * instance had its own copy, so the SAME provider event could be processed once per instance, and a
 * redeploy reset the memory entirely — a duplicate delivery hours later would be processed as if it
 * were new. The de-duplication key now lives in Postgres, where UNIQUE (provider, event_id) makes the
 * INSERT itself the concurrency-safe claim: two instances racing the same event, one wins, the loser
 * gets 23505 and answers an idempotent no-op.
 *
 * Out-of-order delivery is handled explicitly rather than ignored. Providers retry, and retries can
 * overtake: a `hold.authorized` emitted at T1 can arrive AFTER a `release.succeeded` emitted at T2.
 * Applying it would walk the ledger backwards. When a newly-claimed event is older than the newest
 * already-applied event for the same intent, it is recorded and marked `superseded` — durable and
 * auditable, but never applied.
 *
 * This module NEVER moves money. It records what a provider claims happened; the authoritative ledger
 * is advanced only by the atomic transition RPC.
 */
import { resolveClient } from '../diasporaServiceUtils.js';

export const SAFETRADE_EVENTS_TABLE = 'diaspora_safetrade_provider_events';

export const EVENT_STATUS = Object.freeze({
  RECEIVED: 'received',
  APPLIED: 'applied',
  SUPERSEDED: 'superseded',
  DEAD_LETTERED: 'dead_lettered',
  IGNORED: 'ignored',
});

/** Postgres unique-violation. Supabase surfaces it as `code`, node-postgres as `code` too. */
const UNIQUE_VIOLATION = '23505';

/**
 * Payload redaction. A provider webhook body can carry customer names, emails, addresses, card
 * fingerprints and the provider's own secrets. None of that belongs in our ledger: we keep only the
 * fields we actually reconcile against. Anything not on this allowlist is dropped — a denylist would
 * silently pass through every new field the provider adds later.
 */
const PAYLOAD_ALLOWLIST = Object.freeze([
  'id', 'event_id', 'type', 'event_type', 'created', 'occurred_at', 'sequence',
  'intentId', 'intent_id', 'status', 'amount', 'currency', 'capturedAmount', 'refundedAmount',
  'holdRef', 'captureRef', 'releaseRef', 'refundRef', 'reason', 'live',
]);

export function redactEventPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const out = {};
  for (const key of PAYLOAD_ALLOWLIST) {
    if (payload[key] !== undefined && payload[key] !== null) out[key] = payload[key];
  }
  // `data` is the common nesting used by providers; recurse ONE level with the same allowlist.
  if (payload.data && typeof payload.data === 'object') {
    const nested = {};
    for (const key of PAYLOAD_ALLOWLIST) {
      if (payload.data[key] !== undefined && payload.data[key] !== null) nested[key] = payload.data[key];
    }
    if (Object.keys(nested).length) out.data = nested;
  }
  return out;
}

/** Provider-asserted event time, normalized to an ISO string (or null when the provider sends none). */
function normalizeOccurredAt(payload) {
  const raw = payload?.occurred_at ?? payload?.occurredAt ?? payload?.created ?? payload?.data?.occurred_at ?? null;
  if (raw == null) return null;
  // Unix seconds (the common provider convention) vs an ISO string.
  const asDate = typeof raw === 'number' ? new Date(raw * 1000) : new Date(raw);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

function normalizeSequence(payload) {
  const raw = payload?.sequence ?? payload?.provider_sequence ?? payload?.data?.sequence ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Claim a provider event.
 *
 * @returns {Promise<{claimed:boolean, duplicate:boolean, superseded:boolean, event:object|null}>}
 *   claimed=false + duplicate=true  → this exact event was already recorded; the caller answers a
 *                                     200 idempotent no-op and does NOT re-apply any effect.
 *   claimed=true  + superseded=true → recorded for audit, but older than what has already been
 *                                     applied for this intent; the caller must NOT apply it.
 */
export async function claimProviderEvent({
  provider,
  eventId,
  eventType = null,
  intentId = null,
  transactionId = null,
  milestoneId = null,
  tenantId = null,
  payload = {},
  signatureVerified = false,
  correlationId = null,
  supabaseClient = null,
} = {}) {
  if (!provider) throw new Error('claimProviderEvent requires a provider');
  if (!eventId) throw new Error('claimProviderEvent requires an eventId');

  const supabase = await resolveClient({ supabaseClient });
  const occurredAt = normalizeOccurredAt(payload);
  const providerSequence = normalizeSequence(payload);

  const { data, error } = await supabase
    .from(SAFETRADE_EVENTS_TABLE)
    .insert({
      provider,
      event_id: String(eventId),
      event_type: eventType,
      intent_id: intentId,
      transaction_id: transactionId,
      milestone_id: milestoneId,
      tenant_id: tenantId,
      occurred_at: occurredAt,
      provider_sequence: providerSequence,
      payload: redactEventPayload(payload),
      signature_verified: Boolean(signatureVerified),
      status: EVENT_STATUS.RECEIVED,
      correlation_id: correlationId,
    })
    .select()
    .single();

  if (error) {
    // Losing the INSERT race IS the de-duplication. Any other error is a real failure and must not be
    // swallowed into a false "already processed".
    if (error.code === UNIQUE_VIOLATION || /duplicate key|uq_diaspora_safetrade_provider_event/i.test(error.message || '')) {
      return { claimed: false, duplicate: true, superseded: false, event: null };
    }
    throw new Error(`Failed to record SafeTrade provider event: ${error.message}`);
  }

  // Out-of-order guard: is anything NEWER already applied for this intent?
  if (intentId && (occurredAt || providerSequence != null)) {
    const newer = await findNewerAppliedEvent(supabase, { provider, intentId, occurredAt, providerSequence });
    if (newer) {
      await supabase
        .from(SAFETRADE_EVENTS_TABLE)
        .update({ status: EVENT_STATUS.SUPERSEDED, superseded_by: newer.id })
        .eq('id', data.id);
      return { claimed: true, duplicate: false, superseded: true, event: { ...data, status: EVENT_STATUS.SUPERSEDED } };
    }
  }

  return { claimed: true, duplicate: false, superseded: false, event: data };
}

async function findNewerAppliedEvent(supabase, { provider, intentId, occurredAt, providerSequence }) {
  const { data, error } = await supabase
    .from(SAFETRADE_EVENTS_TABLE)
    .select('id, occurred_at, provider_sequence')
    .eq('provider', provider)
    .eq('intent_id', intentId)
    .eq('status', EVENT_STATUS.APPLIED);
  if (error) throw new Error(`Failed to read SafeTrade event history: ${error.message}`);
  for (const row of data || []) {
    if (providerSequence != null && row.provider_sequence != null) {
      if (row.provider_sequence > providerSequence) return row;
      continue;
    }
    if (occurredAt && row.occurred_at && new Date(row.occurred_at) > new Date(occurredAt)) return row;
  }
  return null;
}

/** Mark a claimed event applied. Called only after the effect is durably recorded. */
export async function markEventApplied(eventRowId, { supabaseClient = null } = {}) {
  if (!eventRowId) return null;
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(SAFETRADE_EVENTS_TABLE)
    .update({ status: EVENT_STATUS.APPLIED, applied_at: new Date().toISOString() })
    .eq('id', eventRowId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to mark SafeTrade event applied: ${error.message}`);
  return data;
}

/** Record a processing failure so the event lands in the operator dead-letter view instead of vanishing. */
export async function markEventFailed(eventRowId, message, { supabaseClient = null, deadLetter = false } = {}) {
  if (!eventRowId) return null;
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(SAFETRADE_EVENTS_TABLE)
    .update({
      status: deadLetter ? EVENT_STATUS.DEAD_LETTERED : EVENT_STATUS.RECEIVED,
      // Sanitized: never a provider payload, signature or stack trace.
      last_error: String(message || 'unknown error').slice(0, 500),
    })
    .eq('id', eventRowId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to record SafeTrade event failure: ${error.message}`);
  return data;
}

/** Operator view: events that need a human (dead-lettered, or received-with-error). */
export async function listEventDeadLetters({ tenantId = null, limit = 50, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(SAFETRADE_EVENTS_TABLE)
    .select('id, provider, event_id, event_type, intent_id, status, last_error, received_at, attempts')
    .eq('status', EVENT_STATUS.DEAD_LETTERED)
    .order('received_at', { ascending: false })
    .limit(Math.min(Number(limit) || 50, 200));
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list SafeTrade event dead letters: ${error.message}`);
  return data || [];
}
