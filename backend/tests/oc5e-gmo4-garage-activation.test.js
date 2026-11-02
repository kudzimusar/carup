/**
 * OC-5E GMO-4 — a garage workspace can finally exist (ported from PR #209 6dcf5945).
 *
 * `activate_garage_application` is the one place a garage workspace comes into existence: atomic,
 * serialized, idempotent, and derived entirely from the approved application — no parameter lets a
 * caller choose the tenant, the founder or the role. Proven on real PostgreSQL (PGlite, built from
 * the repository's own migrations), then through the shipped app, end to end on THIS lineage's
 * authority: approval builds the workspace; the founder's session lists it but does not select it
 * (OC-5D — organisations are chosen, never guessed); one explicit selection makes them its verified
 * admin.
 *
 * OC-5E, beyond #209: activation re-checks the applicant's governed identity (a retry can arrive
 * after a suspension); the function is SECURITY INVOKER with a pinned search_path and only
 * service_role may execute it; the audit names the tenant and membership it created.
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
const { migrationUpSql } = await import('./helpers/pgliteLedgerHarness.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { buildSessionRow } = await import('../services/auth/sessionRow.js');
const { activateApprovedApplication } = await import('../services/garageOnboarding/garageActivationService.js');

const MIGRATION = '20261004190100_gmo4_garage_business_activation.sql';
const FN = 'public.activate_garage_application(uuid,text)';
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const REVIEWER = 'gmo4-admin';

let db; let installed; let server; let baseUrl;
let people = 0;

/** A person with a session (stepped up when asked), optionally with an approved identity. */
async function person(role = 'owner', { identity = true, stepUp = false } = {}) {
  people += 1;
  const id = `gmo4-person-${people}`;
  await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified) VALUES ($1, $1, $2, $3, '2026-01-01', true)`,
    [id, `${id}@example.invalid`, role]);
  const { error } = await installed.client.from('user_sessions').insert(buildSessionRow({ userId: id, activeRole: role, token: `tok-${id}`, expiresAt: FUTURE }));
  assert.equal(error, null);
  if (stepUp) {
    await db.query(`UPDATE user_sessions SET auth_method = 'password', step_up_at = $1, step_up_method = 'password_reauth' WHERE token = $2`,
      [new Date().toISOString(), `tok-${id}`]);
  }
  if (identity) await seedApprovedIdentity(db, id);
  return id;
}

/** An application already approved by a reviewer (through the decision function). */
async function approvedApplication({ tradingName = 'Avondale Auto', identity = true } = {}) {
  const applicant = await person('owner', { identity });
  const appRow = await seedSubmittedApplication(db, applicant, { tradingName });
  await db.query(`SELECT public.record_garage_application_decision($1, 'approve', $2, 'admin')`, [appRow.id, REVIEWER]);
  return { applicant, appRow };
}

before(async () => {
  db = await createGmoDatabase();
  installed = installOver(supabase, db);
  await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified) VALUES ($1, 'Reviewer', 'r@example.invalid', 'admin', '2026-01-01', true)`, [REVIEWER]);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  installed?.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

