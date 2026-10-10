/**
 * OC-5R-PC01-H — converge seven staging definitions to THIS lineage. Staging only.
 *
 * WHY. PR #208's own workflows applied #208's migrations to staging. OC-5R's healing later recorded
 * this lineage's files over those objects with existence-only probes (`oc5r-ledger-repair`). So the
 * objects exist, but four of them are #208's (or #209's) definitions, not this lineage's. Measured
 * read-only on 2026-10-10 (PC01-H):
 *   D1  identity_lifecycle_events.user_id                 FK ON DELETE CASCADE      (lineage: RESTRICT)
 *   D2  dealer_workbook_mapping_confirmations user/dealer  FKs ON DELETE CASCADE     (lineage: RESTRICT)
 *   D3  dealer_workbook_mapping_confirmations             no CHECKs                 (lineage: checksum + array CHECKs)
 *   D4  dealer_workbook_mapping_confirmations.dealer_id   nullable                  (lineage: NOT NULL)
 *   D5  diaspora_workbook_import_receipts.tenant_id       nullable (#208 20260904090000, recorded nowhere)
 *                                                                                   (lineage: NOT NULL)
 *   D6  identity_lifecycle_events_append_only()           search_path unset         (lineage: public, pg_temp)
 *   D7  activate_garage_application(uuid, text)           search_path unset (#209)  (lineage: public, pg_temp)
 * Both O2 tables are EMPTY, with no policies and nothing that references or views them.
 *
 * HOW. The objects are rebuilt by the lineage's OWN SQL, not by hand-written equivalents. In ONE
 * transaction: every pre-assertion must hold (the exact measured drift, empty tables, no dependents),
 * then the two empty tables are dropped and their migrations' Up sections replayed, the GMO-4 function
 * migration is replayed (its header says CREATE OR REPLACE is meant to apply over #209's function),
 * and tenant_id is set NOT NULL — the exact inverse of #208's 20260904090000. Then every post-assertion
 * must hold, including table grants equal to what they were inside this same transaction before the
 * drop. Any failure rolls everything back. A dry run executes all of it and rolls back.
 *
 * The pre-assertions are the measured drift, so this refuses to touch a database that does not have
 * exactly that drift — production, a converged staging, or a staging that has moved since.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseMigrationSource } from '../../../backend/db/migrationParser.js';
import { prepareUpSql, sha256 } from './stagingMigrationRunner.mjs';

export const SOURCES = Object.freeze({
  identity: '20261004170000_o2_x3_identity_lifecycle_events.sql',
  confirmations: '20261004173000_o2_x5_dealer_workbook_mapping_confirmations.sql',
  activation: '20261004190100_gmo4_garage_business_activation.sql',
  // Defines diaspora_workbook_import_receipts.tenant_id as `uuid NOT NULL`. Not replayed (it is the whole
  // Diaspora GTM foundation); cited as the authority for D5.
  receipts: '20260727120000_diaspora_gtm_activation_foundation.sql',
});

const ILE = "'public.identity_lifecycle_events'::regclass";
const DWMC = "'public.dealer_workbook_mapping_confirmations'::regclass";
const DWIR = "'public.diaspora_workbook_import_receipts'::regclass";
const fkDel = (rel, name) => `(select confdeltype from pg_constraint where conrelid = ${rel} and conname = '${name}')`;
const notNull = (rel, col) => `(select attnotnull from pg_attribute where attrelid = ${rel} and attname = '${col}' and not attisdropped)`;
const cfg = (sig) => `(select proconfig from pg_proc where oid = '${sig}'::regprocedure)`;
const noDependents = (rel) => `not exists (select 1 from pg_constraint where contype = 'f' and confrelid = ${rel})
  and not exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid where d.refobjid = ${rel} and r.ev_class <> ${rel})
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = (select relname from pg_class where oid = ${rel}))`;

/** The measured staging drift, exactly. Every one must be true or nothing runs. */
export const PRE_ASSERTIONS = Object.freeze([
  ['D1 identity user FK is CASCADE', `${fkDel(ILE, 'identity_lifecycle_events_user_id_fkey')} = 'c'`],
  ['D2 confirmations user FK is CASCADE', `${fkDel(DWMC, 'dealer_workbook_mapping_confirmations_user_id_fkey')} = 'c'`],
  ['D2 confirmations dealer FK is CASCADE', `${fkDel(DWMC, 'dealer_workbook_mapping_confirmations_dealer_id_fkey')} = 'c'`],
  ['D3 confirmations has no CHECK', `not exists (select 1 from pg_constraint where conrelid = ${DWMC} and contype = 'c')`],
  ['D4 confirmations dealer_id is nullable', `${notNull(DWMC, 'dealer_id')} = false`],
  ['D5 receipts tenant_id is nullable', `${notNull(DWIR, 'tenant_id')} = false`],
  ['D6 append-only trigger function has no search_path', `${cfg('public.identity_lifecycle_events_append_only()')} is null`],
  ['D7 activate_garage_application has no search_path', `${cfg('public.activate_garage_application(uuid, text)')} is null`],
  ['identity_lifecycle_events is empty', '(select count(*) from public.identity_lifecycle_events) = 0'],
  ['dealer_workbook_mapping_confirmations is empty', '(select count(*) from public.dealer_workbook_mapping_confirmations) = 0'],
  ['no receipt has a null tenant', 'not exists (select 1 from public.diaspora_workbook_import_receipts where tenant_id is null)'],
  ['nothing references, views or polices identity_lifecycle_events', noDependents(ILE)],
  ['nothing references, views or polices dealer_workbook_mapping_confirmations', noDependents(DWMC)],
]);

