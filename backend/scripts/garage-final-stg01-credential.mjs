#!/usr/bin/env node
/**
 * GARAGE-1.0-FINAL-STG01 — staging UAT window harness (evidence infrastructure only).
 *
 * Hard-pinned to THREE synthetic staging identities and refuses anything outside the approved staging
 * project. The runner NEVER sees a plaintext credential: the operator generates the passwords on their own
 * machine and commits only the scrypt hashes. The harness restores the exact prior state: every pinned
 * identity ends with password_hash NULL and no session created during the window is left valid.
 *
 *   garage admin   uat_ops01_owner_20261022a            (admin of the retained synthetic Garage)
 *   mechanic       uat_ops01_mech01_20261022a           (mechanic of the same Garage)
 *   customer       uat_final_customer_20261024a         (synthetic vehicle owner; provisioned here, idempotent)
 *
 * Modes: preflight | provision | grant | cleanup | verify-clean | witness
 *
 * `witness` is an independent, read-only DB readout of everything the window changed, so the browser evidence
 * can be reconciled against the database by something that is not the browser.
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const MODE = (process.argv.find((arg) => arg.startsWith('--mode=')) || '--mode=preflight').split('=')[1]

const EXPECTED_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer'
const FORBIDDEN_PRODUCTION_PROJECT_REF = 'vhmnajoeicasaigiophh'
const GARAGE_ID = '442c82c1-fc69-46ff-a138-712a6504ac98'
const HASH_FORMAT = /^scrypt:[A-Za-z0-9+/=_-]{8,}:[0-9a-f]{64,}$/

const IDENTITIES = Object.freeze({
  admin: { id: 'uat_ops01_owner_20261022a', email: 'ops01.owner.20261022a@carup-staging.test', platformRole: 'owner', garageRole: 'admin', provisioned: false },
  mechanic: { id: 'uat_ops01_mech01_20261022a', email: 'ops01.mechanic.01.20261022a@carup-staging.test', platformRole: 'mechanic', garageRole: 'mechanic', provisioned: false },
  customer: { id: 'uat_final_customer_20261024a', email: 'final.customer.20261024a@carup-staging.test', platformRole: 'owner', garageRole: null, provisioned: true,
    name: 'SYNTHETIC / UAT FINAL CUSTOMER 20261024A' },
})
const CUSTOMER_VEHICLE = Object.freeze({ vin: 'UATFINAL202610241', make: 'SYNTHETIC', model: 'UAT FINAL SERVICE FIXTURE', year: 2026, mileage: 15000, price: 0, status: 'UAT' })

const RUNNER_TEMP = process.env.RUNNER_TEMP || '/tmp'
const RESULTS_DIR = path.resolve(process.env.GARAGE_FINAL_RESULTS_DIR || 'test-results/garage-final-stg01')
const file = (suffix) => path.join(RUNNER_TEMP, `garage-final-${suffix}`)
const PRE_SESSIONS_FILE = file('pre-session-ids.json')
const WINDOW_FILE = file('window-start.json')
const PREFLIGHT_FILE = path.join(RESULTS_DIR, 'credential-preflight.json')
const CLEANUP_FILE = path.join(RESULTS_DIR, 'credential-cleanup.json')
const WITNESS_FILE = path.join(RESULTS_DIR, 'db-witness.json')

function fail(message) { console.error(`FAIL: ${message}`); process.exit(1) }
function blocked(message) { console.error(`BLOCKED: ${message}`); process.exit(2) }
function ensureMode() {
  if (!['preflight', 'provision', 'grant', 'cleanup', 'verify-clean', 'witness'].includes(MODE)) blocked(`unsupported --mode=${MODE}`)
}
function ensureStagingDbUrl() {
  const value = process.env.DIASPORA_STAGING_DATABASE_URL || ''
  if (!value) blocked('DIASPORA_STAGING_DATABASE_URL is not configured')
  if (value.includes(FORBIDDEN_PRODUCTION_PROJECT_REF) || !value.includes(EXPECTED_STAGING_PROJECT_REF)) {
    blocked('REFUSING GARAGE FINAL CREDENTIAL OPERATION OUTSIDE APPROVED STAGING')
  }
  return value
}
const cleaned = (value) => value.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '')
function writePrivate(target, value) { fs.writeFileSync(target, value, { mode: 0o600 }); fs.chmodSync(target, 0o600) }
function writeJson(target, value) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n') }

async function connect() {
  const url = cleaned(ensureStagingDbUrl())
  // TLS is mandatory for the real staging pooler; only a loopback host (the local rehearsal server) may skip it.
  const loopback = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url)
  const client = new pg.Client({ connectionString: url, ssl: loopback ? false : { rejectUnauthorized: false } })
  try { await client.connect() } catch (error) { await client.end().catch(() => {}); throw error }
  return client
}

async function readIdentity(client, who, { lock = false } = {}) {
  const spec = IDENTITIES[who]
  const result = await client.query(`
    select u.id, u.email, u.role as platform_role, u.password_hash,
           (select tu.role from public.tenant_users tu where tu.user_id = u.id and tu.tenant_id = $2::uuid) as garage_role
      from public.users u where u.id = $1 ${lock ? 'for update of u' : ''}`, [spec.id, GARAGE_ID])
  if (result.rowCount === 0) return null
  const row = result.rows[0]
  const problems = []
  if (row.email !== spec.email) problems.push('email drift')
  if (row.platform_role !== spec.platformRole) problems.push('platform role drift')
  if ((row.garage_role || null) !== spec.garageRole) problems.push('garage membership drift')
  if (problems.length) blocked(`${who}: pinned identity invariant failure: ${problems.join(', ')}`)
  return row
}

async function validSessionIds(client) {
  const ids = Object.values(IDENTITIES).map((i) => i.id)
  const result = await client.query(`
    select user_id, id::text as id from public.user_sessions
     where user_id = any($1::text[]) and is_valid = true and expires_at::timestamptz > now() order by id::text`, [ids])
  return result.rows.map((r) => `${r.user_id}:${r.id}`)
}

async function preflight(client) {
  const summary = {}
  for (const who of Object.keys(IDENTITIES)) {
    const row = await readIdentity(client, who)
    if (!row) {
      if (!IDENTITIES[who].provisioned) blocked(`${who}: pinned identity is absent`)
      summary[who] = { present: false, will_be_provisioned: true }
      continue
    }
    if (row.password_hash != null) blocked(`STOP — CREDENTIAL STATE DRIFT (${who})`)
    summary[who] = { present: true, password_hash_is_null: true }
  }
  const sessions = await validSessionIds(client)
  writePrivate(PRE_SESSIONS_FILE, JSON.stringify(sessions))
  writeJson(PREFLIGHT_FILE, { staging_project_ref: EXPECTED_STAGING_PROJECT_REF, garage_tenant_id: GARAGE_ID, identities: summary, valid_session_ids: sessions })
  console.log(JSON.stringify({ staging_guard: 'PASS', identities: summary, pre_existing_valid_session_count: sessions.length }))
}

/** Idempotent: the synthetic customer and their one vehicle. Nothing else, and nothing in the Garage tenant. */
async function provision(client) {
  const c = IDENTITIES.customer
  await client.query('begin')
  try {
    await client.query(`
      insert into public.users (id, name, email, role, join_date)
      values ($1, $2, $3, $4, to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
      on conflict (id) do nothing`, [c.id, c.name, c.email, c.platformRole])
    const v = CUSTOMER_VEHICLE
    await client.query(`
      insert into public.vehicles (vin, make, model, year, mileage, price, owner_id, status)
      values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (vin) do nothing`, [v.vin, v.make, v.model, v.year, v.mileage, v.price, c.id, v.status])
    const check = await client.query('select owner_id from public.vehicles where vin = $1', [v.vin])
    if (check.rowCount !== 1 || check.rows[0].owner_id !== c.id) throw new Error('synthetic vehicle is not owned by the synthetic customer')
    await readIdentity(client, 'customer')
    await client.query('commit')
  } catch (error) { await client.query('rollback'); throw error }
  console.log(JSON.stringify({ provisioned: 'synthetic customer + vehicle', customer: c.id, vin: CUSTOMER_VEHICLE.vin }))
}

