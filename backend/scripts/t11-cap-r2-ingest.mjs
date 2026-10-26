/**
 * T11-CAP-LR01-R2 — ingest the Owner-authorised HISTORICAL customer-progress record of the first real transaction into
 * CarUp's own tables, on STAGING, with provenance on every row.
 *
 * What it writes — and the only things it writes:
 *   diaspora_external_progress_entries   the 14 actions the source reported, in 5 stages, all Completed, with NO time
 *   diaspora_order_parties               consignee (name + coarse location), notify party, document delivery/centre, agent
 *   diaspora_document_dispatches         the posting of the B/L originals, in the source's own words
 *   vehicle_specification_observations   spec facts `vehicles` has no column for
 *   vehicle_media_references             the 50 existing evidence photos, in gallery order — references, not copies
 *   diaspora_import_audit_log            one attributable row per batch
 *
 * What it will not do, and checks:
 *   · it touches PRODUCTION never: it refuses any URL that is not the approved staging project;
 *   · it invents nothing: every value comes from the facts file (itself generated from the private capture), and the plan
 *     is held to rules — no completion time for any action, every action Completed exactly as reported, the stage counts
 *     the capture proved (7/1/3/1/2), no tracking number or time for the dispatch, and NO consignee street address, phone
 *     or email (personal data; the account profile remains their one home);
 *   · it writes NOTHING that is movement: it never touches T11's shipments, stage events, legs or observations, T12, T8
 *     or the payment milestones, and it checks that none of them changed;
 *   · it changes no existing row: INSERT-only, and the protected vehicle (the Serena), the target vehicle, the order and
 *     the shipment are fingerprinted before and after — one byte of difference rolls the whole transaction back;
 *   · it is idempotent: a second run finds its own rows by natural key and inserts nothing; an existing row that DISAGREES
 *     with the facts STOPS the run — it is reported, never "fixed";
 *   · it emits no event and sends nothing: raw inserts pass through no event service, and event and notification counts
 *     are compared before and after.
 *
 * RECOVERY. The tables forbid editing and deleting a recorded fact, so recovery is SUPERSESSION, not deletion:
 *     node backend/scripts/t11-cap-r2-ingest.mjs --mode=supersede --confirm=<ingestion_run>
 * sets deleted_at on exactly the rows this run wrote (identified by ingestion_run), in one transaction, with an audit row.
 * Nothing is lost: superseded rows stay, a repeat of `apply` then records fresh rows, and `verify` reports the difference.
 *
 * Modes: preflight = the whole write inside a transaction that is ROLLED BACK; apply = the same, committed, then verified;
 * verify = read-only; supersede = recovery (needs --confirm).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessStop, ensureStagingDbUrl, makeDb } from './t11-cap-stg-converge.mjs'
import { auditSeal } from './t11-cap-r1-vezel-seed.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FACTS_PATH = path.resolve(HERE, 'data/t11-cap-r2-historical-facts.json')
export const PROGRAMME = 'T11-CAP-LR01-R2'
const LOCK_KEY = 't11-cap-r2-ingest'

const LEDGER = 'diaspora_external_progress_entries'
const PARTIES = 'diaspora_order_parties'
const DISPATCHES = 'diaspora_document_dispatches'
const SPECS = 'vehicle_specification_observations'
const MEDIA = 'vehicle_media_references'
const AUDIT = 'diaspora_import_audit_log'
export const INGESTED_TABLES = Object.freeze([PARTIES, DISPATCHES, LEDGER, SPECS, MEDIA])

/** The only columns this script may set, per table. Anything else is a defect, not a convenience. */
export const WRITABLE = Object.freeze({
  [LEDGER]: ['import_order_id', 'vehicle_vin', 'stage_code', 'entry_sequence', 'action_sequence', 'action_taker_reported', 'action_taker_kind', 'action_text',
    'reported_status', 'source_system', 'source_reference', 'source_position', 'evidence_ref', 'evidence_digest', 'observed_at', 'ingestion_run', 'metadata'],
  [PARTIES]: ['import_order_id', 'party_role', 'party_kind', 'display_name', 'address_line', 'city', 'country', 'phone', 'email', 'origin', 'source_system',
    'source_reference', 'source_position', 'evidence_ref', 'evidence_digest', 'observed_at', 'ingestion_run', 'metadata'],
  [DISPATCHES]: ['import_order_id', 'recipient_party_id', 'document_types', 'status_reported_text', 'dispatch_status', 'status_observed_at', 'message_text', 'origin',
    'source_system', 'source_reference', 'source_position', 'evidence_ref', 'evidence_digest', 'ingestion_run', 'metadata'],
  [SPECS]: ['vin', 'spec_key', 'value_text', 'value_number', 'unit', 'source_value_raw', 'origin', 'source_system', 'source_reference', 'source_position',
    'evidence_ref', 'evidence_digest', 'observed_at', 'ingestion_run', 'metadata'],
  [MEDIA]: ['vin', 'evidence_id', 'gallery_position', 'is_primary', 'primary_basis', 'ordinal_basis', 'source_system', 'source_reference', 'source_position',
    'observed_at', 'ingestion_run', 'metadata'],
  [AUDIT]: ['import_order_id', 'actor_id', 'action', 'resource_type', 'resource_id', 'previous_state', 'new_state', 'metadata', 'cryptographic_seal'],
})

