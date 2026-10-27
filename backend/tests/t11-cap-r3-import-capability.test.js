/**
 * T11-CAP-LR01-R3 — does this vehicle have an import journey the viewer may open? (Moderator §18–§19)
 *
 * The Vehicle Passport and My Garage show a CAP action only for a vehicle that really has one. The answer is
 * one of four, and the difference between two of them is the point of this file:
 *
 *   none         no readable import order. An order that EXISTS but is not the viewer's is indistinguishable
 *                from no order at all — no count, no id, no hint.
 *   single       exactly one readable order (`order_id`)
 *   multiple     several readable orders (`count`), never a pick
 *   unavailable  the read FAILED. Never "none".
 *
 * Held here:
 *   1. the four answers, and the shape of each (no extra key can leak an id or a count);
 *   2. an unreadable order changes nothing the viewer can see;
 *   3. the capability and `getJourney('vehicle', …)` AGREE for every vehicle and viewer in a matrix — one
 *      interpretation of import ownership, not two;
 *   4. a failed read is `unavailable` — and `getJourney('vehicle', …)` now throws on a failed read instead of
 *      claiming "no journey";
 *   5. it is bounded (two reads however many vehicles), chunked, and writes nothing.
 *
 * Fixtures are synthetic structural cases, not UAT evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  getJourney,
  getVehicleImportCapability,
  getVehiclesImportCapabilities,
  selectReadableOrders,
  JOURNEY_STATES,
} from '../services/diaspora/journeyProjectionService.js';
import { DatabaseError, ForbiddenError } from '../utils/errors.js';

const OWNER = { id: 'u-owner', platformRole: 'member' };
const STRANGER = { id: 'u-stranger', platformRole: 'member' };
const ASSIGNED = { id: 'u-assigned', platformRole: 'member' };
const ADMIN = { id: 'u-platform-admin', platformRole: 'platform_admin' };
// `admin` is a platform ADMIN but not in the platform REVIEWER set, so canReadImportOrder alone would refuse it:
// it is the privilege branch of the shared rule that opens every linked order to it. Both are exercised.
const PLAIN_ADMIN = { id: 'u-plain-admin', platformRole: 'admin' };
const REVIEWER = { id: 'u-reviewer', platformRole: 'reviewer' };
const VIEWERS = { OWNER, ASSIGNED, STRANGER, ADMIN, PLAIN_ADMIN, REVIEWER };

const opts = (client) => ({ supabaseClient: client });

const V_NONE = 'VINNONE-AAAA-001';     // owner · no order
const V_ONE = 'VINONE-BBBB-002';       // owner · one order
const V_TWO = 'VINTWO-CCCC-003';       // owner · two orders
const V_GONE = 'VINGONE-DDDD-004';     // owner · one order, soft-deleted
const V_THEIRS = 'VINTHEIRS-EEEE-005'; // owner's vehicle · the only order is the stranger's
const V_MIXED = 'VINMIXED-FFFF-006';   // owner's vehicle · one order of the owner's, one of the stranger's
const V_PART = 'VINPART-GGGG-007';     // owner · one order with an assigned participant
const V_FOREIGN = 'VINFOREIGN-HHHH-008'; // the stranger's vehicle and order

const vehicle = (vin, over = {}) => ({
  vin, make: 'MakeOf', model: `ModelOf-${vin}`, year: 2016, color: 'Pearl', mileage: 1000,
  chassis_number: `CH-${vin}`, engine_number: `EN-${vin}`, owner_id: 'u-owner', current_seller_id: null,
  publication_status: 'draft', status: 'Available', import_source: 'import', ...over,
});
const order = (id, vin, buyer, over = {}) => ({
  id, tenant_id: null, buyer_id: buyer, created_by: buyer, linked_vehicle_vin: vin, status: 'IMPORT_REQUESTED',
  origin_country: 'Origin', destination_country: 'Dest', deleted_at: null, created_at: '2026-10-01T00:00:00Z', ...over,
});

function world(over = {}) {
  return createMockSupabase({
    vehicles: over.vehicles || [
      vehicle(V_NONE), vehicle(V_ONE), vehicle(V_TWO), vehicle(V_GONE), vehicle(V_THEIRS), vehicle(V_MIXED), vehicle(V_PART),
      vehicle(V_FOREIGN, { owner_id: 'u-stranger' }),
    ],
    diaspora_import_orders: over.orders || [
      order('ord-one', V_ONE, 'u-owner'),
      order('ord-two-a', V_TWO, 'u-owner', { created_at: '2026-09-01T00:00:00Z' }),
      order('ord-two-b', V_TWO, 'u-owner', { created_at: '2026-10-01T00:00:00Z' }),
      order('ord-gone', V_GONE, 'u-owner', { deleted_at: '2026-10-02T00:00:00Z' }),
      order('ord-theirs', V_THEIRS, 'u-stranger'),
      order('ord-mix-mine', V_MIXED, 'u-owner'),
      order('ord-mix-theirs', V_MIXED, 'u-stranger'),
      order('ord-part', V_PART, 'u-owner'),
      order('ord-foreign', V_FOREIGN, 'u-stranger'),
    ],
    diaspora_import_order_participants: over.participants || [
      { id: 'p1', import_order_id: 'ord-part', user_id: 'u-assigned', verification_status: 'active', deleted_at: null },
    ],
    diaspora_container_shipments: [], diaspora_cargo_reservations: [], diaspora_container_loads: [], diaspora_container_load_items: [],
    diaspora_shipments: [], diaspora_shipment_stage_events: [], diaspora_shipment_legs: [], diaspora_shipment_observations: [],
    trade_document_types: [], diaspora_trade_documents: [], diaspora_trade_document_readiness: [],
    diaspora_customs_cases: [], diaspora_customs_events: [], diaspora_customs_agent_appointments: [], diaspora_import_quotes: [],
  });
}

const rowOf = (w, vin) => w._rows('vehicles').find((row) => row.vin === vin);
const capability = (w, vin, who) => getVehicleImportCapability(rowOf(w, vin), who, opts(w));

/** A client that counts every table read. */
function counting(client) {
  const reads = [];
  return { reads, from(table) { reads.push(table); return client.from(table); }, _rows: client._rows, _tables: client._tables };
}
/** A client whose reads of one table fail the way supabase-js reports a failure, or throw. */
function failing(client, table, mode = 'error') {
  const dead = () => {
    const b = {
      select: () => b, eq: () => b, in: () => b, is: () => b, order: () => b, limit: () => b,
      then(resolve, reject) {
        if (mode === 'throw') return (reject ? reject(new Error('boom')) : Promise.reject(new Error('boom')));
        return Promise.resolve({ data: null, error: { message: 'boom', code: '57014' } }).then(resolve, reject);
      },
    };
    return b;
  };
  return { from: (t) => (t === table ? dead() : client.from(t)), _rows: client._rows };
}

