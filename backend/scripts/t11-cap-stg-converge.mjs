#!/usr/bin/env node
/**
 * T11-CAP-LR01 — staging convergence harness (evidence infrastructure, not product code).
 *
 *   --mode=preflight   read-only: prove the target is the approved staging project, prove the three CAP migrations'
 *                      prerequisites hold in the LIVE catalog, report the ledger and which migrations are present
 *                      (partial state is a STOP), and record the shared dedupe function's fingerprint.
 *   --mode=apply       apply the three migrations in order, each in ONE transaction together with its ledger row.
 *                      Idempotent: a migration whose ledger row exists is never re-run. A migration that changes the
 *                      shared `communication_domain_event_dedupe_key()` is ROLLED BACK before it can commit.
 *   --mode=verify      diff the live catalog against the expected manifest generated from the tested PGlite world.
 *
 * Hard-pinned to staging project eoyenigwevnxwwhyhaer. The production project ref is refused by name.
 *
 * The three functions below are importable so the SAME code that runs against staging is rehearsed against a PGlite
 * world in backend/tests/t11-cap-stg-converge-harness.test.js.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveVersion, parseMigrationSource } from '../db/migrationParser.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_MIGRATIONS_DIR = path.resolve(HERE, '../../database/migrations')
export const DEFAULT_MANIFEST = path.resolve(HERE, 't11-cap-stg-expected-manifest.json')

export const EXPECTED_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer'
export const FORBIDDEN_PRODUCTION_PROJECT_REF = 'vhmnajoeicasaigiophh'
export const LEDGER_CREATED_BY = 't11-cap-lr01-convergence'

// version = the FULL FILENAME (the repo's documented ledger contract, backend/db/migrationParser.js deriveVersion);
// blob = the git blob of the committed file, so an edited migration is refused rather than applied.
export const MIGRATIONS = Object.freeze([
  { file: '20260920090000_trade_os_cap04_shipment_legs.sql', name: 'trade_os_cap04_shipment_legs', blob: '0d9c76cc3a715f0259edcdaec1674c503a3f8851' },
  { file: '20260921090000_trade_os_cap05_shipment_observations.sql', name: 'trade_os_cap05_shipment_observations', blob: '75442903c79fbdd186fd055238137a316e057975' },
  { file: '20260922090000_trade_os_cap08_journey_alerts.sql', name: 'trade_os_cap08_journey_alerts', blob: '1c18274d50572392f83eca3f84d5ad84e946743f' },
])

const SHARED_FUNCTION = 'communication_domain_event_dedupe_key'

// what each migration OWNS — a partial state (objects without a ledger row, or a ledger row without its objects) is a STOP
const OWNS = Object.freeze({
  '20260920090000_trade_os_cap04_shipment_legs.sql': {
    tables: ['diaspora_shipment_legs'], functions: ['carup_shipment_leg_guard', 'carup_shipment_leg_no_delete'],
    triggers: [['diaspora_shipment_legs', 'trg_shipment_leg_guard'], ['diaspora_shipment_legs', 'trg_shipment_leg_no_delete']],
  },
  '20260921090000_trade_os_cap05_shipment_observations.sql': {
    tables: ['diaspora_shipment_observations'], functions: ['carup_shipment_observation_guard', 'carup_shipment_observation_no_delete'],
    triggers: [['diaspora_shipment_observations', 'trg_shipment_observation_guard'], ['diaspora_shipment_observations', 'trg_shipment_observation_no_delete']],
  },
  '20260922090000_trade_os_cap08_journey_alerts.sql': {
    tables: [], functions: ['communication_journey_alert_dedupe_key'],
    triggers: [['domain_events', 'trg_domain_events_journey_alert_dedupe']],
  },
})
export const NEW_TABLES = Object.freeze(Object.values(OWNS).flatMap((o) => o.tables))
export const NEW_FUNCTIONS = Object.freeze(Object.values(OWNS).flatMap((o) => o.functions))
const NEW_TRIGGERS = Object.values(OWNS).flatMap((o) => o.triggers)

const PREREQUISITE_TABLES = ['tenants', 'users', 'diaspora_shipments', 'diaspora_shipment_stage_events', 'domain_events', 'communication_templates', 'communication_template_versions']
// the foreign keys and the trigger depend on these types, so they are checked rather than assumed
const PREREQUISITE_COLUMNS = [
  ['tenants', 'id', 'uuid'], ['users', 'id', 'text'], ['diaspora_shipments', 'id', 'uuid'], ['diaspora_shipments', 'tenant_id', 'uuid'],
  ['domain_events', 'dedupe_key', 'text'], ['domain_events', 'payload', 'jsonb'], ['domain_events', 'event_type', 'text'],
  ['communication_templates', 'template_key', 'text'], ['communication_template_versions', 'required_variables', 'jsonb'],
]

export class HarnessStop extends Error {
  constructor(code, message) { super(message); this.name = 'HarnessStop'; this.code = code }
}

const gitBlob = (buffer) => crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex')
const md5 = (text) => crypto.createHash('md5').update(text).digest('hex')
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')

/** One surface over a `pg` client and a PGlite instance, so the same code is rehearsed and run. */
export function makeDb(client) {
  const isPglite = typeof client.exec === 'function' && typeof client.close === 'function'
  return {
    kind: isPglite ? 'pglite' : 'pg',
    // `pg` returns rowCount; PGlite does not. Normalised here, once, so an existence check can never read as "absent".
    query: async (sql, params) => {
      const result = await client.query(sql, params)
      return { ...result, rows: result.rows, rowCount: result.rowCount ?? result.rows.length }
    },
    exec: (sql) => (isPglite ? client.exec(sql) : client.query(sql)),
  }
}

