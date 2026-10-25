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
import { getJourney, JOURNEY_STATES, JOURNEY_DOCUMENT_TYPES } from '../services/diaspora/journeyProjectionService.js';
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

const DOC_TYPES = [
  ['bill_of_lading', 'Bill of Lading', true], ['commercial_invoice', 'Commercial Invoice', true], ['export_certificate', 'Export Certificate', true],
  ['inspection_certificate', 'Inspection Certificate', true], ['insurance_certificate', 'Insurance Certificate', true], ['packing_list', 'Packing List', false],
  ['passport', 'Passport', true], ['customs_declaration', 'Customs Declaration', true],
].map(([code, display_name, verification_required]) => ({ id: `type-${code}`, code, display_name, verification_required, deleted_at: null }));

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
    diaspora_shipment_legs: over.legs || [],
    diaspora_shipment_observations: over.observations || [],
    trade_document_types: over.docTypes || DOC_TYPES,
    diaspora_trade_documents: over.documents || [],
    diaspora_trade_document_readiness: over.readiness || [],
    diaspora_import_quotes: [],
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
  for (const section of ['customs', 'payments', 'notifications']) {
    assert.equal(j.sections[section].availability, 'not_yet_composed', `${section} implied it was complete`);
  }
  // Legs were a placeholder in CAP-02 and are composed from CAP-04 (see the CAP-04 section below).
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

// ══ CAP-04: vessel legs, composed ═══════════════════════════════════════════
//
// A leg is a DECLARED fact about a vessel and a route. The projection shows it, labels it declared,
// and never lets it become a claim that anything sailed.

const leg = (over = {}) => ({
  id: 'leg-1', shipment_id: 'ship-1', tenant_id: 'tenant-1', leg_sequence: 1, carrier_name: 'Declared Carrier', vessel_name: 'DECLARED VESSEL',
  voyage_ref: 'V-9', imo: '9074729', mmsi: null, port_of_loading: 'Origin Port', port_of_discharge: 'Dest Port',
  planned_departure_date: '2026-08-29T00:00:00Z', estimated_arrival_date: '2026-09-18T00:00:00Z',
  source: 'OPERATOR_DECLARED', source_reference: 'doc-secret-ref', metadata: { internal: 'LEG-METADATA-SECRET' },
  created_by: 'u-leg-author', updated_by: 'u-leg-editor', deleted_at: null, ...over,
});

test('CAP-04: with no vessel declared, the legs section says so — it is not "not yet composed"', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world()));
  assert.equal(j.shipping.legs.availability, 'composed');
  assert.deepEqual(j.shipping.legs.items, []);
  assert.match(j.shipping.legs.note, /no vessel or voyage has been declared/i);
});

test('CAP-04: declared legs are shown in journey order, labelled declared, superseded ones excluded', async () => {
  // Inserted as 2, 3, 1 so that neither "no sort" nor "reverse" can produce the right order by accident.
  const w = world({ legs: [
    leg({ id: 'l2', leg_sequence: 2, vessel_name: 'SECOND VESSEL', port_of_loading: 'Hub', port_of_discharge: 'Hub 2' }),
    leg({ id: 'l3', leg_sequence: 3, vessel_name: 'THIRD VESSEL', port_of_loading: 'Hub 2', port_of_discharge: 'Dest Port' }),
    leg({ id: 'l1', port_of_discharge: 'Hub' }),
    leg({ id: 'l0', leg_sequence: 4, vessel_name: 'SUPERSEDED', deleted_at: '2026-01-01T00:00:00Z' }),
  ] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.deepEqual(j.shipping.legs.items.map((l) => l.sequence), [1, 2, 3]);
  assert.equal(j.shipping.legs.items[0].vessel_name, 'DECLARED VESSEL');
  assert.equal(j.shipping.legs.items[0].planned_departure, '2026-08-29T00:00:00Z');
  assert.equal(j.shipping.legs.items[0].estimated_arrival, '2026-09-18T00:00:00Z');
  assert.match(j.shipping.legs.note, /declared, not observed/i);
  assert.ok(!JSON.stringify(j).includes('SUPERSEDED'), 'a superseded leg was shown');
});

test('CAP-04: a declared leg can never make the journey say the vessel sailed', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({ legs: [leg()] })));
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_CREATED);
  assert.equal(j.shipping.dates.observed_departure, null);
  assert.equal(j.shipping.dates.observed_arrival, null);
  for (const item of j.shipping.legs.items) {
    assert.ok(!Object.keys(item).some((k) => /observed|actual|departed|arrived|status/.test(k)), `a leg item asserts movement through ${Object.keys(item)}`);
  }
});