async function call(path, { token = null, method = 'GET', body } = {}) {
  const headers = { 'x-bypass-rate-limit': 'true', 'content-type': 'application/json' };
  if (token) headers['x-session-token'] = token;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

const activate = (applicationId, actor = REVIEWER) => db.query('SELECT * FROM public.activate_garage_application($1, $2)', [applicationId, actor]);
const refusal = async (promise) => { try { await promise; return null; } catch (error) { return error.message; } };
const count = async (table) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

// ── DATABASE ─────────────────────────────────────────────────────────────────────────────────────

test('database: an approved application becomes a garage, with its applicant as the founding admin', async () => {
  const { applicant, appRow } = await approvedApplication({ tradingName: 'Borrowdale Brakes' });
  const { rows: [out] } = await activate(appRow.id);
  assert.equal(out.created, true);
  assert.equal(out.founder_user_id, applicant, 'the founder is the APPLICANT, never the actor who ran it');
  assert.equal(out.founding_role, 'admin');
  const { rows: [tenant] } = await db.query('SELECT name, type, status FROM tenants WHERE id = $1', [out.tenant_id]);
  assert.deepEqual(tenant, { name: 'Borrowdale Brakes', type: 'garage', status: 'active' });
  const { rows: members } = await db.query('SELECT id, user_id, role FROM tenant_users WHERE tenant_id = $1', [out.tenant_id]);
  assert.deepEqual(members, [{ id: out.membership_id, user_id: applicant, role: 'admin' }]);
  const { rows: [claimed] } = await db.query('SELECT activated_tenant_id, activated_at FROM garage_applications WHERE id = $1', [appRow.id]);
  assert.equal(claimed.activated_tenant_id, out.tenant_id);
  assert.ok(claimed.activated_at);
  const { rows: [platform] } = await db.query('SELECT role FROM users WHERE id = $1', [applicant]);
  assert.equal(platform.role, 'owner', 'the platform role is never modified');
});

test('database: activating again returns the same workspace and builds nothing', async () => {
  const { appRow } = await approvedApplication({ tradingName: 'Idempotent Motors' });
  const first = (await activate(appRow.id)).rows[0];
  const tenants = await count('tenants');
  const memberships = await count('tenant_users');
  const again = (await activate(appRow.id)).rows[0];
  assert.equal(again.created, false);
  assert.equal(again.tenant_id, first.tenant_id);
  assert.equal(again.membership_id, first.membership_id, 'the SAME membership — never a second');
  assert.equal(await count('tenants'), tenants);
  assert.equal(await count('tenant_users'), memberships);
});

test('database: only an approved, named application activates — every refusal builds nothing', async () => {
  const tenants = await count('tenants');
  const memberships = await count('tenant_users');
  for (const status of ['submitted', 'draft']) {
    const applicant = await person();
    const appRow = await seedSubmittedApplication(db, applicant, { status, tradingName: `Pending ${status}` });
    assert.match(await refusal(activate(appRow.id)), new RegExp(`GARAGE_APPLICATION_NOT_APPROVED:${status}`));
  }
  const rejectedApplicant = await person();
  const rejected = await seedSubmittedApplication(db, rejectedApplicant, { tradingName: 'Rejected Motors' });
  await db.query(`SELECT public.record_garage_application_decision($1, 'reject', $2, 'admin', NULL, 'Not a garage.')`, [rejected.id, REVIEWER]);
  assert.match(await refusal(activate(rejected.id)), /GARAGE_APPLICATION_NOT_APPROVED:rejected/);

  const { appRow: unnamed } = await approvedApplication({ tradingName: '   ' });
  assert.match(await refusal(activate(unnamed.id)), /GARAGE_APPLICATION_HAS_NO_NAME/);
  assert.match(await refusal(activate('00000000-0000-4000-8000-000000000000')), /GARAGE_APPLICATION_NOT_FOUND/);

  assert.equal(await count('tenants'), tenants, 'no refused activation left a tenant behind');
  assert.equal(await count('tenant_users'), memberships);
});

test('database: only the backend may execute it; it runs as its caller with a pinned search_path; #209\'s shape is kept', async () => {
  const { rows: [p] } = await db.query(
    `SELECT has_function_privilege('anon', '${FN}', 'EXECUTE') AS anon,
            has_function_privilege('authenticated', '${FN}', 'EXECUTE') AS authenticated,
            has_function_privilege('service_role', '${FN}', 'EXECUTE') AS service_role`);
  assert.deepEqual(p, { anon: false, authenticated: false, service_role: true });
  const { rows: [f] } = await db.query(`SELECT prosecdef, proconfig, pg_get_function_result(oid) AS result FROM pg_proc WHERE oid = '${FN}'::regprocedure`);
  assert.equal(f.prosecdef, false);
  assert.ok((f.proconfig || []).some((c) => /^search_path=public, pg_temp$/.test(c)), String(f.proconfig));
  // CREATE OR REPLACE cannot change a RETURNS TABLE: an environment that ran #209's copy must accept this one.
  assert.equal(f.result, 'TABLE(tenant_id uuid, membership_id uuid, founder_user_id text, founding_role text, created boolean)');
});

test('database: Up re-applies cleanly, and Down then Up round-trips', async () => {
  const sql = readFileSync(new URL(`../../database/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  await db.exec(migrationUpSql(MIGRATION));
  await db.exec(sql.split('-- +migrate Down')[1]);
  assert.equal((await db.query(`SELECT 1 FROM pg_proc WHERE proname = 'activate_garage_application'`)).rows.length, 0);
  await db.exec(migrationUpSql(MIGRATION));
  const { rows: [p] } = await db.query(`SELECT has_function_privilege('anon', '${FN}', 'EXECUTE') AS anon`);
  assert.equal(p.anon, false);
});

// ── SERVICE ──────────────────────────────────────────────────────────────────────────────────────

test('service: no workspace for an identity CarUp no longer stands behind — and an unreadable identity refuses, never approves', async () => {
  const actor = { id: REVIEWER, role: 'admin' };
  // Approved while the identity was approved; suspended before activation ran.
  const { appRow } = await approvedApplication({ tradingName: 'Suspended Founder Motors' });
  const tenants = await count('tenants');
  await assert.rejects(
    activateApprovedApplication(supabase, actor, appRow.id, { getIdentityAssurance: async () => ({ usable_for_identity_gated_actions: false, identity_state: 'suspended' }) }),
    /no longer approved \(suspended\)/,
  );
  await assert.rejects(
    activateApprovedApplication(supabase, actor, appRow.id, { getIdentityAssurance: async () => { throw new Error('connection reset'); } }),
    /could not be read just now/,
  );
  assert.equal(await count('tenants'), tenants, 'nothing was built');
  // The real projection approves this applicant: the retry builds it.
  const built = await activateApprovedApplication(supabase, actor, appRow.id);
  assert.equal(built.created, true);
  // An already-built workspace keeps answering, whatever has happened to identity since.
  const again = await activateApprovedApplication(supabase, actor, appRow.id, { getIdentityAssurance: async () => ({ usable_for_identity_gated_actions: false }) });
  assert.equal(again.created, false);
  assert.equal(again.tenantId, built.tenantId);
});

test('service: the activation is audited once, naming the tenant, membership and application it created', async () => {
  const { appRow } = await approvedApplication({ tradingName: 'Audited Motors' });
  const built = await activateApprovedApplication(supabase, { id: REVIEWER, role: 'admin' }, appRow.id);
  assert.equal(built.auditRecorded, true);
  await activateApprovedApplication(supabase, { id: REVIEWER, role: 'admin' }, appRow.id);
  const { rows } = await db.query(
    `SELECT new_value FROM trust_audit_events WHERE event_type = 'GARAGE_WORKSPACE_ACTIVATED' AND new_value->>'application_id' = $1`, [appRow.id]);
  assert.equal(rows.length, 1, 'a no-op retry is not recorded as a second build');
  assert.equal(rows[0].new_value.tenant_id, built.tenantId);
  assert.equal(rows[0].new_value.membership_id, built.membershipId);
  assert.equal(rows[0].new_value.founding_role, 'admin');
});

// ── SHIPPED: approval to a workspace the founder can act for ─────────────────────────────────────

test('shipped: approving builds the workspace; the founder is offered it, selects it, and is its verified admin', async () => {
  const reviewerId = await person('admin', { stepUp: true });
  const founder = await person('owner');
  const appRow = await seedSubmittedApplication(db, founder, { tradingName: 'Mabelreign Motors' });

  const approved = await call(`/api/admin/garage-applications/${appRow.id}/decision`, { token: `tok-${reviewerId}`, method: 'POST', body: { decision: 'approve' } });
  assert.equal(approved.status, 201, approved.text);
  assert.equal(approved.body.application.status, 'approved');
  assert.equal(approved.body.activation.activated, true);
  assert.equal(approved.body.activation.created, true);
  assert.equal(approved.body.activation.foundingRole, 'admin');
  const garageId = approved.body.activation.tenantId;

  // OC-5D: the session LISTS the new organisation and does not select it — chosen, never guessed.
  const me = await call('/api/auth/me', { token: `tok-${founder}` });
  assert.equal(me.status, 200, me.text);
  const user = me.body.user || me.body;
  assert.ok(!user.active_tenant_id, 'login/me never selects an organisation');
  const listed = (user.memberships || []).find((m) => m.id === garageId);
  assert.ok(listed, 'the new garage is offered');
  assert.equal(listed.type, 'garage');
  assert.equal(listed.role, 'admin');
  assert.equal(listed.selectable, true);

  const selected = await call('/api/auth/active-tenant', { token: `tok-${founder}`, method: 'PUT', body: { tenantId: garageId } });
  assert.equal(selected.status, 200, selected.text);
  const after = (await call('/api/auth/me', { token: `tok-${founder}` })).body;
  const active = (after.user || after).active_tenant;
  assert.equal(active?.id, garageId);
  assert.equal(active?.type, 'garage');
  assert.equal(active?.role, 'admin');
});

test('shipped: a failed activation leaves the approval standing; the retry route builds it once, then reports it', async () => {
  const reviewerId = await person('admin', { stepUp: true });
  const founder = await person('owner');
  const appRow = await seedSubmittedApplication(db, founder, { tradingName: '' });
  const approved = await call(`/api/admin/garage-applications/${appRow.id}/decision`, { token: `tok-${reviewerId}`, method: 'POST', body: { decision: 'approve' } });
  assert.equal(approved.status, 201, approved.text);
  assert.equal(approved.body.application.status, 'approved', 'the decision stands');
  assert.equal(approved.body.activation.activated, false);
  assert.equal(approved.body.activation.retryable, true);
  assert.match(approved.body.activation.reason, /no garage name/);

  await db.query(`UPDATE garage_applications SET trading_name = 'Named Later Motors' WHERE id = $1`, [appRow.id]);
  const retried = await call(`/api/admin/garage-applications/${appRow.id}/activate`, { token: `tok-${reviewerId}`, method: 'POST' });
  assert.equal(retried.status, 201, retried.text);
  assert.equal(retried.body.created, true);
  const again = await call(`/api/admin/garage-applications/${appRow.id}/activate`, { token: `tok-${reviewerId}`, method: 'POST' });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);
  assert.equal(again.body.tenantId, retried.body.tenantId);
});

test('shipped: activation is a reviewer\'s act — the capability and a fresh step-up, nothing less', async () => {
  const { appRow } = await approvedApplication({ tradingName: 'Gated Motors' });
  const government = await person('government', { stepUp: true });
  const staleAdmin = await person('admin');
  const owner = await person('owner', { stepUp: true });
  assert.equal((await call(`/api/admin/garage-applications/${appRow.id}/activate`, { method: 'POST' })).status, 401);
  assert.equal((await call(`/api/admin/garage-applications/${appRow.id}/activate`, { token: `tok-${owner}`, method: 'POST' })).status, 403);
  const gov = await call(`/api/admin/garage-applications/${appRow.id}/activate`, { token: `tok-${government}`, method: 'POST' });
  assert.equal(gov.status, 403);
  assert.equal(gov.body.code, 'OPERATIONS_CAPABILITY_REQUIRED');
  const stale = await call(`/api/admin/garage-applications/${appRow.id}/activate`, { token: `tok-${staleAdmin}`, method: 'POST' });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, 'STEP_UP_REQUIRED');
  const { rows } = await db.query('SELECT activated_tenant_id FROM garage_applications WHERE id = $1', [appRow.id]);
  assert.equal(rows[0].activated_tenant_id, null, 'none of them built anything');
});