/** This lineage's definitions. Every one must be true or the transaction rolls back. */
export const POST_ASSERTIONS = Object.freeze([
  ['D1 identity user FK is RESTRICT', `${fkDel(ILE, 'identity_lifecycle_events_user_id_fkey')} = 'r'`],
  ['D2 confirmations user FK is RESTRICT', `${fkDel(DWMC, 'dealer_workbook_mapping_confirmations_user_id_fkey')} = 'r'`],
  ['D2 confirmations dealer FK is RESTRICT', `${fkDel(DWMC, 'dealer_workbook_mapping_confirmations_dealer_id_fkey')} = 'r'`],
  ['D3 checksum CHECK', `exists (select 1 from pg_constraint where conrelid = ${DWMC} and conname = 'dealer_workbook_mapping_confirmations_workbook_checksum_check')`],
  ['D3 mapping CHECK', `exists (select 1 from pg_constraint where conrelid = ${DWMC} and conname = 'dealer_workbook_mapping_confirmations_mapping_check')`],
  ['D4 confirmations dealer_id is NOT NULL', `${notNull(DWMC, 'dealer_id')} = true`],
  ['D5 receipts tenant_id is NOT NULL', `${notNull(DWIR, 'tenant_id')} = true`],
  ['D6 append-only trigger function search_path', `${cfg('public.identity_lifecycle_events_append_only()')} = array['search_path=public, pg_temp']`],
  ['D7 activate_garage_application search_path', `${cfg('public.activate_garage_application(uuid, text)')} = array['search_path=public, pg_temp']`],
  ['identity RLS enabled and forced', `(select relrowsecurity and relforcerowsecurity from pg_class where oid = ${ILE})`],
  ['confirmations RLS enabled and forced', `(select relrowsecurity and relforcerowsecurity from pg_class where oid = ${DWMC})`],
  ['browser roles hold no privilege on either rebuilt table (lineage: REVOKE ALL FROM anon, authenticated)',
    "not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('identity_lifecycle_events', 'dealer_workbook_mapping_confirmations') and grantee in ('anon', 'authenticated'))"],
  ['append-only trigger present', `exists (select 1 from pg_trigger where tgrelid = ${ILE} and tgname = 'trg_identity_lifecycle_events_append_only' and not tgisinternal)`],
  ['activate_garage_application executable by service_role only (of the API roles)',
    "(select coalesce(array_agg(grantee::text order by grantee::text), '{}') from information_schema.role_routine_grants where routine_schema = 'public' and routine_name = 'activate_garage_application' and privilege_type = 'EXECUTE' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) = array['service_role']"],
]);

const REBUILT = "('public.identity_lifecycle_events'::regclass, 'public.dealer_workbook_mapping_confirmations'::regclass)";
const REBUILT_NAMES = "('identity_lifecycle_events', 'dealer_workbook_mapping_confirmations')";

/**
 * Everything the convergence answers for, as one comparable JSON value. Grants are limited to the API roles
 * the lineage governs explicitly (both tables' REVOKE/GRANT and GMO-4's function grants); the trigger
 * function's grants come from each environment's default privileges, which the lineage does not state.
 */
