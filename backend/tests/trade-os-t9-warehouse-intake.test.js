/**
 * Trade OS T9.2/T9.3 — the governed warehouse intake service.
 *
 * These tests are written against the sentences the phase has to be able to say, not against the
 * shape of the code. Each of the load-bearing ones is mutation-proven: break the guard in the
 * service and a named test here goes red.
 *
 * The five that matter most:
 *
 *   1. A customer cannot mark their own cargo received.
 *   2. A receipt says who and when — and the "who" is the authenticated actor, never the body.
 *   3. The customer's estimate is never overwritten by what the warehouse measured.
 *   4. Nothing in T9 writes T5's capacity ledger.
 *   5. A discrepancy is a fact, and carries no charge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  createWarehouse,
  listWarehouses,
  scheduleIntake,
  receiveIntake,
  recordMeasurement,
  assignStorageLocation,
  getIntake,
  listIntakeQueue,
  getMyCargoIntake,
  deriveVolumeCbm,
  projectDiscrepancy,
  INTAKE_STATUSES,
} from '../services/diaspora/warehouseIntakeService.js';

const OPERATOR = { id: 'user-operator', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-wh' };
const CUSTOMER = { id: 'user-customer', platformRole: 'member' };
const COLOADER = { id: 'user-coloader', platformRole: 'member' };
const FOREIGN_OP = { id: 'user-foreign', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-other' };
const ADMIN = { id: 'user-admin', platformRole: 'platform_admin' };

/**
 * A world with one warehouse, one approved booking owned by the customer, and a co-loader's booking
 * on the same sailing — because "the same container" is where a privacy leak would actually happen.
 */
function world(overrides = {}) {
  return createMockSupabase({
    diaspora_warehouses: [
      { id: 'wh-1', tenant_id: 'tenant-wh', name: 'Durban Consolidation', country: 'South Africa', city: 'Durban', operator_user_id: 'user-operator', active: true, deleted_at: null },
      { id: 'wh-2', tenant_id: 'tenant-other', name: 'Beira Depot', country: 'Mozambique', operator_user_id: 'user-foreign', active: true, deleted_at: null },
    ],
    diaspora_cargo_reservations: [
      { id: 'res-1', tenant_id: 'tenant-wh', container_id: 'cont-1', import_order_id: 'ord-1', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 3.0, estimated_weight: 800, reservation_status: 'APPROVED', deleted_at: null },
      { id: 'res-2', tenant_id: 'tenant-wh', container_id: 'cont-1', import_order_id: 'ord-2', buyer_id: 'user-coloader', created_by: 'user-coloader', cargo_type: 'boxes', estimated_volume: 1.5, estimated_weight: 200, reservation_status: 'APPROVED', deleted_at: null },
      { id: 'res-pending', tenant_id: 'tenant-wh', container_id: 'cont-1', import_order_id: 'ord-3', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 2.0, reservation_status: 'REQUESTED', deleted_at: null },
      ...(overrides.reservations || []),
    ],
    diaspora_container_shipments: [
      { id: 'cont-1', tenant_id: 'tenant-wh', total_capacity_volume: 33, used_capacity_volume: 4.5, available_capacity_volume: 28.5, deleted_at: null },
    ],
    diaspora_logistics_requests: [
      { id: 'req-1', tenant_id: 'tenant-wh', requester_id: 'user-customer', created_by: 'user-customer', origin_country: 'UK', destination_country: 'Zimbabwe', status: 'AWARDED', deleted_at: null },
      { id: 'req-draft', tenant_id: 'tenant-wh', requester_id: 'user-customer', created_by: 'user-customer', origin_country: 'UK', destination_country: 'Zimbabwe', status: 'OPEN_FOR_QUOTES', deleted_at: null },
    ],
    diaspora_logistics_request_items: [
      { id: 'item-1', logistics_request_id: 'req-1', line_number: 1, cargo_category: 'boxes', description: 'Kitchen boxes', quantity: 4, estimated_volume_cbm: 2.0, estimated_weight_kg: 150, measurement_basis: 'PROVIDED', deleted_at: null },
      { id: 'item-2', logistics_request_id: 'req-1', line_number: 2, cargo_category: 'furniture_appliances', description: 'Sofa', quantity: 1, estimated_volume_cbm: 1.0, estimated_weight_kg: 60, measurement_basis: 'PROVIDED', deleted_at: null },
      ...(overrides.items || []),
    ],
    diaspora_warehouse_intakes: overrides.intakes || [],
    diaspora_warehouse_measurements: overrides.measurements || [],
    diaspora_import_audit_log: [],
  });
}

