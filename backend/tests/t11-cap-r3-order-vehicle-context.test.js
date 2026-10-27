/**
 * T11-CAP-LR01-R3 — an import order names its vehicle, for the person entitled to know which it is.
 *
 * The order list titled rows "Import <uuid>", the detail said "Vehicle request" and the documents page said
 * "PURCHASE 3E2B66A0" — the data was there (`linked_vehicle_vin`) and nothing read it. The fix must not become
 * a leak, so this file holds the audience rule as hard as the feature:
 *
 *   · the owner / current seller of the vehicle gets `linked_vehicle: { vin, title }` — exactly those keys;
 *   · EVERYONE else — the order's buyer who is not the vehicle's owner, a seller participant, a logistics
 *     provider, a platform admin — gets the order back untouched, so the response cannot be used to learn
 *     which vehicle an order is about or whether one is linked;
 *   · a failed read changes nothing (the page falls back to its existing titles); it never fails the order;
 *   · bounded and read-only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { attachLinkedVehicle, attachLinkedVehicles, vehicleTitle } from '../services/diaspora/orderVehicleContext.js';

const OWNER = { id: 'u-owner', platformRole: 'member' };
const SELLER = { id: 'u-seller', platformRole: 'member' };
const STRANGER = { id: 'u-stranger', platformRole: 'member' };
const ADMIN = { id: 'u-admin', platformRole: 'platform_admin' };

const VEZEL = { vin: 'RU3-1316558', make: 'Honda', model: 'Vezel', year: 2018, owner_id: 'u-owner', current_seller_id: null, color: 'Pearl', mileage: 134741, chassis_number: 'SECRET-CH', engine_number: 'SECRET-EN', price: 0 };
const SERENA = { vin: 'GFC27-027051', make: 'Nissan', model: 'Serena', year: 2016, owner_id: 'u-owner', current_seller_id: 'u-owner' };
const OTHERS = { vin: 'OTHERS-0001', make: 'Toyota', model: 'Aqua', year: 2017, owner_id: 'u-stranger', current_seller_id: 'u-seller' };
const BARE = { vin: 'BARE-0001', make: null, model: null, year: 0, owner_id: 'u-owner', current_seller_id: null };

const order = (id, vin, over = {}) => ({ id, buyer_id: 'u-owner', created_by: 'u-owner', linked_vehicle_vin: vin, status: 'DOCUMENTS_PENDING', requested_make: null, requested_model: null, ...over });
const world = (vehicles = [VEZEL, SERENA, OTHERS, BARE]) => createMockSupabase({ vehicles: vehicles.map((v) => ({ ...v })) });

// ── the title ───────────────────────────────────────────────────────────────────────────

test('R3-O1: a vehicle is titled "year make model" and never with a part it does not have', () => {
  assert.equal(vehicleTitle(VEZEL), '2018 Honda Vezel');
  assert.equal(vehicleTitle({ year: 0, make: 'Honda', model: null }), 'Honda');
  assert.equal(vehicleTitle({ year: '  ', make: undefined, model: '' }), null);
  assert.equal(vehicleTitle(null), null);
});

// ── the audience ────────────────────────────────────────────────────────────────────────

test('R3-O2: the owner is told which vehicle the order is about — a vin and a title, nothing else', async () => {
  const w = world();
  const out = await attachLinkedVehicle(order('o1', VEZEL.vin), OWNER, { client: w });
  assert.deepEqual(out.linked_vehicle, { vin: 'RU3-1316558', title: '2018 Honda Vezel' });
  assert.deepEqual(Object.keys(out.linked_vehicle), ['vin', 'title']);
  const text = JSON.stringify(out);
  for (const secret of ['SECRET-CH', 'SECRET-EN', '134741', 'Pearl', 'owner_id']) assert.equal(text.includes(secret), false, `${secret} leaked into the order`);
});

test('R3-O3: the current seller of a vehicle is entitled as well', async () => {
  const out = await attachLinkedVehicle(order('o2', OTHERS.vin, { buyer_id: 'u-seller' }), SELLER, { client: world() });
  assert.deepEqual(out.linked_vehicle, { vin: 'OTHERS-0001', title: '2017 Toyota Aqua' });
});

test('R3-O4: AUDIENCE — everyone else gets the order back UNTOUCHED, byte for byte', async () => {
  const w = world();
  const o = order('o3', VEZEL.vin);
  const before = JSON.stringify(o);
  // The order's own buyer, when the vehicle belongs to someone else, is not the vehicle's owner.
  const buyerNotOwner = order('o4', OTHERS.vin, { buyer_id: 'u-owner' });
  const cases = [
    ['a stranger', o, STRANGER],
    ['a platform admin', o, ADMIN],
    ['the buyer of an order about someone else\'s vehicle', buyerNotOwner, OWNER],
  ];
  for (const [label, input, who] of cases) {
    const out = await attachLinkedVehicle(input, who, { client: w });
    assert.equal(out, input, `${label}: the order object was rebuilt`);
    assert.equal('linked_vehicle' in out, false, `${label} was told a vehicle`);
  }
  assert.equal(JSON.stringify(o), before);
});

test('R3-O5: an order with no linked vehicle, or a link to a vehicle that does not exist, is returned as it came', async () => {
  const w = world();
  const none = order('o5', null);
  const ghost = order('o6', 'NO-SUCH-VIN');
  assert.equal(await attachLinkedVehicle(none, OWNER, { client: w }), none);
  assert.equal(await attachLinkedVehicle(ghost, OWNER, { client: w }), ghost);
});

test('R3-O6: no identity, or an identity that was merely asserted, is queried for nothing and told nothing', async () => {
  let reads = 0;
  const spy = { from() { reads += 1; throw new Error('must not be read'); } };
  const o = order('o7', VEZEL.vin);
  for (const who of [undefined, null, {}, { id: null }, { id: 'u-owner', identityAsserted: true }]) {
    assert.equal(await attachLinkedVehicle(o, who, { client: spy }), o);
  }
  assert.equal(reads, 0);
});

test('R3-O7: a vehicle that names none of year, make or model is linked with a null title, not an invented one', async () => {
  const out = await attachLinkedVehicle(order('o8', BARE.vin), OWNER, { client: world() });
  assert.deepEqual(out.linked_vehicle, { vin: 'BARE-0001', title: null });
});

// ── the list ────────────────────────────────────────────────────────────────────────────

test('R3-O8: a list is read once for all its vehicles, and each order gets only its own entitlement', async () => {
  const w = world();
  let reads = 0;
  const counted = { from(t) { reads += 1; return w.from(t); } };
  const orders = [order('a', VEZEL.vin), order('b', SERENA.vin), order('c', OTHERS.vin), order('d', null)];
  const out = await attachLinkedVehicles(orders, OWNER, { client: counted });
  assert.equal(reads, 1, 'one vehicles read for the whole list');
  assert.deepEqual(out.map((o) => o.linked_vehicle?.title ?? null), ['2018 Honda Vezel', '2016 Nissan Serena', null, null]);
  assert.equal(out[2], orders[2], 'the order about someone else\'s vehicle is the same object');
  assert.equal(out[3], orders[3]);
});

test('R3-O9: a large list is read in chunks, and the same VIN is asked for once', async () => {
  const many = Array.from({ length: 230 }, (_, i) => ({ vin: `BULK-${String(i).padStart(4, '0')}`, make: 'M', model: `N${i}`, year: 2020, owner_id: 'u-owner', current_seller_id: null }));
  const w = world(many);
  const asked = [];
  const spy = { from(t) { const b = w.from(t); const orig = b.in.bind(b); b.in = (col, vals) => { asked.push(vals.length); return orig(col, vals); }; return b; } };
  const orders = [...many.map((v, i) => order(`o${i}`, v.vin)), order('dupe', many[0].vin)];
  const out = await attachLinkedVehicles(orders, OWNER, { client: spy });
  assert.deepEqual(asked, [100, 100, 30], '230 distinct vehicles at 100 per read');
  assert.equal(out.filter((o) => o.linked_vehicle).length, 231);
});

test('R3-O10: it does not modify the orders it is given', async () => {
  const orders = [Object.freeze(order('x', VEZEL.vin))];
  const out = await attachLinkedVehicles(orders, OWNER, { client: world() });
  assert.equal('linked_vehicle' in orders[0], false);
  assert.ok(out[0].linked_vehicle);
});

// ── faults ──────────────────────────────────────────────────────────────────────────────

test('R3-O11: FAULTS — a failed vehicle read returns the orders as they were; it never fails them and never invents a title', async () => {
  const orders = [order('f1', VEZEL.vin)];
  const failing = { from: () => { const b = { select: () => b, in: () => b, then: (res) => Promise.resolve({ data: null, error: { message: 'down' } }).then(res) }; return b; } };
  const throwing = { from() { throw new Error('connection reset'); } };
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    for (const client of [failing, throwing]) {
      const out = await attachLinkedVehicles(orders, OWNER, { client });
      assert.deepEqual(out, orders);
      assert.equal('linked_vehicle' in out[0], false);
    }
  } finally {
    console.warn = realWarn;
  }
  // A fault must leave a trace: a silent fallback is how an outage hides.
  assert.equal(warnings.filter((line) => /linked vehicles could not be read/.test(line)).length, 2);
});

test('R3-O12: it writes nothing', async () => {
  const w = world();
  const before = JSON.stringify(w._tables);
  await attachLinkedVehicles([order('w', VEZEL.vin)], OWNER, { client: w });
  assert.equal(JSON.stringify(w._tables), before);
});

// ── wiring ──────────────────────────────────────────────────────────────────────────────

test('R3-O13: the list and the detail route both go through it, and the order service is untouched', () => {
  const routes = readFileSync(new URL('../routes/diasporaRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /const data = await attachLinkedVehicles\(orders, req\.userContext\);/);
  assert.match(routes, /res\.json\(await attachLinkedVehicle\(await getImportOrder\(req\.params\.id, req\.userContext\), req\.userContext\)\);/);
  const service = readFileSync(new URL('../services/diaspora/diasporaImportOrderService.js', import.meta.url), 'utf8');
  // The whole word: the order's own column is `linked_vehicle_vin`, which is not this key.
  assert.doesNotMatch(service, /\blinked_vehicle\b/, 'the order service must not learn about vehicle identity');
});
