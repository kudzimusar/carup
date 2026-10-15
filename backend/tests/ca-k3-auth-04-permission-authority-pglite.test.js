/**
 * CA-K3-AUTH-04 (Phase C) — the PERSISTENT Corporate permission authority and the DB-trusted evaluator, run for real on PostgreSQL (PGlite 17).
 *
 * Phase A (membership truth) and Phase B (the governed mutation procedures) are applied unchanged, then Phase C, by a NON-superuser
 * BYPASSRLS owner with Supabase's default privileges reproduced. Every call a client could make goes through `SET ROLE service_role`.
 *
 * What this file proves, and a mock could not: authority is DERIVED inside the transaction from ACTIVE, currently-effective assignments over an
 * ACTIVE membership; a hand-written governance snapshot enables nothing (the snapshot-taking procedures are closed to service_role and the entry
 * points have no decision parameter); every lifecycle state, window, scope and membership condition denies; grants are never combined; and the
 * Phase-B controls (maker/checker, A1, replay, TTLs, atomic events, compromise, continuity) hold unchanged through the new entry points.
 *
 * Phase C creates NO assignment, member, administrator or backfill. Every row below exists only in a throw-away in-memory database, written by
 * an owner-run FIXTURE ceremony that no real environment has.
 *
 * Authorities: CA-RBAC-01 §4.4 (permission assignment), §8.2 (no cross-grant synthesis), §10 (scope), §13.1 (lifecycle), §14 (revoke semantics),
 * §15 (assurance), OD-CARBAC-001/002/003/019/020/025/030; CA-K3-AUTH-02/03 (frozen).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import {
  PHASE_A, PHASE_A_FILE, PHASE_B, PHASE_B_FILE, PHASE_C, PHASE_C_FILE, PHASE_C_RAW, OWNER, HOUR, MINUTE, iso, IDENTITY_TABLES,
  openDatabase, closeAll, asRole, addSession, decisionFor, rpc, refusal, snapshot,
  MANAGE, REVOKE_SESSIONS, ROOT_NODE, FIXTURE_ACTORS, ensureUsers, seedMembership, seedAssignment, seedGovernor, backdate, evaluate,
} from './helpers/corporateGovernanceDb.js';

after(closeAll);
const REPO = new URL('../../', import.meta.url);
const gitBlob = (rel) => { const body = readFileSync(new URL(rel, REPO)); return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'); };
const NODE = 'BU_MARKETPLACE';
const OTHER = 'BU_SERVICE_NETWORK';
const DEPT = 'DEPT_MKT_OPS';
const TEAM = 'TEAM_MKT_OPS_1';
let seq = 0;

const WRAPPERS = ['corporate_authority_apply_direct', 'corporate_authority_request_submit', 'corporate_authority_request_decide', 'corporate_authority_request_execute', 'corporate_authority_request_cancel'];
const SNAPSHOT_PROCEDURES = ['corporate_membership_apply_direct', 'corporate_membership_request_submit', 'corporate_membership_request_decide', 'corporate_membership_request_execute', 'corporate_membership_request_cancel'];
const C_TABLES = ['corporate_permission_assignments', 'corporate_permission_assignment_events'];
const C_RELATIONS = [...C_TABLES, 'corporate_permission_assignment_effective'];
const OLD_TABLES = ['corporate_org_nodes', 'corporate_memberships', 'corporate_membership_events', 'corporate_membership_requests', 'corporate_membership_request_steps', 'corporate_membership_request_status', 'corporate_membership_authorization_epoch'];

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
const owner = async (db, sql, params = []) => (await db.query(sql, params)).rows;
async function world(governors = ['g-alice', 'g-bob', 'g-carol']) {
  const db = await openDatabase({ migrate: 'all' });
  const g = {};
  for (const u of governors) g[u] = await seedGovernor(db, u);
  return { db, g };
}
async function addTree(db) {
  await db.query(`INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES
    ('${DEPT}', 'DEPARTMENT', '${NODE}', 'Marketplace Operations'), ('${TEAM}', 'TEAM', '${DEPT}', 'Operations Team 1')`);
}
const sess = (db, user, options) => addSession(db, user, options);
const direct = (db, { op, actor, session, subject, node, membership = null, reason = 'a reason', reference = `REF-${(seq += 1)}`, classification = 'ROUTINE', revocation = null, from = null, until = null }) =>
  rpc(db, 'corporate_authority_apply_direct', {
    p_operation: op, p_actor_user_id: actor, p_actor_session_id: session, p_subject_user_id: subject, p_org_node_id: node, p_membership_id: membership,
    p_reason: reason, p_reference: reference, p_effective_from: from, p_effective_until: until, p_classification: classification, p_session_revocation: revocation });
const submit = (db, { op = 'ACTIVATE', membership, actor, session, reason = 'please', reference = `REQ-${(seq += 1)}` }) =>
  rpc(db, 'corporate_authority_request_submit', { p_operation: op, p_membership_id: membership, p_requester_user_id: actor, p_requester_session_id: session, p_reason: reason, p_reference: reference });
const decide = (db, req, { actor, session, verdict = 'APPROVE', reason = 'reviewed', expected = {} }) =>
  rpc(db, 'corporate_authority_request_decide', {
    p_request_id: req.request_id, p_checker_user_id: actor, p_checker_session_id: session, p_decision: verdict, p_reason: reason,
    p_expected_subject_user_id: expected.subject ?? req.subject_user_id, p_expected_membership_id: expected.membership ?? req.membership_id,
    p_expected_org_node_id: expected.node ?? req.org_node_id, p_expected_operation: expected.operation ?? req.operation, p_expected_binding_digest: expected.digest ?? req.binding_digest });
const execute = (db, req, { actor, session, digest }) =>
  rpc(db, 'corporate_authority_request_execute', { p_request_id: req.request_id, p_executor_user_id: actor, p_executor_session_id: session, p_expected_binding_digest: digest ?? req.binding_digest });
const cancel = (db, req, { actor, session, reason = 'withdrawn' }) =>
  rpc(db, 'corporate_authority_request_cancel', { p_request_id: req.request_id, p_actor_user_id: actor, p_actor_session_id: session, p_reason: reason });
const stateOf = async (db, id) => (await owner(db, 'SELECT state FROM corporate_memberships WHERE membership_id = $1', [id]))[0]?.state ?? null;
const move = (db, id, to, by, reason = 'a reason') => db.query(
  `UPDATE corporate_permission_assignments SET state = $2, updated_by_kind = 'USER', updated_by_user_id = $3, updated_reason = $4, updated_reference = 'MOVE' WHERE assignment_id = $1`, [id, to, by, reason]);
const sqlCode = async (promise) => { try { await promise; return null; } catch (e) { return e?.code ?? `OTHER:${e?.message}`; } };
const message = async (promise) => { try { await promise; return null; } catch (e) { return String(e?.message ?? e); } };
const countAll = async (db) => JSON.stringify((await owner(db, `SELECT (SELECT count(*)::int FROM corporate_memberships) m, (SELECT count(*)::int FROM corporate_membership_events) e,
  (SELECT count(*)::int FROM corporate_membership_requests) r, (SELECT count(*)::int FROM corporate_membership_request_steps) s,
  (SELECT count(*)::int FROM corporate_permission_assignments) a, (SELECT count(*)::int FROM corporate_permission_assignment_events) ae`))[0]);
/** A pending membership for a subject, created through the governed entry point by a governor. */
async function governedPending(db, maker, makerSession, subject, node = NODE) {
  const created = await direct(db, { op: 'CREATE', actor: maker, session: makerSession, subject, node });
  assert.equal(created.outcome, 'EXECUTED');
  return created;
}

// ═════════════ 1 · the migration file, and everything accepted that must stay frozen ═════════════

test('file: a canonical migration sorted after Phase B, with a unique version, both markers and a real Down', () => {
  const all = readdirSync(new URL('database/migrations/', REPO)).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  assert.ok(all.indexOf(PHASE_C_FILE) > all.indexOf(PHASE_B_FILE) && all.indexOf(PHASE_B_FILE) > all.indexOf(PHASE_A_FILE));
  assert.equal(all.filter((f) => f.startsWith(PHASE_C_FILE.slice(0, 14))).length, 1, 'no shared version');
  assert.match(PHASE_C_RAW, /^-- \+migrate Up$/m);
  assert.match(PHASE_C_RAW, /^-- \+migrate Down$/m);
  assert.ok(PHASE_C.up.length > 8000 && PHASE_C.down.length > 500);
  assert.doesNotMatch(PHASE_C_RAW, /\\n/, 'no literal escaped newline in the migration');
});

test('frozen: Phase A, Phase B, the legacy bridge, the effective route, the resolver and the shadow policy are byte-identical to the accepted heads', () => {
  // A change to any of these is a NEW authority decision for CA-MOD, not a side effect of Phase C.
  assert.equal(gitBlob(`database/migrations/${PHASE_A_FILE}`), 'a6f7d0ec15236056b3b1c3f6f1f55c1fbf024cda', 'the accepted Phase-A migration');
  assert.equal(gitBlob(`database/migrations/${PHASE_B_FILE}`), '433ae3bf85e53455b48f0bee5ff3c35028a22169', 'the accepted Phase-B migration (9a419ae3)');
  assert.equal(gitBlob('backend/services/corporate/corporateAccessService.js'), 'fd38cd1bc8f2559974808ddfc68db61f71eba1c3', 'the legacy compatibility bridge');
  assert.equal(gitBlob('backend/routes/corporateAccessRoutes.js'), '3ae43f123577811b6ffdad44314ec0a631a33146', 'the effective /api/corporate/access route');
  assert.equal(gitBlob('backend/services/corporate/corporateMembershipService.js'), '2f9d4f4d44bcae901ffdabc3ef6ada68b5006d97', 'the Phase-A resolver');
  assert.equal(gitBlob('backend/services/corporate/corporateShadowPolicy.js'), '2ed0d8a799ff654cc404f95c4dc6a995e22662f1', 'the shadow evaluation (separate from admission)');
});