export function ensureStagingDbUrl(value = process.env.DIASPORA_STAGING_DATABASE_URL || '') {
  if (!value) throw new HarnessStop('NO_DATABASE_URL', 'DIASPORA_STAGING_DATABASE_URL is not configured')
  if (value.includes(FORBIDDEN_PRODUCTION_PROJECT_REF) || !value.includes(EXPECTED_STAGING_PROJECT_REF)) {
    throw new HarnessStop('NOT_APPROVED_STAGING', 'REFUSING T11-CAP CONVERGENCE OUTSIDE APPROVED STAGING')
  }
  return value
}

export function loadMigration(m, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const buffer = fs.readFileSync(path.join(migrationsDir, m.file))
  const blob = gitBlob(buffer)
  if (blob !== m.blob) throw new HarnessStop('BLOB_MISMATCH', `${m.file}: git blob ${blob} != pinned ${m.blob} — refusing to apply an unreviewed migration`)
  const { up, down } = parseMigrationSource(buffer.toString('utf8'), m.file)
  return { ...m, version: deriveVersion(m.file), up, down, upSha256: sha256(up) }
}

/** Function bodies exactly as Postgres will store them (`prosrc` is the text between the dollar quotes). */
export function expectedFunctionBodies(up) {
  const out = new Map()
  // Both writing styles are in use: `... AS $$ body $$ LANGUAGE plpgsql;` and `... LANGUAGE plpgsql AS $$ body $$;`
  for (const match of up.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\([^)]*\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/g)) out.set(match[1], md5(match[2]))
  return out
}

async function identity(db) {
  return (await db.query(`select current_database() as db, current_user as usr, current_setting('transaction_read_only') as ro, version() as pg`)).rows[0]
}

async function sharedFunction(db) {
  const { rows } = await db.query(`select md5(p.prosrc) as md5, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = $1`, [SHARED_FUNCTION])
  if (rows.length !== 1) return { present: false, count: rows.length }
  const src = rows[0].src
  return {
    present: true, count: 1, md5: rows[0].md5, length: src.length,
    // which lineages' branches are live — informational, and the reason this migration must never re-state the function
    branches: {
      marketplace_inquiry: src.includes('marketplace.inquiry.created'), email_verified: src.includes('user.email.verified'),
      trust_presentation: src.includes('vehicle.trust.presentation_changed'), service_network_o4: src.includes('service.case.accepted'),
      garage: src.includes('garage.estimate.sent'), journey_alert: src.includes('diaspora.journey.alert'),
    },
  }
}