const opts = (client) => ({ supabaseClient: client });

async function bookedIn(client, subjectId = 'res-1', subjectType = 'cargo_reservation') {
  return scheduleIntake({ warehouseId: 'wh-1', subjectType, subjectId }, OPERATOR, opts(client));
}

// ── 1. Receiving is somebody else's act ────────────────────────────────────

test('T9: a customer cannot mark their OWN cargo as received', async () => {
  const client = world();
  const intake = await bookedIn(client);
  // The customer is given every role short of platform admin and still cannot do it, because the
  // refusal is about whose cargo it is, not about how senior they are.
  await assert.rejects(
    () => receiveIntake(intake.id, { outcome: 'RECEIVED' }, { ...CUSTOMER, tenantRole: 'admin', tenantId: 'tenant-wh' }, opts(client)),
    /cannot record your own cargo as received/i,
  );
  const { data } = await client.from('diaspora_warehouse_intakes').select('*').eq('id', intake.id).maybeSingle();
  assert.equal(data.status, INTAKE_STATUSES.EXPECTED);
  assert.ok(!data.received_by, 'no receiver was recorded');
});

test('T9: a platform admin who owns the cargo is refused too — seniority is not the question', async () => {
  const client = world({
    reservations: [{ id: 'res-admin', tenant_id: 'tenant-wh', container_id: 'cont-1', import_order_id: 'ord-9', buyer_id: 'user-admin', created_by: 'user-admin', cargo_type: 'parts', estimated_volume: 1, reservation_status: 'APPROVED', deleted_at: null }],
  });
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-admin' }, ADMIN, opts(client));
  await assert.rejects(() => receiveIntake(intake.id, {}, ADMIN, opts(client)), /cannot record your own cargo/i);
});

test('T9: an operator at another warehouse cannot receive this cargo', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await assert.rejects(() => receiveIntake(intake.id, {}, FOREIGN_OP, opts(client)), /not authorized to receive/i);
});

test('T9: the authorized receiver succeeds — the positive control', async () => {
  const client = world();
  const intake = await bookedIn(client);
  const received = await receiveIntake(intake.id, { outcome: 'RECEIVED', condition: 'good', observedPackageCount: 4 }, OPERATOR, opts(client));
  assert.equal(received.status, INTAKE_STATUSES.RECEIVED);
  assert.equal(received.received_by, 'user-operator');
  assert.ok(received.received_at, 'a receipt has a time');
  assert.equal(received.observed_package_count, 4);
});

// ── 2. Attribution comes from the session, not the body ────────────────────

test('T9: a forged received_by in the body is ignored', async () => {
  const client = world();
  const intake = await bookedIn(client);
  const received = await receiveIntake(intake.id, {
    received_by: 'user-customer', receivedBy: 'user-customer', created_by: 'user-customer',
  }, OPERATOR, opts(client));
  assert.equal(received.received_by, 'user-operator', 'the receiver is whoever was authenticated');
});

test('T9: cargo cannot be received at a time in the future', async () => {
  const client = world();
  const intake = await bookedIn(client);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  await assert.rejects(() => receiveIntake(intake.id, { receivedAt: tomorrow }, OPERATOR, opts(client)), /future/i);
});

