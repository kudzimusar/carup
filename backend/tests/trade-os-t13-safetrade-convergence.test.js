import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SAFETRADE_ENABLED = 'true';
delete process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT;
delete process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT;

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { resolveSafeTradeCommercialTruth } = await import('../services/diaspora/safetrade/diasporaSafeTradeCommercialTruthService.js');
const { projectSafeTradeMoneyTruth } = await import('../services/diaspora/safetrade/diasporaSafeTradeMoneyTruthService.js');
const operationService = await import('../services/diaspora/safetrade/diasporaSafeTradeOperationService.js');
const milestoneService = await import('../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js');
const txnService = await import('../services/diaspora/safetrade/diasporaSafeTradeTransactionService.js');

const buyer = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: 'tenant-A' };
const seller = { id: 'seller-1', userId: 'seller-1', role: 'owner', platformRole: 'owner', tenantId: 'tenant-A' };
const outsider = { id: 'buyer-2', userId: 'buyer-2', role: 'owner', platformRole: 'owner', tenantId: 'tenant-B' };
const reviewer = { id: 'reviewer-1', userId: 'reviewer-1', role: 'reviewer', platformRole: 'reviewer', tenantId: 'tenant-B' };

function db({ quote = {}, order = {} } = {}) {
  return createMockSupabase({
    diaspora_import_orders: [{
      id: 'ord-1',
      buyer_id: 'buyer-1',
      tenant_id: 'tenant-A',
      status: 'SELLER_ASSIGNED',
      metadata: { rfq: { acceptedQuoteId: 'q-1' } },
      created_by: 'buyer-1',
      deleted_at: null,
      ...order,
    }],
    diaspora_import_quotes: [{
      id: 'q-1',
      import_order_id: 'ord-1',
      seller_id: 'seller-1',
      quote_amount: 2400000,
      quote_currency: 'JPY',
      status: 'ACCEPTED',
      tenant_id: 'tenant-A',
      deleted_at: null,
      ...quote,
    }],
    diaspora_safetrade_transactions: [],
    diaspora_import_audit_log: [],
  });
}

function moneyDb({ operation = null, milestone = {}, rpcCalls = [] } = {}) {
  const seedOperation = operation ? [operation] : [];
  return createMockSupabase({
    diaspora_safetrade_transactions: [{
      id: 'st-1',
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      tenant_id: 'tenant-A',
      import_order_id: 'ord-1',
      total_amount: 100,
      currency: 'USD',
      status: 'FUNDS_PENDING',
      created_by: 'buyer-1',
      updated_by: 'buyer-1',
      deleted_at: null,
    }],
    diaspora_safetrade_milestones: [{
      id: 'm-1',
      transaction_id: 'st-1',
      milestone_type: 'DEPOSIT',
      amount: 100,
      currency: 'USD',
      status: 'FUNDS_PENDING',
      provider_reference: 'pi-1',
      payer: 'buyer-1',
      payee: 'seller-1',
      deleted_at: null,
      ...milestone,
    }],
    diaspora_safetrade_operations: seedOperation,
  }, {
    rpc: {
      diaspora_safetrade_transition_atomic: (params, { table }) => {
        rpcCalls.push(params);
        const row = table('diaspora_safetrade_operations').find((candidate) => candidate.id === params.p_metadata?.operationId);
        if (row) {
          row.state = 'ledger_applied';
          row.applied_at = '2026-09-13T00:00:01Z';
        }
        const targetMilestone = table('diaspora_safetrade_milestones').find((candidate) => candidate.id === params.p_milestone_id);
        if (targetMilestone) targetMilestone.status = params.p_target_status;
        return {
          milestone: targetMilestone ? { ...targetMilestone } : null,
          transaction: { ...table('diaspora_safetrade_transactions')[0] },
          idempotentReplay: false,
        };
      },
    },
  });
}

function captureProvider(calls = []) {
  return {
    name: 'sandbox',
    async captureRelease(args) {
      calls.push(args);
      return { provider: 'sandbox', intentId: args.intentId, status: 'captured', live: false };
    },
  };
}