test('CAP-04: leg internals — author, metadata, tenant, source reference — never leave the service', async () => {
  const w = world({ legs: [leg()] });
  for (const who of [BUYER, ADMIN, PARTICIPANT]) {
    const text = JSON.stringify(await getJourney('import_order', 'ord-a', who, opts(w)));
    for (const leak of ['LEG-METADATA-SECRET', 'u-leg-author', 'u-leg-editor', 'doc-secret-ref']) assert.ok(!text.includes(leak), `${leak} leaked to ${who.id}`);
  }
});

test('CAP-04: an ambiguous shipment shows no vessel — there is no shipment to attach it to', async () => {
  const w = world({
    shipments: [{ id: 'ship-1', import_order_id: 'ord-a' }, { id: 'ship-2', import_order_id: 'ord-c' }],
    legs: [leg(), leg({ id: 'leg-x', shipment_id: 'ship-2', vessel_name: 'OTHER VESSEL' })],
  });
  const j = await getJourney('import_order', 'ord-b', COLOADER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_AMBIGUOUS);
  assert.equal(j.shipping.legs.availability, 'not_applicable');
  const text = JSON.stringify(j);
  assert.ok(!text.includes('DECLARED VESSEL') && !text.includes('OTHER VESSEL'), 'an ambiguous shipment leaked a vessel');
});

test('CAP-04: cargo that is not on the shipment is not shown its vessel', async () => {
  const w = world({
    legs: [leg()],
    items: [{ id: 'li-a', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-a', outcome: 'LEFT_BEHIND', deleted_at: null }],
  });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.shipping.legs.availability, 'not_applicable');
  assert.ok(!JSON.stringify(j).includes('DECLARED VESSEL'));
});

test('CAP-04: a co-loader sees the container shipment\'s vessel, with no other order\'s identity', async () => {
  const j = await getJourney('import_order', 'ord-b', COLOADER, opts(world({ legs: [leg()] })));
  assert.equal(j.shipping.association, 'container');
  assert.equal(j.shipping.legs.items[0].vessel_name, 'DECLARED VESSEL');
  const text = JSON.stringify(j);
  assert.ok(!text.includes('ord-a') && !text.includes('u-buyer'), 'another order leaked through the legs');
});

test('CAP-04: a leg that names different ports than the shipment is flagged, not hidden', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({ legs: [leg({ port_of_loading: 'Somewhere Else' })] })));
  const flag = j.exceptions.find((e) => e.code === 'LEG_PORT_MISMATCH');
  assert.ok(flag, 'the disagreement between the vessel details and the shipment record was not surfaced');
  assert.match(flag.note, /disagree/i);
});

test('CAP-04: ports that agree — in different spelling — raise no flag', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({
    shipments: [{ id: 'ship-1', origin_port: 'Origin Port', destination_port: 'Dest Port' }],
    legs: [leg({ port_of_loading: 'ORIGIN PORT / SAMPLELAND', port_of_discharge: 'dest port' })],
  })));
  assert.ok(!j.exceptions.some((e) => e.code === 'LEG_PORT_MISMATCH'), 'agreeing ports were flagged');
});

test('CAP-04: a leg with no ports, or a shipment with no ports, raises no flag — unknown is not a contradiction', async () => {
  const noLegPorts = await getJourney('import_order', 'ord-a', BUYER, opts(world({ legs: [leg({ port_of_loading: null, port_of_discharge: null })] })));
  assert.ok(!noLegPorts.exceptions.some((e) => e.code === 'LEG_PORT_MISMATCH'));
  const noShipmentPorts = await getJourney('import_order', 'ord-a', BUYER, opts(world({
    shipments: [{ id: 'ship-1', origin_port: null, destination_port: null }], legs: [leg()],
  })));
  assert.ok(!noShipmentPorts.exceptions.some((e) => e.code === 'LEG_PORT_MISMATCH'));
});

