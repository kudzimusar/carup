/**
 * Diaspora GTM — scheduled retry of provider events that were CLAIMED but never APPLIED
 * (Issue #127, Phase 2E).
 *
 * THE HOLE THIS CLOSES
 * --------------------
 * `diasporaBillingEventLedgerService.js` says it plainly in its own comment: the ledger row is
 * written BEFORE the state is applied and `processed_at` is stamped AFTER, so anything that fails in
 * between — a status the CHECK rejects, an unknown plan_key hitting the FK, a request killed by a
 * serverless timeout — leaves a claimed row that was never processed. The webhook handler already
 * refuses to answer the provider's later retries with "already processed", precisely so the event is
 * not blackholed. But that only helps if the provider retries, and every provider eventually stops.
 * On the Zimbabwe rail, ADR-001 §3E records that there is no delivery guarantee at all.
 *
 * So an unapplied event needs something that comes back for it. That is this.
 *
 * WHAT IT WILL AND WILL NOT DO
 * ----------------------------
 *  · It re-applies through `syncSubscriptionFromSnapshot` — the SAME writer the webhook uses. A second
 *    copy of the only function that mutates subscription state would drift, and the drift would be
 *    invisible until the two paths disagreed about a paying tenant.
 *  · It never re-verifies a signature, because it never re-reads the wire. It replays the payload that
 *    was already verified at claim time and recorded with `signature_verified = true`; a row without
 *    that flag is SKIPPED rather than trusted.
 *  · It honours the same supersede rule as the webhook: a superseded event is recorded history, never
 *    applied. Applying one would roll a tenant's subscription backwards.
 *  · It leaves brand-new rows alone for a grace window. Retrying an event the webhook is still
 *    processing at this instant is how you get two writers for one row.
 *  · At the attempt ceiling it DEAD-LETTERS, which is the NEEDS_OPERATOR terminus: the row surfaces in
 *    `GET /billing-health` under `failedWebhooks`. Retrying a permanently broken event forever turns a
 *    real defect into background noise.
 */
import { resolveClient } from '../diasporaServiceUtils.js';
import { syncSubscriptionFromSnapshot } from './diasporaBillingSubscriptionSync.js';
import {
  BILLING_EVENTS_TABLE,
  markBillingEventApplied,
  markBillingEventFailed,
} from './diasporaBillingEventLedgerService.js';

/**
 * How long an unapplied event is left alone before a retry touches it.
 *
 * Long enough that the original request is certainly over: a serverless invocation that is still
 * running has not failed yet, and racing it produces two writers for one subscription row.
 */
export const DEFAULT_RETRY_GRACE_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_EVENT_ATTEMPTS = 5;

/** Outcome vocabulary. Each value means a different operator action, so they are not collapsed. */
export const EVENT_RETRY_OUTCOMES = Object.freeze({
  APPLIED: 'applied',
  DEAD_LETTERED: 'dead_lettered',
  FAILED: 'failed',
  SKIPPED_UNVERIFIED: 'skipped_unverified',
  SKIPPED_NO_TENANT: 'skipped_no_tenant',
  SKIPPED_NO_STATE: 'skipped_no_state',
});

function carriesSubscriptionState(normalized) {
  return Boolean(normalized?.status || normalized?.planKey);
}

/**
 * Rebuild the normalized view of a stored payload.
 *
 * Prefers the provider profile's own `normalizeEvent`, because provider vocabulary belongs in exactly
 * one place (ADR-001 §5). Falls back to the shape the sandbox provider records, which is already
 * CarUp-shaped, so a sandbox event is still retryable without a profile.
 */
export function normalizeStoredEvent(row, billingProvider = null) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  if (billingProvider && typeof billingProvider.normalizeEvent === 'function') {
    try {
      const normalized = billingProvider.normalizeEvent(payload);
      if (normalized && (normalized.status || normalized.planKey || normalized.tenantId)) return normalized;
    } catch { /* a profile that cannot parse an old payload must not abort the sweep */ }
  }
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    eventId: row?.event_id || null,
    eventType: row?.event_type || payload.type || payload.event_type || null,
    tenantId: row?.tenant_id || data.tenantId || data.tenant_id || null,
    planKey: data.planKey || data.plan_key || null,
    status: data.status || null,
    currentPeriodStart: data.currentPeriodStart || data.current_period_start || null,
    currentPeriodEnd: data.currentPeriodEnd || data.current_period_end || null,
    cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? data.cancel_at_period_end ?? null,
    providerCustomerRef: data.providerCustomerRef || data.provider_customer_ref || null,
    providerSubscriptionRef: data.providerSubscriptionRef || data.provider_subscription_ref || null,
  };
}

