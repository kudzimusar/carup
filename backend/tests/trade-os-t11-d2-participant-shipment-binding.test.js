/**
 * T11-CAP-LR01-R1 / D2 — a participant's tracking resolves only the shipment bound to THEIR OWN order.
 *
 * The defect (CAP-01 Part B, G4): `getMyShipmentTracking` read every live shipment on the booking's
 * container and took the first, without asking whose it was. On a container shared by two orders the
 * customer of one order could be shown the other order's carrier, tracking number, dates and timeline.
 *
 * The invariant these tests hold:
 *
 *     A cargo booking may resolve only the shipment associated with that booking's own import order
 *     AND that booking's own container. Sharing a container is not an association.
 *
 * Where more than one live shipment remains for that one order/container, nothing in the data can
 * distinguish them, so the answer is closed: no movement is shown at all. Array order is never evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getShipmentOperatorView, getMyShipmentTracking, TRACKING_STATES } from '../services/diaspora/shipmentTrackingService.js';

const OPERATOR = { id: 'user-operator', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-op' };
const ADMIN = { id: 'user-platform-admin', platformRole: 'admin' };
const BUYER_A = { id: 'user-buyer-a', platformRole: 'member' };
const BUYER_B = { id: 'user-buyer-b', platformRole: 'member' };

const CONTAINER = 'cont-1';
const OTHER_CONTAINER = 'cont-2';
const LOAD = 'load-1';
const RES_A = 'res-a';
const RES_B = 'res-b';

const shipment = (over = {}) => ({
  id: 'ship-x', tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-a', status: 'PLANNED',
  carrier_name: 'Carrier', tracking_number: 'TRK', origin_port: 'Durban', destination_port: 'Beira',
  departure_date: null, estimated_arrival_date: '2026-10-01T00:00:00Z', actual_arrival_date: null,
  metadata: {}, deleted_at: null, ...over,
});

/** Two orders (A, B) co-loaded on one container, both LOADED unless the caller says otherwise. */
function world({ shipments, events = [], itemB = {}, resA = {}, resB = {} } = {}) {
  return createMockSupabase({
    diaspora_container_shipments: [
      { id: CONTAINER, tenant_id: 'tenant-op', coordinator_id: 'user-operator', status: 'LOADING', deleted_at: null },
      { id: OTHER_CONTAINER, tenant_id: 'tenant-op', coordinator_id: 'user-operator', status: 'LOADING', deleted_at: null },
    ],
    diaspora_cargo_reservations: [
      { id: RES_A, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-a', buyer_id: 'user-buyer-a', created_by: 'user-buyer-a', reservation_status: 'APPROVED', deleted_at: null, ...resA },
      { id: RES_B, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-b', buyer_id: 'user-buyer-b', created_by: 'user-buyer-b', reservation_status: 'APPROVED', deleted_at: null, ...resB },
    ],
    diaspora_container_loads: [
      { id: LOAD, tenant_id: 'tenant-op', container_id: CONTAINER, reference: 'LOAD-1', status: 'COMPLETED', confirmed_at: '2026-09-12T10:00:00Z', deleted_at: null },
    ],
    diaspora_container_load_items: [
      { id: 'li-a', load_id: LOAD, subject_type: 'cargo_reservation', subject_id: RES_A, outcome: 'LOADED', deleted_at: null },
      { id: 'li-b', load_id: LOAD, subject_type: 'cargo_reservation', subject_id: RES_B, outcome: 'LOADED', deleted_at: null, ...itemB },
    ],
    diaspora_container_seal_records: [],
    diaspora_shipments: shipments,
    diaspora_shipment_stage_events: events,
    diaspora_import_orders: [{ id: 'ord-a', deleted_at: null }, { id: 'ord-b', deleted_at: null }],
  });
}

const opts = (client) => ({ supabaseClient: client });

const SHIP_A = shipment({ id: 'ship-a', import_order_id: 'ord-a', carrier_name: 'CARRIER-OF-A', tracking_number: 'TRK-OF-A', departure_date: '2026-09-21T08:00:00Z' });
const SHIP_B = shipment({ id: 'ship-b', import_order_id: 'ord-b', carrier_name: 'CARRIER-OF-B', tracking_number: 'TRK-OF-B', departure_date: null });

// ── Each participant resolves only their own shipment ─────────────────────

test('D2: two orders on one container — each participant resolves only their own shipment, whatever the row order', async () => {
  for (const shipments of [[SHIP_A, SHIP_B], [SHIP_B, SHIP_A]]) {
    const w = world({ shipments });
    const a = await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, opts(w));
    const b = await getMyShipmentTracking('cargo_reservation', RES_B, BUYER_B, opts(w));
    assert.equal(a.references.carrier, 'CARRIER-OF-A');
    assert.equal(a.state, TRACKING_STATES.IN_TRANSIT);
    assert.equal(b.references.carrier, 'CARRIER-OF-B');
    assert.equal(b.state, TRACKING_STATES.SHIPMENT_CREATED);
    // Neither sees a trace of the other's shipment.
    assert.ok(!JSON.stringify(a).includes('CARRIER-OF-B') && !JSON.stringify(a).includes('TRK-OF-B'), 'A was shown B\'s shipment');
    assert.ok(!JSON.stringify(b).includes('CARRIER-OF-A') && !JSON.stringify(b).includes('TRK-OF-A'), 'B was shown A\'s shipment');
  }
});

test('D2: each participant\'s timeline is their own shipment\'s events only', async () => {
  const w = world({
    shipments: [SHIP_A, SHIP_B],
    events: [
      { id: 'e-a', shipment_id: 'ship-a', stage: 'IN_TRANSIT', event_time: '2026-09-21T08:00:00Z', location: 'Durban-A', created_by: 'user-operator', deleted_at: null, metadata: {} },
      { id: 'e-b', shipment_id: 'ship-b', stage: 'BOOKED', event_time: '2026-09-15T08:00:00Z', location: 'Durban-B', created_by: 'user-operator', deleted_at: null, metadata: {} },
    ],
  });
  const a = await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, opts(w));
  const b = await getMyShipmentTracking('cargo_reservation', RES_B, BUYER_B, opts(w));
  assert.deepEqual(a.timeline.map((e) => e.location), ['Durban-A']);
  assert.deepEqual(b.timeline.map((e) => e.location), ['Durban-B']);
});