/** Columns that, if ever non-null here, would be an invented business fact. */
export const MUST_STAY_EMPTY = Object.freeze({
  [LEDGER]: ['event_time', 'event_time_basis', 'tenant_id', 'shipment_id', 'created_by', 'updated_by'],
  [PARTIES]: ['tenant_id', 'created_by', 'updated_by'],
  [DISPATCHES]: ['tracking_number', 'courier_name', 'dispatched_at', 'delivered_at', 'shipment_id', 'tenant_id', 'created_by', 'updated_by'],
  [SPECS]: ['created_by', 'updated_by'],
  [MEDIA]: ['label', 'created_by', 'updated_by'],
})

const JSONB = new Set(['metadata', 'previous_state', 'new_state'])
const TIMESTAMP = new Set(['observed_at', 'status_observed_at', 'event_time', 'dispatched_at', 'delivered_at'])
const TEXT_ARRAY = new Set(['document_types'])

const STAGE_COUNTS = Object.freeze({ BOOKING: 7, DEPARTURE: 1, BILL_OF_LADING: 3, DISPATCH: 1, CLEARING_DELIVERY: 2 })

export function loadFacts(file = FACTS_PATH) {
  const text = fs.readFileSync(file, 'utf8')
  return { ...JSON.parse(text), _sha256: crypto.createHash('sha256').update(text).digest('hex') }
}

const provenance = (facts, what) => ({
  programme: PROGRAMME,
  recorded_by: 'certification ingestion — no user session was used',
  recorded_for: what,
  basis: facts.source.label,
  observed_utc: facts.source.observed_at,
  evidence: 'private bundle outside the repository, cited by content digest',
  facts_sha256: facts._sha256,
})

/** The source's display name travels WITH THE DATA, so reusable code never has to name any source. */
const sourceMeta = (facts) => ({ source_label: facts.source.display_label });

const externalBase = (facts, context) => ({
  source_system: facts.source.system,
  source_reference: facts.source.reference,
  evidence_ref: facts.source.evidence.ref,
  evidence_digest: facts.source.evidence.digest_sha256,
  observed_at: facts.source.observed_at,
  ingestion_run: facts.ingestion_run,
})

/**
 * The rows to insert, before any database write. `context` carries what only the database knows: the order the facts belong
 * to and the ordered evidence photographs. Throws if the plan would set a column outside the whitelist, fill one that must
 * stay empty, or break the rules the capture established.
 */
export function buildPlan(facts, context) {
  const base = externalBase(facts)
  const orderId = context.order.id
  const plan = {
    [PARTIES]: facts.parties.map((p) => {
      const row = {
        import_order_id: orderId, party_role: p.party_role, party_kind: p.party_kind, display_name: p.display_name,
        ...Object.fromEntries(['address_line', 'city', 'country', 'phone', 'email'].filter((k) => p[k]).map((k) => [k, p[k]])),
        origin: 'EXTERNAL_REPORT', ...base, source_position: p.source_position,
        metadata: { ...sourceMeta(facts), ...(p.note ? { note: p.note } : {}), ...(p.withheld_from_source_control ? { withheld_from_source_control: p.withheld_from_source_control } : {}), provenance: provenance(facts, `party ${p.party_role}`) },
      }
      return row
    }),
    [DISPATCHES]: [{
      import_order_id: orderId, recipient_party_role: facts.dispatch.recipient_party_role,
      document_types: facts.dispatch.document_types, status_reported_text: facts.dispatch.status_reported_text, dispatch_status: facts.dispatch.dispatch_status,
      status_observed_at: facts.source.observed_at, message_text: facts.dispatch.message_text, origin: 'EXTERNAL_REPORT',
      source_system: base.source_system, source_reference: base.source_reference, source_position: facts.dispatch.source_position,
      evidence_ref: base.evidence_ref, evidence_digest: base.evidence_digest, ingestion_run: base.ingestion_run,
      metadata: { ...sourceMeta(facts), note: facts.dispatch.note, provenance: provenance(facts, 'document dispatch') },
    }],
    [LEDGER]: facts.progress.map((e) => ({
      import_order_id: orderId, vehicle_vin: facts.target.vin, stage_code: e.stage_code, entry_sequence: e.entry_sequence, action_sequence: e.action_sequence,
      action_taker_reported: e.action_taker_reported, action_taker_kind: e.action_taker_kind, action_text: e.action_text, reported_status: e.reported_status,
      ...base, source_position: e.source_position, metadata: { ...sourceMeta(facts), provenance: provenance(facts, 'reported customer progress') },
    })),
    [SPECS]: facts.specifications.map((s) => ({
      vin: facts.target.vin, spec_key: s.spec_key,
      ...(s.value_text !== undefined ? { value_text: s.value_text } : {}), ...(s.value_number !== undefined ? { value_number: s.value_number } : {}), ...(s.unit ? { unit: s.unit } : {}),
      source_value_raw: s.source_value_raw, origin: 'EXTERNAL_REPORT', ...base, source_position: s.source_position,
      metadata: { ...sourceMeta(facts), provenance: provenance(facts, 'vehicle specification') },
    })),
    [MEDIA]: context.photos.map((photo, index) => {
      const position = index + 1
      const primary = position === facts.media.primary_position
      return {
        vin: facts.target.vin, evidence_id: photo.id, gallery_position: position, is_primary: primary, ...(primary ? { primary_basis: facts.media.primary_basis } : {}),
        ordinal_basis: facts.media.ordinal_basis, source_system: base.source_system, source_reference: base.source_reference, source_position: position,
        observed_at: photo.uploaded_at instanceof Date ? photo.uploaded_at.toISOString() : new Date(photo.uploaded_at).toISOString(),
        ingestion_run: base.ingestion_run,
        metadata: { ordinal_note: facts.media.ordinal_note, provenance: provenance(facts, 'vehicle media reference') },
      }
    }),
  }
  assertPlanTruthful(plan, facts)
  return plan
}

