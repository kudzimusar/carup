/**
 * OC-5H — RC2 journey J3: a garage is born and hires its first mechanic.
 *
 * One path through the SHIPPED app, over real PostgreSQL (PGlite) built only from the repository's own
 * migrations (helpers/gmoGarageWorld.js — the GMO decision, activation, invitation and membership
 * functions run for real; Supabase's default privileges are applied):
 *
 *   a submitted application → the reviewer re-proves their password (X3 step-up) → approves → the
 *   workspace is built in the same request → the founder is offered the garage and CHOOSES it (OC-5D)
 *   → invites a mechanic by address → the mechanic, whose own verified address it is, accepts → the
 *   mechanic chooses the garage → both appear on the team; nobody else ever could.
 *
 * AI: NONE. No step calls a model; a fetch guard refuses anything that leaves this process and the
 * file asserts zero escaped calls. (The applicant's evidence extraction is RC1's C3 path, proven with
 * Cloudflare intercepted in its own suites; it is upstream of this journey.)
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

const { createGmoDatabase, installOver, seedApprovedIdentity, seedSubmittedApplication } = await import('./helpers/gmoGarageWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { buildSessionRow } = await import('../services/auth/sessionRow.js');
const { hashPassword } = await import('../utils/passwordAuth.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const REVIEWER_PASSWORD = 'oc5h-reviewer-correct-horse';

const realFetch = globalThis.fetch;
const escapedCalls = [];
globalThis.fetch = async (url, init) => {
  const target = String(url?.url || url);
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target)) return realFetch(url, init);
  escapedCalls.push(target);
  throw new Error(`OC-5H J3 calls no provider or remote service; refused ${target}`);
};

/** [platform role, email] — every address verified (acceptance requires the invitee's own, verified). */
const PEOPLE = {
  founder: ['owner', 'founder@example.invalid'],
  mechanic: ['owner', 'mechanic@example.invalid'],
  reviewer: ['admin', 'reviewer@example.invalid'],
  stranger: ['owner', 'stranger@example.invalid'],
};

let db; let installed; let server; let baseUrl;

