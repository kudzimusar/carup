/**
 * CA-K3-AUTH-02-R1 — authoritative, append-only LIFECYCLE CUSTODY for Corporate memberships, proven on real
 * PostgreSQL (PGlite 17) against the actual migration SQL.
 *
 * The proven defect: corporate_memberships keeps only the LATEST change (updated_*), so every transition
 * overwrote the actor, reason and reference of the one before it. The remedy is corporate_membership_events:
 * one immutable row per creation or change, written by a trigger inside the SAME transaction as the change.
 *
 * Proven here:
 *   · creation writes exactly one immutable CREATED event (history does not begin at the first UPDATE);
 *   · every later change appends exactly one event — TRANSITIONED, WINDOW_CHANGED or PROVENANCE_AMENDED — carrying the
 *     actor, reason and reference that came WITH that change; earlier events are never touched, and an earlier
 *     transition's provenance now survives the row being overwritten;
 *   · a refused or failed change appends nothing; a statement that changes nothing writes nothing;
 *   · if the event cannot be written the membership change FAILS with it (fault-injected), and an explicit transaction
 *     rolls the change and its event back together;
 *   · events are append-only for everyone: the backend role cannot INSERT, UPDATE, DELETE or TRUNCATE them; the table
 *     owner still cannot UPDATE, DELETE, TRUNCATE or add an event outside a membership change;
 *   · the chain is gap-free and describes the membership as it now is; CHECK constraints are a second wall behind the guard;
 *   · the history writes nothing to users.role, tenant_users, sessions or legacy organisations, and nothing derives
 *     authority from it — an ACTIVE membership still grants zero capability;
 *   · Up, Up, Down, Up on a populated database leaves a clean Phase-A schema.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { parseMigrationSource } from '../db/migrationParser.js';
import { MEMBERSHIP_STATE as S, resolveCorporateMembership } from '../services/corporate/corporateMembershipService.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');
const FILE = '20261014010000_ca_k3_auth_02_corporate_membership_foundation.sql';
const raw = readFileSync(path.resolve(BACKEND, '../database/migrations', FILE), 'utf8');
const { up: UP, down: DOWN } = parseMigrationSource(raw, FILE);

const open = [];
after(async () => { await Promise.all(open.map((db) => db.close().catch(() => {}))); });

const BOOTSTRAP = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  -- Supabase hands service_role / anon / authenticated ALL on every NEW public table, function and sequence (pg_default_acl,
  -- read from staging). Reproduced here so the privilege assertions are about the platform, not about a bare PostgreSQL.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
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
const identitySnapshot = async (db) => {
  const out = {};
  for (const t of IDENTITY) out[t] = (await db.query(`SELECT * FROM ${t} ORDER BY 1, 2`)).rows;
  return JSON.stringify(out);
};
async function refused(db, sql, params, pattern) {
  try { await db.query(sql, params); } catch (error) {
    assert.match(String(error.message), pattern, `refused for the wrong reason: ${error.message}`);
    return;
  }
  assert.fail(`expected refusal ${pattern}: ${sql}`);
}
async function asBackend(db, fn) {
  await db.exec('SET ROLE service_role');
  try { return await fn(); } finally { await db.exec('RESET ROLE'); }
}
const HOUR = 3600 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
let seq = 0;

async function addMembership(db, { user = 'u-hr', node = 'BU_MARKETPLACE', state = 'ACTIVE', from = iso(-24 * HOUR), until = null, by = null, reason = 'test fixture', reference = null } = {}) {
  const kind = by ? 'USER' : 'SYSTEM';
  const { rows } = await db.query(
    `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, effective_until,
       created_by_kind, created_by_user_id, created_reason, created_reference,
       updated_by_kind, updated_by_user_id, updated_reason, updated_reference)
     VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$6,$7,$8,$9) RETURNING membership_id`,
    [user, node, state, from, until, kind, by, `${reason} #${(seq += 1)}`, reference]);
  return rows[0].membership_id;
}
/** One lifecycle change, always carrying its OWN actor / reason / reference. */
async function change(db, id, { state, kind = 'SYSTEM', by = null, reason, reference = null, from, until } = {}) {
  const sets = ['updated_by_kind = $2', 'updated_by_user_id = $3', 'updated_reason = $4', 'updated_reference = $5'];
  const params = [id, kind, by, reason, reference];
  if (state !== undefined) { params.push(state); sets.push(`state = $${params.length}`); }
  if (from !== undefined) { params.push(from); sets.push(`effective_from = $${params.length}::timestamptz`); }
  if (until !== undefined) { params.push(until); sets.push(`effective_until = $${params.length}::timestamptz`); }
  await db.query(`UPDATE corporate_memberships SET ${sets.join(', ')} WHERE membership_id = $1`, params);
}
const eventsOf = async (db, id) => (await db.query('SELECT * FROM corporate_membership_events WHERE membership_id = $1 ORDER BY event_seq', [id])).rows;
const rowOf = async (db, id) => (await db.query('SELECT * FROM corporate_memberships WHERE membership_id = $1', [id])).rows[0];
const count = async (db, table, where = 'TRUE', params = []) => (await db.query(`SELECT count(*)::int AS c FROM ${table} WHERE ${where}`, params)).rows[0].c;
const time = (value) => (value === null ? null : new Date(value).getTime());

// ═════════════ 1 · creation has authoritative history ═════════════

test('creation: every membership INSERT writes exactly one immutable CREATED event — whatever its initial state', async () => {
  const db = await database();
  const cases = [
    { user: 'u-hr', state: 'PENDING', by: 'u-actor', reason: 'onboarding request', reference: 'HR-1001' },
    { user: 'u-owner', state: 'ACTIVE', by: null, reason: 'controlled procedure', reference: null },
    { user: 'u-tadmin', state: 'SUSPENDED', by: 'u-admin', reason: 'imported suspended', reference: 'IMP-7' },
    { user: 'u-lorg', state: 'ENDED', by: null, reason: 'imported ended', reference: 'IMP-8', until: iso(-HOUR), from: iso(-48 * HOUR) },
  ];
  for (const c of cases) {
    const id = await addMembership(db, c);
    const row = await rowOf(db, id);
    const events = await eventsOf(db, id);
    assert.equal(events.length, 1, `${c.state}: exactly one event`);
    const [e] = events;
    assert.match(e.event_id, /^[0-9a-f-]{36}$/);
    assert.deepEqual([e.event_seq, e.event_type, e.from_state, e.to_state], [1, 'CREATED', null, c.state], c.state);
    assert.deepEqual([e.prior_effective_from, e.prior_effective_until], [null, null]);
    assert.deepEqual([time(e.effective_from), time(e.effective_until)], [time(row.effective_from), time(row.effective_until)]);
    assert.deepEqual([e.membership_id, e.user_id, e.org_node_id], [id, c.user, 'BU_MARKETPLACE']);
    assert.deepEqual([e.actor_kind, e.actor_user_id, e.reason, e.reference], [c.by ? 'USER' : 'SYSTEM', c.by, row.created_reason, c.reference]);
    assert.equal(time(e.occurred_at), time(row.created_at), 'the event timestamp is the database transaction time of the creation');
  }
  assert.equal(await count(db, 'corporate_membership_events'), 4, 'one event per membership — none for the seeded organisation nodes');
});

