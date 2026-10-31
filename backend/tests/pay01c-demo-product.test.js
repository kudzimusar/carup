import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'offline-fixture-only';
const S = await import('../services/payment/pay01cDemoService.js');
const P = await import('../services/payment/pay01aService.js');
const C = await import('../services/payment/pay01aContract.js');

const BUYER = 'buyer-session-one';
const OTHER = 'buyer-session-two';
const REF = 'pay01a_00000000-0000-4000-8000-000000000019';
const ID = '00000000-0000-4000-8000-000000000019';
const metadata = { ...C.pay01aMetadata(REF), carup_demo_product: 'vehicle_history_demo' };
const env = () => ({
  NODE_ENV: 'test', CARUP_ENV: 'test', CARUP_PAY01A_ENABLED: 'true',
  CARUP_PAY01C_ENABLED: 'true',
  CARUP_PAY01A_STRIPE_ACCOUNT_ID: C.PAY01A_ACCOUNT,
  CARUP_PAY01A_STRIPE_SECRET_KEY: 'sk_test_offline_fixture_only_000',
  CARUP_PAY01A_STRIPE_WEBHOOK_SECRET: 'whsec_offlineFixtureOnly000',
  CARUP_PAY01A_RETURN_ORIGIN: 'http://127.0.0.1:5173',
});

function fake() {
  const payment = {
    reference: REF, gateway: 'stripe_carup_japan_sandbox', amount: 100,
    currency: 'JPY', status: 'pending', pay01a_actor_id: BUYER,
    pay01a_request_key: null, pay01a_account_id: C.PAY01A_ACCOUNT,
    pay01a_checkout_id: null, pay01a_intent_id: null, pay01a_refund_id: null,
    created_at: '2026-10-30T00:00:00Z', updated_at: '2026-10-30T00:01:00Z',
  };
  const order = {
    id: ID, buyer_id: BUYER, payment_reference: REF, product_code: 'vehicle_history_demo',
    created_at: '2026-10-30T00:00:00Z', granted_at: null, revoked_at: null,
  };
  const checkout = {
    id: 'cs_test_pay01c', url: 'https://checkout.stripe.com/c/pay/cs_test_pay01c',
    mode: 'payment', livemode: false, payment_status: 'unpaid', status: 'open',
    client_reference_id: REF, metadata, currency: 'jpy', amount_total: 100,
    payment_intent: null,
  };
  const intent = {
    id: 'pi_pay01c', livemode: false, amount: 100, amount_received: 100,
    status: 'succeeded', currency: 'jpy', metadata,
  };
  const refunds = []; const receiptIds = new Set(); const calls = [];
  const db = {
    rpc: async (name, args) => {
      calls.push(name);
      if (name === 'pay01c_claim_demo_checkout') {
        payment.pay01a_request_key = args.p_request_key;
        return { data: { ...payment, pay01c_order_id: ID }, error: null };
      }
      if (name === 'pay01a_attach_checkout') {
        payment.pay01a_checkout_id = args.p_checkout_id;
        return { data: { ...payment }, error: null };
      }
      if (name === 'pay01a_apply_provider_snapshot') {
        const dup = Boolean(args.p_event_id && receiptIds.has(args.p_event_id));
        if (args.p_event_id) receiptIds.add(args.p_event_id);
        if (!dup) {
          payment.status = args.p_status;
          payment.pay01a_intent_id ||= args.p_intent_id;
          payment.pay01a_refund_id ||= args.p_refund_id;
        }
        return { data: { ...payment, duplicate_event: dup }, error: null };
      }
      if (name === 'pay01c_sync_demo_entitlement') {
        if (payment.status === 'paid' && !order.granted_at && !order.revoked_at) order.granted_at = '2026-10-30T00:02:00Z';
        if (payment.status === 'refunded' && order.granted_at && !order.revoked_at) order.revoked_at = '2026-10-30T00:05:00Z';
        return { data: { order_id: ID }, error: null };
      }
      if (name === 'pay01a_begin_refund') {
        if (payment.status !== 'paid') return { data: null, error: { code: 'NO_REFUND' } };
        payment.status = 'refund_pending';
        return { data: { ...payment }, error: null };
      }
      return { data: null, error: { code: 'UNKNOWN_RPC' } };
    },
    from: table => {
      const filters = {}; const query = {
        select: () => query,
        eq: (name, value) => { filters[name] = value; return query; },
        maybeSingle: async () => {
          const row = table === 'pay01c_demo_orders' ? order : payment;
          return { data: Object.entries(filters).every(([k, v]) => row[k] === v) ? { ...row } : null, error: null };
        },
        order: () => query,
        limit: async () => {
          const row = table === 'pay01c_demo_orders' ? order : payment;
          return { data: Object.entries(filters).every(([k, v]) => row[k] === v) ? [{ ...row }] : [], error: null };
        },
      };
      return query;
    },
  };
  const stripe = {
    accounts: { retrieve: async () => { calls.push('account_verify'); return { id: C.PAY01A_ACCOUNT }; } },
    checkout: { sessions: {
      create: async params => {
        calls.push('checkout_create');
        checkout.client_reference_id = params.client_reference_id;
        checkout.metadata = params.metadata;
        return { ...checkout };
      },
      retrieve: async () => { calls.push('checkout_retrieve'); return { ...checkout }; },
    } },
    paymentIntents: { retrieve: async () => { calls.push('intent_retrieve'); return { ...intent }; } },
    refunds: {
      list: async () => ({ data: [...refunds], has_more: false }),
      create: async args => {
        calls.push('refund_create');
        const refund = { id: 're_pay01c', payment_intent: intent.id, currency: 'jpy',
          amount: 100, status: 'succeeded' };
        refunds.push(refund);
        return refund;
      },
    },
    webhooks: { constructEvent: (raw, sig) => {
      if (sig !== 'valid') throw new Error('invalid signature');
      return JSON.parse(raw.toString());
    } },
  };
  const opts = { buyerId: BUYER, db, env: env(), stripe };
  const start = async () => S.createBuyerDemoCheckout({ ...opts, requestKey: 'pay01c_a0123456789abcdef0123456789abcdef' });
  const pay = () => {
    checkout.status = 'complete'; checkout.payment_status = 'paid'; checkout.payment_intent = intent.id;
  };
  const event = (id, type = 'payment_intent.succeeded') => Buffer.from(JSON.stringify({
    id, type, livemode: false, data: { object: { metadata, client_reference_id: REF } },
  }));
  return { payment, order, checkout, intent, refunds, calls, db, stripe, opts, start, pay, event, receiptIds };
}

