/**
 * Trade OS T2 §9.4/§9.14 — adversarial tests for the safe cross-tenant RFQ marketplace.
 *
 * The marketplace's whole risk is that widening discovery across tenants also widens EXPOSURE.
 * These tests pin both halves:
 *   1. a supplier in another tenant CAN discover a published request (the marketplace works);
 *   2. what they receive is the sanitized projection and nothing else (the marketplace is safe).
 *
 * Test 2 is written as an allow-list assertion over the returned keys rather than a list of
 * "must not contain buyer_id" checks, so a column added to diaspora_import_orders in future fails
 * this test instead of silently leaking.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const rfq = await import('../services/diaspora/diasporaRfqService.js');
const buyerOrders = await import('../services/diaspora/diasporaBuyerOrderService.js');

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const buyerA = { id: 'buyer-a', userId: 'buyer-a', role: 'owner', platformRole: 'owner', tenantId: TENANT_A };
const sellerB = { id: 'seller-b', userId: 'seller-b', role: 'dealer', platformRole: 'dealer', tenantId: TENANT_B };
const sellerNoTenant = { id: 'seller-n', userId: 'seller-n', role: 'dealer', platformRole: 'dealer', tenantId: null };

/** A published buyer request carrying every private field a leak would expose. */
function publishedOrder(overrides = {}) {
  return {
    id: 'order-1',
    tenant_id: TENANT_A,
    buyer_id: 'buyer-a',
    created_by: 'buyer-a',
    updated_by: 'buyer-a',
    order_type: 'parts',
    origin_country: 'Japan',
    destination_country: 'Zimbabwe',
    destination_city: 'Harare',
    requested_make: 'Honda',
    requested_model: 'Fit',
    budget_amount: 4200,
    budget_currency: 'USD',
    // Private identifiers that must never reach another tenant's supplier.
    vin: 'JHMGD18608S201234',
    chassis_number: 'GD1-1234567',
    linked_vehicle_vin: 'JHMGD18608S201234',
    auction_lot_number: 'LOT-99',
    verification_status: 'VERIFIED',
    status: 'QUOTE_ISSUED',
    metadata: {
      rfq: { published: true, publishedAt: '2026-09-04T00:00:00.000Z', neededBy: '2026-10-30' },
      internal_risk_note: 'buyer flagged for manual review',
      buyer_contact_email: 'private@example.test',
    },
    ...overrides,
  };
}

function client(seed = {}) {
  return createMockSupabase({
    diaspora_import_orders: [publishedOrder()],
    diaspora_import_quotes: [],
    diaspora_import_order_request_lines: [],
    diaspora_import_audit_log: [],
    ...seed,
  });
}

// The complete set of keys a supplier may receive. Nothing else is permitted.
const ALLOWED_PROJECTION_KEYS = new Set([
  'id', 'reference', 'order_type',
  'requested_make', 'requested_model', 'requested_year_min', 'requested_year_max',
  'origin_country', 'destination_country', 'destination_city',
  'budget_amount', 'budget_currency', 'budget_disclosed',
  'needed_by', 'urgency', 'buyer_notes', 'published_at', 'quote_deadline',
  'buyer_context', 'lines', 'quote_count',
]);

// ── The marketplace works ────────────────────────────────────────────────────

test('a supplier in ANOTHER tenant can discover a published request (cross-tenant marketplace)', async () => {
  const c = client();
  const list = await rfq.listRfqs({}, sellerB, { supabaseClient: c });
  assert.equal(list.length, 1, 'tenant-B supplier must see tenant-A published request');
  assert.equal(list[0].id, 'order-1');
  assert.equal(list[0].reference, 'RFQ-ORDER1'.slice(0, 12) || list[0].reference); // reference is derived, not the raw id
});

test('a supplier never sees their OWN request in the opportunity feed', async () => {
  const c = client();
  const list = await rfq.listRfqs({}, buyerA, { supabaseClient: c });
  assert.equal(list.length, 0);
});

test('an UNPUBLISHED draft request is never in the marketplace', async () => {
  const c = client({ diaspora_import_orders: [publishedOrder({ metadata: { rfq: { published: false } } })] });
  assert.equal((await rfq.listRfqs({}, sellerB, { supabaseClient: c })).length, 0);
});

test('an AWARDED request leaves the marketplace', async () => {
  const c = client({
    diaspora_import_orders: [publishedOrder({ metadata: { rfq: { published: true, acceptedQuoteId: 'q1' } } })],
  });
  assert.equal((await rfq.listRfqs({}, sellerB, { supabaseClient: c })).length, 0);
});

