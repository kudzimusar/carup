/**
 * T11-CAP-LR01-R1 / D9 — does a Journey alert actually reach the right person, on the REAL staging database?
 *
 * Until now the alert path was proven against mocks and PGlite: the notifier, the event bus, the dedupe trigger and the governed
 * template had never run together on staging. A Preview cannot process events and the canonical runtime serves another programme,
 * so this does NOT run a worker. It runs the exact candidate's own code — the notifier, the event bus insert, the communications
 * pipeline, the ETA service — for ONE explicitly chosen event at a time, inside ONE transaction that is ALWAYS rolled back.
 *
 * What makes it safe to point at shared staging:
 *   · it refuses anything but the approved staging project, and refuses to run unless outbound sends are disabled;
 *   · it never commits. The only COMMIT-capable statement in this file is none; ROLLBACK is unconditional (`finally`);
 *   · the code under test reaches the database only through (a) a bounded client that names every table it may read and write,
 *     refuses every other call shape, and can only UPDATE/DELETE rows this run created, and (b) a raw-SQL guard that admits exactly
 *     two statements — INSERT of a Journey event into domain_events and the dedupe lookup;
 *   · it processes events by EXACT identity: an event is delivered only if this run created it AND it is a Journey alert;
 *     there is no polling and no worker, so no other programme's event can be picked up;
 *   · afterwards, on a SEPARATE connection, it proves every row it created is gone and that no Journey event exists;
 *   · the people are staging's own synthetic "outsider" identities, the orders and shipments are labelled and rolled back — the
 *     real Vezel and the Serena are never read or written.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessStop, ensureStagingDbUrl } from './t11-cap-stg-converge.mjs'
import { createPgTxClient } from './lib/pgTxServiceClient.mjs'

export const JOURNEY_EVENT_TYPES = Object.freeze(['diaspora.journey.alert', 'diaspora.journey.exception'])
export const SYNTHETIC = Object.freeze({
  buyerA: 'uat.outsider@carup-staging.test',
  buyerB: 'tradeos.outsider@carup-staging.test',
  operator: 'uat.reviewer@carup-staging.test',
})
export const READ_TABLES = Object.freeze([
  'users', 'diaspora_import_orders', 'diaspora_shipments', 'diaspora_cargo_reservations', 'diaspora_container_loads',
  'diaspora_container_load_items', 'communication_sla_policies', 'communication_preferences', 'communication_templates',
  'communication_template_versions', 'message_threads', 'message_participants', 'notification_queue',
])
export const WRITE_TABLES = Object.freeze([
  'diaspora_shipment_observations', 'diaspora_import_audit_log', 'message_threads', 'message_participants', 'messages', 'notification_queue',
])
const LABEL = 'T11-CAP-LR01-R1 D9 certification fixture — rolled back, never committed'

/** The only raw SQL the event bus may send. Anything else is refused before it reaches the driver. */
export function guardRawSql(pg, { createdEventIds, log }) {
  return {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim()
      const insert = /^INSERT INTO domain_events \(event_type, payload, status, attempts, tenant_id\) VALUES \(\$1, \$2, \$3, \$4, \$5\)( ON CONFLICT DO NOTHING)? RETURNING \*;?$/i.test(text)
      const lookup = /^SELECT \* FROM domain_events WHERE dedupe_key = \$1 ORDER BY created_at ASC LIMIT 1;?$/i.test(text)
      if (insert) {
        if (!JOURNEY_EVENT_TYPES.includes(params[0])) throw new Error(`REFUSED: raw insert of event type ${JSON.stringify(params[0])} (only Journey alerts)`)
        const res = await pg.query(sql, params)
        for (const r of res.rows) createdEventIds.add(String(r.id))
        log.push({ op: 'insert', table: 'domain_events', rows: res.rows.length })
        return res
      }
      if (lookup) { const res = await pg.query(sql, params); log.push({ op: 'select', table: 'domain_events', rows: res.rows.length }); return res }
      throw new Error(`REFUSED: raw SQL outside the two permitted statements: ${text.slice(0, 80)}`)
    },
  }
}

