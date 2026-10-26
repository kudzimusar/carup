/**
 * T11-CAP-LR01-R2 — the staging convergence harness for the customer-journey authorities migration, rehearsed on a PGlite
 * world that has the neighbours a real database has (tables with triggers, indexes, policies and functions), because the
 * harness's whole job is to prove an ADDITIVE migration touched none of them.
 *
 * The same functions run against staging in the certification workflow; nothing here is a mock of them.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { HarnessStop, ensureStagingDbUrl, loadMigration, makeDb } from '../scripts/t11-cap-stg-converge.mjs'
import {
  DEFAULT_MANIFEST, DEFAULT_MIGRATIONS_DIR, LEDGER_CREATED_BY, MIGRATION, OWNS, apply, catalogSnapshot, diffSnapshot, foreignFingerprint, preflight, verify,
} from '../scripts/t11-cap-r2-converge.mjs'

process.env.NODE_ENV = 'test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATION_PATH = path.join(DEFAULT_MIGRATIONS_DIR, MIGRATION.file)
const gitBlob = (buffer) => crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex')

const WORLDS = []
test.after(async () => { for (const p of WORLDS) await p.close().catch(() => {}) })

async function world({ wrongVinType = false, noLedger = false, noEvidence = false } = {}) {
  const pg = new PGlite()
  WORLDS.push(pg)
  await pg.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    CREATE TABLE public.tenants (id uuid PRIMARY KEY);
    CREATE TABLE public.users (id text PRIMARY KEY);
    CREATE TABLE public.vehicles (vin ${wrongVinType ? 'uuid' : 'text'} PRIMARY KEY, make text);
    ${noEvidence ? '' : `CREATE TABLE public.vehicle_evidence (id uuid PRIMARY KEY, vin text NOT NULL ${wrongVinType ? '' : 'REFERENCES public.vehicles(vin) ON DELETE CASCADE'}, mime_type text NOT NULL, verification_status text NOT NULL DEFAULT 'pending');`}
    CREATE TABLE public.diaspora_import_orders (id uuid PRIMARY KEY, status text);
    CREATE TABLE public.diaspora_shipments (id uuid PRIMARY KEY, import_order_id uuid);
    -- neighbours the migration must not touch
    CREATE TABLE public.neighbour (id int PRIMARY KEY, note text);
    CREATE INDEX idx_neighbour_note ON public.neighbour (note);
    ALTER TABLE public.neighbour ENABLE ROW LEVEL SECURITY;
    CREATE POLICY neighbour_read ON public.neighbour FOR SELECT USING (true);
    CREATE FUNCTION public.neighbour_touch() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_neighbour_touch BEFORE UPDATE ON public.neighbour FOR EACH ROW EXECUTE FUNCTION public.neighbour_touch();
    CREATE FUNCTION public.shared_helper() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;
    ${noLedger ? '' : `CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[], created_by text);`}
  `)
  return { pg, db: makeDb(pg) }
}

/** A copy of the real migration, transformed, written to a temp directory with the git blob it will then be pinned to. */
function variant(transform, file = MIGRATION.file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-converge-'))
  const text = transform(fs.readFileSync(MIGRATION_PATH, 'utf8'))
  fs.writeFileSync(path.join(dir, file), text)
  return { dir, migration: { ...MIGRATION, blob: gitBlob(Buffer.from(text)) } }
}

const ledgerCount = async (db) => (await db.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n
const ownedTables = async (db) => (await db.query(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1::text[])`, [OWNS.tables])).rows.length

// ═══════════════════════════ the pin ═══════════════════════════

test('R2-C1: the harness pins the committed migration byte-for-byte, and refuses an edited one', () => {
  assert.equal(gitBlob(fs.readFileSync(MIGRATION_PATH)), MIGRATION.blob, 'the migration changed: re-review it, then update the pin deliberately')
  assert.doesNotThrow(() => loadMigration(MIGRATION))
  const edited = variant((t) => `${t}\n-- an unreviewed edit\n`)
  assert.throws(() => loadMigration({ ...MIGRATION, blob: MIGRATION.blob }, edited.dir), (e) => e.code === 'BLOB_MISMATCH')
})

test('R2-C2: the harness refuses anything but approved staging, and names production only to refuse it', () => {
  assert.throws(() => ensureStagingDbUrl('postgresql://u:p@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres'), (e) => e.code === 'NOT_APPROVED_STAGING')
  assert.throws(() => ensureStagingDbUrl('postgresql://u:p@db.someotherproject.supabase.co:5432/postgres'), (e) => e.code === 'NOT_APPROVED_STAGING')
  assert.throws(() => ensureStagingDbUrl(''), (e) => e.code === 'NO_DATABASE_URL')
  assert.doesNotThrow(() => ensureStagingDbUrl('postgresql://u:p@db.eoyenigwevnxwwhyhaer.supabase.co:5432/postgres'))
  const source = fs.readFileSync(path.join(HERE, '../scripts/t11-cap-r2-converge.mjs'), 'utf8')
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE|postgres(ql)?:\/\/[^'"`\s]+:[^'"`\s]+@/i)
})

