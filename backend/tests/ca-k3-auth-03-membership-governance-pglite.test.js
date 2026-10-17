/**
 * CA-K3-AUTH-03 (Phase B core) — the governed Corporate membership mutation boundary, run for real on PostgreSQL (PGlite 17).
 *
 * The ACCEPTED Phase-A migration and the Phase-B governance migration are applied by a NON-superuser BYPASSRLS owner, with
 * Supabase's default privileges reproduced, so the privilege assertions are about the platform and not a bare PostgreSQL.
 * Every governed call goes through PostgREST-style role switching (`SET ROLE service_role`): the backend role, which holds NO
 * table DML — only EXECUTE on five procedures.
 *
 * What a mock cannot show and this does: the CHECKs reject, the triggers fire, the unique indexes make replay structurally
 * impossible, a failed audit write rolls the membership change back, and no procedure touches any identity table.
 *
 * Authorities: OD-CARBAC-001/002/003/019/020/030, CA-RBAC-01 (membership ≠ permission; no self-grant; A1 vs A2),
 * CA-K3-AUTH-02 (Phase A, frozen — pinned below).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import {
  PHASE_A, PHASE_A_FILE, PHASE_B, PHASE_B_FILE, PHASE_B_RAW, OWNER, HOUR, MINUTE, iso, IDENTITY_TABLES,
  openDatabase, closeAll, asRole, addSession, decisionFor, rpc, refusal, snapshot,
} from './helpers/corporateGovernanceDb.js';
import { STEP_UP_TTL_MS, ACTION_CLASSES } from '../services/auth/authenticationAssuranceService.js';
import { MEMBERSHIP_STATE as S, resolveCorporateMembership } from '../services/corporate/corporateMembershipService.js';

after(closeAll);
const REPO = new URL('../../', import.meta.url);
const gitBlob = (rel) => { const body = readFileSync(new URL(rel, REPO)); return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'); };

// ═════════════ 1 · the migration file, and everything Phase A that must stay frozen ═════════════

test('file: a canonical migration sorted after Phase A, with a unique version and both markers', () => {
  const all = readdirSync(new URL('database/migrations/', REPO)).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  assert.ok(all.indexOf(PHASE_B_FILE) > all.indexOf(PHASE_A_FILE), 'Phase B sorts after the Phase-A tables it references');
  assert.equal(all.filter((f) => f.startsWith(PHASE_B_FILE.slice(0, 14))).length, 1, 'no shared version');
  assert.match(PHASE_B_RAW, /^-- \+migrate Up$/m);
  assert.match(PHASE_B_RAW, /^-- \+migrate Down$/m);
  assert.ok(PHASE_B.up.length > 5000 && PHASE_B.down.length > 200);
});

test('frozen: the accepted Phase-A migration, bridge, route, resolver and shadow policy are byte-identical to the accepted head 896c3fe1', () => {
  // A change to any of these is a NEW authority decision for CA-MOD, not a side effect of Phase B.
  assert.equal(gitBlob(`database/migrations/${PHASE_A_FILE}`), 'a6f7d0ec15236056b3b1c3f6f1f55c1fbf024cda', 'the accepted Phase-A migration');
  // CA-CLOSE-01 (F2) — a moderator-directed authority decision re-pins exactly these two: persistent-authority admission with the
  // role-only rule bounded to a labelled read-only compatibility (was fd38cd1b), and the routes serving it (was 3ae43f12).
  assert.equal(gitBlob('backend/services/corporate/corporateAccessService.js'), '8cb1e212cb9984679c1bdc1e2da9713c21a119dd', 'the persistent-authority admission (CA-CLOSE-01)');
  assert.equal(gitBlob('backend/routes/corporateAccessRoutes.js'), '70c3defda12c301453bd56300cbfed8083a9aa7f', 'the effective /api/corporate/access + /api/corporate/people-access routes (CA-CLOSE-01)');
  assert.equal(gitBlob('backend/services/corporate/corporateMembershipService.js'), '2f9d4f4d44bcae901ffdabc3ef6ada68b5006d97', 'the Phase-A resolver');
  assert.equal(gitBlob('backend/services/corporate/corporateShadowPolicy.js'), '2ed0d8a799ff654cc404f95c4dc6a995e22662f1', 'the shadow evaluation (separate from admission)');
});

const stripped = (sql) => sql.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");
test('file: it writes only the two ledgers and the membership table, never an identity table; it reads users and user_sessions only', () => {
  const sql = stripped(PHASE_B.up);
  const inserts = [...new Set([...sql.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]))].sort();
  assert.deepEqual(inserts, ['corporate_membership_request_steps', 'corporate_membership_requests', 'corporate_memberships']);
  const updates = [...new Set([...sql.matchAll(/\bUPDATE\s+(?:public\.)?(\w+)\s+SET\b/gi)].map((m) => m[1]))];
  assert.deepEqual(updates, ['corporate_memberships'], 'the ONLY table it ever UPDATEs, and only through the procedures');
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|(?:^|;)\s*TRUNCATE\b/im, 'no DELETE or TRUNCATE statement');
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+[^;]*\bSELECT\b/i, 'no INSERT ... SELECT backfill');
  // Every mention of an identity table is a READ (FROM / EXISTS) or a foreign key to users(id) — never a write.
  for (const t of ['users', 'user_sessions', 'tenants', 'tenant_users', 'organizations', 'organization_users']) {
    assert.doesNotMatch(sql, new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:public\\.)?${t}\\b`, 'i'), `never writes ${t}`);
  }
  assert.doesNotMatch(sql, /\b(tenants|tenant_users|organizations|organization_users)\b/i, 'tenant / external-organisation tables are not even read');
  assert.doesNotMatch(sql, /\busers\s+SET\b|\.role\b|\brole\s*=/i, 'users.role is never touched');
});

test('file: no permission, capability, role or grant column is introduced — membership still grants nothing', () => {
  const cols = [...stripped(PHASE_B.up).matchAll(/^\s{2}([a-z_]+)\s+(?:TEXT|UUID|INTEGER|BOOLEAN|TIMESTAMPTZ|JSONB)\b/gm)].map((m) => m[1]);
  assert.ok(cols.length > 20);
  for (const c of cols) assert.doesNotMatch(c, /^(permission|capabilit|role|grant|scope_grant|entitlement)/, `column ${c}`);
});

// ═════════════ 2 · privileges and structure (a pristine database) ═════════════

const PHASE_A_TABLES = ['corporate_org_nodes', 'corporate_memberships', 'corporate_membership_events'];
const LEDGERS = ['corporate_membership_requests', 'corporate_membership_request_steps'];
const VIEWS = ['corporate_membership_request_status', 'corporate_membership_authorization_epoch'];
const WRITE_PROCEDURES = ['corporate_membership_apply_direct', 'corporate_membership_request_submit', 'corporate_membership_request_decide', 'corporate_membership_request_execute', 'corporate_membership_request_cancel'];
const HELPERS = ['corporate_governance_policy', 'corporate_governance_binding_digest', 'corporate_governance_assert_a1', 'corporate_governance_check_decision', 'corporate_membership_requests_guard', 'corporate_membership_request_steps_guard'];

test('privileges: service_role is SELECT-only on every Phase-A and Phase-B table and view; anon, authenticated and PUBLIC hold nothing', async () => {
  const db = await openDatabase();
  const matrix = {};
  for (const rel of [...PHASE_A_TABLES, ...LEDGERS, ...VIEWS]) {
    for (const role of ['service_role', 'anon', 'authenticated']) {
      const granted = [];
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
        const ok = (await db.query('SELECT has_table_privilege($1, $2, $3) AS ok', [role, `public.${rel}`, p])).rows[0].ok;
        if (ok) granted.push(p);
      }
      matrix[`${rel}:${role}`] = granted.join(',') || '(none)';
      assert.equal(granted.join(','), role === 'service_role' ? 'SELECT' : '', `${rel} for ${role}`);
    }
  }
  const acl = (await db.query("SELECT relname, relacl::text AS acl FROM pg_class WHERE relname = ANY($1) ORDER BY 1", [[...LEDGERS, ...VIEWS]])).rows;
  for (const r of acl) assert.doesNotMatch(String(r.acl), /(^|[{,])=[a-zA-Z]+\//, `${r.relname}: no PUBLIC entry`);
});

test('privileges: RLS is enabled and forced on both ledgers, and no policy exists anywhere in the corporate namespace', async () => {
  const db = await openDatabase();
  const rows = (await db.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY 1", [LEDGERS])).rows;
  assert.equal(rows.length, 2);
  for (const r of rows) { assert.equal(r.relrowsecurity, true, r.relname); assert.equal(r.relforcerowsecurity, true, r.relname); }
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename LIKE 'corporate\\_%'")).rows[0].n, 0);
});

test('privileges: service_role may EXECUTE exactly the five write procedures — no guard, helper or Phase-A function — and anon / authenticated none', async () => {
  const db = await openDatabase();
  const allowed = {};
  for (const role of ['service_role', 'anon', 'authenticated']) {
    const rows = (await db.query(
      `SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'corporate\\_%'
          AND has_function_privilege($1, p.oid, 'EXECUTE') ORDER BY 1`, [role])).rows.map((r) => r.proname);
    allowed[role] = rows;
  }
  assert.deepEqual(allowed.service_role, [...WRITE_PROCEDURES].sort());
  assert.deepEqual(allowed.anon, []);
  assert.deepEqual(allowed.authenticated, []);
});

test('functions: the five write procedures are SECURITY DEFINER, owned by the migration owner, with a pinned search_path; helpers and guards are not definers', async () => {
  const db = await openDatabase();
  const rows = (await db.query(
    `SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner, proconfig::text AS config
       FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1) ORDER BY 1`, [[...WRITE_PROCEDURES, ...HELPERS]])).rows;
  assert.equal(rows.length, WRITE_PROCEDURES.length + HELPERS.length);
  for (const r of rows) {
    assert.equal(r.owner, OWNER, r.proname);
    assert.match(String(r.config), /search_path=public, pg_temp/, `${r.proname}: pinned search_path`);
    assert.equal(r.prosecdef, WRITE_PROCEDURES.includes(r.proname), `${r.proname}: definer only for the write procedures`);
  }
});

test('direct DML: service_role cannot INSERT, UPDATE, DELETE, TRUNCATE or lock any of the five tables — 42501 — and calling a guard or helper directly is refused', async () => {
  const db = await openDatabase();
  const SET_COLUMN = { corporate_org_nodes: "display_name = 'x'", corporate_memberships: "updated_reason = 'x'", corporate_membership_events: "reason = 'x'", corporate_membership_requests: "request_reason = 'x'", corporate_membership_request_steps: "reason = 'x'" };
  const failures = [];
  await asRole(db, 'service_role', async () => {
    for (const t of [...PHASE_A_TABLES, ...LEDGERS]) {
      for (const [label, sql] of [['insert', `INSERT INTO ${t} DEFAULT VALUES`], ['update', `UPDATE ${t} SET ${SET_COLUMN[t]}`], ['delete', `DELETE FROM ${t}`], ['truncate', `TRUNCATE ${t}`], ['select_for_update', `SELECT * FROM ${t} FOR UPDATE`]]) {
        try { await db.query(sql); failures.push(`${t}:${label}: succeeded`); } catch (e) { if (!/permission denied/.test(e.message)) failures.push(`${t}:${label}: ${e.message}`); }
      }
      await db.exec('BEGIN');
      try { await db.query(`LOCK TABLE ${t} IN ACCESS EXCLUSIVE MODE`); failures.push(`${t}:lock: succeeded`); } catch (e) { if (!/permission denied/.test(e.message)) failures.push(`${t}:lock: ${e.message}`); }
      await db.exec('ROLLBACK');
    }
    for (const fn of ['corporate_governance_policy()', 'corporate_membership_requests_guard()', 'corporate_custody_truncate_guard()']) {
      try { await db.query(`SELECT public.${fn}`); failures.push(`${fn}: succeeded`); } catch (e) { if (!/permission denied/.test(e.message)) failures.push(`${fn}: ${e.message}`); }
    }
  });
  assert.deepEqual(failures, []);
});

test('inventory: Phase B changes no Phase-A object; Down restores Phase A exactly; Up → Up → Down → Up is deterministic', async () => {
  const catalog = async (db) => JSON.stringify((await db.query(
    `SELECT 'rel' AS k, c.relname AS n, c.relkind::text AS x, c.relacl::text AS acl, c.relrowsecurity::text AS rls FROM pg_class c WHERE c.relname LIKE 'corporate\\_%' AND c.relname NOT LIKE '%request%' AND c.relname NOT LIKE '%authorization_epoch%'
     UNION ALL SELECT 'fn', p.proname, md5(p.prosrc), p.proacl::text, p.prosecdef::text FROM pg_proc p WHERE p.proname LIKE 'corporate\\_%' AND p.proname !~ '(request|governance|apply_direct)'
     UNION ALL SELECT 'trg', t.tgname, pg_get_triggerdef(t.oid), '', '' FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('corporate_org_nodes','corporate_memberships','corporate_membership_events')
     UNION ALL SELECT 'con', conname, pg_get_constraintdef(oid), '', '' FROM pg_constraint WHERE conrelid::regclass::text IN ('corporate_org_nodes','corporate_memberships','corporate_membership_events')
     ORDER BY 1, 2`)).rows);
  const full = async (db) => JSON.stringify((await db.query(
    `SELECT c.relname AS n, c.relkind::text AS x, c.relacl::text AS acl FROM pg_class c WHERE c.relname LIKE 'corporate\\_%' ORDER BY 1`)).rows.concat(
    (await db.query(`SELECT p.proname AS n, md5(p.prosrc) AS x, p.proacl::text AS acl FROM pg_proc p WHERE p.proname LIKE 'corporate\\_%' ORDER BY 1`)).rows));
  const a = await openDatabase({ migrate: 'A' });
  const phaseAOnly = await catalog(a);
  const b = await openDatabase({ migrate: 'A' });
  await b.exec(PHASE_B.up);
  assert.equal(await catalog(b), phaseAOnly, 'Phase B Up changed no Phase-A object');
  const afterUp = await full(b);
  await b.exec(PHASE_B.up);                      // Up again: idempotent
  assert.equal(await full(b), afterUp, 'the second Up is a no-op');
  await b.exec(PHASE_B.down);
  assert.equal(await catalog(b), phaseAOnly, 'Down restored Phase A exactly');
  assert.equal((await b.query("SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE '%request%' OR relname LIKE '%authorization_epoch%'")).rows[0].n, 0, 'Down removed every Phase-B relation');
  assert.equal((await b.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname ~ '(corporate_governance|corporate_membership_request|apply_direct)'")).rows[0].n, 0, 'Down removed every Phase-B function');
  await b.exec(PHASE_B.up);
  assert.equal(await full(b), afterUp, 'Up → Up → Down → Up is deterministic');
  // Down must run before Phase A's Down: the ledgers reference the Phase-A tables.
  await assert.rejects(() => b.exec(PHASE_A.down), /depend|cannot drop/i);
});

test('policy: the SQL A1 window equals the application step-up window for sensitive actions; the minimum governor count is the accepted two-human minimum', async () => {
  const db = await openDatabase();
  const policy = (await db.query('SELECT public.corporate_governance_policy() AS p')).rows[0].p;
  assert.equal(policy.a1_ttl_seconds * 1000, STEP_UP_TTL_MS[ACTION_CLASSES.SENSITIVE], 'one definition of "recent", not two');
  assert.equal(policy.min_independent_governors, 2);
  assert.equal(policy.assurance_class, 'A1_RECENT_REAUTH');
  assert.equal(policy.decision_source, 'target_corporate_governance');
  assert.equal(policy.capability_membership_manage, 'corporate.people.membership.manage');
  assert.equal(policy.capability_session_revoke, 'corporate.people.session.revoke');
});

// ═════════════ 3 · a shared database for the lifecycle scenarios ═════════════

let db;
before(async () => { db = await openDatabase(); });

let castSeq = 0;
/** A fresh cast of accounts (so scenarios never collide): a maker, an independent checker, a third party, and the subject. */
async function cast(node = 'BU_MARKETPLACE') {
  const tag = (castSeq += 1);
  const mk = async (p) => { const id = `${p}-${tag}`; await db.query("INSERT INTO users VALUES ($1,$2,'owner')", [id, `${id}@x.invalid`]); return id; };
  const c = { tag, node, maker: await mk('mk'), checker: await mk('ck'), other: await mk('ot'), subject: await mk('sb'), sessions: {} };
  for (const u of [c.maker, c.checker, c.other]) c.sessions[u] = await addSession(db, u);
  return c;
}
const dec = (actor, c, o = {}) => decisionFor({ actor, subject: c.subject, node: c.node, ...o });

