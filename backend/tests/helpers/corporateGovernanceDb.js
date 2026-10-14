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

/** { db } with `migrate`: 'both' (default) | 'A' | 'none'. Every handle is closed by closeAll(). */
const open = [];
export async function closeAll() { await Promise.all(open.splice(0).map((db) => db.close().catch(() => {}))); }
export async function openDatabase({ migrate = 'both' } = {}) {
  const db = await PGlite.create();
  open.push(db);
  await db.exec(BOOTSTRAP);
  if (migrate === 'A' || migrate === 'both') await db.exec(PHASE_A.up);
  if (migrate === 'both') await db.exec(PHASE_B.up);
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
  const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}${JSON_PARAMS.has(k) ? '::jsonb' : ''}${UUID_PARAMS.has(k) ? '::uuid' : ''}${TS_PARAMS.has(k) ? '::timestamptz' : ''}`).join(', ')}) AS r`;
  const values = keys.map((k) => (JSON_PARAMS.has(k) && args[k] !== null ? JSON.stringify(args[k]) : args[k]));
  return asRole(db, 'service_role', async () => (await db.query(sql, values)).rows[0].r);
}
const JSON_PARAMS = new Set(['p_governance_decision', 'p_session_revocation']);
const UUID_PARAMS = new Set(['p_membership_id', 'p_request_id', 'p_expected_membership_id']);
const TS_PARAMS = new Set(['p_effective_from', 'p_effective_until']);

/** The refusal code (the part after CORPORATE_GOVERNANCE/) of a failed governed call, or null if it succeeded. */
export async function refusal(promise) {
  try { await promise; } catch (error) {
    const m = String(error?.message ?? error).match(/CORPORATE_GOVERNANCE\/([A-Z0-9_]+)/);
    return m ? m[1] : `OTHER:${String(error?.message ?? error)}`;
  }
  return null;
}

export const snapshot = async (db, tables) => JSON.stringify(Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await db.query(`SELECT * FROM ${t} ORDER BY 1, 2`)).rows]))));