test('PAY01C: local test-only gate and fixed synthetic product', () => {
  assert.equal(S.PAY01C_PRODUCT.amount, 100);
  assert.equal(S.PAY01C_PRODUCT.currency, 'JPY');
  assert.throws(() => S.requirePay01cDemo({ ...env(), CARUP_PAY01C_ENABLED: 'false' }), /PAY01C_DEMO_DISABLED/);
  assert.throws(() => S.requirePay01cDemo({ ...env(), VERCEL_ENV: 'production' }), /PAY01A_SANDBOX_DISABLED/);
  assert.throws(() => S.requirePay01cDemo({ ...env(), CARUP_PAY01A_STRIPE_SECRET_KEY: 'sk_live_fake' }), /PAY01A_TEST_KEY_REQUIRED/);
  const report = S.syntheticDemoReport();
  assert.match(report.classification, /SYNTHETIC SAMPLE/);
  assert.match(report.vehicleIdentifier, /NOT-A-VIN/);
  assert.match(report.disclaimer, /No actual vehicle/);
});

test('PAY01C: server price, account, buyer and atomic order claim are authoritative', async () => {
  const f = fake();
  const result = await f.start();
  assert.equal(result.orderId, ID);
  assert.equal(result.reference, REF);
  assert.equal(result.amount, 100);
  assert.equal(result.currency, 'JPY');
  assert.equal(result.live, false);
  assert.equal(result.testOnly, true);
  assert.match(result.checkoutUrl, /^https:\/\/checkout\.stripe\.com/);
  assert.ok(f.calls.indexOf('account_verify') < f.calls.indexOf('checkout_create'));
  assert.ok(f.calls.includes('pay01c_claim_demo_checkout'));
  assert.equal(f.checkout.metadata.carup_demo_product, 'vehicle_history_demo');
  assert.equal(f.payment.pay01a_actor_id, BUYER);
  assert.throws(() => C.validatePay01aRequestKey('bad'), /PAY01A_IDEMPOTENCY/);
  await assert.rejects(S.createBuyerDemoCheckout({ ...f.opts, requestKey: 'short' }), /PAY01C_REQUEST_KEY_REQUIRED/);
});

test('PAY01C: anonymous or foreign buyer cannot inspect the canonical order or report', async () => {
  const f = fake();
  await assert.rejects(S.readBuyerDemoOrder({ ...f.opts, buyerId: OTHER, orderId: ID }), /PAY01C_ORDER_NOT_FOUND/);
  await assert.rejects(S.readBuyerDemoReport({ ...f.opts, buyerId: OTHER, orderId: ID }), /PAY01C_ORDER_NOT_FOUND/);
  await assert.rejects(S.listBuyerDemoOrders({ ...f.opts, buyerId: '' }), /PAY01C_SESSION_REQUIRED/);
});