// ── 1. The four answers and their shapes ────────────────────────────────────────────────

test('R3-I1: no readable order -> none, and the answer carries no id and no count', async () => {
  const w = world();
  assert.deepEqual(await capability(w, V_NONE, OWNER), { state: 'none' });
});

test('R3-I2: exactly one readable order -> single, naming that order and nothing else', async () => {
  const w = world();
  assert.deepEqual(await capability(w, V_ONE, OWNER), { state: 'single', order_id: 'ord-one' });
});

test('R3-I3: several readable orders -> multiple with a count — never a pick, never an id', async () => {
  const w = world();
  const cap = await capability(w, V_TWO, OWNER);
  assert.deepEqual(cap, { state: 'multiple', count: 2 });
  assert.equal(JSON.stringify(cap).includes('ord-two'), false, 'a multiple answer named an order');
});

test('R3-I4: a soft-deleted order is not an order', async () => {
  assert.deepEqual(await capability(world(), V_GONE, OWNER), { state: 'none' });
});

// ── 2. An unreadable order changes nothing the viewer can see ─────────────────────────────

test('R3-I5: an order that exists but is not the viewer\'s is INDISTINGUISHABLE from no order', async () => {
  const w = world();
  const withHiddenOrder = await capability(w, V_THEIRS, OWNER);
  const withNoOrder = await capability(w, V_NONE, OWNER);
  assert.deepEqual(withHiddenOrder, withNoOrder);
  assert.deepEqual(withHiddenOrder, { state: 'none' });
});

test('R3-I6: a vehicle with a readable order AND an unreadable one counts only the readable one', async () => {
  const w = world();
  assert.deepEqual(await capability(w, V_MIXED, OWNER), { state: 'single', order_id: 'ord-mix-mine' });
  // Same answer a viewer who owns no order would get is `none` — the stranger's order never leaks to the owner or vice versa.
  assert.deepEqual(await capability(w, V_MIXED, STRANGER), { state: 'single', order_id: 'ord-mix-theirs' });
});

test('R3-I7: an assigned participant can read the order, so CAP is available to them though they do not own the vehicle', async () => {
  const w = world();
  assert.deepEqual(await capability(w, V_PART, ASSIGNED), { state: 'single', order_id: 'ord-part' });
});

test('R3-I7b: a participant who has been removed (soft-deleted) no longer opens the order', async () => {
  const w = world({
    participants: [{ id: 'p1', import_order_id: 'ord-part', user_id: 'u-assigned', verification_status: 'active', deleted_at: '2026-10-02T00:00:00Z' }],
  });
  assert.deepEqual(await capability(w, V_PART, ASSIGNED), { state: 'none' });
  // …and the participant who is still there does.
  const live = world();
  assert.deepEqual(await capability(live, V_PART, ASSIGNED), { state: 'single', order_id: 'ord-part' });
});

