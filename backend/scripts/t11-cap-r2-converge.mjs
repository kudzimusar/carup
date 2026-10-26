#!/usr/bin/env node
/**
 * T11-CAP-LR01-R2 — staging convergence harness for the customer-journey authorities migration (evidence infrastructure,
 * not product code). A sibling of the R1 harness: it reuses that harness's connection, pinning and parsing helpers and
 * leaves R1's certified code untouched.
 *
 *   --mode=preflight   read-only: prove the target is the approved staging project, prove the migration's prerequisites hold
 *                      in the LIVE catalog, and report whether the migration is absent, applied, or in a PARTIAL state (a STOP).
 *   --mode=apply       apply the one migration in ONE transaction together with its ledger row. Idempotent: a migration whose
 *                      ledger row exists is never re-run. THE TRIPWIRE: the migration is ADDITIVE, so a fingerprint of every
 *                      table, column, constraint, trigger, index, policy and function it does not own is taken before and
 *                      after; ANY difference rolls the whole transaction back before it can commit.
 *   --mode=verify      diff the live catalog against the expected manifest generated from the tested PGlite world.
 *
 * Hard-pinned to staging project eoyenigwevnxwwhyhaer. The production project ref is refused by name.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveVersion, parseMigrationSource } from '../db/migrationParser.js'
import {
  EXPECTED_STAGING_PROJECT_REF, FORBIDDEN_PRODUCTION_PROJECT_REF, HarnessStop, ensureStagingDbUrl, expectedFunctionBodies, loadMigration, makeDb,
} from './t11-cap-stg-converge.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_MIGRATIONS_DIR = path.resolve(HERE, '../../database/migrations')
export const DEFAULT_MANIFEST = path.resolve(HERE, 't11-cap-r2-expected-manifest.json')
export const LEDGER_CREATED_BY = 't11-cap-lr01-r2-convergence'

// version = the FULL FILENAME (the repo's documented ledger contract); blob = the git blob of the committed file, so an
// edited migration is refused rather than applied.
export const MIGRATION = Object.freeze({
  file: '20260926090000_trade_os_cap_r2_customer_journey_authorities.sql',
  name: 'trade_os_cap_r2_customer_journey_authorities',
  blob: '49d75cb555bc7f019e9a5a7f3917bfafd66f703b',
})

/** What the migration OWNS — a partial state (objects without a ledger row, or a ledger row without its objects) is a STOP. */
export const OWNS = Object.freeze({
  tables: ['diaspora_external_progress_entries', 'diaspora_order_parties', 'diaspora_document_dispatches', 'vehicle_specification_observations', 'vehicle_media_references'],
  functions: ['carup_cap_recorded_fact_guard', 'carup_cap_recorded_fact_no_delete', 'carup_document_dispatch_time_guard', 'carup_vehicle_media_reference_check'],
  triggers: [
    ['diaspora_external_progress_entries', 'trg_external_progress_guard'], ['diaspora_external_progress_entries', 'trg_external_progress_no_delete'],
    ['diaspora_order_parties', 'trg_order_party_guard'], ['diaspora_order_parties', 'trg_order_party_no_delete'],
    ['diaspora_document_dispatches', 'trg_document_dispatch_time_guard'], ['diaspora_document_dispatches', 'trg_document_dispatch_guard'], ['diaspora_document_dispatches', 'trg_document_dispatch_no_delete'],
    ['vehicle_specification_observations', 'trg_vehicle_spec_obs_guard'], ['vehicle_specification_observations', 'trg_vehicle_spec_obs_no_delete'],
    ['vehicle_media_references', 'trg_vehicle_media_ref_guard'], ['vehicle_media_references', 'trg_vehicle_media_ref_validate'],
  ],
})

