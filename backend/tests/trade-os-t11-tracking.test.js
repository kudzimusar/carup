/**
 * Trade OS T11.2/T11.3 — the shipment projections.
 *
 * Four distinctions, each of which is a way a tracking page starts lying if it is collapsed:
 *
 *     PLANNED departure   ≠ OBSERVED departure
 *     ETA                 ≠ ACTUAL ARRIVAL
 *     a carrier reference ≠ movement
 *     a customs HOLD      ≠ a customs DECISION
 *
 * Plus the one inherited from T10: LOADED is not SAILED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getShipmentOperatorView, getMyShipmentTracking, TRACKING_STATES } from '../services/diaspora/shipmentTrackingService.js';

const OPERATOR = { id: 'user-operator', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-op' };
const CUSTOMER = { id: 'user-customer', platformRole: 'member' };
const COLOADER = { id: 'user-coloader', platformRole: 'member' };
const OUTSIDER = { id: 'user-outsider', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-other' };

const CONTAINER = 'cont-1';
const SHIPMENT = 'ship-1';
const LOAD = 'load-1';
const RES_A = 'res-a'; // customer's, loaded
const RES_B = 'res-b'; // co-loader's, left behind

function world(over = {}) {
  return createMockSupabase({
    diaspora_container_shipments: [
      { id: CONTAINER, tenant_id: 'tenant-op', coordinator_id: 'user-operator', status: 'LOADING', total_capacity_volume: 33, deleted_at: null },
    ],
    diaspora_cargo_reservations: [
      { id: RES_A, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-a', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 3, reservation_status: 'APPROVED', deleted_at: null },
      { id: RES_B, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-b', buyer_id: 'user-coloader', created_by: 'user-coloader', cargo_type: 'other', estimated_volume: 1.5, reservation_status: 'APPROVED', deleted_at: null },
    ],
    diaspora_container_loads: [
      { id: LOAD, tenant_id: 'tenant-op', container_id: CONTAINER, reference: 'LOAD-1', status: 'COMPLETED', confirmed_by: 'user-operator', confirmed_at: '2026-09-12T10:00:00Z', actual_loaded_volume_cbm: 3.6, deleted_at: null },
    ],
    diaspora_container_load_items: [
      { id: 'li-a', load_id: LOAD, subject_type: 'cargo_reservation', subject_id: RES_A, outcome: 'LOADED', loaded_volume_cbm: 3.6, loaded_by: 'user-operator', loaded_at: '2026-09-12T09:30:00Z', deleted_at: null },
      { id: 'li-b', load_id: LOAD, subject_type: 'cargo_reservation', subject_id: RES_B, outcome: 'LEFT_BEHIND', left_behind_reason: 'NO_SPACE', loaded_volume_cbm: null, deleted_at: null },
    ],
    diaspora_container_seal_records: [
      { id: 's-1', load_id: LOAD, container_number: 'MSKU7654321', seal_number: 'SEAL-A1', recorded_by: 'user-operator', recorded_at: '2026-09-12T10:05:00Z', deleted_at: null },
    ],
    diaspora_shipments: over.shipments === undefined ? [
      { id: SHIPMENT, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-a', status: 'PLANNED',
        carrier_name: 'Maersk', tracking_number: 'TRK-999', origin_port: 'Durban', destination_port: 'Beira',
        departure_date: null, estimated_arrival_date: '2026-10-01T00:00:00Z', actual_arrival_date: null,
        metadata: { planned_departure_date: '2026-09-20T00:00:00Z', planned_departure_source: 'stated_at_creation' },
        deleted_at: null, ...(over.shipment || {}) },
    ] : over.shipments,
    diaspora_shipment_stage_events: over.events || [],
    diaspora_import_orders: [{ id: 'ord-a', buyer_id: 'user-customer', deleted_at: null }],
  });
}

const opts = (client) => ({ supabaseClient: client });

// ── Planned ≠ observed ─────────────────────────────────────────────────────

test('T11: a planned departure is reported as a PLAN, and observed stays null', async () => {
  const client = world();
  const v = await getShipmentOperatorView(SHIPMENT, OPERATOR, opts(client));
  assert.equal(v.dates.planned_departure, '2026-09-20T00:00:00Z');
  assert.equal(v.dates.planned_departure_source, 'stated_at_creation');
  assert.equal(v.dates.observed_departure, null, 'an intention was reported as a sailing');
  assert.match(v.dates.note, /planned departure is an intention/i);
});

test('T11: an ETA is reported as an estimate, and arrival stays null', async () => {
  const client = world();
  const v = await getShipmentOperatorView(SHIPMENT, OPERATOR, opts(client));
  assert.equal(v.dates.estimated_arrival, '2026-10-01T00:00:00Z');
  assert.equal(v.dates.observed_arrival, null, 'an estimate was reported as an arrival');
});

test('T11: a carrier reference is never reported as movement', async () => {
  const client = world();
  const v = await getShipmentOperatorView(SHIPMENT, OPERATOR, opts(client));
  assert.equal(v.references.carrier, 'Maersk');
  assert.equal(v.references.tracking_reference, 'TRK-999');
  assert.match(v.references.note, /not a record that anything has moved/i);
  // …and the participant, who is the one who would misread it, is still told nothing moved.
  const mine = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, TRACKING_STATES.SHIPMENT_CREATED);
  assert.match(mine.sentence, /Nothing has been recorded as moving/i);
});

test('T11: unknown references stay unknown', async () => {
  const client = world({ shipment: { carrier_name: null, tracking_number: null, origin_port: null } });
  const v = await getShipmentOperatorView(SHIPMENT, OPERATOR, opts(client));
  assert.equal(v.references.carrier, null);
  assert.equal(v.references.tracking_reference, null);
  assert.equal(v.references.origin_port, null);
});

// ── The operator view ──────────────────────────────────────────────────────

test('T11: the operator sees the completed T10 load the shipment came from', async () => {
  const client = world();
  const v = await getShipmentOperatorView(SHIPMENT, OPERATOR, opts(client));
  assert.equal(v.load.status, 'COMPLETED');
  assert.equal(v.load.loaded_lines, 1);
  // Left-behind cargo stays historically attached and is counted separately from what travelled.
  assert.equal(v.load.left_behind_lines, 1);
  assert.equal(v.load.actual_loaded_volume_cbm, 3.6);
});

test('T11: the operator sees the container and seal recorded at loading', async () => {
  const client = world();
  const v = await getShipmentOperatorView(SHIPMENT, OPERATOR, opts(client));
  assert.equal(v.references.container_number, 'MSKU7654321');
  assert.equal(v.references.seal_number, 'SEAL-A1');
});

test('T11: the timeline is oldest-first and every event says who recorded it', async () => {
  const client = world({
    events: [
      { id: 'e2', shipment_id: SHIPMENT, stage: 'IN_TRANSIT', event_time: '2026-09-21T08:00:00Z', location: 'Durban', created_by: 'user-operator', created_at: '2026-09-21T08:05:00Z', metadata: { source: 'carrier email' }, deleted_at: null },
      { id: 'e1', shipment_id: SHIPMENT, stage: 'BOOKED', event_time: '2026-09-19T08:00:00Z', location: null, created_by: 'user-operator', created_at: '2026-09-19T08:05:00Z', metadata: {}, deleted_at: null },
    ],
  });
  const v = await getShipmentOperatorView(SHIPMENT, OPERATOR, opts(client));
  assert.deepEqual(v.timeline.map((e) => e.stage), ['BOOKED', 'IN_TRANSIT']);
  for (const e of v.timeline) assert.equal(e.recorded_by, 'user-operator');
  assert.equal(v.timeline[1].source, 'carrier email');
  // An event with no stated source says so rather than inventing one.
  assert.equal(v.timeline[0].source, null);
  assert.equal(v.timeline[0].location, null, 'a location was inferred from a stage name');
});

test('T11: a superseded event is not shown as current', async () => {
  const client = world({
    events: [
      { id: 'e1', shipment_id: SHIPMENT, stage: 'IN_TRANSIT', event_time: '2026-09-21T08:00:00Z', created_by: 'user-operator', deleted_at: '2026-09-22T00:00:00Z', metadata: {} },
      { id: 'e2', shipment_id: SHIPMENT, stage: 'IN_TRANSIT', event_time: '2026-09-21T09:00:00Z', location: 'Beira', created_by: 'user-operator', deleted_at: null, metadata: {} },
    ],
  });
  const v = await getShipmentOperatorView(SHIPMENT, OPERATOR, opts(client));
  assert.equal(v.timeline.length, 1);
  assert.equal(v.timeline[0].location, 'Beira');
});

test('T11: the operator view never claims customs or release', async () => {
  const client = world();
  const v = await getShipmentOperatorView(SHIPMENT, OPERATOR, opts(client));
  const { note, dates, references, ...rest } = v;
  const text = JSON.stringify(rest).toLowerCase();
  for (const forbidden of ['cleared', 'duty', 'released by', 'assessment']) {
    assert.ok(!text.includes(forbidden), `the operator view says "${forbidden}"`);
  }
  assert.match(note, /customs, duties and release are recorded separately/i);
});

// ── The participant ladder ─────────────────────────────────────────────────

test('T11: LOADED is not SAILED — before a shipment exists', async () => {
  const client = world({ shipments: [] });
  const mine = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, TRACKING_STATES.LOADED);
  assert.match(mine.note, /does not mean the container has sailed/i);
  assert.deepEqual(mine.timeline, []);
});

test('T11: a shipment existing is not movement', async () => {
  const client = world();
  const mine = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, TRACKING_STATES.SHIPMENT_CREATED);
  assert.equal(mine.dates.observed_departure, null);
});

test('T11: IN_TRANSIT is derived from the OBSERVED departure, not the status enum', async () => {
  // The enum could say anything; the projection reads the observed fact.
  const client = world({ shipment: { status: 'PLANNED', departure_date: '2026-09-21T08:00:00Z' } });
  const mine = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, TRACKING_STATES.IN_TRANSIT);
});

test('T11: ARRIVED is derived from the OBSERVED arrival, never from the ETA', async () => {
  const eta = world({ shipment: { departure_date: '2026-09-21T08:00:00Z', estimated_arrival_date: '2026-09-01T00:00:00Z' } });
  const still = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(eta));
  // The ETA is in the past. That is not an arrival.
  assert.equal(still.state, TRACKING_STATES.IN_TRANSIT);

  const arrived = world({ shipment: { departure_date: '2026-09-21T08:00:00Z', actual_arrival_date: '2026-10-02T00:00:00Z' } });
  const now = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(arrived));
  assert.equal(now.state, TRACKING_STATES.ARRIVED);
});

test('T11: a CUSTOMS_HOLD shows as an exception and asserts no customs decision', async () => {
  const client = world({
    shipment: { status: 'CUSTOMS_HOLD', departure_date: '2026-09-21T08:00:00Z' },
    events: [{ id: 'e1', shipment_id: SHIPMENT, stage: 'CUSTOMS_HOLD', event_time: '2026-09-30T00:00:00Z', created_by: 'user-operator', deleted_at: null, metadata: {} }],
  });
  const mine = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, TRACKING_STATES.EXCEPTION);
  assert.equal(mine.exception.stage, 'CUSTOMS_HOLD');
  assert.match(mine.exception.note, /not a customs decision/i);
  const text = JSON.stringify(mine).toLowerCase();
  for (const forbidden of ['cleared', 'duty', 'assessed', 'released by']) {
    assert.ok(!text.includes(forbidden), `the participant view says "${forbidden}"`);
  }
});

test('T11: left-behind cargo gets the truth and no journey', async () => {
  const client = world();
  const theirs = await getMyShipmentTracking('cargo_reservation', RES_B, COLOADER, opts(client));
  assert.equal(theirs.state, TRACKING_STATES.LEFT_BEHIND);
  assert.equal(theirs.left_behind_reason, 'NO_SPACE');
  // Their goods are not on it, so none of the journey is theirs to read.
  assert.deepEqual(theirs.timeline, []);
  assert.equal(theirs.dates, null);
  assert.equal(theirs.references, null);
});

test('T11: cargo never loaded is told tracking has not begun', async () => {
  const client = world();
  await client.from('diaspora_container_load_items').delete().eq('id', 'li-a');
  const mine = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, TRACKING_STATES.NOT_LOADED);
  assert.match(mine.note, /begins once your cargo has been loaded/i);
});

// ── Privacy ────────────────────────────────────────────────────────────────

test('T11: a co-loader cannot read another participant\'s tracking', async () => {
  const client = world();
  await assert.rejects(() => getMyShipmentTracking('cargo_reservation', RES_A, COLOADER, opts(client)), /not your cargo/i);
  // POSITIVE CONTROL: they CAN read their own.
  const theirs = await getMyShipmentTracking('cargo_reservation', RES_B, COLOADER, opts(client));
  assert.ok(theirs.state);
});

test('T11: a participant cannot read the operator view', async () => {
  const client = world();
  await assert.rejects(() => getShipmentOperatorView(SHIPMENT, CUSTOMER, opts(client)), /not authorized/i);
});

test('T11: an operator of another sailing gets nothing', async () => {
  const client = world();
  await assert.rejects(() => getShipmentOperatorView(SHIPMENT, OUTSIDER, opts(client)), /not authorized/i);
});

test('T11: the participant view leaks no other cargo, operator, tenant or commercial detail', async () => {
  const client = world({ shipment: { departure_date: '2026-09-21T08:00:00Z' } });
  const mine = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(client));
  const text = JSON.stringify(mine);
  assert.ok(!text.includes(RES_B), 'another participant\'s booking appears');
  assert.ok(!text.includes('user-operator'), 'the operator is named to the participant');
  assert.ok(!text.includes('tenant-op'), 'the tenant is exposed');
  // Checked by FIELD, not substring — a bare number check would depend on the timestamps.
  for (const field of ['load', 'container_id', 'import_order_id', 'capacity']) {
    assert.ok(!(field in mine), `the participant view exposes ${field}`);
  }
});

test('T11: the participant timeline carries no operator notes', async () => {
  const client = world({
    shipment: { departure_date: '2026-09-21T08:00:00Z' },
    events: [{ id: 'e1', shipment_id: SHIPMENT, stage: 'IN_TRANSIT', event_time: '2026-09-21T08:00:00Z', location: 'Durban', notes: 'internal: chase the agent about the other consignment', created_by: 'user-operator', deleted_at: null, metadata: {} }],
  });
  const mine = await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, opts(client));
  const text = JSON.stringify(mine);
  assert.ok(!text.includes('chase the agent'), 'an internal note reached the customer');
  assert.deepEqual(Object.keys(mine.timeline[0]).sort(), ['event_time', 'location', 'stage']);
});

test('T11: the projections write nothing — proven by trap', async () => {
  const client = world({ shipment: { departure_date: '2026-09-21T08:00:00Z' } });
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
  };
  const o = { supabaseClient: trapped };
  await getShipmentOperatorView(SHIPMENT, OPERATOR, o);
  await getMyShipmentTracking('cargo_reservation', RES_A, CUSTOMER, o);
  assert.deepEqual(writes, [], 'a read-only projection wrote to the database');
});
