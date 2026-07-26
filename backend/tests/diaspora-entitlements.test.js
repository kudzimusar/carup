/**
 * Phase 8 backend tests — subscription resolution, effective entitlements (plan + per-user override),
 * feature/quota checks with explainable denials, atomic + idempotent usage reservation, release after
 * a simulated failed domain op, cross-tenant isolation, and audited admin override.
 *
 * Uses the in-memory mock Supabase + the JS RPC reference (the mock cannot execute the SQL RPC, so
 * diaspora_reserve_usage_atomic is stubbed in diasporaRpcReference.js to mirror the SQL semantics).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const ent = await import('../services/diaspora/diasporaEntitlementService.js');
const { FEATURE_KEYS, PLAN_CATALOG } = await import('../constants/diaspora/diasporaEntitlements.js');
const billing = await import('../services/diaspora/billing/billingProvider.js');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const platformAdmin = { id: 'admin-1', platformRole: 'platform_admin' };

// Seed the plan catalog rows from the config catalog so the DB path is exercised (the service falls
// back to PLAN_CATALOG when a row is absent — covered by the config-fallback test).
function seedPlans() {
  return Object.entries(PLAN_CATALOG).map(([plan_key, p]) => ({
    plan_key, name: p.name, tier: p.tier, entitlements: p.entitlements, is_active: true, sort_order: p.sort_order, deleted_at: null,
  }));
}

function subscriptionRow(tenantId, planKey, status = 'active', extra = {}) {
  return {
    id: `sub-${tenantId}-${planKey}`,
    tenant_id: tenantId,
    plan_key: planKey,
    status,
    created_at: new Date(2026, 5, 1).toISOString(),
    deleted_at: null,
    ...extra,
  };
}

function clientWith({ subscriptions = [], overrides = [], meters = [], reservations = [], plans = seedPlans() } = {}) {
  return createMockSupabase({
    diaspora_subscription_plans: plans,
    diaspora_subscriptions: subscriptions,
    diaspora_user_entitlement_overrides: overrides,
    diaspora_usage_meters: meters,
    diaspora_usage_reservations: reservations,
    diaspora_import_audit_log: [],
  }, { rpc: DIASPORA_RPCS });
}

// ── Subscription resolution ──

test('a tenant with no subscription resolves to the synthetic Free default', async () => {
  const client = clientWith();
  const sub = await ent.resolveSubscription(client, TENANT_A);
  assert.equal(sub.plan_key, 'free');
  assert.equal(sub.synthetic, true);
});

test('Free tenant is blocked from stock.publish but may download workbooks', async () => {
  const client = clientWith();
  const publish = await ent.checkFeature(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.STOCK_PUBLISH });
  assert.equal(publish.allowed, false);
  assert.equal(publish.reason.code, 'FEATURE_NOT_IN_PLAN');
  assert.equal(publish.requiredPlan, 'seller'); // lowest plan granting stock.publish
  const download = await ent.checkFeature(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.WORKBOOK_DOWNLOAD });
  assert.equal(download.allowed, true);
});

// ── Plan capability matrix ──

test('buyer plan allows rfq.create but denies stock.publish', async () => {
  const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'diaspora_buyer')] });
  const rfq = await ent.checkFeature(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.RFQ_CREATE });
  assert.equal(rfq.allowed, true);
  const publish = await ent.checkFeature(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.STOCK_PUBLISH });
  assert.equal(publish.allowed, false);
});

test('seller plan allows stock.publish but denies api.access', async () => {
  const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'seller')] });
  const publish = await ent.checkFeature(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.STOCK_PUBLISH });
  assert.equal(publish.allowed, true);
  const api = await ent.checkFeature(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.API_ACCESS });
  assert.equal(api.allowed, false);
  assert.equal(api.requiredPlan, 'enterprise');
});

test('Trade Pro gets container + higher rfq quota; Enterprise gets api.access', async () => {
  const pro = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'trade_pro')] });
  const container = await ent.checkFeature(pro, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.CONTAINER_RESERVE });
  assert.equal(container.allowed, true);
  const proRfqQuota = await ent.checkQuota(pro, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.RFQ_MAX_OPEN });
  assert.equal(proRfqQuota.limit, 100);

  const ent2 = clientWith({ subscriptions: [subscriptionRow(TENANT_B, 'enterprise')] });
  const api = await ent.checkFeature(ent2, { tenantId: TENANT_B, featureKey: FEATURE_KEYS.API_ACCESS });
  assert.equal(api.allowed, true);
  const entRfqQuota = await ent.checkQuota(ent2, { tenantId: TENANT_B, featureKey: FEATURE_KEYS.RFQ_MAX_OPEN });
  assert.equal(entRfqQuota.limit, 1000);
});

// ── Subscription lifecycle policy ──

test('expired / cancelled / past_due fall back to Free (no access to paid features)', async () => {
  for (const status of ['expired', 'cancelled', 'past_due', 'paused', 'suspended', 'incomplete']) {
    const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'seller', status)] });
    const sub = await ent.resolveSubscription(client, TENANT_A);
    assert.equal(sub.plan_key, 'free', `status ${status} should not grant the seller plan`);
    const publish = await ent.checkFeature(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.STOCK_PUBLISH });
    assert.equal(publish.allowed, false, `status ${status} should deny stock.publish`);
  }
});

test('trialing and grace_period are access-granting', async () => {
  for (const status of ['trialing', 'grace_period', 'active']) {
    const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'seller', status)] });
    const publish = await ent.checkFeature(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.STOCK_PUBLISH });
    assert.equal(publish.allowed, true, `status ${status} should grant stock.publish`);
  }
});

// ── Per-user overrides ──

test('a per-user override can widen a feature beyond the tenant plan', async () => {
  const client = clientWith({
    subscriptions: [subscriptionRow(TENANT_A, 'diaspora_buyer')],
    overrides: [{ id: 'ov-1', tenant_id: TENANT_A, user_id: 'user-x', feature_key: FEATURE_KEYS.API_ACCESS, value: true, deleted_at: null }],
  });
  const denied = await ent.checkFeature(client, { tenantId: TENANT_A, userId: 'user-y', featureKey: FEATURE_KEYS.API_ACCESS });
  assert.equal(denied.allowed, false);
  const allowed = await ent.checkFeature(client, { tenantId: TENANT_A, userId: 'user-x', featureKey: FEATURE_KEYS.API_ACCESS });
  assert.equal(allowed.allowed, true);
});

test('the plan catalog falls back to config when the DB plans table is empty', async () => {
  const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'seller')], plans: [] });
  const effective = await ent.resolveEffectiveEntitlements(client, TENANT_A, null);
  assert.equal(effective.source, 'config');
  const publish = await ent.checkFeature(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.STOCK_PUBLISH });
  assert.equal(publish.allowed, true);
});

// ── Atomic + idempotent usage reservation ──

test('reserveUsage is atomic and idempotent on the idempotency key', async () => {
  const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'trade_pro')] });
  const a = await ent.reserveUsage(client, { tenantId: TENANT_A, userId: 'u1', featureKey: FEATURE_KEYS.WORKBOOK_BULK_IMPORT, amount: 1, idempotencyKey: 'imp-1' });
  assert.equal(a.reserved, 1);
  assert.equal(a.used, 1);
  assert.equal(a.idempotentReplay, false);

  const replay = await ent.reserveUsage(client, { tenantId: TENANT_A, userId: 'u1', featureKey: FEATURE_KEYS.WORKBOOK_BULK_IMPORT, amount: 1, idempotencyKey: 'imp-1' });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.reservationId, a.reservationId);

  // One consumption only, despite two calls with the same key.
  const meter = client._rows('diaspora_usage_meters').find((m) => m.feature_key === FEATURE_KEYS.WORKBOOK_BULK_IMPORT);
  assert.equal(meter.used_count, 1);
  assert.equal(client._rows('diaspora_usage_reservations').length, 1);
});

test('reserveUsage rejects with an explainable denial when the quota is exhausted', async () => {
  // diaspora_buyer has bulk_import quota 0, so any reservation is denied before the RPC.
  const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'diaspora_buyer')] });
  await assert.rejects(
    () => ent.reserveUsage(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.WORKBOOK_BULK_IMPORT, idempotencyKey: 'k1' }),
    (err) => {
      assert.ok(/quota|not available/i.test(err.message));
      assert.ok(err.details && err.details.requiredPlan === 'trade_pro');
      return true;
    },
  );
});

test('reserveUsage denies once the per-period ceiling is reached (RPC enforces quota)', async () => {
  // trade_pro bulk_import quota is 200; pre-fill the meter to the ceiling.
  const periodStart = ent.currentPeriodStart();
  const client = clientWith({
    subscriptions: [subscriptionRow(TENANT_A, 'trade_pro')],
    meters: [{ id: 'm-full', tenant_id: TENANT_A, feature_key: FEATURE_KEYS.WORKBOOK_BULK_IMPORT, period_start: periodStart, used_count: 200 }],
  });
  await assert.rejects(
    () => ent.reserveUsage(client, { tenantId: TENANT_A, featureKey: FEATURE_KEYS.WORKBOOK_BULK_IMPORT, amount: 1, idempotencyKey: 'over-1', periodStart }),
    (err) => {
      assert.equal(err.details.code, 'QUOTA_EXCEEDED');
      return true;
    },
  );
});

// ── Commit / release ──

test('releaseUsage after a simulated failed domain op frees the quota', async () => {
  const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'trade_pro')] });
  const r = await ent.reserveUsage(client, { tenantId: TENANT_A, userId: 'u1', featureKey: FEATURE_KEYS.WORKBOOK_BULK_IMPORT, amount: 2, idempotencyKey: 'imp-rel' });
  let meter = client._rows('diaspora_usage_meters').find((m) => m.feature_key === FEATURE_KEYS.WORKBOOK_BULK_IMPORT);
  assert.equal(meter.used_count, 2);

  // Simulated downstream failure -> release the reservation.
  const released = await ent.releaseUsage(client, { reservationId: r.reservationId, actor: 'u1' });
  assert.equal(released.status, 'RELEASED');
  meter = client._rows('diaspora_usage_meters').find((m) => m.feature_key === FEATURE_KEYS.WORKBOOK_BULK_IMPORT);
  assert.equal(meter.used_count, 0); // quota freed

  // Idempotent: releasing again does not decrement twice.
  const again = await ent.releaseUsage(client, { reservationId: r.reservationId, actor: 'u1' });
  assert.equal(again.idempotentReplay, true);
  meter = client._rows('diaspora_usage_meters').find((m) => m.feature_key === FEATURE_KEYS.WORKBOOK_BULK_IMPORT);
  assert.equal(meter.used_count, 0);
});

test('commitUsage is idempotent and a committed reservation cannot be released', async () => {
  const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'trade_pro')] });
  const r = await ent.reserveUsage(client, { tenantId: TENANT_A, userId: 'u1', featureKey: FEATURE_KEYS.WORKBOOK_BULK_IMPORT, amount: 1, idempotencyKey: 'imp-commit' });
  const c1 = await ent.commitUsage(client, { reservationId: r.reservationId, actor: 'u1' });
  assert.equal(c1.status, 'COMMITTED');
  const c2 = await ent.commitUsage(client, { reservationId: r.reservationId, actor: 'u1' });
  assert.equal(c2.idempotentReplay, true);
  await assert.rejects(() => ent.releaseUsage(client, { reservationId: r.reservationId, actor: 'u1' }), /committed reservation cannot be released/i);
  // The commit wrote a CRITICAL audit row.
  const audits = client._rows('diaspora_import_audit_log');
  assert.ok(audits.some((a) => a.action === 'ENTITLEMENT_USAGE_COMMITTED'));
});

// ── Cross-tenant isolation ──

test('tenant B cannot see tenant A subscription or usage', async () => {
  const periodStart = ent.currentPeriodStart();
  const client = clientWith({
    subscriptions: [subscriptionRow(TENANT_A, 'enterprise')],
    meters: [{ id: 'm-a', tenant_id: TENANT_A, feature_key: FEATURE_KEYS.WORKBOOK_BULK_IMPORT, period_start: periodStart, used_count: 7 }],
  });
  // Tenant B has no subscription -> Free; A's enterprise plan must not leak.
  const subB = await ent.resolveSubscription(client, TENANT_B);
  assert.equal(subB.plan_key, 'free');
  const apiB = await ent.checkFeature(client, { tenantId: TENANT_B, featureKey: FEATURE_KEYS.API_ACCESS });
  assert.equal(apiB.allowed, false);
  // B's usage meter for the same feature is independent (0, not A's 7).
  const quotaB = await ent.checkQuota(client, { tenantId: TENANT_B, featureKey: FEATURE_KEYS.WORKBOOK_BULK_IMPORT, periodStart });
  assert.equal(quotaB.used, 0);
});

// ── Admin override + audit ──

test('applyAdminOverride writes the override and a critical audit row', async () => {
  const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'diaspora_buyer')] });
  const saved = await ent.applyAdminOverride(client, {
    tenantId: TENANT_A, userId: 'user-x', featureKey: FEATURE_KEYS.API_ACCESS, value: true,
    actor: platformAdmin, reason: 'pilot partner',
  });
  assert.equal(saved.feature_key, FEATURE_KEYS.API_ACCESS);
  const audits = client._rows('diaspora_import_audit_log');
  assert.ok(audits.some((a) => a.action === 'ENTITLEMENT_OVERRIDE_APPLIED' && a.actor_id === 'admin-1'));
  // The override now takes effect for that user.
  const check = await ent.checkFeature(client, { tenantId: TENANT_A, userId: 'user-x', featureKey: FEATURE_KEYS.API_ACCESS });
  assert.equal(check.allowed, true);
});

test('a non-admin actor cannot apply an entitlement override', async () => {
  const client = clientWith({ subscriptions: [subscriptionRow(TENANT_A, 'diaspora_buyer')] });
  await assert.rejects(
    () => ent.applyAdminOverride(client, {
      tenantId: TENANT_A, userId: 'user-x', featureKey: FEATURE_KEYS.API_ACCESS, value: true,
      actor: { id: 'rando', role: 'member' },
    }),
    /platform or tenant admin/i,
  );
});

// ── Billing provider abstraction (sandbox, deterministic, no network) ──

test('sandbox billing provider is selected by default and is deterministic', async () => {
  const provider = billing.selectBillingProvider();
  assert.equal(provider.name, 'sandbox');
  const checkout = await provider.createCheckoutSession({ tenantId: TENANT_A, planKey: 'seller' });
  assert.equal(checkout.live, false);
  assert.match(checkout.url, /sandbox-billing\.local/);
  const sub = await provider.syncSubscription({ tenantId: TENANT_A, planKey: 'seller' });
  assert.equal(sub.planKey, 'seller');
  assert.equal(sub.status, 'active');
});

test('sandbox webhook verification accepts a correctly signed body and rejects a bad one', async () => {
  const crypto = await import('node:crypto');
  const provider = new billing.SandboxBillingProvider();
  const body = JSON.stringify({ id: 'evt_1', type: 'subscription.updated' });
  const sig = crypto.createHmac('sha256', 'diaspora-billing-dev-webhook-secret').update(body).digest('hex');
  const ok = await provider.verifyWebhook({ rawBody: body, signature: sig });
  assert.equal(ok.verified, true);
  assert.equal(ok.eventId, 'evt_1');
  const bad = await provider.verifyWebhook({ rawBody: body, signature: 'deadbeef' });
  assert.equal(bad.verified, false);
});
