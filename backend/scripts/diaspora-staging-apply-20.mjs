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
 * Gates: staging-ref-only URL; frozen checksum; version-collision refusal; ZERO-POLICY INVARIANT
 * pre-gate (abort before any apply if the table has ANY policy — not a before/after diff); one
 * transaction including the official supabase_migrations ledger row; post-apply contract on
 * diaspora_oauth_states:
 *   - EFFECTIVE privileges via has_table_privilege for every PG17 table privilege
 *     (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) — anon and authenticated
 *     must hold NONE. Direct role_table_grants checks are insufficient: client roles inherit
 *     whatever is granted to PUBLIC.
 *   - PUBLIC itself holds no table ACL (pg_class.relacl aclexplode grantee=0).
 *   - service_role retains effective CRUD; RLS enabled; policy count EXACTLY zero post-apply
 *     (absolute, also on verify-only re-runs); row count unchanged.
 *   - Column belt: pg_attribute.attacl aclexplode including PUBLIC (grantee=0) entries, not only
 *     named anon/authenticated roles (information_schema.role_column_grants expands table grants
 *     per column, so it cannot be used).
 *   - Live probes denied (42501). Never prints the URL or any credential.
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

// Every PG17 table privilege — has_table_privilege sees EFFECTIVE rights (incl. PUBLIC inheritance).
const PG17_TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

async function effectivePrivs(c, role) {
  const held = [];
  for (const p of PG17_TABLE_PRIVS) {
    if ((await c.query(`SELECT has_table_privilege($1, 'public.${TABLE}', $2) h`, [role, p])).rows[0].h) held.push(p);
  }
  return held;
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

  // ZERO-POLICY INVARIANT pre-gate: the nonce store must have NO policy at all. Abort before any
  // apply if one exists — an absolute check, not a before/after diff.
  const polsBefore = (await c.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [TABLE])).rows[0].n;
  if (polsBefore !== 0) fail(`zero-policy invariant violated BEFORE apply: ${TABLE} has ${polsBefore} policies (expected 0)`);
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
  // EFFECTIVE privileges (has_table_privilege includes PUBLIC inheritance) — all 8 PG17 privileges.
  const anonEff = await effectivePrivs(c, 'anon');
  if (anonEff.length) errs.push(`anon holds EFFECTIVE ${anonEff.join(',')}`);
  const authEff = await effectivePrivs(c, 'authenticated');
  if (authEff.length) errs.push(`authenticated holds EFFECTIVE ${authEff.join(',')}`);
  const svcEff = await effectivePrivs(c, 'service_role');
  if (!['DELETE', 'INSERT', 'SELECT', 'UPDATE'].every((p) => svcEff.includes(p))) errs.push(`service_role missing effective CRUD (${svcEff.join(',')})`);
  // PUBLIC itself must hold no table ACL (grantee=0 in relacl).
  const pubAcl = (await c.query(
    `SELECT count(*)::int n FROM pg_class k CROSS JOIN LATERAL aclexplode(k.relacl) acl
     WHERE k.oid = ('public.'||$1)::regclass AND acl.grantee = 0`, [TABLE])).rows[0].n;
  if (pubAcl !== 0) errs.push(`PUBLIC holds ${pubAcl} table ACL entr${pubAcl === 1 ? 'y' : 'ies'} in relacl`);
  const rls = (await c.query(`SELECT relrowsecurity r FROM pg_class k JOIN pg_namespace n ON n.oid=k.relnamespace WHERE n.nspname='public' AND k.relname=$1`, [TABLE])).rows[0].r;
  if (!rls) errs.push('RLS disabled');
  // Zero-policy invariant post-apply — absolute (holds on apply and verify-only runs alike).
  const polsAfter = (await c.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [TABLE])).rows[0].n;
  if (polsAfter !== 0) errs.push(`zero-policy invariant violated after apply: ${polsAfter} policies (expected 0)`);
  const rowsAfter = (await c.query(`SELECT count(*)::int n FROM public.${TABLE}`)).rows[0].n;
  if (rowsAfter !== rowsBefore) errs.push(`row count changed ${rowsBefore}→${rowsAfter}`);
  // Column belt incl. PUBLIC: aclexplode reports PUBLIC as grantee=0 (no pg_roles row), so an inner
  // join on pg_roles would silently drop it — match grantee=0 explicitly.
  const colGrants = (await c.query(
    `SELECT count(*)::int n FROM pg_class k
       JOIN pg_namespace ns ON ns.oid = k.relnamespace
       JOIN pg_attribute a ON a.attrelid = k.oid AND a.attacl IS NOT NULL
       CROSS JOIN LATERAL aclexplode(a.attacl) acl
       LEFT JOIN pg_roles r ON r.oid = acl.grantee
     WHERE ns.nspname='public' AND k.relname=$1 AND (acl.grantee = 0 OR r.rolname IN ('anon','authenticated'))`, [TABLE])).rows[0].n;
  if (colGrants !== 0) errs.push(`${colGrants} residual column-level client/PUBLIC grants`);

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
  console.log(`\n#20 STAGING ${mode === 'apply' ? 'APPLY+' : ''}VERIFY PASS: anon/authenticated hold ZERO effective privileges (8 PG17 privs), PUBLIC holds no table/column ACL, service_role CRUD, RLS on, exactly 0 policies, data unchanged`);
}
main().catch((e) => fail(e.message));