/**
 * Sweep unapplied provider events and try them again.
 *
 * @param {object} opts
 * @param {number} [opts.limit=100]        bounded — a run must terminate
 * @param {number} [opts.maxAttempts]      dead-letter ceiling
 * @param {number} [opts.graceMs]          leave rows younger than this alone
 * @param {Date|string} [opts.now]
 * @param {object} [opts.billingProvider]  injected; used only for `normalizeEvent`
 * @param {Function} [opts.applier]        injected writer, defaults to syncSubscriptionFromSnapshot
 * @returns {{scanned:number, applied:number, deadLettered:number, failed:number, skipped:number, outcomes:Array}}
 */
export async function retryUnappliedBillingEvents({
  limit = 100,
  maxAttempts = DEFAULT_MAX_EVENT_ATTEMPTS,
  graceMs = DEFAULT_RETRY_GRACE_MS,
  now = null,
  correlationId = null,
  billingProvider = null,
  applier = null,
  supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const clock = now ? new Date(now) : new Date();
  const cutoff = clock.getTime() - Math.max(0, Number(graceMs) || 0);
  const write = applier || syncSubscriptionFromSnapshot;

  const { data, error } = await supabase
    .from(BILLING_EVENTS_TABLE)
    .select('id, provider, event_id, event_type, tenant_id, payload, signature_verified, processed_at, superseded, dead_lettered, attempts, occurred_at, created_at, correlation_id')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(Math.min(Number(limit) || 100, 500));
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to read unapplied billing events: ${error.message}`);
  }

  const rows = (Array.isArray(data) ? data : (data ? [data] : []))
    // Boolean columns are filtered here rather than in the query: a NULL from an older row must be
    // treated as false, and `.eq(col, false)` would exclude it silently.
    .filter((row) => !row.superseded && !row.dead_lettered)
    .filter((row) => {
      const created = Date.parse(row.created_at || '');
      return !Number.isFinite(created) || created <= cutoff;
    });

  const outcomes = [];
  let applied = 0;
  let deadLettered = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const attempts = Number(row.attempts || 0) + 1;

    // Never trust a payload that was not signature-verified when it was claimed. There is no wire to
    // re-check against here, so "we cannot verify it" must mean "we do not apply it".
    if (!row.signature_verified) {
      outcomes.push({ eventId: row.event_id, outcome: EVENT_RETRY_OUTCOMES.SKIPPED_UNVERIFIED });
      skipped += 1;
      continue;
    }

    if (attempts > Math.max(1, Number(maxAttempts) || DEFAULT_MAX_EVENT_ATTEMPTS)) {
      await markBillingEventFailed(row.id, 'Retry ceiling reached; operator action required', {
        supabaseClient: supabase, deadLetter: true, attempts,
      });
      outcomes.push({ eventId: row.event_id, outcome: EVENT_RETRY_OUTCOMES.DEAD_LETTERED, attempts });
      deadLettered += 1;
      continue;
    }

    const normalized = normalizeStoredEvent(row, billingProvider);
    if (!normalized.tenantId) {
      // A platform-level event (a provider account notice, say) has no subscription to apply. It is
      // marked applied so it stops appearing as unfinished work — it is not lost, it is complete.
      await markBillingEventApplied(row.id, { supabaseClient: supabase });
      outcomes.push({ eventId: row.event_id, outcome: EVENT_RETRY_OUTCOMES.SKIPPED_NO_TENANT });
      skipped += 1;
      continue;
    }
    if (!carriesSubscriptionState(normalized)) {
      await markBillingEventApplied(row.id, { supabaseClient: supabase });
      outcomes.push({ eventId: row.event_id, outcome: EVENT_RETRY_OUTCOMES.SKIPPED_NO_STATE });
      skipped += 1;
      continue;
    }

    try {
      await write(supabase, {
        tenantId: normalized.tenantId,
        planKey: normalized.planKey,
        status: normalized.status,
        currentPeriodStart: normalized.currentPeriodStart,
        currentPeriodEnd: normalized.currentPeriodEnd,
        provider: row.provider,
        providerCustomerRef: normalized.providerCustomerRef,
        providerSubscriptionRef: normalized.providerSubscriptionRef,
        cancelAtPeriodEnd: normalized.cancelAtPeriodEnd ?? undefined,
      }, null);
      await markBillingEventApplied(row.id, { supabaseClient: supabase });
      outcomes.push({ eventId: row.event_id, outcome: EVENT_RETRY_OUTCOMES.APPLIED, attempts, correlationId });
      applied += 1;
    } catch (err) {
      // Still unfinished work: `processed_at` stays NULL so the next sweep sees it again, with one
      // more attempt spent.
      await markBillingEventFailed(row.id, err?.message, { supabaseClient: supabase, attempts })
        .catch(() => { /* the original failure is what matters */ });
      outcomes.push({ eventId: row.event_id, outcome: EVENT_RETRY_OUTCOMES.FAILED, attempts });
      failed += 1;
    }
  }

  return { scanned: rows.length, applied, deadLettered, failed, skipped, outcomes };
}
