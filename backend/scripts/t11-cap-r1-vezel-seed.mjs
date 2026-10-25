/**
 * T11-CAP-LR01-R1 — create the Owner-authorised real purchase on STAGING, from verified facts only.
 *
 * The purchase is a 2018 vehicle shown on the Owner's own BE FORWARD CAP page. CarUp had no record of it. This
 * writes the records a real Journey needs — a vehicle, an import order, a shipment, its creation stage event and
 * its one declared vessel leg — as ADDITIONAL staging data, and nothing else.
 *
 * What it will not do, and checks:
 *   · it touches PRODUCTION never: it refuses any URL that is not the approved staging project;
 *   · it invents nothing: every value comes from the facts file, where each one carries its basis, and the plan is
 *     validated against a list of columns that must stay empty (an actual departure, an actual arrival, a tracking
 *     number, a purchase amount, a consignee, a customs outcome …);
 *   · it changes no existing row: it only INSERTs, and it fingerprints the protected vehicle (the existing Serena)
 *     before and after — one byte of difference rolls the whole transaction back;
 *   · it is idempotent: a second run finds its own rows by natural key and inserts nothing; an existing row that
 *     DISAGREES with the facts stops the run rather than being "fixed";
 *   · it emits no event, sends nothing and creates no notification: raw inserts do not pass through T11's
 *     transition service, so no `DIASPORA_SHIPMENT_*` event exists to alert on.
 *
 * Attribution is honest: there is no operator session, so `created_by` stays NULL and each row's metadata (and the
 * audit trail) says it was recorded by this certification run from the named evidence — it does not borrow an
 * operator's identity.
 *
 * Modes: preflight = the whole write inside a transaction that is ROLLED BACK; apply = the same, committed, then
 * verified; verify = read-only.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessStop, ensureStagingDbUrl, makeDb } from './t11-cap-stg-converge.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FACTS_PATH = path.resolve(HERE, 'data/t11-cap-r1-vezel-facts.json')
export const PROGRAMME = 'T11-CAP-LR01-R1'
const LOCK_KEY = 't11-cap-r1-vezel-seed'

/** The only columns this script may set, per table. Anything else is a defect, not a convenience. */
export const WRITABLE = Object.freeze({
  vehicles: ['vin', 'chassis_number', 'engine_number', 'make', 'model', 'trim', 'year', 'color', 'mileage', 'fuel_type', 'drivetrain', 'transmission', 'import_source', 'status', 'publication_status', 'price', 'owner_id'],
  diaspora_import_orders: ['buyer_id', 'created_by', 'updated_by', 'order_type', 'origin_country', 'destination_country', 'linked_vehicle_vin', 'chassis_number', 'status', 'metadata'],
  diaspora_shipments: ['import_order_id', 'carrier_name', 'origin_port', 'destination_port', 'estimated_arrival_date', 'status', 'metadata'],
  diaspora_shipment_stage_events: ['shipment_id', 'import_order_id', 'stage', 'notes', 'event_time', 'metadata'],
  diaspora_shipment_legs: ['shipment_id', 'leg_sequence', 'carrier_name', 'vessel_name', 'port_of_loading', 'port_of_discharge', 'planned_departure_date', 'estimated_arrival_date', 'source', 'source_reference', 'metadata'],
  diaspora_import_audit_log: ['import_order_id', 'actor_id', 'action', 'resource_type', 'resource_id', 'previous_state', 'new_state', 'metadata', 'cryptographic_seal'],
})

/** Columns that, if ever non-null here, would be an invented business fact. */
export const MUST_STAY_EMPTY = Object.freeze({
  vehicles: ['currency', 'current_seller_id', 'current_seller_type', 'registration_status', 'registration_country', 'plate_number', 'trust_score', 'listing_city', 'seller_description'],
  diaspora_import_orders: ['budget_amount', 'consignee_kind', 'consignee_name', 'consignee_phone', 'delivery_address', 'clearing_agent_name', 'requested_make', 'requested_model', 'requested_year_min', 'destination_city', 'origin_city', 'tenant_id', 'vin'],
  diaspora_shipments: ['departure_date', 'actual_arrival_date', 'tracking_number', 'container_id', 'tenant_id', 'created_by'],
  diaspora_shipment_legs: ['voyage_ref', 'imo', 'mmsi', 'created_by'],
})

const JSONB = new Set(['metadata', 'previous_state', 'new_state'])
const TIMESTAMP = new Set(['estimated_arrival_date', 'planned_departure_date', 'event_time'])