test('R3-I7c: both reads exclude removed rows at the QUERY, not only in the readability rule (second line of defence)', async () => {
  const w = world();
  const isCalls = [];
  const spy = {
    _rows: w._rows,
    from(table) {
      const builder = w.from(table);
      const original = builder.is.bind(builder);
      builder.is = (column, value) => { isCalls.push([table, column, value]); return original(column, value); };
      return builder;
    },
  };
  await getVehiclesImportCapabilities([rowOf(w, V_PART)], OWNER, opts(spy));
  assert.ok(isCalls.some(([table, column, value]) => table === 'diaspora_import_orders' && column === 'deleted_at' && value === null), 'orders read did not exclude removed rows');
  assert.ok(isCalls.some(([table, column, value]) => table === 'diaspora_import_order_participants' && column === 'deleted_at' && value === null), 'participants read did not exclude removed rows');
});

test('R3-I8: a viewer with no standing and no readable order is answered `none`, not an error and not a hint', async () => {
  const w = world();
  assert.deepEqual(await capability(w, V_ONE, STRANGER), { state: 'none' });
  assert.deepEqual(await capability(w, V_FOREIGN, OWNER), { state: 'none' });
});

test('R3-I9: a platform admin or reviewer reads every linked order — whichever platform role names them', async () => {
  const w = world();
  for (const [name, who] of Object.entries({ ADMIN, PLAIN_ADMIN, REVIEWER })) {
    assert.deepEqual(await capability(w, V_MIXED, who), { state: 'multiple', count: 2 }, name);
    assert.deepEqual(await capability(w, V_THEIRS, who), { state: 'single', order_id: 'ord-theirs' }, name);
  }
});

test('R3-I10: nothing about the vehicle\'s make, provenance or listing changes the answer', async () => {
  const w = world();
  for (const over of [{ import_source: 'diaspora_import' }, { import_source: 'Japan' }, { publication_status: 'published', current_seller_id: 'u-owner' }, { make: 'Anything', model: 'Else' }]) {
    const none = await getVehicleImportCapability({ ...rowOf(w, V_NONE), ...over }, OWNER, opts(w));
    const one = await getVehicleImportCapability({ ...rowOf(w, V_ONE), ...over }, OWNER, opts(w));
    assert.deepEqual(none, { state: 'none' }, `${JSON.stringify(over)} made an import journey appear`);
    assert.deepEqual(one, { state: 'single', order_id: 'ord-one' }, `${JSON.stringify(over)} hid an import journey`);
  }
});

// ── 3. One interpretation of import ownership: the capability agrees with the journey resolver ──────

test('R3-I11: for every vehicle and viewer, the capability agrees with what getJourney("vehicle") does', async () => {
  const w = world();
  const vins = [V_NONE, V_ONE, V_TWO, V_GONE, V_THEIRS, V_MIXED, V_PART, V_FOREIGN];
  let compared = 0;
  for (const [name, viewer] of Object.entries(VIEWERS)) {
    for (const vin of vins) {
      const cap = await capability(w, vin, viewer);
      const journey = await getJourney('vehicle', vin, viewer, opts(w)).catch((error) => error);
      const label = `${name} on ${vin}`;
      if (journey instanceof Error) {
        assert.ok(journey instanceof ForbiddenError, `${label}: unexpected ${journey.name}: ${journey.message}`);
        assert.deepEqual(cap, { state: 'none' }, `${label}: the resolver refuses, the capability must say none`);
      } else if (journey.state === JOURNEY_STATES.ORDER_AMBIGUOUS) {
        assert.equal(cap.state, 'multiple', label);
        assert.equal(cap.count, journey.candidates.length, label);
      } else if (journey.subject?.order_id) {
        assert.deepEqual(cap, { state: 'single', order_id: journey.subject.order_id }, label);
      } else {
        assert.deepEqual(cap, { state: 'none' }, `${label}: the resolver found no readable journey`);
      }
      compared += 1;
    }
  }
  assert.equal(compared, 48, 'the matrix did not run in full');
});

test('R3-I12: the shared readability rule is exported and is exactly canReadImportOrder + privilege', () => {
  const orders = [order('a', 'V', 'u-owner'), order('b', 'V', 'u-stranger')];
  assert.deepEqual(selectReadableOrders(orders, [], OWNER).map((o) => o.id), ['a']);
  assert.deepEqual(selectReadableOrders(orders, [], STRANGER).map((o) => o.id), ['b']);
  assert.deepEqual(selectReadableOrders(orders, [], ADMIN).map((o) => o.id), ['a', 'b']);
  assert.deepEqual(selectReadableOrders(null, null, OWNER), []);
  const participants = [{ import_order_id: 'b', user_id: 'u-assigned', verification_status: 'active', deleted_at: null }];
  assert.deepEqual(selectReadableOrders(orders, participants, ASSIGNED).map((o) => o.id), ['b']);
});

