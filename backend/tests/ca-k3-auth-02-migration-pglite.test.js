/**
 * CA-K3-AUTH-02 (Phase A) — the Corporate organisation + membership migration, run for real on PostgreSQL
 * (PGlite 17): the actual SQL, applied Up, Up again, Down, Up.
 *
 * What a mock cannot show and this does: the CHECKs reject, the triggers fire, the privileges bind, RLS is
 * forced, the seed is exactly the accepted reference nodes and no member, nothing touches users.role /
 * tenant_users / organization_users / user_sessions, and the shipped resolver reads the REAL columns.
 *
 * Authorities: CA-ORG-01 (taxonomy + eligible parents + the four stable BU ids), CA-RBAC-01 (membership is
 * not permission), CA-K3-AUTH-02 (Phase A only).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { parseMigrationSource } from '../db/migrationParser.js';
import { MEMBERSHIP_STATE as S, resolveCorporateMembership } from '../services/corporate/corporateMembershipService.js';

const DIR = new URL('../../database/migrations/', import.meta.url);
const FILE = '20261014010000_ca_k3_auth_02_corporate_membership_foundation.sql';
const raw = readFileSync(new URL(FILE, DIR), 'utf8');
const { up: UP, down: DOWN } = parseMigrationSource(raw, FILE);

const open = [];
after(async () => { await Promise.all(open.map((db) => db.close().catch(() => {}))); });

const BOOTSTRAP = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, role TEXT NOT NULL);
  CREATE TABLE tenants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, type TEXT);
  CREATE TABLE tenant_users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL);
  CREATE TABLE user_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token TEXT, is_valid BOOLEAN);
  CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE organization_users (organization_id TEXT REFERENCES organizations(id), user_id TEXT REFERENCES users(id), role TEXT);
  INSERT INTO users VALUES ('u-admin','admin@x.invalid','admin'), ('u-padmin','padmin@x.invalid','platform_admin'), ('u-sadmin','sadmin@x.invalid','super_admin'),
    ('u-owner','owner@x.invalid','owner'), ('u-tadmin','tadmin@x.invalid','owner'), ('u-lorg','lorg@x.invalid','owner'),
    ('u-hr','hr@x.invalid','owner'), ('u-actor','actor@x.invalid','owner');
  INSERT INTO tenants (id, name, type) VALUES ('11111111-1111-1111-1111-111111111111','Avondale Dealers','dealership');
  INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ('11111111-1111-1111-1111-111111111111','u-tadmin','admin');
  INSERT INTO user_sessions VALUES ('s1','u-admin','tok-admin',true);
  INSERT INTO organizations VALUES ('O-1','Legacy External Org');
  INSERT INTO organization_users VALUES ('O-1','u-lorg','admin');`;
const IDENTITY = ['users', 'tenants', 'tenant_users', 'user_sessions', 'organizations', 'organization_users'];

async function database({ migrate = true } = {}) {
  const db = await PGlite.create();
  open.push(db);
  await db.exec(BOOTSTRAP);
  if (migrate) await db.exec(UP);
  return db;
}
async function identitySnapshot(db) {
  const out = {};
  for (const t of IDENTITY) out[t] = (await db.query(`SELECT * FROM ${t} ORDER BY 1, 2`)).rows;
  return JSON.stringify(out);
}
async function refused(db, sql, params, pattern) {
  try { await db.query(sql, params); } catch (error) {
    assert.match(String(error.message), pattern, `refused for the wrong reason: ${error.message}`);
    return;
  }
  assert.fail(`expected refusal ${pattern}: ${sql}`);
}
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 3600 * 1000;
let seq = 0;
async function addMembership(db, { user = 'u-hr', node = 'BU_MARKETPLACE', state = 'ACTIVE', from = iso(-24 * HOUR), until = null, by = null, reason = 'test fixture' } = {}) {
  const kind = by ? 'USER' : 'SYSTEM';
  const { rows } = await db.query(
    `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, effective_until,
       created_by_kind, created_by_user_id, created_reason, updated_by_kind, updated_by_user_id, updated_reason)
     VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$6,$7,$8) RETURNING membership_id`,
    [user, node, state, from, until, kind, by, `${reason} #${(seq += 1)}`]);
  return rows[0].membership_id;
}
const stateOf = async (db, id) => (await db.query('SELECT state FROM corporate_memberships WHERE membership_id = $1', [id])).rows[0].state;

// ═════════════ 1 · the migration file ═════════════

test('file: a canonical migration, sorted after every other, with a unique version', () => {
  const all = readdirSync(DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  assert.equal(all.at(-1), FILE, 'the newest migration in the tree');
  assert.equal(all.filter((f) => f.startsWith(FILE.slice(0, 14))).length, 1, 'no shared version');
  assert.ok(UP.length > 500 && DOWN.length > 20);
});

const stripped = (sql) => sql.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");

test('file: it writes only to the two new tables — nothing reads, writes, grants on or backfills any identity table', () => {
  const sql = stripped(UP);
  const inserts = [...sql.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]);
  assert.ok(inserts.length >= 2);
  assert.deepEqual([...new Set(inserts)], ['corporate_org_nodes'], 'the only seeded table is the organisation reference table');
  assert.doesNotMatch(sql, /\bUPDATE\s+(?:public\.)?\w+\s+SET\b/i, 'no UPDATE statement');
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO[\s\S]{0,400}\bSELECT\b/i, 'no INSERT ... SELECT backfill from anywhere');
  // The only mention of an identity table is a foreign key to users(id).
  const without = sql.replace(/REFERENCES\s+public\.users\(id\)/gi, '');
  assert.doesNotMatch(without, /\b(users|user_sessions|tenants|tenant_users|organizations|organization_users)\b/i);
  assert.equal([...sql.matchAll(/REFERENCES\s+public\.users\(id\)/gi)].length, 3, 'user_id + the two actor references');
});

test('file: closed to every client role — RLS enabled and forced on both tables, no grant to anon / authenticated / PUBLIC, no DELETE / TRUNCATE', () => {
  const sql = stripped(UP);
  for (const t of ['corporate_org_nodes', 'corporate_memberships']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} FORCE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM PUBLIC, anon, authenticated`));
  }
  const grants = [...sql.matchAll(/\bGRANT\b[^;]*;/gi)].map((m) => m[0]);
  assert.equal(grants.length, 2);
  for (const g of grants) {
    assert.match(g, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.corporate_(org_nodes|memberships) TO service_role;$/);
    assert.doesNotMatch(g, /\b(?:anon|authenticated)\b|\bPUBLIC\b|\bDELETE\b|\bTRUNCATE\b|\bALL\b/, 'keywords only: the lowercase schema prefix public. is not the PUBLIC role');
  }
});

test('file: the Down removes exactly what the Up created', () => {
  assert.match(DOWN, /DROP TABLE IF EXISTS public\.corporate_memberships/);
  assert.match(DOWN, /DROP TABLE IF EXISTS public\.corporate_org_nodes/);
  assert.match(DOWN, /DROP FUNCTION IF EXISTS public\.corporate_memberships_guard\(\)/);
  assert.match(DOWN, /DROP FUNCTION IF EXISTS public\.corporate_org_nodes_guard\(\)/);
  assert.doesNotMatch(stripped(DOWN), /\b(users|tenant_users|organization_users|user_sessions)\b/i);
});

// ═════════════ 2 · what exists after Up ═════════════

test('Up: exactly the accepted reference nodes and NO member — the four stable BU ids preserved verbatim', async () => {
  const db = await database();
  const { rows } = await db.query('SELECT node_id, entity_type, parent_node_id, display_name, legal_evidence_ref FROM corporate_org_nodes ORDER BY node_id');
  assert.deepEqual(rows.map((r) => [r.node_id, r.entity_type, r.parent_node_id]), [
    ['BU_DIASPORA_TRADE', 'BUSINESS_UNIT', 'CARUP_CORPORATE'], ['BU_FINANCIAL_SERVICES', 'BUSINESS_UNIT', 'CARUP_CORPORATE'],
    ['BU_MARKETPLACE', 'BUSINESS_UNIT', 'CARUP_CORPORATE'], ['BU_SERVICE_NETWORK', 'BUSINESS_UNIT', 'CARUP_CORPORATE'],
    ['CARUP_CORPORATE', 'CORPORATE_PARENT', null],
  ]);
  assert.ok(rows.every((r) => r.legal_evidence_ref === null), 'no legal status asserted for any node');
  assert.equal(rows.filter((r) => ['LEGAL_ENTITY', 'SUBSIDIARY'].includes(r.entity_type)).length, 0, 'no LEGAL_ENTITY / SUBSIDIARY exists merely because the type exists');
  assert.equal((await db.query('SELECT count(*)::int AS c FROM corporate_memberships')).rows[0].c, 0, 'no Corporate member is created');
});

test('Up: unchanged identity — no user, session, tenant, tenant membership or legacy organisation row is created, changed or removed', async () => {
  const db = await database({ migrate: false });
  const before = await identitySnapshot(db);
  await db.exec(UP);
  assert.equal(await identitySnapshot(db), before);
  assert.equal((await db.query("SELECT role FROM users WHERE id = 'u-admin'")).rows[0].role, 'admin');
});

test('Up is idempotent: applying it twice changes nothing (same nodes, no member)', async () => {
  const db = await database();
  const snap = JSON.stringify((await db.query('SELECT * FROM corporate_org_nodes ORDER BY node_id')).rows);
  await db.exec(UP);
  assert.equal(JSON.stringify((await db.query('SELECT * FROM corporate_org_nodes ORDER BY node_id')).rows), snap);
});

test('the schema carries membership and placement ONLY — no permission, capability, role, scope or grant column anywhere', async () => {
  const db = await database();
  const cols = async (t) => (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name", [t])).rows.map((r) => r.column_name);
  assert.deepEqual(await cols('corporate_memberships'), [
    'created_at', 'created_by_kind', 'created_by_user_id', 'created_reason', 'created_reference', 'effective_from', 'effective_until',
    'membership_id', 'org_node_id', 'state', 'updated_at', 'updated_by_kind', 'updated_by_user_id', 'updated_reason', 'user_id',
  ]);
  assert.deepEqual(await cols('corporate_org_nodes'), ['created_at', 'display_name', 'entity_type', 'legal_evidence_ref', 'node_id', 'parent_node_id']);
  for (const c of [...await cols('corporate_memberships'), ...await cols('corporate_org_nodes')]) assert.doesNotMatch(c, /permission|capabilit|role|scope|grant|privilege|admin/i, c);
});

test('RLS is enabled AND forced on both tables; the guard functions are not executable by client roles', async () => {
  const db = await database();
  const { rows } = await db.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('corporate_org_nodes','corporate_memberships') ORDER BY relname");
  assert.deepEqual(rows.map((r) => [r.relname, r.relrowsecurity, r.relforcerowsecurity]), [['corporate_memberships', true, true], ['corporate_org_nodes', true, true]]);
  for (const fn of ['corporate_org_nodes_guard', 'corporate_memberships_guard']) {
    for (const role of ['anon', 'authenticated']) assert.equal((await db.query(`SELECT has_function_privilege('${role}', 'public.${fn}()', 'EXECUTE') AS ok`)).rows[0].ok, false, `${role} ${fn}`);
  }
});

test('privileges: anon and authenticated cannot read or write either table; service_role reads / inserts / updates but cannot delete or truncate', async () => {
  const db = await database();
  for (const role of ['anon', 'authenticated']) {
    try {
      await db.exec(`SET ROLE ${role}`);
      for (const t of ['corporate_memberships', 'corporate_org_nodes']) {
        await refused(db, `SELECT * FROM ${t}`, [], /permission denied/);
        await refused(db, `INSERT INTO ${t} DEFAULT VALUES`, [], /permission denied/);
        await refused(db, `UPDATE ${t} SET created_at = now()`, [], /permission denied/);
        await refused(db, `DELETE FROM ${t}`, [], /permission denied/);
      }
    } finally { await db.exec('RESET ROLE'); }
  }
  const id = await addMembership(db);
  try {
    await db.exec('SET ROLE service_role');
    assert.equal((await db.query('SELECT count(*)::int AS c FROM corporate_memberships')).rows[0].c, 1);
    await db.query("UPDATE corporate_memberships SET state = 'SUSPENDED', updated_by_kind = 'SYSTEM', updated_reason = 'r' WHERE membership_id = $1", [id]);
    await refused(db, 'DELETE FROM corporate_memberships', [], /permission denied/);
    await refused(db, 'TRUNCATE corporate_memberships', [], /permission denied/);
    await refused(db, 'DELETE FROM corporate_org_nodes', [], /permission denied/);
    await refused(db, 'TRUNCATE corporate_org_nodes', [], /permission denied/);
  } finally { await db.exec('RESET ROLE'); }
});

// ═════════════ 3 · the internal organisation ═════════════

const addNode = (db, id, type, parent, extra = {}) => db.query(
  'INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name, legal_evidence_ref) VALUES ($1,$2,$3,$4,$5)',
  [id, type, parent, extra.name ?? id, extra.evidence ?? null]);

// The row guard runs BEFORE the CHECK constraints and is deliberately fail-closed (an unknown type is never an
// eligible child), so an invalid type is refused by whichever fires first. Both are refusals; the CHECK stays as
// the second wall so widening it later cannot silently loosen the hierarchy.
const REFUSED_TYPE = /check constraint|CORPORATE_ORG_NODE_PARENT_TYPE_NOT_ELIGIBLE/;

test('organisation: only the seven accepted node types; a node id is a stable upper-case code', async () => {
  const db = await database();
  await refused(db, "INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES ('REGION_ZW','REGION','CARUP_CORPORATE','r')", [], REFUSED_TYPE);
  await refused(db, "INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES ('EXTERNAL_DEALER','EXTERNAL_CUSTOMER_OR_MERCHANT_ORGANISATION','CARUP_CORPORATE','d')", [], REFUSED_TYPE);
  for (const bad of ['bu_lower', '1BU', 'BU-DASH', 'B', 'BU SPACE', '']) await refused(db, 'INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES ($1,$2,$3,$4)', [bad, 'DEPARTMENT', 'BU_MARKETPLACE', 'x'], /check constraint/);
  await refused(db, "INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES ('BU_NO_NAME','BUSINESS_UNIT','CARUP_CORPORATE','   ')", [], /check constraint/);
});

test('organisation: exactly one consolidated root; the root has no parent and everything else has one', async () => {
  const db = await database();
  await refused(db, "INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES ('SECOND_ROOT','CORPORATE_PARENT',NULL,'x')", [], /duplicate key|unique/);
  await refused(db, "INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES ('ROOT_WITH_PARENT','CORPORATE_PARENT','CARUP_CORPORATE','x')", [], REFUSED_TYPE);
  await refused(db, "INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES ('ORPHAN_BU','BUSINESS_UNIT',NULL,'x')", [], /check constraint/);
  await refused(db, "INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES ('GHOST_CHILD','BUSINESS_UNIT','NO_SUCH_PARENT','x')", [], /CORPORATE_ORG_NODE_PARENT_NOT_FOUND/);
});

test('organisation: LEGAL_ENTITY and SUBSIDIARY exist only on recorded legal evidence', async () => {
  const db = await database();
  for (const type of ['LEGAL_ENTITY', 'SUBSIDIARY']) {
    await refused(db, 'INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES ($1,$2,$3,$4)', [`${type}_X`, type, 'CARUP_CORPORATE', 'x'], /check constraint/);
    await refused(db, 'INSERT INTO corporate_org_nodes (node_id, entity_type, parent_node_id, display_name, legal_evidence_ref) VALUES ($1,$2,$3,$4,$5)', [`${type}_Y`, type, 'CARUP_CORPORATE', 'x', '   '], /check constraint/);
  }
  await addNode(db, 'LE_EVIDENCED', 'LEGAL_ENTITY', 'CARUP_CORPORATE', { evidence: 'registry-extract-2026-ref-001' });
  await addNode(db, 'SUB_EVIDENCED', 'SUBSIDIARY', 'LE_EVIDENCED', { evidence: 'registry-extract-2026-ref-002' });
});

test('organisation: the CA-ORG-01 eligible-parent matrix, node type by node type', async () => {
  const db = await database();
  await addNode(db, 'LE_E', 'LEGAL_ENTITY', 'CARUP_CORPORATE', { evidence: 'ev-1' });
  await addNode(db, 'SUB_E', 'SUBSIDIARY', 'LE_E', { evidence: 'ev-2' });
  await addNode(db, 'CF_PEOPLE_ADMIN', 'CORPORATE_FUNCTION', 'CARUP_CORPORATE');
  await addNode(db, 'DEP_MKT_OPS', 'DEPARTMENT', 'BU_MARKETPLACE');
  await addNode(db, 'TEAM_MKT_A', 'TEAM', 'DEP_MKT_OPS');
  // allowed
  const ok = [['BU_UNDER_LE', 'BUSINESS_UNIT', 'LE_E'], ['BU_UNDER_SUB', 'BUSINESS_UNIT', 'SUB_E'], ['CF_UNDER_LE', 'CORPORATE_FUNCTION', 'LE_E'], ['CF_UNDER_SUB', 'CORPORATE_FUNCTION', 'SUB_E'],
    ['DEP_UNDER_CF', 'DEPARTMENT', 'CF_PEOPLE_ADMIN'], ['DEP_UNDER_LE', 'DEPARTMENT', 'LE_E'], ['TEAM_UNDER_BU', 'TEAM', 'BU_SERVICE_NETWORK'], ['TEAM_UNDER_CF', 'TEAM', 'CF_PEOPLE_ADMIN']];
  for (const [id, type, parent] of ok) await addNode(db, id, type, parent);
  // refused
  const bad = [
    ['LE_UNDER_BU', 'LEGAL_ENTITY', 'BU_MARKETPLACE', { evidence: 'e' }], ['LE_UNDER_TEAM', 'LEGAL_ENTITY', 'TEAM_MKT_A', { evidence: 'e' }],
    ['SUB_UNDER_SUB', 'SUBSIDIARY', 'SUB_E', { evidence: 'e' }], ['SUB_UNDER_BU', 'SUBSIDIARY', 'BU_MARKETPLACE', { evidence: 'e' }],
    ['BU_UNDER_BU', 'BUSINESS_UNIT', 'BU_MARKETPLACE'], ['BU_UNDER_CF', 'BUSINESS_UNIT', 'CF_PEOPLE_ADMIN'], ['BU_UNDER_DEPT', 'BUSINESS_UNIT', 'DEP_MKT_OPS'],
    ['CF_UNDER_BU', 'CORPORATE_FUNCTION', 'BU_MARKETPLACE'], ['CF_UNDER_CF', 'CORPORATE_FUNCTION', 'CF_PEOPLE_ADMIN'], ['CF_UNDER_DEPT', 'CORPORATE_FUNCTION', 'DEP_MKT_OPS'],
    ['DEP_UNDER_ROOT', 'DEPARTMENT', 'CARUP_CORPORATE'], ['DEP_UNDER_DEP', 'DEPARTMENT', 'DEP_MKT_OPS'], ['DEP_UNDER_TEAM', 'DEPARTMENT', 'TEAM_MKT_A'],
    ['TEAM_UNDER_ROOT', 'TEAM', 'CARUP_CORPORATE'], ['TEAM_UNDER_TEAM', 'TEAM', 'TEAM_MKT_A'], ['TEAM_UNDER_LE', 'TEAM', 'LE_E'],
  ];
  for (const [id, type, parent, extra] of bad) {
    await assert.rejects(addNode(db, id, type, parent, extra), /CORPORATE_ORG_NODE_PARENT_TYPE_NOT_ELIGIBLE/, `${type} under ${parent}`);
  }
  assert.equal((await db.query("SELECT count(*)::int c FROM corporate_org_nodes WHERE node_id = 'CF_PEOPLE_ADMIN' AND parent_node_id = 'CARUP_CORPORATE'")).rows[0].c, 1,
    'a Corporate Function is a peer under the root — not required to sit under a Business Unit');
});

test('organisation: identity and place in the hierarchy never change and a node is never deleted; only its display name may be corrected', async () => {
  const db = await database();
  await refused(db, "UPDATE corporate_org_nodes SET node_id = 'BU_RENAMED' WHERE node_id = 'BU_MARKETPLACE'", [], /CORPORATE_ORG_NODE_IDENTITY_IMMUTABLE/);
  await refused(db, "UPDATE corporate_org_nodes SET entity_type = 'DEPARTMENT' WHERE node_id = 'BU_MARKETPLACE'", [], /CORPORATE_ORG_NODE_IDENTITY_IMMUTABLE/);
  await refused(db, "UPDATE corporate_org_nodes SET parent_node_id = 'BU_SERVICE_NETWORK' WHERE node_id = 'BU_MARKETPLACE'", [], /CORPORATE_ORG_NODE_IDENTITY_IMMUTABLE/);
  await refused(db, "UPDATE corporate_org_nodes SET parent_node_id = 'BU_MARKETPLACE' WHERE node_id = 'CARUP_CORPORATE'", [], /CORPORATE_ORG_NODE_IDENTITY_IMMUTABLE/);
  await refused(db, "DELETE FROM corporate_org_nodes WHERE node_id = 'BU_MARKETPLACE'", [], /CORPORATE_ORG_NODE_DELETE_FORBIDDEN/);
  await db.query("UPDATE corporate_org_nodes SET display_name = 'Marketplace and Vehicle Commerce' WHERE node_id = 'BU_MARKETPLACE'");
  assert.equal((await db.query("SELECT display_name FROM corporate_org_nodes WHERE node_id = 'BU_MARKETPLACE'")).rows[0].display_name, 'Marketplace and Vehicle Commerce');
});

// ═════════════ 4 · memberships ═════════════

test('membership: exactly the four lifecycle states', async () => {
  const db = await database();
  for (const state of ['PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED']) await addMembership(db, { user: `u-${state === 'PENDING' ? 'owner' : state === 'ACTIVE' ? 'tadmin' : state === 'SUSPENDED' ? 'lorg' : 'actor'}`, state });
  for (const bad of ['APPROVED', 'active', 'EXPIRED', 'REVOKED', 'NOT_YET_EFFECTIVE', '']) {
    await assert.rejects(addMembership(db, { user: 'u-hr', node: 'BU_SERVICE_NETWORK', state: bad }), /check constraint/, bad || '(empty)');
  }
});

test('membership: the person and the node must exist; ids are the stable codes and TEXT account ids', async () => {
  const db = await database();
  await assert.rejects(addMembership(db, { user: 'u-ghost' }), /foreign key/);
  await assert.rejects(addMembership(db, { node: 'BU_GHOST' }), /foreign key/);
  await assert.rejects(addMembership(db, { node: 'bu_marketplace' }), /foreign key/, 'node ids are case-exact');
  const id = await addMembership(db);
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('membership: the effective window must be ordered; an open end is allowed', async () => {
  const db = await database();
  await assert.rejects(addMembership(db, { from: iso(HOUR), until: iso(-HOUR) }), /corporate_memberships_window_ordered/);
  await assert.rejects(addMembership(db, { from: iso(HOUR), until: iso(HOUR) }), /corporate_memberships_window_ordered/);
  await addMembership(db, { from: iso(-HOUR), until: iso(HOUR) });
  await addMembership(db, { node: 'BU_SERVICE_NETWORK', from: iso(-HOUR), until: null });
});

test('membership: provenance is required and coherent — SYSTEM has no user, USER has one, and nobody creates their own membership', async () => {
  const db = await database();
  await addMembership(db, { by: 'u-actor' });
  await addMembership(db, { node: 'BU_SERVICE_NETWORK' });
  await assert.rejects(addMembership(db, { node: 'BU_FINANCIAL_SERVICES', by: 'u-hr' }), /corporate_memberships_no_self_provenance/);
  await refused(db, `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, created_by_kind, created_by_user_id, created_reason, updated_by_kind, updated_by_user_id, updated_reason) VALUES ('u-hr','BU_DIASPORA_TRADE','PENDING',now(),'USER',NULL,'r','SYSTEM',NULL,'r')`, [], /created_actor_coherent/);
  await refused(db, `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, created_by_kind, created_by_user_id, created_reason, updated_by_kind, updated_by_user_id, updated_reason) VALUES ('u-hr','BU_DIASPORA_TRADE','PENDING',now(),'SYSTEM','u-actor','r','SYSTEM',NULL,'r')`, [], /created_actor_coherent/);
  await refused(db, `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, created_by_kind, created_by_user_id, created_reason, updated_by_kind, updated_by_user_id, updated_reason) VALUES ('u-hr','BU_DIASPORA_TRADE','PENDING',now(),'SYSTEM',NULL,'r','USER',NULL,'r')`, [], /updated_actor_coherent/);
  await refused(db, `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, created_by_kind, created_by_user_id, created_reason, updated_by_kind, updated_by_user_id, updated_reason) VALUES ('u-hr','BU_DIASPORA_TRADE','PENDING',now(),'ROBOT',NULL,'r','SYSTEM',NULL,'r')`, [], /check constraint/);
  await refused(db, `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, created_by_kind, created_by_user_id, created_reason, updated_by_kind, updated_by_user_id, updated_reason) VALUES ('u-hr','BU_DIASPORA_TRADE','PENDING',now(),'SYSTEM',NULL,'   ','SYSTEM',NULL,'r')`, [], /check constraint/);
  await refused(db, `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, created_by_kind, created_by_user_id, created_reason, updated_by_kind, updated_by_user_id, updated_reason) VALUES ('u-hr','BU_DIASPORA_TRADE','PENDING',now(),'SYSTEM',NULL,'r','SYSTEM',NULL,'')`, [], /check constraint/);
});

test('membership: one LIVE relationship per person per node; an ENDED one never blocks a fresh start; several nodes are allowed', async () => {
  const db = await database();
  const first = await addMembership(db, { node: 'BU_MARKETPLACE', state: 'PENDING' });
  await assert.rejects(addMembership(db, { node: 'BU_MARKETPLACE', state: 'ACTIVE' }), /duplicate key|unique/);
  await assert.rejects(addMembership(db, { node: 'BU_MARKETPLACE', state: 'SUSPENDED' }), /duplicate key|unique/);
  await addMembership(db, { node: 'BU_SERVICE_NETWORK', state: 'ACTIVE' });
  await db.query("UPDATE corporate_memberships SET state = 'ENDED', updated_by_kind = 'SYSTEM', updated_reason = 'left' WHERE membership_id = $1", [first]);
  await addMembership(db, { node: 'BU_MARKETPLACE', state: 'ACTIVE' });
  await addMembership(db, { node: 'BU_MARKETPLACE', state: 'ENDED' });
  assert.equal((await db.query("SELECT count(*)::int c FROM corporate_memberships WHERE user_id = 'u-hr' AND org_node_id = 'BU_MARKETPLACE'")).rows[0].c, 3, 'history retained next to the live row');
});

test('membership lifecycle: the legal transitions, the illegal ones, and ENDED is terminal', async () => {
  const db = await database();
  const move = async (from, to) => {
    const id = await addMembership(db, { user: 'u-hr', node: 'BU_MARKETPLACE', state: from === 'ENDED' ? 'ACTIVE' : from });
    if (from === 'ENDED') await db.query("UPDATE corporate_memberships SET state = 'ENDED', updated_by_kind = 'SYSTEM', updated_reason = 'e' WHERE membership_id = $1", [id]);
    try { await db.query("UPDATE corporate_memberships SET state = $2, updated_by_kind = 'SYSTEM', updated_reason = 'move' WHERE membership_id = $1", [id, to]); return true; } catch (e) { assert.match(e.message, /CORPORATE_MEMBERSHIP_(TRANSITION_NOT_ALLOWED|ENDED_IS_TERMINAL)/); return false; }
    finally { await db.query("UPDATE corporate_memberships SET state = 'ENDED', updated_by_kind = 'SYSTEM', updated_reason = 'cleanup' WHERE membership_id = $1 AND state <> 'ENDED'", [id]).catch(() => {}); }
  };
  const allowed = { PENDING: ['ACTIVE', 'ENDED'], ACTIVE: ['SUSPENDED', 'ENDED'], SUSPENDED: ['ACTIVE', 'ENDED'], ENDED: [] };
  for (const from of Object.keys(allowed)) {
    for (const to of ['PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED']) {
      if (from === to) continue;
      assert.equal(await move(from, to), allowed[from].includes(to), `${from} → ${to}`);
    }
  }
  const id = await addMembership(db, { node: 'BU_FINANCIAL_SERVICES', state: 'ACTIVE' });
  await db.query("UPDATE corporate_memberships SET state = 'ENDED', updated_by_kind = 'SYSTEM', updated_reason = 'left' WHERE membership_id = $1", [id]);
  await refused(db, "UPDATE corporate_memberships SET effective_until = now() + interval '1 day', updated_by_kind = 'SYSTEM', updated_reason = 'extend' WHERE membership_id = $1", [id], /ENDED_IS_TERMINAL/);
  await refused(db, "UPDATE corporate_memberships SET updated_reason = 'edit' WHERE membership_id = $1", [id], /ENDED_IS_TERMINAL/);
});

test('membership: identity and creation provenance are immutable; rows are never deleted; updating records who and when', async () => {
  const db = await database();
  const id = await addMembership(db, { by: 'u-actor' });
  for (const [col, val] of [['user_id', "'u-owner'"], ['org_node_id', "'BU_SERVICE_NETWORK'"], ['membership_id', 'gen_random_uuid()'], ['created_by_kind', "'SYSTEM'"], ['created_by_user_id', "'u-admin'"], ['created_reason', "'rewritten'"], ['created_reference', "'REF-1'"], ['created_at', "now() - interval '1 year'"]]) {
    await refused(db, `UPDATE corporate_memberships SET ${col} = ${val} WHERE membership_id = $1`, [id], /CORPORATE_MEMBERSHIP_IDENTITY_IMMUTABLE|created_actor_coherent|foreign key|no_self/);
  }
  await refused(db, 'DELETE FROM corporate_memberships WHERE membership_id = $1', [id], /CORPORATE_MEMBERSHIP_DELETE_FORBIDDEN/);
  await refused(db, 'DELETE FROM corporate_memberships', [], /CORPORATE_MEMBERSHIP_DELETE_FORBIDDEN/);
  await refused(db, 'DELETE FROM users WHERE id = $1', ['u-hr'], /foreign key|violates/);
  const before = (await db.query('SELECT updated_at FROM corporate_memberships WHERE membership_id = $1', [id])).rows[0].updated_at;
  await db.query('SELECT pg_sleep(0.05)');
  await db.query("UPDATE corporate_memberships SET state = 'SUSPENDED', updated_by_kind = 'USER', updated_by_user_id = 'u-admin', updated_reason = 'review' WHERE membership_id = $1", [id]);
  const after = (await db.query('SELECT updated_at, updated_by_user_id, updated_reason FROM corporate_memberships WHERE membership_id = $1', [id])).rows[0];
  assert.ok(after.updated_at > before, 'updated_at moves');
  assert.equal(after.updated_by_user_id, 'u-admin');
  await refused(db, "UPDATE corporate_memberships SET updated_by_kind = 'USER', updated_by_user_id = 'u-hr', updated_reason = 'self' WHERE membership_id = $1", [id], /no_self_provenance/);
});

// ═════════════ 5 · membership vs everything else, on real rows ═════════════

test('separation: creating, changing and ending memberships leaves users.role, tenant memberships, sessions and legacy organisations untouched', async () => {
  const db = await database();
  const before = await identitySnapshot(db);
  const a = await addMembership(db, { user: 'u-admin', node: 'BU_MARKETPLACE' });
  await addMembership(db, { user: 'u-tadmin', node: 'BU_SERVICE_NETWORK' });
  await addMembership(db, { user: 'u-lorg', node: 'BU_FINANCIAL_SERVICES', state: 'PENDING' });
  await db.query("UPDATE corporate_memberships SET state = 'SUSPENDED', updated_by_kind = 'SYSTEM', updated_reason = 's' WHERE membership_id = $1", [a]);
  await db.query("UPDATE corporate_memberships SET state = 'ENDED', updated_by_kind = 'SYSTEM', updated_reason = 'e' WHERE membership_id = $1", [a]);
  assert.equal(await identitySnapshot(db), before);
});

test('separation: an administrator, a tenant admin and a legacy organisation admin hold NO Corporate membership until a row says so', async () => {
  const db = await database();
  const client = adapter(db);
  for (const id of ['u-admin', 'u-padmin', 'u-sadmin', 'u-tadmin', 'u-lorg', 'u-owner']) {
    const r = await resolveCorporateMembership(client, id);
    assert.equal(r.state, S.NO_MEMBERSHIP, id);
    assert.equal(r.is_active_member, false);
  }
  // …and an ACTIVE row for one person says nothing about the others, whatever namespaces they share.
  await addMembership(db, { user: 'u-owner', node: 'BU_MARKETPLACE' });
  assert.equal((await resolveCorporateMembership(client, 'u-owner')).is_active_member, true);
  for (const id of ['u-admin', 'u-tadmin', 'u-lorg']) assert.equal((await resolveCorporateMembership(client, id)).is_active_member, false, id);
});

// ═════════════ 6 · the shipped resolver on the REAL schema ═════════════

/** The slice of the supabase-js builder the resolver uses, over real SQL, with PostgREST-style timestamps. */
function adapter(db) {
  const ALLOWED = new Set(['corporate_memberships', 'corporate_org_nodes']);
  return {
    from(table) {
      assert.ok(ALLOWED.has(table), `the resolver must read only the Corporate tables, asked for ${table}`);
      const st = { cols: '*', where: [], params: [] };
      const b = {
        select(cols) { assert.match(cols, /^[a-z_, ]+$/); st.cols = cols; return b; },
        eq(col, value) { assert.match(col, /^[a-z_]+$/); st.params.push(value); st.where.push(`${col} = $${st.params.length}`); return b; },
        in(col, values) { assert.match(col, /^[a-z_]+$/); st.params.push(values); st.where.push(`${col} = ANY($${st.params.length}::text[])`); return b; },
        then(resolve, reject) {
          return db.query(`SELECT ${st.cols} FROM ${table}${st.where.length ? ` WHERE ${st.where.join(' AND ')}` : ''}`, st.params)
            .then(({ rows }) => ({ data: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))), error: null }),
              (error) => ({ data: null, error: { message: error.message } }))
            .then(resolve, reject);
        },
      };
      return b;
    },
  };
}