// ═══════════════════════════ preflight ═══════════════════════════

test('R2-C3: preflight on a clean database says READY_TO_APPLY and fingerprints what is NOT the migration\'s', async () => {
  const { db } = await world()
  const r = await preflight(db)
  assert.equal(r.verdict, 'READY_TO_APPLY')
  assert.equal(r.objects_present.tables.length, 0)
  assert.match(r.foreign_fingerprint.fp, /^[0-9a-f]{32}$/)
  assert.ok(r.foreign_fingerprint.n > 10, 'the fingerprint covers real objects')
})

test('R2-C4: preflight is BLOCKED when a prerequisite is missing or has the wrong type, and writes nothing', async () => {
  for (const [what, opts, pattern] of [
    ['vehicles.vin is not text', { wrongVinType: true }, /vehicles\.vin: uuid != text/],
    ['vehicle_evidence is absent', { noEvidence: true }, /vehicle_evidence/],
    ['the migration ledger is absent', { noLedger: true }, /schema_migrations is absent/],
  ]) {
    const { db } = await world(opts)
    await assert.rejects(() => preflight(db), (e) => e.code === 'BLOCKED_PREREQUISITES' && pattern.test(e.message), what)
    assert.equal(await ownedTables(db), 0)
  }
})

test('R2-C5: a PARTIAL state is a STOP — objects without a ledger row, and a ledger row without objects', async () => {
  const a = await world()
  await a.db.exec(`CREATE TABLE public.vehicle_media_references (id uuid PRIMARY KEY)`)
  await assert.rejects(() => preflight(a.db), (e) => e.code === 'STOP_PARTIAL_STATE' && /NOT in the ledger/.test(e.message))
  await assert.rejects(() => apply(a.db), (e) => e.code === 'STOP_PARTIAL_STATE')
  const b = await world()
  await b.db.query(`insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ($1, 'x', ARRAY['x'], 'x')`, [MIGRATION.file])
  await assert.rejects(() => preflight(b.db), (e) => e.code === 'STOP_PARTIAL_STATE' && /only 0\//.test(e.message))
})

// ═══════════════════════════ apply ═══════════════════════════

test('R2-C6: apply creates exactly the migration\'s objects, records one ledger row, and changes NOTHING it does not own', async () => {
  const { db } = await world()
  const before = await foreignFingerprint(db)
  const out = await apply(db, { productSha: 'abc123' })
  assert.equal(out.applied.length, 1)
  assert.equal(out.applied[0].action, 'applied')
  assert.deepEqual(out.foreign_fingerprint, before)
  assert.deepEqual(await foreignFingerprint(db), before, 'a neighbouring table, index, policy, trigger or function moved')
  assert.equal(await ownedTables(db), 5)
  const ledger = (await db.query('select version, name, created_by, statements from supabase_migrations.schema_migrations')).rows
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0].version, MIGRATION.file)
  assert.equal(ledger[0].created_by, LEDGER_CREATED_BY)
  assert.ok(ledger[0].statements[0].includes(`git blob ${MIGRATION.blob}`))
  assert.match(ledger[0].statements[0], /abc123/)
  const pre = await preflight(db)
  assert.equal(pre.verdict, 'ALREADY_APPLIED')
})

test('R2-C7: a second apply is a no-op — nothing re-runs, no second ledger row', async () => {
  const { db } = await world()
  await apply(db)
  const again = await apply(db)
  assert.deepEqual(again.applied, [])
  assert.equal(await ledgerCount(db), 1)
})