test('CAP-04: a transshipment is only compared at its ends — the middle ports are not the shipment\'s', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({ legs: [
    leg({ id: 'a', leg_sequence: 1, port_of_loading: 'Origin Port', port_of_discharge: 'Transshipment Hub' }),
    leg({ id: 'b', leg_sequence: 2, vessel_name: 'FEEDER', port_of_loading: 'Transshipment Hub', port_of_discharge: 'Dest Port' }),
  ] })));
  assert.ok(!j.exceptions.some((e) => e.code === 'LEG_PORT_MISMATCH'), 'a legitimate transshipment was flagged as a contradiction');
});

test('CAP-04: reads stay bounded however many legs there are', async () => {
  const count = async (legs) => {
    const client = world({ legs });
    let n = 0;
    const counting = { ...client, from(t) { n += 1; return client.from(t); } };
    await getJourney('import_order', 'ord-a', BUYER, opts(counting));
    return n;
  };
  const many = Array.from({ length: 12 }, (_, i) => leg({ id: `l${i}`, leg_sequence: i + 1 }));
  assert.equal(await count([leg()]), await count(many), 'query count grew with the number of legs');
});

test('CAP-04: composing legs still writes nothing', async () => {
  const client = world({ legs: [leg()] });
  const writes = [];
  const trapped = { ...client, from(table) {
    const chain = client.from(table);
    return new Proxy(chain, { get(target, prop) {
      if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
      const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
    } });
  } };
  await getJourney('import_order', 'ord-a', BUYER, opts(trapped));
  assert.deepEqual(writes, []);
});

// ══ CAP-05: estimate history, composed ══════════════════════════════════════
//
// The estimate is shown as TWO values and never merged: the shipment record's own (`original`, T11's)
// and the latest accepted revision (`current`). A revision is an observation — an input — shown beside
// the record, not written over it, and an estimate is never an arrival.

const rev = (over = {}) => ({
  id: 'obs-1', shipment_id: 'ship-1', provider_id: 'OPERATOR_DECLARED', provider_event_id: 'evt-secret', kind: 'ETA_REVISION',
  observed_at: '2026-09-10T00:00:00Z', received_at: '2026-09-10T01:00:00Z', payload: { estimated_arrival: '2026-10-08T00:00:00Z', reason: 'Port congestion' },
  source_reference: 'doc-secret-ref', status: 'ACCEPTED', decided_by: 'u-secret-decider', decided_at: '2026-09-10T01:00:00Z', created_by: 'u-secret-author', ...over,
});

test('CAP-05: with no revision, the estimate is the shipment record\'s own, and says so', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world()));
  assert.equal(j.shipping.eta.availability, 'composed');
  assert.equal(j.shipping.eta.basis, 'shipment_record');
  assert.equal(j.shipping.eta.current, j.shipping.eta.original);
  assert.equal(j.shipping.eta.revision_count, 0);
  assert.deepEqual(j.shipping.eta.revisions, []);
});

test('CAP-05: with no estimate anywhere, none is invented', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({ shipments: [{ id: 'ship-1', estimated_arrival_date: null }] })));
  assert.equal(j.shipping.eta.basis, 'none');
  assert.equal(j.shipping.eta.current, null);
});