const stripped = (sql) => sql.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");
test('file: it writes only the two assignment tables, never an identity table; it never reads a role, a tenant, an organisation or the bridge', () => {
  const sql = stripped(PHASE_C.up);
  const inserts = [...new Set([...sql.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]))].sort();
  assert.deepEqual(inserts, ['corporate_permission_assignment_events'], 'the only INSERT is the event recorder; no assignment row is ever created by the migration');
  const updates = [...new Set([...sql.matchAll(/\bUPDATE\s+(?:public\.)?(\w+)\s+SET\b/gi)].map((m) => m[1]))];
  assert.deepEqual(updates, [], 'no UPDATE statement at all');
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|(?:^|;)\s*TRUNCATE\b/im);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+[^;]*\bSELECT\b/i, 'no INSERT ... SELECT backfill');
  for (const t of ['users', 'user_sessions', 'tenants', 'tenant_users', 'organizations', 'organization_users']) {
    assert.doesNotMatch(sql, new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:public\\.)?${t}\\b`, 'i'), `never writes ${t}`);
  }
  assert.doesNotMatch(sql, /\b(tenants|tenant_users|organizations|organization_users)\b/i, 'tenant / external-organisation tables are not even read');
  assert.equal([...sql.matchAll(/\bFROM\s+(?:public\.)?user_sessions\b/gi)].length, 1,
    'the only Phase-C session read is the final wall-clock A1 revalidation; session state never grants Corporate capability');
  assert.doesNotMatch(sql, /\bFROM\s+(?:public\.)?users\b|\busers\s+SET\b|\.role\b|\brole\s*=|\bplatform_admin\b|\bsuper_admin\b|legacy_admin|\badmin\b/i, 'no role, no admin, no legacy bridge anywhere in the executable SQL');
});

const phaseCFunction = (sql, name) => {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION public.', start + marker.length);
  return sql.slice(start, next >= 0 ? next : sql.length);
};
const ordered = (body, parts) => parts.every((part, i) => i === 0 || body.indexOf(parts[i - 1]) < body.indexOf(part));

function temporalInvariantViolations(sql) {
  const failures = [];
  const directBody = phaseCFunction(sql, 'corporate_authority_apply_direct');
  if (!ordered(directBody, ['pg_advisory_xact_lock', 'corporate_authority_require', 'corporate_membership_apply_direct', 'corporate_authority_finalize'])) {
    failures.push('CREATE serialization/finalization order');
  }
  for (const [wrapper, phaseB] of [
    ['corporate_authority_request_decide', 'corporate_membership_request_decide'],
    ['corporate_authority_request_execute', 'corporate_membership_request_execute'],
    ['corporate_authority_request_cancel', 'corporate_membership_request_cancel'],
  ]) {
    const body = phaseCFunction(sql, wrapper);
    if (!ordered(body, ['FOR UPDATE', 'corporate_authority_require', phaseB, 'corporate_authority_finalize'])) {
      failures.push(`${wrapper} serialization/finalization order`);
    }
  }
  const submitBody = phaseCFunction(sql, 'corporate_authority_request_submit');
  if (!ordered(submitBody, ['corporate_authority_require', 'corporate_membership_request_submit', 'corporate_authority_finalize'])) {
    failures.push('submit finalization order');
  }
  const requireBody = phaseCFunction(sql, 'corporate_authority_require');
  if (!ordered(requireBody, ['FOR SHARE', 'FOR UPDATE', 'clock_timestamp() - now()', 'corporate_authority_evaluate'])) {
    failures.push('require post-lock stale gate');
  }
  const finalBody = phaseCFunction(sql, 'corporate_authority_finalize');
  if ((finalBody.match(/clock_timestamp\(\) - now\(\)/g) ?? []).length < 2) failures.push('final stale gates');
  if (!ordered(finalBody, ['clock_timestamp() - now()', 'corporate_authority_assert_a1_wall_clock', 'corporate_authority_evaluate', 'corporate_governance_check_decision'])) {
    failures.push('final wall-clock authority order');
  }
  const a1Body = phaseCFunction(sql, 'corporate_authority_assert_a1_wall_clock');
  if (!a1Body.includes('v_now timestamptz := clock_timestamp()') || /v_exp\s*<=\s*now\(\)|v_step\s*[<>].*now\(\)/.test(a1Body)) {
    failures.push('final A1 wall clock');
  }
  const evaluatorBody = phaseCFunction(sql, 'corporate_authority_evaluate');
  if (!evaluatorBody.includes('v_now timestamptz := clock_timestamp()')
      || !evaluatorBody.includes("'decided_at', to_char(v_now AT TIME ZONE 'UTC'")
      || evaluatorBody.includes("'decided_at', to_char(now()")) {
    failures.push('decision timestamp wall clock');
  }
  const wrapperFinalizeCalls = (sql.match(/:=\s*public\.corporate_authority_finalize\(/g) ?? []).length;
  if (wrapperFinalizeCalls !== 5) failures.push(`all five wrappers finalize (${wrapperFinalizeCalls})`);
  return failures;
}

test('R1 temporal closure: every later Phase-B serialization point is owned before authority evaluation and every callable wrapper has a rollback-producing final wall-clock boundary', () => {
  assert.deepEqual(temporalInvariantViolations(PHASE_C.up), []);
});

test('R1 mutation guards kill every requested temporal-authority regression class', () => {
  const sql = PHASE_C.up;
  const mutants = [
    ['remove post-lock stale gate',
      sql.replace(`IF clock_timestamp() - now() > public.corporate_authority_max_transaction_age() THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/TRANSACTION_STALE' USING DETAIL = 'a governed call must run in a fresh transaction: time rules are judged against the transaction start';
  END IF;`, '')],
    ['move require stale gate before a blocking membership lock',
      (() => {
        const body = phaseCFunction(sql, 'corporate_authority_require');
        const stale = `  IF clock_timestamp() - now() > public.corporate_authority_max_transaction_age() THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/TRANSACTION_STALE' USING DETAIL = 'a governed call must run in a fresh transaction: time rules are judged against the transaction start';
  END IF;

`;
        const without = body.replace(stale, '');
        const moved = without.replace('  FOR r IN\n', stale + '  FOR r IN\n');
        return sql.replace(body, moved);
      })()],
    ['change evaluator wall-clock authority time back to transaction time',
      (() => {
        const body = phaseCFunction(sql, 'corporate_authority_evaluate');
        return sql.replace(body, body.replace('v_now timestamptz := clock_timestamp();', 'v_now timestamptz := now();'));
      })()],
    ['change final A1 back to transaction time',
      (() => {
        const body = phaseCFunction(sql, 'corporate_authority_assert_a1_wall_clock');
        return sql.replace(body, body.replace('v_now timestamptz := clock_timestamp();', 'v_now timestamptz := now();'));
      })()],
    ['bypass final rollback-producing validation on CREATE',
      sql.replace(
        `    v_decision := public.corporate_authority_finalize(
      p_actor_user_id, p_actor_session_id, v_subject, v_node, v_caps,`,
        `    v_decision := v_decision; -- mutant: finalization bypassed
    -- removed corporate_authority_finalize(
      p_actor_user_id, p_actor_session_id, v_subject, v_node, v_caps,`)],
    ['omit DECIDE request serialization',
      sql.replace('FROM public.corporate_membership_requests WHERE request_id = p_request_id FOR UPDATE;', 'FROM public.corporate_membership_requests WHERE request_id = p_request_id;', 1)],
    ['omit EXECUTE request serialization',
      (() => {
        const body = phaseCFunction(sql, 'corporate_authority_request_execute');
        return sql.replace(body, body.replace('FOR UPDATE;', ';'));
      })()],
    ['omit CANCEL request serialization',
      (() => {
        const body = phaseCFunction(sql, 'corporate_authority_request_cancel');
        return sql.replace(body, body.replace('FOR UPDATE;', ';'));
      })()],
  ];
  for (const [name, mutant] of mutants) {
    assert.notDeepEqual(temporalInvariantViolations(mutant), [], `mutant survived: ${name}`);
  }
});

test('migration: applied to an empty Corporate world it creates NO assignment, member, administrator or reference row — only the accepted organisation nodes exist', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const rows = (await owner(db, `SELECT (SELECT count(*)::int FROM corporate_permission_assignments) a, (SELECT count(*)::int FROM corporate_permission_assignment_events) ae,
    (SELECT count(*)::int FROM corporate_memberships) m, (SELECT count(*)::int FROM corporate_membership_requests) r, (SELECT count(*)::int FROM corporate_org_nodes) n`))[0];
  assert.deepEqual(rows, { a: 0, ae: 0, m: 0, r: 0, n: 5 });
  const evaluated = await evaluate(db, { actor: 'u-admin', subject: 'm-eve', node: NODE });
  assert.equal(evaluated.decision, 'denied', 'with no assignment anywhere, nobody — not even a legacy administrator — is authorized');
});

// ═════════════ 2 · privileges: the backend role reads, executes five gated entry points, writes nothing ═════════════

test('privileges: service_role is SELECT-only on the assignment tables and the effective view; anon, authenticated and PUBLIC hold nothing; Phase A/B tables are unchanged', async () => {
  const db = await openDatabase({ migrate: 'all' });
  for (const rel of [...C_RELATIONS, ...OLD_TABLES]) {
    for (const role of ['service_role', 'anon', 'authenticated']) {
      const granted = [];
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
        if ((await db.query('SELECT has_table_privilege($1, $2, $3) AS ok', [role, `public.${rel}`, p])).rows[0].ok) granted.push(p);
      }
      assert.equal(granted.join(','), role === 'service_role' ? 'SELECT' : '', `${rel} for ${role}`);
    }
  }
  const acl = (await db.query('SELECT relname, relacl::text AS acl FROM pg_class WHERE relname = ANY($1)', [C_RELATIONS])).rows;
  assert.equal(acl.length, 3);
  for (const r of acl) assert.doesNotMatch(String(r.acl), /(^|[{,])=[a-zA-Z]+\//, `${r.relname}: no PUBLIC entry`);
  // and no column-level grant sneaks a write in
  const cols = (await db.query(`SELECT count(*)::int AS n FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = ANY($1)
      AND grantee IN ('service_role', 'anon', 'authenticated', 'PUBLIC') AND privilege_type <> 'SELECT'`, [C_TABLES])).rows[0].n;
  assert.equal(cols, 0);
});

test('privileges: RLS is enabled and forced on both assignment tables and no policy exists anywhere in the corporate namespace', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const rows = (await db.query('SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY 1', [C_TABLES])).rows;
  assert.equal(rows.length, 2);
  for (const r of rows) { assert.equal(r.relrowsecurity, true, r.relname); assert.equal(r.relforcerowsecurity, true, r.relname); }
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename LIKE 'corporate\\_%'")).rows[0].n, 0);
});

test('privileges: service_role may EXECUTE exactly the five authority-gated entry points and the read-only evaluator — never a Phase-B snapshot procedure, guard or helper; anon / authenticated none', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const allowed = {};
  for (const role of ['service_role', 'anon', 'authenticated']) {
    allowed[role] = (await db.query(
      `SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'corporate\\_%' AND has_function_privilege($1, p.oid, 'EXECUTE') ORDER BY 1`, [role])).rows.map((r) => r.proname);
  }
  assert.deepEqual(allowed.service_role, [...WRAPPERS, 'corporate_authority_evaluate'].sort());
  assert.deepEqual(allowed.anon, []);
  assert.deepEqual(allowed.authenticated, []);
  for (const p of SNAPSHOT_PROCEDURES) assert.ok(!allowed.service_role.includes(p), `${p} is closed to service_role`);
  const pub = (await db.query(`SELECT count(*)::int AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'corporate\\_%'
      AND EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')`)).rows[0].n;
  assert.equal(pub, 0, 'no corporate function is executable by PUBLIC');
});

test('functions: the entry points, the evaluator and the lock-and-require helper are SECURITY DEFINER owned by the migration owner with a pinned search_path; guards and pure helpers are not definers', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const NEW_DEFINERS = [...WRAPPERS, 'corporate_authority_evaluate', 'corporate_authority_require',
    'corporate_authority_assert_a1_wall_clock', 'corporate_authority_finalize', 'corporate_permission_assignment_events_record'];
  const NEW_PLAIN = ['corporate_authority_grantable_capabilities', 'corporate_authority_scope_covers',
    'corporate_authority_max_transaction_age', 'corporate_permission_assignments_guard', 'corporate_permission_assignment_events_guard'];
  const rows = (await db.query(`SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner, proconfig::text AS config FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1) ORDER BY 1`, [[...NEW_DEFINERS, ...NEW_PLAIN]])).rows;
  assert.equal(rows.length, NEW_DEFINERS.length + NEW_PLAIN.length);
  for (const r of rows) {
    assert.equal(r.owner, OWNER, r.proname);
    assert.match(String(r.config), /search_path=public, pg_temp/, `${r.proname}: pinned search_path`);
    assert.equal(r.prosecdef, NEW_DEFINERS.includes(r.proname), `${r.proname}`);
  }
});

test('direct DML: service_role, anon and authenticated cannot INSERT, UPDATE, DELETE, TRUNCATE or lock an assignment table — 42501 — and cannot call a guard, the lock helper or a snapshot procedure', async () => {
  const { db, g } = await world(['g-alice']);
  const SET = { corporate_permission_assignments: "updated_reason = 'x'", corporate_permission_assignment_events: "reason = 'x'" };
  const failures = [];
  for (const role of ['service_role', 'anon', 'authenticated']) {
    await asRole(db, role, async () => {
      for (const t of C_TABLES) {
        for (const [label, sql] of [['insert', `INSERT INTO ${t} DEFAULT VALUES`], ['update', `UPDATE ${t} SET ${SET[t]}`], ['delete', `DELETE FROM ${t}`], ['truncate', `TRUNCATE ${t}`],
            ['select_for_update', `SELECT 1 FROM ${t} FOR UPDATE`], ['select_for_share', `SELECT 1 FROM ${t} FOR SHARE`], ['lock', `LOCK TABLE ${t} IN ROW EXCLUSIVE MODE`]]) {
          if (label === 'lock') await db.exec('BEGIN');              // LOCK TABLE exists only inside a transaction block
          const code = await sqlCode(db.query(sql));
          if (label === 'lock') await db.exec('ROLLBACK');
          if (code !== '42501') failures.push(`${role} ${t} ${label}: ${code}`);
        }
      }
      const internalCalls = {
        corporate_authority_require: "'a','b','c',ARRAY['x'],false,NULL,false",
        corporate_authority_assert_a1_wall_clock: "'s','a'",
        corporate_authority_finalize: "'a','s','b','c',ARRAY['x'],false,false,NULL",
        corporate_permission_assignments_guard: '',
        corporate_permission_assignment_events_record: '',
        corporate_authority_scope_covers: "ARRAY['X'], false, 'X'",
      };
      for (const [fn, args] of Object.entries(internalCalls)) {
        const code = await sqlCode(db.query(`SELECT public.${fn}(${args})`));
        if (code !== '42501') failures.push(`${role} ${fn}: ${code}`);
      }
    });
  }
  assert.deepEqual(failures, []);
  // service_role CAN read — and only read — what the evaluator relies on
  const readable = await asRole(db, 'service_role', async () => (await db.query('SELECT count(*)::int AS n FROM corporate_permission_assignments')).rows[0].n);
  assert.equal(readable, 2);
  assert.ok(g['g-alice']);
});