const PREREQUISITE_TABLES = ['tenants', 'users', 'vehicles', 'vehicle_evidence', 'diaspora_import_orders', 'diaspora_shipments']
// the foreign keys and the media validation trigger depend on these, so they are checked rather than assumed
const PREREQUISITE_COLUMNS = [
  ['tenants', 'id', 'uuid'], ['users', 'id', 'text'], ['vehicles', 'vin', 'text'], ['vehicle_evidence', 'id', 'uuid'], ['vehicle_evidence', 'vin', 'text'],
  ['vehicle_evidence', 'mime_type', 'text'], ['vehicle_evidence', 'verification_status', 'text'], ['diaspora_import_orders', 'id', 'uuid'], ['diaspora_shipments', 'id', 'uuid'],
]

async function identity(db) {
  return (await db.query(`select current_database() as db, current_user as usr, current_setting('transaction_read_only') as ro, version() as pg`)).rows[0]
}

async function ledgerRows(db) {
  const { rows } = await db.query(`select version, name, created_by from supabase_migrations.schema_migrations where version = $1`, [deriveVersion(MIGRATION.file)])
  return rows
}

async function presentObjects(db) {
  const tables = (await db.query(`select table_name as n from information_schema.tables where table_schema='public' and table_name = any($1::text[])`, [OWNS.tables])).rows.map((r) => r.n)
  const functions = (await db.query(`select p.proname as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname = any($1::text[])`, [OWNS.functions])).rows.map((r) => r.n)
  const triggers = (await db.query(`select c.relname as t, g.tgname as n from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace s on s.oid=c.relnamespace
    where not g.tgisinternal and s.nspname='public' and g.tgname = any($1::text[])`, [OWNS.triggers.map(([, name]) => name)])).rows.map((r) => `${r.t}.${r.n}`)
  return { tables, functions, triggers }
}

/**
 * A fingerprint of everything in `public` that this migration does NOT own. The migration is additive, so applying it must not
 * change this by one byte. (Foreign keys add internal RI triggers to the tables they point at; those are `tgisinternal` and are
 * excluded, which is exactly the one effect an additive migration is allowed to have on its neighbours.)
 */
export async function foreignFingerprint(db) {
  const ownedTables = OWNS.tables
  const { rows } = await db.query(`
    select md5(coalesce(string_agg(x, '|' order by x), '')) as fp, count(*)::int as n from (
      select 'col:' || c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, '') as x
        from information_schema.columns c where c.table_schema='public' and c.table_name <> all($1::text[])
      union all
      select 'con:' || cl.relname || '.' || co.conname || ':' || pg_get_constraintdef(co.oid)
        from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace where n.nspname='public' and cl.relname <> all($1::text[])
      union all
      select 'trg:' || cl.relname || '.' || g.tgname || ':' || g.tgenabled::text
        from pg_trigger g join pg_class cl on cl.oid = g.tgrelid join pg_namespace n on n.oid = cl.relnamespace where not g.tgisinternal and n.nspname='public' and cl.relname <> all($1::text[])
      union all
      select 'idx:' || i.tablename || '.' || i.indexname || ':' || i.indexdef from pg_indexes i where i.schemaname='public' and i.tablename <> all($1::text[])
      union all
      select 'pol:' || p.tablename || '.' || p.policyname || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, '') from pg_policies p where p.schemaname='public' and p.tablename <> all($1::text[])
      union all
      select 'rls:' || cl.relname || ':' || cl.relrowsecurity || ':' || cl.relforcerowsecurity from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname='public' and cl.relkind = 'r' and cl.relname <> all($1::text[])
      union all
      select 'fn:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname='public' and p.proname <> all($2::text[])
    ) t`, [ownedTables, OWNS.functions])
  return rows[0]
}

