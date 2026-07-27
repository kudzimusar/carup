/**
 * Billing reconciliation, observability and checkout-abandonment (Issue #127, Deliverable D).
 *
 * Reconciliation exists because every other detection mechanism is silent. A webhook that never
 * arrives produces no error; a secret rotation that drops an hour of deliveries produces no error; a
 * rail whose callback its own provider documents as unreliable produces no error. The system simply
 * keeps serving whatever it last believed, in whichever direction costs money.
 *
 * So the assertions here are about the DIRECTIONS of drift and about the honesty of the run record:
 *   - drift is detected both ways (serving a cancelled tenant / cancelling a paying one);
 *   - findings are sanitized — a findings blob that carried customer identity would be a new PII sink
 *     with a long retention;
 *   - a failed run is recorded as FAILED, never left `running`, because a run stuck in `running` is
 *     indistinguishable from a scheduler that stopped weeks ago;
 *   - repair is off by default and, when on, only in the direction that cannot revoke paid access.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const recon = await import('../services/diaspora/billing/diasporaBillingReconciliationService.js');
const checkout = await import('../services/diaspora/billing/diasporaBillingCheckoutSessionService.js');
const obs = await import('../services/diaspora/billing/diasporaBillingObservability.js');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function db(seed = {}) {
  return createMockSupabase({
    diaspora_subscriptions: [],
    diaspora_billing_reconciliation_runs: [],
    diaspora_billing_checkout_sessions: [],
    ...seed,
  }, { rpc: DIASPORA_RPCS });
}

function subscription(overrides = {}) {
  return {
    id: `sub-${overrides.tenant_id || TENANT_A}`,
    tenant_id: TENANT_A,
    plan_key: 'seller',
    status: 'active',
    current_period_start: '2026-06-01T00:00:00.000Z',
    current_period_end: '2026-07-01T00:00:00.000Z',
    cancel_at_period_end: false,
    provider: 'sandbox',
    provider_customer_ref: 'cus_1',
    provider_subscription_ref: 'sub_ref_1',
    deleted_at: null,
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A provider stub whose getSubscription is a pure read — the reconciliation contract. */
function providerReturning(map, { name = 'sandbox_test', onRead = null } = {}) {
  return {
    name,
    reads: [],
    async getSubscription({ tenantId, subscriptionRef }) {
      this.reads.push({ tenantId, subscriptionRef });
      if (onRead) onRead({ tenantId, subscriptionRef });
      return map[subscriptionRef] ?? null;
    },
  };
}

beforeEach(() => obs.clearBillingSignals());

// ── Detection, both directions ──────────────────────────────────────────────────────────────────

test('provider says CANCELLED while we say ACTIVE — we are serving a tenant who stopped paying', async () => {
  const client = db({ diaspora_subscriptions: [subscription({ status: 'active' })] });
  const provider = providerReturning({ sub_ref_1: { status: 'cancelled', planKey: 'seller' } });

  const result = await recon.runBillingReconciliation({
    billingProvider: provider, supabaseClient: client, trigger: 'operator',
  });

  assert.equal(result.checked, 1);
  assert.equal(result.mismatches, 1);
  const finding = result.findings[0];
  assert.equal(finding.kind, recon.MISMATCH_KINDS.STATUS);
  assert.equal(finding.expected, 'cancelled', 'the provider is authoritative on status');
  assert.equal(finding.actual, 'active');
  assert.equal(finding.tenantId, TENANT_A);

  // Detection alone must NOT change the ledger: repair is opt-in.
  assert.equal(client._rows('diaspora_subscriptions')[0].status, 'active');
  assert.equal(result.repaired, 0);
});

test('provider says ACTIVE while we say CANCELLED — we are charging a tenant who gets nothing', async () => {
  const client = db({ diaspora_subscriptions: [subscription({ status: 'cancelled' })] });
  const provider = providerReturning({ sub_ref_1: { status: 'active', planKey: 'seller' } });
  const result = await recon.runBillingReconciliation({ billingProvider: provider, supabaseClient: client });
  assert.equal(result.mismatches, 1);
  assert.equal(result.findings[0].expected, 'active');
  assert.equal(result.findings[0].actual, 'cancelled');
});