test('CAP-05: the latest accepted revision is the current estimate, shown beside the original, with why', async () => {
  const w = world({ observations: [
    rev({ id: 'o1', observed_at: '2026-09-01T00:00:00Z', payload: { estimated_arrival: '2026-10-05T00:00:00Z', reason: 'First notice' }, status: 'SUPERSEDED' }),
    rev({ id: 'o2' }),
  ] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.shipping.eta.basis, 'revision');
  assert.equal(j.shipping.eta.original, '2026-10-01T00:00:00Z');
  assert.equal(j.shipping.eta.current, '2026-10-08T00:00:00Z');
  assert.equal(j.shipping.eta.change_days, 7);
  assert.equal(j.shipping.eta.revision_count, 2);
  assert.deepEqual(j.shipping.eta.revisions.map((r) => r.reason), ['First notice', 'Port congestion']);
  assert.equal(j.shipping.eta.revisions[0].superseded, true);
  assert.match(j.shipping.eta.note, /still an estimate/i);
});

test('CAP-05: the shipment record\'s own dates are untouched — a revision sits beside them, not over them', async () => {
  const w = world({ observations: [rev()] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.shipping.dates.estimated_arrival, '2026-10-01T00:00:00Z', 'a revision overwrote the T11 estimate');
  const t11 = await getMyShipmentTracking('cargo_reservation', 'res-a', BUYER, opts(w));
  assert.deepEqual(j.shipping.dates, t11.dates, 'the Journey\'s dates drifted from T11\'s own projection');
});

test('CAP-05: a revised estimate never becomes an arrival or moves the state', async () => {
  const w = world({ observations: [rev({ payload: { estimated_arrival: '2026-09-01T00:00:00Z', reason: null } })] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_CREATED);
  assert.equal(j.shipping.dates.observed_arrival, null);
});

test('CAP-05: observations that are only RECEIVED or REJECTED, or of another kind, count for nothing', async () => {
  const w = world({ observations: [
    rev({ id: 'r1', status: 'RECEIVED', decided_by: null, decided_at: null, payload: { estimated_arrival: '2027-01-01T00:00:00Z', reason: 'Unverified' } }),
    rev({ id: 'r2', status: 'REJECTED', payload: { estimated_arrival: '2027-02-01T00:00:00Z', reason: 'Rejected' } }),
    rev({ id: 'r3', kind: 'PORT_EVENT', payload: { port: 'Somewhere' } }),
  ] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.shipping.eta.basis, 'shipment_record');
  assert.equal(j.shipping.eta.revision_count, 0);
  const text = JSON.stringify(j);
  assert.ok(!text.includes('Unverified') && !text.includes('2027-01-01') && !text.includes('Somewhere'), 'an untrusted observation reached the customer');
});

test('CAP-05: another shipment\'s revisions never leak into this one', async () => {
  const w = world({ observations: [rev({ shipment_id: 'ship-OTHER', payload: { estimated_arrival: '2030-01-01T00:00:00Z', reason: 'Not yours' } })] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(j.shipping.eta.revision_count, 0);
  assert.ok(!JSON.stringify(j).includes('Not yours'));
});

test('CAP-05: who decided, who recorded, event ids and references never leave the service', async () => {
  const w = world({ observations: [rev()] });
  for (const who of [BUYER, ADMIN, PARTICIPANT]) {
    const text = JSON.stringify(await getJourney('import_order', 'ord-a', who, opts(w)));
    for (const leak of ['u-secret-decider', 'u-secret-author', 'evt-secret', 'doc-secret-ref', 'decided_by', 'provider_event_id']) {
      assert.ok(!text.includes(leak), `${leak} leaked to ${who.id}`);
    }
  }
});

test('CAP-05: an ambiguous shipment, or cargo not on it, has no estimate to show', async () => {
  const amb = await getJourney('import_order', 'ord-b', COLOADER, opts(world({
    shipments: [{ id: 'ship-1', import_order_id: 'ord-a' }, { id: 'ship-2', import_order_id: 'ord-c' }],
    observations: [rev(), rev({ id: 'o9', shipment_id: 'ship-2', payload: { estimated_arrival: '2031-01-01T00:00:00Z', reason: 'Other' } })],
  })));
  assert.equal(amb.shipping.eta.availability, 'not_applicable');
  assert.ok(!JSON.stringify(amb).includes('2031-01-01') && !JSON.stringify(amb).includes('Port congestion'));
  const left = await getJourney('import_order', 'ord-a', BUYER, opts(world({
    observations: [rev()],
    items: [{ id: 'li-a', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-a', outcome: 'LEFT_BEHIND', deleted_at: null }],
  })));
  assert.equal(left.shipping.eta.availability, 'not_applicable');
});

test('CAP-05: a co-loader sees the container shipment\'s estimate history, with no other order\'s identity', async () => {
  const j = await getJourney('import_order', 'ord-b', COLOADER, opts(world({ observations: [rev()] })));
  assert.equal(j.shipping.association, 'container');
  assert.equal(j.shipping.eta.current, '2026-10-08T00:00:00Z');
  const text = JSON.stringify(j);
  assert.ok(!text.includes('ord-a') && !text.includes('u-buyer'));
});

test('CAP-05: reads stay bounded however many revisions there are', async () => {
  const count = async (observations) => {
    const client = world({ observations });
    let n = 0;
    const counting = { ...client, from(t) { n += 1; return client.from(t); } };
    await getJourney('import_order', 'ord-a', BUYER, opts(counting));
    return n;
  };
  const many = Array.from({ length: 15 }, (_, i) => rev({ id: `o${i}`, provider_event_id: `e${i}`, observed_at: `2026-09-${String(10 + (i % 15)).padStart(2, '0')}T00:00:00Z`, status: i === 14 ? 'ACCEPTED' : 'SUPERSEDED' }));
  assert.equal(await count([rev()]), await count(many), 'query count grew with the number of revisions');
});

test('CAP-05: composing the estimate history writes nothing', async () => {
  const client = world({ observations: [rev()] });
  const writes = [];
  const trapped = { ...client, from(table) {
    const chain = client.from(table);
    return new Proxy(chain, { get(target, prop) {
      if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
      const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
    } });
  } };
  await getJourney('import_order', 'ord-a', BUYER, opts(trapped));
  assert.deepEqual(writes, []);
});

// ══ CAP-06: documents and next steps, composed ══════════════════════════════
//
// Documents are T8's. The Journey COMPOSES T8's own workspace — it does not re-implement who may see
// a document or what state it is in — and forwards no id, no user id, no storage path. Where T8 would
// refuse a viewer the Journey otherwise admits, the section says so instead of failing the Journey.
// Next steps are derived ONLY from recorded authority state; nothing here invents an obligation.

const doc = (type, over = {}) => ({
  id: `doc-${type}`, import_order_id: 'ord-a', subject_type: null, subject_id: null, document_type: type, version: 1,
  verification_status: 'PENDING_REVIEW', uploaded_by: 'u-secret-uploader', reviewed_by: null, reviewed_at: null, ocr_document_id: null,
  storage_path: 'secret/path.pdf', created_at: '2026-09-02T00:00:00Z', deleted_at: null, superseded_at: null, ...over,
});
const ready = (type, readiness) => ({ id: `r-${type}`, subject_type: 'import_order', subject_id: 'ord-a', document_type: type, readiness, deleted_at: null });

const DOC_WORLD = () => world({
  documents: [
    doc('bill_of_lading', { verification_status: 'VERIFIED', reviewed_by: 'u-secret-reviewer', reviewed_at: '2026-09-03T00:00:00Z', ocr_document_id: 'ocr-secret', version: 2 }),
    doc('commercial_invoice'),
    doc('export_certificate', { verification_status: 'REJECTED', reviewed_by: 'u-secret-reviewer', reviewed_at: '2026-09-03T00:00:00Z' }),
    doc('packing_list'),
    doc('passport'),
  ],
  readiness: [ready('inspection_certificate', 'requested'), ready('insurance_certificate', 'not_applicable')],
});

const docItems = (j) => Object.fromEntries(j.sections.documents.items.map((i) => [i.document_type, i]));

test('CAP-06: the buyer\'s documents are T8\'s own states, in shipping order, shipping documents only', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD()));
  assert.equal(j.sections.documents.availability, 'composed');
  assert.deepEqual(j.sections.documents.items.map((i) => i.document_type),
    ['bill_of_lading', 'commercial_invoice', 'export_certificate', 'inspection_certificate', 'insurance_certificate', 'packing_list']);
  const by = docItems(j);
  assert.equal(by.bill_of_lading.state, 'VERIFIED');
  assert.equal(by.commercial_invoice.state, 'AWAITING_REVIEW');
  assert.equal(by.export_certificate.state, 'REJECTED');
  assert.equal(by.inspection_certificate.state, 'REQUESTED');
  assert.equal(by.insurance_certificate.state, 'NOT_APPLICABLE');
  assert.equal(by.packing_list.state, 'PRESENT');
  assert.ok(!('passport' in by) && !('customs_declaration' in by), 'a non-shipping document type was shown on the journey');
});

test('CAP-06: the states come from T8, not from the file existing — a present file is not a verified one', async () => {
  const by = docItems(await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD())));
  assert.notEqual(by.commercial_invoice.state, 'VERIFIED', 'a file arriving was shown as verified');
  assert.match(by.commercial_invoice.note, /nobody has checked/i);
  assert.match(by.bill_of_lading.note, /verified/i);
});

test('CAP-06: no document id, user id, storage path or extraction id is forwarded', async () => {
  const w = DOC_WORLD();
  for (const who of [BUYER, ADMIN]) {
    const text = JSON.stringify(await getJourney('import_order', 'ord-a', who, opts(w)));
    for (const leak of ['u-secret-uploader', 'u-secret-reviewer', 'ocr-secret', 'secret/path.pdf', 'doc-bill_of_lading', 'supplied_by', 'reviewed_by', 'viewer_role']) {
      assert.ok(!text.includes(leak), `${leak} leaked to ${who.id}`);
    }
  }
});

test('CAP-06: a document\'s provenance is shown as when, and whether it was checked — never as who', async () => {
  const bl = docItems(await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD()))).bill_of_lading;
  assert.equal(bl.document.version, 2);
  assert.equal(bl.document.has_earlier_versions, true);
  assert.equal(bl.document.has_extraction, true);
  assert.equal(bl.document.supplied_at, '2026-09-02T00:00:00Z');
  assert.equal(bl.document.reviewed_at, '2026-09-03T00:00:00Z');
  assert.ok(!('supplied_by' in bl.document) && !('reviewed_by' in bl.document) && !('id' in bl.document));
});

test('CAP-06: the document summary counts the journey\'s documents, not T8\'s whole checklist', async () => {
  const s = (await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD()))).sections.documents.summary;
  assert.deepEqual(s, { total: 6, supplied: 4, verified: 1, awaiting_review: 1, rejected: 1, requested_outstanding: 1 });
});

