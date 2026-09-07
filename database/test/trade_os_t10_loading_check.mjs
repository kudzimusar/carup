/**
 * Trade OS T10.1 — the consolidation and loading authority, on a REAL Postgres (PGlite).
 *
 * Three things are under test, and every constraint is exercised by trying to break it:
 *
 *   1. a PLAN is not a LOADED FACT — the schema keeps them apart and neither can impersonate
 *      the other;
 *   2. loading is an ATTRIBUTED ACT — "loaded, by nobody, at no time" is refused;
 *   3. the T11 FIREWALL — there is no column anywhere here that can say departed, shipped, in
 *      transit, arrived or customs-cleared.
 *
 * Plus the three-measurement invariant: booked 3.0 (T5), warehouse-actual 3.8 (T9) and
 * loaded-actual 3.6 (T10) must ALL survive together, because each is a true statement about a
 * different moment and collapsing any pair destroys the only record of the difference.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20260913090000_trade_os_t10_consolidation_loading.sql', import.meta.url), 'utf-8');
const up = sql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
// The firewall checks below scan for REFERENCES to other phases' tables. The header comment names
// them deliberately — that is the audit finding written down — so comments are stripped first.
// Without this the gate fails on its own documentation, which teaches the next person to delete the
// explanation rather than the reference.
const upCode = up.replace(/^\s*--.*$/gm, '');
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

const CONTAINER = 'dddddddd-0000-0000-0000-000000000001';
const PLAN = 'eeeeeeee-0000-0000-0000-000000000001';
const LOAD = 'ffffffff-0000-0000-0000-000000000001';
const RES_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const RES_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const INTAKE = 'cccccccc-0000-0000-0000-000000000001';

// Stand-ins for what already exists, INCLUDING both earlier measurements this migration must never
// touch: T5's booked estimate and T9's warehouse actual.
await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE TABLE public.users (id text PRIMARY KEY);
  INSERT INTO public.users (id) VALUES ('loader-1'), ('planner-1'), ('customer-1');

  CREATE TABLE public.diaspora_container_shipments (
    id uuid PRIMARY KEY,
    total_capacity_volume numeric(12,3) NOT NULL,
    used_capacity_volume numeric(12,3) NOT NULL,
    available_capacity_volume numeric(12,3) NOT NULL,
    status text NOT NULL
  );
  INSERT INTO public.diaspora_container_shipments VALUES ('${CONTAINER}', 33.000, 4.500, 28.500, 'BOOKING_CLOSED');

  CREATE TABLE public.diaspora_cargo_reservations (
    id uuid PRIMARY KEY,
    estimated_volume numeric(12,3) NULL
  );
  INSERT INTO public.diaspora_cargo_reservations VALUES ('${RES_A}', 3.000), ('${RES_B}', 1.500);

  CREATE TABLE public.diaspora_warehouse_intakes (
    id uuid PRIMARY KEY,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    status text NOT NULL
  );
  INSERT INTO public.diaspora_warehouse_intakes VALUES ('${INTAKE}', 'cargo_reservation', '${RES_A}', 'RECEIVED');

  CREATE TABLE public.diaspora_warehouse_measurements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_id uuid NOT NULL,
    actual_volume_cbm numeric(12,3) NULL
  );
  INSERT INTO public.diaspora_warehouse_measurements (intake_id, actual_volume_cbm) VALUES ('${INTAKE}', 3.800);
`);

await check('the migration applies', async () => { await db.exec(up); });

// ── The plan ──────────────────────────────────────────────────────────────

await check('a DRAFT plan needs no confirmation — nobody has committed to it yet', async () => {
  await db.exec(`INSERT INTO public.diaspora_container_load_plans (id, container_id, reference, planned_by)
    VALUES ('${PLAN}', '${CONTAINER}', 'LPLN-0001', 'planner-1');`);
});

await refuses('a CONFIRMED plan without a confirmer or a time is refused',
  `UPDATE public.diaspora_container_load_plans SET status='CONFIRMED' WHERE id='${PLAN}';`,
  /load_plan_confirmation_is_attributed/);

await check('a properly attributed confirmation is accepted', async () => {
  await db.exec(`UPDATE public.diaspora_container_load_plans
    SET status='CONFIRMED', confirmed_by='planner-1', confirmed_at=now() WHERE id='${PLAN}';`);
});

await refuses('a second live plan for the same container is refused — a revision supersedes',
  `INSERT INTO public.diaspora_container_load_plans (container_id, reference, status)
     VALUES ('${CONTAINER}', 'LPLN-0002', 'DRAFT');`,
  /uq_container_live_load_plan/);

await check('a SUPERSEDED plan frees the slot without being destroyed', async () => {
  await db.exec(`UPDATE public.diaspora_container_load_plans SET status='SUPERSEDED' WHERE id='${PLAN}';`);
  await db.exec(`INSERT INTO public.diaspora_container_load_plans (container_id, reference, status)
    VALUES ('${CONTAINER}', 'LPLN-0002', 'DRAFT');`);
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_container_load_plans WHERE container_id='${CONTAINER}';`);
  if (r.rows[0].n !== 2) throw new Error('the superseded plan was destroyed');
  // Put the first one back in charge for the remaining tests.
  await db.exec(`DELETE FROM public.diaspora_container_load_plans WHERE reference='LPLN-0002';`);
  await db.exec(`UPDATE public.diaspora_container_load_plans SET status='CONFIRMED' WHERE id='${PLAN}';`);
});

await check('a planned-in line records WHICH number it was planned against', async () => {
  await db.exec(`INSERT INTO public.diaspora_container_load_plan_items
    (load_plan_id, subject_type, subject_id, intake_id, disposition, planned_volume_cbm, planned_source)
    VALUES ('${PLAN}', 'cargo_reservation', '${RES_A}', '${INTAKE}', 'PLANNED_IN', 3.800, 'WAREHOUSE_ACTUAL');`);
});

await refuses('a planned figure with no provenance is refused',
  `INSERT INTO public.diaspora_container_load_plan_items
     (load_plan_id, subject_type, subject_id, disposition, planned_volume_cbm)
     VALUES ('${PLAN}', 'cargo_reservation', '${RES_B}', 'PLANNED_IN', 1.500);`,
  /load_plan_figure_has_source/);

await refuses('excluding cargo without saying why is refused',
  `INSERT INTO public.diaspora_container_load_plan_items
     (load_plan_id, subject_type, subject_id, disposition)
     VALUES ('${PLAN}', 'cargo_reservation', '${RES_B}', 'PLANNED_OUT');`,
  /load_plan_exclusion_has_reason/);

await check('an exclusion WITH a bounded reason is accepted', async () => {
  await db.exec(`INSERT INTO public.diaspora_container_load_plan_items
    (load_plan_id, subject_type, subject_id, disposition, exclusion_reason)
    VALUES ('${PLAN}', 'cargo_reservation', '${RES_B}', 'PLANNED_OUT', 'NOT_RECEIVED');`);
});

await refuses('an invented exclusion reason is refused — the vocabulary is bounded',
  `UPDATE public.diaspora_container_load_plan_items SET exclusion_reason='captain did not fancy it'
     WHERE subject_id='${RES_B}';`,
  /exclusion_reason/);

await refuses('the same cargo cannot appear twice on one plan',
  `INSERT INTO public.diaspora_container_load_plan_items
     (load_plan_id, subject_type, subject_id, disposition, exclusion_reason)
     VALUES ('${PLAN}', 'cargo_reservation', '${RES_B}', 'PLANNED_OUT', 'NO_SPACE');`,
  /uq_load_plan_item_subject|exclusion_reason/);

// ── The loaded fact ───────────────────────────────────────────────────────

await check('a load can be opened against the plan', async () => {
  await db.exec(`INSERT INTO public.diaspora_container_loads (id, container_id, load_plan_id, reference)
    VALUES ('${LOAD}', '${CONTAINER}', '${PLAN}', 'LOAD-0001');`);
});

await refuses('a COMPLETED load without a confirmer or a time is refused',
  `UPDATE public.diaspora_container_loads SET status='COMPLETED' WHERE id='${LOAD}';`,
  /load_completion_is_attributed/);

await refuses('abandoning a load without a reason is refused',
  `UPDATE public.diaspora_container_loads SET status='ABANDONED' WHERE id='${LOAD}';`,
  /load_abandonment_has_reason/);

await refuses('a PLANNED item is not a LOADED item — loading needs its own attribution',
  `INSERT INTO public.diaspora_container_load_items (load_id, subject_type, subject_id, outcome, loaded_volume_cbm)
     VALUES ('${LOAD}', 'cargo_reservation', '${RES_A}', 'LOADED', 3.600);`,
  /load_item_loading_is_attributed/);

await check('an attributed loaded line is accepted', async () => {
  await db.exec(`INSERT INTO public.diaspora_container_load_items
    (load_id, subject_type, subject_id, intake_id, outcome, loaded_volume_cbm, loaded_by, loaded_at)
    VALUES ('${LOAD}', 'cargo_reservation', '${RES_A}', '${INTAKE}', 'LOADED', 3.600, 'loader-1', now());`);
});

await refuses('cargo left behind without a reason is refused',
  `INSERT INTO public.diaspora_container_load_items (load_id, subject_type, subject_id, outcome)
     VALUES ('${LOAD}', 'cargo_reservation', '${RES_B}', 'LEFT_BEHIND');`,
  /load_item_left_behind_has_reason/);

await refuses('cargo left behind cannot carry a loaded volume — that would say it went in',
  `INSERT INTO public.diaspora_container_load_items (load_id, subject_type, subject_id, outcome, left_behind_reason, loaded_volume_cbm)
     VALUES ('${LOAD}', 'cargo_reservation', '${RES_B}', 'LEFT_BEHIND', 'NO_SPACE', 1.500);`,
  /load_item_left_behind_has_no_figures/);

await check('left-behind cargo STAYS on the manifest with its reason', async () => {
  await db.exec(`INSERT INTO public.diaspora_container_load_items
    (load_id, subject_type, subject_id, outcome, left_behind_reason)
    VALUES ('${LOAD}', 'cargo_reservation', '${RES_B}', 'LEFT_BEHIND', 'NO_SPACE');`);
  const r = await db.query(`SELECT count(*)::int AS n FROM public.diaspora_container_load_items WHERE load_id='${LOAD}';`);
  if (r.rows[0].n !== 2) throw new Error('the manifest lost a line');
});

await check('a completed load is attributed', async () => {
  await db.exec(`UPDATE public.diaspora_container_loads
    SET status='COMPLETED', confirmed_by='loader-1', confirmed_at=now(), actual_loaded_volume_cbm=3.600
    WHERE id='${LOAD}';`);
});

await refuses('a second live load for the same container is refused',
  `INSERT INTO public.diaspora_container_loads (container_id, reference) VALUES ('${CONTAINER}', 'LOAD-0002');`,
  /uq_container_live_load/);

// ── THE THREE MEASUREMENTS ────────────────────────────────────────────────

await check('BOOKED 3.0, WAREHOUSE 3.8 and LOADED 3.6 all survive together', async () => {
  const r = await db.query(`
    SELECT res.estimated_volume AS booked,
           m.actual_volume_cbm  AS warehouse,
           li.loaded_volume_cbm AS loaded
    FROM public.diaspora_cargo_reservations res
    JOIN public.diaspora_warehouse_intakes i ON i.subject_id = res.id::text
    JOIN public.diaspora_warehouse_measurements m ON m.intake_id = i.id
    JOIN public.diaspora_container_load_items li ON li.subject_id = res.id::text AND li.outcome='LOADED'
    WHERE res.id = '${RES_A}';`);
  const row = r.rows[0];
  if (Number(row.booked) !== 3) throw new Error(`booked is ${row.booked}`);
  if (Number(row.warehouse) !== 3.8) throw new Error(`warehouse is ${row.warehouse}`);
  if (Number(row.loaded) !== 3.6) throw new Error(`loaded is ${row.loaded}`);
});

await check('T10 does not write T5 capacity or T9 measurements — not one statement', async () => {
  if (/UPDATE\s+public\.diaspora_container_shipments/i.test(upCode)) throw new Error('the migration writes the T5 ledger');
  if (/UPDATE\s+public\.diaspora_cargo_reservations/i.test(upCode)) throw new Error('the migration writes the booking estimate');
  if (/UPDATE\s+public\.diaspora_warehouse_measurements/i.test(upCode)) throw new Error('the migration writes a T9 measurement');
  const cap = await db.query(`SELECT used_capacity_volume, available_capacity_volume FROM public.diaspora_container_shipments WHERE id='${CONTAINER}';`);
  if (Number(cap.rows[0].used_capacity_volume) !== 4.5) throw new Error('the T5 ledger moved');
});

// ── The T11 firewall ──────────────────────────────────────────────────────

await refuses('T10 cannot record a DEPARTED load — there is no such state',
  `UPDATE public.diaspora_container_loads SET status='DEPARTED' WHERE id='${LOAD}';`,
  /diaspora_container_loads_status_check/);

await refuses('nor SHIPPED, nor IN_TRANSIT',
  `UPDATE public.diaspora_container_loads SET status='SHIPPED' WHERE id='${LOAD}';`,
  /diaspora_container_loads_status_check/);

await check('no T10 column can express a T11 or T12 fact', async () => {
  const r = await db.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name LIKE 'diaspora_container_load%';`);
  // Whole words only. The first version used a bare `eta` alternative and flagged every `metadata`
  // column — a firewall check that cries wolf gets switched off, which is worse than not having it.
  //
  // `metadata jsonb` is deliberately NOT treated as a hole. It is unstructured by design across the
  // whole codebase, and the thing that stops it becoming a shadow state machine is the service layer
  // refusing to read a status out of it — not a column name. The schema-level claim this check makes
  // is narrower and true: there is no NAMED place to put a later phase's fact.
  const forbidden = /(^|_)(departed?|departure|transit|arrival|arrived|customs|cleared|delivered|delivery|vessel|eta)($|_)/i;
  const offenders = r.rows.filter((c) => forbidden.test(c.column_name));
  if (offenders.length) throw new Error(`columns that could hold a later phase's fact: ${offenders.map((o) => `${o.table_name}.${o.column_name}`).join(', ')}`);
  // And nothing references the shipment authority at all.
  if (/diaspora_shipments|diaspora_shipment_stage_events/.test(upCode)) throw new Error('the migration references the T11 authority');
});

// ── Container and seal ────────────────────────────────────────────────────

await refuses('a seal record that records neither identifier is refused',
  `INSERT INTO public.diaspora_container_seal_records (load_id, recorded_by) VALUES ('${LOAD}', 'loader-1');`,
  /seal_record_states_something/);

await check('an observed container number and seal are recorded with their author', async () => {
  await db.exec(`INSERT INTO public.diaspora_container_seal_records (load_id, container_number, seal_number, recorded_by)
    VALUES ('${LOAD}', 'MSKU1234567', 'SEAL-0001', 'loader-1');`);
});

await refuses('replacing a seal without saying why is refused',
  `INSERT INTO public.diaspora_container_seal_records (load_id, seal_number, record_reason, recorded_by)
     VALUES ('${LOAD}', 'SEAL-0002', 'SEAL_REPLACED', 'loader-1');`,
  /seal_replacement_has_note/);

await check('a replaced seal keeps the previous one readable, with who and when', async () => {
  await db.exec(`INSERT INTO public.diaspora_container_seal_records (load_id, seal_number, record_reason, reason_note, recorded_by)
    VALUES ('${LOAD}', 'SEAL-0002', 'SEAL_REPLACED', 'Customs inspection at the depot gate', 'loader-1');`);
  const r = await db.query(`SELECT seal_number, record_reason, recorded_by FROM public.diaspora_container_seal_records
    WHERE load_id='${LOAD}' ORDER BY recorded_at ASC;`);
  if (r.rows.length !== 2) throw new Error(`${r.rows.length} seal records, expected 2`);
  if (r.rows[0].seal_number !== 'SEAL-0001') throw new Error('the original seal was lost');
  if (!r.rows.every((x) => x.recorded_by === 'loader-1')) throw new Error('a seal record lost its author');
});

await check('an unknown container number stays unknown — nothing is fabricated', async () => {
  await db.exec(`INSERT INTO public.diaspora_container_seal_records (load_id, seal_number, recorded_by)
    VALUES ('${LOAD}', 'SEAL-0003', 'loader-1');`);
  const r = await db.query(`SELECT container_number FROM public.diaspora_container_seal_records WHERE seal_number='SEAL-0003';`);
  if (r.rows[0].container_number !== null) throw new Error('a container number was invented');
});

// ── Governed access ───────────────────────────────────────────────────────

await check('all five tables are ENABLE + FORCE RLS with no anon/authenticated grants', async () => {
  const names = ['diaspora_container_load_plans', 'diaspora_container_load_plan_items', 'diaspora_container_loads', 'diaspora_container_load_items', 'diaspora_container_seal_records'];
  const r = await db.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname IN (${names.map((n) => `'${n}'`).join(',')});`);
  if (r.rows.length !== 5) throw new Error(`expected 5 tables, saw ${r.rows.length}`);
  for (const row of r.rows) {
    if (!row.relrowsecurity || !row.relforcerowsecurity) throw new Error(`${row.relname} is not FORCE RLS`);
  }
  for (const n of names) {
    const g = await db.query(`SELECT has_table_privilege('anon','public.${n}','SELECT') AS a,
                                     has_table_privilege('authenticated','public.${n}','INSERT') AS b;`);
    if (g.rows[0].a || g.rows[0].b) throw new Error(`${n} still grants anon/authenticated`);
  }
});

await check('Down is reversible, and the earlier phases survive it', async () => {
  await db.exec(down);
  const r = await db.query(`SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_name LIKE 'diaspora_container_load%' OR table_name='diaspora_container_seal_records';`);
  if (r.rows[0].n !== 0) throw new Error('tables not dropped');
  const est = await db.query(`SELECT estimated_volume FROM public.diaspora_cargo_reservations WHERE id='${RES_A}';`);
  if (Number(est.rows[0].estimated_volume) !== 3) throw new Error('the booking estimate did not survive Down');
  const act = await db.query(`SELECT actual_volume_cbm FROM public.diaspora_warehouse_measurements;`);
  if (Number(act.rows[0].actual_volume_cbm) !== 3.8) throw new Error('the warehouse measurement did not survive Down');
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 }, null, 2));
await db.close();
process.exit(failed.length ? 1 : 0);