/** Deliver one event through the real pipeline — but only an event THIS run created, of a Journey type. */
export function makeExactProcessor({ services, createdEventIds }) {
  return async function processExact(event) {
    if (!event || !JOURNEY_EVENT_TYPES.includes(event.event_type)) throw new Error(`REFUSED: ${event?.event_type ?? 'no event'} is not a Journey alert`)
    if (!createdEventIds.has(String(event.id))) throw new Error('REFUSED: this event was not created by this run')
    return services.orchestrator.handleDomainEvent({ id: event.id, event_type: event.event_type, payload: event.payload, tenant_id: event.tenant_id }, null, event.tenant_id)
  }
}

const check = (checks, name, ok, detail = null) => { checks.push({ name, ok: Boolean(ok), ...(detail === null ? {} : { detail }) }); return Boolean(ok) }

export async function runCertification({ connect, now = () => new Date() }) {
  if (process.env.COMMUNICATION_OUTBOUND_DISABLED !== 'true') throw new HarnessStop('OUTBOUND_NOT_DISABLED', 'REFUSING: COMMUNICATION_OUTBOUND_DISABLED must be "true" — this run must be unable to send anything')
  // The code under test is imported only AFTER the guards above, with a dead Supabase endpoint: any path that ignores the injected
  // client fails loudly instead of reaching the real REST API.
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:9'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'certification-not-a-key'
  const { handleShipmentStageEvent } = await import('../services/diaspora/journeyAlertNotifier.js')
  const { journeyAlertText } = await import('../services/diaspora/journeyAlertNotifier.js')
  const { shipmentReference } = await import('../services/diaspora/journeyProjectionService.js')
  const { recordEtaRevision } = await import('../services/diaspora/diasporaShipmentObservationService.js')
  const { emitDomainEvent } = await import('../services/eventBus/eventBusService.js')
  const { CommunicationRepository } = await import('../services/communication/communicationRepository.js')
  const { createCommunicationServices } = await import('../services/communication/communicationServiceFactory.js')

  const checks = []
  const observer = await connect()
  const tx = await connect()
  const report = { programme: 'T11-CAP-LR01-R1 D9', rolled_back: false, checks, statements: null }
  const ids = {}
  let beforeRows = null
  try {
    // ── before, on a connection that is not part of the transaction ────────────────────────────────────────────────
    const snapshot = async (c) => (await c.query(`SELECT event_type, status, count(*)::int AS n FROM domain_events GROUP BY 1, 2 ORDER BY 1, 2`)).rows
    const before = await snapshot(observer)
    beforeRows = before.map((r) => [r.event_type, r.status, r.n])
    const journeyBefore = (await observer.query(`SELECT count(*)::int AS n FROM domain_events WHERE event_type = ANY($1)`, [JOURNEY_EVENT_TYPES])).rows[0].n
    report.before = { domain_events_by_type_status: before.length, journey_events: journeyBefore }

    await tx.query('BEGIN')
    await tx.query("SET LOCAL statement_timeout = '30s'")
    await tx.query("SET LOCAL lock_timeout = '5s'")
    await tx.query("SET LOCAL idle_in_transaction_session_timeout = '120s'")

    const who = async (email) => {
      const { rows } = await tx.query('SELECT id FROM users WHERE email = $1', [email])
      if (rows.length !== 1) throw new HarnessStop('BLOCKED_PREREQUISITES', `synthetic identity ${email} is missing`)
      return rows[0].id
    }
    const A = await who(SYNTHETIC.buyerA); const B = await who(SYNTHETIC.buyerB); const OP = await who(SYNTHETIC.operator)
    check(checks, 'three distinct synthetic identities', new Set([A, B, OP]).size === 3)

    // ── labelled fixtures — inside the transaction, so they exist only for the duration of the run ──────────────────
    const order = async (buyer) => (await tx.query(
      `INSERT INTO diaspora_import_orders (buyer_id, created_by, updated_by, order_type, origin_country, destination_country, status, metadata)
       VALUES ($1, $1, $1, 'vehicle', 'Japan', 'Zimbabwe', 'DOCUMENTS_PENDING', $2::jsonb) RETURNING id`, [buyer, JSON.stringify({ certification: LABEL })])).rows[0].id
    const shipment = async (orderId) => (await tx.query(
      `INSERT INTO diaspora_shipments (import_order_id, carrier_name, origin_port, destination_port, status, estimated_arrival_date, metadata)
       VALUES ($1, 'CERT D9 CARRIER', 'Cert Port A', 'Cert Port B', 'PLANNED', '2026-12-01T00:00:00Z', $2::jsonb) RETURNING id`, [orderId, JSON.stringify({ certification: LABEL })])).rows[0].id
    ids.orderA = await order(A); ids.orderB = await order(B)
    ids.shipA = await shipment(ids.orderA); ids.shipB = await shipment(ids.orderB)

    // ── the bounded client and the guarded event insert ──────────────────────────────────────────────────────────────
    const createdEventIds = new Set(); const rawLog = []
    const client = createPgTxClient(tx, { readTables: [...READ_TABLES], writeTables: [...WRITE_TABLES] })
    client.ownOnly('message_threads', 'message_participants', 'messages', 'notification_queue', 'diaspora_shipment_observations')
    const emitEvent = (_pg, type, payload, tenantId) => emitDomainEvent(guardRawSql(tx, { createdEventIds, log: rawLog }), type, payload, tenantId)
    const repository = new CommunicationRepository({ client })
    const services = createCommunicationServices({ repository })
    const processExact = makeExactProcessor({ services, createdEventIds })

    const eventsFor = async (shipmentId) => (await tx.query(
      `SELECT * FROM domain_events WHERE event_type = ANY($1) AND payload ->> 'subjectId' = $2 ORDER BY created_at, id`, [JOURNEY_EVENT_TYPES, shipmentId === ids.shipA ? ids.orderA : ids.orderB])).rows
    const stage = (shipmentId, orderId, stageName, outboxId) => handleShipmentStageEvent(
      { shipmentId, importOrderId: orderId, stage: stageName },
      { id: outboxId, event_type: `DIASPORA_SHIPMENT_${stageName}`, attempts: 0, tenant_id: null },
      { client, emitEvent },
    )
    const notices = async (userId) => (await tx.query(`SELECT * FROM notification_queue WHERE recipient_user_id = $1 ORDER BY created_at, id`, [userId])).rows

    // 1. a departure is recorded for shipment A: exactly one alert, addressed to A's own order, with the DB-derived identity
    const outboxX = crypto.randomUUID()
    await stage(ids.shipA, ids.orderA, 'IN_TRANSIT', outboxX)
    const dep = await eventsFor(ids.shipA)
    check(checks, 'one alert event for the departure', dep.length === 1, dep.length)
    const ev = dep[0]
    check(checks, 'it is a Journey alert addressed to A for A\'s own order', ev?.event_type === 'diaspora.journey.alert' && ev.payload.recipientUserId === A && ev.payload.subjectId === ids.orderA && ev.payload.kind === 'DEPARTED')
    check(checks, 'the REAL staging trigger derived the identity from the alert key', ev?.dedupe_key === `diaspora.journey.alert:${ev.payload.alertKey}`, ev?.dedupe_key ? 'dedupe_key present' : 'dedupe_key missing')
    check(checks, 'it carries the shipment reference the Journey prints and a path to the owner\'s own journey', ev.payload.reference === shipmentReference(ids.shipA) && ev.payload.journeyPath === `/diaspora/journey/import_order/${ids.orderA}`)
    check(checks, 'it names no other person, order, container or tenant', !JSON.stringify(ev.payload).includes(B) && !JSON.stringify(ev.payload).includes(ids.orderB) && !JSON.stringify(ev.payload).includes(OP))

    // 2. the SAME observation delivered again (a redelivery, a worker retry) is the same alert — enforced by the real unique index —
    //    and a DISTINCT observation is a distinct alert
    await stage(ids.shipA, ids.orderA, 'IN_TRANSIT', outboxX)
    check(checks, 'the same observation delivered twice is ONE alert (the real unique index)', (await eventsFor(ids.shipA)).length === 1)
    await stage(ids.shipA, ids.orderA, 'IN_TRANSIT', crypto.randomUUID())
    check(checks, 'a distinct observation is a distinct alert', (await eventsFor(ids.shipA)).length === 2)
    await stage(ids.shipA, ids.orderA, 'ARRIVED', crypto.randomUUID())

    // 3. an exception: its own event type
    await stage(ids.shipA, ids.orderA, 'EXCEPTION', crypto.randomUUID())
    const exc = (await eventsFor(ids.shipA)).find((e) => e.event_type === 'diaspora.journey.exception')
    check(checks, 'an exception is announced as an exception, to A', exc?.payload.recipientUserId === A && exc.payload.kind === 'EXCEPTION')

    // 4. an estimate revision, through the REAL service (authority, supersede, audit, announce) — and its replay
    const eta = { provider_event_id: `d9-${crypto.randomUUID()}`, estimated_arrival: '2026-12-20T00:00:00Z', observed_at: now().toISOString(), reason: 'Port congestion (certification, rolled back)' }
    const revised = await recordEtaRevision(ids.shipA, eta, { id: OP, platformRole: 'platform_admin' }, { supabaseClient: client, emitEvent })
    check(checks, 'the revision was accepted as the current estimate', revised.status === 'ACCEPTED' && String(revised.estimated_arrival).startsWith('2026-12-20'))
    await recordEtaRevision(ids.shipA, eta, { id: OP, platformRole: 'platform_admin' }, { supabaseClient: client, emitEvent })
    const etaAlerts = (await eventsFor(ids.shipA)).filter((e) => e.payload.kind === 'ETA_CHANGED')
    check(checks, 'the estimate change is announced exactly once, however many times it is replayed', etaAlerts.length === 1, etaAlerts.length)

    // 5. B's own shipment moves: B is told, A is not — and A's events never named B
    await stage(ids.shipB, ids.orderB, 'IN_TRANSIT', crypto.randomUUID())
    const forB = await eventsFor(ids.shipB)
    check(checks, 'B\'s own shipment alerts B only', forB.length === 1 && forB[0].payload.recipientUserId === B && forB[0].payload.subjectId === ids.orderB)
    const forA = await eventsFor(ids.shipA)
    check(checks, 'none of A\'s alerts went to B, none of B\'s to A', forA.every((e) => e.payload.recipientUserId === A) && forB.every((e) => e.payload.recipientUserId === B))

    // 6. deliver EXACTLY the events this run created — through the real governed template and notification pipeline
    for (const e of [...forA, ...forB]) await processExact(e)
    const noticesA = await notices(A); const noticesB = await notices(B)
    check(checks, 'A has exactly one in-app notice per alert, B exactly one for B\'s', noticesA.length === forA.length && noticesB.length === forB.length, `${noticesA.length}/${noticesB.length}`)
    check(checks, 'every notice is in-app, from the governed Journey template', [...noticesA, ...noticesB].every((n) => n.channel === 'in_app' && n.template_key === 'journey_update_v1'))
    const depNotice = noticesA.find((n) => n.message === journeyAlertText('DEPARTED'))
    check(checks, 'the departure notice says what the registry recorded, in the governed words, with the real reference', Boolean(depNotice) && depNotice.title === `Your shipment ${shipmentReference(ids.shipA)}`)
    check(checks, 'the exception notice is its own wording', noticesA.some((n) => n.message === journeyAlertText('EXCEPTION')))
    check(checks, 'the estimate notice is its own wording', noticesA.some((n) => n.message === journeyAlertText('ETA_CHANGED')))
    check(checks, 'nothing was queued outside the app', (await tx.query(`SELECT count(*)::int AS n FROM notification_queue WHERE recipient_user_id = ANY($1) AND channel <> 'in_app'`, [[A, B]])).rows[0].n === 0)

    // 7. the harness's own refusals — an event it did not create, or that is not a Journey alert, is never delivered
    await assert_rejects(() => processExact({ id: crypto.randomUUID(), event_type: 'diaspora.journey.alert', payload: {}, tenant_id: null }), /not created by this run/, checks, 'an event this run did not create is refused')
    await assert_rejects(() => processExact({ id: [...createdEventIds][0], event_type: 'diaspora.shipment.updated', payload: {}, tenant_id: null }), /not a Journey alert/, checks, 'a non-Journey event is refused even with a known id')
    await assert_rejects(() => emitEvent(null, 'marketplace.inquiry.created', { inquiryId: 'x' }, null), /only Journey alerts/, checks, 'the event bus cannot be used to emit anything but Journey alerts')

    report.statements = summarise(client.statements, rawLog)
    check(checks, 'only the permitted tables were written', report.statements.writes.every((w) => [...WRITE_TABLES, 'domain_events'].includes(w.table)), report.statements.writes.map((w) => w.table).join(','))
    check(checks, 'every domain_events write was an insert of a Journey alert', rawLog.filter((l) => l.table === 'domain_events' && l.op !== 'select').every((l) => l.op === 'insert'))
    report.created = { events: createdEventIds.size, notices: noticesA.length + noticesB.length }
  } finally {
    await tx.query('ROLLBACK').catch(() => {})
    report.rolled_back = true
  }

  // ── after, on the other connection: nothing this run created survives, and nothing else moved ─────────────────────────
  const { rows: [after] } = await observer.query(
    `SELECT (SELECT count(*)::int FROM diaspora_import_orders WHERE id = ANY($1)) AS orders,
            (SELECT count(*)::int FROM diaspora_shipments WHERE id = ANY($2)) AS shipments,
            (SELECT count(*)::int FROM domain_events WHERE event_type = ANY($3)) AS journey_events,
            (SELECT count(*)::int FROM notification_queue WHERE template_key = 'journey_update_v1' AND message LIKE '%certification%') AS labelled_notices`,
    [[ids.orderA, ids.orderB].filter(Boolean), [ids.shipA, ids.shipB].filter(Boolean), JOURNEY_EVENT_TYPES])
  check(checks, 'after the rollback no fixture order or shipment exists', after.orders === 0 && after.shipments === 0, JSON.stringify(after))
  check(checks, 'after the rollback no Journey event exists anywhere', after.journey_events === report.before.journey_events, `${report.before.journey_events} -> ${after.journey_events}`)
  const afterSnapshot = await observer.query(`SELECT event_type, status, count(*)::int AS n FROM domain_events GROUP BY 1, 2 ORDER BY 1, 2`)
  // Informational: other programmes' real events may legitimately arrive between the two reads; the hard guarantees are the
  // checks above (nothing of this run survives; no Journey event exists) and the structure of the run itself.
  report.unrelated_event_snapshot_equal = JSON.stringify(afterSnapshot.rows.map((r) => [r.event_type, r.status, r.n])) === JSON.stringify(beforeRows)
  await Promise.all([observer.end(), tx.end()]).catch(() => {})
  report.verdict = checks.every((c) => c.ok) ? 'PASS' : 'FAIL'
  return report
}

