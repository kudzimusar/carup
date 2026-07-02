/**
 * Integrated MVP acceptance gate — PARTS trade journey (directive J, spec "31-diaspora-trade-os-parts-flow").
 *
 * Drives ONE end-to-end parts journey through the REAL Phase-3+ services + the REAL atomic Postgres RPCs
 * (mocked in-memory, sandbox only — no live provider, no network):
 *
 *   parts demand  → publish RFQ → seller quote → ATOMIC quote acceptance (diaspora_accept_quote_atomic)
 *     → seller stock create → LEDGER reservation (diaspora_append_stock_movement_atomic)
 *     → stock total is NEVER directly overwritten → container capacity reservation with OVERFILL guard
 *     → Stock Passport (ledger provenance + quantity history) → audit seal.
 *
 * These services resolve an injected client via resolveClient({ supabaseClient }), so the whole chain runs
 * against the in-memory mock. This file is the executable acceptance gate the directive calls primary
 * (NOT UI-10). Home = backend/tests/diaspora-*.test.js so CI (`node --test backend/tests/diaspora-*.test.js`)
 * actually runs it; the directive's "tests/agents/31-*.spec.ts" path is a Playwright UI dir which cannot
 * exercise the backend chain (many steps have no UI), so a UI mock there would prove nothing about the API.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const buyer = await import('../services/diaspora/diasporaBuyerOrderService.js');
const rfq = await import('../services/diaspora/diasporaRfqService.js');
const stock = await import('../services/diaspora/diasporaStockService.js');
const ledger = await import('../services/diaspora/diasporaStockLedgerService.js');
const market = await import('../services/diaspora/diasporaContainerMarketplaceService.js');

const buyerCtx = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: null };
const sellerCtx = { id: 'seller-1', userId: 'seller-1', role: 'dealer', platformRole: 'dealer', tenantId: null };
const buyer2Ctx = { id: 'buyer-2', userId: 'buyer-2', role: 'owner', platformRole: 'owner', tenantId: null };
const reviewerCtx = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };

function journeyClient() {
  return createMockSupabase(
    {
      diaspora_import_orders: [],
      diaspora_import_quotes: [],
      diaspora_stock_items: [],
      diaspora_stock_ledger: [],
      diaspora_supply_documents: [],
      diaspora_cargo_reservations: [],
      diaspora_container_shipments: [
        { id: 'cont-1', tenant_id: null, status: 'BOOKING_OPEN', total_capacity_volume: 50, used_capacity_volume: 0, available_capacity_volume: 50, coordinator_id: 'rev-1', metadata: {} },
      ],
      diaspora_import_audit_log: [],
    },
    { rpc: DIASPORA_RPCS },
  );
}

test('PARTS JOURNEY: demand → RFQ → quote → atomic accept → stock ledger reservation → container reservation → passport → audit', async () => {
  const client = journeyClient();
  const opt = { supabaseClient: client };

  // 1. Buyer creates a parts demand/request.
  const order = await buyer.createBuyerOrder(
    { order_type: 'parts', origin_country: 'Japan', requested_make: 'Toyota', requested_model: 'Hilux', part_name: 'Brake caliper' },
    buyerCtx, opt,
  );
  assert.ok(order.id, 'order created');

  // 4. Buyer publishes the reverse RFQ.
  const published = await buyer.publishRfq(order.id, buyerCtx, opt);
  assert.equal(published.status, 'QUOTE_ISSUED');

  // 5. Seller responds with a quote.
  const created = await rfq.createQuote(order.id, { quote_amount: 480, currency: 'USD', submit: true }, sellerCtx, opt);
  const quote = created.quote || created;
  assert.ok(quote.id, 'quote issued');

  // 6. Quote accepted via the supported ATOMIC path (diaspora_accept_quote_atomic: accept one, reject siblings).
  const accepted = await buyer.acceptQuote(order.id, quote.id, buyerCtx, opt);
  const acceptedOrder = accepted.order || accepted;
  assert.equal(String(acceptedOrder.status), 'SELLER_ASSIGNED', 'order stamped SELLER_ASSIGNED by the atomic RPC');
  const quoteRow = client._rows('diaspora_import_quotes').find((q) => q.id === quote.id);
  assert.equal(quoteRow.status, 'ACCEPTED');

  // 2. Seller publishes compatible stock (created with real compatibility fields + opening balance).
  const item = await stock.createStockItem(
    { part_name: 'Brake caliper', vehicle_make: 'Toyota', vehicle_model: 'Hilux', part_number: 'BC-4455', condition: 'NEW', unit_price: 120, currency: 'USD', initial_quantity: 10 },
    sellerCtx, opt,
  );
  assert.equal(Number(item.quantity_on_hand), 10, 'opening balance seeded via the ledger');

  // 7. Stock reserved through LEDGER movements (atomic RPC), NOT a direct column write.
  await ledger.appendStockMovement(item.id, { action: 'RESERVE', quantity: 4, importOrderId: order.id }, sellerCtx, opt);
  const afterReserve = await stock.getStockItem(item.id, sellerCtx, opt);
  assert.equal(afterReserve.balances.reserved, 4);
  assert.equal(afterReserve.balances.available, 6);

  // 8. Stock total can NEVER be directly overwritten from arbitrary input.
  await assert.rejects(
    () => stock.updateStockItem(item.id, { quantity_on_hand: 999 }, sellerCtx, opt),
    /cannot be set directly/i,
    'direct quantity overwrite is rejected',
  );

  // 9. Parts reserve container capacity; approval enforces the OVERFILL guard.
  const res = await market.requestReservation('cont-1', { estimated_volume: 30, import_order_id: order.id }, buyerCtx, opt);
  const approved = await market.approveReservation(res.id, reviewerCtx, opt);
  assert.equal(approved.capacity.usedVolume, 30);
  assert.equal(approved.capacity.availableVolume, 20);

  // 12/13. Stock Passport backbone: immutable ledger provenance + quantity history (open + reserve).
  const ledgerRows = client._rows('diaspora_stock_ledger').filter((r) => r.stock_item_id === item.id);
  assert.equal(ledgerRows.length, 2, 'ledger holds opening ADD + RESERVE (quantity history)');
  assert.ok(ledgerRows.every((r) => Number.isFinite(Number(r.quantity_after))), 'each movement records a running balance');

  // 14. Audit records exist and are sealed (cryptographic_seal on the audit-log row for the movement).
  const audits = client._rows('diaspora_import_audit_log');
  assert.ok(audits.some((a) => a.action === 'STOCK_RESERVE'), 'a sealed STOCK_RESERVE audit row exists');
  const sealed = audits.filter((a) => typeof a.cryptographic_seal === 'string');
  assert.ok(sealed.length >= 1, 'movement audit carries a cryptographic seal');
  assert.ok(sealed.every((a) => a.cryptographic_seal.length === 64), 'seal is a 64-char SHA-256 digest');
});

test('PARTS: overfilling a container is rejected at approval (capacity guard, authoritative recompute)', async () => {
  const client = journeyClient();
  const opt = { supabaseClient: client };
  const r1 = await market.requestReservation('cont-1', { estimated_volume: 40 }, buyerCtx, opt);
  await market.approveReservation(r1.id, reviewerCtx, opt);
  const r2 = await market.requestReservation('cont-1', { estimated_volume: 20 }, buyer2Ctx, opt);
  await assert.rejects(() => market.approveReservation(r2.id, reviewerCtx, opt), /overfill/i);
});

test('PARTS: atomic quote acceptance is idempotent/exclusive — re-accepting a different quote conflicts', async () => {
  const client = journeyClient();
  const opt = { supabaseClient: client };
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, opt);
  await buyer.publishRfq(order.id, buyerCtx, opt);
  const q1 = (await rfq.createQuote(order.id, { quote_amount: 500, submit: true }, sellerCtx, opt)).quote;
  const q2 = (await rfq.createQuote(order.id, { quote_amount: 450, submit: true }, { ...sellerCtx, id: 'seller-2', userId: 'seller-2' }, opt)).quote;
  await buyer.acceptQuote(order.id, q1.id, buyerCtx, opt);
  // The order is already SELLER_ASSIGNED against q1 — accepting q2 must not silently double-accept.
  await assert.rejects(() => buyer.acceptQuote(order.id, q2.id, buyerCtx, opt), /already|conflict|not.*open|accepted/i);
});