test('creation: history exists from the INSERT itself — a membership is never first seen at its first UPDATE', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'PENDING' });
  assert.equal((await eventsOf(db, id)).length, 1);
  assert.equal((await rowOf(db, id)).state, 'PENDING');
  await asBackend(db, async () => {
    await refused(db, `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, created_by_kind, created_reason, updated_by_kind, updated_reason)
                       VALUES ('u-owner','BU_SERVICE_NETWORK','PENDING',now(),'SYSTEM','runtime write','SYSTEM','runtime write')`, [], /permission denied/);
  });
  assert.equal((await db.query("SELECT count(*)::int AS c FROM corporate_memberships WHERE user_id = 'u-owner' AND org_node_id = 'BU_SERVICE_NETWORK'")).rows[0].c, 0, 'Phase-A backend cannot create membership truth');
});

// ═════════════ 2 · every change appends exactly one event; earlier events never change ═════════════

test('lifecycle: PENDING → ACTIVE → SUSPENDED → ACTIVE → ENDED appends one event each, carrying the actor/reason/reference of THAT change', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'PENDING', by: 'u-actor', reason: 'onboarding request', reference: 'HR-1' });
  const steps = [
    { state: 'ACTIVE', kind: 'USER', by: 'u-admin', reason: 'approved after review', reference: 'CHG-2', was: 'PENDING' },
    { state: 'SUSPENDED', kind: 'SYSTEM', by: null, reason: 'access review opened', reference: null, was: 'ACTIVE' },
    { state: 'ACTIVE', kind: 'USER', by: 'u-actor', reason: 'review cleared', reference: 'CHG-4', was: 'SUSPENDED' },
    { state: 'ENDED', kind: 'SYSTEM', by: null, reason: 'leaver', reference: 'HR-9', was: 'ACTIVE' },
  ];
  const snapshots = [JSON.stringify(await eventsOf(db, id))];
  for (const [i, step] of steps.entries()) {
    const { was, ...changeArgs } = step;
    await change(db, id, changeArgs);
    const events = await eventsOf(db, id);
    const row = await rowOf(db, id);
    assert.equal(events.length, i + 2, `after ${step.state}: exactly one more event`);
    assert.deepEqual(events.map((e) => e.event_seq), Array.from({ length: i + 2 }, (_, k) => k + 1), 'gap-free sequence');
    const e = events.at(-1);
    assert.deepEqual([e.event_type, e.from_state, e.to_state], ['TRANSITIONED', step.was, step.state]);
    assert.deepEqual([e.actor_kind, e.actor_user_id, e.reason, e.reference], [step.kind, step.by, step.reason, step.reference], 'the provenance of THIS change');
    assert.deepEqual([e.prior_effective_from === null, e.prior_effective_until], [false, null]);
    // The row's change provenance is, at every moment, exactly the latest event's.
    assert.deepEqual([row.updated_by_kind, row.updated_by_user_id, row.updated_reason, row.updated_reference], [e.actor_kind, e.actor_user_id, e.reason, e.reference]);
    assert.equal(time(row.updated_at), time(e.occurred_at), 'row.updated_at and event.occurred_at are the same transaction instant');
    assert.equal(row.state, e.to_state);
    snapshots.push(JSON.stringify(events));
  }
  assert.equal((await rowOf(db, id)).state, 'ENDED');
  // Prior events remain byte/field-identical after every later transition.
  const final = JSON.parse(snapshots.at(-1));
  for (const [k, snap] of snapshots.entries()) assert.deepEqual(JSON.parse(snap), final.slice(0, k + 1), `events 1..${k + 1} unchanged by everything after`);
});

test('the proven defect is fixed: an earlier transition\'s provenance survives after the row has been overwritten by later ones', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'PENDING', by: 'u-actor', reason: 'onboarding request', reference: 'HR-1' });
  await change(db, id, { state: 'ACTIVE', kind: 'USER', by: 'u-admin', reason: 'approved after review', reference: 'CHG-2' });
  await change(db, id, { state: 'SUSPENDED', kind: 'SYSTEM', reason: 'access review opened' });
  await change(db, id, { state: 'ENDED', kind: 'SYSTEM', reason: 'leaver', reference: 'HR-9' });
  const row = await rowOf(db, id);
  assert.deepEqual([row.updated_by_kind, row.updated_reason, row.updated_reference], ['SYSTEM', 'leaver', 'HR-9'], 'the row can only ever show the LATEST change');
  const history = (await eventsOf(db, id)).map((e) => [e.event_seq, e.to_state, e.actor_kind, e.actor_user_id, e.reason, e.reference]);
  assert.deepEqual(history, [
    [1, 'PENDING', 'USER', 'u-actor', row.created_reason, 'HR-1'],
    [2, 'ACTIVE', 'USER', 'u-admin', 'approved after review', 'CHG-2'],
    [3, 'SUSPENDED', 'SYSTEM', null, 'access review opened', null],
    [4, 'ENDED', 'SYSTEM', null, 'leaver', 'HR-9'],
  ], 'who approved the activation, and why, is still recorded');
});

// ═════════════ 3 · window and provenance changes are custody too; no-ops write nothing ═════════════