// ── The marketplace is safe ──────────────────────────────────────────────────

test('SECURITY: the feed exposes ONLY allow-listed fields — no private column leaks', async () => {
  const c = client();
  const [row] = await rfq.listRfqs({}, sellerB, { supabaseClient: c });
  const unexpected = Object.keys(row).filter((k) => !ALLOWED_PROJECTION_KEYS.has(k));
  assert.deepEqual(unexpected, [], `unexpected fields leaked to supplier: ${unexpected.join(', ')}`);
});

test('SECURITY: buyer identity, private identifiers and internal notes are absent', async () => {
  const c = client();
  const [row] = await rfq.listRfqs({}, sellerB, { supabaseClient: c });
  const serialized = JSON.stringify(row);
  for (const secret of ['buyer-a', 'JHMGD18608S201234', 'GD1-1234567', 'LOT-99', 'private@example.test', 'manual review', TENANT_A]) {
    assert.ok(!serialized.includes(secret), `projection leaked "${secret}"`);
  }
  assert.equal(row.buyer_id, undefined);
  assert.equal(row.tenant_id, undefined);
  assert.equal(row.metadata, undefined);
  assert.equal(row.vin, undefined);
});

test('SECURITY: a tenantless supplier gets the SAME sanitized projection (the old leak is closed)', async () => {
  // Before T2 this caller received `select('*')` rows — every published buyer's private columns.
  const c = client();
  const [row] = await rfq.listRfqs({}, sellerNoTenant, { supabaseClient: c });
  const unexpected = Object.keys(row).filter((k) => !ALLOWED_PROJECTION_KEYS.has(k));
  assert.deepEqual(unexpected, []);
  assert.equal(row.buyer_id, undefined);
});

test('SECURITY: budget stays private unless the buyer explicitly disclosed it', async () => {
  const c = client();
  const [undisclosed] = await rfq.listRfqs({}, sellerB, { supabaseClient: c });
  assert.equal(undisclosed.budget_amount, null);
  assert.equal(undisclosed.budget_disclosed, false);

  const c2 = client({
    diaspora_import_orders: [publishedOrder({ metadata: { rfq: { published: true, discloseBudget: true } } })],
  });
  const [disclosed] = await rfq.listRfqs({}, sellerB, { supabaseClient: c2 });
  assert.equal(Number(disclosed.budget_amount), 4200);
  assert.equal(disclosed.budget_disclosed, true);
});

test('SECURITY: the single-request detail view is the same projection, not the raw row', async () => {
  const c = client();
  const detail = await rfq.getRfqForSeller('order-1', sellerB, { supabaseClient: c });
  const unexpected = Object.keys(detail).filter((k) => !ALLOWED_PROJECTION_KEYS.has(k));
  assert.deepEqual(unexpected, []);
  assert.equal(detail.buyer_id, undefined);
});

test('SECURITY: a buyer cannot read their own request through the SUPPLIER endpoint', async () => {
  const c = client();
  await assert.rejects(
    () => rfq.getRfqForSeller('order-1', buyerA, { supabaseClient: c }),
    /buyer order endpoint/i,
  );
});

test('SECURITY: competitor quote amounts are never in the projection — only a count', async () => {
  const c = client({
    diaspora_import_quotes: [
      { id: 'q1', import_order_id: 'order-1', seller_id: 'rival-1', quote_amount: 3999, status: 'ISSUED' },
      { id: 'q2', import_order_id: 'order-1', seller_id: 'rival-2', quote_amount: 4100, status: 'ISSUED' },
      { id: 'q3', import_order_id: 'order-1', seller_id: 'rival-3', quote_amount: 1, status: 'DRAFT' },
    ],
  });
  const [row] = await rfq.listRfqs({}, sellerB, { supabaseClient: c });
  assert.equal(row.quote_count, 2, 'only SUBMITTED quotes are counted');
  const serialized = JSON.stringify(row);
  for (const secret of ['3999', '4100', 'rival-1', 'rival-2']) {
    assert.ok(!serialized.includes(secret), `competitor detail leaked: ${secret}`);
  }
});

// ── Request lines ────────────────────────────────────────────────────────────