export function assertPlanTruthful(plan, facts) {
  const problems = []
  const writable = (table) => new Set(WRITABLE[table])
  const virtual = new Set(['recipient_party_role'])
  for (const [table, rows] of Object.entries(plan)) {
    const allowed = writable(table)
    for (const row of rows) {
      for (const [col, val] of Object.entries(row)) {
        if (!allowed.has(col) && !virtual.has(col)) problems.push(`${table}.${col} is not a column this script may set`)
        if (val === undefined) problems.push(`${table}.${col} is undefined`)
      }
      for (const col of MUST_STAY_EMPTY[table] || []) {
        if (row[col] !== undefined && row[col] !== null) problems.push(`${table}.${col} must stay empty but is set`)
      }
    }
  }
  const ledger = plan[LEDGER]
  const byStage = {}
  for (const e of ledger) byStage[e.stage_code] = (byStage[e.stage_code] || 0) + 1
  if (ledger.length !== 14) problems.push(`the capture proved 14 reported actions; the plan has ${ledger.length}`)
  if (JSON.stringify(Object.entries(byStage).sort()) !== JSON.stringify(Object.entries(STAGE_COUNTS).sort())) problems.push(`the stage counts differ from the capture's 7/1/3/1/2: ${JSON.stringify(byStage)}`)
  if (ledger.some((e) => e.reported_status !== 'COMPLETED')) problems.push('every action was reported Completed; the plan must not downgrade or upgrade any')
  if (ledger.some((e, i) => e.entry_sequence !== i + 1)) problems.push('entry sequences must be exactly 1..14 in order')
  // The most important lie to refuse: a time that nobody stated.
  if (ledger.some((e) => 'event_time' in e || 'event_time_basis' in e)) problems.push('no completion time is supplied by the source; none may be recorded')

  const consignee = plan[PARTIES].find((p) => p.party_role === 'CONSIGNEE')
  if (!consignee) problems.push('the consignee party is missing')
  else for (const col of ['address_line', 'phone', 'email']) if (consignee[col]) problems.push(`the consignee's ${col} is personal data and must not be ingested from source control`)
  if (plan[PARTIES].length !== 5) problems.push(`expected five declared parties, found ${plan[PARTIES].length}`)
  if (new Set(plan[PARTIES].map((p) => p.party_role)).size !== plan[PARTIES].length) problems.push('a party role appears twice')

  const dispatch = plan[DISPATCHES][0]
  if (plan[DISPATCHES].length !== 1) problems.push('exactly one dispatch was reported')
  if (dispatch && (dispatch.tracking_number || dispatch.courier_name || dispatch.dispatched_at || dispatch.delivered_at)) problems.push('the dispatch states no tracking number, courier or time')

  if (plan[MEDIA].length !== facts.media.expected_count) problems.push(`expected ${facts.media.expected_count} media references, found ${plan[MEDIA].length}`)
  if (plan[MEDIA].filter((m) => m.is_primary).length !== 1) problems.push('exactly one media reference is primary')
  if (plan[MEDIA].some((m, i) => m.gallery_position !== i + 1)) problems.push('gallery positions must be exactly 1..N in order')
  if (plan[SPECS].filter((s) => s.spec_key !== 'EQUIPMENT_ITEM').length !== new Set(plan[SPECS].filter((s) => s.spec_key !== 'EQUIPMENT_ITEM').map((s) => s.spec_key)).size) problems.push('a single-valued specification appears twice')

  const text = JSON.stringify(plan)
  if (/[?&]t=[0-9a-f]{16,}/i.test(text) || /cap\?t=/i.test(text)) problems.push('a capability token is present in the plan')
  if (problems.length) throw new HarnessStop('PLAN_NOT_TRUTHFUL', problems.join('; '))
}

