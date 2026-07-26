// Real-Postgres PUBLIC-VEHICLE regression for the SEC-DB-2 correction (2026-07-18).
//
// The foundation hardening's first cut revoked anon EXECUTE on public.current_tenant_id() — but the
// PUBLIC marketplace policy vehicles.tenant_vehicles_isolation calls it (`tenant_id =
// current_tenant_id() OR tenant_id IS NULL`), so anonymous vehicle browsing would fail at policy
// evaluation. This harness applies the ACTUAL corrected migration file verbatim and proves:
//   1. anon CAN execute current_tenant_id()                       (the correction)
//   2. the vehicles policy evaluates for anon with NO permission error
//   3. a public vehicle (tenant_id IS NULL) IS visible to anon
//   4. a tenant-owned private vehicle is NOT exposed to anon
//   5. authenticated access remains valid (tenant vehicle + public visible with tenant context)
//   6. anon CANNOT execute the Diaspora admin/membership helpers  (hardening intact)
//   7. all 27 Diaspora foundation tables remain write-denied      (hardening intact)
//   8. is_platform_admin preserves lower(coalesce(role)) normalization ('Admin' still admin)
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIG = fileURLToPath(new URL('../../../database/migrations/20260718100000_diaspora_foundation_mutation_boundary_hardening.sql', import.meta.url));
const UP = readFileSync(MIG, 'utf8').split('-- +migrate Down')[0].replace(/^-- \+migrate Up/m, '');
const DATA_DIR = fileURLToPath(new URL('./.pgdata-pubveh', import.meta.url));
const PORT = 54396;
const results = [];
const rec = (n, ok, d) => { results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const COLS = `id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text,
  user_id text, buyer_id text, seller_id text, uploaded_by text, reviewer_id text, coordinator_id text,
  actor_id text, trade_document_id uuid, trade_profile_id uuid, import_order_id uuid, status text, deleted_at timestamptz`;
const TABLES = [
  'diaspora_import_orders','diaspora_import_order_participants','diaspora_trade_profiles','diaspora_import_quotes',
  'diaspora_trade_documents','diaspora_trade_document_extractions','diaspora_trade_document_verifications',
  'diaspora_container_shipments','diaspora_cargo_reservations','diaspora_shipments','diaspora_shipment_stage_events',
  'diaspora_compliance_reviews','diaspora_payment_milestones','diaspora_reputation_records','diaspora_import_audit_log',
  'diaspora_notification_preferences','vehicle_import_records','vehicle_government_documents',
  'diaspora_workbook_import_batches','diaspora_workbook_import_rows','diaspora_supply_documents','diaspora_stock_items',
  'diaspora_order_documents','diaspora_ai_commands','diaspora_stock_ledger','diaspora_drive_connections','diaspora_drive_files'];

const epg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false });

async function asRole(url, role, opts, sql) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    await c.query('BEGIN');
    if (opts.sub !== undefined) await c.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [opts.sub ?? '']);
    if (opts.tenant !== undefined) await c.query(`SELECT set_config('app.current_tenant',$1,true)`, [opts.tenant ?? '']);
    await c.query(`SET LOCAL ROLE ${role}`);
    const res = await c.query(sql); await c.query('ROLLBACK');
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (e) { await c.query('ROLLBACK').catch(()=>{}); return { ok: false, code: e.code, msg: e.message }; } finally { await c.end(); }
}

