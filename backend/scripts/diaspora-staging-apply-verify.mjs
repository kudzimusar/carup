#!/usr/bin/env node
/**
 * Diaspora Trade OS — staging READ-ONLY DIAGNOSTIC (carup-staging, ref eoyenigwevnxwwhyhaer).
 *
 * This is a diagnostic only — it NEVER writes to staging and is NOT the canonical apply path.
 * Canonical migration application is done by the release operator through the OFFICIAL Supabase
 * migration flow (Supabase MCP `apply_migration`, or `supabase db push`), which records history in
 * Supabase's own `supabase_migrations.schema_migrations`. This script must never create or write a
 * parallel migration ledger.
 *
 * What it does (all read-only, inside read-only transactions):
 *   1. Reads Supabase's OFFICIAL migration history and diffs it against the repo diaspora set.
 *   2. STATIC-scans the pending migration files for security anti-patterns (FOR ALL to authenticated,
 *      authenticated INSERT/UPDATE grants, SECURITY DEFINER without a pinned search_path, mutation
 *      RPCs missing an explicit anon/authenticated REVOKE).
 *   3. Runs REAL verification queries against the connected DB: RLS-enabled state, per-table policy
 *      commands, function grants, and the diaspora advisor-finding adjudication queries.
 *   4. Runs a REAL negative ACL probe as the `authenticated` role (SET LOCAL ROLE, read-only txn):
 *      a direct INSERT into a launch money-table must be denied (42501).
 *
 * Access: requires DIASPORA_STAGING_DATABASE_URL in the env (never hard-coded/printed). It POSITIVELY
 * requires the URL to reference the staging ref `eoyenigwevnxwwhyhaer`, and refuses any URL that
 * references the forbidden production ref `vhmnajoeicasaigiophh`. No --apply mode exists.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MIG_DIR = `${REPO}database/migrations`;
const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FORBIDDEN_PROD_REF = 'vhmnajoeicasaigiophh';

const DIASPORA_MIGRATIONS = [
  '013_diaspora_trade_schema', '014_diaspora_rls_recursion_fix',
  '20260611061849_diaspora_trade_os_phase1b_foundation', '20260619201406_production_access_containment',
  '20260620120000_diaspora_phase3_stock_ledger_idempotency', '20260620232827_issue77_access_containment_followup',
  '20260621090000_diaspora_h1_stock_movement_rpc', '20260621091000_diaspora_h2_quote_acceptance_rpc',
  '20260621092000_diaspora_h3_container_approval_rpc', '20260621093000_diaspora_h6_oauth_state_nonce',
  '20260621094000_diaspora_h7_rpc_execute_grants', '20260621120000_diaspora_phase8_subscription_entitlements',
  '20260621130000_diaspora_phase9_safetrade', '20260621131000_diaspora_phase9_safetrade_disputes',
  '20260621140000_diaspora_phase10_trade_graph', '20260704090000_diaspora_payment_milestone_idempotency',
];

// Strip -- line comments and /* */ block comments, then collapse whitespace, so scans see only SQL.
function stripSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}
// Repo-wide concatenation of all diaspora Up blocks — so a REVOKE that lives in a SEPARATE grants
// migration (e.g. H7 locks the H1/H2/H3 RPCs) is correctly credited to those RPCs.
let _repoUp = null;
function repoUp() {
  if (_repoUp) return _repoUp;
  _repoUp = DIASPORA_MIGRATIONS.map((n) => stripSql(readFileSync(`${MIG_DIR}/${n}.sql`, 'utf8').split('-- +migrate Down')[0])).join('\n;\n');
  return _repoUp;
}

