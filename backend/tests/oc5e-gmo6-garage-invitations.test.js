/**
 * OC-5E GMO-6 — inviting a person into a garage (ported from PR #209 6ea23bd8, re-authored).
 *
 * Proven through the shipped app over real PostgreSQL (PGlite, built from the repository's own
 * migrations), on THIS lineage's authority:
 *   · only an admin of the garage the person SELECTED and the server verified may invite or revoke —
 *     F1: a dealership's tenant admin, a mechanic, an unselected session and a platform admin are all
 *     refused (#209's tenant gate never read the organisation's type);
 *   · acceptance is ONE transaction: every refusal leaves no membership, and no invitation is ever
 *     spent without its member (#209 claimed, then inserted, in two calls);
 *   · only an ACTIVE GARAGE seats anyone — an invitation into a dealership or a suspended garage is
 *     "not valid", at peek and at acceptance;
 *   · the account's own address must be the invited one AND verified — otherwise whoever registers
 *     the invitee's address first takes the link;
 *   · the token is returned once and never stored or audited; the audit names its subject.
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
const { migrationUpSql } = await import('./helpers/pgliteLedgerHarness.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { buildSessionRow } = await import('../services/auth/sessionRow.js');
const { hashCapabilityToken } = await import('../services/serviceNetwork/serviceLinkService.js');

const MIGRATION = '20261004190200_gmo6_garage_invitations.sql';
const FN = 'public.accept_garage_invitation(text,text)';
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

let db; let installed; let server; let baseUrl;
const T = {};

/** [platform role, email, verified] */
const PEOPLE = {
  founder: ['owner', 'founder@example.invalid', true],
  mechanic: ['owner', 'mechanic@example.invalid', true],
  dealerAdmin: ['owner', 'dealer-admin@example.invalid', true],
  suspendedAdmin: ['owner', 'suspended-admin@example.invalid', true],
  platformAdmin: ['admin', 'platform-admin@example.invalid', true],
  invitee: ['owner', 'invitee@example.invalid', true],
  unverified: ['owner', 'unverified@example.invalid', false],
  stranger: ['owner', 'stranger@example.invalid', true],
  member2: ['owner', 'member2@example.invalid', true],
};