const direct = (c, o) => rpc(db, 'corporate_membership_apply_direct', {
  p_operation: o.op, p_actor_user_id: o.actor ?? c.maker, p_actor_session_id: 'session' in o ? o.session : c.sessions[o.actor ?? c.maker], p_subject_user_id: o.subject ?? c.subject,
  p_org_node_id: 'node' in o ? o.node : c.node, p_membership_id: o.membership ?? null,
  p_reason: 'reason' in o ? o.reason : 'a reason', p_reference: 'reference' in o ? o.reference : 'REF-1',
  p_effective_from: o.from ?? null, p_effective_until: o.until ?? null, p_classification: o.classification ?? null, p_session_revocation: o.revocation ?? null,
  p_governance_decision: 'decision' in o ? o.decision : dec(o.actor ?? c.maker, c, o.decisionOverrides),
});
const submit = (c, op, membership, o = {}) => rpc(db, 'corporate_membership_request_submit', {
  p_operation: op, p_membership_id: membership, p_requester_user_id: o.actor ?? c.maker, p_requester_session_id: 'session' in o ? o.session : c.sessions[o.actor ?? c.maker],
  p_reason: 'reason' in o ? o.reason : 'a reason', p_reference: 'reference' in o ? o.reference : 'REF-2',
  p_governance_decision: 'decision' in o ? o.decision : dec(o.actor ?? c.maker, c, o.decisionOverrides),
});
const decide = (c, r, o = {}) => rpc(db, 'corporate_membership_request_decide', {
  p_request_id: o.request ?? r.request_id, p_checker_user_id: o.actor ?? c.checker, p_checker_session_id: 'session' in o ? o.session : c.sessions[o.actor ?? c.checker],
  p_decision: o.decision ?? 'APPROVE', p_reason: 'reason' in o ? o.reason : 'verified',
  p_expected_subject_user_id: 'subject' in o ? o.subject : r.subject_user_id, p_expected_membership_id: 'membership' in o ? o.membership : r.membership_id,
  p_expected_org_node_id: 'node' in o ? o.node : r.org_node_id, p_expected_operation: 'operation' in o ? o.operation : r.operation,
  p_expected_binding_digest: 'digest' in o ? o.digest : r.binding_digest,
  p_governance_decision: 'governance' in o ? o.governance : dec(o.actor ?? c.checker, c, o.decisionOverrides),
});
const execute = (c, r, o = {}) => rpc(db, 'corporate_membership_request_execute', {
  p_request_id: o.request ?? r.request_id, p_executor_user_id: o.actor ?? c.maker, p_executor_session_id: 'session' in o ? o.session : c.sessions[o.actor ?? c.maker],
  p_expected_binding_digest: 'digest' in o ? o.digest : r.binding_digest,
  p_governance_decision: 'governance' in o ? o.governance : dec(o.actor ?? c.maker, c, o.decisionOverrides),
});
const cancel = (c, r, o = {}) => rpc(db, 'corporate_membership_request_cancel', {
  p_request_id: r.request_id, p_actor_user_id: o.actor ?? c.maker, p_actor_session_id: 'session' in o ? o.session : c.sessions[o.actor ?? c.maker],
  p_reason: 'reason' in o ? o.reason : 'withdrawn', p_governance_decision: 'governance' in o ? o.governance : dec(o.actor ?? c.maker, c, o.decisionOverrides),
});

async function pending(c, o = {}) { return direct(c, { op: 'CREATE', ...o }); }
async function activeMembership(c) {
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  await decide(c, r);
  await execute(c, r);
  return created.membership_id;
}
async function suspendedMembership(c) {
  const id = await activeMembership(c);
  await direct(c, { op: 'SUSPEND', actor: c.other, membership: id });
  return id;
}
const stateOf = async (id) => (await db.query('SELECT state FROM corporate_memberships WHERE membership_id = $1', [id])).rows[0].state;
const eventCount = async (id) => (await db.query('SELECT count(*)::int AS n FROM corporate_membership_events WHERE membership_id = $1', [id])).rows[0].n;
const events = async (id) => (await db.query('SELECT event_seq, event_type, from_state, to_state, actor_kind, actor_user_id, reason, reference FROM corporate_membership_events WHERE membership_id = $1 ORDER BY event_seq', [id])).rows;
const steps = async (requestId) => (await db.query('SELECT step_seq, step_type, actor_user_id, outcome_classification, result_event_seq FROM corporate_membership_request_steps WHERE request_id = $1 ORDER BY step_seq', [requestId])).rows;
const statusOf = async (requestId) => (await db.query('SELECT status, outcome_classification FROM corporate_membership_request_status WHERE request_id = $1', [requestId])).rows[0];
/** Superuser-only time travel for rows that are otherwise immutable (the triggers are bypassed ONLY for this statement). */
async function timeTravel(sql, params = []) {
  await db.exec('RESET ROLE; SET session_replication_role = replica');
  try { await db.query(sql, params); } finally { await db.exec(`SET session_replication_role = origin; SET ROLE ${OWNER}`); }
}
const epoch = async (user) => Number((await db.query('SELECT authorization_epoch FROM corporate_membership_authorization_epoch WHERE user_id = $1', [user])).rows[0]?.authorization_epoch ?? 0);

// ═════════════ 4 · creation: only ever PENDING ═════════════

test('CREATE: exactly one PENDING membership, one CREATED event by the actor, one already-executed request — and the membership grants nothing', async () => {
  const c = await cast();
  const r = await pending(c);
  assert.equal(r.outcome, 'EXECUTED'); assert.equal(r.state, 'PENDING'); assert.equal(r.event_seq, 1);
  assert.equal(await stateOf(r.membership_id), 'PENDING');
  const ev = await events(r.membership_id);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].event_type, ev[0].from_state, ev[0].to_state, ev[0].actor_kind, ev[0].actor_user_id], ['CREATED', null, 'PENDING', 'USER', c.maker]);
  assert.match(ev[0].reference, new RegExp(`^CMR:${r.request_id};REF-1$`), 'the event names its governed request AND keeps the caller reference');
  assert.deepEqual(await steps(r.request_id), [{ step_seq: 1, step_type: 'EXECUTED', actor_user_id: c.maker, outcome_classification: 'EXECUTED', result_event_seq: 1 }]);
  assert.deepEqual(await statusOf(r.request_id), { status: 'EXECUTED', outcome_classification: 'EXECUTED' });
  const resolved = await resolveCorporateMembership({ from: (t) => selectBuilder(t) }, c.subject, { now: new Date() });
  assert.equal(resolved.is_active_member, false, 'PENDING confers nothing');
  assert.deepEqual([...resolved.capabilities], []);
});

// a minimal supabase-js-shaped reader over the shared database (read-only), enough for the shipped resolver
function selectBuilder(table) {
  const st = { cols: '*', where: [], params: [] };
  const b = {
    select(cols) { st.cols = cols; return b; },
    eq(col, v) { st.params.push(v); st.where.push(`${col} = $${st.params.length}`); return b; },
    in(col, v) { st.params.push(v); st.where.push(`${col} = ANY($${st.params.length}::text[])`); return b; },
    then(res, rej) {
      return asRole(db, 'service_role', () => db.query(`SELECT ${st.cols} FROM ${table}${st.where.length ? ` WHERE ${st.where.join(' AND ')}` : ''}`, st.params))
        .then(({ rows }) => ({ data: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))), error: null }), (error) => ({ data: null, error: { message: error.message } })).then(res, rej);
    },
  };
  return b;
}

test('CREATE: there is no way to create an ACTIVE membership through the boundary — no state parameter, and the ledger only admits PENDING for CREATE', async () => {
  const c = await cast();
  const r = await pending(c);
  assert.equal(await stateOf(r.membership_id), 'PENDING');
  const sig = (await db.query("SELECT pg_get_function_arguments(oid) AS a FROM pg_proc WHERE proname = 'corporate_membership_apply_direct'")).rows[0].a;
  assert.doesNotMatch(sig, /p_state|p_to_state|p_status/, 'the boundary has no state parameter');
  // The ledger's own CHECK: a CREATE request can only ever describe a PENDING result.
  const shape = (await db.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'corporate_membership_requests_operation_shape'")).rows[0].d;
  assert.match(shape, /operation = 'CREATE'::text\) AND \(from_state IS NULL\) AND \(to_state = 'PENDING'::text\)/);
  // Phase B's own call cannot be pointed at an existing membership to "create" it again, nor given a membership id.
  assert.equal(await refusal(direct(c, { op: 'CREATE', membership: r.membership_id })), 'BINDING_MISMATCH');
});