async function ledgerRows(db) {
  const versions = MIGRATIONS.map((m) => deriveVersion(m.file))
  const { rows } = await db.query(`select version, name, created_by from supabase_migrations.schema_migrations where version = any($1::text[]) order by version`, [versions])
  return rows
}

async function presentObjects(db) {
  const tables = (await db.query(`select table_name as n from information_schema.tables where table_schema='public' and table_name = any($1::text[])`, [NEW_TABLES])).rows.map((r) => r.n)
  const functions = (await db.query(`select p.proname as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname = any($1::text[])`, [NEW_FUNCTIONS])).rows.map((r) => r.n)
  const triggers = (await db.query(`select c.relname as t, g.tgname as n from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace s on s.oid=c.relnamespace
    where not g.tgisinternal and s.nspname='public' and g.tgname = any($1::text[])`, [NEW_TRIGGERS.map(([, name]) => name)])).rows.map((r) => `${r.t}.${r.n}`)
  return { tables, functions, triggers }
}

export async function preflight(db, ctx = {}) {
  const resultsDir = ctx.resultsDir
  const conn = await identity(db)
  const missingTables = (await db.query(`select t from unnest($1::text[]) t where not exists
    (select 1 from information_schema.tables where table_schema='public' and table_name = t)`, [PREREQUISITE_TABLES])).rows.map((r) => r.t)
  const ledgerExists = (await db.query(`select to_regclass('supabase_migrations.schema_migrations') as r`)).rows[0].r
  const wrongColumns = []
  for (const [table, column, type] of PREREQUISITE_COLUMNS) {
    const row = (await db.query(`select data_type from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`, [table, column])).rows[0]
    if (!row || row.data_type !== type) wrongColumns.push(`${table}.${column}: ${row ? row.data_type : 'missing'} != ${type}`)
  }
  const dedupeIndex = (await db.query(`select 1 from pg_indexes where schemaname='public' and tablename='domain_events' and indexname='idx_domain_events_dedupe_key'`)).rowCount
  const shared = await sharedFunction(db)

  const result = {
    mode: 'preflight', at: new Date().toISOString(), product_sha: ctx.productSha || 'unset', target_project_ref: EXPECTED_STAGING_PROJECT_REF,
    production_project_ref_refused: FORBIDDEN_PRODUCTION_PROJECT_REF, connection: conn,
    missing_prerequisite_tables: missingTables, wrong_prerequisite_columns: wrongColumns, ledger_table_present: Boolean(ledgerExists),
    dedupe_unique_index_present: dedupeIndex > 0, shared_function: shared,
  }
  const blockers = []
  if (missingTables.length) blockers.push(`prerequisite tables absent: ${missingTables.join(', ')}`)
  if (wrongColumns.length) blockers.push(`prerequisite column types differ: ${wrongColumns.join('; ')}`)
  if (!ledgerExists) blockers.push('supabase_migrations.schema_migrations is absent')
  if (!shared.present) blockers.push(`the shared dedupe function ${SHARED_FUNCTION} is absent or ambiguous (${shared.count})`)
  if (!dedupeIndex) blockers.push('idx_domain_events_dedupe_key is absent')
  if (blockers.length) {
    result.verdict = 'BLOCKED_PREREQUISITES'; result.blockers = blockers
    writeJson(resultsDir, 'preflight.json', result)
    throw new HarnessStop('BLOCKED_PREREQUISITES', blockers.join(' | '))
  }

  const ledger = await ledgerRows(db)
  const have = new Set(ledger.map((r) => r.version))
  const present = await presentObjects(db)
  const integrity = []
  let gap = false
  MIGRATIONS.forEach((m, index) => {
    const version = deriveVersion(m.file)
    const owns = OWNS[m.file]
    const inLedger = have.has(version)
    if (inLedger && MIGRATIONS.slice(0, index).some((earlier) => !have.has(deriveVersion(earlier.file)))) gap = true
    const tablesHave = owns.tables.filter((t) => present.tables.includes(t))
    const fnHave = owns.functions.filter((f) => present.functions.includes(f))
    const trgHave = owns.triggers.filter(([t, n]) => present.triggers.includes(`${t}.${n}`))
    const total = owns.tables.length + owns.functions.length + owns.triggers.length
    const found = tablesHave.length + fnHave.length + trgHave.length
    if (inLedger && found !== total) integrity.push(`${m.file}: in the ledger but only ${found}/${total} of its objects exist`)
    if (!inLedger && found > 0) integrity.push(`${m.file}: NOT in the ledger but ${found}/${total} of its objects already exist`)
  })
  if (gap) integrity.push('the ledger has a later migration without an earlier one (not a prefix)')
  result.ledger_rows = ledger
  result.objects_present = present
  result.integrity_problems = integrity
  result.verdict = integrity.length ? 'STOP_PARTIAL_STATE'
    : ledger.length === MIGRATIONS.length ? 'ALREADY_APPLIED'
      : ledger.length === 0 ? 'READY_TO_APPLY' : 'RESUME_PREFIX_APPLIED'
  writeJson(resultsDir, 'preflight.json', result)
  if (result.verdict === 'STOP_PARTIAL_STATE') throw new HarnessStop('STOP_PARTIAL_STATE', `staging integrity: ${integrity.join('; ')}`)
  return result
}

