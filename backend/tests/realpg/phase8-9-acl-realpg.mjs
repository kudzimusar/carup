// Real-Postgres ACL proof for the Phase 8 / Phase 9 mutation-boundary hardening (2026-07-18).
//
// Boots a REAL embedded Postgres, creates the real anon / authenticated / service_role roles and the
// real diaspora_trade_os_* SECURITY DEFINER helper functions (verbatim contract from the phase1b
// foundation migration), then applies the EXACT hardened RLS policies + table/function grants from
// the Phase 8 & 9 migrations onto minimal table skeletons carrying the columns the predicates/tests
// touch. It then proves — as the actual authenticated/anon/service_role Postgres roles with a JWT sub
// set — the negative security cases the hardening must guarantee:
//   authenticated cannot INSERT/UPDATE the money tables, cannot self-grant entitlements, cannot forge
//   an eligible release evaluation, cannot execute the service-only RPCs; cross-tenant SELECT returns
//   zero rows; service_role writes succeed.
//
// This proves the GRANT + RLS posture the migrations declare. It is NOT staging (see README) — it is a
// real-Postgres authorization proof of the SQL, standalone (not part of CI `node --test`).
import EmbeddedPostgres from 'embedded-postgres';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DATA_DIR = fileURLToPath(new URL('./.pgdata-acl', import.meta.url));
const PORT = 54398;
const results = [];
const rec = (name, ok, detail) => { results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const epg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false });

// Run `fn(client)` as `role` with request.jwt.claim.sub = `sub`, inside a txn; returns {ok, err}.
async function asRole(url, role, sub, sql) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub ?? '']);
    await c.query(`SET LOCAL ROLE ${role}`);
    const res = await c.query(sql);
    await c.query('ROLLBACK');
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return { ok: false, code: e.code, msg: e.message };
  } finally { await c.end(); }
}