export async function preflight(db, ctx = {}) {
  const conn = await identity(db)
  const missingTables = (await db.query(`select t from unnest($1::text[]) t where not exists
    (select 1 from information_schema.tables where table_schema='public' and table_name = t)`, [PREREQUISITE_TABLES])).rows.map((r) => r.t)
  const ledgerExists = (await db.query(`select to_regclass('supabase_migrations.schema_migrations') as r`)).rows[0].r
  const wrongColumns = []
  for (const [table, column, type] of PREREQUISITE_COLUMNS) {
    const row = (await db.query(`select data_type from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`, [table, column])).rows[0]
    if (!row || row.data_type !== type) wrongColumns.push(`${table}.${column}: ${row ? row.data_type : 'missing'} != ${type}`)
  }
  const result = {
    mode: 'preflight', at: new Date().toISOString(), product_sha: ctx.productSha || 'unset', target_project_ref: EXPECTED_STAGING_PROJECT_REF,
    production_project_ref_refused: FORBIDDEN_PRODUCTION_PROJECT_REF, connection: conn, missing_prerequisite_tables: missingTables,
    wrong_prerequisite_columns: wrongColumns, ledger_table_present: Boolean(ledgerExists),
  }
  const blockers = []
  if (missingTables.length) blockers.push(`prerequisite tables absent: ${missingTables.join(', ')}`)
  if (wrongColumns.length) blockers.push(`prerequisite column types differ: ${wrongColumns.join('; ')}`)
  if (!ledgerExists) blockers.push('supabase_migrations.schema_migrations is absent')
  if (blockers.length) {
    result.verdict = 'BLOCKED_PREREQUISITES'; result.blockers = blockers
    writeJson(ctx.resultsDir, 'preflight.json', result)
    throw new HarnessStop('BLOCKED_PREREQUISITES', blockers.join(' | '))
  }
  const ledger = await ledgerRows(db)
  const present = await presentObjects(db)
  const total = OWNS.tables.length + OWNS.functions.length + OWNS.triggers.length
  const found = present.tables.length + present.functions.length + present.triggers.length
  const integrity = []
  if (ledger.length && found !== total) integrity.push(`in the ledger but only ${found}/${total} of its objects exist`)
  if (!ledger.length && found > 0) integrity.push(`NOT in the ledger but ${found}/${total} of its objects already exist`)
  result.ledger_rows = ledger
  result.objects_present = present
  result.integrity_problems = integrity
  result.foreign_fingerprint = await foreignFingerprint(db)
  result.verdict = integrity.length ? 'STOP_PARTIAL_STATE' : ledger.length ? 'ALREADY_APPLIED' : 'READY_TO_APPLY'
  writeJson(ctx.resultsDir, 'preflight.json', result)
  if (result.verdict === 'STOP_PARTIAL_STATE') throw new HarnessStop('STOP_PARTIAL_STATE', `staging integrity: ${integrity.join('; ')}`)
  return result
}

