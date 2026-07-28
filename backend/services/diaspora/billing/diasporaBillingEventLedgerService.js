/**
 * Durable billing provider-event ledger (Issue #127, Deliverable D).
 *
 * Three properties, each of which fails silently if you get it wrong:
 *
 * 1. DE-DUPLICATION IS THE DATABASE. `UNIQUE (provider, event_id)` makes the INSERT itself the
 *    concurrency-safe claim: two instances racing the same delivery, one wins, the loser gets 23505 and
 *    answers an idempotent no-op. A `Set` in process memory would be per-instance and per-deploy — on
 *    serverless that means the same event processed once per instance, and a redeploy forgetting
 *    everything. (The subscription webhook previously did a SELECT-then-INSERT, which is a race, not a
 *    claim: two concurrent deliveries can both see "no existing row".)
 *
 * 2. OUT-OF-ORDER DELIVERY IS HANDLED, NOT IGNORED. Providers retry, and retries overtake. A
 *    `subscription.updated` emitted at T1 can arrive AFTER a `subscription.cancelled` emitted at T2.
 *    Applying it walks the ledger backwards and silently resurrects a cancelled plan. When a
 *    newly-claimed event is older than what has already been applied for the same tenant, it is
 *    recorded and marked `superseded` — durable and auditable, never applied.
 *
 * 3. THE PAYLOAD IS REDACTED. A billing webhook carries names, emails, addresses, card fingerprints
 *    and the provider's own identifiers. We store only the fields we reconcile against, via an
 *    ALLOWLIST — a denylist would pass through every new field the provider adds later.
 *
 * Ordering signal: `provider_sequence` when the provider supplies one, else `occurred_at`. A provider
 * that supplies NEITHER (the local rail — ADR-001 §3E) cannot be ordered at all, and this module says
 * so explicitly rather than pretending: such events are applied in arrival order and reconciliation is
 * the backstop. That honesty is the point; a fabricated ordering key would be worse than none.
 *
 * This module NEVER moves money and never decides entitlements. It records what a provider claims.
 */
import { resolveClient } from '../diasporaServiceUtils.js';

export const BILLING_EVENTS_TABLE = 'diaspora_billing_provider_events';

/** Postgres unique-violation. Supabase and node-postgres both surface it as `code`. */
const UNIQUE_VIOLATION = '23505';

/** Truncation ceiling for any operator-facing error string written to the ledger. */
const ERROR_MAX = 500;

/**
 * Payload allowlist. Everything not named here is dropped before the row is written.
 *
 * Deliberately excludes: customer name/email/phone/address, card brand/last4/fingerprint, IP, and any
 * provider secret. None of it is needed to reconcile a subscription, and a ledger is exactly the kind
 * of long-lived table where PII accumulates unnoticed.
 */
const PAYLOAD_ALLOWLIST = Object.freeze([
  'id', 'event_id', 'type', 'event_type', 'created', 'occurred_at', 'sequence', 'provider_sequence',
  'object', 'status', 'currency', 'amount', 'amount_due', 'amount_paid',
  'plan_key', 'planKey', 'tenant_id', 'tenantId',
  'subscription', 'customer', 'client_reference_id',
  'current_period_start', 'current_period_end', 'cancel_at_period_end', 'trial_end',
  'currentPeriodStart', 'currentPeriodEnd', 'cancelAtPeriodEnd', 'trialEnd',
  'reference', 'paynowreference', 'pollurl', 'live',
]);

export function redactBillingPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const pick = (source) => {
    const out = {};
    for (const key of PAYLOAD_ALLOWLIST) {
      if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
    }
    return out;
  };
  const out = pick(payload);
  // `data.object` is the common provider nesting; recurse with the SAME allowlist, one level only.
  const nested = payload.data?.object ?? payload.data;
  if (nested && typeof nested === 'object') {
    const inner = pick(nested);
    if (Object.keys(inner).length) out.data = inner;
  }
  return out;
}

/** Sanitize an error for the operator-facing `last_error` column. Never a payload or a stack. */
export function sanitizeLedgerError(message) {
  return String(message || 'unknown error').replace(/\s+/g, ' ').slice(0, ERROR_MAX);
}

/**
 * Claim a provider event.
 *
 * @returns {{claimed:boolean, duplicate:boolean, superseded:boolean, orderable:boolean, event:object|null, supersededBy:string|null}}
 *   duplicate=true            → already recorded; caller answers 200 and applies NOTHING.
 *   claimed=true, superseded  → recorded for audit but older than what is already applied; do NOT apply.
 *   orderable=false           → the provider supplied no ordering signal; arrival order is all we have.
 */
/**
 * How long a claimed-but-unprocessed event is presumed to be in flight.
 *
 * Under this, a second delivery of the same event is a concurrent duplicate and must not be applied
 * again. Over it, the first apply is presumed dead and the event is re-claimed so a provider retry is
 * not silently discarded. Providers retry over minutes to hours, so a few minutes separates the two
 * cases comfortably without leaving a genuinely failed event stuck for long.
 */
