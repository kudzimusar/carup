/**
 * T11-CAP-02 — the Journey & Arrival projection.
 *
 * The projection COMPOSES; it stores nothing and decides nothing. These tests hold it to four things:
 *
 *   1. it never says more than the owning authorities recorded
 *        PLANNED departure ≠ OBSERVED departure · ETA ≠ ACTUAL ARRIVAL · LOADED ≠ SAILED ·
 *        a carrier reference ≠ movement · a customs HOLD ≠ a customs DECISION
 *   2. it selects the shipment deterministically and FAILS CLOSED when it cannot (CAP-01 Part B §4.1)
 *   3. it tells nobody anything about a journey that is not theirs — including that it exists
 *   4. it writes nothing
 *
 * Fixtures here are synthetic and exist only inside this test file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getJourney, JOURNEY_STATES } from '../services/diaspora/journeyProjectionService.js';
import { getMyShipmentTracking } from '../services/diaspora/shipmentTrackingService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';

const BUYER = { id: 'u-buyer', platformRole: 'member' };
const COLOADER = { id: 'u-coloader', platformRole: 'member' };
const OUTSIDER = { id: 'u-outsider', platformRole: 'member' };
const PARTICIPANT = { id: 'u-assigned', platformRole: 'member' };
const OPERATOR = { id: 'u-operator', platformRole: 'member' };
const TENANT_ADMIN = { id: 'u-tenant-admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-1' };
const OTHER_TENANT_ADMIN = { id: 'u-other-admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-other' };
const ADMIN = { id: 'u-platform-admin', platformRole: 'platform_admin' };

const opts = (client) => ({ supabaseClient: client });

function world(over = {}) {
  const shipment = (id, extra = {}) => ({
    id, tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-1', status: 'PLANNED',
    carrier_name: 'Carrier X', tracking_number: 'TRK-1', origin_port: 'Origin Port', destination_port: 'Dest Port',
    departure_date: null, estimated_arrival_date: '2026-10-01T00:00:00Z', actual_arrival_date: null,
    metadata: { planned_departure_date: '2026-09-20T00:00:00Z', planned_departure_source: 'stated_at_creation', internal_note: 'METADATA-SECRET' },
    created_by: 'u-operator', deleted_at: null, ...extra,
  });
  return createMockSupabase({
    diaspora_import_orders: over.orders || [
      { id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', linked_vehicle_vin: 'VIN-A', vin: 'VIN-A',
        chassis_number: 'CH-A', status: 'SHIPPED', consignee_kind: 'another_person', consignee_name: 'Consignee Name', consignee_phone: '+000', deleted_at: null },
      { id: 'ord-b', tenant_id: 'tenant-1', buyer_id: 'u-coloader', created_by: 'u-coloader', linked_vehicle_vin: null, status: 'SHIPPED', deleted_at: null },
    ],
    diaspora_import_order_participants: over.participants || [
      { id: 'p1', import_order_id: 'ord-a', user_id: 'u-assigned', verification_status: 'active', deleted_at: null },
    ],
    vehicles: [{ vin: 'VIN-A', make: 'Make', model: 'Model', year: 2018, color: 'Pearl', mileage: 1000, chassis_number: 'CH-A', engine_number: 'ENG-A' }],
    diaspora_container_shipments: [{ id: 'cont-1', tenant_id: 'tenant-1', coordinator_id: 'u-operator', status: 'SHIPPED', deleted_at: null }],
    diaspora_cargo_reservations: over.reservations || [
      { id: 'res-a', tenant_id: 'tenant-1', container_id: 'cont-1', import_order_id: 'ord-a', buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null },
      { id: 'res-b', tenant_id: 'tenant-1', container_id: 'cont-1', import_order_id: 'ord-b', buyer_id: 'u-coloader', created_by: 'u-coloader', deleted_at: null },
    ],
    diaspora_container_loads: over.loads || [{ id: 'load-1', container_id: 'cont-1', status: 'COMPLETED', confirmed_at: '2026-09-12T10:00:00Z', deleted_at: null }],
    diaspora_container_load_items: over.items || [
      { id: 'li-a', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-a', outcome: 'LOADED', deleted_at: null },
      { id: 'li-b', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-b', outcome: 'LOADED', deleted_at: null },
    ],
    diaspora_shipments: over.shipments === undefined ? [shipment('ship-1')] : over.shipments.map((s) => shipment(s.id, s)),
    diaspora_shipment_stage_events: over.events || [],
  });
}

// ── Access ────────────────────────────────────────────────────────────────

test('CAP-02: the buyer reads the journey of their own order', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world()));
  assert.equal(j.subject.type, 'import_order');
  assert.equal(j.subject.id, 'ord-a');
  assert.equal(j.viewer.kind, 'OWNER');
});

test('CAP-02: an unrelated user is refused', async () => {
  await assert.rejects(() => getJourney('import_order', 'ord-a', OUTSIDER, opts(world())), ForbiddenError);
});

test('CAP-02: a non-privileged caller cannot tell a missing journey from a forbidden one', async () => {
  const w = world();
  const missing = await getJourney('import_order', 'does-not-exist', OUTSIDER, opts(w)).catch((e) => e);
  const forbidden = await getJourney('import_order', 'ord-a', OUTSIDER, opts(w)).catch((e) => e);
  assert.ok(missing instanceof ForbiddenError, 'a missing id leaked its absence to an outsider');
  assert.ok(forbidden instanceof ForbiddenError);
  assert.equal(missing.message, forbidden.message, 'the two refusals are distinguishable');
});

test('CAP-02: a platform admin is told the truth about a missing journey', async () => {
  await assert.rejects(() => getJourney('import_order', 'does-not-exist', ADMIN, opts(world())), NotFoundError);
});

test('CAP-02: a co-loader cannot read another buyer\'s journey, by order or by reservation', async () => {
  const w = world();
  await assert.rejects(() => getJourney('import_order', 'ord-a', COLOADER, opts(w)), ForbiddenError);
  await assert.rejects(() => getJourney('cargo_reservation', 'res-a', COLOADER, opts(w)), ForbiddenError);
});

test('CAP-02: the reservation alias resolves to the same journey for its owner', async () => {
  const j = await getJourney('cargo_reservation', 'res-a', BUYER, opts(world()));
  assert.equal(j.subject.order_id, 'ord-a');
});

test('CAP-02: a reservation pointing at someone else\'s order does not open that order', async () => {
  const w = world({
    reservations: [{ id: 'res-x', container_id: 'cont-1', import_order_id: 'ord-a', buyer_id: 'u-coloader', created_by: 'u-coloader', deleted_at: null }],
  });
  await assert.rejects(() => getJourney('cargo_reservation', 'res-x', COLOADER, opts(w)), ForbiddenError,
    'owning a reservation must not unlock an order that is not yours');
});

test('CAP-02: the shipment alias is authorized from its order', async () => {
  const w = world();
  const j = await getJourney('shipment', 'ship-1', BUYER, opts(w));
  assert.equal(j.subject.order_id, 'ord-a');
  await assert.rejects(() => getJourney('shipment', 'ship-1', OUTSIDER, opts(w)), ForbiddenError);
});

test('CAP-02: a sailing operator with no right to read the order is refused (they use the T11 operator view)', async () => {
  await assert.rejects(() => getJourney('import_order', 'ord-a', OPERATOR, opts(world())), ForbiddenError);
});

test('CAP-02: a tenant admin of the order\'s tenant may read; another tenant\'s admin may not', async () => {
  const w = world();
  const j = await getJourney('import_order', 'ord-a', TENANT_ADMIN, opts(w));
  assert.equal(j.viewer.kind, 'ADMIN');
  await assert.rejects(() => getJourney('import_order', 'ord-a', OTHER_TENANT_ADMIN, opts(w)), ForbiddenError);
});

test('CAP-02: an unknown subject type is rejected', async () => {
  await assert.rejects(() => getJourney('vehicle', 'x', BUYER, opts(world())), ValidationError);
});

// ── Shipment selection: deterministic, and closed when it cannot be ──────

test('CAP-02: exactly one shipment for the order and its container is selected, as an order association', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world()));
  assert.equal(j.shipping.association, 'order');
  assert.equal(j.shipping.references.carrier, 'Carrier X');
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_CREATED);
});

test('CAP-02: a co-loader is shown the container\'s one shipment, labelled as a container association, with no other order\'s identity', async () => {
  const j = await getJourney('import_order', 'ord-b', COLOADER, opts(world()));
  assert.equal(j.shipping.association, 'container');
  assert.equal(j.shipping.references.carrier, 'Carrier X');
  const text = JSON.stringify(j);
  assert.ok(!text.includes('ord-a'), 'another order\'s id leaked into a co-loader\'s journey');
  assert.ok(!text.includes('u-buyer'), 'another buyer\'s identity leaked into a co-loader\'s journey');
});

test('CAP-02: when each co-loader has their own shipment on the container, each sees their own', async () => {
  const w = world({ shipments: [
    { id: 'ship-1', carrier_name: 'Carrier For A', import_order_id: 'ord-a' },
    { id: 'ship-2', carrier_name: 'Carrier For B', import_order_id: 'ord-b' },
  ] });
  const a = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  const b = await getJourney('import_order', 'ord-b', COLOADER, opts(w));
  assert.equal(a.shipping.references.carrier, 'Carrier For A');
  assert.equal(a.shipping.association, 'order');
  assert.equal(b.shipping.references.carrier, 'Carrier For B');
  assert.equal(b.shipping.association, 'order');
});

test('CAP-02: two live shipments on the container, NEITHER attached to my order, FAIL CLOSED — no movement claim, never "the first one"', async () => {
  const w = world({ shipments: [
    { id: 'ship-1', carrier_name: 'First Carrier', departure_date: '2026-09-21T08:00:00Z', status: 'IN_TRANSIT', import_order_id: 'ord-a' },
    { id: 'ship-2', carrier_name: 'Second Carrier', import_order_id: 'ord-c' },
  ] });
  const j = await getJourney('import_order', 'ord-b', COLOADER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_AMBIGUOUS);
  assert.equal(j.shipping.association, 'ambiguous');
  assert.equal(j.shipping.dates, null, 'a date was reported while the shipment was ambiguous');
  assert.deepEqual(j.timeline.filter((e) => e.kind === 'MOVEMENT'), []);
  const text = JSON.stringify(j);
  assert.ok(!text.includes('First Carrier') && !text.includes('Second Carrier'), 'an ambiguous shipment leaked a carrier');
  assert.ok(j.exceptions.some((e) => e.code === 'SHIPMENT_AMBIGUOUS'));
});

test('CAP-02: a vehicle with no container (RoRo) and one shipment is selected', async () => {
  const w = world({
    reservations: [],
    shipments: [{ id: 'ship-r', container_id: null, import_order_id: 'ord-a', carrier_name: 'RoRo Line' }],
  });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.shipping.association, 'order');
  assert.equal(j.shipping.references.carrier, 'RoRo Line');
});

test('CAP-02: two shipments for one container-less order also fail closed', async () => {
  const w = world({
    reservations: [],
    shipments: [{ id: 's1', container_id: null }, { id: 's2', container_id: null }],
  });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_AMBIGUOUS);
});

test('CAP-02: a soft-deleted shipment is not a candidate', async () => {
  const w = world({ shipments: [{ id: 'ship-old', deleted_at: '2026-01-01T00:00:00Z' }] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.notEqual(j.state, JOURNEY_STATES.SHIPMENT_AMBIGUOUS);
  assert.equal(j.shipping.association, 'none');
});

test('CAP-02: a shipment of this order on a DIFFERENT container is flagged, not silently shown as consistent', async () => {
  const w = world({ shipments: [{ id: 'ship-m', container_id: 'cont-OTHER', import_order_id: 'ord-a' }] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.shipping.association, 'order_container_mismatch');
  assert.ok(j.exceptions.some((e) => e.code === 'ORDER_CONTAINER_MISMATCH'));
});

// ── The T11 distinctions ─────────────────────────────────────────────────

test('CAP-02: a planned departure is a PLAN and the observed departure stays null', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world()));
  assert.equal(j.shipping.dates.planned_departure, '2026-09-20T00:00:00Z');
  assert.equal(j.shipping.dates.observed_departure, null, 'an intention was reported as a sailing');
});

test('CAP-02: an ETA in the past is not an arrival', async () => {
  const w = world({ shipments: [{ id: 'ship-1', estimated_arrival_date: '2020-01-01T00:00:00Z', departure_date: '2026-09-21T08:00:00Z' }] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.IN_TRANSIT);
  assert.equal(j.shipping.dates.observed_arrival, null);
});

test('CAP-02: a carrier or tracking reference is never movement', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world()));
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_CREATED);
  assert.match(j.sentence, /Nothing has been recorded as moving/i);
  assert.match(j.shipping.references.note, /not a record that anything has moved/i);
});

test('CAP-02: LOADED is not SAILED', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({ shipments: [] })));
  assert.equal(j.state, JOURNEY_STATES.LOADED);
  assert.match(j.sentence, /has not been recorded as leaving/i);
});

test('CAP-02: observed departure → IN_TRANSIT, observed arrival → ARRIVED', async () => {
  const inTransit = await getJourney('import_order', 'ord-a', BUYER,
    opts(world({ shipments: [{ id: 'ship-1', departure_date: '2026-09-21T08:00:00Z' }] })));
  assert.equal(inTransit.state, JOURNEY_STATES.IN_TRANSIT);
  const arrived = await getJourney('import_order', 'ord-a', BUYER,
    opts(world({ shipments: [{ id: 'ship-1', departure_date: '2026-09-21T08:00:00Z', actual_arrival_date: '2026-10-02T08:00:00Z' }] })));
  assert.equal(arrived.state, JOURNEY_STATES.ARRIVED);
});

test('CAP-02: a customs hold is a stop recorded by the shipment authority, never a customs decision', async () => {
  const w = world({ shipments: [{ id: 'ship-1', departure_date: '2026-09-21T08:00:00Z' }],
    events: [{ id: 'e1', shipment_id: 'ship-1', stage: 'CUSTOMS_HOLD', event_time: '2026-09-25T00:00:00Z', location: 'Gateway', deleted_at: null }] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.EXCEPTION);
  const hold = j.exceptions.find((e) => e.code === 'SHIPMENT_EXCEPTION');
  assert.match(hold.note, /not a customs decision/i);
  assert.ok(!('cleared' in j) && !('customs_decision' in j), 'the journey invented a customs outcome');
});

test('CAP-02: the participant dates equal T11\'s own projection (drift guard)', async () => {
  const w = world({ shipments: [{ id: 'ship-1', departure_date: '2026-09-21T08:00:00Z' }] });
  const t11 = await getMyShipmentTracking('cargo_reservation', 'res-a', BUYER, opts(w));
  const j = await getJourney('cargo_reservation', 'res-a', BUYER, opts(w));
  assert.deepEqual(j.shipping.dates, t11.dates);
  assert.equal(j.state === JOURNEY_STATES.IN_TRANSIT, t11.state === 'IN_TRANSIT');
});

test('CAP-02: cargo left behind has no journey to follow', async () => {
  const w = world({ items: [{ id: 'li-a', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-a', outcome: 'LEFT_BEHIND', left_behind_reason: 'NO_SPACE', deleted_at: null }] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.LEFT_BEHIND);
  assert.equal(j.shipping.dates, null);
});

test('CAP-02: a reservation with no order has no journey, and says so', async () => {
  const w = world({ reservations: [{ id: 'res-n', container_id: 'cont-1', import_order_id: null, buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null }] });
  const j = await getJourney('cargo_reservation', 'res-n', BUYER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.NO_TRANSACTION);
});

// ── What is never serialised ─────────────────────────────────────────────

test('CAP-02: metadata, created_by and recorded_by never leave the service', async () => {
  const w = world({ shipments: [{ id: 'ship-1', departure_date: '2026-09-21T08:00:00Z' }],
    events: [{ id: 'e1', shipment_id: 'ship-1', stage: 'IN_TRANSIT', event_time: '2026-09-21T08:00:00Z', location: 'Port', created_by: 'u-operator',
      metadata: { lastStage: 'LEAK-LASTSTAGE', source: 'operator_declared' }, deleted_at: null }] });
  for (const who of [BUYER, ADMIN]) {
    const text = JSON.stringify(await getJourney('import_order', 'ord-a', who, opts(w)));
    for (const leak of ['METADATA-SECRET', 'LEAK-LASTSTAGE', 'u-operator']) {
      assert.ok(!text.includes(leak), `${leak} leaked to ${who.id}`);
    }
  }
});

test('CAP-02: the consignee is shown to the order\'s owner and a platform admin, and to nobody else', async () => {
  const w = world();
  const owner = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(owner.contacts.consignee.name, 'Consignee Name');
  const admin = await getJourney('import_order', 'ord-a', ADMIN, opts(w));
  assert.equal(admin.contacts.consignee.name, 'Consignee Name');
  for (const who of [PARTICIPANT, TENANT_ADMIN]) {
    const j = await getJourney('import_order', 'ord-a', who, opts(w));
    assert.equal(j.contacts.consignee, null, `the consignee was shown to ${who.id}`);
    assert.ok(!JSON.stringify(j).includes('Consignee Name') && !JSON.stringify(j).includes('+000'));
  }
});

test('CAP-02: the vehicle panel carries only recorded fields, and chassis/engine only for the owner and admin', async () => {
  const w = world();
  const owner = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(owner.asset.make, 'Make');
  assert.equal(owner.asset.chassis_number, 'CH-A');
  const participant = await getJourney('import_order', 'ord-a', PARTICIPANT, opts(w));
  assert.equal(participant.asset.make, 'Make');
  assert.equal(participant.asset.chassis_number, undefined, 'a participant was shown the chassis number');
});

test('CAP-02: a vehicle with no recorded row stays unknown — requested make/model are not an asset', async () => {
  const w = world({ orders: [{ id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', linked_vehicle_vin: null,
    requested_make: 'WantedMake', requested_model: 'WantedModel', status: 'REQUESTED', deleted_at: null }] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.asset.make, null);
  assert.ok(!JSON.stringify(j.asset).includes('WantedMake'), 'a request was shown as a vehicle');
});

// ── Honesty about what is not yet composed, and provenance ───────────────

test('CAP-02: sections not yet composed say so; they are not empty-and-implied-complete', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world()));
  for (const section of ['documents', 'customs', 'payments', 'notifications', 'actions']) {
    assert.equal(j.sections[section].availability, 'not_yet_composed', `${section} implied it was complete`);
  }
  assert.equal(j.shipping.legs.availability, 'not_yet_composed');
});

test('CAP-02: every date is labelled planned / estimated / observed and every section names its authority', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world()));
  assert.ok('planned_departure' in j.shipping.dates && 'estimated_arrival' in j.shipping.dates
    && 'observed_departure' in j.shipping.dates && 'observed_arrival' in j.shipping.dates);
  for (const key of ['asset', 'transaction', 'journey', 'shipping', 'timeline']) {
    assert.ok(j.provenance[key]?.authority, `${key} has no named authority`);
  }
  assert.equal(j.provenance.shipping.authority, 'T11');
});

// ── It writes nothing ────────────────────────────────────────────────────

test('CAP-02: the projection writes nothing — proven by trap', async () => {
  const client = world({ shipments: [{ id: 'ship-1', departure_date: '2026-09-21T08:00:00Z' }] });
  const writes = [];
  const trapped = {
    ...client,
    from(table) {
      const chain = client.from(table);
      return new Proxy(chain, {
        get(target, prop) {
          if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
    rpc: (...a) => { writes.push(`rpc ${a[0]}`); return client.rpc(...a); },
  };
  await getJourney('import_order', 'ord-a', BUYER, opts(trapped));
  await getJourney('cargo_reservation', 'res-a', BUYER, opts(trapped));
  assert.deepEqual(writes, [], `the projection wrote: ${writes.join(', ')}`);
});

test('CAP-02: reads are bounded — the same number of queries however long the timeline is', async () => {
  const events = Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, shipment_id: 'ship-1', stage: 'IN_TRANSIT',
    event_time: `2026-09-${String(10 + (i % 18)).padStart(2, '0')}T00:00:00Z`, location: null, deleted_at: null }));
  const count = async (evs) => {
    const client = world({ shipments: [{ id: 'ship-1', departure_date: '2026-09-21T08:00:00Z' }], events: evs });
    let n = 0;
    const counting = { ...client, from(t) { n += 1; return client.from(t); } };
    await getJourney('import_order', 'ord-a', BUYER, opts(counting));
    return n;
  };
  assert.equal(await count([]), await count(events), 'query count grew with the timeline');
});