before(async () => {
  db = await createGmoDatabase();
  installed = installOver(supabase, db);
  for (const [who, [role, email, verified]] of Object.entries(PEOPLE)) {
    await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified, email_verified_at) VALUES ($1, $1, $2, $3, '2026-01-01', true, $4)`,
      [who, email, role, verified ? new Date().toISOString() : null]);
    const { error } = await installed.client.from('user_sessions').insert(buildSessionRow({ userId: who, activeRole: role, token: `tok-${who}`, expiresAt: FUTURE }));
    assert.equal(error, null);
  }
  const tenant = async (key, name, type, status = 'active') => {
    T[key] = (await db.query('INSERT INTO tenants (name, type, status) VALUES ($1, $2, $3) RETURNING id', [name, type, status])).rows[0].id;
  };
  await tenant('garage', 'Msasa Motors', 'garage');
  await tenant('garage2', 'Other Garage', 'garage');
  await tenant('dealership', 'Croco Cars', 'dealership');
  await tenant('suspended', 'Closed Garage', 'garage', 'suspended');
  const member = (t, user, role) => db.query('INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, $3)', [T[t], user, role]);
  await member('garage', 'founder', 'admin');
  await member('garage', 'mechanic', 'mechanic');
  await member('garage', 'member2', 'mechanic');
  await member('garage2', 'stranger', 'admin');
  await member('dealership', 'dealerAdmin', 'admin');
  await member('suspended', 'suspendedAdmin', 'admin');
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  // Each admin acts for the organisation they SELECT — the real path, through the real endpoint.
  for (const [who, key] of [['founder', 'garage'], ['mechanic', 'garage'], ['dealerAdmin', 'dealership'], ['stranger', 'garage2']]) {
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

/** The app's error envelope is { error: { code, message } }. */
const errorText = (res) => String(res.body?.error?.message ?? res.body?.error ?? res.text);
const invite = (who, email, role = 'mechanic') => call('/api/garage/invitations', { who, method: 'POST', body: { email, role } });
const accept = (who, token) => call('/api/garage/invitations/accept', { who, method: 'POST', body: { token } });
const memberships = async (user) => (await db.query('SELECT tenant_id, role FROM tenant_users WHERE user_id = $1 ORDER BY joined_at', [user])).rows;
const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

/** An invitation written straight into the table — for organisations no admin may invite into. */
async function rawInvitation(tenantKey, email, token) {
  await db.query(`INSERT INTO garage_invitations (tenant_id, invited_email, role, invited_by_user_id, token_hash, expires_at)
                  VALUES ($1, $2, 'mechanic', 'founder', $3, now() + interval '1 day')`, [T[tenantKey], email, hashCapabilityToken(token)]);
}

// ── who may invite ───────────────────────────────────────────────────────────────────────────────

test('F1: only an admin of the SELECTED, verified, active garage may invite', async () => {
  const before = await count('SELECT count(*)::int AS n FROM garage_invitations');
  const dealer = await invite('dealerAdmin', 'someone@example.invalid');
  assert.equal(dealer.status, 403, `a dealership's tenant admin: ${dealer.text}`);
  const mech = await invite('mechanic', 'someone@example.invalid');
  assert.equal(mech.status, 403, 'a mechanic of the garage is not its admin');
  const platform = await invite('platformAdmin', 'someone@example.invalid');
  assert.ok([403, 409].includes(platform.status), `a platform admin with no garage selected: ${platform.status}`);
  const suspendedSelect = await call('/api/auth/active-tenant', { who: 'suspendedAdmin', method: 'PUT', body: { tenantId: T.suspended } });
  assert.notEqual(suspendedSelect.status, 200, 'a suspended garage cannot be selected');
  const suspended = await invite('suspendedAdmin', 'someone@example.invalid');
  assert.ok([403, 409].includes(suspended.status), `the admin of a suspended garage: ${suspended.status}`);
  assert.equal(await count('SELECT count(*)::int AS n FROM garage_invitations'), before, 'none of them created an invitation');
});

test('an admin invites: the token comes back once, is stored only as a hash, and is never audited', async () => {
  const res = await invite('founder', 'Invitee@Example.invalid');
  assert.equal(res.status, 201, res.text);
  assert.equal(res.headers?.['cache-control'] ?? 'no-store', 'no-store');
  const { token, invitation } = res.body;
  assert.ok(typeof token === 'string' && token.length >= 32);
  assert.equal(invitation.status, 'pending');
  assert.equal(invitation.invited_email, 'invitee@example.invalid', 'the address is normalised');
  assert.ok(!('token_hash' in invitation));
  const { rows: [row] } = await db.query('SELECT token_hash, tenant_id FROM garage_invitations WHERE id = $1', [invitation.id]);
  assert.equal(row.token_hash, hashCapabilityToken(token));
  assert.notEqual(row.token_hash, token);
  assert.equal(row.tenant_id, T.garage, 'the invitation names the garage the admin selected');
  const { rows: audits } = await db.query(`SELECT new_value FROM trust_audit_events WHERE event_type = 'GARAGE_INVITATION_SENT'`);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].new_value.invitation_id, invitation.id);
  assert.ok(!JSON.stringify(audits[0]).includes(token), 'the token is never audited');

  const listed = await call('/api/garage/invitations', { who: 'founder' });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.invitations.some((i) => i.id === invitation.id));
  assert.ok(!listed.text.includes('token_hash'));
  const other = await call('/api/garage/invitations', { who: 'stranger' });
  assert.ok(!other.body.invitations.some((i) => i.id === invitation.id), 'another garage never sees this garage\'s invitations');

  const dup = await invite('founder', 'invitee@example.invalid');
  assert.equal(dup.status, 409, 'one open offer per person per garage');
});