test('a change to the effective period appends WINDOW_CHANGED with the prior and the new values', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'ACTIVE', from: iso(-48 * HOUR), until: null });
  const before = await rowOf(db, id);
  const newUntil = iso(30 * 24 * HOUR);
  await change(db, id, { until: newUntil, kind: 'USER', by: 'u-actor', reason: 'fixed-term contract', reference: 'CON-5' });
  let e = (await eventsOf(db, id)).at(-1);
  assert.deepEqual([e.event_seq, e.event_type, e.from_state, e.to_state], [2, 'WINDOW_CHANGED', 'ACTIVE', 'ACTIVE']);
  assert.deepEqual([time(e.prior_effective_from), e.prior_effective_until, time(e.effective_from), time(e.effective_until)], [time(before.effective_from), null, time(before.effective_from), time(newUntil)]);
  assert.deepEqual([e.actor_user_id, e.reason, e.reference], ['u-actor', 'fixed-term contract', 'CON-5']);
  // and again: the prior values are the previous event's resulting values
  const moved = iso(40 * 24 * HOUR);
  await change(db, id, { until: moved, kind: 'SYSTEM', reason: 'contract extended', reference: 'CON-6' });
  e = (await eventsOf(db, id)).at(-1);
  assert.deepEqual([e.event_seq, e.event_type, time(e.prior_effective_until), time(e.effective_until)], [3, 'WINDOW_CHANGED', time(newUntil), time(moved)]);
});

test('a state change and a window change in ONE statement is one TRANSITIONED event that captures both windows', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'PENDING', from: iso(48 * HOUR), until: null });
  const before = await rowOf(db, id);
  const newFrom = iso(-HOUR); const newUntil = iso(90 * 24 * HOUR);
  await change(db, id, { state: 'ACTIVE', from: newFrom, until: newUntil, kind: 'SYSTEM', reason: 'activated early' });
  const events = await eventsOf(db, id);
  assert.equal(events.length, 2);
  const e = events[1];
  assert.deepEqual([e.event_type, e.from_state, e.to_state], ['TRANSITIONED', 'PENDING', 'ACTIVE']);
  assert.deepEqual([time(e.prior_effective_from), e.prior_effective_until, time(e.effective_from), time(e.effective_until)], [time(before.effective_from), null, time(newFrom), time(newUntil)]);
});

test('a provenance-only change appends PROVENANCE_AMENDED: nothing about the state or window moves, and the old claim stays on the old event', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'ACTIVE', by: 'u-actor', reason: 'initial grant', reference: 'REF-1' });
  await change(db, id, { kind: 'USER', by: 'u-admin', reason: 'corrected reason text', reference: 'REF-1B' });
  const events = await eventsOf(db, id);
  assert.equal(events.length, 2);
  const [created, amended] = events;
  assert.deepEqual([amended.event_type, amended.from_state, amended.to_state], ['PROVENANCE_AMENDED', 'ACTIVE', 'ACTIVE']);
  assert.deepEqual([time(amended.prior_effective_from), amended.prior_effective_until], [time(amended.effective_from), amended.effective_until]);
  assert.deepEqual([amended.actor_user_id, amended.reason, amended.reference], ['u-admin', 'corrected reason text', 'REF-1B']);
  assert.deepEqual([created.actor_user_id, created.reference], ['u-actor', 'REF-1'], 'the original claim is untouched');
  assert.equal((await rowOf(db, id)).state, 'ACTIVE');
});

test('a statement that changes nothing writes no event and leaves the row — updated_at included — exactly as it was', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'ACTIVE', by: 'u-actor', reference: 'REF' });
  await db.query('SELECT pg_sleep(0.05)');
  const rowBefore = JSON.stringify(await rowOf(db, id));
  const eventsBefore = JSON.stringify(await eventsOf(db, id));
  await db.query("UPDATE corporate_memberships SET state = state WHERE membership_id = $1", [id]);
  await db.query("UPDATE corporate_memberships SET updated_reason = updated_reason, effective_until = effective_until WHERE membership_id = $1", [id]);
  await db.query("UPDATE corporate_memberships SET updated_at = '2001-01-01T00:00:00Z' WHERE membership_id = $1", [id]);
  await db.query("UPDATE corporate_memberships SET state = 'ACTIVE' WHERE membership_id = $1 AND FALSE", [id]);
  assert.equal(JSON.stringify(await rowOf(db, id)), rowBefore, 'row byte-identical, including updated_at');
  assert.equal(JSON.stringify(await eventsOf(db, id)), eventsBefore);
});

test('updated_at and occurred_at cannot be forged: a real change takes the database transaction time whatever the caller writes', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'ACTIVE' });
  await db.query(`UPDATE corporate_memberships SET state = 'SUSPENDED', updated_by_kind = 'SYSTEM', updated_reason = 'forged clock', updated_at = '2001-01-01T00:00:00Z' WHERE membership_id = $1`, [id]);
  const row = await rowOf(db, id); const e = (await eventsOf(db, id)).at(-1);
  assert.ok(time(row.updated_at) > time('2025-01-01'), 'the caller\'s timestamp was ignored');
  assert.equal(time(row.updated_at), time(e.occurred_at));
});

test('an UPSERT that updates an existing membership appends a change event — never a second CREATED', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'ACTIVE' });
  const row = await rowOf(db, id);
  await db.query(
    `INSERT INTO corporate_memberships (membership_id, user_id, org_node_id, state, effective_from, created_by_kind, created_reason, updated_by_kind, updated_reason)
     VALUES ($1, $2, $3, 'ACTIVE', $4, 'SYSTEM', 'x', 'SYSTEM', 'x')
     ON CONFLICT (membership_id) DO UPDATE SET state = 'SUSPENDED', updated_by_kind = 'SYSTEM', updated_reason = 'upsert review'`,
    [id, row.user_id, row.org_node_id, row.effective_from]);
  const events = await eventsOf(db, id);
  assert.deepEqual(events.map((e) => [e.event_seq, e.event_type, e.to_state]), [[1, 'CREATED', 'ACTIVE'], [2, 'TRANSITIONED', 'SUSPENDED']]);
});

// ═════════════ 4 · refused changes append nothing ═════════════

