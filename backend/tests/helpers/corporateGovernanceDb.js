/**
 * CA-K3-AUTH-03 — a real PostgreSQL (PGlite 17) database carrying the ACCEPTED Phase-A migration and the Phase-B governance migration,
 * under the conditions that matter: the migrations are applied by a NON-superuser BYPASSRLS owner (as `postgres` is on Supabase),
 * Supabase's default privileges are reproduced (service_role / anon / authenticated receive ALL on every NEW table and function),
 * and user_sessions has the real shape (TEXT timestamps, the O2-X3 step-up columns).
 *
 * Shared by the database test and the service test, so both exercise the SAME SQL.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { parseMigrationSource } from '../../db/migrationParser.js';

const DIR = new URL('../../../database/migrations/', import.meta.url);
export const PHASE_A_FILE = '20261014010000_ca_k3_auth_02_corporate_membership_foundation.sql';
export const PHASE_B_FILE = '20261014020000_ca_k3_auth_03_corporate_membership_governance.sql';
const load = (file) => parseMigrationSource(readFileSync(new URL(file, DIR), 'utf8'), file);
export const PHASE_A = load(PHASE_A_FILE);
export const PHASE_B = load(PHASE_B_FILE);
export const PHASE_B_RAW = readFileSync(new URL(PHASE_B_FILE, DIR), 'utf8');
// Phase C (CA-K3-AUTH-04): the persistent permission authority + DB-trusted evaluator. Opened ONLY on request (`migrate: 'all'`), so the Phase-B
// tests keep running against exactly the accepted Phase-A + Phase-B database they were written for.
export const PHASE_C_FILE = '20261015010000_ca_k3_auth_04_corporate_permission_authority.sql';
export const PHASE_C = load(PHASE_C_FILE);
export const PHASE_C_RAW = readFileSync(new URL(PHASE_C_FILE, DIR), 'utf8');

export const OWNER = 'mig_owner';
export const HOUR = 3600 * 1000;
export const MINUTE = 60 * 1000;
export const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

export const BOOTSTRAP = `
  CREATE ROLE ${OWNER} NOSUPERUSER BYPASSRLS CREATEROLE;
  CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  ALTER SCHEMA public OWNER TO ${OWNER}; GRANT USAGE ON SCHEMA public TO ${OWNER}, anon, authenticated, service_role;
  -- Supabase default privileges (read from staging's pg_default_acl): ALL on every NEW table / function / sequence.
  ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON TABLES    TO ${OWNER}, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON FUNCTIONS TO ${OWNER}, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON SEQUENCES TO ${OWNER}, anon, authenticated, service_role;
  SET ROLE ${OWNER};
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, role TEXT NOT NULL);
  CREATE TABLE tenants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, type TEXT);
  CREATE TABLE tenant_users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL);
  -- the real shape: TEXT timestamps; step_up_* from the O2-X3 migration
  CREATE TABLE user_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT, is_valid BOOLEAN DEFAULT true,
                              created_at TEXT NOT NULL DEFAULT now()::text, expires_at TEXT NOT NULL, auth_method TEXT, user_agent TEXT, step_up_at TEXT, step_up_method TEXT);
  CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE organization_users (organization_id TEXT REFERENCES organizations(id), user_id TEXT REFERENCES users(id), role TEXT);
  INSERT INTO users VALUES
    ('u-admin','admin@x.invalid','admin'), ('u-padmin','padmin@x.invalid','platform_admin'), ('u-sadmin','sadmin@x.invalid','super_admin'),
    ('u-tadmin','tadmin@x.invalid','owner'), ('u-lorg','lorg@x.invalid','owner'),
    ('g-alice','alice@x.invalid','owner'), ('g-bob','bob@x.invalid','owner'), ('g-carol','carol@x.invalid','owner'), ('g-dave','dave@x.invalid','owner'),
    ('m-eve','eve@x.invalid','owner'), ('m-frank','frank@x.invalid','owner'), ('m-grace','grace@x.invalid','owner'), ('m-heidi','heidi@x.invalid','owner'), ('m-ivan','ivan@x.invalid','owner');
  INSERT INTO tenants (id, name, type) VALUES ('11111111-1111-1111-1111-111111111111','Avondale Dealers','dealership');
  INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ('11111111-1111-1111-1111-111111111111','u-tadmin','admin'), ('11111111-1111-1111-1111-111111111111','m-eve','member');
  INSERT INTO organizations VALUES ('O-1','Legacy External Org');
  INSERT INTO organization_users VALUES ('O-1','u-lorg','admin'), ('O-1','m-frank','member');`;
export const IDENTITY_TABLES = ['users', 'tenants', 'tenant_users', 'organizations', 'organization_users'];

/** { db } with `migrate`: 'both' (default: Phase A + B) | 'all' (A + B + C) | 'A' | 'none'. Every handle is closed by closeAll(). */
const open = [];
export async function closeAll() { await Promise.all(open.splice(0).map((db) => db.close().catch(() => {}))); }
export async function openDatabase({ migrate = 'both' } = {}) {
  const db = await PGlite.create();
  open.push(db);
  await db.exec(BOOTSTRAP);
  if (migrate === 'A' || migrate === 'both' || migrate === 'all') await db.exec(PHASE_A.up);
  if (migrate === 'both' || migrate === 'all') await db.exec(PHASE_B.up);
  if (migrate === 'all') await db.exec(PHASE_C.up);
  return db;
}