export function loadFacts(file = FACTS_PATH) {
  const text = fs.readFileSync(file, 'utf8')
  return { ...JSON.parse(text), _sha256: crypto.createHash('sha256').update(text).digest('hex') }
}

const valuesOf = (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value]))

/** Same formula as diasporaAuditService.buildAuditSeal (a test pins the two together). */
export function auditSeal({ actorId, action, resourceType, resourceId, timestamp, payload }) {
  return crypto.createHash('sha256')
    .update(`${actorId || 'system'}|${action}|${resourceType}|${resourceId}|${timestamp}|${JSON.stringify(payload || {})}`)
    .digest('hex')
}

const provenance = (facts, what) => ({
  programme: PROGRAMME,
  recorded_by: 'certification seed — no user session was used',
  recorded_for: what,
  basis: facts.source.system,
  observed_utc: facts.source.observed_utc,
  evidence: 'private bundle outside the repository',
  facts_sha256: facts._sha256,
})

/**
 * The rows to insert, before any database is involved. Throws if the plan would set a column outside the
 * whitelist or fill one that must stay empty — so a future edit to the facts file cannot quietly invent something.
 */
export function buildPlan(facts) {
  const v = valuesOf(facts.vehicle.fields)
  const o = valuesOf(facts.order.fields)
  const s = valuesOf(facts.shipment.fields)
  const l = valuesOf(facts.leg.fields)
  const sm = valuesOf(facts.shipment.metadata)
  const plan = {
    vehicles: { ...v },
    diaspora_import_orders: {
      ...o,
      updated_by: o.created_by,
      metadata: { external_reference: facts.order.metadata.external_reference, provenance: provenance(facts, 'import order') },
    },
    diaspora_shipments: {
      ...s,
      metadata: { ...sm, provenance: provenance(facts, 'shipment') },
    },
    diaspora_shipment_legs: {
      ...l,
      metadata: { provenance: provenance(facts, 'declared vessel leg') },
    },
  }
  assertPlanTruthful(plan, facts)
  return plan
}

export function assertPlanTruthful(plan, facts) {
  const problems = []
  for (const [table, row] of Object.entries(plan)) {
    const allowed = new Set(WRITABLE[table])
    for (const [col, val] of Object.entries(row)) {
      if (!allowed.has(col)) problems.push(`${table}.${col} is not a column this script may set`)
      if (val === undefined) problems.push(`${table}.${col} is undefined`)
    }
    for (const col of MUST_STAY_EMPTY[table] || []) {
      if (row[col] !== undefined && row[col] !== null) problems.push(`${table}.${col} must stay empty but is set`)
    }
  }
  // The specific lies that matter most: a movement that was never observed.
  if (plan.diaspora_shipments.status !== 'PLANNED') problems.push('the shipment must be PLANNED')
  if (plan.diaspora_import_orders.status !== 'IMPORT_REQUESTED') problems.push('the order must be IMPORT_REQUESTED')
  if (plan.vehicles.price !== 0) problems.push('the vehicle price is a placeholder 0, never a purchase amount')
  if (plan.vehicles.status !== 'Pending' || plan.vehicles.publication_status !== 'draft') problems.push('the vehicle must stay off the marketplace')
  if (plan.vehicles.owner_id !== facts.account.user_id || plan.diaspora_import_orders.buyer_id !== facts.account.user_id) problems.push('the owner and buyer must be the canonical staging account')
  if (plan.vehicles.vin === facts.protected_vehicle.vin) problems.push('the new vehicle may not be the protected one')
  if (plan.diaspora_shipment_legs.leg_sequence !== 1) problems.push('exactly one leg, sequence 1')
  if (problems.length) throw new HarnessStop('PLAN_NOT_TRUTHFUL', problems.join('; '))
}

function insertSql(table, row) {
  const cols = Object.keys(row)
  const placeholders = cols.map((c, i) => `$${i + 1}${JSONB.has(c) ? '::jsonb' : TIMESTAMP.has(c) ? '::timestamptz' : ''}`)
  const params = cols.map((c) => (JSONB.has(c) ? (row[c] === null ? null : JSON.stringify(row[c])) : row[c]))
  return { sql: `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`, params }
}

const sameValue = (actual, expected) => {
  if (expected === null || expected === undefined) return actual === null || actual === undefined
  if (actual instanceof Date) return actual.getTime() === new Date(expected).getTime()
  if (typeof expected === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(expected) && actual) return new Date(actual).getTime() === new Date(expected).getTime()
  if (typeof expected === 'number') return Number(actual) === expected
  if (typeof expected === 'object') return JSON.stringify(sortKeys(actual)) === JSON.stringify(sortKeys(expected))
  return actual === expected
}
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys)
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]))
  return x
}