test('every refused change appends no event and leaves the row byte-identical', async () => {
  const db = await database();
  const make = async (state, user, node = 'BU_MARKETPLACE') => {
    const id = await addMembership(db, { user, node, state: state === 'ENDED' ? 'ACTIVE' : state, by: 'u-actor' });
    if (state === 'ENDED') await change(db, id, { state: 'ENDED', reason: 'left' });
    return id;
  };
  const pending = await make('PENDING', 'u-hr'); const active = await make('ACTIVE', 'u-owner'); const suspended = await make('SUSPENDED', 'u-tadmin'); const ended = await make('ENDED', 'u-lorg');
  const attempts = [
    // illegal transitions
    [pending, "state = 'SUSPENDED'", /TRANSITION_NOT_ALLOWED/], [active, "state = 'PENDING'", /TRANSITION_NOT_ALLOWED/], [suspended, "state = 'PENDING'", /TRANSITION_NOT_ALLOWED/],
    // ENDED is terminal, for every kind of edit
    [ended, "state = 'ACTIVE'", /ENDED_IS_TERMINAL/], [ended, "effective_until = now() + interval '9 days'", /ENDED_IS_TERMINAL/],
    [ended, "updated_reason = 'late edit'", /ENDED_IS_TERMINAL/], [ended, "updated_reference = 'LATE'", /ENDED_IS_TERMINAL/], [ended, 'updated_at = now()', /ENDED_IS_TERMINAL/],
    // identity and creation provenance are immutable
    [active, "user_id = 'u-hr'", /IDENTITY_IMMUTABLE/], [active, "org_node_id = 'BU_SERVICE_NETWORK'", /IDENTITY_IMMUTABLE/], [active, 'membership_id = gen_random_uuid()', /IDENTITY_IMMUTABLE/],
    [active, "created_reason = 'rewritten'", /IDENTITY_IMMUTABLE/], [active, "created_reference = 'REF-X'", /IDENTITY_IMMUTABLE/], [active, "created_at = now() - interval '1 year'", /IDENTITY_IMMUTABLE/],
    // constraints
    [active, "state = 'EXPIRED'", /TRANSITION_NOT_ALLOWED/], [active, "state = 'SUSPENDED', updated_by_kind = 'USER', updated_by_user_id = 'u-owner'", /no_self_provenance/],
    [active, "state = 'SUSPENDED', updated_reason = '   '", /corporate_memberships_updated_reason_check/], [active, "state = 'SUSPENDED', updated_by_kind = 'ROBOT', updated_by_user_id = NULL", /corporate_memberships_updated_by_kind_check/], [active, "state = 'SUSPENDED', updated_by_kind = 'USER', updated_by_user_id = NULL", /updated_actor_coherent/],
    [active, "state = 'SUSPENDED', updated_by_kind = 'SYSTEM', updated_by_user_id = 'u-actor'", /updated_actor_coherent/], [active, 'effective_until = effective_from', /corporate_memberships_window_ordered/],
  ];
  assert.ok(attempts.length >= 20);
  for (const [id, assignment, pattern] of attempts) {
    const rowBefore = JSON.stringify(await rowOf(db, id)); const eventsBefore = JSON.stringify(await eventsOf(db, id)); const total = await count(db, 'corporate_membership_events');
    await refused(db, `UPDATE corporate_memberships SET ${assignment} WHERE membership_id = $1`, [id], pattern);
    assert.equal(JSON.stringify(await rowOf(db, id)), rowBefore, `row unchanged: ${assignment}`);
    assert.equal(JSON.stringify(await eventsOf(db, id)), eventsBefore, `no event: ${assignment}`);
    assert.equal(await count(db, 'corporate_membership_events'), total);
  }
  const total = await count(db, 'corporate_membership_events');
  await refused(db, 'DELETE FROM corporate_memberships WHERE membership_id = $1', [active], /DELETE_FORBIDDEN/);
  await refused(db, 'DELETE FROM users WHERE id = $1', ['u-owner'], /foreign key|violates/);
  assert.equal(await count(db, 'corporate_membership_events'), total);
});

// ═════════════ 5 · failed event custody fails the membership change ═════════════

test('if the event cannot be written, the membership INSERT and UPDATE FAIL with it (fault-injected) and nothing is left behind', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'ACTIVE' });
  const rowBefore = JSON.stringify(await rowOf(db, id)); const eventsBefore = JSON.stringify(await eventsOf(db, id));
  const memberships = await count(db, 'corporate_memberships'); const events = await count(db, 'corporate_membership_events');

  await db.exec('ALTER TABLE corporate_membership_events ADD CONSTRAINT zz_custody_blocked CHECK (FALSE) NOT VALID');
  try {
    await refused(db, `INSERT INTO corporate_memberships (user_id, org_node_id, state, effective_from, created_by_kind, created_reason, updated_by_kind, updated_reason)
                       VALUES ('u-owner','BU_SERVICE_NETWORK','ACTIVE', now(), 'SYSTEM','x','SYSTEM','x')`, [], /zz_custody_blocked/);
    await refused(db, `UPDATE corporate_memberships SET state = 'SUSPENDED', updated_by_kind = 'SYSTEM', updated_reason = 'cannot be recorded' WHERE membership_id = $1`, [id], /zz_custody_blocked/);
    await refused(db, `UPDATE corporate_memberships SET effective_until = now() + interval '1 day', updated_by_kind = 'SYSTEM', updated_reason = 'cannot be recorded' WHERE membership_id = $1`, [id], /zz_custody_blocked/);
    assert.equal(await count(db, 'corporate_memberships'), memberships, 'no half-created membership');
    assert.equal(await count(db, 'corporate_membership_events'), events);
    assert.equal(JSON.stringify(await rowOf(db, id)), rowBefore, 'the state did not change');
    assert.equal(JSON.stringify(await eventsOf(db, id)), eventsBefore);
  } finally {
    await db.exec('ALTER TABLE corporate_membership_events DROP CONSTRAINT zz_custody_blocked');
  }
  await change(db, id, { state: 'SUSPENDED', reason: 'now it can be recorded' });
  assert.equal((await rowOf(db, id)).state, 'SUSPENDED');
  assert.equal((await eventsOf(db, id)).length, 2);
});

test('the event writer has no error handler: a failure inside it can never be swallowed into a "successful" change', () => {
  const sql = raw.split('-- +migrate Down')[0].replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(sql, /\bEXCEPTION\s+WHEN\b/i);
  assert.equal([...sql.matchAll(/\bSECURITY\s+DEFINER\b/gi)].length, 1, 'exactly one definer function: the event writer');
});