test('a plan mismatch is detected separately from a status mismatch', async () => {
  const client = db({ diaspora_subscriptions: [subscription({ plan_key: 'seller' })] });
  const provider = providerReturning({ sub_ref_1: { status: 'active', planKey: 'enterprise' } });
  const result = await recon.runBillingReconciliation({ billingProvider: provider, supabaseClient: client });
  assert.equal(result.mismatches, 1);
  assert.equal(result.findings[0].kind, recon.MISMATCH_KINDS.PLAN);
  assert.equal(result.findings[0].expected, 'enterprise');
});

test('a subscription the provider has never heard of is reported, not skipped', async () => {
  const client = db({ diaspora_subscriptions: [subscription()] });
  const provider = providerReturning({}); // returns null
  const result = await recon.runBillingReconciliation({ billingProvider: provider, supabaseClient: client });
  assert.equal(result.findings[0].kind, recon.MISMATCH_KINDS.MISSING_AT_PROVIDER);
});

test('a local row with no provider handle is itself the finding (it can never be reconciled)', async () => {
  const client = db({ diaspora_subscriptions: [subscription({ provider_subscription_ref: null })] });
  const provider = providerReturning({});
  const result = await recon.runBillingReconciliation({ billingProvider: provider, supabaseClient: client });
  assert.equal(result.findings[0].kind, recon.MISMATCH_KINDS.NO_PROVIDER_REF);
  assert.equal(provider.reads.length, 0, 'and no pointless provider call is made');
});

test('period end is compared at DAY granularity so ordinary clock skew is not reported as drift', async () => {
  const client = db({
    diaspora_subscriptions: [subscription({ current_period_end: '2026-07-01T00:00:03.000Z' })],
  });
  const sameDay = providerReturning({
    sub_ref_1: { status: 'active', planKey: 'seller', currentPeriodEnd: '2026-07-01T00:00:00.000Z' },
  });
  const same = await recon.runBillingReconciliation({ billingProvider: sameDay, supabaseClient: client });
  assert.equal(same.mismatches, 0, 'three seconds apart is not drift');

  const differentDay = providerReturning({
    sub_ref_1: { status: 'active', planKey: 'seller', currentPeriodEnd: '2026-08-01T00:00:00.000Z' },
  });
  const different = await recon.runBillingReconciliation({ billingProvider: differentDay, supabaseClient: client });
  assert.equal(different.findings[0].kind, recon.MISMATCH_KINDS.PERIOD_END, 'a month apart is');
});

test('the cancel-at-period-end flag drifting is detected (a silent renewal or a silent lapse)', async () => {
  const client = db({ diaspora_subscriptions: [subscription({ cancel_at_period_end: false })] });
  const provider = providerReturning({
    sub_ref_1: { status: 'active', planKey: 'seller', cancelAtPeriodEnd: true },
  });
  const result = await recon.runBillingReconciliation({ billingProvider: provider, supabaseClient: client });
  assert.equal(result.findings[0].kind, recon.MISMATCH_KINDS.CANCEL_FLAG);
});

test('a matching subscription produces no findings and still records a completed run', async () => {
  const client = db({ diaspora_subscriptions: [subscription()] });
  const provider = providerReturning({
    sub_ref_1: { status: 'active', planKey: 'seller', currentPeriodEnd: '2026-07-01T00:00:00.000Z', cancelAtPeriodEnd: false },
  });
  const result = await recon.runBillingReconciliation({ billingProvider: provider, supabaseClient: client });
  assert.equal(result.mismatches, 0);
  const run = client._rows('diaspora_billing_reconciliation_runs')[0];
  assert.equal(run.state, 'completed');
  assert.equal(run.checked_count, 1);
  assert.ok(run.finished_at, '"we checked and found nothing" must be distinguishable from "we never ran"');
});