export async function apply(db, ctx = {}) {
  const migrationsDir = ctx.migrationsDir || DEFAULT_MIGRATIONS_DIR
  const pre = await preflight(db, ctx)
  if (pre.connection.ro !== 'off') throw new HarnessStop('READ_ONLY', `connection is read-only (${pre.connection.ro}) — cannot apply`)
  if (pre.verdict === 'ALREADY_APPLIED') return { applied: [], note: 'all three migrations are already in the ledger' }
  // `ctx.migrations` lets a test supply the same plan with different pinned blobs (to rehearse a migration that
  // misbehaves); the real run never sets it, and the file names — hence the ledger versions — are the same either way.
  const loaded = (ctx.migrations || MIGRATIONS).map((m) => loadMigration(m, migrationsDir))
  const applied = []
  for (const m of loaded) {
    const exists = (await db.query(`select 1 from supabase_migrations.schema_migrations where version = $1`, [m.version])).rowCount
    if (exists) { applied.push({ version: m.version, action: 'skipped_already_in_ledger' }); continue }
    const started = Date.now()
    try {
      await db.exec('BEGIN')
      await db.exec(`SET LOCAL lock_timeout = '20s'`)
      await db.exec(`SET LOCAL statement_timeout = '120s'`)
      await db.exec(m.up)
      // THE TRIPWIRE. The first design of CAP-08 re-stated the shared function and would have deleted two other
      // lineages' branches. A migration that changes it in any way is rolled back here, before it can commit.
      const after = await sharedFunction(db)
      if (!after.present || after.md5 !== pre.shared_function.md5) {
        throw new HarnessStop('SHARED_FUNCTION_CHANGED', `${m.file} changed ${SHARED_FUNCTION} (${pre.shared_function.md5} -> ${after.md5}) — rolled back`)
      }
      const pointer = `-- applied from kudzimusar/carup ${ctx.productSha || 'unset'}; git blob ${m.blob}; Up-SQL sha256 ${m.upSha256}`
      await db.query(`insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ($1, $2, $3::text[], $4)`,
        [m.version, m.name, [pointer], LEDGER_CREATED_BY])
      await db.exec('COMMIT')
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => {})
      writeJson(ctx.resultsDir, 'apply.json', { applied, failed: { version: m.version, error: String(error.message || error), code: error.code || null } })
      throw new HarnessStop(error.code === 'SHARED_FUNCTION_CHANGED' ? 'SHARED_FUNCTION_CHANGED' : 'APPLY_FAILED', `${m.file} did not apply and was rolled back: ${error.message}`)
    }
    applied.push({ version: m.version, action: 'applied', ms: Date.now() - started, up_sha256: m.upSha256, blob: m.blob })
  }
  writeJson(ctx.resultsDir, 'apply.json', { at: new Date().toISOString(), product_sha: ctx.productSha || 'unset', shared_function_md5: pre.shared_function.md5, applied })
  return { applied, shared_function_md5: pre.shared_function.md5 }
}