export const CONVERGED_CATALOG_SQL = `select json_build_object(
  'constraints', (select json_agg(json_build_array(c.relname, co.conname, pg_get_constraintdef(co.oid)) order by c.relname, co.conname)
                  from pg_constraint co join pg_class c on c.oid = co.conrelid where c.oid in ${REBUILT}),
  'columns', (select json_agg(json_build_array(table_name, column_name, data_type, is_nullable, column_default) order by table_name, column_name)
              from information_schema.columns where table_schema = 'public' and table_name in ${REBUILT_NAMES}),
  'indexes', (select json_agg(json_build_array(tablename, indexname, indexdef) order by tablename, indexname)
              from pg_indexes where schemaname = 'public' and tablename in ${REBUILT_NAMES}),
  'triggers', (select json_agg(json_build_array(tgname, pg_get_triggerdef(oid)) order by tgname) from pg_trigger where not tgisinternal and tgrelid in ${REBUILT}),
  'rls', (select json_agg(json_build_array(relname, relrowsecurity, relforcerowsecurity) order by relname) from pg_class where oid in ${REBUILT}),
  'table_comments', (select json_agg(json_build_array(relname, obj_description(oid, 'pg_class')) order by relname) from pg_class where oid in ${REBUILT}),
  'table_grants', (select json_agg(json_build_array(table_name, grantee, privilege_type) order by table_name, grantee, privilege_type)
                   from information_schema.role_table_grants where table_schema = 'public' and table_name in ${REBUILT_NAMES} and grantee in ('anon', 'authenticated', 'service_role')),
  'functions', (select json_agg(json_build_array(proname, pg_get_function_identity_arguments(oid), pg_get_function_result(oid), proconfig, prosecdef, md5(prosrc)) order by proname)
                from pg_proc where pronamespace = 'public'::regnamespace and proname in ('identity_lifecycle_events_append_only', 'activate_garage_application')),
  'activation_grants', (select json_agg(json_build_array(grantee, privilege_type) order by grantee, privilege_type) from information_schema.role_routine_grants
                        where routine_schema = 'public' and routine_name = 'activate_garage_application' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  'activation_comment', (select obj_description('public.activate_garage_application(uuid, text)'::regprocedure, 'pg_proc')),
  'receipts_tenant_id_not_null', (select attnotnull from pg_attribute where attrelid = 'public.diaspora_workbook_import_receipts'::regclass and attname = 'tenant_id' and not attisdropped)
)::text as catalog`;

/** The top-level keys whose values differ (an empty list means identical). */
export function catalogDifferences(a, b) {
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
  return keys.filter((k) => JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null));
}

/** Table grants of the two rebuilt tables, so the rebuild can be held to what was granted before it. */
export const GRANTS_SQL = `select coalesce(json_agg(json_build_array(table_name, grantee, privilege_type) order by 1, 2, 3), '[]')::text as grants
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name in ('identity_lifecycle_events', 'dealer_workbook_mapping_confirmations')`;

/** The statements, in order, each tied to the lineage file it comes from and that file's sha256. */
export function buildConvergence(migrationsDir) {
  const read = (file) => {
    const text = readFileSync(path.join(migrationsDir, file), 'utf8');
    return { file, text, sha256: sha256(text) };
  };
  const up = (src) => prepareUpSql(parseMigrationSource(src.text, src.file).up, src.file).sql;
  const identity = read(SOURCES.identity);
  const confirmations = read(SOURCES.confirmations);
  const activation = read(SOURCES.activation);
  const receipts = read(SOURCES.receipts);
  if (!/tenant_id\s+uuid\s+NOT NULL/.test(receipts.text)) {
    throw new Error(`${SOURCES.receipts} no longer defines tenant_id uuid NOT NULL; D5 has no authority`);
  }
  const steps = [
    { label: 'D1/D6: drop the empty identity_lifecycle_events (RESTRICT: refuses if anything depends on it)', sql: 'DROP TABLE public.identity_lifecycle_events RESTRICT', source: null },
    { label: `D1/D6: replay ${SOURCES.identity}`, sql: up(identity), source: identity },
    { label: 'D2-D4: drop the empty dealer_workbook_mapping_confirmations (RESTRICT)', sql: 'DROP TABLE public.dealer_workbook_mapping_confirmations RESTRICT', source: null },
    { label: `D2-D4: replay ${SOURCES.confirmations}`, sql: up(confirmations), source: confirmations },
    { label: `D7: replay ${SOURCES.activation}`, sql: up(activation), source: activation },
    { label: `D5: tenant_id NOT NULL, as ${SOURCES.receipts} defines it`, sql: 'ALTER TABLE public.diaspora_workbook_import_receipts ALTER COLUMN tenant_id SET NOT NULL', source: receipts },
  ];
  return steps.map((s) => ({ ...s, sqlSha256: sha256(s.sql), source: s.source ? { file: s.source.file, sha256: s.source.sha256 } : null }));
}