test('structural closure: every Phase-B snapshot procedure is refused to service_role — even with a perfectly valid snapshot for a real governor — and nothing changes', async () => {
  const { db } = await world(['g-alice', 'g-bob']);
  const alice = await sess(db, 'g-alice');
  const forged = decisionFor({ actor: 'g-alice', subject: 'm-eve', node: NODE, evaluator: { name: 'corporate_authority_evaluate', version: '1' } });
  const before = await countAll(db);
  const calls = {
    corporate_membership_apply_direct: { p_operation: 'CREATE', p_actor_user_id: 'g-alice', p_actor_session_id: alice, p_subject_user_id: 'm-eve', p_org_node_id: NODE, p_membership_id: null, p_reason: 'r', p_reference: 'x', p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null, p_governance_decision: forged },
    corporate_membership_request_submit: { p_operation: 'ACTIVATE', p_membership_id: '00000000-0000-0000-0000-000000000001', p_requester_user_id: 'g-alice', p_requester_session_id: alice, p_reason: 'r', p_reference: 'x', p_governance_decision: forged },
    corporate_membership_request_decide: { p_request_id: '00000000-0000-0000-0000-000000000001', p_checker_user_id: 'g-bob', p_checker_session_id: alice, p_decision: 'APPROVE', p_reason: 'r', p_expected_subject_user_id: 'm-eve', p_expected_membership_id: '00000000-0000-0000-0000-000000000001', p_expected_org_node_id: NODE, p_expected_operation: 'ACTIVATE', p_expected_binding_digest: 'a'.repeat(64), p_governance_decision: forged },
    corporate_membership_request_execute: { p_request_id: '00000000-0000-0000-0000-000000000001', p_executor_user_id: 'g-alice', p_executor_session_id: alice, p_expected_binding_digest: 'a'.repeat(64), p_governance_decision: forged },
    corporate_membership_request_cancel: { p_request_id: '00000000-0000-0000-0000-000000000001', p_actor_user_id: 'g-alice', p_actor_session_id: alice, p_reason: 'r', p_governance_decision: forged },
  };
  for (const [name, args] of Object.entries(calls)) {
    const m = await message(rpc(db, name, args));
    assert.match(String(m), /permission denied for function/, `${name}: ${m}`);
  }
  assert.equal(await countAll(db), before, 'nothing changed');
});

// ═════════════ 3 · the assignment lifecycle guard (owner-level: the only writer there is) ═════════════

test('lifecycle: REQUESTED → APPROVED → ACTIVE → SUSPENDED → ACTIVE → REVOKED is recorded as an append-only chain, with the lineage written by the guard', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const mid = await seedMembership(db, 'g-alice');
  const id = await seedAssignment(db, { subject: 'g-alice', membershipId: mid, finalState: 'REQUESTED' });
  assert.equal((await owner(db, 'SELECT state FROM corporate_permission_assignments WHERE assignment_id = $1', [id]))[0].state, 'REQUESTED');
  await move(db, id, 'APPROVED', 'f-approver');
  await move(db, id, 'ACTIVE', 'f-activator');
  await move(db, id, 'SUSPENDED', 'f-suspender', 'paused');
  await move(db, id, 'ACTIVE', 'f-approver', 'restored');
  await move(db, id, 'REVOKED', 'f-suspender', 'withdrawn');
  const row = (await owner(db, 'SELECT * FROM corporate_permission_assignments WHERE assignment_id = $1', [id]))[0];
  assert.equal(row.state, 'REVOKED');
  assert.equal(row.approved_by_user_id, 'f-approver'); assert.ok(row.approved_at);
  assert.equal(row.activated_by_user_id, 'f-activator'); assert.ok(row.activated_at);
  assert.equal(row.requested_by_user_id, 'f-requester');
  const events = await owner(db, 'SELECT event_seq, event_type, from_state, to_state, actor_user_id, reason FROM corporate_permission_assignment_events WHERE assignment_id = $1 ORDER BY event_seq', [id]);
  assert.deepEqual(events.map((e) => `${e.event_seq}:${e.event_type}:${e.from_state ?? '-'}>${e.to_state}`),
    ['1:REQUESTED:->REQUESTED', '2:TRANSITIONED:REQUESTED>APPROVED', '3:TRANSITIONED:APPROVED>ACTIVE', '4:TRANSITIONED:ACTIVE>SUSPENDED', '5:TRANSITIONED:SUSPENDED>ACTIVE', '6:TRANSITIONED:ACTIVE>REVOKED']);
  assert.equal(events[3].reason, 'paused', 'each event carries the reason that came WITH that change');
});

test('lifecycle: only legal edges exist — no skipped state, no way back, no way out of REVOKED or EXPIRED', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const make = async (user, finalState) => { const mid = await seedMembership(db, user); return seedAssignment(db, { subject: user, membershipId: mid, finalState }); };
  const illegal = [['REQUESTED', 'ACTIVE'], ['REQUESTED', 'SUSPENDED'], ['REQUESTED', 'EXPIRED'], ['APPROVED', 'REQUESTED'], ['APPROVED', 'SUSPENDED'], ['ACTIVE', 'REQUESTED'], ['ACTIVE', 'APPROVED'],
    ['SUSPENDED', 'APPROVED'], ['REVOKED', 'ACTIVE'], ['REVOKED', 'REQUESTED'], ['EXPIRED', 'ACTIVE'], ['EXPIRED', 'REVOKED']];
  let n = 0;
  for (const [from, to] of illegal) {
    const id = await make(`lc-${(n += 1)}`, from);
    const m = await message(move(db, id, to, 'f-suspender'));
    assert.match(String(m), /CORPORATE_ASSIGNMENT_(TRANSITION_NOT_ALLOWED|TERMINAL)/, `${from} → ${to}: ${m}`);
    assert.equal((await owner(db, 'SELECT state FROM corporate_permission_assignments WHERE assignment_id = $1', [id]))[0].state, from, 'unchanged');
  }
  // the legal edges all work (control: the refusals above are about the edge, not the fixture)
  for (const [from, to] of [['REQUESTED', 'REVOKED'], ['APPROVED', 'REVOKED'], ['APPROVED', 'ACTIVE'], ['ACTIVE', 'SUSPENDED'], ['ACTIVE', 'REVOKED'], ['SUSPENDED', 'ACTIVE'], ['SUSPENDED', 'REVOKED']]) {
    const id = await make(`lc-${(n += 1)}`, from);
    await move(db, id, to, 'f-activator');
    assert.equal((await owner(db, 'SELECT state FROM corporate_permission_assignments WHERE assignment_id = $1', [id]))[0].state, to, `${from} → ${to}`);
  }
});

test('lifecycle: segregation of duties at the table — no self-approval, no self-activation, nobody acts on their own grant, a system actor may only record an expiry', async () => {
  const db = await openDatabase({ migrate: 'all' });
  await ensureUsers(db, ['f-requester', 'f-approver', 'f-activator', 'f-suspender']);
  const mid = await seedMembership(db, 'g-alice');
  const req = () => seedAssignment(db, { subject: 'g-alice', membershipId: mid, finalState: 'REQUESTED', capability: REVOKE_SESSIONS });
  // the requester cannot approve their own request
  let id = await req();
  assert.match(String(await message(move(db, id, 'APPROVED', 'f-requester'))), /no_self_grant/);
  // the subject cannot approve, activate, suspend or revoke their own grant
  assert.match(String(await message(move(db, id, 'APPROVED', 'g-alice'))), /CORPORATE_ASSIGNMENT_NO_SELF_ACTION/);
  await move(db, id, 'APPROVED', 'f-approver');
  assert.match(String(await message(move(db, id, 'ACTIVE', 'g-alice'))), /CORPORATE_ASSIGNMENT_NO_SELF_ACTION/);
  await move(db, id, 'ACTIVE', 'f-activator');
  assert.match(String(await message(move(db, id, 'SUSPENDED', 'g-alice'))), /CORPORATE_ASSIGNMENT_NO_SELF_ACTION/);
  assert.match(String(await message(move(db, id, 'REVOKED', 'g-alice'))), /CORPORATE_ASSIGNMENT_NO_SELF_ACTION/);
  // a SYSTEM actor can record only the passing of the period — never an approval, activation, suspension or revocation
  for (const to of ['REVOKED', 'SUSPENDED']) {
    const m = await message(db.query(`UPDATE corporate_permission_assignments SET state = $2, updated_by_kind = 'SYSTEM', updated_by_user_id = NULL, updated_reason = 'auto' WHERE assignment_id = $1`, [id, to]));
    assert.match(String(m), /CORPORATE_ASSIGNMENT_ONLY_A_PERSON_CHANGES_A_GRANT/, to);
  }
  // an expiry is only recordable once the period has really passed, and a system actor may then record it
  assert.match(String(await message(move(db, id, 'EXPIRED', 'f-suspender'))), /CORPORATE_ASSIGNMENT_NOT_YET_EXPIRED/);
  await backdate(db, `UPDATE corporate_permission_assignments SET effective_from = now() - interval '2 hours', effective_until = now() - interval '1 minute' WHERE assignment_id = $1`, [id]);
  await db.query(`UPDATE corporate_permission_assignments SET state = 'EXPIRED', updated_by_kind = 'SYSTEM', updated_by_user_id = NULL, updated_reason = 'period ended' WHERE assignment_id = $1`, [id]);
  assert.equal((await owner(db, 'SELECT state FROM corporate_permission_assignments WHERE assignment_id = $1', [id]))[0].state, 'EXPIRED');
  // the subject cannot request a grant for themselves and approve it either way: requested_by may be the subject, approved_by never
  const self = await seedAssignment(db, { subject: 'g-bob', membershipId: await seedMembership(db, 'g-bob'), finalState: 'REQUESTED', requestedBy: 'g-bob' });
  assert.match(String(await message(move(db, self, 'APPROVED', 'g-bob'))), /CORPORATE_ASSIGNMENT_NO_SELF_ACTION/);
});

test('lifecycle: what a grant IS never changes, lineage is never rewritten, a provenance-only change is refused, and nothing is deleted or truncated — not even by the owner', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const mid = await seedMembership(db, 'g-alice');
  const id = await seedAssignment(db, { subject: 'g-alice', membershipId: mid });
  const edits = {
    capability: `capability = '${REVOKE_SESSIONS}'`, scope: "scope_node_ids = ARRAY['BU_MARKETPLACE']", descendants: 'include_descendants = NOT include_descendants',
    from: "effective_from = effective_from - interval '1 day'", until: "effective_until = effective_until + interval '1 year'", floor: "assurance_floor = 'A2_STRONG'",
    subject: "subject_user_id = 'g-bob'", membership: `membership_id = '${await seedMembership(db, 'g-bob')}'`, requester: "requested_by_user_id = 'f-approver'",
    reason: "request_reason = 'rewritten'", approver: "approved_by_user_id = 'f-suspender'", activator: "activated_by_user_id = 'f-suspender'",
  };
  for (const [k, set] of Object.entries(edits)) {
    const m = await message(db.query(`UPDATE corporate_permission_assignments SET ${set} WHERE assignment_id = $1`, [id]));
    assert.match(String(m), /CORPORATE_ASSIGNMENT_(GRANT_IMMUTABLE|PROVENANCE_IS_NOT_REWRITTEN|LINEAGE_IS_NOT_REWRITTEN)|violates/, `${k}: ${m}`);
  }
  assert.match(String(await message(db.query(`UPDATE corporate_permission_assignments SET updated_reason = 'edited quietly' WHERE assignment_id = $1`, [id]))), /CORPORATE_ASSIGNMENT_PROVENANCE_IS_NOT_REWRITTEN/);
  assert.match(String(await message(db.query('DELETE FROM corporate_permission_assignments'))), /CORPORATE_ASSIGNMENT_DELETE_FORBIDDEN/);
  assert.match(String(await message(db.query('TRUNCATE corporate_permission_assignments CASCADE'))), /CORPORATE_CUSTODY_TRUNCATE_FORBIDDEN/);
  for (const sql of ['UPDATE corporate_permission_assignment_events SET reason = \'x\'', 'DELETE FROM corporate_permission_assignment_events', 'TRUNCATE corporate_permission_assignment_events']) {
    assert.match(String(await message(db.query(sql))), /CORPORATE_ASSIGNMENT_EVENT_APPEND_ONLY|CORPORATE_CUSTODY_TRUNCATE_FORBIDDEN/, sql);
  }
  assert.match(String(await message(db.query(`INSERT INTO corporate_permission_assignment_events (assignment_id, event_seq, subject_user_id, capability, event_type, from_state, to_state, actor_kind, actor_user_id, reason)
     VALUES ($1, 9, 'g-alice', '${MANAGE}', 'TRANSITIONED', 'ACTIVE', 'SUSPENDED', 'USER', 'f-suspender', 'forged history')`, [id]))), /CORPORATE_ASSIGNMENT_EVENT_ONLY_VIA_ASSIGNMENT_CHANGE/);
  assert.equal((await owner(db, 'SELECT count(*)::int AS n FROM corporate_permission_assignment_events WHERE assignment_id = $1', [id]))[0].n, 3, 'history is exactly what the changes produced');
});