export const BILLING_CLAIM_LEASE_MS = 5 * 60 * 1000;

export async function claimBillingEvent({
  provider,
  eventId,
  eventType = null,
  providerEventType = null,
  tenantId = null,
  occurredAt = null,
  providerSequence = null,
  payload = {},
  signatureVerified = false,
  correlationId = null,
  supabaseClient = null,
} = {}) {
  if (!provider) throw new Error('claimBillingEvent requires a provider');
  if (!eventId) throw new Error('claimBillingEvent requires an eventId');

  const supabase = await resolveClient({ supabaseClient });
  const normalizedOccurredAt = normalizeOccurredAt(occurredAt, payload);
  const normalizedSequence = normalizeSequence(providerSequence, payload);
  const orderable = Boolean(normalizedOccurredAt) || normalizedSequence != null;

  const { data, error } = await supabase
    .from(BILLING_EVENTS_TABLE)
    .insert({
      provider,
      event_id: String(eventId),
      // The NORMALIZED type is stored; the provider's own name rides along in the redacted payload for
      // operator diagnosis. Storing the provider's name here would leak vocabulary into every consumer.
      event_type: eventType || providerEventType || null,
      tenant_id: tenantId || null,
      occurred_at: normalizedOccurredAt,
      provider_sequence: normalizedSequence,
      payload: redactBillingPayload(payload),
      signature_verified: Boolean(signatureVerified),
      correlation_id: correlationId || null,
      superseded: false,
    })
    .select()
    .single();

  if (error) {
    // Losing the INSERT race IS the de-duplication. Anything else is a genuine failure and must not be
    // swallowed into a false "already processed" — that would drop a real event silently.
    if (error.code === UNIQUE_VIOLATION || /duplicate key|uq_diaspora_billing_event/i.test(error.message || '')) {
      // Losing the INSERT race means a row exists — but NOT necessarily that it was ever processed,
      // and the two cases need opposite treatment.
      //
      // The row is written before the state is applied and `processed_at` is stamped after, so a
      // failure in between (a status the DB CHECK rejects — providers emit 'canceled' while the CHECK
      // accepts 'cancelled' — or an unknown plan_key hitting the FK) leaves a claimed row that was
      // never processed. Answering every later retry "already processed" blackholes that event: the
      // provider keeps retrying, we keep returning 200, and nothing ever scans for it. A cancellation
      // lost that way leaves a tenant on a paid plan forever.
      //
      // But an unprocessed row can ALSO mean a concurrent delivery is applying it right now. Handing
      // that back as claimed would let two requests apply the same event at once.
      //
      // The row alone cannot distinguish them, so age does: a claim younger than
      // BILLING_CLAIM_LEASE_MS is presumed in flight and answered as a duplicate; an older one whose
      // apply never completed is presumed dead and is re-claimed for reprocessing. Re-applying an
      // authoritative provider snapshot is idempotent by construction, so a replay is safe; silently
      // dropping the event is not.
      const existing = await findBillingEvent(supabase, provider, eventId);
      if (existing && !existing.processed_at) {
        const claimedAt = Date.parse(existing.created_at ?? '');
        const stale = Number.isFinite(claimedAt) && (Date.now() - claimedAt) > BILLING_CLAIM_LEASE_MS;
        if (stale) {
          return { claimed: true, duplicate: false, superseded: false, orderable, event: existing, supersededBy: null, reclaimed: true };
        }
      }
      return { claimed: false, duplicate: true, superseded: false, orderable, event: null, supersededBy: null };
    }
    throw new Error(`Failed to record billing provider event: ${error.message}`);
  }

  // Out-of-order guard. Only meaningful when we have BOTH a tenant to scope by and an ordering signal.
  if (tenantId && orderable) {
    const newer = await findNewerAppliedEvent(supabase, {
      provider,
      tenantId,
      occurredAt: normalizedOccurredAt,
      providerSequence: normalizedSequence,
    });
    if (newer) {
      const { error: updateError } = await supabase
        .from(BILLING_EVENTS_TABLE)
        .update({
          superseded: true,
          superseded_by: newer.id,
          // Processing IS complete for this row — it reached a terminal decision. Leaving processed_at
          // null would make a superseded event look like an unprocessed backlog item forever.
          processed_at: new Date().toISOString(),
        })
        .eq('id', data.id);
      if (updateError) throw new Error(`Failed to mark billing event superseded: ${updateError.message}`);
      return {
        claimed: true,
        duplicate: false,
        superseded: true,
        orderable,
        event: { ...data, superseded: true, superseded_by: newer.id },
        supersededBy: newer.id,
      };
    }
  }

  return { claimed: true, duplicate: false, superseded: false, orderable, event: data, supersededBy: null };
}

