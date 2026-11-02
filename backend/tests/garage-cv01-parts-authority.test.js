/**
 * GARAGE-1.0-CV01 — parts authority convergence.
 *
 * The parts master predates the current Garage authority model. CV01 keeps the product behaviour
 * (Garage admins and mechanics may read/create basic parts inventory) but proves that authority now
 * comes only from a real session plus the selected, re-verified active Garage tenant.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const GARAGE = '11111111-1111-1111-1111-111111111111';
const OTHER_GARAGE = '33333333-3333-3333-3333-333333333333';
const DEALERSHIP = '22222222-2222-2222-2222-222222222222';
const INACTIVE_GARAGE = '44444444-4444-4444-4444-444444444444';

let world; let restoreWorld; let server; let baseUrl;

const session = (token, user, tenant) => ({
  token,
  user_id: user,
  active_role: 'owner',
  active_organization_id: tenant,
  is_valid: true,
  expires_at: FUTURE,
});

function seedWorld() {
  restoreWorld?.();
  world = createSupabaseWorld({
    users: [
      { id: 'u-admin', name: 'Garage Admin', role: 'owner', is_verified: true },
      { id: 'u-mech', name: 'Garage Mechanic', role: 'owner', is_verified: true },
      { id: 'u-member', name: 'Garage Member', role: 'owner', is_verified: true },
      { id: 'u-dealer', name: 'Dealer Admin', role: 'owner', is_verified: true },
      { id: 'u-padmin', name: 'Platform Admin', role: 'admin', is_verified: true },
      { id: 'u-inactive', name: 'Inactive Garage Admin', role: 'owner', is_verified: true },
    ],
    user_sessions: [
      session('tok-admin', 'u-admin', GARAGE),
      session('tok-mech', 'u-mech', GARAGE),
      session('tok-member', 'u-member', GARAGE),
      session('tok-dealer', 'u-dealer', DEALERSHIP),
      session('tok-padmin', 'u-padmin', GARAGE),
      session('tok-inactive', 'u-inactive', INACTIVE_GARAGE),
    ],
    tenants: [
      { id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active' },
      { id: OTHER_GARAGE, name: 'Avondale Garage', type: 'garage', status: 'active' },
      { id: DEALERSHIP, name: 'Avondale Dealers', type: 'dealership', status: 'active' },
      { id: INACTIVE_GARAGE, name: 'Closed Garage', type: 'garage', status: 'inactive' },
    ],
    tenant_users: [
      { tenant_id: GARAGE, user_id: 'u-admin', role: 'admin' },
      { tenant_id: GARAGE, user_id: 'u-mech', role: 'mechanic' },
      { tenant_id: GARAGE, user_id: 'u-member', role: 'member' },
      { tenant_id: DEALERSHIP, user_id: 'u-dealer', role: 'admin' },
      { tenant_id: INACTIVE_GARAGE, user_id: 'u-inactive', role: 'admin' },
    ],
    mechanic_parts: [
      { id: 'part-a', tenant_id: GARAGE, name: 'Brake Pad', sku: 'BP-001', stock_level: 8, min_stock: 2, supplier: 'Supplier A', unit_price: 25 },
      { id: 'part-b', tenant_id: OTHER_GARAGE, name: 'Oil Filter', sku: 'OF-001', stock_level: 5, min_stock: 1, supplier: 'Supplier B', unit_price: 12 },
    ],
  });
  restoreWorld = installSupabaseWorld(supabase, world);
}

before(async () => {
  seedWorld();
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  restoreWorld?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => seedWorld());

async function call(method, path, { token, headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-bypass-rate-limit': 'true',
      ...(token ? { 'x-session-token': token } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

test('Garage admin and mechanic can read only the selected Garage inventory', async () => {
  for (const token of ['tok-admin', 'tok-mech']) {
    const res = await call('GET', '/api/mechanic/parts', { token });
    assert.equal(res.status, 200, `${token}: ${res.text}`);
    assert.deepEqual(res.body.map((row) => row.sku), ['BP-001']);
    assert.ok(res.body.every((row) => row.tenant_id === GARAGE));
  }
});

test('Garage admin and mechanic retain the existing basic create capability', async () => {
  for (const [token, sku] of [['tok-admin', 'ADMIN-001'], ['tok-mech', 'MECH-001']]) {
    const res = await call('POST', '/api/mechanic/parts', {
      token,
      body: { name: 'Test Part', sku, stock_level: 3, unit_price: 9.5, tenant_id: OTHER_GARAGE },
    });
    assert.equal(res.status, 200, `${token}: ${res.text}`);
    assert.equal(res.body.success, true);
    assert.equal(res.body.part.tenant_id, GARAGE, 'body tenant_id never redirects the write');
  }
});

test('a Garage member outside the workspace cannot read or create inventory', async () => {
  for (const method of ['GET', 'POST']) {
    const res = await call(method, '/api/mechanic/parts', {
      token: 'tok-member',
      body: method === 'POST' ? { name: 'No', sku: 'NO-001', stock_level: 1, unit_price: 1 } : undefined,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'ACTIVE_TENANT_ROLE');
  }
});

test('a dealership tenant is rejected even when its user is a tenant admin', async () => {
  const res = await call('GET', '/api/mechanic/parts', { token: 'tok-dealer' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'ACTIVE_TENANT_TYPE');
});

test('platform admin without Garage membership cannot substitute platform authority for Garage membership', async () => {
  const res = await call('GET', '/api/mechanic/parts', { token: 'tok-padmin' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'TENANT_CONTEXT_REVOKED');
});

test('an inactive selected Garage cannot be used for parts operations', async () => {
  const res = await call('GET', '/api/mechanic/parts', { token: 'tok-inactive' });
  assert.equal(res.status, 403);
});

test('a mismatched tenant header cannot redirect a valid Garage session', async () => {
  const res = await call('GET', '/api/mechanic/parts', {
    token: 'tok-admin',
    headers: { 'x-tenant-id': OTHER_GARAGE },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'TENANT_CONTEXT_MISMATCH');
});

test('x-user-id fallback cannot stand in for a proven session on parts routes', async () => {
  const res = await call('GET', '/api/mechanic/parts', {
    headers: { 'x-user-id': 'u-mech', 'x-tenant-id': GARAGE, 'x-stakeholder-role': 'mechanic' },
  });
  assert.equal(res.status, 401);
});

test('revoking Garage membership ends parts authority on the next request', async () => {
  assert.equal((await call('GET', '/api/mechanic/parts', { token: 'tok-mech' })).status, 200);
  world.tables.tenant_users = world.rows('tenant_users').filter((row) => row.user_id !== 'u-mech');
  const after = await call('GET', '/api/mechanic/parts', { token: 'tok-mech' });
  assert.equal(after.status, 403);
  assert.equal(after.body.code, 'TENANT_CONTEXT_REVOKED');
});

test('the existing parts master remains unique per Garage tenant and no parallel master is introduced', () => {
  const sql = readFileSync(new URL('../../database/migrations/009_phase4_schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS mechanic_parts[\s\S]*UNIQUE\s*\(tenant_id,\s*sku\)/i);
  const route = readFileSync(new URL('../routes/partsRoutes.js', import.meta.url), 'utf8');
  assert.match(route, /from\('mechanic_parts'\)/);
  assert.doesNotMatch(route, /garage_parts|parts_inventory|inventory_parts/);
});