// ── Run durability and honesty ──────────────────────────────────────────────────────────────────

test('one unreadable subscription does not abort the run for every other tenant', async () => {
  const client = db({
    diaspora_subscriptions: [
      subscription({ id: 'sub-a', tenant_id: TENANT_A, provider_subscription_ref: 'sub_ref_broken' }),
      subscription({ id: 'sub-b', tenant_id: TENANT_B, provider_subscription_ref: 'sub_ref_ok' }),
    ],
  });
  const provider = {
    name: 'sandbox_test',
    async getSubscription({ subscriptionRef }) {
      if (subscriptionRef === 'sub_ref_broken') {
        const err = new Error('provider unavailable');
        err.code = 'PROVIDER_RATE_LIMITED';
        throw err;
      }
      return { status: 'active', planKey: 'seller' };
    },
  };
  const result = await recon.runBillingReconciliation({ billingProvider: provider, supabaseClient: client });
  assert.equal(result.checked, 2, 'both were checked');
  assert.equal(result.state, 'completed');
  const unreadable = result.findings.find((f) => f.kind === recon.MISMATCH_KINDS.UNREADABLE_AT_PROVIDER);
  assert.equal(unreadable.actual, 'PROVIDER_RATE_LIMITED', 'and the reason is recorded, not swallowed');
});

test('a run that throws is recorded as FAILED, never left "running"', async () => {
  const client = db({ diaspora_subscriptions: [subscription()] });
  // Break the subscription LOAD, which is outside the per-row try/catch.
  const original = client.from;
  client.from = (table) => {
    if (table !== 'diaspora_subscriptions') return original(table);
    const chain = {
      select() { return chain; }, is() { return chain; }, order() { return chain; },
      limit() { return chain; }, eq() { return chain; },
      then(resolve) { return Promise.resolve({ data: null, error: { code: '08006', message: 'connection lost' } }).then(resolve); },
    };
    return chain;
  };

  await assert.rejects(
    () => recon.runBillingReconciliation({ billingProvider: providerReturning({}), supabaseClient: client }),
    /connection lost/,
  );
  const run = client._rows('diaspora_billing_reconciliation_runs')[0];
  assert.equal(run.state, 'failed');
  assert.ok(run.finished_at);
  assert.match(run.last_error, /connection lost/);
});

test('the run row records the trigger and who asked for it', async () => {
  const client = db({ diaspora_subscriptions: [subscription()] });
  await recon.runBillingReconciliation({
    billingProvider: providerReturning({ sub_ref_1: { status: 'active', planKey: 'seller' } }),
    supabaseClient: client,
    trigger: 'operator',
    tenantId: TENANT_A,
    initiatedBy: 'user-ops',
  });
  const run = client._rows('diaspora_billing_reconciliation_runs')[0];
  assert.equal(run.trigger, 'operator');
  assert.equal(run.initiated_by, 'user-ops');
  assert.equal(run.tenant_id, TENANT_A);
});

test('a tenant-scoped run does not read other tenants', async () => {
  const client = db({
    diaspora_subscriptions: [
      subscription({ id: 'sub-a', tenant_id: TENANT_A }),
      subscription({ id: 'sub-b', tenant_id: TENANT_B, provider_subscription_ref: 'sub_ref_b' }),
    ],
  });
  const provider = providerReturning({
    sub_ref_1: { status: 'active', planKey: 'seller' },
    sub_ref_b: { status: 'active', planKey: 'seller' },
  });
  const result = await recon.runBillingReconciliation({
    billingProvider: provider, supabaseClient: client, tenantId: TENANT_A,
  });
  assert.equal(result.checked, 1);
  assert.deepEqual(provider.reads.map((r) => r.tenantId), [TENANT_A]);
});

test('a soft-deleted subscription is not reconciled', async () => {
  const client = db({
    diaspora_subscriptions: [subscription({ deleted_at: '2026-06-15T00:00:00.000Z' })],
  });
  const result = await recon.runBillingReconciliation({
    billingProvider: providerReturning({}), supabaseClient: client,
  });
  assert.equal(result.checked, 0);
});

