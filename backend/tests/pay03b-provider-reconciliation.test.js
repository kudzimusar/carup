/**
 * CARUP-PAY-03B-LR01 Work Unit 05 — recurring provider adapter contract.
 *
 * The subscription service never sees provider vocabulary: adapters return CarUp-shaped objects. These tests pin
 * the Stripe normalizers (both the SDK-pinned 2025-02-24.acacia shapes and the newer shapes Stripe now uses for
 * period/invoice parent fields), the sandbox guards around every provider call, and the local simulator, which is
 * a clearly labelled UAT provider that can never be mistaken for Stripe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const A = await import('../services/payment/pay03bProviderAdapters.js');
const SIM = await import('../services/payment/pay03bLocalSimulator.js');
const { PAY01A_ACCOUNT } = await import('../services/payment/pay01aContract.js');

const T0 = 1_793_000_000; // 2026-10-27T05:33:20Z (unix seconds)
const iso = (s) => new Date(s * 1000).toISOString();

function sandboxEnv(extra = {}) {
  return {
    NODE_ENV: 'test', CARUP_ENV: 'test', CARUP_PAY01A_ENABLED: 'true', CARUP_PAY03B_ENABLED: 'true',
    CARUP_PAY01A_STRIPE_ACCOUNT_ID: PAY01A_ACCOUNT,
    CARUP_PAY01A_STRIPE_SECRET_KEY: 'sk_test_local_fixture_only_000000',
    CARUP_PAY01A_STRIPE_WEBHOOK_SECRET: 'whsec_localFixtureOnly000000',
    CARUP_PAY01A_RETURN_ORIGIN: 'http://127.0.0.1:5183', ...extra,
  };
}

test('normalizer: an acacia subscription (top-level periods) becomes a CarUp-shaped snapshot', () => {
  const s = A.normalizeStripeSubscription({
    id: 'sub_acacia1', object: 'subscription', livemode: false, status: 'active', customer: 'cus_a1',
    current_period_start: T0, current_period_end: T0 + 2592000, cancel_at_period_end: false,
    canceled_at: null, ended_at: null, trial_end: null, latest_invoice: 'in_a1', schedule: null,
    metadata: { carup_subscription_reference: 'pay03b_sub_00000000-0000-4000-8000-000000000001' },
    items: { data: [{ id: 'si_a1', price: { id: 'price_std' }, quantity: 1 }] },
  });
  assert.deepEqual(s, {
    id: 'sub_acacia1', livemode: false, status: 'active', customerId: 'cus_a1',
    itemId: 'si_a1', priceRef: 'price_std', currentPeriodStart: iso(T0), currentPeriodEnd: iso(T0 + 2592000),
    cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, trialEnd: null, latestInvoiceId: 'in_a1',
    pendingUpdate: false, subscriptionReference: 'pay03b_sub_00000000-0000-4000-8000-000000000001',
  });
});

test('normalizer: a basil+ subscription (periods on the item, expanded objects) normalizes identically', () => {
  const s = A.normalizeStripeSubscription({
    id: 'sub_basil1', object: 'subscription', livemode: false, status: 'past_due',
    customer: { id: 'cus_b1', object: 'customer' }, cancel_at_period_end: true, canceled_at: null, ended_at: null,
    trial_end: null, latest_invoice: { id: 'in_b2', object: 'invoice' }, pending_update: { expires_at: T0 },
    metadata: {},
    items: { data: [{ id: 'si_b1', price: { id: 'price_prem' }, current_period_start: T0, current_period_end: T0 + 60 }] },
  });
  assert.equal(s.customerId, 'cus_b1');
  assert.equal(s.latestInvoiceId, 'in_b2');
  assert.equal(s.currentPeriodStart, iso(T0));
  assert.equal(s.currentPeriodEnd, iso(T0 + 60));
  assert.equal(s.cancelAtPeriodEnd, true);
  assert.equal(s.pendingUpdate, true);
  assert.equal(s.subscriptionReference, null);
});

test('normalizer: multi-item, quantity>1, live or unknown-status subscriptions are refused (no guessing)', () => {
  const base = { id: 'sub_x', livemode: false, status: 'active', customer: 'cus_x', current_period_start: T0,
    current_period_end: T0 + 60, items: { data: [{ id: 'si_x', price: { id: 'price_x' }, quantity: 1 }] } };
  assert.throws(() => A.normalizeStripeSubscription({ ...base, items: { data: [base.items.data[0], { id: 'si_y', price: { id: 'p' } }] } }),
    /PAY03B_PROVIDER_SUBSCRIPTION_SHAPE_UNSUPPORTED/);
  assert.throws(() => A.normalizeStripeSubscription({ ...base, items: { data: [{ ...base.items.data[0], quantity: 2 }] } }),
    /PAY03B_PROVIDER_SUBSCRIPTION_SHAPE_UNSUPPORTED/);
  assert.throws(() => A.normalizeStripeSubscription({ ...base, livemode: true }), /PAY03B_PROVIDER_LIVE_OBJECT_REFUSED/);
  assert.throws(() => A.normalizeStripeSubscription({ ...base, status: 'mystery' }), /PAY03B_PROVIDER_STATUS_UNKNOWN/);
});

test('normalizer: invoice period and price come from the subscription LINE, not the invoice header', () => {
  // Stripe's invoice-level period_start/period_end describe the previous usage window; the line describes the
  // period actually being paid for.
  const inv = A.normalizeStripeInvoice({
    id: 'in_cycle2', object: 'invoice', livemode: false, status: 'paid', billing_reason: 'subscription_cycle',
    customer: 'cus_a1', subscription: 'sub_acacia1', currency: 'jpy', amount_due: 3000, amount_paid: 3000,
    amount_remaining: 0, payment_intent: 'pi_cycle2', attempt_count: 1, next_payment_attempt: null,
    period_start: T0 - 2592000, period_end: T0,
    lines: { data: [{ id: 'il_1', type: 'subscription', proration: false, amount: 3000,
      period: { start: T0, end: T0 + 2592000 }, price: { id: 'price_std' } }] },
  });
  assert.equal(inv.periodStart, iso(T0));
  assert.equal(inv.periodEnd, iso(T0 + 2592000));
  assert.equal(inv.priceRef, 'price_std');
  assert.equal(inv.currency, 'JPY');
  assert.equal(inv.subscriptionId, 'sub_acacia1');
  assert.equal(inv.paymentIntentId, 'pi_cycle2');
});

test('normalizer: basil+ invoices (parent subscription details, payments list, pricing) normalize identically', () => {
  const inv = A.normalizeStripeInvoice({
    id: 'in_basil', livemode: false, status: 'open', billing_reason: 'subscription_cycle', customer: 'cus_b1',
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_basil1' } },
    payments: { data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_basil' } }] },
    currency: 'jpy', amount_due: 6000, amount_paid: 0, amount_remaining: 6000, attempt_count: 1,
    next_payment_attempt: T0 + 86400,
    lines: { data: [{ id: 'il_b', amount: 6000, period: { start: T0, end: T0 + 60 },
      parent: { type: 'subscription_item_details', subscription_item_details: { proration: false } },
      pricing: { price_details: { price: 'price_prem' } } }] },
  });
  assert.equal(inv.subscriptionId, 'sub_basil1');
  assert.equal(inv.paymentIntentId, 'pi_basil');
  assert.equal(inv.priceRef, 'price_prem');
  assert.equal(inv.nextPaymentAttempt, iso(T0 + 86400));
});

test('normalizer: a proration invoice reports the NEW plan line; unsupported billing reasons are refused', () => {
  const inv = A.normalizeStripeInvoice({
    id: 'in_upd', livemode: false, status: 'paid', billing_reason: 'subscription_update', customer: 'cus_a1',
    subscription: 'sub_acacia1', currency: 'jpy', amount_due: 1500, amount_paid: 1500, amount_remaining: 0,
    payment_intent: 'pi_upd', attempt_count: 1,
    lines: { data: [
      { id: 'il_old', type: 'subscription', proration: true, amount: -1500, period: { start: T0 + 10, end: T0 + 60 }, price: { id: 'price_std' } },
      { id: 'il_new', type: 'subscription', proration: true, amount: 3000, period: { start: T0 + 10, end: T0 + 60 }, price: { id: 'price_prem' } },
    ] },
  });
  assert.equal(inv.priceRef, 'price_prem');
  assert.equal(inv.periodStart, iso(T0 + 10));
  assert.throws(() => A.normalizeStripeInvoice({ ...inv, id: 'in_q', livemode: false, billing_reason: 'quote_accept',
    lines: { data: [] } }), /PAY03B_INVOICE_BILLING_REASON_UNSUPPORTED/);
});

test('payment truth: provider PaymentIntent states map to canonical states; refunds reuse the F5 classifier', () => {
  assert.equal(A.paymentTruthFromProvider({ intent: { id: 'pi_1', status: 'requires_payment_method', livemode: false,
    amount: 3000, currency: 'jpy' }, refunds: [], amountMinor: 3000, currency: 'JPY' }).status, 'pending');
  assert.equal(A.paymentTruthFromProvider({ intent: { id: 'pi_1', status: 'canceled', livemode: false, amount: 3000,
    currency: 'jpy' }, refunds: [], amountMinor: 3000, currency: 'JPY' }).status, 'cancelled');
  const held = A.paymentTruthFromProvider({ intent: { id: 'pi_1', status: 'succeeded', livemode: false, amount: 3000,
    amount_received: 3000, currency: 'jpy' }, refunds: [{ id: 're_1', payment_intent: 'pi_1', amount: 1000, currency: 'jpy',
    status: 'succeeded' }], amountMinor: 3000, currency: 'JPY' });
  assert.deepEqual([held.status, held.refundedMinor, held.mismatch], ['reconciliation_hold', 1000, 'partial_refund_succeeded']);
  assert.throws(() => A.paymentTruthFromProvider({ intent: { id: 'pi_1', status: 'succeeded', livemode: false, amount: 2999,
    amount_received: 2999, currency: 'jpy' }, refunds: [], amountMinor: 3000, currency: 'JPY' }), /PAY03B_PROVIDER_PAYMENT_AMOUNT_MISMATCH/);
  assert.throws(() => A.paymentTruthFromProvider({ intent: { id: 'pi_1', status: 'succeeded', livemode: true, amount: 3000,
    amount_received: 3000, currency: 'jpy' }, refunds: [], amountMinor: 3000, currency: 'JPY' }), /PAY03B_PROVIDER_LIVE_OBJECT_REFUSED/);
});

function recordingStripe(overrides = {}) {
  const calls = [];
  const rec = (name, result) => async (...args) => { calls.push([name, ...args]); return typeof result === 'function' ? result(...args) : result; };
  const stripe = {
    accounts: { retrieve: rec('accounts.retrieve', { id: PAY01A_ACCOUNT }) },
    customers: { create: rec('customers.create', { id: 'cus_new1', livemode: false }) },
    checkout: { sessions: {
      create: rec('checkout.create', (params) => ({ id: 'cs_test_sub1', object: 'checkout.session', livemode: false, mode: params.mode,
        url: 'https://checkout.stripe.com/c/pay/cs_test_sub1', customer: params.customer, client_reference_id: params.client_reference_id,
        metadata: params.metadata, status: 'open' })),
    } },
    subscriptions: {
      update: rec('subscriptions.update', { id: 'sub_1', livemode: false, status: 'active', customer: 'cus_new1',
        current_period_start: T0, current_period_end: T0 + 60, items: { data: [{ id: 'si_1', price: { id: 'price_prem' } }] } }),
      cancel: rec('subscriptions.cancel', { id: 'sub_1', livemode: false, status: 'canceled', customer: 'cus_new1',
        current_period_start: T0, current_period_end: T0 + 60, items: { data: [{ id: 'si_1', price: { id: 'price_std' } }] } }),
    },
    ...overrides,
  };
  return { stripe, calls };
}

test('stripe adapter: every provider operation is refused unless PAY-03B is explicitly enabled in a sandbox runtime', async () => {
  const { stripe } = recordingStripe();
  for (const env of [
    sandboxEnv({ CARUP_PAY03B_ENABLED: 'false' }),
    sandboxEnv({ CARUP_ENV: 'production' }),
    sandboxEnv({ CARUP_PAY01A_STRIPE_SECRET_KEY: 'sk_live_this_must_never_work_000' }),
    sandboxEnv({ CARUP_PAY01A_STRIPE_ACCOUNT_ID: 'acct_someoneelse' }),
  ]) {
    assert.throws(() => new A.Pay03bStripeSandboxProvider({ env, stripe }), /PAY03B_SANDBOX_DISABLED|PAY01A_/);
  }
});

test('stripe adapter: subscription checkout uses the server price, subscription metadata and a stable idempotency key', async () => {
  const { stripe, calls } = recordingStripe();
  const provider = new A.Pay03bStripeSandboxProvider({ env: sandboxEnv(), stripe });
  await provider.verifyAccount();
  const out = await provider.createSubscriptionCheckout({
    customerId: 'cus_new1', priceRef: 'price_std', subscriptionReference: 'pay03b_sub_00000000-0000-4000-8000-000000000001',
    metadata: { carup_owner_tenant_id: 't1' }, successUrl: 'http://127.0.0.1:5183/dealer/subscription?r=1',
    cancelUrl: 'http://127.0.0.1:5183/dealer/subscription?c=1', idempotencyKey: 'carup_pay03b_checkout_abc',
  });
  const [, params, opts] = calls.find((c) => c[0] === 'checkout.create');
  assert.equal(params.mode, 'subscription');
  assert.deepEqual(params.line_items, [{ price: 'price_std', quantity: 1 }]);
  assert.equal(params.subscription_data.metadata.carup_subscription_reference, 'pay03b_sub_00000000-0000-4000-8000-000000000001');
  assert.equal(params.metadata.carup_programme, 'PAY-03B');
  assert.equal(params.client_reference_id, 'pay03b_sub_00000000-0000-4000-8000-000000000001');
  assert.equal(opts.idempotencyKey, 'carup_pay03b_checkout_abc');
  assert.deepEqual(out, { checkoutId: 'cs_test_sub1', url: 'https://checkout.stripe.com/c/pay/cs_test_sub1' });
});

test('stripe adapter: a live/foreign checkout or customer mismatch is refused after creation (never used)', async () => {
  const { stripe } = recordingStripe({ checkout: { sessions: { create: async (p) => ({ id: 'cs_live_x', livemode: true, mode: 'subscription',
    url: 'https://x', customer: p.customer, client_reference_id: p.client_reference_id, metadata: p.metadata }) } } });
  const provider = new A.Pay03bStripeSandboxProvider({ env: sandboxEnv(), stripe });
  await assert.rejects(provider.createSubscriptionCheckout({ customerId: 'cus_new1', priceRef: 'price_std',
    subscriptionReference: 'pay03b_sub_00000000-0000-4000-8000-000000000001', metadata: {}, successUrl: 'http://127.0.0.1:5183/a',
    cancelUrl: 'http://127.0.0.1:5183/b', idempotencyKey: 'carup_pay03b_checkout_abc' }), /PAY03B_CHECKOUT_PROVIDER_MISMATCH/);
});

test('stripe adapter: plan changes are explicit about proration; period-end changes never charge now', async () => {
  const { stripe, calls } = recordingStripe();
  const provider = new A.Pay03bStripeSandboxProvider({ env: sandboxEnv(), stripe });
  await provider.changePlan({ subscriptionId: 'sub_1', itemId: 'si_1', priceRef: 'price_prem', mode: 'period_end', idempotencyKey: 'k1k1k1k1k1k1k1k1' });
  await provider.changePlan({ subscriptionId: 'sub_1', itemId: 'si_1', priceRef: 'price_prem', mode: 'immediate', idempotencyKey: 'k2k2k2k2k2k2k2k2' });
  const updates = calls.filter((c) => c[0] === 'subscriptions.update').map((c) => c[2]);
  assert.equal(updates[0].proration_behavior, 'none');
  assert.equal(updates[0].payment_behavior, undefined);
  assert.equal(updates[1].proration_behavior, 'always_invoice');
  assert.equal(updates[1].payment_behavior, 'pending_if_incomplete', 'an unpaid upgrade is never applied');
  await assert.rejects(provider.changePlan({ subscriptionId: 'sub_1', itemId: 'si_1', priceRef: 'price_prem', mode: 'free',
    idempotencyKey: 'k3k3k3k3k3k3k3k3' }), /PAY03B_PLAN_CHANGE_MODE_INVALID/);
});

test('stripe adapter: payment-method update needs an explicitly configured portal (no implicit provider config)', async () => {
  const { stripe } = recordingStripe();
  const provider = new A.Pay03bStripeSandboxProvider({ env: sandboxEnv(), stripe });
  await assert.rejects(provider.createPaymentMethodUpdateSession({ customerId: 'cus_new1', returnUrl: 'http://127.0.0.1:5183/x',
    idempotencyKey: 'k4k4k4k4k4k4k4k4' }), (err) => err.code === 'PAY03B_PAYMENT_METHOD_UPDATE_NOT_CONFIGURED' && err.status === 503);
});

// ------------------------------------------------------------------ local provider simulator (UAT only)
function simEnv(dir, extra = {}) {
  return {
    NODE_ENV: 'test', CARUP_ENV: 'test', CARUP_PAY03B_ENABLED: 'true', CARUP_PAY03B_PROVIDER_MODE: 'local_simulator',
    CARUP_PAY03B_SIMULATOR_STATE_FILE: path.join(dir, 'sim-state.json'), CARUP_PAY03B_SIMULATOR_PERIOD_SECONDS: '120',
    CARUP_PAY03B_SIMULATOR_WEBHOOK_SECRET: 'simsec_localFixtureOnly0000', CARUP_PAY01A_RETURN_ORIGIN: 'http://127.0.0.1:5183', ...extra,
  };
}

test('simulator: refused in production, without explicit mode, or without a state file; never claims a Stripe identity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay03b-sim-'));
  assert.throws(() => new SIM.Pay03bLocalSimulatorProvider({ env: simEnv(dir, { CARUP_ENV: 'production' }) }), /PAY03B_SIMULATOR_REFUSED/);
  assert.throws(() => new SIM.Pay03bLocalSimulatorProvider({ env: simEnv(dir, { CARUP_PAY03B_PROVIDER_MODE: '' }) }), /PAY03B_SIMULATOR_REFUSED/);
  assert.throws(() => new SIM.Pay03bLocalSimulatorProvider({ env: simEnv(dir, { CARUP_PAY03B_SIMULATOR_STATE_FILE: '' }) }), /PAY03B_SIMULATOR_REFUSED/);
  const sim = new SIM.Pay03bLocalSimulatorProvider({ env: simEnv(dir) });
  assert.equal(sim.gateway, 'pay03b_local_provider_simulator');
  assert.equal(sim.accountId, 'acct_pay03b_local_simulator');
  assert.notEqual(sim.accountId, PAY01A_ACCOUNT);
});

test('simulator: checkout -> paid subscription -> renewal -> failed renewal -> recovery -> external partial refund, all persisted and deterministic', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay03b-sim-'));
  const sim = new SIM.Pay03bLocalSimulatorProvider({ env: simEnv(dir) });
  const { customerId } = await sim.ensureCustomer({ organizationId: 'org_1', tenantId: 't1', displayName: 'Dealer', idempotencyKey: 'cust_key_000000000001' });
  const again = await sim.ensureCustomer({ organizationId: 'org_1', tenantId: 't1', displayName: 'Dealer', idempotencyKey: 'cust_key_000000000001' });
  assert.equal(again.customerId, customerId, 'idempotent customer');
  assert.match(customerId, /^sim_cus_/);
  const co = await sim.createSubscriptionCheckout({ customerId, priceRef: 'sim_price_std', amountMinor: 3000, currency: 'JPY',
    subscriptionReference: 'pay03b_sub_00000000-0000-4000-8000-000000000009', metadata: {}, successUrl: 'http://127.0.0.1:5183/s',
    cancelUrl: 'http://127.0.0.1:5183/c', idempotencyKey: 'carup_pay03b_checkout_sim1' });
  assert.match(co.checkoutId, /^sim_cs_/);
  assert.match(co.url, /^http:\/\/127\.0\.0\.1:\d+\/api\/pay03b\/simulator\/checkout\/sim_cs_/);
  const done = await sim.completeCheckout(co.checkoutId, { outcome: 'success' });
  assert.equal(done.events.map((e) => e.type).join(','), 'checkout.session.completed,customer.subscription.created,invoice.paid');
  const reread = new SIM.Pay03bLocalSimulatorProvider({ env: simEnv(dir) });
  const sub = await reread.getSubscription(done.subscriptionId);
  assert.equal(sub.status, 'active');
  assert.equal(sub.priceRef, 'sim_price_std');
  const [first] = await reread.listSubscriptionInvoices(done.subscriptionId);
  assert.equal(first.status, 'paid');
  assert.equal(first.billingReason, 'subscription_create');
  assert.equal(Date.parse(first.periodEnd) - Date.parse(first.periodStart), 120_000);
  const truth = await reread.getPaymentTruth({ paymentIntentId: first.paymentIntentId, amountMinor: 3000, currency: 'JPY' });
  assert.equal(truth.status, 'paid');

  const failed = await reread.advanceToNextPeriod(done.subscriptionId, { outcome: 'failure' });
  assert.equal(failed.events.map((e) => e.type).join(','), 'invoice.payment_failed,customer.subscription.updated');
  assert.equal((await reread.getSubscription(done.subscriptionId)).status, 'past_due');
  const open = (await reread.listSubscriptionInvoices(done.subscriptionId)).find((i) => i.status === 'open');
  assert.equal((await reread.getPaymentTruth({ paymentIntentId: open.paymentIntentId, amountMinor: 3000, currency: 'JPY' })).status, 'pending');
  const recovered = await reread.payOpenInvoice(open.id);
  assert.equal(recovered.events.map((e) => e.type).join(','), 'invoice.paid,customer.subscription.updated');
  assert.equal((await reread.getSubscription(done.subscriptionId)).status, 'active');

  const refund = await reread.createExternalRefund({ paymentIntentId: first.paymentIntentId, amountMinor: 1000 });
  assert.equal(refund.events[0].type, 'charge.refunded');
  const partial = await reread.getPaymentTruth({ paymentIntentId: first.paymentIntentId, amountMinor: 3000, currency: 'JPY' });
  assert.deepEqual([partial.status, partial.refundedMinor], ['reconciliation_hold', 1000]);
});

test('simulator: signed events verify only with the simulator secret and carry the simulator account', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay03b-sim-'));
  const sim = new SIM.Pay03bLocalSimulatorProvider({ env: simEnv(dir) });
  const event = { id: 'sim_evt_1', type: 'invoice.paid', livemode: false, account: sim.accountId, data: { object: { id: 'sim_in_1', object: 'invoice' } } };
  const { rawBody, signature } = sim.signEvent(event);
  assert.deepEqual(sim.verifyWebhook({ rawBody, signature }), event);
  assert.throws(() => sim.verifyWebhook({ rawBody, signature: signature.replace(/v1=./, 'v1=0') }), /PAY03B_SIMULATOR_SIGNATURE_INVALID/);
  // Correctly signed with the simulator secret but claiming the real Stripe account (or live mode): refused.
  for (const forged of [{ ...event, account: PAY01A_ACCOUNT }, { ...event, livemode: true }, { ...event, id: 'evt_real_looking' }]) {
    const signedForged = sim.signEvent(forged);
    assert.throws(() => sim.verifyWebhook(signedForged), /PAY03B_SIMULATOR_EVENT_REFUSED/);
  }
});

// ------------------------------------------------------------------ Level 2 (Owner-authorized) test-clock control
const L2 = await import('../services/payment/pay03bLevel2Service.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');

function level2Fixture({ decision = 'Authorize exact scope (Recommended)', advances = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay03b-l2-'));
  fs.writeFileSync(path.join(dir, 'decision.json'), JSON.stringify({ decisions: { level2_stripe_sandbox_rehearsal: decision },
    limits: { test_clock_advances: 1 } }));
  fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify({ advances }));
  const env = sandboxEnv({ CARUP_PAY03B_LEVEL2_AUTHORIZATION_FILE: path.join(dir, 'decision.json'),
    CARUP_PAY03B_LEVEL2_LEDGER_FILE: path.join(dir, 'ledger.json'), CARUP_PAY03B_STRIPE_TEST_CLOCK_ID: 'clock_authorized1' });
  const calls = [];
  const stripe = {
    accounts: { retrieve: async () => ({ id: PAY01A_ACCOUNT }) },
    testHelpers: { testClocks: {
      retrieve: async (id) => ({ id, livemode: false, status: 'ready', frozen_time: T0 }),
      advance: async (id, params) => { calls.push([id, params]); return { id, status: 'advancing' }; },
    } },
  };
  const db = createMockSupabase({
    pay03b_business_subscriptions: [{ id: 'sub-l2', owner_tenant_id: 't-l2', gateway: 'stripe_carup_japan_sandbox',
      provider_subscription_id: 'sub_l2provider', current_period_end: iso(T0 + 2592000) }],
    trust_audit_events: [],
  });
  return { env, stripe, db, calls, dir };
}

test('Level 2: the single authorized test-clock advance is audited first, recorded, and moves the clock past the paid period', async () => {
  const f = level2Fixture();
  const out = await L2.advancePay03bLevel2TestClock({ db: f.db, env: f.env, stripe: f.stripe, adminActorId: 'ops-1', subscriptionId: 'sub-l2' });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], ['clock_authorized1', { frozen_time: T0 + 2592000 + 7200 }]);
  assert.equal(out.status, 'advancing');
  assert.equal(f.db._rows('trust_audit_events')[0].event_type, 'PAY03B_LEVEL2_TEST_CLOCK_ADVANCE_REQUESTED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, 'ledger.json'), 'utf8')).advances.length, 1);
  await assert.rejects(L2.advancePay03bLevel2TestClock({ db: f.db, env: f.env, stripe: f.stripe, adminActorId: 'ops-1', subscriptionId: 'sub-l2' }),
    (e) => e.code === 'PAY03B_LEVEL2_ADVANCE_LIMIT_REACHED');
  assert.equal(f.calls.length, 1, 'never a second advance');
});

test('Level 2: refused without the recorded Owner decision, in simulator mode, or without an admin actor', async () => {
  const declined = level2Fixture({ decision: 'Do not authorize' });
  await assert.rejects(L2.advancePay03bLevel2TestClock({ db: declined.db, env: declined.env, stripe: declined.stripe,
    adminActorId: 'ops-1', subscriptionId: 'sub-l2' }), (e) => e.code === 'PAY03B_LEVEL2_NOT_AUTHORIZED' && e.status === 403);
  const f = level2Fixture();
  await assert.rejects(L2.advancePay03bLevel2TestClock({ db: f.db, env: { ...f.env, CARUP_PAY03B_PROVIDER_MODE: 'local_simulator' },
    stripe: f.stripe, adminActorId: 'ops-1', subscriptionId: 'sub-l2' }), (e) => e.code === 'PAY03B_LEVEL2_NOT_IN_SIMULATOR');
  await assert.rejects(L2.advancePay03bLevel2TestClock({ db: f.db, env: f.env, stripe: f.stripe, subscriptionId: 'sub-l2' }),
    (e) => e.code === 'PAY03B_ADMIN_ACTOR_REQUIRED');
  assert.equal(declined.calls.length + f.calls.length, 0);
});

test('Level 2: an unwritable audit refuses the advance before any provider call or ledger entry', async () => {
  const f = level2Fixture();
  const from = f.db.from;
  f.db.from = (table) => (table === 'trust_audit_events' ? { insert: async () => ({ error: { message: 'audit down' } }) } : from(table));
  await assert.rejects(L2.advancePay03bLevel2TestClock({ db: f.db, env: f.env, stripe: f.stripe, adminActorId: 'ops-1', subscriptionId: 'sub-l2' }),
    (e) => e.code === 'PAY03B_LEVEL2_AUDIT_UNAVAILABLE');
  assert.equal(f.calls.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, 'ledger.json'), 'utf8')).advances.length, 0);
});

test('stripe adapter: Level 2 customers are created on the authorized test clock only when one is configured', async () => {
  const { stripe, calls } = recordingStripe();
  await new A.Pay03bStripeSandboxProvider({ env: sandboxEnv({ CARUP_PAY03B_STRIPE_TEST_CLOCK_ID: 'clock_authorized1' }), stripe })
    .ensureCustomer({ organizationId: 'org1', tenantId: 't1', displayName: 'Dealer', idempotencyKey: 'k5k5k5k5k5k5k5k5' });
  await new A.Pay03bStripeSandboxProvider({ env: sandboxEnv(), stripe })
    .ensureCustomer({ organizationId: 'org1', tenantId: 't1', displayName: 'Dealer', idempotencyKey: 'k6k6k6k6k6k6k6k6' });
  const creates = calls.filter((c) => c[0] === 'customers.create').map((c) => c[1]);
  assert.equal(creates[0].test_clock, 'clock_authorized1');
  assert.equal('test_clock' in creates[1], false);
});