// ── SQL helpers ─────────────────────────────────────────────────────────────

function insertSql(table, row) {
  const cols = Object.keys(row)
  const placeholders = cols.map((c, i) => `$${i + 1}${JSONB.has(c) ? '::jsonb' : TIMESTAMP.has(c) ? '::timestamptz' : TEXT_ARRAY.has(c) ? '::text[]' : ''}`)
  const params = cols.map((c) => (JSONB.has(c) ? (row[c] === null ? null : JSON.stringify(row[c])) : row[c]))
  return { sql: `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`, params }
}

const sortKeys = (x) => {
  if (Array.isArray(x)) return x.map(sortKeys)
  if (x && typeof x === 'object' && !(x instanceof Date)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]))
  return x
}
const sameValue = (actual, expected) => {
  if (expected === null || expected === undefined) return actual === null || actual === undefined
  if (actual instanceof Date) return actual.getTime() === new Date(expected).getTime()
  if (typeof expected === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(expected) && actual) return new Date(actual).getTime() === new Date(expected).getTime()
  if (typeof expected === 'number') return Number(actual) === expected
  if (Array.isArray(expected)) return JSON.stringify(actual) === JSON.stringify(expected)
  if (typeof expected === 'object') return JSON.stringify(sortKeys(actual)) === JSON.stringify(sortKeys(expected))
  return actual === expected
}
/** The columns of an existing row that disagree with the plan. The provenance block carries this run's own hash, so only its facts are compared. */
function disagreements(row, expected) {
  return Object.entries(expected).filter(([col, val]) => {
    if (col === 'recipient_party_role') return false
    if (col === 'metadata') {
      const actual = { ...(row.metadata || {}) }
      const want = { ...val }
      delete actual.provenance; delete want.provenance
      return !sameValue(actual, want)
    }
    return !sameValue(row[col], val)
  }).map(([col]) => col)
}

const NATURAL_KEY = Object.freeze({
  [PARTIES]: (r) => ({ import_order_id: r.import_order_id, party_role: r.party_role }),
  [DISPATCHES]: (r) => ({ import_order_id: r.import_order_id, source_system: r.source_system, source_reference: r.source_reference }),
  [LEDGER]: (r) => ({ import_order_id: r.import_order_id, source_system: r.source_system, source_reference: r.source_reference, entry_sequence: r.entry_sequence }),
  [SPECS]: (r) => ({ vin: r.vin, spec_key: r.spec_key, source_system: r.source_system, source_reference: r.source_reference, ...(r.spec_key === 'EQUIPMENT_ITEM' ? { value_text: r.value_text } : {}) }),
  [MEDIA]: (r) => ({ vin: r.vin, evidence_id: r.evidence_id }),
})

async function findLive(db, table, row) {
  const key = NATURAL_KEY[table](row)
  const conds = []
  const params = []
  for (const [col, val] of Object.entries(key)) {
    params.push(val)
    conds.push(table === SPECS && col === 'value_text' ? `lower(value_text) = lower($${params.length})` : `${col} = $${params.length}`)
  }
  const { rows } = await db.query(`SELECT * FROM public.${table} WHERE ${conds.join(' AND ')} AND deleted_at IS NULL`, params)
  if (rows.length > 1) throw new HarnessStop('AMBIGUOUS_EXISTING', `more than one live ${table} row matches ${JSON.stringify(key)}; refusing to choose`)
  return rows[0] || null
}

async function fingerprint(db, table, column, value) {
  const { rows } = await db.query(`SELECT md5(row_to_json(t)::text) AS md5 FROM public.${table} t WHERE ${column} = $1`, [value])
  return rows[0]?.md5 ?? null
}