test('CREATE: actor ≠ subject, reason and reference mandatory, node must exist, one live membership per account and node — an ENDED one allows a NEW membership', async () => {
  const c = await cast();
  assert.equal(await refusal(direct(c, { op: 'CREATE', actor: c.subject, session: await addSession(db, c.subject) })), 'ACTOR_IS_SUBJECT');
  assert.equal(await refusal(direct(c, { op: 'CREATE', reason: '  ' })), 'REASON_REQUIRED');
  assert.equal(await refusal(direct(c, { op: 'CREATE', reason: null })), 'REASON_REQUIRED');
  assert.equal(await refusal(direct(c, { op: 'CREATE', reference: '' })), 'REFERENCE_REQUIRED');
  assert.equal(await refusal(direct(c, { op: 'CREATE', reference: null })), 'REFERENCE_REQUIRED');
  assert.equal(await refusal(direct(c, { op: 'CREATE', reason: 'x'.repeat(2001) })), 'REASON_TOO_LONG');
  assert.equal(await refusal(direct(c, { op: 'CREATE', reference: 'x'.repeat(301) })), 'REFERENCE_TOO_LONG');
  assert.equal(await refusal(direct(c, { op: 'CREATE', node: 'BU_NOT_A_NODE', decisionOverrides: { scope: { kind: 'ORG_NODES', org_node_ids: ['BU_NOT_A_NODE'] } } })), 'NODE_UNKNOWN');
  assert.equal(await refusal(direct(c, { op: 'CREATE', subject: 'nobody-here' })), 'SUBJECT_UNKNOWN');
  assert.equal(await refusal(direct(c, { op: 'CREATE', actor: 'nobody-here', session: 'x' })), 'ACTOR_UNKNOWN');
  assert.equal(await refusal(direct(c, { op: 'ACTIVATE' })), 'OPERATION_NOT_DIRECT', 'activation is never a one-person operation');
  assert.equal(await refusal(direct(c, { op: 'RESTORE' })), 'OPERATION_NOT_DIRECT');
  assert.equal(await refusal(direct(c, { op: 'DELETE' })), 'OPERATION_NOT_DIRECT');
  const first = await pending(c);
  assert.equal(await refusal(pending(c)), 'MEMBERSHIP_ALREADY_LIVE');
  assert.equal(await refusal(pending(c, { actor: c.other })), 'MEMBERSHIP_ALREADY_LIVE');
  await direct(c, { op: 'END', membership: first.membership_id });
  const second = await pending(c);
  assert.notEqual(second.membership_id, first.membership_id, 'a later relationship is a NEW membership');
  assert.equal(await stateOf(first.membership_id), 'ENDED');
});

test('CREATE: the window is honoured (effective_from defaults to now; an end before the start is refused by the Phase-A table)', async () => {
  const c = await cast();
  const r = await direct(c, { op: 'CREATE', from: iso(-HOUR), until: iso(HOUR) });
  const row = (await db.query('SELECT effective_from, effective_until FROM corporate_memberships WHERE membership_id = $1', [r.membership_id])).rows[0];
  assert.ok(row.effective_until > row.effective_from);
  const c2 = await cast();
  assert.match(String(await refusal(direct(c2, { op: 'CREATE', from: iso(HOUR), until: iso(-HOUR) }))), /OTHER:.*corporate_memberships_window_ordered/);
});

// ═════════════ 5 · activation / restoration: maker–checker ═════════════

test('ACTIVATE: request → independent approval → execution produces ONE event, an executed request, and an ACTIVE membership — and ACTIVE still grants nothing', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  assert.equal(r.outcome, 'REQUESTED');
  assert.equal(await stateOf(created.membership_id), 'PENDING', 'a request changes nothing');
  assert.equal((await statusOf(r.request_id)).status, 'REQUESTED');
  const approved = await decide(c, r);
  assert.equal(approved.outcome, 'APPROVED');
  assert.equal(await stateOf(created.membership_id), 'PENDING', 'an approval changes nothing either: only execution does');
  assert.equal((await statusOf(r.request_id)).status, 'APPROVED');
  const executed = await execute(c, r);
  assert.equal(executed.outcome, 'EXECUTED'); assert.equal(executed.state, 'ACTIVE'); assert.equal(executed.event_seq, 2);
  assert.equal(await stateOf(created.membership_id), 'ACTIVE');
  assert.equal(await eventCount(created.membership_id), 2, 'exactly one new event');
  const ev = (await events(created.membership_id))[1];
  assert.deepEqual([ev.event_type, ev.from_state, ev.to_state, ev.actor_user_id], ['TRANSITIONED', 'PENDING', 'ACTIVE', c.maker]);
  assert.deepEqual((await steps(r.request_id)).map((s) => [s.step_type, s.actor_user_id]), [['APPROVED', c.checker], ['EXECUTED', c.maker]]);
  const resolved = await resolveCorporateMembership({ from: (t) => selectBuilder(t) }, c.subject, { now: new Date() });
  assert.equal(resolved.is_active_member, true);
  assert.deepEqual([...resolved.capabilities], [], 'membership grants ZERO capability');
  assert.equal(resolved.grants_capability, false);
});

test('ACTIVATE: without an independent checker it fails — never executed unapproved, never self-approved, never approved by the subject', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  assert.equal(await refusal(execute(c, r)), 'APPROVAL_REQUIRED', 'no approval, no execution');
  assert.equal(await refusal(decide(c, r, { actor: c.maker })), 'MAKER_CHECKER_SAME_ACTOR', 'maker ≠ checker');
  const subjectSession = await addSession(db, c.subject);
  assert.equal(await refusal(decide(c, r, { actor: c.subject, session: subjectSession })), 'ACTOR_IS_SUBJECT', 'the subject cannot approve their own membership');
  assert.equal(await refusal(execute(c, r, { actor: c.subject, session: subjectSession })), 'ACTOR_IS_SUBJECT');
  assert.equal(await refusal(submit(c, 'ACTIVATE', created.membership_id, { actor: c.subject, session: subjectSession })), 'ACTOR_IS_SUBJECT', 'the subject cannot request their own activation either');
  assert.equal(await stateOf(created.membership_id), 'PENDING');
  assert.equal(await eventCount(created.membership_id), 1);
  assert.deepEqual(await steps(r.request_id), [], 'every refusal left the ledger untouched');
});

test('RESTORE: SUSPENDED → ACTIVE needs the same independent checker custody — and nothing else restores', async () => {
  const c = await cast();
  const id = await suspendedMembership(c);
  assert.equal(await refusal(direct(c, { op: 'RESTORE', membership: id })), 'OPERATION_NOT_DIRECT');
  const r = await submit(c, 'RESTORE', id);
  assert.equal(r.operation, 'RESTORE');
  assert.equal(await refusal(execute(c, r)), 'APPROVAL_REQUIRED');
  assert.equal(await refusal(decide(c, r, { actor: c.maker })), 'MAKER_CHECKER_SAME_ACTOR');
  assert.equal(await stateOf(id), 'SUSPENDED');
  await decide(c, r);
  const out = await execute(c, r, { actor: c.checker });
  assert.equal(out.state, 'ACTIVE');
  assert.deepEqual((await events(id)).map((e) => e.to_state), ['PENDING', 'ACTIVE', 'SUSPENDED', 'ACTIVE']);
});

test('executor: only the requester or the approving checker may execute an approval — never the subject, never a bystander', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  await decide(c, r);
  assert.equal(await refusal(execute(c, r, { actor: c.other })), 'EXECUTOR_NOT_PARTY');
  assert.equal(await refusal(execute(c, r, { actor: c.subject, session: await addSession(db, c.subject) })), 'ACTOR_IS_SUBJECT');
  assert.equal((await execute(c, r, { actor: c.checker })).outcome, 'EXECUTED', 'the approving checker may execute');
});

test('REFUSE and CANCEL are terminal: a refused or withdrawn request can never be executed', async () => {
  const c = await cast();
  const created = await pending(c);
  const refused = await submit(c, 'ACTIVATE', created.membership_id);
  const out = await decide(c, refused, { decision: 'REFUSE', reason: 'not yet' });
  assert.equal(out.outcome, 'REFUSED');
  assert.equal(await refusal(execute(c, refused)), 'REQUEST_NOT_EXECUTABLE');
  assert.equal(await refusal(decide(c, refused)), 'REQUEST_NOT_OPEN', 'a decided request cannot be decided again');
  assert.equal((await statusOf(refused.request_id)).status, 'REFUSED');

  const withdrawn = await submit(c, 'ACTIVATE', created.membership_id);
  assert.equal(await refusal(cancel(c, withdrawn, { actor: c.checker })), 'ONLY_REQUESTER_MAY_CANCEL');
  assert.equal((await cancel(c, withdrawn)).outcome, 'CANCELLED');
  assert.equal(await refusal(execute(c, withdrawn)), 'REQUEST_NOT_EXECUTABLE');
  assert.equal(await refusal(decide(c, withdrawn)), 'REQUEST_NOT_OPEN');

  const approvedThenWithdrawn = await submit(c, 'ACTIVATE', created.membership_id);
  await decide(c, approvedThenWithdrawn);
  assert.equal((await cancel(c, approvedThenWithdrawn)).outcome, 'CANCELLED', 'an approval that has not been consumed can be withdrawn');
  assert.equal(await refusal(execute(c, approvedThenWithdrawn)), 'REQUEST_NOT_EXECUTABLE');
  assert.equal(await stateOf(created.membership_id), 'PENDING');
});

// ═════════════ 6 · authority-reducing operations: one administrator, immediately ═════════════

test('SUSPEND and END: one separately authorized administrator, executed immediately, ONE event each — and ENDED is terminal', async () => {
  const c = await cast();
  const id = await activeMembership(c);
  const suspended = await direct(c, { op: 'SUSPEND', actor: c.other, membership: id, reason: 'access review', reference: 'SEC-9' });
  assert.equal(suspended.state, 'SUSPENDED'); assert.equal(suspended.event_seq, 3);
  assert.equal(await stateOf(id), 'SUSPENDED');
  const resolved = await resolveCorporateMembership({ from: (t) => selectBuilder(t) }, c.subject, { now: new Date() });
  assert.equal(resolved.is_active_member, false, 'suspension denies Corporate authority at once');
  const ended = await direct(c, { op: 'END', actor: c.other, membership: id, reason: 'leaver', reference: 'HR-4' });
  assert.equal(ended.state, 'ENDED'); assert.equal(ended.event_seq, 4);
  assert.deepEqual((await events(id)).map((e) => [e.event_type, e.to_state, e.actor_user_id]), [['CREATED', 'PENDING', c.maker], ['TRANSITIONED', 'ACTIVE', c.maker], ['TRANSITIONED', 'SUSPENDED', c.other], ['TRANSITIONED', 'ENDED', c.other]]);
  // ENDED is terminal — through the boundary, and in the table itself.
  for (const op of ['SUSPEND', 'END']) assert.equal(await refusal(direct(c, { op, membership: id })), 'ILLEGAL_TRANSITION');
  const reopen = await db.query("UPDATE corporate_memberships SET state = 'ACTIVE', updated_by_kind = 'SYSTEM', updated_by_user_id = NULL, updated_reason = 'x' WHERE membership_id = $1", [id]).then(() => null, (e) => e);
  assert.match(String(reopen?.message), /ENDED_IS_TERMINAL/);
  assert.equal(await stateOf(id), 'ENDED');
});

test('SUSPEND / END: actor ≠ subject, reason and reference mandatory, the membership must exist and match the stated subject and node', async () => {
  const c = await cast();
  const id = await activeMembership(c);
  const subjectSession = await addSession(db, c.subject);
  assert.equal(await refusal(direct(c, { op: 'SUSPEND', actor: c.subject, session: subjectSession, membership: id })), 'ACTOR_IS_SUBJECT');
  assert.equal(await refusal(direct(c, { op: 'END', actor: c.subject, session: subjectSession, membership: id })), 'ACTOR_IS_SUBJECT');
  assert.equal(await refusal(direct(c, { op: 'SUSPEND', membership: id, reason: '' })), 'REASON_REQUIRED');
  assert.equal(await refusal(direct(c, { op: 'SUSPEND', membership: id, reference: ' ' })), 'REFERENCE_REQUIRED');
  assert.equal(await refusal(direct(c, { op: 'SUSPEND', membership: '00000000-0000-4000-8000-000000000000' })), 'MEMBERSHIP_NOT_FOUND');
  assert.equal(await refusal(direct(c, { op: 'SUSPEND', membership: id, subject: c.other })), 'BINDING_MISMATCH');
  assert.equal(await refusal(direct(c, { op: 'SUSPEND', membership: id, node: 'BU_SERVICE_NETWORK' })), 'BINDING_MISMATCH');
  assert.equal(await stateOf(id), 'ACTIVE');
});