const MISBEHAVING = [
  ['adds a column to a table it does not own', (t) => t.replace('-- +migrate Down', () => 'ALTER TABLE public.vehicles ADD COLUMN sneaky text;\n-- +migrate Down')],
  ['rewrites a shared function', (t) => t.replace('-- +migrate Down', () => "CREATE OR REPLACE FUNCTION public.shared_helper() RETURNS int AS $$ SELECT 2 $$ LANGUAGE sql;\n-- +migrate Down")],
  ['adds an index to a neighbour', (t) => t.replace('-- +migrate Down', () => 'CREATE INDEX idx_neighbour_sneaky ON public.neighbour (id);\n-- +migrate Down')],
  ['adds a policy to a neighbour', (t) => t.replace('-- +migrate Down', () => 'CREATE POLICY neighbour_sneaky ON public.neighbour FOR ALL USING (true);\n-- +migrate Down')],
  ['disables a neighbour\'s trigger', (t) => t.replace('-- +migrate Down', () => 'ALTER TABLE public.neighbour DISABLE TRIGGER trg_neighbour_touch;\n-- +migrate Down')],
  ['turns row security off on a neighbour', (t) => t.replace('-- +migrate Down', () => 'ALTER TABLE public.neighbour DISABLE ROW LEVEL SECURITY;\n-- +migrate Down')],
  ['drops a neighbour\'s policy', (t) => t.replace('-- +migrate Down', () => 'DROP POLICY neighbour_read ON public.neighbour;\n-- +migrate Down')],
  ['adds a constraint to a neighbour', (t) => t.replace('-- +migrate Down', () => 'ALTER TABLE public.neighbour ADD CONSTRAINT neighbour_sneaky CHECK (id > 0);\n-- +migrate Down')],
  ['adds a column to vehicle_evidence', (t) => t.replace('-- +migrate Down', () => 'ALTER TABLE public.vehicle_evidence ADD COLUMN sneaky text;\n-- +migrate Down')],
]
for (const [what, transform] of MISBEHAVING) {
  test(`R2-C8: TRIPWIRE — a migration that ${what} is ROLLED BACK, with no table, no ledger row`, async () => {
    const { db } = await world()
    const before = await foreignFingerprint(db)
    const v = variant(transform)
    await assert.rejects(() => apply(db, { migration: v.migration, migrationsDir: v.dir }), (e) => e instanceof HarnessStop && e.code === 'FOREIGN_OBJECTS_CHANGED')
    assert.equal(await ownedTables(db), 0, 'the migration\'s own tables survived a rolled-back apply')
    assert.equal(await ledgerCount(db), 0)
    assert.deepEqual(await foreignFingerprint(db), before)
  })
}

test('R2-C9: a migration that fails, or that creates less than it owns, is rolled back whole', async () => {
  for (const [what, transform, code] of [
    ['has a SQL error halfway', (t) => t.replace('-- ── 3. Document dispatches', 'SELECT this_is_not_sql;\n-- ── 3. Document dispatches'), 'APPLY_FAILED'],
    ['omits one of its triggers', (t) => t.replace(/DROP TRIGGER IF EXISTS trg_vehicle_media_ref_guard[\s\S]*?'updated_by'\);\n/, ''), 'OBJECTS_MISSING'],
  ]) {
    const { db } = await world()
    const v = variant(transform)
    await assert.rejects(() => apply(db, { migration: v.migration, migrationsDir: v.dir }), (e) => e.code === code, what)
    assert.equal(await ownedTables(db), 0, `${what}: partial tables survived`)
    assert.equal(await ledgerCount(db), 0)
  }
})

test('R2-C10: apply refuses an unpinned (edited) migration before touching anything', async () => {
  const { db } = await world()
  const edited = variant((t) => `${t}\n-- edit\n`)
  await assert.rejects(() => apply(db, { migration: { ...MIGRATION, blob: MIGRATION.blob }, migrationsDir: edited.dir }), (e) => e.code === 'BLOB_MISMATCH')
  assert.equal(await ownedTables(db), 0)
  assert.equal(await ledgerCount(db), 0)
})

// ═══════════════════════════ verify ═══════════════════════════

test('R2-V1: the committed manifest IS the tested world — regenerating it from PGlite reproduces it exactly', async () => {
  const { db } = await world()
  await apply(db)
  const snapshot = await catalogSnapshot(db)
  if (process.env.WRITE_MANIFEST === '1') fs.writeFileSync(DEFAULT_MANIFEST, JSON.stringify(snapshot, null, 2) + '\n')
  assert.deepEqual(snapshot, JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, 'utf8')), 'the manifest drifted from the migration; regenerate it with WRITE_MANIFEST=1 and review the diff')
  assert.equal(snapshot.tables.length, 5)
  assert.equal(snapshot.functions.length, 4)
  assert.equal(snapshot.triggers.length, 11)
  assert.ok(snapshot.tables.every((t) => t.rls && t.force_rls && !t.anon_any && !t.authenticated_any))
})