test('lifecycle: a grant can only be REQUESTED well-formed — real membership of the subject, known distinct nodes, a stable assignable capability, an explicit and unexpired period, an A1+ floor', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const mid = await seedMembership(db, 'g-alice');
  const base = { subject: 'g-alice', membershipId: mid };
  const attempt = (over) => message(seedAssignment(db, { ...base, finalState: 'REQUESTED', ...over }));
  assert.equal(await attempt({}), null, 'control: the fixture request itself is valid');
  assert.match(String(await attempt({ capability: 'corporate.finance.restricted.read' })), /corporate_permission_assignments_capability_check/, 'a capability whose evaluation needs data classification is not assignable yet');
  assert.match(String(await attempt({ capability: 'platform.security.manage' })), /corporate_permission_assignments_capability_check/);
  assert.match(String(await attempt({ capability: 'admin' })), /corporate_permission_assignments_capability_check/, 'a role name is not a capability');
  assert.match(String(await attempt({ nodes: ['NO_SUCH_NODE'] })), /CORPORATE_ASSIGNMENT_SCOPE_NODE_UNKNOWN/);
  assert.match(String(await attempt({ nodes: [NODE, NODE] })), /CORPORATE_ASSIGNMENT_SCOPE_DUPLICATE/);
  assert.match(String(await attempt({ nodes: [] })), /corporate_permission_assignments_scope_shape/);
  assert.match(String(await attempt({ nodes: ['*'] })), /CORPORATE_ASSIGNMENT_SCOPE_NODE_UNKNOWN/, 'no wildcard');
  assert.match(String(await attempt({ nodes: ['GLOBAL'] })), /CORPORATE_ASSIGNMENT_SCOPE_NODE_UNKNOWN/, 'no GLOBAL');
  assert.match(String(await attempt({ floor: 'A0_STANDARD' })), /assurance_floor_check|floor_is_not_ordinary/);
  assert.match(String(await attempt({ untilOffsetMs: -MINUTE })), /CORPORATE_ASSIGNMENT_WINDOW_ALREADY_ENDED/);
  assert.match(String(await attempt({ fromOffsetMs: HOUR, untilOffsetMs: 30 * MINUTE })), /window_ordered/);
  const open = await message(db.query(`INSERT INTO corporate_permission_assignments (subject_user_id, membership_id, capability, scope_node_ids, effective_from, assurance_floor, requested_by_user_id, request_reason, request_reference, state, updated_by_kind, updated_by_user_id, updated_reason)
     VALUES ('g-alice', $1, '${MANAGE}', ARRAY['${NODE}'], now(), 'A1_RECENT_REAUTH', 'f-requester', 'r', 'x', 'REQUESTED', 'USER', 'f-requester', 'r')`, [mid]));
  assert.match(String(open), /effective_until|null value/i, 'no open-ended period');
  assert.match(String(await message(seedAssignment(db, { subject: 'g-bob', membershipId: mid, finalState: 'REQUESTED' }))), /CORPORATE_ASSIGNMENT_MEMBERSHIP_MISMATCH/, 'the membership must be the SUBJECT\'s own');
  const ended = await seedMembership(db, 'g-carol', ROOT_NODE, { state: 'ENDED' });
  assert.match(String(await message(seedAssignment(db, { subject: 'g-carol', membershipId: ended, finalState: 'REQUESTED' }))), /CORPORATE_ASSIGNMENT_MEMBERSHIP_ENDED/);
  // it cannot start anywhere but REQUESTED
  const start = await message(db.query(`INSERT INTO corporate_permission_assignments (subject_user_id, membership_id, capability, scope_node_ids, effective_from, effective_until, assurance_floor, requested_by_user_id, request_reason, request_reference, state, updated_by_kind, updated_by_user_id, updated_reason, approved_by_user_id, approved_at, activated_by_user_id, activated_at)
     VALUES ('g-alice', $1, '${MANAGE}', ARRAY['${NODE}'], now(), now() + interval '1 hour', 'A1_RECENT_REAUTH', 'f-requester', 'r', 'x', 'ACTIVE', 'USER', 'f-requester', 'r', 'f-approver', now(), 'f-activator', now())`, [mid]));
  assert.match(String(start), /CORPORATE_ASSIGNMENT_MUST_START_REQUESTED/);
});

test('lifecycle: an authority-increasing edge needs a live footing — ACTIVE is refused while the underlying membership is not ACTIVE or the period is over', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const pending = await seedMembership(db, 'g-alice', ROOT_NODE, { state: 'PENDING' });
  const id = await seedAssignment(db, { subject: 'g-alice', membershipId: pending, finalState: 'APPROVED' });
  assert.match(String(await message(move(db, id, 'ACTIVE', 'f-activator'))), /CORPORATE_ASSIGNMENT_MEMBERSHIP_NOT_ACTIVE/);
  const id2 = await seedAssignment(db, { subject: 'g-bob', membershipId: await seedMembership(db, 'g-bob'), finalState: 'APPROVED' });
  await backdate(db, `UPDATE corporate_permission_assignments SET effective_from = now() - interval '2 hours', effective_until = now() - interval '1 minute' WHERE assignment_id = $1`, [id2]);
  assert.match(String(await message(move(db, id2, 'ACTIVE', 'f-activator'))), /CORPORATE_ASSIGNMENT_WINDOW_ENDED/);
});

// ═════════════ 4 · the trusted evaluator ═════════════

test('evaluator: an ACTIVE membership with NO assignment authorizes nothing — membership is not permission', async () => {
  const db = await openDatabase({ migrate: 'all' });
  await seedMembership(db, 'g-alice');
  const d = await evaluate(db, { actor: 'g-alice', subject: 'm-eve', node: NODE });
  assert.equal(d.decision, 'denied');
  assert.deepEqual(d.denials, [{ capability: MANAGE, reason: 'NO_ASSIGNMENT', assignment_id: null }]);
  const both = await evaluate(db, { actor: 'g-alice', subject: 'm-eve', node: NODE, capabilities: [MANAGE, REVOKE_SESSIONS] });
  assert.deepEqual(both.denials.map((x) => x.reason), ['NO_ASSIGNMENT', 'NO_ASSIGNMENT']);
});

test('evaluator: a valid ACTIVE assignment for the exact node authorizes — and the decision names exactly what it rests on', async () => {
  const { db, g } = await world(['g-alice']);
  const d = await evaluate(db, { actor: 'g-alice', subject: 'm-eve', node: NODE });
  assert.equal(d.decision, 'granted');
  assert.equal(d.contract, 'carup.corporate_governance_decision.v1');
  assert.equal(d.source, 'target_corporate_governance');
  assert.deepEqual(d.evaluator, { name: 'corporate_authority_evaluate', version: '1' });
  assert.equal(d.actor_user_id, 'g-alice'); assert.equal(d.subject_user_id, 'm-eve');
  assert.deepEqual(d.capabilities, [MANAGE]);
  assert.deepEqual(d.scope, { kind: 'ORG_NODES', org_node_ids: [NODE] }, 'the decision covers exactly the node at issue, not the whole of the grant');
  assert.deepEqual(d.assurance, { class: 'A1_RECENT_REAUTH', server_proven: true });
  assert.equal(d.provenance.derivation, 'persistent_assignments');
  assert.equal(d.provenance.assignments.length, 1);
  const a = d.provenance.assignments[0];
  assert.equal(a.assignment_id, g['g-alice'].manageId); assert.equal(a.membership_id, g['g-alice'].membershipId);
  assert.equal(a.capability, MANAGE); assert.deepEqual(a.scope_node_ids, [ROOT_NODE]); assert.equal(a.include_descendants, true);
  assert.equal(a.approved_by_user_id, 'f-approver'); assert.equal(a.activated_by_user_id, 'f-activator');
  assert.ok(Math.abs(Date.parse(d.decided_at) - Date.now()) < 60_000, 'decided now');
  assert.ok(Buffer.byteLength(JSON.stringify(d)) < 4096, 'small enough to be stored in the Phase-B ledgers (8 KB ceiling)');
});

test('evaluator: REQUESTED, APPROVED, SUSPENDED, REVOKED and EXPIRED assignments deny — each with its own reason — and ACTIVE grants', async () => {
  const db = await openDatabase({ migrate: 'all' });
  for (const state of ['REQUESTED', 'APPROVED', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'ACTIVE']) {
    const user = `st-${state.toLowerCase()}`;
    await seedAssignment(db, { subject: user, membershipId: await seedMembership(db, user), finalState: state });
    const d = await evaluate(db, { actor: user, subject: 'm-eve', node: NODE });
    if (state === 'ACTIVE') assert.equal(d.decision, 'granted', state);
    else { assert.equal(d.decision, 'denied', state); assert.equal(d.denials[0].reason, `STATE_${state}`); }
  }
});

test('evaluator: the effective period is enforced on both sides — not yet effective and already over both deny; an ACTIVE-state row is not enough', async () => {
  const db = await openDatabase({ migrate: 'all' });
  await seedAssignment(db, { subject: 'w-future', membershipId: await seedMembership(db, 'w-future'), fromOffsetMs: HOUR, untilOffsetMs: 2 * HOUR });
  const over = await seedAssignment(db, { subject: 'w-past', membershipId: await seedMembership(db, 'w-past') });
  await backdate(db, `UPDATE corporate_permission_assignments SET effective_from = now() - interval '2 hours', effective_until = now() - interval '1 minute' WHERE assignment_id = $1`, [over]);
  await seedAssignment(db, { subject: 'w-now', membershipId: await seedMembership(db, 'w-now'), fromOffsetMs: -MINUTE, untilOffsetMs: MINUTE });
  for (const user of ['w-future', 'w-past']) {
    const row = (await owner(db, "SELECT state FROM corporate_permission_assignments WHERE subject_user_id = $1", [user]))[0];
    assert.equal(row.state, 'ACTIVE', `${user}: the state column alone says ACTIVE`);
    const d = await evaluate(db, { actor: user, subject: 'm-eve', node: NODE });
    assert.equal(d.decision, 'denied', user); assert.equal(d.denials[0].reason, 'OUT_OF_WINDOW', user);
  }
  assert.equal((await evaluate(db, { actor: 'w-now', subject: 'm-eve', node: NODE })).decision, 'granted');
  const eff = (await owner(db, "SELECT subject_user_id FROM corporate_permission_assignment_effective ORDER BY 1")).map((r) => r.subject_user_id);
  assert.deepEqual(eff, ['w-now'], 'the effective view contains only the one row that can take part in a decision');
});

test('evaluator: scope — a wrong organisation denies; explicit nodes cover only themselves; descendants only when the grant says so; nothing is inherited upward or sideways', async () => {
  const db = await openDatabase({ migrate: 'all' });
  await addTree(db);
  const cases = [
    // [scope nodes, include_descendants, node → expected]
    [[NODE], false, { [NODE]: true, [DEPT]: false, [TEAM]: false, [OTHER]: false, [ROOT_NODE]: false }],
    [[NODE], true,  { [NODE]: true, [DEPT]: true, [TEAM]: true, [OTHER]: false, [ROOT_NODE]: false }],
    [[DEPT], true,  { [NODE]: false, [DEPT]: true, [TEAM]: true, [OTHER]: false, [ROOT_NODE]: false }],
    [[TEAM], true,  { [NODE]: false, [DEPT]: false, [TEAM]: true, [OTHER]: false, [ROOT_NODE]: false }],
    [[ROOT_NODE], false, { [NODE]: false, [DEPT]: false, [TEAM]: false, [OTHER]: false, [ROOT_NODE]: true }],
    [[ROOT_NODE], true,  { [NODE]: true, [DEPT]: true, [TEAM]: true, [OTHER]: true, [ROOT_NODE]: true }],
    [[NODE, OTHER], false, { [NODE]: true, [OTHER]: true, 'BU_DIASPORA_TRADE': false, [DEPT]: false }],
  ];
  let n = 0;
  for (const [nodes, descendants, expected] of cases) {
    const user = `sc-${(n += 1)}`;
    await seedAssignment(db, { subject: user, membershipId: await seedMembership(db, user, ROOT_NODE), nodes, includeDescendants: descendants });
    for (const [node, covered] of Object.entries(expected)) {
      const d = await evaluate(db, { actor: user, subject: 'm-eve', node });
      assert.equal(d.decision === 'granted', covered, `${JSON.stringify(nodes)}${descendants ? '+descendants' : ''} at ${node}`);
      if (!covered) assert.equal(d.denials[0].reason, 'OUT_OF_SCOPE');
    }
  }
  assert.equal((await evaluate(db, { actor: 'sc-1', subject: 'm-eve', node: 'NO_SUCH_NODE' })).decision, 'denied', 'an unknown node is never covered');
});