test('illegal lifecycle transitions are impossible through every route: the boundary refuses them and so does the table', async () => {
  const c = await cast();
  const pendingId = (await pending(c)).membership_id;
  assert.equal(await refusal(direct(c, { op: 'SUSPEND', membership: pendingId })), 'ILLEGAL_TRANSITION', 'PENDING → SUSPENDED');
  assert.equal(await refusal(submit(c, 'RESTORE', pendingId)), 'ILLEGAL_TRANSITION', 'PENDING → ACTIVE by restore');
  const c2 = await cast();
  const a = await activeMembership(c2);
  assert.equal(await refusal(submit(c2, 'ACTIVATE', a)), 'ILLEGAL_TRANSITION', 'ACTIVE → ACTIVE');
  assert.equal(await refusal(submit(c2, 'RESTORE', a)), 'ILLEGAL_TRANSITION', 'ACTIVE → ACTIVE by restore');
  const c3 = await cast();
  const s3 = await suspendedMembership(c3);
  assert.equal(await refusal(direct(c3, { op: 'SUSPEND', membership: s3 })), 'ILLEGAL_TRANSITION', 'SUSPENDED → SUSPENDED');
  assert.equal(await refusal(submit(c3, 'ACTIVATE', s3)), 'ILLEGAL_TRANSITION', 'SUSPENDED → ACTIVE by activate');
  // The Phase-A table refuses the same transitions even to the OWNER: the matrix lives in the data, not only in the procedures.
  const cases = [['PENDING', 'SUSPENDED'], ['ACTIVE', 'PENDING'], ['SUSPENDED', 'PENDING']];
  for (const [from, to] of cases) {
    const cc = await cast();
    const mid = from === 'PENDING' ? (await pending(cc)).membership_id : from === 'ACTIVE' ? await activeMembership(cc) : await suspendedMembership(cc);
    const err = await db.query('UPDATE corporate_memberships SET state = $2, updated_by_kind = $3, updated_by_user_id = $4, updated_reason = $5 WHERE membership_id = $1', [mid, to, 'USER', cc.other, 'x']).then(() => null, (e) => e);
    assert.match(String(err?.message), /TRANSITION_NOT_ALLOWED/, `${from} → ${to} must be refused by the table`);
    assert.equal(await stateOf(mid), from);
  }
});

// ═════════════ 7 · approvals are bound, consumed once, and go stale ═════════════

test('a consumed approval cannot execute twice — by the same actor, the other party, or at the same instant — and the ledger makes it structural', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  await decide(c, r);
  assert.equal((await execute(c, r)).outcome, 'EXECUTED');
  assert.equal(await refusal(execute(c, r)), 'REQUEST_ALREADY_CONSUMED');
  assert.equal(await refusal(execute(c, r, { actor: c.checker })), 'REQUEST_ALREADY_CONSUMED');
  assert.equal(await refusal(decide(c, r)), 'REQUEST_NOT_OPEN');
  assert.equal(await eventCount(created.membership_id), 2, 'one execution, one event');
  // Even a forced second EXECUTED step (owner holding the write token) is refused by the data itself.
  await db.query("SELECT set_config('carup.corporate_governance_write', 'on', false)");
  try {
    const err = await db.query(
      `INSERT INTO corporate_membership_request_steps (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at, governance_decision, binding_digest, outcome_classification, result_membership_id, result_event_seq)
       SELECT request_id, 3, 'EXECUTED', $2::text, 's', 'A1_RECENT_REAUTH', now(), '{}'::jsonb, binding_digest, 'EXECUTED', membership_id, 2 FROM corporate_membership_requests WHERE request_id = $1::uuid`, [r.request_id, c.maker]).then(() => null, (e) => e);
    assert.match(String(err?.message), /STEP_AFTER_TERMINAL|one_terminal|one_request_per_event/);
  } finally { await db.query("SELECT set_config('carup.corporate_governance_write', 'off', false)"); }
});

test('binding: an approval is for EXACTLY this subject, membership, organisation node, transition and request — any difference is refused', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  const other = await cast();
  const otherCreated = await pending(other);
  const otherRequest = await submit(other, 'ACTIVATE', otherCreated.membership_id);
  for (const [label, o] of [
    ['subject', { subject: other.subject }], ['membership', { membership: otherCreated.membership_id }], ['org node', { node: 'BU_SERVICE_NETWORK' }],
    ['transition', { operation: 'RESTORE' }], ['digest', { digest: otherRequest.binding_digest }], ['digest (garbage)', { digest: 'f'.repeat(64) }], ['digest (null)', { digest: null }],
    ['subject (null)', { subject: null }], ['membership (null)', { membership: null }],
  ]) assert.equal(await refusal(decide(c, r, o)), 'BINDING_MISMATCH', label);
  assert.deepEqual(await steps(r.request_id), []);
  // Another request's approval cannot be lifted onto this one: approving A does not make B executable.
  await decide(other, otherRequest);
  assert.equal(await refusal(execute(c, r, { digest: otherRequest.binding_digest })), 'APPROVAL_REQUIRED', 'B has no approval of its own');
  await decide(c, r);
  assert.equal(await refusal(execute(c, r, { digest: otherRequest.binding_digest })), 'BINDING_MISMATCH');
  assert.equal(await refusal(execute(c, r, { request: otherRequest.request_id })), 'EXECUTOR_NOT_PARTY', 'the first request\'s maker is a stranger to the second request');
  assert.equal(await stateOf(created.membership_id), 'PENDING');
});

test('stale approval (approval window): an approval not executed within its window is RECORDED as EXPIRED, changes nothing, and cannot be revived', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  await decide(c, r);
  await timeTravel("UPDATE corporate_membership_request_steps SET occurred_at = now() - interval '31 minutes' WHERE request_id = $1 AND step_type = 'APPROVED'", [r.request_id]);
  const out = await execute(c, r);
  assert.deepEqual([out.outcome, out.classification], ['EXPIRED', 'APPROVAL_EXPIRED']);
  assert.equal(await stateOf(created.membership_id), 'PENDING');
  assert.equal(await eventCount(created.membership_id), 1);
  assert.deepEqual((await steps(r.request_id)).map((s) => [s.step_type, s.outcome_classification]), [['APPROVED', 'APPROVED'], ['EXPIRED', 'APPROVAL_EXPIRED']]);
  assert.equal(await refusal(execute(c, r)), 'REQUEST_NOT_EXECUTABLE', 'an expired approval is not reusable');
  assert.equal((await statusOf(r.request_id)).status, 'EXPIRED');
});

test('stale request (request window): an unapproved request lapses after its window, recorded as EXPIRED', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  await timeTravel("UPDATE corporate_membership_requests SET requested_at = now() - interval '4 days', expires_at = now() - interval '1 day' WHERE request_id = $1", [r.request_id]);
  const out = await decide(c, r);
  assert.deepEqual([out.outcome, out.classification], ['EXPIRED', 'REQUEST_EXPIRED']);
  assert.equal(await refusal(execute(c, r)), 'REQUEST_NOT_EXECUTABLE');
  assert.equal(await stateOf(created.membership_id), 'PENDING');
});

test('stale precondition: if the membership moved since the request, the approval is RECORDED as refused and nothing changes — whichever way it moved', async () => {
  // (a) another governed change: the membership was ENDED after the request was approved
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  await decide(c, r);
  await direct(c, { op: 'END', actor: c.other, membership: created.membership_id });
  const out = await execute(c, r);
  assert.deepEqual([out.outcome, out.classification], ['REFUSED', 'STALE_PRECONDITION']);
  assert.equal(await stateOf(created.membership_id), 'ENDED');
  assert.equal(await eventCount(created.membership_id), 2, 'no event for the refused execution');
  assert.deepEqual((await steps(r.request_id)).map((s) => s.step_type), ['APPROVED', 'EXECUTION_REFUSED']);
  assert.equal(await refusal(execute(c, r)), 'REQUEST_NOT_EXECUTABLE');
  // (b) an owner-run ceremony amended the provenance (same state, one more lifecycle event): the position moved, the approval is stale
  const c2 = await cast();
  const m2 = (await pending(c2)).membership_id;
  const r2 = await submit(c2, 'ACTIVATE', m2);
  await decide(c2, r2);
  await db.query("UPDATE corporate_memberships SET updated_by_kind = 'SYSTEM', updated_by_user_id = NULL, updated_reason = 'amended by ceremony', updated_reference = 'CEREMONY-1' WHERE membership_id = $1", [m2]);
  const out2 = await execute(c2, r2);
  assert.deepEqual([out2.outcome, out2.classification], ['REFUSED', 'STALE_PRECONDITION']);
  assert.equal(await stateOf(m2), 'PENDING');
  // (c) the state was changed OUT OF BAND (triggers bypassed by a superuser, so no lifecycle event exists for it): the position is unchanged but the
  //     membership is no longer where the request says it is — still refused and recorded, and nothing is applied on top of it
  const c3 = await cast();
  const m3 = (await pending(c3)).membership_id;
  const r3 = await submit(c3, 'ACTIVATE', m3);
  await decide(c3, r3);
  await timeTravel("UPDATE corporate_memberships SET state = 'SUSPENDED' WHERE membership_id = $1", [m3]);
  const out3 = await execute(c3, r3);
  assert.deepEqual([out3.outcome, out3.classification], ['REFUSED', 'STALE_PRECONDITION']);
  assert.equal(await stateOf(m3), 'SUSPENDED');
  assert.equal(await eventCount(m3), 1, 'no event was added on top of the out-of-band change');
  await timeTravel("UPDATE corporate_memberships SET state = 'PENDING' WHERE membership_id = $1", [m3]); // undo the tamper: later invariants describe untampered data
});

// ═════════════ 8 · assurance: A1 is re-proven from the session row ═════════════

test('A1 is server-proven at the database: no step-up, an old step-up, the wrong account, a revoked or expired session, a non-password method, unreadable state — all refused', async () => {
  const c = await cast();
  const attempt = (session) => refusal(direct(c, { op: 'CREATE', session }));
  assert.equal(await attempt(await addSession(db, c.maker, { stepUp: null })), 'ASSURANCE_A1_REQUIRED', 'authenticated but never re-authenticated: A0 is not A1');
  assert.equal(await attempt(await addSession(db, c.maker, { stepUp: { ageMs: 16 * MINUTE, method: 'password_reauth' } })), 'ASSURANCE_A1_REQUIRED', 'older than the A1 window');
  assert.equal(await attempt(await addSession(db, c.maker, { stepUp: { ageMs: 0, method: 'webauthn' } })), 'ASSURANCE_A1_REQUIRED', 'a method that does not exist yet is never trusted');
  assert.equal(await attempt(await addSession(db, c.maker, { stepUp: { ageMs: 0, method: 'x-assurance-a1' } })), 'ASSURANCE_A1_REQUIRED');
  assert.equal(await attempt(await addSession(db, c.checker)), 'ASSURANCE_SESSION_INVALID', "another account's perfectly good session");
  assert.equal(await attempt(await addSession(db, c.maker, { valid: false })), 'ASSURANCE_SESSION_INVALID', 'revoked');
  assert.equal(await attempt(await addSession(db, c.maker, { expiresInMs: -MINUTE })), 'ASSURANCE_SESSION_INVALID', 'expired');
  assert.equal(await attempt('no-such-session'), 'ASSURANCE_SESSION_INVALID');
  assert.equal(await attempt(null), 'ASSURANCE_A1_REQUIRED');
  assert.equal(await attempt(''), 'ASSURANCE_A1_REQUIRED');
  const garbage = await addSession(db, c.maker);
  await db.query("UPDATE user_sessions SET step_up_at = 'last tuesday-ish' WHERE id = $1", [garbage]);
  assert.equal(await attempt(garbage), 'ASSURANCE_UNREADABLE', 'unreadable assurance state fails closed');
  const noExpiry = await addSession(db, c.maker);
  await db.query("UPDATE user_sessions SET expires_at = 'soonish' WHERE id = $1", [noExpiry]);
  assert.equal(await attempt(noExpiry), 'ASSURANCE_UNREADABLE');
  const future = await addSession(db, c.maker, { stepUp: { ageMs: -10 * MINUTE, method: 'password_reauth' } });
  assert.equal(await attempt(future), 'ASSURANCE_A1_REQUIRED', 'a step-up stamped in the future is not recent');
  const fresh = await cast();
  assert.equal(await refusal(direct(fresh, { op: 'CREATE', session: await addSession(db, fresh.maker, { stepUp: { ageMs: 14 * MINUTE, method: 'password_reauth' } }) })), null, 'a 14-minute-old password re-authentication is still A1');
  // Every checker, executor and canceller is held to the same proof — not only the maker.
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  assert.equal(await refusal(decide(c, r, { session: await addSession(db, c.checker, { stepUp: null }) })), 'ASSURANCE_A1_REQUIRED');
  await decide(c, r);
  assert.equal(await refusal(execute(c, r, { session: await addSession(db, c.maker, { stepUp: null }) })), 'ASSURANCE_A1_REQUIRED');
  assert.equal(await refusal(cancel(c, r, { session: await addSession(db, c.maker, { stepUp: null }) })), 'ASSURANCE_A1_REQUIRED');
  assert.equal(await refusal(submit(c, 'ACTIVATE', created.membership_id, { session: await addSession(db, c.maker, { stepUp: null }) })), 'ASSURANCE_A1_REQUIRED');
  assert.equal(await stateOf(created.membership_id), 'PENDING');
});

// ═════════════ 9 · the target-governance decision is required, fresh, bound and never legacy ═════════════

