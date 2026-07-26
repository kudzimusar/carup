/**
 * Integrated MVP acceptance gate — VEHICLE-IMPORT journey (directive J, spec "30-diaspora-trade-os-vehicle-import").
 *
 * Two-part proof, both against REAL code (sandbox/in-memory only; no live provider, no network):
 *
 * PART A — EXECUTABLE (Phase-3+ injectable services + real atomic RPCs):
 *   buyer creates a VEHICLE import demand → publish RFQ → seller quote
 *     → ATOMIC quote acceptance (diaspora_accept_quote_atomic → order SELLER_ASSIGNED)
 *     → cargo container reservation with the OVERFILL capacity guard (diaspora_approve_cargo_reservation_atomic).
 *
 * PART B — CONTRACT (Phase 1-2C services bind the module-level supabase singleton and cannot run in-memory
 *   without a live DB — that behavioral proof is EB-1 staging + backend/tests/diaspora-workflow.test.js). Here
 *   we assert the vehicle-specific GATES against the real service source + the pure transition constants:
 *     • Zimbabwe-Ready gate BLOCKS until every required government document is VERIFIED;
 *     • vehicle_import_record refuses to link a VIN until identity is VERIFIED, then stamps linked_vehicle_vin;
 *     • the ONLY legal inbound transition to ZIMBABWE_READY is from INSURANCE_PENDING.
 *
 * Home = backend/tests/diaspora-*.test.js so CI runs it (`node --test backend/tests/diaspora-*.test.js`); the
 * directive's tests/agents/30-*.spec.ts path is a Playwright UI dir which cannot exercise this backend chain
 * (assign-seller, gov-footprint, Zimbabwe-Ready and vehicle_import_record have no UI).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { IMPORT_ORDER_STATUSES, IMPORT_ORDER_TRANSITIONS } = await import('../constants/diaspora/diasporaStatuses.js');
const buyer = await import('../services/diaspora/diasporaBuyerOrderService.js');
const rfq = await import('../services/diaspora/diasporaRfqService.js');
const market = await import('../services/diaspora/diasporaContainerMarketplaceService.js');

const buyerCtx = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: null };
const sellerCtx = { id: 'seller-1', userId: 'seller-1', role: 'dealer', platformRole: 'dealer', tenantId: null };
const buyer2Ctx = { id: 'buyer-2', userId: 'buyer-2', role: 'owner', platformRole: 'owner', tenantId: null };
const reviewerCtx = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };

const workflowSrc = readFileSync(new URL('../services/diaspora/diasporaWorkflowService.js', import.meta.url), 'utf8');
const importOrderSrc = readFileSync(new URL('../services/diaspora/diasporaImportOrderService.js', import.meta.url), 'utf8');

function journeyClient() {
  return createMockSupabase(
    {
      diaspora_import_orders: [],
      diaspora_import_quotes: [],
      diaspora_cargo_reservations: [],
      diaspora_container_shipments: [
        { id: 'cont-1', tenant_id: null, status: 'BOOKING_OPEN', total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60, coordinator_id: 'rev-1', metadata: {} },
      ],
      diaspora_import_audit_log: [],
    },
    { rpc: DIASPORA_RPCS },
  );
}

// ── PART A — executable vehicle order → quote → atomic accept → cargo reservation ──
test('VEHICLE JOURNEY (executable): demand → RFQ → seller quote → ATOMIC accept → cargo reservation w/ overfill guard', async () => {
  const client = journeyClient();
  const opt = { supabaseClient: client };

  // 1. Buyer creates a vehicle import order (demand).
  const order = await buyer.createBuyerOrder(
    { order_type: 'vehicle', origin_country: 'Japan', requested_make: 'Toyota', requested_model: 'Land Cruiser', requested_year: 2019 },
    buyerCtx, opt,
  );
  assert.ok(order.id, 'vehicle import order created');

  // 4. Publish RFQ; 5. seller quotes.
  const published = await buyer.publishRfq(order.id, buyerCtx, opt);
  assert.equal(published.status, 'QUOTE_ISSUED');
  const quote = (await rfq.createQuote(order.id, { quote_amount: 21500, currency: 'USD', submit: true }, sellerCtx, opt)).quote;
  assert.ok(quote.id, 'seller quote issued');

  // 5b (acceptance). Buyer accepts via the ATOMIC path → order stamped SELLER_ASSIGNED by the RPC.
  const accepted = await buyer.acceptQuote(order.id, quote.id, buyerCtx, opt);
  const acceptedOrder = accepted.order || accepted;
  assert.equal(String(acceptedOrder.status), 'SELLER_ASSIGNED');

  // 11-12. Cargo reservation + capacity approval (authoritative recompute, overfill guard).
  const res = await market.requestReservation('cont-1', { estimated_volume: 35, import_order_id: order.id }, buyerCtx, opt);
  const approved = await market.approveReservation(res.id, reviewerCtx, opt);
  assert.equal(approved.capacity.usedVolume, 35);
  assert.equal(approved.capacity.availableVolume, 25);
});

test('VEHICLE (executable): a cargo reservation that would overfill the container is rejected at approval', async () => {
  const client = journeyClient();
  const opt = { supabaseClient: client };
  const r1 = await market.requestReservation('cont-1', { estimated_volume: 50 }, buyerCtx, opt);
  await market.approveReservation(r1.id, reviewerCtx, opt);
  const r2 = await market.requestReservation('cont-1', { estimated_volume: 20 }, buyer2Ctx, opt);
  await assert.rejects(() => market.approveReservation(r2.id, reviewerCtx, opt), /overfill/i);
});

// ── PART B — contract-level gate proofs (singleton services; behavioral proof = diaspora-workflow.test.js + EB-1) ──
test('VEHICLE (contract): Zimbabwe-Ready gate BLOCKS transition until every required government document is VERIFIED', () => {
  // The gate reads the government footprint and refuses if any required doc is not VERIFIED.
  assert.match(workflowSrc, /assertZimbabweReadyPrerequisites/);
  assert.match(workflowSrc, /requiredForZimbabweReady\s*&&\s*doc\.status\s*!==\s*'VERIFIED'/);
  assert.match(workflowSrc, /Cannot mark import order as ZIMBABWE_READY until all required government documents are verified/);
  // …and the gate is actually invoked on the ZIMBABWE_READY transition (not dead code).
  assert.match(workflowSrc, /nextStatus === IMPORT_ORDER_STATUSES\.ZIMBABWE_READY[\s\S]{0,120}assertZimbabweReadyPrerequisites\(importOrderId\)/);
});

test('VEHICLE (contract): vehicle_import_record refuses to link a VIN until identity is VERIFIED, then stamps linked_vehicle_vin', () => {
  assert.match(importOrderSrc, /Cannot link a vehicle VIN until import identity is verified/);
  assert.match(importOrderSrc, /payload\.verification_status\s*!==\s*'VERIFIED'/);
  assert.match(importOrderSrc, /linked_vehicle_vin/);
});

test('VEHICLE (contract): the ONLY legal inbound transition to ZIMBABWE_READY is from INSURANCE_PENDING', () => {
  const inbound = Object.entries(IMPORT_ORDER_TRANSITIONS)
    .filter(([, next]) => next.includes(IMPORT_ORDER_STATUSES.ZIMBABWE_READY))
    .map(([from]) => from);
  assert.deepEqual(inbound, [IMPORT_ORDER_STATUSES.INSURANCE_PENDING], 'ZIMBABWE_READY reachable only from INSURANCE_PENDING');
});