before(async () => {
  db = await createGmoDatabase();
  // The reviewer re-proves a real password (X3 step-up), so the column the auth contract added is
  // applied from its own migration, verbatim.
  const passwordMigration = readFileSync(new URL('../../database/migrations/20260613010000_users_password_hash.sql', import.meta.url), 'utf8');
  const statement = 'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;';
  assert.ok(passwordMigration.includes(statement), 'the password_hash statement is no longer in its migration');
  await db.exec(statement);
  installed = installOver(supabase, db);
  for (const [who, [role, email]] of Object.entries(PEOPLE)) {
    await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified, email_verified_at) VALUES ($1, $1, $2, $3, '2026-01-01', true, $4)`,
      [who, email, role, new Date().toISOString()]);
    const { error } = await installed.client.from('user_sessions').insert(buildSessionRow({ userId: who, activeRole: role, token: `tok-${who}`, expiresAt: FUTURE }));
    assert.equal(error, null, `session for ${who}`);
  }
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(REVIEWER_PASSWORD), 'reviewer']);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  installed?.restore();
  globalThis.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

async function call(path, { who = null, method = 'GET', body } = {}) {
  const headers = { 'x-bypass-rate-limit': 'true', 'content-type': 'application/json' };
  if (who) headers['x-session-token'] = `tok-${who}`;
  const res = await realFetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}
const memberships = async (user) => (await db.query('SELECT tenant_id, role FROM tenant_users WHERE user_id = $1', [user])).rows;

test('J3 [AI: NONE] a garage is born — reviewed under step-up, built once, chosen by its founder — and hires its first mechanic', async () => {
  await seedApprovedIdentity(db, 'founder');
  const application = await seedSubmittedApplication(db, 'founder', { tradingName: 'Glen View Motors' });

  // The reviewer sees it, but cannot decide on a stale session: authority changes need a fresh proof.
  const queue = await call('/api/admin/garage-applications', { who: 'reviewer' });
  assert.equal(queue.status, 200, queue.text);
  assert.ok(JSON.stringify(queue.body).includes(application.id), 'the submitted application is in the review queue');
  const stale = await call(`/api/admin/garage-applications/${application.id}/decision`, { who: 'reviewer', method: 'POST', body: { decision: 'approve' } });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, 'STEP_UP_REQUIRED');

  const stepUp = await call('/api/auth/step-up', { who: 'reviewer', method: 'POST', body: { password: REVIEWER_PASSWORD } });
  assert.equal(stepUp.status, 200, stepUp.text);
  const approved = await call(`/api/admin/garage-applications/${application.id}/decision`, { who: 'reviewer', method: 'POST', body: { decision: 'approve' } });
  assert.equal(approved.status, 201, approved.text);
  assert.equal(approved.body.application.status, 'approved');
  assert.equal(approved.body.activation?.activated, true, `the workspace is built in the same request: ${approved.text}`);

  // Exactly one garage, with its founder as admin — derived from the approved application.
  const { rows: [built] } = await db.query('SELECT activated_tenant_id FROM garage_applications WHERE id = $1', [application.id]);
  const garage = built.activated_tenant_id;
  assert.ok(garage);
  const { rows: [tenant] } = await db.query('SELECT name, type, status FROM tenants WHERE id = $1', [garage]);
  assert.deepEqual(tenant, { name: 'Glen View Motors', type: 'garage', status: 'active' });
  assert.deepEqual(await memberships('founder'), [{ tenant_id: garage, role: 'admin' }]);

  // The founder is OFFERED the garage — never placed in it — and chooses it.
  const me = await call('/api/auth/me', { who: 'founder' });
  assert.equal(me.body.user.active_tenant_id, null);
  assert.deepEqual(me.body.user.memberships.map((m) => [m.id, m.type, m.role]), [[garage, 'garage', 'admin']]);
  assert.equal((await call('/api/auth/active-tenant', { who: 'founder', method: 'PUT', body: { tenantId: garage } })).status, 200);

  // The founder invites a mechanic by address. The link is returned once, and stored only hashed.
  const invited = await call('/api/garage/invitations', { who: 'founder', method: 'POST', body: { email: PEOPLE.mechanic[1], role: 'mechanic' } });
  assert.equal(invited.status, 201, invited.text);
  const token = invited.body.token;
  assert.ok(token);
  const { rows: stored } = await db.query('SELECT token_hash FROM garage_invitations WHERE tenant_id = $1', [garage]);
  assert.ok(stored.length === 1 && stored[0].token_hash !== token, 'the invitation stores a hash, never the token');

  // Someone else holding the link cannot take the seat: the address must be their own, verified.
  const squatter = await call('/api/garage/invitations/accept', { who: 'stranger', method: 'POST', body: { token } });
  assert.notEqual(squatter.status, 200, squatter.text);
  assert.deepEqual(await memberships('stranger'), []);

  const accepted = await call('/api/garage/invitations/accept', { who: 'mechanic', method: 'POST', body: { token } });
  assert.equal(accepted.status, 201, accepted.text);
  assert.deepEqual(await memberships('mechanic'), [{ tenant_id: garage, role: 'mechanic' }]);
  // Pressing the link again changes nothing — one seat, one transaction.
  const replay = await call('/api/garage/invitations/accept', { who: 'mechanic', method: 'POST', body: { token } });
  assert.equal(replay.status, 200, replay.text);
  assert.deepEqual(await memberships('mechanic'), [{ tenant_id: garage, role: 'mechanic' }]);

  // The mechanic chooses the garage too, and sees the team.
  assert.equal((await call('/api/auth/active-tenant', { who: 'mechanic', method: 'PUT', body: { tenantId: garage } })).status, 200);
  const team = await call('/api/garage/members', { who: 'founder' });
  assert.equal(team.status, 200, team.text);
  const roster = JSON.stringify(team.body);
  for (const who of ['founder', 'mechanic']) assert.ok(roster.includes(who), `${who} is on the team`);
  assert.ok(!roster.includes('stranger'));
});

test('the AI label holds: J3 reached no provider or remote service', () => {
  assert.deepEqual(escapedCalls, []);
});