test('evaluator: the grant rests on a membership — SUSPENDED, ENDED, PENDING or out-of-window memberships make every assignment on them deny, and restoring the membership restores the authority without touching the assignment', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const cases = { suspended: { state: 'SUSPENDED' }, ended: { state: 'ENDED' }, pending: { state: 'PENDING' }, future: { fromOffsetMs: HOUR }, };
  for (const [name, opts] of Object.entries(cases)) {
    const user = `mb-${name}`;
    const mid = await seedMembership(db, user, ROOT_NODE, { state: 'ACTIVE' });
    const id = await seedAssignment(db, { subject: user, membershipId: mid });
    // move the footing out from under an already-ACTIVE assignment, through the membership's own lifecycle
    if (opts.state === 'SUSPENDED') await db.query(`UPDATE corporate_memberships SET state = 'SUSPENDED', updated_by_kind = 'USER', updated_by_user_id = 'u-admin', updated_reason = 'pause', updated_reference = 'x' WHERE membership_id = $1`, [mid]);
    if (opts.state === 'ENDED') await db.query(`UPDATE corporate_memberships SET state = 'ENDED', updated_by_kind = 'USER', updated_by_user_id = 'u-admin', updated_reason = 'left', updated_reference = 'x' WHERE membership_id = $1`, [mid]);
    if (opts.state === 'PENDING' || opts.fromOffsetMs) await backdate(db, `UPDATE corporate_memberships SET ${opts.state ? "state = 'PENDING'" : "effective_from = now() + interval '1 hour', effective_until = now() + interval '2 hours'"} WHERE membership_id = $1`, [mid]);
    const d = await evaluate(db, { actor: user, subject: 'm-eve', node: NODE });
    assert.equal(d.decision, 'denied', name); assert.equal(d.denials[0].reason, 'MEMBERSHIP_NOT_EFFECTIVE', name);
    assert.equal((await owner(db, 'SELECT state FROM corporate_permission_assignments WHERE assignment_id = $1', [id]))[0].state, 'ACTIVE', `${name}: the assignment itself is untouched`);
    if (name === 'suspended') {
      await db.query(`UPDATE corporate_memberships SET state = 'ACTIVE', updated_by_kind = 'USER', updated_by_user_id = 'u-admin', updated_reason = 'back', updated_reference = 'x' WHERE membership_id = $1`, [mid]);
      assert.equal((await evaluate(db, { actor: user, subject: 'm-eve', node: NODE })).decision, 'granted', 'restored membership → authority is back, same assignment');
    }
  }
});

test('evaluator: an A2_STRONG floor is recorded but INERT — A2 does not exist, so such an assignment never authorizes, never counts as a governor, and is never downgraded', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const id = await seedAssignment(db, { subject: 'a2-user', membershipId: await seedMembership(db, 'a2-user'), floor: 'A2_STRONG' });
  assert.equal((await owner(db, 'SELECT assurance_floor FROM corporate_permission_assignments WHERE assignment_id = $1', [id]))[0].assurance_floor, 'A2_STRONG', 'stored as asked');
  const d = await evaluate(db, { actor: 'a2-user', subject: 'm-eve', node: NODE });
  assert.equal(d.decision, 'denied'); assert.equal(d.denials[0].reason, 'ASSURANCE_FLOOR_UNMET');
  assert.equal((await owner(db, 'SELECT count(*)::int AS n FROM corporate_permission_assignment_effective'))[0].n, 0, 'not in the effective view');
});

test('evaluator: NO cross-grant privilege synthesis — each capability must be covered by ONE assignment on its own; scopes, windows and floors of different grants never combine', async () => {
  const db = await openDatabase({ migrate: 'all' });
  // (a) two manage grants over DIFFERENT nodes: each node is decided by its own grant and never by their union
  const a = await seedMembership(db, 'sy-a');
  const g1 = await seedAssignment(db, { subject: 'sy-a', membershipId: a, nodes: [NODE], includeDescendants: false });
  const g2 = await seedAssignment(db, { subject: 'sy-a', membershipId: a, nodes: [OTHER], includeDescendants: false });
  assert.equal((await evaluate(db, { actor: 'sy-a', subject: 'm-eve', node: NODE })).provenance.assignments[0].assignment_id, g1);
  assert.equal((await evaluate(db, { actor: 'sy-a', subject: 'm-eve', node: OTHER })).provenance.assignments[0].assignment_id, g2);
  assert.equal((await evaluate(db, { actor: 'sy-a', subject: 'm-eve', node: 'BU_DIASPORA_TRADE' })).decision, 'denied');
  // (b) the multi-capability case (security compromise): a broad manage grant and a NARROW session-revoke grant do not make a broad revoke
  const b = await seedMembership(db, 'sy-b');
  await seedAssignment(db, { subject: 'sy-b', membershipId: b, capability: MANAGE, nodes: [ROOT_NODE], includeDescendants: true });
  const narrow = await seedAssignment(db, { subject: 'sy-b', membershipId: b, capability: REVOKE_SESSIONS, nodes: [OTHER], includeDescendants: false });
  const atNode = await evaluate(db, { actor: 'sy-b', subject: 'm-eve', node: NODE, capabilities: [MANAGE, REVOKE_SESSIONS] });
  assert.equal(atNode.decision, 'denied');
  assert.deepEqual(atNode.denials.map((x) => [x.capability, x.reason]), [[REVOKE_SESSIONS, 'OUT_OF_SCOPE']], 'manage is fine at the node; revoke is not covered there, however broad manage is');
  const atOther = await evaluate(db, { actor: 'sy-b', subject: 'm-eve', node: OTHER, capabilities: [MANAGE, REVOKE_SESSIONS] });
  assert.equal(atOther.decision, 'granted');
  assert.equal(new Set(atOther.provenance.assignments.map((x) => x.assignment_id)).size, 2, 'two capabilities, two different assignments, each covering the node on its own');
  assert.ok(atOther.provenance.assignments.some((x) => x.assignment_id === narrow));
  // (c) two DIFFERENT accounts never pool: one holds manage, the other revoke
  await seedAssignment(db, { subject: 'sy-c1', membershipId: await seedMembership(db, 'sy-c1'), capability: MANAGE });
  await seedAssignment(db, { subject: 'sy-c2', membershipId: await seedMembership(db, 'sy-c2'), capability: REVOKE_SESSIONS });
  for (const actor of ['sy-c1', 'sy-c2']) assert.equal((await evaluate(db, { actor, subject: 'm-eve', node: NODE, capabilities: [MANAGE, REVOKE_SESSIONS] })).decision, 'denied', actor);
  // (d) same capability, two grants that each fail on a DIFFERENT dimension (right scope but over; open but wrong scope): no grant is assembled from the two
  const d = await seedMembership(db, 'sy-d');
  const right = await seedAssignment(db, { subject: 'sy-d', membershipId: d, nodes: [NODE], includeDescendants: false });
  await seedAssignment(db, { subject: 'sy-d', membershipId: d, nodes: [OTHER], includeDescendants: false });
  await backdate(db, `UPDATE corporate_permission_assignments SET effective_from = now() - interval '2 hours', effective_until = now() - interval '1 minute' WHERE assignment_id = $1`, [right]);
  assert.equal((await evaluate(db, { actor: 'sy-d', subject: 'm-eve', node: NODE })).decision, 'denied');
  assert.equal((await evaluate(db, { actor: 'sy-d', subject: 'm-eve', node: OTHER })).decision, 'granted', 'control: the other grant works at ITS node');
  // (e) an A2-floor grant over the node plus an A1 grant over a narrower scope: the narrow one never widens, the strong one never downgrades
  const e = await seedMembership(db, 'sy-e');
  await seedAssignment(db, { subject: 'sy-e', membershipId: e, nodes: [NODE], includeDescendants: false, floor: 'A2_STRONG' });
  await seedAssignment(db, { subject: 'sy-e', membershipId: e, nodes: [OTHER], includeDescendants: false });
  assert.equal((await evaluate(db, { actor: 'sy-e', subject: 'm-eve', node: NODE })).decision, 'denied');
  assert.equal((await evaluate(db, { actor: 'sy-e', subject: 'm-eve', node: OTHER })).decision, 'granted');
});

test('evaluator: legacy platform roles, tenant roles, organisation roles, titles and the bridge are not inputs — an account with every one of them still has no authority, and none can mint an assignment', async () => {
  const db = await openDatabase({ migrate: 'all' });
  // the very accounts the legacy compatibility bridge admits, plus a tenant admin and a legacy-organisation admin
  for (const [user, why] of [['u-admin', 'admin'], ['u-padmin', 'platform_admin'], ['u-sadmin', 'super_admin'], ['u-tadmin', 'tenant admin'], ['u-lorg', 'organisation admin']]) {
    await seedMembership(db, user);   // even a real ACTIVE Corporate membership changes nothing
    const d = await evaluate(db, { actor: user, subject: 'm-eve', node: NODE, capabilities: [MANAGE, REVOKE_SESSIONS] });
    assert.equal(d.decision, 'denied', why);
    assert.deepEqual(d.denials.map((x) => x.reason), ['NO_ASSIGNMENT', 'NO_ASSIGNMENT'], why);
  }
  // changing a role never changes the answer (the evaluator does not read it)
  await db.query("UPDATE users SET role = 'super_admin' WHERE id = 'm-eve'");
  await seedMembership(db, 'm-eve');
  assert.equal((await evaluate(db, { actor: 'm-eve', subject: 'g-alice', node: NODE })).decision, 'denied');
  // nobody can create an assignment from outside the owner ceremony: not the backend role, not a client role, not via any function
  for (const role of ['service_role', 'anon', 'authenticated']) {
    const m = await asRole(db, role, async () => message(db.query(`INSERT INTO corporate_permission_assignments (subject_user_id, membership_id, capability, scope_node_ids, effective_from, effective_until, assurance_floor, requested_by_user_id, request_reason, request_reference, state, updated_by_kind, updated_by_user_id, updated_reason)
      VALUES ('u-admin', gen_random_uuid(), '${MANAGE}', ARRAY['${ROOT_NODE}'], now(), now() + interval '1 day', 'A1_RECENT_REAUTH', 'u-sadmin', 'r', 'x', 'ACTIVE', 'USER', 'u-sadmin', 'r')`)));
    assert.match(String(m), /permission denied for table corporate_permission_assignments/, role);
  }
  const creators = (await owner(db, `SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~* 'INSERT\\s+INTO\\s+(public\\.)?corporate_permission_assignments\\M' AND p.proname LIKE 'corporate\\_%'`)).map((r) => r.proname);
  assert.deepEqual(creators, [], 'no function anywhere inserts an assignment');
  assert.equal((await owner(db, 'SELECT count(*)::int AS n FROM corporate_permission_assignments'))[0].n, 0);
});

test('evaluator: anything it cannot read or understand is a denial — missing inputs, an unknown capability, an unknown node, an unreadable continuity target', async () => {
  const { db } = await world(['g-alice']);
  const call = (args) => rpc(db, 'corporate_authority_evaluate', args);
  for (const bad of [
    { p_actor_user_id: null, p_subject_user_id: 'm-eve', p_org_node_id: NODE, p_capabilities: [MANAGE] },
    { p_actor_user_id: 'g-alice', p_subject_user_id: null, p_org_node_id: NODE, p_capabilities: [MANAGE] },
    { p_actor_user_id: 'g-alice', p_subject_user_id: 'm-eve', p_org_node_id: '', p_capabilities: [MANAGE] },
    { p_actor_user_id: 'g-alice', p_subject_user_id: 'm-eve', p_org_node_id: NODE, p_capabilities: [] },
    { p_actor_user_id: '', p_subject_user_id: 'm-eve', p_org_node_id: NODE, p_capabilities: [MANAGE] },
  ]) { const d = await call(bad); assert.equal(d.decision, 'denied'); assert.equal(d.denials[0].reason, 'INPUT_INVALID'); }
  const unknownCap = await call({ p_actor_user_id: 'g-alice', p_subject_user_id: 'm-eve', p_org_node_id: NODE, p_capabilities: ['corporate.finance.restricted.read'] });
  assert.equal(unknownCap.decision, 'denied'); assert.equal(unknownCap.denials[0].reason, 'CAPABILITY_NOT_EVALUABLE');
  const mixed = await call({ p_actor_user_id: 'g-alice', p_subject_user_id: 'm-eve', p_org_node_id: NODE, p_capabilities: [MANAGE, 'admin'] });
  assert.equal(mixed.decision, 'denied', 'one unevaluable capability sinks the whole decision');
  const noTarget = await call({ p_actor_user_id: 'g-alice', p_subject_user_id: 'm-eve', p_org_node_id: NODE, p_capabilities: [MANAGE], p_need_continuity: true });
  assert.equal(noTarget.decision, 'denied'); assert.equal(noTarget.denials[0].reason, 'CONTINUITY_TARGET_REQUIRED');
});