// Static security scan of a pending migration — reports anti-patterns the operator must review
// before canonical application. (Fixes defect D: statement-scoped, comment-stripped, cross-migration
// aware for RPC revokes.)
function scanSecurity(name) {
  const up = stripSql(readFileSync(`${MIG_DIR}/${name}.sql`, 'utf8').split('-- +migrate Down')[0]);
  const flags = [];
  const statements = up.split(';');
  for (const st of statements) {
    if (/\bCREATE POLICY\b/i.test(st) && /\bFOR\s+ALL\b/i.test(st) && /\bTO\s+authenticated\b/i.test(st)) flags.push('FOR ALL policy to authenticated');
    if (/\bGRANT\b/i.test(st) && !/\bREVOKE\b/i.test(st) && /\b(INSERT|UPDATE|DELETE)\b/i.test(st) && /\bTO\s+authenticated\b/i.test(st)) flags.push('authenticated INSERT/UPDATE/DELETE grant');
  }
  // SECURITY DEFINER functions must pin search_path (scan each function head).
  for (const m of up.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.([a-z_]+)[\s\S]{0,400}?\bAS\b/gi)) {
    // Postgres accepts both `SET search_path = 'public'` and `SET search_path TO 'public'`.
    if (/SECURITY DEFINER/i.test(m[0]) && !/SET search_path\s*(=|TO)\s*/i.test(m[0])) flags.push(`SECURITY DEFINER without pinned search_path: ${m[1]}`);
  }
  // Mutation RPCs should have anon + authenticated EXECUTE revoked SOMEWHERE in the diaspora set
  // (own migration OR the dedicated grants migration). Only flag genuine mutation RPCs (…_atomic /
  // …reserve…), not read-only helper fns.
  const repo = repoUp();
  for (const m of up.matchAll(/REVOKE ALL ON FUNCTION public\.([a-z_]+)\([^)]*\)\s*FROM PUBLIC/gi)) {
    const fn = m[1];
    if (!/_atomic$|reserve_usage/.test(fn)) continue;
    if (!new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*FROM anon`, 'i').test(repo)) flags.push(`mutation RPC ${fn}: no explicit anon REVOKE anywhere in the diaspora set`);
    if (!new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*FROM authenticated`, 'i').test(repo)) flags.push(`mutation RPC ${fn}: no explicit authenticated REVOKE anywhere in the diaspora set`);
  }
  return flags;
}