test('governance decision: missing, malformed, legacy-derived, stale, mis-bound, wrong-capability, wrong-scope and wrong-assurance decisions are all refused', async () => {
  const c = await cast();
  const attempt = (overrides, extra = {}) => refusal(direct(c, { op: 'CREATE', decision: overrides === undefined ? undefined : overrides, ...extra }));
  const good = dec(c.maker, c);
  assert.equal(await attempt(null), 'DECISION_MISSING');
  assert.equal(await attempt([]), 'DECISION_MISSING');
  assert.equal(await attempt('granted'), 'DECISION_MISSING');
  assert.equal(await attempt({}), 'DECISION_CONTRACT');
  assert.equal(await attempt({ ...good, contract: 'carup.corporate_access.v1' }), 'DECISION_CONTRACT', 'the legacy access contract is not a governance decision');
  assert.equal(await attempt({ ...good, contract: undefined }), 'DECISION_CONTRACT');
  assert.equal(await attempt({ ...good, decision: 'denied' }), 'DECISION_NOT_GRANTED');
  assert.equal(await attempt({ ...good, decision: undefined }), 'DECISION_NOT_GRANTED');
  for (const source of ['legacy_admin_compatibility_bridge', 'platform_role', 'tenant_role', 'client_header', 'x-user-id', '', null, undefined]) {
    assert.equal(await attempt({ ...good, source }), 'DECISION_SOURCE', `source ${String(source)}`);
  }
  assert.equal(await attempt({ ...good, evaluator: undefined }), 'DECISION_EVALUATOR');
  assert.equal(await attempt({ ...good, evaluator: { name: 'x' } }), 'DECISION_EVALUATOR');
  assert.equal(await attempt({ ...good, evaluator: 'x' }), 'DECISION_EVALUATOR');
  assert.equal(await attempt({ ...good, decided_at: 'yesterday-ish' }), 'DECISION_MALFORMED');
  assert.equal(await attempt({ ...good, decided_at: undefined }), 'DECISION_STALE');
  assert.equal(await attempt({ ...good, decided_at: iso(-6 * MINUTE) }), 'DECISION_STALE', 'an old decision cannot be replayed');
  assert.equal(await attempt({ ...good, decided_at: iso(10 * MINUTE) }), 'DECISION_STALE', 'nor one from the future');
  assert.equal(await attempt({ ...good, actor_user_id: c.other }), 'DECISION_BINDING', 'a decision for someone else');
  assert.equal(await attempt({ ...good, subject_user_id: c.other }), 'DECISION_BINDING', 'a decision for another subject');
  assert.equal(await attempt({ ...good, actor_user_id: undefined }), 'DECISION_BINDING');
  for (const capabilities of [undefined, null, [], 'corporate.people.membership.manage', ['corporate.people.access.approve'], ['corporate.people.membership.read'], [...Array(16).keys()].map((i) => `corporate.read.${i}`), { 0: 'corporate.people.membership.manage' }]) {
    assert.equal(await attempt({ ...good, capabilities }), 'DECISION_CAPABILITY', JSON.stringify(capabilities));
  }
  for (const scope of [undefined, null, {}, { kind: 'GLOBAL' }, { kind: 'ORG_NODES' }, { kind: 'ORG_NODES', org_node_ids: [] }, { kind: 'ORG_NODES', org_node_ids: ['BU_SERVICE_NETWORK'] },
    { kind: 'ORG_NODES', org_node_ids: ['*'] }, { kind: 'ORG_NODES', org_node_ids: ['GLOBAL', 'BU_MARKETPLACE'] }, { kind: 'ORG_NODES', org_node_ids: ['*', 'BU_MARKETPLACE'] },
    { kind: 'ORG_NODES', org_node_ids: 'BU_MARKETPLACE' }, { kind: 'org_nodes', org_node_ids: ['BU_MARKETPLACE'] }]) {
    assert.equal(await attempt({ ...good, scope }), 'DECISION_SCOPE', JSON.stringify(scope));
  }
  for (const assurance of [undefined, null, {}, { class: 'A0_STANDARD', server_proven: true }, { class: 'A2_STRONG', server_proven: true }, { class: 'A1_RECENT_REAUTH' }, { class: 'A1_RECENT_REAUTH', server_proven: false }, { class: 'A1_RECENT_REAUTH', server_proven: 'yes' }]) {
    assert.equal(await attempt({ ...good, assurance }), 'DECISION_ASSURANCE', JSON.stringify(assurance));
  }
  assert.equal(await refusal(direct(c, { op: 'CREATE' })), null, 'the well-formed decision is the ONLY thing that passes');
});

test('governance decision: every other operation requires it too — and the checker, executor and canceller are each bound to their own decision', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  assert.equal(await refusal(submit(c, 'ACTIVATE', created.membership_id, { decision: null })), 'DECISION_MISSING');
  assert.equal(await refusal(decide(c, r, { governance: null })), 'DECISION_MISSING');
  assert.equal(await refusal(decide(c, r, { governance: dec(c.maker, c) })), 'DECISION_BINDING', "the maker's decision is not the checker's");
  assert.equal(await refusal(decide(c, r, { decisionOverrides: { source: 'legacy_admin_compatibility_bridge' } })), 'DECISION_SOURCE');
  await decide(c, r);
  assert.equal(await refusal(execute(c, r, { governance: null })), 'DECISION_MISSING');
  assert.equal(await refusal(execute(c, r, { decisionOverrides: { scope: { kind: 'ORG_NODES', org_node_ids: ['BU_FINANCIAL_SERVICES'] } } })), 'DECISION_SCOPE');
  // the canceller is bound to a decision of their own, exactly like everyone else
  assert.equal(await refusal(cancel(c, r, { governance: null })), 'DECISION_MISSING');
  assert.equal(await refusal(cancel(c, r, { decisionOverrides: { source: 'legacy_admin_compatibility_bridge' } })), 'DECISION_SOURCE');
  assert.equal(await refusal(cancel(c, r, { governance: dec(c.checker, c) })), 'DECISION_BINDING', "someone else's decision is not the canceller's");
  assert.equal(await refusal(cancel(c, r, { decisionOverrides: { capabilities: ['corporate.people.view'] } })), 'DECISION_CAPABILITY');
  assert.equal(await refusal(cancel(c, r, { decisionOverrides: { scope: { kind: 'ORG_NODES', org_node_ids: ['BU_FINANCIAL_SERVICES'] } } })), 'DECISION_SCOPE');
  assert.equal(await refusal(cancel(c, r, { decisionOverrides: { ageMs: 6 * MINUTE } })), 'DECISION_STALE');
  assert.deepEqual((await steps(r.request_id)).map((x) => x.step_type), ['APPROVED'], 'every refused cancellation left the request untouched');
  assert.equal(await refusal(cancel(c, r)), null);
  const id = await activeMembership(await cast());
  const c2 = await cast();
  const sub = await activeMembership(c2);
  assert.ok(id && sub);
  assert.equal(await refusal(direct(c2, { op: 'SUSPEND', membership: sub, decision: null })), 'DECISION_MISSING');
  assert.equal(await refusal(direct(c2, { op: 'END', membership: sub, decision: null })), 'DECISION_MISSING');
  assert.equal(await stateOf(sub), 'ACTIVE');
});

// ═════════════ 10 · governance-loss protection and security-compromise suspension ═════════════

test('END: a governance-bearing membership needs a continuity attestation — fewer than two independent governors remaining, a missing or malformed attestation: all refused', async () => {
  const c = await cast();
  const id = await activeMembership(c);
  const end = (continuity, extra = {}) => refusal(direct(c, { op: 'END', actor: c.other, membership: id, decisionOverrides: { governance_continuity: continuity }, ...extra }));
  assert.equal(await end({ subject_holds_governance_authority: true, remaining_independent_governors: 1 }), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal(await end({ subject_holds_governance_authority: true, remaining_independent_governors: 0 }), 'GOVERNANCE_CONTINUITY_PROTECTION');
  for (const bad of [undefined, null, {}, 'yes', { subject_holds_governance_authority: true }, { remaining_independent_governors: 5 }, { subject_holds_governance_authority: 'maybe', remaining_independent_governors: 5 },
    { subject_holds_governance_authority: 'yes', remaining_independent_governors: 5 }, { subject_holds_governance_authority: false, remaining_independent_governors: '5' },
    { subject_holds_governance_authority: false, remaining_independent_governors: -1 }, { subject_holds_governance_authority: false, remaining_independent_governors: 'many' }]) {
    assert.equal(await end(bad), 'DECISION_CONTINUITY', JSON.stringify(bad));
  }
  assert.equal(await stateOf(id), 'ACTIVE');
  assert.equal(await end({ subject_holds_governance_authority: true, remaining_independent_governors: 2 }), null, 'two independent governors remain: the accepted two-human minimum');
  assert.equal(await stateOf(id), 'ENDED');
  // a membership that carries no governance authority needs only the attestation that says so
  const c2 = await cast();
  const id2 = await activeMembership(c2);
  assert.equal(await refusal(direct(c2, { op: 'END', actor: c2.other, membership: id2, decisionOverrides: { governance_continuity: { subject_holds_governance_authority: false, remaining_independent_governors: 0 } } })), null);
});

test('SECURITY_COMPROMISE suspension: needs the session-revoke capability, a revocation record, and an account with NO live session at that instant', async () => {
  const c = await cast();
  const id = await activeMembership(c);
  await addSession(db, c.subject);                                    // the privileged identity is still signed in
  const revocation = { revoked_count: 1, primitive: 'revokeSessionsForUser' };
  const suspend = (o = {}) => refusal(direct(c, { op: 'SUSPEND', actor: c.other, membership: id, classification: 'SECURITY_COMPROMISE', revocation, ...o }));
  assert.equal(await suspend({ decisionOverrides: { capabilities: ['corporate.people.membership.manage'] } }), 'DECISION_CAPABILITY', 'membership management alone cannot end sessions');
  const both = { capabilities: ['corporate.people.membership.manage', 'corporate.people.session.revoke'] };
  assert.equal(await suspend({ revocation: null, decisionOverrides: both }), 'SESSION_REVOCATION_REQUIRED');
  assert.equal(await suspend({ revocation: [], decisionOverrides: both }), 'SESSION_REVOCATION_REQUIRED');
  assert.equal(await suspend({ decisionOverrides: both }), 'SESSIONS_STILL_VALID', 'a live session remains: the identity would still be usable');
  assert.equal(await stateOf(id), 'ACTIVE');
  await db.query('UPDATE user_sessions SET is_valid = false WHERE user_id = $1', [c.subject]);      // what the session-security primitive does
  const ok = await direct(c, { op: 'SUSPEND', actor: c.other, membership: id, classification: 'SECURITY_COMPROMISE', revocation, decisionOverrides: both });
  assert.equal(ok.state, 'SUSPENDED');
  const row = (await db.query('SELECT classification, session_revocation FROM corporate_membership_requests WHERE request_id = $1', [ok.request_id])).rows[0];
  assert.equal(row.classification, 'SECURITY_COMPROMISE');
  assert.deepEqual(row.session_revocation, revocation, 'the suspension permanently records what was revoked before it');
  // The classification means nothing for any other operation.
  assert.equal(await refusal(direct(c, { op: 'END', actor: c.other, membership: id, classification: 'SECURITY_COMPROMISE', revocation })), 'CLASSIFICATION_NOT_ALLOWED');
  assert.equal(await refusal(direct(c, { op: 'CREATE', classification: 'SECURITY_COMPROMISE', revocation })), 'CLASSIFICATION_NOT_ALLOWED');
  assert.equal(await refusal(direct(c, { op: 'SUSPEND', membership: id, classification: 'PANIC' })), 'CLASSIFICATION_INVALID');
});

// ═════════════ 11 · audit: append-only, atomic, one event per mutation ═════════════

test('append-only: the ledgers cannot be updated, deleted or truncated — not even by the owner — and cannot be inserted into outside a governed procedure', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  await decide(c, r);
  const before = await snapshot(db, LEDGERS);
  const attempts = [
    ["UPDATE corporate_membership_requests SET request_reason = 'rewritten'", /REQUEST_APPEND_ONLY/],
    ['DELETE FROM corporate_membership_requests', /REQUEST_APPEND_ONLY/],
    ["UPDATE corporate_membership_request_steps SET reason = 'rewritten'", /STEP_APPEND_ONLY/],
    ['DELETE FROM corporate_membership_request_steps', /STEP_APPEND_ONLY/],
    ['TRUNCATE corporate_membership_requests CASCADE', /CUSTODY_TRUNCATE_FORBIDDEN/],
    ['TRUNCATE corporate_membership_request_steps', /CUSTODY_TRUNCATE_FORBIDDEN/],
    [`INSERT INTO corporate_membership_request_steps (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at, governance_decision, binding_digest, outcome_classification, reason)
        SELECT request_id, 2, 'CANCELLED', requester_user_id, 's', 'A1_RECENT_REAUTH', now(), '{}'::jsonb, binding_digest, 'CANCELLED_BY_REQUESTER', 'forged' FROM corporate_membership_requests WHERE request_id = '${r.request_id}'`, /STEP_ONLY_VIA_GOVERNED_PROCEDURE/],
    [`INSERT INTO corporate_membership_requests (operation, approval_required, membership_id, subject_user_id, org_node_id, from_state, to_state, expected_event_seq, requester_user_id, requester_session_id, requester_assurance_class, requester_assurance_proven_at, request_reason, request_reference, expires_at, governance_decision, binding_digest)
        VALUES ('SUSPEND', false, '${created.membership_id}', '${c.subject}', '${c.node}', 'ACTIVE', 'SUSPENDED', 1, '${c.maker}', 's', 'A1_RECENT_REAUTH', now(), 'r', 'r', now() + interval '1 day', '{}'::jsonb, '${'a'.repeat(64)}')`, /REQUEST_ONLY_VIA_GOVERNED_PROCEDURE/],
  ];
  for (const [sql, pattern] of attempts) {
    const err = await db.query(sql).then(() => null, (e) => e);
    assert.match(String(err?.message), pattern, sql.slice(0, 60));
  }
  assert.equal(await snapshot(db, LEDGERS), before, 'every attempt left both ledgers byte-identical');
});