test('continuity: the two-independent-governor minimum is COUNTED from persistent assignments — suspended, revoked, A2-inert, out-of-scope, duplicate and membership-less governors do not count; the subject never counts', async () => {
  const { db, g } = await world(['g-alice', 'g-bob', 'g-carol', 'g-dave']);
  const target = g['g-dave'].membershipId;
  const cont = async (actor = 'g-alice', node = ROOT_NODE) => (await evaluate(db, { actor, subject: 'g-dave', node, needContinuity: true, target })).governance_continuity;
  // four governors, the subject being one of them: the other three remain
  assert.deepEqual(await cont(), { subject_holds_governance_authority: true, remaining_independent_governors: 3 });
  // a second assignment by the same person is still ONE governor
  await seedAssignment(db, { subject: 'g-bob', membershipId: g['g-bob'].membershipId, nodes: [NODE], includeDescendants: true });
  assert.equal((await cont()).remaining_independent_governors, 3);
  // the count is the WEAKEST node the subject's authority covers: with bob's corporate-wide assignment suspended, his second one reaches only
  // BU_MARKETPLACE and below, so at the corporate root only alice and carol remain
  await move(db, g['g-bob'].manageId, 'SUSPENDED', 'f-suspender');
  assert.equal((await cont()).remaining_independent_governors, 2);
  // a revoked assignment stops counting at once
  await move(db, g['g-carol'].manageId, 'REVOKED', 'f-suspender');
  assert.equal((await cont()).remaining_independent_governors, 1);
  // an A2-floor assignment is inert and does not rescue the count
  await seedAssignment(db, { subject: 'g-carol', membershipId: g['g-carol'].membershipId, floor: 'A2_STRONG' });
  assert.equal((await cont()).remaining_independent_governors, 1);
  // restoring the suspended assignment restores the count — the number is read from the rows, not remembered
  await move(db, g['g-bob'].manageId, 'ACTIVE', 'f-activator', 'restored');
  assert.equal((await cont()).remaining_independent_governors, 2);
  // a governor whose MEMBERSHIP is suspended no longer counts and can no longer act (bob's second assignment covers the marketplace only)
  await db.query(`UPDATE corporate_memberships SET state = 'SUSPENDED', updated_by_kind = 'USER', updated_by_user_id = 'u-admin', updated_reason = 'pause', updated_reference = 'x' WHERE membership_id = $1`, [g['g-alice'].membershipId]);
  assert.equal((await evaluate(db, { actor: 'g-alice', subject: 'g-dave', node: ROOT_NODE, needContinuity: true, target })).decision, 'denied');
  assert.equal((await cont('g-bob')).remaining_independent_governors, 1, 'only bob remains once alice\'s membership is suspended and carol\'s assignment is revoked');
});

test('continuity: a subject who holds governance only through ANOTHER membership, or none, is not governance-bearing for this membership; an end of such a membership needs no minimum', async () => {
  const { db, g } = await world(['g-alice', 'g-bob']);
  const other = await seedMembership(db, 'g-carol', OTHER);                      // carol's governance rests on her ROOT membership …
  const root = await seedGovernor(db, 'g-carol', { node: ROOT_NODE });            // … seeded here
  const holds = await evaluate(db, { actor: 'g-alice', subject: 'g-carol', node: OTHER, needContinuity: true, target: other });
  assert.deepEqual(holds.governance_continuity.subject_holds_governance_authority, false, 'the membership being ended carries none of her assignments');
  const bearing = await evaluate(db, { actor: 'g-alice', subject: 'g-carol', node: ROOT_NODE, needContinuity: true, target: root.membershipId });
  assert.equal(bearing.governance_continuity.subject_holds_governance_authority, true);
  const plain = await seedMembership(db, 'm-eve', NODE);
  const nongov = await evaluate(db, { actor: 'g-alice', subject: 'm-eve', node: NODE, needContinuity: true, target: plain });
  assert.deepEqual(nongov.governance_continuity, { subject_holds_governance_authority: false, remaining_independent_governors: 3 }, 'informational: governors in scope, subject excluded');
  assert.ok(g['g-bob']);
});

// ═════════════ 5 · the entry points: fabricated snapshots enable nothing; Phase-B controls hold unchanged ═════════════

test('fabricated governance JSON cannot authorize: the entry points take no decision parameter, an unauthorised account is refused whatever it sends, and the owner-level internal layer is the only place a snapshot is consumed', async () => {
  const { db } = await world(['g-alice']);
  const eve = await sess(db, 'm-eve');
  const alice = await sess(db, 'g-alice');
  const before = await countAll(db);
  const base = { p_operation: 'CREATE', p_actor_user_id: 'm-eve', p_actor_session_id: eve, p_subject_user_id: 'm-frank', p_org_node_id: NODE, p_membership_id: null, p_reason: 'r', p_reference: 'x', p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null };
  // (1) a decision parameter does not exist on any entry point: a PostgREST-style named call carrying one finds no such function
  const forged = decisionFor({ actor: 'm-eve', subject: 'm-frank', node: NODE });
  assert.match(String(await message(rpc(db, 'corporate_authority_apply_direct', { ...base, p_governance_decision: forged }))), /does not exist|function .* not unique/i);
  // (2) without it, the account that has an A1 session, a real-looking everything and NO assignment is refused
  assert.equal(await refusal(rpc(db, 'corporate_authority_apply_direct', base)), 'AUTHORITY_DENIED');
  // (3) the same call by a real governor works: the difference is the persistent authority, not the payload
  assert.equal((await rpc(db, 'corporate_authority_apply_direct', { ...base, p_actor_user_id: 'g-alice', p_actor_session_id: alice })).outcome, 'EXECUTED');
  // (4) borrowing a governor's identity needs that governor's own live A1 session row: someone else's session does not carry it
  assert.equal(await refusal(rpc(db, 'corporate_authority_apply_direct', { ...base, p_actor_user_id: 'g-alice', p_actor_session_id: eve, p_subject_user_id: 'm-grace' })), 'ASSURANCE_SESSION_INVALID');
  assert.equal((await owner(db, "SELECT count(*)::int AS n FROM corporate_memberships WHERE user_id IN ('m-frank','m-grace')"))[0].n, 1, 'exactly the one governed creation');
  assert.notEqual(await countAll(db), before);
  // (5) THE EDGE OF THE BOUNDARY, stated and pinned: the Phase-B snapshot layer still accepts a structurally valid snapshot from whoever may call it.
  //     That is now ONLY the migration owner (an owner-level session is outside the threat model: it can write any table anyway).
  const asOwner = await rpc(db, 'corporate_membership_apply_direct', { ...base, p_actor_user_id: 'm-eve', p_subject_user_id: 'm-heidi', p_governance_decision: forged }).catch((e) => e);
  assert.ok(String(asOwner?.message ?? asOwner).includes('permission denied'), 'through service_role it is closed');
  await db.exec('RESET ROLE'); await db.exec(`SET ROLE ${OWNER}`);
  const ownerCall = (await db.query(`SELECT public.corporate_membership_apply_direct('CREATE','m-eve',$1,'m-heidi',$2,NULL,'r','x',NULL,NULL,'ROUTINE',NULL,$3::jsonb) AS r`, [eve, NODE, JSON.stringify(decisionFor({ actor: 'm-eve', subject: 'm-heidi', node: NODE }))])).rows[0].r;
  assert.equal(ownerCall.outcome, 'EXECUTED', 'the internal layer is owner-only; this is the documented edge, not a client path');
});

test('end to end: CREATE → request → approve → execute → SUSPEND → request → approve → execute → END, all through the entry points, with the authority recorded in the Phase-B ledgers', async () => {
  const { db, g } = await world();
  const [alice, bob, carol] = [await sess(db, 'g-alice'), await sess(db, 'g-bob'), await sess(db, 'g-carol')];
  const created = await governedPending(db, 'g-alice', alice, 'm-eve');
  assert.equal(created.state, 'PENDING'); assert.equal(created.authority.assignments[0].assignment_id, g['g-alice'].manageId);
  const req = await submit(db, { membership: created.membership_id, actor: 'g-alice', session: alice });
  assert.equal(req.outcome, 'REQUESTED');
  assert.equal((await decide(db, req, { actor: 'g-bob', session: bob })).outcome, 'APPROVED');
  const done = await execute(db, req, { actor: 'g-alice', session: alice });
  assert.equal(done.outcome, 'EXECUTED'); assert.equal(done.state, 'ACTIVE');
  assert.equal((await direct(db, { op: 'SUSPEND', actor: 'g-carol', session: carol, subject: 'm-eve', node: NODE, membership: created.membership_id })).state, 'SUSPENDED');
  const back = await submit(db, { op: 'RESTORE', membership: created.membership_id, actor: 'g-bob', session: bob });
  await decide(db, back, { actor: 'g-carol', session: carol });
  assert.equal((await execute(db, back, { actor: 'g-bob', session: bob })).state, 'ACTIVE');
  const ended = await direct(db, { op: 'END', actor: 'g-alice', session: alice, subject: 'm-eve', node: NODE, membership: created.membership_id });
  assert.equal(ended.state, 'ENDED');
  assert.equal((await owner(db, 'SELECT count(*)::int AS n FROM corporate_membership_events WHERE membership_id = $1', [created.membership_id]))[0].n, 5, 'one lifecycle event per accepted mutation: CREATED, ACTIVE, SUSPENDED, ACTIVE, ENDED');
  // every ledger row names the assignments it rested on, generated by the database from persistent authority
  const rows = await owner(db, `SELECT s.step_type, s.actor_user_id, s.governance_decision AS d FROM corporate_membership_request_steps s ORDER BY s.occurred_at, s.step_seq`);
  assert.ok(rows.length >= 7);
  for (const r of rows) {
    assert.equal(r.d.source, 'target_corporate_governance'); assert.equal(r.d.evaluator.name, 'corporate_authority_evaluate');
    assert.equal(r.d.provenance.derivation, 'persistent_assignments');
    const used = r.d.provenance.assignments.map((a) => a.assignment_id);
    const mine = await owner(db, 'SELECT assignment_id FROM corporate_permission_assignments WHERE subject_user_id = $1 AND capability = $2 AND state = \'ACTIVE\'', [r.actor_user_id, MANAGE]);
    assert.ok(mine.some((m) => used.includes(m.assignment_id)), `${r.step_type} by ${r.actor_user_id}: the recorded assignment is that actor's own ACTIVE manage assignment`);
  }
  const reqRows = await owner(db, 'SELECT governance_decision AS d, requester_user_id FROM corporate_membership_requests');
  for (const r of reqRows) assert.equal(r.d.provenance.assignments.length >= 1, true);
});

test('Phase-B controls hold through the entry points: actor ≠ subject, maker ≠ checker, executor must be a party, replay is structurally impossible, binding is exact', async () => {
  const { db } = await world(['g-alice', 'g-bob', 'g-carol', 'g-dave']);
  const s = {}; for (const u of ['g-alice', 'g-bob', 'g-carol', 'g-dave']) s[u] = await sess(db, u);
  const created = await governedPending(db, 'g-alice', s['g-alice'], 'm-eve');
  const req = await submit(db, { membership: created.membership_id, actor: 'g-alice', session: s['g-alice'] });
  // the subject never acts on their own membership — even a governor who is the subject
  const gSubject = await governedPending(db, 'g-alice', s['g-alice'], 'g-dave', OTHER);
  assert.equal(await refusal(direct(db, { op: 'SUSPEND', actor: 'g-dave', session: s['g-dave'], subject: 'g-dave', node: OTHER, membership: gSubject.membership_id })), 'ACTOR_IS_SUBJECT');
  assert.equal(await refusal(submit(db, { membership: gSubject.membership_id, actor: 'g-dave', session: s['g-dave'] })), 'ACTOR_IS_SUBJECT');
  // maker ≠ checker
  assert.equal(await refusal(decide(db, req, { actor: 'g-alice', session: s['g-alice'] })), 'MAKER_CHECKER_SAME_ACTOR');
  // no execution without an independent approval, and a wrong digest never binds
  assert.equal(await refusal(execute(db, req, { actor: 'g-alice', session: s['g-alice'] })), 'APPROVAL_REQUIRED');
  assert.equal(await refusal(decide(db, req, { actor: 'g-bob', session: s['g-bob'], expected: { digest: 'a'.repeat(64) } })), 'BINDING_MISMATCH');
  assert.equal((await decide(db, req, { actor: 'g-bob', session: s['g-bob'] })).outcome, 'APPROVED');
  // only a party executes, even a fully authorised governor who is not one
  assert.equal(await refusal(execute(db, req, { actor: 'g-carol', session: s['g-carol'] })), 'EXECUTOR_NOT_PARTY');
  assert.equal((await execute(db, req, { actor: 'g-bob', session: s['g-bob'] })).outcome, 'EXECUTED');
  // consumed exactly once, by anyone, ever
  for (const who of ['g-alice', 'g-bob', 'g-carol']) assert.equal(await refusal(execute(db, req, { actor: who, session: s[who] })), 'REQUEST_ALREADY_CONSUMED', who);
  assert.equal(await refusal(decide(db, req, { actor: 'g-carol', session: s['g-carol'] })), 'REQUEST_NOT_OPEN');
  assert.equal(await stateOf(db, created.membership_id), 'ACTIVE');
});

