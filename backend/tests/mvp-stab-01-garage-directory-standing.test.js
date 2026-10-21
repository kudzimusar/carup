/**
 * CARUP-MVP-STAB-01 SVC-008 — a public garage listing stands only while its garage does.
 *
 * `publication_status = 'published'` was the only public condition: a garage whose tenant CarUp had
 * suspended stayed listed, and a published profile hanging off a tenant that is not a garage at all
 * was listed as a garage. The public reads now also require the profile's tenant to be a GARAGE whose
 * status is ACTIVE — read the way the one tenant-context verifier reads it (activeTenantContext.js:
 * type compared case-insensitively; an absent status is the column's default, 'active').
 *
 * Real PostgreSQL (PGlite) from the repository's own migrations (the GMO world + the Service Network
 * S1 garage identity migration), the REAL service, and the shipped public routes.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { createGmoDatabase, installOver } = await import('./helpers/gmoGarageWorld.js');
const { migrationUpSql } = await import('./helpers/pgliteLedgerHarness.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { getPublicGarageDirectory, getPublicGarageDetail } = await import('../services/serviceNetwork/garageDirectoryService.js');

const TENANTS = {
  active: ['11111111-aaaa-4aaa-8aaa-111111111111', 'Active Motors', 'garage', 'active'],
  suspended: ['22222222-aaaa-4aaa-8aaa-222222222222', 'Suspended Motors', 'garage', 'suspended'],
  dealership: ['33333333-aaaa-4aaa-8aaa-333333333333', 'Not A Garage Dealers', 'dealership', 'active'],
  // The column default: a garage written without a status IS active (002: status TEXT DEFAULT 'active').
  defaulted: ['44444444-aaaa-4aaa-8aaa-444444444444', 'Default Status Motors', 'garage', undefined],
  // An explicit NULL status (the column is nullable) reads as the default, exactly as
  // resolveVerifiedActiveTenant reads it — the directory never disagrees with workspace authority.
  nullstatus: ['66666666-aaaa-4aaa-8aaa-666666666666', 'Null Status Motors', 'garage', null],
  // Type is compared the way the tenant-context verifier compares it.
  capitalised: ['55555555-aaaa-4aaa-8aaa-555555555555', 'Capital Type Motors', 'Garage', 'Active'],
};
const slugOf = (key) => `${key}-motors`;

let db; let installed; let server; let baseUrl;

before(async () => {
  db = await createGmoDatabase();
  await db.exec(migrationUpSql('20261004180000_service_network_s1_garage_identity.sql'));
  installed = installOver(supabase, db);
  await db.query(`INSERT INTO users (id, name, email, role, join_date) VALUES ('stab01-garage-admin', 'Admin', 'admin@example.invalid', 'owner', '2026-01-01')`);
  for (const [key, [id, name, type, status]] of Object.entries(TENANTS)) {
    if (status === undefined) await db.query('INSERT INTO tenants (id, name, type) VALUES ($1, $2, $3)', [id, name, type]);
    else await db.query('INSERT INTO tenants (id, name, type, status) VALUES ($1, $2, $3, $4)', [id, name, type, status]);
    await db.query(
      `INSERT INTO garage_public_profiles (tenant_id, display_name, slug, publication_status, location_city, service_categories, published_at, created_by_user_id)
       VALUES ($1, $2, $3, 'published', 'Harare', ARRAY['brakes'], now(), 'stab01-garage-admin')`,
      [id, name, slugOf(key)]);
  }
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  installed?.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

const LISTED = ['active', 'defaulted', 'nullstatus', 'capitalised'];
const HIDDEN = ['suspended', 'dealership'];

test('service: the directory lists a published profile only while its tenant is an active garage', async () => {
  const { garages, total } = await getPublicGarageDirectory(installed.client, {});
  assert.deepEqual(garages.map((g) => g.slug).sort(), LISTED.map(slugOf).sort());
  assert.equal(total, LISTED.length, 'the count is of what is listed, not of what was read');
});

test('service: detail is "not found" for a suspended garage and for a non-garage tenant — the same answer as unpublished', async () => {
  for (const key of LISTED) {
    const detail = await getPublicGarageDetail(installed.client, slugOf(key));
    assert.equal(detail.garage.slug, slugOf(key));
  }
  for (const key of HIDDEN) {
    await assert.rejects(getPublicGarageDetail(installed.client, slugOf(key)), (err) => err.name === 'NotFoundError' && /Garage not found/.test(err.message),
      `${key} must read exactly like a garage that does not exist`);
  }
});

test('service: reinstating a garage brings its listing back; suspending it removes it — nothing else changes', async () => {
  const [suspendedId] = TENANTS.suspended;
  await db.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [suspendedId]);
  assert.ok((await getPublicGarageDirectory(installed.client, {})).garages.some((g) => g.slug === slugOf('suspended')));
  await db.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [suspendedId]);
  assert.ok(!(await getPublicGarageDirectory(installed.client, {})).garages.some((g) => g.slug === slugOf('suspended')));
  const { rows: [profile] } = await db.query('SELECT publication_status FROM garage_public_profiles WHERE tenant_id = $1', [suspendedId]);
  assert.equal(profile.publication_status, 'published', 'the public read filters; it never rewrites the garage\'s own publication');
});

/** A query chain that answers `result` however it is built, so the fault does not depend on the query's shape. */
function answering(result) {
  const chain = new Proxy({}, {
    get: (_target, prop) => (prop === 'then' ? (resolve, reject) => Promise.resolve(result).then(resolve, reject) : () => chain),
  });
  return chain;
}

test('service: a tenant read that fails is a failure, never an empty directory', async () => {
  const broken = {
    from: (table) => (table === 'tenants'
      ? answering({ data: null, error: { message: 'tenants unavailable' } })
      : installed.client.from(table)),
  };
  await assert.rejects(getPublicGarageDirectory(broken, {}), (err) => err.name === 'DatabaseError');
  await assert.rejects(getPublicGarageDetail(broken, slugOf('active')), (err) => err.name === 'DatabaseError');
});

test('shipped: the public routes apply the same standing', async () => {
  const list = await fetch(`${baseUrl}/api/garage-directory`, { headers: { 'x-bypass-rate-limit': 'true' } });
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.deepEqual(body.garages.map((g) => g.slug).sort(), LISTED.map(slugOf).sort());
  assert.ok(body.garages.every((g) => !('tenant_id' in g)), 'the tenant UUID is still never public');
  for (const key of HIDDEN) {
    const res = await fetch(`${baseUrl}/api/garage-directory/${slugOf(key)}`, { headers: { 'x-bypass-rate-limit': 'true' } });
    assert.equal(res.status, 404, `${key} is not public`);
  }
  const ok = await fetch(`${baseUrl}/api/garage-directory/${slugOf('active')}`, { headers: { 'x-bypass-rate-limit': 'true' } });
  assert.equal(ok.status, 200);
});