test('T9: a receiver may state when it actually arrived, and the row says which that was', async () => {
  const client = world();
  const intake = await bookedIn(client);
  const earlier = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const received = await receiveIntake(intake.id, { receivedAt: earlier }, OPERATOR, opts(client));
  assert.equal(received.received_at, earlier);
  assert.equal(received.metadata.received_at_source, 'stated_by_receiver');

  const client2 = world();
  const i2 = await bookedIn(client2);
  const r2 = await receiveIntake(i2.id, {}, OPERATOR, opts(client2));
  assert.equal(r2.metadata.received_at_source, 'server_clock');
});

// ── 3. An appointment is not a receipt ─────────────────────────────────────

test('T9: booking cargo in sets no receiver and no arrival time', async () => {
  const client = world();
  const intake = await bookedIn(client);
  assert.equal(intake.status, INTAKE_STATUSES.EXPECTED);
  assert.ok(!intake.received_at, 'no arrival time');
  assert.ok(!intake.received_by, 'no receiver');
});

test('T9: an APPROVED booking is not received cargo', async () => {
  const client = world();
  const view = await getMyCargoIntake('cargo_reservation', 'res-1', CUSTOMER, opts(client));
  assert.equal(view.intake, null);
  assert.match(view.status_sentence, /no warehouse has booked this cargo in/i);
});

test('T9: two consignments whose subject ids share a prefix get DIFFERENT references', async () => {
  // Found on the deployed queue at 393px: four rows all read "WHIN-99994444". The reference was the
  // subject id's first eight hex characters, and the receive confirmation asked the operator to type
  // exactly that string — so a check meant to prevent receiving the wrong consignment could not tell
  // two consignments apart. A disambiguator that does not disambiguate is worse than none, because
  // it looks like a check.
  const client = world({
    reservations: [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', tenant_id: 'tenant-wh', container_id: 'cont-1', import_order_id: 'ord-a', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 1, reservation_status: 'APPROVED', deleted_at: null },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', tenant_id: 'tenant-wh', container_id: 'cont-1', import_order_id: 'ord-b', buyer_id: 'user-customer', created_by: 'user-customer', cargo_type: 'parts', estimated_volume: 1, reservation_status: 'APPROVED', deleted_at: null },
    ],
  });
  const first = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'aaaaaaaa-0000-0000-0000-000000000001' }, OPERATOR, opts(client));
  const second = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'aaaaaaaa-0000-0000-0000-000000000002' }, OPERATOR, opts(client));
  assert.notEqual(first.reference, second.reference, 'two consignments present the same reference to the operator');
  assert.match(first.reference, /^WHIN-[0-9A-F]{8}$/);
});

test('T9: a replay still returns the SAME intake, reference included', async () => {
  // The unique reference must not cost idempotency: the one-live-intake index keys on the subject,
  // so a repeated appointment hands back the winner rather than minting a new reference.
  const client = world();
  const first = await bookedIn(client);
  const again = await bookedIn(client);
  assert.equal(again.id, first.id);
  assert.equal(again.reference, first.reference);
});

test('T9: an un-approved booking cannot be booked in at all', async () => {
  const client = world();
  await assert.rejects(
    () => scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-pending' }, OPERATOR, opts(client)),
    /not approved/i,
  );
});

test('T9: a shipping request nobody has awarded cannot be booked in', async () => {
  const client = world();
  await assert.rejects(
    () => scheduleIntake({ warehouseId: 'wh-1', subjectType: 'logistics_request', subjectId: 'req-draft' }, OPERATOR, opts(client)),
    /offer has been accepted/i,
  );
});

test('T9: an arbitrary UUID does not become physical cargo', async () => {
  const client = world();
  await assert.rejects(
    () => scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: '11111111-2222-3333-4444-555555555555' }, OPERATOR, opts(client)),
    /does not exist/i,
  );
});