export async function apply(db, ctx = {}) {
  const migrationsDir = ctx.migrationsDir || DEFAULT_MIGRATIONS_DIR
  const pre = await preflight(db, ctx)
  if (pre.connection.ro !== 'off') throw new HarnessStop('READ_ONLY', `connection is read-only (${pre.connection.ro}) — cannot apply`)
  if (pre.verdict === 'ALREADY_APPLIED') return { applied: [], note: 'the migration is already in the ledger', foreign_fingerprint: pre.foreign_fingerprint }
  // `ctx.migration` lets a test supply a different pinned migration to rehearse one that misbehaves; the real run never sets it.
  const m = loadMigration(ctx.migration || MIGRATION, migrationsDir)
  const started = Date.now()
  try {
    await db.exec('BEGIN')
    await db.exec(`SET LOCAL lock_timeout = '20s'`)
    await db.exec(`SET LOCAL statement_timeout = '120s'`)
    const before = await foreignFingerprint(db)
    await db.exec(m.up)
    // THE TRIPWIRE. This migration is additive. If anything it does not own changed, it is rolled back before it can commit.
    const after = await foreignFingerprint(db)
    if (before.fp !== after.fp || before.n !== after.n) {
      throw new HarnessStop('FOREIGN_OBJECTS_CHANGED', `${m.file} changed objects it does not own (${before.n} items ${before.fp} -> ${after.n} items ${after.fp}) — rolled back`)
    }
    const present = await presentObjects(db)
    const missing = [
      ...OWNS.tables.filter((t) => !present.tables.includes(t)), ...OWNS.functions.filter((f) => !present.functions.includes(f)),
      ...OWNS.triggers.filter(([t, n]) => !present.triggers.includes(`${t}.${n}`)).map(([t, n]) => `${t}.${n}`),
    ]
    if (missing.length) throw new HarnessStop('OBJECTS_MISSING', `${m.file} did not create: ${missing.join(', ')} — rolled back`)
    const pointer = `-- applied from kudzimusar/carup ${ctx.productSha || 'unset'}; git blob ${m.blob}; Up-SQL sha256 ${m.upSha256}`
    await db.query(`insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ($1, $2, $3::text[], $4)`,
      [m.version, m.name, [pointer], LEDGER_CREATED_BY])
    await db.exec('COMMIT')
    const applied = [{ version: m.version, action: 'applied', ms: Date.now() - started, up_sha256: m.upSha256, blob: m.blob }]
    writeJson(ctx.resultsDir, 'apply.json', { at: new Date().toISOString(), product_sha: ctx.productSha || 'unset', foreign_fingerprint: before, applied })
    return { applied, foreign_fingerprint: before }
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => {})
    writeJson(ctx.resultsDir, 'apply.json', { failed: { version: m.version, error: String(error.message || error), code: error.code || null } })
    if (error instanceof HarnessStop) throw error
    throw new HarnessStop('APPLY_FAILED', `${m.file} did not apply and was rolled back: ${error.message}`)
  }
}

/**
 * The catalog, as far as this migration owns it. Used both to GENERATE the expected manifest (against the tested PGlite world)
 * and to read the live catalog, so the two can only differ if staging genuinely differs.
 */
export async function catalogSnapshot(db, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  // Only the SQL is needed here (to know what each function body should be); pinning is the apply path's job.
  const { up } = parseMigrationSource(fs.readFileSync(path.join(migrationsDir, MIGRATION.file), 'utf8'), MIGRATION.file)
  const bodies = expectedFunctionBodies(up)
  const functions = (await db.query(`select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, md5(p.prosrc) as body_md5, p.prosecdef as secdef,
      (p.prorettype = 'trigger'::regtype) as is_trigger, p.proconfig::text as config,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname = any($1::text[]) order by 1`, [OWNS.functions])).rows
  const tables = (await db.query(`select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
      (select count(*)::int from information_schema.columns k where k.table_schema='public' and k.table_name=c.relname) as columns,
      (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')) as anon_any,
      (has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE')) as authenticated_any
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname = any($1::text[]) order by 1`, [OWNS.tables])).rows
  // EVERY trigger on the owned tables, not just the ones the migration names: a stray trigger is exactly what this must see.
  const triggers = (await db.query(`select c.relname as table_name, g.tgname as name, g.tgenabled::text as enabled, (g.tgtype & 2) <> 0 as before_row_timing,
      (g.tgtype & 1) <> 0 as for_each_row, (g.tgtype & 4) <> 0 as on_insert, (g.tgtype & 8) <> 0 as on_delete, (g.tgtype & 16) <> 0 as on_update
    from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace s on s.oid=c.relnamespace
    where not g.tgisinternal and s.nspname='public' and c.relname = any($1::text[]) order by 1,2`, [OWNS.tables])).rows
  const constraints = (await db.query(`select cl.relname as table_name, co.conname as name, co.contype as type, co.convalidated as validated
    from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname='public' and cl.relname = any($1::text[]) and co.contype in ('c', 'f', 'p', 'u') order by 1,2`, [OWNS.tables])).rows
  const indexes = (await db.query(`select indexname as name from pg_indexes where schemaname='public' and tablename = any($1::text[]) order by 1`, [OWNS.tables])).rows
  return { functions: functions.map((f) => ({ ...f, expected_body_md5: bodies.get(f.name) || null })), tables, triggers, constraints, indexes }
}

