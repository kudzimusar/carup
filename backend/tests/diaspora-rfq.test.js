/**
 * Phase 4 backend tests — buyer orders, RFQ publication, deterministic matching, quote lifecycle,
 * and transactional/idempotent acceptance with tenant/role isolation.
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
const matching = await import('../services/diaspora/diasporaDemandSupplyMatchingService.js');

const buyerCtx = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: null };
const buyer2Ctx = { id: 'buyer-2', userId: 'buyer-2', role: 'owner', platformRole: 'owner', tenantId: null };
const sellerCtx = { id: 'seller-1', userId: 'seller-1', role: 'dealer', platformRole: 'dealer', tenantId: null };
const seller2Ctx = { id: 'seller-2', userId: 'seller-2', role: 'dealer', platformRole: 'dealer', tenantId: null };
const reviewerCtx = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };

function freshClient(extra = {}) {
  return createMockSupabase({
    diaspora_import_orders: [],
    diaspora_import_quotes: [],
    diaspora_stock_items: [],
    diaspora_import_audit_log: [],
    ...extra,
  }, { rpc: DIASPORA_RPCS });
}

test('buyer creates an order and only the owner can list it', async () => {
  const client = freshClient();
  await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan', requested_make: 'Toyota' }, buyerCtx, { supabaseClient: client });
  const own = await buyer.listBuyerOrders({}, buyerCtx, { supabaseClient: client });
  assert.equal(own.length, 1);
  const other = await buyer.listBuyerOrders({}, buyer2Ctx, { supabaseClient: client });
  assert.equal(other.length, 0);
  const rev = await buyer.listBuyerOrders({}, reviewerCtx, { supabaseClient: client });
  assert.equal(rev.length, 1);
});

test('draft orders are not visible as RFQs until published', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  let open = await rfq.listRfqs({}, sellerCtx, { supabaseClient: client });
  assert.equal(open.length, 0);
  await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  open = await rfq.listRfqs({}, sellerCtx, { supabaseClient: client });
  assert.equal(open.length, 1);
});

test('publish is idempotent', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  const first = await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  const second = await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  assert.equal(first.metadata.rfq.publishedAt, second.metadata.rfq.publishedAt);
});

test('matching excludes unavailable stock and explains reasons', async () => {
  const client = freshClient({
    diaspora_stock_items: [
      { id: 's1', part_name: 'Camry bumper', vehicle_make: 'Toyota', vehicle_model: 'Camry', publication_status: 'PUBLISHED', quantity_on_hand: 5, quantity_reserved: 0, export_readiness_status: 'EXPORT_READY' },
      { id: 's2', part_name: 'Out of stock', vehicle_make: 'Toyota', vehicle_model: 'Camry', publication_status: 'PUBLISHED', quantity_on_hand: 2, quantity_reserved: 2 },
      { id: 's3', part_name: 'Private', vehicle_make: 'Toyota', publication_status: 'PRIVATE', quantity_on_hand: 9, quantity_reserved: 0 },
    ],
  });
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan', requested_make: 'Toyota', requested_model: 'Camry' }, buyerCtx, { supabaseClient: client });
  const matches = await buyer.getOrderMatches(order.id, buyerCtx, { supabaseClient: client });
  assert.equal(matches.length, 1); // only the available, published one
  assert.equal(matches[0].stockItemId, 's1');
  assert.ok(matches[0].reasons.some((r) => /Make matches/i.test(r)));
  assert.ok(matches[0].score > 0);
});

test('seller cannot quote a draft (unpublished) order', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await assert.rejects(() => rfq.createQuote(order.id, { quote_amount: 100, submit: true }, sellerCtx, { supabaseClient: client }), /not an open RFQ/i);
});

test('quote submission is idempotent on key', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  const a = await rfq.createQuote(order.id, { quote_amount: 500, submit: true, idempotencyKey: 'q-1' }, sellerCtx, { supabaseClient: client });
  const b = await rfq.createQuote(order.id, { quote_amount: 500, submit: true, idempotencyKey: 'q-1' }, sellerCtx, { supabaseClient: client });
  assert.equal(b.idempotentReplay, true);
  assert.equal(a.quote.id, b.quote.id);
  const quotes = client._rows('diaspora_import_quotes');
  assert.equal(quotes.length, 1);
});

test('accepting one quote rejects the others and is idempotent', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  const q1 = (await rfq.createQuote(order.id, { quote_amount: 500, submit: true }, sellerCtx, { supabaseClient: client })).quote;
  const q2 = (await rfq.createQuote(order.id, { quote_amount: 450, submit: true }, seller2Ctx, { supabaseClient: client })).quote;

  const accepted = await buyer.acceptQuote(order.id, q1.id, buyerCtx, { supabaseClient: client });
  assert.equal(accepted.acceptedQuote.status, 'ACCEPTED');
  const quotes = client._rows('diaspora_import_quotes');
  assert.equal(quotes.find((q) => q.id === q2.id).status, 'REJECTED');

  // idempotent replay
  const replay = await buyer.acceptQuote(order.id, q1.id, buyerCtx, { supabaseClient: client });
  assert.equal(replay.idempotentReplay, true);

  // cannot accept a different quote after one is accepted
  await assert.rejects(() => buyer.acceptQuote(order.id, q2.id, buyerCtx, { supabaseClient: client }), /already has a different accepted quote/i);
});

test('a non-owner buyer cannot accept quotes on someone else order', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  const q1 = (await rfq.createQuote(order.id, { quote_amount: 500, submit: true }, sellerCtx, { supabaseClient: client })).quote;
  await assert.rejects(() => buyer.acceptQuote(order.id, q1.id, buyer2Ctx, { supabaseClient: client }), /access|reviewer/i);
});

test('only DRAFT quotes can be edited; withdraw soft-deletes', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  const draft = (await rfq.createQuote(order.id, { quote_amount: 100, submit: false }, sellerCtx, { supabaseClient: client })).quote;
  const updated = await rfq.updateQuote(draft.id, { quote_amount: 120 }, sellerCtx, { supabaseClient: client });
  assert.equal(Number(updated.quote_amount), 120);
  const submitted = await rfq.submitQuoteById(draft.id, sellerCtx, { supabaseClient: client });
  assert.equal(submitted.status, 'ISSUED');
  await assert.rejects(() => rfq.updateQuote(draft.id, { quote_amount: 130 }, sellerCtx, { supabaseClient: client }), /Only DRAFT/i);
  const wd = await rfq.withdrawQuote(draft.id, sellerCtx, { supabaseClient: client });
  assert.equal(wd.withdrawn, true);
});

test('a seller cannot edit another seller quote', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  const draft = (await rfq.createQuote(order.id, { quote_amount: 100 }, sellerCtx, { supabaseClient: client })).quote;
  await assert.rejects(() => rfq.updateQuote(draft.id, { quote_amount: 1 }, seller2Ctx, { supabaseClient: client }), /access/i);
});

test('audit events recorded for publish and accept', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  const q1 = (await rfq.createQuote(order.id, { quote_amount: 500, submit: true }, sellerCtx, { supabaseClient: client })).quote;
  await buyer.acceptQuote(order.id, q1.id, buyerCtx, { supabaseClient: client });
  const audits = client._rows('diaspora_import_audit_log');
  assert.ok(audits.some((a) => a.action === 'RFQ_PUBLISHED'));
  assert.ok(audits.some((a) => a.action === 'RFQ_QUOTE_ACCEPTED'));
});

// ── H2: atomic quote acceptance contract (via diaspora_accept_quote_atomic) ──

test('H2: a draft quote cannot be accepted', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  const draft = (await rfq.createQuote(order.id, { quote_amount: 200, submit: false }, sellerCtx, { supabaseClient: client })).quote;
  await assert.rejects(() => buyer.acceptQuote(order.id, draft.id, buyerCtx, { supabaseClient: client }), /submitted quotes can be accepted/i);
});

test('H2: a quote from another order cannot be accepted', async () => {
  const client = freshClient();
  const orderA = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  const orderB = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await buyer.publishRfq(orderB.id, buyerCtx, { supabaseClient: client });
  const qB = (await rfq.createQuote(orderB.id, { quote_amount: 300, submit: true }, sellerCtx, { supabaseClient: client })).quote;
  await assert.rejects(() => buyer.acceptQuote(orderA.id, qB.id, buyerCtx, { supabaseClient: client }), /does not belong to this order/i);
});

test('H2: simulated audit failure rolls back acceptance (quote stays ISSUED, order unstamped)', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder({ order_type: 'parts', origin_country: 'Japan' }, buyerCtx, { supabaseClient: client });
  await buyer.publishRfq(order.id, buyerCtx, { supabaseClient: client });
  const q1 = (await rfq.createQuote(order.id, { quote_amount: 500, submit: true }, sellerCtx, { supabaseClient: client })).quote;
  const q2 = (await rfq.createQuote(order.id, { quote_amount: 480, submit: true }, seller2Ctx, { supabaseClient: client })).quote;
  client.setFault('failAudit');
  await assert.rejects(() => buyer.acceptQuote(order.id, q1.id, buyerCtx, { supabaseClient: client }), /could not be applied|audit/i);
  client.clearFaults();
  const quotes = client._rows('diaspora_import_quotes');
  assert.equal(quotes.find((q) => q.id === q1.id).status, 'ISSUED'); // not accepted
  assert.equal(quotes.find((q) => q.id === q2.id).status, 'ISSUED'); // sibling not rejected
  const stored = client._rows('diaspora_import_orders').find((o) => o.id === order.id);
  assert.equal(stored.metadata?.rfq?.acceptedQuoteId ?? null, null); // order unstamped
});