/** Compare a row that already exists against what the facts say it should hold. Returns the disagreeing columns. */
function disagreements(row, expected, { ignore = [] } = {}) {
  return Object.entries(expected).filter(([col, val]) => {
    if (ignore.includes(col)) return false
    if (col === 'metadata') {
      // The provenance block carries the run's own hash and may legitimately differ between runs of an edited file;
      // what must agree is every fact in it.
      const actual = { ...(row.metadata || {}) }
      const want = { ...val }
      delete actual.provenance; delete want.provenance
      return !sameValue(actual, want)
    }
    return !sameValue(row[col], val)
  }).map(([col]) => col)
}

async function fingerprint(db, vin) {
  const { rows } = await db.query('SELECT md5(row_to_json(v)::text) AS md5 FROM public.vehicles v WHERE vin = $1', [vin])
  return rows[0]?.md5 ?? null
}

async function counts(db, userId) {
  const { rows } = await db.query(`SELECT
      (SELECT count(*) FROM public.vehicles WHERE owner_id = $1)::int AS kingston_vehicles,
      (SELECT count(*) FROM public.diaspora_import_orders WHERE (buyer_id = $1 OR created_by = $1) AND deleted_at IS NULL)::int AS kingston_orders,
      (SELECT count(*) FROM public.diaspora_shipments WHERE deleted_at IS NULL)::int AS shipments,
      (SELECT count(*) FROM public.diaspora_shipment_legs WHERE deleted_at IS NULL)::int AS legs,
      (SELECT count(*) FROM public.vehicles)::int AS vehicles_total`, [userId])
  return rows[0]
}

async function findExisting(db, facts, plan) {
  const user = facts.account.user_id
  const vin = plan.vehicles.vin
  const one = async (sql, params, what) => {
    const { rows } = await db.query(sql, params)
    if (rows.length > 1) throw new HarnessStop('AMBIGUOUS_EXISTING', `more than one live ${what} already matches; refusing to choose`)
    return rows[0] || null
  }
  const vehicle = await one('SELECT * FROM public.vehicles WHERE vin = $1', [vin], 'vehicle')
  const order = await one('SELECT * FROM public.diaspora_import_orders WHERE buyer_id = $1 AND linked_vehicle_vin = $2 AND deleted_at IS NULL', [user, vin], 'import order')
  const shipment = order ? await one('SELECT * FROM public.diaspora_shipments WHERE import_order_id = $1 AND deleted_at IS NULL', [order.id], 'shipment') : null
  const creationEvent = shipment ? await one("SELECT * FROM public.diaspora_shipment_stage_events WHERE shipment_id = $1 AND deleted_at IS NULL AND metadata->>'created' = 'true'", [shipment.id], 'creation stage event') : null
  const leg = shipment ? await one('SELECT * FROM public.diaspora_shipment_legs WHERE shipment_id = $1 AND leg_sequence = 1 AND deleted_at IS NULL', [shipment.id], 'leg') : null
  return { vehicle, order, shipment, creationEvent, leg }
}

function stopOnDivergence(existing, plan) {
  const bad = []
  if (existing.vehicle) { const d = disagreements(existing.vehicle, plan.vehicles); if (d.length) bad.push(`vehicle: ${d.join(',')}`) }
  if (existing.order) { const d = disagreements(existing.order, plan.diaspora_import_orders); if (d.length) bad.push(`order: ${d.join(',')}`) }
  if (existing.shipment) { const d = disagreements(existing.shipment, { ...plan.diaspora_shipments, import_order_id: existing.order.id }); if (d.length) bad.push(`shipment: ${d.join(',')}`) }
  if (existing.leg) { const d = disagreements(existing.leg, { ...plan.diaspora_shipment_legs, shipment_id: existing.shipment.id }); if (d.length) bad.push(`leg: ${d.join(',')}`) }
  if (bad.length) throw new HarnessStop('EXISTING_ROW_DISAGREES', `an existing row disagrees with the verified facts (${bad.join(' | ')}); it is not "fixed" automatically`)
}

