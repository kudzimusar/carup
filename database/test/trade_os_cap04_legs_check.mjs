/**
 * Trade OS T11-CAP-04 — shipment legs, on a REAL Postgres (PGlite).
 *
 * A leg is a *declared* fact about a vessel and a route: which carrier, which vessel, which voyage,
 * load port to discharge port, a planned departure and an estimated arrival. It is deliberately NOT a
 * record that anything sailed. Movement stays T11's alone — the shipment's observed departure and
 * arrival, and its append-only timeline — and a second place to assert "it sailed" would be a second
 * lifecycle that could disagree with the first.
 *
 * So the strongest check here is structural: the table has no column that could say a vessel left or
 * arrived. The rest tries to break the table's rules and proves the correction path still works.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20260920090000_trade_os_cap04_shipment_legs.sql', import.meta.url), 'utf-8');
const up = sql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = sql.split('-- +migrate Down')[1];

const db = new PGlite();
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); }
};
const refuses = async (name, stmt, pattern) => check(name, async () => {
  let threw = null;
  try { await db.exec(stmt); } catch (e) { threw = e; }
  if (!threw) throw new Error('the database ACCEPTED what it must refuse');
  if (pattern && !pattern.test(threw.message)) throw new Error(`refused for the wrong reason: ${threw.message.split('\n')[0]}`);
});

const SHIPMENT = 'aaaa0000-0000-0000-0000-000000000001';
const OTHER_SHIPMENT = 'aaaa0000-0000-0000-0000-000000000002';
const LEG = 'cccc0000-0000-0000-0000-000000000001';

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  -- Supabase grants every new public table to these roles by default. A bare Postgres does not, so
  -- without this the REVOKE in the migration would be untestable: removing it would change nothing.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  CREATE TABLE public.users (id text PRIMARY KEY);
  INSERT INTO public.users (id) VALUES ('operator-1'), ('operator-2');
  CREATE TABLE public.tenants (id uuid PRIMARY KEY);
  CREATE TABLE public.diaspora_shipments (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'PLANNED',
    departure_date timestamptz NULL, actual_arrival_date timestamptz NULL);
  INSERT INTO public.diaspora_shipments (id) VALUES ('${SHIPMENT}'), ('${OTHER_SHIPMENT}');
`);

await check('the migration applies', async () => { await db.exec(up); });

// ── Structure: nothing here can assert a sailing ───────────────────────────

await check('STRUCTURE: the table has no column that could assert a departure, an arrival or a status', async () => {
  const r = await db.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='diaspora_shipment_legs' ORDER BY ordinal_position;`);
  const cols = r.rows.map((x) => x.column_name);
  const forbidden = cols.filter((c) => /^(observed|actual|departed|arrived|status|verified)/.test(c) || /(_observed|_actual)(_|$)/.test(c));
  if (forbidden.length) throw new Error(`a leg can assert movement through: ${forbidden.join(', ')}`);
  for (const must of ['shipment_id', 'leg_sequence', 'vessel_name', 'voyage_ref', 'imo', 'mmsi', 'port_of_loading', 'port_of_discharge', 'planned_departure_date', 'estimated_arrival_date', 'source']) {
    if (!cols.includes(must)) throw new Error(`missing column ${must}`);
  }
});

// ── A valid leg ────────────────────────────────────────────────────────────

await check('a single-vessel journey is one leg', async () => {
  await db.exec(`INSERT INTO public.diaspora_shipment_legs
    (id, shipment_id, leg_sequence, carrier_name, vessel_name, voyage_ref, imo, port_of_loading, port_of_discharge,
     planned_departure_date, estimated_arrival_date, created_by)
    VALUES ('${LEG}', '${SHIPMENT}', 1, 'Sample Carrier', 'SAMPLE VESSEL', 'V-1', '9074729', 'Port A', 'Port B',
            '2026-08-29', '2026-09-18', 'operator-1');`);
  const r = await db.query(`SELECT source FROM public.diaspora_shipment_legs WHERE id='${LEG}';`);
  if (r.rows[0].source !== 'OPERATOR_DECLARED') throw new Error('the default source is not an honest "operator declared"');
});

await check('a second leg for the same shipment (transshipment) is representable', async () => {
  await db.exec(`INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name, port_of_loading, port_of_discharge, created_by)
    VALUES ('${SHIPMENT}', 2, 'SECOND VESSEL', 'Port B', 'Port C', 'operator-1');`);
});

// ── A leg must say something true-shaped ─────────────────────────────────

await refuses('a leg that identifies nothing is not a leg',
  `INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence) VALUES ('${OTHER_SHIPMENT}', 1);`, /legs_identify|check/i);

await refuses('an IMO number must be exactly seven digits',
  `INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name, imo) VALUES ('${OTHER_SHIPMENT}', 1, 'V', '12345');`, /imo|check/i);

await refuses('an IMO number cannot contain letters',
  `INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name, imo) VALUES ('${OTHER_SHIPMENT}', 1, 'V', 'IMO9074729');`, /imo|check/i);

await refuses('an MMSI must be exactly nine digits',
  `INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name, mmsi) VALUES ('${OTHER_SHIPMENT}', 1, 'V', '1234');`, /mmsi|check/i);

await refuses('the source must be a known kind of source',
  `INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name, source) VALUES ('${OTHER_SHIPMENT}', 1, 'V', 'GUESSED');`, /source|check/i);

await refuses('a leg sequence starts at 1',
  `INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name) VALUES ('${OTHER_SHIPMENT}', 0, 'V');`, /sequence|check/i);

await refuses('two live legs cannot share a position in one journey',
  `INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name) VALUES ('${SHIPMENT}', 1, 'DUPLICATE');`, /uq_|unique|duplicate/i);

await refuses('a leg cannot belong to a shipment that does not exist',
  `INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name) VALUES ('aaaa0000-0000-0000-0000-0000000000ff', 1, 'V');`, /foreign key|violates/i);

// ── What cannot be rewritten ───────────────────────────────────────────────

await refuses('a leg cannot be moved to another journey',
  `UPDATE public.diaspora_shipment_legs SET shipment_id='${OTHER_SHIPMENT}' WHERE id='${LEG}';`, /journey|cannot be rewritten|immutable/i);

await refuses('a leg cannot be re-ordered — supersede it instead',
  `UPDATE public.diaspora_shipment_legs SET leg_sequence=5 WHERE id='${LEG}';`, /journey|cannot be rewritten|immutable|re-order/i);

await refuses('who declared a leg cannot be rewritten',
  `UPDATE public.diaspora_shipment_legs SET created_by='operator-2' WHERE id='${LEG}';`, /cannot be rewritten|immutable/i);

await refuses('when a leg was declared cannot be rewritten',
  `UPDATE public.diaspora_shipment_legs SET created_at = now() - interval '30 days' WHERE id='${LEG}';`, /cannot be rewritten|immutable/i);

await refuses('a leg cannot be DELETED — supersede it',
  `DELETE FROM public.diaspora_shipment_legs WHERE id='${LEG}';`, /cannot be deleted/i);

await refuses('the whole table cannot be emptied either',
  `DELETE FROM public.diaspora_shipment_legs;`, /cannot be deleted/i);

// ── …but corrections still work ────────────────────────────────────────────

await check('POSITIVE CONTROL: a vessel name and an estimate can be corrected', async () => {
  await db.exec(`UPDATE public.diaspora_shipment_legs SET vessel_name='SAMPLE VESSEL (CORRECTED)',
    estimated_arrival_date='2026-09-20', updated_by='operator-2', updated_at=now() WHERE id='${LEG}';`);
  const r = await db.query(`SELECT vessel_name, created_by, updated_by FROM public.diaspora_shipment_legs WHERE id='${LEG}';`);
  if (!/CORRECTED/.test(r.rows[0].vessel_name)) throw new Error('the correction did not apply');
  if (r.rows[0].created_by !== 'operator-1' || r.rows[0].updated_by !== 'operator-2') throw new Error('attribution was lost');
});

await check('POSITIVE CONTROL: a leg can be superseded, and its position reused by a replacement', async () => {
  await db.exec(`UPDATE public.diaspora_shipment_legs SET deleted_at = now(), updated_by='operator-2' WHERE id='${LEG}';`);
  await db.exec(`INSERT INTO public.diaspora_shipment_legs (shipment_id, leg_sequence, vessel_name, created_by)
    VALUES ('${SHIPMENT}', 1, 'REPLACEMENT VESSEL', 'operator-2');`);
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_shipment_legs WHERE shipment_id='${SHIPMENT}' AND leg_sequence=1;`);
  if (r.rows[0].n !== 2) throw new Error('the superseded leg was erased instead of kept');
});

await check('a leg never changes the shipment it describes', async () => {
  const r = await db.query(`SELECT status, departure_date, actual_arrival_date FROM public.diaspora_shipments WHERE id='${SHIPMENT}';`);
  if (r.rows[0].status !== 'PLANNED' || r.rows[0].departure_date || r.rows[0].actual_arrival_date) {
    throw new Error('declaring legs moved the shipment');
  }
});

// ── Governed access ────────────────────────────────────────────────────────

await check('the browser cannot reach the table at all', async () => {
  const r = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='diaspora_shipment_legs';`);
  if (!r.rows[0].relrowsecurity || !r.rows[0].relforcerowsecurity) throw new Error('not FORCE RLS');
  const g = await db.query(`SELECT has_table_privilege('anon','public.diaspora_shipment_legs','SELECT') AS a,
                                   has_table_privilege('authenticated','public.diaspora_shipment_legs','INSERT') AS b,
                                   has_table_privilege('authenticated','public.diaspora_shipment_legs','UPDATE') AS c;`);
  if (g.rows[0].a || g.rows[0].b || g.rows[0].c) throw new Error('anon/authenticated still hold privileges');
});

await check('Down removes the table and leaves the shipments it described untouched', async () => {
  await db.exec(down);
  const gone = await db.query(`SELECT to_regclass('public.diaspora_shipment_legs') AS t;`);
  if (gone.rows[0].t) throw new Error('the table is still there after Down');
  const ship = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_shipments;`);
  if (ship.rows[0].n !== 2) throw new Error('Down touched the shipments');
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 }, null, 2));
await db.close();
process.exit(failed.length ? 1 : 0);
