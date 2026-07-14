/**
 * Isolated verification for the mobile-certification migration (20260703170000_mobile_certification.sql)
 * using PGlite (PostgreSQL 17.5, WASM) — no daemon, no production Supabase.
 *
 * This is a NEW, standalone harness (the shared database/test/migration_pglite_check.mjs is not
 * edited). It proves the additive+reversible migration in isolation:
 *   1. bootstrap a Supabase-compat env: roles, auth.uid(), users, and the governance_block_mutation()
 *      function the migration DEPENDS ON (defined identically to 20260621160000).
 *   2. apply the migration Up — assert both tables + indexes + triggers + RLS exist.
 *   3. functional checks:
 *        - a run + result insert succeeds;
 *        - results are APPEND-ONLY: UPDATE and DELETE are BOTH blocked by the trigger;
 *        - the results.run_id FK is ON DELETE RESTRICT (deleting a run with results is refused);
 *        - CHECK constraints reject a bad platform/build_type/status/result;
 *        - RLS is enabled on both tables.
 *   4. apply Down — assert both tables are gone.
 *   5. re-apply Up — assert idempotent-after-rollback.
 *
 * Run:  node database/test/mobile_certification_migration_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FILE = '20260703170000_mobile_certification.sql';

function splitMigration(file) {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const idx = raw.indexOf('-- +migrate Down');
  const up = (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
  const down = idx >= 0 ? raw.slice(idx).replace('-- +migrate Down', '') : '';
  return { up, down };
}

// governance_block_mutation() — copied verbatim from 20260621160000 (the migration's dependency).
const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub', true) $$;
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, role TEXT, is_verified BOOLEAN DEFAULT false);
  CREATE OR REPLACE FUNCTION governance_block_mutation()
  RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
  BEGIN
    RAISE EXCEPTION 'Append-only table %: % is not permitted', TG_TABLE_NAME, TG_OP;
  END; $$;
`;

const results = { steps: [], catalog: {}, ok: true };
async function step(db, label, sql) {
  try { await db.exec(sql); results.steps.push({ label, status: 'OK' }); return true; }
  catch (e) { results.steps.push({ label, status: 'FAIL', error: e.message }); results.ok = false; return false; }
}
async function q(db, sql) { try { return (await db.query(sql)).rows; } catch (e) { return [{ _err: e.message }]; } }

const db = new PGlite();
const { up, down } = splitMigration(FILE);

await step(db, 'bootstrap (roles/auth/users/governance_block_mutation)', BOOTSTRAP);
await step(db, `${FILE} (Up)`, up);

// --- catalog assertions ---
results.catalog.tables = (await q(db, `
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('mobile_certification_runs','mobile_certification_results')
  ORDER BY table_name`)).map(r => r.table_name);
results.catalog.runs_rls = (await q(db, `SELECT relrowsecurity FROM pg_class WHERE relname='mobile_certification_runs' AND relnamespace='public'::regnamespace`))[0]?.relrowsecurity || false;
results.catalog.results_rls = (await q(db, `SELECT relrowsecurity FROM pg_class WHERE relname='mobile_certification_results' AND relnamespace='public'::regnamespace`))[0]?.relrowsecurity || false;
results.catalog.results_fk_mode = (await q(db, `
  SELECT confdeltype FROM pg_constraint
  WHERE conrelid='mobile_certification_results'::regclass AND confrelid='mobile_certification_runs'::regclass AND contype='f' LIMIT 1`))[0]?.confdeltype || null;
results.catalog.results_fk_is_restrict = results.catalog.results_fk_mode === 'r';
results.catalog.triggers = (await q(db, `SELECT trigger_name FROM information_schema.triggers WHERE event_object_table='mobile_certification_results' ORDER BY trigger_name`)).map(r => r.trigger_name);
results.catalog.index_count = (await q(db, `SELECT count(*)::int n FROM pg_indexes WHERE tablename IN ('mobile_certification_runs','mobile_certification_results')`))[0]?.n ?? null;

// --- functional: insert a run + result ---
await step(db, 'insert run', `INSERT INTO mobile_certification_runs(id,platform,device_model,os_version,build_type,status)
  VALUES ('11111111-1111-1111-1111-111111111111','android','Pixel 6a','Android 14','release','running')`);
await step(db, 'insert result', `INSERT INTO mobile_certification_results(run_id,check_key,result,detail,evidence_ref)
  VALUES ('11111111-1111-1111-1111-111111111111','offline_queue_persist_restart','pass','ok','mobile-cert/run-1/restart.png')`);

// --- append-only: UPDATE and DELETE on results must both be blocked ---
results.catalog.result_update_blocked = await (async () => {
  try { await db.exec(`UPDATE mobile_certification_results SET result='fail' WHERE check_key='offline_queue_persist_restart'`); return false; }
  catch { return true; }
})();
results.catalog.result_delete_blocked = await (async () => {
  try { await db.exec(`DELETE FROM mobile_certification_results WHERE check_key='offline_queue_persist_restart'`); return false; }
  catch { return true; }
})();

// --- FK ON DELETE RESTRICT: cannot delete a run that has results ---
results.catalog.run_delete_restricted = await (async () => {
  try { await db.exec(`DELETE FROM mobile_certification_runs WHERE id='11111111-1111-1111-1111-111111111111'`); return false; }
  catch { return true; }
})();

// --- CHECK constraints reject bad values ---
async function rejects(sql) { try { await db.exec(sql); return false; } catch { return true; } }
results.catalog.bad_platform_rejected = await rejects(`INSERT INTO mobile_certification_runs(platform,device_model,os_version,build_type) VALUES ('windows','x','y','release')`);
results.catalog.bad_build_rejected = await rejects(`INSERT INTO mobile_certification_runs(platform,device_model,os_version,build_type) VALUES ('android','x','y','staging')`);
results.catalog.bad_status_rejected = await rejects(`INSERT INTO mobile_certification_runs(platform,device_model,os_version,build_type,status) VALUES ('android','x','y','release','green')`);
results.catalog.bad_result_rejected = await rejects(`INSERT INTO mobile_certification_results(run_id,check_key,result) VALUES ('11111111-1111-1111-1111-111111111111','k','maybe')`);

// --- Down + re-Up ---
await step(db, `${FILE} (Down)`, down);
results.catalog.tables_after_down = (await q(db, `
  SELECT count(*)::int n FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('mobile_certification_runs','mobile_certification_results')`))[0]?.n ?? null;
await step(db, `${FILE} (re-Up)`, up);
results.catalog.tables_after_reup = (await q(db, `
  SELECT count(*)::int n FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('mobile_certification_runs','mobile_certification_results')`))[0]?.n ?? null;

// --- verdict ---
const assertions = {
  both_tables_created: results.catalog.tables.length === 2,
  runs_rls_enabled: results.catalog.runs_rls === true,
  results_rls_enabled: results.catalog.results_rls === true,
  results_fk_is_restrict: results.catalog.results_fk_is_restrict === true,
  two_append_only_triggers: results.catalog.triggers.length === 2,
  result_update_blocked: results.catalog.result_update_blocked === true,
  result_delete_blocked: results.catalog.result_delete_blocked === true,
  run_delete_restricted: results.catalog.run_delete_restricted === true,
  bad_platform_rejected: results.catalog.bad_platform_rejected === true,
  bad_build_rejected: results.catalog.bad_build_rejected === true,
  bad_status_rejected: results.catalog.bad_status_rejected === true,
  bad_result_rejected: results.catalog.bad_result_rejected === true,
  down_dropped_tables: results.catalog.tables_after_down === 0,
  reup_recreated_tables: results.catalog.tables_after_reup === 2,
};
const allAssertsPass = Object.values(assertions).every(Boolean);
const overall = results.ok && allAssertsPass;

console.log(JSON.stringify({
  overall: overall ? 'PASS' : 'FAIL',
  step_failures: results.steps.filter(s => s.status === 'FAIL'),
  assertions,
  catalog: results.catalog,
}, null, 2));
process.exit(overall ? 0 : 1);
