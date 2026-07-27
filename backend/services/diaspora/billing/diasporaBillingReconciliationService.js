/**
 * Billing reconciliation — provider state vs the CarUp subscription ledger (Issue #127, Deliverable D).
 *
 * Reconciliation is not a nicety here, it is load-bearing. ADR-001 §3E records that the Zimbabwe rail's
 * callback is documented by its own provider as a hint, with no event ids, no ordering and no delivery
 * guarantee; the documented correct pattern is to poll for truth. Even on the best-behaved provider,
 * webhooks are at-least-once and unordered, endpoints have outages, and a webhook secret rotation can
 * silently drop every delivery for an hour. Every one of those failures is invisible: the system keeps
 * serving whatever it last believed.
 *
 * Both directions of drift cost money:
 *   provider says CANCELLED, we say ACTIVE  → we are serving a tenant who stopped paying;
 *   provider says ACTIVE, we say CANCELLED  → we are charging a tenant who gets nothing.
 *
 * Design commitments:
 *  - A run is DURABLE (`diaspora_billing_reconciliation_runs`, ledger #21), so "we checked and found
 *    nothing" is distinguishable from "the scheduler has not run in three weeks".
 *  - Findings are SANITIZED: tenant id, field, and the two STATES. Never an amount tied to a person,
 *    never a provider payload, never a customer identifier in the clear.
 *  - Detection NEVER repairs by default. Auto-healing a mismatch would destroy the evidence of the bug
 *    that caused it and could itself revoke a paying tenant's access from a single bad provider read.
 *    `repair` is opt-in, bounded to the safe direction, and recorded.
 *  - The provider read is a PURE read (`getSubscription`), so an audit cannot create the drift it is
 *    looking for.
 *  - A run is BOUNDED and always terminal: it completes or it fails, never "running" forever.
 */
import { resolveClient } from '../diasporaServiceUtils.js';
import { selectBillingProvider } from './billingProvider.js';
import {
  BILLING_RECONCILIATION_TRIGGERS,
  BILLING_RECONCILIATION_STATES,
  billingReconciliationBatchSize,
} from '../../../constants/diaspora/diasporaBillingConstants.js';
import {
  emitBillingSignal,
  BILLING_EVENTS,
  reconciliationMismatch,
  reconciliationCompleted,
  reconciliationFailed,
  newCorrelationId,
  fingerprint,
} from './diasporaBillingObservability.js';

export const RECONCILIATION_RUNS_TABLE = 'diaspora_billing_reconciliation_runs';
export const SUBSCRIPTIONS_TABLE = 'diaspora_subscriptions';

/** Mismatch kinds. Each one implies a different operator action, so they are not collapsed into one. */
export const MISMATCH_KINDS = Object.freeze({
  STATUS: 'STATUS_MISMATCH',
  PLAN: 'PLAN_MISMATCH',
  PERIOD_END: 'PERIOD_END_MISMATCH',
  CANCEL_FLAG: 'CANCEL_AT_PERIOD_END_MISMATCH',
  MISSING_AT_PROVIDER: 'MISSING_AT_PROVIDER',
  UNREADABLE_AT_PROVIDER: 'UNREADABLE_AT_PROVIDER',
  NO_PROVIDER_REF: 'NO_PROVIDER_REF',
});

/**
 * The only mismatch kind safe to repair automatically, and only in one direction.
 *
 * A provider saying CANCELLED while we say ACTIVE means we are giving away service — correcting it
 * costs the tenant nothing they paid for. The reverse (provider ACTIVE, we CANCELLED) must NOT be
 * auto-applied: a transient bad read would restore access that a human deliberately revoked. That
 * asymmetry is the whole repair policy.
 */
const SAFE_REPAIR_STATUSES = Object.freeze(['cancelled', 'expired', 'suspended']);

const SUBSCRIPTION_COLUMNS = 'id, tenant_id, plan_key, status, current_period_start, current_period_end, cancel_at_period_end, provider, provider_customer_ref, provider_subscription_ref, deleted_at, created_at';