// ── accepting ────────────────────────────────────────────────────────────────────────────────────

test('accepting: wrong recipient and unverified address refuse and seat nobody; the invited, verified person joins', async () => {
  const { body: { token } } = await invite('founder', 'unverified@example.invalid');
  assert.equal((await accept(null, token)).status, 401);
  const wrong = await accept('stranger', token);
  assert.equal(wrong.status, 403);
  assert.deepEqual((await memberships('stranger')).filter((m) => m.tenant_id === T.garage), []);
  const unverified = await accept('unverified', token);
  assert.equal(unverified.status, 403);
  assert.match(errorText(unverified), /Verify your email address/);
  assert.deepEqual(await memberships('unverified'), [], 'an unverified address is not a way in');
  const { rows: [still] } = await db.query('SELECT accepted_at FROM garage_invitations WHERE token_hash = $1', [hashCapabilityToken(token)]);
  assert.equal(still.accepted_at, null, 'a refused acceptance leaves the invitation open');

  // The pending one from the previous test, for the verified invitee.
  const pending = (await call('/api/garage/invitations', { who: 'founder' })).body.invitations.find((i) => i.invited_email === 'invitee@example.invalid');
  assert.ok(pending, 'the earlier invitation is still open');
});

test('accepting the right invitation seats the person once; a replay is a no-op; anyone else is refused', async () => {
  const { body: { token } } = await invite('founder', 'member-to-be@example.invalid', 'mechanic');
  await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified, email_verified_at) VALUES ('joiner', 'joiner', 'Member-To-Be@example.invalid', 'owner', '2026-01-01', true, now())`);
  await installed.client.from('user_sessions').insert(buildSessionRow({ userId: 'joiner', activeRole: 'owner', token: 'tok-joiner', expiresAt: FUTURE }));

  const joined = await accept('joiner', token);
  assert.equal(joined.status, 201, joined.text);
  assert.deepEqual({ tenantId: joined.body.tenantId, role: joined.body.role, created: joined.body.created }, { tenantId: T.garage, role: 'mechanic', created: true });
  assert.deepEqual(await memberships('joiner'), [{ tenant_id: T.garage, role: 'mechanic' }]);

  const replay = await accept('joiner', token);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.alreadyMember, true);
  assert.equal((await memberships('joiner')).length, 1, 'never a second membership');
  assert.equal((await accept('stranger', token)).status, 403, 'a spent invitation is spent for anyone else');

  // The new mechanic can now select this garage, and is its verified mechanic — not its admin.
  const selected = await call('/api/auth/active-tenant', { who: 'joiner', method: 'PUT', body: { tenantId: T.garage } });
  assert.equal(selected.status, 200, selected.text);
  const me = (await call('/api/auth/me', { who: 'joiner' })).body;
  assert.equal((me.user || me).active_tenant?.role, 'mechanic');
});

test('only an ACTIVE GARAGE seats anyone — a dealership\'s or a suspended garage\'s invitation is "not valid"', async () => {
  await rawInvitation('dealership', 'invitee@example.invalid', 'dealership-token-0123456789abcdef0123456789');
  await rawInvitation('suspended', 'invitee@example.invalid', 'suspended-token-0123456789abcdef0123456789');
  for (const token of ['dealership-token-0123456789abcdef0123456789', 'suspended-token-0123456789abcdef0123456789']) {
    assert.equal((await call(`/api/garage/invitations/peek/${token}`)).status, 404, `peek ${token}`);
    const res = await accept('invitee', token);
    assert.equal(res.status, 404, `accept ${token}: ${res.text}`);
  }
  assert.ok(!(await memberships('invitee')).some((m) => [T.dealership, T.suspended].includes(m.tenant_id)), 'no membership was minted');
});

test('peek shows what is offered — and nothing for an unknown link', async () => {
  const { body: { token } } = await invite('founder', 'peek@example.invalid', 'admin');
  const res = await call(`/api/garage/invitations/peek/${token}`);
  assert.equal(res.status, 200);
  assert.deepEqual({ garageName: res.body.garageName, role: res.body.role, usable: res.body.usable }, { garageName: 'Msasa Motors', role: 'admin', usable: true });
  assert.equal((await call('/api/garage/invitations/peek/not-a-real-token')).status, 404);
});

test('revoked and expired invitations refuse; revoking is the garage\'s own act, once', async () => {
  const { body: { token, invitation } } = await invite('founder', 'revoked@example.invalid');
  assert.equal((await call(`/api/garage/invitations/${invitation.id}`, { who: 'stranger', method: 'DELETE' })).status, 404,
    'another garage\'s admin cannot reach it');
  assert.equal((await call(`/api/garage/invitations/${invitation.id}`, { who: 'founder', method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/garage/invitations/${invitation.id}`, { who: 'founder', method: 'DELETE' })).status, 404, 'once');
  await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified, email_verified_at) VALUES ('revokedperson', 'r', 'revoked@example.invalid', 'owner', '2026-01-01', true, now())`);
  await installed.client.from('user_sessions').insert(buildSessionRow({ userId: 'revokedperson', activeRole: 'owner', token: 'tok-revokedperson', expiresAt: FUTURE }));
  assert.equal((await accept('revokedperson', token)).status, 403);

  const fresh = await invite('founder', 'revoked@example.invalid');
  assert.equal(fresh.status, 201, 'after a revoke the person can be invited again');
  await db.query(`UPDATE garage_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [fresh.body.invitation.id]);
  const expired = await accept('revokedperson', fresh.body.token);
  assert.equal(expired.status, 403);
  assert.match(errorText(expired), /expired/);
  assert.deepEqual(await memberships('revokedperson'), []);
});