// ── A shared container is not an association ──────────────────────────────

test('D2: a booking whose own order has NO shipment is not handed the other order\'s shipment on the same container', async () => {
  // Only A has a shipment. B is loaded on the same container but has none of its own.
  const w = world({ shipments: [SHIP_A] });
  const b = await getMyShipmentTracking('cargo_reservation', RES_B, BUYER_B, opts(w));
  assert.equal(b.state, TRACKING_STATES.LOADED);
  assert.equal(b.dates, null);
  assert.equal(b.references, null);
  assert.deepEqual(b.timeline, []);
  assert.ok(!JSON.stringify(b).includes('CARRIER-OF-A') && !JSON.stringify(b).includes('TRK-OF-A'), 'B was shown A\'s shipment');
  // POSITIVE CONTROL: A, the order the shipment is attached to, still sees it — the fix does not hide the shipment from its owner.
  const a = await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, opts(w));
  assert.equal(a.references.carrier, 'CARRIER-OF-A');
});

test('D2: a shipment attached to this order but sailing on a DIFFERENT container is not this booking\'s shipment', async () => {
  const w = world({ shipments: [shipment({ id: 'ship-a2', import_order_id: 'ord-a', container_id: OTHER_CONTAINER, carrier_name: 'WRONG-BOX' })] });
  const a = await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, opts(w));
  assert.equal(a.state, TRACKING_STATES.LOADED);
  assert.ok(!JSON.stringify(a).includes('WRONG-BOX'));
});

test('D2: a booking with no import order cannot be bound to any shipment', async () => {
  const w = world({ shipments: [SHIP_A, SHIP_B], resA: { import_order_id: null } });
  const a = await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, opts(w));
  assert.equal(a.state, TRACKING_STATES.LOADED);
  assert.equal(a.references, null);
  assert.ok(!/CARRIER-OF/.test(JSON.stringify(a)), 'an order-less booking was handed a shipment');
});

// ── Left behind / not loaded are unchanged ────────────────────────────────

test('D2: left-behind cargo remains left behind, even when its own order has a shipment', async () => {
  const w = world({ shipments: [SHIP_A, SHIP_B], itemB: { outcome: 'LEFT_BEHIND', left_behind_reason: 'NO_SPACE' } });
  const b = await getMyShipmentTracking('cargo_reservation', RES_B, BUYER_B, opts(w));
  assert.equal(b.state, TRACKING_STATES.LEFT_BEHIND);
  assert.equal(b.references, null);
  assert.equal(b.dates, null);
  assert.deepEqual(b.timeline, []);
  assert.ok(!/CARRIER-OF/.test(JSON.stringify(b)), 'left-behind cargo was shown a shipment');
});

test('D2: cargo that was never loaded is still told tracking has not begun', async () => {
  const w = world({ shipments: [SHIP_A, SHIP_B] });
  await w.from('diaspora_container_load_items').delete().eq('id', 'li-b');
  const b = await getMyShipmentTracking('cargo_reservation', RES_B, BUYER_B, opts(w));
  assert.equal(b.state, TRACKING_STATES.NOT_LOADED);
  assert.equal(b.references, null);
});

// ── Ambiguity fails closed ────────────────────────────────────────────────