async function main() {
  await epg.initialise(); await epg.start(); await epg.createDatabase('acldb');
  const url = `postgres://postgres:postgres@127.0.0.1:${PORT}/acldb`;
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  rec('real Postgres booted', true, (await admin.query('show server_version')).rows[0].server_version);

  // ── Roles (Supabase's three) + schema usage. service_role has BYPASSRLS exactly as Supabase
  //    configures it — the backend service client is the trusted mutation path that bypasses RLS. ──
  for (const r of ['anon', 'authenticated', 'service_role']) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${r}') THEN CREATE ROLE ${r} NOLOGIN; END IF; END $$;`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  }
  await admin.query(`ALTER ROLE service_role BYPASSRLS`);

  // ── FK/membership deps + the real helper functions (verbatim contract from phase1b) ──
  await admin.query(`
    CREATE TABLE public.users (id text PRIMARY KEY, role text);
    CREATE TABLE public.tenant_users (user_id text, tenant_id uuid);
    CREATE FUNCTION public.diaspora_trade_os_current_user_id() RETURNS text LANGUAGE sql STABLE SET search_path TO 'public'
      AS $$ SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true), ''), '') $$;
    CREATE FUNCTION public.diaspora_trade_os_is_platform_admin(actor_id text DEFAULT public.diaspora_trade_os_current_user_id())
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
      AS $$ SELECT actor_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=actor_id AND u.role IN ('admin','platform_admin','super_admin')) $$;
    CREATE FUNCTION public.diaspora_trade_os_is_tenant_member(actor_id text, requested_tenant_id uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
      AS $$ SELECT actor_id IS NOT NULL AND requested_tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=actor_id AND tu.tenant_id=requested_tenant_id) $$;
    CREATE FUNCTION public.diaspora_trade_os_can_access_row(row_tenant_id uuid, row_created_by text, row_updated_by text DEFAULT NULL)
      RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public'
      AS $$ SELECT public.diaspora_trade_os_is_platform_admin() OR public.diaspora_trade_os_current_user_id()=row_created_by OR public.diaspora_trade_os_current_user_id()=row_updated_by OR public.diaspora_trade_os_is_tenant_member(public.diaspora_trade_os_current_user_id(), row_tenant_id) $$;`);

  // ── Minimal skeletons carrying the columns the real predicates/tests touch ──
  await admin.query(`
    CREATE TABLE public.diaspora_subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, plan_key text, status text, created_by text, updated_by text);
    CREATE TABLE public.diaspora_user_entitlement_overrides (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, feature_key text, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_milestones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_release_evaluations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, eligible boolean, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text, fraud_hold boolean, created_by text, updated_by text);`);

  // ── The EXACT hardened RLS + grants (mirrors the migrations' final statements) ──
  for (const t of ['diaspora_subscriptions','diaspora_user_entitlement_overrides','diaspora_safetrade_transactions','diaspora_safetrade_milestones','diaspora_safetrade_release_evaluations','diaspora_safetrade_disputes']) {
    await admin.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`CREATE POLICY ${t}_read ON public.${t} FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))`);
    await admin.query(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC`);
    await admin.query(`GRANT SELECT ON TABLE public.${t} TO authenticated`);
    await admin.query(`REVOKE INSERT, UPDATE, DELETE ON TABLE public.${t} FROM authenticated`);
    await admin.query(`GRANT ALL ON TABLE public.${t} TO service_role`);
  }
  // A service-only RPC (models diaspora_reserve_usage_atomic / safetrade RPC ACL posture).
  await admin.query(`CREATE FUNCTION public.diaspora_reserve_usage_atomic() RETURNS text LANGUAGE sql AS $$ SELECT 'reserved' $$;`);
  await admin.query(`REVOKE ALL ON FUNCTION public.diaspora_reserve_usage_atomic() FROM PUBLIC`);
  await admin.query(`REVOKE ALL ON FUNCTION public.diaspora_reserve_usage_atomic() FROM anon`);
  await admin.query(`REVOKE ALL ON FUNCTION public.diaspora_reserve_usage_atomic() FROM authenticated`);
  await admin.query(`GRANT EXECUTE ON FUNCTION public.diaspora_reserve_usage_atomic() TO service_role`);

  // ── Seed (as postgres/owner, bypasses RLS) ──
  const TA = '11111111-1111-1111-1111-111111111111', TB = '22222222-2222-2222-2222-222222222222';
  await admin.query(`INSERT INTO users(id,role) VALUES ('memberA','buyer'),('memberB','buyer'),('adminX','admin')`);
  await admin.query(`INSERT INTO tenant_users(user_id,tenant_id) VALUES ('memberA',$1),('memberB',$2)`, [TA, TB]);
  await admin.query(`INSERT INTO diaspora_subscriptions(tenant_id,plan_key,status,created_by) VALUES ($1,'pro','ACTIVE','system')`, [TA]);
  await admin.query(`INSERT INTO diaspora_safetrade_transactions(tenant_id,status,created_by) VALUES ($1,'INITIATED','system')`, [TA]);
  await admin.query(`INSERT INTO diaspora_safetrade_milestones(tenant_id,status,created_by) VALUES ($1,'PENDING','system')`, [TA]);
  await admin.query(`INSERT INTO diaspora_safetrade_disputes(tenant_id,status,fraud_hold,created_by) VALUES ($1,'OPEN',false,'system')`, [TA]);

  // ═══ Phase 8 negative cases ═══
  let r;
  r = await asRole(url, 'authenticated', 'memberA', `SELECT count(*)::int c FROM diaspora_subscriptions WHERE tenant_id='${TA}'`);
  rec('P8: tenant member CAN SELECT own-tenant subscription', r.ok && r.rows[0].c === 1, r.ok ? `rows=${r.rows[0].c}` : r.msg);
  r = await asRole(url, 'authenticated', 'memberB', `SELECT count(*)::int c FROM diaspora_subscriptions WHERE tenant_id='${TA}'`);
  rec('P8: cross-tenant member SELECT of tenant-A subscription returns 0 rows (RLS)', r.ok && r.rows[0].c === 0, r.ok ? `rows=${r.rows[0].c}` : r.msg);
  r = await asRole(url, 'authenticated', 'memberA', `INSERT INTO diaspora_subscriptions(tenant_id,plan_key,status,created_by) VALUES ('${TA}','enterprise','ACTIVE','memberA')`);
  rec('P8: tenant member CANNOT INSERT a subscription (grant denied)', !r.ok && r.code === '42501', r.ok ? 'INSERT unexpectedly allowed' : r.code);
  r = await asRole(url, 'authenticated', 'memberA', `UPDATE diaspora_subscriptions SET plan_key='enterprise', status='ACTIVE' WHERE tenant_id='${TA}'`);
  rec('P8: tenant member CANNOT UPDATE plan_key/status (grant denied)', !r.ok && r.code === '42501', r.ok ? 'UPDATE unexpectedly allowed' : r.code);
  r = await asRole(url, 'authenticated', 'memberA', `INSERT INTO diaspora_user_entitlement_overrides(tenant_id,feature_key,created_by) VALUES ('${TA}','safetrade','memberA')`);
  rec('P8: tenant member CANNOT create an entitlement override (grant denied)', !r.ok && r.code === '42501', r.ok ? 'override INSERT unexpectedly allowed' : r.code);
  r = await asRole(url, 'authenticated', 'memberA', `SELECT public.diaspora_reserve_usage_atomic()`);
  rec('P8: authenticated CANNOT execute the usage-mutation RPC (execute denied)', !r.ok && r.code === '42501', r.ok ? 'RPC unexpectedly executable' : r.code);
  r = await asRole(url, 'anon', null, `SELECT public.diaspora_reserve_usage_atomic()`);
  rec('P8: anon CANNOT execute the usage-mutation RPC (execute denied)', !r.ok && r.code === '42501', r.ok ? 'RPC unexpectedly executable' : r.code);

  // ═══ Phase 9 negative cases ═══
  r = await asRole(url, 'authenticated', 'memberA', `SELECT count(*)::int c FROM diaspora_safetrade_transactions WHERE tenant_id='${TA}'`);
  rec('P9: participant CAN SELECT an allowed SafeTrade transaction', r.ok && r.rows[0].c === 1, r.ok ? `rows=${r.rows[0].c}` : r.msg);
  r = await asRole(url, 'authenticated', 'memberA', `UPDATE diaspora_safetrade_transactions SET status='RELEASED' WHERE tenant_id='${TA}'`);
  rec('P9: participant CANNOT set transaction status RELEASED (grant denied)', !r.ok && r.code === '42501', r.ok ? 'UPDATE unexpectedly allowed' : r.code);
  r = await asRole(url, 'authenticated', 'memberA', `UPDATE diaspora_safetrade_milestones SET status='RELEASED' WHERE tenant_id='${TA}'`);
  rec('P9: participant CANNOT change milestone status (grant denied)', !r.ok && r.code === '42501', r.ok ? 'UPDATE unexpectedly allowed' : r.code);
  r = await asRole(url, 'authenticated', 'memberA', `INSERT INTO diaspora_safetrade_release_evaluations(tenant_id,eligible,created_by) VALUES ('${TA}',true,'memberA')`);
  rec('P9: participant CANNOT forge an eligible=true release evaluation (grant denied)', !r.ok && r.code === '42501', r.ok ? 'eval INSERT unexpectedly allowed' : r.code);
  r = await asRole(url, 'authenticated', 'memberA', `UPDATE diaspora_safetrade_disputes SET status='RESOLVED', fraud_hold=true WHERE tenant_id='${TA}'`);
  rec('P9: participant CANNOT set dispute status/fraud_hold (grant denied)', !r.ok && r.code === '42501', r.ok ? 'dispute UPDATE unexpectedly allowed' : r.code);
  r = await asRole(url, 'authenticated', 'memberB', `SELECT count(*)::int c FROM diaspora_safetrade_transactions WHERE tenant_id='${TA}'`);
  rec('P9: cross-tenant participant SELECT of tenant-A transaction returns 0 (RLS)', r.ok && r.rows[0].c === 0, r.ok ? `rows=${r.rows[0].c}` : r.msg);

  // ═══ service_role positive cases (writes must succeed) ═══
  r = await asRole(url, 'service_role', null, `UPDATE diaspora_safetrade_transactions SET status='RELEASED' WHERE tenant_id='${TA}'`);
  rec('service_role CAN write the money table (backend path succeeds)', r.ok && r.rowCount === 1, r.ok ? `updated=${r.rowCount}` : r.msg);
  r = await asRole(url, 'service_role', null, `SELECT public.diaspora_reserve_usage_atomic()`);
  rec('service_role CAN execute the usage-mutation RPC', r.ok, r.ok ? 'ok' : r.msg);

  await admin.end(); await epg.stop();
  const passed = results.filter((x) => x.ok).length;
  console.log(`\n════ PHASE 8/9 ACL PROOF: ${passed}/${results.length} passed ════`);
  if (passed !== results.length) process.exit(1);
}
main().catch(async (e) => { console.error('HARNESS ERROR:', e.message); try { await epg.stop(); } catch {} process.exit(2); });
