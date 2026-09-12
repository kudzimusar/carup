import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SAFETRADE_ENABLED = 'true';
delete process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT;
delete process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT;

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { resolveSafeTradeCommercialTruth } = await import('../services/diaspora/safetrade/diasporaSafeTradeCommercialTruthService.js');
const { projectSafeTradeMoneyTruth } = await import('../services/diaspora/safetrade/diasporaSafeTradeMoneyTruthService.js');
const txnService = await import('../services/diaspora/safetrade/diasporaSafeTradeTransactionService.js');

const buyer = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: 'tenant-A' };
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

test('T13 historical incomplete quote remains explicit compatibility debt, never fake accepted-quote truth', async () => {
  const client = db({ quote: { seller_id: undefined, quote_amount: undefined, quote_currency: undefined } });
  const truth = await resolveSafeTradeCommercialTruth(client, {
    importOrderId: 'ord-1',
    userContext: buyer,
    sellerId: 'seller-legacy',
    currency: 'USD',
    totalAmount: 1000,
  });

  assert.equal(truth.provenance.status, 'LEGACY_INCOMPLETE_ACCEPTED_QUOTE');
  assert.deepEqual(truth.provenance.missingFields.sort(), ['quote_amount', 'quote_currency', 'seller_id']);
  assert.equal(truth.amount, 1000);
  assert.equal(truth.currency, 'USD');
  assert.equal(truth.sellerId, 'seller-legacy');
  assert.equal(truth.provenance.fx, null);
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

test('T13 money truth keeps provider-confirmed separate from ledger-applied', () => {
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
      { id: 'op-provider', operation: 'release', state: 'provider_confirmed', amount: 300, currency: 'USD' },
      { id: 'op-ledger', operation: 'capture', state: 'ledger_applied', amount: 300, currency: 'USD' },
    ],
  });

  assert.equal(truth.milestonePlan.reconciles, true);
  assert.equal(truth.milestonePlan.heldAmount, 300);
  assert.equal(truth.milestonePlan.pendingAmount, 700);
  assert.deepEqual(truth.provider.providerConfirmedOperationIds, ['op-provider']);
  assert.deepEqual(truth.provider.ledgerAppliedOperationIds, ['op-ledger']);
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

test('T13 exposes settlement FX only when an operation carries complete provider provenance', () => {
  const truth = projectSafeTradeMoneyTruth({
    transaction: { total_amount: 1000, currency: 'USD' },
    operations: [{
      id: 'op1',
      state: 'ledger_applied',
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
});