/** Everything that must be exactly the same after as before. */
async function invariants(db, facts, context) {
  const orderId = context.order.id
  const one = async (sql, params) => (await db.query(sql, params)).rows[0].n
  const q = (table, where = 'true', params = []) => one(`SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`, params)
  return {
    fingerprints: {
      protected_vehicle: await fingerprint(db, 'vehicles', 'vin', facts.protected_vehicle.vin),
      target_vehicle: await fingerprint(db, 'vehicles', 'vin', facts.target.vin),
      order: await fingerprint(db, 'diaspora_import_orders', 'id', orderId),
      shipment: context.shipment ? await fingerprint(db, 'diaspora_shipments', 'id', context.shipment.id) : null,
    },
    counts: {
      stage_events: context.shipment ? await q('diaspora_shipment_stage_events', 'shipment_id = $1 AND deleted_at IS NULL', [context.shipment.id]) : 0,
      observations: context.shipment ? await q('diaspora_shipment_observations', 'shipment_id = $1', [context.shipment.id]) : 0,
      legs: context.shipment ? await q('diaspora_shipment_legs', 'shipment_id = $1 AND deleted_at IS NULL', [context.shipment.id]) : 0,
      shipments: await q('diaspora_shipments'),
      orders: await q('diaspora_import_orders'),
      vehicles: await q('vehicles'),
      evidence_target: await q('vehicle_evidence', 'vin = $1', [facts.target.vin]),
      evidence_protected: await q('vehicle_evidence', 'vin = $1', [facts.protected_vehicle.vin]),
      listing_images_target: await q('listing_images', 'vin = $1', [facts.target.vin]),
      listing_images_protected: await q('listing_images', 'vin = $1', [facts.protected_vehicle.vin]),
      trade_documents: await q('diaspora_trade_documents', 'import_order_id = $1 AND deleted_at IS NULL', [orderId]),
      payment_milestones: await q('diaspora_payment_milestones', 'import_order_id = $1', [orderId]),
      customs_cases: await q('diaspora_customs_cases', 'import_order_id = $1', [orderId]),
      domain_events: await q('domain_events'),
      notifications: await q('notification_queue'),
    },
  }
}

async function prerequisites(db, facts) {
  const missing = []
  for (const t of [...INGESTED_TABLES, 'vehicles', 'vehicle_evidence', 'listing_images', 'diaspora_import_orders', 'diaspora_shipments', 'diaspora_shipment_stage_events',
    'diaspora_shipment_observations', 'diaspora_shipment_legs', 'diaspora_trade_documents', 'diaspora_payment_milestones', 'diaspora_customs_cases', 'domain_events', 'notification_queue', AUDIT]) {
    const { rows } = await db.query('SELECT to_regclass($1) AS t', [`public.${t}`])
    if (!rows[0].t) missing.push(t)
  }
  if (missing.length) throw new HarnessStop('BLOCKED_PREREQUISITES', `not applied / not present: ${missing.join(', ')}`)
  const { rows } = await db.query('SELECT id FROM public.users WHERE id = $1', [facts.account.user_id])
  if (!rows.length) throw new HarnessStop('BLOCKED_PREREQUISITES', `the canonical staging account ${facts.account.user_id} does not exist`)
}

