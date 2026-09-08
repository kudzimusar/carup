/**
 * Trade OS T9.1 — the warehouse authority, on a REAL Postgres (PGlite).
 *
 * The boundary under test is ESTIMATED vs ACTUAL, and the rule that a receipt is an authorized act
 * rather than a side effect. Every constraint is exercised by trying to break it.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20260911090000_trade_os_t9_warehouse_intake.sql', import.meta.url), 'utf-8');
const up = sql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = sql.split('-- +migrate Down')[1];

// T9.5 — intake evidence rides the frozen T8 binding rather than a store of its own.
const evidenceSql = readFileSync(new URL('../migrations/20260912090000_trade_os_t9_intake_evidence_binding.sql', import.meta.url), 'utf-8');
const evidenceUp = evidenceSql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const evidenceDown = evidenceSql.split('-- +migrate Down')[1];

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

// Stand-ins for what already exists, INCLUDING the estimate this migration must never touch.
// The Supabase roles exist in every real environment this migration runs in; PGlite has no notion
// of them, so they are created here rather than weakening the REVOKE in the migration itself.
await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE TABLE public.users (id text PRIMARY KEY);
  INSERT INTO public.users (id) VALUES ('staff-1'), ('customer-1');
  CREATE TABLE public.diaspora_cargo_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    estimated_volume numeric(12,3) NULL,
    estimated_weight numeric(12,3) NULL
  );
  INSERT INTO public.diaspora_cargo_reservations (id, estimated_volume, estimated_weight)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 3.000, 500.000);
`);

await check('the migration applies', async () => { await db.exec(up); });

await check('a warehouse can be created', async () => {
  await db.exec(`INSERT INTO public.diaspora_warehouses (id, name, country, city, operator_user_id)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001','Harare Receiving','Zimbabwe','Harare','staff-1');`);
});

await check('an EXPECTED intake needs no receiver — nothing has arrived yet', async () => {
  await db.exec(`INSERT INTO public.diaspora_warehouse_intakes (id, warehouse_id, subject_type, subject_id, reference)
    VALUES ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cargo_reservation','aaaaaaaa-0000-0000-0000-000000000001','INT-0001');`);
});

await refuses('RECEIVED without a receiver or a time is refused — that is not a receipt',
  `UPDATE public.diaspora_warehouse_intakes SET status='RECEIVED' WHERE id='cccccccc-0000-0000-0000-000000000001';`,
  /intake_receipt_is_attributed/);

await check('a properly attributed receipt is accepted', async () => {
  await db.exec(`UPDATE public.diaspora_warehouse_intakes
    SET status='RECEIVED', received_by='staff-1', received_at=now(), condition='good', observed_package_count=1
    WHERE id='cccccccc-0000-0000-0000-000000000001';`);
});

await refuses('a REFUSAL without a reason is refused',
  `INSERT INTO public.diaspora_warehouse_intakes (warehouse_id, subject_type, subject_id, reference, status, received_by, received_at)
   VALUES ('bbbbbbbb-0000-0000-0000-000000000001','logistics_request','req-9','INT-0009','REFUSED','staff-1',now());`,
  /intake_exception_has_reason/);

await refuses('a second live intake for the same cargo is refused — a re-receipt is a correction',
  `INSERT INTO public.diaspora_warehouse_intakes (warehouse_id, subject_type, subject_id, reference)
   VALUES ('bbbbbbbb-0000-0000-0000-000000000001','cargo_reservation','aaaaaaaa-0000-0000-0000-000000000001','INT-0002');`,
  /uq_warehouse_intake_subject|duplicate key/);

await refuses('an invented intake subject is refused — no shadow anchor',
  `INSERT INTO public.diaspora_warehouse_intakes (warehouse_id, subject_type, subject_id, reference)
   VALUES ('bbbbbbbb-0000-0000-0000-000000000001','warehouse_receipt','x','INT-X');`,
  /subject_type/);

await refuses('T9 cannot record a LOADED or DEPARTED state — there is no column for it',
  `UPDATE public.diaspora_warehouse_intakes SET status='LOADED' WHERE id='cccccccc-0000-0000-0000-000000000001';`,
  /status/);

await refuses('a condition the receiver did not observe is refused',
  `UPDATE public.diaspora_warehouse_intakes SET condition='probably_fine' WHERE id='cccccccc-0000-0000-0000-000000000001';`,
  /condition/);

// ── measurement ─────────────────────────────────────────────────────────
await check('an actual measurement is recorded with its units and its author', async () => {
  await db.exec(`INSERT INTO public.diaspora_warehouse_measurements
    (intake_id, length_value, width_value, height_value, dimension_unit, weight_value, weight_unit, package_count, actual_volume_cbm, measured_by, method)
    VALUES ('cccccccc-0000-0000-0000-000000000001', 200, 100, 190, 'cm', 620, 'kg', 1, 3.800, 'staff-1', 'manual');`);
});

await refuses('two of three sides is not a box',
  `INSERT INTO public.diaspora_warehouse_measurements (intake_id, length_value, width_value, dimension_unit)
   VALUES ('cccccccc-0000-0000-0000-000000000001', 200, 100, 'cm');`,
  /measurement_dimensions_complete/);

await refuses('a weight without its unit is refused',
  `INSERT INTO public.diaspora_warehouse_measurements (intake_id, weight_value)
   VALUES ('cccccccc-0000-0000-0000-000000000001', 620);`,
  /measurement_weight_has_unit/);

await refuses('a measurement that measured nothing is refused',
  `INSERT INTO public.diaspora_warehouse_measurements (intake_id, notes)
   VALUES ('cccccccc-0000-0000-0000-000000000001', 'had a look');`,
  /measurement_observes_something/);

await refuses('a negative dimension is refused',
  `INSERT INTO public.diaspora_warehouse_measurements (intake_id, length_value, width_value, height_value, dimension_unit)
   VALUES ('cccccccc-0000-0000-0000-000000000001', -5, 100, 190, 'cm');`,
  /length_value/);

// ── THE boundary ────────────────────────────────────────────────────────
await check('THE ESTIMATE IS UNTOUCHED — the customer said 3.0 CBM and still does', async () => {
  const r = await db.query(`SELECT estimated_volume, estimated_weight FROM public.diaspora_cargo_reservations WHERE id='aaaaaaaa-0000-0000-0000-000000000001';`);
  if (Number(r.rows[0].estimated_volume) !== 3) throw new Error(`estimate became ${r.rows[0].estimated_volume}`);
  if (Number(r.rows[0].estimated_weight) !== 500) throw new Error(`weight estimate became ${r.rows[0].estimated_weight}`);
});

await check('the discrepancy is DERIVABLE, and both numbers survive', async () => {
  const r = await db.query(`
    SELECT res.estimated_volume AS estimated, m.actual_volume_cbm AS actual,
           (m.actual_volume_cbm - res.estimated_volume) AS difference
    FROM public.diaspora_warehouse_measurements m
    JOIN public.diaspora_warehouse_intakes i ON i.id = m.intake_id
    JOIN public.diaspora_cargo_reservations res ON res.id::text = i.subject_id
    WHERE m.intake_id = 'cccccccc-0000-0000-0000-000000000001';`);
  const row = r.rows[0];
  if (Number(row.estimated) !== 3) throw new Error('estimate lost');
  if (Number(row.actual) !== 3.8) throw new Error('actual lost');
  if (Math.abs(Number(row.difference) - 0.8) > 0.001) throw new Error(`difference ${row.difference}`);
});

await check('the T5 capacity ledger is not touched by this migration at all', async () => {
  if (/diaspora_container_shipments/.test(up)) throw new Error('the migration references the frozen capacity ledger');
  if (/UPDATE\s+public\.diaspora_cargo_reservations/i.test(up)) throw new Error('the migration writes the estimate');
});

await check('all three tables are ENABLE + FORCE RLS with no anon/authenticated grants', async () => {
  const r = await db.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname IN ('diaspora_warehouses','diaspora_warehouse_intakes','diaspora_warehouse_measurements');`);
  for (const row of r.rows) {
    if (!row.relrowsecurity || !row.relforcerowsecurity) throw new Error(`${row.relname} is not FORCE RLS`);
  }
  if (r.rows.length !== 3) throw new Error(`expected 3 tables, saw ${r.rows.length}`);
  // The row that decides whether somebody's cargo was received must not be reachable from a browser.
  const g = await db.query(`SELECT has_table_privilege('anon','public.diaspora_warehouse_intakes','SELECT') AS anon_sel,
                                   has_table_privilege('authenticated','public.diaspora_warehouse_intakes','INSERT') AS auth_ins;`);
  if (g.rows[0].anon_sel || g.rows[0].auth_ins) throw new Error('anon/authenticated still hold privileges');
});

// ── T9.5 — evidence goes through T8, and T8's rules survive the extension ──
//
// The whole point of adding one value to a governed vocabulary rather than creating
// `warehouse_photos` is that everything T8 enforces keeps applying. So the gate proves the
// vocabulary really is still bounded, and that the T8 constraints a warehouse photo has to obey are
// the same ones a commercial invoice obeys.
await check('a T8-shaped documents table exists to extend', async () => {
  await db.exec(`
    CREATE TABLE public.diaspora_trade_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      import_order_id uuid NULL,
      subject_type text NULL,
      subject_id text NULL,
      verification_status text NOT NULL DEFAULT 'UPLOADED',
      CONSTRAINT trade_document_subject_pairing CHECK (
        (subject_type IS NULL AND subject_id IS NULL)
        OR (subject_type IS NOT NULL AND subject_id IS NOT NULL AND length(btrim(subject_id)) > 0)
      ),
      CONSTRAINT trade_document_exactly_one_owner CHECK (num_nonnulls(import_order_id, subject_type) = 1),
      CONSTRAINT trade_document_subject_vocabulary CHECK (
        subject_type IS NULL OR subject_type IN ('import_order','logistics_request','container_booking','trade_order')
      )
    );`);
});

await refuses('BEFORE the extension, an intake photo has nowhere to live — which is why T9.5 exists',
  `INSERT INTO public.diaspora_trade_documents (subject_type, subject_id) VALUES ('warehouse_intake','cccccccc-0000-0000-0000-000000000001');`,
  /trade_document_subject_vocabulary/);

await check('the evidence-binding migration applies', async () => { await db.exec(evidenceUp); });

await check('AFTER it, an intake photo is an ordinary T8 document', async () => {
  await db.exec(`INSERT INTO public.diaspora_trade_documents (subject_type, subject_id)
    VALUES ('warehouse_intake','cccccccc-0000-0000-0000-000000000001');`);
  const r = await db.query(`SELECT verification_status FROM public.diaspora_trade_documents WHERE subject_type='warehouse_intake';`);
  // Presence is not verification — T8's rule, inherited whole rather than re-implemented.
  if (r.rows[0].verification_status !== 'UPLOADED') throw new Error('an uploaded photo arrived with a verdict');
});

await check('T9 created no evidence table of its own', async () => {
  if (/CREATE\s+TABLE/i.test(evidenceUp)) throw new Error('the evidence migration created a table');
  const r = await db.query(`SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_name IN ('warehouse_photos','warehouse_files','diaspora_warehouse_documents','diaspora_warehouse_evidence');`);
  if (r.rows[0].n !== 0) throw new Error('a second evidence store exists');
});

await refuses('the vocabulary is still BOUNDED — a free-text subject is still refused',
  `INSERT INTO public.diaspora_trade_documents (subject_type, subject_id) VALUES ('whatever_i_like','x');`,
  /trade_document_subject_vocabulary/);

await refuses('a document still cannot belong to two things at once',
  `INSERT INTO public.diaspora_trade_documents (import_order_id, subject_type, subject_id)
     VALUES ('aaaaaaaa-0000-0000-0000-000000000009','warehouse_intake','cccccccc-0000-0000-0000-000000000001');`,
  /trade_document_exactly_one_owner/);

await check('the frozen T8 subjects still work after the extension', async () => {
  for (const s of ['import_order', 'logistics_request', 'container_booking', 'trade_order']) {
    await db.exec(`INSERT INTO public.diaspora_trade_documents (subject_type, subject_id) VALUES ('${s}','subj-${s}');`);
  }
});

await check('the evidence binding is reversible, and reverts to exactly the frozen T8 vocabulary', async () => {
  await db.exec(`DELETE FROM public.diaspora_trade_documents WHERE subject_type='warehouse_intake';`);
  await db.exec(evidenceDown);
  let threw = null;
  try {
    await db.exec(`INSERT INTO public.diaspora_trade_documents (subject_type, subject_id) VALUES ('warehouse_intake','x');`);
  } catch (e) { threw = e; }
  if (!threw) throw new Error('warehouse_intake is still accepted after Down');
  await db.exec(`DROP TABLE public.diaspora_trade_documents;`);
});

await check('Down is reversible', async () => {
  await db.exec(down);
  const r = await db.query(`SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_name IN ('diaspora_warehouses','diaspora_warehouse_intakes','diaspora_warehouse_measurements');`);
  if (r.rows[0].n !== 0) throw new Error('tables not dropped');
  const est = await db.query(`SELECT estimated_volume FROM public.diaspora_cargo_reservations;`);
  if (Number(est.rows[0].estimated_volume) !== 3) throw new Error('the estimate did not survive Down');
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 }, null, 2));
await db.close();
process.exit(failed.length ? 1 : 0);