test('resolver on real PostgreSQL: every state, window boundary and node resolves exactly as specified', async () => {
  const db = await database();
  const client = adapter(db);
  const now = new Date();
  const check = async (user, expected, active) => { const r = await resolveCorporateMembership(client, user, { now }); assert.equal(r.state, expected, user); assert.equal(r.is_active_member, active, user); return r; };

  await addMembership(db, { user: 'u-owner', node: 'BU_DIASPORA_TRADE', state: 'ACTIVE', from: iso(-HOUR), until: iso(HOUR) });
  const active = await check('u-owner', S.ACTIVE, true);
  assert.deepEqual(active.active_memberships.map((m) => [m.org_node_id, m.org_node_type]), [['BU_DIASPORA_TRADE', 'BUSINESS_UNIT']]);
  assert.deepEqual(active.capabilities, []);

  await addMembership(db, { user: 'u-tadmin', state: 'PENDING' });
  await check('u-tadmin', S.PENDING, false);
  await addMembership(db, { user: 'u-lorg', state: 'SUSPENDED' });
  await check('u-lorg', S.SUSPENDED, false);
  await addMembership(db, { user: 'u-actor', state: 'ENDED' });
  await check('u-actor', S.ENDED, false);
  await addMembership(db, { user: 'u-admin', state: 'ACTIVE', from: iso(HOUR) });
  await check('u-admin', S.NOT_YET_EFFECTIVE, false);
  await addMembership(db, { user: 'u-padmin', state: 'ACTIVE', from: iso(-2 * HOUR), until: iso(-HOUR) });
  await check('u-padmin', S.EXPIRED, false);
  await check('u-sadmin', S.NO_MEMBERSHIP, false);

  // the boundary instants, against the database's own timestamps
  const id = await addMembership(db, { user: 'u-hr', state: 'ACTIVE', from: iso(-HOUR), until: iso(HOUR) });
  const edge = (await db.query('SELECT effective_from, effective_until FROM corporate_memberships WHERE membership_id = $1', [id])).rows[0];
  assert.equal((await resolveCorporateMembership(client, 'u-hr', { now: new Date(edge.effective_from) })).state, S.ACTIVE, 'start instant inclusive');
  assert.equal((await resolveCorporateMembership(client, 'u-hr', { now: new Date(edge.effective_from.getTime() - 1) })).state, S.NOT_YET_EFFECTIVE);
  assert.equal((await resolveCorporateMembership(client, 'u-hr', { now: new Date(edge.effective_until.getTime() - 1) })).state, S.ACTIVE);
  assert.equal((await resolveCorporateMembership(client, 'u-hr', { now: new Date(edge.effective_until) })).state, S.EXPIRED, 'end instant exclusive');
});