/** What only the database knows: the order, its shipment, and the ordered photographs. */
export async function gatherContext(db, facts) {
  const vin = facts.target.vin
  const { rows: vehicles } = await db.query('SELECT * FROM public.vehicles WHERE vin = $1', [vin])
  if (vehicles.length !== 1) throw new HarnessStop('BLOCKED_PREREQUISITES', `the target vehicle ${vin} must exist exactly once`)
  if (vehicles[0].owner_id !== facts.account.user_id) throw new HarnessStop('BLOCKED_PREREQUISITES', `the target vehicle is not owned by ${facts.account.user_id}`)
  const { rows: orders } = await db.query('SELECT * FROM public.diaspora_import_orders WHERE buyer_id = $1 AND linked_vehicle_vin = $2 AND deleted_at IS NULL', [facts.account.user_id, vin])
  if (orders.length !== 1) throw new HarnessStop('AMBIGUOUS_EXISTING', `expected exactly one live import order for the target vehicle, found ${orders.length}`)
  const order = orders[0]
  const ext = order.metadata?.external_reference
  if (ext?.reference && ext.reference !== facts.source.reference) throw new HarnessStop('EXISTING_ROW_DISAGREES', `the order's external reference ${ext.reference} is not the capture's ${facts.source.reference}`)
  const { rows: shipments } = await db.query('SELECT * FROM public.diaspora_shipments WHERE import_order_id = $1 AND deleted_at IS NULL', [order.id])
  if (shipments.length > 1) throw new HarnessStop('AMBIGUOUS_EXISTING', 'more than one live shipment for the order; refusing to choose')

  const sel = facts.media.evidence_selector
  const { rows: photos } = await db.query(
    `SELECT id, uploaded_at, mime_type, verification_status FROM public.vehicle_evidence
      WHERE vin = $1 AND evidence_type = $2 AND evidence_subtype = $3 ORDER BY uploaded_at ASC, id ASC`, [vin, sel.evidence_type, sel.evidence_subtype])
  if (photos.length !== facts.media.expected_count) throw new HarnessStop('EXISTING_ROW_DISAGREES', `expected ${facts.media.expected_count} imported photographs, found ${photos.length}`)
  if (new Set(photos.map((p) => new Date(p.uploaded_at).getTime())).size !== photos.length) throw new HarnessStop('EXISTING_ROW_DISAGREES', 'two photographs share an upload instant: the gallery order would be ambiguous, so none is chosen')
  if (photos.some((p) => !/^image\//.test(p.mime_type || ''))) throw new HarnessStop('EXISTING_ROW_DISAGREES', 'a selected evidence row is not an image')
  if (photos.some((p) => p.verification_status === 'rejected')) throw new HarnessStop('EXISTING_ROW_DISAGREES', 'a selected photograph has been rejected; it cannot be presented')
  return { vehicle: vehicles[0], order, shipment: shipments[0] || null, photos }
}

async function liveSourceRows(db, table, scope) {
  const column = scope.column
  const extra = table === MEDIA ? '' : ' AND source_system = $2'
  const params = table === MEDIA ? [scope.value] : [scope.value, scope.source]
  return (await db.query(`SELECT * FROM public.${table} WHERE ${column} = $1${extra} AND deleted_at IS NULL`, params)).rows
}

const SCOPE = (facts, context) => ({
  [PARTIES]: { column: 'import_order_id', value: context.order.id, source: facts.source.system },
  [DISPATCHES]: { column: 'import_order_id', value: context.order.id, source: facts.source.system },
  [LEDGER]: { column: 'import_order_id', value: context.order.id, source: facts.source.system },
  [SPECS]: { column: 'vin', value: facts.target.vin, source: facts.source.system },
  [MEDIA]: { column: 'vin', value: facts.target.vin },
})

/** Existing rows that the plan does not account for (a 15th action, a different gallery order, ...). */
async function unexpectedRows(db, facts, context, plan) {
  const scope = SCOPE(facts, context)
  const out = []
  for (const table of INGESTED_TABLES) {
    const live = await liveSourceRows(db, table, scope[table])
    const known = new Set(plan[table].map((r) => JSON.stringify(sortKeys(NATURAL_KEY[table](r))).toLowerCase()))
    for (const row of live) {
      const key = JSON.stringify(sortKeys(NATURAL_KEY[table](row))).toLowerCase()
      if (!known.has(key)) out.push(`${table}: a live row the plan does not contain (${key})`)
    }
  }
  return out
}

/**
 * The write. `commit:false` rolls everything back (preflight); `commit:true` commits (apply).
 */
export async function ingest(db, facts, { commit = false } = {}) {
  const evidence = { programme: PROGRAMME, committed: false, ingestion_run: facts.ingestion_run, facts_sha256: facts._sha256, created: {}, existing: {} }
  await db.exec('BEGIN')
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY])
    await prerequisites(db, facts)
    const context = await gatherContext(db, facts)
    const plan = buildPlan(facts, context)
    evidence.plan_counts = Object.fromEntries(INGESTED_TABLES.map((t) => [t, plan[t].length]))
    evidence.before = await invariants(db, facts, context)

    // Compare before writing anything: an existing row that disagrees STOPS the run.
    const divergent = []
    const existing = {}
    for (const table of INGESTED_TABLES) {
      existing[table] = new Map()
      for (const row of plan[table]) {
        if (table === DISPATCHES) continue   // recipient is resolved after the parties exist
        const found = await findLive(db, table, row)
        if (!found) continue
        existing[table].set(JSON.stringify(NATURAL_KEY[table](row)), found)
        const d = disagreements(found, row)
        if (d.length) divergent.push(`${table} ${JSON.stringify(NATURAL_KEY[table](row))}: ${d.join(',')}`)
        for (const col of MUST_STAY_EMPTY[table] || []) {
          if (found[col] !== null && found[col] !== undefined) divergent.push(`${table} ${JSON.stringify(NATURAL_KEY[table](row))}: ${col} is set but must stay empty`)
        }
      }
    }
    const unexpected = await unexpectedRows(db, facts, context, plan)
    if (divergent.length || unexpected.length) {
      throw new HarnessStop('EXISTING_ROW_DISAGREES', `existing rows disagree with the facts and are not "fixed" automatically: ${[...divergent, ...unexpected].slice(0, 12).join(' | ')}`)
    }

    const make = async (table, row) => {
      const { sql, params } = insertSql(table, row)
      return (await db.query(sql, params)).rows[0]
    }
    const batches = {}
    const written = (table) => (batches[table] ||= [])

    // 1. parties — the dispatch refers to one of them
    const partyIds = {}
    for (const row of plan[PARTIES]) {
      const key = JSON.stringify(NATURAL_KEY[PARTIES](row))
      const found = existing[PARTIES].get(key)
      if (found) { partyIds[row.party_role] = found.id; continue }
      const made = await make(PARTIES, row)
      partyIds[row.party_role] = made.id
      written(PARTIES).push(made.id)
    }
    // 2. the dispatch
    for (const { recipient_party_role: role, ...row } of plan[DISPATCHES]) {
      const recipient = partyIds[role]
      if (!recipient) throw new HarnessStop('PLAN_NOT_TRUTHFUL', `the dispatch refers to a party role (${role}) that the plan does not contain`)
      const full = { ...row, recipient_party_id: recipient }
      const found = await findLive(db, DISPATCHES, full)
      if (found) {
        const d = disagreements(found, full)
        if (d.length) throw new HarnessStop('EXISTING_ROW_DISAGREES', `${DISPATCHES}: ${d.join(',')}`)
        continue
      }
      written(DISPATCHES).push((await make(DISPATCHES, full)).id)
    }
    // 3. the rest
    for (const table of [LEDGER, SPECS, MEDIA]) {
      for (const row of plan[table]) {
        if (existing[table].has(JSON.stringify(NATURAL_KEY[table](row)))) continue
        written(table).push((await make(table, row)).id)
      }
    }

    // 4. attribution — one audit row per batch that actually wrote something
    const ACTION = { [PARTIES]: 'CAP_R2_PARTIES_INGESTED', [DISPATCHES]: 'CAP_R2_DISPATCH_INGESTED', [LEDGER]: 'CAP_R2_PROGRESS_INGESTED', [SPECS]: 'CAP_R2_SPECIFICATIONS_INGESTED', [MEDIA]: 'CAP_R2_MEDIA_REFERENCED' }
    for (const table of INGESTED_TABLES) {
      const ids = batches[table] || []
      evidence[ids.length ? 'created' : 'existing'][table] = ids.length || plan[table].length
      if (!ids.length) continue
      const newState = { ingestion_run: facts.ingestion_run, table, inserted: ids.length, source_reference: facts.source.reference, evidence_digest: facts.source.evidence.digest_sha256, ids }
      const metadata = { programme: PROGRAMME, note: `${ACTION[table]} — recorded by the certification ingestion from the named evidence; no user session`, facts_sha256: facts._sha256 }
      const timestamp = new Date().toISOString()
      await make(AUDIT, {
        import_order_id: context.order.id, actor_id: null, action: ACTION[table], resource_type: table, resource_id: context.order.id,
        previous_state: null, new_state: newState, metadata,
        cryptographic_seal: auditSeal({ actorId: null, action: ACTION[table], resourceType: table, resourceId: context.order.id, timestamp, payload: { previousState: null, newState, metadata } }),
      })
    }

    // 5. nothing else may have moved
    evidence.after = await invariants(db, facts, context)
    const moved = []
    for (const [k, v] of Object.entries(evidence.before.fingerprints)) if (v !== evidence.after.fingerprints[k]) moved.push(`fingerprint ${k}`)
    for (const [k, v] of Object.entries(evidence.before.counts)) if (v !== evidence.after.counts[k]) moved.push(`count ${k}: ${v} -> ${evidence.after.counts[k]}`)
    if (moved.length) throw new HarnessStop('SOMETHING_ELSE_CHANGED', `the ingestion changed what it must not change (${moved.join('; ')}); rolling back`)
    evidence.unchanged = true

    if (commit) { await db.exec('COMMIT'); evidence.committed = true } else await db.exec('ROLLBACK')
    return evidence
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => {})
    throw error
  }
}