test('T13 commercial truth is inherited from the complete accepted quote', async () => {
  const client = db();
  const truth = await resolveSafeTradeCommercialTruth(client, {
    importOrderId: 'ord-1',
    userContext: buyer,
    sellerId: 'attacker-seller',
    currency: 'USD',
    totalAmount: 1,
    tenantId: 'tenant-A',
  });

  assert.equal(truth.amount, 2400000);
  assert.equal(truth.currency, 'JPY');
  assert.equal(truth.sellerId, 'seller-1');
  assert.equal(truth.buyerId, 'buyer-1');
  assert.equal(truth.provenance.status, 'ACCEPTED_QUOTE');
  assert.equal(truth.provenance.fx, null);
  assert.deepEqual(truth.provenance.ignoredAssertions.map((x) => x.field).sort(), ['currency', 'sellerId', 'totalAmount']);
});

test('T13 createTransaction cannot be re-priced by caller fields', async () => {
  const client = db();
  const result = await txnService.createTransaction(client, {
    importOrderId: 'ord-1',
    sellerId: 'attacker-seller',
    currency: 'USD',
    totalAmount: 1,
    tenantId: 'tenant-A',
    userContext: buyer,
    skipEligibility: true,
  });

  assert.equal(result.transaction.total_amount, 2400000);
  assert.equal(result.transaction.currency, 'JPY');
  assert.equal(result.transaction.seller_id, 'seller-1');
  assert.equal(result.transaction.buyer_id, 'buyer-1');
  assert.equal(result.transaction.metadata.safetrade.commercialSource.status, 'ACCEPTED_QUOTE');
  assert.equal(result.transaction.metadata.safetrade.commercialSource.fx, null);
});

test('T13 uses the order buyer even when a reviewer creates the governed overlay', async () => {
  const client = db();
  const result = await txnService.createTransaction(client, {
    importOrderId: 'ord-1',
    currency: 'JPY',
    totalAmount: 2400000,
    userContext: reviewer,
    skipEligibility: true,
  });
  assert.equal(result.transaction.buyer_id, 'buyer-1');
  assert.equal(result.transaction.created_by, 'reviewer-1');
  assert.equal(result.transaction.tenant_id, 'tenant-A');
});

test('T13 refuses an unrelated user before creating SafeTrade', async () => {
  const client = db();
  await assert.rejects(
    resolveSafeTradeCommercialTruth(client, {
      importOrderId: 'ord-1',
      userContext: outsider,
      sellerId: 'seller-1',
      currency: 'JPY',
      totalAmount: 2400000,
    }),
    /order buyer|reviewer\/admin/i,
  );
  assert.equal(client._rows('diaspora_safetrade_transactions').length, 0);
});

test('T13 incomplete accepted quote fails closed instead of accepting client-authored money', async () => {
  const client = db({ quote: { seller_id: undefined, quote_amount: undefined, quote_currency: undefined } });
  await assert.rejects(
    resolveSafeTradeCommercialTruth(client, {
      importOrderId: 'ord-1',
      userContext: buyer,
      sellerId: 'seller-legacy',
      currency: 'USD',
      totalAmount: 1000,
    }),
    (error) => error?.details?.code === 'SAFETRADE_ACCEPTED_QUOTE_INCOMPLETE'
      && error.details.missingFields.length === 3,
  );
});

test('T13 rejects non-positive quote money and malformed quote currency', async () => {
  for (const quote of [
    { quote_amount: 0 },
    { quote_amount: -1 },
    { quote_currency: 'USDX' },
  ]) {
    const client = db({ quote });
    await assert.rejects(
      resolveSafeTradeCommercialTruth(client, { importOrderId: 'ord-1', userContext: buyer }),
      (error) => error?.details?.code === 'SAFETRADE_ACCEPTED_QUOTE_INCOMPLETE',
    );
  }
});

test('T13 accepted quote cannot cross the order tenant boundary', async () => {
  const client = db({ quote: { tenant_id: 'tenant-B' } });
  await assert.rejects(
    resolveSafeTradeCommercialTruth(client, { importOrderId: 'ord-1', userContext: buyer }),
    (error) => error?.details?.code === 'SAFETRADE_ACCEPTED_QUOTE_TENANT_MISMATCH',
  );
});

