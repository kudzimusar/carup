import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const C = await import('../services/payment/pay01aContract.js');
const S = await import('../services/payment/pay01aService.js');
const REF = 'pay01a_00000000-0000-4000-8000-000000000001';

function fixtureEnv(extra = {}) {
  return {
    NODE_ENV: 'test', CARUP_ENV: 'test', CARUP_PAY01A_ENABLED: 'true',
    CARUP_PAY01A_STRIPE_ACCOUNT_ID: C.PAY01A_ACCOUNT,
    CARUP_PAY01A_STRIPE_SECRET_KEY: 'sk_test_local_fixture_only_000000',
    CARUP_PAY01A_STRIPE_WEBHOOK_SECRET: 'whsec_localFixtureOnly000000',
    CARUP_PAY01A_RETURN_ORIGIN: 'http://localhost:5173', ...extra,
  };
}
function fakeSandbox() {
  const meta = C.pay01aMetadata(REF);
  const row = {
    reference: REF, gateway: 'stripe_carup_japan_sandbox',
    amount: 100, currency: 'JPY', status: 'pending', pay01a_actor_id: 'owner-1',
    pay01a_account_id: C.PAY01A_ACCOUNT,
    pay01a_checkout_id: null, pay01a_intent_id: null, pay01a_refund_id: null,
  };
  const checkout = {
    id: 'cs_test_pay01a123', mode: 'payment', livemode: false,
    client_reference_id: REF, metadata: meta, amount_total: 100, currency: 'jpy',
    payment_status: 'unpaid', status: 'open', payment_intent: null,
    url: 'https://checkout.stripe.com/c/pay/cs_test_pay01a123',
  };
  const intent = {
    id: 'pi_pay01a123', livemode: false, amount: 100, amount_received: 100,
    currency: 'jpy', status: 'succeeded', metadata: meta,
  };
  const refunds = [];
  const events = new Set();
  const calls = [];
  const stripe = {
    accounts: { retrieve: async () => { calls.push('accounts.retrieve'); return { id: C.PAY01A_ACCOUNT }; } },
    checkout: { sessions: {
      create: async (params, opts) => {
        calls.push({ method: 'checkout', params, opts });
        return { ...checkout };
      },
      retrieve: async () => { calls.push('checkout.retrieve'); return { ...checkout }; },
    } },
    paymentIntents: { retrieve: async () => { calls.push('intent.retrieve'); return { ...intent }; } },
    refunds: {
      list: async () => ({ data: refunds.map(r => ({ ...r })), has_more: false }),
      create: async (args, opts) => {
        calls.push({ method: 'refund', args, opts });
        const r = { id: 're_pay01a123', payment_intent: intent.id,
          currency: 'jpy', amount: 100, status: 'succeeded', livemode: false };
        refunds.push(r);
        return r;
      },
    },
    webhooks: { constructEvent: (raw, signature) => {
      if (signature !== 'valid') throw new Error('invalid fixture signature');
      return JSON.parse(raw.toString('utf8'));
    } },
  };
  const db = {
    rpc: async (name, args) => {
      calls.push(name);
      if (name === 'pay01a_claim_checkout') return { data: { ...row }, error: null };
      if (name === 'pay01a_attach_checkout') {
        assert.equal(args.p_reference, REF);
        row.pay01a_checkout_id = args.p_checkout_id;
        return { data: { ...row }, error: null };
      }
      if (name === 'pay01a_begin_refund') {
        assert.equal(row.status, 'paid');
        row.status = 'refund_pending';
        return { data: { ...row }, error: null };
      }
      if (name === 'pay01a_apply_provider_snapshot') {
        const duplicate = Boolean(args.p_event_id && events.has(args.p_event_id));
        if (args.p_event_id) events.add(args.p_event_id);
        if (!duplicate) {
          row.status = args.p_status;
          row.pay01a_intent_id ||= args.p_intent_id;
          row.pay01a_refund_id ||= args.p_refund_id;
        }
        return { data: { ...row, duplicate_event: duplicate }, error: null };
      }
      return { data: null, error: { code: 'MISSING_RPC' } };
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...row }, error: null }) }) }),
    }),
  };
  return { env: fixtureEnv(), stripe, db, checkout, intent, refunds, calls, row };
}

