/**
 * Trade OS T2 closure — adversarial tests for the owner-audit security findings.
 *
 *  1. A caller-supplied `linked_vehicle_vin` is authorized SERVER-SIDE against the canonical
 *     vehicle object authority. The UI only offering the caller's own vehicles is presentation,
 *     not authorization.
 *  2. No buyer identity-verification claim is published. `diaspora_import_orders.verification_status`
 *     verifies the ORDER, and reinterpreting it as person verification is a Truth & Trust
 *     violation — this pins that the substitution cannot come back.
 *  3. Supplier match evidence is scoped to the caller's OWN stock, never a competitor's.
 *  4. Supplier identity attached to offers carries no contact details or invented reputation.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { supabase } = await import('../db/supabase.js');
const buyerOrders = await import('../services/diaspora/diasporaBuyerOrderService.js');
const rfq = await import('../services/diaspora/diasporaRfqService.js');

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const buyerA = { id: 'buyer-a', userId: 'buyer-a', role: 'owner', platformRole: 'owner', tenantId: null };
const sellerB = { id: 'seller-b', userId: 'seller-b', role: 'dealer', platformRole: 'dealer', tenantId: TENANT_B };

const MY_VIN = 'JHMGD18608S200001';
const FOREIGN_VIN = 'JHMGD18608S209999';

/**
 * `resolveVehicleObjectAuthority` reads the shared supabase singleton (it is the platform-wide
 * authority, not a diaspora-local helper), so the vehicles table is stubbed on the singleton —
 * the same pattern diaspora-logistics-auth.test.js uses.
 */
let vehiclesById;
function stubVehicles() {
  vehiclesById = {
    [MY_VIN]: { vin: MY_VIN, owner_id: 'buyer-a', current_seller_id: null, tenant_id: null },
    [FOREIGN_VIN]: { vin: FOREIGN_VIN, owner_id: 'someone-else', current_seller_id: null, tenant_id: 'other-tenant' },
  };
  Object.defineProperty(supabase, 'from', {
    configurable: true,
    writable: true,
    value: (table) => {
      const chain = {
        select() { return chain },
        eq(_col, value) { chain._vin = value; return chain },
        maybeSingle() {
          if (table !== 'vehicles') return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: vehiclesById[chain._vin] || null, error: null });
        },
      };
      return chain;
    },
  });
}

before(stubVehicles);
beforeEach(stubVehicles);
after(() => { delete supabase.from; });

function client(seed = {}) {
  return createMockSupabase({
    diaspora_import_orders: [],
    diaspora_import_quotes: [],
    diaspora_import_order_request_lines: [],
    diaspora_import_audit_log: [],
    diaspora_stock_items: [],
    users: [],
    user_registration_profiles: [],
    ...seed,
  });
}

const draftOrder = (overrides = {}) => ({
  id: 'order-draft', tenant_id: null, buyer_id: 'buyer-a', created_by: 'buyer-a',
  order_type: 'parts', origin_country: 'Japan', destination_country: 'Zimbabwe',
  status: 'IMPORT_REQUESTED', metadata: { rfq: { published: false } }, ...overrides,
});

// ── 1. Linked vehicle authorization ─────────────────────────────────────────

test('SECURITY: a buyer cannot link a vehicle they are not authorized for (403)', async () => {
  const c = client();
  await assert.rejects(
    () => buyerOrders.replaceRequestLines(c, draftOrder(), [
      { item_description: 'Front shocks', linked_vehicle_vin: FOREIGN_VIN },
    ], buyerA),
    /not authorized to link that vehicle/i,
  );
  // Nothing may be written when authorization fails.
  assert.equal(c._rows('diaspora_import_order_request_lines').length, 0);
});

test('SECURITY: an unknown VIN is refused as not-on-record, never silently written', async () => {
  const c = client();
  await assert.rejects(
    () => buyerOrders.replaceRequestLines(c, draftOrder(), [
      { item_description: 'Front shocks', linked_vehicle_vin: 'JHMGD18608S2NOPE0' },
    ], buyerA),
    /not on record/i,
  );
  assert.equal(c._rows('diaspora_import_order_request_lines').length, 0);
});

test('a buyer CAN link their own authorized vehicle', async () => {
  const c = client();
  const [line] = await buyerOrders.replaceRequestLines(c, draftOrder(), [
    { item_description: 'Front shocks', linked_vehicle_vin: MY_VIN },
  ], buyerA);
  assert.equal(line.linked_vehicle_vin, MY_VIN);
});

test('manual vehicle details still work with no linkage at all', async () => {
  const c = client();
  const [line] = await buyerOrders.replaceRequestLines(c, draftOrder(), [
    { item_description: 'Front shocks', vehicle_make: 'Honda', vehicle_model: 'Fit' },
  ], buyerA);
  assert.equal(line.linked_vehicle_vin, null);
  assert.equal(line.vehicle_make, 'Honda');
});

test('SECURITY: one unauthorized line rejects the WHOLE batch (no partial write)', async () => {
  const c = client();
  await assert.rejects(
    () => buyerOrders.replaceRequestLines(c, draftOrder(), [
      { item_description: 'Legit', linked_vehicle_vin: MY_VIN },
      { item_description: 'Sneaky', linked_vehicle_vin: FOREIGN_VIN },
    ], buyerA),
    /not authorized/i,
  );
  assert.equal(c._rows('diaspora_import_order_request_lines').length, 0);
});

// ── 2. Buyer verification semantics ─────────────────────────────────────────

