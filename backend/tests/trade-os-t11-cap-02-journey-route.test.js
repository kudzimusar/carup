/**
 * T11-CAP-02 — the Journey HTTP surface.
 *
 * Real Express and the production error handler; only authentication is stubbed (it is a token and a
 * database lookup in production) and the database is the in-memory mock. What is held here:
 *
 *   - one GET, and no write verb answers
 *   - an outsider cannot tell a missing journey from a forbidden one
 *   - nothing internal is serialised
 *   - the production router is mounted, and mounted behind authentication
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase.js';
import errorHandler from '../middleware/errorMiddleware.js';
import defaultJourneyRouter, { createJourneyRouter } from '../routes/diasporaJourneyRoutes.js';
import { getJourney } from '../services/diaspora/journeyProjectionService.js';

const client = createMockSupabase({
  diaspora_import_orders: [{ id: 'ord-a', tenant_id: 't1', buyer_id: 'u-buyer', created_by: 'u-buyer', linked_vehicle_vin: null, status: 'SHIPPED', deleted_at: null }],
  diaspora_import_order_participants: [],
  diaspora_cargo_reservations: [],
  diaspora_container_loads: [],
  diaspora_container_load_items: [],
  vehicles: [],
  diaspora_shipments: [{
    id: 'ship-1', tenant_id: 't1', import_order_id: 'ord-a', container_id: null, status: 'IN_TRANSIT', carrier_name: 'Carrier X',
    departure_date: '2026-09-21T08:00:00Z', estimated_arrival_date: '2026-10-01T00:00:00Z', actual_arrival_date: null,
    metadata: { internal_note: 'ROUTE-METADATA-SECRET' }, created_by: 'u-operator', deleted_at: null,
  }],
  diaspora_shipment_stage_events: [],
});

async function withApp(fn) {
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'no user' });
    req.userContext = { id: who, platformRole: req.get('x-test-platform-role') || 'member' };
    return next();
  };
  app.use('/api/diaspora', createJourneyRouter({
    auth,
    getJourneyFn: (type, id, ctx) => getJourney(type, id, ctx, { supabaseClient: client }),
  }));
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/api/diaspora`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const get = (base, path, user, role) => fetch(`${base}${path}`, { headers: user ? { 'x-test-user': user, ...(role ? { 'x-test-platform-role': role } : {}) } : {} });

test('CAP-02 route: the buyer gets their journey, and nothing internal is serialised', async () => {
  await withApp(async (base) => {
    const res = await get(base, '/journeys/import_order/ord-a', 'u-buyer');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.state, 'IN_TRANSIT');
    const text = JSON.stringify(body);
    assert.ok(!text.includes('ROUTE-METADATA-SECRET'), 'shipment metadata was serialised');
    assert.ok(!text.includes('u-operator'), 'an operator identity was serialised');
  });
});

test('CAP-02 route: an outsider is refused (403), and cannot tell missing from forbidden', async () => {
  await withApp(async (base) => {
    const forbidden = await get(base, '/journeys/import_order/ord-a', 'u-outsider');
    const missing = await get(base, '/journeys/import_order/no-such-order', 'u-outsider');
    assert.equal(forbidden.status, 403);
    assert.equal(missing.status, 403, 'a missing id told an outsider it does not exist');
    // The handler stamps each response with the time it was produced; everything else must match.
    const strip = (b) => { const { timestamp, ...rest } = b.error; return { ...b, error: rest }; };
    assert.deepEqual(strip(await missing.json()), strip(await forbidden.json()), 'the two refusals are distinguishable');
  });
});

test('CAP-02 route: a platform admin is told a missing journey is missing (404)', async () => {
  await withApp(async (base) => {
    const res = await get(base, '/journeys/import_order/no-such-order', 'u-admin', 'platform_admin');
    assert.equal(res.status, 404);
  });
});

test('CAP-02 route: an unknown subject type is a 400', async () => {
  await withApp(async (base) => {
    const res = await get(base, '/journeys/vehicle/x', 'u-buyer');
    assert.equal(res.status, 400);
  });
});

test('CAP-02 route: authentication is required', async () => {
  await withApp(async (base) => {
    const res = await get(base, '/journeys/import_order/ord-a', null);
    assert.equal(res.status, 401);
  });
});

test('CAP-02 route: no write verb answers on the journey path', async () => {
  await withApp(async (base) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${base}/journeys/import_order/ord-a`, { method, headers: { 'x-test-user': 'u-buyer', 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
      assert.ok(res.status >= 400, `${method} answered ${res.status}`);
      assert.notEqual(res.status, 200);
    }
  });
});

test('CAP-02 route: the production router exposes exactly one GET route and no write verb', () => {
  const routes = defaultJourneyRouter.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods) }));
  assert.deepEqual(routes, [{ path: '/journeys/:subjectType/:subjectId', methods: ['get'] }]);
  const source = readFileSync(new URL('../routes/diasporaJourneyRoutes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /router\.(post|put|patch|delete)\s*\(/);
});

test('CAP-02 route: the journey router is mounted in the diaspora router, after authentication is defined', () => {
  const source = readFileSync(new URL('../routes/diasporaRoutes.js', import.meta.url), 'utf8');
  // Anchored to the start of a line so a commented-out mount cannot satisfy it.
  assert.match(source, /^import diasporaJourneyRouter from '\.\/diasporaJourneyRoutes\.js'/m);
  assert.match(source, /^router\.use\(diasporaJourneyRouter\);/m);
});

test('CAP-02 route: the production default is behind authorizeRole', () => {
  const source = readFileSync(new URL('../routes/diasporaJourneyRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /const participantAuth = authorizeRole\(\[/);
  assert.match(source, /auth = participantAuth/);
});