test('table guards hold even if a procedure were wrong: with the write token an owner session still cannot record a self-approval, a mis-bound step, an out-of-order step or a result with no event', async () => {
  const c = await cast();
  const created = await pending(c);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  const step = (type, actor, over = {}) => db.query(
    `INSERT INTO corporate_membership_request_steps (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at, governance_decision, binding_digest, outcome_classification, reason, result_membership_id, result_event_seq)
     SELECT request_id, $3::int, $1::text, $2::text, 's', 'A1_RECENT_REAUTH', now(), '{}'::jsonb, COALESCE($4::text, binding_digest), $5::text, $6::text, $7::uuid, $8::int FROM corporate_membership_requests WHERE request_id = $9::uuid`,
    [type, actor, over.seq ?? 1, over.digest ?? null, over.outcome ?? type, over.reason ?? 'r', over.resultMembership ?? null, over.resultSeq ?? null, r.request_id]).then(() => null, (e) => String(e.message));
  await db.query("SELECT set_config('carup.corporate_governance_write', 'on', false)");
  try {
    assert.match(await step('APPROVED', c.maker), /MAKER_IS_CHECKER/, 'the requester cannot approve');
    assert.match(await step('REFUSED', c.maker, { outcome: 'REFUSED_BY_CHECKER' }), /MAKER_IS_CHECKER/);
    assert.match(await step('APPROVED', c.subject), /ACTOR_IS_SUBJECT/, 'the subject cannot approve');
    assert.match(await step('APPROVED', c.checker, { digest: 'e'.repeat(64) }), /STEP_BINDING/, 'an approval carries its own request digest');
    assert.match(await step('APPROVED', c.checker, { seq: 2 }), /STEP_SEQUENCE/);
    assert.match(await step('EXECUTED', c.maker, { outcome: 'EXECUTED', resultMembership: created.membership_id, resultSeq: 2 }), /STEP_ORDER/, 'cannot execute with no approval');
    assert.match(await step('CANCELLED', c.checker, { outcome: 'CANCELLED_BY_REQUESTER' }), /STEP_ACTOR/, 'only the requester cancels');
    assert.equal(await step('APPROVED', c.checker), null, 'the legitimate approval is accepted');
    assert.match(await step('EXECUTED', c.maker, { seq: 2, outcome: 'EXECUTED', resultMembership: created.membership_id, resultSeq: 2 }), /RESULT_EVENT_MISMATCH|event_fk/, 'a result that no lifecycle event backs');
    assert.match(await step('EXECUTED', c.maker, { seq: 2, outcome: 'EXECUTED', resultMembership: created.membership_id, resultSeq: 5 }), /RESULT_EVENT_COUNT/, 'exactly one event: expected + 1');
    assert.match(await step('EXECUTED', c.other, { seq: 2, outcome: 'EXECUTED', resultMembership: created.membership_id, resultSeq: 2 }), /STEP_ACTOR/, 'a bystander cannot execute');
  } finally { await db.query("SELECT set_config('carup.corporate_governance_write', 'off', false)"); }
  assert.equal(await stateOf(created.membership_id), 'PENDING');
});

// ═════════════ 11b · every table rule, individually, with the procedures out of the picture ═════════════
// The procedures re-check what the tables enforce, so a test through the procedures alone cannot tell whether the TABLE would hold if a
// procedure were ever wrong. Here an OWNER session writes raw rows with the write token on (what a buggy or hostile procedure body could do),
// inside a transaction that is rolled back, and every table rule must refuse by itself — each variant violating exactly ONE rule, next to a
// positive control proving the harness can accept a well-formed row. (Found by mutation testing: these table rules had no test of their own.)

const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const STEP_OUTCOME = { APPROVED: 'APPROVED', REFUSED: 'REFUSED_BY_CHECKER', CANCELLED: 'CANCELLED_BY_REQUESTER', EXPIRED: 'REQUEST_EXPIRED', EXECUTED: 'EXECUTED', EXECUTION_REFUSED: 'STALE_PRECONDITION' };
const OP_SHAPE = { CREATE: [null, 'PENDING'], ACTIVATE: ['PENDING', 'ACTIVE'], SUSPEND: ['ACTIVE', 'SUSPENDED'], RESTORE: ['SUSPENDED', 'ACTIVE'], END: ['ACTIVE', 'ENDED'] };

function rawRequest(c, membershipId, o = {}) {
  const id = o.id ?? randomUUID();
  const op = o.op ?? 'ACTIVATE';
  const [defFrom, defTo] = OP_SHAPE[op];
  const from = 'from' in o ? o.from : defFrom;
  const to = o.to ?? defTo;
  const seq = 'seq' in o ? o.seq : 1;
  const approval = 'approval' in o ? o.approval : (op === 'ACTIVATE' || op === 'RESTORE');
  const at = o.requestedAt ?? 'now()';
  const digest = 'digest' in o ? lit(o.digest) : `public.corporate_governance_binding_digest(${lit(id)}::uuid, ${lit(membershipId)}::uuid, ${lit(c.subject)}, ${lit(c.node)}, ${lit(op)}, ${from === null ? 'NULL' : lit(from)}, ${lit(to)}, ${seq === null ? 'NULL' : seq})`;
  return {
    id,
    sql: `INSERT INTO corporate_membership_requests
      (request_id, operation, approval_required, membership_id, subject_user_id, org_node_id, from_state, to_state, expected_event_seq, classification,
       requester_user_id, requester_session_id, requester_assurance_class, requester_assurance_proven_at, request_reason, request_reference, requested_at, expires_at,
       governance_decision, session_revocation, binding_digest)
      VALUES (${lit(id)}::uuid, ${lit(op)}, ${approval}, ${lit(membershipId)}::uuid, ${lit(c.subject)}, ${lit(c.node)}, ${from === null ? 'NULL' : lit(from)}, ${lit(to)}, ${seq === null ? 'NULL' : seq}, ${lit(o.classification ?? 'ROUTINE')},
       ${lit(o.requester ?? c.maker)}, 's-raw', ${lit(o.assurance ?? 'A1_RECENT_REAUTH')}, now(), 'raw', 'raw', ${at}, ${o.expiresAt ?? `${at} + interval '259200 seconds'`},
       '{}'::jsonb, ${o.revocation ?? 'NULL'}, ${digest})`,
  };
}
function rawStep(requestId, o) {
  const type = o.type;
  return `INSERT INTO corporate_membership_request_steps
      (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at, governance_decision, binding_digest, outcome_classification, reason,
       result_membership_id, result_event_seq, occurred_at)
    SELECT request_id, ${o.seq ?? 1}, ${lit(type)}, ${lit(o.actor)}, 's-raw', ${lit(o.assurance ?? 'A1_RECENT_REAUTH')}, now(), '{}'::jsonb, binding_digest, ${lit(o.outcome ?? STEP_OUTCOME[type])},
           ${'reason' in o ? lit(o.reason) : "'raw'"}, ${o.resultMembership ? `${lit(o.resultMembership)}::uuid` : 'NULL'}, ${o.resultSeq ?? 'NULL'}, ${o.occurredAt ?? 'now()'}
      FROM corporate_membership_requests WHERE request_id = ${lit(requestId)}::uuid`;
}
/** One raw statement as an owner session with the write token on (optionally with triggers bypassed by a superuser), in its own savepoint. */
async function attempt(sql, { superuser = false } = {}) {
  await db.exec('SAVEPOINT raw_attempt');
  let accepted = false;
  try {
    if (superuser) await db.exec('RESET ROLE; SET session_replication_role = replica');
    await db.query("SELECT set_config('carup.corporate_governance_write', 'on', true)");
    await db.query(sql);
    accepted = true;
    return null;
  } catch (e) {
    await db.exec('ROLLBACK TO SAVEPOINT raw_attempt'); // also restores the role and the replication setting
    return String(e.message);
  } finally {
    if (superuser && accepted) await db.exec(`SET session_replication_role = origin; SET ROLE ${OWNER}`);
    await db.exec('RELEASE SAVEPOINT raw_attempt').catch(() => {});
  }
}
/** Everything a scenario creates is rolled back with it, so the whole-database invariants below see nothing raw. */
async function scenario(fn) {
  await db.exec('SAVEPOINT raw_scenario');
  try { await fn(); } finally { await db.exec('ROLLBACK TO SAVEPOINT raw_scenario; RELEASE SAVEPOINT raw_scenario'); }
}
const ownerMove = (membershipId, state, actor, ref) => db.query(
  "UPDATE corporate_memberships SET state = $2, updated_by_kind = 'USER', updated_by_user_id = $3, updated_reason = 'raw ownership change', updated_reference = $4 WHERE membership_id = $1", [membershipId, state, actor, ref]);

test('table rules (request ledger): digest, expiry and lifecycle position are checked by the table, not trusted from the procedure', async () => {
  await db.exec('BEGIN');
  try {
    await scenario(async () => {
      const c = await cast();
      const active = await activeMembership(c); // ACTIVE at position 2
      const suspend = { op: 'SUSPEND', approval: false, seq: 2 };
      assert.equal(await attempt(rawRequest(c, active, suspend).sql), null, 'positive control: a well-formed request at the exact position is accepted');
      assert.match(await attempt(rawRequest(c, active, { ...suspend, digest: 'd'.repeat(64) }).sql), /REQUEST_BINDING_DIGEST/, 'the digest is recomputed, never trusted');
      assert.match(await attempt(rawRequest(c, active, { ...suspend, expiresAt: "now() + interval '1 day'" }).sql), /REQUEST_EXPIRY/, 'the expiry is policy-derived');
      assert.match(await attempt(rawRequest(c, active, { ...suspend, seq: 1 }).sql), /REQUEST_POSITION/, 'a request at the wrong lifecycle position');
      assert.match(await attempt(rawRequest(c, active, { op: 'END', approval: false, from: 'PENDING', seq: 2 }).sql), /REQUEST_POSITION/, 'a request from the wrong state');
      assert.match(await attempt(rawRequest(c, active, { op: 'CREATE', approval: false, from: null, to: 'PENDING', seq: null }).sql), /REQUEST_CREATE_POSITION/, 'a CREATE request for a membership that is already past creation');
      const cP = await cast();
      const fresh = (await pending(cP)).membership_id;
      assert.equal(await attempt(rawRequest(cP, fresh, { op: 'CREATE', approval: false, from: null, to: 'PENDING', seq: null }).sql), null, 'positive control: a CREATE request for a membership at its creation position');
    });
  } finally { await db.exec('ROLLBACK'); }
});

test('table rules (request ledger): the CHECKs hold on their own — authority-increasing needs a checker, nobody requests on themselves, A1 only, compromise carries its revocation', async () => {
  await db.exec('BEGIN');
  try {
    await scenario(async () => {
      const cP = await cast();
      const fresh = (await pending(cP)).membership_id;
      const cS = await cast();
      const suspended = await suspendedMembership(cS);
      const cA = await cast();
      const active = await activeMembership(cA);
      assert.match(await attempt(rawRequest(cP, fresh, { op: 'ACTIVATE', approval: false }).sql), /corporate_membership_requests_operation_shape/, 'ACTIVATE without a checker is not a row that can exist');
      assert.match(await attempt(rawRequest(cS, suspended, { op: 'RESTORE', approval: false, seq: 3 }).sql), /corporate_membership_requests_operation_shape/, 'RESTORE without a checker is not a row that can exist');
      assert.match(await attempt(rawRequest(cA, active, { op: 'SUSPEND', approval: true, seq: 2 }).sql), /corporate_membership_requests_operation_shape/, 'a direct operation never claims a checker');
      assert.match(await attempt(rawRequest(cP, fresh, { op: 'ACTIVATE', requester: cP.subject }).sql), /corporate_membership_requests_actor_not_subject/, 'nobody requests on their own membership');
      assert.match(await attempt(rawRequest(cA, active, { op: 'END', approval: false, seq: 2, classification: 'SECURITY_COMPROMISE', revocation: "'{}'::jsonb" }).sql), /corporate_membership_requests_classification_scope/, 'only a suspension can be a compromise');
      assert.match(await attempt(rawRequest(cA, active, { op: 'SUSPEND', approval: false, seq: 2, classification: 'SECURITY_COMPROMISE' }).sql), /corporate_membership_requests_compromise_revocation/, 'a compromise suspension carries its revocation record');
      assert.equal(await attempt(rawRequest(cA, active, { op: 'SUSPEND', approval: false, seq: 2, classification: 'SECURITY_COMPROMISE', revocation: "'{\"revoked\": 2}'::jsonb" }).sql), null, 'positive control: with the revocation record it is accepted');
      assert.match(await attempt(rawRequest(cP, fresh, { op: 'ACTIVATE', assurance: 'A2_STRONG' }).sql), /corporate_membership_requests_requester_assurance_class_check/, 'A1 is the only assurance class that exists');
    });
  } finally { await db.exec('ROLLBACK'); }
});

