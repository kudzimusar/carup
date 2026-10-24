#!/usr/bin/env node
/**
 * GARAGE-1.0-FINAL — staging activation harness (evidence infrastructure, not product code).
 *
 *   --mode=preflight   read-only: prove the target is the approved staging project, report the ledger tip and
 *                      which of the five GARAGE-1.0 migrations are already present (partial state is a STOP).
 *   --mode=apply       apply the five migrations in order, each in ONE transaction together with its ledger row.
 *                      Idempotent: a migration whose ledger row exists is verified, never re-run.
 *   --mode=verify      diff the live catalog against the expected manifest generated from the tested PGlite world
 *                      (function md5(prosrc), privileges, RLS, columns, triggers, constraints, indexes).
 *
 * Hard-pinned to staging project eoyenigwevnxwwhyhaer. The production project ref is refused by name.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MODE = (process.argv.find((arg) => arg.startsWith('--mode=')) || '--mode=preflight').split('=')[1]
const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(HERE, '../../database/migrations')
const EXPECTED_MANIFEST = path.resolve(HERE, 'garage-final-stg01-expected-manifest.json')
const RESULTS_DIR = path.resolve(process.env.GARAGE_FINAL_RESULTS_DIR || 'test-results/garage-final-stg01')

const EXPECTED_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer'
const FORBIDDEN_PRODUCTION_PROJECT_REF = 'vhmnajoeicasaigiophh'
const PRODUCT_SHA = process.env.PRODUCT_SHA || 'unset'
const LEDGER_CREATED_BY = 'garage-1.0-final-campaign'
const OPS03_TIP = '20261023140000'

// version = 14-digit timestamp (the ledger convention); blob = the git blob of the committed migration file.
const MIGRATIONS = Object.freeze([
  { file: '20261024100000_garage_ops04_estimates_and_authorization.sql', version: '20261024100000', name: 'garage_ops04_estimates_and_authorization', blob: '931243a3279372828a4527e5f2989c992c2d8130' },
  { file: '20261024110000_garage_ops05_workshop_execution_gates.sql', version: '20261024110000', name: 'garage_ops05_workshop_execution_gates', blob: '57e431102bb009759076187b9b5e5d8b6dfe308f' },
  { file: '20261024120000_garage_ops06_parts_stock.sql', version: '20261024120000', name: 'garage_ops06_parts_stock', blob: '23a19fcb33eb0c9c8c791961f236570a664a46ee' },
  { file: '20261024130000_garage_ops07_invoice_payment_receipt.sql', version: '20261024130000', name: 'garage_ops07_invoice_payment_receipt', blob: '938d1d64e3e5a57202c1d54c46059578443656da' },
  { file: '20261024140000_garage_communications_events_and_template.sql', version: '20261024140000', name: 'garage_communications_events_and_template', blob: 'cca41ce14c6efa76df82c7de2ba054a1e7d2e824' },
])

const PREREQUISITE_TABLES = ['tenants', 'users', 'vehicles', 'service_cases', 'service_case_events', 'service_records', 'work_order_assignments',
  'mechanic_work_orders', 'mechanic_parts', 'garage_appointments', 'garage_branches', 'communication_templates', 'communication_template_versions',
  'partsentry_logs', 'service_record_parts', 'trust_audit_events', 'domain_events']
const PREREQUISITE_FUNCTIONS = ['mechanic_work_order_decide_authorization', 'garage_ops03_assert_admin', 'communication_domain_event_dedupe_key']
// which tables each migration owns (a migration with none is checked by the ledger and the catalog only)
const MIGRATION_TABLES = Object.freeze({
  '20261024100000': ['garage_estimates', 'garage_estimate_lines', 'garage_estimate_events'],
  '20261024120000': ['garage_stock_movements', 'garage_service_part_usage'],
  '20261024130000': ['garage_invoices', 'garage_invoice_lines', 'garage_invoice_events', 'garage_payment_records', 'garage_receipts', 'garage_document_counters'],
})
const NEW_TABLES = ['garage_estimates', 'garage_estimate_lines', 'garage_estimate_events', 'garage_stock_movements', 'garage_service_part_usage',
  'garage_invoices', 'garage_invoice_lines', 'garage_invoice_events', 'garage_payment_records', 'garage_receipts', 'garage_document_counters']

const fail = (message) => { console.error(`FAIL: ${message}`); process.exit(1) }
const blocked = (message) => { console.error(`BLOCKED: ${message}`); process.exit(2) }
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

function ensureStagingDbUrl() {
  const value = process.env.DIASPORA_STAGING_DATABASE_URL || ''
  if (!value) blocked('DIASPORA_STAGING_DATABASE_URL is not configured')
  if (value.includes(FORBIDDEN_PRODUCTION_PROJECT_REF) || !value.includes(EXPECTED_STAGING_PROJECT_REF)) {
    blocked('REFUSING GARAGE-1.0 FINAL ACTIVATION OUTSIDE APPROVED STAGING')
  }
  return value
}
const cleaned = (value) => value.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '')

async function connect() {
  const url = cleaned(ensureStagingDbUrl())
  // TLS is mandatory for the real staging pooler; only a loopback host (the local rehearsal server) may skip it.
  const loopback = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url)
  const client = new pg.Client({ connectionString: url, ssl: loopback ? false : { rejectUnauthorized: false } })
  try { await client.connect() } catch (error) { await client.end().catch(() => {}); throw error }
  return client
}

const gitBlob = (buffer) => crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex')
const upSection = (sql) => sql.split(/^-- \+migrate Down/m)[0]

function loadMigration(m) {
  const buffer = fs.readFileSync(path.join(MIGRATIONS_DIR, m.file))
  const blob = gitBlob(buffer)
  if (blob !== m.blob) fail(`${m.file}: git blob ${blob} != pinned ${m.blob} — refusing to apply an unreviewed migration`)
  const text = buffer.toString('utf8')
  if (!/^-- \+migrate Up/m.test(text)) fail(`${m.file}: missing "-- +migrate Up" marker`)
  const up = upSection(text)
  return { ...m, up, upSha256: crypto.createHash('sha256').update(up).digest('hex') }
}

async function ledgerRows(client) {
  const { rows } = await client.query(
    `select version, name, created_by from supabase_migrations.schema_migrations where version >= $1 order by version`, [OPS03_TIP])
  return rows
}
async function existingNewTables(client) {
  const { rows } = await client.query(
    `select table_name from information_schema.tables where table_schema='public' and table_name = any($1::text[]) order by 1`, [NEW_TABLES])
  return rows.map((r) => r.table_name)
}

async function preflight(client) {
  const identity = (await client.query(`select current_database() db, current_user usr, current_setting('transaction_read_only') ro, version() pg`)).rows[0]
  const ledger = await ledgerRows(client)
  const tip = ledger[ledger.length - 1]?.version || null
  const present = await existingNewTables(client)
  const missingTables = (await client.query(
    `select t from unnest($1::text[]) t where not exists (select 1 from information_schema.tables where table_schema='public' and table_name=t)`, [PREREQUISITE_TABLES])).rows.map((r) => r.t)
  const missingFunctions = (await client.query(
    `select f from unnest($1::text[]) f where not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f)`, [PREREQUISITE_FUNCTIONS])).rows.map((r) => r.f)
  const ours = ledger.filter((r) => MIGRATIONS.some((m) => m.version === r.version))
  const result = {
    mode: 'preflight', at: new Date().toISOString(), product_sha: PRODUCT_SHA, target_project_ref: EXPECTED_STAGING_PROJECT_REF,
    production_project_ref_refused: FORBIDDEN_PRODUCTION_PROJECT_REF, connection: identity,
    ledger_tip: tip, ledger_since_ops03: ledger, our_ledger_rows: ours.map((r) => r.version),
    new_tables_present: present, missing_prerequisite_tables: missingTables, missing_prerequisite_functions: missingFunctions,
  }
  if (missingTables.length || missingFunctions.length) { writeJson(path.join(RESULTS_DIR, 'preflight.json'), { ...result, verdict: 'BLOCKED_PREREQUISITES' }); blocked(`prerequisites absent: ${[...missingTables, ...missingFunctions].join(', ')}`) }
  // Migrations are applied in order, each atomically with its ledger row, so the ledger must be a PREFIX of the plan
  // (resumable after a transient failure). A gap, or a ledger row that disagrees with its tables, is a staging-integrity STOP.
  const integrity = []
  const ledgerVersions = new Set(ours.map((r) => r.version))
  let gap = false
  MIGRATIONS.forEach((m, index) => {
    const has = ledgerVersions.has(m.version)
    if (has && MIGRATIONS.slice(0, index).some((earlier) => !ledgerVersions.has(earlier.version))) gap = true
    const tables = MIGRATION_TABLES[m.version] || []
    const have = tables.filter((t) => present.includes(t))
    if (tables.length && has && have.length !== tables.length) integrity.push(`${m.version}: in ledger but only ${have.length}/${tables.length} tables present`)
    if (tables.length && !has && have.length > 0) integrity.push(`${m.version}: NOT in ledger but ${have.length}/${tables.length} of its tables exist`)
  })
  if (gap) integrity.push('ledger has a later migration without an earlier one (not a prefix)')
  result.integrity_problems = integrity
  result.verdict = integrity.length ? 'STOP_PARTIAL_STATE'
    : ours.length === MIGRATIONS.length ? 'ALREADY_APPLIED'
    : ours.length === 0 ? 'READY_TO_APPLY' : 'RESUME_PREFIX_APPLIED'
  writeJson(path.join(RESULTS_DIR, 'preflight.json'), result)
  console.log(JSON.stringify({ verdict: result.verdict, ledger_tip: tip, our_rows: result.our_ledger_rows, new_tables_present: present.length, db: identity.db, user: identity.usr, read_only: identity.ro }))
  if (result.verdict === 'STOP_PARTIAL_STATE') fail(`staging integrity: ${integrity.join('; ')}`)
  return result
}

async function apply(client) {
  const pre = await preflight(client)
  if (pre.connection.ro !== 'off') blocked(`connection is read-only (${pre.connection.ro}) — cannot apply`)
  if (pre.verdict === 'ALREADY_APPLIED') { console.log('All five migrations are already in the ledger; nothing to apply.'); return [] }
  const loaded = MIGRATIONS.map(loadMigration)
  const applied = []
  for (const m of loaded) {
    const exists = (await client.query(`select 1 from supabase_migrations.schema_migrations where version = $1`, [m.version])).rowCount
    if (exists) { applied.push({ version: m.version, action: 'skipped_already_in_ledger' }); continue }
    const started = Date.now()
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL lock_timeout = '20s'`)
      await client.query(`SET LOCAL statement_timeout = '120s'`)
      await client.query(m.up)
      const pointer = `-- applied from kudzimusar/carup ${PRODUCT_SHA}; git blob ${m.blob}; Up-SQL sha256 ${m.upSha256}`
      await client.query(
        `insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ($1, $2, $3::text[], $4)`,
        [m.version, m.name, [pointer], LEDGER_CREATED_BY])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      writeJson(path.join(RESULTS_DIR, 'apply.json'), { applied, failed: { version: m.version, error: String(error.message || error), code: error.code || null } })
      fail(`${m.file} did not apply and was rolled back: ${error.message}`)
    }
    applied.push({ version: m.version, action: 'applied', ms: Date.now() - started, up_sha256: m.upSha256, blob: m.blob })
    console.log(`applied ${m.version} in ${Date.now() - started} ms`)
  }
  writeJson(path.join(RESULTS_DIR, 'apply.json'), { at: new Date().toISOString(), product_sha: PRODUCT_SHA, applied })
  return applied
}

async function verify(client) {
  const expected = JSON.parse(fs.readFileSync(EXPECTED_MANIFEST, 'utf8'))
  const problems = []
  const note = (what) => problems.push(what)

  const functions = (await client.query(`select p.proname name, pg_get_function_identity_arguments(p.oid) args, md5(p.prosrc) body_md5, p.prosecdef secdef, (p.prorettype = 'trigger'::regtype) is_trigger,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec, has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE') service_role_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ~ '^garage_ops0[4-7]_' order by 1`)).rows
  // identity = name + argument types: a same-name overload is a DIFFERENT function and must never hide a tampered original
  const fnKey = (f) => `${f.name}(${f.args})`
  const liveFn = new Map(functions.map((f) => [fnKey(f), f]))
  if (liveFn.size !== functions.length) note('duplicate function identities on staging')
  for (const e of expected.functions) {
    const l = liveFn.get(fnKey(e))
    if (!l) { note(`function missing: ${fnKey(e)}`); continue }
    if (l.body_md5 !== e.body_md5) note(`function body differs: ${fnKey(e)}`)
    for (const k of ['secdef', 'is_trigger', 'anon_exec', 'authenticated_exec', 'service_role_exec']) {
      if (l[k] !== e[k]) note(`function ${fnKey(e)}.${k}: live ${l[k]} != expected ${e[k]}`)
    }
  }
  for (const l of functions) if (!expected.functions.some((e) => fnKey(e) === fnKey(l))) note(`unexpected function on staging: ${fnKey(l)}`)

  const tables = (await client.query(`select c.relname name, c.relrowsecurity rls, c.relforcerowsecurity force_rls,
      (select count(*)::int from information_schema.columns k where k.table_schema='public' and k.table_name=c.relname) columns,
      has_table_privilege('anon', c.oid, 'SELECT') anon_select, has_table_privilege('authenticated', c.oid, 'SELECT') authenticated_select,
      has_table_privilege('service_role', c.oid, 'SELECT') service_select, has_table_privilege('service_role', c.oid, 'INSERT') service_insert,
      has_table_privilege('service_role', c.oid, 'UPDATE') service_update, has_table_privilege('service_role', c.oid, 'DELETE') service_delete
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any($1::text[]) order by 1`, [NEW_TABLES])).rows
  const liveTbl = new Map(tables.map((t) => [t.name, t]))
  for (const e of expected.tables) {
    const l = liveTbl.get(e.name)
    if (!l) { note(`table missing: ${e.name}`); continue }
    for (const k of Object.keys(e)) if (k !== 'name' && l[k] !== e[k]) note(`table ${e.name}.${k}: live ${l[k]} != expected ${e[k]}`)
  }

  const triggers = (await client.query(`select c.relname table_name, g.tgname name from pg_trigger g join pg_class c on c.oid=g.tgrelid
    where not g.tgisinternal and g.tgname ~ '^trg_garage_ops0[4-7]_' order by 1,2`)).rows
  const key = (t) => `${t.table_name}.${t.name}`
  const liveTrg = new Set(triggers.map(key))
  for (const e of expected.triggers) if (!liveTrg.has(key(e))) note(`trigger missing: ${key(e)}`)
  for (const l of triggers) if (!expected.triggers.some((e) => key(e) === key(l))) note(`unexpected trigger: ${key(l)}`)

  const parts = (await client.query(`select column_name name, is_nullable from information_schema.columns where table_schema='public' and table_name='mechanic_parts'
    and column_name in ('unit_cost','sell_price','price_currency','is_active','created_by_user_id','updated_at') order by 1`)).rows
  for (const e of expected.partsColumns) {
    const l = parts.find((p) => p.name === e.name)
    if (!l) note(`mechanic_parts column missing: ${e.name}`)
    else if (l.is_nullable !== e.is_nullable) note(`mechanic_parts.${e.name} nullable ${l.is_nullable} != ${e.is_nullable}`)
  }

  const constraints = (await client.query(`select conrelid::regclass::text table_name, conname name, convalidated validated from pg_constraint
    where conname ~ '^garage_ops0[4-7]_' order by 1,2`)).rows
  for (const e of expected.constraints) {
    const l = constraints.find((c) => c.name === e.name && c.table_name === e.table_name)
    if (!l) note(`constraint missing: ${e.table_name}.${e.name}`)
    else if (l.validated !== e.validated) note(`constraint ${e.name} validated ${l.validated} != ${e.validated}`)
  }

  const indexes = (await client.query(`select indexname name from pg_indexes where schemaname='public' and (indexname ~ '^(uq|idx)_garage_ops0[4-7]_' or indexname='uq_mechanic_work_orders_id_tenant') order by 1`)).rows
  for (const e of expected.indexes) if (!indexes.some((i) => i.name === e.name)) note(`index missing: ${e.name}`)

  // Communications migration: the Garage template and the rebuilt dedupe function.
  const comms = loadMigration(MIGRATIONS[4])
  const tpl = (await client.query(`select count(*)::int n from communication_templates where template_key = 'garage_commercial_update_v1'`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n
  if (tpl < 1) note('communication template garage_commercial_update_v1 not found')
  const dedupe = (await client.query(`select md5(p.prosrc) h, position('GARAGE' in upper(p.prosrc)) > 0 has_garage from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = 'communication_domain_event_dedupe_key'`)).rows
  const body = comms.up.match(/communication_domain_event_dedupe_key\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/)
  const expectedDedupeMd5 = body ? crypto.createHash('md5').update(body[1]).digest('hex') : null
  if (dedupe.length !== 1) note(`dedupe function count ${dedupe.length}`)
  else if (expectedDedupeMd5 && dedupe[0].h !== expectedDedupeMd5) note('communication_domain_event_dedupe_key body differs from migration 20261024140000')

  const ledger = await ledgerRows(client)
  for (const m of MIGRATIONS) if (!ledger.some((r) => r.version === m.version)) note(`ledger row missing: ${m.version}`)

  const result = {
    mode: 'verify', at: new Date().toISOString(), product_sha: PRODUCT_SHA, target_project_ref: EXPECTED_STAGING_PROJECT_REF,
    migration_tip: ledger[ledger.length - 1]?.version || null, ledger_since_ops03: ledger,
    counts: { functions: functions.length, tables: tables.length, triggers: triggers.length, constraints: constraints.length, indexes: indexes.length },
    expected_counts: { functions: expected.functions.length, tables: expected.tables.length, triggers: expected.triggers.length, constraints: expected.constraints.length, indexes: expected.indexes.length },
    anon_executable_functions: functions.filter((f) => f.anon_exec).map((f) => `${f.name}${f.is_trigger ? ' (trigger)' : ''}`),
    anon_or_authenticated_table_select: tables.filter((t) => t.anon_select || t.authenticated_select).map((t) => t.name),
    all_new_tables_rls_forced: tables.every((t) => t.rls && t.force_rls),
    garage_template_rows: tpl, dedupe_function_matches_migration: dedupe.length === 1 && dedupe[0].h === expectedDedupeMd5,
    problems, verdict: problems.length === 0 ? 'CATALOG_MATCHES_EXPECTED' : 'CATALOG_DIFFERS',
  }
  writeJson(path.join(RESULTS_DIR, 'verify.json'), result)
  console.log(JSON.stringify({ verdict: result.verdict, migration_tip: result.migration_tip, counts: result.counts, problems: problems.length }))
  if (problems.length) { for (const p of problems.slice(0, 40)) console.error(`  - ${p}`); fail(`${problems.length} catalog difference(s)`) }
}

async function main() {
  if (!['preflight', 'apply', 'verify'].includes(MODE)) blocked(`unsupported --mode=${MODE}`)
  const client = await connect()
  try {
    if (MODE === 'preflight') await preflight(client)
    else if (MODE === 'apply') { await apply(client); await verify(client) }
    else await verify(client)
  } finally { await client.end().catch(() => {}) }
}
main().catch((error) => { console.error(`ERROR: ${error.stack || error.message}`); process.exit(1) })