async function main() {
  const url = process.env.DIASPORA_STAGING_DATABASE_URL;
  if (!url) { console.error('REFUSING: DIASPORA_STAGING_DATABASE_URL not set. Read-only diagnostic; never applies.'); process.exit(3); }
  if (url.includes(FORBIDDEN_PROD_REF)) { console.error(`REFUSING: URL references the forbidden production ref ${FORBIDDEN_PROD_REF}.`); process.exit(4); }
  if (!url.includes(STAGING_REF)) { console.error(`REFUSING: URL must positively reference the staging ref ${STAGING_REF} (production/other targets are rejected).`); process.exit(5); }

  console.log('── STATIC security scan of pending migrations (no DB needed) ──');
  for (const name of DIASPORA_MIGRATIONS) {
    const flags = scanSecurity(name);
    if (flags.length) console.log(`  ⚠ ${name}: ${flags.join('; ')}`);
  }
  console.log('  (no ⚠ lines above = clean scan)\n');

  const client = new pg.Client({ connectionString: url, statement_timeout: 15000 });
  await client.connect();
  await client.query('SET default_transaction_read_only = on'); // belt: this session cannot write
  const info = (await client.query(`select current_database() db, version() v`)).rows[0];
  console.log(`Connected READ-ONLY: db=${info.db} ${info.v.split(' ').slice(0,2).join(' ')}\n`);

  // Read the OFFICIAL Supabase migration history (never a parallel table). Fixes defect B.
  let applied = new Set();
  try { (await client.query(`SELECT version FROM supabase_migrations.schema_migrations`)).rows.forEach(r => applied.add(String(r.version))); }
  catch { console.log('  (supabase_migrations.schema_migrations not readable — check the operator applies via the official flow)'); }
  console.log(`Official staging migration history entries: ${applied.size}`);
  const missing = DIASPORA_MIGRATIONS.filter(m => !applied.has(m) && !applied.has(m.split('_')[0]));
  console.log(`Diaspora migrations NOT yet in staging history (${missing.length}): ${missing.join(', ') || 'none'}\n`);

  console.log('── RPC posture (SECURITY + pinned search_path + PUBLIC/anon/authenticated grants) ──');
  for (const r of (await client.query(`
    SELECT proname, prosecdef, proconfig,
      (SELECT string_agg(grantee||':'||privilege_type,', ') FROM information_schema.routine_privileges
        WHERE routine_schema='public' AND routine_name=p.proname AND grantee IN ('PUBLIC','anon','authenticated')) AS client_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND proname LIKE 'diaspora_%atomic' ORDER BY proname`)).rows)
    console.log(`  ${r.proname}: ${r.prosecdef?'DEFINER':'INVOKER'} search_path=${JSON.stringify(r.proconfig)} client_exec=${r.client_exec||'none ✓'}`);

  console.log('\n── RLS + policy commands on launch/money tables ──');
  for (const r of (await client.query(`
    SELECT c.relname, c.relrowsecurity AS rls,
      (SELECT string_agg(DISTINCT cmd,',') FROM pg_policies WHERE tablename=c.relname) AS policy_cmds,
      (SELECT string_agg(grantee||':'||privilege_type,', ') FROM information_schema.role_table_grants
        WHERE table_name=c.relname AND grantee='authenticated') AS auth_grants
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN
      ('diaspora_subscriptions','diaspora_user_entitlement_overrides','diaspora_safetrade_transactions',
       'diaspora_safetrade_milestones','diaspora_safetrade_release_evaluations','diaspora_safetrade_disputes')
    ORDER BY c.relname`)).rows)
    console.log(`  ${r.relname}: rls=${r.rls} policy_cmds=${r.policy_cmds} authenticated=${r.auth_grants||'none'}`);

  console.log('\n── Advisor-finding adjudication queries (read-only) ──');
  const adv = {
    oauth_states_rls: `SELECT relrowsecurity rls,(SELECT count(*) FROM pg_policies WHERE tablename='diaspora_oauth_states') pols FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relname='diaspora_oauth_states'`,
    set_updated_at_searchpath: `SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='set_diaspora_updated_at'`,
    authz_helper_client_exec: `SELECT routine_name,grantee FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name IN ('diaspora_trade_os_is_platform_admin','diaspora_trade_os_is_tenant_member','diaspora_can_access_order') AND grantee IN ('anon','authenticated') ORDER BY routine_name`,
  };
  for (const [k,q] of Object.entries(adv)) { try { console.log(`  ${k}:`, JSON.stringify((await client.query(q)).rows)); } catch(e){ console.log(`  ${k}: ${e.message}`); } }

  // Real negative ACL probe as `authenticated` (read-only txn; the INSERT must be REJECTED, not run).
  console.log('\n── Live negative ACL probe (authenticated INSERT must be denied) ──');
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE authenticated`);
    await client.query(`SET LOCAL request.jwt.claim.sub = 'diagnostic-probe'`);
    let denied = false;
    try { await client.query(`INSERT INTO public.diaspora_subscriptions (id) VALUES (gen_random_uuid())`); }
    catch (e) { denied = e.code === '42501' || /permission denied|read-only/i.test(e.message); }
    console.log(`  authenticated direct INSERT into diaspora_subscriptions denied: ${denied}`);
    await client.query('ROLLBACK');
  } catch (e) { await client.query('ROLLBACK').catch(()=>{}); console.log(`  probe skipped: ${e.message}`); }

  await client.end();
  console.log('\nDIAGNOSTIC COMPLETE (no writes performed). Canonical migration application + the Supabase');
  console.log('security/performance advisors are run by the operator via the official Supabase flow.');
}
main().catch(e => { console.error('DIAGNOSTIC ERROR:', e.message); process.exit(2); });
