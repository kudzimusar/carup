/**
 * T11-CAP-LR01-R2 — the historical ingestion: it records what the source REPORTED, with its provenance, and NOTHING else.
 *
 * Rehearsed on PGlite with staging-shaped base tables, the REAL CAP-04/05 migrations, the REAL R2 migration, and the
 * REAL R1 seed to create the Vezel's vehicle, order, shipment and leg exactly as they exist on staging. The facts file is
 * the real one (generated from the private capture): the point is to hold the real plan to the rules.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { MIGRATIONS, loadMigration, makeDb, HarnessStop } from '../scripts/t11-cap-stg-converge.mjs'
import { loadFacts as loadR1Facts, seed as seedR1 } from '../scripts/t11-cap-r1-vezel-seed.mjs'
import { parseMigrationSource } from '../db/migrationParser.js'
import {
  INGESTED_TABLES, MUST_STAY_EMPTY, WRITABLE, assertPlanTruthful, buildPlan, gatherContext, ingest, loadFacts, supersede, verify,
} from '../scripts/t11-cap-r2-ingest.mjs'

process.env.NODE_ENV = 'test'
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const R2_MIGRATION = path.resolve(HERE, '../../database/migrations/20260926090000_trade_os_cap_r2_customer_journey_authorities.sql')
const SCRIPT_SOURCE = fs.readFileSync(path.resolve(HERE, '../scripts/t11-cap-r2-ingest.mjs'), 'utf8')
const FACTS_TEXT = fs.readFileSync(path.resolve(HERE, '../scripts/data/t11-cap-r2-historical-facts.json'), 'utf8')

const FACTS = loadFacts()
const R1_FACTS = loadR1Facts()
const USER = FACTS.account.user_id
const SERENA = FACTS.protected_vehicle.vin
const VIN = FACTS.target.vin
const [LEDGER, PARTIES, DISPATCHES, SPECS, MEDIA] = ['diaspora_external_progress_entries', 'diaspora_order_parties', 'diaspora_document_dispatches', 'vehicle_specification_observations', 'vehicle_media_references']
const EXPECTED = { [PARTIES]: 5, [DISPATCHES]: 1, [LEDGER]: 14, [SPECS]: 13, [MEDIA]: 50 }

const WORLDS = []
test.after(async () => { for (const p of WORLDS) await p.close().catch(() => {}) })

async function world({ twoShipments = false, photos = 50, tie = false, nonImage = false, rejected = false, secondOrder = false, otherOwner = false, r2 = true, externalRef = null } = {}) {
  const pg = new PGlite()
  WORLDS.push(pg)
  await pg.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.tenants (id uuid PRIMARY KEY);
    CREATE TABLE public.users (id text PRIMARY KEY);
    CREATE TABLE public.vehicles (
      vin text PRIMARY KEY, make text NOT NULL, model text NOT NULL, generation text, trim text, year integer NOT NULL, color text,
      mileage integer NOT NULL, fuel_type text, drivetrain text, transmission text, import_source text, duty_paid boolean DEFAULT false,
      police_verified boolean DEFAULT false, status text DEFAULT 'Available', trust_score real, price real NOT NULL, currency text,
      created_at timestamptz DEFAULT now(), tenant_id uuid, owner_id text REFERENCES public.users(id) ON DELETE SET NULL,
      plate_number text, chassis_number text, engine_number text, registration_status text, registration_country text,
      current_seller_id text, current_seller_type text, vehicle_condition_category text NOT NULL DEFAULT 'unknown',
      passport_verified boolean NOT NULL DEFAULT false, zimra_verified boolean NOT NULL DEFAULT false,
      safe_pay_ready boolean NOT NULL DEFAULT false, inspection_ready boolean NOT NULL DEFAULT false,
      publication_status text NOT NULL DEFAULT 'draft', listing_city text, seller_description text,
      CONSTRAINT vehicles_publication_status_check CHECK (publication_status = ANY (ARRAY['draft','identity_complete','documents_submitted','review_pending','publishable','published'])),
      CONSTRAINT vehicles_vehicle_condition_category_check CHECK (vehicle_condition_category = ANY (ARRAY['brand_new','recently_imported','locally_used','second_hand','certified_dealer','unknown']))
    );
    CREATE TABLE public.vehicle_evidence (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vin text NOT NULL REFERENCES public.vehicles(vin) ON DELETE CASCADE,
      evidence_type text NOT NULL, evidence_subtype text, mime_type text NOT NULL, verification_status text NOT NULL DEFAULT 'pending',
      visibility_level text NOT NULL DEFAULT 'private', uploaded_at timestamptz NOT NULL DEFAULT now(), captured_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.listing_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vin text NOT NULL, image_url text NOT NULL, is_primary boolean NOT NULL DEFAULT false);
    CREATE TABLE public.diaspora_import_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, buyer_id text REFERENCES public.users(id) ON DELETE SET NULL,
      linked_vehicle_vin text REFERENCES public.vehicles(vin) ON DELETE SET NULL, order_type text NOT NULL,
      origin_country text NOT NULL, origin_city text, destination_country text NOT NULL DEFAULT 'Zimbabwe', destination_city text,
      requested_make text, requested_model text, requested_year_min integer, budget_amount numeric,
      budget_currency text NOT NULL DEFAULT 'USD', chassis_number text, vin text, status text NOT NULL DEFAULT 'IMPORT_REQUESTED',
      verification_status text NOT NULL DEFAULT 'PENDING_REVIEW', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text REFERENCES public.users(id) ON DELETE SET NULL, updated_by text REFERENCES public.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
      budget_disclosed boolean NOT NULL DEFAULT false, consignee_kind text, consignee_name text, consignee_phone text,
      delivery_address text, clearing_agent_name text,
      CONSTRAINT diaspora_import_orders_order_type_check CHECK (order_type = ANY (ARRAY['vehicle','parts','mixed'])),
      CONSTRAINT diaspora_import_orders_consignee_kind_check CHECK (consignee_kind = ANY (ARRAY['self','my_company','another_person','another_company','undecided'])),
      CONSTRAINT diaspora_import_orders_status_check CHECK (status = ANY (ARRAY['IMPORT_REQUESTED','QUOTE_ISSUED','SELLER_ASSIGNED','DOCUMENTS_PENDING','DOCUMENTS_VERIFIED','CONTAINER_BOOKED','READY_FOR_LOADING','LOADED','SHIPPED','ARRIVED_AT_BORDER','CUSTOMS_IN_PROGRESS','DUTY_PENDING','DUTY_PAID','RELEASED','REGISTRATION_PENDING','ROADWORTHINESS_PENDING','INSURANCE_PENDING','ZIMBABWE_READY','LOCAL_LISTING_ENABLED','COMPLETED','CANCELLED','DISPUTED','FLAGGED_FOR_REVIEW']))
    );
    CREATE TABLE public.diaspora_container_shipments (id uuid PRIMARY KEY);
    CREATE TABLE public.diaspora_shipments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
      import_order_id uuid NOT NULL REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,
      container_id uuid REFERENCES public.diaspora_container_shipments(id) ON DELETE SET NULL, carrier_name text, tracking_number text,
      origin_port text, destination_port text, departure_date timestamptz, estimated_arrival_date timestamptz, actual_arrival_date timestamptz,
      status text NOT NULL DEFAULT 'PLANNED', verification_status text NOT NULL DEFAULT 'PENDING_REVIEW', metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text REFERENCES public.users(id) ON DELETE SET NULL, updated_by text REFERENCES public.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
      CONSTRAINT diaspora_shipments_status_check CHECK (status = ANY (ARRAY['PLANNED','BOOKED','LOADING','IN_TRANSIT','ARRIVED','CUSTOMS_HOLD','RELEASED','COMPLETED','EXCEPTION']))
    );
    CREATE TABLE public.diaspora_shipment_stage_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, shipment_id uuid NOT NULL REFERENCES public.diaspora_shipments(id) ON DELETE CASCADE,
      import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE, stage text NOT NULL, notes text, location text,
      event_time timestamptz NOT NULL DEFAULT now(), verification_status text NOT NULL DEFAULT 'PENDING_REVIEW',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_by text, updated_by text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    );
    CREATE TABLE public.diaspora_import_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, import_order_id uuid REFERENCES public.diaspora_import_orders(id) ON DELETE CASCADE,
      actor_id text REFERENCES public.users(id) ON DELETE SET NULL, action text NOT NULL, resource_type text NOT NULL, resource_id text,
      previous_state jsonb, new_state jsonb, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, cryptographic_seal text NOT NULL, ip_address text,
      user_agent text, verification_status text NOT NULL DEFAULT 'VERIFIED', created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    );
    CREATE TABLE public.diaspora_trade_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid REFERENCES public.diaspora_import_orders(id), document_type text NOT NULL, deleted_at timestamptz);
    CREATE TABLE public.diaspora_payment_milestones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid NOT NULL REFERENCES public.diaspora_import_orders(id));
    CREATE TABLE public.diaspora_customs_cases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_order_id uuid REFERENCES public.diaspora_import_orders(id));
    CREATE TABLE public.domain_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text);
    CREATE TABLE public.notification_queue (id bigserial PRIMARY KEY, recipient_id text);
  `)
  for (const m of MIGRATIONS.slice(0, 2)) await pg.exec(loadMigration(m).up)
  if (r2) await pg.exec(parseMigrationSource(fs.readFileSync(R2_MIGRATION, 'utf8'), path.basename(R2_MIGRATION)).up)
  await pg.exec(`INSERT INTO public.users (id) VALUES ('${USER}'), ('u-other')`)
  await pg.exec(`INSERT INTO public.vehicles (vin, make, model, year, mileage, price, owner_id, chassis_number, status, publication_status)
    VALUES ('${SERENA}', 'Nissan', 'Serena Highway Star', 2016, 63000, 12800, '${USER}', '${SERENA}', 'Available', 'published')`)
  const db = makeDb(pg)
  // The Vezel exactly as R1 left it on staging: vehicle, order, shipment, its creation event and one declared leg.
  await seedR1(db, R1_FACTS, { commit: true })
  if (otherOwner) await pg.exec(`UPDATE public.vehicles SET owner_id = 'u-other' WHERE vin = '${VIN}'`)
  if (twoShipments) await pg.exec(`INSERT INTO public.diaspora_shipments (import_order_id) SELECT id FROM public.diaspora_import_orders WHERE linked_vehicle_vin = '${VIN}'`)
  if (externalRef) await pg.exec(`UPDATE public.diaspora_import_orders SET metadata = jsonb_set(metadata, '{external_reference,reference}', '"${externalRef}"') WHERE linked_vehicle_vin = '${VIN}'`)
  if (secondOrder) await pg.exec(`INSERT INTO public.diaspora_import_orders (buyer_id, created_by, order_type, origin_country, linked_vehicle_vin) VALUES ('${USER}', '${USER}', 'vehicle', 'Japan', '${VIN}')`)
  // The R1 evidence: 50 photographs uploaded one after another, plus the three documents.
  const base = Date.parse('2026-10-25T05:18:08Z')
  for (let i = 0; i < photos; i += 1) {
    const at = new Date(tie && i === 5 ? base + 4 * 12000 : base + i * 12000).toISOString()
    const mime = nonImage && i === 7 ? 'application/pdf' : 'image/jpeg'
    const status = rejected && i === 9 ? 'rejected' : 'pending'
    await pg.exec(`INSERT INTO public.vehicle_evidence (vin, evidence_type, evidence_subtype, mime_type, verification_status, uploaded_at) VALUES ('${VIN}', 'import_photo', 'export_yard_photo', '${mime}', '${status}', '${at}')`)
  }
  for (const subtype of ['bill_of_lading', 'commercial_invoice', 'export_certificate']) {
    await pg.exec(`INSERT INTO public.vehicle_evidence (vin, evidence_type, evidence_subtype, mime_type) VALUES ('${VIN}', 'vehicle_life_document', '${subtype}', 'application/pdf')`)
    await pg.exec(`INSERT INTO public.diaspora_trade_documents (import_order_id, document_type) SELECT id, '${subtype}' FROM public.diaspora_import_orders WHERE linked_vehicle_vin = '${VIN}' LIMIT 1`)
  }
  return { pg, db }
}

const count = async (db, table, where = 'true') => (await db.query(`SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`)).rows[0].n
const counts = async (db) => Object.fromEntries(await Promise.all(INGESTED_TABLES.map(async (t) => [t, await count(db, t)])))
const ZERO = Object.fromEntries(INGESTED_TABLES.map((t) => [t, 0]))
const synthetic = () => ({
  order: { id: '00000000-0000-4000-8000-0000000000a1' },
  photos: Array.from({ length: 50 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`, uploaded_at: new Date(Date.parse('2026-10-25T05:18:08Z') + i * 12000) })),
})

// ═══════════════════════════ the facts file ═══════════════════════════

test('R2-F1: the facts are the capture\'s — 14 reported actions in 5 stages (7/1/3/1/2), every one Completed, none carrying a time', () => {
  assert.equal(FACTS.progress.length, 14)
  const byStage = {}
  for (const e of FACTS.progress) byStage[e.stage_code] = (byStage[e.stage_code] || 0) + 1
  assert.deepEqual(byStage, { BOOKING: 7, DEPARTURE: 1, BILL_OF_LADING: 3, DISPATCH: 1, CLEARING_DELIVERY: 2 })
  assert.ok(FACTS.progress.every((e) => e.reported_status === 'COMPLETED'))
  assert.ok(FACTS.progress.every((e) => !('event_time' in e) && !('event_time_basis' in e)))
  assert.deepEqual(FACTS.progress.map((e) => e.entry_sequence), Array.from({ length: 14 }, (_, i) => i + 1))
  // wording is preserved verbatim, including the source's own typo — a transcript, not a rewrite
  assert.ok(FACTS.progress.some((e) => e.action_text === 'Comfirmed the loading of your vehicle to the vessel.'))
  assert.ok(FACTS.progress.some((e) => e.action_taker_reported === 'You! (Customer) Your Action' && e.action_taker_kind === 'CUSTOMER'))
})

test('R2-F2: the facts hold no personal contact data and no token — the consignee is a name and a coarse location', () => {
  for (const leak of [/[?&]t=[0-9a-f]{12,}/i, /cap\?t=/i, /@(gmail|yahoo|hotmail|outlook|icloud)\./i, /\+263/, /\b0?7[1-9]\d{7}\b/, /bearer\s/i, /eyJ[A-Za-z0-9_-]{20,}/, /password/i]) {
    assert.doesNotMatch(FACTS_TEXT, leak, `the facts file matches ${leak}`)
  }
  const consignee = FACTS.parties.find((p) => p.party_role === 'CONSIGNEE')
  assert.equal(consignee.party_kind, 'INDIVIDUAL')
  for (const field of ['address_line', 'phone', 'email']) assert.equal(consignee[field], undefined, `the consignee's ${field} must not be in source control`)
  assert.deepEqual(consignee.withheld_from_source_control, ['address_line', 'phone', 'email'])
  // the only e-mail anywhere is a role mailbox of a business
  assert.deepEqual([...FACTS_TEXT.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g)].map((m) => m[0]), ['documentcenter_001@beforward.jp'])
})

test('R2-F3: the dispatch keeps the source\'s status phrase verbatim and states no tracking number, courier or time', () => {
  assert.equal(FACTS.dispatch.status_reported_text, 'Arrived at delivery address')
  for (const field of ['tracking_number', 'courier_name', 'dispatched_at', 'delivered_at']) assert.equal(FACTS.dispatch[field], undefined)
  assert.deepEqual(FACTS.dispatch.document_types, ['bill_of_lading'])
  assert.doesNotMatch(JSON.stringify(FACTS.dispatch), /nyasha/i, 'a staff member\'s personal name is not stored')
})

test('R2-F4: every external row cites its evidence by a lower-case SHA-256, and the observation time is a real UTC instant', () => {
  assert.match(FACTS.source.evidence.digest_sha256, /^[0-9a-f]{64}$/)
  assert.match(FACTS.source.evidence.capture_file_sha256, /^[0-9a-f]{64}$/)
  assert.match(FACTS.source.observed_at, /^2026-10-24T23:\d\d:\d\dZ$/)
  assert.equal(new Date(FACTS.source.observed_at).toISOString().replace('.000', ''), FACTS.source.observed_at)
  assert.equal(FACTS.source.reference, 'CD740269')
})

// ═══════════════════════════ the plan ═══════════════════════════

test('R2-P1: the plan holds exactly the facts, in order, and the gallery follows upload rank with a stated primary', () => {
  const plan = buildPlan(FACTS, synthetic())
  assert.deepEqual(Object.fromEntries(INGESTED_TABLES.map((t) => [t, plan[t].length])), EXPECTED)
  assert.deepEqual(plan[MEDIA].map((m) => m.gallery_position), Array.from({ length: 50 }, (_, i) => i + 1))
  const primary = plan[MEDIA].filter((m) => m.is_primary)
  assert.equal(primary.length, 1)
  assert.equal(primary[0].gallery_position, 1)
  assert.equal(primary[0].primary_basis, 'SOURCE_FIRST_IMAGE')
  assert.ok(plan[MEDIA].every((m) => m.ordinal_basis === 'SOURCE_GALLERY_ORDER'))
  assert.ok(plan[LEDGER].every((r) => r.vehicle_vin === VIN && r.evidence_digest === FACTS.source.evidence.digest_sha256 && r.source_reference === 'CD740269'))
  assert.equal(plan[SPECS].filter((s) => s.spec_key === 'EQUIPMENT_ITEM').length, 5)
  // provenance: externally REPORTED, observed when the capture was taken, with the source's own wording kept beside every normalised value
  for (const t of [PARTIES, DISPATCHES, SPECS]) assert.ok(plan[t].every((r) => r.origin === 'EXTERNAL_REPORT'), `${t} must be marked as an external report`)
  for (const t of [PARTIES, LEDGER, SPECS]) assert.ok(plan[t].every((r) => r.observed_at === FACTS.source.observed_at), `${t} must carry the capture time`)
  assert.equal(plan[DISPATCHES][0].status_observed_at, FACTS.source.observed_at)
  assert.deepEqual(plan[SPECS].filter((r) => r.spec_key !== 'EQUIPMENT_ITEM').map((r) => [r.spec_key, r.source_value_raw]), [
    ['MODEL_CODE', 'DAA-RU3'], ['REGISTRATION_YEAR_MONTH', '2018/12'], ['MANUFACTURE_YEAR_MONTH', '2018/6'], ['ENGINE_DISPLACEMENT_CC', '1490'],
    ['STEERING_SIDE', 'Right'], ['SEAT_COUNT', '5'], ['DOOR_COUNT', '5'], ['FUEL_DETAIL', 'Hybrid(Petrol)'],
  ])
})

test('R2-P2: no table outside the five (and the audit log) can be written, and no movement, customs, payment or document table is among them', () => {
  assert.deepEqual(Object.keys(WRITABLE).sort(), [...INGESTED_TABLES, 'diaspora_import_audit_log'].sort())
  for (const forbidden of ['diaspora_shipments', 'diaspora_shipment_stage_events', 'diaspora_shipment_legs', 'diaspora_shipment_observations', 'diaspora_customs_cases', 'diaspora_customs_events',
    'diaspora_payment_milestones', 'diaspora_trade_documents', 'vehicles', 'vehicle_evidence', 'listing_images', 'diaspora_import_orders', 'domain_events', 'notification_queue', 'message_threads']) {
    assert.ok(!(forbidden in WRITABLE), `${forbidden} must not be writable by the ingestion`)
    // and the script text never names one as an INSERT/UPDATE/DELETE target
    assert.doesNotMatch(SCRIPT_SOURCE, new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+public\\.${forbidden}\\b`), `${forbidden} is a write target in the script`)
  }
  assert.ok(MUST_STAY_EMPTY[LEDGER].includes('event_time') && MUST_STAY_EMPTY[LEDGER].includes('event_time_basis'))
})

const TAMPERS = [
  ['a completion time appears on a reported action', (p) => { p[LEDGER][2].event_time = '2026-08-30T00:00:00Z' }, /no completion time is supplied/],
  ['a time basis appears without a time', (p) => { p[LEDGER][2].event_time_basis = 'SOURCE_SUPPLIED' }, /no completion time is supplied/],
  ['a completion time appears (and the empty-column rule names it too)', (p) => { p[LEDGER][2].event_time = '2026-08-30T00:00:00Z' }, /event_time must stay empty/],
  ['an action is downgraded to In progress', (p) => { p[LEDGER][4].reported_status = 'IN_PROGRESS' }, /Completed/],
  ['a reported action is dropped (the count rule)', (p) => { p[LEDGER].pop() }, /the capture proved 14 reported actions/],
  ['a reported action is dropped (the stage-shape rule)', (p) => { p[LEDGER].pop() }, /stage counts differ/],
  ['a stage is moved so the 7/1/3/1/2 shape breaks', (p) => { p[LEDGER][0].stage_code = 'DISPATCH' }, /7\/1\/3\/1\/2/],
  ['entry sequences are reordered', (p) => { [p[LEDGER][0], p[LEDGER][1]] = [p[LEDGER][1], p[LEDGER][0]] }, /1\.\.14 in order/],
  ['the consignee\'s phone is ingested', (p) => { p[PARTIES].find((x) => x.party_role === 'CONSIGNEE').phone = '+000 000 0000' }, /personal data/],
  ['the consignee\'s street address is ingested', (p) => { p[PARTIES].find((x) => x.party_role === 'CONSIGNEE').address_line = 'A street' }, /personal data/],
  ['the consignee\'s email is ingested', (p) => { p[PARTIES].find((x) => x.party_role === 'CONSIGNEE').email = 'someone@example.test' }, /personal data/],
  ['a party is dropped', (p) => { p[PARTIES].pop() }, /five declared parties|consignee/],
  ['a party role is repeated', (p) => { p[PARTIES][2].party_role = 'NOTIFY_PARTY' }, /twice/],
  ['a tracking number is invented', (p) => { p[DISPATCHES][0].tracking_number = 'EJ123456789JP' }, /the dispatch states no tracking number/],
  ['a delivery time is invented', (p) => { p[DISPATCHES][0].delivered_at = '2026-09-20T00:00:00Z' }, /the dispatch states no tracking number/],
  ['a courier is invented', (p) => { p[DISPATCHES][0].courier_name = 'DHL' }, /the dispatch states no tracking number/],
  ['a tracking number is invented (and the empty-column rule names it too)', (p) => { p[DISPATCHES][0].tracking_number = 'EJ123456789JP' }, /tracking_number must stay empty/],
  ['a second dispatch appears', (p) => { p[DISPATCHES].push({ ...p[DISPATCHES][0] }) }, /exactly one dispatch/],
  ['a media reference is dropped', (p) => { p[MEDIA].pop() }, /50 media|1\.\.N/],
  ['two media references are primary', (p) => { p[MEDIA][1].is_primary = true; p[MEDIA][1].primary_basis = 'SOURCE_FIRST_IMAGE' }, /exactly one media reference is primary/],
  ['gallery positions are not contiguous', (p) => { p[MEDIA][3].gallery_position = 99 }, /1\.\.N in order/],
  ['an attribution column is written (created_by)', (p) => { p[LEDGER][0].created_by = 'someone' }, /created_by must stay empty/],
  ['a verification is invented (VERIFIED is not a column this script may set)', (p) => { p[LEDGER][0].verification_status = 'VERIFIED' }, /verification_status is not a column this script may set/],
  ['a party is marked verified', (p) => { p[PARTIES][1].verification_status = 'VERIFIED' }, /verification_status is not a column this script may set/],
  ['a value is left undefined', (p) => { p[SPECS][0].value_text = undefined }, /value_text is undefined/],
  ['a media label is invented', (p) => { p[MEDIA][0].label = 'Front' }, /must stay empty/],
  ['a capability token slips into a text', (p) => { p[LEDGER][0].action_text = 'see https://example.test/customer/cap?t=0123456789abcdef0123' }, /token/],
  ['a single-valued specification is stated twice', (p) => { p[SPECS].push({ ...p[SPECS][0], source_position: 'again' }) }, /appears twice/],
]
for (const [what, tamper, expected] of TAMPERS) {
  test(`R2-P3: the plan is refused when ${what}`, () => {
    const plan = buildPlan(FACTS, synthetic())
    tamper(plan)
    assert.throws(() => assertPlanTruthful(plan, FACTS), (e) => e instanceof HarnessStop && e.code === 'PLAN_NOT_TRUTHFUL' && expected.test(e.message))
  })
}

// ═══════════════════════════ the write ═══════════════════════════

test('R2-W1: a preflight rehearses the whole write and leaves NOTHING behind', async () => {
  const { db } = await world()
  const out = await ingest(db, FACTS, { commit: false })
  assert.equal(out.committed, false)
  assert.deepEqual(out.plan_counts, EXPECTED)
  assert.equal(out.unchanged, true)
  assert.deepEqual(await counts(db), ZERO)
  assert.equal(await count(db, 'diaspora_import_audit_log', "action LIKE 'CAP_R2%'"), 0)
})

test('R2-W2: apply writes exactly the planned rows, attributes each batch, and verifies', async () => {
  const { db } = await world()
  const out = await ingest(db, FACTS, { commit: true })
  assert.equal(out.committed, true)
  assert.deepEqual(await counts(db), EXPECTED)
  const audit = (await db.query("SELECT action, resource_type, new_state, cryptographic_seal, actor_id FROM public.diaspora_import_audit_log WHERE action LIKE 'CAP_R2%' ORDER BY action")).rows
  assert.equal(audit.length, 5)
  assert.ok(audit.every((a) => /^[0-9a-f]{64}$/.test(a.cryptographic_seal) && a.actor_id === null), 'each batch is sealed and honestly unattributed to a person')
  assert.deepEqual(Object.fromEntries(audit.map((a) => [a.resource_type, a.new_state.inserted])), EXPECTED)
  const v = await verify(db, FACTS)
  assert.equal(v.verdict, 'MATCHES', v.problems.join('; '))
})

test('R2-W3: a second run is a no-op (idempotent) — no rows, no audit entries, no divergence', async () => {
  const { db } = await world()
  await ingest(db, FACTS, { commit: true })
  const again = await ingest(db, FACTS, { commit: true })
  assert.deepEqual(again.created, {})
  assert.deepEqual(await counts(db), EXPECTED)
  assert.equal(await count(db, 'diaspora_import_audit_log', "action LIKE 'CAP_R2%'"), 5)
})

test('R2-W4: the records say what the source said and nothing more — Completed, no time, no tracking number, no personal contact', async () => {
  const { db } = await world()
  await ingest(db, FACTS, { commit: true })
  const ledger = (await db.query(`SELECT stage_code, reported_status, event_time, event_time_basis, verification_status, evidence_digest FROM public.${LEDGER} ORDER BY entry_sequence`)).rows
  assert.equal(ledger.length, 14)
  assert.ok(ledger.every((r) => r.reported_status === 'COMPLETED' && r.event_time === null && r.event_time_basis === null))
  assert.ok(ledger.every((r) => r.verification_status === 'REPORTED'), 'reported, not yet reviewed by CarUp')
  assert.ok(ledger.every((r) => r.evidence_digest === FACTS.source.evidence.digest_sha256))
  const consignee = (await db.query(`SELECT display_name, address_line, phone, email, city, country, party_kind FROM public.${PARTIES} WHERE party_role = 'CONSIGNEE'`)).rows[0]
  assert.equal(consignee.display_name, 'Kingstone Musaurwa')
  assert.deepEqual([consignee.address_line, consignee.phone, consignee.email], [null, null, null])
  assert.equal(consignee.party_kind, 'INDIVIDUAL')
  const dispatch = (await db.query(`SELECT d.status_reported_text, d.dispatch_status, d.tracking_number, d.courier_name, d.dispatched_at, d.delivered_at, p.party_role
    FROM public.${DISPATCHES} d JOIN public.${PARTIES} p ON p.id = d.recipient_party_id`)).rows[0]
  assert.equal(dispatch.status_reported_text, 'Arrived at delivery address')
  assert.equal(dispatch.party_role, 'DOCUMENT_DELIVERY')
  assert.deepEqual([dispatch.tracking_number, dispatch.courier_name, dispatch.dispatched_at, dispatch.delivered_at], [null, null, null, null])
  const media = (await db.query(`SELECT gallery_position, is_primary, primary_basis FROM public.${MEDIA} ORDER BY gallery_position`)).rows
  assert.deepEqual(media.map((m) => m.gallery_position), Array.from({ length: 50 }, (_, i) => i + 1))
  assert.deepEqual(media.filter((m) => m.is_primary).map((m) => [m.gallery_position, m.primary_basis]), [[1, 'SOURCE_FIRST_IMAGE']])
  // the photographs come out in UPLOAD order — the first row uploaded is position 1
  const ranked = (await db.query(`SELECT e.uploaded_at FROM public.${MEDIA} m JOIN public.vehicle_evidence e ON e.id = m.evidence_id ORDER BY m.gallery_position`)).rows.map((r) => new Date(r.uploaded_at).getTime())
  assert.deepEqual(ranked, [...ranked].sort((a, b) => a - b))
  const specs = (await db.query(`SELECT spec_key, value_text, value_number, unit FROM public.${SPECS} WHERE spec_key <> 'EQUIPMENT_ITEM' ORDER BY spec_key`)).rows
  assert.deepEqual(specs.find((s) => s.spec_key === 'ENGINE_DISPLACEMENT_CC'), { spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: null, value_number: '1490', unit: 'cc' })
  assert.equal(specs.find((s) => s.spec_key === 'MANUFACTURE_YEAR_MONTH').value_text, '2018-06')
})

test('R2-W5: NOTHING ELSE MOVED — movement, documents, customs, payments, events, notifications, listing media, the order, the Vezel vehicle and the Serena', async () => {
  const { db } = await world()
  const before = await ingest(db, FACTS, { commit: false })
  const out = await ingest(db, FACTS, { commit: true })
  assert.equal(out.unchanged, true)
  assert.deepEqual(out.before.fingerprints, out.after.fingerprints)
  assert.deepEqual(out.before.counts, out.after.counts)
  assert.equal(out.after.counts.stage_events, 1)
  assert.equal(out.after.counts.observations, 0)
  assert.equal(out.after.counts.legs, 1)
  assert.equal(out.after.counts.domain_events, 0)
  assert.equal(out.after.counts.notifications, 0)
  assert.equal(out.after.counts.listing_images_target, 0)
  assert.equal(out.after.counts.evidence_target, 53)
  assert.equal(out.after.counts.trade_documents, 3)
  assert.equal(out.after.counts.payment_milestones, 0)
  assert.equal(out.after.counts.customs_cases, 0)
  assert.equal((await db.query(`SELECT status FROM public.diaspora_import_orders WHERE linked_vehicle_vin = '${VIN}'`)).rows[0].status, 'IMPORT_REQUESTED')
  assert.equal((await db.query(`SELECT status FROM public.diaspora_shipments`)).rows[0].status, 'PLANNED')
  assert.deepEqual(before.before.fingerprints, out.after.fingerprints)
})

test('R2-W6: an existing row that DISAGREES stops the run and writes nothing — it is reported, never "fixed"', async () => {
  const { db } = await world()
  const ctx = await gatherContext(db, FACTS)
  await db.exec(`INSERT INTO public.${LEDGER} (import_order_id, stage_code, entry_sequence, action_sequence, action_taker_reported, action_taker_kind, action_text, reported_status,
    source_system, source_reference, evidence_ref, evidence_digest, observed_at, vehicle_vin)
    VALUES ('${ctx.order.id}', 'BOOKING', 3, 3, 'BE FORWARD', 'PROVIDER', 'A DIFFERENT SENTENCE', 'COMPLETED', '${FACTS.source.system}', '${FACTS.source.reference}', '${FACTS.source.evidence.ref}', '${FACTS.source.evidence.digest_sha256}', '${FACTS.source.observed_at}', '${VIN}')`)
  await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'EXISTING_ROW_DISAGREES' && /action_text/.test(e.message))
  const c = await counts(db)
  assert.deepEqual(c, { ...ZERO, [LEDGER]: 1 }, 'only the pre-existing row; the failed run wrote nothing')
})

test('R2-W7: a live row the plan does not contain (a fifteenth action) stops the run, and `verify` reports it', async () => {
  const { db } = await world()
  await ingest(db, FACTS, { commit: true })
  const ctx = await gatherContext(db, FACTS)
  await db.exec(`INSERT INTO public.${LEDGER} (import_order_id, stage_code, entry_sequence, action_sequence, action_taker_reported, action_taker_kind, action_text, reported_status,
    source_system, source_reference, evidence_ref, evidence_digest, observed_at)
    VALUES ('${ctx.order.id}', 'CLEARING_DELIVERY', 15, 3, 'X', 'UNKNOWN', 'An action nobody reported', 'COMPLETED', '${FACTS.source.system}', '${FACTS.source.reference}', '${FACTS.source.evidence.ref}', '${FACTS.source.evidence.digest_sha256}', '${FACTS.source.observed_at}')`)
  const v = await verify(db, FACTS)
  assert.equal(v.verdict, 'DIFFERS')
  assert.ok(v.problems.some((p) => /does not contain/.test(p)))
  await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'EXISTING_ROW_DISAGREES')
})

test('R2-W8: a divergent party stops the run (the consignee\'s name is not silently overwritten)', async () => {
  const { db } = await world()
  const ctx = await gatherContext(db, FACTS)
  await db.exec(`INSERT INTO public.${PARTIES} (import_order_id, party_role, party_kind, display_name, origin, source_system, source_reference, evidence_ref, evidence_digest, observed_at)
    VALUES ('${ctx.order.id}', 'CONSIGNEE', 'INDIVIDUAL', 'Somebody Else', 'EXTERNAL_REPORT', '${FACTS.source.system}', '${FACTS.source.reference}', '${FACTS.source.evidence.ref}', '${FACTS.source.evidence.digest_sha256}', '${FACTS.source.observed_at}')`)
  await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'EXISTING_ROW_DISAGREES' && /display_name/.test(e.message))
})

for (const [what, opts, code, pattern] of [
  ['two photographs share an upload instant (the order would be a guess)', { tie: true }, 'EXISTING_ROW_DISAGREES', /share an upload instant/],
  ['only 49 photographs exist', { photos: 49 }, 'EXISTING_ROW_DISAGREES', /expected 50/],
  ['there are 51 photographs', { photos: 51 }, 'EXISTING_ROW_DISAGREES', /expected 50/],
  ['one of the photographs is not an image', { nonImage: true }, 'EXISTING_ROW_DISAGREES', /not an image/],
  ['one of the photographs was rejected', { rejected: true }, 'EXISTING_ROW_DISAGREES', /rejected/],
  ['the vehicle has two live orders', { secondOrder: true }, 'AMBIGUOUS_EXISTING', /exactly one live import order/],
  ['the vehicle belongs to somebody else', { otherOwner: true }, 'BLOCKED_PREREQUISITES', /not owned/],
]) {
  test(`R2-W9: the run stops and writes nothing when ${what}`, async () => {
    const { db } = await world(opts)
    await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e instanceof HarnessStop && e.code === code && pattern.test(e.message))
    assert.deepEqual(await counts(db), ZERO)
  })
}

test('R2-W14: with the migration not applied, the run is BLOCKED naming what is missing, and writes nothing', async () => {
  const { db } = await world({ r2: false })
  await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'BLOCKED_PREREQUISITES' && INGESTED_TABLES.every((t) => e.message.includes(t)))
  assert.equal(await count(db, 'diaspora_import_audit_log', "action LIKE 'CAP_R2%'"), 0)
})

test('R2-W15: an order that names a DIFFERENT external reference than the capture stops the run — the facts belong to another purchase', async () => {
  const { db } = await world({ externalRef: 'ZZ999999' })
  await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'EXISTING_ROW_DISAGREES' && /ZZ999999/.test(e.message))
  assert.deepEqual(await counts(db), ZERO)
})

test('R2-W16: a divergent dispatch, specification or media reference each stop a re-run — and only that table is blamed', async () => {
  const src = `'${FACTS.source.system}', '${FACTS.source.reference}', '${FACTS.source.evidence.ref}', '${FACTS.source.evidence.digest_sha256}'`
  for (const [name, setup, pattern] of [
    ['dispatch', async (db, ctx) => {
      await db.exec(`UPDATE public.${DISPATCHES} SET deleted_at = now()`)
      const party = (await db.query(`SELECT id FROM public.${PARTIES} WHERE party_role = 'DOCUMENT_DELIVERY' AND deleted_at IS NULL`)).rows[0].id
      await db.exec(`INSERT INTO public.${DISPATCHES} (import_order_id, recipient_party_id, document_types, dispatch_status, status_reported_text, status_observed_at, origin, source_system, source_reference, evidence_ref, evidence_digest)
        VALUES ('${ctx.order.id}', '${party}', ARRAY['bill_of_lading']::text[], 'IN_TRANSIT', 'On its way', '${FACTS.source.observed_at}', 'EXTERNAL_REPORT', ${src})`)
    }, /^diaspora_document_dispatches: .*dispatch_status/],
    ['specification', async (db) => {
      await db.exec(`UPDATE public.${SPECS} SET deleted_at = now() WHERE spec_key = 'ENGINE_DISPLACEMENT_CC'`)
      await db.exec(`INSERT INTO public.${SPECS} (vin, spec_key, value_number, unit, origin, source_system, source_reference, evidence_ref, evidence_digest, observed_at)
        VALUES ('${VIN}', 'ENGINE_DISPLACEMENT_CC', 1500, 'cc', 'EXTERNAL_REPORT', ${src}, '${FACTS.source.observed_at}')`)
    }, /vehicle_specification_observations .*value_number/],
    ['media reference', async (db) => {
      const first = (await db.query(`SELECT evidence_id FROM public.${MEDIA} WHERE gallery_position = 1 AND deleted_at IS NULL`)).rows[0]
      await db.exec(`UPDATE public.${MEDIA} SET deleted_at = now() WHERE gallery_position = 1`)
      await db.exec(`INSERT INTO public.${MEDIA} (vin, evidence_id, gallery_position, ordinal_basis, source_system, observed_at) VALUES ('${VIN}', '${first.evidence_id}', 1, 'OWNER_ORDER', 'OWNER', now())`)
    }, /vehicle_media_references .*(ordinal_basis|is_primary)/],
  ]) {
    const { db } = await world()
    await ingest(db, FACTS, { commit: true })
    await setup(db, await gatherContext(db, FACTS))
    await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'EXISTING_ROW_DISAGREES' && pattern.test(e.message), `${name}: divergence was not caught, or the wrong table was blamed`)
    // and `verify` — read-only, run by itself — reports the same disagreement
    const v = await verify(db, FACTS)
    assert.equal(v.verdict, 'DIFFERS', `${name}: verify missed the divergence`)
    assert.ok(v.problems.some((p) => /disagrees with the facts/.test(p)), `${name}: verify did not name a disagreement: ${v.problems.join(' | ')}`)
  }
})

test('R2-W17: an existing row that matches the plan but carries a completion time is NOT accepted as already present', async () => {
  const { db } = await world()
  await ingest(db, FACTS, { commit: true })
  const ctx = await gatherContext(db, FACTS)
  // supersede entry 3 and replace it with a row identical in every planned column — except that it states a time
  const old = (await db.query(`SELECT * FROM public.${LEDGER} WHERE entry_sequence = 3 AND deleted_at IS NULL`)).rows[0]
  await db.exec(`UPDATE public.${LEDGER} SET deleted_at = now() WHERE id = '${old.id}'`)
  await db.query(`INSERT INTO public.${LEDGER} (import_order_id, vehicle_vin, stage_code, entry_sequence, action_sequence, action_taker_reported, action_taker_kind, action_text, reported_status,
    source_system, source_reference, source_position, evidence_ref, evidence_digest, observed_at, ingestion_run, metadata, event_time, event_time_basis)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb, $15::timestamptz - interval '1 hour', 'SOURCE_SUPPLIED')`,
  [old.import_order_id, old.vehicle_vin, old.stage_code, old.entry_sequence, old.action_sequence, old.action_taker_reported, old.action_taker_kind, old.action_text, old.reported_status,
    old.source_system, old.source_reference, old.source_position, old.evidence_ref, old.evidence_digest, old.observed_at, old.ingestion_run, JSON.stringify(old.metadata)])
  await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'EXISTING_ROW_DISAGREES' && /event_time is set but must stay empty/.test(e.message))
  const v = await verify(db, FACTS)
  assert.equal(v.verdict, 'DIFFERS')
  assert.ok(v.problems.some((p) => /event_time is set/.test(p)))
})

test('R2-W18: `verify` reports a movement stage event that this ingestion did not record', async () => {
  const { db } = await world()
  await ingest(db, FACTS, { commit: true })
  await db.exec(`INSERT INTO public.diaspora_shipment_stage_events (shipment_id, stage) SELECT id, 'IN_TRANSIT' FROM public.diaspora_shipments LIMIT 1`)
  const v = await verify(db, FACTS)
  assert.equal(v.verdict, 'DIFFERS')
  assert.ok(v.problems.some((p) => /movement stage event/.test(p)))
})

test('R2-W19: two live shipments for the order make the run refuse to choose', async () => {
  const { db } = await world({ twoShipments: true })
  await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'AMBIGUOUS_EXISTING' && /shipment/.test(e.message))
  assert.deepEqual(await counts(db), ZERO)
})

test('R2-W10: TRIPWIRE — if the protected vehicle changes during the run, everything rolls back', async () => {
  const { pg, db } = await world()
  await pg.exec(`
    CREATE FUNCTION public.touch_serena() RETURNS trigger AS $$ BEGIN UPDATE public.vehicles SET mileage = mileage + 1 WHERE vin = '${SERENA}'; RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_touch_serena AFTER INSERT ON public.${LEDGER} FOR EACH ROW EXECUTE FUNCTION public.touch_serena();`)
  await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'SOMETHING_ELSE_CHANGED' && /protected_vehicle/.test(e.message))
  assert.deepEqual(await counts(db), ZERO)
  assert.equal((await db.query(`SELECT mileage FROM public.vehicles WHERE vin = '${SERENA}'`)).rows[0].mileage, 63000)
})

test('R2-W11: TRIPWIRE — if the run emits an event or a notification, or moves the shipment, everything rolls back', async () => {
  for (const [name, body, pattern] of [
    ['event', "INSERT INTO public.domain_events (event_type) VALUES ('diaspora.journey.alert');", /domain_events/],
    ['notification', "INSERT INTO public.notification_queue (recipient_id) VALUES ('x');", /notifications/],
    ['shipment', "UPDATE public.diaspora_shipments SET status = 'BOOKED';", /shipment/],
    ['order', "UPDATE public.diaspora_import_orders SET status = 'DOCUMENTS_VERIFIED' WHERE linked_vehicle_vin = 'RU3-1316558';", /order/],
    ['listing image', "INSERT INTO public.listing_images (vin, image_url) VALUES ('RU3-1316558', '/x.jpg');", /listing_images_target/],
  ]) {
    const { pg, db } = await world()
    await pg.exec(`CREATE FUNCTION public.side_effect() RETURNS trigger AS $$ BEGIN ${body} RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_side_effect AFTER INSERT ON public.${DISPATCHES} FOR EACH ROW EXECUTE FUNCTION public.side_effect();`)
    await assert.rejects(() => ingest(db, FACTS, { commit: true }), (e) => e.code === 'SOMETHING_ELSE_CHANGED' && pattern.test(e.message), `${name} side effect was not caught`)
    assert.deepEqual(await counts(db), ZERO, `${name}: rows survived a rolled-back run`)
  }
})

test('R2-W12: a reviewer moving a row to CORROBORATED is not a difference — a DISPUTE is', async () => {
  const { db } = await world()
  await ingest(db, FACTS, { commit: true })
  const row = (await db.query(`SELECT id FROM public.${LEDGER} WHERE entry_sequence = 5`)).rows[0]
  await db.exec(`UPDATE public.${LEDGER} SET verification_status = 'CORROBORATED', updated_by = NULL WHERE id = '${row.id}'`)
  assert.equal((await verify(db, FACTS)).verdict, 'MATCHES')
  await db.exec(`UPDATE public.${LEDGER} SET verification_status = 'DISPUTED' WHERE id = '${row.id}'`)
  const v = await verify(db, FACTS)
  assert.equal(v.verdict, 'DIFFERS')
  assert.ok(v.problems.some((p) => /DISPUTED/.test(p)))
})

test('R2-W13: the recorded facts cannot be edited or deleted after ingestion (the guards hold on the real rows)', async () => {
  const { db } = await world()
  await ingest(db, FACTS, { commit: true })
  await assert.rejects(() => db.exec(`UPDATE public.${LEDGER} SET action_text = 'edited' WHERE entry_sequence = 1`), /immutable/i)
  await assert.rejects(() => db.exec(`UPDATE public.${LEDGER} SET event_time = now(), event_time_basis = 'SOURCE_SUPPLIED' WHERE entry_sequence = 1`), /immutable/i)
  await assert.rejects(() => db.exec(`DELETE FROM public.${LEDGER}`), /cannot be deleted/i)
  await assert.rejects(() => db.exec(`UPDATE public.${PARTIES} SET address_line = 'added later' WHERE party_role = 'CONSIGNEE'`), /immutable/i)
})

// ═══════════════════════════ recovery ═══════════════════════════

test('R2-R1: recovery SUPERSEDES exactly this run\'s rows, deletes nothing, leaves other runs alone, and a repeat of `apply` records afresh', async () => {
  const { db } = await world()
  await ingest(db, FACTS, { commit: true })
  // A specification recorded by a DIFFERENT run from a different source must survive the recovery of this one.
  await db.exec(`INSERT INTO public.${SPECS} (vin, spec_key, value_text, origin, source_system, observed_at, ingestion_run)
    VALUES ('${VIN}', 'MODEL_CODE', 'DAA-RU3', 'OWNER_DECLARED', 'OWNER', now(), 'some-other-run')`)
  await assert.rejects(() => supersede(db, FACTS, {}), (e) => e.code === 'NOT_CONFIRMED')
  await assert.rejects(() => supersede(db, FACTS, { confirm: 'something-else' }), (e) => e.code === 'NOT_CONFIRMED')
  const totalBefore = Object.fromEntries(await Promise.all(INGESTED_TABLES.map(async (t) => [t, await count(db, t)])))
  const out = await supersede(db, FACTS, { confirm: FACTS.ingestion_run })
  assert.deepEqual(out.superseded, EXPECTED)
  assert.deepEqual(Object.fromEntries(await Promise.all(INGESTED_TABLES.map(async (t) => [t, await count(db, t)]))), totalBefore, 'nothing was deleted')
  assert.deepEqual(Object.fromEntries(await Promise.all(INGESTED_TABLES.map(async (t) => [t, await count(db, t, 'deleted_at IS NULL')]))), { ...ZERO, [SPECS]: 1 }, 'only the other run\'s row is still live')
  assert.equal(await count(db, 'diaspora_import_audit_log', "action = 'CAP_R2_INGESTION_SUPERSEDED'"), 1)
  assert.equal((await verify(db, FACTS)).verdict, 'DIFFERS')
  await ingest(db, FACTS, { commit: true })
  assert.equal((await verify(db, FACTS)).verdict, 'MATCHES')
  assert.deepEqual(Object.fromEntries(await Promise.all(INGESTED_TABLES.map(async (t) => [t, await count(db, t, 'deleted_at IS NULL')]))), { ...EXPECTED, [SPECS]: 14 })
})

test('R2-R3: recovery has its own tripwire — if it moves anything else it rolls back and supersedes nothing', async () => {
  const { pg, db } = await world()
  await ingest(db, FACTS, { commit: true })
  await pg.exec(`CREATE FUNCTION public.side_effect() RETURNS trigger AS $$ BEGIN INSERT INTO public.domain_events (event_type) VALUES ('x'); RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_side_effect AFTER UPDATE ON public.${LEDGER} FOR EACH ROW EXECUTE FUNCTION public.side_effect();`)
  await assert.rejects(() => supersede(db, FACTS, { confirm: FACTS.ingestion_run }), (e) => e.code === 'SOMETHING_ELSE_CHANGED' && /domain_events/.test(e.message))
  assert.deepEqual(Object.fromEntries(await Promise.all(INGESTED_TABLES.map(async (t) => [t, await count(db, t, 'deleted_at IS NULL')]))), EXPECTED, 'nothing was superseded')
})

test('R2-R4: recovery\'s FINGERPRINT tripwire — if it touches the protected vehicle it rolls back and supersedes nothing', async () => {
  const { pg, db } = await world()
  await ingest(db, FACTS, { commit: true })
  await pg.exec(`CREATE FUNCTION public.touch_serena() RETURNS trigger AS $$ BEGIN UPDATE public.vehicles SET mileage = mileage + 1 WHERE vin = '${SERENA}'; RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_touch_serena AFTER UPDATE ON public.${LEDGER} FOR EACH ROW EXECUTE FUNCTION public.touch_serena();`)
  await assert.rejects(() => supersede(db, FACTS, { confirm: FACTS.ingestion_run }), (e) => e.code === 'SOMETHING_ELSE_CHANGED' && /fingerprint protected_vehicle/.test(e.message))
  assert.deepEqual(Object.fromEntries(await Promise.all(INGESTED_TABLES.map(async (t) => [t, await count(db, t, 'deleted_at IS NULL')]))), EXPECTED, 'nothing was superseded')
  assert.equal((await db.query(`SELECT mileage FROM public.vehicles WHERE vin = '${SERENA}'`)).rows[0].mileage, 63000)
})

test('R2-R2: recovery changes nothing else either', async () => {
  const { db } = await world()
  await ingest(db, FACTS, { commit: true })
  const out = await supersede(db, FACTS, { confirm: FACTS.ingestion_run })
  assert.deepEqual(out.before.fingerprints, out.after.fingerprints)
  assert.deepEqual(out.before.counts, out.after.counts)
})

// ═══════════════════════════ the script's own discipline ═══════════════════════════

test('R2-S1: the script refuses anything but staging, holds no secrets, and writes through bound parameters only', () => {
  assert.match(SCRIPT_SOURCE, /ensureStagingDbUrl\(\)/)
  assert.doesNotMatch(SCRIPT_SOURCE, /vhmnajoeicasaigiophh/, 'the production project ref belongs only in the harness that refuses it')
  assert.doesNotMatch(SCRIPT_SOURCE, /service_role|SUPABASE_SERVICE|postgres(ql)?:\/\//i)
  // every INSERT is built from a column list and positional parameters — no value is interpolated into SQL
  assert.doesNotMatch(SCRIPT_SOURCE, /VALUES\s*\(\s*['"`]/)
})
