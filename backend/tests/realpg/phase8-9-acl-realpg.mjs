// Real-Postgres ACL proof for the Phase 8 / 9 / 10 client-role boundary (2026-07-18, extended
// 2026-07-26 for ledger #19).
//
// Boots a REAL embedded Postgres, creates the real anon / authenticated / service_role roles and the
// real diaspora_trade_os_* SECURITY DEFINER helper functions (verbatim contract from the phase1b
// foundation migration), and — critically — models Supabase's DEFAULT PRIVILEGES: on Supabase, every
// new public-schema table is granted directly to anon/authenticated/service_role (not via PUBLIC).
// The 2026-07-18 version of this harness omitted that, so `REVOKE ... FROM PUBLIC` in the Phase
// 8/9/10 migrations looked sufficient here while anon kept FULL grants on the live databases.
//
// It then proves, in order:
//   1. THE GAP: with Supabase default grants modeled, the Phase 8/9/10 migrations' own statements
//      leave anon with table privileges on all 19 tables (reproduces the production finding).
//   2. REGRESSION PROOF: on a control table, `REVOKE ALL ... FROM PUBLIC` alone does NOT remove the
//      direct anon/authenticated grants — the #19 gate would fail without direct role revokes.
//   3. THE FIX: applying the REAL ledger #19 file (20260726120000_diaspora_phase8_9_10_client_grant_
//      hardening.sql, Up block, verbatim) yields the exact contract on every table: anon=NONE,
//      authenticated=SELECT-only, service_role retains SELECT/INSERT/UPDATE/DELETE, RLS still
//      enabled, pg_policies byte-identical before vs after (#19 must not touch policies).
//   4. BEHAVIOR: the original Phase 8/9 negative/positive cases still hold post-#19 (authenticated
//      cannot write money tables or execute service RPCs; cross-tenant SELECT is 0 rows;
//      service_role writes succeed) plus anon SELECT/INSERT now fail at the GRANT layer (42501).
//
// This proves the GRANT + RLS posture the migrations declare. It is NOT staging (see README) — it is a
// real-Postgres authorization proof of the SQL, standalone (not part of CI `node --test`).
import EmbeddedPostgres from 'embedded-postgres';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DATA_DIR = fileURLToPath(new URL('./.pgdata-acl', import.meta.url));
const MIGRATION_19 = fileURLToPath(new URL(
  '../../../database/migrations/20260726120000_diaspora_phase8_9_10_client_grant_hardening.sql', import.meta.url));
const PORT = 54398;
const results = [];
const rec = (name, ok, detail) => { results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// The exact 19 tables ledger #19 hardens (6 Phase 8, 6 Phase 9, 7 Phase 10).
const P19_TABLES = [
  'diaspora_subscriptions', 'diaspora_subscription_plans', 'diaspora_user_entitlement_overrides',
  'diaspora_usage_meters', 'diaspora_usage_reservations', 'diaspora_billing_provider_events',
  'diaspora_safetrade_transactions', 'diaspora_safetrade_milestones', 'diaspora_safetrade_release_evaluations',
  'diaspora_safetrade_disputes', 'diaspora_safetrade_dispute_evidence', 'diaspora_safetrade_delivery_confirmations',
  'trade_graph_nodes', 'trade_graph_edges', 'trade_graph_materialized_summaries',
  'trade_graph_projection_checkpoints', 'trade_graph_processed_events', 'trade_graph_dead_letters',
  'trade_graph_rebuilds',
];

const epg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false });

// Run `sql` as `role` with request.jwt.claim.sub = `sub`, inside a txn; returns {ok, err}.
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

// Distinct table privileges information_schema reports for `grantee` on public.`table`.
// privilege_type is an information_schema DOMAIN — cast to text so node-pg parses a real array.
async function privs(admin, table, grantee) {
  const r = await admin.query(
    `SELECT array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) p FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name=$1 AND grantee=$2`, [table, grantee]);
  return r.rows[0].p ?? [];
}

// Canonical serialization of every policy on the 19 tables (name, cmd, roles, qual, with_check).
async function policySnapshot(admin) {
  const r = await admin.query(
    `SELECT tablename, policyname, cmd, roles::text, coalesce(qual,'-') qual, coalesce(with_check,'-') wc
     FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1) ORDER BY tablename, policyname`, [P19_TABLES]);
  return JSON.stringify(r.rows);
}