test('R2-V2: verify MATCHES a correctly applied database and is stable across a second reading', async () => {
  const { db } = await world()
  const a = await apply(db)
  const v = await verify(db, { foreignFingerprint: a.foreign_fingerprint })
  assert.equal(v.verdict, 'CATALOG_MATCHES_EXPECTED', v.problems.join('; '))
  assert.equal((await verify(db, { foreignFingerprint: a.foreign_fingerprint })).verdict, 'CATALOG_MATCHES_EXPECTED')
})

const DAMAGE = [
  ['a guard trigger is dropped', 'DROP TRIGGER trg_vehicle_media_ref_guard ON public.vehicle_media_references', /trigger missing: vehicle_media_references\.trg_vehicle_media_ref_guard/],
  ['a no-delete trigger is dropped', 'DROP TRIGGER trg_external_progress_no_delete ON public.diaspora_external_progress_entries', /trigger missing: diaspora_external_progress_entries\.trg_external_progress_no_delete/],
  ['row security stops being forced', 'ALTER TABLE public.diaspora_order_parties NO FORCE ROW LEVEL SECURITY', /does not have FORCE RLS/],
  ['row security is switched off', 'ALTER TABLE public.diaspora_order_parties DISABLE ROW LEVEL SECURITY', /does not have FORCE RLS/],
  ['the browser is granted a privilege', 'GRANT SELECT ON public.diaspora_document_dispatches TO anon', /reachable by the browser roles/],
  ['an authenticated grant appears', 'GRANT INSERT ON public.vehicle_specification_observations TO authenticated', /reachable by the browser roles/],
  ['a constraint is dropped', 'ALTER TABLE public.diaspora_document_dispatches DROP CONSTRAINT diaspora_document_dispatches_tracking_chk', /constraint missing: diaspora_document_dispatches\.diaspora_document_dispatches_tracking_chk/],
  ['an index is dropped', 'DROP INDEX public.uq_vehicle_media_ref_live_primary', /index missing: uq_vehicle_media_ref_live_primary/],
  ['a guard function body is changed', 'CREATE OR REPLACE FUNCTION public.carup_cap_recorded_fact_guard() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql', /function body differs/],
  ['a stray trigger is added to an owned table', 'CREATE TRIGGER trg_stray BEFORE UPDATE ON public.diaspora_external_progress_entries FOR EACH ROW EXECUTE FUNCTION public.neighbour_touch()', /unexpected trigger/],
  ['a stray constraint is added to an owned table', 'ALTER TABLE public.vehicle_media_references ADD CONSTRAINT stray CHECK (gallery_position < 1000)', /unexpected constraint/],
  ['a stray index is added to an owned table', 'CREATE INDEX stray_idx ON public.vehicle_media_references (label)', /unexpected index/],
  ['a column is added to an owned table', 'ALTER TABLE public.vehicle_media_references ADD COLUMN stray text', /\.columns: live/],
  ['a neighbour is changed after the apply', 'ALTER TABLE public.neighbour ADD COLUMN later text', /do(es)? not own changed/],
  ['the ledger row is removed', 'DELETE FROM supabase_migrations.schema_migrations', /ledger row missing/],
]
for (const [what, damage, pattern] of DAMAGE) {
  test(`R2-V3: verify reports DIFFERS when ${what}`, async () => {
    const { db } = await world()
    const a = await apply(db)
    await db.exec(damage)
    const v = await verify(db, { foreignFingerprint: a.foreign_fingerprint })
    assert.equal(v.verdict, 'CATALOG_DIFFERS')
    assert.ok(v.problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}; got: ${v.problems.join(' | ')}`)
  })
}

test('R2-V4: diffSnapshot reports an expected object that is missing from the live catalog altogether', async () => {
  const { db } = await world()
  await apply(db)
  const expected = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, 'utf8'))
  const live = await catalogSnapshot(db)
  assert.deepEqual(diffSnapshot(live, expected), [])
  const gutted = { ...live, tables: live.tables.slice(1), functions: live.functions.slice(1) }
  const problems = diffSnapshot(gutted, expected)
  assert.ok(problems.some((p) => /table missing/.test(p)) && problems.some((p) => /function missing/.test(p)))
})
