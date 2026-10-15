// CA-K3-AUTH-04-R1 — real PostgreSQL temporal / lock-order adversarial proof.
//
// Standalone by design. Uses the existing backend/tests/realpg embedded-postgres + pg harness,
// never staging/Production. It applies the exact Phase A/B/C migration files from this checkout,
// opens independent PostgreSQL connections, reproduces the pre-R1 post-authority lock defect as a
// negative control, then proves the corrected wrappers fail closed under real lock contention.
//
// Run:
//   cd backend/tests/realpg
//   npm install
//   node ca-k3-auth-04-r1-temporal-realpg.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DATA_DIR = fileURLToPath(new URL('./.pgdata-ca-k3-auth-04-r1', import.meta.url));
const PORT = 54461;
const EXTERNAL_DATABASE_URL = process.env.CA_R1_DATABASE_URL || '';
const PHASE_A = fileURLToPath(new URL('../../../database/migrations/20261014010000_ca_k3_auth_02_corporate_membership_foundation.sql', import.meta.url));
const PHASE_B = fileURLToPath(new URL('../../../database/migrations/20261014020000_ca_k3_auth_03_corporate_membership_governance.sql', import.meta.url));
const PHASE_C = fileURLToPath(new URL('../../../database/migrations/20261015010000_ca_k3_auth_04_corporate_permission_authority.sql', import.meta.url));
const ROOT = 'CARUP_CORPORATE';
const NODE = 'BU_MARKETPLACE';
const MANAGE = 'corporate.people.membership.manage';
const MAX_AGE_MS = 5000;
const LONG_WAIT_MS = 5400;
const SHORT_EXPIRY_MS = 3600;
const results = [];
let refSeq = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rec = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const errText = (e) => String(e?.message ?? e);
const upBlock = (path) => {
  const raw = readFileSync(path, 'utf8');
  const idx = raw.indexOf('-- +migrate Down');
  return (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
};
const connect = async (role = null) => {
  const client = new pg.Client(EXTERNAL_DATABASE_URL
    ? { connectionString: EXTERNAL_DATABASE_URL }
    : { host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await client.connect();
  if (role) await client.query(`SET ROLE ${role}`);
  await client.query(`SET lock_timeout = '8s'; SET statement_timeout = '15s'`);
  return client;
};
const observed = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
async function assertStillPending(promise, ms = 250) {
  const marker = Symbol('pending');
  const raced = await Promise.race([promise.then(() => 'settled'), sleep(ms).then(() => marker)]);
  return raced === marker;
}
const advisoryKeySql = `SELECT pg_advisory_xact_lock(hashtextextended('corporate_membership_create|' || $1 || '|' || $2, 0))`;

async function ensureUsers(owner, ids) {
  for (const id of ids) {
    await owner.query(`INSERT INTO users(id,email,role) VALUES ($1,$2,'owner') ON CONFLICT (id) DO NOTHING`, [id, `${id}@x.invalid`]);
  }
}
async function addSession(owner, userId, { expiresInMs = 8 * 3600_000, stepUpAgeMs = 0, id = `s-${userId}` } = {}) {
  await ensureUsers(owner, [userId]);
  await owner.query(
    `INSERT INTO user_sessions(id,user_id,token,is_valid,expires_at,step_up_at,step_up_method)
     VALUES ($1,$2,$3,true,$4,$5,'password_reauth')
     ON CONFLICT (id) DO UPDATE SET user_id=EXCLUDED.user_id, token=EXCLUDED.token, is_valid=true,
       expires_at=EXCLUDED.expires_at, step_up_at=EXCLUDED.step_up_at, step_up_method='password_reauth'`,
    [id, userId, `tok-${id}`, new Date(Date.now() + expiresInMs).toISOString(), new Date(Date.now() - stepUpAgeMs).toISOString()]);
  return id;
}
async function seedMembership(owner, userId, { node = ROOT, state = 'ACTIVE', untilMs = null } = {}) {
  await ensureUsers(owner, [userId]);
  const { rows } = await owner.query(
    `INSERT INTO corporate_memberships
      (user_id,org_node_id,state,effective_from,effective_until,created_by_kind,created_reason,created_reference,
       updated_by_kind,updated_reason,updated_reference)
     VALUES ($1,$2,$3,clock_timestamp()-interval '1 minute',$4,'SYSTEM','realpg fixture','R1-FIX','SYSTEM','realpg fixture','R1-FIX')
     RETURNING membership_id`,
    [userId, node, state, untilMs === null ? null : new Date(Date.now() + untilMs).toISOString()]);
  return rows[0].membership_id;
}
async function moveAssignment(owner, id, to, by = 'f-suspender') {
  await owner.query(
    `UPDATE corporate_permission_assignments
       SET state=$2, updated_by_kind='USER', updated_by_user_id=$3,
           updated_reason=$4, updated_reference='R1-MOVE'
     WHERE assignment_id=$1`,
    [id, to, by, `realpg ${to.toLowerCase()}`]);
}
async function seedAssignment(owner, { subject, membershipId, untilMs = 8 * 3600_000 }) {
  await ensureUsers(owner, ['f-requester','f-approver','f-activator','f-suspender']);
  const { rows } = await owner.query(
    `INSERT INTO corporate_permission_assignments
      (subject_user_id,membership_id,capability,scope_node_ids,include_descendants,effective_from,effective_until,
       assurance_floor,requested_by_user_id,request_reason,request_reference,state,updated_by_kind,updated_by_user_id,
       updated_reason,updated_reference)
     VALUES ($1,$2,$3,ARRAY[$4]::text[],true,clock_timestamp()-interval '1 minute',$5,
       'A1_RECENT_REAUTH','f-requester','realpg request','R1-REQ','REQUESTED','USER','f-requester','realpg request','R1-REQ')
     RETURNING assignment_id`,
    [subject, membershipId, MANAGE, ROOT, new Date(Date.now() + untilMs).toISOString()]);
  const id = rows[0].assignment_id;
  await moveAssignment(owner, id, 'APPROVED', 'f-approver');
  await moveAssignment(owner, id, 'ACTIVE', 'f-activator');
  return id;
}
async function seedGovernor(owner, userId, { assignmentUntilMs = 8 * 3600_000, membershipUntilMs = null, session = {} } = {}) {
  const membershipId = await seedMembership(owner, userId, { untilMs: membershipUntilMs });
  const assignmentId = await seedAssignment(owner, { subject: userId, membershipId, untilMs: assignmentUntilMs });
  const sessionId = await addSession(owner, userId, session);
  return { userId, membershipId, assignmentId, sessionId };
}

async function direct(client, { op='CREATE', actor, session, subject, node=NODE, membership=null, classification='ROUTINE' }) {
  const { rows } = await client.query(
    `SELECT public.corporate_authority_apply_direct($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,NULL) AS r`,
    [op, actor, session, subject, node, membership, 'realpg governed operation', `R1-${++refSeq}`, classification]);
  return rows[0].r;
}
async function submit(client, { membership, actor, session, op='ACTIVATE' }) {
  const { rows } = await client.query(
    `SELECT public.corporate_authority_request_submit($1,$2,$3,$4,$5,$6) AS r`,
    [op, membership, actor, session, 'realpg request', `R1-REQ-${++refSeq}`]);
  return rows[0].r;
}
async function decide(client, req, { actor, session, verdict='APPROVE' }) {
  const { rows } = await client.query(
    `SELECT public.corporate_authority_request_decide($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS r`,
    [req.request_id, actor, session, verdict, 'realpg checker', req.subject_user_id, req.membership_id, req.org_node_id, req.operation, req.binding_digest]);
  return rows[0].r;
}
async function execute(client, req, { actor, session }) {
  const { rows } = await client.query(
    `SELECT public.corporate_authority_request_execute($1,$2,$3,$4) AS r`,
    [req.request_id, actor, session, req.binding_digest]);
  return rows[0].r;
}
async function cancel(client, req, { actor, session }) {
  const { rows } = await client.query(
    `SELECT public.corporate_authority_request_cancel($1,$2,$3,$4) AS r`,
    [req.request_id, actor, session, 'realpg cancel']);
  return rows[0].r;
}
async function preview(client, actor, subject='m-eve', node=NODE) {
  const { rows } = await client.query(
    `SELECT public.corporate_authority_evaluate($1,$2,$3,ARRAY[$4]::text[],false,NULL) r`,
    [actor, subject, node, MANAGE]);
  return rows[0].r;
}
async function requestFixture(owner, service, maker, checker, subject, { approved = false } = {}) {
  await ensureUsers(owner, [subject]);
  const created = await direct(service, { actor: maker.userId, session: maker.sessionId, subject });
  const req = await submit(service, { membership: created.membership_id, actor: maker.userId, session: maker.sessionId });
  if (approved) await decide(service, req, { actor: checker.userId, session: checker.sessionId });
  return req;
}
async function countSubject(admin, subject) {
  const { rows } = await admin.query(
    `SELECT
       (SELECT count(*)::int FROM corporate_memberships WHERE user_id=$1) memberships,
       (SELECT count(*)::int FROM corporate_membership_events WHERE user_id=$1) events,
       (SELECT count(*)::int FROM corporate_membership_requests WHERE subject_user_id=$1) requests,
       (SELECT count(*)::int FROM corporate_membership_request_steps s JOIN corporate_membership_requests r USING(request_id) WHERE r.subject_user_id=$1) steps`,
    [subject]);
  return rows[0];
}
async function holdAdvisory(client, subject, node = NODE) {
  await client.query('BEGIN');
  await client.query(advisoryKeySql, [subject, node]);
}
async function release(client, commit = false) {
  await client.query(commit ? 'COMMIT' : 'ROLLBACK');
}
async function holdRequest(client, requestId) {
  await client.query('BEGIN');
  await client.query('SELECT request_id FROM corporate_membership_requests WHERE request_id=$1 FOR UPDATE', [requestId]);
}
async function longQueued(label, blocker, call, releaseBlocker, verify) {
  const started = Date.now();
  const pending = observed(call());
  const blocked = await assertStillPending(pending, 300);
  rec(`${label}: caller is genuinely queued on the intended lock`, blocked);
  const left = Math.max(0, LONG_WAIT_MS - (Date.now() - started));
  await sleep(left);
  await releaseBlocker();
  const result = await pending;
  const elapsed = Date.now() - started;
  rec(`${label}: queued beyond the 5s bound`, elapsed >= MAX_AGE_MS, `${elapsed}ms`);
  rec(`${label}: denied TRANSACTION_STALE after release`,
    !result.ok && /CORPORATE_GOVERNANCE\/TRANSACTION_STALE/.test(errText(result.error)),
    result.ok ? JSON.stringify(result.value) : errText(result.error));
  await verify(result);
}
async function shortQueuedExpiry(label, blocker, call, releaseBlocker, expectedError, verify) {
  const started = Date.now();
  const pending = observed(call());
  rec(`${label}: queued before expiry`, await assertStillPending(pending, 250));
  await sleep(Math.max(0, SHORT_EXPIRY_MS - (Date.now() - started)));
  await releaseBlocker();
  const result = await pending;
  const elapsed = Date.now() - started;
  rec(`${label}: release occurs below transaction stale ceiling`, elapsed < MAX_AGE_MS, `${elapsed}ms`);
  rec(`${label}: fails closed after real-world expiry`,
    !result.ok && expectedError.test(errText(result.error)),
    result.ok ? JSON.stringify(result.value) : errText(result.error));
  await verify(result);
}

let epg = null;
const clients = [];
const openClient = async (role = null) => { const c = await connect(role); clients.push(c); return c; };

async function main() {
  if (!EXTERNAL_DATABASE_URL) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    epg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false });
    await epg.initialise();
    await epg.start();
    await epg.createDatabase('postgres').catch(() => {});
  }

  const admin = await openClient();
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await admin.query(`
    CREATE ROLE mig_owner NOSUPERUSER BYPASSRLS CREATEROLE;
    CREATE ROLE anon NOLOGIN NOINHERIT;
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    ALTER SCHEMA public OWNER TO mig_owner;
    GRANT USAGE ON SCHEMA public TO mig_owner, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE mig_owner IN SCHEMA public GRANT ALL ON TABLES TO mig_owner, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE mig_owner IN SCHEMA public GRANT ALL ON FUNCTIONS TO mig_owner, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE mig_owner IN SCHEMA public GRANT ALL ON SEQUENCES TO mig_owner, anon, authenticated, service_role;
  `);
  await admin.query('SET ROLE mig_owner');
  await admin.query(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, role TEXT NOT NULL);
    CREATE TABLE tenants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, type TEXT);
    CREATE TABLE tenant_users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL);
    CREATE TABLE user_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT, is_valid BOOLEAN DEFAULT true,
      created_at TEXT NOT NULL DEFAULT now()::text, expires_at TEXT NOT NULL, auth_method TEXT, user_agent TEXT, step_up_at TEXT, step_up_method TEXT);
    CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE organization_users (organization_id TEXT REFERENCES organizations(id), user_id TEXT REFERENCES users(id), role TEXT);
    INSERT INTO users VALUES
      ('u-admin','admin@x.invalid','admin'),
      ('f-requester','f-requester@x.invalid','owner'),('f-approver','f-approver@x.invalid','owner'),
      ('f-activator','f-activator@x.invalid','owner'),('f-suspender','f-suspender@x.invalid','owner');
  `);
  await admin.query(upBlock(PHASE_A));
  await admin.query(upBlock(PHASE_B));
  await admin.query(upBlock(PHASE_C));
  await admin.query('RESET ROLE');

  const version = (await admin.query('SHOW server_version')).rows[0].server_version;
  const pgMajor = Number.parseInt(String(version).split('.')[0], 10);
  rec('real PostgreSQL booted (not PGlite / not a mock)', Boolean(version),
    `server_version=${version}; source=${EXTERNAL_DATABASE_URL ? 'external disposable service' : 'embedded'}`);

  const owner = await openClient('mig_owner');
  const service = await openClient('service_role');
  const service2 = await openClient('service_role');
  const blocker = await openClient();
  const other = await openClient('mig_owner');

  // ACL / ownership / RLS proof on the real server.
  const acl = {};
  for (const role of ['anon','authenticated','service_role']) {
    acl[role] = {};
    for (const rel of ['corporate_permission_assignments','corporate_permission_assignment_events','corporate_permission_assignment_effective']) {
      const held = [];
      for (const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER', ...(pgMajor >= 17 ? ['MAINTAIN'] : [])]) {
        if ((await admin.query('SELECT has_table_privilege($1,$2,$3) ok', [role, `public.${rel}`, p])).rows[0].ok) held.push(p);
      }
      acl[role][rel] = held;
    }
  }
  rec('ACL: assignment tables/view are service_role SELECT-only and client roles have no table privilege',
    Object.values(acl.anon).every((x) => x.length === 0)
      && Object.values(acl.authenticated).every((x) => x.length === 0)
      && Object.values(acl.service_role).every((x) => x.join(',') === 'SELECT'),
    JSON.stringify(acl));
  const rls = (await admin.query(`
    SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class WHERE relname IN ('corporate_permission_assignments','corporate_permission_assignment_events')
      ORDER BY relname`)).rows;
  rec('ACL: Phase-C tables have RLS enabled and forced', rls.length === 2 && rls.every((r) => r.relrowsecurity && r.relforcerowsecurity), JSON.stringify(rls));
  const fnAcl = async (role, sig) => (await admin.query('SELECT has_function_privilege($1,$2,$3) ok', [role, sig, 'EXECUTE'])).rows[0].ok;
  const oldSnapshot = 'public.corporate_membership_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb,jsonb)';
  const internalFinal = 'public.corporate_authority_finalize(text,text,text,text,text[],boolean,boolean,uuid)';
  const callable = 'public.corporate_authority_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb)';
  rec('ACL: service_role executes wrapper but not old snapshot or final internal helper',
    await fnAcl('service_role', callable) && !(await fnAcl('service_role', oldSnapshot)) && !(await fnAcl('service_role', internalFinal)));

  // Shared governors for the request-path tests.
  const alice = await seedGovernor(owner, 'g-alice');
  const bob = await seedGovernor(owner, 'g-bob');
  const carol = await seedGovernor(owner, 'g-carol');

  // NEGATIVE CONTROL — recreate the old ordering: authority first, Phase-B CREATE advisory lock later, no final revalidation.
  await owner.query(`
    CREATE OR REPLACE FUNCTION public.ca_r1_unsafe_pre_fix_create(p_actor text,p_session text,p_subject text,p_node text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
    DECLARE v_decision jsonb;
    BEGIN
      v_decision := public.corporate_authority_require(p_actor,p_subject,p_node,ARRAY['${MANAGE}']::text[],false,NULL,true);
      RETURN public.corporate_membership_apply_direct(
        'CREATE',p_actor,p_session,p_subject,p_node,NULL,'negative control','R1-OLD',NULL,NULL,'ROUTINE',NULL,v_decision);
    END $$;
    REVOKE ALL ON FUNCTION public.ca_r1_unsafe_pre_fix_create(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION public.ca_r1_unsafe_pre_fix_create(text,text,text,text) TO service_role;
  `);
  await ensureUsers(owner, ['m-old-window']);
  await holdAdvisory(blocker, 'm-old-window');
  const oldStarted = Date.now();
  const oldPending = observed(service.query(
    `SELECT public.ca_r1_unsafe_pre_fix_create($1,$2,$3,$4) r`,
    [alice.userId, alice.sessionId, 'm-old-window', NODE]));
  rec('NEGATIVE CONTROL: old ordering blocks after authority evaluation', await assertStillPending(oldPending, 300));
  await sleep(Math.max(0, LONG_WAIT_MS - (Date.now() - oldStarted)));
  await release(blocker);
  const oldResult = await oldPending;
  rec('NEGATIVE CONTROL: pre-R1 ordering can still mutate after >5s',
    oldResult.ok && Date.now() - oldStarted >= MAX_AGE_MS && oldResult.value.rows[0].r?.outcome === 'EXECUTED',
    oldResult.ok ? `${Date.now()-oldStarted}ms ${JSON.stringify(oldResult.value.rows[0].r)}` : errText(oldResult.error));
  await owner.query('DROP FUNCTION public.ca_r1_unsafe_pre_fix_create(text,text,text,text)');

  // CREATE: Phase C now owns the advisory serialization key before authority evaluation.
  await ensureUsers(owner, ['m-create-stale']);
  const createBefore = await countSubject(admin, 'm-create-stale');
  await holdAdvisory(blocker, 'm-create-stale');
  await longQueued(
    'CREATE post-lock closure', blocker,
    () => direct(service, { actor: alice.userId, session: alice.sessionId, subject: 'm-create-stale' }),
    () => release(blocker),
    async () => rec('CREATE: zero membership/request/event writes committed', JSON.stringify(await countSubject(admin, 'm-create-stale')) === JSON.stringify(createBefore),
      JSON.stringify(await countSubject(admin, 'm-create-stale'))));

  // DECIDE: request-row lock is now before authority evaluation.
  const reqDecide = await requestFixture(owner, service, alice, bob, 'm-decide-stale');
  const decideStepsBefore = Number((await admin.query('SELECT count(*) n FROM corporate_membership_request_steps WHERE request_id=$1',[reqDecide.request_id])).rows[0].n);
  await holdRequest(blocker, reqDecide.request_id);
  await longQueued(
    'REQUEST DECIDE post-lock closure', blocker,
    () => decide(service, reqDecide, { actor: bob.userId, session: bob.sessionId }),
    () => release(blocker),
    async () => {
      const n=Number((await admin.query('SELECT count(*) n FROM corporate_membership_request_steps WHERE request_id=$1',[reqDecide.request_id])).rows[0].n);
      rec('DECIDE: no decision step committed', n === decideStepsBefore, `steps=${n}`);
    });

  // EXECUTE: same pre-lock, plus membership FOR UPDATE already taken by corporate_authority_require.
  const reqExecute = await requestFixture(owner, service, alice, bob, 'm-execute-stale', { approved: true });
  const execStateBefore=(await admin.query('SELECT state FROM corporate_memberships WHERE membership_id=$1',[reqExecute.membership_id])).rows[0].state;
  const execStepsBefore=Number((await admin.query('SELECT count(*) n FROM corporate_membership_request_steps WHERE request_id=$1',[reqExecute.request_id])).rows[0].n);
  await holdRequest(blocker, reqExecute.request_id);
  await longQueued(
    'REQUEST EXECUTE post-lock closure', blocker,
    () => execute(service, reqExecute, { actor: alice.userId, session: alice.sessionId }),
    () => release(blocker),
    async () => {
      const state=(await admin.query('SELECT state FROM corporate_memberships WHERE membership_id=$1',[reqExecute.membership_id])).rows[0].state;
      const n=Number((await admin.query('SELECT count(*) n FROM corporate_membership_request_steps WHERE request_id=$1',[reqExecute.request_id])).rows[0].n);
      rec('EXECUTE: no activation/restoration, event, or execution step committed', state === execStateBefore && n === execStepsBefore, `state=${state} steps=${n}`);
    });

  // CANCEL.
  const reqCancel = await requestFixture(owner, service, alice, bob, 'm-cancel-stale');
  const cancelStepsBefore=Number((await admin.query('SELECT count(*) n FROM corporate_membership_request_steps WHERE request_id=$1',[reqCancel.request_id])).rows[0].n);
  await holdRequest(blocker, reqCancel.request_id);
  await longQueued(
    'REQUEST CANCEL post-lock closure', blocker,
    () => cancel(service, reqCancel, { actor: alice.userId, session: alice.sessionId }),
    () => release(blocker),
    async () => {
      const n=Number((await admin.query('SELECT count(*) n FROM corporate_membership_request_steps WHERE request_id=$1',[reqCancel.request_id])).rows[0].n);
      rec('CANCEL: no cancellation step committed', n === cancelStepsBefore, `steps=${n}`);
    });

  // Expiry while queued — assignment and membership are evaluated after the serialization wait.
  const expAssignment = await seedGovernor(owner, 'g-exp-assignment', { assignmentUntilMs: 2800 });
  await ensureUsers(owner, ['m-exp-assignment']);
  rec('ASSIGNMENT_EXPIRES_WHILE_WAITING: initially authorized', (await preview(service, expAssignment.userId, 'm-exp-assignment')).decision === 'granted');
  const expAssignmentBefore=await countSubject(admin,'m-exp-assignment');
  await holdAdvisory(blocker,'m-exp-assignment');
  await shortQueuedExpiry(
    'ASSIGNMENT_EXPIRES_WHILE_WAITING', blocker,
    () => direct(service,{actor:expAssignment.userId,session:expAssignment.sessionId,subject:'m-exp-assignment'}),
    () => release(blocker), /AUTHORITY_DENIED|OUT_OF_WINDOW/,
    async()=>rec('assignment expiry commits zero mutation',JSON.stringify(await countSubject(admin,'m-exp-assignment'))===JSON.stringify(expAssignmentBefore)));

  const expMembership = await seedGovernor(owner, 'g-exp-membership', { membershipUntilMs: 2800 });
  await ensureUsers(owner, ['m-exp-membership']);
  rec('MEMBERSHIP_WINDOW_EXPIRES_WHILE_WAITING: initially authorized', (await preview(service, expMembership.userId, 'm-exp-membership')).decision === 'granted');
  const expMembershipBefore=await countSubject(admin,'m-exp-membership');
  await holdAdvisory(blocker,'m-exp-membership');
  await shortQueuedExpiry(
    'MEMBERSHIP_WINDOW_EXPIRES_WHILE_WAITING', blocker,
    () => direct(service,{actor:expMembership.userId,session:expMembership.sessionId,subject:'m-exp-membership'}),
    () => release(blocker), /AUTHORITY_DENIED|MEMBERSHIP_NOT_EFFECTIVE/,
    async()=>rec('membership expiry commits zero mutation',JSON.stringify(await countSubject(admin,'m-exp-membership'))===JSON.stringify(expMembershipBefore)));

  // Session / A1 remain apparently fresh to frozen Phase B now(), so these specifically prove the FINAL wall-clock rollback boundary.
  const expSession = await seedGovernor(owner, 'g-exp-session', { session: { expiresInMs: 2800 } });
  await ensureUsers(owner, ['m-exp-session']);
  await owner.query('SELECT public.corporate_governance_assert_a1($1,$2)', [expSession.sessionId, expSession.userId]);
  rec('SESSION_EXPIRES_WHILE_WAITING: initially A1-authorized', true);
  const expSessionBefore=await countSubject(admin,'m-exp-session');
  await holdAdvisory(blocker,'m-exp-session');
  await shortQueuedExpiry(
    'SESSION_EXPIRES_WHILE_WAITING', blocker,
    () => direct(service,{actor:expSession.userId,session:expSession.sessionId,subject:'m-exp-session'}),
    () => release(blocker), /ASSURANCE_SESSION_INVALID/,
    async()=>rec('session expiry rolls back Phase-B writes',JSON.stringify(await countSubject(admin,'m-exp-session'))===JSON.stringify(expSessionBefore)));

  const expA1 = await seedGovernor(owner, 'g-exp-a1', { session: { stepUpAgeMs: 898_000 } });
  await ensureUsers(owner, ['m-exp-a1']);
  await owner.query('SELECT public.corporate_governance_assert_a1($1,$2)', [expA1.sessionId, expA1.userId]);
  rec('A1_EXPIRES_WHILE_WAITING: initially A1-authorized', true);
  const expA1Before=await countSubject(admin,'m-exp-a1');
  await holdAdvisory(blocker,'m-exp-a1');
  await shortQueuedExpiry(
    'A1_EXPIRES_WHILE_WAITING', blocker,
    () => direct(service,{actor:expA1.userId,session:expA1.sessionId,subject:'m-exp-a1'}),
    () => release(blocker), /ASSURANCE_A1_REQUIRED/,
    async()=>rec('A1 expiry rolls back Phase-B writes',JSON.stringify(await countSubject(admin,'m-exp-a1'))===JSON.stringify(expA1Before)));

  // REVOCATION WINS FIRST: assignment UPDATE holds the row, governed operation queues behind it, then denies.
  const revFirst=await seedGovernor(owner,'g-rev-first');
  await ensureUsers(owner,['m-rev-first']);
  await other.query('BEGIN');
  await other.query(
    `UPDATE corporate_permission_assignments SET state='SUSPENDED',updated_by_kind='USER',updated_by_user_id='f-suspender',
       updated_reason='revocation wins',updated_reference='R1' WHERE assignment_id=$1`,[revFirst.assignmentId]);
  const revFirstCall=observed(direct(service,{actor:revFirst.userId,session:revFirst.sessionId,subject:'m-rev-first'}));
  rec('revocation-first: governed operation queues behind assignment lock',await assertStillPending(revFirstCall,250));
  await other.query('COMMIT');
  const revFirstResult=await revFirstCall;
  rec('revocation-first: governed operation denies after revocation commits',
    !revFirstResult.ok && /AUTHORITY_DENIED/.test(errText(revFirstResult.error)),revFirstResult.ok?JSON.stringify(revFirstResult.value):errText(revFirstResult.error));

  // OPERATION WINS FIRST: it holds assignment SHARE while waiting on its target membership; revocation must wait for it.
  const opFirst=await seedGovernor(owner,'g-op-first');
  const targetOp=await seedMembership(owner,'m-op-target',{node:NODE,state:'ACTIVE'});
  await blocker.query('BEGIN');
  await blocker.query('SELECT membership_id FROM corporate_memberships WHERE membership_id=$1 FOR UPDATE',[targetOp]);
  const opPromise=observed(direct(service,{op:'SUSPEND',actor:opFirst.userId,session:opFirst.sessionId,subject:'m-op-target',membership:targetOp}));
  rec('operation-first: governed operation queues on target membership after taking authority locks',await assertStillPending(opPromise,250));
  const revokePromise=observed(other.query(
    `UPDATE corporate_permission_assignments SET state='SUSPENDED',updated_by_kind='USER',updated_by_user_id='f-suspender',
       updated_reason='after operation',updated_reference='R1' WHERE assignment_id=$1`,[opFirst.assignmentId]));
  rec('operation-first: later assignment revocation waits behind operation authority lock',await assertStillPending(revokePromise,250));
  await blocker.query('COMMIT');
  const opResult=await opPromise;
  const revokeResult=await revokePromise;
  const opState=(await admin.query('SELECT state FROM corporate_memberships WHERE membership_id=$1',[targetOp])).rows[0].state;
  rec('operation-first: mutation commits before revocation proceeds',opResult.ok && revokeResult.ok && opState==='SUSPENDED',`state=${opState}`);

  // MEMBERSHIP SUSPENSION WINS FIRST.
  const memFirst=await seedGovernor(owner,'g-mem-first');
  await ensureUsers(owner,['m-mem-first-target']);
  await other.query('BEGIN');
  await other.query(
    `UPDATE corporate_memberships SET state='SUSPENDED',updated_by_kind='USER',updated_by_user_id='u-admin',
       updated_reason='membership suspension wins',updated_reference='R1' WHERE membership_id=$1`,[memFirst.membershipId]);
  const memFirstCall=observed(direct(service,{actor:memFirst.userId,session:memFirst.sessionId,subject:'m-mem-first-target'}));
  rec('membership-suspension-first: governed operation queues on authority membership',await assertStillPending(memFirstCall,250));
  await other.query('COMMIT');
  const memFirstResult=await memFirstCall;
  rec('membership-suspension-first: governed operation denies',
    !memFirstResult.ok && /AUTHORITY_DENIED|MEMBERSHIP_NOT_EFFECTIVE/.test(errText(memFirstResult.error)),
    memFirstResult.ok?JSON.stringify(memFirstResult.value):errText(memFirstResult.error));

  // Opposing END operations: same global assignment/membership ordering, no AB/BA deadlock.
  const ends=[];
  for(const id of ['g-end-1','g-end-2','g-end-3','g-end-4']) ends.push(await seedGovernor(owner,id));
  const cont=(await service.query(
    `SELECT public.corporate_authority_evaluate($1,$2,$3,ARRAY[$4]::text[],true,$5) r`,
    [ends[2].userId,ends[0].userId,NODE,MANAGE,ends[0].membershipId])).rows[0].r;
  rec('continuity precondition: ending one of four governors leaves at least two independent governors',
    cont.decision==='granted' && cont.governance_continuity?.remaining_independent_governors>=2,JSON.stringify(cont.governance_continuity));
  const endA=observed(direct(service,{op:'END',actor:ends[2].userId,session:ends[2].sessionId,subject:ends[0].userId,node:ROOT,membership:ends[0].membershipId}));
  const endB=observed(direct(service2,{op:'END',actor:ends[3].userId,session:ends[3].sessionId,subject:ends[1].userId,node:ROOT,membership:ends[1].membershipId}));
  const [endRa,endRb]=await Promise.all([endA,endB]);
  const ended=(await admin.query('SELECT count(*)::int n FROM corporate_memberships WHERE membership_id=ANY($1::uuid[]) AND state=\'ENDED\'',
    [[ends[0].membershipId,ends[1].membershipId]])).rows[0].n;
  rec('opposing END operations complete without unexplained deadlock',endRa.ok && endRb.ok && ended===2,
    `A=${endRa.ok?'ok':errText(endRa.error)} B=${endRb.ok?'ok':errText(endRb.error)} ended=${ended}`);

  // Repeated short contention: lock ordering must remain live under repeated acquisition.
  const repeat=await seedGovernor(owner,'g-repeat');
  let repeatOk=true;
  for(let i=0;i<4;i+=1){
    const subject=`m-repeat-${i}`;
    await ensureUsers(owner,[subject]);
    await holdAdvisory(blocker,subject);
    const p=observed(direct(service,{actor:repeat.userId,session:repeat.sessionId,subject}));
    if(!(await assertStillPending(p,120))) repeatOk=false;
    await release(blocker);
    const r=await p;
    if(!r.ok || r.value.outcome!=='EXECUTED') repeatOk=false;
  }
  rec('repeated contention: four serialized CREATEs complete with no deadlock',repeatOk);

  console.log('\nACL MATRIX');
  console.log(JSON.stringify(acl,null,2));
  const passed=results.filter((x)=>x.ok).length;
  console.log(`\n════ CA-K3-AUTH-04-R1 REAL-POSTGRES PROOF: ${passed}/${results.length} passed ════`);
  if(passed!==results.length) process.exitCode=1;
}

main().catch((e)=>{
  console.error('HARNESS ERROR:',e?.stack||e);
  process.exitCode=2;
}).finally(async()=>{
  for(const c of clients.reverse()) await c.end().catch(()=>{});
  if (epg) await epg.stop().catch(()=>{});
});