test('CAP-06: T8\'s own disclaimer travels with the documents', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD()));
  assert.match(j.sections.documents.disclaimer, /does not mean it has been checked/i);
});

test('CAP-06: a platform admin sees the documents too', async () => {
  const j = await getJourney('import_order', 'ord-a', ADMIN, opts(DOC_WORLD()));
  assert.equal(j.sections.documents.availability, 'composed');
});

test('CAP-06: where T8 would refuse a viewer the Journey admits, the section says WITHHELD — the Journey still renders', async () => {
  for (const who of [TENANT_ADMIN, PARTICIPANT]) {
    const j = await getJourney('import_order', 'ord-a', who, opts(DOC_WORLD()));
    assert.equal(j.sections.documents.availability, 'withheld', `${who.id} was shown documents T8 refuses them`);
    assert.ok(!('items' in j.sections.documents));
    assert.match(j.sections.documents.note, /not available to you/i);
    assert.ok(j.state, 'the journey itself failed because documents were withheld');
    assert.ok(!JSON.stringify(j).includes('bill_of_lading'), 'a withheld section still named a document');
  }
});

test('CAP-06: if documents cannot be read, the section says UNAVAILABLE — it does not fail the journey or imply there are none', async () => {
  const client = DOC_WORLD();
  const broken = { ...client, from(t) { if (t === 'trade_document_types') throw new Error('boom'); return client.from(t); } };
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(broken));
  assert.equal(j.sections.documents.availability, 'unavailable');
  assert.ok(!('items' in j.sections.documents));
  assert.match(j.sections.documents.note, /could not be read/i);
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_CREATED);
});

