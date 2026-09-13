/**
 * Trade OS Intake 2.0 — the intake contract's persistence, verified by EXECUTING its migration on
 * real PostgreSQL (PGlite).
 *
 * What only real Postgres can show, and what the in-memory mock cannot:
 *   - every enumerated intake choice is CHECK-constrained, so an invented value is refused at the
 *     database rather than silently stored and later believed;
 *   - the observation ledger accepts several observations of the SAME fact and keeps them all,
 *     which is the entire "capture once, verify later, never overwrite" guarantee;
 *   - `VERIFIED` is a legal provenance value at the schema level (the service layer, not the
 *     column, is what refuses it from a customer) while a fabricated provenance is refused here;
 *   - Down reverses cleanly.
 *
 * ci.yml's NEW_MIGRATIONS list ends at 20260810120000, so this migration is executed by NO other
 * gate. This file is that gate, and it is wired into CI as its own step.
 *
 * Run:  node database/test/trade_os_intake_2_0_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FILE = '20260906120000_trade_os_intake_2_0_contract.sql';
const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
};
const section = (s) => {
  const raw = readFileSync(join(MIG, FILE), 'utf-8');
  const d = raw.indexOf('-- +migrate Down');
  return s === 'up' ? (d >= 0 ? raw.slice(0, d) : raw).replace('-- +migrate Up', '')
                    : (d >= 0 ? raw.slice(d) : '').replace('-- +migrate Down', '');
};

const ORDER = '11111111-1111-4111-8111-111111111111';
const LINE = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';

const db = new PGlite();
// PGlite ships none of Supabase's API roles, so the migration's named REVOKE/GRANT would abort the
// whole Up transaction. Creating them here is harness setup, not a change to the migration: the
// point of this gate is that those grants EXECUTE, not that they are skipped.
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
await db.exec(`
  CREATE TABLE public.diaspora_import_orders (
    id uuid PRIMARY KEY, buyer_id text, budget_amount numeric, budget_currency text,
    origin_country text, destination_country text, deleted_at timestamptz);
  CREATE TABLE public.diaspora_import_order_request_lines (
    id uuid PRIMARY KEY, import_order_id uuid, line_number int, item_description text,
    item_kind text, quantity int, deleted_at timestamptz);
  CREATE TABLE public.diaspora_logistics_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id text, origin_country text,
    destination_country text, service_preference text, status text, deleted_at timestamptz);
  CREATE TABLE public.diaspora_logistics_request_items (
    id uuid PRIMARY KEY, logistics_request_id uuid, line_number int, cargo_category text,
    description text, quantity int, measurement_basis text, deleted_at timestamptz);
  INSERT INTO public.diaspora_import_orders (id, buyer_id) VALUES ('${ORDER}','buyer-a');
  INSERT INTO public.diaspora_import_order_request_lines (id, import_order_id, line_number, item_description, item_kind, quantity)
    VALUES ('${LINE}','${ORDER}',1,'Toyota Alphard','vehicle',1);
  INSERT INTO public.diaspora_logistics_request_items (id, line_number, cargo_category, description, quantity, measurement_basis)
    VALUES ('${ITEM}',1,'vehicle','Alphard',1,'UNKNOWN');
`);

try { await db.exec(section('up')); record('migration Up applies', true); }
catch (e) { record('migration Up applies', false, String(e.message || e)); }

const ok = async (label, sql) => { try { await db.exec(sql); record(label, true); } catch (e) { record(label, false, String(e.message || e).slice(0, 140)); } };
const refused = async (label, sql) => {
  try { await db.exec(sql); record(label, false, 'the database ACCEPTED an invalid value'); }
  catch (e) { record(label, /violates check constraint/i.test(String(e.message)), String(e.message).slice(0, 100)); }
};

// ── enumerated intake choices are constrained, not free text ────────────
await ok('a valid budget basis is accepted',
  `UPDATE public.diaspora_import_orders SET budget_basis='delivered', destination_outcome='door_delivery', shipping_objective='lowest_cost' WHERE id='${ORDER}';`);
await refused('an invented budget basis is REFUSED',
  `UPDATE public.diaspora_import_orders SET budget_basis='whatever_i_like' WHERE id='${ORDER}';`);
await refused('an invented destination outcome is REFUSED',
  `UPDATE public.diaspora_import_orders SET destination_outcome='teleport' WHERE id='${ORDER}';`);
await refused('an invented clearing intent is REFUSED',
  `UPDATE public.diaspora_import_orders SET clearing_intent='someone_else_problem' WHERE id='${ORDER}';`);
await ok('vehicle preferences are accepted on the LINE',
  `UPDATE public.diaspora_import_order_request_lines SET vehicle_steering='rhd', vehicle_drivetrain='4wd_awd', vehicle_mileage_max_km=80000, accident_repair_tolerance='none', intended_use='personal_family', alternative_models=ARRAY['Toyota Vellfire'] WHERE id='${LINE}';`);
await refused('an invented steering value is REFUSED',
  `UPDATE public.diaspora_import_order_request_lines SET vehicle_steering='sideways' WHERE id='${LINE}';`);
await ok('unknown preferences stay NULL rather than defaulted',
  `UPDATE public.diaspora_import_order_request_lines SET vehicle_fuel_type=NULL, vehicle_transmission=NULL WHERE id='${LINE}';`);
const { rows: nulls } = await db.query(
  `SELECT vehicle_transmission IS NULL AS t, vehicle_engine_cc_min IS NULL AS e FROM public.diaspora_import_order_request_lines WHERE id='${LINE}';`);
record('no silent default was written for an unstated preference', nulls[0].t === true && nulls[0].e === true);
await ok('cargo declarations are accepted as arrays',
  `UPDATE public.diaspora_logistics_request_items SET content_declarations=ARRAY['batteries','engines'], handling_flags=ARRAY['fragile'], vehicle_running_state='non_running' WHERE id='${ITEM}';`);
await refused('an invented running state is REFUSED',
  `UPDATE public.diaspora_logistics_request_items SET vehicle_running_state='sort_of' WHERE id='${ITEM}';`);

// ── the observation ledger: history, not overwrite ──────────────────────
await ok('a customer estimate is recorded',
  `INSERT INTO public.diaspora_trade_fact_observations (subject_type, subject_id, fact_key, value_numeric, unit, provenance, observed_by)
   VALUES ('logistics_request_item','${ITEM}','weight_kg',400,'kg','CUSTOMER_ESTIMATED','buyer-a');`);
await ok('a warehouse measurement of the SAME fact is recorded alongside it',
  `INSERT INTO public.diaspora_trade_fact_observations (subject_type, subject_id, fact_key, value_numeric, unit, provenance, observed_by)
   VALUES ('logistics_request_item','${ITEM}','weight_kg',437,'kg','WAREHOUSE_MEASURED','warehouse-1');`);
const { rows: obs } = await db.query(
  `SELECT value_numeric, provenance FROM public.diaspora_trade_fact_observations
    WHERE subject_id='${ITEM}' AND fact_key='weight_kg' AND deleted_at IS NULL ORDER BY observed_at;`);
record('BOTH observations survive — the estimate is not overwritten', obs.length === 2,
  obs.map((o) => `${o.provenance}=${o.value_numeric}`).join(' , '));
record('the newest observation is the measurement', obs.length === 2 && Number(obs[1].value_numeric) === 437);
await refused('a fabricated provenance is REFUSED',
  `INSERT INTO public.diaspora_trade_fact_observations (subject_type, subject_id, fact_key, value_numeric, provenance)
   VALUES ('logistics_request_item','${ITEM}','weight_kg',1,'TRUST_ME');`);
await refused('an unknown subject type is REFUSED',
  `INSERT INTO public.diaspora_trade_fact_observations (subject_type, subject_id, fact_key, value_numeric, provenance)
   VALUES ('spaceship','${ITEM}','weight_kg',1,'CUSTOMER_STATED');`);

// ── RLS posture matches every sibling Diaspora trade table ──────────────
const { rows: rls } = await db.query(
  `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='diaspora_trade_fact_observations';`);
record('observation ledger has RLS enabled and forced', rls[0]?.relrowsecurity === true && rls[0]?.relforcerowsecurity === true);

try { await db.exec(section('down')); record('migration Down reverses cleanly', true); }
catch (e) { record('migration Down reverses cleanly', false, String(e.message || e)); }
const { rows: gone } = await db.query(
  `SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name='diaspora_import_orders' AND column_name IN ('budget_basis','destination_outcome','clearing_intent');`);
record('Down removes the intake columns', gone[0].n === 0);

console.log(JSON.stringify(results, null, 2));
process.exit(results.ok ? 0 : 1);