test('T13 fails closed when the accepted-quote pointer is absent', async () => {
  const client = db({ order: { metadata: {} } });
  await assert.rejects(
    resolveSafeTradeCommercialTruth(client, {
      importOrderId: 'ord-1',
      userContext: buyer,
      sellerId: 'seller-1',
      currency: 'JPY',
      totalAmount: 2400000,
    }),
    /accepted quote/i,
  );
});

test('T13 transaction idempotency key cannot replay a different commercial transaction', async () => {
  const client = db();
  client._rows('diaspora_safetrade_transactions').push({
    id: 'st-existing',
    tenant_id: 'tenant-A',
    import_order_id: 'other-order',
    accepted_quote_id: 'other-quote',
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    total_amount: 2400000,
    currency: 'JPY',
    idempotency_key: 'txn-key-1',
    deleted_at: null,
  });

  await assert.rejects(
    txnService.createTransaction(client, {
      importOrderId: 'ord-1',
      idempotencyKey: 'txn-key-1',
      userContext: buyer,
      skipEligibility: true,
    }),
    (error) => error?.details?.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('T13 operation idempotency replay requires an identical economic fingerprint', async () => {
  const client = createMockSupabase({ diaspora_safetrade_operations: [] });
  const base = {
    tenantId: 'tenant-A',
    transactionId: 'st-1',
    milestoneId: 'm-1',
    operation: 'capture',
    idempotencyKey: 'money-key-1',
    provider: 'sandbox',
    amount: 100,
    currency: 'USD',
    requestedBy: 'buyer-1',
    supabaseClient: client,
  };
  const first = await operationService.reserveOperation(base);
  const replay = await operationService.reserveOperation(base);
  assert.equal(first.replay, false);
  assert.equal(replay.replay, true);
  assert.equal(first.operation.id, replay.operation.id);

  await assert.rejects(
    operationService.reserveOperation({ ...base, amount: 99 }),
    (error) => error?.details?.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('T13 money truth keeps provider-confirmed separate from ledger-applied and unresolved', () => {
  const truth = projectSafeTradeMoneyTruth({
    transaction: {
      id: 'st-1', accepted_quote_id: 'q-1', total_amount: 1000, currency: 'USD',
      metadata: { safetrade: { commercialSource: { authority: 'diaspora_import_quotes', status: 'ACCEPTED_QUOTE', quoteId: 'q-1', amount: 1000, currency: 'USD' } } },
    },
    milestones: [
      { id: 'm1', amount: 300, status: 'HELD' },
      { id: 'm2', amount: 700, status: 'PENDING' },
    ],
    operations: [
      { id: 'op-provider', operation: 'release', state: 'provider_confirmed', amount: 300, currency: 'USD', provider: 'sandbox', provider_ref: 'pi-1', confirmed_at: '2026-09-13T00:00:00Z' },
      { id: 'op-ledger', operation: 'capture', state: 'ledger_applied', amount: 300, currency: 'USD', provider: 'sandbox', provider_ref: 'pi-2', confirmed_at: '2026-09-13T00:00:00Z' },
    ],
  });

  assert.equal(truth.milestonePlan.reconciles, true);
  assert.equal(truth.milestonePlan.heldAmount, 300);
  assert.equal(truth.milestonePlan.pendingAmount, 700);
  assert.deepEqual(truth.provider.providerConfirmedOperationIds, ['op-provider']);
  assert.deepEqual(truth.provider.ledgerAppliedOperationIds, ['op-ledger']);
  assert.deepEqual(truth.provider.unresolvedOperationIds, ['op-provider']);
  assert.equal(truth.releaseBlocked, true);
  assert.equal(truth.firewalls.providerConfirmedIsLedgerApplied, false);
});

test('T13 unresolved provider operation blocks release projection without pretending it failed', () => {
  const truth = projectSafeTradeMoneyTruth({
    transaction: { total_amount: 1000, currency: 'USD' },
    milestones: [{ id: 'm1', amount: 1000, status: 'HELD' }],
    operations: [{ id: 'op-unknown', operation: 'release', state: 'reconciling', amount: 1000, currency: 'USD' }],
  });
  assert.equal(truth.provider.unresolvedCount, 1);
  assert.equal(truth.releaseBlocked, true);
});

test('T13 open dispute blocks release projection but does not manufacture refund', () => {
  const truth = projectSafeTradeMoneyTruth({
    transaction: { total_amount: 1000, currency: 'USD' },
    milestones: [{ id: 'm1', amount: 1000, status: 'HELD' }],
    disputes: [{ id: 'd1', status: 'OPEN', deleted_at: null }],
  });
  assert.equal(truth.disputes.open, true);
  assert.equal(truth.releaseBlocked, true);
  assert.equal(truth.milestonePlan.refundedAmount, 0);
});

test('T13 never invents settlement FX from source/reference/customs money', () => {
  const truth = projectSafeTradeMoneyTruth({
    transaction: {
      total_amount: 2400000,
      currency: 'JPY',
      metadata: { reference_fx: { rate: 0.0068, source: 'ECB' }, customs_fx: { rate: 13.5 } },
    },
  });
  assert.equal(truth.settlementFx, null);
  assert.equal(truth.firewalls.referenceFxIsSettlementFx, false);
  assert.equal(truth.firewalls.customsPaymentEvidenceIsSettlement, false);
});

test('T13 ignores settlement FX metadata until the provider has acknowledged the operation', () => {
  const truth = projectSafeTradeMoneyTruth({
    transaction: { total_amount: 1000, currency: 'USD' },
    operations: [{
      id: 'op-pending',
      state: 'provider_dispatched',
      provider: 'sandbox',
      metadata: {
        settlementFx: {
          rate: 154.25,
          source: 'sandbox-provider',
          fromCurrency: 'USD',
          toCurrency: 'JPY',
          effectiveAt: '2026-09-13T00:00:00Z',
        },
      },
    }],
  });
  assert.equal(truth.settlementFx, null);
});

test('T13 exposes settlement FX only with provider reference and confirmation provenance', () => {
  const truth = projectSafeTradeMoneyTruth({
    transaction: { total_amount: 1000, currency: 'USD' },
    operations: [{
      id: 'op1',
      state: 'ledger_applied',
      provider: 'sandbox',
      provider_ref: 'pi-1',
      confirmed_at: '2026-09-13T00:00:00Z',
      metadata: {
        settlementFx: {
          rate: 154.25,
          source: 'sandbox-provider',
          fromCurrency: 'USD',
          toCurrency: 'JPY',
          effectiveAt: '2026-09-13T00:00:00Z',
        },
      },
    }],
  });
  assert.equal(truth.settlementFx.rate, 154.25);
  assert.equal(truth.settlementFx.source, 'sandbox-provider');
  assert.equal(truth.settlementFx.operationId, 'op1');
  assert.equal(truth.settlementFx.providerRef, 'pi-1');
});

test('T13 full-state capture uses one provider dispatch and replays from ledger without redispatch', async () => {
  const providerCalls = [];
  const rpcCalls = [];
  const client = moneyDb({ rpcCalls });
  const provider = captureProvider(providerCalls);
  const input = {
    transactionId: 'st-1',
    milestoneId: 'm-1',
    operation: 'CAPTURE',
    idempotencyKey: 'capture-1',
    userContext: buyer,
    options: { paymentProvider: provider },
  };

  const first = await milestoneService.recordMilestone(client, input);
  const second = await milestoneService.recordMilestone(client, input);

  assert.equal(first.milestone.status, 'HELD');
  assert.equal(second.idempotentReplay, true);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].idempotencyKey, 'capture-1');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].p_idempotency_key, 'capture-1');
});

test('T13 provider-confirmed replay resumes ledger only and never dispatches provider again', async () => {
  const providerCalls = [];
  const rpcCalls = [];
  const client = moneyDb({
    rpcCalls,
    operation: {
      id: 'op-confirmed',
      tenant_id: 'tenant-A',
      transaction_id: 'st-1',
      milestone_id: 'm-1',
      operation: 'capture',
      idempotency_key: 'capture-resume',
      provider: 'sandbox',
      amount: 100,
      currency: 'USD',
      state: 'provider_confirmed',
      provider_ref: 'pi-1',
      provider_status: 'captured',
      confirmed_at: '2026-09-13T00:00:00Z',
    },
  });
  const provider = captureProvider(providerCalls);

  const result = await milestoneService.recordMilestone(client, {
    transactionId: 'st-1',
    milestoneId: 'm-1',
    operation: 'CAPTURE',
    idempotencyKey: 'capture-resume',
    userContext: buyer,
    options: { paymentProvider: provider },
  });

  assert.equal(providerCalls.length, 0);
  assert.equal(rpcCalls.length, 1);
  assert.equal(result.milestone.status, 'HELD');
  assert.equal(client._rows('diaspora_safetrade_operations')[0].state, 'ledger_applied');
});

test('T13 ambiguous durable operation never redispatches provider', async () => {
  for (const state of ['pending', 'provider_dispatched', 'reconciling']) {
    const providerCalls = [];
    const client = moneyDb({
      operation: {
        id: `op-${state}`,
        tenant_id: 'tenant-A',
        transaction_id: 'st-1',
        milestone_id: 'm-1',
        operation: 'capture',
        idempotency_key: `capture-${state}`,
        provider: 'sandbox',
        amount: 100,
        currency: 'USD',
        state,
      },
    });
    await assert.rejects(
      milestoneService.recordMilestone(client, {
        transactionId: 'st-1',
        milestoneId: 'm-1',
        operation: 'CAPTURE',
        idempotencyKey: `capture-${state}`,
        userContext: buyer,
        options: { paymentProvider: captureProvider(providerCalls) },
      }),
      (error) => error?.details?.code === 'SAFETRADE_OPERATION_RECONCILIATION_REQUIRED',
    );
    assert.equal(providerCalls.length, 0, `provider redispatched from ${state}`);
  }
});

test('T13 seller cannot initiate buyer-side hold/capture money movement', async () => {
  const providerCalls = [];
  const client = moneyDb();
  await assert.rejects(
    milestoneService.recordMilestone(client, {
      transactionId: 'st-1',
      milestoneId: 'm-1',
      operation: 'CAPTURE',
      idempotencyKey: 'seller-capture',
      userContext: seller,
      options: { paymentProvider: captureProvider(providerCalls) },
    }),
    (error) => error?.details?.code === 'SAFETRADE_PAYER_AUTHORITY_REQUIRED',
  );
  assert.equal(providerCalls.length, 0);
  assert.equal(client._rows('diaspora_safetrade_operations').length, 0);
});

test('T13 partial money cannot advance a full milestone state', async () => {
  const providerCalls = [];
  const client = moneyDb();
  await assert.rejects(
    milestoneService.recordMilestone(client, {
      transactionId: 'st-1',
      milestoneId: 'm-1',
      operation: 'CAPTURE',
      amount: 50,
      idempotencyKey: 'partial-capture',
      userContext: buyer,
      options: { paymentProvider: captureProvider(providerCalls) },
    }),
    (error) => error?.details?.code === 'SAFETRADE_PARTIAL_MONEY_NOT_SUPPORTED',
  );
  assert.equal(providerCalls.length, 0);
  assert.equal(client._rows('diaspora_safetrade_operations').length, 0);
});

test('T13 HOLD uses separate provider substep key for intent creation and canonical key for authorization', async () => {
  const keys = [];
  const rpcCalls = [];
  const client = moneyDb({ milestone: { provider_reference: null, status: 'PLANNED' }, rpcCalls });
  const provider = {
    name: 'sandbox',
    async createPaymentIntent(args) {
      keys.push(['intent', args.idempotencyKey]);
      return { provider: 'sandbox', intentId: 'pi-hold', status: 'requires_authorization', live: false };
    },
    async authorizeHold(args) {
      keys.push(['hold', args.idempotencyKey]);
      return { provider: 'sandbox', intentId: args.intentId, status: 'authorized', live: false };
    },
  };

  await milestoneService.recordMilestone(client, {
    transactionId: 'st-1',
    milestoneId: 'm-1',
    operation: 'HOLD',
    idempotencyKey: 'hold-1',
    userContext: buyer,
    options: { paymentProvider: provider },
  });

  assert.deepEqual(keys, [['intent', 'hold-1:intent'], ['hold', 'hold-1']]);
  assert.equal(rpcCalls[0].p_idempotency_key, 'hold-1');
  assert.equal(client._rows('diaspora_safetrade_operations')[0].idempotency_key, 'hold-1');
});