// ── Findings are sanitized ──────────────────────────────────────────────────────────────────────

test('findings carry tenant + field + STATES only — never customer identity or amounts', async () => {
  const client = db({ diaspora_subscriptions: [subscription()] });
  const provider = providerReturning({
    sub_ref_1: {
      status: 'cancelled',
      planKey: 'seller',
      // A realistic provider snapshot carries far more than we should ever persist.
      customerEmail: 'buyer@example.com',
      customerName: 'A Person',
      amountDue: 4900,
      card: { last4: '4242' },
    },
  });
  const result = await recon.runBillingReconciliation({ billingProvider: provider, supabaseClient: client });

  const serialized = JSON.stringify(client._rows('diaspora_billing_reconciliation_runs')[0].findings);
  assert.ok(!serialized.includes('buyer@example.com'));
  assert.ok(!serialized.includes('A Person'));
  assert.ok(!serialized.includes('4242'));
  assert.ok(!serialized.includes('4900'));
  for (const f of result.findings) {
    assert.deepEqual(Object.keys(f).sort(), ['actual', 'expected', 'field', 'kind', 'tenantId'].sort());
  }
});

// ── Repair policy ───────────────────────────────────────────────────────────────────────────────

test('repair is OFF by default even when a repairable mismatch exists', async () => {
  const client = db({ diaspora_subscriptions: [subscription({ status: 'active' })] });
  const provider = providerReturning({ sub_ref_1: { status: 'cancelled', planKey: 'seller' } });
  const result = await recon.runBillingReconciliation({ billingProvider: provider, supabaseClient: client });
  assert.equal(result.repaired, 0);
  assert.equal(client._rows('diaspora_subscriptions')[0].status, 'active');
});

test('repair, when enabled, applies the SAFE direction (stop serving a cancelled tenant)', async () => {
  const client = db({ diaspora_subscriptions: [subscription({ status: 'active' })] });
  const provider = providerReturning({ sub_ref_1: { status: 'cancelled', planKey: 'seller' } });
  const result = await recon.runBillingReconciliation({
    billingProvider: provider, supabaseClient: client, repair: true,
  });
  assert.equal(result.repaired, 1);
  assert.equal(client._rows('diaspora_subscriptions')[0].status, 'cancelled');
  const run = client._rows('diaspora_billing_reconciliation_runs')[0];
  assert.equal(run.repaired_count, 1, 'and the repair is recorded, not silent');
});

test('repair NEVER restores access a human revoked, even with repair enabled', async () => {
  // Provider says active, we say cancelled. Auto-applying this would let one bad provider read undo a
  // deliberate revocation — the asymmetry is the entire repair policy.
  const client = db({ diaspora_subscriptions: [subscription({ status: 'cancelled' })] });
  const provider = providerReturning({ sub_ref_1: { status: 'active', planKey: 'seller' } });
  const result = await recon.runBillingReconciliation({
    billingProvider: provider, supabaseClient: client, repair: true,
  });
  assert.equal(result.mismatches, 1, 'still reported');
  assert.equal(result.repaired, 0, 'but never applied');
  assert.equal(client._rows('diaspora_subscriptions')[0].status, 'cancelled');
});

test('repair never touches a plan mismatch (only status has a safe direction)', async () => {
  const client = db({ diaspora_subscriptions: [subscription({ plan_key: 'seller' })] });
  const provider = providerReturning({ sub_ref_1: { status: 'active', planKey: 'enterprise' } });
  const result = await recon.runBillingReconciliation({
    billingProvider: provider, supabaseClient: client, repair: true,
  });
  assert.equal(result.repaired, 0);
  assert.equal(client._rows('diaspora_subscriptions')[0].plan_key, 'seller');
});

// ── Freshness: silence is the dangerous failure ─────────────────────────────────────────────────

test('freshness reports NEVER_COMPLETED when no run has ever finished', async () => {
  const fresh = await recon.reconciliationFreshness({ supabaseClient: db() });
  assert.equal(fresh.stale, true);
  assert.equal(fresh.reason, 'NEVER_COMPLETED');
});

