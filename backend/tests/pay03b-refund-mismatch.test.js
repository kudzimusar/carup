/**
 * CARUP-PAY-03B-LR01 Work Unit 01 — F5 cross-cutting payment integrity.
 *
 * A refund that conflicts with CarUp's approved full-refund-only policy (for example a partial refund
 * created directly in the Stripe dashboard) must become a durable, operator-visible reconciliation hold:
 * the provider truth is preserved, the payment never authorizes protected content while held, and only a
 * verified provider state plus an authorized resolution can end the hold.
 *
 * This file covers the pure provider-evidence contract and the webhook/service boundary with injected
 * fakes. The canonical database state machine is exercised against real PostgreSQL in
 * backend/tests/sql/pay03b-f5-reconciliation-postgres-smoke.sql.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const C = await import('../services/payment/pay01aContract.js');

const REF = 'pay01a_00000000-0000-4000-8000-0000000000f5';
const INTENT = 'pi_f5partial0001';

function paidSnapshotFixture() {
  const meta = C.pay01aMetadata(REF);
  const checkout = {
    id: 'cs_test_f5partial0001', mode: 'payment', livemode: false,
    client_reference_id: REF, metadata: meta, amount_total: 100, currency: 'jpy',
    payment_status: 'paid', status: 'complete', payment_intent: INTENT,
  };
  const intent = {
    id: INTENT, livemode: false, amount: 100, amount_received: 100,
    currency: 'jpy', status: 'succeeded', metadata: meta,
  };
  return { checkout, intent };
}

function refund(id, amount, status = 'succeeded', extra = {}) {
  // Dashboard-created refunds carry no CarUp metadata and (in the current API) may omit livemode.
  return { id, object: 'refund', payment_intent: INTENT, currency: 'jpy', amount, status, metadata: {}, ...extra };
}

function evaluate(refunds) {
  const { checkout, intent } = paidSnapshotFixture();
  return C.evaluatePay01aProviderSnapshot({ checkout, intent, refunds, reference: REF });
}

test('F5 contract: an external partial refund that succeeded becomes a reconciliation hold, never paid or refunded', () => {
  const result = evaluate([refund('re_f5part30', 30)]);
  assert.equal(result.status, 'reconciliation_hold');
  assert.equal(result.intentId, INTENT);
  assert.deepEqual(result.refundEvidence, {
    mismatch: 'partial_refund_succeeded',
    refundedMinor: 30,
    pendingRefundMinor: 0,
    refundIds: ['re_f5part30'],
  });
});

test('F5 contract: a pending partial refund is already a policy conflict (hold), not a full refund in flight', () => {
  const result = evaluate([refund('re_f5pend40', 40, 'pending')]);
  assert.equal(result.status, 'reconciliation_hold');
  assert.equal(result.refundEvidence.mismatch, 'partial_refund_pending');
  assert.equal(result.refundEvidence.refundedMinor, 0);
  assert.equal(result.refundEvidence.pendingRefundMinor, 40);
});

test('F5 contract: only a provider-confirmed full amount is refunded, even when it arrives as several partial refunds', () => {
  assert.equal(evaluate([refund('re_a', 60), refund('re_b', 40)]).status, 'refunded');
  // Succeeded part + pending remainder is still not a confirmed full refund.
  const inFlight = evaluate([refund('re_a', 60), refund('re_b', 40, 'pending')]);
  assert.equal(inFlight.status, 'reconciliation_hold');
  assert.equal(inFlight.refundEvidence.mismatch, 'partial_refund_succeeded');
  assert.equal(inFlight.refundEvidence.refundedMinor, 60);
  assert.equal(inFlight.refundEvidence.pendingRefundMinor, 40);
});

test('F5 contract: CarUp policy-consistent states are unchanged (full pending refund, full refund, failed refund)', () => {
  assert.equal(evaluate([refund('re_full', 100, 'pending')]).status, 'refund_pending');
  assert.equal(evaluate([refund('re_full', 100)]).status, 'refunded');
  // A failed or cancelled refund moved no money: the provider truth is simply paid. Whether a held payment
  // may return to paid is decided by the canonical database state machine, not by this pure evaluation.
  assert.equal(evaluate([refund('re_failed', 40, 'failed')]).status, 'paid');
  assert.equal(evaluate([refund('re_canceled', 40, 'canceled')]).status, 'paid');
  assert.deepEqual(evaluate([]), { status: 'paid', intentId: INTENT }, 'certified PAY-01A result shape preserved');
});

test('F5 contract: refund evidence that cannot belong to this payment still fails closed', () => {
  assert.throws(() => evaluate([refund('re_other', 30, 'succeeded', { payment_intent: 'pi_someoneelse' })]),
    /PAY01A_PROVIDER_REFUND_MISMATCH/, 'unmatched PaymentIntent');
  assert.throws(() => evaluate([refund('re_live', 30, 'succeeded', { livemode: true })]),
    /PAY01A_PROVIDER_REFUND_MISMATCH/, 'live-mode refund');
  assert.throws(() => evaluate([refund('re_usd', 30, 'succeeded', { currency: 'usd' })]),
    /PAY01A_PROVIDER_REFUND_MISMATCH/, 'currency substitution');
  assert.throws(() => evaluate([refund('re_zero', 0)]), /PAY01A_PROVIDER_REFUND_MISMATCH/, 'non-positive amount');
  assert.throws(() => evaluate([refund('re_frac', 12.5)]), /PAY01A_PROVIDER_REFUND_MISMATCH/, 'fractional minor units');
  assert.throws(() => evaluate([refund('re_a', 80), refund('re_b', 40)]), /PAY01A_REFUND_OVERFLOW/);
  assert.throws(() => evaluate([refund('re_a', 80), refund('re_b', 40, 'pending')]), /PAY01A_REFUND_OVERFLOW/);
});

test('F5 contract: the refund classifier is reusable for any canonical payment amount (subscription invoices)', () => {
  const evidence = C.classifyPay01aRefundEvidence({
    intentId: 'pi_invoice1', amountMinor: 3000, currency: 'jpy',
    refunds: [{ id: 're_inv1', payment_intent: 'pi_invoice1', currency: 'jpy', amount: 1000, status: 'succeeded' }],
  });
  assert.equal(evidence.state, 'reconciliation_hold');
  assert.equal(evidence.refundedMinor, 1000);
  assert.equal(C.classifyPay01aRefundEvidence({
    intentId: 'pi_invoice1', amountMinor: 3000, currency: 'jpy', refunds: [],
  }).state, 'paid');
  assert.throws(() => C.classifyPay01aRefundEvidence({
    intentId: 'pi_invoice1', amountMinor: 0, currency: 'jpy', refunds: [],
  }), /PAY01A_PROVIDER_AMOUNT_INVALID/);
});

// ---------------------------------------------------------------------------------------------------------
// Service / webhook boundary (pay01aService) with injected Stripe and canonical-DB fakes.
// ---------------------------------------------------------------------------------------------------------
const S = await import('../services/payment/pay01aService.js');

function fixtureEnv() {
  return {
    NODE_ENV: 'test', CARUP_ENV: 'test', CARUP_PAY01A_ENABLED: 'true',
    CARUP_PAY01A_STRIPE_ACCOUNT_ID: C.PAY01A_ACCOUNT,
    CARUP_PAY01A_STRIPE_SECRET_KEY: 'sk_test_local_fixture_only_000000',
    CARUP_PAY01A_STRIPE_WEBHOOK_SECRET: 'whsec_localFixtureOnly000000',
    CARUP_PAY01A_RETURN_ORIGIN: 'http://localhost:5173',
  };
}

const REF_B = 'pay01a_00000000-0000-4000-8000-0000000000b5';

function servicePaidFixture({ failRetrieval = false } = {}) {
  const { checkout, intent } = paidSnapshotFixture();
  const rows = new Map([
    [REF, {
      reference: REF, gateway: 'stripe_carup_japan_sandbox', amount: 100, currency: 'JPY', status: 'paid',
      pay01a_actor_id: 'buyer-f5', pay01a_account_id: C.PAY01A_ACCOUNT, pay01a_checkout_id: checkout.id,
      pay01a_intent_id: INTENT, pay01a_refund_id: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
    }],
    [REF_B, {
      reference: REF_B, gateway: 'stripe_carup_japan_sandbox', amount: 100, currency: 'JPY', status: 'paid',
      pay01a_actor_id: 'buyer-other', pay01a_account_id: C.PAY01A_ACCOUNT, pay01a_checkout_id: 'cs_test_f5other',
      pay01a_intent_id: 'pi_f5other0001', pay01a_refund_id: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
    }],
  ]);
  const refunds = [];
  const writes = [];
  const calls = [];
  const stripe = {
    accounts: { retrieve: async () => ({ id: C.PAY01A_ACCOUNT }) },
    checkout: { sessions: { retrieve: async (id) => {
      calls.push(['checkout.retrieve', id]);
      if (failRetrieval) throw new Error('provider unavailable');
      return { ...checkout };
    } } },
    paymentIntents: { retrieve: async () => ({ ...intent }) },
    refunds: {
      list: async () => ({ data: refunds.map((r) => ({ ...r })), has_more: false }),
      create: async (args, opts) => {
        calls.push(['refunds.create', args, opts]);
        const created = { id: 're_f5carup' + refunds.length, object: 'refund', payment_intent: INTENT, currency: 'jpy',
          amount: args.amount ?? 100, status: 'succeeded', created: 2000 + refunds.length, metadata: args.metadata };
        refunds.push(created);
        return { ...created };
      },
    },
    webhooks: { constructEvent: (raw, signature) => {
      if (signature !== 'valid') throw new Error('invalid fixture signature');
      return JSON.parse(raw.toString('utf8'));
    } },
  };
  const rowSelect = () => {
    const filters = {};
    const q = {
      eq: (col, val) => { filters[col] = val; return q; },
      maybeSingle: async () => {
        const match = [...rows.values()].filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        return { data: match[0] ? { ...match[0] } : null, error: null };
      },
    };
    return q;
  };
  const db = {
    from: (table) => {
      assert.equal(table, 'payment_transactions');
      return { select: () => rowSelect() };
    },
    rpc: async (name, args) => {
      if (name === 'pay03b_apply_provider_payment_snapshot') {
        writes.push(args);
        const row = rows.get(args.p_reference);
        // Minimal mirror of the canonical sticky hold (the real state machine is certified in SQL).
        if (row.status === 'reconciliation_hold' && args.p_status !== 'refunded') {
          return { data: { ...row, duplicate_event: false, hold_retained: args.p_status !== 'reconciliation_hold' }, error: null };
        }
        row.status = args.p_status;
        if (args.p_status !== 'reconciliation_hold') row.pay01a_refund_id ||= args.p_refund_id;
        return { data: { ...row, duplicate_event: false, hold_retained: false,
          reconciliation_exception_event: args.p_status === 'reconciliation_hold' ? 'opened' : null }, error: null };
      }
      if (name === 'pay01a_begin_refund') {
        calls.push(['begin_refund', args]);
        const row = rows.get(args.p_reference);
        if (row.pay01a_actor_id !== args.p_actor_id) return { data: null, error: { message: 'PAY01A_REFUND_AUTHORITY_REFUSED' } };
        if (row.status === 'reconciliation_hold') return { data: { ...row, reconciliation_hold: true }, error: null };
        row.status = 'refund_pending';
        return { data: { ...row }, error: null };
      }
      if (name === 'pay02_sync_quote_from_canonical_payment') return { data: null, error: null };
      return { data: null, error: { message: 'UNEXPECTED_RPC_' + name } };
    },
  };
  return { rows, refunds, writes, calls, stripe, db, env: fixtureEnv() };
}

function signed(event) {
  return { rawBody: Buffer.from(JSON.stringify(event)), signature: 'valid' };
}

test('F5 webhook: a dashboard partial refund with NO CarUp metadata is bound through its PaymentIntent and held', async () => {
  const f = servicePaidFixture();
  f.refunds.push(refund('re_dash30', 30, 'succeeded', { created: 1000 }));
  const event = { id: 'evt_f5dash30', type: 'refund.created', livemode: false,
    data: { object: { id: 're_dash30', object: 'refund', payment_intent: INTENT, metadata: {} } } };
  const result = await S.processPay01aWebhook({ ...signed(event), db: f.db, env: f.env, stripe: f.stripe });
  assert.equal(result.status, 'reconciliation_hold');
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0], {
    p_reference: REF, p_status: 'reconciliation_hold', p_intent_id: INTENT, p_refund_id: null,
    p_event_id: 'evt_f5dash30', p_event_type: 'refund.created',
    p_refunded_minor: 30, p_pending_refund_minor: 0, p_refund_ids: ['re_dash30'],
    p_mismatch: 'partial_refund_succeeded', p_detected_via: 'signed_webhook',
  });
});

test('F5 webhook: charge.refunded carrying the PaymentIntent metadata reaches the same held evidence', async () => {
  const f = servicePaidFixture();
  f.refunds.push(refund('re_dash30', 30, 'succeeded', { created: 1000 }));
  const event = { id: 'evt_f5charge30', type: 'charge.refunded', livemode: false,
    data: { object: { id: 'ch_f5', object: 'charge', payment_intent: INTENT, metadata: C.pay01aMetadata(REF) } } };
  const result = await S.processPay01aWebhook({ ...signed(event), db: f.db, env: f.env, stripe: f.stripe });
  assert.equal(result.status, 'reconciliation_hold');
  assert.equal(f.writes[0].p_mismatch, 'partial_refund_succeeded');
  assert.equal(f.writes[0].p_detected_via, 'signed_webhook');
});

test('F5 readback: a later provider read discovers the partial refund (provider_readback) and never lifts a hold', async () => {
  const f = servicePaidFixture();
  f.refunds.push(refund('re_dash40', 40, 'pending', { created: 1000 }));
  const held = await S.reconcilePay01aPayment({ reference: REF, actorId: 'buyer-f5', db: f.db, env: f.env, stripe: f.stripe });
  assert.equal(held.status, 'reconciliation_hold');
  assert.equal(f.writes[0].p_mismatch, 'partial_refund_pending');
  assert.equal(f.writes[0].p_detected_via, 'provider_readback');
  // The pending partial refund then fails at the provider: truth is 'paid', but the canonical hold is retained.
  f.refunds[0].status = 'failed';
  const after = await S.reconcilePay01aPayment({ reference: REF, actorId: 'buyer-f5', db: f.db, env: f.env, stripe: f.stripe });
  assert.equal(f.writes[1].p_status, 'paid');
  assert.deepEqual([f.writes[1].p_refunded_minor, f.writes[1].p_pending_refund_minor, f.writes[1].p_refund_ids], [0, 0, []]);
  assert.equal(after.status, 'reconciliation_hold');
  assert.equal(after.holdRetained, true);
});

test('F5 webhook: an unmatched PaymentIntent is ignored without any canonical write', async () => {
  const f = servicePaidFixture();
  const event = { id: 'evt_f5unmatched', type: 'refund.created', livemode: false,
    data: { object: { id: 're_x', object: 'refund', payment_intent: 'pi_notours0001', metadata: {} } } };
  const result = await S.processPay01aWebhook({ ...signed(event), db: f.db, env: f.env, stripe: f.stripe });
  assert.deepEqual(result, { ignored: true, reason: 'unmatched_payment_intent', live: false });
  assert.equal(f.writes.length, 0);
});

test('F5 webhook: metadata naming one payment with another payment\'s PaymentIntent is refused (reference substitution)', async () => {
  const f = servicePaidFixture();
  const event = { id: 'evt_f5swap', type: 'charge.refunded', livemode: false,
    data: { object: { id: 'ch_swap', object: 'charge', payment_intent: 'pi_f5other0001', metadata: C.pay01aMetadata(REF) } } };
  await assert.rejects(S.processPay01aWebhook({ ...signed(event), db: f.db, env: f.env, stripe: f.stripe }),
    (err) => err.code === 'PAY01A_EVENT_REFERENCE_MISMATCH' && err.status === 400);
  assert.equal(f.writes.length, 0);
});

test('F5 webhook: an event from another Stripe account or live mode is refused before any lookup', async () => {
  const f = servicePaidFixture();
  for (const bad of [{ account: 'acct_someoneelse' }, { livemode: true }]) {
    const event = { id: 'evt_f5acct', type: 'charge.refunded', livemode: false, ...bad,
      data: { object: { object: 'charge', payment_intent: INTENT, metadata: C.pay01aMetadata(REF) } } };
    await assert.rejects(S.processPay01aWebhook({ ...signed(event), db: f.db, env: f.env, stripe: f.stripe }),
      /PAY01A_EVENT_ENVIRONMENT_MISMATCH/);
  }
  assert.equal(f.writes.length, 0);
});

test('F5 readback: a provider read failure changes nothing (no write, no reinstatement)', async () => {
  const f = servicePaidFixture({ failRetrieval: true });
  f.rows.get(REF).status = 'reconciliation_hold';
  await assert.rejects(S.reconcilePay01aPayment({ reference: REF, actorId: 'buyer-f5', db: f.db, env: f.env, stripe: f.stripe }),
    (err) => err.code === 'PAY01A_PROVIDER_RETRIEVAL_UNAVAILABLE' && err.status === 502);
  assert.equal(f.writes.length, 0);
  assert.equal(f.rows.get(REF).status, 'reconciliation_hold');
});

test('F5 refund: completing a held partial refund refunds exactly the provider-confirmed remainder, once', async () => {
  const f = servicePaidFixture();
  f.refunds.push(refund('re_dash30', 30, 'succeeded', { created: 1000 }));
  const result = await S.refundPay01aPayment({ reference: REF, actorId: 'buyer-f5', db: f.db, env: f.env, stripe: f.stripe });
  const created = f.calls.filter((c) => c[0] === 'refunds.create');
  assert.equal(created.length, 1);
  assert.equal(created[0][1].amount, 70, 'only the remainder is refunded');
  assert.equal(created[0][1].payment_intent, INTENT);
  assert.match(created[0][2].idempotencyKey, /^carup_pay01a_refund_remainder_30_/);
  assert.equal(result.status, 'refunded');
  assert.equal(f.writes.at(-1).p_refund_id, 're_dash30', 'the oldest succeeded refund is the stable refund reference');
});

test('F5 refund: completion is refused while a provider refund is still in flight', async () => {
  const f = servicePaidFixture();
  f.refunds.push(refund('re_dash30', 30, 'succeeded', { created: 1000 }));
  f.refunds.push(refund('re_dash20', 20, 'pending', { created: 1001 }));
  await assert.rejects(S.refundPay01aPayment({ reference: REF, actorId: 'buyer-f5', db: f.db, env: f.env, stripe: f.stripe }),
    (err) => err.code === 'PAY01A_REFUND_IN_FLIGHT' && err.status === 409);
  assert.equal(f.calls.filter((c) => c[0] === 'refunds.create').length, 0);
});

test('F5 refund: an ordinary full refund is unchanged (no explicit amount, refund idempotency key)', async () => {
  const f = servicePaidFixture();
  const result = await S.refundPay01aPayment({ reference: REF, actorId: 'buyer-f5', db: f.db, env: f.env, stripe: f.stripe });
  const created = f.calls.filter((c) => c[0] === 'refunds.create');
  assert.equal(created.length, 1);
  assert.equal(created[0][1].amount, undefined);
  assert.match(created[0][2].idempotencyKey, /^carup_pay01a_refund_[0-9a-f]{32}$/);
  assert.equal(result.status, 'refunded');
});

// ---------------------------------------------------------------------------------------------------------
// Operator surface: alert inventory, fresh-provider-verified resolution, attributable audit.
// ---------------------------------------------------------------------------------------------------------
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const R = await import('../services/payment/pay03bReconciliationService.js');

const EXC = '7f3c2a1e-0000-4000-8000-0000000000e5';

function operatorFixture({ providerRefunds = [], failRetrieval = false, resolveFault = null } = {}) {
  const f = servicePaidFixture({ failRetrieval });
  f.rows.get(REF).status = 'reconciliation_hold';
  f.refunds.push(...providerRefunds);
  const rpcCalls = [];
  const db = createMockSupabase({
    payment_transactions: [...f.rows.values()],
    pay03b_payment_reconciliation_exceptions: [{
      id: EXC, payment_reference: REF, exception_type: 'partial_refund_policy_conflict', status: 'open', severity: 'high',
      gateway: 'stripe_carup_japan_sandbox', provider_account_id: C.PAY01A_ACCOUNT, provider_payment_intent_id: INTENT,
      payment_amount_minor: 100, currency: 'JPY', prior_payment_status: 'paid', mismatch: 'partial_refund_succeeded',
      detected_refunded_minor: 30, detected_pending_refund_minor: 0, detected_refund_ids: ['re_dash30'],
      detected_via: 'signed_webhook', detection_event_type: 'refund.created', first_detected_at: '2026-11-01T10:00:00Z',
      observation_count: 1, last_observed_status: 'reconciliation_hold', last_observed_refunded_minor: 30,
      last_observed_pending_refund_minor: 0, last_observed_via: 'signed_webhook', last_observed_at: '2026-11-01T10:00:00Z',
      acknowledged_by: null, acknowledged_at: null, resolution: null, resolved_by: null, resolution_note: null, resolved_at: null,
    }],
    trust_audit_events: [],
  }, {
    rpc: {
      pay03b_resolve_payment_reconciliation_exception: (p, { table }) => {
        rpcCalls.push(['resolve', p]);
        if (resolveFault) throw new Error(resolveFault);
        if (p.p_resolution === 'restore_access_provider_unrefunded'
          && (p.p_verified_status !== 'paid' || p.p_verified_refunded_minor !== 0 || p.p_verified_pending_refund_minor !== 0)) {
          throw new Error('PAY03B_RESTORE_REQUIRES_UNREFUNDED_PROVIDER_STATE');
        }
        const exception = table('pay03b_payment_reconciliation_exceptions').find((x) => x.id === p.p_exception_id);
        Object.assign(exception, { status: 'resolved', resolution: p.p_resolution, resolved_by: p.p_actor_id,
          resolution_note: p.p_note, resolved_at: '2026-11-01T10:05:00Z' });
        const payment = table('payment_transactions').find((x) => x.reference === exception.payment_reference);
        payment.status = p.p_resolution === 'restore_access_provider_unrefunded' ? 'paid' : 'partially_refunded';
        return { exception: { ...exception }, payment_reference: payment.reference, payment_status: payment.status,
          sync: { report_entitlement_status: payment.status === 'paid' ? 'entitled' : 'revoked_refunded' } };
      },
      pay03b_acknowledge_payment_reconciliation_exception: (p, { table }) => {
        rpcCalls.push(['acknowledge', p]);
        const exception = table('pay03b_payment_reconciliation_exceptions').find((x) => x.id === p.p_exception_id);
        if (!exception.acknowledged_at) Object.assign(exception, { acknowledged_by: p.p_actor_id, acknowledged_at: '2026-11-01T10:01:00Z' });
        return { ...exception };
      },
    },
  });
  return { ...f, db, rpcCalls };
}

const adminCtx = { adminActorId: 'ops-admin-1', adminActorRole: 'admin', sourceRoute: '/api/pay03b/admin/reconciliation-exceptions',
  requestContext: { requestId: 'req-f5-1', ipAddress: '127.0.0.1', userAgent: 'node-test' } };

test('F5 operator: the open-exception inventory is the operator alert, with exact evidence and the source of truth', async () => {
  const f = operatorFixture();
  const list = await R.listPay03bReconciliationExceptions({ status: 'open', db: f.db, env: f.env });
  assert.equal(list.openCount, 1);
  assert.equal(list.exceptions[0].id, EXC);
  assert.equal(list.exceptions[0].detectedRefundedMinor, 30);
  assert.equal(list.exceptions[0].paymentAmountMinor, 100);
  assert.match(list.sourceOfFinancialTruth, /payment_transactions/);
  assert.equal(JSON.stringify(list).includes('buyer-f5'), false, 'no payer identity in the operator inventory');
  await assert.rejects(R.listPay03bReconciliationExceptions({ status: 'everything', db: f.db, env: f.env }),
    (err) => err.code === 'PAY03B_RECONCILIATION_STATUS_FILTER_INVALID' && err.status === 400);
});

test('F5 operator: resolution needs a proven administrator and a written reason before anything happens', async () => {
  const f = operatorFixture();
  await assert.rejects(R.resolvePay03bReconciliationException({ exceptionId: EXC, resolution: 'restore_access_provider_unrefunded',
    note: 'Provider shows no refund.', db: f.db, env: f.env, stripe: f.stripe }),
  (err) => err.code === 'PAY03B_ADMIN_ACTOR_REQUIRED' && err.status === 401);
  await assert.rejects(R.resolvePay03bReconciliationException({ ...adminCtx, exceptionId: EXC, resolution: 'restore_access_provider_unrefunded',
    note: 'too short', db: f.db, env: f.env, stripe: f.stripe }),
  (err) => err.code === 'PAY03B_RESOLUTION_NOTE_REQUIRED' && err.status === 400);
  await assert.rejects(R.resolvePay03bReconciliationException({ ...adminCtx, exceptionId: EXC, resolution: 'mark_paid',
    note: 'Provider shows no refund at all.', db: f.db, env: f.env, stripe: f.stripe }),
  (err) => err.code === 'PAY03B_RESOLUTION_INVALID' && err.status === 400);
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(f.calls.filter((c) => c[0] === 'checkout.retrieve').length, 0, 'no provider read before validation');
});

test('F5 operator: the REQUESTED audit is written before the provider read; if it cannot be written nothing proceeds', async () => {
  const f = operatorFixture();
  f.db.setFault('trust_audit_events:insert');
  const originalFrom = f.db.from;
  f.db.from = (table) => {
    const chain = originalFrom(table);
    if (table !== 'trust_audit_events') return chain;
    return { insert: async () => ({ data: null, error: { message: 'audit store unavailable' } }) };
  };
  await assert.rejects(R.resolvePay03bReconciliationException({ ...adminCtx, exceptionId: EXC,
    resolution: 'restore_access_provider_unrefunded', note: 'Provider shows the partial refund failed.',
    db: f.db, env: f.env, stripe: f.stripe }),
  (err) => err.code === 'PAY03B_RECONCILIATION_AUDIT_UNAVAILABLE' && err.status === 503);
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(f.calls.filter((c) => c[0] === 'checkout.retrieve').length, 0);
});

test('F5 operator: a resolution rests on a FRESH provider read; a failed read refuses it (502) and changes nothing', async () => {
  const f = operatorFixture({ failRetrieval: true });
  await assert.rejects(R.resolvePay03bReconciliationException({ ...adminCtx, exceptionId: EXC,
    resolution: 'restore_access_provider_unrefunded', note: 'Provider shows the partial refund failed.',
    db: f.db, env: f.env, stripe: f.stripe }),
  (err) => err.code === 'PAY01A_PROVIDER_RETRIEVAL_UNAVAILABLE' && err.status === 502);
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(f.db._rows('payment_transactions').find((r) => r.reference === REF).status, 'reconciliation_hold');
});

test('F5 operator: restore passes the exact verified provider evidence; a still-refunded payment is refused by the canonical RPC', async () => {
  const f = operatorFixture({ providerRefunds: [refund('re_dash30', 30, 'succeeded', { created: 1000 })] });
  await assert.rejects(R.resolvePay03bReconciliationException({ ...adminCtx, exceptionId: EXC,
    resolution: 'restore_access_provider_unrefunded', note: 'Attempting restore while refund stands.',
    db: f.db, env: f.env, stripe: f.stripe }),
  (err) => err.code === 'PAY03B_RESTORE_REQUIRES_UNREFUNDED_PROVIDER_STATE' && err.status === 409);
  const [, params] = f.rpcCalls[0];
  assert.equal(params.p_verified_status, 'reconciliation_hold');
  assert.equal(params.p_verified_refunded_minor, 30);
  assert.deepEqual(params.p_verified_refund_ids, ['re_dash30']);
  assert.ok(Math.abs(Date.parse(params.p_verified_at) - Date.now()) < 60_000, 'verification timestamp is fresh');
  const audits = f.db._rows('trust_audit_events').map((a) => a.event_type);
  assert.deepEqual(audits, ['PAY03B_RECONCILIATION_RESOLUTION_REQUESTED', 'PAY03B_RECONCILIATION_RESOLUTION_RESULT']);
  assert.equal(f.db._rows('trust_audit_events')[1].new_value.outcome, 'failed');
});

test('F5 operator: the verification time is taken BEFORE the provider read (superseded evidence is refusable in SQL)', async () => {
  const f = operatorFixture({ providerRefunds: [refund('re_dash30', 30, 'failed', { created: 1000 })] });
  const retrieve = f.stripe.checkout.sessions.retrieve;
  let readAt = null;
  f.stripe.checkout.sessions.retrieve = async (id) => {
    readAt = Date.now();
    await new Promise((resolve) => { setTimeout(resolve, 25); });
    return retrieve(id);
  };
  await R.resolvePay03bReconciliationException({ ...adminCtx, exceptionId: EXC,
    resolution: 'restore_access_provider_unrefunded', note: 'Fresh readback: the dashboard refund failed; nothing refunded.',
    db: f.db, env: f.env, stripe: f.stripe });
  const [, params] = f.rpcCalls[0];
  assert.ok(readAt !== null, 'the provider was read');
  assert.ok(Date.parse(params.p_verified_at) <= readAt, 'p_verified_at precedes the provider read');
});

test('F5 operator: a verified unrefunded payment is restored, attributed to the administrator, and audited', async () => {
  const f = operatorFixture({ providerRefunds: [refund('re_dash30', 30, 'failed', { created: 1000 })] });
  const result = await R.resolvePay03bReconciliationException({ ...adminCtx, exceptionId: EXC,
    resolution: 'restore_access_provider_unrefunded', note: 'Fresh readback: the dashboard refund failed; nothing refunded.',
    db: f.db, env: f.env, stripe: f.stripe });
  assert.equal(result.paymentStatus, 'paid');
  assert.equal(result.entitlementStatus, 'entitled');
  assert.equal(result.exception.status, 'resolved');
  assert.equal(result.exception.resolvedBy, 'ops-admin-1');
  assert.equal(result.providerTruth.status, 'paid');
  const [, params] = f.rpcCalls[0];
  assert.equal(params.p_actor_id, 'ops-admin-1');
  assert.equal(params.p_actor_role, 'admin');
  const result_audit = f.db._rows('trust_audit_events').at(-1);
  assert.equal(result_audit.event_type, 'PAY03B_RECONCILIATION_RESOLUTION_RESULT');
  assert.equal(result_audit.actor_user_id, 'ops-admin-1');
  assert.equal(result_audit.new_value.outcome, 'resolved');
});

test('F5 operator: acknowledgement is attributed and resolves nothing; raw RPC failures never leak', async () => {
  const f = operatorFixture();
  const ack = await R.acknowledgePay03bReconciliationException({ ...adminCtx, exceptionId: EXC, db: f.db, env: f.env });
  assert.equal(ack.exception.acknowledgedBy, 'ops-admin-1');
  assert.equal(ack.exception.status, 'open');
  const g = operatorFixture({ providerRefunds: [], resolveFault: 'connection to server at "10.1.2.3" failed: secret detail' });
  await assert.rejects(R.resolvePay03bReconciliationException({ ...adminCtx, exceptionId: EXC,
    resolution: 'restore_access_provider_unrefunded', note: 'Fresh readback shows nothing refunded.',
    db: g.db, env: g.env, stripe: g.stripe }),
  (err) => err.code === 'PAY03B_CANONICAL_RPC_UNAVAILABLE' && err.status === 503 && !String(err.message).includes('10.1.2.3'));
});
