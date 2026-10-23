#!/usr/bin/env node
/**
 * GARAGE-1.0-OPS02-STG01 — isolated staging credential harness.
 * Evidence infrastructure only. Hard-pinned to one synthetic staging Garage Owner.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { hashPassword } from '../utils/passwordAuth.js'

const MODE = (process.argv.find((arg) => arg.startsWith('--mode=')) || '--mode=preflight').split('=')[1]

const EXPECTED_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer'
const FORBIDDEN_PRODUCTION_PROJECT_REF = 'vhmnajoeicasaigiophh'
const OWNER_ID = 'uat_ops01_owner_20261022a'
const OWNER_EMAIL = 'ops01.owner.20261022a@carup-staging.test'
const OWNER_PLATFORM_ROLE = 'owner'
const GARAGE_ID = '442c82c1-fc69-46ff-a138-712a6504ac98'
const GARAGE_ROLE = 'admin'
const GARAGE_TYPE = 'garage'
const GARAGE_STATUS = 'active'

const RUNNER_TEMP = process.env.RUNNER_TEMP || '/tmp'
const RESULTS_DIR = path.resolve(process.env.GARAGE_OPS02_RESULTS_DIR || 'test-results/garage-ops02-stg01')
const PASSWORD_FILE = path.join(RUNNER_TEMP, 'garage-ops02-stg01-owner-password')
const HASH_FILE = path.join(RUNNER_TEMP, 'garage-ops02-stg01-owner-hash')
const PRE_SESSIONS_FILE = path.join(RUNNER_TEMP, 'garage-ops02-stg01-pre-session-ids.json')
const PREFLIGHT_FILE = path.join(RESULTS_DIR, 'garage-ops02-stg01-owner-preflight.json')
const CLEANUP_FILE = path.join(RESULTS_DIR, 'garage-ops02-stg01-cleanup.json')

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}
function blocked(message) {
  console.error(`BLOCKED: ${message}`)
  process.exit(2)
}
function ensureMode() {
  if (!['preflight', 'grant', 'cleanup', 'verify-clean'].includes(MODE)) blocked(`unsupported --mode=${MODE}`)
}
function ensureStagingDbUrl() {
  const value = process.env.DIASPORA_STAGING_DATABASE_URL || ''
  if (!value) blocked('DIASPORA_STAGING_DATABASE_URL is not configured')
  if (value.includes(FORBIDDEN_PRODUCTION_PROJECT_REF) || !value.includes(EXPECTED_STAGING_PROJECT_REF)) {
    blocked('REFUSING GARAGE OPS02 STG01 CREDENTIAL OPERATION OUTSIDE APPROVED STAGING')
  }
  return value
}
function cleanedConnectionString(value) {
  return value.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '')
}
function writePrivate(file, value) {
  fs.writeFileSync(file, value, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}
function safeWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

async function connect() {
  const raw = ensureStagingDbUrl()
  const client = new pg.Client({ connectionString: cleanedConnectionString(raw), ssl: { rejectUnauthorized: false } })
  try { await client.connect() } catch (error) { await client.end().catch(() => {}); throw error }
  return client
}

async function readPinnedIdentity(client, { lock = false } = {}) {
  const result = await client.query(`
    select
      u.id,
      u.email,
      u.role as platform_role,
      u.password_hash,
      t.id::text as tenant_id,
      t.type as tenant_type,
      t.status as tenant_status,
      tu.role as garage_role,
      (select count(*)::int
         from public.garage_workforce_profiles p
        where p.tenant_id = t.id
          and p.user_id = u.id) as workforce_profile_count
    from public.users u
    join public.tenant_users tu
      on tu.user_id = u.id
     and tu.tenant_id = $2::uuid
    join public.tenants t
      on t.id = tu.tenant_id
    where u.id = $1
    ${lock ? 'for update of u' : ''}
  `, [OWNER_ID, GARAGE_ID])

  if (result.rowCount !== 1) blocked('Pinned Garage Owner identity/membership is absent or ambiguous')
  const row = result.rows[0]
  const problems = []
  if (row.id !== OWNER_ID) problems.push('user id drift')
  if (row.email !== OWNER_EMAIL) problems.push('email drift')
  if (row.platform_role !== OWNER_PLATFORM_ROLE) problems.push('platform role drift')
  if (row.tenant_id !== GARAGE_ID) problems.push('Garage tenant drift')
  if (row.tenant_type !== GARAGE_TYPE) problems.push('Garage tenant type drift')
  if (row.tenant_status !== GARAGE_STATUS) problems.push('Garage tenant status drift')
  if (row.garage_role !== GARAGE_ROLE) problems.push('Garage membership role drift')
  if (Number(row.workforce_profile_count) !== 0) problems.push('Owner workforce profile already exists')
  if (problems.length) blocked(`Pinned Garage Owner invariant failure: ${problems.join(', ')}`)
  return row
}

async function validSessionIds(client) {
  const result = await client.query(`
    select id::text as id
      from public.user_sessions
     where user_id = $1
       and is_valid = true
       and expires_at::timestamptz > now()
     order by id::text
  `, [OWNER_ID])
  return result.rows.map((row) => row.id)
}

async function preflight(client) {
  const identity = await readPinnedIdentity(client)
  if (identity.password_hash != null) blocked('STOP — CREDENTIAL STATE DRIFT')
  const sessions = await validSessionIds(client)
  writePrivate(PRE_SESSIONS_FILE, JSON.stringify(sessions))
  safeWriteJson(PREFLIGHT_FILE, {
    staging_project_ref: EXPECTED_STAGING_PROJECT_REF,
    user_id: OWNER_ID,
    email: OWNER_EMAIL,
    platform_role: identity.platform_role,
    garage_tenant_id: identity.tenant_id,
    garage_role: identity.garage_role,
    tenant_type: identity.tenant_type,
    tenant_status: identity.tenant_status,
    workforce_profile_count: Number(identity.workforce_profile_count),
    password_hash_is_null: true,
    valid_session_ids: sessions,
    valid_session_count: sessions.length,
  })
  console.log(JSON.stringify({
    staging_guard: 'PASS',
    pinned_identity: 'PASS',
    owner_workforce_profile_count: Number(identity.workforce_profile_count),
    password_hash_is_null: true,
    pre_existing_valid_session_count: sessions.length,
  }))
}

async function grant(client) {
  if (!fs.existsSync(PRE_SESSIONS_FILE)) blocked('Run --mode=preflight before credential grant')
  const password = `OPS02-${crypto.randomBytes(32).toString('base64url')}-A9!`
  if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${password}\n`)
  const passwordHash = await hashPassword(password)

  // Persist the runner-private credential material BEFORE the database write. If the runner cannot
  // create its 0600 cleanup files, fail before mutating staging. Once these files exist, the
  // workflow's `if: always()` cleanup can compare the exact temporary hash even if any later step
  // fails immediately after the database transaction commits.
  writePrivate(PASSWORD_FILE, password)
  writePrivate(HASH_FILE, passwordHash)
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, [
      `GARAGE_OPS02_PASSWORD_FILE=${PASSWORD_FILE}`,
      `GARAGE_OPS02_HASH_FILE=${HASH_FILE}`,
      `GARAGE_OPS02_PRE_SESSIONS_FILE=${PRE_SESSIONS_FILE}`,
      `GARAGE_OPS02_RESULTS_DIR=${RESULTS_DIR}`,
    ].join('\n') + '\n', { mode: 0o600 })
  }

  await client.query('begin')
  try {
    const identity = await readPinnedIdentity(client, { lock: true })
    if (identity.password_hash != null) throw new Error('STOP — CREDENTIAL STATE DRIFT')
    const update = await client.query(`
      update public.users
         set password_hash = $1
       where id = $2
         and email = $3
         and role = $4
         and password_hash is null
       returning id
    `, [passwordHash, OWNER_ID, OWNER_EMAIL, OWNER_PLATFORM_ROLE])
    if (update.rowCount !== 1) throw new Error('Temporary credential grant did not affect exactly one pinned user')
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }

  console.log(JSON.stringify({
    temporary_credential: 'GRANTED',
    target_user_id: OWNER_ID,
    governed_hash_format: 'scrypt',
    plaintext_printed: false,
    hash_printed: false,
    target_count: 1,
  }))
}

async function cleanup(client) {
  const sessionSnapshotAvailable = fs.existsSync(PRE_SESSIONS_FILE)
  const beforeIds = sessionSnapshotAvailable ? JSON.parse(fs.readFileSync(PRE_SESSIONS_FILE, 'utf8')) : []
  const tempHash = fs.existsSync(HASH_FILE) ? fs.readFileSync(HASH_FILE, 'utf8').trim() : null

  let credentialCleanup = 'not_granted'
  let certSessionIds = []
  let passwordHashIsNull = false

  await client.query('begin')
  try {
    const identity = await readPinnedIdentity(client, { lock: true })
    if (tempHash) {
      if (identity.password_hash === tempHash) {
        const cleared = await client.query(`
          update public.users
             set password_hash = null
           where id = $1
             and email = $2
             and role = $3
             and password_hash = $4
           returning id
        `, [OWNER_ID, OWNER_EMAIL, OWNER_PLATFORM_ROLE, tempHash])
        if (cleared.rowCount !== 1) throw new Error('Temporary credential cleanup did not affect exactly one pinned user')
        credentialCleanup = 'temporary_hash_cleared'
      } else if (identity.password_hash == null) {
        credentialCleanup = 'already_null'
      } else {
        throw new Error('STOP — CREDENTIAL STATE DRIFT')
      }
    }

    const after = await validSessionIds(client)
    // Never infer session ownership when preflight did not run. With no snapshot, preserve all
    // existing sessions. Grant itself requires the preflight snapshot, so a no-snapshot/no-hash
    // cleanup is an early-failure no-op rather than authority to revoke an unrelated session.
    if (sessionSnapshotAvailable) {
      const before = new Set(beforeIds)
      certSessionIds = after.filter((id) => !before.has(id))
    } else {
      certSessionIds = []
    }
    if (certSessionIds.length) {
      await client.query(`
        update public.user_sessions
           set is_valid = false
         where user_id = $1
           and id::text = any($2::text[])
      `, [OWNER_ID, certSessionIds])
    }

    const verify = await client.query(
      'select password_hash is null as is_null from public.users where id=$1 and email=$2 and role=$3',
      [OWNER_ID, OWNER_EMAIL, OWNER_PLATFORM_ROLE],
    )
    passwordHashIsNull = verify.rowCount === 1 && verify.rows[0].is_null === true
    if (!passwordHashIsNull) throw new Error('Final Owner password_hash is not NULL')
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    safeWriteJson(CLEANUP_FILE, {
      credential_cleanup: credentialCleanup,
      cert_session_ids: certSessionIds,
      final_password_hash_is_null: passwordHashIsNull,
      cleanup_error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    for (const file of [PASSWORD_FILE, HASH_FILE]) {
      try { fs.unlinkSync(file) } catch {}
    }
  }

  safeWriteJson(CLEANUP_FILE, {
    credential_cleanup: credentialCleanup,
    cert_session_ids: certSessionIds,
    cert_session_count: certSessionIds.length,
    pre_existing_session_ids_preserved: beforeIds,
    session_snapshot_available: sessionSnapshotAvailable,
    session_cleanup_proven: sessionSnapshotAvailable || !tempHash,
    final_password_hash_is_null: passwordHashIsNull,
    secret_files_removed: !fs.existsSync(PASSWORD_FILE) && !fs.existsSync(HASH_FILE),
  })
  console.log(JSON.stringify({
    credential_cleanup: credentialCleanup,
    cert_session_count: certSessionIds.length,
    final_password_hash_is_null: passwordHashIsNull,
    secret_files_removed: true,
  }))
}

async function verifyClean(client) {
  const identity = await readPinnedIdentity(client)
  const sessions = await validSessionIds(client)
  const sessionSnapshotAvailable = fs.existsSync(PRE_SESSIONS_FILE)
  let unexpected = []
  if (sessionSnapshotAvailable) {
    const before = new Set(JSON.parse(fs.readFileSync(PRE_SESSIONS_FILE, 'utf8')))
    unexpected = sessions.filter((id) => !before.has(id))
  } else if (fs.existsSync(CLEANUP_FILE)) {
    const cleanupReceipt = JSON.parse(fs.readFileSync(CLEANUP_FILE, 'utf8'))
    if (cleanupReceipt.credential_cleanup !== 'not_granted' && cleanupReceipt.credential_cleanup !== 'already_null') {
      fail('OPS02 certification credential was granted but the pre-existing session snapshot is unavailable; session cleanup cannot be proven safely')
    }
  }
  if (identity.password_hash != null) fail('Final password_hash is not NULL')
  if (unexpected.length) fail(`Unexpected OPS02-certification valid sessions remain: ${unexpected.join(',')}`)
  console.log(JSON.stringify({
    final_password_hash_is_null: true,
    session_snapshot_available: sessionSnapshotAvailable,
    unexpected_r3_valid_session_count: 0,
    current_valid_session_count: sessions.length,
  }))
}

async function main() {
  ensureMode()
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const client = await connect()
  try {
    if (MODE === 'preflight') return await preflight(client)
    if (MODE === 'grant') return await grant(client)
    if (MODE === 'cleanup') return await cleanup(client)
    if (MODE === 'verify-clean') return await verifyClean(client)
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((error) => fail(error?.stack || error?.message || String(error)))