test('D2: two live shipments for the SAME order and container fail closed — no movement, in either row order', async () => {
  const dup1 = shipment({ id: 'ship-a1', import_order_id: 'ord-a', carrier_name: 'DUP-ONE', departure_date: '2026-09-21T08:00:00Z' });
  const dup2 = shipment({ id: 'ship-a2', import_order_id: 'ord-a', carrier_name: 'DUP-TWO', departure_date: null });
  for (const shipments of [[dup1, dup2], [dup2, dup1]]) {
    const w = world({ shipments: [...shipments, SHIP_B] });
    const a = await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, opts(w));
    assert.equal(a.dates, null, 'a date was claimed from an ambiguous pair');
    assert.equal(a.references, null);
    assert.deepEqual(a.timeline, []);
    assert.equal(a.exception, undefined);
    assert.equal(a.association, 'ambiguous');
    assert.notEqual(a.state, TRACKING_STATES.IN_TRANSIT, 'the first row decided the state');
    assert.notEqual(a.state, TRACKING_STATES.ARRIVED);
    assert.ok(!/DUP-ONE|DUP-TWO/.test(JSON.stringify(a)), 'an ambiguous shipment leaked its detail');
    // The sentence must not assert the container has not left — we do not know.
    assert.ok(!/has not been recorded as leaving/i.test(a.sentence), 'the sentence asserted something the records cannot support');
    assert.match(a.sentence, /more than one shipment/i);
    // And the neighbour is untouched by it.
    const b = await getMyShipmentTracking('cargo_reservation', RES_B, BUYER_B, opts(w));
    assert.equal(b.references.carrier, 'CARRIER-OF-B');
  }
});

test('D2: a soft-deleted duplicate is not ambiguity', async () => {
  const live = shipment({ id: 'ship-a1', import_order_id: 'ord-a', carrier_name: 'LIVE-ONE' });
  const gone = shipment({ id: 'ship-a2', import_order_id: 'ord-a', carrier_name: 'GONE', deleted_at: '2026-09-13T00:00:00Z' });
  const w = world({ shipments: [gone, live] });
  const a = await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, opts(w));
  assert.equal(a.references.carrier, 'LIVE-ONE');
  assert.equal(a.association, undefined);
});

// ── Authority and privacy are unchanged ───────────────────────────────────

test('D2: the operator view of a shipment is unaffected — it is read by shipment id, not by booking', async () => {
  const w = world({ shipments: [SHIP_A, SHIP_B] });
  const viewA = await getShipmentOperatorView('ship-a', OPERATOR, opts(w));
  const viewB = await getShipmentOperatorView('ship-b', OPERATOR, opts(w));
  assert.equal(viewA.references.carrier, 'CARRIER-OF-A');
  assert.equal(viewB.references.carrier, 'CARRIER-OF-B');
});

test('D2: a platform admin reading a booking gets that booking\'s own shipment, not the container\'s first', async () => {
  const w = world({ shipments: [SHIP_A, SHIP_B] });
  const b = await getMyShipmentTracking('cargo_reservation', RES_B, ADMIN, opts(w));
  assert.equal(b.references.carrier, 'CARRIER-OF-B');
});

test('D2: a co-loader still cannot read another participant\'s booking at all', async () => {
  const w = world({ shipments: [SHIP_A, SHIP_B] });
  await assert.rejects(() => getMyShipmentTracking('cargo_reservation', RES_A, BUYER_B, opts(w)), /not your cargo/i);
});

test('D2: the participant view still exposes no other order, shipment id, container or tenant', async () => {
  const w = world({ shipments: [SHIP_A, SHIP_B] });
  const a = await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, opts(w));
  const text = JSON.stringify(a);
  for (const leak of ['ord-b', 'ship-b', RES_B, 'user-buyer-b', 'user-operator', 'tenant-op', CONTAINER]) {
    assert.ok(!text.includes(leak), `${leak} reached participant A`);
  }
});

test('D2: an order-less booking is bound to nothing even when the container carries exactly ONE other order\'s shipment', async () => {
  // One shipment on the container, attached to B. A's booking has no order: it must not be handed B's.
  const w = world({ shipments: [SHIP_B], resA: { import_order_id: null } });
  const a = await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, opts(w));
  assert.equal(a.state, TRACKING_STATES.LOADED);
  assert.equal(a.references, null);
  assert.equal(a.dates, null);
  assert.ok(!JSON.stringify(a).includes('CARRIER-OF-B'), 'an order-less booking was handed another order\'s shipment');
});

test('D2: the projection still writes nothing — proven by trap', async () => {
  const w = world({ shipments: [SHIP_A, SHIP_B] });
  const writes = [];
  const trapped = {
    ...w,
    from(table) {
      return new Proxy(w.from(table), {
        get(target, prop) {
          if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
  await getMyShipmentTracking('cargo_reservation', RES_A, BUYER_A, { supabaseClient: trapped });
  assert.deepEqual(writes, []);
});