test('freshness reports STALE when the last completed run is older than the window', async () => {
  const client = db({
    diaspora_billing_reconciliation_runs: [{
      id: 'run-old', provider: 'sandbox', trigger: 'scheduled', state: 'completed',
      started_at: '2026-06-01T00:00:00.000Z', finished_at: '2026-06-01T00:05:00.000Z',
      checked_count: 5, mismatch_count: 0, repaired_count: 0, findings: [],
    }],
  });
  const fresh = await recon.reconciliationFreshness({
    supabaseClient: client, now: '2026-06-21T00:00:00.000Z', maxAgeMinutes: 1440,
  });
  assert.equal(fresh.stale, true);
  assert.equal(fresh.reason, 'STALE');
  assert.ok(fresh.ageMinutes > 1440);
});

test('a run that is still RUNNING does not count as fresh', async () => {
  const client = db({
    diaspora_billing_reconciliation_runs: [{
      id: 'run-stuck', provider: 'sandbox', trigger: 'scheduled', state: 'running',
      started_at: '2026-06-21T00:00:00.000Z', finished_at: null,
      checked_count: 0, mismatch_count: 0, repaired_count: 0, findings: [],
    }],
  });
  const fresh = await recon.reconciliationFreshness({ supabaseClient: client, now: '2026-06-21T00:10:00.000Z' });
  assert.equal(fresh.stale, true);
  assert.equal(fresh.reason, 'NEVER_COMPLETED');
});

// ── Observability ───────────────────────────────────────────────────────────────────────────────

test('a mismatch emits a signal carrying the correlation and run ids', async () => {
  const client = db({ diaspora_subscriptions: [subscription({ status: 'active' })] });
  const provider = providerReturning({ sub_ref_1: { status: 'cancelled', planKey: 'seller' } });
  const result = await recon.runBillingReconciliation({
    billingProvider: provider, supabaseClient: client, correlationId: 'corr-recon-1',
  });
  const signals = obs.recentBillingSignals(obs.BILLING_EVENTS.RECONCILIATION_MISMATCH);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].correlationId, 'corr-recon-1');
  assert.equal(signals[0].runId, result.runId);
});

test('redaction drops PII and FINGERPRINTS provider refs so correlation survives without identity', () => {
  const redacted = obs.redactBillingMeta({
    tenantId: TENANT_A,
    customerEmail: 'buyer@example.com',
    billing: { name: 'A Person', address: { line1: '1 Road' } },
    card: { last4: '4242', fingerprint: 'fp_x' },
    providerCustomerRef: 'cus_123',
    planKey: 'seller',
  });
  assert.equal(redacted.tenantId, TENANT_A, 'a tenant id is our own identifier and stays');
  assert.equal(redacted.planKey, 'seller');
  assert.equal(redacted.customerEmail, '[REDACTED]');
  assert.equal(redacted.billing.name, '[REDACTED]');
  assert.equal(redacted.card, '[REDACTED]');
  assert.match(redacted.providerCustomerRef, /^fp_/);
  assert.notEqual(redacted.providerCustomerRef, 'cus_123');
});

test('the same provider ref fingerprints identically, so log lines still correlate', () => {
  assert.equal(obs.fingerprint('cus_123'), obs.fingerprint('cus_123'));
  assert.notEqual(obs.fingerprint('cus_123'), obs.fingerprint('cus_456'));
  assert.equal(obs.fingerprint(null), null);
});

test('an observability failure never propagates into the operation it observes', () => {
  const circular = {};
  circular.self = circular; // JSON.stringify inside the logger would throw
  assert.doesNotThrow(() => obs.emitBillingSignal('billing.test', circular));
});