export function diffSnapshot(live, expected) {
  const problems = []
  const note = (what) => problems.push(what)
  const key = (f) => `${f.name}(${f.args})`
  const liveFn = new Map(live.functions.map((f) => [key(f), f]))
  for (const e of expected.functions) {
    const l = liveFn.get(key(e))
    if (!l) { note(`function missing: ${key(e)}`); continue }
    if (l.body_md5 !== l.expected_body_md5) note(`function body differs from the migration: ${key(e)}`)
    for (const k of ['secdef', 'is_trigger', 'config']) if (l[k] !== e[k]) note(`function ${key(e)}.${k}: live ${l[k]} != expected ${e[k]}`)
    // Compared with the manifest, not demanded absolute: Postgres makes a function executable by PUBLIC by default, and a trigger
    // function cannot be called by a client in any case ("trigger functions can only be called as triggers").
    if (l.anon_exec !== e.anon_exec || l.authenticated_exec !== e.authenticated_exec) note(`function ${key(e)} execute privileges differ`)
  }
  for (const l of live.functions) if (!expected.functions.some((e) => key(e) === key(l))) note(`unexpected function: ${key(l)}`)

  const liveTbl = new Map(live.tables.map((t) => [t.name, t]))
  for (const e of expected.tables) {
    const l = liveTbl.get(e.name)
    if (!l) { note(`table missing: ${e.name}`); continue }
    if (l.columns !== e.columns) note(`table ${e.name}.columns: live ${l.columns} != expected ${e.columns}`)
    if (!l.rls || !l.force_rls) note(`table ${e.name} does not have FORCE RLS`)
    if (l.anon_any || l.authenticated_any) note(`table ${e.name} is reachable by the browser roles`)
  }
  const tk = (t) => `${t.table_name}.${t.name}`
  const liveTrg = new Map(live.triggers.map((t) => [tk(t), t]))
  for (const e of expected.triggers) {
    const l = liveTrg.get(tk(e))
    if (!l) { note(`trigger missing: ${tk(e)}`); continue }
    for (const k of Object.keys(e)) if (l[k] !== e[k]) note(`trigger ${tk(e)}.${k}: live ${l[k]} != expected ${e[k]}`)
  }
  for (const l of live.triggers) if (!expected.triggers.some((e) => tk(e) === tk(l))) note(`unexpected trigger: ${tk(l)}`)
  const ck = (c) => `${c.table_name}.${c.name}`
  for (const e of expected.constraints) {
    const l = live.constraints.find((c) => ck(c) === ck(e))
    if (!l) note(`constraint missing: ${ck(e)}`)
    else if (l.type !== e.type || l.validated !== e.validated) note(`constraint ${ck(e)} differs`)
  }
  for (const l of live.constraints) if (!expected.constraints.some((e) => ck(e) === ck(l))) note(`unexpected constraint: ${ck(l)}`)
  for (const e of expected.indexes) if (!live.indexes.some((i) => i.name === e.name)) note(`index missing: ${e.name}`)
  for (const l of live.indexes) if (!expected.indexes.some((e) => e.name === l.name)) note(`unexpected index: ${l.name}`)
  return problems
}