test('PAY01A: disables all live/unknown-account/remote-return/key mismatch paths', () => {
  assert.throws(() => C.requirePay01aSandbox(fixtureEnv({ VERCEL_ENV: 'production' })), /PAY01A_SANDBOX_DISABLED/);
  assert.throws(() => C.requirePay01aSandbox(fixtureEnv({ CARUP_ENV: 'production' })), /PAY01A_SANDBOX_DISABLED/);
  assert.throws(() => C.requirePay01aSandbox(fixtureEnv({ NODE_ENV: 'production', CARUP_ENV: 'staging' })), /PAY01A_SANDBOX_DISABLED/);
  assert.throws(() => C.requirePay01aSandbox(fixtureEnv({ CARUP_PAY01A_ENABLED: 'false' })), /PAY01A_SANDBOX_DISABLED/);
  assert.throws(() => C.requirePay01aSandbox(fixtureEnv({ CARUP_PAY01A_STRIPE_ACCOUNT_ID: 'acct_wrong' })), /PAY01A_MERCHANT_MISMATCH/);
  assert.throws(() => C.requirePay01aSandbox(fixtureEnv({ CARUP_PAY01A_STRIPE_SECRET_KEY: 'sk_live_danger' })), /PAY01A_TEST_KEY_REQUIRED/);
  assert.throws(() => C.requirePay01aSandbox(fixtureEnv({ CARUP_PAY01A_RETURN_ORIGIN: 'https://outside.test' })), /PAY01A_LOCAL_RETURN_ORIGIN_REQUIRED/);
  assert.throws(() => C.requirePay01aSandbox(fixtureEnv({ CARUP_PAY01A_STRIPE_WEBHOOK_SECRET: '' }), { webhook: true }), /PAY01A_WEBHOOK_SECRET_REQUIRED/);
  assert.throws(() => C.validatePay01aRequestKey('weak'), /PAY01A_IDEMPOTENCY_KEY_REQUIRED/);
});

test('PAY01A: never derives money success from browser return/unpaid checkout', () => {
  const f = fakeSandbox();
  assert.deepEqual(C.evaluatePay01aProviderSnapshot({
    checkout: f.checkout, reference: REF,
  }), { status: 'pending', intentId: null });
  assert.throws(() => C.evaluatePay01aProviderSnapshot({
    checkout: { ...f.checkout, amount_total: 999 }, reference: REF,
  }), /PAY01A_PROVIDER_CHECKOUT_MISMATCH/);
  assert.throws(() => C.evaluatePay01aProviderSnapshot({
    checkout: { ...f.checkout, payment_status: 'paid', payment_intent: f.intent.id },
    intent: { ...f.intent, livemode: true }, reference: REF,
  }), /PAY01A_PROVIDER_INTENT_MISMATCH/);
  assert.deepEqual(C.evaluatePay01aProviderSnapshot({
    checkout: { ...f.checkout, payment_status: 'unpaid', status: 'expired' },
    reference: REF,
  }), { status: 'cancelled', intentId: null });
});