/** Grant the operator-supplied scrypt hashes. The runner never holds, generates or prints a plaintext. */
async function grant(client) {
  if (!fs.existsSync(PRE_SESSIONS_FILE)) blocked('Run --mode=preflight before credential grant')
  const hashesFile = process.env.GARAGE_FINAL_WINDOW_HASHES_FILE || ''
  if (!hashesFile || !fs.existsSync(hashesFile)) blocked('GARAGE_FINAL_WINDOW_HASHES_FILE is missing')
  const supplied = JSON.parse(fs.readFileSync(hashesFile, 'utf8'))
  const granted = {}
  for (const who of Object.keys(IDENTITIES)) {
    const hash = supplied[who]
    if (typeof hash !== 'string' || !HASH_FORMAT.test(hash)) blocked(`${who}: supplied hash is not the governed scrypt format`)
    granted[who] = { hash, spec: IDENTITIES[who] }
  }
  if (new Set(Object.values(granted).map((g) => g.hash)).size !== 3) blocked('the three supplied hashes must be distinct')
  // runner-private copies FIRST, so an always() cleanup can compare the exact temporary hash even if a later step dies
  for (const [who, { hash }] of Object.entries(granted)) writePrivate(file(`${who}-hash`), hash)

  await client.query('begin')
  try {
    const started = (await client.query('select now()::text as ts, clock_timestamp()::text as wall')).rows[0]
    for (const [who, { hash, spec }] of Object.entries(granted)) {
      const row = await readIdentity(client, who, { lock: true })
      if (!row) throw new Error(`${who}: identity missing at grant`)
      if (row.password_hash != null) throw new Error(`STOP — CREDENTIAL STATE DRIFT (${who})`)
      const update = await client.query(
        'update public.users set password_hash = $1 where id = $2 and email = $3 and role = $4 and password_hash is null returning id',
        [hash, spec.id, spec.email, spec.platformRole])
      if (update.rowCount !== 1) throw new Error(`${who}: temporary grant did not affect exactly one pinned user`)
    }
    writePrivate(WINDOW_FILE, JSON.stringify({ window_started_at: started.wall }))
    writeJson(path.join(RESULTS_DIR, 'window-opened.json'), { window_started_at: started.wall, identities: Object.keys(granted), plaintext_known_to_runner: false })
    await client.query('commit')
  } catch (error) { await client.query('rollback'); throw error }
  console.log(JSON.stringify({ temporary_credential: 'GRANTED', identities: Object.keys(granted), plaintext_known_to_runner: false, hash_printed: false }))
}

