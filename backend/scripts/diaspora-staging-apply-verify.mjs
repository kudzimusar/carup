#!/usr/bin/env node
/**
 * Diaspora Trade OS — staging apply + verify runner (carup-staging, ref eoyenigwevnxwwhyhaer).
 *
 * Implements the completion-loop staging steps against the ACTUAL staging Postgres via a direct
 * connection — for use in an execution environment that HAS staging access (the Supabase MCP
 * connector, or a DB URL). It does NOT invent access: it requires DIASPORA_STAGING_DATABASE_URL
 * (a service-role/owner Postgres URL for carup-staging) in the environment. Never hard-code or print
 * the secret; pass it via env only.
 *
 *   Dry-run (default — reads history, diffs vs repo, prints plan, NO writes):
 *     DIASPORA_STAGING_DATABASE_URL=... node backend/scripts/diaspora-staging-apply-verify.mjs
 *   Apply the verified-missing migrations, then verify + adjudicate advisors:
 *     DIASPORA_STAGING_DATABASE_URL=... node backend/scripts/diaspora-staging-apply-verify.mjs --apply
 *
 * Safety: refuses to run against production (rejects a URL whose host/db matches the forbidden prod
 * ref vhmnajoeicasaigiophh). Never reapplies a recorded migration. Stops on first migration failure.
 * Production (CarUp / vhmnajoeicasaigiophh) must remain read-only — this script never targets it.
 */
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MIG_DIR = `${REPO}database/migrations`;
const APPLY = process.argv.includes('--apply');
const FORBIDDEN_PROD_REF = 'vhmnajoeicasaigiophh';

// The diaspora migrations that must exist on staging, in dependency order (matches the ledger).
const DIASPORA_MIGRATIONS = [
  '013_diaspora_trade_schema',
  '014_diaspora_rls_recursion_fix',
  '20260611061849_diaspora_trade_os_phase1b_foundation',
  '20260619201406_production_access_containment',
  '20260620120000_diaspora_phase3_stock_ledger_idempotency',
  '20260620232827_issue77_access_containment_followup',
  '20260621090000_diaspora_h1_stock_movement_rpc',
  '20260621091000_diaspora_h2_quote_acceptance_rpc',
  '20260621092000_diaspora_h3_container_approval_rpc',
  '20260621093000_diaspora_h6_oauth_state_nonce',
  '20260621094000_diaspora_h7_rpc_execute_grants',
  '20260621120000_diaspora_phase8_subscription_entitlements',
  '20260621130000_diaspora_phase9_safetrade',
  '20260621131000_diaspora_phase9_safetrade_disputes',
  '20260621140000_diaspora_phase10_trade_graph',
  '20260704090000_diaspora_payment_milestone_idempotency',
];

// The five diaspora advisor findings the loop must explicitly adjudicate (intended vs defect).
const ADVISOR_QUERIES = {
  'diaspora_oauth_states RLS-enabled + policy count': `
    SELECT c.relrowsecurity AS rls_enabled,
           (SELECT count(*) FROM pg_policies p WHERE p.tablename='diaspora_oauth_states') AS policy_count,
           (SELECT string_agg(grantee||':'||privilege_type, ', ')
              FROM information_schema.role_table_grants
             WHERE table_name='diaspora_oauth_states' AND grantee IN ('anon','authenticated','PUBLIC')) AS client_grants
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='diaspora_oauth_states'`,
  'set_diaspora_updated_at search_path': `
    SELECT proname, proconfig, prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND proname='set_diaspora_updated_at'`,
  'authz helper EXECUTE grants (anon/authenticated must not hold where intended service-only)': `
    SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges
    WHERE routine_schema='public'
      AND routine_name IN ('diaspora_trade_os_is_platform_admin','diaspora_trade_os_is_tenant_member','diaspora_can_access_order')
      AND grantee IN ('anon','authenticated','PUBLIC') ORDER BY routine_name, grantee`,
};

function loadUp(name) {
  const sql = readFileSync(`${MIG_DIR}/${name}.sql`, 'utf8');
  // Node runner convention: Up block is before the -- +migrate Down marker.
  return sql.split('-- +migrate Down')[0].replace(/^-- \+migrate Up\s*/m, '');
}
function isAdditive(name) {
  const up = loadUp(name).toUpperCase();
  return !/\bDROP\s+TABLE\b|\bDROP\s+COLUMN\b|\bTRUNCATE\b/.test(up); // heuristic; RPC/grant migrations are additive
}