test('atomic in a transaction: a change and its event commit or roll back together, and a later failure undoes an earlier change\'s event', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'ACTIVE' });
  const before = { events: await count(db, 'corporate_membership_events'), memberships: await count(db, 'corporate_memberships'), row: JSON.stringify(await rowOf(db, id)) };

  await db.exec('BEGIN');
  const inTx = await addMembership(db, { user: 'u-owner', node: 'BU_SERVICE_NETWORK', state: 'PENDING' });
  await change(db, inTx, { state: 'ACTIVE', reason: 'in the same transaction' });
  await change(db, id, { state: 'SUSPENDED', reason: 'in the same transaction' });
  assert.equal((await eventsOf(db, inTx)).length, 2, 'visible inside the transaction');
  assert.equal(await count(db, 'corporate_membership_events'), before.events + 3);
  await db.exec('ROLLBACK');
  assert.equal(await count(db, 'corporate_membership_events'), before.events, 'rolled back together');
  assert.equal(await count(db, 'corporate_memberships'), before.memberships);
  assert.equal(JSON.stringify(await rowOf(db, id)), before.row);

  await db.exec('BEGIN');
  await change(db, id, { state: 'SUSPENDED', reason: 'first change in the transaction' });
  await assert.rejects(change(db, id, { state: 'PENDING', reason: 'illegal second change' }), /TRANSITION_NOT_ALLOWED/);
  await db.exec('ROLLBACK');
  assert.equal(await count(db, 'corporate_membership_events'), before.events, 'the first change\'s event is gone with it');
  assert.equal(JSON.stringify(await rowOf(db, id)), before.row);

  await db.exec('BEGIN');
  await change(db, id, { state: 'SUSPENDED', reason: 'committed' });
  await db.exec('COMMIT');
  assert.equal(await count(db, 'corporate_membership_events'), before.events + 1);
  assert.equal((await rowOf(db, id)).state, 'SUSPENDED');
});

// ═════════════ 6 · events are append-only, and exist only as the consequence of a membership change ═════════════

test('append-only: the backend role can read events but cannot INSERT, UPDATE, DELETE or TRUNCATE them', async () => {
  const db = await database();
  const id = await addMembership(db);
  await asBackend(db, async () => {
    assert.equal((await eventsOf(db, id)).length, 1, 'SELECT is allowed');
    const sample = "'" + id + "'";
    await refused(db, `INSERT INTO corporate_membership_events (membership_id, event_seq, user_id, org_node_id, event_type, to_state, effective_from, actor_kind, reason) VALUES (${sample}, 2, 'u-hr', 'BU_MARKETPLACE', 'PROVENANCE_AMENDED', 'ACTIVE', now(), 'SYSTEM', 'forged')`, [], /permission denied/);
    await refused(db, "UPDATE corporate_membership_events SET reason = 'rewritten'", [], /permission denied/);
    await refused(db, 'DELETE FROM corporate_membership_events', [], /permission denied/);
    await refused(db, 'TRUNCATE corporate_membership_events', [], /permission denied/);
    await refused(db, 'TRUNCATE corporate_membership_events, corporate_memberships CASCADE', [], /permission denied/);
  });
  assert.equal((await eventsOf(db, id)).length, 1);
});

test('append-only: even the table OWNER cannot UPDATE, DELETE or TRUNCATE history, nor add an event outside a membership change', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'PENDING' });
  await change(db, id, { state: 'ACTIVE', reason: 'approved' });
  const snapshot = JSON.stringify(await eventsOf(db, id));
  await refused(db, "UPDATE corporate_membership_events SET reason = 'rewritten' WHERE membership_id = $1", [id], /CORPORATE_MEMBERSHIP_EVENT_APPEND_ONLY/);
  await refused(db, 'UPDATE corporate_membership_events SET event_seq = event_seq + 10', [], /CORPORATE_MEMBERSHIP_EVENT_APPEND_ONLY/);
  await refused(db, 'DELETE FROM corporate_membership_events WHERE membership_id = $1', [id], /CORPORATE_MEMBERSHIP_EVENT_APPEND_ONLY/);
  await refused(db, 'DELETE FROM corporate_membership_events', [], /CORPORATE_MEMBERSHIP_EVENT_APPEND_ONLY/);
  await refused(db, 'TRUNCATE corporate_membership_events', [], /CORPORATE_CUSTODY_TRUNCATE_FORBIDDEN/);
  await refused(db, 'TRUNCATE corporate_memberships CASCADE', [], /CORPORATE_CUSTODY_TRUNCATE_FORBIDDEN/);
  await refused(db, 'TRUNCATE corporate_org_nodes CASCADE', [], /CORPORATE_CUSTODY_TRUNCATE_FORBIDDEN/);
  // A perfectly CONSISTENT next event is still refused when it is not the consequence of a membership change.
  await refused(db, `INSERT INTO corporate_membership_events (membership_id, event_seq, user_id, org_node_id, event_type, from_state, to_state,
      prior_effective_from, effective_from, actor_kind, reason)
    SELECT m.membership_id, 3, m.user_id, m.org_node_id, 'PROVENANCE_AMENDED', m.state, m.state, m.effective_from, m.effective_from, 'SYSTEM', 'forged'
      FROM corporate_memberships m WHERE m.membership_id = $1`, [id], /CORPORATE_MEMBERSHIP_EVENT_ONLY_VIA_MEMBERSHIP_CHANGE/);
  assert.equal(JSON.stringify(await eventsOf(db, id)), snapshot, 'history is exactly as it was');
});

