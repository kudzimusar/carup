/**
 * Diaspora GTM — the Zimbabwe-side renewal sweep (Issue #127, Phase 2E; ADR-001 §8).
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * ADR-001 §4.2 puts CarUp in charge of the renewal schedule for tenants on a rail with no
 * subscription concept: "Because Paynow has no subscription concept, CarUp drives the renewal
 * schedule and *our* `diaspora_subscriptions` row stays the tenant-facing truth for those tenants."
 * §8 then lists "the Zimbabwe-side renewal scheduler" as something the ADR explicitly does NOT decide,
 * because "someone must trigger each period".
 *
 * That sentence describes two jobs, and only one of them is engineering's to do now:
 *
 *   DETECTION — noticing that a period came due, exactly once, durably, per tenant per period. That
 *   is buildable today, it needs no merchant account, and without it nobody can trigger anything
 *   because nobody knows what is due.
 *
 *   COLLECTION — actually taking the money. ADR-001 §9 keeps `APPROVED_LIVE_PROVIDERS` empty until the
 *   owner completes five external actions, the last of which is "authorize production money movement,
 *   separately from all of the above".
 *
 * THIS MODULE DOES DETECTION ONLY, AND IT CANNOT DO THE OTHER
 * ----------------------------------------------------------
 * It calls no provider method. Not `createCheckoutSession`, not a charge, not a payment initiation —
 * none of them appear in this file, and a test asserts that. `diaspora_subscription_renewals` carries
 * no amount, no currency and no payment handle, because a schema that can express a charge will
 * eventually be used to make one.
 *
 * A due period lands in `needs_operator` whenever collection is not authorized, which is every case
 * today. That is the honest terminus: a human is told a renewal is due, and a human decides. When the
 * owner completes ADR-001 §9, the state becomes `due` and a separate, deliberately-written collection
 * path can pick it up.
 *
 * IDEMPOTENCY IS THE DATABASE'S
 * -----------------------------
 * `uq_diaspora_subscription_renewal_period (tenant_id, subscription_id, period_end)` means a sweep
 * that runs twice, or two dispatchers that overlap, produce ONE row: the loser gets 23505 and reads
 * the winner back. Code that SELECTed first would have a window between the check and the write —
 * and the thing on the other side of that window is a duplicate charge.
 *
 * WHICH SUBSCRIPTIONS
 * -------------------
 * Only rails with no native subscription lifecycle. Stripe renews its own subscriptions and emits a
 * webhook; sweeping those would create a second, competing schedule for the same period, which is how
 * a tenant gets billed twice by two systems that each believe they are in charge.
 */
import { resolveClient } from '../diasporaServiceUtils.js';
import {
  BILLING_PROVIDERS,
  APPROVED_LIVE_PROVIDERS,
  isBillingLiveEnabled,
} from '../../../constants/diaspora/diasporaBillingConstants.js';
import { SUBSCRIPTION_RENEWALS_TABLE } from '../../../constants/diaspora/diasporaSchedulerConstants.js';

export const SUBSCRIPTIONS_TABLE = 'diaspora_subscriptions';

export const RENEWAL_STATES = Object.freeze({
  DUE: 'due',
  NEEDS_OPERATOR: 'needs_operator',
  COLLECTED: 'collected',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
});

/**
 * Rails where CarUp owns the renewal clock because the provider has no subscription object.
 *
 * Stripe and the sandbox are deliberately absent: they renew themselves and tell us. Manual is
 * present because an invoice-and-bank-transfer tenant has no automatic renewal at all, so "this
 * period ended" still needs to reach a human.
 */
export const LOCALLY_DRIVEN_RENEWAL_PROVIDERS = Object.freeze([
  BILLING_PROVIDERS.PAYNOW,
  BILLING_PROVIDERS.MANUAL,
]);

/** Statuses that represent a live, paying relationship whose period can come due. */
const RENEWABLE_STATUSES = Object.freeze(['active', 'trialing', 'past_due']);

/**
 * How far ahead of `current_period_end` a renewal is detected.
 *
 * Deliberately generous: a mobile-money collection is an operational process, not an API call, and
 * telling an operator on the morning the period ends leaves no time to act.
 */
export function renewalLeadTimeMs(env = process.env) {
  const days = Number(env.DIASPORA_SUBSCRIPTION_RENEWAL_LEAD_DAYS || 3);
  const safe = Number.isFinite(days) && days >= 0 ? Math.min(days, 30) : 3;
  return safe * 24 * 60 * 60 * 1000;
}

/**
 * Is a scheduled job permitted to initiate collection for this provider?
 *
 * Both halves must hold, and the second one is empty by construction until ADR-001 §9 is complete.
 * This function exists so the answer is computed in exactly one place and can be asserted directly.
 */
export function isAutomaticCollectionAuthorized(provider) {
  return isBillingLiveEnabled() && APPROVED_LIVE_PROVIDERS.includes(String(provider || '').toLowerCase());
}

