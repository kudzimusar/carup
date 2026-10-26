/**
 * T11-CAP-04 — the leg HTTP surface.
 *
 * Real Express and the production error handler; only authentication is stubbed and the database is
 * the in-memory mock. Held here: every failure maps to the right status, responses are allow-listed
 * projections (never a raw row), DELETE supersedes rather than erases, no route can move a leg to
 * another journey, and the production router is mounted and mounted behind authentication.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase.js';
import errorHandler from '../middleware/errorMiddleware.js';
import defaultRouter, { createShipmentLegRouter } from '../routes/diasporaShipmentLegRoutes.js';
import * as legService from '../services/diaspora/diasporaShipmentLegService.js';

function freshClient() {
  return createMockSupabase({
    diaspora_shipments: [{ id: 'ship-1', tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-1', status: 'PLANNED', deleted_at: null }],
    diaspora_import_orders: [{ id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null }],
    diaspora_container_shipments: [{ id: 'cont-1', tenant_id: 'tenant-1', coordinator_id: 'u-operator', deleted_at: null }],
    diaspora_shipment_legs: [],
    diaspora_shipment_stage_events: [],
    diaspora_trade_documents: [],
    diaspora_import_audit_log: [],
  });
}

async function withApp(fn) {
  const client = freshClient();
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'no user' });
    req.userContext = { id: who, platformRole: req.get('x-test-platform-role') || 'member' };
    return next();
  };
  // The service functions with the mock client bound in as their options.
  const service = {
    addShipmentLeg: (id, body, ctx) => legService.addShipmentLeg(id, body, ctx, { supabaseClient: client }),
    listShipmentLegs: (id, ctx) => legService.listShipmentLegs(id, ctx, { supabaseClient: client }),
    updateShipmentLeg: (id, body, ctx) => legService.updateShipmentLeg(id, body, ctx, { supabaseClient: client }),
    supersedeShipmentLeg: (id, ctx) => legService.supersedeShipmentLeg(id, ctx, { supabaseClient: client }),
  };
  app.use('/api/diaspora', createShipmentLegRouter({ auth, service }));
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/diaspora`;
  const call = (method, path, user, body, role) => fetch(`${base}${path}`, {
    method,
    headers: { ...(user ? { 'x-test-user': user } : {}), ...(role ? { 'x-test-platform-role': role } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try { return await fn({ call, client }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

const LEG = { vessel_name: 'SAMPLE VESSEL', voyage_ref: 'V-1', imo: '9074729', port_of_loading: 'Port A', port_of_discharge: 'Port B' };

test('CAP-04 route: the container operator declares a leg (201) and nothing internal is returned', async () => {
  await withApp(async ({ call }) => {
    const res = await call('POST', '/shipments/ship-1/legs', 'u-operator', LEG);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.data.sequence, 1);
    assert.equal(body.data.vessel_name, 'SAMPLE VESSEL');
    assert.equal(body.data.source, 'OPERATOR_DECLARED');
    const text = JSON.stringify(body);
    for (const leak of ['tenant_id', 'tenant-1', 'metadata', 'deleted_at']) assert.ok(!text.includes(leak), `${leak} was serialised`);
  });
});

test('CAP-04 route: a buyer is refused (403) and nothing is written', async () => {
  await withApp(async ({ call, client }) => {
    const res = await call('POST', '/shipments/ship-1/legs', 'u-buyer', LEG);
    assert.equal(res.status, 403);
    assert.equal(client._rows('diaspora_shipment_legs').length, 0);
  });
});

test('CAP-04 route: bad input is a 400 — a wrong IMO, a carrier-sourced claim, an unknown field', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('POST', '/shipments/ship-1/legs', 'u-operator', { ...LEG, imo: '9074728' })).status, 400);
    assert.equal((await call('POST', '/shipments/ship-1/legs', 'u-operator', { ...LEG, source: 'CARRIER' })).status, 400);
    assert.equal((await call('POST', '/shipments/ship-1/legs', 'u-operator', { ...LEG, observed_departure_at: '2026-09-01' })).status, 400,
      'a caller tried to assert a sailing through a leg');
  });
});

test('CAP-04 route: a missing shipment is a 404', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('POST', '/shipments/no-such/legs', 'u-operator', LEG)).status, 404);
  });
});

test('CAP-04 route: an operator lists the legs; a buyer cannot', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/shipments/ship-1/legs', 'u-operator', LEG);
    const ok = await call('GET', '/shipments/ship-1/legs', 'u-operator');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).data.length, 1);
    assert.equal((await call('GET', '/shipments/ship-1/legs', 'u-buyer')).status, 403);
  });
});

test('CAP-04 route: a correction is attributed and cannot move the leg to another journey', async () => {
  await withApp(async ({ call }) => {
    const created = (await (await call('POST', '/shipments/ship-1/legs', 'u-operator', LEG)).json()).data;
    const fixed = await call('PATCH', `/shipment-legs/${created.id}`, 'u-operator', { vessel_name: 'RENAMED' });
    assert.equal(fixed.status, 200);
    assert.equal((await fixed.json()).data.vessel_name, 'RENAMED');
    assert.equal((await call('PATCH', `/shipment-legs/${created.id}`, 'u-operator', { shipment_id: 'ship-2' })).status, 400);
    assert.equal((await call('PATCH', `/shipment-legs/${created.id}`, 'u-operator', { leg_sequence: 4 })).status, 400);
    assert.equal((await call('PATCH', `/shipment-legs/${created.id}`, 'u-buyer', { vessel_name: 'HIJACK' })).status, 403);
  });
});

test('CAP-04 route: DELETE supersedes — the row is kept', async () => {
  await withApp(async ({ call, client }) => {
    const created = (await (await call('POST', '/shipments/ship-1/legs', 'u-operator', LEG)).json()).data;
    const res = await call('DELETE', `/shipment-legs/${created.id}`, 'u-operator');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { id: created.id, superseded: true });
    assert.equal(client._rows('diaspora_shipment_legs').length, 1, 'DELETE erased the leg');
    assert.ok(client._rows('diaspora_shipment_legs')[0].deleted_at);
    assert.equal((await call('DELETE', `/shipment-legs/${created.id}`, 'u-operator')).status, 404, 'a superseded leg was superseded twice');
  });
});

test('CAP-04 route: authentication is required', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('POST', '/shipments/ship-1/legs', null, LEG)).status, 401);
    assert.equal((await call('GET', '/shipments/ship-1/legs', null)).status, 401);
  });
});

test('CAP-04 route: the production router exposes exactly these four routes', () => {
  const routes = defaultRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods).join(',')} ${l.route.path}`).sort();
  assert.deepEqual(routes, [
    'delete /shipment-legs/:legId',
    'get /shipments/:shipmentId/legs',
    'patch /shipment-legs/:legId',
    'post /shipments/:shipmentId/legs',
  ]);
  const source = readFileSync(new URL('../routes/diasporaShipmentLegRoutes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /router\.put\s*\(/);
});

test('CAP-04 route: mounted in the diaspora router, and the production default is behind authorizeRole', () => {
  const mount = readFileSync(new URL('../routes/diasporaRoutes.js', import.meta.url), 'utf8');
  assert.match(mount, /^import diasporaShipmentLegRouter from '\.\/diasporaShipmentLegRoutes\.js'/m);
  assert.match(mount, /^router\.use\(diasporaShipmentLegRouter\);/m);
  const source = readFileSync(new URL('../routes/diasporaShipmentLegRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /const participantAuth = authorizeRole\(\[/);
  assert.match(source, /auth = participantAuth/);
});