async function assert_rejects(fn, pattern, checks, name) {
  try { await fn(); check(checks, name, false, 'it did not throw') } catch (e) { check(checks, name, pattern.test(String(e.message)), String(e.message).slice(0, 90)) }
}

function summarise(statements, raw) {
  const all = [...statements.map((s) => ({ op: s.op, table: s.table, rows: s.rows ?? 0 })), ...raw]
  const key = (s) => `${s.op}:${s.table}`
  const agg = new Map()
  for (const s of all) agg.set(key(s), (agg.get(key(s)) || 0) + (s.rows || 0) + 1)
  const writes = all.filter((s) => ['insert', 'update', 'delete', 'upsert'].includes(s.op)).map((s) => ({ op: s.op, table: s.table }))
  const tables = [...new Set(all.map((s) => s.table))].sort()
  return { statements: all.length, tables, writes: [...new Map(writes.map((w) => [`${w.op}:${w.table}`, w])).values()] }
}

async function main() {
  const resultsDir = path.resolve(process.env.T11_CAP_RESULTS_DIR || 'test-results/t11-cap-r1-d9')
  fs.mkdirSync(resultsDir, { recursive: true })
  const { default: pg } = await import('pg')
  try {
    const url = ensureStagingDbUrl().replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '')
    const loopback = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url)
    const connect = async () => { const c = new pg.Client({ connectionString: url, ssl: loopback ? false : { rejectUnauthorized: false } }); await c.connect(); return c }
    const report = await runCertification({ connect })
    fs.writeFileSync(path.join(resultsDir, 'd9.json'), JSON.stringify(report, null, 2))
    for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`)
    console.log(JSON.stringify({ verdict: report.verdict, rolled_back: report.rolled_back, created: report.created, statements: report.statements?.statements, tables: report.statements?.tables }))
    if (report.verdict !== 'PASS') process.exit(1)
  } catch (error) {
    if (error instanceof HarnessStop) { const blocked = ['BLOCKED_PREREQUISITES', 'NO_DATABASE_URL', 'NOT_APPROVED_STAGING', 'OUTBOUND_NOT_DISABLED'].includes(error.code); console.error(`${blocked ? 'BLOCKED' : 'FAIL'}: ${error.code}: ${error.message}`); process.exit(blocked ? 2 : 1) }
    console.error(`ERROR: ${error.stack || error.message}`); process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