async function cleanup(client) {
  const snapshotAvailable = fs.existsSync(PRE_SESSIONS_FILE)
  const before = new Set(snapshotAvailable ? JSON.parse(fs.readFileSync(PRE_SESSIONS_FILE, 'utf8')) : [])
  const result = { identities: {}, run_session_ids: [] }
  await client.query('begin')
  try {
    for (const who of Object.keys(IDENTITIES)) {
      const spec = IDENTITIES[who]
      const hashFile = file(`${who}-hash`)
      const tempHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, 'utf8').trim() : null
      const row = await readIdentity(client, who, { lock: true })
      if (!row) { result.identities[who] = 'absent'; continue }
      if (tempHash && row.password_hash === tempHash) {
        const cleared = await client.query(
          'update public.users set password_hash = null where id = $1 and email = $2 and role = $3 and password_hash = $4 returning id',
          [spec.id, spec.email, spec.platformRole, tempHash])
        if (cleared.rowCount !== 1) throw new Error(`${who}: cleanup did not affect exactly one pinned user`)
        result.identities[who] = 'temporary_hash_cleared'
      } else if (row.password_hash == null) {
        result.identities[who] = tempHash ? 'already_null' : 'not_granted'
      } else {
        throw new Error(`STOP — CREDENTIAL STATE DRIFT (${who})`)
      }
    }
    const after = await validSessionIds(client)
    result.run_session_ids = snapshotAvailable ? after.filter((s) => !before.has(s)) : []
    for (const key of result.run_session_ids) {
      const [userId, sessionId] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
      await client.query('update public.user_sessions set is_valid = false where user_id = $1 and id::text = $2', [userId, sessionId])
    }
    const verify = await client.query('select count(*)::int as n from public.users where id = any($1::text[]) and password_hash is not null', [Object.values(IDENTITIES).map((i) => i.id)])
    if (verify.rows[0].n !== 0) throw new Error('a pinned identity still has a password hash')
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    writeJson(CLEANUP_FILE, { ...result, cleanup_error: error instanceof Error ? error.message : String(error) })
    throw error
  } finally {
    for (const who of Object.keys(IDENTITIES)) { try { fs.unlinkSync(file(`${who}-hash`)) } catch {} }
  }
  writeJson(CLEANUP_FILE, { ...result, run_session_count: result.run_session_ids.length, all_pinned_password_hashes_null: true, secret_files_removed: true })
  console.log(JSON.stringify({ credential_cleanup: result.identities, run_session_count: result.run_session_ids.length, all_pinned_password_hashes_null: true, secret_files_removed: true }))
}