test('CAP-06: documents belong to the ORDER — an ambiguous shipment does not hide them', async () => {
  const w = world({ documents: [doc('bill_of_lading', { import_order_id: 'ord-b' })], shipments: [{ id: 'ship-1', import_order_id: 'ord-a' }, { id: 'ship-2', import_order_id: 'ord-c' }] });
  const j = await getJourney('import_order', 'ord-b', COLOADER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_AMBIGUOUS);
  assert.equal(j.sections.documents.availability, 'composed');
  assert.equal(docItems(j).bill_of_lading.state, 'AWAITING_REVIEW');
});

test('CAP-06: another order\'s documents never appear', async () => {
  const w = world({ documents: [doc('bill_of_lading', { import_order_id: 'ord-OTHER', verification_status: 'VERIFIED' })] });
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(w));
  assert.equal(docItems(j).bill_of_lading.state, 'MISSING', 'another order\'s verified document showed on this journey');
});

test('CAP-06: a booking with no order has no documents to show', async () => {
  const w = world({ reservations: [{ id: 'res-n', container_id: 'cont-1', import_order_id: null, buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null }] });
  const j = await getJourney('cargo_reservation', 'res-n', BUYER, opts(w));
  assert.equal(j.state, JOURNEY_STATES.NO_TRANSACTION);
  assert.equal(j.sections.documents.availability, 'not_applicable');
  assert.equal(j.sections.actions.availability, 'not_applicable');
});