/** Test-only harness: runs an arbitrary INSERT from inside a trigger, so the chain checks can be reached on their own. */
async function installForger(db) {
  await db.exec(`
    CREATE TABLE zz_forge (payload TEXT);
    CREATE FUNCTION zz_forge_fn() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN EXECUTE NEW.payload; RETURN NEW; END $fn$;
    CREATE TRIGGER zz_forge_trg AFTER INSERT ON zz_forge FOR EACH ROW EXECUTE FUNCTION zz_forge_fn();`);
}
const lit = (v) => (v === null || v === undefined ? 'NULL' : v instanceof Date ? `'${v.toISOString()}'::timestamptz` : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const COLUMNS = ['membership_id', 'event_seq', 'user_id', 'org_node_id', 'event_type', 'from_state', 'to_state', 'prior_effective_from', 'prior_effective_until', 'effective_from', 'effective_until', 'actor_kind', 'actor_user_id', 'reason', 'reference'];
const insertSql = (e) => `INSERT INTO corporate_membership_events (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((c) => lit(e[c])).join(', ')})`;
const forge = (db, event) => db.query('INSERT INTO zz_forge (payload) VALUES ($1)', [insertSql(event)]);
const nextOf = (membership, last, overrides = {}) => ({
  membership_id: membership.membership_id, event_seq: last.event_seq + 1, user_id: membership.user_id, org_node_id: membership.org_node_id,
  event_type: 'PROVENANCE_AMENDED', from_state: last.to_state, to_state: membership.state,
  prior_effective_from: last.effective_from, prior_effective_until: last.effective_until, effective_from: membership.effective_from, effective_until: membership.effective_until,
  actor_kind: 'SYSTEM', actor_user_id: null, reason: 'forged', reference: null, ...overrides,
});

test('chain integrity: an event must describe the membership AS IT NOW IS and extend its chain by exactly one (reached from inside a trigger)', async () => {
  const db = await database();
  await installForger(db);
  const id = await addMembership(db, { state: 'PENDING' });
  await change(db, id, { state: 'ACTIVE', reason: 'approved' });
  const membership = await rowOf(db, id);
  const last = (await eventsOf(db, id)).at(-1);
  const total = await count(db, 'corporate_membership_events');
  const cases = [
    ['a gap in the sequence', { event_seq: last.event_seq + 2 }, /CHAIN_BROKEN/],
    ['a repeated sequence number', { event_seq: last.event_seq }, /CHAIN_BROKEN/],
    ['a second CREATED event', { event_type: 'CREATED', event_seq: 1, from_state: null, prior_effective_from: null, prior_effective_until: null }, /CHAIN_BROKEN/],
    ['a from_state that is not the previous to_state', { from_state: 'PENDING' }, /CHAIN_BROKEN/],
    ['a prior window that is not the previous window', { prior_effective_from: new Date(Date.now() - 999 * HOUR) }, /CHAIN_BROKEN/],
    ['a prior end that is not the previous end', { prior_effective_until: new Date(Date.now() + 999 * HOUR) }, /CHAIN_BROKEN/],
    ['a resulting state that is not the membership\'s state', { event_type: 'TRANSITIONED', from_state: 'ACTIVE', to_state: 'SUSPENDED' }, /NOT_CURRENT/],
    ['a resulting window that is not the membership\'s window', { effective_until: new Date(Date.now() + 5 * HOUR) }, /NOT_CURRENT/],
    ['another person\'s user_id', { user_id: 'u-owner' }, /foreign key/],
    ['another node', { org_node_id: 'BU_SERVICE_NETWORK' }, /foreign key/],
    ['a membership that does not exist', { membership_id: '00000000-0000-0000-0000-000000000000' }, /MEMBERSHIP_NOT_FOUND|foreign key/],
    ['the member as their own actor', { actor_kind: 'USER', actor_user_id: membership.user_id }, /no_self_actor/],
    ['a USER actor with no user', { actor_kind: 'USER', actor_user_id: null }, /actor_coherent/],
    ['a SYSTEM actor naming a user', { actor_kind: 'SYSTEM', actor_user_id: 'u-actor' }, /actor_coherent/],
    ['a blank reason', { reason: '   ' }, /check constraint/],
    ['an unknown event type', { event_type: 'DELETED' }, /check constraint/],
    ['a TRANSITIONED event that moves nowhere', { event_type: 'TRANSITIONED' }, /legal_transition|transition_shape|check constraint/],
  ];
  for (const [label, overrides, pattern] of cases) {
    await assert.rejects(forge(db, nextOf(membership, last, overrides)), pattern, label);
    assert.equal(await count(db, 'corporate_membership_events'), total, `${label}: nothing was appended`);
  }
  // CONTROL: the same harness DOES add a consistent event — so the refusals above are the guards' doing, not the harness's.
  await forge(db, nextOf(membership, last));
  assert.equal(await count(db, 'corporate_membership_events'), total + 1);
});

test('a membership that somehow lacks its creation event cannot be changed (fail closed), and a non-CREATED first event is refused', async () => {
  const db = await database();
  await installForger(db);
  await db.exec('ALTER TABLE corporate_memberships DISABLE TRIGGER corporate_memberships_record_event');
  const id = await addMembership(db, { state: 'PENDING' }); // tampering: inserted with the event writer switched off
  await db.exec('ALTER TABLE corporate_memberships ENABLE TRIGGER corporate_memberships_record_event');
  assert.equal((await eventsOf(db, id)).length, 0);
  const membership = await rowOf(db, id);
  await assert.rejects(forge(db, nextOf(membership, { event_seq: 1, to_state: 'PENDING', effective_from: membership.effective_from, effective_until: null })), /CHAIN_BROKEN/);
  await assert.rejects(change(db, id, { state: 'ACTIVE', reason: 'cannot be recorded without a creation event' }), /CHAIN_BROKEN/);
  assert.equal((await rowOf(db, id)).state, 'PENDING', 'the change did not happen');
  assert.equal((await eventsOf(db, id)).length, 0);
});

test('the CHECK constraints are a second wall: with the guard switched off they still refuse malformed events', async () => {
  const db = await database();
  const id = await addMembership(db, { state: 'ACTIVE' });
  const m = await rowOf(db, id); const last = (await eventsOf(db, id)).at(-1);
  await db.exec('ALTER TABLE corporate_membership_events DISABLE TRIGGER corporate_membership_events_guard');
  try {
    const bad = [
      ['CREATED with a prior state', { event_type: 'CREATED', event_seq: 1, from_state: 'PENDING', prior_effective_from: null, prior_effective_until: null }, /created_shape/],
      ['CREATED that is not first', { event_type: 'CREATED', event_seq: 2, from_state: null, prior_effective_from: null, prior_effective_until: null }, /created_shape/],
      ['a change that is first', { event_seq: 1 }, /change_shape/],
      ['a change with no prior state', { from_state: null }, /change_shape/],
      ['a change with no prior window', { event_type: 'WINDOW_CHANGED', prior_effective_from: null }, /change_shape/],
      ['TRANSITIONED from ACTIVE to PENDING', { event_type: 'TRANSITIONED', from_state: 'ACTIVE', to_state: 'PENDING' }, /legal_transition/],
      ['TRANSITIONED out of ENDED', { event_type: 'TRANSITIONED', from_state: 'ENDED', to_state: 'ACTIVE' }, /legal_transition/],
      ['TRANSITIONED PENDING to SUSPENDED', { event_type: 'TRANSITIONED', from_state: 'PENDING', to_state: 'SUSPENDED' }, /legal_transition/],
      ['WINDOW_CHANGED that changes no window', { event_type: 'WINDOW_CHANGED' }, /window_change_shape/],
      ['WINDOW_CHANGED that changes the state', { event_type: 'WINDOW_CHANGED', to_state: 'SUSPENDED', effective_until: new Date(Date.now() + HOUR) }, /window_change_shape/],
      ['PROVENANCE_AMENDED that changes the window', { prior_effective_until: new Date(Date.now() + HOUR) }, /amendment_shape/],
      ['an unordered window', { event_type: 'WINDOW_CHANGED', effective_until: new Date(m.effective_from.getTime() - HOUR) }, /window_ordered/],
      ['an unknown state', { to_state: 'EXPIRED' }, /check constraint/],
    ];
    for (const [label, overrides, pattern] of bad) {
      await assert.rejects(db.query(insertSql(nextOf(m, last, overrides))), pattern, label);
    }
    assert.equal((await eventsOf(db, id)).length, 1);
  } finally {
    await db.exec('ALTER TABLE corporate_membership_events ENABLE TRIGGER corporate_membership_events_guard');
  }
  await refused(db, insertSql(nextOf(m, last)), [], /ONLY_VIA_MEMBERSHIP_CHANGE/);
});

// ═════════════ 7 · schema, privileges, hygiene ═════════════

test('schema: the event table carries history only — and no permission, capability, role, scope or grant column', async () => {
  const db = await database();
  const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'corporate_membership_events' ORDER BY column_name")).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ['actor_kind', 'actor_user_id', 'effective_from', 'effective_until', 'event_id', 'event_seq', 'event_type', 'from_state', 'membership_id', 'occurred_at', 'org_node_id', 'prior_effective_from', 'prior_effective_until', 'reason', 'reference', 'to_state', 'user_id']);
  for (const c of cols) assert.doesNotMatch(c, /permission|capabilit|role|scope|grant|privilege|admin/i, c);
  const constraints = (await db.query("SELECT conname FROM pg_constraint WHERE conrelid = 'public.corporate_membership_events'::regclass")).rows.map((r) => r.conname);
  for (const name of ['corporate_membership_events_membership_fk', 'corporate_membership_events_one_per_seq', 'corporate_membership_events_window_ordered', 'corporate_membership_events_actor_coherent',
    'corporate_membership_events_no_self_actor', 'corporate_membership_events_created_shape', 'corporate_membership_events_change_shape', 'corporate_membership_events_legal_transition',
    'corporate_membership_events_window_change_shape', 'corporate_membership_events_amendment_shape']) assert.ok(constraints.includes(name), name);
  assert.ok((await db.query("SELECT 1 FROM pg_constraint WHERE conname = 'corporate_memberships_event_anchor'")).rows.length === 1);
});

test('privileges: a full role × table × privilege matrix — Phase-A backend is SELECT-only everywhere; clients hold nothing', async () => {
  const db = await database();
  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  const expected = {
    corporate_membership_events: { service_role: ['SELECT'] },
    corporate_memberships: { service_role: ['SELECT'] },
    corporate_org_nodes: { service_role: ['SELECT'] },
  };
  for (const [table, byRole] of Object.entries(expected)) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const granted = [];
      for (const privilege of privileges) if ((await db.query(`SELECT has_table_privilege('${role}', 'public.${table}', '${privilege}') AS ok`)).rows[0].ok) granted.push(privilege);
      assert.deepEqual(granted, byRole[role] ?? [], `${role} on ${table}`);
    }
  }
});

