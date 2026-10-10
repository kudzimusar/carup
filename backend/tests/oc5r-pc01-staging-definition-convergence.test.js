/**
 * OC-5R-PC01-H — the staging definition convergence, rehearsed on real PostgreSQL (PGlite).
 *
 * The rehearsal is built from the lineage itself: apply the three migrations fresh, reproduce EXACTLY
 * the drift measured on staging (which is the recovery script, ROLLBACK_STATEMENTS), then converge.
 * The convergence must:
 *   - refuse a database that does not have the measured drift (a fresh lineage — i.e. production — or a
 *     staging already converged), and refuse a non-empty table;
 *   - change nothing on a dry run;
 *   - leave the catalog IDENTICAL to a fresh application of the lineage (constraints, nullability,
 *     functions incl. search_path and body, trigger, RLS, table and routine grants, indexes);
 *   - be reversible to the recorded pre-image by the recovery script.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import {
  SOURCES, PRE_ASSERTIONS, POST_ASSERTIONS, ROLLBACK_STATEMENTS, buildConvergence, runConvergence,
} from '../../database/scripts/lib/pc01StagingDefinitionConvergence.mjs';
import { prepareUpSql } from '../../database/scripts/lib/stagingMigrationRunner.mjs';
import { parseMigrationSource } from '../db/migrationParser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '../../database/migrations');
const upOf = (file) => prepareUpSql(parseMigrationSource(readFileSync(path.join(MIGRATIONS, file), 'utf8'), file).up, file).sql;

/** node-postgres-shaped adapter: every statement list runs as one simple query; rows come from the last. */
const adapter = (db) => ({ query: async (sql) => { const res = await db.exec(sql); return { rows: res.at(-1)?.rows ?? [] }; } });

const instances = [];
after(async () => { await Promise.all(instances.map((db) => db.close().catch(() => {}))); });