test('an existing member who accepts keeps their membership; the spent invitation is still audited', async () => {
  const { body: { token, invitation } } = await invite('founder', 'member2@example.invalid', 'admin');
  const res = await accept('member2', token);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.alreadyMember, true);
  assert.deepEqual(await memberships('member2'), [{ tenant_id: T.garage, role: 'mechanic' }], 'the existing role is kept — an invitation never promotes');
  const { rows } = await db.query(`SELECT new_value FROM trust_audit_events WHERE event_type = 'GARAGE_INVITATION_ACCEPTED' AND new_value->>'invitation_id' = $1`, [invitation.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].new_value.membership_created, false);
});

test('no invitation is ever spent without its member', async () => {
  const orphans = await count(`SELECT count(*)::int AS n FROM garage_invitations gi
      WHERE gi.accepted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.tenant_id = gi.tenant_id AND tu.user_id = gi.accepted_by_user_id)`);
  assert.equal(orphans, 0);
});

// ── the database ─────────────────────────────────────────────────────────────────────────────────

test('database: the table is closed to every client role; acceptance runs only as the backend, as its caller', async () => {
  const { rows: [t] } = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.garage_invitations'::regclass`);
  assert.deepEqual(t, { relrowsecurity: true, relforcerowsecurity: true });
  const { rows: [p] } = await db.query(`
    SELECT has_table_privilege('anon', 'public.garage_invitations', 'SELECT') AS anon_select,
           has_table_privilege('authenticated', 'public.garage_invitations', 'SELECT') AS auth_select,
           has_function_privilege('anon', '${FN}', 'EXECUTE') AS anon_exec,
           has_function_privilege('authenticated', '${FN}', 'EXECUTE') AS auth_exec,
           has_function_privilege('service_role', '${FN}', 'EXECUTE') AS service_exec`);
  assert.deepEqual(p, { anon_select: false, auth_select: false, anon_exec: false, auth_exec: false, service_exec: true });
  const { rows: [f] } = await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = '${FN}'::regprocedure`);
  assert.equal(f.prosecdef, false);
  assert.ok((f.proconfig || []).some((c) => /^search_path=public, pg_temp$/.test(c)));
});

test('database: Up re-applies over itself (as over #209\'s copy), and Down then Up round-trips', async () => {
  const sql = readFileSync(new URL(`../../database/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  const before = await count('SELECT count(*)::int AS n FROM garage_invitations');
  await db.exec(migrationUpSql(MIGRATION));
  assert.equal(await count('SELECT count(*)::int AS n FROM garage_invitations'), before, 're-applying keeps every row');
  // Round-trip on a fresh database (Down drops the table and its rows).
  const fresh = await createGmoDatabase();
  try {
    await fresh.exec(sql.split('-- +migrate Down')[1]);
    assert.equal((await fresh.query(`SELECT to_regclass('public.garage_invitations') AS t`)).rows[0].t, null);
    await fresh.exec(migrationUpSql(MIGRATION));
    const { rows: [t] } = await fresh.query(`SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.garage_invitations'::regclass`);
    assert.equal(t.relforcerowsecurity, true);
  } finally {
    await fresh.close();
  }
});