/**
 * The catalog, as far as these three migrations own it. Used both to GENERATE the expected manifest (against the
 * tested PGlite world) and to read the live catalog, so the two can only differ if staging genuinely differs.
 */
export async function catalogSnapshot(db, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const bodies = new Map()
  for (const m of MIGRATIONS) for (const [name, hash] of expectedFunctionBodies(parseMigrationSource(fs.readFileSync(path.join(migrationsDir, m.file), 'utf8'), m.file).up)) bodies.set(name, hash)

  const functions = (await db.query(`select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, md5(p.prosrc) as body_md5, p.prosecdef as secdef,
      (p.prorettype = 'trigger'::regtype) as is_trigger, p.proconfig::text as config,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
      coalesce(p.proacl::text, '') ~ '(^\\{|,)=X/' as public_exec_explicit
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname = any($1::text[]) order by 1`, [NEW_FUNCTIONS])).rows
  const tables = (await db.query(`select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
      (select count(*)::int from information_schema.columns k where k.table_schema='public' and k.table_name=c.relname) as columns,
      (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')) as anon_any,
      (has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE')) as authenticated_any
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname = any($1::text[]) order by 1`, [NEW_TABLES])).rows
  const triggers = (await db.query(`select c.relname as table_name, g.tgname as name, g.tgenabled as enabled, (g.tgtype & 2) <> 0 as before_row_timing,
      (g.tgtype & 1) <> 0 as for_each_row, (g.tgtype & 4) <> 0 as on_insert, (g.tgtype & 8) <> 0 as on_delete, (g.tgtype & 16) <> 0 as on_update,
      pg_get_triggerdef(g.oid) as def
    from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace s on s.oid=c.relnamespace
    where not g.tgisinternal and s.nspname='public' and g.tgname = any($1::text[]) order by 1,2`, [NEW_TRIGGERS.map(([, name]) => name)])).rows
    .map(({ def, ...rest }) => ({ ...rest, when_scopes_both_journey_events: def.includes('diaspora.journey.alert') && def.includes('diaspora.journey.exception') && /WHEN/i.test(def) }))
  const constraints = (await db.query(`select conrelid::regclass::text as table_name, conname as name, contype as type, convalidated as validated from pg_constraint
    where conrelid = any(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any($1::text[])) order by 1,2`, [NEW_TABLES])).rows
  const indexes = (await db.query(`select indexname as name from pg_indexes where schemaname='public' and tablename = any($1::text[]) order by 1`, [NEW_TABLES])).rows
  const domainTriggers = (await db.query(`select g.tgname as name from pg_trigger g where not g.tgisinternal and g.tgrelid='public.domain_events'::regclass order by 1`)).rows.map((r) => r.name)
  const template = (await db.query(`select t.template_key, t.classification, t.status, t.stakeholder_audience, v.version, v.channel, v.language, v.approval_status,
      v.subject_template, v.body_template, v.required_variables::text as required_variables
    from communication_templates t left join communication_template_versions v on v.template_id = t.id where t.template_key = 'journey_update_v1' order by v.version`)).rows
  return {
    functions: functions.map((f) => ({ ...f, expected_body_md5: bodies.get(f.name) || null })),
    tables, triggers, constraints, indexes, domain_events_triggers: domainTriggers, template,
  }
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
    if (l.anon_exec !== e.anon_exec || l.authenticated_exec !== e.authenticated_exec) note(`function ${key(e)} execute privileges differ`)
    if (e.name === 'communication_journey_alert_dedupe_key' && (l.anon_exec || l.authenticated_exec || l.public_exec_explicit)) note('communication_journey_alert_dedupe_key is executable by the browser or PUBLIC')
  }
  for (const l of live.functions) if (!expected.functions.some((e) => key(e) === key(l))) note(`unexpected function: ${key(l)}`)

  const liveTbl = new Map(live.tables.map((t) => [t.name, t]))
  for (const e of expected.tables) {
    const l = liveTbl.get(e.name)
    if (!l) { note(`table missing: ${e.name}`); continue }
    for (const k of Object.keys(e)) if (k !== 'name' && l[k] !== e[k]) note(`table ${e.name}.${k}: live ${l[k]} != expected ${e[k]}`)
    if (l.anon_any || l.authenticated_any) note(`table ${e.name} is reachable by the browser roles`)
    if (!l.rls || !l.force_rls) note(`table ${e.name} does not have FORCE RLS`)
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
  for (const e of expected.indexes) if (!live.indexes.some((i) => i.name === e.name)) note(`index missing: ${e.name}`)
  // domain_events must carry exactly the triggers it had plus the Journey one — nothing of anyone else's removed
  for (const name of expected.domain_events_triggers_must_include) if (!live.domain_events_triggers.includes(name)) note(`domain_events trigger missing: ${name}`)
  if (JSON.stringify(live.template) !== JSON.stringify(expected.template)) note('the governed template journey_update_v1 differs from the migration')
  return problems
}