test('TRUTH: order verification is NEVER published as buyer identity verification', () => {
  // An order marked VERIFIED must not produce any buyer-verification signal in the projection.
  const projected = rfq.projectRfqForMarketplace(
    { id: 'o1', verification_status: 'VERIFIED', metadata: { rfq: { published: true } } },
    [],
  );
  assert.equal(projected.buyer_context, undefined, 'buyer_context must not exist');
  const serialized = JSON.stringify(projected);
  assert.ok(!/verified/i.test(serialized), 'no verification claim may appear in the projection');
});

// ── 3. Supplier-scoped matching ─────────────────────────────────────────────

test('SECURITY: match evidence uses only the CALLER\'S own stock, never a competitor\'s', async () => {
  const c = client({
    diaspora_import_orders: [{
      id: 'o-open', tenant_id: TENANT_A, buyer_id: 'buyer-a', order_type: 'parts',
      origin_country: 'Japan', destination_country: 'Zimbabwe',
      requested_make: 'Honda', requested_model: 'Fit',
      metadata: { rfq: { published: true } }, status: 'QUOTE_ISSUED',
    }],
    diaspora_stock_items: [
      // The caller's own stock — may be used as evidence.
      { id: 'mine', tenant_id: TENANT_B, publication_status: 'PUBLISHED', part_name: 'Front shocks', vehicle_make: 'Honda', vehicle_model: 'Fit', quantity_on_hand: 24, quantity_reserved: 0, export_readiness_status: 'EXPORT_READY' },
      // A competitor's stock in another tenant — must never surface.
      { id: 'rivals', tenant_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publication_status: 'PUBLISHED', part_name: 'RIVAL SECRET STOCK', vehicle_make: 'Honda', vehicle_model: 'Fit', quantity_on_hand: 99, quantity_reserved: 0, export_readiness_status: 'EXPORT_READY' },
    ],
  });
  const [row] = await rfq.listRfqs({}, sellerB, { supabaseClient: c });
  assert.ok(row.supplier_match, 'the supplier has matching stock, so evidence must be present');
  assert.equal(row.supplier_match.stock_name, 'Front shocks');
  assert.equal(row.supplier_match.available_quantity, 24);
  assert.equal(row.supplier_match.export_ready, true);
  assert.ok(!JSON.stringify(row).includes('RIVAL SECRET STOCK'), 'competitor stock leaked');
});

test('a supplier with NO matching stock gets an honest null, not invented reasons', async () => {
  const c = client({
    diaspora_import_orders: [{
      id: 'o-open', tenant_id: TENANT_A, buyer_id: 'buyer-a', order_type: 'parts',
      origin_country: 'Japan', destination_country: 'Zimbabwe', requested_make: 'Honda',
      metadata: { rfq: { published: true } }, status: 'QUOTE_ISSUED',
    }],
    diaspora_stock_items: [],
  });
  const [row] = await rfq.listRfqs({}, sellerB, { supabaseClient: c });
  assert.equal(row.supplier_match, null);
});

// ── 4. Supplier identity on offers ──────────────────────────────────────────

test('the buyer sees safe supplier identity on offers — and no contact details', async () => {
  const c = client({
    diaspora_import_orders: [{
      id: 'o1', buyer_id: 'buyer-a', created_by: 'buyer-a', tenant_id: null,
      order_type: 'parts', origin_country: 'Japan', destination_country: 'Zimbabwe',
      status: 'QUOTE_ISSUED', metadata: { rfq: { published: true } },
    }],
    diaspora_import_quotes: [
      { id: 'q1', import_order_id: 'o1', seller_id: 'seller-b', quote_amount: 900, quote_currency: 'USD', status: 'ISSUED' },
      { id: 'q-draft', import_order_id: 'o1', seller_id: 'seller-c', quote_amount: 500, quote_currency: 'USD', status: 'DRAFT' },
    ],
    users: [{ id: 'seller-b', name: 'Personal Name', email: 'secret@example.test', phone: '+81000000' }],
    user_registration_profiles: [{
      user_id: 'seller-b', organization_name: 'Tokyo Auto Parts Ltd', business_type: 'parts_seller',
      account_kind: 'business', country_of_residence: 'Japan',
    }],
  });
  const order = await buyerOrders.getBuyerOrder('o1', buyerA, { supabaseClient: c });
  const offer = order.quotes.find((q) => q.id === 'q1');
  assert.equal(offer.supplier.display_name, 'Tokyo Auto Parts Ltd');
  assert.equal(offer.supplier.business_type, 'parts_seller');
  assert.equal(offer.supplier.country, 'Japan');
  // Registration data is supplier-stated; CarUp has not verified it.
  assert.equal(offer.supplier.verified, false);
  const serialized = JSON.stringify(offer.supplier);
  assert.ok(!serialized.includes('secret@example.test'), 'supplier email leaked');
  assert.ok(!serialized.includes('+81000000'), 'supplier phone leaked');
  assert.ok(!/score|rating|reputation/i.test(serialized), 'invented reputation leaked');

  // A DRAFT quote is private to its supplier and is not an offer.
  //
  // This assertion was strengthened deliberately. It used to accept the draft ROW being returned as
  // long as no supplier identity was attached — but the row still carried the draft's amount, so a
  // buyer could read a competitor's unsubmitted price. T3 already excluded drafts outright, and
  // walking the governed supplier journey showed a buyer seeing "DRAFT USD 23800". The row is now
  // withheld entirely, which is what "private to its supplier" has to mean.
  const draft = order.quotes.find((q) => q.id === 'q-draft');
  assert.equal(draft, undefined, 'a DRAFT offer must not reach the buyer at all');
  assert.ok(!JSON.stringify(order.quotes).includes('500'), "the draft's amount must not reach the buyer");
});
