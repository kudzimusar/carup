/**
 * RX06-LR04 CAP S1 — the grants migration for the carried CAP objects, on a REAL Postgres (PGlite).
 *
 * Proves, after CAP-04, CAP-05 and R2 and then the grants migration (applied twice):
 *   - EXECUTE on the eight trigger functions is held by neither PUBLIC, anon nor authenticated;
 *   - service_role can SELECT all seven CAP tables, and anon cannot;
 *   - a role that holds INSERT/DELETE but no EXECUTE still has the guards fire (a delete is refused);
 *   - re-applying changes no privilege;
 *   - NEGATIVE CONTROL: on the carried migrations alone, the same privilege checks FAIL (so they are not vacuous).
 * Exit code 1 on any failure.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf-8');
const upOf = (sql) => sql.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const CAP = [
  '20260920090000_trade_os_cap04_shipment_legs.sql',
  '20260921090000_trade_os_cap05_shipment_observations.sql',
  '20260926090000_trade_os_cap_r2_customer_journey_authorities.sql',
];
const GRANTS = upOf(read('20261122140000_rx06_cap_s1_grants_hardening.sql'));
const FUNCS = [
  'carup_shipment_leg_guard', 'carup_shipment_leg_no_delete', 'carup_shipment_observation_guard', 'carup_shipment_observation_no_delete',
  'carup_cap_recorded_fact_guard', 'carup_cap_recorded_fact_no_delete', 'carup_document_dispatch_time_guard', 'carup_vehicle_media_reference_check',
];
const TABLES = [
  'diaspora_shipment_legs', 'diaspora_shipment_observations', 'diaspora_external_progress_entries', 'diaspora_order_parties',
  'diaspora_document_dispatches', 'vehicle_specification_observations', 'vehicle_media_references',
];
const SHIPMENT = 'aaaa0000-0000-0000-0000-000000000001';
const LEG = 'cccc0000-0000-0000-0000-000000000001';

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE writer BYPASSRLS;
    -- Supabase grants every new public table to these roles by default; a bare Postgres does not.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    CREATE TABLE public.users (id text PRIMARY KEY);
    INSERT INTO public.users (id) VALUES ('operator-1');
    CREATE TABLE public.tenants (id uuid PRIMARY KEY);
    CREATE TABLE public.vehicles (vin text PRIMARY KEY, price real NOT NULL DEFAULT 0);
    CREATE TABLE public.vehicle_evidence (id uuid PRIMARY KEY, vin text NOT NULL REFERENCES public.vehicles(vin) ON DELETE CASCADE,
      mime_type text NOT NULL, verification_status text NOT NULL DEFAULT 'pending');
    CREATE TABLE public.diaspora_import_orders (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'IMPORT_REQUESTED');
    CREATE TABLE public.diaspora_shipments (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'PLANNED',
      departure_date timestamptz NULL, estimated_arrival_date timestamptz NULL, actual_arrival_date timestamptz NULL);
    CREATE TABLE public.diaspora_shipment_stage_events (id uuid PRIMARY KEY);
    INSERT INTO public.diaspora_shipments (id) VALUES ('${SHIPMENT}');
  `);
  for (const f of CAP) await db.exec(upOf(read(f)));
  return db;
}

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: String(e.message).split('\n')[0] }); }
};
const val = async (db, q) => Object.values((await db.query(q)).rows[0])[0];
const publicExecutes = (fn) => `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE p.proname = '${fn}' AND p.pronamespace = 'public'::regnamespace AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS x`;
const aclSnapshot = async (db) => JSON.stringify((await db.query(`
  SELECT 'f:' || proname AS k, coalesce(proacl::text, 'default') AS v FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'carup_%'
  UNION ALL SELECT 't:' || relname, coalesce(relacl::text, 'default') FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  ORDER BY 1`)).rows);

async function privilegeChecks(db, label) {
  for (const fn of FUNCS) {
    await check(`${label}: PUBLIC holds no EXECUTE on ${fn}`, async () => { if (await val(db, publicExecutes(fn))) throw new Error('PUBLIC can execute it'); });
    for (const r of ['anon', 'authenticated']) {
      await check(`${label}: ${r} cannot execute ${fn}`, async () => {
        if (await val(db, `SELECT has_function_privilege('${r}', 'public.${fn}()', 'EXECUTE') AS x`)) throw new Error(`${r} can execute it`);
      });
    }
  }
  for (const t of TABLES) {
    await check(`${label}: service_role can SELECT ${t}`, async () => {
      if (!(await val(db, `SELECT has_table_privilege('service_role', 'public.${t}', 'SELECT') AS x`))) throw new Error('no SELECT');
    });
    await check(`${label}: anon cannot SELECT ${t}`, async () => {
      if (await val(db, `SELECT has_table_privilege('anon', 'public.${t}', 'SELECT') AS x`)) throw new Error('anon can read it');
    });
  }
}

// ── With the grants migration ─────────────────────────────────────────────────────────────────────
const db = await freshDb();
await check('the grants migration applies', async () => { await db.exec(GRANTS); });
const first = await aclSnapshot(db);
await check('re-applying it changes no privilege', async () => {
  await db.exec(GRANTS);
  if ((await aclSnapshot(db)) !== first) throw new Error('privileges changed on the second application');
});
await privilegeChecks(db, 'WITH');
await check('the guards still fire for a role that holds no EXECUTE (a leg cannot be deleted)', async () => {
  await db.exec(`GRANT SELECT, INSERT, DELETE ON public.diaspora_shipment_legs TO writer;`);
  if (await val(db, `SELECT has_function_privilege('writer', 'public.carup_shipment_leg_no_delete()', 'EXECUTE') AS x`)) throw new Error('writer unexpectedly holds EXECUTE');
  await db.exec(`SET ROLE writer;
    INSERT INTO public.diaspora_shipment_legs (id, shipment_id, leg_sequence, vessel_name, port_of_loading, port_of_discharge, created_by)
    VALUES ('${LEG}', '${SHIPMENT}', 1, 'SAMPLE VESSEL', 'Port A', 'Port B', 'operator-1');`);
  let refused = null;
  try { await db.exec(`DELETE FROM public.diaspora_shipment_legs WHERE id = '${LEG}';`); } catch (e) { refused = e; }
  await db.exec('RESET ROLE;');
  if (!refused) throw new Error('the delete was ACCEPTED — the no-delete trigger did not fire');
  if (!/cannot be deleted/i.test(refused.message)) throw new Error(`refused for another reason: ${refused.message.split('\n')[0]}`);
});

// ── Negative control: the carried migrations alone ────────────────────────────────────────────────
const bare = await freshDb();
const before = results.length;
await privilegeChecks(bare, 'CONTROL');
const control = results.splice(before);
const controlFailures = control.filter((r) => !r.ok).length;
results.push({
  name: `NEGATIVE CONTROL: without the grants migration the privilege checks fail (${controlFailures}/${control.length} fail)`,
  ok: controlFailures > 0 && control.some((r) => !r.ok && /PUBLIC can execute|anon can execute|no SELECT/.test(r.error || '')),
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
console.log(`RX06-LR04 CAP S1 grants: ${results.length - failed.length}/${results.length} pass`);
process.exit(failed.length ? 1 : 0);