/** Read-only: do the rows exist, hold exactly the facts, and claim nothing more? */
export async function verify(db, facts) {
  const problems = []
  await prerequisites(db, facts)
  const context = await gatherContext(db, facts)
  const plan = buildPlan(facts, context)
  const partyIds = {}
  for (const table of INGESTED_TABLES) {
    for (const row of plan[table]) {
      const lookup = table === DISPATCHES ? { ...row, recipient_party_id: partyIds[row.recipient_party_role] } : row
      const found = await findLive(db, table, lookup)
      if (!found) { problems.push(`missing: ${table} ${JSON.stringify(NATURAL_KEY[table](row))}`); continue }
      if (table === PARTIES) partyIds[row.party_role] = found.id
      const d = disagreements(found, table === DISPATCHES ? { ...lookup } : row)
      if (d.length) problems.push(`${table} ${JSON.stringify(NATURAL_KEY[table](row))} disagrees with the facts: ${d.join(',')}`)
      for (const col of MUST_STAY_EMPTY[table] || []) if (found[col] !== null && found[col] !== undefined) problems.push(`${table}.${col} is set on ${JSON.stringify(NATURAL_KEY[table](row))}`)
      // Verification state is meant to MOVE (a reviewer may corroborate or verify a row); only a dispute is a finding here.
      if (found.verification_status === 'DISPUTED') problems.push(`${table} ${JSON.stringify(NATURAL_KEY[table](row))} is DISPUTED`)
    }
  }
  problems.push(...await unexpectedRows(db, facts, context, plan))
  // The structural truths about movement, asserted on the rows themselves and not just on the plan.
  const { rows: events } = context.shipment
    ? await db.query("SELECT stage FROM public.diaspora_shipment_stage_events WHERE shipment_id = $1 AND deleted_at IS NULL", [context.shipment.id])
    : { rows: [] }
  if (events.some((e) => e.stage !== 'PLANNED')) problems.push('a movement stage event exists that this ingestion did not record')
  const inv = await invariants(db, facts, context)
  return {
    verdict: problems.length ? 'DIFFERS' : 'MATCHES',
    problems,
    counts: Object.fromEntries(INGESTED_TABLES.map((t) => [t, plan[t].length])),
    ingestion_run: facts.ingestion_run,
    order_id: context.order.id,
    fingerprints: inv.fingerprints,
    invariant_counts: inv.counts,
  }
}

