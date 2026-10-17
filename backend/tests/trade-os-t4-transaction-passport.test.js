/**
 * Trade OS T4 — Order & Booking Passport convergence.
 *
 * The passport aggregates more domains than any surface before it, which makes it the single most
 * attractive place in Trade OS to accidentally (a) leak a fact across a participant boundary, or
 * (b) claim a transaction has reached a stage its authorities cannot prove. These tests exist for
 * those two failure modes above all.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT = 'false';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const passport = await import('../services/diaspora/tradeTransactionPassportService.js');
const stage = await import('../services/diaspora/tradeTransactionStage.js');

const TENANT_P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RIVAL_TENANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const QUOTE_ID = '33333333-3333-4333-8333-333333333333';
const CONTAINER_ID = '44444444-4444-4444-8444-444444444444';
const DRAFT_QUOTE_ID = '55555555-5555-4555-8555-555555555555';
const ORDER_QUOTE_ID = '66666666-6666-4666-8666-666666666666';
const VIN = 'JHMGD18608S200001';

const buyer = { id: 'buyer-a', userId: 'buyer-a', role: 'owner', platformRole: 'owner', tenantId: null, tenantRole: null };
const provider = { id: 'provider-b', userId: 'provider-b', role: 'owner', platformRole: 'owner', tenantId: TENANT_P, tenantRole: 'admin' };
const rival = { id: 'rival-c', userId: 'rival-c', role: 'owner', platformRole: 'owner', tenantId: RIVAL_TENANT, tenantRole: 'admin' };
const stranger = { id: 'stranger-d', userId: 'stranger-d', role: 'owner', platformRole: 'owner', tenantId: null, tenantRole: null };

let db;
function seed({ requestStatus = 'AWARDED', acceptedQuoteId = QUOTE_ID, reservationStatus = null, importOrderId = null, orderQuoteStatus = 'ACCEPTED', vehicleOwner = 'buyer-a' } = {}) {
  db = createMockSupabase({
    diaspora_logistics_requests: [{
      id: REQUEST_ID, requester_id: 'buyer-a', created_by: 'buyer-a', tenant_id: null,
      status: requestStatus, accepted_quote_id: acceptedQuoteId, import_order_id: importOrderId,
      origin_country: 'Japan', origin_city: 'Yokohama',
      destination_country: 'Zimbabwe', destination_city: 'Harare',
      metadata: {}, deleted_at: null, updated_at: '2026-09-06T00:00:00Z',
    }],
    diaspora_logistics_request_items: [{
      id: 'item-1', logistics_request_id: REQUEST_ID, line_number: 1, cargo_category: 'VEHICLE',
      description: 'Toyota Aqua', quantity: 1, estimated_volume_cbm: 3, estimated_weight_kg: null,
      measurement_basis: 'DECLARED', linked_vehicle_vin: VIN, deleted_at: null,
    }],
    diaspora_logistics_quotes: [
      { id: QUOTE_ID, logistics_request_id: REQUEST_ID, provider_id: 'provider-b', provider_tenant_id: TENANT_P,
        status: 'ACCEPTED', total_amount: 650, currency: 'USD', service_mode: 'shared_container',
        valid_until: '2026-12-01', compatible_container_id: CONTAINER_ID, deleted_at: null },
      // A DIFFERENT provider's unsubmitted draft. It must never reach the requester.
      { id: DRAFT_QUOTE_ID, logistics_request_id: REQUEST_ID, provider_id: 'rival-c', provider_tenant_id: RIVAL_TENANT,
        status: 'DRAFT', total_amount: 999, currency: 'USD', deleted_at: null },
    ],
    diaspora_container_shipments: [{
      id: CONTAINER_ID, coordinator_id: 'organiser-x', tenant_id: TENANT_P,
      origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
      total_capacity_volume: 24, used_capacity_volume: 0, available_capacity_volume: 24,
      container_type: '40HC', departure_date: '2026-11-01', booking_deadline: '2026-10-01',
      status: 'BOOKING_OPEN', deleted_at: null,
    }],
    diaspora_cargo_reservations: reservationStatus ? [{
      id: 'res-1', container_id: CONTAINER_ID, buyer_id: 'buyer-a', estimated_volume: 3,
      reservation_status: reservationStatus, metadata: { logistics_request_id: REQUEST_ID }, deleted_at: null,
    }] : [],
    diaspora_import_orders: [{
      id: ORDER_ID, buyer_id: 'buyer-a', tenant_id: null, status: 'QUOTED',
      origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
      requested_make: 'Toyota', requested_model: 'Aqua', vin: VIN, deleted_at: null,
      // Intake 2.0 answers the buyer gave on the sourcing form.
      destination_outcome: 'door_delivery', shipping_objective: 'lowest_cost',
      available_from: '2026-10-04', arrival_window_start: '2026-11-01',
      arrival_window_end: '2026-12-01', timing_flexibility: 'somewhat_flexible',
      budget_basis: 'delivered', budget_max_amount: 24000, budget_disclosed: false,
      payment_intent: 'bank_transfer', clearing_intent: 'want_provider',
    }],
    diaspora_import_quotes: [{
      id: ORDER_QUOTE_ID, import_order_id: ORDER_ID, seller_id: 'supplier-s', status: orderQuoteStatus,
      quote_amount: 8200, quote_currency: 'USD', deleted_at: null, created_at: '2026-09-01T00:00:00Z',
    }],
    diaspora_import_order_participants: [{ id: 'p1', import_order_id: ORDER_ID, user_id: 'buyer-a', participant_role: 'buyer', verification_status: 'VERIFIED' }],
    diaspora_trade_documents: [{ id: 'doc-1', import_order_id: ORDER_ID, document_type: 'INVOICE', verification_status: 'PENDING', deleted_at: null, created_at: '2026-09-02T00:00:00Z' }],
    diaspora_import_audit_log: [],
    users: [{ id: 'buyer-a', name: 'Buyer Person' }, { id: 'provider-b', name: 'Provider Person' }],
    user_registration_profiles: [{ user_id: 'provider-b', organization_name: 'Provider B Logistics', business_type: 'logistics_provider' }],
    // linked_vehicle_vin is a FK to vehicles; the continuation may only carry a VIN this buyer owns.
    vehicles: vehicleOwner === null ? [] : [{ vin: VIN, owner_id: vehicleOwner }],
  });
  return { supabaseClient: db };
}
beforeEach(() => { seed(); });

const get = (kind, id, ctx, opts) => passport.getTransactionPassport({ kind, id }, ctx, opts);

// ───────────────────────────── STAGE TRUTH ──────────────────────────────

test('the headline stage reports the FURTHEST proven state, not one table enum', async () => {
  const awarded = await get('logistics', REQUEST_ID, buyer, seed({ reservationStatus: null }));
  assert.equal(awarded.identity.stage, 'COUNTERPARTY_SELECTED');

  const requested = await get('logistics', REQUEST_ID, buyer, seed({ reservationStatus: 'REQUESTED' }));
  assert.equal(requested.identity.stage, 'SPACE_REQUESTED',
    'an awarded request with a REQUESTED reservation is past "provider selected"');

  const approved = await get('logistics', REQUEST_ID, buyer, seed({ reservationStatus: 'APPROVED' }));
  assert.equal(approved.identity.stage, 'SPACE_APPROVED');
});

test('APPROVED space is not loaded, shipped, cleared or delivered', async () => {
  const view = await get('logistics', REQUEST_ID, buyer, seed({ reservationStatus: 'APPROVED' }));
  const beyond = view.lifecycle.filter((s) => ['WAREHOUSE_INTAKE', 'LOADING', 'SHIPMENT', 'CUSTOMS', 'HANDOVER'].includes(s.key));
  assert.equal(beyond.length, 5);
  assert.deepEqual(beyond.map((s) => s.state),
    ['NOT_STARTED', 'NOT_STARTED', 'NOT_CONNECTED', 'NOT_RECORDED', 'NOT_RECORDED'],
    'stages with no authority must stay unknown — never DONE, never a zero');
});

test('REQUESTED consumes nothing; only APPROVED consumes capacity', async () => {
  const requested = await get('logistics', REQUEST_ID, buyer, seed({ reservationStatus: 'REQUESTED' }));
  assert.equal(requested.booking.reservation.consumes_capacity, false);
  const approved = await get('logistics', REQUEST_ID, buyer, seed({ reservationStatus: 'APPROVED' }));
  assert.equal(approved.booking.reservation.consumes_capacity, true);
});

test('no container means no booking is claimed', async () => {
  const view = await get('logistics', REQUEST_ID, buyer, seed({ acceptedQuoteId: null, requestStatus: 'OPEN_FOR_QUOTES' }));
  assert.equal(view.booking.sailing, null);
  assert.equal(view.booking.reservation, null);
});

test('capacity is read from the container authority, never restated', async () => {
  const view = await get('logistics', REQUEST_ID, buyer, seed({ reservationStatus: 'APPROVED' }));
  assert.deepEqual(view.booking.sailing.capacity, { total_cbm: 24, used_cbm: 3, available_cbm: 21 },
    'available = total - sum(APPROVED), computed by the container authority');
});

test('unknown measurements stay unknown', async () => {
  const view = await get('logistics', REQUEST_ID, buyer, seed());
  assert.equal(view.cargo[0].estimated_weight_kg, null, 'an unrecorded weight is null, not 0');
  assert.equal(view.cargo[0].measurement_basis, 'DECLARED');
});

// ────────────────────────── PARTICIPANT SECURITY ─────────────────────────

test('the requester sees their own transaction, named not id-ed', async () => {
  const view = await get('logistics', REQUEST_ID, buyer, seed());
  assert.equal(view.viewer_role, 'requester');
  assert.equal(view.participants.requester.display_name, 'Buyer Person');
  assert.equal(view.participants.requester.role, 'Shipper');
});

test('a raw internal user id NEVER reaches a customer-facing passport', async () => {
  for (const [kind, id] of [['logistics', REQUEST_ID], ['procurement', ORDER_ID]]) {
    for (const who of [buyer, provider]) {
      const view = await get(kind, id, who, seed()).catch(() => null);
      if (!view) continue;
      const parties = JSON.stringify(view.participants);
      for (const rawId of ['buyer-a', 'provider-b', 'supplier-s', 'rival-c']) {
        assert.ok(!parties.includes(rawId),
          `${kind} passport leaked the raw id "${rawId}" to ${who.id} in participants: ${parties}`);
      }
    }
  }
});

test('an unresolvable party falls back to its ROLE, never to an id', async () => {
  // No users/profile rows for the supplier: the label must still be human.
  const opts = seed();
  const view = await get('procurement', ORDER_ID, buyer, opts);
  assert.equal(view.participants.supplier.display_name, 'Selected supplier');
  assert.equal(view.participants.supplier.identified, false);
});

test('the awarded provider sees the transaction but never the requester identity or the VIN', async () => {
  const view = await get('logistics', REQUEST_ID, provider, seed());
  assert.equal(view.viewer_role, 'provider');
  assert.equal(view.participants.requester.withheld, true);
  assert.equal(view.participants.requester.display_name, 'Shipper', 'a withheld party is shown by role');
  assert.ok(!JSON.stringify(view.participants.requester).includes('buyer-a'));
  assert.equal(view.cargo[0].linked_vehicle_vin, undefined, 'VIN is private vehicle identity');
  assert.equal(view.cargo[0].has_linked_vehicle, true, 'the FACT of a vehicle may cross; its identity may not');
});

test('a rival tenant cannot read the transaction', async () => {
  await assert.rejects(() => get('logistics', REQUEST_ID, rival, seed()), /do not have access/i);
});

test('an unrelated user cannot read the transaction', async () => {
  await assert.rejects(() => get('logistics', REQUEST_ID, stranger, seed()), /do not have access/i);
});

test('an anonymous caller cannot read the transaction', async () => {
  await assert.rejects(() => get('logistics', REQUEST_ID, {}, seed()), /.+/);
});

test("a provider's DRAFT offer never reaches the requester", async () => {
  const view = await get('logistics', REQUEST_ID, buyer, seed());
  assert.equal(view.offers_visible, 1, 'only the SUBMITTED/ACCEPTED offer is visible, not the rival DRAFT');
});

test('the requester-visible allow-list matches T3 exactly and cannot drift', async () => {
  const routeSource = (await import('node:fs')).readFileSync('backend/routes/diasporaContainerMarketplaceRoutes.js', 'utf8');
  const t3 = routeSource.match(/REQUESTER_VISIBLE = new Set\(\[([^\]]+)\]\)/)?.[1] || '';
  const t3Set = t3.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort();
  assert.deepEqual([...passport.REQUESTER_VISIBLE_QUOTE_STATUSES].sort(), t3Set,
    'T4 duplicates T3 route-level DRAFT privacy; the two copies must stay identical');
});

// ─────────────────────── PROCUREMENT ORIGIN + EDGE ───────────────────────

test('a procurement transaction projects its own origin, not a logistics one', async () => {
  const view = await get('procurement', ORDER_ID, buyer, seed());
  assert.equal(view.kind, 'procurement');
  assert.equal(view.commercial.total_amount, 8200);
  assert.equal(view.identity.destination.city, 'Harare', 'the recorded city must not be discarded (F5)');
  assert.equal(view.identity.origin.city, 'Yokohama');
  assert.equal(view.identity.shipping_continuation, null, 'no shipping arranged yet');
});

test('a procurement passport reports its shipping continuation once one exists', async () => {
  const opts = seed({ importOrderId: ORDER_ID, reservationStatus: 'APPROVED' });
  const view = await get('procurement', ORDER_ID, buyer, opts);
  assert.equal(view.identity.shipping_continuation.anchor_id, REQUEST_ID);
  assert.equal(view.identity.stage, 'SPACE_APPROVED',
    'the order inherits the furthest stage its continuation proves');
});

test('a logistics-origin transaction manufactures no procurement order', async () => {
  const view = await get('logistics', REQUEST_ID, buyer, seed());
  assert.equal(view.identity.continued_from_order, null);
  assert.equal(view.kind, 'logistics');
  assert.equal(view.documents.authority_available, false,
    'no document anchor exists for a pure logistics transaction — that is stated, not faked');
  assert.deepEqual(view.documents.records, []);
});

// ───────────────────────── CONTINUATION / §8 / §9 ────────────────────────

test('continuing a purchase into shipping copies the facts CarUp already knows', async () => {
  const opts = seed();
  const { request, idempotentReplay } = await passport.continueToLogistics(ORDER_ID, buyer, opts);
  assert.equal(idempotentReplay, false);
  assert.equal(request.import_order_id, ORDER_ID);
  assert.equal(request.origin_country, 'Japan');
  assert.equal(request.destination_city, 'Harare', 'the buyer does not retype the route');

  const items = db._rows('diaspora_logistics_request_items').filter((i) => i.logistics_request_id === request.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].cargo_category, 'vehicle',
    'the cargo vocabulary is lowercase; VEHICLE violates the CHECK and once failed silently');
  assert.equal(items[0].linked_vehicle_vin, VIN, 'the purchased vehicle carries over');
  assert.equal(items[0].description, 'Toyota Aqua');
  assert.equal(items[0].measurement_basis, 'UNKNOWN',
    'CarUp does not know the crate size, so it must not invent one');
  assert.equal(items[0].estimated_volume_cbm ?? null, null, 'unknown volume stays null, never 0');
});

test('a VIN the buyer does not own is NOT linked, but the vehicle context still carries', async () => {
  const opts = seed({ vehicleOwner: 'someone-else' });
  const { request } = await passport.continueToLogistics(ORDER_ID, buyer, opts);
  const items = db._rows('diaspora_logistics_request_items').filter((i) => i.logistics_request_id === request.id);
  assert.equal(items.length, 1, 'the cargo line is still created');
  assert.equal(items[0].linked_vehicle_vin, null, 'an unowned vehicle must not be linked');
  assert.equal(items[0].description, 'Toyota Aqua', 'the descriptive context still carries over');
});

test('a replay repairs a continuation whose cargo line is missing', async () => {
  const opts = seed();
  const { request } = await passport.continueToLogistics(ORDER_ID, buyer, opts);
  // Simulate the exact failure that shipped once: request created, cargo line absent.
  const rows = db._rows('diaspora_logistics_request_items');
  rows.length = 0;
  const replay = await passport.continueToLogistics(ORDER_ID, buyer, opts);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.request.id, request.id);
  assert.equal(db._rows('diaspora_logistics_request_items').length, 1,
    'the replay must converge, not merely decline to duplicate');
});

test('the continuation INHERITS the buyer\'s stated outcome, not just the route', async () => {
  const opts = seed();
  const { request } = await passport.continueToLogistics(ORDER_ID, buyer, opts);

  // The whole point of Intake 2.0 -> T4: what the buyer already said must not have to be said
  // again downstream.
  assert.equal(request.destination_outcome, 'door_delivery', 'the delivery OUTCOME carries over');
  assert.equal(request.shipping_objective, 'lowest_cost', 'what matters to the buyer carries over');
  assert.equal(request.available_from, '2026-10-04');
  assert.equal(request.arrival_window_start, '2026-11-01');
  assert.equal(request.arrival_window_end, '2026-12-01');
  assert.equal(request.timing_flexibility, 'somewhat_flexible');

  const items = db._rows('diaspora_logistics_request_items').filter((i) => i.logistics_request_id === request.id);
  assert.equal(items[0].description, 'Toyota Aqua', 'the purchased item identity carries over');
  // …and what the purchase genuinely does not know stays unknown rather than being assumed.
  assert.equal(items[0].vehicle_running_state, 'unknown');
  assert.equal(items[0].export_clearance_state, 'unknown');
  assert.equal(items[0].measurement_basis, 'UNKNOWN');
  assert.equal(items[0].estimated_volume_cbm ?? null, null);
});

test('the continuation does NOT inherit private commercial intent', async () => {
  const opts = seed();
  const { request } = await passport.continueToLogistics(ORDER_ID, buyer, opts);
  // A shipping request is a different commercial conversation with a different counterparty. The
  // buyer's budget ceiling and payment intent belong to the purchase, and copying them onto a
  // logistics row would put them one projection mistake away from a freight provider.
  for (const leaked of ['budget_max_amount', 'budget_basis', 'payment_intent', 'clearing_intent']) {
    assert.ok(!(leaked in request) || request[leaked] === undefined || request[leaked] === null,
      `the continuation must not carry "${leaked}" onto the logistics authority`);
  }
});

test('continuation is idempotent under replay', async () => {
  const opts = seed();
  const first = await passport.continueToLogistics(ORDER_ID, buyer, opts);
  const second = await passport.continueToLogistics(ORDER_ID, buyer, opts);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.request.id, first.request.id, 'exactly one operating link results');
  const live = db._rows('diaspora_logistics_requests').filter((r) => r.import_order_id === ORDER_ID && !['CANCELLED','CLOSED'].includes(String(r.status||'').toUpperCase()));
  assert.equal(live.length, 1, 'no duplicate shipping request was created');
});

test('two concurrent continuations still produce exactly one link', async () => {
  const opts = seed();
  const [a, b] = await Promise.all([
    passport.continueToLogistics(ORDER_ID, buyer, opts),
    passport.continueToLogistics(ORDER_ID, buyer, opts),
  ]);
  const live = db._rows('diaspora_logistics_requests').filter((r) => r.import_order_id === ORDER_ID && !['CANCELLED','CLOSED'].includes(String(r.status||'').toUpperCase()));
  assert.equal(live.length, 1, 'concurrent activation must converge on one operating transaction');
  assert.equal(a.request.id, b.request.id);
});

test('shipping cannot be arranged for a purchase with no accepted supplier offer', async () => {
  await assert.rejects(
    () => passport.continueToLogistics(ORDER_ID, buyer, seed({ orderQuoteStatus: 'SUBMITTED' })),
    /Accept a supplier offer/i);
});

test('only the buyer may arrange shipping for their order', async () => {
  await assert.rejects(() => passport.continueToLogistics(ORDER_ID, stranger, seed()), /.+/);
});

// ──────────────────────────── NO SECOND SILO ─────────────────────────────

test('Communications points at the canonical conversation, not a new inbox', async () => {
  const logistics = await get('logistics', REQUEST_ID, buyer, seed());
  assert.equal(logistics.communications.subject_type, 'diaspora_logistics_request');
  assert.equal(logistics.communications.workflow, 'marketplace');
  const procurement = await get('procurement', ORDER_ID, buyer, seed());
  assert.equal(procurement.communications.subject_type, 'diaspora_rfq');
  assert.equal(procurement.communications.workflow, 'marketplace');
});

test('documents come from the document authority and never expose storage paths', async () => {
  const view = await get('procurement', ORDER_ID, buyer, seed());
  assert.equal(view.documents.authority_available, true);
  assert.equal(view.documents.records.length, 1);
  assert.equal(view.documents.records[0].verification_status, 'PENDING');
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('storage_path'), 'a storage path must never cross the API');
  assert.ok(!serialized.includes('document_url'), 'a document URL must never cross the API');
});

test('an unknown transaction kind is refused rather than guessed', async () => {
  await assert.rejects(() => get('shipment', REQUEST_ID, buyer, seed()), /Unknown transaction kind/i);
});

test('the passport tells the reader what to do next (F2)', async () => {
  const awardedNoSailing = await get('logistics', REQUEST_ID, buyer, seed({ acceptedQuoteId: QUOTE_ID }));
  assert.ok(awardedNoSailing.next_step, 'every passport carries a next step');

  const approved = await get('logistics', REQUEST_ID, buyer, seed({ reservationStatus: 'APPROVED' }));
  assert.equal(approved.next_step.state, 'NONE');
  assert.match(approved.next_step.label, /Container space approved/i);

  const requested = await get('logistics', REQUEST_ID, buyer, seed({ reservationStatus: 'REQUESTED' }));
  assert.equal(requested.next_step.state, 'WAITING', 'a pending space request offers no duplicate CTA');

  const proc = await get('procurement', ORDER_ID, buyer, seed());
  assert.equal(proc.next_step.state, 'ACTION');
  assert.match(proc.next_step.label, /Arrange shipping/i);

  const procWithContinuation = await get('procurement', ORDER_ID, buyer, seed({ importOrderId: ORDER_ID }));
  assert.match(procWithContinuation.next_step.label, /Continue shipping request|View shipping request/i,
    'once a continuation exists the passport points at it instead of offering to create another');
});

// ───────────────────────── PURE STAGE FUNCTION ──────────────────────────

test('the stage ladder never skips backwards and never leaps ahead', () => {
  const d = stage.deriveTransactionStage;
  assert.equal(d({ status: 'DRAFT' }).stage, 'DRAFT');
  assert.equal(d({ status: 'OPEN_FOR_QUOTES' }).stage, 'OPEN_FOR_OFFERS');
  assert.equal(d({ status: 'OPEN_FOR_QUOTES', visibleOfferCount: 3 }).stage, 'OFFERS_RECEIVED');
  // A reservation cannot drag the stage BACKWARDS below what the award already proved.
  assert.equal(d({ status: 'AWARDED', hasAcceptedOffer: true, reservationStatus: 'REJECTED' }).stage, 'COUNTERPARTY_SELECTED');
  // Nor can an unknown reservation state invent progress.
  assert.equal(d({ status: 'AWARDED', hasAcceptedOffer: true, reservationStatus: '' }).stage, 'COUNTERPARTY_SELECTED');
});