test('PAY01C: browser redirect or pending Checkout cannot unlock synthetic report', async () => {
  const f = fake(); await f.start();
  await assert.rejects(S.readBuyerDemoReport({ ...f.opts, orderId: ID }), /PAY01C_REPORT_NOT_ENTITLED/);
  assert.equal(f.order.granted_at, null);
  assert.equal((await S.readBuyerDemoOrder({ ...f.opts, orderId: ID })).reportAvailable, false);
});

test('PAY01C: provider reconciliation grants once, order history and report are buyer-scoped', async () => {
  const f = fake(); await f.start(); f.pay();
  const paid = await S.readBuyerDemoOrder({ ...f.opts, orderId: ID, refresh: true });
  assert.equal(paid.status, 'paid');
  assert.equal(paid.reportAvailable, true);
  assert.equal(paid.paymentIntentId, f.intent.id);
  const history = await S.listBuyerDemoOrders(f.opts);
  assert.equal(history.orders.length, 1);
  assert.equal(history.orders[0].amount, 100);
  const receipt = await S.readBuyerDemoReport({ ...f.opts, orderId: ID });
  assert.equal(receipt.order.reportAvailable, true);
  assert.match(receipt.report.title, /Demo Edition/);
  assert.equal(f.order.granted_at, '2026-10-30T00:02:00Z');
  assert.ok(f.calls.includes('intent_retrieve'));
});

test('PAY01C: genuine signature gate, duplicate receipt, and out-of-order provider state', async () => {
  const f = fake(); await f.start(); f.pay();
  await assert.rejects(P.processPay01aWebhook({
    rawBody: f.event('evt_pay01c1'), signature: 'invalid', db: f.db, stripe: f.stripe, env: f.opts.env,
  }), /PAY01A_SIGNATURE_INVALID/);
  assert.equal(f.receiptIds.size, 0);
  const payload = { rawBody: f.event('evt_pay01c1'), signature: 'valid',
    db: f.db, stripe: f.stripe, env: f.opts.env };
  const first = await P.processPay01aWebhook(payload);
  const dup = await P.processPay01aWebhook(payload);
  assert.equal(first.status, 'paid');
  assert.equal(dup.duplicateEvent, true);
  assert.equal(f.receiptIds.size, 1);
  assert.equal(f.order.granted_at !== null, true);
  const late = await P.processPay01aWebhook({ ...payload,
    rawBody: f.event('evt_pay01c2', 'checkout.session.expired') });
  assert.equal(late.status, 'paid');
});

test('PAY01C: admin refund once revokes report; delayed old event cannot restore access', async () => {
  const f = fake(); await f.start(); f.pay();
  await S.readBuyerDemoOrder({ ...f.opts, orderId: ID, refresh: true });
  const refunded = await S.refundAdminDemoOrder({ orderId: ID, db: f.db, stripe: f.stripe, env: f.opts.env });
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.reportAvailable, false);
  assert.equal(refunded.entitlement, 'revoked');
  await assert.rejects(S.readBuyerDemoReport({ ...f.opts, orderId: ID }), /PAY01C_REPORT_NOT_ENTITLED/);
  const replay = await S.refundAdminDemoOrder({ orderId: ID, db: f.db, stripe: f.stripe, env: f.opts.env });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(f.calls.filter(x => x === 'refund_create').length, 1);
  const late = await P.processPay01aWebhook({
    rawBody: f.event('evt_pay01c3'), signature: 'valid', db: f.db, stripe: f.stripe, env: f.opts.env,
  });
  assert.equal(late.status, 'refunded');
  assert.equal(f.order.revoked_at !== null, true);
});

test('PAY01C: schema is additive and browser/admin route authorities remain separated', () => {
  const source = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const migration = source('../database/migrations/20261030223000_carup_pay01c_demo_product.sql');
  assert.match(migration, /REFERENCES public\.payment_transactions\(reference\)/);
  assert.match(migration, /pay01c_sync_demo_entitlement/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.pay01c_demo_orders FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);
  const routes = source('routes/pay01cDemoRoutes.js');
  assert.match(routes, /buyerSession = authorizeSessionRole\(\[\]\)/);
  assert.match(routes, /adminSession = authorizeSessionRole\(\['admin'\]\)/);
  assert.match(routes, /admin\/orders\/:orderId\/refund', adminSession/);
  assert.doesNotMatch(routes, /x-user-id/);
  const oldRoutes = source('routes/pay01aRoutes.js');
  assert.match(oldRoutes, /admin = authorizeSessionRole\(\['admin'\]\)/);
});
