/**
 * CARUP-PAY-03B-LR01 Work Unit 04 — Diaspora continuity. The PAY-03B bridge applies VERIFIED provider state only
 * through the existing Diaspora writer and resolver; it never creates a second Diaspora subscription authority,
 * never broadens paid entitlements beyond paid coverage, and leaves free tenants exactly as they are.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { resolveEffectiveEntitlements } = await import('../services/diaspora/diasporaEntitlementService.js');
const B = await import('../services/payment/pay03bDiasporaBridge.js');

const TENANT_A = '33333333-3333-4333-8333-333333333333';
const TENANT_B = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-01T12:00:00Z');

function client(seed = {}) {
  return createMockSupabase({ diaspora_subscriptions: [], diaspora_subscription_plans: [], diaspora_user_entitlement_overrides: [],
    diaspora_usage_meters: [], diaspora_usage_reservations: [], ...seed }, { rpc: DIASPORA_RPCS });
}

const governanceBuyerPro = { id: 'p1', plan_code: 'diaspora_buyer_pro', subscription_authority: 'diaspora_subscriptions',
  authority_plan_key: 'diaspora_buyer', pricing_kind: 'unpriced', activation_status: 'commercially_blocked', effective_to: null };
const activatableBuyer = { ...governanceBuyerPro, id: 'p2', pricing_kind: 'sandbox_fixture', activation_status: 'sandbox_only' };
const dealerPlan = { id: 'p3', subscription_authority: 'pay03b_business_subscriptions', authority_plan_key: null,
  pricing_kind: 'sandbox_fixture', activation_status: 'sandbox_only', effective_to: null };
const snapshot = (over = {}) => ({ id: 'sub_diaspora1', status: 'active', customerId: 'cus_diaspora1',
  currentPeriodStart: '2026-11-01T00:00:00.000Z', currentPeriodEnd: '2026-12-01T00:00:00.000Z', cancelAtPeriodEnd: false, ...over });

test('Diaspora continuity: a free tenant keeps the synthetic free tier with no PAY-03B involvement', async () => {
  const db = client();
  const ent = await resolveEffectiveEntitlements(db, TENANT_A);
  assert.equal(ent.planKey, 'free');
  assert.equal(ent.synthetic, true);
  assert.equal(db._rows('diaspora_subscriptions').length, 0);
});

test('bridge: commercially blocked Diaspora tariffs and non-Diaspora plans are refused before any write', async () => {
  const db = client();
  await assert.rejects(B.applyVerifiedSubscriptionToDiaspora({ db, tenantId: TENANT_A, plan: governanceBuyerPro, snapshot: snapshot(),
    paidThrough: '2026-12-01T00:00:00Z', gateway: 'stripe_carup_japan_sandbox', now: NOW }), /PAY03B_DIASPORA_PLAN_NOT_ACTIVATABLE/);
  await assert.rejects(B.applyVerifiedSubscriptionToDiaspora({ db, tenantId: TENANT_A, plan: dealerPlan, snapshot: snapshot(),
    paidThrough: '2026-12-01T00:00:00Z', gateway: 'stripe_carup_japan_sandbox', now: NOW }), /PAY03B_DIASPORA_AUTHORITY_MISMATCH/);
  assert.equal(db._rows('diaspora_subscriptions').length, 0);
});

test('bridge: an incomplete provider snapshot never reaches the legacy writer (which would default it to active)', async () => {
  const db = client();
  for (const bad of [snapshot({ status: undefined }), snapshot({ currentPeriodEnd: null }), snapshot({ customerId: null }),
    snapshot({ status: 'mystery' }), snapshot({ cancelAtPeriodEnd: undefined })]) {
    await assert.rejects(B.applyVerifiedSubscriptionToDiaspora({ db, tenantId: TENANT_A, plan: activatableBuyer, snapshot: bad,
      paidThrough: '2026-12-01T00:00:00Z', gateway: 'stripe_carup_japan_sandbox', now: NOW }), /PAY03B_DIASPORA_SNAPSHOT_INCOMPLETE/);
  }
  assert.equal(db._rows('diaspora_subscriptions').length, 0);
  assert.equal((await resolveEffectiveEntitlements(db, TENANT_A)).planKey, 'free');
});

test('bridge: a verified, PAID subscription is applied through the existing writer and resolver, bounded by paid coverage', async () => {
  const db = client();
  const out = await B.applyVerifiedSubscriptionToDiaspora({ db, tenantId: TENANT_A, plan: activatableBuyer, snapshot: snapshot(),
    paidThrough: '2026-11-15T00:00:00.000Z', gateway: 'stripe_carup_japan_sandbox', actorId: 'pay03b-test', now: NOW });
  const [row] = db._rows('diaspora_subscriptions');
  assert.equal(db._rows('diaspora_subscriptions').length, 1, 'still exactly one Diaspora authority row');
  assert.equal(row.plan_key, 'diaspora_buyer');
  assert.equal(row.status, 'active');
  assert.equal(row.current_period_end, '2026-11-15T00:00:00.000Z', 'period end is the PAID coverage, not the provider period');
  assert.equal(row.provider_subscription_ref, 'sub_diaspora1');
  assert.equal(out.entitlements.planKey, 'diaspora_buyer');
  assert.equal(out.entitlements.synthetic, false);
  // Tenant B is untouched.
  assert.equal((await resolveEffectiveEntitlements(db, TENANT_B)).planKey, 'free');
});

test('bridge: provider-active without a paid period, and past_due, never broaden paid entitlements', async () => {
  const db = client();
  const unpaid = await B.applyVerifiedSubscriptionToDiaspora({ db, tenantId: TENANT_A, plan: activatableBuyer, snapshot: snapshot(),
    paidThrough: null, gateway: 'stripe_carup_japan_sandbox', now: NOW });
  assert.equal(db._rows('diaspora_subscriptions')[0].status, 'incomplete');
  assert.equal(unpaid.entitlements.planKey, 'free');
  const pastDue = await B.applyVerifiedSubscriptionToDiaspora({ db, tenantId: TENANT_A, plan: activatableBuyer,
    snapshot: snapshot({ status: 'past_due' }), paidThrough: '2026-10-31T00:00:00.000Z', gateway: 'stripe_carup_japan_sandbox', now: NOW });
  assert.equal(db._rows('diaspora_subscriptions')[0].status, 'past_due');
  assert.equal(pastDue.entitlements.planKey, 'free');
  assert.equal(db._rows('diaspora_subscriptions').length, 1);
});