async function verifyClean(client) {
  const rows = await client.query('select id from public.users where id = any($1::text[]) and password_hash is not null', [Object.values(IDENTITIES).map((i) => i.id)])
  if (rows.rowCount) fail(`a pinned identity still has a password hash: ${rows.rows.map((r) => r.id).join(',')}`)
  const sessions = await validSessionIds(client)
  let unexpected = []
  if (fs.existsSync(PRE_SESSIONS_FILE)) {
    const before = new Set(JSON.parse(fs.readFileSync(PRE_SESSIONS_FILE, 'utf8')))
    unexpected = sessions.filter((s) => !before.has(s))
  }
  if (unexpected.length) fail(`unexpected run-created valid sessions remain: ${unexpected.join(',')}`)
  console.log(JSON.stringify({ all_pinned_password_hashes_null: true, unexpected_run_valid_session_count: 0, current_valid_session_count: sessions.length }))
}

/**
 * Read-only readout of every business row created since the window opened. Each section is independent:
 * a missing table or column is recorded as an error, never as an empty result and never as a crash.
 */
async function witness(client) {
  if (!fs.existsSync(WINDOW_FILE)) blocked('no window was opened on this runner (window-start.json missing)')
  const since = JSON.parse(fs.readFileSync(WINDOW_FILE, 'utf8')).window_started_at
  const out = { generated_at: new Date().toISOString(), window_started_at: since, garage_tenant_id: GARAGE_ID, sections: {} }
  const section = async (name, sql, params = []) => {
    try { out.sections[name] = (await client.query(sql, params)).rows.map((r) => r.j) }
    catch (error) { out.sections[name] = { error: String(error.message || error).slice(0, 300) } }
  }
  const T = GARAGE_ID
  const CASES = `select id from public.service_cases where garage_tenant_id = $1::uuid and created_at >= $2::timestamptz`
  await section('service_cases', `select to_jsonb(c) j from public.service_cases c where c.garage_tenant_id = $1::uuid and c.created_at >= $2::timestamptz order by c.created_at`, [T, since])
  await section('service_case_events', `select to_jsonb(e) j from public.service_case_events e where e.service_case_id in (${CASES}) order by e.id`, [T, since])
  await section('work_orders', `select to_jsonb(w) j from public.mechanic_work_orders w where w.service_case_id in (${CASES}) order by w.created_at`, [T, since])
  await section('work_order_assignments', `select to_jsonb(a) j from public.work_order_assignments a where a.work_order_id in (select id from public.mechanic_work_orders where service_case_id in (${CASES})) order by a.assigned_at`, [T, since])
  await section('garage_estimates', `select to_jsonb(e) j from public.garage_estimates e where e.service_case_id in (${CASES}) order by e.created_at, e.version`, [T, since])
  await section('garage_estimate_lines', `select to_jsonb(l) j from public.garage_estimate_lines l where l.estimate_id in (select id from public.garage_estimates where service_case_id in (${CASES})) order by l.estimate_id, l.line_no`, [T, since])
  await section('garage_estimate_events', `select to_jsonb(v) j from public.garage_estimate_events v where v.estimate_id in (select id from public.garage_estimates where service_case_id in (${CASES})) order by v.seq`, [T, since])
  await section('service_records', `select to_jsonb(r) j from public.service_records r where r.service_case_id in (${CASES}) order by r.performed_at`, [T, since])
  await section('garage_appointments', `select to_jsonb(a) j from public.garage_appointments a where a.service_case_id in (${CASES}) order by a.created_at`, [T, since])
  await section('garage_appointment_events', `select to_jsonb(v) j from public.garage_appointment_events v where v.appointment_id in (select id from public.garage_appointments where service_case_id in (${CASES})) order by v.created_at`, [T, since])
  await section('service_mileage_observations', `select to_jsonb(m) j from public.service_mileage_observations m where m.service_record_id in (select id from public.service_records where service_case_id in (${CASES})) order by m.id`, [T, since])
  // CarUp must not rewrite a vehicle's odometer from a garage's observation
  await section('fixture_vehicle', `select jsonb_build_object('vin', v.vin, 'mileage', v.mileage, 'owner_id', v.owner_id) j from public.vehicles v where v.vin = 'UATFINAL202610241'`)
  await section('mechanic_parts_created', `select to_jsonb(p) j from public.mechanic_parts p where p.tenant_id = $1::uuid and p.created_at >= $2::timestamptz order by p.created_at`, [T, since])
  await section('garage_stock_movements', `select to_jsonb(m) j from public.garage_stock_movements m where m.tenant_id = $1::uuid and m.created_at >= $2::timestamptz order by m.seq`, [T, since])
  await section('garage_service_part_usage', `select to_jsonb(u) j from public.garage_service_part_usage u where u.tenant_id = $1::uuid and u.created_at >= $2::timestamptz order by u.created_at`, [T, since])
  await section('garage_invoices', `select to_jsonb(i) j from public.garage_invoices i where i.service_case_id in (${CASES}) order by i.created_at`, [T, since])
  await section('garage_invoice_lines', `select to_jsonb(l) j from public.garage_invoice_lines l where l.invoice_id in (select id from public.garage_invoices where service_case_id in (${CASES})) order by l.invoice_id, l.line_no`, [T, since])
  await section('garage_invoice_events', `select to_jsonb(v) j from public.garage_invoice_events v where v.invoice_id in (select id from public.garage_invoices where service_case_id in (${CASES})) order by v.created_at`, [T, since])
  await section('garage_payment_records', `select to_jsonb(p) j from public.garage_payment_records p where p.invoice_id in (select id from public.garage_invoices where service_case_id in (${CASES})) order by p.seq`, [T, since])
  await section('garage_receipts', `select to_jsonb(r) j from public.garage_receipts r where r.invoice_id in (select id from public.garage_invoices where service_case_id in (${CASES})) order by r.issued_at`, [T, since])
  await section('garage_document_counters', `select to_jsonb(c) j from public.garage_document_counters c where c.tenant_id = $1::uuid`, [T])
  await section('trust_audit_events', `select to_jsonb(a) j from public.trust_audit_events a where a.created_at >= $1::timestamptz and (a.actor_tenant_id = $2 or a.event_type like 'GARAGE_%') order by a.created_at`, [since, T])
  await section('domain_events', `select jsonb_build_object('id', d.id, 'event_type', d.event_type, 'status', d.status, 'attempts', d.attempts, 'dedupe_key', d.dedupe_key, 'tenant_id', d.tenant_id, 'created_at', d.created_at, 'processed_at', d.processed_at, 'error_log', d.error_log) j from public.domain_events d where d.created_at >= $1::timestamptz and d.event_type like 'garage.%' order by d.created_at`, [since])
  // delivery, as opposed to emission: what the communications worker did with the events
  await section('notification_queue', `select to_jsonb(n) j from public.notification_queue n where n.created_at >= $1::timestamptz order by n.created_at limit 300`, [since])
  await section('messages_in_window', `select to_jsonb(m) j from public.messages m where m.created_at >= $1::timestamptz order by m.created_at limit 300`, [since])
  await section('message_threads', `select to_jsonb(t) j from public.message_threads t where t.created_at >= $1::timestamptz order by t.created_at`, [since])
  await section('messages_since', `select jsonb_build_object('count', count(*)) j from public.messages m where m.created_at >= $1::timestamptz`, [since])
  await section('sessions_created', `select jsonb_build_object('user_id', s.user_id, 'is_valid', s.is_valid, 'created_at', s.created_at, 'auth_method', s.auth_method) j from public.user_sessions s where s.user_id = any($1::text[]) and s.created_at::timestamptz >= $2::timestamptz order by s.created_at::timestamptz`, [Object.values(IDENTITIES).map((i) => i.id), since])
  // isolation: the window wrote nothing into any OTHER garage
  await section('other_garage_writes', `select jsonb_build_object('cases_created_in_other_tenants', (select count(*) from public.service_cases where created_at >= $1::timestamptz and garage_tenant_id <> $2::uuid), 'estimates_in_other_tenants', (select count(*) from public.garage_estimates where created_at >= $1::timestamptz and tenant_id <> $2::uuid), 'invoices_in_other_tenants', (select count(*) from public.garage_invoices where created_at >= $1::timestamptz and tenant_id <> $2::uuid), 'payments_in_other_tenants', (select count(*) from public.garage_payment_records where recorded_at >= $1::timestamptz and tenant_id <> $2::uuid)) j`, [since, T])
  await section('pinned_identities_state', `select jsonb_build_object('id', u.id, 'password_hash_is_null', u.password_hash is null) j from public.users u where u.id = any($1::text[]) order by u.id`, [Object.values(IDENTITIES).map((i) => i.id)])
  writeJson(WITNESS_FILE, out)
  const counts = Object.fromEntries(Object.entries(out.sections).map(([k, v]) => [k, Array.isArray(v) ? v.length : `ERROR: ${v.error}`]))
  console.log(JSON.stringify({ witness: 'WRITTEN', since, counts }))
}

async function main() {
  ensureMode()
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const client = await connect()
  try {
    if (MODE === 'preflight') return await preflight(client)
    if (MODE === 'provision') return await provision(client)
    if (MODE === 'grant') return await grant(client)
    if (MODE === 'cleanup') return await cleanup(client)
    if (MODE === 'verify-clean') return await verifyClean(client)
    if (MODE === 'witness') return await witness(client)
  } finally { await client.end().catch(() => {}) }
}
main().catch((error) => fail(error?.stack || error?.message || String(error)))