test('hygiene: exactly one SECURITY DEFINER function (the event writer), every Corporate function pins its search_path, and the trigger inventory is exactly as designed', async () => {
  const db = await database();
  const fns = (await db.query("SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname LIKE 'corporate\\_%' ORDER BY proname")).rows;
  assert.deepEqual(fns.map((f) => f.proname), ['corporate_custody_truncate_guard', 'corporate_membership_events_guard', 'corporate_membership_events_record', 'corporate_memberships_guard', 'corporate_org_nodes_guard']);
  assert.deepEqual(fns.filter((f) => f.prosecdef).map((f) => f.proname), ['corporate_membership_events_record']);
  for (const f of fns) assert.ok((f.proconfig ?? []).some((c) => /^search_path=public, pg_temp$/.test(c)), `${f.proname} pins search_path`);
  const triggers = (await db.query(`SELECT c.relname AS tbl, t.tgname AS name, t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relname LIKE 'corporate\\_%' ORDER BY 1, 2`)).rows;
  assert.deepEqual(triggers.map((t) => [t.tbl, t.name]), [
    ['corporate_membership_events', 'corporate_membership_events_guard'], ['corporate_membership_events', 'corporate_membership_events_no_truncate'],
    ['corporate_memberships', 'corporate_memberships_guard'], ['corporate_memberships', 'corporate_memberships_no_truncate'], ['corporate_memberships', 'corporate_memberships_record_event'],
    ['corporate_org_nodes', 'corporate_org_nodes_guard'], ['corporate_org_nodes', 'corporate_org_nodes_no_truncate'],
  ]);
  assert.ok(triggers.every((t) => t.enabled === 'O'), 'all enabled');
});

test('events are evidence, not authority: no runtime module reads or writes the event table', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'tests' || name.startsWith('.')) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs|ts)$/.test(name) && /corporate_membership_events/.test(readFileSync(full, 'utf8'))) offenders.push(path.relative(BACKEND, full));
    }
  };
  walk(BACKEND);
  assert.deepEqual(offenders, [], 'nothing in the backend runtime touches the history table');
});

// ═════════════ 8 · separation: history changes no identity, and grants nothing ═════════════

test('separation: a full lifecycle — and every refused attempt — leaves users.role, tenant_users, sessions and legacy organisations byte-identical', async () => {
  const db = await database({ migrate: false });
  const before = await identitySnapshot(db);
  await db.exec(UP);
  const id = await addMembership(db, { user: 'u-admin', state: 'PENDING', by: 'u-actor' });
  await change(db, id, { state: 'ACTIVE', kind: 'USER', by: 'u-owner', reason: 'approved' });
  await change(db, id, { until: iso(10 * HOUR), reason: 'fixed term' });
  await change(db, id, { reason: 'amended text' });
  await change(db, id, { state: 'SUSPENDED', reason: 'review' });
  await change(db, id, { state: 'ENDED', reason: 'leaver' });
  await refused(db, "UPDATE corporate_memberships SET state = 'ACTIVE', updated_by_kind = 'SYSTEM', updated_reason = 'x' WHERE membership_id = $1", [id], /ENDED_IS_TERMINAL/);
  await refused(db, 'UPDATE corporate_membership_events SET reason = $1', ['x'], /APPEND_ONLY/);
  assert.equal((await eventsOf(db, id)).length, 6);
  assert.equal(await identitySnapshot(db), before);
  assert.equal((await db.query("SELECT role FROM users WHERE id = 'u-admin'")).rows[0].role, 'admin', 'the administrator\'s platform role was never involved');
});

