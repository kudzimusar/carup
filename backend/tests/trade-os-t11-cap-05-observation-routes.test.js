/**
 * T11-CAP-05 — the estimate-revision HTTP surface.
 *
 * Real Express and the production error handler; only authentication is stubbed and the database is
 * the in-memory mock. Held: every failure maps to the right status, a revision cannot be edited or
 * deleted over HTTP (observations are append-only evidence), an idempotent replay is safe and a
 * conflicting one is a 409, and the production router is mounted behind authentication.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase.js';
import errorHandler from '../middleware/errorMiddleware.js';
import defaultRouter, { createShipmentObservationRouter } from '../routes/diasporaShipmentObservationRoutes.js';
import * as svc from '../services/diaspora/diasporaShipmentObservationService.js';

function freshClient() {
  return createMockSupabase({
    diaspora_shipments: [{ id: 'ship-1', tenant_id: 'tenant-1', import_order_id: 'ord-a', container_id: 'cont-1', status: 'IN_TRANSIT',
      estimated_arrival_date: '2026-09-18T00:00:00Z', departure_date: '2026-08-30T00:00:00Z', actual_arrival_date: null, metadata: {}, deleted_at: null }],
    diaspora_import_orders: [{ id: 'ord-a', tenant_id: 'tenant-1', buyer_id: 'u-buyer', created_by: 'u-buyer', deleted_at: null }],
    diaspora_container_shipments: [{ id: 'cont-1', tenant_id: 'tenant-1', coordinator_id: 'u-operator', deleted_at: null }],
    diaspora_shipment_observations: [],
    diaspora_shipment_stage_events: [],
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
  const service = {
    recordEtaRevision: (id, body, ctx) => svc.recordEtaRevision(id, body, ctx, { supabaseClient: client }),
    listEtaRevisions: (id, ctx) => svc.listEtaRevisions(id, ctx, { supabaseClient: client }),
  };
  app.use('/api/diaspora', createShipmentObservationRouter({ auth, service }));
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/diaspora`;
  const call = (method, path, user, body) => fetch(`${base}${path}`, {
    method,
    headers: { ...(user ? { 'x-test-user': user } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try { return await fn({ call, client }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

const REV = { estimated_arrival: '2026-09-25T00:00:00Z', reason: 'Vessel rescheduled by the carrier', observed_at: '2026-09-01T00:00:00Z' };

test('CAP-05 route: the container operator records a revision (201) and nothing internal is returned', async () => {
  await withApp(async ({ call }) => {
    const res = await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', REV);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.data.estimated_arrival, '2026-09-25T00:00:00.000Z');
    assert.equal(body.data.reason, 'Vessel rescheduled by the carrier');
    assert.equal(body.data.source, 'OPERATOR_DECLARED');
    const text = JSON.stringify(body);
    for (const leak of ['tenant_id', 'tenant-1', 'decided_by', 'provider_event_id', 'payload']) assert.ok(!text.includes(leak), `${leak} was serialised`);
  });
});

test('CAP-05 route: a buyer is refused (403) and nothing is written', async () => {
  await withApp(async ({ call, client }) => {
    assert.equal((await call('POST', '/shipments/ship-1/eta-revisions', 'u-buyer', REV)).status, 403);
    assert.equal(client._rows('diaspora_shipment_observations').length, 0);
  });
});

test('CAP-05 route: bad input is a 400 — no date, an unreadable date, a claimed provider, a claimed status', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', {})).status, 400);
    assert.equal((await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', { estimated_arrival: 'soon' })).status, 400);
    assert.equal((await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', { ...REV, provider_id: 'CARRIER_API' })).status, 400);
    assert.equal((await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', { ...REV, status: 'ACCEPTED' })).status, 400);
  });
});

test('CAP-05 route: a missing shipment is a 404', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('POST', '/shipments/no-such/eta-revisions', 'u-operator', REV)).status, 404);
  });
});

test('CAP-05 route: replaying an event is safe; the same id with different content is a 409', async () => {
  await withApp(async ({ call, client }) => {
    const body = { ...REV, provider_event_id: 'evt-A' };
    assert.equal((await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', body)).status, 201);
    assert.equal((await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', body)).status, 201);
    assert.equal(client._rows('diaspora_shipment_observations').length, 1, 'a replay recorded a duplicate');
    assert.equal((await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', { ...body, estimated_arrival: '2026-12-01T00:00:00Z' })).status, 409);
  });
});

test('CAP-05 route: an operator lists the history; a buyer cannot', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', REV);
    const ok = await call('GET', '/shipments/ship-1/eta-revisions', 'u-operator');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).data.length, 1);
    assert.equal((await call('GET', '/shipments/ship-1/eta-revisions', 'u-buyer')).status, 403);
  });
});

test('CAP-05 route: a revision cannot be edited or deleted over HTTP — it is evidence', async () => {
  await withApp(async ({ call, client }) => {
    const created = (await (await call('POST', '/shipments/ship-1/eta-revisions', 'u-operator', REV)).json()).data;
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      for (const path of [`/shipments/ship-1/eta-revisions/${created.id}`, '/shipments/ship-1/eta-revisions', `/shipment-observations/${created.id}`]) {
        const res = await call(method, path, 'u-operator', {});
        assert.ok(res.status >= 400, `${method} ${path} answered ${res.status}`);
        assert.notEqual(res.status, 200);
      }
    }
    assert.equal(client._rows('diaspora_shipment_observations').length, 1);
  });
});

test('CAP-05 route: authentication is required', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('POST', '/shipments/ship-1/eta-revisions', null, REV)).status, 401);
    assert.equal((await call('GET', '/shipments/ship-1/eta-revisions', null)).status, 401);
  });
});

test('CAP-05 route: the production router exposes exactly a GET and a POST — no edit, no delete', () => {
  const routes = defaultRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods).join(',')} ${l.route.path}`).sort();
  assert.deepEqual(routes, ['get /shipments/:shipmentId/eta-revisions', 'post /shipments/:shipmentId/eta-revisions']);
  const source = readFileSync(new URL('../routes/diasporaShipmentObservationRoutes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /router\.(put|patch|delete)\s*\(/);
});

test('CAP-05 route: mounted in the diaspora router, and the production default is behind authorizeRole', () => {
  const mount = readFileSync(new URL('../routes/diasporaRoutes.js', import.meta.url), 'utf8');
  assert.match(mount, /^import diasporaShipmentObservationRouter from '\.\/diasporaShipmentObservationRoutes\.js'/m);
  assert.match(mount, /^router\.use\(diasporaShipmentObservationRouter\);/m);
  const source = readFileSync(new URL('../routes/diasporaShipmentObservationRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /const participantAuth = authorizeRole\(\[/);
  assert.match(source, /auth = participantAuth/);
});