// ── 4. A failed read is unavailable — never none ─────────────────────────────────────────

test('R3-I13: a failed read of the orders makes every vehicle `unavailable`, never `none`', async () => {
  const w = world();
  for (const mode of ['error', 'throw']) {
    const map = await getVehiclesImportCapabilities([rowOf(w, V_NONE), rowOf(w, V_ONE)], OWNER, opts(failing(w, 'diaspora_import_orders', mode)));
    assert.deepEqual([...map.entries()], [[V_NONE, { state: 'unavailable' }], [V_ONE, { state: 'unavailable' }]], `mode=${mode}`);
  }
});

test('R3-I14: a failed read of the PARTICIPANTS also makes the vehicles `unavailable` — readability cannot be decided', async () => {
  const w = world();
  const map = await getVehiclesImportCapabilities([rowOf(w, V_ONE), rowOf(w, V_PART)], OWNER, opts(failing(w, 'diaspora_import_order_participants')));
  assert.deepEqual(map.get(V_ONE), { state: 'unavailable' });
  assert.deepEqual(map.get(V_PART), { state: 'unavailable' });
});

test('R3-I15: the vehicle journey no longer reports a failed read as "no journey" — it fails', async () => {
  const w = world();
  await assert.rejects(
    () => getJourney('vehicle', V_ONE, OWNER, opts(failing(w, 'diaspora_import_orders'))),
    (error) => error instanceof DatabaseError,
  );
  // The unfailed read is unchanged.
  const journey = await getJourney('vehicle', V_NONE, OWNER, opts(w));
  assert.match(journey.sentence, /No import order or shipment is recorded for this vehicle that you can view/);
});

test('R3-I16: degenerate input — no vehicles, a row with no vin, a missing viewer', async () => {
  const w = world();
  assert.equal((await getVehiclesImportCapabilities([], OWNER, opts(w))).size, 0);
  assert.equal((await getVehiclesImportCapabilities(null, OWNER, opts(w))).size, 0);
  assert.equal((await getVehiclesImportCapabilities([{ owner_id: 'u-owner' }, null], OWNER, opts(w))).size, 0);
  assert.deepEqual(await getVehicleImportCapability(null, OWNER, opts(w)), { state: 'unavailable' });
  await assert.rejects(() => getVehiclesImportCapabilities([rowOf(w, V_ONE)], null, opts(w)));
});

// ── 5. Bounded, chunked, read-only ──────────────────────────────────────────────────────

test('R3-I17: the reads are bounded — two for any number of vehicles with orders, one when none have any', async () => {
  const w = world();
  const all = w._rows('vehicles');
  const counted = counting(w);
  const map = await getVehiclesImportCapabilities(all, OWNER, opts(counted));
  assert.equal(map.size, all.length);
  assert.deepEqual(counted.reads, ['diaspora_import_orders', 'diaspora_import_order_participants']);

  const bare = counting(world({ orders: [], participants: [] }));
  await getVehiclesImportCapabilities(bare._rows('vehicles'), OWNER, opts(bare));
  assert.deepEqual(bare.reads, ['diaspora_import_orders'], 'no orders means nothing to read participants for');
});

test('R3-I18: a large garage is read in chunks, not in one oversized request', async () => {
  const many = Array.from({ length: 250 }, (_, i) => vehicle(`BULK-${String(i).padStart(4, '0')}-VIN`));
  const w = world({ vehicles: many, orders: [order('ord-bulk', 'BULK-0007-VIN', 'u-owner')], participants: [] });
  const counted = counting(w);
  const map = await getVehiclesImportCapabilities(many, OWNER, opts(counted));
  assert.equal(counted.reads.filter((table) => table === 'diaspora_import_orders').length, 3, '250 vehicles at 100 per request');
  assert.deepEqual(map.get('BULK-0007-VIN'), { state: 'single', order_id: 'ord-bulk' });
  assert.deepEqual(map.get('BULK-0008-VIN'), { state: 'none' });
});

test('R3-I19: it writes nothing', async () => {
  const w = world();
  const before = JSON.stringify(w._tables);
  await getVehiclesImportCapabilities(w._rows('vehicles'), OWNER, opts(w));
  await getVehiclesImportCapabilities(w._rows('vehicles'), ADMIN, opts(w));
  assert.equal(JSON.stringify(w._tables), before);
});
