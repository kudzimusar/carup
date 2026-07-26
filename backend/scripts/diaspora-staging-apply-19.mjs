#!/usr/bin/env node
/**
 * Diaspora Trade OS — ledger #19 staging apply + verify (carup-staging, ref eoyenigwevnxwwhyhaer).
 *
 * SINGLE-PURPOSE, FAIL-CLOSED. This script applies exactly ONE migration — ledger #19
 * (20260726120000_diaspora_phase8_9_10_client_grant_hardening.sql) — and nothing else. It exists
 * because the staging credential lives only in the DIASPORA_STAGING_DATABASE_URL GitHub Actions
 * secret (CR-1 rotation removed all local copies), so canonical application runs in CI via
 * .github/workflows/diaspora-staging-19-grant-hardening.yml. Owner-authorized 2026-07-26
 * ("APPROVE #19 PHASE-8/9/10 HARDENING").
 *
 * Gates (any failure exits non-zero; nothing is committed on failure):
 *   1. URL must reference the staging ref and must NOT reference the production ref.
 *   2. The migration file's sha256[:12] must equal the FROZEN checksum recorded in the ledger.
 *   3. If version 20260726120000 is already recorded with the same name → verify-only (idempotent
 *      re-run). Recorded with a DIFFERENT name → abort.
 *   4. Up block runs in ONE transaction together with its supabase_migrations.schema_migrations row.
 *   5. Post-apply contract on all 19 tables: anon=NONE, authenticated=SELECT-only, service_role
 *      retains SELECT/INSERT/UPDATE/DELETE, RLS enabled, pg_policies snapshot unchanged, per-table
 *      row counts unchanged, plus live negative probes (anon SELECT and authenticated INSERT → 42501).
 *
 * Never prints the connection URL or any credential.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FORBIDDEN_PROD_REF = 'vhmnajoeicasaigiophh';
const VERSION = '20260726120000';
const NAME = 'diaspora_phase8_9_10_client_grant_hardening';
const FROZEN_SHA12 = '6674706778b5';
const FILE = fileURLToPath(new URL(`../../database/migrations/${VERSION}_${NAME}.sql`, import.meta.url));

const TABLES = [
  'diaspora_subscriptions', 'diaspora_subscription_plans', 'diaspora_user_entitlement_overrides',
  'diaspora_usage_meters', 'diaspora_usage_reservations', 'diaspora_billing_provider_events',
  'diaspora_safetrade_transactions', 'diaspora_safetrade_milestones', 'diaspora_safetrade_release_evaluations',
  'diaspora_safetrade_disputes', 'diaspora_safetrade_dispute_evidence', 'diaspora_safetrade_delivery_confirmations',
  'trade_graph_nodes', 'trade_graph_edges', 'trade_graph_materialized_summaries',
  'trade_graph_projection_checkpoints', 'trade_graph_processed_events', 'trade_graph_dead_letters',
  'trade_graph_rebuilds',
];

const fail = (msg) => { console.error(`FAIL-CLOSED: ${msg}`); process.exit(1); };

// privilege_type is an information_schema DOMAIN — cast to text so node-pg parses a real array.
async function privs(c, table, grantee) {
  const r = await c.query(
    `SELECT array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) p FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name=$1 AND grantee=$2`, [table, grantee]);
  return r.rows[0].p ?? [];
}
async function policySnapshot(c) {
  const r = await c.query(
    `SELECT tablename, policyname, cmd, roles::text, coalesce(qual,'-') qual, coalesce(with_check,'-') wc
     FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1) ORDER BY tablename, policyname`, [TABLES]);
  return JSON.stringify(r.rows);
}
async function rowCounts(c) {
  const out = {};
  for (const t of TABLES) out[t] = (await c.query(`SELECT count(*)::int n FROM public."${t}"`)).rows[0].n;
  return JSON.stringify(out);
}

async function main() {
  const rawUrl = process.env.DIASPORA_STAGING_DATABASE_URL;
  if (!rawUrl) fail('DIASPORA_STAGING_DATABASE_URL not set');
  if (rawUrl.includes(FORBIDDEN_PROD_REF)) fail(`URL references the forbidden production ref ${FORBIDDEN_PROD_REF}`);
  if (!rawUrl.includes(STAGING_REF)) fail(`URL must positively reference the staging ref ${STAGING_REF}`);
  // sslmode in the URL overrides the explicit ssl config and breaks pooler TLS — strip it.
  const url = rawUrl.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');

  const sql = readFileSync(FILE, 'utf8');
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 12);
  if (sum !== FROZEN_SHA12) fail(`migration checksum ${sum} != frozen ${FROZEN_SHA12} — file drifted, refusing`);
  const up = sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  console.log(`#19 file verified: sha256:12=${sum}, ${up.split('\n').filter((l) => /^(REVOKE|GRANT)/.test(l)).length} ACL statements`);

  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
  await c.connect();
  const ref = (await c.query(`SELECT current_database() db`)).rows[0].db;
  console.log(`connected: db=${ref}`);

  const existing = (await c.query(`SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1`, [VERSION])).rows;
  let mode = 'apply';
  if (existing.length) {
    if (existing[0].name === NAME) { mode = 'verify-only'; console.log(`version ${VERSION} already recorded as ${NAME} — verify-only re-run`); }
    else fail(`version ${VERSION} already recorded as '${existing[0].name}' — collision, refusing`);
  }

  const missing = [];
  for (const t of TABLES) {
    const ok = (await c.query(`SELECT to_regclass('public.'||$1) r`, [t])).rows[0].r;
    if (!ok) missing.push(t);
  }
  if (missing.length) fail(`tables missing on staging: ${missing.join(', ')}`);

  const policiesBefore = await policySnapshot(c);
  const countsBefore = await rowCounts(c);

  if (mode === 'apply') {
    await c.query('BEGIN');
    try {
      await c.query(up);
      await c.query(`INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)`, [VERSION, [up], NAME]);
      await c.query('COMMIT');
      console.log(`APPLIED #19 in one transaction; ledger row ${VERSION} recorded`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      fail(`apply error (rolled back, nothing recorded): ${e.message}`);
    }
  }

  // ── Post-apply verification (all gates must hold) ──
  const errs = [];
  for (const t of TABLES) {
    const anon = await privs(c, t, 'anon');
    if (anon.length) errs.push(`${t}: anon still has ${anon.join(',')}`);
    const auth = await privs(c, t, 'authenticated');
    if (!(auth.length === 1 && auth[0] === 'SELECT')) errs.push(`${t}: authenticated=${auth.join(',') || 'NONE'} (want SELECT only)`);
    const svc = await privs(c, t, 'service_role');
    if (!['DELETE', 'INSERT', 'SELECT', 'UPDATE'].every((p) => svc.includes(p))) errs.push(`${t}: service_role missing CRUD (${svc.join(',')})`);
    const rls = (await c.query(`SELECT relrowsecurity r FROM pg_class c2 JOIN pg_namespace n ON n.oid=c2.relnamespace WHERE n.nspname='public' AND c2.relname=$1`, [t])).rows[0].r;
    if (!rls) errs.push(`${t}: RLS disabled`);
  }
  if ((await policySnapshot(c)) !== policiesBefore) errs.push('pg_policies changed — #19 must not touch policies');
  if ((await rowCounts(c)) !== countsBefore) errs.push('row counts changed — #19 must not touch data');
  // Belt: table-level checks cannot see residual COLUMN-level grants.
  const colGrants = (await c.query(
    `SELECT count(*)::int n FROM information_schema.role_column_grants
     WHERE table_schema='public' AND table_name = ANY($1) AND grantee IN ('anon','authenticated')`, [TABLES])).rows[0].n;
  if (colGrants !== 0) errs.push(`${colGrants} residual column-level client grants remain`);
  // Belt: PG17 MAINTAIN is invisible to information_schema — check it explicitly.
  for (const t of TABLES) {
    const m = (await c.query(
      `SELECT has_table_privilege('anon','public.'||$1::text,'MAINTAIN') a, has_table_privilege('authenticated','public.'||$1::text,'MAINTAIN') b`, [t])).rows[0];
    if (m.a || m.b) errs.push(`${t}: residual MAINTAIN privilege (anon=${m.a}, authenticated=${m.b})`);
  }

  // Live negative probes (rolled back).
  for (const [role, probe, label] of [
    ['anon', `SELECT count(*) FROM public.diaspora_subscriptions`, 'anon SELECT'],
    ['anon', `INSERT INTO public.diaspora_safetrade_transactions (id) VALUES (gen_random_uuid())`, 'anon INSERT'],
    ['authenticated', `INSERT INTO public.diaspora_subscriptions (id) VALUES (gen_random_uuid())`, 'authenticated INSERT'],
  ]) {
    try {
      await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`); await c.query(probe);
      await c.query('ROLLBACK'); errs.push(`${label} unexpectedly ALLOWED`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      if (e.code !== '42501') errs.push(`${label}: expected 42501, got ${e.code || e.message}`);
      else console.log(`probe ok: ${label} denied (42501)`);
    }
  }

  await c.end();
  if (errs.length) { errs.forEach((e) => console.error(`CONTRACT VIOLATION: ${e}`)); process.exit(1); }
  console.log(`\n#19 STAGING ${mode === 'apply' ? 'APPLY+' : ''}VERIFY PASS: 19/19 tables anon=NONE, authenticated=SELECT-only, service_role CRUD, RLS on, policies+data unchanged`);
}
main().catch((e) => fail(e.message));