test('quota anomalies distinguish a burst from exhaustion', () => {
  obs.clearBillingSignals();
  const burst = obs.detectQuotaAnomaly({
    tenantId: TENANT_A, featureKey: 'diaspora.ai.execute_medium',
    limit: 100, used: 60, reservedNow: 60, windowMinutes: 5,
  });
  assert.equal(burst.length, 1);
  assert.equal(burst[0].kind, 'BURST');

  const exhausted = obs.detectQuotaAnomaly({
    tenantId: TENANT_A, featureKey: 'diaspora.ai.execute_medium', limit: 100, used: 100,
  });
  assert.equal(exhausted[0].kind, 'EXHAUSTED');

  // Normal usage is not an anomaly — a detector that fires constantly is a detector nobody reads.
  assert.equal(obs.detectQuotaAnomaly({
    tenantId: TENANT_A, featureKey: 'diaspora.ai.execute_medium', limit: 100, used: 3, reservedNow: 1, windowMinutes: 5,
  }).length, 0);
});

test('a zero-limit feature produces no quota anomaly (a denial is not an anomaly)', () => {
  assert.equal(obs.detectQuotaAnomaly({
    tenantId: TENANT_A, featureKey: 'diaspora.ai.execute_medium', limit: 0, used: 0,
  }).length, 0);
});

// ── Checkout abandonment ────────────────────────────────────────────────────────────────────────

test('an open checkout past the window is swept to abandoned and emits the signal', async () => {
  const client = db({
    diaspora_billing_checkout_sessions: [{
      id: 'cs-1', tenant_id: TENANT_A, provider: 'sandbox', session_ref: 'sbx_cs_1',
      plan_key: 'seller', state: 'open', opened_at: '2026-06-21T10:00:00.000Z',
      correlation_id: 'corr-cs-1', detail: {},
    }],
  });
  const result = await checkout.sweepAbandonedCheckouts({
    supabaseClient: client, now: '2026-06-21T12:00:00.000Z', olderThanMinutes: 60,
  });
  assert.equal(result.swept, 1);
  const row = client._rows('diaspora_billing_checkout_sessions')[0];
  assert.equal(row.state, 'abandoned');
  assert.ok(row.abandoned_at);

  const signals = obs.recentBillingSignals(obs.BILLING_EVENTS.CHECKOUT_ABANDONED);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].openMinutes, 120);
  assert.equal(signals[0].correlationId, 'corr-cs-1');
});

test('a checkout still inside the window is left alone', async () => {
  const client = db({
    diaspora_billing_checkout_sessions: [{
      id: 'cs-2', tenant_id: TENANT_A, provider: 'sandbox', session_ref: 'sbx_cs_2',
      plan_key: 'seller', state: 'open', opened_at: '2026-06-21T11:50:00.000Z', detail: {},
    }],
  });
  const result = await checkout.sweepAbandonedCheckouts({
    supabaseClient: client, now: '2026-06-21T12:00:00.000Z', olderThanMinutes: 60,
  });
  assert.equal(result.swept, 0);
  assert.equal(client._rows('diaspora_billing_checkout_sessions')[0].state, 'open');
});

test('a completed checkout is never swept, and completion is idempotent', async () => {
  const client = db({
    diaspora_billing_checkout_sessions: [{
      id: 'cs-3', tenant_id: TENANT_A, provider: 'sandbox', session_ref: 'sbx_cs_3',
      plan_key: 'seller', state: 'open', opened_at: '2026-06-21T09:00:00.000Z', detail: {},
    }],
  });
  await checkout.markCheckoutCompleted({
    tenantId: TENANT_A, provider: 'sandbox', sessionRef: 'sbx_cs_3',
    supabaseClient: client, now: '2026-06-21T09:05:00.000Z',
  });
  assert.equal(client._rows('diaspora_billing_checkout_sessions')[0].state, 'completed');

  obs.clearBillingSignals();
  // A provider retry of the completion webhook must not double-count the funnel.
  await checkout.markCheckoutCompleted({
    tenantId: TENANT_A, provider: 'sandbox', sessionRef: 'sbx_cs_3',
    supabaseClient: client, now: '2026-06-21T09:30:00.000Z',
  });
  assert.equal(obs.recentBillingSignals(obs.BILLING_EVENTS.CHECKOUT_COMPLETED).length, 0);
  assert.equal(client._rows('diaspora_billing_checkout_sessions')[0].completed_at, '2026-06-21T09:05:00.000Z');

  const swept = await checkout.sweepAbandonedCheckouts({
    supabaseClient: client, now: '2026-06-22T00:00:00.000Z', olderThanMinutes: 60,
  });
  assert.equal(swept.swept, 0);
});