// ── 4. Outcomes must be truthful ───────────────────────────────────────────

test('T9: a refusal must say why', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await assert.rejects(() => receiveIntake(intake.id, { outcome: 'REFUSED' }, OPERATOR, opts(client)), /say why/i);
});

test('T9: a refusal preserves the reason, the actor, the time and the booking', async () => {
  const client = world();
  const intake = await bookedIn(client);
  const refused = await receiveIntake(intake.id, { outcome: 'REFUSED', outcomeReason: 'Crate was open and contents were loose' }, OPERATOR, opts(client));
  assert.equal(refused.status, 'REFUSED');
  assert.equal(refused.outcome_reason, 'Crate was open and contents were loose');
  assert.equal(refused.received_by, 'user-operator');
  assert.ok(refused.received_at);
  const { data: booking } = await client.from('diaspora_cargo_reservations').select('*').eq('id', 'res-1').maybeSingle();
  assert.ok(booking, 'the booking still exists after a physical refusal');
  assert.equal(booking.reservation_status, 'APPROVED', 'and its state is untouched');
});

test('T9: a condition outside the vocabulary is refused', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await assert.rejects(() => receiveIntake(intake.id, { condition: 'looks_a_bit_rough' }, OPERATOR, opts(client)), /not one of the conditions/i);
});

test('T9: LOADED cannot be smuggled in as an intake outcome', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await assert.rejects(() => receiveIntake(intake.id, { outcome: 'LOADED' }, OPERATOR, opts(client)), /must be received, conditionally received, or refused/i);
});

// ── 5. Measurement ─────────────────────────────────────────────────────────

test('T9: volume is derived from the measured dimensions', () => {
  assert.equal(deriveVolumeCbm({ length_value: 200, width_value: 100, height_value: 190, dimension_unit: 'cm' }), 3.8);
  assert.equal(deriveVolumeCbm({ length_value: 2, width_value: 1, height_value: 1.9, dimension_unit: 'm' }), 3.8);
  assert.equal(deriveVolumeCbm({ length_value: null, width_value: null, height_value: null, dimension_unit: null }), null);
});

test('T9: a client-supplied volume is never stored', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const { measurement } = await recordMeasurement(intake.id, {
    lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm',
    actualVolumeCbm: 0.1, actual_volume_cbm: 0.1,
  }, OPERATOR, opts(client));
  assert.equal(Number(measurement.actual_volume_cbm), 3.8, 'the server derived it; the claim was discarded');
});

test('T9: a stated volume with no dimensions behind it is refused, not stored', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await assert.rejects(
    () => recordMeasurement(intake.id, { actualVolumeCbm: 3.8, packageCount: 4 }, OPERATOR, opts(client)),
    /worked out from the measured dimensions/i,
  );
});

test('T9: two of three sides is not a box', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await assert.rejects(
    () => recordMeasurement(intake.id, { lengthValue: 200, widthValue: 100, dimensionUnit: 'cm' }, OPERATOR, opts(client)),
    /all three of length, width and height/i,
  );
});

test('T9: a weight without its unit is refused', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await assert.rejects(() => recordMeasurement(intake.id, { weightValue: 900 }, OPERATOR, opts(client)), /kilograms or tonnes/i);
});

test('T9: cargo that has not arrived cannot be measured', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await assert.rejects(
    () => recordMeasurement(intake.id, { lengthValue: 2, widthValue: 1, heightValue: 1.9, dimensionUnit: 'm' }, OPERATOR, opts(client)),
    /has to be received before it can be measured/i,
  );
});

test('T9: package count does not multiply the measured volume', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const { measurement } = await recordMeasurement(intake.id, {
    lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm', packageCount: 5,
  }, OPERATOR, opts(client));
  assert.equal(Number(measurement.actual_volume_cbm), 3.8, 'the stack was measured once, not five times');
});

