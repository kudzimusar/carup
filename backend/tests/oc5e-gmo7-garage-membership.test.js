/**
 * OC-5E GMO-7 — who works in a garage (ported from PR #209 6ea23bd8, re-authored).
 *
 * Through the shipped app over real PostgreSQL (PGlite, the repository's own migrations):
 *   · only an admin of the garage the person SELECTED and the server verified may list, remove or
 *     re-role its members (F1: a dealership's tenant admin, a mechanic and a platform admin are
 *     refused — #209's gate read `actor.tenantId`, which they all carry);
 *   · removing someone ends what they can do NEXT — the verifier re-reads membership on the next
 *     request — and touches nothing they already did;
 *   · a garage is never left without an administrator: the guard is enforced under a lock on the
 *     garage (#209 counted and then acted in two calls, so two admins demoting each other at once left
 *     it with none). PGlite has one connection, so the race itself is not reproduced here; the guard's
 *     sequential answer and the lock's presence are;
 *   · every change is audited with the membership and the role it replaced.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { createGmoDatabase, installOver } = await import('./helpers/gmoGarageWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { buildSessionRow } = await import('../services/auth/sessionRow.js');

const MIGRATION = '20261004190300_gmo7_garage_membership_guard.sql';
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

let db; let installed; let server; let baseUrl;
const T = {};
const PEOPLE = { founder: 'owner', coAdmin: 'owner', mechanic: 'owner', mechanic2: 'owner', dealerAdmin: 'owner', platformAdmin: 'admin', soloAdmin: 'owner' };

before(async () => {
  db = await createGmoDatabase();
  installed = installOver(supabase, db);
  for (const [who, role] of Object.entries(PEOPLE)) {
    await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified, email_verified_at) VALUES ($1, $2, $3, $4, '2026-01-01', true, now())`,
      [who, `Name of ${who}`, `${who}@example.invalid`, role]);
    const { error } = await installed.client.from('user_sessions').insert(buildSessionRow({ userId: who, activeRole: role, token: `tok-${who}`, expiresAt: FUTURE }));
    assert.equal(error, null);
  }
  const tenant = async (key, name, type) => { T[key] = (await db.query('INSERT INTO tenants (name, type, status) VALUES ($1, $2, \'active\') RETURNING id', [name, type])).rows[0].id; };
  await tenant('garage', 'Msasa Motors', 'garage');
  await tenant('solo', 'Solo Garage', 'garage');
  await tenant('dealership', 'Croco Cars', 'dealership');
  const member = (t, user, role) => db.query('INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, $3)', [T[t], user, role]);
  await member('garage', 'founder', 'admin');
  await member('garage', 'coAdmin', 'admin');
  await member('garage', 'mechanic', 'mechanic');
  await member('garage', 'mechanic2', 'mechanic');
  await member('dealership', 'dealerAdmin', 'admin');
  await member('solo', 'soloAdmin', 'admin');
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [who, key] of [['founder', 'garage'], ['coAdmin', 'garage'], ['mechanic', 'garage'], ['mechanic2', 'garage'], ['dealerAdmin', 'dealership'], ['soloAdmin', 'solo']]) {
    const res = await call('/api/auth/active-tenant', { who, method: 'PUT', body: { tenantId: T[key] } });
    assert.equal(res.status, 200, `${who} selects ${key}: ${res.text}`);
  }
});

after(async () => {
  installed?.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

async function call(path, { who = null, method = 'GET', body } = {}) {
  const headers = { 'x-bypass-rate-limit': 'true', 'content-type': 'application/json' };
  if (who) headers['x-session-token'] = `tok-${who}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

const roleOf = async (tenantKey, user) => (await db.query('SELECT role FROM tenant_users WHERE tenant_id = $1 AND user_id = $2', [T[tenantKey], user])).rows[0]?.role ?? null;
const refusal = async (promise) => { try { await promise; return null; } catch (error) { return error.message; } };

test('F1: only an admin of the SELECTED, verified garage manages its team', async () => {
  for (const who of ['dealerAdmin', 'mechanic', 'platformAdmin']) {
    const res = await call('/api/garage/members', { who });
    assert.ok([403, 409].includes(res.status), `${who}: ${res.status}`);
    assert.ok([403, 409].includes((await call('/api/garage/members/mechanic2', { who, method: 'DELETE' })).status), `${who} cannot remove`);
  }
  assert.equal(await roleOf('garage', 'mechanic2'), 'mechanic', 'nobody refused changed anything');
});

test('the admin sees the team, by name and role, with what may be removed', async () => {
  const res = await call('/api/garage/members', { who: 'founder' });
  assert.equal(res.status, 200, res.text);
  const byUser = Object.fromEntries(res.body.members.map((m) => [m.userId, m]));
  assert.deepEqual(Object.keys(byUser).sort(), ['coAdmin', 'founder', 'mechanic', 'mechanic2']);
  assert.equal(byUser.founder.displayName, 'Name of founder');
  assert.equal(res.body.adminCount, 2);
  assert.equal(byUser.founder.removable, true, 'with two admins, either may go');
  const solo = await call('/api/garage/members', { who: 'soloAdmin' });
  assert.equal(solo.body.members[0].removable, false, 'the only admin is not removable');
});

test('removing someone ends what they can do NEXT — their next request no longer carries the garage', async () => {
  const res = await call('/api/garage/members/mechanic', { who: 'founder', method: 'DELETE' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual({ removed: res.body.removed, previousRole: res.body.previousRole }, { removed: true, previousRole: 'mechanic' });
  assert.equal(await roleOf('garage', 'mechanic'), null);
  const me = (await call('/api/auth/me', { who: 'mechanic' })).body;
  assert.ok(!(me.user || me).active_tenant, 'the removed person\'s session no longer acts for the garage');
  const { rows } = await db.query(`SELECT previous_value, new_value FROM trust_audit_events WHERE event_type = 'GARAGE_MEMBERSHIP_REVOKED'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].previous_value.role, 'mechanic');
  assert.equal(rows[0].new_value.user_id, 'mechanic');
  assert.ok(rows[0].new_value.membership_id, 'the audit names the membership it ended');
  assert.equal((await call('/api/garage/members/mechanic', { who: 'founder', method: 'DELETE' })).status, 404, 'once');
});

test('a garage is never left without an administrator — by removal or by demotion', async () => {
  assert.equal((await call('/api/garage/members/soloAdmin', { who: 'soloAdmin', method: 'DELETE' })).status, 409);
  assert.equal((await call('/api/garage/members/soloAdmin/role', { who: 'soloAdmin', method: 'PATCH', body: { role: 'mechanic' } })).status, 409);
  assert.equal(await roleOf('solo', 'soloAdmin'), 'admin');

  // Two admins: one hands over by demoting the other — then the remaining one cannot step down.
  const demoted = await call('/api/garage/members/coAdmin/role', { who: 'founder', method: 'PATCH', body: { role: 'mechanic' } });
  assert.equal(demoted.status, 200, demoted.text);
  assert.deepEqual({ changed: demoted.body.changed, role: demoted.body.role, previousRole: demoted.body.previousRole }, { changed: true, role: 'mechanic', previousRole: 'admin' });
  assert.equal((await call('/api/garage/members/founder/role', { who: 'founder', method: 'PATCH', body: { role: 'mechanic' } })).status, 409);
  assert.equal(await roleOf('garage', 'founder'), 'admin');
  const { rows } = await db.query(`SELECT previous_value, new_value FROM trust_audit_events WHERE event_type = 'GARAGE_MEMBERSHIP_ROLE_CHANGED'`);
  assert.deepEqual(rows.map((r) => [r.previous_value.role, r.new_value.role]), [['admin', 'mechanic']]);
  // …and the demoted admin's next request no longer carries admin authority.
  assert.ok([403, 409].includes((await call('/api/garage/members', { who: 'coAdmin' })).status));
});

test('validation: an invented role, a non-member, the same role', async () => {
  assert.equal((await call('/api/garage/members/mechanic2/role', { who: 'founder', method: 'PATCH', body: { role: 'owner' } })).status, 400);
  assert.equal((await call('/api/garage/members/nobody/role', { who: 'founder', method: 'PATCH', body: { role: 'admin' } })).status, 404);
  const same = await call('/api/garage/members/mechanic2/role', { who: 'founder', method: 'PATCH', body: { role: 'mechanic' } });
  assert.equal(same.status, 200);
  assert.equal(same.body.changed, false);
});

test('database: the guard under the lock — two admins demoting each other leave exactly one', async () => {
  const g = (await db.query(`INSERT INTO tenants (name, type, status) VALUES ('Pair Garage', 'garage', 'active') RETURNING id`)).rows[0].id;
  await db.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, 'founder', 'admin'), ($1, 'coAdmin', 'admin')`, [g]);
  await db.query(`SELECT public.change_garage_member_role($1, 'coAdmin', 'mechanic', 'founder')`, [g]);
  assert.match(await refusal(db.query(`SELECT public.change_garage_member_role($1, 'founder', 'mechanic', 'coAdmin')`, [g])), /GARAGE_MEMBERSHIP_LAST_ADMIN/);
  assert.match(await refusal(db.query(`SELECT public.remove_garage_member($1, 'founder', 'coAdmin')`, [g])), /GARAGE_MEMBERSHIP_LAST_ADMIN/);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM tenant_users WHERE tenant_id = $1 AND role = 'admin'`, [g]);
  assert.equal(rows[0].n, 1);
  // Not a garage: the functions refuse a dealership outright.
  assert.match(await refusal(db.query(`SELECT public.remove_garage_member($1, 'dealerAdmin', 'founder')`, [T.dealership])), /GARAGE_MEMBERSHIP_NOT_A_GARAGE/);
  assert.match(await refusal(db.query(`SELECT public.change_garage_member_role($1, 'founder', 'owner', 'founder')`, [g])), /GARAGE_MEMBERSHIP_ROLE_INVALID/);
});

test('database: both functions lock the garage first, run as the backend only, as their caller', async () => {
  const sql = readFileSync(new URL(`../../database/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  const up = sql.split('-- +migrate Down')[0];
  assert.equal((up.match(/FROM public\.tenants WHERE id = p_tenant_id FOR UPDATE;/g) || []).length, 2, 'each function locks the garage before it counts');
  for (const fn of ['public.remove_garage_member(uuid,text,text)', 'public.change_garage_member_role(uuid,text,text,text)']) {
    const { rows: [p] } = await db.query(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', '${fn}', 'EXECUTE') AS auth, has_function_privilege('service_role', '${fn}', 'EXECUTE') AS service,
      (SELECT prosecdef FROM pg_proc WHERE oid = '${fn}'::regprocedure) AS definer`);
    assert.deepEqual(p, { anon: false, auth: false, service: true, definer: false }, fn);
  }
});

test('F1, layer by layer: the route gate refuses by organisation type and role; the service refuses without it', async () => {
  assert.equal((await call('/api/garage/members', { who: 'dealerAdmin' })).body.code, 'ACTIVE_TENANT_TYPE');
  assert.equal((await call('/api/garage/members', { who: 'mechanic2' })).body.code, 'ACTIVE_TENANT_ROLE');
  assert.equal((await call('/api/garage/members', { who: 'platformAdmin' })).body.code, 'ACTIVE_TENANT_REQUIRED');
  const { listMembers, removeMember, changeMemberRole } = await import('../services/garageOnboarding/garageMembershipService.js');
  const dealership = { id: 'dealerAdmin', activeTenant: { id: T.dealership, type: 'dealership', role: 'admin' } };
  const legacyShape = { id: 'dealerAdmin', tenantId: T.garage, tenantRole: 'admin' };
  for (const actor of [dealership, legacyShape]) {
    await assert.rejects(listMembers(supabase, actor), /garage/i);
    await assert.rejects(removeMember(supabase, actor, 'mechanic2'), /garage/i);
    await assert.rejects(changeMemberRole(supabase, actor, 'mechanic2', 'admin'), /garage/i);
  }
  assert.equal(await roleOf('garage', 'mechanic2'), 'mechanic', 'nothing changed');
});
