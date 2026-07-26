// Real-Postgres proof for the FOUNDATION mutation-boundary hardening (SEC-DB-2, 2026-07-18).
//
// Creates all 27 diaspora foundation tables (skeletons with the union of columns the RLS predicates
// reference), the tenant_users/users deps, and the real diaspora_trade_os_* helper functions; grants
// the ORIGINAL broad authenticated writes to simulate the pre-hardening state; then applies the ACTUAL
// compensating migration file verbatim (so any SQL error in it fails here) and proves, as real
// anon/authenticated/service_role roles: authenticated + anon cannot mutate any foundation table,
// lifecycle/ledger/audit/verification/approval writes are denied, cross-tenant SELECT returns 0,
// same-tenant SELECT still works, service_role writes succeed, and the helper actor-spoofing guard
// rejects a foreign actor id. NOT staging (see README).
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIG = fileURLToPath(new URL('../../../database/migrations/20260718100000_diaspora_foundation_mutation_boundary_hardening.sql', import.meta.url));
const UP = readFileSync(MIG, 'utf8').split('-- +migrate Down')[0].replace(/^-- \+migrate Up/m, '');
const DATA_DIR = fileURLToPath(new URL('./.pgdata-foundation', import.meta.url));
const PORT = 54397;
const results = [];
const rec = (n, ok, d) => { results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

// Union of columns every foundation RLS predicate references (extra cols are harmless).
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

async function asRole(url, role, sub, sql) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try { await c.query('BEGIN'); await c.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [sub ?? '']); await c.query(`SET LOCAL ROLE ${role}`);
    const res = await c.query(sql); await c.query('ROLLBACK'); return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (e) { await c.query('ROLLBACK').catch(()=>{}); return { ok: false, code: e.code, msg: e.message }; } finally { await c.end(); }
}