async function main() {
  await epg.initialise(); await epg.start(); await epg.createDatabase('pubvehdb');
  const url = `postgres://postgres:postgres@127.0.0.1:${PORT}/pubvehdb`;
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  rec('real Postgres booted', true, (await admin.query('show server_version')).rows[0].server_version);

  for (const r of ['anon','authenticated','service_role']) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${r}') THEN CREATE ROLE ${r} NOLOGIN; END IF; END $$;`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  }
  await admin.query(`ALTER ROLE service_role BYPASSRLS`);

  // Deps + the real helper functions (verbatim contracts incl. the ORIGINAL lower(coalesce()) admin body).
  await admin.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'') $$;
    CREATE TABLE public.users (id text PRIMARY KEY, role text);
    CREATE TABLE public.tenant_users (user_id text, tenant_id uuid);
    GRANT SELECT ON public.tenant_users TO authenticated;
    CREATE FUNCTION public.diaspora_trade_os_current_user_id() RETURNS text LANGUAGE sql STABLE SET search_path TO 'public'
      AS $$ SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),''),'') $$;
    CREATE FUNCTION public.diaspora_trade_os_is_platform_admin(actor_id text DEFAULT public.diaspora_trade_os_current_user_id())
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
      AS $$ SELECT actor_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=actor_id AND lower(coalesce(u.role,'')) IN ('admin','platform_admin','super_admin')) $$;
    CREATE FUNCTION public.diaspora_trade_os_is_tenant_member(actor_id text, requested_tenant_id uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
      AS $$ SELECT actor_id IS NOT NULL AND requested_tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=actor_id AND tu.tenant_id=requested_tenant_id) $$;
    CREATE FUNCTION public.diaspora_trade_os_can_access_row(row_tenant_id uuid, row_created_by text, row_updated_by text DEFAULT NULL)
      RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public'
      AS $$ SELECT public.diaspora_trade_os_is_platform_admin() OR public.diaspora_trade_os_current_user_id()=row_created_by OR public.diaspora_trade_os_current_user_id()=row_updated_by OR public.diaspora_trade_os_is_tenant_member(public.diaspora_trade_os_current_user_id(), row_tenant_id) $$;
    CREATE FUNCTION public.is_diaspora_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
      AS $$ SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND lower(coalesce(u.role,'')) IN ('admin','platform_admin','super_admin')) $$;
    CREATE FUNCTION public.diaspora_can_access_order(target_order_id uuid, target_user_id text) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT target_user_id IS NOT NULL AND target_user_id = auth.uid()::text $$;
    CREATE FUNCTION public.set_diaspora_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE FUNCTION public.set_diaspora_trade_os_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    -- current_tenant_id: verbatim body from 002/20260620232827 (app.current_tenant setting).
    CREATE FUNCTION public.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid $$;`);

  // The PUBLIC marketplace vehicles table + the verbatim tenant_vehicles_isolation policy (002).
  await admin.query(`
    CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, make text);
    ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "tenant_vehicles_isolation" ON public.vehicles
      FOR ALL
      USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
      WITH CHECK (tenant_id = current_tenant_id());
    GRANT SELECT ON public.vehicles TO anon, authenticated;`);

  // 27 diaspora tables in the pre-hardening state (broad writes; real policy names).
  for (const t of TABLES) {
    await admin.query(`CREATE TABLE public.${t} (${COLS})`);
    await admin.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.${t} TO authenticated`);
  }
  rec('schema created (vehicles + verbatim policy + 27 diaspora tables, pre-hardening grants)', true);

  // ── APPLY THE ACTUAL CORRECTED MIGRATION VERBATIM ──
  try { await admin.query(UP); rec('corrected migration APPLIES cleanly on real Postgres', true); }
  catch (e) { rec('corrected migration APPLIES cleanly on real Postgres', false, e.message); await admin.end(); await epg.stop(); return finish(); }

  // Seed: one PUBLIC vehicle (tenant_id NULL) + one tenant-A private vehicle; users incl. mixed-case admin.
  const TA='11111111-1111-1111-1111-111111111111';
  await admin.query(`INSERT INTO vehicles(tenant_id, make) VALUES (NULL,'PublicCar'), ($1,'PrivateCar')`, [TA]);
  await admin.query(`INSERT INTO users(id,role) VALUES ('mixedAdmin','Admin'),('mA','buyer')`);
  await admin.query(`INSERT INTO tenant_users(user_id,tenant_id) VALUES ('mA',$1)`, [TA]);

  // 1. anon can execute current_tenant_id().
  let r = await asRole(url, 'anon', {}, `SELECT public.current_tenant_id() AS t`);
  rec('anon CAN execute current_tenant_id()', r.ok, r.ok ? `returned ${r.rows[0].t === null ? 'NULL (no tenant context)' : r.rows[0].t}` : `${r.code} ${r.msg}`);

  // 2+3+4. vehicles policy evaluates for anon; public visible; private hidden.
  r = await asRole(url, 'anon', {}, `SELECT make FROM public.vehicles ORDER BY make`);
  const makes = r.ok ? r.rows.map(x => x.make) : [];
  rec('vehicles tenant_vehicles_isolation evaluates for anon with NO permission error', r.ok, r.ok ? `rows=${makes.join(',')}` : `${r.code} ${r.msg}`);
  rec('public vehicle (tenant_id IS NULL) IS visible to anon', r.ok && makes.includes('PublicCar'), r.ok ? '' : 'n/a');
  rec('tenant-owned private vehicle is NOT exposed to anon', r.ok && !makes.includes('PrivateCar'), r.ok ? '' : 'n/a');

  // 5. authenticated with tenant context sees tenant + public vehicles.
  r = await asRole(url, 'authenticated', { sub: 'mA', tenant: TA }, `SELECT make FROM public.vehicles ORDER BY make`);
  rec('authenticated (tenant context) still sees tenant + public vehicles', r.ok && r.rows.length === 2, r.ok ? `rows=${r.rows.map(x=>x.make).join(',')}` : `${r.code} ${r.msg}`);

  // 6. anon CANNOT execute the Diaspora admin/membership helpers (post-migration revoke).
  const helperProbes = [
    ['diaspora_trade_os_is_platform_admin', `SELECT public.diaspora_trade_os_is_platform_admin('mA')`],
    ['diaspora_trade_os_is_tenant_member', `SELECT public.diaspora_trade_os_is_tenant_member('mA','${TA}')`],
    ['diaspora_trade_os_can_access_row', `SELECT public.diaspora_trade_os_can_access_row('${TA}','mA',NULL)`],
    ['diaspora_trade_os_current_user_id', `SELECT public.diaspora_trade_os_current_user_id()`],
    ['is_diaspora_platform_admin', `SELECT public.is_diaspora_platform_admin()`],
    ['diaspora_can_access_order', `SELECT public.diaspora_can_access_order(gen_random_uuid(),'mA')`],
  ];
  let allHelpersDenied = true, leak = null;
  for (const [name, sql] of helperProbes) { const p = await asRole(url, 'anon', {}, sql); if (p.ok || p.code !== '42501') { allHelpersDenied = false; leak = `${name}(${p.ok?'ALLOWED':p.code})`; break; } }
  rec('anon CANNOT execute any Diaspora admin/membership helper (6 probes, all 42501)', allHelpersDenied, leak ?? 'all denied');

  // 7. all 27 diaspora tables remain write-denied for authenticated.
  let anyWrite = false, worst = null;
  for (const t of TABLES) { const p = await asRole(url, 'authenticated', { sub: 'mA' }, `INSERT INTO public.${t}(tenant_id, created_by) VALUES ('${TA}','mA')`); if (p.ok || p.code !== '42501') { anyWrite = true; worst = `${t}(${p.ok?'ALLOWED':p.code})`; break; } }
  rec('all 27 Diaspora foundation tables remain write-denied for authenticated (42501)', !anyWrite, worst ?? 'all 27 denied');

  // 8. Role normalization preserved: mixed-case 'Admin' still evaluates as admin (backend path, no jwt).
  r = await asRole(url, 'service_role', { sub: null }, `SELECT public.diaspora_trade_os_is_platform_admin('mixedAdmin') AS a`);
  rec("is_platform_admin preserves lower(coalesce(role)) — mixed-case 'Admin' still admin", r.ok && r.rows[0].a === true, r.ok ? `returned ${r.rows[0].a}` : r.msg);

  await admin.end(); await epg.stop(); return finish();
}
function finish() {
  const passed = results.filter(x => x.ok).length;
  console.log(`\n════ PUBLIC-VEHICLE RLS REGRESSION: ${passed}/${results.length} passed ════`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error('HARNESS ERROR:', e.message); try { await epg.stop(); } catch {} process.exit(2); });