test('table rules (step ledger): order and actor rules of a directly executed request, and the approval / request windows, are checked by the table', async () => {
  await db.exec('BEGIN');
  try {
    await scenario(async () => {
      const c = await cast();
      const active = await activeMembership(c);
      const direct = rawRequest(c, active, { op: 'SUSPEND', approval: false, seq: 2, requester: c.maker });
      assert.equal(await attempt(direct.sql), null, 'positive control: a raw direct request');
      assert.match(await attempt(rawStep(direct.id, { type: 'APPROVED', actor: c.checker })), /STEP_ORDER/, 'a directly executed request has no approval step');
      assert.match(await attempt(rawStep(direct.id, { type: 'EXECUTED', actor: c.other, resultMembership: active, resultSeq: 3 })), /STEP_ACTOR/, 'a directly executed request is executed by its own requester');
    });
    await scenario(async () => {
      const c = await cast();
      const created = await pending(c);
      const r = await submit(c, 'ACTIVATE', created.membership_id);
      await decide(c, r);
      const executed = (o) => rawStep(r.request_id, { type: 'EXECUTED', actor: c.maker, seq: 2, resultMembership: created.membership_id, resultSeq: 2, ...o });
      assert.match(await attempt(executed({ occurredAt: "now() + interval '31 minutes'" })), /STEP_APPROVAL_STALE/, 'an execution outside the approval window');
      assert.match(await attempt(executed({ resultMembership: (await pending(await cast())).membership_id })), /STEP_RESULT_MEMBERSHIP/, 'an execution pointing at another membership');
      // the request itself lapsed, while the approval is still fresh
      await timeTravel("UPDATE corporate_membership_requests SET requested_at = now() - interval '73 hours', expires_at = now() - interval '1 hour' WHERE request_id = $1", [r.request_id]);
      assert.match(await attempt(executed({})), /STEP_REQUEST_EXPIRED/, 'an execution after the request expired');
    });
  } finally { await db.exec('ROLLBACK'); }
});

test('table rules (step ledger): an EXECUTED step must match the ONE lifecycle event it claims — membership, position, actor, states — one variant per rule', async () => {
  await db.exec('BEGIN');
  try {
    const world = async () => { // a PENDING membership, an APPROVED ACTIVATE request (position 1); the caller performs the change
      const c = await cast();
      const created = await pending(c);
      const r = await submit(c, 'ACTIVATE', created.membership_id);
      await decide(c, r);
      return { c, m: created.membership_id, r, executed: () => rawStep(r.request_id, { type: 'EXECUTED', actor: c.maker, seq: 2, resultMembership: created.membership_id, resultSeq: 2 }) };
    };
    await scenario(async () => {
      const w = await world();
      await ownerMove(w.m, 'ACTIVE', w.c.maker, 'RAW-1');
      assert.equal(await attempt(w.executed()), null, 'positive control: the event, the actor, the position and the states all match');
    });
    await scenario(async () => {
      const w = await world();
      await ownerMove(w.m, 'ACTIVE', w.c.other, 'RAW-1'); // the event was produced by someone else
      assert.match(await attempt(w.executed()), /RESULT_EVENT_MISMATCH/, 'the event actor must be the executing actor');
    });
    await scenario(async () => {
      const w = await world();
      await ownerMove(w.m, 'ACTIVE', w.c.maker, 'RAW-1');
      await timeTravel("UPDATE corporate_memberships SET state = 'SUSPENDED' WHERE membership_id = $1", [w.m]); // the row no longer shows the target state
      assert.match(await attempt(w.executed()), /RESULT_EVENT_MISMATCH/, 'the membership must really be in the target state');
    });
    await scenario(async () => {
      const w = await world();
      await ownerMove(w.m, 'ACTIVE', w.c.maker, 'RAW-1');
      await db.query("UPDATE corporate_memberships SET updated_reason = 'amended later', updated_reference = 'RAW-2' WHERE membership_id = $1", [w.m]); // a second event: the claimed one is no longer the last
      assert.equal(await stateOf(w.m), 'ACTIVE');
      assert.match(await attempt(w.executed()), /RESULT_EVENT_MISMATCH/, 'the claimed event must be the LAST one: exactly one new event');
    });
    await scenario(async () => {
      // Phase A's own chain guard makes an event that starts from the wrong state unreachable by any legitimate write, so this variant is built
      // with every trigger bypassed (superuser): event 2 claims SUSPENDED → ACTIVE although the request was made from PENDING.
      const w = await world();
      await timeTravel(`INSERT INTO corporate_membership_events (membership_id, event_seq, user_id, org_node_id, event_type, from_state, to_state, prior_effective_from, prior_effective_until, effective_from, effective_until, actor_kind, actor_user_id, reason)
                          SELECT membership_id, 2, user_id, org_node_id, 'TRANSITIONED', 'SUSPENDED', 'ACTIVE', effective_from, effective_until, effective_from, effective_until, 'USER', $2, 'raw' FROM corporate_memberships WHERE membership_id = $1`, [w.m, w.c.maker]);
      await timeTravel("UPDATE corporate_memberships SET state = 'ACTIVE' WHERE membership_id = $1", [w.m]);
      assert.match(await attempt(w.executed()), /RESULT_EVENT_MISMATCH/, 'the event must start from the state the request was made from');
    });
    await scenario(async () => {
      const w = await world();
      await ownerMove(w.m, 'ENDED', w.c.maker, 'RAW-1'); // event 2 is PENDING → ENDED
      await timeTravel("UPDATE corporate_memberships SET state = 'ACTIVE' WHERE membership_id = $1", [w.m]); // the row shows ACTIVE, the event says ENDED
      assert.match(await attempt(w.executed()), /RESULT_EVENT_MISMATCH/, 'the event must end in the state the request asked for');
    });
  } finally { await db.exec('ROLLBACK'); }
});

test('table rules (step ledger): outcome and result shapes, and the A1 class, are CHECKs of the table itself', async () => {
  await db.exec('BEGIN');
  try {
    await scenario(async () => {
      const c = await cast();
      const created = await pending(c);
      const r = await submit(c, 'ACTIVATE', created.membership_id);
      assert.match(await attempt(rawStep(r.request_id, { type: 'APPROVED', actor: c.checker, reason: null })), /corporate_membership_request_steps_outcome_shape/, 'a decision always carries its reason');
      assert.match(await attempt(rawStep(r.request_id, { type: 'APPROVED', actor: c.checker, outcome: 'REFUSED_BY_CHECKER' })), /corporate_membership_request_steps_outcome_shape/, 'the classification must match the step');
      assert.match(await attempt(rawStep(r.request_id, { type: 'CANCELLED', actor: c.maker, resultMembership: created.membership_id, resultSeq: 1 })), /corporate_membership_request_steps_result_shape/, 'only an execution points at a lifecycle event');
      assert.match(await attempt(rawStep(r.request_id, { type: 'APPROVED', actor: c.checker, assurance: 'A2_STRONG' })), /corporate_membership_request_steps_assurance_class_check/, 'A1 is the only assurance class that exists');
      assert.equal(await attempt(rawStep(r.request_id, { type: 'APPROVED', actor: c.checker })), null, 'positive control: a well-formed approval');
    });
  } finally { await db.exec('ROLLBACK'); }
});

test('structural replay protection: one decision, one terminal step and one request per lifecycle event are UNIQUE indexes — they hold even with every trigger bypassed', async () => {
  await db.exec('BEGIN');
  try {
    await scenario(async () => {
      const c = await cast();
      const created = await pending(c);
      const r = await submit(c, 'ACTIVATE', created.membership_id);
      await decide(c, r); // APPROVED, step 1
      assert.match(await attempt(rawStep(r.request_id, { type: 'APPROVED', actor: c.other, seq: 2 }), { superuser: true }), /idx_corporate_membership_request_steps_one_decision/, 'a second decision');
      assert.match(await attempt(rawStep(r.request_id, { type: 'REFUSED', actor: c.other, seq: 2 }), { superuser: true }), /idx_corporate_membership_request_steps_one_decision/, 'a refusal after an approval is also a second decision');
      assert.equal(await attempt(rawStep(r.request_id, { type: 'CANCELLED', actor: c.maker, seq: 2 }), { superuser: true }), null, 'positive control: the first terminal step');
      assert.match(await attempt(rawStep(r.request_id, { type: 'EXPIRED', actor: c.maker, seq: 3 }), { superuser: true }), /idx_corporate_membership_request_steps_one_terminal/, 'a second terminal step');
    });
    await scenario(async () => {
      const c = await cast();
      const created = await pending(c);
      const r1 = await submit(c, 'ACTIVATE', created.membership_id);
      await decide(c, r1);
      await execute(c, r1); // event 2 belongs to r1
      const r2 = rawRequest(c, created.membership_id, { op: 'ACTIVATE', seq: 1 });
      assert.equal(await attempt(r2.sql, { superuser: true }), null);
      assert.equal(await attempt(rawStep(r2.id, { type: 'APPROVED', actor: c.checker, seq: 1 }), { superuser: true }), null);
      assert.match(await attempt(rawStep(r2.id, { type: 'EXECUTED', actor: c.maker, seq: 2, resultMembership: created.membership_id, resultSeq: 2 }), { superuser: true }), /idx_corporate_membership_request_steps_one_request_per_event/, 'two requests can never claim one lifecycle event');
    });
  } finally { await db.exec('ROLLBACK'); }
});

test('triggers: both ledgers carry their guard AND their truncate guard (the truncate guard of the request ledger cannot be exercised alone, so it is pinned by inventory)', async () => {
  const triggers = (await db.query(`SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                                     WHERE NOT t.tgisinternal AND c.relname IN ('corporate_membership_requests','corporate_membership_request_steps') ORDER BY 1, 2`)).rows;
  assert.deepEqual(triggers.map((t) => `${t.relname}:${t.tgname}`).sort(), [
    'corporate_membership_request_steps:corporate_membership_request_steps_guard', 'corporate_membership_request_steps:corporate_membership_request_steps_no_truncate',
    'corporate_membership_requests:corporate_membership_requests_guard', 'corporate_membership_requests:corporate_membership_requests_no_truncate'].sort());
  for (const t of triggers) {
    if (t.tgname.endsWith('_no_truncate')) assert.match(t.def, /BEFORE TRUNCATE ON public\.\w+ FOR EACH STATEMENT EXECUTE FUNCTION (public\.)?corporate_custody_truncate_guard\(\)/, t.tgname);
    else assert.match(t.def, /BEFORE INSERT OR DELETE OR UPDATE ON public\.\w+ FOR EACH ROW EXECUTE FUNCTION (public\.)?corporate_membership_request\w*_guard\(\)/, t.tgname);
  }
  // and the one that CAN be exercised alone is refused by the owner
  const err = await db.query('TRUNCATE corporate_membership_request_steps').then(() => null, (e) => e);
  assert.match(String(err?.message), /CUSTODY_TRUNCATE_FORBIDDEN/);
});