/** Run `fn` as another role on the one connection (PostgREST style), then return to the migration owner. */
export async function asRole(db, role, fn) {
  await db.exec(`SET ROLE ${role}`);
  try { return await fn(db); } finally { await db.exec(`SET ROLE ${OWNER}`); }
}

/** A live session for `userId`. stepUp: { ageMs, method } or null for none. */
let sessionSeq = 0;
export async function addSession(db, userId, { stepUp = { ageMs: 0, method: 'password_reauth' }, valid = true, expiresInMs = 8 * HOUR, id } = {}) {
  const sid = id ?? `s-${userId}-${(sessionSeq += 1)}`;
  await db.query(
    `INSERT INTO user_sessions (id, user_id, token, is_valid, expires_at, step_up_at, step_up_method) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [sid, userId, `tok-${sid}`, valid, iso(expiresInMs), stepUp ? iso(-stepUp.ageMs) : null, stepUp ? stepUp.method : null]);
  return sid;
}

/** The decision snapshot a target governance evaluator would issue. Plain JSON, for the database boundary. */
export function decisionFor({ actor, subject, node = 'BU_MARKETPLACE', capabilities, scope, ageMs = 0, ...overrides }) {
  return {
    contract: 'carup.corporate_governance_decision.v1',
    decision: 'granted',
    source: 'target_corporate_governance',
    evaluator: { name: 'test-evaluator', version: '1' },
    decided_at: iso(-ageMs),
    actor_user_id: actor,
    subject_user_id: subject,
    capabilities: capabilities ?? ['corporate.people.membership.manage'],
    scope: scope ?? { kind: 'ORG_NODES', org_node_ids: [node] },
    assurance: { class: 'A1_RECENT_REAUTH', server_proven: true },
    governance_continuity: { subject_holds_governance_authority: false, remaining_independent_governors: 5 },
    ...overrides,
  };
}

/** Call a governed procedure as service_role, exactly as PostgREST would; returns the jsonb result. */
export async function rpc(db, name, args) {
  const keys = Object.keys(args);
  const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}${JSON_PARAMS.has(k) ? '::jsonb' : ''}${UUID_PARAMS.has(k) ? '::uuid' : ''}${TS_PARAMS.has(k) ? '::timestamptz' : ''}${TEXT_ARRAY_PARAMS.has(k) ? '::text[]' : ''}`).join(', ')}) AS r`;
  const values = keys.map((k) => (JSON_PARAMS.has(k) && args[k] !== null ? JSON.stringify(args[k]) : args[k]));
  return asRole(db, 'service_role', async () => (await db.query(sql, values)).rows[0].r);
}
const JSON_PARAMS = new Set(['p_governance_decision', 'p_session_revocation']);
const UUID_PARAMS = new Set(['p_membership_id', 'p_request_id', 'p_expected_membership_id', 'p_target_membership_id']);
const TS_PARAMS = new Set(['p_effective_from', 'p_effective_until']);
const TEXT_ARRAY_PARAMS = new Set(['p_capabilities']);

/** The refusal code (the part after CORPORATE_GOVERNANCE/) of a failed governed call, or null if it succeeded. */
export async function refusal(promise) {
  try { await promise; } catch (error) {
    const m = String(error?.message ?? error).match(/CORPORATE_GOVERNANCE\/([A-Z0-9_]+)/);
    return m ? m[1] : `OTHER:${String(error?.message ?? error)}`;
  }
  return null;
}

export const snapshot = async (db, tables) => JSON.stringify(Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await db.query(`SELECT * FROM ${t} ORDER BY 1, 2`)).rows]))));

// ── Phase C fixtures (CA-K3-AUTH-04) ───────────────────────────────────────────────────────────────────────────────────────────
// Everything below is an OWNER-run ceremony on a DISPOSABLE test database: Phase C deliberately ships no way to create an assignment or a
// first administrator, so a test has to play the owner. None of this exists in any real environment.
export const MANAGE = 'corporate.people.membership.manage';
export const REVOKE_SESSIONS = 'corporate.people.session.revoke';
export const ROOT_NODE = 'CARUP_CORPORATE';
export const FIXTURE_ACTORS = Object.freeze({ requester: 'f-requester', approver: 'f-approver', activator: 'f-activator', suspender: 'f-suspender' });

export async function ensureUsers(db, ids) {
  for (const id of ids) await db.query(`INSERT INTO users (id, email, role) VALUES ($1, $2, 'owner') ON CONFLICT (id) DO NOTHING`, [id, `${id}@x.invalid`]);
}

/** A membership created by the owner ceremony (SYSTEM actor), in the given state and window. Returns its id. */
export async function seedMembership(db, userId, node = ROOT_NODE, { state = 'ACTIVE', fromOffsetMs = -MINUTE, untilOffsetMs = null } = {}) {
  await ensureUsers(db, [userId]);
  const r = await db.query(
    `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, effective_until, created_by_kind, created_reason, created_reference,
                                        updated_by_kind, updated_reason, updated_reference)
     VALUES ($1, $2, $3, $4, $5, 'SYSTEM', 'fixture ceremony', 'FIX', 'SYSTEM', 'fixture ceremony', 'FIX') RETURNING membership_id`,
    [userId, node, state, iso(fromOffsetMs), untilOffsetMs === null ? null : iso(untilOffsetMs)]);
  return r.rows[0].membership_id;
}

/** Superuser-only time travel for rows the guards (rightly) make immutable: used to MOVE a window into the past, never to write a fact. */
export async function backdate(db, sql, params = []) {
  await db.exec('RESET ROLE');
  try { await db.exec('SET session_replication_role = replica'); await db.query(sql, params); } finally { await db.exec('RESET session_replication_role'); await db.exec(`SET ROLE ${OWNER}`); }
}

/** One lifecycle step on an assignment, through the real guard (an owner ceremony on a disposable database; the guard writes the lineage). */
export const moveAssignment = (db, assignmentId, to, by = FIXTURE_ACTORS.suspender, reason = `fixture ${to.toLowerCase()}`) => db.query(
  `UPDATE corporate_permission_assignments SET state = $2, updated_by_kind = 'USER', updated_by_user_id = $3, updated_reason = $4, updated_reference = 'FIX' WHERE assignment_id = $1`,
  [assignmentId, to, by, reason]);

/**
 * One assignment, walked through the REAL lifecycle guard: REQUESTED → APPROVED → ACTIVE → (SUSPENDED | REVOKED | EXPIRED).
 * `finalState` says where to stop. Requester, approver and activator are three different fixture people, none of them the subject.
 */
export async function seedAssignment(db, {
  subject, membershipId, capability = MANAGE, nodes = [ROOT_NODE], includeDescendants = true, floor = 'A1_RECENT_REAUTH',
  fromOffsetMs = -MINUTE, untilOffsetMs = 8 * HOUR, finalState = 'ACTIVE',
  requestedBy = FIXTURE_ACTORS.requester, approvedBy = FIXTURE_ACTORS.approver, activatedBy = FIXTURE_ACTORS.activator,
}) {
  await ensureUsers(db, [requestedBy, approvedBy, activatedBy, FIXTURE_ACTORS.suspender]);
  const inserted = await db.query(
    `INSERT INTO corporate_permission_assignments (subject_user_id, membership_id, capability, scope_node_ids, include_descendants, effective_from, effective_until,
                                                   assurance_floor, requested_by_user_id, request_reason, request_reference, state, updated_by_kind, updated_by_user_id, updated_reason, updated_reference)
     VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8, $9, 'fixture request', 'FIX-REQ', 'REQUESTED', 'USER', $9, 'fixture request', 'FIX-REQ') RETURNING assignment_id`,
    [subject, membershipId, capability, nodes, includeDescendants, iso(fromOffsetMs), iso(untilOffsetMs), floor, requestedBy]);
  const id = inserted.rows[0].assignment_id;
  const move = (to, by) => moveAssignment(db, id, to, by);
  const path = ['REQUESTED', 'APPROVED', 'ACTIVE'];
  const stop = path.indexOf(finalState);
  if (stop >= 1) await move('APPROVED', approvedBy);
  if (stop >= 2) await move('ACTIVE', activatedBy);
  if (stop === -1) {
    await move('APPROVED', approvedBy); await move('ACTIVE', activatedBy);
    if (finalState === 'EXPIRED') {
      await backdate(db, `UPDATE corporate_permission_assignments SET effective_from = now() - interval '2 hours', effective_until = now() - interval '1 minute' WHERE assignment_id = $1`, [id]);
    }
    await move(finalState, FIXTURE_ACTORS.suspender);
  }
  return id;
}

/** A governor: an ACTIVE membership plus an ACTIVE manage assignment and an ACTIVE session-revoke assignment over the whole tree. */
export async function seedGovernor(db, userId, { node = ROOT_NODE, nodes = [ROOT_NODE], includeDescendants = true, withRevoke = true, ...rest } = {}) {
  const membershipId = await seedMembership(db, userId, node);
  const manageId = await seedAssignment(db, { subject: userId, membershipId, capability: MANAGE, nodes, includeDescendants, ...rest });
  const revokeId = withRevoke ? await seedAssignment(db, { subject: userId, membershipId, capability: REVOKE_SESSIONS, nodes, includeDescendants, ...rest }) : null;
  return { userId, membershipId, manageId, revokeId };
}

/** The trusted evaluator as service_role would call it (the read-only preview). */
export const evaluate = (db, { actor, subject, node, capabilities = [MANAGE], needContinuity = false, target = null }) =>
  rpc(db, 'corporate_authority_evaluate', { p_actor_user_id: actor, p_subject_user_id: subject, p_org_node_id: node, p_capabilities: capabilities, p_need_continuity: needContinuity, p_target_membership_id: target });
