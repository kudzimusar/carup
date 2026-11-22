/**
 * Trade OS T11-CAP-LR01-R2 — the five customer-journey authorities, on a REAL Postgres (PGlite).
 *
 *   diaspora_external_progress_entries · diaspora_order_parties · diaspora_document_dispatches
 *   vehicle_specification_observations · vehicle_media_references
 *
 * What this proves is not that the tables exist. It proves the DISHONEST states cannot be stored:
 *   - a time with no stated basis, or a time after the moment it was observed;
 *   - a status phrase stored as a tracking number;
 *   - an external fact with no content-hashed evidence behind it;
 *   - a seat count that is text, an engine size with no unit;
 *   - a photo reference to another vehicle's image, to a document, or to a rejected asset;
 *   - a recorded fact quietly edited — including through a column added next year.
 * And the structural claims the design rests on: nothing here can assert movement, money or a customs decision, and
 * the migration touches no table that already existed.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20260926090000_trade_os_cap_r2_customer_journey_authorities.sql', import.meta.url), 'utf-8');
const up = sql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = sql.split('-- +migrate Down')[1];

const db = new PGlite();
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: String(e.message).split('\n')[0] }); }
};
const refuses = async (name, stmt, pattern) => check(name, async () => {
  let threw = null;
  try { await db.exec(stmt); } catch (e) { threw = e; }
  if (!threw) throw new Error('the database ACCEPTED what it must refuse');
  if (pattern && !pattern.test(threw.message)) throw new Error(`refused for the wrong reason: ${String(threw.message).split('\n')[0]}`);
});
const accepts = async (name, stmt, verify) => check(name, async () => {
  await db.exec(stmt);
  if (verify) await verify();
});
const one = async (q) => (await db.query(q)).rows[0];

// ── SQL literal helpers ─────────────────────────────────────────────────────
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return `ARRAY[${v.map((x) => lit(x)).join(', ')}]::text[]`;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const insert = (table, row) => `INSERT INTO public.${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(lit).join(', ')});`;
const update = (table, id, set) => `UPDATE public.${table} SET ${Object.entries(set).map(([k, v]) => `${k} = ${lit(v)}`).join(', ')} WHERE id = ${lit(id)};`;

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORDER = uid(1); const ORDER_B = uid(2); const SHIPMENT = uid(11);
const VIN = 'RU3-1316558'; const VIN_B = 'GFC27-027051';
const DIGEST = 'a'.repeat(64);
const OBSERVED = raw("(now() - interval '2 hours')");     // always in the past, whatever the host clock says
const EARLIER = raw("(now() - interval '3 hours')");

const entry = (o = {}) => ({
  id: uid(100 + (entry.n = (entry.n || 0) + 1)), import_order_id: ORDER, stage_code: 'BOOKING', entry_sequence: entry.n, action_sequence: entry.n,
  action_taker_reported: 'EXPORTER', action_taker_kind: 'PROVIDER', action_text: 'Booking made.', reported_status: 'COMPLETED',
  source_system: 'EXT_PORTAL', source_reference: 'REF-1', evidence_ref: 'bundle:test#scn-1', evidence_digest: DIGEST, observed_at: OBSERVED, ...o,
});
const party = (o = {}) => ({
  id: uid(200 + (party.n = (party.n || 0) + 1)), import_order_id: ORDER, party_role: 'CONSIGNEE', party_kind: 'INDIVIDUAL', display_name: 'A. Consignee',
  origin: 'EXTERNAL_REPORT', source_system: 'EXT_PORTAL', source_reference: 'REF-1', evidence_ref: 'bundle:test#scn-1', evidence_digest: DIGEST, observed_at: OBSERVED, ...o,
});
const dispatch = (o = {}) => ({
  id: uid(300 + (dispatch.n = (dispatch.n || 0) + 1)), import_order_id: ORDER, document_types: ['bill_of_lading'], dispatch_status: 'DELIVERED',
  status_reported_text: 'Arrived at delivery address', status_observed_at: OBSERVED, origin: 'EXTERNAL_REPORT', source_system: 'EXT_PORTAL',
  source_reference: `REF-D${dispatch.n}`, evidence_ref: 'bundle:test#scn-1', evidence_digest: DIGEST, ...o,
});
const spec = (o = {}) => ({
  id: uid(400 + (spec.n = (spec.n || 0) + 1)), vin: VIN, spec_key: 'MODEL_CODE', value_text: 'DAA-RU3', origin: 'EXTERNAL_REPORT', source_system: 'EXT_PORTAL',
  source_reference: 'REF-1', evidence_ref: 'bundle:test#scn-1', evidence_digest: DIGEST, observed_at: OBSERVED, ...o,
});
const media = (evidenceId, o = {}) => ({
  id: uid(500 + (media.n = (media.n || 0) + 1)), vin: VIN, evidence_id: evidenceId, gallery_position: media.n, ordinal_basis: 'SOURCE_GALLERY_ORDER',
  source_system: 'EXT_PORTAL', source_reference: 'REF-1', source_position: media.n, observed_at: OBSERVED, ...o,
});

const VIN_C = 'TST-0000001'; const TENANT_X = uid(900);
const EV_PHOTO = uid(1001); const EV_PHOTO_2 = uid(1002); const EV_PHOTO_3 = uid(1003); const EV_PDF = uid(1004); const EV_OTHER_VEHICLE = uid(1005); const EV_REJECTED = uid(1006); const EV_PHOTO_4 = uid(1007);

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  -- Supabase grants every new public table to these roles by default. A bare Postgres does not, so without this the
  -- REVOKE in the migration would be untestable: removing it would change nothing.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  CREATE TABLE public.users (id text PRIMARY KEY);
  INSERT INTO public.users (id) VALUES ('operator-1'), ('operator-2'), ('operator-3');
  CREATE TABLE public.tenants (id uuid PRIMARY KEY);
  INSERT INTO public.tenants (id) VALUES ('${TENANT_X}');
  CREATE TABLE public.vehicles (vin text PRIMARY KEY, price real NOT NULL DEFAULT 0);
  INSERT INTO public.vehicles (vin) VALUES ('${VIN}'), ('${VIN_B}'), ('${VIN_C}');
  CREATE TABLE public.vehicle_evidence (
    id uuid PRIMARY KEY, vin text NOT NULL REFERENCES public.vehicles(vin) ON DELETE CASCADE,
    mime_type text NOT NULL, verification_status text NOT NULL DEFAULT 'pending');
  INSERT INTO public.vehicle_evidence (id, vin, mime_type, verification_status) VALUES
    ('${EV_PHOTO}', '${VIN}', 'image/jpeg', 'pending'), ('${EV_PHOTO_2}', '${VIN}', 'image/jpeg', 'pending'),
    ('${EV_PHOTO_3}', '${VIN}', 'image/png', 'verified'), ('${EV_PDF}', '${VIN}', 'application/pdf', 'pending'),
    ('${EV_OTHER_VEHICLE}', '${VIN_B}', 'image/jpeg', 'pending'), ('${EV_REJECTED}', '${VIN}', 'image/jpeg', 'rejected'),
    ('${EV_PHOTO_4}', '${VIN}', 'image/jpeg', 'pending');
  CREATE TABLE public.diaspora_import_orders (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'IMPORT_REQUESTED');
  INSERT INTO public.diaspora_import_orders (id) VALUES ('${ORDER}'), ('${ORDER_B}');
  CREATE TABLE public.diaspora_shipments (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'PLANNED',
    departure_date timestamptz NULL, actual_arrival_date timestamptz NULL);
  INSERT INTO public.diaspora_shipments (id) VALUES ('${SHIPMENT}');
`);

const snapshotExisting = async () => (await db.query(`
  SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN ('users','tenants','vehicles','vehicle_evidence','diaspora_import_orders','diaspora_shipments')
  ORDER BY table_name, ordinal_position;`)).rows;
const beforeColumns = JSON.stringify(await snapshotExisting());
const beforeTables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;`)).rows.map((r) => r.table_name);

const NEW_TABLES = ['diaspora_external_progress_entries', 'diaspora_order_parties', 'diaspora_document_dispatches', 'vehicle_specification_observations', 'vehicle_media_references'];

await check('the migration applies', async () => { await db.exec(up); });
await check('IDEMPOTENT: applying the migration a second time changes nothing and fails nothing', async () => { await db.exec(up); });

await check('SCOPE: the migration creates exactly the five tables and alters no table that already existed', async () => {
  const after = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;`)).rows.map((r) => r.table_name);
  const created = after.filter((t) => !beforeTables.includes(t)).sort();
  if (JSON.stringify(created) !== JSON.stringify([...NEW_TABLES].sort())) throw new Error(`created: ${created.join(', ')}`);
  if (JSON.stringify(await snapshotExisting()) !== beforeColumns) throw new Error('an existing table was altered');
});

// ═══════════════════════════ 1. EXTERNAL PROGRESS LEDGER ═══════════════════════════

const LEDGER = 'diaspora_external_progress_entries';

await check('STRUCTURE: nothing in the ledger can assert movement, money or a customs decision', async () => {
  for (const t of NEW_TABLES) {
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}'`)).rows.map((r) => r.column_name);
    const bad = cols.filter((c) => /^(actual|observed_(departure|arrival)|departed|arrived|sailed|released|cleared)/.test(c)
      || /(amount|price|currency|payment|duty|tariff|customs|imo|mmsi)/.test(c));
    if (bad.length) throw new Error(`${t} can assert something it must not: ${bad.join(', ')}`);
  }
});
await check('STRUCTURE: event_time has no default — creation time is not event time', async () => {
  const r = await one(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name='${LEDGER}' AND column_name='event_time'`);
  if (r.column_default !== null) throw new Error(`event_time defaults to ${r.column_default}`);
  if (r.is_nullable !== 'YES') throw new Error('an unknown time cannot be stored');
});
await check('STRUCTURE: the ledger has no origin column — it can only ever hold what others reported', async () => {
  const r = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name='${LEDGER}' AND column_name='origin'`);
  if (r.rows.length) throw new Error('a CarUp-origin row could be stored here and diverge from the authority that owns the fact');
});

const e1 = entry({ stage_code: 'BOOKING', action_text: 'Your Cap is now available.' });
await accepts('a completed action with NO time is a complete, valid record', insert(LEDGER, e1), async () => {
  const r = await one(`SELECT reported_status, event_time, event_time_basis, verification_status, imported_at IS NOT NULL AS stamped FROM public.${LEDGER} WHERE id='${e1.id}'`);
  if (r.reported_status !== 'COMPLETED' || r.event_time !== null || r.event_time_basis !== null) throw new Error('Completed was not stored with an unknown time');
  if (r.verification_status !== 'REPORTED') throw new Error(`default verification is ${r.verification_status}, not REPORTED`);
  if (!r.stamped) throw new Error('import time not recorded');
});
await accepts('a time WITH a stated basis, before it was observed, is accepted', insert(LEDGER, entry({ stage_code: 'DEPARTURE', event_time: EARLIER, event_time_basis: 'SOURCE_SUPPLIED' })));
await accepts('a DOCUMENT_STATED time is accepted', insert(LEDGER, entry({ stage_code: 'BILL_OF_LADING', event_time: EARLIER, event_time_basis: 'DOCUMENT_STATED' })));

await refuses('a time with no basis is refused', insert(LEDGER, entry({ event_time: EARLIER })), /time_basis_chk/);
await refuses('a basis with no time is refused', insert(LEDGER, entry({ event_time_basis: 'SOURCE_SUPPLIED' })), /time_basis_chk/);
await refuses('a time CarUp itself observed does not belong in a ledger of what others reported (that is T11)', insert(LEDGER, entry({ event_time: EARLIER, event_time_basis: 'CARUP_OBSERVED' })), /time_basis_chk/);
await refuses('an action cannot be dated after the moment it was observed', insert(LEDGER, entry({ event_time: raw("(now() - interval '1 hour')"), event_time_basis: 'SOURCE_SUPPLIED' })), /time_order_chk/);
await refuses('an observation cannot be from the future of its own import', insert(LEDGER, entry({ observed_at: raw("(now() + interval '1 day')") })), /observed_chk/);
await accepts('…but a few minutes of clock skew between the source and the database is tolerated', insert(LEDGER, entry({ observed_at: raw("(now() + interval '2 minutes')") })));
await refuses('NULL IS NOT A PASS: an unknown basis alongside a time is still refused', insert(LEDGER, entry({ event_time: EARLIER, event_time_basis: null })), /time_basis_chk/);
await refuses('an unrecognised basis is refused', insert(LEDGER, entry({ event_time: EARLIER, event_time_basis: 'GUESSED' })), /time_basis_chk/);
await refuses('an unknown stage is refused', insert(LEDGER, entry({ stage_code: 'TRANSIT' })), /stage_chk/);
await refuses('an unknown reported status is refused', insert(LEDGER, entry({ reported_status: 'DONE' })), /status_chk/);
await refuses('an unknown action-taker kind is refused', insert(LEDGER, entry({ action_taker_kind: 'ROBOT' })), /taker_kind_chk/);
await refuses('sequences start at 1 (entry)', insert(LEDGER, entry({ entry_sequence: 0 })), /sequence_chk/);
await refuses('sequences start at 1 (action)', insert(LEDGER, entry({ action_sequence: 0 })), /sequence_chk/);
await refuses('a blank action is refused', insert(LEDGER, entry({ action_text: '   ' })), /text_chk/);
await refuses('a blank action taker is refused', insert(LEDGER, entry({ action_taker_reported: '' })), /taker_chk/);
await refuses('an external fact must name its source system', insert(LEDGER, entry({ source_system: ' ' })), /source_system_chk/);
await refuses('an external fact must carry the source reference', insert(LEDGER, entry({ source_reference: null })), /not-null|null value|source_reference/i);
await refuses('an external fact must point at its supporting evidence', insert(LEDGER, entry({ evidence_ref: null })), /not-null|null value|evidence_ref/i);
await refuses('an external fact must carry a content digest of that evidence', insert(LEDGER, entry({ evidence_digest: null })), /not-null|null value|evidence_digest/i);
await refuses('a digest must be a lower-case SHA-256', insert(LEDGER, entry({ evidence_digest: 'ABC' })), /evidence_digest_chk/);
await refuses('an upper-case digest is not the canonical form', insert(LEDGER, entry({ evidence_digest: 'A'.repeat(64) })), /evidence_digest_chk/);
await refuses('a verification state outside the vocabulary is refused', insert(LEDGER, entry({ verification_status: 'TRUSTED' })), /verification_chk/);
await refuses('an entry cannot belong to an order that does not exist', insert(LEDGER, entry({ import_order_id: uid(999) })), /foreign key|violates/i);
await refuses('an entry cannot name a vehicle that does not exist', insert(LEDGER, entry({ vehicle_vin: 'NOPE' })), /foreign key|violates/i);
const dupe = entry({ stage_code: 'BOOKING' });
await accepts('POSITIVE CONTROL: a second entry in a different position is accepted', insert(LEDGER, dupe));
await refuses('the same position in the ledger from the same source cannot be recorded twice (a repeated import is a no-op)',
  insert(LEDGER, entry({ entry_sequence: dupe.entry_sequence, action_sequence: 99 })), /uq_external_progress_live_entry|unique/i);
await refuses('the same action slot in a stage cannot be recorded twice',
  insert(LEDGER, entry({ stage_code: dupe.stage_code, action_sequence: dupe.action_sequence, entry_sequence: 98 })), /uq_external_progress_live_stage_action|unique/i);
await accepts('a different source may report the same position', insert(LEDGER, entry({ entry_sequence: dupe.entry_sequence, action_sequence: dupe.action_sequence, source_reference: 'REF-OTHER' })));

// Immutability — every recorded fact, one by one.
const target = entry({ stage_code: 'DISPATCH', action_text: 'Sent out documents.' });
await db.exec(insert(LEDGER, target));
const IMMUTABLE_LEDGER = [
  ['action_text', 'Edited text'], ['reported_status', 'PENDING'], ['stage_code', 'BOOKING'], ['entry_sequence', 77], ['action_sequence', 77],
  ['action_taker_reported', 'SOMEONE ELSE'], ['action_taker_kind', 'CUSTOMER'], ['event_time', EARLIER], ['source_system', 'OTHER'],
  ['source_reference', 'REF-X'], ['source_position', 'row 99'], ['evidence_ref', 'bundle:other'], ['evidence_digest', 'b'.repeat(64)],
  ['observed_at', raw("now() - interval '5 hours'")], ['imported_at', raw("now() - interval '5 days'")], ['import_order_id', ORDER_B],
  ['created_by', 'operator-2'], ['tenant_id', TENANT_X], ['created_at', raw("now() - interval '9 days'")], ['ingestion_run', 'forged-run'], ['vehicle_vin', VIN], ['shipment_id', SHIPMENT],
];
for (const [col, val] of IMMUTABLE_LEDGER) {
  await refuses(`IMMUTABLE: ${col} of a recorded fact cannot be edited`, update(LEDGER, target.id, { [col]: val }), /immutable/i);
}
await check('IMMUTABLE BY DEFAULT: a column added to the table next year is not silently editable', async () => {
  await db.exec(`ALTER TABLE public.${LEDGER} ADD COLUMN future_fact text`);
  let threw = null;
  try { await db.exec(update(LEDGER, target.id, { future_fact: 'x' })); } catch (e) { threw = e; }
  await db.exec(`ALTER TABLE public.${LEDGER} DROP COLUMN future_fact`);
  if (!threw || !/immutable/i.test(threw.message)) throw new Error('a new column was editable');
});
await accepts('POSITIVE CONTROL: verification state, metadata and attribution CAN change', update(LEDGER, target.id,
  { verification_status: 'CORROBORATED', metadata: raw(`'{"reviewed":true}'::jsonb`), updated_by: 'operator-1', updated_at: raw('now()') }),
async () => {
  const r = await one(`SELECT verification_status, updated_by, action_text FROM public.${LEDGER} WHERE id='${target.id}'`);
  if (r.verification_status !== 'CORROBORATED' || r.updated_by !== 'operator-1') throw new Error('the permitted change did not apply');
  if (r.action_text !== 'Sent out documents.') throw new Error('the fact itself moved');
});
await accepts('POSITIVE CONTROL: an entry can be superseded, freeing its position for a corrected one', update(LEDGER, target.id, { deleted_at: raw('now()'), updated_by: 'operator-2' }));
await accepts('…and its replacement takes the same position', insert(LEDGER, entry({ stage_code: 'DISPATCH', entry_sequence: target.entry_sequence, action_sequence: target.action_sequence, action_text: 'Corrected text.' })));
await refuses('a superseded entry cannot be restored', update(LEDGER, target.id, { deleted_at: null }), /restored|superseded/i);
await refuses('a superseded entry cannot be re-dated', update(LEDGER, target.id, { deleted_at: raw("now() + interval '1 day'") }), /restored|superseded|re-dated/i);
const linked = entry({ stage_code: 'CLEARING_DELIVERY', vehicle_vin: VIN_C, shipment_id: SHIPMENT });
await accepts('an entry may be associated with a vehicle and a shipment', insert(LEDGER, linked));
await refuses('a vehicle that has progress recorded against it cannot be hard-deleted (the association is an immutable fact)', `DELETE FROM public.vehicles WHERE vin='${VIN_C}';`, /foreign key|violates/i);
await refuses('a shipment that has progress recorded against it cannot be hard-deleted', `DELETE FROM public.diaspora_shipments WHERE id='${SHIPMENT}';`, /foreign key|violates/i);
await refuses('a recorded fact cannot be DELETED', `DELETE FROM public.${LEDGER} WHERE id='${e1.id}';`, /cannot be deleted/i);
await refuses('the whole ledger cannot be emptied either', `DELETE FROM public.${LEDGER};`, /cannot be deleted/i);
await refuses('an order that has a ledger cannot be hard-deleted out from under it', `DELETE FROM public.diaspora_import_orders WHERE id='${ORDER}';`, /cannot be deleted/i);

// ═══════════════════════════ 2. ORDER PARTIES ═══════════════════════════

const PARTIES = 'diaspora_order_parties';
const consignee = party({ party_role: 'CONSIGNEE', party_kind: 'INDIVIDUAL', display_name: 'A. Consignee', address_line: '1 Example Road', city: 'HARARE', country: 'Zimbabwe', phone: '+263 77 000 0000', email: 'a@example.test' });
await accepts('an individual consignee with full contact details is accepted', insert(PARTIES, consignee));
await accepts('an organisation notify party is accepted', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', party_kind: 'ORGANISATION', display_name: 'Example Forwarding Ltd', phone: '+255-222-000-000' })));
await accepts('document delivery, document centre and agent roles are accepted', [
  insert(PARTIES, party({ party_role: 'DOCUMENT_DELIVERY', party_kind: 'ORGANISATION', display_name: 'Example Forwarding Ltd' })),
  insert(PARTIES, party({ party_role: 'DOCUMENT_CENTRE', party_kind: 'ORGANISATION', display_name: 'Example Document Centre' })),
  insert(PARTIES, party({ party_role: 'DESTINATION_AGENT', party_kind: 'ORGANISATION', display_name: 'Example Agent', source_reference: null, origin: 'OWNER_DECLARED', evidence_ref: null, evidence_digest: null })),
].join('\n'));
await refuses('an unknown role is refused', insert(PARTIES, party({ party_role: 'BUYER' })), /role_chk/);
await refuses('an unknown kind is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', party_kind: 'ROBOT' })), /kind_chk/);
await refuses('a nameless party is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', display_name: ' ' })), /name_chk/);
await refuses('an email with no @ is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', email: 'not-an-email' })), /email_chk/);
await refuses('an email with whitespace is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', email: 'a b@example.test' })), /email_chk/);
await refuses('a phone number with letters is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', phone: 'call me' })), /phone_chk/);
await refuses('two live parties cannot share a role on one order', insert(PARTIES, party({ party_role: 'CONSIGNEE' })), /uq_order_party_live_role|unique/i);
await accepts('the same role on a different order is fine', insert(PARTIES, party({ import_order_id: ORDER_B, party_role: 'CONSIGNEE' })));
await refuses('an externally reported party without a source reference is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', source_reference: null })), /external_provenance_chk/);
await refuses('an externally reported party without evidence is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', evidence_ref: null, evidence_digest: null })), /external_provenance_chk/);
await refuses('an externally reported party with evidence but no digest is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', evidence_digest: null })), /external_provenance_chk/);
await refuses('an unknown origin is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', origin: 'GUESSED' })), /origin_chk/);
await refuses('a party observation from the future is refused', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', observed_at: raw("(now() + interval '1 day')") })), /observed_chk/);
await accepts('…while minutes of clock skew are tolerated', insert(PARTIES, party({ import_order_id: ORDER_B, party_role: 'NOTIFY_PARTY', observed_at: raw("(now() + interval '2 minutes')") })));
await refuses('a party cannot belong to an order that does not exist', insert(PARTIES, party({ party_role: 'NOTIFY_PARTY', import_order_id: uid(999) })), /foreign key|violates/i);
for (const [col, val] of [['display_name', 'Someone Else'], ['address_line', 'Elsewhere'], ['phone', '+1 555 0100'], ['email', 'b@example.test'], ['party_role', 'NOTIFY_PARTY'], ['origin', 'CARUP'], ['party_kind', 'ORGANISATION'], ['source_reference', 'X'], ['import_order_id', ORDER_B]]) {
  await refuses(`IMMUTABLE: a declared party's ${col} cannot be edited`, update(PARTIES, consignee.id, { [col]: val }), /immutable/i);
}
await accepts('POSITIVE CONTROL: a party can be superseded and replaced (a changed address is a new record)', [
  update(PARTIES, consignee.id, { deleted_at: raw('now()') }),
  insert(PARTIES, party({ party_role: 'CONSIGNEE', display_name: 'A. Consignee', address_line: '2 New Road' })),
].join('\n'), async () => {
  const r = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE deleted_at IS NULL)::int AS live FROM public.${PARTIES} WHERE import_order_id='${ORDER}' AND party_role='CONSIGNEE'`);
  if (r.n !== 2 || r.live !== 1) throw new Error(`history not kept (${r.n} rows, ${r.live} live)`);
});
await refuses('a party cannot be deleted', `DELETE FROM public.${PARTIES} WHERE id='${consignee.id}';`, /cannot be deleted/i);

// ═══════════════════════════ 3. DOCUMENT DISPATCHES ═══════════════════════════

const DISPATCHES = 'diaspora_document_dispatches';
const notifyParty = (await one(`SELECT id FROM public.${PARTIES} WHERE import_order_id='${ORDER}' AND party_role='NOTIFY_PARTY' AND deleted_at IS NULL`)).id;
const d1 = dispatch({ recipient_party_id: notifyParty, message_text: 'This is your tracking number for your envelope.' });
await accepts('a dispatch whose only known status is the source\'s own words is accepted, with NO tracking number and NO times', insert(DISPATCHES, d1), async () => {
  const r = await one(`SELECT status_reported_text, tracking_number, dispatched_at, delivered_at, dispatch_status FROM public.${DISPATCHES} WHERE id='${d1.id}'`);
  if (r.tracking_number !== null || r.dispatched_at !== null || r.delivered_at !== null) throw new Error('a value was invented');
  if (r.status_reported_text !== 'Arrived at delivery address' || r.dispatch_status !== 'DELIVERED') throw new Error('status not kept');
});
await refuses('A STATUS PHRASE CANNOT BE STORED AS A TRACKING NUMBER', insert(DISPATCHES, dispatch({ tracking_number: 'Arrived at delivery address' })), /tracking_chk/);
await refuses('a too-short tracking number is refused', insert(DISPATCHES, dispatch({ tracking_number: 'AB12' })), /tracking_chk/);
await accepts('a real-shaped tracking number is accepted', insert(DISPATCHES, dispatch({ tracking_number: 'EJ123456789JP', courier_name: 'Example Courier', dispatch_status: 'IN_TRANSIT', status_reported_text: null })));
await refuses('a dispatch must carry at least one document', insert(DISPATCHES, dispatch({ document_types: raw("ARRAY[]::text[]") })), /types_chk/);
await refuses('only shipping documents can travel', insert(DISPATCHES, dispatch({ document_types: ['selfie'] })), /types_chk/);
await refuses('an unknown dispatch status is refused', insert(DISPATCHES, dispatch({ dispatch_status: 'LOST_IN_SPACE' })), /status_chk/);
await refuses('a delivery time on a dispatch that is not DELIVERED is refused', insert(DISPATCHES, dispatch({ dispatch_status: 'IN_TRANSIT', delivered_at: EARLIER })), /times_chk/);
await refuses('delivered before it was dispatched is refused', insert(DISPATCHES, dispatch({ dispatched_at: EARLIER, delivered_at: raw("(now() - interval '4 hours')") })), /times_chk/);
await refuses('delivered after it was observed to be delivered is refused', insert(DISPATCHES, dispatch({ delivered_at: raw("(now() - interval '1 hour')") })), /times_chk/);
await refuses('a status observed in the future is refused (a slipped time zone is the realistic error)', insert(DISPATCHES, dispatch({ status_observed_at: raw("(now() + interval '1 day')") })), /in the future/);
await accepts('…but a few minutes of clock skew is tolerated', insert(DISPATCHES, dispatch({ status_observed_at: raw("(now() + interval '2 minutes')"), dispatch_status: 'IN_TRANSIT', status_reported_text: null })));
await refuses('an externally reported dispatch must cite evidence', insert(DISPATCHES, dispatch({ evidence_ref: null, evidence_digest: null })), /external_provenance_chk/);
await refuses('an externally reported dispatch must carry its source reference', insert(DISPATCHES, dispatch({ source_reference: null })), /external_provenance_chk/);
await refuses('a repeated import of the same dispatch is a duplicate', insert(DISPATCHES, dispatch({ source_reference: d1.source_reference })), /uq_document_dispatch_live_source|unique/i);
await refuses('a party that a dispatch refers to cannot be hard-deleted', `DELETE FROM public.${PARTIES} WHERE id='${notifyParty}';`, /cannot be deleted/i);
await refuses('a recipient that is not a party is refused', insert(DISPATCHES, dispatch({ recipient_party_id: uid(998) })), /foreign key|violates/i);
await accepts('a CarUp-originated dispatch needs no source reference', insert(DISPATCHES, dispatch({ origin: 'CARUP', source_system: 'CARUP', source_reference: null, evidence_ref: null, evidence_digest: null, dispatch_status: 'PREPARING', status_reported_text: null })));
for (const [col, val] of [['import_order_id', ORDER_B], ['document_types', ['commercial_invoice']], ['origin', 'CARUP'], ['source_system', 'OTHER'], ['source_reference', 'X'], ['recipient_party_id', null], ['evidence_digest', 'c'.repeat(64)], ['imported_at', raw("now() - interval '3 days'")], ['created_by', 'operator-2']]) {
  await refuses(`IMMUTABLE: a dispatch's ${col} cannot be edited`, update(DISPATCHES, d1.id, { [col]: val }), /immutable/i);
}
const live = dispatch({ origin: 'CARUP', source_system: 'CARUP', source_reference: null, evidence_ref: null, evidence_digest: null, dispatch_status: 'PREPARING', status_reported_text: null });
await db.exec(insert(DISPATCHES, live));
await accepts('POSITIVE CONTROL: a dispatch moves through its life, attributed, and every step must still be coherent', [
  update(DISPATCHES, live.id, { dispatch_status: 'DISPATCHED', courier_name: 'Example Courier', tracking_number: 'EJ987654321JP', dispatched_at: EARLIER, updated_by: 'operator-1' }),
  update(DISPATCHES, live.id, { dispatch_status: 'DELIVERED', delivered_at: raw("(now() - interval '2 hours')"), status_observed_at: raw("now()"), updated_by: 'operator-2' }),
].join('\n'));
await refuses('…but a step that breaks the rules is still refused', update(DISPATCHES, live.id, { tracking_number: 'two words' }), /tracking_chk/);
await refuses('a dispatch cannot be deleted', `DELETE FROM public.${DISPATCHES} WHERE id='${d1.id}';`, /cannot be deleted/i);

// ═══════════════════════════ 4. SPECIFICATION OBSERVATIONS ═══════════════════════════

const SPECS = 'vehicle_specification_observations';
const specOk = [
  spec({ spec_key: 'MODEL_CODE', value_text: 'DAA-RU3', source_value_raw: 'DAA-RU3' }),
  spec({ spec_key: 'REGISTRATION_YEAR_MONTH', value_text: '2018-12', source_value_raw: '2018/12' }),
  spec({ spec_key: 'MANUFACTURE_YEAR_MONTH', value_text: '2018-06', source_value_raw: '2018/6' }),
  spec({ spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: null, value_number: 1490, unit: 'cc', source_value_raw: '1490' }),
  spec({ spec_key: 'STEERING_SIDE', value_text: 'RIGHT', source_value_raw: 'Right' }),
  spec({ spec_key: 'SEAT_COUNT', value_text: null, value_number: 5, unit: 'count' }),
  spec({ spec_key: 'DOOR_COUNT', value_text: null, value_number: 5, unit: 'count' }),
  spec({ spec_key: 'FUEL_DETAIL', value_text: 'Hybrid (Petrol)', source_value_raw: 'Hybrid(Petrol)' }),
  spec({ spec_key: 'EQUIPMENT_ITEM', value_text: 'A/C' }), spec({ spec_key: 'EQUIPMENT_ITEM', value_text: 'Airbag' }),
];
await accepts('every kind of specification fact is representable in its one shape (10 observations)', specOk.map((s) => insert(SPECS, s)).join('\n'), async () => {
  const r = await one(`SELECT count(*)::int AS n FROM public.${SPECS} WHERE vin='${VIN}'`);
  if (r.n !== 10) throw new Error(`expected 10, stored ${r.n}`);
});
await refuses('an unknown kind of fact is refused', insert(SPECS, spec({ spec_key: 'PURCHASE_PRICE', value_text: 'x' })), /key_chk/);
await refuses('a specification observed in the future is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'MODEL_CODE', observed_at: raw("(now() + interval '1 day')") })), /observed_chk/);
await accepts('…while minutes of clock skew are tolerated', insert(SPECS, spec({ vin: VIN_C, spec_key: 'MODEL_CODE', observed_at: raw("(now() + interval '2 minutes')") })));
// NULL IS NOT A PASS. A CHECK that evaluates to NULL is ACCEPTED by SQL, so each shape rule must be tried with the value missing.
await refuses('NULL IS NOT A PASS: a model code with no value is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'MODEL_CODE', value_text: null })), /text_keys_chk/);
await refuses('NULL IS NOT A PASS: a registration year/month with no value is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'REGISTRATION_YEAR_MONTH', value_text: null })), /year_month_chk/);
await refuses('NULL IS NOT A PASS: a manufacture year/month with no value is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'MANUFACTURE_YEAR_MONTH', value_text: null })), /year_month_chk/);
await refuses('NULL IS NOT A PASS: a steering side with no value is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'STEERING_SIDE', value_text: null })), /steering_chk/);
await refuses('NULL IS NOT A PASS: an engine size with no number is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: null, value_number: null, unit: 'cc' })), /displacement_chk/);
await refuses('NULL IS NOT A PASS: a seat count with no number is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'SEAT_COUNT', value_text: null, value_number: null, unit: 'count' })), /count_chk/);
await refuses('NULL IS NOT A PASS: a door count with no number is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'DOOR_COUNT', value_text: null, value_number: null, unit: null })), /count_chk/);
await refuses('a seat count cannot be text', insert(SPECS, spec({ vin: VIN_B, spec_key: 'SEAT_COUNT', value_text: 'five', value_number: null, unit: 'count' })), /count_chk/);
await refuses('a seat count of zero is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'SEAT_COUNT', value_text: null, value_number: 0, unit: 'count' })), /count_chk/);
await refuses('a seat count of 2.5 is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'SEAT_COUNT', value_text: null, value_number: 2.5, unit: 'count' })), /count_chk/);
await refuses('a door count of 101 is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'DOOR_COUNT', value_text: null, value_number: 101, unit: 'count' })), /count_chk/);
await refuses('a count with no unit is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'DOOR_COUNT', value_text: null, value_number: 5, unit: null })), /count_chk/);
await refuses('an engine size with no unit is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: null, value_number: 1490, unit: null })), /displacement_chk/);
await refuses('an engine size in the wrong unit is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: null, value_number: 1490, unit: 'ml' })), /displacement_chk/);
await refuses('an engine size of zero is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: null, value_number: 0, unit: 'cc' })), /displacement_chk/);
await refuses('an engine size of 20 litres in cc is refused as implausible', insert(SPECS, spec({ vin: VIN_B, spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: null, value_number: 20000, unit: 'cc' })), /displacement_chk/);
await refuses('an engine size carrying text as well is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: '1490cc', value_number: 1490, unit: 'cc' })), /displacement_chk/);
await refuses('a year/month must be ISO — the source\'s slash form is normalised before it is stored', insert(SPECS, spec({ vin: VIN_B, spec_key: 'REGISTRATION_YEAR_MONTH', value_text: '2018/12' })), /year_month_chk/);
await refuses('month 13 is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'REGISTRATION_YEAR_MONTH', value_text: '2018-13' })), /year_month_chk/);
await refuses('a registration before 1950 is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'MANUFACTURE_YEAR_MONTH', value_text: '1949-12' })), /year_month_chk/);
await refuses('steering is RIGHT or LEFT', insert(SPECS, spec({ vin: VIN_B, spec_key: 'STEERING_SIDE', value_text: 'CENTRE' })), /steering_chk/);
await refuses('steering is not case-sloppy', insert(SPECS, spec({ vin: VIN_B, spec_key: 'STEERING_SIDE', value_text: 'Right' })), /steering_chk/);
await refuses('a model code cannot be a number', insert(SPECS, spec({ vin: VIN_B, spec_key: 'MODEL_CODE', value_text: null, value_number: 3 })), /text_keys_chk/);
await refuses('a blank equipment item is refused', insert(SPECS, spec({ vin: VIN_B, spec_key: 'EQUIPMENT_ITEM', value_text: '  ' })), /text_keys_chk/);
await refuses('a specification for a vehicle that does not exist is refused', insert(SPECS, spec({ vin: 'NOPE' })), /foreign key|violates/i);
await refuses('a single-valued fact has ONE live value per source: a conflicting engine size from the same source is refused',
  insert(SPECS, spec({ spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: null, value_number: 1500, unit: 'cc' })), /uq_vehicle_spec_obs_live_single|unique/i);
await accepts('…but a different source may state its own value', insert(SPECS, spec({ spec_key: 'ENGINE_DISPLACEMENT_CC', value_text: null, value_number: 1500, unit: 'cc', source_system: 'OTHER_SOURCE', source_reference: 'REG-DOC-9' })));
await refuses('equipment is many-valued, but the same item twice (any case) is a duplicate', insert(SPECS, spec({ spec_key: 'EQUIPMENT_ITEM', value_text: 'a/c' })), /uq_vehicle_spec_obs_live_equipment|unique/i);
await refuses('an external specification must cite its evidence', insert(SPECS, spec({ spec_key: 'DOOR_COUNT', value_text: null, value_number: 3, unit: 'count', source_system: 'THIRD', evidence_ref: null, evidence_digest: null })), /external_provenance_chk/);
await accepts('an OWNER_DECLARED specification needs no external evidence', insert(SPECS, spec({ vin: VIN_B, origin: 'OWNER_DECLARED', source_reference: null, evidence_ref: null, evidence_digest: null, spec_key: 'STEERING_SIDE', value_text: 'RIGHT' })));
const specTarget = specOk[0];
for (const [col, val] of [['value_text', 'OTHER-CODE'], ['spec_key', 'FUEL_DETAIL'], ['vin', VIN_B], ['source_value_raw', 'x'], ['origin', 'CARUP'], ['evidence_digest', 'd'.repeat(64)], ['observed_at', raw("now() - interval '9 hours'")]]) {
  await refuses(`IMMUTABLE: an observation's ${col} cannot be edited`, update(SPECS, specTarget.id, { [col]: val }), /immutable/i);
}
await accepts('POSITIVE CONTROL: a document-verified spec can be marked VERIFIED, attributed', update(SPECS, specTarget.id, { verification_status: 'VERIFIED', updated_by: 'operator-1' }));
await refuses('a specification cannot be deleted', `DELETE FROM public.${SPECS} WHERE id='${specTarget.id}';`, /cannot be deleted/i);
await refuses('a vehicle that has recorded specifications cannot be hard-deleted out from under them', `DELETE FROM public.vehicles WHERE vin='${VIN}';`, /foreign key|violates|restrict/i);

// ═══════════════════════════ 5. MEDIA REFERENCES ═══════════════════════════

const MEDIA = 'vehicle_media_references';
const m1 = media(EV_PHOTO, { is_primary: true, primary_basis: 'SOURCE_FIRST_IMAGE' });
await accepts('a reference to an image of THIS vehicle is accepted, primary because the source designated it', insert(MEDIA, m1));
await accepts('a second reference takes the next position', insert(MEDIA, media(EV_PHOTO_2)));
await accepts('a PNG that is already verified is just as presentable', insert(MEDIA, media(EV_PHOTO_3)));
await refuses('a reference to ANOTHER VEHICLE\'S image is refused', insert(MEDIA, media(EV_OTHER_VEHICLE, { gallery_position: 40 })), /different vehicle/i);
await refuses('a reference to a document (not an image) is refused', insert(MEDIA, media(EV_PDF, { gallery_position: 41 })), /only an image/i);
await refuses('a reference to a REJECTED asset is refused', insert(MEDIA, media(EV_REJECTED, { gallery_position: 42 })), /rejected/i);
await refuses('a reference to an asset that does not exist is refused', insert(MEDIA, media(uid(7777), { gallery_position: 43 })), /does not exist/i);
await refuses('"primary" with no stated basis is refused — primacy is a choice and says whose', insert(MEDIA, media(EV_PHOTO, { gallery_position: 44, is_primary: true })), /primary_chk/);
await refuses('a basis for primacy on a non-primary reference is refused', insert(MEDIA, media(EV_PHOTO, { gallery_position: 45, primary_basis: 'OWNER_SELECTED' })), /primary_chk/);
await refuses('an unknown primacy basis is refused', insert(MEDIA, media(EV_PHOTO, { gallery_position: 46, is_primary: true, primary_basis: 'ELECTED' })), /primary_basis_chk/);
await refuses('an unknown ordinal basis is refused', insert(MEDIA, media(EV_PHOTO, { gallery_position: 47, ordinal_basis: 'ALPHABETICAL' })), /ordinal_basis_chk/);
await refuses('positions start at 1', insert(MEDIA, media(EV_PHOTO, { gallery_position: 0 })), /position_chk/);
await refuses('a reference observed in the future is refused', insert(MEDIA, media(EV_PHOTO_4, { gallery_position: 60, observed_at: raw("(now() + interval '1 day')") })), /observed_chk/);
await refuses('an asset is referenced once per vehicle', insert(MEDIA, media(EV_PHOTO, { gallery_position: 48 })), /uq_vehicle_media_ref_live_asset|unique/i);
await refuses('a position is held once per vehicle', insert(MEDIA, media(EV_PHOTO_4, { gallery_position: 1 })), /uq_vehicle_media_ref_live_position|unique/i);
await db.exec(`UPDATE public.${MEDIA} SET deleted_at = now() WHERE evidence_id='${EV_PHOTO_2}'`);
await refuses('there is at most one primary per vehicle', insert(MEDIA, media(EV_PHOTO_2, { gallery_position: 49, is_primary: true, primary_basis: 'OWNER_SELECTED' })), /uq_vehicle_media_ref_live_primary|unique/i);
await accepts('POSITIVE CONTROL: a superseded reference frees its asset and position', insert(MEDIA, media(EV_PHOTO_2, { gallery_position: 2 })));
for (const [col, val] of [['vin', VIN_B], ['evidence_id', EV_PHOTO_3], ['source_system', 'OTHER'], ['source_reference', 'X'], ['source_position', 9], ['observed_at', raw("now() - interval '9 hours'")], ['created_by', 'operator-2']]) {
  await refuses(`IMMUTABLE: a reference's ${col} cannot be edited`, update(MEDIA, m1.id, { [col]: val }), /immutable/i);
}
await accepts('POSITIVE CONTROL: the owner can re-label a reference and move the primary designation', [
  update(MEDIA, m1.id, { label: 'Front three-quarter', updated_by: 'operator-1' }),
  update(MEDIA, m1.id, { is_primary: false, primary_basis: null }),
  update(MEDIA, (await one(`SELECT id FROM public.${MEDIA} WHERE evidence_id='${EV_PHOTO_3}' AND deleted_at IS NULL`)).id, { is_primary: true, primary_basis: 'OWNER_SELECTED' }),
].join('\n'), async () => {
  const r = await one(`SELECT count(*)::int AS n, bool_and(primary_basis = 'OWNER_SELECTED') AS who FROM public.${MEDIA} WHERE vin='${VIN}' AND is_primary AND deleted_at IS NULL`);
  if (r.n !== 1 || !r.who) throw new Error('primacy did not move to the owner\'s choice');
});
await accepts('a reference whose asset is rejected LATER can still be re-ordered or retired (the check guards creation, not housekeeping)', [
  `UPDATE public.vehicle_evidence SET verification_status='rejected' WHERE id='${EV_PHOTO_3}';`,
  update(MEDIA, (await one(`SELECT id FROM public.${MEDIA} WHERE evidence_id='${EV_PHOTO_3}'`)).id, { label: 'Rejected later' }),
  update(MEDIA, (await one(`SELECT id FROM public.${MEDIA} WHERE evidence_id='${EV_PHOTO_3}'`)).id, { deleted_at: raw('now()') }),
].join('\n'));
await refuses('a reference cannot be re-pointed at a different asset', update(MEDIA, (await one(`SELECT id FROM public.${MEDIA} WHERE evidence_id='${EV_PHOTO}'`)).id, { evidence_id: EV_PHOTO_2 }), /immutable/i);
await check('deleting the evidence removes its reference (the presentation cannot outlive the asset)', async () => {
  await db.exec(`DELETE FROM public.vehicle_evidence WHERE id='${EV_PHOTO}'`);
  const r = await one(`SELECT count(*)::int AS n FROM public.${MEDIA} WHERE evidence_id='${EV_PHOTO}'`);
  if (r.n !== 0) throw new Error('an orphaned reference remains');
});
await check('STRUCTURE: nothing on a media reference can make an image public', async () => {
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${MEDIA}'`)).rows.map((r) => r.column_name);
  const bad = cols.filter((c) => /(public|publish|visib|url|path|bucket|storage|signed)/.test(c));
  if (bad.length) throw new Error(`a reference can carry a locator or a publication switch: ${bad.join(', ')}`);
});

// ═══════════════════════════ PROVENANCE RULES, EVERY TABLE ═══════════════════════════
// The same provenance block sits on four tables. A rule that only one table's tests exercise is a rule the other three
// can lose without anyone noticing, so each rule is tried on each table.

const long = (n) => 'x'.repeat(n);
const VARIANTS = [
  // [label, override, constraint suffix]
  ['a blank source system', { source_system: '   ' }, 'source_system_chk'],
  ['a blank source reference', { source_reference: '   ' }, 'source_reference_chk'],
  ['an over-long source reference', { source_reference: long(501) }, 'source_reference_chk'],
  ['a malformed evidence digest', { evidence_digest: 'xyz' }, 'evidence_digest_chk'],
];
const asNonExternal = { origin: 'OWNER_DECLARED' };   // isolates the rule under test from the external-provenance rule
const cases = [
  ['progress entry', LEDGER, (o) => entry({ ...o }), 'diaspora_external_progress', {},
    [['a blank evidence reference', { evidence_ref: '   ' }, 'evidence_ref_chk'], ['an over-long evidence reference', { evidence_ref: long(501) }, 'evidence_ref_chk'],
     ['an over-long source position', { source_position: long(201) }, 'source_position_chk'], ['an unknown verification state', { verification_status: 'TRUSTED' }, 'verification_chk']]],
  ['party', PARTIES, (o) => party({ party_role: 'NOTIFY_PARTY', import_order_id: ORDER_B, ...o }), 'diaspora_order_parties', asNonExternal,
    [['a blank evidence reference', { evidence_ref: '   ' }, 'evidence_ref_chk'], ['an over-long evidence reference', { evidence_ref: long(501) }, 'evidence_ref_chk'],
     ['an over-long source position', { source_position: long(201) }, 'source_position_chk'], ['an unknown verification state', { verification_status: 'TRUSTED' }, 'verification_chk'],
     ['an over-long address line', { address_line: long(401) }, 'address_chk'], ['an over-long city', { city: long(121) }, 'address_chk'], ['an over-long country', { country: long(121) }, 'address_chk']]],
  ['dispatch', DISPATCHES, (o) => dispatch({ ...o }), 'diaspora_document_dispatches', asNonExternal,
    [['a blank evidence reference', { evidence_ref: '   ' }, 'evidence_ref_chk'], ['an over-long evidence reference', { evidence_ref: long(501) }, 'evidence_ref_chk'],
     ['an over-long source position', { source_position: long(201) }, 'source_position_chk'], ['an unknown verification state', { verification_status: 'TRUSTED' }, 'verification_chk'],
     ['an unknown origin', { origin: 'GUESSED' }, 'origin_chk'], ['a blank courier', { courier_name: '  ' }, 'courier_chk'], ['an over-long courier', { courier_name: long(121) }, 'courier_chk'],
     ['an over-long reported status', { status_reported_text: long(301) }, 'text_chk'], ['an over-long message', { message_text: long(2001) }, 'text_chk']]],
  ['specification', SPECS, (o) => spec({ vin: VIN_C, spec_key: 'FUEL_DETAIL', value_text: 'Hybrid', ...o }), 'vehicle_spec_obs', asNonExternal,
    [['a blank evidence reference', { evidence_ref: '   ' }, 'evidence_ref_chk'], ['an over-long evidence reference', { evidence_ref: long(501) }, 'evidence_ref_chk'],
     ['an over-long source position', { source_position: long(201) }, 'source_position_chk'], ['an unknown verification state', { verification_status: 'TRUSTED' }, 'verification_chk'],
     ['an unknown origin', { origin: 'GUESSED' }, 'origin_chk'], ['an over-long raw source value', { source_value_raw: long(501) }, 'raw_chk']]],
];
for (const [what, table, build, prefix, base, extra] of cases) {
  for (const [label, override, suffix] of [...VARIANTS, ...extra]) {
    // 'origin' variants must NOT be forced to a valid origin by `base`
    await refuses(`${what}: ${label} is refused`, insert(table, build({ ...base, ...override })), new RegExp(`${prefix}_${suffix}`));
  }
}
// media references carry the same block minus evidence (the evidence IS the asset)
for (const [label, override, suffix] of [
  ['a blank source system', { source_system: '   ' }, 'source_system_chk'], ['a blank source reference', { source_reference: '   ' }, 'source_reference_chk'],
  ['an over-long source reference', { source_reference: long(501) }, 'source_reference_chk'], ['a source position below 1', { source_position: 0 }, 'source_position_chk'],
  ['a blank label', { label: '  ' }, 'label_chk'], ['an over-long label', { label: long(121) }, 'label_chk'],
]) {
  await refuses(`media reference: ${label} is refused`, insert(MEDIA, media(EV_PHOTO_4, { gallery_position: 70, ...override })), new RegExp(`vehicle_media_ref_${suffix}`));
}
// The external-provenance rule is "source reference AND evidence AND digest" — each leg alone must be enforced.
for (const [what, table, build, prefix] of [
  ['party', PARTIES, (o) => party({ party_role: 'NOTIFY_PARTY', import_order_id: ORDER_B, ...o }), 'diaspora_order_parties'],
  ['dispatch', DISPATCHES, (o) => dispatch({ ...o }), 'diaspora_document_dispatches'],
  ['specification', SPECS, (o) => spec({ vin: VIN_C, spec_key: 'FUEL_DETAIL', value_text: 'Hybrid', ...o }), 'vehicle_spec_obs'],
]) {
  await refuses(`${what}: an external report with evidence and digest but NO source reference is refused`, insert(table, build({ source_reference: null })), new RegExp(`${prefix}_external_provenance_chk`));
  await refuses(`${what}: an external report with a digest but NO evidence reference is refused`, insert(table, build({ evidence_ref: null })), new RegExp(`${prefix}_external_provenance_chk`));
  await refuses(`${what}: an external report with an evidence reference but NO digest is refused`, insert(table, build({ evidence_digest: null })), new RegExp(`${prefix}_external_provenance_chk`));
}
await refuses('dispatch: a dispatch cannot be dated after the status that reports it', insert(DISPATCHES, dispatch({ dispatched_at: raw("(now() - interval '1 hour')"), status_observed_at: raw("(now() - interval '2 hours')"), dispatch_status: 'IN_TRANSIT', status_reported_text: null })), /times_chk/);

// ═══════════════════════════ REMOVING A USER OR TENANT ═══════════════════════════

const owned = entry({ stage_code: 'DEPARTURE', tenant_id: TENANT_X, created_by: 'operator-3', updated_by: 'operator-3' });
await db.exec(insert(LEDGER, owned));
await check('POSITIVE CONTROL: removing the user and tenant behind a recorded fact NULLS the attribution and leaves the fact untouched', async () => {
  await db.exec(`DELETE FROM public.users WHERE id='operator-3'; DELETE FROM public.tenants WHERE id='${TENANT_X}';`);
  const r = await one(`SELECT created_by, updated_by, tenant_id, action_text, reported_status FROM public.${LEDGER} WHERE id='${owned.id}'`);
  if (r.created_by !== null || r.updated_by !== null || r.tenant_id !== null) throw new Error('attribution was not nulled');
  if (r.action_text !== owned.action_text || r.reported_status !== 'COMPLETED') throw new Error('the fact itself moved');
});
await refuses('…but attribution still cannot be REWRITTEN to someone else', update(LEDGER, owned.id, { created_by: 'operator-1' }), /immutable/i);

// ═══════════════════════════ ACCESS + REVERSAL ═══════════════════════════

await check('ACCESS: the browser can reach none of the five tables', async () => {
  for (const t of NEW_TABLES) {
    const rls = await one(`SELECT relrowsecurity AS r, relforcerowsecurity AS f FROM pg_class WHERE relname='${t}'`);
    if (!rls.r || !rls.f) throw new Error(`${t}: not FORCE RLS`);
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const g = await one(`SELECT has_table_privilege('${role}', 'public.${t}', '${priv}') AS ok`);
        if (g.ok) throw new Error(`${role} holds ${priv} on ${t}`);
      }
    }
  }
});
await check('every recorded-fact table is guarded against UPDATE and DELETE; media references against UPDATE and a bad INSERT', async () => {
  const r = await db.query(`SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname = ANY($1) ORDER BY 1, 2`, [NEW_TABLES]);
  const have = new Set(r.rows.map((x) => `${x.relname}:${x.tgname}`));
  for (const want of [
    `${LEDGER}:trg_external_progress_guard`, `${LEDGER}:trg_external_progress_no_delete`, `${PARTIES}:trg_order_party_guard`, `${PARTIES}:trg_order_party_no_delete`,
    `${DISPATCHES}:trg_document_dispatch_guard`, `${DISPATCHES}:trg_document_dispatch_no_delete`, `${SPECS}:trg_vehicle_spec_obs_guard`, `${SPECS}:trg_vehicle_spec_obs_no_delete`,
    `${MEDIA}:trg_vehicle_media_ref_guard`, `${MEDIA}:trg_vehicle_media_ref_validate`,
  ]) if (!have.has(want)) throw new Error(`missing trigger ${want}`);
});

await check('Down removes the five tables and both shared guards, and touches nothing it did not create', async () => {
  await db.exec(down);
  for (const t of NEW_TABLES) {
    const gone = await one(`SELECT to_regclass('public.${t}') AS t`);
    if (gone.t) throw new Error(`${t} still exists after Down`);
  }
  const fns = await db.query(`SELECT proname FROM pg_proc WHERE proname LIKE 'carup_cap_recorded_fact%' OR proname = 'carup_vehicle_media_reference_check'`);
  if (fns.rows.length) throw new Error(`functions remain: ${fns.rows.map((x) => x.proname).join(', ')}`);
  if (JSON.stringify(await snapshotExisting()) !== beforeColumns) throw new Error('Down altered an existing table');
  const keep = await one(`SELECT (SELECT count(*) FROM public.vehicles)::int AS v, (SELECT count(*) FROM public.diaspora_import_orders)::int AS o, (SELECT count(*) FROM public.vehicle_evidence)::int AS e`);
  if (keep.v !== 3 || keep.o !== 2) throw new Error('Down removed rows it did not own');
});
await check('the migration can be re-applied after Down (a clean round trip)', async () => { await db.exec(up); });

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 }, null, 2));
await db.close();
process.exit(failed.length ? 1 : 0);