async function prerequisites(db, facts) {
  const { rows } = await db.query('SELECT id FROM public.users WHERE id = $1', [facts.account.user_id])
  if (!rows.length) throw new HarnessStop('BLOCKED_PREREQUISITES', `the canonical staging account ${facts.account.user_id} does not exist`)
  const protectedRow = await fingerprint(db, facts.protected_vehicle.vin)
  if (!protectedRow) throw new HarnessStop('BLOCKED_PREREQUISITES', `the protected vehicle ${facts.protected_vehicle.vin} does not exist`)
  const legs = await db.query("SELECT to_regclass('public.diaspora_shipment_legs') AS t")
  if (!legs.rows[0].t) throw new HarnessStop('BLOCKED_PREREQUISITES', 'diaspora_shipment_legs is not applied')
}

/**
 * The write. `commit:false` rolls everything back (preflight); `commit:true` commits (apply).
 */
export async function seed(db, facts, { commit = false, now = new Date() } = {}) {
  const plan = buildPlan(facts)
  const nowIso = now.toISOString()
  const evidence = { programme: PROGRAMME, committed: false, facts_sha256: facts._sha256, created: {}, existing: {} }
  await db.exec('BEGIN')
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY])
    await prerequisites(db, facts)
    evidence.protected = { vin: facts.protected_vehicle.vin, before: await fingerprint(db, facts.protected_vehicle.vin) }
    evidence.counts_before = await counts(db, facts.account.user_id)

    const existing = await findExisting(db, facts, plan)
    stopOnDivergence(existing, plan)

    const make = async (table, row) => {
      const { sql, params } = insertSql(table, row)
      const { rows } = await db.query(sql, params)
      return rows[0]
    }
    const audit = async (orderId, action, resourceType, resourceId, newState, what) => {
      const metadata = { programme: PROGRAMME, note: `${what} — recorded by the certification seed from the named evidence; no user session`, facts_sha256: facts._sha256 }
      const timestamp = new Date().toISOString()
      await make('diaspora_import_audit_log', {
        import_order_id: orderId, actor_id: null, action, resource_type: resourceType, resource_id: resourceId,
        previous_state: null, new_state: newState, metadata,
        cryptographic_seal: auditSeal({ actorId: null, action, resourceType, resourceId, timestamp, payload: { previousState: null, newState, metadata } }),
      })
    }

    const vehicle = existing.vehicle || await make('vehicles', plan.vehicles)
    evidence[existing.vehicle ? 'existing' : 'created'].vehicle = vehicle.vin

    let order = existing.order
    if (!order) {
      order = await make('diaspora_import_orders', plan.diaspora_import_orders)
      await audit(order.id, 'IMPORT_ORDER_CREATED', 'diaspora_import_order', order.id, order, 'import order')
      evidence.created.import_order = order.id
    } else evidence.existing.import_order = order.id

    let shipment = existing.shipment
    if (!shipment) {
      shipment = await make('diaspora_shipments', { ...plan.diaspora_shipments, import_order_id: order.id })
      await audit(order.id, 'SHIPMENT_CREATED', 'diaspora_shipment', shipment.id, shipment, 'shipment')
      evidence.created.shipment = shipment.id
    } else evidence.existing.shipment = shipment.id

    if (!existing.creationEvent) {
      const event = await make('diaspora_shipment_stage_events', {
        shipment_id: shipment.id, import_order_id: order.id, stage: 'PLANNED', notes: 'Shipment created', event_time: nowIso,
        metadata: { created: true, source: 'certification seed', provenance: provenance(facts, 'shipment creation event') },
      })
      evidence.created.creation_event = event.id
    } else evidence.existing.creation_event = existing.creationEvent.id

    if (!existing.leg) {
      const leg = await make('diaspora_shipment_legs', { ...plan.diaspora_shipment_legs, shipment_id: shipment.id })
      evidence.created.leg = leg.id
    } else evidence.existing.leg = existing.leg.id

    evidence.protected.after = await fingerprint(db, facts.protected_vehicle.vin)
    evidence.protected.unchanged = evidence.protected.before === evidence.protected.after
    if (!evidence.protected.unchanged) throw new HarnessStop('PROTECTED_VEHICLE_CHANGED', `the protected vehicle ${facts.protected_vehicle.vin} changed during the seed; rolling back`)
    evidence.counts_after_in_transaction = await counts(db, facts.account.user_id)

    if (commit) { await db.exec('COMMIT'); evidence.committed = true } else await db.exec('ROLLBACK')
    return evidence
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => {})
    throw error
  }
}

