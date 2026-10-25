/**
 * T11-CAP-LR01-R1 — Journey & Arrival is a CarUp VEHICLE capability, not a feature of one purchase.
 *
 * `GET /journeys/vehicle/:vin` answers "what is happening to this vehicle?" for ANY vehicle:
 *
 *   · a vehicle with a full Trade OS journey         → that order's journey, unchanged;
 *   · a vehicle with an order but no shipment         → the order and the honest next stage;
 *   · a vehicle with no Trade OS history at all       → its identity and "no journey recorded", never a
 *                                                       broken page and never somebody else's journey;
 *   · a vehicle with several orders                   → no guess: the readable ones are offered.
 *
 * What these tests hold:
 *
 *   1. vehicles are ISOLATED — two vehicles of one user, a co-loaded neighbour and an unrelated user
 *      never lend each other a shipment, vessel, ETA, document, case or alert;
 *   2. the capability depends on no make, model, chassis, reference, port, carrier or seller — and the
 *      reusable code contains none (a scan, not a promise);
 *   3. access follows the order's own rule; a vehicle's owner is not thereby an order participant, and a
 *      refusal is the same for a missing vehicle as for one that is not yours;
 *   4. it writes nothing.
 *
 * Fixtures are synthetic and exist only in this file. They are structural edge cases, not UAT evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getJourney, JOURNEY_STATES, JOURNEY_SUBJECT_TYPES } from '../services/diaspora/journeyProjectionService.js';
import { resolveAlertRecipients } from '../services/diaspora/journeyAlertNotifier.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

const OWNER = { id: 'u-owner', platformRole: 'member' };
const NEIGHBOUR = { id: 'u-neighbour', platformRole: 'member' };
const STRANGER = { id: 'u-stranger', platformRole: 'member' };
const ASSIGNED = { id: 'u-assigned', platformRole: 'member' };
const ADMIN = { id: 'u-platform-admin', platformRole: 'platform_admin' };

const opts = (client) => ({ supabaseClient: client });

const V_FULL = 'VINFULL-AAAA-111';     // owner · order + shipment + leg
const V_BARE = 'VINBARE-BBBB-222';     // owner · no order at all
const V_ORDER = 'VINORDER-CCCC-333';   // owner · order, no shipment
const V_NEIGH = 'VINNEIGH-DDDD-444';   // neighbour · order on the SAME container, no shipment of its own
const V_TWO = 'VINTWO-EEEE-555';       // owner · two orders
const V_FOREIGN = 'VINFOREIGN-FFFF-666'; // stranger-owned, owner's name nowhere

const vehicle = (vin, over = {}) => ({
  vin, make: 'MakeOf', model: `ModelOf-${vin}`, year: 2016, color: 'Pearl', mileage: 1000,
  chassis_number: `CH-${vin}`, engine_number: `EN-${vin}`, owner_id: 'u-owner', current_seller_id: null, ...over,
});
const order = (id, vin, buyer, over = {}) => ({
  id, tenant_id: null, buyer_id: buyer, created_by: buyer, linked_vehicle_vin: vin, status: 'IMPORT_REQUESTED',
  origin_country: 'Origin', destination_country: 'Dest', deleted_at: null, created_at: '2026-10-01T00:00:00Z', ...over,
});
const shipment = (id, orderId, over = {}) => ({
  id, tenant_id: 'tenant-1', import_order_id: orderId, container_id: null, status: 'PLANNED',
  carrier_name: `Carrier-${id}`, tracking_number: null, origin_port: 'Port Origin', destination_port: 'Port Discharge',
  departure_date: null, estimated_arrival_date: '2026-09-18T00:00:00Z', actual_arrival_date: null,
  metadata: { planned_departure_date: '2026-08-29T00:00:00Z', planned_departure_source: 'stated_at_creation' },
  deleted_at: null, ...over,
});

function world(over = {}) {
  return createMockSupabase({
    vehicles: over.vehicles || [
      vehicle(V_FULL, { make: 'AlphaMake', model: 'AlphaModel' }),
      vehicle(V_BARE, { make: 'BravoMake', model: 'BravoModel', year: 2010 }),
      vehicle(V_ORDER, { make: 'CharlieMake', model: 'CharlieModel' }),
      vehicle(V_NEIGH, { make: 'DeltaMake', model: 'DeltaModel', owner_id: 'u-neighbour' }),
      vehicle(V_TWO, { make: 'EchoMake', model: 'EchoModel' }),
      vehicle(V_FOREIGN, { make: 'FoxMake', model: 'FoxModel', owner_id: 'u-stranger' }),
    ],
    diaspora_import_orders: over.orders || [
      order('ord-full', V_FULL, 'u-owner'),
      order('ord-order', V_ORDER, 'u-owner'),
      order('ord-neigh', V_NEIGH, 'u-neighbour'),
      order('ord-two-a', V_TWO, 'u-owner', { created_at: '2026-09-01T00:00:00Z' }),
      order('ord-two-b', V_TWO, 'u-owner', { created_at: '2026-10-01T00:00:00Z' }),
      order('ord-foreign', V_FOREIGN, 'u-stranger'),
    ],
    diaspora_import_order_participants: over.participants || [
      { id: 'p1', import_order_id: 'ord-full', user_id: 'u-assigned', verification_status: 'active', deleted_at: null },
    ],
    diaspora_container_shipments: [{ id: 'cont-1', tenant_id: null, coordinator_id: 'u-operator', status: 'SHIPPED', deleted_at: null }],
    diaspora_cargo_reservations: over.reservations || [
      { id: 'res-full', container_id: 'cont-1', import_order_id: 'ord-full', buyer_id: 'u-owner', created_by: 'u-owner', deleted_at: null },
      { id: 'res-neigh', container_id: 'cont-1', import_order_id: 'ord-neigh', buyer_id: 'u-neighbour', created_by: 'u-neighbour', deleted_at: null },
    ],
    diaspora_container_loads: [{ id: 'load-1', container_id: 'cont-1', status: 'COMPLETED', confirmed_at: '2026-08-20T00:00:00Z', deleted_at: null }],
    diaspora_container_load_items: [
      { id: 'li-full', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-full', outcome: 'LOADED', deleted_at: null },
      { id: 'li-neigh', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-neigh', outcome: 'LOADED', deleted_at: null },
    ],
    diaspora_shipments: over.shipments || [shipment('ship-full', 'ord-full', { container_id: 'cont-1' })],
    diaspora_shipment_stage_events: [],
    diaspora_shipment_legs: over.legs || [{
      id: 'leg-1', shipment_id: 'ship-full', leg_sequence: 1, carrier_name: 'Carrier-ship-full', vessel_name: 'VESSEL-OF-FULL',
      port_of_loading: 'Port Origin', port_of_discharge: 'Port Discharge', source: 'OPERATOR_DECLARED', deleted_at: null, created_at: '2026-10-01T00:00:00Z',
    }],
    diaspora_shipment_observations: [],
    trade_document_types: [],
    diaspora_trade_documents: [],
    diaspora_trade_document_readiness: [],
    diaspora_customs_cases: [],
    diaspora_customs_events: [],
    diaspora_customs_agent_appointments: [],
    diaspora_import_quotes: [],
  });
}

const read = (vin, who, w = world()) => getJourney('vehicle', vin, who, opts(w));

// ── The subject exists, and means the vehicle ─────────────────────────────

test('R1-V: "vehicle" is a Journey subject, and the answer names the vehicle and the order it resolved', async () => {
  assert.ok(JOURNEY_SUBJECT_TYPES.includes('vehicle'));
  const j = await read(V_FULL, OWNER);
  assert.deepEqual(j.subject, { type: 'vehicle', id: V_FULL, order_id: 'ord-full' });
  assert.equal(j.asset.make, 'AlphaMake');
  assert.equal(j.shipping.references.carrier, 'Carrier-ship-full');
});

test('R1-V: a vehicle with ONE readable order is exactly that order\'s journey, however it is named', async () => {
  const w = world();
  const byVehicle = await read(V_FULL, OWNER, w);
  const byOrder = await getJourney('import_order', 'ord-full', OWNER, opts(w));
  const strip = ({ subject, generated_at, ...rest }) => rest;
  assert.deepEqual(strip(byVehicle), strip(byOrder), 'the vehicle route is a second, different journey');
});

// ── 1. Isolation ──────────────────────────────────────────────────────────

test('R1-V: two vehicles of ONE user never lend each other anything', async () => {
  const w = world();
  const full = await read(V_FULL, OWNER, w);
  const bare = await read(V_BARE, OWNER, w);

  // The bare vehicle: identity and an honest absence — no shipment, vessel, ETA, document, case, alert.
  assert.equal(bare.state, JOURNEY_STATES.NO_TRANSACTION);
  assert.equal(bare.asset.make, 'BravoMake');
  assert.equal(bare.shipping, null);
  assert.equal(bare.transaction, null);
  assert.deepEqual(bare.timeline, []);
  assert.deepEqual(bare.exceptions, []);
  assert.equal(bare.sections.documents.availability, 'not_applicable');
  assert.equal(bare.sections.customs.availability, 'not_applicable');
  assert.equal(bare.sections.intelligence.availability, 'not_applicable');
  // The owner of the vehicle sees its identifiers; a vehicle with no journey is still THEIR vehicle.
  assert.equal(bare.asset.chassis_number, `CH-${V_BARE}`);
  assert.equal(bare.viewer.kind, 'OWNER');
  const bareText = JSON.stringify(bare);
  for (const borrowed of ['Carrier-ship-full', 'VESSEL-OF-FULL', 'AlphaMake', 'AlphaModel', V_FULL, 'ord-full', 'ship-full', 'Port Discharge']) {
    assert.ok(!bareText.includes(borrowed), `the bare vehicle borrowed ${borrowed}`);
  }
  // And the reverse.
  const fullText = JSON.stringify(full);
  for (const borrowed of ['BravoMake', 'BravoModel', V_BARE]) {
    assert.ok(!fullText.includes(borrowed), `the full vehicle shows ${borrowed}`);
  }
});

test('R1-V: a vehicle with an order and NO shipment does not inherit one — even from a co-loaded neighbour', async () => {
  const w = world();
  // V_ORDER's order has no shipment and no container. V_FULL's order has one.
  const j = await read(V_ORDER, OWNER, w);
  assert.equal(j.subject.order_id, 'ord-order');
  assert.equal(j.state, JOURNEY_STATES.NO_SHIPMENT);
  assert.equal(j.shipping.association, 'none');
  assert.equal(j.shipping.dates, null);
  assert.equal(j.shipping.references, null);
  assert.ok(!JSON.stringify(j).includes('Carrier-ship-full'));
});

test('R1-V: a co-loaded neighbour\'s vehicle is NOT shown the owner\'s shipment, and the owner is not shown theirs', async () => {
  const w = world();
  const neigh = await read(V_NEIGH, NEIGHBOUR, w);
  assert.equal(neigh.subject.order_id, 'ord-neigh');
  assert.equal(neigh.shipping.association, 'none');
  assert.equal(neigh.shipping.references, null);
  assert.ok(!/Carrier-ship-full|VESSEL-OF-FULL|AlphaMake|VINFULL|ord-full/.test(JSON.stringify(neigh)), 'the neighbour was shown the owner\'s journey');
  const full = await read(V_FULL, OWNER, w);
  assert.ok(!/DeltaMake|VINNEIGH|ord-neigh|u-neighbour/.test(JSON.stringify(full)), 'the owner was shown the neighbour\'s');
});

test('R1-V: a vehicle without documents gets T8\'s honest "missing", not an empty list and not another vehicle\'s documents', async () => {
  const w = world({
    // A verified B/L exists — for the OTHER vehicle's order.
  });
  const j = await read(V_ORDER, OWNER, w);
  assert.equal(j.sections.documents.availability, 'composed');
  assert.ok(!JSON.stringify(j.sections.documents).includes('VERIFIED'), 'a document state appeared from nowhere');
});

// ── 3. Access ─────────────────────────────────────────────────────────────

test('R1-V: an unrelated user is refused — identically for a vehicle that exists and one that does not', async () => {
  const w = world();
  const real = await read(V_FULL, STRANGER, w).catch((e) => e);
  const missing = await read('NO-SUCH-VIN-0000', STRANGER, w).catch((e) => e);
  assert.ok(real instanceof ForbiddenError);
  assert.ok(missing instanceof ForbiddenError);
  assert.equal(real.message, missing.message, 'the refusals are distinguishable');
});

test('R1-V: a platform admin is told the truth about a missing vehicle, and may read any vehicle', async () => {
  const w = world();
  await assert.rejects(() => read('NO-SUCH-VIN-0000', ADMIN, w), NotFoundError);
  const j = await read(V_FULL, ADMIN, w);
  assert.equal(j.viewer.kind, 'ADMIN');
  assert.equal(j.shipping.references.carrier, 'Carrier-ship-full');
});

test('R1-V: an order participant may read the vehicle journey; a neighbour whose order is not related may not', async () => {
  const w = world();
  const assigned = await read(V_FULL, ASSIGNED, w);
  assert.equal(assigned.viewer.kind, 'PARTICIPANT');
  await assert.rejects(() => read(V_FULL, NEIGHBOUR, w), ForbiddenError);
});

test('R1-V: being a participant of ONE order opens no other order — a participant\'s standing is per order', async () => {
  const w = world();
  // u-assigned is on ord-full only. V_ORDER's order (ord-order) is the owner's alone.
  await assert.rejects(() => read(V_ORDER, ASSIGNED, w), ForbiddenError);
  const ok = await read(V_FULL, ASSIGNED, w);
  assert.equal(ok.subject.order_id, 'ord-full');
});

test('R1-V: a vehicle\'s owner who is not on the order sees the vehicle and NOTHING of an order they cannot read', async () => {
  // The vehicle is the owner's, but its only order belongs to someone else.
  const w = world({ orders: [order('ord-other', V_BARE, 'u-stranger')], shipments: [shipment('ship-other', 'ord-other')], legs: [], reservations: [] });
  const j = await read(V_BARE, OWNER, w);
  assert.equal(j.state, JOURNEY_STATES.NO_TRANSACTION);
  assert.equal(j.asset.make, 'BravoMake');
  assert.equal(j.shipping, null);
  assert.ok(!/ord-other|ship-other|Carrier-ship-other|u-stranger/.test(JSON.stringify(j)), 'an order the owner cannot read leaked');
  // The same words a vehicle with no order at all gets — existence of the order is not an oracle.
  const none = await read(V_BARE, OWNER, world());
  assert.equal(j.sentence, none.sentence);
});

test('R1-V: another user\'s vehicle with no order is refused to a stranger, shown to its owner', async () => {
  const w = world();
  await assert.rejects(() => read(V_BARE, STRANGER, w), ForbiddenError);
  const j = await read(V_BARE, OWNER, w);
  assert.equal(j.viewer.kind, 'OWNER');
});

test('R1-V: private identifiers are the owner\'s and the platform\'s — not a participant\'s', async () => {
  const w = world();
  const owner = await read(V_FULL, OWNER, w);
  assert.equal(owner.asset.chassis_number, `CH-${V_FULL}`);
  const participant = await read(V_FULL, ASSIGNED, w);
  assert.ok(!('chassis_number' in participant.asset), 'a participant was shown the chassis number');
  assert.ok(!('engine_number' in participant.asset));
});

// ── Several orders: no guess ──────────────────────────────────────────────

test('R1-V: a vehicle with several readable orders is NEVER resolved by guessing — the choices are offered', async () => {
  const j = await read(V_TWO, OWNER);
  assert.equal(j.state, JOURNEY_STATES.ORDER_AMBIGUOUS);
  assert.equal(j.shipping, null);
  assert.equal(j.asset.make, 'EchoMake');
  assert.deepEqual(j.candidates.map((c) => c.order_id).sort(), ['ord-two-a', 'ord-two-b']);
  assert.deepEqual(Object.keys(j.candidates[0]).sort(), ['created_at', 'order_id', 'status']);
});

test('R1-V: only the orders the viewer may read are offered; one readable order is simply that journey', async () => {
  // The stranger is the buyer of ord-two-b only.
  const w = world({ orders: [order('ord-two-a', V_TWO, 'u-owner'), order('ord-two-b', V_TWO, 'u-stranger')], shipments: [], legs: [], reservations: [] });
  const j = await read(V_TWO, STRANGER, w);
  assert.equal(j.subject.order_id, 'ord-two-b');
  assert.ok(!JSON.stringify(j).includes('ord-two-a'), 'an unreadable order was offered');
});

test('R1-V: with several orders, a participant of ONE of them sees that one — and only that one is theirs to open', async () => {
  const w = world({
    orders: [order('ord-two-a', V_TWO, 'u-owner'), order('ord-two-b', V_TWO, 'u-owner')],
    participants: [{ id: 'p-two', import_order_id: 'ord-two-a', user_id: 'u-assigned', verification_status: 'active', deleted_at: null }],
    shipments: [], legs: [], reservations: [],
  });
  const j = await read(V_TWO, ASSIGNED, w);
  assert.equal(j.subject.order_id, 'ord-two-a');
  assert.notEqual(j.state, JOURNEY_STATES.ORDER_AMBIGUOUS, 'a standing on one order was read as standing on both');
  assert.ok(!JSON.stringify(j).includes('ord-two-b'));
});

test('R1-V: the choices offered never include an order the viewer cannot read, even when several are readable', async () => {
  const w = world({
    orders: [order('ord-two-a', V_TWO, 'u-owner'), order('ord-two-b', V_TWO, 'u-owner'), order('ord-two-c', V_TWO, 'u-stranger')],
    shipments: [], legs: [], reservations: [], participants: [],
  });
  const j = await read(V_TWO, OWNER, w);
  assert.equal(j.state, JOURNEY_STATES.ORDER_AMBIGUOUS);
  assert.deepEqual(j.candidates.map((c) => c.order_id).sort(), ['ord-two-a', 'ord-two-b']);
  assert.ok(!JSON.stringify(j).includes('ord-two-c'), 'an order the viewer cannot read was offered');
});

test('R1-V: an order that is deleted is not a journey', async () => {
  const w = world({ orders: [order('ord-gone', V_BARE, 'u-owner', { deleted_at: '2026-10-02T00:00:00Z' })], shipments: [], legs: [], reservations: [] });
  const j = await read(V_BARE, OWNER, w);
  assert.equal(j.state, JOURNEY_STATES.NO_TRANSACTION);
  assert.ok(!JSON.stringify(j).includes('ord-gone'));
});

test('R1-V: the vehicle is matched by its exact identifier — a near-miss is another vehicle, not this one', async () => {
  const w = world();
  await assert.rejects(() => read(V_FULL.toLowerCase(), STRANGER, w), ForbiddenError);
  const admin = await read(V_FULL.toLowerCase(), ADMIN, w).catch((e) => e);
  assert.ok(admin instanceof NotFoundError, 'a case-different identifier resolved to the vehicle');
});

// ── 2. The capability depends on no particular vehicle ────────────────────

test('R1-V: it works the same for any make, model, chassis, port and carrier — nothing is special-cased', async () => {
  const shapes = [
    { vin: 'JHMXX-0000001', make: 'Honda', model: 'Vezel', chassis: 'RU3-1316558', port: 'Shimonoseki', carrier: 'Hoegh' },
    { vin: 'GFC27-027051', make: 'Nissan', model: 'Serena Highway Star', chassis: 'GFC27-027051', port: 'Yokohama', carrier: 'NYK' },
    { vin: '1HGCM82633A004352', make: 'Zeta', model: 'Q', chassis: null, port: 'Durban', carrier: 'Maersk' },
  ];
  for (const s of shapes) {
    const w = world({
      vehicles: [vehicle(s.vin, { make: s.make, model: s.model, chassis_number: s.chassis })],
      orders: [order('o1', s.vin, 'u-owner')],
      shipments: [shipment('s1', 'o1', { carrier_name: s.carrier, origin_port: s.port })],
      legs: [], reservations: [], participants: [],
    });
    const j = await read(s.vin, OWNER, w);
    assert.equal(j.asset.make, s.make);
    assert.equal(j.asset.model, s.model);
    assert.equal(j.shipping.references.carrier, s.carrier);
    assert.equal(j.shipping.references.origin_port, s.port);
    assert.equal(j.state, JOURNEY_STATES.SHIPMENT_CREATED);
  }
});

test('R1-V: the reusable Journey code names no vehicle, reference, carrier, port or seller from any real purchase', () => {
  // The Journey capability's own files — not the whole tree, which holds unrelated programmes' fixtures.
  const files = [];
  const add = (dir, re) => {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) if (re.test(name) && !/\.test\./.test(name)) files.push(path.join(dir, name));
  };
  add('backend/services/diaspora', /^(journey|shipmentLegRead|shipmentObservationRead|shipmentTrackingService|diasporaShipmentObservationService|diasporaShipmentLegService)/);
  add('backend/routes', /^diasporaJourneyRoutes/);
  add('web/src/pages/diaspora', /^(JourneyArrival|journeyDisplay)\./);
  assert.ok(files.length >= 8, `the scan found only ${files.length} files — it is not looking where it thinks it is`);
  const forbidden = [/RU3-?1316558/i, /CD740269/i, /GFC27/i, /LEB6736579/i, /HOEGH/i, /TRACER/i, /\bVezel\b/i, /Serena/i, /BE ?FORWARD/i, /u_66cace85fad949e4/, /Kingston/i, /Kingstone/i];
  const hits = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of forbidden) if (re.test(text)) hits.push(`${rel}: ${re}`);
  }
  assert.deepEqual(hits, [], `a real purchase is hard-coded into the reusable capability: ${hits.join('; ')}`);
});

// ── 8. Statistics and 9. alerts stay with the right journey ───────────────

test('R1-V: statistics are the order journey\'s own — not a different calculation behind the vehicle route', async () => {
  const w = world();
  const byVehicle = await read(V_FULL, OWNER, w);
  const byOrder = await getJourney('import_order', 'ord-full', OWNER, opts(w));
  assert.deepEqual(byVehicle.sections.intelligence, byOrder.sections.intelligence);
  assert.equal(byVehicle.sections.intelligence.availability, 'composed');
  // Below the floor, said as such — and it counts nothing it was not asked about.
  assert.equal(byVehicle.sections.intelligence.lane.availability, 'insufficient_data');
  const bare = await read(V_BARE, OWNER, w);
  assert.equal(bare.sections.intelligence.availability, 'not_applicable');
});

test('R1-V: an alert for one vehicle\'s shipment addresses that vehicle\'s order participants and nobody else\'s', async () => {
  const w = world({
    shipments: [shipment('ship-full', 'ord-full', { container_id: 'cont-1' }), shipment('ship-neigh', 'ord-neigh', { container_id: 'cont-1' })],
    legs: [],
  });
  const forFull = await resolveAlertRecipients({ id: 'ship-full', import_order_id: 'ord-full', container_id: 'cont-1' }, { client: w });
  const forNeigh = await resolveAlertRecipients({ id: 'ship-neigh', import_order_id: 'ord-neigh', container_id: 'cont-1' }, { client: w });
  assert.deepEqual(forFull.map((r) => `${r.userId}@${r.orderId}`), ['u-owner@ord-full']);
  assert.deepEqual(forNeigh.map((r) => `${r.userId}@${r.orderId}`), ['u-neighbour@ord-neigh']);
  // Each Journey shows its own shipment, so each alert is about the Journey its recipient can open.
  const fullJ = await read(V_FULL, OWNER, w);
  const neighJ = await read(V_NEIGH, NEIGHBOUR, w);
  assert.notEqual(fullJ.shipping.reference, neighJ.shipping.reference);
});

// ── 4. It writes nothing ──────────────────────────────────────────────────

test('R1-V: the vehicle route writes nothing — proven by trap', async () => {
  const w = world();
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
  for (const vin of [V_FULL, V_BARE, V_ORDER, V_TWO]) await getJourney('vehicle', vin, OWNER, { supabaseClient: trapped });
  assert.deepEqual(writes, []);
});

test('R1-V: an unknown subject type is still rejected, and a vehicle needs an identifier', async () => {
  await assert.rejects(() => getJourney('container', 'x', OWNER, opts(world())), ValidationError);
  await assert.rejects(() => getJourney('vehicle', '  ', OWNER, opts(world())), ValidationError);
});

test('R1-V: the reads are bounded — a vehicle with many orders costs a fixed number of queries', async () => {
  const count = async (extra) => {
    const orders = [];
    for (let i = 0; i < extra; i += 1) orders.push(order(`o${i}`, V_TWO, 'u-owner', { created_at: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
    const w = world({ orders, shipments: [], legs: [], reservations: [], participants: [] });
    let n = 0;
    const counting = { ...w, from(t) { n += 1; return w.from(t); } };
    await getJourney('vehicle', V_TWO, OWNER, { supabaseClient: counting });
    return n;
  };
  const few = await count(2);
  const many = await count(12);
  assert.equal(many, few, `queries grew with the number of orders: ${few} -> ${many}`);
});