test('T9: a correction is a new observation and the earlier one survives', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await recordMeasurement(intake.id, { lengthValue: 200, widthValue: 100, heightValue: 100, dimensionUnit: 'cm' }, OPERATOR, opts(client));
  await new Promise((r) => setTimeout(r, 5));
  await recordMeasurement(intake.id, { lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm' }, OPERATOR, opts(client));
  const { data: rows } = await client.from('diaspora_warehouse_measurements').select('*').eq('intake_id', intake.id);
  assert.equal(rows.length, 2, 'both observations are on the record');
  const view = await getIntake(intake.id, OPERATOR, opts(client));
  assert.equal(view.actual.volume_cbm, 3.8, 'the latest is authoritative');
  assert.equal(view.earlier_measurements, 1, 'and the earlier one is visibly still there');
});

// ── 6. ESTIMATED ≠ ACTUAL ──────────────────────────────────────────────────

test('T9: the estimate survives the measurement, and the difference is derivable', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const { estimate, discrepancy } = await recordMeasurement(intake.id, {
    lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm',
  }, OPERATOR, opts(client));

  assert.equal(estimate.volume_cbm, 3.0, 'the customer still said 3.0');
  assert.equal(discrepancy.volume.actual_cbm, 3.8);
  assert.equal(discrepancy.volume.difference_cbm, 0.8);
  assert.equal(discrepancy.volume.direction, 'LARGER');

  const { data: booking } = await client.from('diaspora_cargo_reservations').select('*').eq('id', 'res-1').maybeSingle();
  assert.equal(Number(booking.estimated_volume), 3.0, 'THE ESTIMATE IS UNTOUCHED');
});

test('T9: an actual SMALLER than the estimate is recorded just as plainly', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const { discrepancy } = await recordMeasurement(intake.id, { lengthValue: 100, widthValue: 100, heightValue: 200, dimensionUnit: 'cm' }, OPERATOR, opts(client));
  assert.equal(discrepancy.volume.actual_cbm, 2);
  assert.equal(discrepancy.volume.difference_cbm, -1);
  assert.equal(discrepancy.volume.direction, 'SMALLER');
});

test('T9: an actual EQUAL to the estimate says so rather than saying nothing', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const { discrepancy } = await recordMeasurement(intake.id, { lengthValue: 150, widthValue: 100, heightValue: 200, dimensionUnit: 'cm' }, OPERATOR, opts(client));
  assert.equal(discrepancy.volume.difference_cbm, 0);
  assert.equal(discrepancy.status, 'MATCHES');
});

test('T9: a weight discrepancy is reported in one unit without rewriting the receiver\'s', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const { measurement, discrepancy } = await recordMeasurement(intake.id, { weightValue: 1.1, weightUnit: 't' }, OPERATOR, opts(client));
  assert.equal(measurement.weight_unit, 't', 'the row keeps what the receiver actually wrote');
  assert.equal(discrepancy.weight.estimated_kg, 800);
  assert.equal(discrepancy.weight.actual_kg, 1100);
  assert.equal(discrepancy.weight.difference_kg, 300);
});