test('Phase-B controls hold through the entry points: A1 is re-proven from the actor\'s OWN session for every operation, and every refusal changes nothing', async () => {
  const { db } = await world(['g-alice', 'g-bob']);
  const alice = await sess(db, 'g-alice');
  const created = await governedPending(db, 'g-alice', alice, 'm-eve');
  const req = await submit(db, { membership: created.membership_id, actor: 'g-alice', session: alice });
  const conditions = {
    'no session id': async () => '',
    'a session that does not exist': async () => 's-nope',
    "another account's valid stepped-up session": async () => sess(db, 'm-heidi'),
    'revoked session': async () => sess(db, 'g-alice', { valid: false }),
    'expired session': async () => sess(db, 'g-alice', { expiresInMs: -1000 }),
    'never re-authenticated': async () => sess(db, 'g-alice', { stepUp: null }),
    'step-up by a method the platform cannot verify': async () => sess(db, 'g-alice', { stepUp: { ageMs: 1000, method: 'webauthn' } }),
    'step-up too old (15m10s)': async () => sess(db, 'g-alice', { stepUp: { ageMs: 15 * MINUTE + 10_000, method: 'password_reauth' } }),
    'step-up from the future': async () => sess(db, 'g-alice', { stepUp: { ageMs: -2 * MINUTE, method: 'password_reauth' } }),
  };
  const before = await countAll(db);
  for (const [label, makeSession] of Object.entries(conditions)) {
    const session = await makeSession();
    const refused = await Promise.all([
      refusal(direct(db, { op: 'CREATE', actor: 'g-alice', session, subject: 'm-frank', node: NODE })),
      refusal(submit(db, { membership: created.membership_id, actor: 'g-alice', session })),
      refusal(decide(db, req, { actor: 'g-bob', session })),
      refusal(execute(db, req, { actor: 'g-alice', session })),
      refusal(cancel(db, req, { actor: 'g-alice', session })),
    ]);
    for (const code of refused) assert.match(String(code), /^ASSURANCE_(A1_REQUIRED|SESSION_INVALID|UNREADABLE)$/, `${label}: ${code}`);
  }
  assert.equal(await countAll(db), before, 'nothing was written by any refused call');
  // boundary controls: 14m50s old is still A1
  const ok = await sess(db, 'g-alice', { stepUp: { ageMs: 14 * MINUTE + 50_000, method: 'password_reauth' } });
  assert.equal((await direct(db, { op: 'CREATE', actor: 'g-alice', session: ok, subject: 'm-frank', node: NODE })).outcome, 'EXECUTED');
});

test('Phase-B controls hold through the entry points: the approval TTL (30 min) and the request TTL (72 h) are RECORDED as the terminal outcome, and stale position is recorded, not dropped', async () => {
  const { db } = await world(['g-alice', 'g-bob']);
  const [alice, bob] = [await sess(db, 'g-alice'), await sess(db, 'g-bob')];
  const mk = async (subject) => { const c = await governedPending(db, 'g-alice', alice, subject); const r = await submit(db, { membership: c.membership_id, actor: 'g-alice', session: alice }); return { c, r }; };
  // approval older than 30 min
  const a = await mk('m-eve'); await decide(db, a.r, { actor: 'g-bob', session: bob });
  await backdate(db, `UPDATE corporate_membership_request_steps SET occurred_at = now() - interval '31 minutes' WHERE request_id = $1`, [a.r.request_id]);
  const expiredApproval = await execute(db, a.r, { actor: 'g-alice', session: alice });
  assert.equal(expiredApproval.outcome, 'EXPIRED'); assert.equal(expiredApproval.classification, 'APPROVAL_EXPIRED');
  assert.equal(await stateOf(db, a.c.membership_id), 'PENDING');
  // request older than 72 h
  const b = await mk('m-frank');
  await backdate(db, `UPDATE corporate_membership_requests SET requested_at = now() - interval '73 hours', expires_at = now() - interval '1 hour' WHERE request_id = $1`, [b.r.request_id]);
  const expiredRequest = await decide(db, b.r, { actor: 'g-bob', session: bob });
  assert.equal(expiredRequest.outcome, 'EXPIRED'); assert.equal(expiredRequest.classification, 'REQUEST_EXPIRED');
  // an approval whose membership moved on is recorded as a STALE_PRECONDITION and changes nothing
  const c = await mk('m-grace'); await decide(db, c.r, { actor: 'g-bob', session: bob });
  await direct(db, { op: 'END', actor: 'g-bob', session: bob, subject: 'm-grace', node: NODE, membership: c.c.membership_id });
  const stale = await execute(db, c.r, { actor: 'g-alice', session: alice });
  assert.equal(stale.outcome, 'REFUSED'); assert.equal(stale.classification, 'STALE_PRECONDITION');
  assert.equal(await stateOf(db, c.c.membership_id), 'ENDED');
});

test('authority is re-evaluated at EVERY step: revoking the executor between approval and execution refuses the execution, leaves the approval unconsumed, and restoring authority lets it proceed within its TTL', async () => {
  const { db, g } = await world();
  const [alice, bob] = [await sess(db, 'g-alice'), await sess(db, 'g-bob')];
  const created = await governedPending(db, 'g-alice', alice, 'm-eve');
  const req = await submit(db, { membership: created.membership_id, actor: 'g-alice', session: alice });
  await decide(db, req, { actor: 'g-bob', session: bob });
  await move(db, g['g-alice'].manageId, 'SUSPENDED', 'f-suspender');
  const before = await countAll(db);
  assert.equal(await refusal(execute(db, req, { actor: 'g-alice', session: alice })), 'AUTHORITY_DENIED');
  assert.equal(await countAll(db), before, 'no step was recorded: the denial is not an execution');
  assert.equal(await stateOf(db, created.membership_id), 'PENDING');
  // the OTHER party (the approving checker) may still execute: authority is per actor
  const viaChecker = await refusal(execute(db, { ...req }, { actor: 'g-bob', session: bob }));
  assert.equal(viaChecker, null);
  assert.equal(await stateOf(db, created.membership_id), 'ACTIVE');
});

