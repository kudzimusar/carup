#!/usr/bin/env node
/**
 * GARAGE-1.0-CUTOVER-01 — replay THIS campaign's synthetic dead-lettered garage.* events through the product's own
 * recovery function (EventWorker.reprocessDeadLetters), after the canonical worker was moved to the final build.
 *
 * Why: before the cutover the canonical worker had no handler for the new events and dead-lettered them
 * (NO_CURRENT_SUBSCRIBER, 5 attempts). The worker's own documentation describes replay as "operator-driven recovery
 * after the underlying defect is fixed" — this proves that claim on data that is safe to replay.
 *
 * What it will and will not do:
 *   - touches ONLY rows that are status 'dead_letter', of the four campaign event types, in the synthetic Garage tenant,
 *     created inside this campaign's window and before the cutover, addressed to the synthetic UAT customer;
 *   - refuses unless that set is EXACTLY the expected size (27) — a different count means somebody else's rows are in
 *     scope, and nothing is replayed;
 *   - refuses unless the canonical backend currently serves the final build (a replay onto an old worker would just
 *     dead-letter them again), the database is the approved staging project, and external sends are disabled;
 *   - never touches the four older `garage.application.*` dead letters, which are not this campaign's.
 *
 * Modes: preflight | replay (preflight + replay + wait for the worker + verify) | verify
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const MODE = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=preflight').split('=')[1]
const EXPECTED_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer'
const FORBIDDEN_PRODUCTION_PROJECT_REF = 'vhmnajoeicasaigiophh'
const GARAGE_ID = '442c82c1-fc69-46ff-a138-712a6504ac98'
const EVENT_TYPES = ['garage.appointment.confirmed', 'garage.estimate.sent', 'garage.invoice.issued', 'garage.payment.recorded']
const RECIPIENT_SUFFIX = ':uat_final_customer_20261024a'
const CREATED_FROM = process.env.REPLAY_CREATED_FROM || '2026-10-24 11:19:00+00'      // the first UAT window opened
const CREATED_BEFORE = process.env.REPLAY_CREATED_BEFORE || '2026-10-24 20:20:00+00'  // the Owner cutover began
const EXPECTED_COUNT = Number(process.env.REPLAY_EXPECTED_COUNT || 27)
const PRODUCT_SHA = process.env.PRODUCT_SHA || ''
const HEALTH_URL = process.env.REPLAY_HEALTH_URL || 'https://api-staging.carup.dev/api/health'
const WAIT_MINUTES = Number(process.env.REPLAY_WAIT_MINUTES || 8)
const RESULTS_DIR = path.resolve(process.env.GARAGE_REPLAY_RESULTS_DIR || 'test-results/garage-cutover-01-replay')

const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1) }
const blocked = (m) => { console.error(`BLOCKED: ${m}`); process.exit(2) }
const writeJson = (name, value) => { fs.mkdirSync(RESULTS_DIR, { recursive: true }); fs.writeFileSync(path.join(RESULTS_DIR, name), JSON.stringify(value, null, 2) + '\n') }
const cleaned = (v) => v.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '')

function stagingUrl() {
  const v = process.env.DIASPORA_STAGING_DATABASE_URL || ''
  if (!v) blocked('DIASPORA_STAGING_DATABASE_URL is not configured')
  if (v.includes(FORBIDDEN_PRODUCTION_PROJECT_REF) || !v.includes(EXPECTED_STAGING_PROJECT_REF)) blocked('REFUSING REPLAY OUTSIDE APPROVED STAGING')
  return v
}
const isLoopback = (u) => /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u)

async function connect() {
  const url = cleaned(stagingUrl())
  const client = new pg.Client({ connectionString: url, ssl: isLoopback(url) ? false : { rejectUnauthorized: false } })
  try { await client.connect() } catch (e) { await client.end().catch(() => {}); throw e }
  return client
}

async function healthGate() {
  if (!PRODUCT_SHA) blocked('PRODUCT_SHA is not set')
  let health
  try { health = await (await fetch(`${HEALTH_URL}${HEALTH_URL.includes('?') ? '&' : '?'}cb=${Date.now()}`)).json() } catch (e) { blocked(`the canonical backend health could not be read: ${e.message}`) }
  const facts = {
    url: HEALTH_URL, commit_sha: health?.build?.commit_sha, deployment_id: health?.build?.deployment_id, environment: health?.build?.environment,
    supabase_project_ref: health?.database?.supabase_project_ref, database_consistent: health?.database?.consistent,
    kill_switch: health?.communications?.outbound?.kill_switch, external_sends: health?.communications?.outbound?.external_sends,
  }
  if (facts.commit_sha !== PRODUCT_SHA) blocked(`the canonical backend serves ${String(facts.commit_sha).slice(0, 8)}, not the final build ${PRODUCT_SHA.slice(0, 8)} — a replay would only dead-letter the events again`)
  if (facts.supabase_project_ref !== EXPECTED_STAGING_PROJECT_REF || facts.database_consistent !== true) blocked('the backend is not bound to the approved staging database')
  if (facts.external_sends !== 'disabled') blocked('external sends are not disabled')
  return facts
}

const SCOPE = `status = 'dead_letter' AND tenant_id = $1::text AND event_type = ANY($2::text[]) AND created_at >= $3::timestamptz AND created_at < $4::timestamptz AND dedupe_key LIKE $5`
const scopeParams = [GARAGE_ID, EVENT_TYPES, CREATED_FROM, CREATED_BEFORE, `%${RECIPIENT_SUFFIX}`]

async function candidates(client) {
  const { rows } = await client.query(`select id::text id, event_type, status, attempts, dedupe_key, created_at from public.domain_events where ${SCOPE} order by created_at, id`, scopeParams)
  return rows
}

async function preflight(client) {
  const health = await healthGate()
  const rows = await candidates(client)
  const byType = {}; for (const r of rows) byType[r.event_type] = (byType[r.event_type] || 0) + 1
  const outOfScope = (await client.query(`select event_type, status, count(*)::int n from public.domain_events where event_type like 'garage.%' and status = 'dead_letter' and id <> all($1::uuid[]) group by 1,2 order by 1`, [rows.map((r) => r.id)])).rows
  const result = { mode: 'preflight', at: new Date().toISOString(), canonical_health: health, expected_count: EXPECTED_COUNT, candidate_count: rows.length, by_type: byType, ids: rows.map((r) => r.id), dead_letters_left_alone: outOfScope }
  writeJson('replay-preflight.json', result)
  console.log(JSON.stringify({ candidate_count: rows.length, expected: EXPECTED_COUNT, by_type: byType, left_alone: outOfScope }))
  if (rows.length !== EXPECTED_COUNT) { writeJson('replay-preflight.json', { ...result, verdict: 'REFUSED_WRONG_COUNT' }); blocked(`scope is ${rows.length} rows, expected exactly ${EXPECTED_COUNT} — nothing was replayed`) }
  return { rows, health }
}

async function waitAndVerify(client, ids, startedAt) {
  const deadline = Date.now() + WAIT_MINUTES * 60_000
  let rows = []
  for (;;) {
    rows = (await client.query(`select id::text id, event_type, status, attempts, processed_at, left(coalesce(error_log,''), 160) error from public.domain_events where id = any($1::uuid[]) order by created_at, id`, [ids])).rows
    const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})
    if (counts.dead_letter) break
    if ((counts.processed || 0) === ids.length) break
    if (Date.now() > deadline) break
    await new Promise((r) => setTimeout(r, 15_000))
  }
  const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})
  const delivered = {}
  for (const [name, sql] of [
    ['notification_queue_since_replay', `select count(*)::int n from public.notification_queue where created_at >= $1::timestamptz`],
    ['messages_since_replay', `select count(*)::int n from public.messages where created_at >= $1::timestamptz`],
  ]) { try { delivered[name] = (await client.query(sql, [startedAt])).rows[0].n } catch (e) { delivered[name] = `unavailable: ${String(e.message).slice(0, 80)}` } }
  const result = { mode: 'verify', at: new Date().toISOString(), replay_started_at: startedAt, total: ids.length, by_status: counts, delivered, rows }
  writeJson('replay-verify.json', result)
  console.log(JSON.stringify({ by_status: counts, delivered }))
  if (counts.dead_letter) fail(`${counts.dead_letter} event(s) dead-lettered AGAIN — the worker still has no handler`)
  if ((counts.processed || 0) !== ids.length) fail(`only ${counts.processed || 0} of ${ids.length} reached "processed" within ${WAIT_MINUTES} minutes (${JSON.stringify(counts)})`)
}

async function replay(client) {
  const { rows } = await preflight(client)
  const ids = rows.map((r) => r.id)
  const startedAt = (await client.query('select clock_timestamp()::text t')).rows[0].t

  // the product's own recovery function, pointed at the approved staging database only
  const url = cleaned(stagingUrl())
  process.env.EVENT_WORKER_DATABASE_URL = isLoopback(url) ? url : `${url}${url.includes('?') ? '&' : '?'}sslmode=no-verify`
  const { eventWorker } = await import('../services/eventBus/eventWorker.js')
  let outcome
  try { outcome = await eventWorker.reprocessDeadLetters({ ids }) } finally { await eventWorker.pool?.end().catch(() => {}) }
  writeJson('replay-call.json', { at: new Date().toISOString(), function: 'EventWorker.reprocessDeadLetters', requested: ids.length, replayed: outcome.replayed, ids_match: JSON.stringify([...outcome.ids].sort()) === JSON.stringify([...ids].sort()) })
  if (outcome.replayed !== ids.length || JSON.stringify([...outcome.ids].sort()) !== JSON.stringify([...ids].sort())) fail(`the recovery function replayed ${outcome.replayed} of ${ids.length}, or different ids`)
  console.log(JSON.stringify({ replayed: outcome.replayed }))
  await waitAndVerify(client, ids, startedAt)
}

async function main() {
  if (!['preflight', 'replay', 'verify'].includes(MODE)) blocked(`unsupported --mode=${MODE}`)
  const client = await connect()
  try {
    if (MODE === 'preflight') await preflight(client)
    else if (MODE === 'replay') await replay(client)
    else {
      const pre = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'replay-preflight.json'), 'utf8'))
      await waitAndVerify(client, pre.ids, new Date(Date.now() - 3600_000).toISOString())
    }
  } finally { await client.end().catch(() => {}) }
}
main().catch((e) => fail(e?.stack || e?.message || String(e)))