test('CAP-06: documents never move the journey state', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD()));
  assert.equal(j.state, JOURNEY_STATES.SHIPMENT_CREATED);
});

test('CAP-06: reads stay bounded however many documents there are', async () => {
  const count = async (documents) => {
    const client = world({ documents });
    let n = 0;
    const counting = { ...client, from(t) { n += 1; return client.from(t); } };
    await getJourney('import_order', 'ord-a', BUYER, opts(counting));
    return n;
  };
  // Two different ways to have "more documents": many VERSIONS of one type (T8 collapses them to one item),
  // and many distinct TYPES each present (six items). The second is the one a per-document query would feel.
  const manyVersions = Array.from({ length: 30 }, (_, i) => doc('bill_of_lading', { id: `d${i}`, version: i + 1, superseded_at: i < 29 ? '2026-09-04T00:00:00Z' : null }));
  const everyType = JOURNEY_DOCUMENT_TYPES.map((type) => doc(type, { verification_status: 'VERIFIED' }));
  const baseline = await count([doc('bill_of_lading')]);
  assert.equal(await count(manyVersions), baseline, 'query count grew with the number of versions');
  assert.equal(await count(everyType), baseline, 'query count grew with the number of documents present');
});

test('CAP-06: composing documents and steps writes nothing', async () => {
  const client = DOC_WORLD();
  const writes = [];
  const trapped = { ...client, from(table) {
    const chain = client.from(table);
    return new Proxy(chain, { get(target, prop) {
      if (['insert', 'update', 'delete', 'upsert'].includes(prop)) writes.push(`${prop} ${table}`);
      const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
    } });
  } };
  await getJourney('import_order', 'ord-a', BUYER, opts(trapped));
  assert.deepEqual(writes, []);
});

// ── Next steps: derived only from recorded authority state ────────────────

const steps = (j) => j.sections.actions.items;

test('CAP-06: a requested document is the buyer\'s action, and links to the document workspace', async () => {
  const s = steps(await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD())));
  const ask = s.find((a) => a.code === 'DOCUMENT_REQUESTED');
  assert.equal(ask.kind, 'YOUR_ACTION');
  assert.equal(ask.waiting_on, 'you');
  assert.match(ask.text, /Inspection Certificate/);
  assert.deepEqual(ask.link, { type: 'document_workspace', subject: { type: 'import_order', id: 'ord-a' } });
});

test('CAP-06: a rejected document needs a corrected one, and says whose move it is', async () => {
  const s = steps(await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD())));
  const fix = s.find((a) => a.code === 'DOCUMENT_REJECTED');
  assert.equal(fix.kind, 'YOUR_ACTION');
  assert.match(fix.text, /Export Certificate/);
});

test('CAP-06: a document waiting for CarUp\'s review is WAITING_ON CarUp for everyone — not an action for the buyer', async () => {
  for (const who of [BUYER, ADMIN]) {
    const a = steps(await getJourney('import_order', 'ord-a', who, opts(DOC_WORLD()))).find((x) => x.code === 'DOCUMENT_AWAITING_REVIEW');
    assert.equal(a.kind, 'WAITING_ON');
    assert.equal(a.waiting_on, 'CarUp review');
    assert.match(a.text, /Commercial Invoice/);
  }
});

test('CAP-06: for someone other than the buyer, "your action" becomes "the buyer\'s"', async () => {
  const s = steps(await getJourney('import_order', 'ord-a', ADMIN, opts(DOC_WORLD())));
  const ask = s.find((a) => a.code === 'DOCUMENT_REQUESTED');
  assert.equal(ask.kind, 'WAITING_ON');
  assert.equal(ask.waiting_on, 'the buyer');
  assert.ok(!s.some((a) => a.kind === 'YOUR_ACTION'), 'an admin was told a step was theirs');
});