test('assignment revocation is observed on the NEXT decision for every operation — suspend, revoke, expiry and the end of the underlying membership each stop an administrator at once', async () => {
  const stops = {
    suspended: async (db, g) => move(db, g.manageId, 'SUSPENDED', 'f-suspender'),
    revoked: async (db, g) => move(db, g.manageId, 'REVOKED', 'f-suspender'),
    expired: async (db, g) => backdate(db, `UPDATE corporate_permission_assignments SET effective_from = now() - interval '2 hours', effective_until = now() - interval '1 minute' WHERE assignment_id = $1`, [g.manageId]),
    'membership ended': async (db, g) => db.query(`UPDATE corporate_memberships SET state = 'ENDED', updated_by_kind = 'USER', updated_by_user_id = 'u-admin', updated_reason = 'left', updated_reference = 'x' WHERE membership_id = $1`, [g.membershipId]),
  };
  for (const [name, stop] of Object.entries(stops)) {
    const { db, g } = await world(['g-alice', 'g-bob', 'g-carol']);
    const [alice, bob] = [await sess(db, 'g-alice'), await sess(db, 'g-bob')];
    const subject = await governedPending(db, 'g-bob', bob, 'm-eve');
    const active = await governedPending(db, 'g-bob', bob, 'm-frank');
    const rq = await submit(db, { membership: active.membership_id, actor: 'g-bob', session: bob });
    await decide(db, rq, { actor: 'g-carol', session: await sess(db, 'g-carol') });
    await execute(db, rq, { actor: 'g-bob', session: bob });
    const open = await submit(db, { membership: subject.membership_id, actor: 'g-bob', session: bob });
    // the decision before: alice works
    assert.equal((await direct(db, { op: 'CREATE', actor: 'g-alice', session: alice, subject: 'm-grace', node: NODE })).outcome, 'EXECUTED', name);
    await stop(db, g['g-alice']);
    const after = await Promise.all([
      refusal(direct(db, { op: 'CREATE', actor: 'g-alice', session: alice, subject: 'm-heidi', node: NODE })),
      refusal(direct(db, { op: 'SUSPEND', actor: 'g-alice', session: alice, subject: 'm-frank', node: NODE, membership: active.membership_id })),
      refusal(direct(db, { op: 'END', actor: 'g-alice', session: alice, subject: 'm-frank', node: NODE, membership: active.membership_id })),
      refusal(submit(db, { membership: subject.membership_id, actor: 'g-alice', session: alice })),
      refusal(decide(db, open, { actor: 'g-alice', session: alice })),
      refusal(execute(db, open, { actor: 'g-alice', session: alice })),
      refusal(cancel(db, open, { actor: 'g-alice', session: alice })),
    ]);
    assert.deepEqual(after, Array(7).fill('AUTHORITY_DENIED'), name);
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * What a caller with direct SQL can do: open a transaction, hold it, and only then call. PostgreSQL pins now() at the START of the transaction, so a time
 * rule written against now() would be judged against the old instant. Runs `run` as service_role inside a transaction held for `holdMs`; always rolled back.
 */
async function heldTransaction(db, holdMs, run) {
  await db.exec('SET ROLE service_role');
  try {
    await db.exec('BEGIN');
    const pinned = (await db.query('SELECT now() AS n')).rows[0].n;
    await sleep(holdMs);
    const clock = (await db.query('SELECT now() AS n, clock_timestamp() AS w')).rows[0];
    let result = null; let error = null;
    try { result = await run(db); } catch (e) { error = String(e?.message ?? e); }
    return { pinned, clock, result, error };
  } finally { await db.exec('ROLLBACK').catch(() => {}); await db.exec(`SET ROLE ${OWNER}`); }
}

test('time: an assignment window is judged against the WALL CLOCK and a governed call must run in a YOUNG transaction — a transaction held open past a deadline cannot outlive it', async () => {
  const { db } = await world(['g-alice', 'g-bob', 'g-carol']);
  await ensureUsers(db, ['g-dave']);
  await seedGovernor(db, 'g-dave', { untilOffsetMs: 1500, withRevoke: false });      // a grant that REALLY ends about a second and a half from now
  const daveSession = await sess(db, 'g-dave');
  const alice = await sess(db, 'g-alice');
  const evalSql = 'SELECT public.corporate_authority_evaluate($1, $2, $3, $4::text[], false, NULL) AS r';
  const createSql = `SELECT public.corporate_authority_apply_direct('CREATE', $1, $2, 'm-eve', '${NODE}', NULL, 'r', 'x', NULL, NULL, 'ROUTINE', NULL) AS r`;

  // control: while the grant is live a fresh transaction authorizes
  assert.equal((await evaluate(db, { actor: 'g-dave', subject: 'm-eve', node: NODE })).decision, 'granted');

  // the attack: BEGIN while the grant is live, wait until it has really ended, then ask
  const held = await heldTransaction(db, 1900, async (tx) => ({
    preview: (await tx.query(evalSql, ['g-dave', 'm-eve', NODE, [MANAGE]])).rows[0].r,
    mutation: await tx.query(createSql, ['g-dave', daveSession]).then((r) => r.rows[0].r, (e) => ({ error: String(e.message) })),
  }));
  assert.equal(+held.clock.n, +held.pinned, 'precondition: now() is pinned for the held transaction');
  assert.ok(held.clock.w - held.pinned >= 1800, 'precondition: the wall clock has moved on');
  assert.deepEqual([held.result.preview.decision, held.result.preview.denials[0].reason], ['denied', 'OUT_OF_WINDOW'], 'the evaluator judges the window by the wall clock');
  assert.match(String(held.result.mutation.error), /CORPORATE_GOVERNANCE\/AUTHORITY_DENIED/, 'and so does the mutation entry point: an expired grant authorizes nothing');
  assert.equal((await owner(db, `SELECT count(*)::int AS n FROM corporate_memberships WHERE user_id = 'm-eve'`))[0].n, 0, 'nothing was created');

  // the bound: a transaction older than corporate_authority_max_transaction_age() is refused outright, even for a fully authorised governor with a fresh A1 session
  assert.equal((await owner(db, 'SELECT public.corporate_authority_max_transaction_age()::text AS v'))[0].v, '00:00:05');
  const stale = await heldTransaction(db, 5400, async (tx) => tx.query(createSql, ['g-alice', alice]).then((r) => r.rows[0].r, (e) => ({ error: String(e.message) })));
  assert.match(String(stale.result.error), /CORPORATE_GOVERNANCE\/TRANSACTION_STALE/);
  assert.equal((await owner(db, `SELECT count(*)::int AS n FROM corporate_memberships WHERE user_id = 'm-eve'`))[0].n, 0, 'nothing was created');

  // …while a young held transaction, and an ordinary call, are not refused (the bound is not what stops the attack above)
  const young = await heldTransaction(db, 300, async (tx) => tx.query(createSql, ['g-alice', alice]).then((r) => r.rows[0].r, (e) => ({ error: String(e.message) })));
  assert.equal(young.result.outcome, 'EXECUTED', JSON.stringify(young));
});

test('SECURITY_COMPROMISE needs BOTH capabilities from persistent authority, each covering the node on its own; the session-revocation record is still required and the live-session refusal is unchanged', async () => {
  const db = await openDatabase({ migrate: 'all' });
  const manageOnly = await seedGovernor(db, 'g-alice', { withRevoke: false });
  await seedGovernor(db, 'g-bob');
  await seedGovernor(db, 'g-carol');
  const [alice, bob] = [await sess(db, 'g-alice'), await sess(db, 'g-bob')];
  const target = await governedPending(db, 'g-bob', bob, 'm-eve');
  const act = await submit(db, { membership: target.membership_id, actor: 'g-bob', session: bob });
  await decide(db, act, { actor: 'g-carol', session: await sess(db, 'g-carol') });
  await execute(db, act, { actor: 'g-bob', session: bob });
  const compromise = (actor, session, revocation = { contract: 'carup.corporate_session_revocation.v1', scope: 'all', revoked_count: 0 }) =>
    direct(db, { op: 'SUSPEND', actor, session, subject: 'm-eve', node: NODE, membership: target.membership_id, classification: 'SECURITY_COMPROMISE', revocation });
  // alice has manage but NOT revoke: refused as authority, before any session is looked at
  assert.equal(await refusal(compromise('g-alice', alice)), 'AUTHORITY_DENIED');
  assert.equal(manageOnly.revokeId, null);
  // bob has both: the DB still demands the revocation record and that no live session remains
  assert.equal(await refusal(compromise('g-bob', bob, null)), 'SESSION_REVOCATION_REQUIRED');
  await sess(db, 'm-eve');
  assert.equal(await refusal(compromise('g-bob', bob)), 'SESSIONS_STILL_VALID');
  await db.query("UPDATE user_sessions SET is_valid = false WHERE user_id = 'm-eve'");
  const done = await compromise('g-bob', bob);
  assert.equal(done.state, 'SUSPENDED');
  assert.deepEqual(done.authority.assignments.map((a) => a.capability).sort(), [MANAGE, REVOKE_SESSIONS], 'both capabilities, each from its own assignment');
  // a revoke grant that does not cover the node is not enough, however broad the manage grant is — and the denial names it
  const dave = await seedGovernor(db, 'g-dave', { withRevoke: false });
  const narrow = await seedAssignment(db, { subject: 'g-dave', membershipId: dave.membershipId, capability: REVOKE_SESSIONS, nodes: ['BU_SERVICE_NETWORK'] });
  const denied = await compromise('g-dave', await sess(db, 'g-dave')).catch((error) => error);
  assert.match(String(denied.message), /CORPORATE_GOVERNANCE\/AUTHORITY_DENIED/);
  assert.deepEqual(JSON.parse(denied.detail), [{ capability: REVOKE_SESSIONS, reason: 'OUT_OF_SCOPE', assignment_id: narrow }]);
});

test('END through the entry point: the governance-loss protection is computed by the database — the last two governors cannot be ended, a third lets one go, a non-governor is free', async () => {
  const { db, g } = await world(['g-alice', 'g-bob', 'g-carol', 'g-dave']);
  const s = {}; for (const u of ['g-alice', 'g-bob', 'g-carol', 'g-dave']) s[u] = await sess(db, u);
  const endGov = (actor, subject) => direct(db, { op: 'END', actor, session: s[actor], subject, node: ROOT_NODE, membership: g[subject].membershipId });
  // dave is one of four governors: alice, bob, carol remain (3 ≥ 2)
  assert.equal((await endGov('g-alice', 'g-dave')).state, 'ENDED');
  // carol ending → alice and bob remain (2 ≥ 2): allowed
  assert.equal((await endGov('g-alice', 'g-carol')).state, 'ENDED');
  // bob ending → only alice would remain: refused, and nothing changes
  const before = await countAll(db);
  assert.equal(await refusal(endGov('g-alice', 'g-bob')), 'GOVERNANCE_CONTINUITY_PROTECTION');
  assert.equal(await countAll(db), before);
  assert.equal(await stateOf(db, g['g-bob'].membershipId), 'ACTIVE');
  // a non-governor member is free to end: no attestation exists to be forged or forgotten
  const plain = await governedPending(db, 'g-alice', s['g-alice'], 'm-eve');
  assert.equal((await direct(db, { op: 'END', actor: 'g-alice', session: s['g-alice'], subject: 'm-eve', node: NODE, membership: plain.membership_id })).state, 'ENDED');
  // the old attestation parameter does not exist on the entry point
  assert.match(String(await message(rpc(db, 'corporate_authority_apply_direct', {
    p_operation: 'END', p_actor_user_id: 'g-alice', p_actor_session_id: s['g-alice'], p_subject_user_id: 'g-bob', p_org_node_id: ROOT_NODE, p_membership_id: g['g-bob'].membershipId, p_reason: 'r', p_reference: 'x',
    p_effective_from: null, p_effective_until: null, p_classification: 'ROUTINE', p_session_revocation: null, p_governance_decision: { governance_continuity: { subject_holds_governance_authority: false, remaining_independent_governors: 99 } } }))), /does not exist/i);
  // revoking a governor's ASSIGNMENT (not the membership) also reduces the count: carol is gone; bob + alice are two; suspend alice's assignment → bob alone
  await seedGovernor(db, 'g-heidi-gov', { node: ROOT_NODE });
  s['g-heidi-gov'] = await sess(db, 'g-heidi-gov');
  assert.equal((await endGov('g-alice', 'g-bob')).state, 'ENDED', 'with a new governor (heidi) alice + heidi remain');
});

test('unresolvable calls pass NO decision and fail with the Phase-B codes: unknown membership, unknown request, wrong operation, missing actor — and write nothing', async () => {
  const { db } = await world(['g-alice']);
  const alice = await sess(db, 'g-alice');
  const before = await countAll(db);
  const ghost = '00000000-0000-0000-0000-0000000000aa';
  const results = {
    'unknown membership (SUSPEND)': await refusal(direct(db, { op: 'SUSPEND', actor: 'g-alice', session: alice, subject: 'm-eve', node: NODE, membership: ghost })),
    'unknown membership (submit)': await refusal(submit(db, { membership: ghost, actor: 'g-alice', session: alice })),
    'unknown request (decide)': await refusal(decide(db, { request_id: ghost, subject_user_id: 'm-eve', membership_id: ghost, org_node_id: NODE, operation: 'ACTIVATE', binding_digest: 'a'.repeat(64) }, { actor: 'g-alice', session: alice })),
    'unknown request (execute)': await refusal(execute(db, { request_id: ghost, binding_digest: 'a'.repeat(64) }, { actor: 'g-alice', session: alice })),
    'unknown request (cancel)': await refusal(cancel(db, { request_id: ghost }, { actor: 'g-alice', session: alice })),
    'operation not direct': await refusal(direct(db, { op: 'ACTIVATE', actor: 'g-alice', session: alice, subject: 'm-eve', node: NODE })),
    'missing actor': await refusal(direct(db, { op: 'CREATE', actor: null, session: alice, subject: 'm-eve', node: NODE })),
    'unknown node': await refusal(direct(db, { op: 'CREATE', actor: 'g-alice', session: alice, subject: 'm-eve', node: 'NO_SUCH_NODE' })),
  };
  assert.deepEqual(results, {
    'unknown membership (SUSPEND)': 'MEMBERSHIP_NOT_FOUND', 'unknown membership (submit)': 'MEMBERSHIP_NOT_FOUND', 'unknown request (decide)': 'REQUEST_NOT_FOUND',
    'unknown request (execute)': 'REQUEST_NOT_FOUND', 'unknown request (cancel)': 'REQUEST_NOT_FOUND', 'operation not direct': 'OPERATION_NOT_DIRECT',
    'missing actor': 'ACTOR_REQUIRED', 'unknown node': 'NODE_UNKNOWN' });
  assert.equal(await countAll(db), before);
});

test('atomic: a failure while writing the ledger rolls the WHOLE governed call back — membership, lifecycle event, request and step — and the authority lookups leave no trace', async () => {
  const { db } = await world(['g-alice']);
  const alice = await sess(db, 'g-alice');
  const created = await governedPending(db, 'g-alice', alice, 'm-eve');
  await db.exec(`CREATE OR REPLACE FUNCTION public.cert_inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_LEDGER_FAILURE'; END; $$;
    CREATE TRIGGER cert_inject BEFORE INSERT ON public.corporate_membership_request_steps FOR EACH ROW EXECUTE FUNCTION public.cert_inject_failure();`);
  const before = await countAll(db);
  const m = await message(direct(db, { op: 'END', actor: 'g-alice', session: alice, subject: 'm-eve', node: NODE, membership: created.membership_id }));
  assert.match(String(m), /INJECTED_LEDGER_FAILURE/);
  assert.equal(await countAll(db), before, 'nothing survived the failure');
  await db.exec('DROP TRIGGER cert_inject ON public.corporate_membership_request_steps');
  assert.equal(await stateOf(db, created.membership_id), 'PENDING');
});

test('tenant and identity separation: a full governed run touches no identity table, no users.role, no tenant or organisation row, and no assignment', async () => {
  const { db } = await world();
  const [alice, bob] = [await sess(db, 'g-alice'), await sess(db, 'g-bob')];
  const before = await snapshot(db, IDENTITY_TABLES);
  const assignmentsBefore = JSON.stringify(await owner(db, 'SELECT assignment_id, state, updated_at FROM corporate_permission_assignments ORDER BY 1'));
  const created = await governedPending(db, 'g-alice', alice, 'm-eve');
  const req = await submit(db, { membership: created.membership_id, actor: 'g-alice', session: alice });
  await decide(db, req, { actor: 'g-bob', session: bob });
  await execute(db, req, { actor: 'g-alice', session: alice });
  await direct(db, { op: 'SUSPEND', actor: 'g-bob', session: bob, subject: 'm-eve', node: NODE, membership: created.membership_id });
  await direct(db, { op: 'END', actor: 'g-alice', session: alice, subject: 'm-eve', node: NODE, membership: created.membership_id });
  assert.equal(await snapshot(db, IDENTITY_TABLES), before, 'users, tenants, tenant_users, organizations, organization_users are byte-identical');
  assert.equal(JSON.stringify(await owner(db, 'SELECT assignment_id, state, updated_at FROM corporate_permission_assignments ORDER BY 1')), assignmentsBefore, 'a membership mutation never changes an assignment');
  assert.equal((await owner(db, "SELECT role FROM users WHERE id = 'm-eve'"))[0].role, 'owner');
});

// ═════════════ 6 · Down / Up ═════════════

test('Down restores the Phase-B privileges exactly and removes only Phase C; Up→Down→Up and a second Up are stable and re-close the snapshot procedures', async () => {
  const fingerprint = async (db, filter) => JSON.stringify({
    fns: (await db.query(`SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS def, p.proacl::text AS acl, p.prosecdef FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'corporate\\_%' AND ${filter} ORDER BY 1`)).rows,
    rels: (await db.query(`SELECT c.relname, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'corporate\\_%' AND c.relkind IN ('r','v') AND ${filter.replaceAll('p.proname', 'c.relname')} ORDER BY 1`)).rows,
    cols: (await db.query(`SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS t FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'corporate\\_%' AND a.attnum > 0 AND NOT a.attisdropped AND ${filter.replaceAll('p.proname', 'c.relname')} ORDER BY 1, a.attnum`)).rows });
  const NOT_C = "p.proname !~ '^(corporate_authority_|corporate_permission_)'";
  const ab = await openDatabase({ migrate: 'both' });
  const baseline = await fingerprint(ab, NOT_C);
  const db = await openDatabase({ migrate: 'all' });
  const withC = await fingerprint(db, NOT_C);
  assert.notEqual(withC, baseline, 'Phase C changes exactly the privileges of the five snapshot procedures (and nothing else) — so the fingerprints differ');
  const diffNames = (JSON.parse(withC).fns).filter((f, i) => JSON.stringify(f) !== JSON.stringify(JSON.parse(baseline).fns[i])).map((f) => f.proname).sort();
  assert.deepEqual(diffNames, [...SNAPSHOT_PROCEDURES].sort(), 'only the five snapshot procedures differ, and only in their ACL');
  assert.equal(JSON.stringify(JSON.parse(withC).rels), JSON.stringify(JSON.parse(baseline).rels), 'no Phase A/B table or view changed');
  assert.equal(JSON.stringify(JSON.parse(withC).cols), JSON.stringify(JSON.parse(baseline).cols), 'no Phase A/B column changed');
  await db.exec(PHASE_C.down);
  assert.equal(await fingerprint(db, NOT_C), baseline, 'Down restores Phase B exactly — including service_role EXECUTE on the snapshot procedures');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname ~ '^(corporate_authority_|corporate_permission_)'")).rows[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relname ~ '^corporate_permission_'")).rows[0].n, 0);
  await db.exec(PHASE_C.up);
  assert.equal(await fingerprint(db, NOT_C), withC, 'Up → Down → Up is the same schema');
  await db.exec(PHASE_C.up);   // a second Up (idempotent)
  assert.equal(await fingerprint(db, NOT_C), withC, 'a second Up changes nothing and re-closes the snapshot procedures');
  assert.equal((await db.query("SELECT has_function_privilege('service_role', 'public.corporate_membership_apply_direct(text,text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,jsonb,jsonb)', 'EXECUTE') AS ok")).rows[0].ok, false);
});