/** Read-only: do the records exist, hold exactly the facts, and claim nothing more? */
export async function verify(db, facts) {
  const plan = buildPlan(facts)
  const problems = []
  const existing = await findExisting(db, facts, plan)
  for (const [name, row] of Object.entries(existing)) if (!row) problems.push(`missing: ${name}`)
  if (!problems.length) {
    const checks = [
      ['vehicle', existing.vehicle, plan.vehicles],
      ['order', existing.order, plan.diaspora_import_orders],
      ['shipment', existing.shipment, { ...plan.diaspora_shipments, import_order_id: existing.order.id }],
      ['leg', existing.leg, { ...plan.diaspora_shipment_legs, shipment_id: existing.shipment.id }],
    ]
    for (const [name, row, expected] of checks) {
      const d = disagreements(row, expected)
      if (d.length) problems.push(`${name} disagrees with the facts: ${d.join(',')}`)
    }
    for (const col of MUST_STAY_EMPTY.diaspora_shipments) if (existing.shipment[col] !== null && existing.shipment[col] !== undefined) problems.push(`shipment.${col} is set`)
    for (const col of MUST_STAY_EMPTY.diaspora_import_orders) if (existing.order[col] !== null && existing.order[col] !== undefined) problems.push(`order.${col} is set`)
    for (const col of MUST_STAY_EMPTY.vehicles) if (existing.vehicle[col] !== null && existing.vehicle[col] !== undefined) problems.push(`vehicle.${col} is set`)
    const { rows: events } = await db.query("SELECT stage FROM public.diaspora_shipment_stage_events WHERE shipment_id = $1 AND deleted_at IS NULL", [existing.shipment.id])
    if (events.some((e) => e.stage !== 'PLANNED')) problems.push('a movement stage event exists that this seed did not record')
    const { rows: revisions } = await db.query('SELECT count(*)::int AS n FROM public.diaspora_shipment_observations WHERE shipment_id = $1', [existing.shipment.id])
    if (revisions[0].n !== 0) problems.push('an estimate revision exists that this seed did not record')
    const { rows: legsN } = await db.query('SELECT count(*)::int AS n FROM public.diaspora_shipment_legs WHERE shipment_id = $1 AND deleted_at IS NULL', [existing.shipment.id])
    if (legsN[0].n !== 1) problems.push(`expected exactly one live leg, found ${legsN[0].n}`)
  }
  const protectedNow = await fingerprint(db, facts.protected_vehicle.vin)
  if (!protectedNow) problems.push('the protected vehicle is missing')
  return {
    verdict: problems.length ? 'DIFFERS' : 'MATCHES',
    problems,
    ids: problems.length ? null : {
      vehicle: existing.vehicle.vin, import_order: existing.order.id, shipment: existing.shipment.id, creation_event: existing.creationEvent.id, leg: existing.leg.id,
    },
    protected_fingerprint: protectedNow,
    counts: await counts(db, facts.account.user_id),
  }
}

async function main() {
  const MODE = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=preflight').split('=')[1]
  if (!['preflight', 'apply', 'verify'].includes(MODE)) { console.error(`BLOCKED: unsupported --mode=${MODE}`); process.exit(2) }
  const { default: pg } = await import('pg')
  const resultsDir = path.resolve(process.env.T11_CAP_RESULTS_DIR || 'test-results/t11-cap-r1')
  fs.mkdirSync(resultsDir, { recursive: true })
  let client
  try {
    const facts = loadFacts()
    const url = ensureStagingDbUrl().replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '')
    const loopback = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url)
    client = new pg.Client({ connectionString: url, ssl: loopback ? false : { rejectUnauthorized: false } })
    await client.connect()
    const db = makeDb(client)
    let out
    if (MODE === 'verify') out = await verify(db, facts)
    else {
      out = await seed(db, facts, { commit: MODE === 'apply' })
      if (MODE === 'apply') out.verify = await verify(db, facts)
    }
    fs.writeFileSync(path.join(resultsDir, `${MODE}.json`), JSON.stringify(out, null, 2))
    console.log(JSON.stringify(out))
    if ((out.verdict && out.verdict !== 'MATCHES') || (out.verify && out.verify.verdict !== 'MATCHES')) throw new HarnessStop('DIFFERS', 'the staging records do not match the verified facts')
  } catch (error) {
    if (error instanceof HarnessStop) {
      const blocked = ['BLOCKED_PREREQUISITES', 'NO_DATABASE_URL', 'NOT_APPROVED_STAGING'].includes(error.code)
      console.error(`${blocked ? 'BLOCKED' : 'FAIL'}: ${error.code}: ${error.message}`)
      process.exit(blocked ? 2 : 1)
    }
    console.error(`ERROR: ${error.stack || error.message}`)
    process.exit(1)
  } finally { if (client) await client.end().catch(() => {}) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