test('resolver on real PostgreSQL: a database that cannot answer is UNAVAILABLE, not "no membership"', async () => {
  const db = await database();
  await addMembership(db, { user: 'u-owner' });
  const r = await resolveCorporateMembership(adapter(db), 'u-owner'); assert.equal(r.state, S.ACTIVE);
  await db.exec('DROP TABLE corporate_memberships');
  const gone = await resolveCorporateMembership(adapter(db), 'u-owner');
  assert.equal(gone.state, S.UNAVAILABLE);
  assert.equal(gone.is_active_member, false);
});

// ═════════════ 7 · Down and back ═════════════

test('Down removes only what Up created and leaves every identity table byte-identical; Up then restores the reference nodes', async () => {
  const db = await database({ migrate: false });
  const before = await identitySnapshot(db);
  await db.exec(UP);
  await addMembership(db, { user: 'u-admin' });
  await db.exec(DOWN);
  const gone = (await db.query(`SELECT to_regclass('public.corporate_memberships') AS a, to_regclass('public.corporate_org_nodes') AS b,
      (SELECT count(*)::int FROM pg_proc WHERE proname IN ('corporate_org_nodes_guard','corporate_memberships_guard')) AS fns`)).rows[0];
  assert.deepEqual([gone.a, gone.b, gone.fns], [null, null, 0]);
  assert.equal(await identitySnapshot(db), before);
  await db.exec(UP);
  assert.equal((await db.query('SELECT count(*)::int c FROM corporate_org_nodes')).rows[0].c, 5);
  assert.equal((await db.query('SELECT count(*)::int c FROM corporate_memberships')).rows[0].c, 0);
  assert.equal(await identitySnapshot(db), before);
});
