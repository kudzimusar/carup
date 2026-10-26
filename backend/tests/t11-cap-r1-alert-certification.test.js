/**
 * T11-CAP-LR01-R1 / D9 — the alert certification's SAFETY CASE.
 *
 * The scenario itself can only run against the real staging schema (it exists precisely because mocks and PGlite were not
 * enough), so it is rehearsed there, inside a transaction that is always rolled back. What can and must be proven offline is
 * that the harness cannot do anything but what it says: no commit, only Journey events, only events it created, only named
 * tables, no real purchase touched, no run without the outbound kill switch.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { HarnessStop } from '../scripts/t11-cap-stg-converge.mjs'
import {
  JOURNEY_EVENT_TYPES, READ_TABLES, SYNTHETIC, WRITE_TABLES, guardRawSql, makeExactProcessor, runCertification,
} from '../scripts/t11-cap-r1-alert-certification.mjs'

const SRC = fs.readFileSync(new URL('../scripts/t11-cap-r1-alert-certification.mjs', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\S\r\n]*\/\/.*$/gm, '')

const recorder = () => { const sent = []; return { sent, async query(sql, params) { sent.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params }); return { rows: [{ id: 'evt-1', event_type: params?.[0] }] } } } }
const INSERT = `INSERT INTO domain_events (event_type, payload, status, attempts, tenant_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
        RETURNING *;`
const INSERT_PLAIN = INSERT.replace('ON CONFLICT DO NOTHING', '')
const LOOKUP = `SELECT * FROM domain_events WHERE dedupe_key = $1 ORDER BY created_at ASC LIMIT 1`

// ── The one raw SQL door ──────────────────────────────────────────────────

test('D9: the raw-SQL guard admits exactly two statements — a Journey event insert and the dedupe lookup', async () => {
  const pg = recorder(); const created = new Set(); const log = []
  const g = guardRawSql(pg, { createdEventIds: created, log })
  await g.query(INSERT, ['diaspora.journey.alert', '{}', 'pending', 0, null])
  await g.query(INSERT_PLAIN, ['diaspora.journey.exception', '{}', 'pending', 0, null])
  await g.query(LOOKUP, ['diaspora.journey.alert:k'])
  assert.equal(pg.sent.length, 3)
  assert.ok(created.has('evt-1'), 'the id of the event this run created was not remembered')
  assert.deepEqual(log.map((l) => `${l.op}:${l.table}`), ['insert:domain_events', 'insert:domain_events', 'select:domain_events'])
})

test('D9: it refuses every other statement and every other event type — before the driver sees them', async () => {
  const pg = recorder(); const g = guardRawSql(pg, { createdEventIds: new Set(), log: [] })
  await assert.rejects(() => g.query(INSERT, ['marketplace.inquiry.created', '{}', 'pending', 0, null]), /only Journey alerts/)
  await assert.rejects(() => g.query(INSERT, ['garage.estimate.sent', '{}', 'pending', 0, null]), /only Journey alerts/)
  for (const sql of [
    "UPDATE domain_events SET status = 'processed'", 'DELETE FROM domain_events', 'TRUNCATE domain_events', 'SELECT * FROM domain_events',
    'INSERT INTO users (id) VALUES ($1)', 'COMMIT', 'DROP TABLE domain_events', "INSERT INTO domain_events (event_type) VALUES ('diaspora.journey.alert')",
    `${LOOKUP}; DROP TABLE users`, 'SELECT * FROM domain_events WHERE dedupe_key = $1 OR true',
  ]) await assert.rejects(() => g.query(sql, []), /raw SQL outside the two permitted statements/, sql)
  assert.deepEqual(pg.sent, [], 'a refused statement reached the driver')
})

// ── Exact-event processing ────────────────────────────────────────────────

test('D9: an event is delivered only if this run created it AND it is a Journey alert — there is no polling', async () => {
  const delivered = []
  const services = { orchestrator: { handleDomainEvent: async (e) => { delivered.push(e.id); return { ok: true } } } }
  const created = new Set(['mine-1'])
  const processExact = makeExactProcessor({ services, createdEventIds: created })
  await processExact({ id: 'mine-1', event_type: 'diaspora.journey.alert', payload: { a: 1 }, tenant_id: null })
  await assert.rejects(() => processExact({ id: 'someone-elses', event_type: 'diaspora.journey.alert', payload: {}, tenant_id: null }), /not created by this run/)
  await assert.rejects(() => processExact({ id: 'mine-1', event_type: 'diaspora.shipment.updated', payload: {}, tenant_id: null }), /not a Journey alert/)
  await assert.rejects(() => processExact({ id: 'mine-1', event_type: 'garage.estimate.sent', payload: {}, tenant_id: null }), /not a Journey alert/)
  await assert.rejects(() => processExact(null), /not a Journey alert|no event/)
  assert.deepEqual(delivered, ['mine-1'])
  assert.ok(!/pollEvents|\.poll\(|process\(\)|setInterval|eventWorker/.test(SRC), 'the harness references a worker or a poll')
})

// ── The run itself ────────────────────────────────────────────────────────

test('D9: it will not run unless outbound sends are disabled, and never against anything but approved staging', async () => {
  const saved = process.env.COMMUNICATION_OUTBOUND_DISABLED
  try {
    delete process.env.COMMUNICATION_OUTBOUND_DISABLED
    await assert.rejects(() => runCertification({ connect: async () => { throw new Error('connected') } }), (e) => e instanceof HarnessStop && e.code === 'OUTBOUND_NOT_DISABLED')
    process.env.COMMUNICATION_OUTBOUND_DISABLED = 'false'
    await assert.rejects(() => runCertification({ connect: async () => { throw new Error('connected') } }), (e) => e instanceof HarnessStop && e.code === 'OUTBOUND_NOT_DISABLED')
  } finally { if (saved === undefined) delete process.env.COMMUNICATION_OUTBOUND_DISABLED; else process.env.COMMUNICATION_OUTBOUND_DISABLED = saved }
  assert.match(SRC, /ensureStagingDbUrl\(\)/)
})

test('D9: it cannot commit — there is no COMMIT, ROLLBACK is unconditional, and the transaction is bounded', () => {
  assert.ok(!/\bCOMMIT\b/i.test(SRC), 'the harness can commit')
  assert.match(SRC, /finally \{\s*await tx\.query\('ROLLBACK'\)/, 'ROLLBACK is not in a finally block')
  assert.match(SRC, /statement_timeout/)
  assert.match(SRC, /lock_timeout/)
  assert.match(SRC, /idle_in_transaction_session_timeout/)
  assert.ok(SRC.indexOf("'BEGIN'") < SRC.indexOf('INSERT INTO diaspora_import_orders'), 'a fixture is written before the transaction begins')
})

test('D9: the tables it may touch are named, small, and exclude anything that is not the alert path', () => {
  const all = [...READ_TABLES, ...WRITE_TABLES]
  for (const forbidden of ['vehicles', 'diaspora_shipment_legs', 'diaspora_trade_documents', 'vehicle_evidence', 'user_sessions', 'domain_events', 'users_secrets', 'password_resets']) {
    assert.ok(!WRITE_TABLES.includes(forbidden), `${forbidden} is writable`)
  }
  for (const writable of WRITE_TABLES) assert.ok(all.includes(writable))
  assert.ok(!READ_TABLES.includes('user_sessions') && !READ_TABLES.includes('vehicles'), 'sessions or vehicles are readable')
  assert.deepEqual([...JOURNEY_EVENT_TYPES].sort(), ['diaspora.journey.alert', 'diaspora.journey.exception'])
})

test('D9: the real purchase and the existing vehicle are never read or written — the fixtures are labelled, synthetic and rolled back', () => {
  for (const real of [/RU3-?1316558/i, /GFC27/i, /3e2b66a0/i, /f8cb8f50/i, /u_66cace85fad949e4/, /Kingston/i, /HOEGH/i, /CD740269/i]) assert.ok(!real.test(SRC), `the harness names ${real}`)
  assert.match(SRC, /@carup-staging\.test/)
  for (const email of Object.values(SYNTHETIC)) assert.match(email, /@carup-staging\.test$/)
  assert.match(SRC, /rolled back, never committed/)
})

test('D9: the code under test is imported only after the guards, against a dead Supabase endpoint', () => {
  assert.ok(SRC.indexOf('COMMUNICATION_OUTBOUND_DISABLED') < SRC.indexOf("await import('../services/diaspora/journeyAlertNotifier.js')"))
  assert.match(SRC, /SUPABASE_URL \|\|= 'http:\/\/127\.0\.0\.1:9'/)
})

test('D9: after the rollback it checks, on a separate connection, that nothing of the run survives', () => {
  assert.match(SRC, /const observer = await connect\(\)/)
  assert.match(SRC, /after the rollback no fixture order or shipment exists/)
  assert.match(SRC, /after the rollback no Journey event exists anywhere/)
})
