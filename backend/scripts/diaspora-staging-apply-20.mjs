#!/usr/bin/env node
/**
 * Diaspora Trade OS — ledger #20 staging apply + verify (carup-staging, ref eoyenigwevnxwwhyhaer).
 *
 * SINGLE-PURPOSE, FAIL-CLOSED. Applies exactly ONE migration — ledger #20
 * (20260727090000_diaspora_oauth_states_client_grant_hardening.sql) — and nothing else. Runs in CI
 * via .github/workflows/diaspora-staging-20-oauth-states-hardening.yml because the staging
 * credential exists only as the DIASPORA_STAGING_DATABASE_URL GitHub secret (post-CR-1).
 * Owner-authorized 2026-07-27 ("APPROVE #20 DIASPORA OAUTH STATES GRANT HARDENING").
 *
 * Gates: staging-ref-only URL; frozen checksum; version-collision refusal; one transaction
 * including the official supabase_migrations ledger row; post-apply contract on
 * diaspora_oauth_states: anon=NONE, authenticated=NONE, service_role CRUD, RLS enabled with ZERO
 * policies (default-deny, unchanged), row count unchanged, no column-level client ACLs
 * (pg_attribute.attacl — information_schema.role_column_grants expands table grants per column),
 * PG17 MAINTAIN absent, live probes denied (42501). Never prints the URL or any credential.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FORBIDDEN_PROD_REF = 'vhmnajoeicasaigiophh';
const VERSION = '20260727090000';
const NAME = 'diaspora_oauth_states_client_grant_hardening';
const FROZEN_SHA12 = 'c9515b888c30';
const TABLE = 'diaspora_oauth_states';
const FILE = fileURLToPath(new URL(`../../database/migrations/${VERSION}_${NAME}.sql`, import.meta.url));

const fail = (msg) => { console.error(`FAIL-CLOSED: ${msg}`); process.exit(1); };

// privilege_type is an information_schema DOMAIN — cast to text so node-pg parses a real array.
async function privs(c, grantee) {
  const r = await c.query(
    `SELECT array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) p FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name=$1 AND grantee=$2`, [TABLE, grantee]);
  return r.rows[0].p ?? [];
}

async function main() {
  const rawUrl = process.env.DIASPORA_STAGING_DATABASE_URL;
  if (!rawUrl) fail('DIASPORA_STAGING_DATABASE_URL not set');
  if (rawUrl.includes(FORBIDDEN_PROD_REF)) fail(`URL references the forbidden production ref ${FORBIDDEN_PROD_REF}`);
  if (!rawUrl.includes(STAGING_REF)) fail(`URL must positively reference the staging ref ${STAGING_REF}`);
  const url = rawUrl.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');

  const sql = readFileSync(FILE, 'utf8');
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 12);
  if (sum !== FROZEN_SHA12) fail(`migration checksum ${sum} != frozen ${FROZEN_SHA12} — file drifted, refusing`);
  const up = sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  console.log(`#20 file verified: sha256:12=${sum}`);

  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
  await c.connect();
  console.log(`connected: db=${(await c.query(`SELECT current_database() db`)).rows[0].db}`);

  const existing = (await c.query(`SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1`, [VERSION])).rows;
  let mode = 'apply';
  if (existing.length) {
    if (existing[0].name === NAME) { mode = 'verify-only'; console.log('already recorded — verify-only re-run'); }
    else fail(`version ${VERSION} already recorded as '${existing[0].name}' — collision, refusing`);
  }
  if (!(await c.query(`SELECT to_regclass('public.${TABLE}') r`)).rows[0].r) fail(`missing table ${TABLE}`);

  const polsBefore = (await c.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [TABLE])).rows[0].n;
  const rowsBefore = (await c.query(`SELECT count(*)::int n FROM public.${TABLE}`)).rows[0].n;

  if (mode === 'apply') {
    await c.query('BEGIN');
    try {
      await c.query(up);
      await c.query(`INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)`, [VERSION, [up], NAME]);
      await c.query('COMMIT');
      console.log(`APPLIED #20 in one transaction; ledger row ${VERSION} recorded`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      fail(`apply error (rolled back, nothing recorded): ${e.message}`);
    }
  }

  const errs = [];
  const anon = await privs(c, 'anon');
  if (anon.length) errs.push(`anon still has ${anon.join(',')}`);
  const auth = await privs(c, 'authenticated');
  if (auth.length) errs.push(`authenticated still has ${auth.join(',')}`);
  const svc = await privs(c, 'service_role');
  if (!['DELETE', 'INSERT', 'SELECT', 'UPDATE'].every((p) => svc.includes(p))) errs.push(`service_role missing CRUD (${svc.join(',')})`);
  const rls = (await c.query(`SELECT relrowsecurity r FROM pg_class k JOIN pg_namespace n ON n.oid=k.relnamespace WHERE n.nspname='public' AND k.relname=$1`, [TABLE])).rows[0].r;
  if (!rls) errs.push('RLS disabled');
  const polsAfter = (await c.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [TABLE])).rows[0].n;
  if (polsAfter !== polsBefore) errs.push(`policy count changed ${polsBefore}→${polsAfter}`);
  const rowsAfter = (await c.query(`SELECT count(*)::int n FROM public.${TABLE}`)).rows[0].n;
  if (rowsAfter !== rowsBefore) errs.push(`row count changed ${rowsBefore}→${rowsAfter}`);
  const colGrants = (await c.query(
    `SELECT count(*)::int n FROM pg_class k
       JOIN pg_namespace ns ON ns.oid = k.relnamespace
       JOIN pg_attribute a ON a.attrelid = k.oid AND a.attacl IS NOT NULL
       CROSS JOIN LATERAL aclexplode(a.attacl) acl
       JOIN pg_roles r ON r.oid = acl.grantee
     WHERE ns.nspname='public' AND k.relname=$1 AND r.rolname IN ('anon','authenticated')`, [TABLE])).rows[0].n;
  if (colGrants !== 0) errs.push(`${colGrants} residual column-level client grants`);
  const mm = (await c.query(
    `SELECT has_table_privilege('anon','public.${TABLE}','MAINTAIN') a, has_table_privilege('authenticated','public.${TABLE}','MAINTAIN') b`)).rows[0];
  if (mm.a || mm.b) errs.push(`residual MAINTAIN (anon=${mm.a}, authenticated=${mm.b})`);

  for (const [role, probe, label] of [
    ['anon', `SELECT count(*) FROM public.${TABLE}`, 'anon SELECT'],
    ['authenticated', `SELECT count(*) FROM public.${TABLE}`, 'authenticated SELECT'],
    ['anon', `INSERT INTO public.${TABLE} (id) VALUES (gen_random_uuid())`, 'anon INSERT'],
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
  console.log(`\n#20 STAGING ${mode === 'apply' ? 'APPLY+' : ''}VERIFY PASS: anon=NONE, authenticated=NONE, service_role CRUD, RLS on (0 policies), data unchanged`);
}
main().catch((e) => fail(e.message));
