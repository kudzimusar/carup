/**
 * RX06-LR04 CAP S1 — the Journey & Arrival projection carried onto R2C. Synthetic fixtures only.
 *
 * Each test pins one of the nine adaptations, and is written so the UNADAPTED source (T11-CAP-LR01-R3, 6af11ac6)
 * fails it — the negative control is the original behaviour:
 *   1  only a platform REVIEWER is privileged; a plain platform admin who is not a party is refused identically
 *   2  a vehicle's own chassis/engine numbers go only to a reviewer or the vehicle's owner/current seller
 *   3  with the T10 loading tables absent or failing, nothing is said about loading (never "not loaded")
 *   4  a shipment recorded without a container does not contradict the order's booking
 *   5  a failed leg or ETA read is "unavailable", never "none declared"
 *   6–9 documents (T8), customs (T12), statistics (D8) and media (S2) are not composed here, and say so
 * plus: the route needs a proven identity, and active/wrong-tenant/revoked participants keep R2C's read rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getJourney, JOURNEY_STATES } from '../services/diaspora/journeyProjectionService.js';
import { createJourneyRouter } from '../routes/diasporaJourneyRoutes.js';
import { ForbiddenError } from '../utils/errors.js';

const BUYER = { id: 'u-buyer', platformRole: 'member' };
const OUTSIDER = { id: 'u-outsider', platformRole: 'member' };
const PARTICIPANT = { id: 'u-assigned', platformRole: 'member' };
const REVIEWER = { id: 'u-reviewer', platformRole: 'reviewer' };
const PLAIN_ADMIN = { id: 'u-plain-admin', platformRole: 'admin' };
const DENIED = 'You do not have access to this journey';

const opts = (client) => ({ supabaseClient: client });

function world(over = {}) {
  const shipment = (id, extra = {}) => ({
    id, tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-1', status: 'PLANNED',
    carrier_name: 'Carrier X', tracking_number: 'TRK-1', origin_port: 'Origin Port', destination_port: 'Dest Port',
    departure_date: null, estimated_arrival_date: '2026-12-01T00:00:00Z', actual_arrival_date: null,
    metadata: { planned_departure_date: '2026-11-20T00:00:00Z', planned_departure_source: 'stated_at_creation' },
    created_by: 'u-operator', deleted_at: null, ...extra,
  });
  return createMockSupabase({
    diaspora_import_orders: over.orders || [
      { id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', linked_vehicle_vin: 'VIN-A', vin: 'VIN-A',
        chassis_number: over.orderChassis === undefined ? 'CH-ORDER' : over.orderChassis, status: 'SHIPPED', deleted_at: null },
    ],
    diaspora_import_order_participants: over.participants || [
      { id: 'p1', import_order_id: 'ord-a', tenant_id: 'tenant-1', user_id: 'u-assigned', verification_status: 'active', deleted_at: null },
    ],
    vehicles: [{ vin: 'VIN-A', make: 'Make', model: 'Model', year: 2018, color: 'Pearl', mileage: 1000,
      chassis_number: 'CH-VEHICLE', engine_number: 'ENG-VEHICLE', owner_id: over.vehicleOwner ?? 'u-someone-else', current_seller_id: null }],
    diaspora_container_shipments: [{ id: 'cont-1', tenant_id: 'tenant-1', coordinator_id: 'u-operator', status: 'BOOKING_CLOSED', deleted_at: null }],
    diaspora_cargo_reservations: over.reservations || [
      { id: 'res-a', tenant_id: 'tenant-1', container_id: 'cont-1', import_order_id: 'ord-a', buyer_id: 'u-buyer', created_by: 'u-buyer', status: 'APPROVED', deleted_at: null },
    ],
    diaspora_container_loads: over.loads || [],
    diaspora_container_load_items: over.items || [],
    diaspora_shipments: over.shipments === undefined ? [shipment('ship-1')] : over.shipments.map((s) => shipment(s.id, s)),
    diaspora_shipment_stage_events: [],
    diaspora_shipment_legs: over.legs || [],
    diaspora_shipment_observations: over.observations || [],
  });
}

/** A client whose reads of the named tables FAIL the way PostgREST does for a missing relation. */
function failing(client, tables) {
  const result = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
  const builder = () => {
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
        if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(result);
        return () => b;
      },
    });
    return b;
  };
  return new Proxy(client, { get: (t, prop) => (prop === 'from' ? (table) => (tables.includes(table) ? builder() : t.from(table)) : t[prop]) });
}