export async function verify(db, ctx = {}) {
  const expected = JSON.parse(fs.readFileSync(ctx.manifest || DEFAULT_MANIFEST, 'utf8'))
  const live = await catalogSnapshot(db, ctx.migrationsDir)
  const problems = diffSnapshot(live, expected)
  const ledger = await ledgerRows(db)
  for (const m of MIGRATIONS) if (!ledger.some((r) => r.version === deriveVersion(m.file))) problems.push(`ledger row missing: ${m.file}`)
  const shared = await sharedFunction(db)
  if (!shared.present) problems.push('the shared dedupe function is missing')
  else if (ctx.sharedMd5 && shared.md5 !== ctx.sharedMd5) problems.push(`the shared dedupe function changed: ${ctx.sharedMd5} -> ${shared.md5}`)
  const result = {
    mode: 'verify', at: new Date().toISOString(), product_sha: ctx.productSha || 'unset', target_project_ref: EXPECTED_STAGING_PROJECT_REF,
    ledger_rows: ledger, shared_function: shared, domain_events_triggers: live.domain_events_triggers,
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
  const resultsDir = path.resolve(process.env.T11_CAP_RESULTS_DIR || 'test-results/t11-cap-stg')
  const ctx = { productSha: process.env.PRODUCT_SHA || 'unset', resultsDir }
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
      console.log(JSON.stringify({ verdict: r.verdict, ledger: r.ledger_rows.map((x) => x.version), shared_function_md5: r.shared_function.md5, branches: r.shared_function.branches, db: r.connection.db, user: r.connection.usr, read_only: r.connection.ro }))
    } else if (MODE === 'apply') {
      const a = await apply(db, ctx)
      console.log(JSON.stringify({ applied: a.applied.map((x) => `${x.version}:${x.action}`), shared_function_md5: a.shared_function_md5 || null }))
      const v = await verify(db, { ...ctx, sharedMd5: a.shared_function_md5 })
      console.log(JSON.stringify({ verdict: v.verdict, counts: v.counts, problems: v.problems.length }))
      if (v.problems.length) { for (const p of v.problems.slice(0, 40)) console.error(`  - ${p}`); throw new HarnessStop('CATALOG_DIFFERS', `${v.problems.length} catalog difference(s)`) }
    } else {
      const v = await verify(db, ctx)
      console.log(JSON.stringify({ verdict: v.verdict, counts: v.counts, problems: v.problems.length }))
      if (v.problems.length) { for (const p of v.problems.slice(0, 40)) console.error(`  - ${p}`); throw new HarnessStop('CATALOG_DIFFERS', `${v.problems.length} catalog difference(s)`) }
    }
  } catch (error) {
    if (error instanceof HarnessStop) { console.error(`${error.code === 'BLOCKED_PREREQUISITES' || error.code === 'NO_DATABASE_URL' || error.code === 'NOT_APPROVED_STAGING' || error.code === 'READ_ONLY' ? 'BLOCKED' : 'FAIL'}: ${error.message}`); process.exit(error.code === 'BLOCKED_PREREQUISITES' || error.code === 'NO_DATABASE_URL' || error.code === 'NOT_APPROVED_STAGING' || error.code === 'READ_ONLY' ? 2 : 1) }
    console.error(`ERROR: ${error.stack || error.message}`); process.exit(1)
  } finally { if (client) await client.end().catch(() => {}) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