/**
 * The exact measured pre-image, for a recovery point. Converged definitions -> the drift that was
 * measured. Only for an emergency return to the recorded state; it restores no data because there was none.
 */
export const ROLLBACK_STATEMENTS = Object.freeze([
  'ALTER TABLE public.identity_lifecycle_events DROP CONSTRAINT identity_lifecycle_events_user_id_fkey, ADD CONSTRAINT identity_lifecycle_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE',
  'ALTER TABLE public.dealer_workbook_mapping_confirmations DROP CONSTRAINT dealer_workbook_mapping_confirmations_user_id_fkey, ADD CONSTRAINT dealer_workbook_mapping_confirmations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE, DROP CONSTRAINT dealer_workbook_mapping_confirmations_dealer_id_fkey, ADD CONSTRAINT dealer_workbook_mapping_confirmations_dealer_id_fkey FOREIGN KEY (dealer_id) REFERENCES public.dealer_profiles(id) ON DELETE CASCADE, DROP CONSTRAINT dealer_workbook_mapping_confirmations_workbook_checksum_check, DROP CONSTRAINT dealer_workbook_mapping_confirmations_mapping_check, ALTER COLUMN dealer_id DROP NOT NULL',
  'ALTER TABLE public.diaspora_workbook_import_receipts ALTER COLUMN tenant_id DROP NOT NULL',
  'ALTER FUNCTION public.identity_lifecycle_events_append_only() RESET search_path',
  'ALTER FUNCTION public.activate_garage_application(uuid, text) RESET search_path',
]);

async function evaluate(client, assertions) {
  const results = [];
  for (const [name, expr] of assertions) {
    const { rows } = await client.query(`select (${expr})::boolean as ok`);
    results.push({ name, ok: rows[0]?.ok === true });
  }
  return results;
}

/**
 * Run the convergence on an open `pg` client (staging, or a local rehearsal). `apply: false` executes
 * everything and rolls back. Returns the receipt; throws (after rolling back) on any refusal.
 */
export async function runConvergence(client, { migrationsDir, apply = false, cleanSource = null } = {}) {
  const steps = buildConvergence(migrationsDir);
  const receipt = { schema: 'oc5r-pc01-staging-definition-convergence/v1', mode: apply ? 'apply' : 'dry-run', steps: steps.map(({ sql, ...rest }) => rest) };
  await client.query('BEGIN');
  try {
    receipt.started_at = (await client.query('select now()::text as t')).rows[0].t;
    receipt.pre = await evaluate(client, PRE_ASSERTIONS);
    const refused = receipt.pre.filter((r) => !r.ok);
    if (refused.length) {
      const err = new Error(`PRE_ASSERTION_FAILED: ${refused.map((r) => r.name).join('; ')}`);
      err.code = 'PRE_ASSERTION_FAILED';
      throw err;
    }
    receipt.grants_before = (await client.query(GRANTS_SQL)).rows[0].grants;
    receipt.catalog_before = JSON.parse((await client.query(CONVERGED_CATALOG_SQL)).rows[0].catalog);
    for (const step of steps) await client.query(step.sql);
    receipt.post = await evaluate(client, POST_ASSERTIONS);
    receipt.grants_after = (await client.query(GRANTS_SQL)).rows[0].grants;
    const failed = receipt.post.filter((r) => !r.ok);
    if (receipt.grants_after !== receipt.grants_before) failed.push({ name: 'table grants unchanged by the rebuild', ok: false });
    // The converged objects, read INSIDE this transaction — so a dry run's result is evidence, not lost at ROLLBACK.
    receipt.catalog_after = JSON.parse((await client.query(CONVERGED_CATALOG_SQL)).rows[0].catalog);
    if (cleanSource) {
      const differences = catalogDifferences(receipt.catalog_after, cleanSource);
      receipt.clean_source = { equal: differences.length === 0, differences, sha256: sha256(JSON.stringify(cleanSource)) };
      if (differences.length) failed.push({ name: `converged catalog equals the clean-source catalog (differs: ${differences.join(', ')})`, ok: false });
    }
    if (failed.length) {
      const err = new Error(`POST_ASSERTION_FAILED: ${failed.map((r) => r.name).join('; ')}`);
      err.code = 'POST_ASSERTION_FAILED';
      throw err;
    }
    receipt.finished_at = (await client.query('select clock_timestamp()::text as t')).rows[0].t;
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    receipt.committed = apply;
    return receipt;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    error.receipt = { ...receipt, committed: false };
    throw error;
  }
}