/**
 * Detect and durably record renewals that have come due on locally-driven rails.
 *
 * @param {object} opts
 * @param {number} [opts.limit=100]
 * @param {Date|string} [opts.now]
 * @param {number} [opts.leadTimeMs]
 * @param {string|null} [opts.tenantId] scope to one tenant (operator spot check)
 * @param {string|null} [opts.runId]
 * @returns {{scanned:number, recorded:number, alreadyRecorded:number, needsOperator:number, renewals:Array}}
 */
export async function sweepDueRenewals({
  limit = 100,
  now = null,
  leadTimeMs = null,
  tenantId = null,
  runId = null,
  correlationId = null,
  supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const clock = now ? new Date(now) : new Date();
  const horizon = clock.getTime() + (leadTimeMs ?? renewalLeadTimeMs());
  const batch = Math.min(Number(limit) || 100, 500);

  let query = supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select('id, tenant_id, plan_key, status, provider, current_period_start, current_period_end, cancel_at_period_end, deleted_at')
    .is('deleted_at', null)
    .order('current_period_end', { ascending: true });
  if (tenantId) query = query.eq('tenant_id', String(tenantId));
  const { data, error } = await query;
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to read subscriptions for renewal detection: ${error.message}`);
  }

  const candidates = (Array.isArray(data) ? data : (data ? [data] : []))
    .filter((row) => LOCALLY_DRIVEN_RENEWAL_PROVIDERS.includes(String(row.provider || '').toLowerCase()))
    .filter((row) => RENEWABLE_STATUSES.includes(String(row.status || '').toLowerCase()))
    .filter((row) => {
      const end = Date.parse(row.current_period_end || '');
      return Number.isFinite(end) && end <= horizon;
    })
    .slice(0, batch);

  const renewals = [];
  let recorded = 0;
  let alreadyRecorded = 0;
  let needsOperator = 0;
  let cancelling = 0;

  for (const subscription of candidates) {
    const provider = String(subscription.provider || '').toLowerCase();

    // A tenant who already asked to cancel at period end must NOT be handed to an operator as a
    // renewal to collect. The period ending is the cancellation taking effect, not money owed.
    const state = subscription.cancel_at_period_end
      ? RENEWAL_STATES.CANCELLED
      : (isAutomaticCollectionAuthorized(provider) ? RENEWAL_STATES.DUE : RENEWAL_STATES.NEEDS_OPERATOR);

    const { data: inserted, error: insertError } = await supabase
      .from(SUBSCRIPTION_RENEWALS_TABLE)
      .insert({
        tenant_id: subscription.tenant_id,
        subscription_id: subscription.id,
        provider,
        plan_key: subscription.plan_key || null,
        period_end: subscription.current_period_end,
        state,
        attempts: 0,
        detected_by_run: runId || null,
        detail: {
          detectedAt: clock.toISOString(),
          correlationId: correlationId || null,
          // WHY a human is needed, recorded at detection time so the reason survives a config change.
          reason: subscription.cancel_at_period_end
            ? 'CANCEL_AT_PERIOD_END'
            : (state === RENEWAL_STATES.NEEDS_OPERATOR ? 'AUTOMATIC_COLLECTION_NOT_AUTHORIZED' : null),
        },
      })
      .select()
      .single();

    if (insertError) {
      // 23505 is not a failure — it is the idempotency working. This period is already recorded.
      if (insertError.code === '23505') {
        alreadyRecorded += 1;
        renewals.push({ subscriptionId: subscription.id, tenantId: subscription.tenant_id, periodEnd: subscription.current_period_end, state, duplicate: true });
        continue;
      }
      throw new Error(`Failed to record a due renewal: ${insertError.message}`);
    }

    recorded += 1;
    if (state === RENEWAL_STATES.NEEDS_OPERATOR) needsOperator += 1;
    if (state === RENEWAL_STATES.CANCELLED) cancelling += 1;
    renewals.push({
      id: inserted.id,
      subscriptionId: subscription.id,
      tenantId: subscription.tenant_id,
      provider,
      periodEnd: subscription.current_period_end,
      state,
      duplicate: false,
    });
  }

  return {
    scanned: candidates.length,
    recorded,
    alreadyRecorded,
    needsOperator,
    cancelling,
    // Nothing in this module contacts a provider. Reported explicitly so a caller (and a reader of
    // the run detail) can see that the collection half is still gated by ADR-001 §9.
    collectionAttempted: false,
    renewals,
  };
}

/** Operator read: renewals awaiting a human, oldest period first. */
export async function listRenewalsNeedingOperator({ tenantId = null, limit = 50, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(SUBSCRIPTION_RENEWALS_TABLE)
    .select('id, tenant_id, subscription_id, provider, plan_key, period_end, state, attempts, last_error, detail, created_at')
    .eq('state', RENEWAL_STATES.NEEDS_OPERATOR)
    .order('period_end', { ascending: true })
    .limit(Math.min(Number(limit) || 50, 200));
  if (tenantId) query = query.eq('tenant_id', String(tenantId));
  const { data, error } = await query;
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to list renewals needing an operator: ${error.message}`);
  }
  return Array.isArray(data) ? data : [];
}