/** Recovery: supersede exactly the rows this run wrote. Never deletes. */
export async function supersede(db, facts, { confirm } = {}) {
  if (confirm !== facts.ingestion_run) throw new HarnessStop('NOT_CONFIRMED', `supersession needs --confirm=${facts.ingestion_run}`)
  const evidence = { programme: PROGRAMME, ingestion_run: facts.ingestion_run, superseded: {} }
  await db.exec('BEGIN')
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY])
    await prerequisites(db, facts)
    const context = await gatherContext(db, facts)
    evidence.before = await invariants(db, facts, context)
    // media references first, then the dispatch (which refers to a party), then the parties
    for (const table of [MEDIA, SPECS, LEDGER, DISPATCHES, PARTIES]) {
      const { rows } = await db.query(`UPDATE public.${table} SET deleted_at = clock_timestamp(), updated_at = clock_timestamp() WHERE ingestion_run = $1 AND deleted_at IS NULL RETURNING id`, [facts.ingestion_run])
      evidence.superseded[table] = rows.length
    }
    const total = Object.values(evidence.superseded).reduce((a, b) => a + b, 0)
    if (total) {
      const newState = { ingestion_run: facts.ingestion_run, superseded: evidence.superseded }
      const metadata = { programme: PROGRAMME, note: 'CAP_R2_INGESTION_SUPERSEDED — recovery; nothing was deleted', facts_sha256: facts._sha256 }
      const timestamp = new Date().toISOString()
      const row = {
        import_order_id: context.order.id, actor_id: null, action: 'CAP_R2_INGESTION_SUPERSEDED', resource_type: 'ingestion_run', resource_id: facts.ingestion_run,
        previous_state: null, new_state: newState, metadata,
        cryptographic_seal: auditSeal({ actorId: null, action: 'CAP_R2_INGESTION_SUPERSEDED', resourceType: 'ingestion_run', resourceId: facts.ingestion_run, timestamp, payload: { previousState: null, newState, metadata } }),
      }
      const { sql, params } = insertSql(AUDIT, row)
      await db.query(sql, params)
    }
    evidence.after = await invariants(db, facts, context)
    for (const [k, v] of Object.entries(evidence.before.fingerprints)) if (v !== evidence.after.fingerprints[k]) throw new HarnessStop('SOMETHING_ELSE_CHANGED', `supersession changed fingerprint ${k}`)
    for (const [k, v] of Object.entries(evidence.before.counts)) if (v !== evidence.after.counts[k]) throw new HarnessStop('SOMETHING_ELSE_CHANGED', `supersession changed count ${k}`)
    await db.exec('COMMIT')
    evidence.committed = true
    return evidence
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => {})
    throw error
  }
}

async function main() {
  const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=')
  const MODE = arg('mode') || 'preflight'
  if (!['preflight', 'apply', 'verify', 'supersede'].includes(MODE)) { console.error(`BLOCKED: unsupported --mode=${MODE}`); process.exit(2) }
  const { default: pg } = await import('pg')
  const resultsDir = path.resolve(process.env.T11_CAP_RESULTS_DIR || 'test-results/t11-cap-r2')
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
    else if (MODE === 'supersede') out = await supersede(db, facts, { confirm: arg('confirm') })
    else {
      out = await ingest(db, facts, { commit: MODE === 'apply' })
      if (MODE === 'apply') out.verify = await verify(db, facts)
    }
    fs.writeFileSync(path.join(resultsDir, `${MODE}.json`), JSON.stringify(out, null, 2))
    console.log(JSON.stringify(out))
    if ((out.verdict && out.verdict !== 'MATCHES') || (out.verify && out.verify.verdict !== 'MATCHES')) throw new HarnessStop('DIFFERS', 'the staging records do not match the verified facts')
  } catch (error) {
    if (error instanceof HarnessStop) {
      const blocked = ['BLOCKED_PREREQUISITES', 'NO_DATABASE_URL', 'NOT_APPROVED_STAGING', 'NOT_CONFIRMED'].includes(error.code)
      console.error(`${blocked ? 'BLOCKED' : 'FAIL'}: ${error.code}: ${error.message}`)
      process.exit(blocked ? 2 : 1)
    }
    console.error(`ERROR: ${error.stack || error.message}`)
    process.exit(1)
  } finally { if (client) await client.end().catch(() => {}) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