export async function verify(db, ctx = {}) {
  const expected = JSON.parse(fs.readFileSync(ctx.manifest || DEFAULT_MANIFEST, 'utf8'))
  const live = await catalogSnapshot(db, ctx.migrationsDir)
  const problems = diffSnapshot(live, expected)
  const ledger = await ledgerRows(db)
  if (!ledger.length) problems.push(`ledger row missing: ${MIGRATION.file}`)
  const fp = await foreignFingerprint(db)
  if (ctx.foreignFingerprint && (ctx.foreignFingerprint.fp !== fp.fp || ctx.foreignFingerprint.n !== fp.n)) problems.push(`objects the migration does not own changed since apply (${ctx.foreignFingerprint.fp} -> ${fp.fp})`)
  const result = {
    mode: 'verify', at: new Date().toISOString(), product_sha: ctx.productSha || 'unset', target_project_ref: EXPECTED_STAGING_PROJECT_REF,
    ledger_rows: ledger, foreign_fingerprint: fp,
    counts: { functions: live.functions.length, tables: live.tables.length, triggers: live.triggers.length, constraints: live.constraints.length, indexes: live.indexes.length },
    problems, verdict: problems.length === 0 ? 'CATALOG_MATCHES_EXPECTED' : 'CATALOG_DIFFERS',
  }
  writeJson(ctx.resultsDir, 'verify.json', result)
  return result
}

function writeJson(dir, file, value) {
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n')
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const MODE = (process.argv.find((arg) => arg.startsWith('--mode=')) || '--mode=preflight').split('=')[1]
  if (!['preflight', 'apply', 'verify'].includes(MODE)) { console.error(`BLOCKED: unsupported --mode=${MODE}`); process.exit(2) }
  const { default: pg } = await import('pg')
  const resultsDir = path.resolve(process.env.T11_CAP_RESULTS_DIR || 'test-results/t11-cap-r2-converge')
  const ctx = { productSha: process.env.PRODUCT_SHA || 'unset', resultsDir }
  const BLOCKED = new Set(['BLOCKED_PREREQUISITES', 'NO_DATABASE_URL', 'NOT_APPROVED_STAGING', 'READ_ONLY'])
  let client
  try {
    const url = ensureStagingDbUrl().replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '')
    // TLS is mandatory for the real staging pooler; only a loopback host (a local rehearsal server) may skip it.
    const loopback = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url)
    client = new pg.Client({ connectionString: url, ssl: loopback ? false : { rejectUnauthorized: false } })
    await client.connect()
    const db = makeDb(client)
    if (MODE === 'preflight') {
      const r = await preflight(db, ctx)
      console.log(JSON.stringify({ verdict: r.verdict, ledger: r.ledger_rows.map((x) => x.version), objects_present: r.objects_present, foreign_fingerprint: r.foreign_fingerprint, db: r.connection.db, user: r.connection.usr, read_only: r.connection.ro }))
    } else if (MODE === 'apply') {
      const a = await apply(db, ctx)
      console.log(JSON.stringify({ applied: a.applied.map((x) => `${x.version}:${x.action}`), foreign_fingerprint: a.foreign_fingerprint }))
      const v = await verify(db, { ...ctx, foreignFingerprint: a.foreign_fingerprint })
      console.log(JSON.stringify({ verdict: v.verdict, counts: v.counts, problems: v.problems.length }))
      if (v.problems.length) { for (const p of v.problems.slice(0, 40)) console.error(`  - ${p}`); throw new HarnessStop('CATALOG_DIFFERS', `${v.problems.length} catalog difference(s)`) }
    } else {
      const v = await verify(db, ctx)
      console.log(JSON.stringify({ verdict: v.verdict, counts: v.counts, problems: v.problems.length }))
      if (v.problems.length) { for (const p of v.problems.slice(0, 40)) console.error(`  - ${p}`); throw new HarnessStop('CATALOG_DIFFERS', `${v.problems.length} catalog difference(s)`) }
    }
  } catch (error) {
    if (error instanceof HarnessStop) { console.error(`${BLOCKED.has(error.code) ? 'BLOCKED' : 'FAIL'}: ${error.message}`); process.exit(BLOCKED.has(error.code) ? 2 : 1) }
    console.error(`ERROR: ${error.stack || error.message}`); process.exit(1)
  } finally { if (client) await client.end().catch(() => {}) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
