/**
 * T13 — the Japan→Zimbabwe corridor prices in JPY, and SafeTrade now settles in JPY directly.
 *
 * The decision: no settlement FX. The accepted quote's JPY IS the settlement money, so there is no
 * conversion to invent, no rate to source, and no second figure to reconcile. What JPY needs instead
 * is honesty about its unit: it has no minor unit, so a fractional yen is refused, never rounded.
 * Every other currency outside the list stays refused (UNSUPPORTED_CURRENCY), never substituted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SAFETRADE_ENABLED = 'true';
delete process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT;
delete process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT;

const FIXED_TS = '2026-09-26T13:00:00.000Z';
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { SAFETRADE_RPCS } = await import('./helpers/diasporaSafeTradeRpcReference.js');
const txnService = await import('../services/diaspora/safetrade/diasporaSafeTradeTransactionService.js');
const milestoneService = await import('../services/diaspora/safetrade/diasporaSafeTradeMilestoneService.js');
const { SAFETRADE_SUPPORTED_CURRENCIES } = await import('../services/diaspora/safetrade/diasporaSafeTradeEligibilityService.js');
const { projectSafeTradeMoneyTruth } = await import('../services/diaspora/safetrade/diasporaSafeTradeMoneyTruthService.js');
const { CURRENCY_MINOR_UNITS, amountFitsCurrency } = await import('../constants/diaspora/currencyMinorUnits.js');

const buyer = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: 'tenant-A' };

function seedWithQuote(quote) {
  return createMockSupabase({
    diaspora_import_orders: [
      { id: 'ord-1', tenant_id: 'tenant-A', buyer_id: 'buyer-1', status: 'SELLER_ASSIGNED', metadata: { rfq: { acceptedQuoteId: 'q-1' } }, created_by: 'buyer-1' },
    ],
    diaspora_import_quotes: [{ id: 'q-1', import_order_id: 'ord-1', status: 'ACCEPTED', tenant_id: 'tenant-A', seller_id: 'seller-1', ...quote }],
    diaspora_cargo_reservations: [{ id: 'res-1', import_order_id: 'ord-1', reservation_status: 'APPROVED', tenant_id: 'tenant-A' }],
    diaspora_trade_profiles: [
      { id: 'tp-b', user_id: 'buyer-1', verification_status: 'VERIFIED', tenant_id: 'tenant-A' },
      { id: 'tp-s', user_id: 'seller-1', verification_status: 'VERIFIED', tenant_id: 'tenant-A' },
    ],
    diaspora_safetrade_transactions: [],
    diaspora_safetrade_milestones: [],
    diaspora_compliance_reviews: [],
    vehicle_government_documents: [],
    diaspora_shipments: [],
    diaspora_import_audit_log: [],
  }, { rpc: { ...DIASPORA_RPCS, ...SAFETRADE_RPCS } });
}

const create = (client, extra = {}) => txnService.createTransaction(client, {
  importOrderId: 'ord-1', userContext: buyer, req: { fixedTimestamp: FIXED_TS }, ...extra,
});

test('a JPY accepted quote opens a JPY SafeTrade transaction — same figure, same currency, no FX', async () => {
  const client = seedWithQuote({ quote_amount: 2400000, quote_currency: 'JPY' });
  const { transaction } = await create(client);
  assert.equal(transaction.currency, 'JPY');
  assert.equal(Number(transaction.total_amount), 2400000);
  const source = transaction.metadata.safetrade.commercialSource;
  assert.equal(source.currency, 'JPY');
  assert.equal(source.amount, 2400000);
  assert.equal(source.fx, null, 'no FX is involved in settling a JPY agreement in JPY');

  const truth = projectSafeTradeMoneyTruth({ transaction });
  assert.equal(truth.sourceMoney.currency, 'JPY');
  assert.equal(truth.sourceMoney.amount, 2400000);
  assert.equal(truth.settlementFx, null, 'settlement FX stays absent: nothing was converted');
});

test('a caller asserting USD cannot re-denominate the JPY agreement', async () => {
  const client = seedWithQuote({ quote_amount: 2400000, quote_currency: 'JPY' });
  const { transaction } = await create(client, { currency: 'USD', totalAmount: 16000 });
  assert.equal(transaction.currency, 'JPY');
  assert.equal(Number(transaction.total_amount), 2400000);
  const ignored = transaction.metadata.safetrade.commercialSource.ignoredAssertions.map((a) => a.field).sort();
  assert.deepEqual(ignored, ['currency', 'totalAmount'], 'the assertion is recorded and ignored, never applied');
});

test('whole-yen milestones reconcile; a fractional yen is refused before anything is written', async () => {
  const client = seedWithQuote({ quote_amount: 2400000, quote_currency: 'JPY' });
  const { transaction } = await create(client);

  await assert.rejects(
    () => milestoneService.createMilestones(client, {
      transactionId: transaction.id,
      milestones: [
        { milestoneType: 'DEPOSIT', amount: 1200000.5, sequence: 0 },
        { milestoneType: 'RELEASE', amount: 1199999.5, sequence: 1 },
      ],
      userContext: buyer, req: { fixedTimestamp: FIXED_TS },
    }),
    (err) => { assert.equal(err.details?.code, 'CURRENCY_MINOR_UNIT_VIOLATION'); assert.equal(err.details.minorUnits, 0); return true; },
  );
  assert.equal(client._rows('diaspora_safetrade_milestones').length, 0, 'the sum reconciled, but it was not payable');

  const ok = await milestoneService.createMilestones(client, {
    transactionId: transaction.id,
    milestones: [
      { milestoneType: 'DEPOSIT', amount: 720000, sequence: 0 },
      { milestoneType: 'RELEASE', amount: 1680000, sequence: 1 },
    ],
    idempotencyKey: 'jpy-ms-1', userContext: buyer, req: { fixedTimestamp: FIXED_TS },
  });
  assert.equal(ok.reconciliation.reconciled, true);
  assert.equal(ok.reconciliation.sum, 2400000);
  const stored = client._rows('diaspora_safetrade_milestones');
  assert.deepEqual(stored.map((m) => [m.currency, Number(m.amount)]), [['JPY', 720000], ['JPY', 1680000]]);
});

test('an accepted JPY quote with a fractional yen cannot open a transaction — it is refused, not rounded', async () => {
  const client = seedWithQuote({ quote_amount: 2400000.5, quote_currency: 'JPY' });
  await assert.rejects(
    () => create(client),
    (err) => { assert.equal(err.details?.code, 'SAFETRADE_QUOTE_AMOUNT_NOT_REPRESENTABLE'); return true; },
  );
  assert.equal(client._rows('diaspora_safetrade_transactions').length, 0);
});

test('two-decimal currencies are unchanged, and cents still work', async () => {
  const client = seedWithQuote({ quote_amount: 14500.25, quote_currency: 'USD' });
  const { transaction } = await create(client);
  assert.equal(transaction.currency, 'USD');
  assert.equal(Number(transaction.total_amount), 14500.25);
});

test('a currency outside the list is refused, never converted or substituted', async () => {
  const client = seedWithQuote({ quote_amount: 100000, quote_currency: 'CNY' });
  await assert.rejects(
    () => create(client),
    (err) => {
      assert.equal(err.details?.code, 'SAFETRADE_NOT_ELIGIBLE');
      assert.ok(err.details.blockers.some((b) => b.code === 'UNSUPPORTED_CURRENCY'));
      return true;
    },
  );
  assert.equal(client._rows('diaspora_safetrade_transactions').length, 0);
});

test('every supported currency declares its minor units; JPY declares none', () => {
  assert.ok(SAFETRADE_SUPPORTED_CURRENCIES.includes('JPY'));
  for (const c of SAFETRADE_SUPPORTED_CURRENCIES) {
    assert.ok(Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_UNITS, c), `${c} must declare its minor units`);
  }
  assert.equal(CURRENCY_MINOR_UNITS.JPY, 0);
  assert.equal(amountFitsCurrency(2400000, 'JPY'), true);
  assert.equal(amountFitsCurrency(2400000.01, 'JPY'), false);
  assert.equal(amountFitsCurrency(10.01, 'USD'), true);
  assert.equal(amountFitsCurrency(10.005, 'USD'), false);
  assert.equal(amountFitsCurrency(1, 'XYZ'), false, 'an unknown currency is never assumed to have two decimals');
});