test('PAY01A: paid, refunded, partial refund and provider metadata truth are strict', () => {
  const f = fakeSandbox();
  const paid = { ...f.checkout, payment_status: 'paid', payment_intent: f.intent.id };
  assert.equal(C.evaluatePay01aProviderSnapshot({
    checkout: paid, intent: f.intent, reference: REF,
  }).status, 'paid');
  const refund = { id: 're_abc', livemode: false, payment_intent: f.intent.id,
    amount: 100, currency: 'jpy', status: 'succeeded' };
  assert.equal(C.evaluatePay01aProviderSnapshot({
    checkout: paid, intent: f.intent, refunds: [refund], reference: REF,
  }).status, 'refunded');
  assert.throws(() => C.evaluatePay01aProviderSnapshot({
    checkout: paid, intent: f.intent, refunds: [{ ...refund, amount: 50 }], reference: REF,
  }), /PAY01A_PARTIAL_REFUND_NOT_AUTHORIZED/);
  assert.throws(() => C.evaluatePay01aProviderSnapshot({
    checkout: paid, intent: { ...f.intent, metadata: {} }, reference: REF,
  }), /PAY01A_PROVIDER_INTENT_MISMATCH/);
});

test('PAY01A: Checkout uses only server price/currency/reference and stable idempotency', async () => {
  const f = fakeSandbox();
  const r = await S.createPay01aCheckout({ actorId: 'owner-1', requestKey: 'request_abcdef123456', db: f.db, stripe: f.stripe, env: f.env });
  assert.equal(r.reference, REF);
  assert.equal(r.amount, 100);
  assert.equal(r.live, false);
  const { params, opts } = f.calls.find(c => c.method === 'checkout');
  assert.equal(params.mode, 'payment');
  assert.equal(params.line_items[0].price_data.unit_amount, 100);
  assert.equal(params.line_items[0].price_data.currency, 'jpy');
  assert.equal(params.client_reference_id, REF);
  assert.equal(params.payment_intent_data.metadata.carup_reference, REF);
  assert.equal(params.success_url.includes('{CHECKOUT_SESSION_ID}'), true);
  assert.equal(params.expires_at, undefined, 'time-dependent expiry invalidates retry idempotency');
  assert.equal(opts.idempotencyKey, C.pay01aIdempotency(REF, 'checkout'));
  assert.equal(f.row.pay01a_checkout_id, f.checkout.id);
});

test('PAY01A: account mismatch refuses before creating canonical money rows', async () => {
  const f = fakeSandbox();
  f.stripe.accounts.retrieve = async () => ({ id: 'acct_other' });
  await assert.rejects(S.createPay01aCheckout({
    actorId: 'owner-1', requestKey: 'request_abcdef123456', db: f.db, stripe: f.stripe, env: f.env,
  }), /PAY01A_STRIPE_ACCOUNT_REFUSED/);
  assert.ok(!f.calls.includes('pay01a_claim_checkout'));
});

test('PAY01A: real provider read is required before each reconciliation/refund; duplicate refund fails closed', async () => {
  const f = fakeSandbox();
  f.row.pay01a_checkout_id = f.checkout.id;
  f.checkout.payment_status = 'paid';
  f.checkout.status = 'complete';
  f.checkout.payment_intent = f.intent.id;
  const first = await S.reconcilePay01aPayment({ reference: REF, actorId: 'owner-1', db: f.db, stripe: f.stripe, env: f.env });
  assert.equal(first.status, 'paid');
  assert.ok(f.calls.includes('intent.retrieve'));
  const returned = await S.refundPay01aPayment({ reference: REF, actorId: 'owner-1', db: f.db, stripe: f.stripe, env: f.env });
  assert.equal(returned.status, 'refunded');
  assert.equal(returned.refundId, 're_pay01a123');
  const replay = await S.refundPay01aPayment({ reference: REF, actorId: 'owner-1', db: f.db, stripe: f.stripe, env: f.env });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(f.calls.filter(c => c.method === 'refund').length, 1);
});