function isoDay(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Compare one subscription row against a provider snapshot.
 * Returns sanitized findings — tenant + field + states only.
 */
export function compareSubscription(local, remote) {
  const findings = [];
  const tenantId = local.tenant_id;

  if (!local.provider_subscription_ref) {
    // Not a drift, but not nothing either: a paid-looking local row with no provider handle can never
    // be reconciled at all, which is itself the finding.
    return [{
      kind: MISMATCH_KINDS.NO_PROVIDER_REF,
      tenantId,
      field: 'provider_subscription_ref',
      expected: 'a provider handle',
      actual: null,
    }];
  }

  if (!remote) {
    return [{
      kind: MISMATCH_KINDS.MISSING_AT_PROVIDER,
      tenantId,
      field: 'subscription',
      expected: String(local.status || ''),
      actual: null,
    }];
  }

  if (remote.status && String(remote.status) !== String(local.status)) {
    findings.push({
      kind: MISMATCH_KINDS.STATUS,
      tenantId,
      field: 'status',
      expected: String(remote.status),  // the provider is authoritative on status
      actual: String(local.status || ''),
    });
  }

  if (remote.planKey && String(remote.planKey) !== String(local.plan_key)) {
    findings.push({
      kind: MISMATCH_KINDS.PLAN,
      tenantId,
      field: 'plan_key',
      expected: String(remote.planKey),
      actual: String(local.plan_key || ''),
    });
  }

  // Day granularity: providers and our own writes differ by seconds routinely, and a second-level
  // comparison would report a "mismatch" on every single row — noise that trains operators to ignore
  // the signal entirely.
  const remoteEnd = isoDay(remote.currentPeriodEnd);
  const localEnd = isoDay(local.current_period_end);
  if (remoteEnd && localEnd && remoteEnd !== localEnd) {
    findings.push({
      kind: MISMATCH_KINDS.PERIOD_END,
      tenantId,
      field: 'current_period_end',
      expected: remoteEnd,
      actual: localEnd,
    });
  }

  if (remote.cancelAtPeriodEnd != null
    && Boolean(remote.cancelAtPeriodEnd) !== Boolean(local.cancel_at_period_end)) {
    findings.push({
      kind: MISMATCH_KINDS.CANCEL_FLAG,
      tenantId,
      field: 'cancel_at_period_end',
      expected: Boolean(remote.cancelAtPeriodEnd),
      actual: Boolean(local.cancel_at_period_end),
    });
  }

  return findings;
}

/** Which subscriptions this run will check. Bounded; newest first so a truncated run sees live tenants. */
async function loadSubscriptions(supabase, { tenantId, limit }) {
  let query = supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select(SUBSCRIPTION_COLUMNS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (tenantId) query = query.eq('tenant_id', String(tenantId));
  const { data, error } = await query;
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to load subscriptions for reconciliation: ${error.message}`);
  }
  return Array.isArray(data) ? data : (data ? [data] : []);
}

async function openRun(supabase, { provider, trigger, tenantId, initiatedBy }) {
  const { data, error } = await supabase
    .from(RECONCILIATION_RUNS_TABLE)
    .insert({
      tenant_id: tenantId || null,
      provider,
      trigger,
      state: BILLING_RECONCILIATION_STATES.RUNNING,
      started_at: new Date().toISOString(),
      checked_count: 0,
      mismatch_count: 0,
      repaired_count: 0,
      findings: [],
      initiated_by: initiatedBy || null,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to open reconciliation run: ${error.message}`);
  return data;
}

async function closeRun(supabase, runId, patch) {
  const { data, error } = await supabase
    .from(RECONCILIATION_RUNS_TABLE)
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', runId)
    .select()
    .single();
  if (error) throw new Error(`Failed to close reconciliation run: ${error.message}`);
  return data;
}

/**
 * Run a reconciliation pass.
 *
 * @param {object} opts
 * @param {string} [opts.trigger]      scheduled | operator | startup | webhook_gap
 * @param {string|null} [opts.tenantId] scope to one tenant (operator-triggered spot check)
 * @param {boolean} [opts.repair=false] apply the safe-direction repair (see SAFE_REPAIR_STATUSES)
 * @param {object} [opts.billingProvider] injected provider
 * @param {object} [opts.supabaseClient]  injected client
 */
export async function runBillingReconciliation({
  trigger = BILLING_RECONCILIATION_TRIGGERS.SCHEDULED,
  tenantId = null,
  limit = null,
  repair = false,
  initiatedBy = null,
  correlationId = null,
  billingProvider = null,
  supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const provider = billingProvider || selectBillingProvider();
  const corr = correlationId || newCorrelationId('rec');
  const batch = limit == null ? billingReconciliationBatchSize() : Math.min(Number(limit) || 1, 500);

  const run = await openRun(supabase, {
    provider: provider.name, trigger, tenantId, initiatedBy,
  });
  emitBillingSignal(BILLING_EVENTS.RECONCILIATION_STARTED, {
    correlationId: corr, runId: run.id, provider: provider.name, trigger, tenantId,
  });

  const findings = [];
  let checked = 0;
  let repaired = 0;

  try {
    const subscriptions = await loadSubscriptions(supabase, { tenantId, limit: batch });

    for (const local of subscriptions) {
      checked += 1;
      let remote = null;
      try {
        if (local.provider_subscription_ref) {
          remote = await provider.getSubscription({
            tenantId: local.tenant_id,
            subscriptionRef: local.provider_subscription_ref,
          });
        }
      } catch (err) {
        // One unreadable subscription must not abort the whole run — that would turn a single provider
        // hiccup into "we have no idea about any tenant".
        findings.push({
          kind: MISMATCH_KINDS.UNREADABLE_AT_PROVIDER,
          tenantId: local.tenant_id,
          field: 'provider',
          expected: 'a readable subscription',
          actual: err?.code || 'PROVIDER_READ_FAILED',
        });
        continue;
      }

      const rowFindings = compareSubscription(local, remote);
      for (const finding of rowFindings) {
        findings.push(finding);
        reconciliationMismatch({ correlationId: corr, runId: run.id, ...finding });
      }

      if (repair && remote) {
        const applied = await maybeRepair(supabase, { local, remote, findings: rowFindings });
        if (applied) repaired += 1;
      }
    }

    const closed = await closeRun(supabase, run.id, {
      state: BILLING_RECONCILIATION_STATES.COMPLETED,
      checked_count: checked,
      mismatch_count: findings.length,
      repaired_count: repaired,
      findings,
    });
    reconciliationCompleted({
      correlationId: corr, runId: run.id, provider: provider.name,
      checked, mismatches: findings.length, trigger,
    });
    return {
      runId: run.id,
      state: BILLING_RECONCILIATION_STATES.COMPLETED,
      provider: provider.name,
      trigger,
      checked,
      mismatches: findings.length,
      repaired,
      findings,
      correlationId: corr,
      run: closed,
    };
  } catch (err) {
    // A failed run is recorded as failed. A run left in `running` forever is indistinguishable from a
    // scheduler that stopped, which is exactly the blindness this whole feature exists to remove.
    await closeRun(supabase, run.id, {
      state: BILLING_RECONCILIATION_STATES.FAILED,
      checked_count: checked,
      mismatch_count: findings.length,
      repaired_count: repaired,
      findings,
      last_error: String(err?.message || 'reconciliation failed').slice(0, 500),
    }).catch(() => { /* the original error is what matters */ });
    reconciliationFailed({ correlationId: corr, runId: run.id, provider: provider.name, reason: err?.message });
    throw err;
  }
}

/**
 * Repair, in the safe direction only.
 *
 * Applies when the provider reports a NON-access-granting terminal status and we still show something
 * else. Never the reverse — restoring access from a provider read would let one bad response undo a
 * deliberate human revocation.
 */
async function maybeRepair(supabase, { local, remote, findings }) {
  const statusFinding = findings.find((f) => f.kind === MISMATCH_KINDS.STATUS);
  if (!statusFinding) return false;
  const remoteStatus = String(remote.status || '').toLowerCase();
  if (!SAFE_REPAIR_STATUSES.includes(remoteStatus)) return false;

  const { error } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .update({ status: remoteStatus, updated_at: new Date().toISOString() })
    .eq('id', local.id);
  if (error) throw new Error(`Failed to repair subscription during reconciliation: ${error.message}`);

  emitBillingSignal(BILLING_EVENTS.RECONCILIATION_MISMATCH, {
    tenantId: local.tenant_id,
    field: 'status',
    kind: 'REPAIRED',
    expected: remoteStatus,
    actual: statusFinding.actual,
    subscription: fingerprint(local.id),
  }, 'warn');
  return true;
}

/** Operator read: recent runs, newest first. */
export async function listReconciliationRuns({ tenantId = null, limit = 20, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(RECONCILIATION_RUNS_TABLE)
    .select('id, tenant_id, provider, trigger, state, started_at, finished_at, checked_count, mismatch_count, repaired_count, findings, initiated_by, last_error')
    .order('started_at', { ascending: false })
    .limit(Math.min(Number(limit) || 20, 100));
  if (tenantId) query = query.eq('tenant_id', String(tenantId));
  const { data, error } = await query;
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to list reconciliation runs: ${error.message}`);
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Freshness: how long since a run COMPLETED.
 *
 * The most dangerous reconciliation failure is not a mismatch, it is silence — nobody notices the
 * scheduler stopped. `stale` answers the question an alert should be asking.
 */
export async function reconciliationFreshness({ maxAgeMinutes = 1440, now = null, supabaseClient = null } = {}) {
  const runs = await listReconciliationRuns({ limit: 20, supabaseClient });
  const completed = runs.filter((r) => r.state === BILLING_RECONCILIATION_STATES.COMPLETED);
  const clock = now ? new Date(now) : new Date();
  if (!completed.length) {
    return { lastCompletedAt: null, ageMinutes: null, stale: true, reason: 'NEVER_COMPLETED' };
  }
  const last = completed
    .map((r) => r.finished_at || r.started_at)
    .filter(Boolean)
    .sort()
    .pop();
  const ageMinutes = Math.round((clock.getTime() - Date.parse(last)) / 60000);
  return {
    lastCompletedAt: last,
    ageMinutes,
    stale: ageMinutes > maxAgeMinutes,
    reason: ageMinutes > maxAgeMinutes ? 'STALE' : null,
  };
}