test('a rail that mints no session handle still attributes completion to the open session', async () => {
  const client = db({
    diaspora_billing_checkout_sessions: [{
      id: 'cs-4', tenant_id: TENANT_A, provider: 'paynow', session_ref: null,
      plan_key: 'seller', state: 'open', opened_at: '2026-06-21T09:00:00.000Z', detail: {},
    }],
  });
  const completed = await checkout.markCheckoutCompleted({
    tenantId: TENANT_A, provider: 'paynow', sessionRef: null, supabaseClient: client,
  });
  assert.equal(completed.state, 'completed');
});

test('recording a checkout is best effort — a write failure never blocks the customer', async () => {
  const client = db();
  client.from = () => {
    const chain = {
      insert() { return chain; }, select() { return chain; }, single() { return chain; },
      then(resolve) { return Promise.resolve({ data: null, error: { message: 'table missing' } }).then(resolve); },
    };
    return chain;
  };
  const result = await checkout.recordCheckoutOpened({
    tenantId: TENANT_A, provider: 'sandbox', planKey: 'seller', supabaseClient: client,
  });
  assert.equal(result, null, 'no throw — a metrics row must never stop a payment');
});

test('the funnel rate is computed over DECIDED sessions, not over recent traffic', async () => {
  const client = db({
    diaspora_billing_checkout_sessions: [
      { id: 'a', tenant_id: TENANT_A, provider: 'sandbox', plan_key: 'seller', state: 'completed' },
      { id: 'b', tenant_id: TENANT_A, provider: 'sandbox', plan_key: 'seller', state: 'abandoned' },
      { id: 'c', tenant_id: TENANT_A, provider: 'sandbox', plan_key: 'seller', state: 'abandoned' },
      // Ten still-open sessions would drag a naive rate down to 0.17 and hide the real 0.67.
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `open-${i}`, tenant_id: TENANT_A, provider: 'sandbox', plan_key: 'seller', state: 'open',
      })),
    ],
  });
  const summary = await checkout.checkoutFunnelSummary({ tenantId: TENANT_A, supabaseClient: client });
  assert.equal(summary.counts.abandoned, 2);
  assert.equal(summary.counts.completed, 1);
  assert.equal(summary.abandonmentRate, 0.667);
});

test('the funnel rate is null rather than 0 when nothing has been decided yet', async () => {
  const client = db({
    diaspora_billing_checkout_sessions: [
      { id: 'a', tenant_id: TENANT_A, provider: 'sandbox', plan_key: 'seller', state: 'open' },
    ],
  });
  const summary = await checkout.checkoutFunnelSummary({ tenantId: TENANT_A, supabaseClient: client });
  assert.equal(summary.abandonmentRate, null, 'a fabricated 0% would read as "nobody abandons"');
});

test('the sweep is bounded so it always terminates', async () => {
  const many = Array.from({ length: 300 }, (_, i) => ({
    id: `cs-${i}`, tenant_id: TENANT_A, provider: 'sandbox', session_ref: `ref-${i}`,
    plan_key: 'seller', state: 'open', opened_at: '2026-06-01T00:00:00.000Z', detail: {},
  }));
  const client = db({ diaspora_billing_checkout_sessions: many });
  const result = await checkout.sweepAbandonedCheckouts({
    supabaseClient: client, now: '2026-06-21T00:00:00.000Z', olderThanMinutes: 60, limit: 50,
  });
  assert.equal(result.swept, 50);
  assert.equal(client._rows('diaspora_billing_checkout_sessions').filter((r) => r.state === 'open').length, 250);
});