test('T9: a MISSING estimate is not treated as zero', async () => {
  const client = world({
    items: [{ id: 'item-3', logistics_request_id: 'req-1', line_number: 3, cargo_category: 'other', description: 'Unmeasured crate', quantity: 1, estimated_volume_cbm: null, estimated_weight_kg: null, measurement_basis: 'UNKNOWN', deleted_at: null }],
  });
  const intake = await bookedIn(client, 'req-1', 'logistics_request');
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const { estimate, discrepancy } = await recordMeasurement(intake.id, { lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm' }, OPERATOR, opts(client));
  assert.equal(estimate.completeness, 'PARTIAL');
  assert.equal(estimate.items_with_volume, 2);
  assert.equal(estimate.items_total, 3);
  assert.equal(discrepancy.status, 'NOT_COMPARABLE');
  assert.match(discrepancy.reason, /2 of 3 cargo items/);
  assert.equal(discrepancy.volume, null, 'no difference is asserted against an incomplete estimate');
});

test('T9: a MISSING actual leaves the discrepancy unmeasured rather than zero', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const view = await getIntake(intake.id, OPERATOR, opts(client));
  assert.equal(view.actual, null);
  assert.equal(view.discrepancy.status, 'NOT_MEASURED');
});

// ── 7. A discrepancy is a fact, not a commercial decision ──────────────────

test('T9: nothing in the discrepancy carries a charge, a rate or an adjustment', () => {
  const d = projectDiscrepancy(
    { volume_cbm: 3.0, weight_kg: 800, completeness: 'COMPLETE', items_total: 1, items_with_volume: 1 },
    { actual_volume_cbm: 3.8, weight_value: 900, weight_unit: 'kg' },
  );
  assert.equal(d.commercial_effect, 'none');
  // The prose disclaimer is allowed to SAY "this does not change the price" — that is the sentence
  // doing the work. What must not exist is a money FIELD, so the check is on everything but the note.
  const { note, ...data } = d;
  assert.match(note, /does not by itself change the price/i);
  const serialized = JSON.stringify(data).toLowerCase();
  for (const forbidden of ['amount', 'charge', 'surcharge', 'price', 'currency', 'usd', 'invoice', 'fee', 'total']) {
    assert.ok(!serialized.includes(forbidden), `a discrepancy must not carry a "${forbidden}" field`);
  }
});

// ── 8. The T5 capacity firewall ────────────────────────────────────────────

test('T9: measuring cargo larger than booked does not touch the T5 capacity ledger', async () => {
  const client = world();
  const before = (await client.from('diaspora_container_shipments').select('*').eq('id', 'cont-1').maybeSingle()).data;
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await recordMeasurement(intake.id, { lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm' }, OPERATOR, opts(client));
  const after = (await client.from('diaspora_container_shipments').select('*').eq('id', 'cont-1').maybeSingle()).data;
  assert.deepEqual(
    { used: Number(after.used_capacity_volume), available: Number(after.available_capacity_volume), total: Number(after.total_capacity_volume) },
    { used: Number(before.used_capacity_volume), available: Number(before.available_capacity_volume), total: Number(before.total_capacity_volume) },
    'T9 records a discrepancy; it does not rewrite the ledger',
  );
});

test('T9: no T9 action writes a reservation, a container or a request item — proven by trap', async () => {
  const client = world();
  const forbidden = new Set(['diaspora_cargo_reservations', 'diaspora_container_shipments', 'diaspora_logistics_requests', 'diaspora_logistics_request_items']);
  const writes = [];
  const trapped = {
    ...client,
    from(table) {
      const chain = client.from(table);
      return new Proxy(chain, {
        get(target, prop) {
          if ((prop === 'insert' || prop === 'update' || prop === 'delete' || prop === 'upsert') && forbidden.has(table)) {
            writes.push(`${prop} ${table}`);
          }
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  const o = { supabaseClient: trapped };
  const intake = await scheduleIntake({ warehouseId: 'wh-1', subjectType: 'cargo_reservation', subjectId: 'res-1' }, OPERATOR, o);
  await receiveIntake(intake.id, { condition: 'minor_damage', outcomeReason: 'Corner dented', outcome: 'CONDITIONALLY_RECEIVED' }, OPERATOR, o);
  await recordMeasurement(intake.id, { lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm' }, OPERATOR, o);
  await assignStorageLocation(intake.id, 'Bay 4', OPERATOR, o);
  assert.deepEqual(writes, [], 'T9 wrote nothing into another phase\'s authority');
});

// ── 9. Storage location ────────────────────────────────────────────────────

test('T9: an unassigned storage location stays unknown', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const view = await getIntake(intake.id, OPERATOR, opts(client));
  assert.equal(view.storage_location, null, 'no Bay A, no Rack 1, no Zone X');
});

test('T9: a storage location appears only when somebody assigns one', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await assignStorageLocation(intake.id, 'Bay 4, rack C', OPERATOR, opts(client));
  const view = await getIntake(intake.id, OPERATOR, opts(client));
  assert.equal(view.storage_location, 'Bay 4, rack C');
});

test('T9: cargo the warehouse does not hold cannot be given a location', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await assert.rejects(() => assignStorageLocation(intake.id, 'Bay 4', OPERATOR, opts(client)), /actually holding/i);
});

// ── 10. Replay and concurrency ─────────────────────────────────────────────

test('T9: booking the same cargo in twice yields ONE intake', async () => {
  const client = world();
  const first = await bookedIn(client);
  const second = await bookedIn(client);
  assert.equal(second.id, first.id);
  assert.equal(second.already_existed, true);
  const { data } = await client.from('diaspora_warehouse_intakes').select('*').eq('subject_id', 'res-1');
  assert.equal(data.length, 1);
});

test('T9: concurrent book-in attempts still yield ONE intake', async () => {
  const client = world();
  const results = await Promise.all([bookedIn(client), bookedIn(client), bookedIn(client)]);
  const ids = new Set(results.map((r) => r.id));
  assert.equal(ids.size, 1, 'the losers were handed the winner');
  const { data } = await client.from('diaspora_warehouse_intakes').select('*').eq('subject_id', 'res-1');
  assert.equal(data.length, 1);
});

test('T9: receiving the same cargo twice does not receive it twice', async () => {
  const client = world();
  const intake = await bookedIn(client);
  const first = await receiveIntake(intake.id, { observedPackageCount: 4 }, OPERATOR, opts(client));
  const second = await receiveIntake(intake.id, { observedPackageCount: 99 }, OPERATOR, opts(client));
  assert.equal(second.already_received, true);
  assert.equal(second.received_at, first.received_at, 'the arrival time did not move');
  assert.equal(Number(second.observed_package_count), 4, 'and the replay changed nothing');
});

test('T9: a replayed receive writes no second arrival into the audit trail', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const { data: audit } = await client.from('diaspora_import_audit_log').select('*').eq('resource_id', intake.id);
  const receipts = (audit || []).filter((a) => String(a.action).startsWith('WAREHOUSE_INTAKE_RECEIVED'));
  // Three requests, one arrival. An audit trail that says the goods turned up three times is a
  // record of something that did not happen — and it is what a downstream reader would believe.
  assert.equal(receipts.length, 1, 'one physical receipt leaves exactly one audit entry');
});

// ── 11. Privacy ────────────────────────────────────────────────────────────

test('T9: a co-loader on the same sailing cannot read another participant\'s cargo', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await assert.rejects(() => getMyCargoIntake('cargo_reservation', 'res-1', COLOADER, opts(client)), /not your cargo/i);
  await assert.rejects(() => getIntake(intake.id, COLOADER, opts(client)), /not authorized to receive/i);
});

test('T9: the customer CAN read their own cargo — the positive control', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  const view = await getMyCargoIntake('cargo_reservation', 'res-1', CUSTOMER, opts(client));
  assert.equal(view.intake.status, INTAKE_STATUSES.RECEIVED);
  assert.match(view.status_sentence, /warehouse has your cargo/i);
});

test('T9: the customer view carries no warehouse staff identity or internal note', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, { notes: 'Forklift driver Jonas signed for it' }, OPERATOR, opts(client));
  await recordMeasurement(intake.id, { lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm', notes: 'internal: recheck scale' }, OPERATOR, opts(client));
  const view = await getMyCargoIntake('cargo_reservation', 'res-1', CUSTOMER, opts(client));
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('user-operator'), 'no staff identity');
  assert.ok(!serialized.includes('Jonas'), 'no internal note');
  assert.ok(!serialized.includes('recheck scale'), 'no measurement note');
  assert.ok(!serialized.includes('tenant-wh'), 'no tenant identifier');
});

test('T9: the operator queue never contains a foreign warehouse\'s cargo', async () => {
  const client = world();
  await bookedIn(client);
  const queue = await listIntakeQueue({}, FOREIGN_OP, opts(client));
  assert.equal(queue.intakes.length, 0);
  assert.deepEqual(queue.warehouses.map((w) => w.id), ['wh-2']);
});

test('T9: a customer\'s intake queue is empty — they do not receive cargo', async () => {
  const client = world();
  await bookedIn(client);
  const queue = await listIntakeQueue({}, CUSTOMER, opts(client));
  assert.deepEqual(queue, { warehouses: [], intakes: [] });
});

test('T9: a forged warehouseId in the queue filter cannot widen the scope', async () => {
  const client = world();
  await bookedIn(client);
  const queue = await listIntakeQueue({ warehouseId: 'wh-1' }, FOREIGN_OP, opts(client));
  assert.equal(queue.intakes.length, 0, 'naming a warehouse you have no authority at grants nothing');
});

test('T9: a tenant admin cannot register a warehouse for another tenant', async () => {
  const client = world();
  // The body's claim has nowhere to land: the tenant and the operator are both DERIVED from the
  // authenticated session, so a forged tenantId produces a warehouse for the caller's own tenant
  // rather than an error. Naming somebody else's tenant grants nothing.
  const forged = await createWarehouse({ name: 'Ghost depot', country: 'Zimbabwe', tenantId: 'tenant-other', operatorUserId: 'user-customer' }, OPERATOR, opts(client));
  assert.equal(forged.tenant_id, 'tenant-wh', 'the forged tenant was discarded');
  assert.equal(forged.operator_user_id, 'user-operator', 'the forged operator was discarded');
  // And the forged warehouse grants its caller nothing over the other tenant's cargo.
  assert.equal((await listWarehouses(FOREIGN_OP, opts(client))).some((w) => w.id === forged.id), false);

  // A caller with no tenant role at all cannot register one.
  await assert.rejects(
    () => createWarehouse({ name: 'Nowhere depot', country: 'Zimbabwe' }, CUSTOMER, opts(client)),
    /not authorized to register/i,
  );
});

test('T9: a warehouse list shows only what the caller may receive at', async () => {
  const client = world();
  assert.deepEqual((await listWarehouses(OPERATOR, opts(client))).map((w) => w.id), ['wh-1']);
  assert.deepEqual((await listWarehouses(CUSTOMER, opts(client))).map((w) => w.id), []);
  assert.equal((await listWarehouses(ADMIN, opts(client))).length, 2);
});

// ── 12. Truthful absence ───────────────────────────────────────────────────

test('T9: a customer whose booking is not yet approved is told why, not shown a queue position', async () => {
  const client = world();
  const view = await getMyCargoIntake('cargo_reservation', 'res-pending', CUSTOMER, opts(client));
  assert.equal(view.intake, null);
  assert.equal(view.eligible_for_intake, false);
  assert.match(view.eligibility_note, /not approved/i);
});

test('T9: the projection never speaks a later phase\'s language', async () => {
  const client = world();
  const intake = await bookedIn(client);
  await receiveIntake(intake.id, {}, OPERATOR, opts(client));
  await recordMeasurement(intake.id, { lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm' }, OPERATOR, opts(client));
  const serialized = JSON.stringify(await getMyCargoIntake('cargo_reservation', 'res-1', CUSTOMER, opts(client))).toLowerCase();
  for (const later of ['ready to load', 'loaded', 'shipped', 'departed', 'customs', 'in transit', 'delivered']) {
    assert.ok(!serialized.includes(later), `T9 must not say "${later}"`);
  }
});