async function main() {
  await epg.initialise(); await epg.start(); await epg.createDatabase('acldb');
  const url = `postgres://postgres:postgres@127.0.0.1:${PORT}/acldb`;
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  admin.on('error', () => {}); // benign 57P01 when epg.stop() runs on the failure path
  rec('real Postgres booted', true, (await admin.query('show server_version')).rows[0].server_version);

  // ── Roles (Supabase's three) + schema usage. service_role has BYPASSRLS exactly as Supabase
  //    configures it — the backend service client is the trusted mutation path that bypasses RLS. ──
  for (const r of ['anon', 'authenticated', 'service_role']) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${r}') THEN CREATE ROLE ${r} NOLOGIN; END IF; END $$;`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  }
  await admin.query(`ALTER ROLE service_role BYPASSRLS`);

  // ── Supabase DEFAULT PRIVILEGES model: every table created from here on is granted DIRECTLY to
  //    anon/authenticated/service_role, exactly as on a real Supabase project. This is the mechanism
  //    the 2026-07-18 harness missed and the reason REVOKE-FROM-PUBLIC-only migrations leaked. ──
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role`);

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

  // ── Minimal skeletons for ALL 19 #19 tables, carrying the columns the predicates/tests touch ──
  await admin.query(`
    CREATE TABLE public.diaspora_subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, plan_key text, status text, created_by text, updated_by text);
    CREATE TABLE public.diaspora_subscription_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_key text, tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.diaspora_user_entitlement_overrides (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, feature_key text, created_by text, updated_by text);
    CREATE TABLE public.diaspora_usage_meters (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.diaspora_usage_reservations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.diaspora_billing_provider_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_milestones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_release_evaluations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, eligible boolean, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, status text, fraud_hold boolean, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_dispute_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.diaspora_safetrade_delivery_confirmations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.trade_graph_nodes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.trade_graph_edges (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.trade_graph_materialized_summaries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.trade_graph_projection_checkpoints (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.trade_graph_processed_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.trade_graph_dead_letters (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);
    CREATE TABLE public.trade_graph_rebuilds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, created_by text, updated_by text);`);

  // ── The migrations' OWN final grant/policy statements, mirrored FAITHFULLY per phase: an
  //    authenticated SELECT policy per table, REVOKE PUBLIC, GRANT SELECT to authenticated,
  //    service_role ALL — and the authenticated INSERT/UPDATE/DELETE revoke ONLY on the six Phase 9
  //    SafeTrade tables, because only #13/#14 shipped that statement (#12 and #15 did not).
  //    Deliberately NO direct anon revoke anywhere — that is exactly what shipped, and what #19
  //    compensates. ──
  const P9_TABLES = P19_TABLES.filter((t) => t.startsWith('diaspora_safetrade_'));
  for (const t of P19_TABLES) {
    await admin.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`CREATE POLICY ${t}_read ON public.${t} FOR SELECT TO authenticated USING (public.diaspora_trade_os_can_access_row(tenant_id, created_by, updated_by))`);
    await admin.query(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC`);
    await admin.query(`GRANT SELECT ON TABLE public.${t} TO authenticated`);
    if (P9_TABLES.includes(t)) await admin.query(`REVOKE INSERT, UPDATE, DELETE ON TABLE public.${t} FROM authenticated`);
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

  // ═══ 1. THE GAP: the shipped statements leave anon privileged on all 19 tables, and
  //        authenticated with write grants on the 13 Phase 8/10 tables (#12/#15 never revoked them) ═══
  let leaking = 0;
  for (const t of P19_TABLES) if ((await privs(admin, t, 'anon')).length > 0) leaking += 1;
  rec('GAP REPRODUCED: with Supabase default grants, shipped migrations leave anon privileged on all 19 tables',
    leaking === P19_TABLES.length, `${leaking}/${P19_TABLES.length} leaking pre-#19`);
  let authWriteLeaks = 0;
  for (const t of P19_TABLES.filter((x) => !P9_TABLES.includes(x))) {
    if ((await privs(admin, t, 'authenticated')).includes('INSERT')) authWriteLeaks += 1;
  }
  rec('GAP REPRODUCED: authenticated retains write grants on all 13 Phase 8/10 tables pre-#19',
    authWriteLeaks === 13, `${authWriteLeaks}/13 with INSERT pre-#19`);

  // ═══ 2. REGRESSION PROOF: REVOKE FROM PUBLIC alone would NOT pass the #19 gate ═══
  await admin.query(`CREATE TABLE public.acl_regression_control (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`);
  await admin.query(`REVOKE ALL ON TABLE public.acl_regression_control FROM PUBLIC`);
  const controlAnon = await privs(admin, 'acl_regression_control', 'anon');
  rec('REGRESSION PROOF: REVOKE ALL FROM PUBLIC alone leaves direct anon grants (old approach fails the gate)',
    controlAnon.length > 0, `anon still holds: ${controlAnon.join(',') || 'none'}`);
  await admin.query(`DROP TABLE public.acl_regression_control`);

  // ═══ 3. THE FIX: apply the REAL ledger #19 file, verbatim Up block, one transaction ═══
  const migSql = readFileSync(MIGRATION_19, 'utf8');
  const migSum = createHash('sha256').update(migSql).digest('hex').slice(0, 12);
  const up = migSql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  const policiesBefore = await policySnapshot(admin);
  await admin.query('BEGIN'); await admin.query(up); await admin.query('COMMIT');
  rec(`ledger #19 applied verbatim (sha256:12=${migSum})`, true);
  // Idempotency: a second application must succeed and change nothing.
  await admin.query('BEGIN'); await admin.query(up); await admin.query('COMMIT');
  rec('#19 is idempotent (second application succeeds)', true);
  rec('#19 leaves pg_policies byte-identical (no policy was touched)', (await policySnapshot(admin)) === policiesBefore);

  // Post-#19 ACL contract on every table: anon=NONE, authenticated=SELECT-only, service_role
  // retains CRUD, RLS still enabled — plus PG17 MAINTAIN, which information_schema CANNOT report,
  // checked explicitly via has_table_privilege (an enumerated revoke would have left it behind).
  let anonClean = 0, authSelectOnly = 0, svcOk = 0, rlsOn = 0, maintainClean = 0;
  for (const t of P19_TABLES) {
    if ((await privs(admin, t, 'anon')).length === 0) anonClean += 1;
    const a = await privs(admin, t, 'authenticated');
    if (a.length === 1 && a[0] === 'SELECT') authSelectOnly += 1;
    const s = await privs(admin, t, 'service_role');
    if (['DELETE', 'INSERT', 'SELECT', 'UPDATE'].every((p) => s.includes(p))) svcOk += 1;
    if ((await admin.query(`SELECT relrowsecurity r FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`, [t])).rows[0].r) rlsOn += 1;
    const m = (await admin.query(
      `SELECT has_table_privilege('anon','public.'||$1::text,'MAINTAIN') a, has_table_privilege('authenticated','public.'||$1::text,'MAINTAIN') b`, [t])).rows[0];
    if (!m.a && !m.b) maintainClean += 1;
  }
  rec('post-#19: anon has ZERO table privileges on all 19 tables', anonClean === 19, `${anonClean}/19`);
  rec('post-#19: authenticated is exactly SELECT-only on all 19 tables', authSelectOnly === 19, `${authSelectOnly}/19`);
  rec('post-#19: service_role retains SELECT/INSERT/UPDATE/DELETE on all 19 tables', svcOk === 19, `${svcOk}/19`);
  rec('post-#19: RLS remains enabled on all 19 tables', rlsOn === 19, `${rlsOn}/19`);
  rec('post-#19: PG17 MAINTAIN revoked from anon+authenticated on all 19 tables (invisible to information_schema)',
    maintainClean === 19, `${maintainClean}/19`);

  // ═══ 4. BEHAVIOR (all post-#19) ═══
  let r;
  r = await asRole(url, 'anon', null, `SELECT count(*) FROM diaspora_subscriptions`);
  rec('anon SELECT on a #19 table now fails at the GRANT layer', !r.ok && r.code === '42501', r.ok ? 'SELECT unexpectedly allowed' : r.code);
  r = await asRole(url, 'anon', null, `INSERT INTO diaspora_safetrade_transactions(tenant_id,status,created_by) VALUES ('${TA}','X','anon')`);
  rec('anon INSERT on a #19 table fails at the GRANT layer', !r.ok && r.code === '42501', r.ok ? 'INSERT unexpectedly allowed' : r.code);
  r = await asRole(url, 'authenticated', 'memberA', `TRUNCATE diaspora_subscriptions`);
  rec('authenticated TRUNCATE denied (grant removed by #19)', !r.ok && r.code === '42501', r.ok ? 'TRUNCATE unexpectedly allowed' : r.code);

  // ═══ Phase 8 negative cases ═══
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

  // ═══ Ledger #20: diaspora_oauth_states (H6 shipped RLS-enable ONLY — no grants, no policies;
  //     every privilege came from Supabase default grants; contract is anon=NONE,
  //     authenticated=NONE, service_role full, zero policies) ═══
  await admin.query(`CREATE TABLE public.diaspora_oauth_states (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), state_hash text, expires_at timestamptz)`);
  await admin.query(`ALTER TABLE public.diaspora_oauth_states ENABLE ROW LEVEL SECURITY`); // exactly what #10 shipped
  rec('#20 GAP REPRODUCED: default grants leave anon privileged on diaspora_oauth_states',
    (await privs(admin, 'diaspora_oauth_states', 'anon')).length > 0);
  const MIGRATION_20 = fileURLToPath(new URL(
    '../../../database/migrations/20260727090000_diaspora_oauth_states_client_grant_hardening.sql', import.meta.url));
  const mig20 = readFileSync(MIGRATION_20, 'utf8');
  const up20 = mig20.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  await admin.query('BEGIN'); await admin.query(up20); await admin.query('COMMIT');
  await admin.query('BEGIN'); await admin.query(up20); await admin.query('COMMIT');
  rec(`#20 applied verbatim + idempotent (sha256:12=${createHash('sha256').update(mig20).digest('hex').slice(0, 12)})`, true);
  const oaAnon = await privs(admin, 'diaspora_oauth_states', 'anon');
  const oaAuth = await privs(admin, 'diaspora_oauth_states', 'authenticated');
  const oaSvc = await privs(admin, 'diaspora_oauth_states', 'service_role');
  const oaMaint = (await admin.query(
    `SELECT has_table_privilege('anon','public.diaspora_oauth_states','MAINTAIN') a, has_table_privilege('authenticated','public.diaspora_oauth_states','MAINTAIN') b`)).rows[0];
  const oaRls = (await admin.query(`SELECT relrowsecurity r FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='diaspora_oauth_states'`)).rows[0].r;
  const oaPols = (await admin.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename='diaspora_oauth_states'`)).rows[0].n;
  rec('post-#20: anon has ZERO privileges on diaspora_oauth_states', oaAnon.length === 0);
  rec('post-#20: authenticated has ZERO privileges on diaspora_oauth_states', oaAuth.length === 0);
  rec('post-#20: service_role retains CRUD on diaspora_oauth_states', ['DELETE', 'INSERT', 'SELECT', 'UPDATE'].every((p) => oaSvc.includes(p)));
  rec('post-#20: MAINTAIN absent from client roles', !oaMaint.a && !oaMaint.b);
  rec('post-#20: RLS enabled, zero policies (default-deny) unchanged', oaRls && oaPols === 0);
  r = await asRole(url, 'anon', null, `SELECT count(*) FROM diaspora_oauth_states`);
  rec('#20: anon SELECT denied at the GRANT layer', !r.ok && r.code === '42501', r.ok ? 'unexpectedly allowed' : r.code);
  r = await asRole(url, 'authenticated', 'memberA', `SELECT count(*) FROM diaspora_oauth_states`);
  rec('#20: authenticated SELECT denied at the GRANT layer', !r.ok && r.code === '42501', r.ok ? 'unexpectedly allowed' : r.code);
  r = await asRole(url, 'service_role', null, `INSERT INTO diaspora_oauth_states(state_hash) VALUES ('h')`);
  rec('#20: service_role CAN write the nonce store', r.ok && r.rowCount === 1, r.ok ? 'ok' : r.msg);

  await admin.end(); await epg.stop();
  const passed = results.filter((x) => x.ok).length;
  console.log(`\n════ PHASE 8/9/10 ACL + #19/#20 PROOF: ${passed}/${results.length} passed ════`);
  if (passed !== results.length) process.exit(1);
}
main().catch(async (e) => { console.error('HARNESS ERROR:', e.message); try { await epg.stop(); } catch {} process.exit(2); });