async function freshLineage() {
  const db = new PGlite();
  instances.push(db);
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE public.users (id text PRIMARY KEY);
    CREATE TABLE public.dealer_profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.garage_applications (id uuid PRIMARY KEY);
    CREATE TABLE public.tenants (id uuid PRIMARY KEY);
    CREATE TABLE public.tenant_users (id uuid PRIMARY KEY);
    -- the column D5 is about, as 20260727120000 defines it
    CREATE TABLE public.diaspora_workbook_import_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL);
  `);
  for (const file of [SOURCES.identity, SOURCES.confirmations, SOURCES.activation]) await db.exec(upOf(file));
  return db;
}

/** Everything the convergence is answerable for, as one comparable value. */
async function catalog(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  const rels = "('identity_lifecycle_events', 'dealer_workbook_mapping_confirmations', 'diaspora_workbook_import_receipts')";
  return {
    constraints: await q(`select c.relname, co.conname, pg_get_constraintdef(co.oid) as def from pg_constraint co join pg_class c on c.oid = co.conrelid
      where c.relname in ${rels} order by 1, 2`),
    columns: await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name in ${rels} order by 1, 2`),
    functions: await q(`select proname, proconfig, prosecdef, md5(prosrc) as body from pg_proc
      where proname in ('identity_lifecycle_events_append_only', 'activate_garage_application') order by 1`),
    triggers: await q(`select tgname, pg_get_triggerdef(oid) as def from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relname in ${rels}) order by 1`),
    rls: await q(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ${rels} order by 1`),
    tableGrants: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name in ${rels} order by 1, 2, 3`),
    routineGrants: await q(`select routine_name, grantee, privilege_type from information_schema.role_routine_grants
      where routine_name in ('identity_lifecycle_events_append_only', 'activate_garage_application') order by 1, 2, 3`),
    indexes: await q(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ${rels} order by 1`),
  };
}

const drift = async (db) => { for (const sql of ROLLBACK_STATEMENTS) await db.exec(sql); };
const assertionsHold = async (db, list) => {
  const out = [];
  for (const [name, expr] of list) out.push([name, (await db.query(`select (${expr})::boolean as ok`)).rows[0].ok]);
  return out;
};

test('PC01-H: every statement is tied to a lineage file by sha256, and the pre-image is exactly the measured drift', () => {
  const steps = buildConvergence(MIGRATIONS);
  for (const step of steps) assert.match(step.sqlSha256, /^[0-9a-f]{64}$/);
  const replays = steps.filter((s) => s.label.includes('replay')).map((s) => s.source.file);
  assert.deepEqual(replays, [SOURCES.identity, SOURCES.confirmations, SOURCES.activation]);
  const productionRef = ['vhmnajoeicasa', 'igiophh'].join(''); // assembled: never a literal in an executable path (CR-1)
  assert.ok(steps.every((s) => !JSON.stringify(s).includes(productionRef)), 'no production reference');
  // The two drops refuse dependents by name; nothing here can cascade.
  assert.ok(steps.filter((s) => /^DROP TABLE/.test(s.sql)).every((s) => /\bRESTRICT$/.test(s.sql)));
  assert.equal(PRE_ASSERTIONS.length, 13);
});

test('PC01-H: refuses a database without the measured drift — a fresh lineage, i.e. production', async () => {
  const db = await freshLineage();
  const pre = await assertionsHold(db, PRE_ASSERTIONS);
  assert.ok(pre.some(([, ok]) => ok === false), 'a fresh lineage must not look drifted');
  const before = await catalog(db);
  await assert.rejects(() => runConvergence(adapter(db), { migrationsDir: MIGRATIONS, apply: true }), /PRE_ASSERTION_FAILED/);
  assert.deepEqual(await catalog(db), before, 'nothing changed');
});

test('PC01-H: on the measured drift — the dry run changes nothing; the apply converges to the fresh lineage exactly; a second run refuses; the recovery script restores the pre-image', async () => {
  const db = await freshLineage();
  const lineage = await catalog(db);
  await drift(db);
  const drifted = await catalog(db);
  assert.notDeepEqual(drifted, lineage, 'the rehearsal really is drifted');
  assert.ok((await assertionsHold(db, PRE_ASSERTIONS)).every(([, ok]) => ok === true), 'the rehearsal drift is the measured drift');

  const dry = await runConvergence(adapter(db), { migrationsDir: MIGRATIONS, apply: false });
  assert.equal(dry.committed, false);
  assert.ok(dry.post.every((r) => r.ok), JSON.stringify(dry.post.filter((r) => !r.ok)));
  assert.deepEqual(await catalog(db), drifted, 'a dry run leaves the database as it was');

  const applied = await runConvergence(adapter(db), { migrationsDir: MIGRATIONS, apply: true });
  assert.equal(applied.committed, true);
  assert.equal(applied.grants_after, applied.grants_before);
  assert.deepEqual(await catalog(db), lineage, 'converged: identical to a fresh application of the lineage');
  assert.ok((await assertionsHold(db, POST_ASSERTIONS)).every(([, ok]) => ok === true));

  await assert.rejects(() => runConvergence(adapter(db), { migrationsDir: MIGRATIONS, apply: true }), /PRE_ASSERTION_FAILED/, 'never runs twice');

  await drift(db);
  assert.deepEqual(await catalog(db), drifted, 'the recovery script restores the recorded pre-image');
});

test('PC01-H: refuses when either rebuilt table holds a row, and rolls everything back', async () => {
  const db = await freshLineage();
  await drift(db);
  await db.exec(`INSERT INTO public.users (id) VALUES ('u-1');
    INSERT INTO public.identity_lifecycle_events (user_id, previous_state, next_state, reason_code, trigger_source, actor_kind, policy_version)
    VALUES ('u-1', 'verified', 'suspended', 'TEST', 'reviewer_action', 'system', 'v1')`);
  const before = await catalog(db);
  await assert.rejects(() => runConvergence(adapter(db), { migrationsDir: MIGRATIONS, apply: true }), /PRE_ASSERTION_FAILED: identity_lifecycle_events is empty/);
  assert.deepEqual(await catalog(db), before);
  assert.equal((await db.query('select count(*)::int as n from public.identity_lifecycle_events')).rows[0].n, 1, 'the row is untouched');
});