// ── 1. Privilege is the platform reviewer's, as on R2C ────────────────────────────────────────────

test('S1-1: a platform reviewer reads any order\'s journey with private access', async () => {
  const j = await getJourney('import_order', 'ord-a', REVIEWER, opts(world()));
  assert.equal(j.viewer.kind, 'ADMIN');
});

test('S1-1: a plain platform admin who is not a party is refused — identically for a real and a missing order', async () => {
  const real = await getJourney('import_order', 'ord-a', PLAIN_ADMIN, opts(world())).then(() => null, (e) => e);
  const missing = await getJourney('import_order', 'ord-missing', PLAIN_ADMIN, opts(world())).then(() => null, (e) => e);
  assert.ok(real instanceof ForbiddenError, 'a plain admin must not read a journey it is not a party to');
  assert.ok(missing instanceof ForbiddenError, 'and must not learn which ids exist');
  assert.equal(real.message, DENIED);
  assert.equal(missing.message, DENIED);
});

// ── 2. Vehicle identifiers belong to the vehicle's owner ──────────────────────────────────────────

test('S1-2: the order\'s buyer, not the vehicle\'s owner, gets the order\'s chassis number but never the vehicle record\'s identifiers', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({ vehicleOwner: 'u-someone-else' })));
  assert.equal(j.viewer.kind, 'OWNER');
  assert.equal(j.asset.chassis_number, 'CH-ORDER');
  assert.equal(j.asset.engine_number, null);
  assert.ok(!JSON.stringify(j).includes('CH-VEHICLE'), 'the vehicle record\'s chassis number is never composed');
  assert.ok(!JSON.stringify(j).includes('ENG-VEHICLE'), 'nor its engine number');
});

test('S1-2: with no chassis on the order, a buyer who does not own the vehicle sees none', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({ vehicleOwner: 'u-someone-else', orderChassis: null })));
  assert.equal(j.asset.chassis_number, null);
});

test('S1-2: the vehicle\'s owner sees its identifiers', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({ vehicleOwner: 'u-buyer' })));
  assert.equal(j.asset.chassis_number, 'CH-VEHICLE');
  assert.equal(j.asset.engine_number, 'ENG-VEHICLE');
});

test('S1-2: an assigned participant gets no identifiers at all', async () => {
  const j = await getJourney('import_order', 'ord-a', PARTICIPANT, opts(world()));
  assert.equal(j.viewer.kind, 'PARTICIPANT');
  assert.equal(j.asset.chassis_number, undefined);
  assert.equal(j.asset.engine_number, undefined);
});

// R2C's read rule for participants is kept (tenant-bound, active only).
test('S1: a wrong-tenant participant and a revoked participant are refused; an outsider too', async () => {
  for (const p of [
    { id: 'p1', import_order_id: 'ord-a', tenant_id: 'tenant-other', user_id: 'u-assigned', verification_status: 'active', deleted_at: null },
    { id: 'p1', import_order_id: 'ord-a', tenant_id: 'tenant-1', user_id: 'u-assigned', verification_status: 'revoked', deleted_at: null },
  ]) {
    await assert.rejects(() => getJourney('import_order', 'ord-a', PARTICIPANT, opts(world({ participants: [p] }))), ForbiddenError);
  }
  await assert.rejects(() => getJourney('import_order', 'ord-a', OUTSIDER, opts(world())), ForbiddenError);
});

// ── 3. No loading claim without the loading records ────────────────────────────────────────────────

test('S1-3: with the T10 loading tables failing (absent on this line), the journey never says the cargo was not loaded', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(failing(world(), ['diaspora_container_loads', 'diaspora_container_load_items'])));
  assert.notEqual(j.state, JOURNEY_STATES.NOT_LOADED);
  assert.notEqual(j.state, JOURNEY_STATES.LEFT_BEHIND);
  assert.ok(!/not been loaded/i.test(String(j.sentence)), `sentence: ${j.sentence}`);
});