async function main() {
  await epg.initialise(); await epg.start(); await epg.createDatabase('founddb');
  const url = `postgres://postgres:postgres@127.0.0.1:${PORT}/founddb`;
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  rec('real Postgres booted', true, (await admin.query('show server_version')).rows[0].server_version);

  for (const r of ['anon','authenticated','service_role']) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${r}') THEN CREATE ROLE ${r} NOLOGIN; END IF; END $$;`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  }
  await admin.query(`ALTER ROLE service_role BYPASSRLS`);

  // Deps + real helpers (verbatim contract). auth.uid() shim maps to the jwt sub (as Supabase does).
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
      AS $$ SELECT actor_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=actor_id AND u.role IN ('admin','platform_admin','super_admin')) $$;
    CREATE FUNCTION public.diaspora_trade_os_is_tenant_member(actor_id text, requested_tenant_id uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
      AS $$ SELECT actor_id IS NOT NULL AND requested_tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=actor_id AND tu.tenant_id=requested_tenant_id) $$;
    CREATE FUNCTION public.diaspora_trade_os_can_access_row(row_tenant_id uuid, row_created_by text, row_updated_by text DEFAULT NULL)
      RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public'
      AS $$ SELECT public.diaspora_trade_os_is_platform_admin() OR public.diaspora_trade_os_current_user_id()=row_created_by OR public.diaspora_trade_os_current_user_id()=row_updated_by OR public.diaspora_trade_os_is_tenant_member(public.diaspora_trade_os_current_user_id(), row_tenant_id) $$;
    CREATE FUNCTION public.set_diaspora_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
    CREATE FUNCTION public.set_diaspora_trade_os_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`);

  // The REAL pre-hardening FOR ALL policy names the migration drops (so after the migration only its
  // tenant-scoped SELECT policies remain). Using the real names makes this a faithful before/after.
  const REAL_FORALL = {
    diaspora_import_order_participants: 'diaspora_participants_access', diaspora_trade_profiles: 'diaspora_trade_profiles_access',
    diaspora_import_quotes: 'diaspora_order_child_access', diaspora_trade_documents: 'diaspora_documents_private_access',
    diaspora_trade_document_extractions: 'diaspora_extractions_private_access', diaspora_trade_document_verifications: 'diaspora_verifications_private_access',
    diaspora_container_shipments: 'diaspora_containers_tenant_write', diaspora_cargo_reservations: 'diaspora_reservations_access',
    diaspora_shipments: 'diaspora_shipments_access', diaspora_shipment_stage_events: 'diaspora_stage_events_access',
    diaspora_compliance_reviews: 'diaspora_compliance_access', diaspora_payment_milestones: 'diaspora_payment_access',
    diaspora_reputation_records: 'diaspora_reputation_access', diaspora_notification_preferences: 'diaspora_notifications_access',
    vehicle_import_records: 'vehicle_import_records_access', vehicle_government_documents: 'vehicle_government_documents_access',
    diaspora_workbook_import_batches: 'diaspora_workbook_batches_private_access', diaspora_workbook_import_rows: 'diaspora_workbook_rows_private_access',
    diaspora_supply_documents: 'diaspora_supply_documents_private_access', diaspora_stock_items: 'diaspora_stock_items_private_access',
    diaspora_order_documents: 'diaspora_order_documents_private_access', diaspora_ai_commands: 'diaspora_ai_commands_private_access',
    diaspora_stock_ledger: 'diaspora_stock_ledger_private_access', diaspora_drive_files: 'diaspora_drive_files_owner_access',
    diaspora_drive_connections: 'diaspora_drive_connections_owner_access',
  };
  for (const t of TABLES) {
    await admin.query(`CREATE TABLE public.${t} (${COLS})`);
    await admin.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.${t} TO authenticated`);
    if (REAL_FORALL[t]) {
      // Pre-state permissive FOR ALL (tenant-scoped USING so, after the migration recreates it as
      // FOR SELECT with the same predicate, cross-tenant reads are correctly denied).
      await admin.query(`CREATE POLICY "${REAL_FORALL[t]}" ON public.${t} FOR ALL TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text)) WITH CHECK (true)`);
    }
  }
  // import_orders: pre-existing SELECT policy the migration keeps (tenant/owner scoped) + the
  // insert/update policies it drops; and the container co-loading read the migration keeps.
  await admin.query(`CREATE POLICY "diaspora_orders_owner_participant_tenant" ON public.diaspora_import_orders FOR SELECT TO authenticated USING (buyer_id = auth.uid()::text OR created_by = auth.uid()::text OR tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text))`);
  await admin.query(`CREATE POLICY "diaspora_orders_owner_insert" ON public.diaspora_import_orders FOR INSERT TO authenticated WITH CHECK (true)`);
  await admin.query(`CREATE POLICY "diaspora_orders_owner_participant_update" ON public.diaspora_import_orders FOR UPDATE TO authenticated USING (true)`);
  await admin.query(`CREATE POLICY "diaspora_containers_read_participants" ON public.diaspora_container_shipments FOR SELECT USING (deleted_at IS NULL)`);
  await admin.query(`CREATE POLICY "diaspora_audit_access" ON public.diaspora_import_audit_log FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()::text))`);
  rec('27 foundation tables created with real pre-hardening policy names + broad writes', true);

  // ── APPLY THE ACTUAL COMPENSATING MIGRATION (verbatim) — any SQL error fails here ──
  try { await admin.query(UP); rec('compensating migration APPLIES cleanly on real Postgres', true); }
  catch (e) { rec('compensating migration APPLIES cleanly on real Postgres', false, e.message); await admin.end(); await epg.stop(); finish(); return; }

  // Seed (owner bypasses RLS).
  const TA='11111111-1111-1111-1111-111111111111', TB='22222222-2222-2222-2222-222222222222';
  await admin.query(`INSERT INTO users(id,role) VALUES ('mA','buyer'),('mB','buyer')`);
  await admin.query(`INSERT INTO tenant_users(user_id,tenant_id) VALUES ('mA',$1),('mB',$2)`, [TA, TB]);
  for (const t of ['diaspora_import_orders','diaspora_stock_ledger','diaspora_import_audit_log','diaspora_cargo_reservations','diaspora_compliance_reviews','diaspora_payment_milestones','diaspora_trade_document_verifications','diaspora_shipment_stage_events','diaspora_reputation_records','diaspora_stock_items','diaspora_container_shipments'])
    await admin.query(`INSERT INTO public.${t}(tenant_id, created_by, status) VALUES ($1,'system','ACTIVE')`, [TA]);

  // ── Negative ACL: authenticated cannot mutate ANY foundation table (grant denied) ──
  let anyWriteAllowed = false, worstTable = null;
  for (const t of TABLES) {
    const r = await asRole(url, 'authenticated', 'mA', `INSERT INTO public.${t}(tenant_id, created_by) VALUES ('${TA}','mA')`);
    if (r.ok || r.code !== '42501') { anyWriteAllowed = true; worstTable = `${t}(${r.ok?'ALLOWED':r.code})`; break; }
  }
  rec('authenticated CANNOT INSERT into ANY of the 27 foundation tables (all 42501)', !anyWriteAllowed, worstTable ? `leaked at ${worstTable}` : 'all 27 denied');

  // anon cannot even read/write.
  const anon = await asRole(url, 'anon', null, `INSERT INTO public.diaspora_import_orders(tenant_id) VALUES ('${TA}')`);
  rec('anon CANNOT write a foundation table', !anon.ok && anon.code === '42501', anon.code);

  // Specific high-value lifecycle/immutable denials (UPDATE/INSERT).
  const cases = [
    ['import-order status', `UPDATE public.diaspora_import_orders SET status='ZIMBABWE_READY' WHERE tenant_id='${TA}'`],
    ['reservation approval', `UPDATE public.diaspora_cargo_reservations SET status='APPROVED' WHERE tenant_id='${TA}'`],
    ['container capacity', `UPDATE public.diaspora_container_shipments SET status='FULL' WHERE tenant_id='${TA}'`],
    ['stock quantities', `UPDATE public.diaspora_stock_items SET status='x' WHERE tenant_id='${TA}'`],
    ['stock ledger insert', `INSERT INTO public.diaspora_stock_ledger(tenant_id,created_by) VALUES ('${TA}','mA')`],
    ['document verification', `UPDATE public.diaspora_trade_document_verifications SET status='VERIFIED' WHERE tenant_id='${TA}'`],
    ['compliance approval', `UPDATE public.diaspora_compliance_reviews SET status='APPROVED' WHERE tenant_id='${TA}'`],
    ['shipment stage event', `INSERT INTO public.diaspora_shipment_stage_events(tenant_id,created_by) VALUES ('${TA}','mA')`],
    ['milestone confirm', `UPDATE public.diaspora_payment_milestones SET status='CONFIRMED' WHERE tenant_id='${TA}'`],
    ['reputation record', `INSERT INTO public.diaspora_reputation_records(tenant_id,created_by) VALUES ('${TA}','mA')`],
    ['audit mutation', `INSERT INTO public.diaspora_import_audit_log(tenant_id,created_by) VALUES ('${TA}','mA')`],
  ];
  let allDenied = true, firstLeak = null;
  for (const [label, sql] of cases) { const r = await asRole(url, 'authenticated', 'mA', sql); if (r.ok || r.code !== '42501') { allDenied = false; firstLeak = `${label}(${r.ok?'ALLOWED':r.code})`; break; } }
  rec('authenticated CANNOT directly write any lifecycle/immutable field (11 probes, all 42501)', allDenied, firstLeak ? `leaked at ${firstLeak}` : 'all denied');

  // ── Reads still work (same-tenant) + cross-tenant denial ──
  let r = await asRole(url, 'authenticated', 'mA', `SELECT count(*)::int c FROM public.diaspora_import_orders WHERE tenant_id='${TA}'`);
  rec('same-tenant member CAN still SELECT (operability preserved)', r.ok && r.rows[0].c === 1, r.ok ? `rows=${r.rows[0].c}` : r.msg);
  r = await asRole(url, 'authenticated', 'mB', `SELECT count(*)::int c FROM public.diaspora_import_orders WHERE tenant_id='${TA}'`);
  rec('cross-tenant SELECT returns 0 rows (RLS)', r.ok && r.rows[0].c === 0, r.ok ? `rows=${r.rows[0].c}` : r.msg);

  // ── service_role writes succeed (backend path) ──
  r = await asRole(url, 'service_role', null, `UPDATE public.diaspora_import_orders SET status='ZIMBABWE_READY' WHERE tenant_id='${TA}'`);
  rec('service_role CAN write (backend path preserved)', r.ok && r.rowCount === 1, r.ok ? `updated=${r.rowCount}` : r.msg);

  // ── Helper actor-spoofing guard: attacker cannot probe a victim's tenant membership ──
  r = await asRole(url, 'authenticated', 'mA', `SELECT public.diaspora_trade_os_is_tenant_member('mB','${TB}') AS m`);
  rec('actor-spoofing rejected: authenticated cannot evaluate a foreign tenant membership', r.ok && r.rows[0].m === false, r.ok ? `returned ${r.rows[0].m}` : r.msg);
  r = await asRole(url, 'authenticated', 'mA', `SELECT public.diaspora_trade_os_is_tenant_member('mA','${TA}') AS m`);
  rec('self membership still evaluates true (RLS path unbroken)', r.ok && r.rows[0].m === true, r.ok ? `returned ${r.rows[0].m}` : r.msg);

  await admin.end(); await epg.stop(); finish();
}
function finish() {
  const passed = results.filter(x => x.ok).length;
  console.log(`\n════ FOUNDATION ACL PROOF: ${passed}/${results.length} passed ════`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch(async (e) => { console.error('HARNESS ERROR:', e.message); try { await epg.stop(); } catch {} process.exit(2); });