/**
 * Read one event by its natural key.
 *
 * Used only on the unique-violation path, to tell a genuine duplicate (processed) apart from a row
 * whose earlier apply died partway (unprocessed). Those two need opposite treatment.
 */
async function findBillingEvent(supabase, provider, eventId) {
  const { data, error } = await supabase
    .from(BILLING_EVENTS_TABLE)
    .select('*')
    .eq('provider', provider)
    .eq('event_id', String(eventId))
    .maybeSingle();
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to read billing provider event: ${error.message}`);
  }
  return data || null;
}

/**
 * Is anything NEWER already applied for this tenant?
 *
 * "Applied" means processed_at IS NOT NULL AND superseded = false. Comparing against every row instead
 * would let a superseded event supersede its own successor, and comparing against unprocessed rows
 * would let a queued-but-never-applied event block a good one.
 *
 * Sequence wins over timestamp when both sides have one: a provider sequence is exact, whereas two
 * events can share a whole-second timestamp.
 */
async function findNewerAppliedEvent(supabase, { provider, tenantId, occurredAt, providerSequence }) {
  const { data, error } = await supabase
    .from(BILLING_EVENTS_TABLE)
    .select('id, occurred_at, provider_sequence, processed_at, superseded, tenant_id, provider')
    .eq('provider', provider)
    .eq('tenant_id', String(tenantId))
    .eq('superseded', false)
    .not('processed_at', 'is', null);
  if (error) throw new Error(`Failed to read billing event history: ${error.message}`);

  for (const row of data || []) {
    if (providerSequence != null && row.provider_sequence != null) {
      if (Number(row.provider_sequence) > Number(providerSequence)) return row;
      continue;
    }
    if (occurredAt && row.occurred_at && new Date(row.occurred_at) > new Date(occurredAt)) return row;
  }
  return null;
}

/** Mark a claimed event applied. Called ONLY after the effect is durably recorded. */
export async function markBillingEventApplied(eventRowId, { supabaseClient = null } = {}) {
  if (!eventRowId) return null;
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(BILLING_EVENTS_TABLE)
    .update({ processed_at: new Date().toISOString(), last_error: null })
    .eq('id', eventRowId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to mark billing event applied: ${error.message}`);
  return data;
}

/**
 * Record a processing failure.
 *
 * A failed event is NOT marked processed — it stays visible as unfinished work. `attempts` increments
 * so a repeatedly-failing event can be dead-lettered rather than retried forever, and the sanitized
 * reason is kept so an operator has something to act on.
 */
export async function markBillingEventFailed(eventRowId, message, {
  supabaseClient = null, deadLetter = false, attempts = null,
} = {}) {
  if (!eventRowId) return null;
  const supabase = await resolveClient({ supabaseClient });
  const update = {
    last_error: sanitizeLedgerError(message),
    dead_lettered: Boolean(deadLetter),
  };
  if (attempts != null) update.attempts = Number(attempts);
  if (deadLetter) {
    // A dead letter is terminal: stop counting it as pending work, but never claim it was applied.
    update.processed_at = new Date().toISOString();
    update.superseded = false;
  }
  const { data, error } = await supabase
    .from(BILLING_EVENTS_TABLE)
    .update(update)
    .eq('id', eventRowId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to record billing event failure: ${error.message}`);
  return data;
}

/** Operator view: events that failed and were dead-lettered. */
export async function listBillingEventDeadLetters({ tenantId = null, limit = 50, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(BILLING_EVENTS_TABLE)
    .select('id, provider, event_id, event_type, tenant_id, last_error, attempts, occurred_at, created_at, dead_lettered')
    .eq('dead_lettered', true)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit) || 50, 200));
  if (tenantId) query = query.eq('tenant_id', String(tenantId));
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list billing event dead letters: ${error.message}`);
  return data || [];
}

/** Operator view: events recorded but deliberately not applied because something newer already was. */
export async function listSupersededEvents({ tenantId = null, limit = 50, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(BILLING_EVENTS_TABLE)
    .select('id, provider, event_id, event_type, tenant_id, occurred_at, provider_sequence, superseded, superseded_by, created_at')
    .eq('superseded', true)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit) || 50, 200));
  if (tenantId) query = query.eq('tenant_id', String(tenantId));
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list superseded billing events: ${error.message}`);
  return data || [];
}

/** Provider-asserted event time, normalized to ISO (or null when the provider sends none). */
export function normalizeOccurredAt(explicit, payload = {}) {
  const raw = explicit
    ?? payload?.occurred_at ?? payload?.occurredAt ?? payload?.created
    ?? payload?.data?.occurred_at ?? null;
  if (raw == null) return null;
  // Unix seconds (the common provider convention) vs an ISO string.
  const asDate = typeof raw === 'number' ? new Date(raw * 1000) : new Date(raw);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

/** Provider sequence number, when one exists. */
export function normalizeSequence(explicit, payload = {}) {
  const raw = explicit ?? payload?.sequence ?? payload?.provider_sequence ?? payload?.data?.sequence ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