test('atomic audit: if the audit write fails, the membership change, the lifecycle event and the request all roll back — for every operation', async () => {
  const c = await cast();
  const active = await activeMembership(c);
  const c2 = await cast();
  const created2 = await pending(c2);
  const r2 = await submit(c2, 'ACTIVATE', created2.membership_id);
  await decide(c2, r2);
  const probe = async (label, run, subject, membership, expectState) => {
    const beforeEvents = await eventCount(membership);
    const beforeRequests = (await db.query('SELECT count(*)::int AS n FROM corporate_membership_requests')).rows[0].n;
    const beforeSteps = (await db.query('SELECT count(*)::int AS n FROM corporate_membership_request_steps')).rows[0].n;
    const beforeEpoch = await epoch(subject);
    const code = await refusal(run());
    assert.match(String(code), /OTHER:.*zz_audit_fault/, `${label}: the injected audit fault must be what stopped it (${code})`);
    assert.equal(await stateOf(membership), expectState, `${label}: state unchanged`);
    assert.equal(await eventCount(membership), beforeEvents, `${label}: no lifecycle event`);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM corporate_membership_requests')).rows[0].n, beforeRequests, `${label}: no request`);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM corporate_membership_request_steps')).rows[0].n, beforeSteps, `${label}: no step`);
    assert.equal(await epoch(subject), beforeEpoch, `${label}: the authorization epoch did not move`);
  };
  await db.exec('ALTER TABLE corporate_membership_request_steps ADD CONSTRAINT zz_audit_fault CHECK (FALSE) NOT VALID');
  try {
    await probe('SUSPEND', () => direct(c, { op: 'SUSPEND', actor: c.other, membership: active }), c.subject, active, 'ACTIVE');
    await probe('END', () => direct(c, { op: 'END', actor: c.other, membership: active }), c.subject, active, 'ACTIVE');
    await probe('EXECUTE', () => execute(c2, r2), c2.subject, created2.membership_id, 'PENDING');
    const c3 = await cast();
    const beforeCreate = (await db.query('SELECT count(*)::int AS n FROM corporate_memberships')).rows[0].n;
    assert.match(String(await refusal(pending(c3))), /OTHER:.*zz_audit_fault/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM corporate_memberships')).rows[0].n, beforeCreate, 'CREATE: no membership row survived');
  } finally { await db.exec('ALTER TABLE corporate_membership_request_steps DROP CONSTRAINT zz_audit_fault'); }
  // …and the request ledger itself failing is just as fatal to the change
  await db.exec('ALTER TABLE corporate_membership_requests ADD CONSTRAINT zz_request_fault CHECK (FALSE) NOT VALID');
  try {
    const before = await eventCount(active);
    assert.match(String(await refusal(direct(c, { op: 'SUSPEND', actor: c.other, membership: active }))), /OTHER:.*zz_request_fault/);
    assert.equal(await stateOf(active), 'ACTIVE'); assert.equal(await eventCount(active), before);
  } finally { await db.exec('ALTER TABLE corporate_membership_requests DROP CONSTRAINT zz_request_fault'); }
  assert.equal((await direct(c, { op: 'SUSPEND', actor: c.other, membership: active })).state, 'SUSPENDED', 'and it works the moment the fault is gone');
  assert.equal((await execute(c2, r2)).outcome, 'EXECUTED');
});

test('exactly one lifecycle event per accepted mutation: every executed request owns precisely one event, and every governed event is owned by one executed request', async () => {
  const c = await cast();
  const id = await activeMembership(c);
  await direct(c, { op: 'SUSPEND', actor: c.other, membership: id });
  const executed = (await db.query(
    `SELECT s.request_id, s.result_membership_id, s.result_event_seq, e.reference, e.actor_user_id, s.actor_user_id AS step_actor
       FROM corporate_membership_request_steps s JOIN corporate_membership_events e ON e.membership_id = s.result_membership_id AND e.event_seq = s.result_event_seq
      WHERE s.step_type = 'EXECUTED' AND s.result_membership_id = $1 ORDER BY s.result_event_seq`, [id])).rows;
  assert.deepEqual(executed.map((x) => x.result_event_seq), [1, 2, 3]);
  for (const x of executed) {
    assert.equal(x.reference.split(';')[0], `CMR:${x.request_id}`, 'the event names exactly the request that owns it');
    assert.equal(x.actor_user_id, x.step_actor, 'the event actor is the executing actor');
  }
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM corporate_membership_events WHERE membership_id = $1 AND reference LIKE 'CMR:%'`, [id])).rows[0].n, 3);
});

// ═════════════ 12 · isolation: tenants, external organisations, users.role; zero capability; the epoch ═════════════

test('isolation: a full lifecycle (create, activate, suspend, restore, end, compromise-suspend) touches no users.role, tenant_users, organisation or session row', async () => {
  const c = await cast();
  const before = await snapshot(db, IDENTITY_TABLES);
  const sessionsBefore = (await db.query('SELECT id, user_id, is_valid, step_up_at, step_up_method FROM user_sessions ORDER BY id')).rows;
  const id = await activeMembership(c);
  await direct(c, { op: 'SUSPEND', actor: c.other, membership: id });
  const r = await submit(c, 'RESTORE', id);
  await decide(c, r); await execute(c, r);
  await direct(c, { op: 'END', actor: c.other, membership: id });
  assert.equal(await snapshot(db, IDENTITY_TABLES), before, 'users, tenants, tenant_users, organizations, organization_users: byte-identical');
  const sessionsAfter = (await db.query('SELECT id, user_id, is_valid, step_up_at, step_up_method FROM user_sessions ORDER BY id')).rows.filter((s) => sessionsBefore.some((b) => b.id === s.id));
  assert.deepEqual(sessionsAfter, sessionsBefore, 'no existing session was touched by a routine membership change');
});

test('isolation: tenant and external-organisation relationships neither create, satisfy nor block a Corporate membership', async () => {
  const c = await cast();
  // the subject is a tenant admin and a legacy organisation admin — which is NOT a Corporate membership
  await db.query("INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ('11111111-1111-1111-1111-111111111111', $1, 'admin')", [c.subject]);
  await db.query("INSERT INTO organization_users VALUES ('O-1', $1, 'admin')", [c.subject]);
  const before = await resolveCorporateMembership({ from: (t) => selectBuilder(t) }, c.subject, { now: new Date() });
  assert.equal(before.state, S.NO_MEMBERSHIP, 'tenant admin / org admin ≠ Corporate member');
  const tenantsBefore = await snapshot(db, ['tenant_users', 'organization_users']);
  const id = await activeMembership(c);
  assert.equal((await resolveCorporateMembership({ from: (t) => selectBuilder(t) }, c.subject, { now: new Date() })).is_active_member, true);
  await direct(c, { op: 'END', actor: c.other, membership: id });
  assert.equal(await snapshot(db, ['tenant_users', 'organization_users']), tenantsBefore, 'ending the Corporate membership did not remove the tenant or organisation relationship');
  // a platform administrator (users.role) holds no standing here either: only a session with A1 and a governance decision acts
  const admin = await addSession(db, 'u-admin', { stepUp: null });
  const c2 = await cast();
  assert.equal(await refusal(direct(c2, { op: 'CREATE', actor: 'u-admin', session: admin })), 'ASSURANCE_A1_REQUIRED', 'u-admin has a session but no recent re-authentication');
  assert.equal(await refusal(direct(c2, { op: 'CREATE', actor: 'u-admin', session: await addSession(db, 'u-admin'), decisionOverrides: { source: 'legacy_admin_compatibility_bridge' } })), 'DECISION_SOURCE', 'and even with A1, a legacy-derived decision is not accepted');
  assert.equal(await refusal(direct(c2, { op: 'CREATE', actor: 'u-sadmin', session: await addSession(db, 'u-sadmin'), decision: { contract: 'carup.corporate_access.v1', decision: 'granted', grant: { source: 'legacy_admin_compatibility_bridge' } } })), 'DECISION_CONTRACT');
});

test('authorization epoch: it rises by exactly one per accepted mutation, per account, and never on a refusal', async () => {
  const c = await cast();
  assert.equal(await epoch(c.subject), 0);
  const created = await pending(c);
  assert.equal(created.authorization_epoch, 1); assert.equal(await epoch(c.subject), 1);
  const r = await submit(c, 'ACTIVATE', created.membership_id);
  assert.equal(await epoch(c.subject), 1, 'a request changes no authority');
  await decide(c, r);
  assert.equal(await epoch(c.subject), 1, 'neither does an approval');
  assert.equal((await execute(c, r)).authorization_epoch, 2); assert.equal(await epoch(c.subject), 2);
  await refusal(direct(c, { op: 'SUSPEND', membership: created.membership_id, reason: '' }));
  assert.equal(await epoch(c.subject), 2, 'a refusal changes nothing');
  assert.equal((await direct(c, { op: 'SUSPEND', actor: c.other, membership: created.membership_id })).authorization_epoch, 3);
  assert.equal(await epoch(c.other), 0, 'only the subject’s epoch moves');
  assert.equal((await direct(c, { op: 'END', actor: c.other, membership: created.membership_id })).authorization_epoch, 4);
});

test('the shipped Phase-A resolver reads the governed rows unchanged: PENDING, ACTIVE, SUSPENDED, ENDED — and always zero capability', async () => {
  const c = await cast();
  const reader = { from: (t) => selectBuilder(t) };
  const states = [];
  const created = await pending(c); states.push((await resolveCorporateMembership(reader, c.subject, { now: new Date() })).state);
  const r = await submit(c, 'ACTIVATE', created.membership_id); await decide(c, r); await execute(c, r); states.push((await resolveCorporateMembership(reader, c.subject, { now: new Date() })).state);
  await direct(c, { op: 'SUSPEND', actor: c.other, membership: created.membership_id }); states.push((await resolveCorporateMembership(reader, c.subject, { now: new Date() })).state);
  await direct(c, { op: 'END', actor: c.other, membership: created.membership_id }); const ended = await resolveCorporateMembership(reader, c.subject, { now: new Date() }); states.push(ended.state);
  assert.deepEqual(states, [S.PENDING, S.ACTIVE, S.SUSPENDED, S.ENDED]);
  assert.deepEqual([...ended.capabilities], []); assert.equal(ended.grants_capability, false);
});

// ═════════════ 13 · whole-database invariants, after every scenario above ═════════════

test('invariants: after every scenario, the ledgers and the lifecycle history agree on everything that matters', async () => {
  const count = async (sql) => (await db.query(sql)).rows[0].n;
  // every membership's state is the target of its latest lifecycle event
  assert.equal(await count(`SELECT count(*)::int AS n FROM corporate_memberships m JOIN LATERAL (SELECT to_state FROM corporate_membership_events e WHERE e.membership_id = m.membership_id ORDER BY event_seq DESC LIMIT 1) l ON TRUE WHERE l.to_state <> m.state`), 0);
  // an executed request owns exactly one event, and exactly one executed request owns each governed event
  assert.equal(await count(`SELECT count(*)::int AS n FROM corporate_membership_request_steps s WHERE s.step_type = 'EXECUTED' AND NOT EXISTS (SELECT 1 FROM corporate_membership_events e WHERE e.membership_id = s.result_membership_id AND e.event_seq = s.result_event_seq)`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM corporate_membership_events e WHERE e.reference LIKE 'CMR:%' AND NOT EXISTS (SELECT 1 FROM corporate_membership_request_steps s WHERE s.step_type = 'EXECUTED' AND s.result_membership_id = e.membership_id AND s.result_event_seq = e.event_seq AND e.reference LIKE 'CMR:' || s.request_id::text || ';%')`), 0);
  // no approval or refusal was ever made by the maker or the subject; no step was ever taken by the subject
  assert.equal(await count(`SELECT count(*)::int AS n FROM corporate_membership_request_steps s JOIN corporate_membership_requests r USING (request_id) WHERE s.step_type IN ('APPROVED','REFUSED') AND (s.actor_user_id = r.requester_user_id OR s.actor_user_id = r.subject_user_id)`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM corporate_membership_request_steps s JOIN corporate_membership_requests r USING (request_id) WHERE s.actor_user_id = r.subject_user_id`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM corporate_membership_requests WHERE requester_user_id = subject_user_id`), 0);
  // every authority-increasing execution was preceded by an approval by an independent checker
  assert.equal(await count(`SELECT count(*)::int AS n FROM corporate_membership_requests r JOIN corporate_membership_request_steps x ON x.request_id = r.request_id AND x.step_type = 'EXECUTED'
                              WHERE r.approval_required AND NOT EXISTS (SELECT 1 FROM corporate_membership_request_steps a WHERE a.request_id = r.request_id AND a.step_type = 'APPROVED' AND a.step_seq < x.step_seq AND a.actor_user_id NOT IN (r.requester_user_id, r.subject_user_id))`), 0);
  // direct operations carry exactly one step; at most one decision and one terminal step per request
  assert.equal(await count(`SELECT count(*)::int AS n FROM corporate_membership_requests r WHERE NOT approval_required AND (SELECT count(*) FROM corporate_membership_request_steps s WHERE s.request_id = r.request_id) <> 1`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM (SELECT request_id FROM corporate_membership_request_steps WHERE step_type IN ('APPROVED','REFUSED') GROUP BY 1 HAVING count(*) > 1) d`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM (SELECT request_id FROM corporate_membership_request_steps WHERE step_type IN ('REFUSED','CANCELLED','EXPIRED','EXECUTED','EXECUTION_REFUSED') GROUP BY 1 HAVING count(*) > 1) d`), 0);
  // nothing ever left ENDED
  assert.equal(await count(`SELECT count(*)::int AS n FROM corporate_membership_events e WHERE e.from_state = 'ENDED'`), 0);
  // there is no capability anywhere: the membership tables still have no permission-shaped column
  assert.equal(await count(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'corporate\\_%' AND column_name ~ '(capabilit|permission|grant)' AND column_name NOT IN ('governance_decision')`), 0);
});