test('zero capability: after a full lifecycle the shipped resolver — which reads only memberships and nodes — still grants nothing', async () => {
  const db = await database();
  const read = new Set();
  const client = {
    from(table) {
      read.add(table);
      const st = { cols: '*', where: [], params: [] };
      const b = {
        select(cols) { st.cols = cols; return b; },
        eq(col, value) { st.params.push(value); st.where.push(`${col} = $${st.params.length}`); return b; },
        in(col, values) { st.params.push(values); st.where.push(`${col} = ANY($${st.params.length}::text[])`); return b; },
        then(resolve, reject) {
          return db.query(`SELECT ${st.cols} FROM ${table}${st.where.length ? ` WHERE ${st.where.join(' AND ')}` : ''}`, st.params)
            .then(({ rows }) => ({ data: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))), error: null }), (error) => ({ data: null, error: { message: error.message } }))
            .then(resolve, reject);
        },
      };
      return b;
    },
  };
  const id = await addMembership(db, { user: 'u-owner', state: 'PENDING', by: 'u-actor' });
  await change(db, id, { state: 'ACTIVE', kind: 'USER', by: 'u-admin', reason: 'approved' });
  await change(db, id, { reason: 'amended' });
  const r = await resolveCorporateMembership(client, 'u-owner');
  assert.equal(r.state, S.ACTIVE);
  assert.equal(r.is_active_member, true);
  assert.deepEqual(r.capabilities, []);
  assert.equal(r.grants_capability, false);
  assert.deepEqual([...read].sort(), ['corporate_memberships', 'corporate_org_nodes'], 'history was not consulted');
});

// ═════════════ 9 · Up, Up, Down, Up ═════════════

test('Up on a POPULATED database is idempotent: memberships and the whole history are untouched, no event duplicated', async () => {
  const db = await database();
  const a = await addMembership(db, { state: 'PENDING', by: 'u-actor', reference: 'R1' });
  await change(db, a, { state: 'ACTIVE', kind: 'USER', by: 'u-admin', reason: 'approved', reference: 'R2' });
  const b = await addMembership(db, { user: 'u-owner', node: 'BU_DIASPORA_TRADE', state: 'ACTIVE' });
  await change(db, b, { until: iso(5 * HOUR), reason: 'fixed term' });
  const snapshot = async () => JSON.stringify({
    nodes: (await db.query('SELECT * FROM corporate_org_nodes ORDER BY node_id')).rows,
    memberships: (await db.query('SELECT * FROM corporate_memberships ORDER BY membership_id')).rows,
    events: (await db.query('SELECT * FROM corporate_membership_events ORDER BY membership_id, event_seq')).rows,
  });
  const before = await snapshot();
  await db.exec(UP);
  await db.exec(UP);
  assert.equal(await snapshot(), before);
  await change(db, a, { state: 'SUSPENDED', reason: 'still works after re-applying' });
  assert.equal((await eventsOf(db, a)).length, 3);
});

test('Down removes only AUTH-02 objects; Up restores a clean Phase-A schema that works; identity tables are byte-identical throughout', async () => {
  const db = await database({ migrate: false });
  const identityBefore = await identitySnapshot(db);
  await db.exec(UP);
  const id = await addMembership(db, { user: 'u-admin', state: 'ACTIVE', by: 'u-actor' });
  await change(db, id, { state: 'SUSPENDED', reason: 'review' });
  assert.equal(await count(db, 'corporate_membership_events'), 2);

  await db.exec(DOWN);
  const gone = (await db.query(`SELECT
      to_regclass('public.corporate_membership_events') AS events, to_regclass('public.corporate_memberships') AS memberships, to_regclass('public.corporate_org_nodes') AS nodes,
      (SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'corporate\\_%') AS functions,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'corporate\\_%') AS triggers,
      (SELECT count(*)::int FROM pg_class WHERE relname LIKE 'corporate\\_%' OR relname LIKE 'idx\\_corporate\\_%') AS relations`)).rows[0];
  assert.deepEqual([gone.events, gone.memberships, gone.nodes, gone.functions, gone.triggers, gone.relations], [null, null, null, 0, 0, 0], 'nothing of AUTH-02 remains');
  assert.equal(await identitySnapshot(db), identityBefore, 'Down touched no identity table');
  assert.equal((await db.query("SELECT count(*)::int c FROM pg_class WHERE relname IN ('users','tenant_users','user_sessions','organizations','organization_users','tenants')")).rows[0].c, 6, 'and none of them was dropped');

  await db.exec(UP);
  assert.deepEqual([await count(db, 'corporate_org_nodes'), await count(db, 'corporate_memberships'), await count(db, 'corporate_membership_events')], [5, 0, 0], 'a clean Phase-A schema: the reference nodes, no member, no history');
  const again = await addMembership(db, { user: 'u-admin', state: 'PENDING', by: 'u-actor' });
  await change(db, again, { state: 'ACTIVE', reason: 'works after Down and Up' });
  assert.deepEqual((await eventsOf(db, again)).map((e) => [e.event_seq, e.event_type]), [[1, 'CREATED'], [2, 'TRANSITIONED']]);
  assert.equal(await identitySnapshot(db), identityBefore);
});

test('a database holding the pre-custody shape of the membership table is REFUSED by Up, atomically — no half-applied schema', async () => {
  const db = await database({ migrate: false });
  await db.exec('CREATE TABLE corporate_memberships (membership_id UUID PRIMARY KEY, user_id TEXT)');
  await assert.rejects(db.exec(UP), /pre-lifecycle-custody shape/);
  const left = (await db.query("SELECT to_regclass('public.corporate_membership_events') AS events, to_regclass('public.corporate_org_nodes') AS nodes")).rows[0];
  assert.deepEqual([left.events, left.nodes], [null, null]);
});
