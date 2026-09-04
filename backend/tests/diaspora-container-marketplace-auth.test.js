/**
 * Trade OS D2 — marketplace route/service authorization over HTTP.
 *
 * Drives the REAL diaspora router + authorizeRole + marketplace service + approval-RPC reference
 * against an in-memory Supabase. Proves the September operator model end to end:
 *
 *   - a legitimate TENANT ADMIN (verified tenant_users membership, sent as x-tenant-id) can
 *     create/approve/reject/close containers for its OWN tenant without any platform role;
 *   - an anonymous caller is denied;
 *   - a plain buyer cannot create/approve (service-layer canReview is authoritative now that the
 *     route gate admits participant-level roles);
 *   - a spoofed x-stakeholder-role does not escalate;
 *   - a spoofed x-tenant-id without a real tenant_users membership is rejected by the middleware;
 *   - a tenant MEMBER (non-admin membership) is still denied operator actions;
 *   - a tenant-B admin cannot approve/close a tenant-A container (cross-tenant denial in the RPC);
 *   - a participant cannot approve their own reservation but can cancel it.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const diasporaRouter = (await import('../routes/diasporaRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function seededMock() {
  return createMockSupabase({
    users: [
      { id: 'buyer-1', role: 'owner', is_verified: true },
      { id: 'op-1', role: 'owner', is_verified: true },
      { id: 'opB-1', role: 'owner', is_verified: true },
      { id: 'member-1', role: 'owner', is_verified: true },
    ],
    tenant_users: [
      { tenant_id: TENANT_A, user_id: 'op-1', role: 'admin' },
      { tenant_id: TENANT_B, user_id: 'opB-1', role: 'admin' },
      { tenant_id: TENANT_A, user_id: 'member-1', role: 'member' },
    ],
    diaspora_container_shipments: [
      { id: 'cont-A', tenant_id: TENANT_A, status: 'BOOKING_OPEN', total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60, coordinator_id: 'op-1', origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare', metadata: {} },
    ],
    diaspora_cargo_reservations: [],
    diaspora_import_audit_log: [],
  }, { rpc: DIASPORA_RPCS });
}

let server; let baseUrl; let mock;
function installMock() {
  mock = seededMock();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => mock.from(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: (n, p) => mock.rpc(n, p) });
}

before(async () => {
  installMock();
  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(installMock);

async function call(method, path, { userId, role, tenantId, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (role) headers['x-stakeholder-role'] = role;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const BASE = '/api/diaspora/container-marketplace';
const CONTAINER = { origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare', departure_date: '2026-10-15', booking_deadline: '2026-10-01', container_type: '40HC', total_capacity_volume: 66 };

async function requestReservationAs(userId, volume = 10) {
  return call('POST', `${BASE}/containers/cont-A/reservations`, { userId, body: { estimated_volume: volume, cargo_type: 'household', cargo_description: 'Boxed household effects' } });
}

// --- anonymous ---------------------------------------------------------------

test('anonymous caller cannot list, create, or approve (401)', async () => {
  assert.equal((await call('GET', `${BASE}/containers`)).status, 401);
  assert.equal((await call('POST', `${BASE}/containers`, { body: CONTAINER })).status, 401);
  assert.equal((await call('POST', `${BASE}/reservations/any/approve`)).status, 401);
});

// --- plain buyer cannot operate ----------------------------------------------

test('a plain buyer cannot create a container (403 from the authoritative service)', async () => {
  const { status } = await call('POST', `${BASE}/containers`, { userId: 'buyer-1', body: CONTAINER });
  assert.equal(status, 403);
});

test('a participant cannot approve their own reservation (403)', async () => {
  const r = await requestReservationAs('buyer-1');
  assert.equal(r.status, 201);
  const { status } = await call('POST', `${BASE}/reservations/${r.body.data.id}/approve`, { userId: 'buyer-1' });
  assert.equal(status, 403);
});

// --- spoofing ----------------------------------------------------------------

test('spoofed x-stakeholder-role does not grant operator authority (403)', async () => {
  assert.equal((await call('POST', `${BASE}/containers`, { userId: 'buyer-1', role: 'admin', body: CONTAINER })).status, 403);
});

test('spoofed x-tenant-id without a real membership is rejected by the middleware (403)', async () => {
  const { status, body } = await call('POST', `${BASE}/containers`, { userId: 'buyer-1', tenantId: TENANT_A, body: CONTAINER });
  assert.equal(status, 403);
  assert.match(String(body.error || ''), /tenant/i);
});

// --- tenant member is not an operator ----------------------------------------

test('a non-admin tenant MEMBER cannot create or approve (403)', async () => {
  assert.equal((await call('POST', `${BASE}/containers`, { userId: 'member-1', tenantId: TENANT_A, body: CONTAINER })).status, 403);
  const r = await requestReservationAs('buyer-1');
  assert.equal((await call('POST', `${BASE}/reservations/${r.body.data.id}/approve`, { userId: 'member-1', tenantId: TENANT_A })).status, 403);
});

// --- legitimate tenant operator ----------------------------------------------

test('a tenant admin can create a container for its own tenant (201, tenant-stamped)', async () => {
  const { status, body } = await call('POST', `${BASE}/containers`, { userId: 'op-1', tenantId: TENANT_A, body: CONTAINER });
  assert.equal(status, 201);
  assert.equal(body.data.tenant_id, TENANT_A);
  assert.equal(body.data.status, 'BOOKING_OPEN');
  assert.equal(body.data.coordinator_id, 'op-1');
});

test('a tenant admin can approve a reservation on its own container; capacity updates', async () => {
  const r = await requestReservationAs('buyer-1', 20);
  const { status, body } = await call('POST', `${BASE}/reservations/${r.body.data.id}/approve`, { userId: 'op-1', tenantId: TENANT_A });
  assert.equal(status, 200);
  assert.equal(body.data.reservation.reservation_status, 'APPROVED');
  assert.equal(body.data.capacity.usedVolume, 20);
  assert.equal(body.data.capacity.availableVolume, 40);
});

test('a tenant admin can reject and close booking on its own container', async () => {
  const r = await requestReservationAs('buyer-1');
  assert.equal((await call('POST', `${BASE}/reservations/${r.body.data.id}/reject`, { userId: 'op-1', tenantId: TENANT_A })).status, 200);
  const closed = await call('POST', `${BASE}/containers/cont-A/close-booking`, { userId: 'op-1', tenantId: TENANT_A });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.data.status, 'BOOKING_CLOSED');
});

// --- cross-tenant denial ------------------------------------------------------

test('a tenant-B admin cannot approve or close a tenant-A container (403)', async () => {
  const r = await requestReservationAs('buyer-1');
  assert.equal((await call('POST', `${BASE}/reservations/${r.body.data.id}/approve`, { userId: 'opB-1', tenantId: TENANT_B })).status, 403);
  assert.equal((await call('POST', `${BASE}/containers/cont-A/close-booking`, { userId: 'opB-1', tenantId: TENANT_B })).status, 403);
});

// --- participant self-service -------------------------------------------------

test('a participant can cancel their own reservation; another participant cannot', async () => {
  const r = await requestReservationAs('buyer-1');
  // op-B (acting as a plain user, no tenant header) does not own it and holds no authority over tenant A.
  assert.equal((await call('POST', `${BASE}/reservations/${r.body.data.id}/cancel`, { userId: 'opB-1' })).status, 403);
  assert.equal((await call('POST', `${BASE}/reservations/${r.body.data.id}/cancel`, { userId: 'buyer-1' })).status, 200);
});