test('PAY01A: signed event only initiates provider reconciliation; duplicates/out-of-order remain safe', async () => {
  const f = fakeSandbox();
  f.row.pay01a_checkout_id = f.checkout.id;
  f.checkout.payment_status = 'paid'; f.checkout.status = 'complete'; f.checkout.payment_intent = f.intent.id;
  const event = { id: 'evt_pay01a123', type: 'checkout.session.completed',
    livemode: false, data: { object: { client_reference_id: REF, metadata: C.pay01aMetadata(REF) } } };
  const raw = Buffer.from(JSON.stringify(event));
  await assert.rejects(S.processPay01aWebhook({
    rawBody: raw, signature: 'bad', db: f.db, env: f.env, stripe: f.stripe,
  }), /PAY01A_SIGNATURE_INVALID/);
  assert.equal(f.calls.includes('accounts.retrieve'), false, 'bad signature must not trigger a provider lookup');
  const r = await S.processPay01aWebhook({ rawBody: raw, signature: 'valid', db: f.db, env: f.env, stripe: f.stripe });
  assert.equal(r.status, 'paid');
  const replay = await S.processPay01aWebhook({ rawBody: raw, signature: 'valid', db: f.db, env: f.env, stripe: f.stripe });
  assert.equal(replay.duplicateEvent, true);
  const outOfOrder = { ...event, id: 'evt_outoforder1', type: 'checkout.session.expired' };
  const late = await S.processPay01aWebhook({
    rawBody: Buffer.from(JSON.stringify(outOfOrder)), signature: 'valid', db: f.db, env: f.env, stripe: f.stripe,
  });
  assert.equal(late.status, 'paid', 'delayed expiry event is not payment authority');
  await assert.rejects(S.processPay01aWebhook({
    rawBody: JSON.stringify(event), signature: 'valid', db: f.db, env: f.env, stripe: f.stripe,
  }), /PAY01A_RAW_SIGNATURE_REQUIRED/);
});

test('PAY01A: existing SafeTrade gates and retired provider webhook remain unchanged', () => {
  const source = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert.match(source('services/payment/paymentRouter.js'), /LEGACY_GATEWAY_WEBHOOK_DISABLED/);
  assert.match(source('routes/escrowTrustRoutes.js'), /LEGACY_SAFEPAY_WEBHOOK_DISABLED/);
  const pay = source('services/payment/pay01aService.js');
  assert.doesNotMatch(pay, /issue164_record_payment_state_atomic|issue164_begin_settlement_atomic|vehicle_reservations|escrow_trust_sessions/);
  assert.match(source('server.js'), /app\.use\(pay01aRouter\)/);
  assert.match(source('server.js'), /req\.rawBodyBytes = Buffer\.from\(buf\)/);
  assert.match(source('middleware/securityMiddleware.js'), /pay01a/);
  const mig = source('../database/migrations/20261029181000_carup_pay01a_stripe_sandbox.sql');
  assert.match(mig, /ALTER TABLE public\.payment_transactions/);
  assert.match(mig, /SECURITY DEFINER/);
  assert.match(mig, /FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(mig, /CREATE TABLE[^;]*pay01a_.*payment_transactions/i);
});


test('PAY01A: official Stripe SDK cryptographically authenticates exact raw bytes without contacting Stripe', async () => {
  const { default: Stripe } = await import('stripe');
  const client = new Stripe('sk_test_local_unit_fixture_key_only');
  const secret = 'whsec_localUnitFixtureOnly12345';
  const payload = JSON.stringify({
    id: 'evt_pay01a_crypto_local', type: 'checkout.session.completed', livemode: false,
    data: { object: { client_reference_id: REF, metadata: C.pay01aMetadata(REF) } },
  });
  const signature = client.webhooks.generateTestHeaderString({ payload, secret });
  const event = client.webhooks.constructEvent(Buffer.from(payload), signature, secret);
  assert.equal(event.id, 'evt_pay01a_crypto_local');
  assert.throws(
    () => client.webhooks.constructEvent(Buffer.from(payload + ' '), signature, secret),
    /signature|payload|match/i,
    'A byte-level change must invalidate the provider signature',
  );
  assert.throws(
    () => client.webhooks.constructEvent(Buffer.from(payload), signature, 'whsec_differentLocalFixture'),
    /signature|payload|match/i,
    'A different signing secret must be rejected',
  );
});