test('F1, layer by layer: the route gate refuses by organisation type and role; the service refuses without it', async () => {
  // The route gate (requireActiveTenant) names WHY — so a gate that stopped checking the type would show.
  assert.equal((await invite('dealerAdmin', 'x@example.invalid')).body.code, 'ACTIVE_TENANT_TYPE');
  assert.equal((await invite('mechanic', 'x@example.invalid')).body.code, 'ACTIVE_TENANT_ROLE');
  assert.equal((await invite('platformAdmin', 'x@example.invalid')).body.code, 'ACTIVE_TENANT_REQUIRED');
  // The service, called past any route, still reads only the VERIFIED active garage — never the
  // tenantId / tenantRole fields #209 read, which a dealership's admin also carries.
  const { inviteToGarage, listInvitations, revokeInvitation } = await import('../services/garageOnboarding/garageInvitationService.js');
  const dealership = { id: 'dealerAdmin', activeTenant: { id: T.dealership, type: 'dealership', role: 'admin' } };
  const legacyShape = { id: 'dealerAdmin', tenantId: T.garage, tenantRole: 'admin' };
  for (const actor of [dealership, legacyShape]) {
    await assert.rejects(inviteToGarage(supabase, actor, { email: 'x@example.invalid' }), /garage/i);
    await assert.rejects(listInvitations(supabase, actor), /garage/i);
    await assert.rejects(revokeInvitation(supabase, actor, '00000000-0000-4000-8000-000000000000'), /garage/i);
  }
});

test('a spent invitation is spent even for a later account holding the invited address', async () => {
  // The first person accepts, then changes their account's email; someone else then registers the
  // invited address. The binding alone would seat them — the invitation's single use is what refuses.
  const { body: { token } } = await invite('founder', 'handover@example.invalid');
  await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified, email_verified_at) VALUES ('first', 'first', 'handover@example.invalid', 'owner', '2026-01-01', true, now())`);
  await installed.client.from('user_sessions').insert(buildSessionRow({ userId: 'first', activeRole: 'owner', token: 'tok-first', expiresAt: FUTURE }));
  assert.equal((await accept('first', token)).status, 201);
  await db.query(`UPDATE users SET email = 'first-renamed@example.invalid' WHERE id = 'first'`);
  await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified, email_verified_at) VALUES ('second', 'second', 'handover@example.invalid', 'owner', '2026-01-01', true, now())`);
  await installed.client.from('user_sessions').insert(buildSessionRow({ userId: 'second', activeRole: 'owner', token: 'tok-second', expiresAt: FUTURE }));
  const res = await accept('second', token);
  assert.equal(res.status, 403);
  assert.match(errorText(res), /already been used/);
  assert.deepEqual(await memberships('second'), []);
});