test('S1-3 (control): when the loading records exist and say LOADED, that is still read', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(world({
    loads: [{ id: 'load-1', container_id: 'cont-1', status: 'COMPLETED', confirmed_at: '2026-11-19T10:00:00Z', deleted_at: null }],
    items: [{ id: 'li-a', load_id: 'load-1', subject_type: 'cargo_reservation', subject_id: 'res-a', outcome: 'LOADED', deleted_at: null }],
  })));
  assert.notEqual(j.state, JOURNEY_STATES.NOT_LOADED);
});

// ── 4. A container-less shipment is not a disagreement ─────────────────────────────────────────────

test('S1-4: a shipment recorded without a container is the order\'s shipment, with no "records disagree" exception', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(failing(world({ shipments: [{ id: 'ship-1', container_id: null }] }), ['diaspora_container_loads', 'diaspora_container_load_items'])));
  assert.equal(j.shipping?.association, 'order');
  assert.ok(!JSON.stringify(j).includes('ORDER_CONTAINER_MISMATCH'));
});

test('S1-4 (control): a shipment on a DIFFERENT container still disagrees', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(failing(world({ shipments: [{ id: 'ship-1', container_id: 'cont-other' }] }), ['diaspora_container_loads', 'diaspora_container_load_items'])));
  assert.ok(JSON.stringify(j).includes('ORDER_CONTAINER_MISMATCH'));
});

// ── 5. Failed reads are unavailable, not empty ─────────────────────────────────────────────────────

test('S1-5: a failed legs read and a failed ETA read are "unavailable", never "none declared"', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(failing(world(), ['diaspora_container_loads', 'diaspora_container_load_items', 'diaspora_shipment_legs', 'diaspora_shipment_observations'])));
  assert.equal(j.shipping.legs.availability, 'unavailable');
  assert.ok(!/no vessel or voyage has been declared/i.test(JSON.stringify(j.shipping.legs)));
  assert.equal(j.shipping.eta.availability, 'unavailable');
});

test('S1-5 (control): an answered, empty legs read says none are declared', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(failing(world(), ['diaspora_container_loads', 'diaspora_container_load_items'])));
  assert.equal(j.shipping.legs.availability, 'composed');
  assert.match(j.shipping.legs.note, /No vessel or voyage has been declared/);
});

// ── 6–9. What this line does not compose says so ───────────────────────────────────────────────────

test('S1-6..9: documents (T8), customs (T12) and statistics (D8) are not composed here; no media is served', async () => {
  const j = await getJourney('import_order', 'ord-a', BUYER, opts(failing(world({ vehicleOwner: 'u-buyer' }), ['diaspora_container_loads', 'diaspora_container_load_items'])));
  assert.deepEqual(j.sections.documents, { availability: 'not_yet_composed', owner: 'T8' });
  assert.deepEqual(j.sections.customs, { availability: 'not_yet_composed', owner: 'T12' });
  assert.equal(j.sections.intelligence.availability, 'not_applicable');
  assert.equal(j.asset.media, undefined);
});

// ── The route needs a proven identity ──────────────────────────────────────────────────────────────

async function call(userContext) {
  const app = express();
  app.use((req, _res, next) => { req.userContext = userContext; next(); });
  app.use(createJourneyRouter({ auth: (_req, _res, next) => next(), getJourneyFn: async () => ({ ok: true }) }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/journeys/import_order/ord-a`);
    return { status: res.status, cache: res.headers.get('cache-control') };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('S1: the journey route refuses an asserted (x-user-id) identity and answers a real session, never cached', async () => {
  const saved = process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
  delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
  try {
    assert.equal((await call({ id: 'u-buyer', authenticationMethod: 'x-user-id-fallback' })).status, 401);
    const ok = await call({ id: 'u-buyer', authenticationMethod: 'session' });
    assert.equal(ok.status, 200);
    assert.equal(ok.cache, 'private, no-store');
  } finally {
    if (saved === undefined) delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK; else process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = saved;
  }
});