test('CAP-06: a missing document is not an instruction, and a verified or present one needs nothing', async () => {
  const s = steps(await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD())));
  const text = JSON.stringify(s);
  assert.ok(!/Bill of Lading/.test(text), 'a verified document produced a step');
  assert.ok(!/Packing List/.test(text), 'a present document produced a step');
  assert.ok(!/Insurance Certificate/.test(text), 'a not-applicable document produced a step');
  const noAsk = steps(await getJourney('import_order', 'ord-a', BUYER, opts(world())));
  assert.ok(!noAsk.some((a) => /DOCUMENT_/.test(a.code)), 'a merely missing document was turned into a demand');
});

test('CAP-06: an ambiguous shipment, an exception and a port disagreement each wait on the organiser', async () => {
  const amb = await getJourney('import_order', 'ord-b', COLOADER, opts(world({ shipments: [{ id: 'ship-1', import_order_id: 'ord-a' }, { id: 'ship-2', import_order_id: 'ord-c' }] })));
  assert.equal(steps(amb).find((a) => a.code === 'SHIPMENT_AMBIGUOUS').waiting_on, 'the organiser');
  const exc = await getJourney('import_order', 'ord-a', BUYER, opts(world({ shipments: [{ id: 'ship-1', departure_date: '2026-09-21T08:00:00Z' }],
    events: [{ id: 'e1', shipment_id: 'ship-1', stage: 'CUSTOMS_HOLD', event_time: '2026-09-25T00:00:00Z', location: 'Gateway', deleted_at: null }] })));
  const hold = steps(exc).find((a) => a.code === 'SHIPMENT_EXCEPTION');
  assert.equal(hold.kind, 'WAITING_ON');
  assert.ok(!/cleared|released|approved|customs decision/i.test(hold.text.replace(/not a customs decision/i, '')), 'a hold produced a customs claim');
  const mismatch = await getJourney('import_order', 'ord-a', BUYER, opts(world({ legs: [leg({ port_of_loading: 'Somewhere Else' })] })));
  assert.equal(steps(mismatch).find((a) => a.code === 'LEG_PORT_MISMATCH').waiting_on, 'the organiser');
});

test('CAP-06: with nothing grounded, the steps are an honest empty list — not "all clear"', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world()));
  assert.equal(j.sections.actions.availability, 'composed');
  assert.deepEqual(steps(j), []);
  assert.match(j.sections.actions.note, /does not mean nothing is needed/i);
});

test('CAP-06: when documents are withheld, no document step is invented — and the section says why', async () => {
  const j = await getJourney('import_order', 'ord-a', TENANT_ADMIN, opts(DOC_WORLD()));
  assert.ok(!steps(j).some((a) => /DOCUMENT_/.test(a.code)));
  assert.match(j.sections.actions.note, /document steps are not shown/i);
  assert.match(j.sections.actions.note, /not available to you/i);
});

test('CAP-06: when documents could not be READ, the steps say so — not that the viewer is not allowed them', async () => {
  const client = DOC_WORLD();
  const broken = { ...client, from(t) { if (t === 'trade_document_types') throw new Error('boom'); return client.from(t); } };
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(broken));
  assert.ok(!steps(j).some((a) => /DOCUMENT_/.test(a.code)), 'a document step was invented from documents that could not be read');
  assert.match(j.sections.actions.note, /document steps are not shown/i);
  assert.match(j.sections.actions.note, /could not be read/i);
  assert.doesNotMatch(j.sections.actions.note, /not available to you/i, 'a read failure was worded as a permission refusal');
});

test('CAP-06: every step is plain data — a kind, a code, words, who it waits on — and no internal id', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(DOC_WORLD()));
  for (const a of steps(j)) {
    assert.ok(['YOUR_ACTION', 'WAITING_ON'].includes(a.kind));
    assert.ok(a.code && a.text && a.waiting_on);
  }
  const text = JSON.stringify(steps(j));
  for (const leak of ['u-secret', 'doc-', 'secret/path']) assert.ok(!text.includes(leak), `${leak} leaked into a step`);
});