async function main() {
  const url = process.env.DIASPORA_STAGING_DATABASE_URL;
  if (!url) {
    console.error('REFUSING TO RUN: DIASPORA_STAGING_DATABASE_URL is not set. This runner needs a real');
    console.error('carup-staging (eoyenigwevnxwwhyhaer) Postgres URL in the environment. It never targets');
    console.error('production. Set the env var in an execution context that has authorized staging access.');
    process.exit(3);
  }
  if (url.includes(FORBIDDEN_PROD_REF)) {
    console.error(`REFUSING TO RUN: the connection string references the forbidden production ref ${FORBIDDEN_PROD_REF}.`);
    process.exit(4);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const dbInfo = (await client.query(`select current_database() db, inet_server_addr() host, version() v`)).rows[0];
  console.log(`Connected: db=${dbInfo.db} host=${dbInfo.host ?? 'n/a'} ${dbInfo.v.split(' ').slice(0,2).join(' ')}`);
  console.log(`Mode: ${APPLY ? 'APPLY (writes enabled)' : 'DRY-RUN (read-only)'}\n`);

  // 1. Read the actual staging migration history (support the Node-runner table AND supabase's).
  let applied = new Set();
  for (const q of [
    `SELECT version FROM public.schema_migrations`,
    `SELECT version FROM supabase_migrations.schema_migrations`,
  ]) {
    try { (await client.query(q)).rows.forEach((r) => applied.add(String(r.version))); } catch { /* table may not exist */ }
  }
  console.log(`Staging recorded migrations: ${applied.size}`);

  // 2/3. Diff vs repo diaspora set → precise missing list, in dependency order.
  const missing = DIASPORA_MIGRATIONS.filter((m) => {
    const version = m.split('_')[0];
    return !applied.has(m) && !applied.has(version);
  });
  console.log(`\nMissing diaspora migrations (dependency order): ${missing.length}`);
  for (const m of missing) console.log(`  - ${m}   additive=${isAdditive(m)}`);

  // 5. Apply only verified-missing migrations, one at a time, stop on first failure.
  if (APPLY) {
    for (const m of missing) {
      process.stdout.write(`APPLY ${m} ... `);
      const up = loadUp(m);
      try {
        await client.query('BEGIN');
        await client.query(up);
        // Record in the Node-runner history table (create if needed) so it is never reapplied.
        await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (version text primary key, applied_at timestamptz default now())`);
        await client.query(`INSERT INTO public.schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING`, [m]);
        await client.query('COMMIT');
        console.log('OK');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(`FAILED: ${e.message}`);
        console.error('STOPPING on first migration failure (per directive).');
        await client.end();
        process.exit(5);
      }
    }
  }

  // 6. Post-verification: RPC posture, grants, RLS. (Runs in dry-run too, reporting current state.)
  console.log('\n── RPC / grant / RLS verification ──');
  const rpcs = (await client.query(`
    SELECT proname, prosecdef AS security_definer, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND proname LIKE 'diaspora_%atomic' ORDER BY proname`)).rows;
  for (const r of rpcs) console.log(`  RPC ${r.proname}: SECURITY ${r.security_definer ? 'DEFINER' : 'INVOKER'}, search_path=${JSON.stringify(r.proconfig)}`);

  // 7. Advisor-finding adjudication.
  console.log('\n── Diaspora advisor-finding adjudication ──');
  for (const [label, q] of Object.entries(ADVISOR_QUERIES)) {
    try { console.log(`  [${label}]`, JSON.stringify((await client.query(q)).rows)); }
    catch (e) { console.log(`  [${label}] query error: ${e.message}`); }
  }

  // 10 (sample). Tenant-isolation smoke: confirm RLS is ENABLED on the launch tables.
  const rls = (await client.query(`
    SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND relname IN
      ('diaspora_trade_profiles','diaspora_import_orders','diaspora_payment_milestones','diaspora_stock_items','diaspora_oauth_states')
    ORDER BY relname`)).rows;
  console.log('\n── RLS enabled state (launch tables) ──');
  for (const r of rls) console.log(`  ${r.relname}: rls_enabled=${r.relrowsecurity}`);

  await client.end();
  console.log('\nDone. (Advisors themselves — Supabase security/performance — run via the Supabase API/MCP,');
  console.log('not raw SQL; use get_advisors before/after alongside this runner.)');
}
main().catch((e) => { console.error('RUNNER ERROR:', e.message); process.exit(2); });