test('published request lines reach the supplier, including "buyer does not know the part number"', async () => {
  const c = client({
    diaspora_import_order_request_lines: [
      { id: 'l1', import_order_id: 'order-1', line_number: 1, item_description: 'Front shocks', item_kind: 'part', quantity: 20, part_number: null, part_number_known: false, vehicle_make: 'Honda', vehicle_model: 'Fit', notes: 'urgent', tenant_id: TENANT_A, created_by: 'buyer-a' },
    ],
  });
  const [row] = await rfq.listRfqs({}, sellerB, { supabaseClient: c });
  assert.equal(row.lines.length, 1);
  assert.equal(row.lines[0].item_description, 'Front shocks');
  assert.equal(row.lines[0].quantity, 20);
  assert.equal(row.lines[0].part_number_known, false);
  // Line-level private columns must not ride along.
  assert.equal(row.lines[0].tenant_id, undefined);
  assert.equal(row.lines[0].created_by, undefined);
  assert.equal(row.lines[0].import_order_id, undefined);
});

test('request lines are rejected once the request is published (suppliers quoted against them)', async () => {
  const c = client();
  const order = publishedOrder();
  await assert.rejects(
    () => buyerOrders.replaceRequestLines(c, order, [{ item_description: 'changed' }], buyerA),
    /cannot be changed after the request is published/i,
  );
});

test('a multi-line draft request stores real rows with sequential line numbers', async () => {
  const c = client();
  const draft = publishedOrder({ id: 'order-draft', metadata: { rfq: { published: false } } });
  const lines = await buyerOrders.replaceRequestLines(c, draft, [
    { item_description: 'Front shocks', quantity: 2, part_number: 'ABC-1', part_number_known: true },
    { item_description: 'Brake pads', quantity: 4 },
  ], buyerA);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.line_number), [1, 2]);
  assert.equal(lines[0].part_number_known, true);
  // Not-known is the default, and is never inferred as "known" from a blank number.
  assert.equal(lines[1].part_number_known, false);
  assert.equal(lines[1].quantity, 4);
});

test('a line claiming a known part number without supplying one is recorded as NOT known', async () => {
  const c = client();
  const draft = publishedOrder({ id: 'order-draft2', metadata: { rfq: { published: false } } });
  const [line] = await buyerOrders.replaceRequestLines(c, draft, [
    { item_description: 'Alternator', part_number_known: true, part_number: '   ' },
  ], buyerA);
  assert.equal(line.part_number_known, false);
  assert.equal(line.part_number, null);
});

test('a line with no description is refused with a human-readable error', async () => {
  const c = client();
  const draft = publishedOrder({ id: 'order-draft3', metadata: { rfq: { published: false } } });
  await assert.rejects(
    () => buyerOrders.replaceRequestLines(c, draft, [{ quantity: 3 }], buyerA),
    /needs a description/i,
  );
});

// ── Supplier quote pipeline ──────────────────────────────────────────────────

test('a supplier sees only their OWN quotes, each paired with the safe request projection', async () => {
  const c = client({
    diaspora_import_quotes: [
      { id: 'mine', import_order_id: 'order-1', seller_id: 'seller-b', quote_amount: 4000, status: 'ISSUED', created_at: '2026-09-01' },
      { id: 'theirs', import_order_id: 'order-1', seller_id: 'rival-9', quote_amount: 3000, status: 'ISSUED', created_at: '2026-09-02' },
    ],
  });
  const mine = await rfq.listMyQuotes({}, sellerB, { supabaseClient: c });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].quote.id, 'mine');
  const unexpected = Object.keys(mine[0].request).filter((k) => !ALLOWED_PROJECTION_KEYS.has(k));
  assert.deepEqual(unexpected, []);
});

test('quote outcome reports won / not selected from authoritative order state', async () => {
  const c = client({
    diaspora_import_orders: [publishedOrder({ metadata: { rfq: { published: true, acceptedQuoteId: 'winner' } } })],
    diaspora_import_quotes: [
      { id: 'winner', import_order_id: 'order-1', seller_id: 'seller-b', quote_amount: 4000, status: 'ACCEPTED', created_at: '2026-09-01' },
    ],
  });
  const [row] = await rfq.listMyQuotes({}, sellerB, { supabaseClient: c });
  assert.equal(row.outcome, 'won');

  const c2 = client({
    diaspora_import_orders: [publishedOrder({ metadata: { rfq: { published: true, acceptedQuoteId: 'someone-else' } } })],
    diaspora_import_quotes: [
      { id: 'mine', import_order_id: 'order-1', seller_id: 'seller-b', quote_amount: 4000, status: 'REJECTED', created_at: '2026-09-01' },
    ],
  });
  const [row2] = await rfq.listMyQuotes({}, sellerB, { supabaseClient: c2 });
  assert.equal(row2.outcome, 'not_selected');
});
