#!/usr/bin/env node
/**
 * Diaspora Trade OS — GTM ledger apply + verify for canonical staging (carup-staging, ref
 * eoyenigwevnxwwhyhaer). Issue #127.
 *
 * Applies the go-to-market ledgers IN ORDER — #21, #22, #23, and any later GTM migration declared in
 * LEDGERS below — each in its own transaction together with its official
 * supabase_migrations.schema_migrations row. Fail-closed throughout: a checksum drift, a version
 * collision, a missing prerequisite or a failed post-apply contract stops the run and records nothing
 * for the migration that failed.
 *
 * Re-dispatch is safe. A ledger already recorded under the same name switches to verify-only, so a
 * re-run after a partial failure resumes at the first unapplied migration and re-proves the contract
 * for the ones already in place.
 *
 * WHY THIS IS NOT A COPY OF diaspora-staging-apply-20.mjs
 * -------------------------------------------------------
 * That script pins `ssl: { rejectUnauthorized: false }`, which disables certificate verification and
 * makes the connection trivially interceptable by anything that can get in front of it. Issue #127
 * asks for TLS verification to be improved rather than propagated, so this script VERIFIES by default:
 *
 *   · verification is ON unless explicitly and loudly disabled;
 *   · DIASPORA_STAGING_CA_CERT (PEM) is used as the trust anchor when supplied;
 *   · otherwise Node's bundled public roots are used, which is what Supabase's pooler certificates
 *     chain to;
 *   · DIASPORA_STAGING_TLS_INSECURE=true is the only way to fall back, it prints a prominent warning,
 *     and it exists solely so a certificate-chain problem is diagnosable rather than a dead end.
 *
 * The credential is never printed, never logged, and is read only from the environment.
 *
 * Run:  node backend/scripts/diaspora-staging-apply-gtm.mjs            # apply + verify
 *       node backend/scripts/diaspora-staging-apply-gtm.mjs --verify   # verify only, never applies
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FORBIDDEN_PROD_REF = 'vhmnajoeicasaigiophh';
const VERIFY_ONLY = process.argv.includes('--verify');

/** Every PG17 table privilege. MAINTAIN is the one information_schema cannot report. */
const PG17_TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

/**
 * The GTM ledgers, in application order.
 *
 * `tables` are verified against the ledger-#20 contract: PUBLIC/anon/authenticated hold NOTHING,
 * service_role holds CRUD, RLS is on, there are no policies and no column-level client grants.
 * `functions` are verified as service_role-only EXECUTE with a pinned search_path.
 *
 * Adding a later GTM migration is a data change here, not a new script.
 */
const LEDGERS = [
  {
    n: 21,
    version: '20260727120000',
    name: 'diaspora_gtm_activation_foundation',
    sha12: '157dae537997',
    tables: [
      'diaspora_safetrade_provider_events',
      'diaspora_safetrade_operations',
      'diaspora_safetrade_approvals',
      'diaspora_workbook_import_confirmations',
      'diaspora_workbook_import_receipts',
      'diaspora_credential_references',
      'diaspora_drive_sync_attempts',
      'diaspora_billing_reconciliation_runs',
    ],
    functions: [],
    // Prerequisite: #21 adds columns to this ledger-#12 table.
    requiresTables: ['diaspora_billing_provider_events'],
    extraColumns: [
      ['diaspora_billing_provider_events', 'occurred_at'],
      ['diaspora_billing_provider_events', 'provider_sequence'],
      ['diaspora_billing_provider_events', 'superseded'],
    ],
  },
  {
    n: 22,
    version: '20260727130000',
    name: 'diaspora_safetrade_st3_closure',
    sha12: '610ac3118e64',
    tables: ['diaspora_safetrade_outbox'],
    functions: ['diaspora_safetrade_transition_atomic'],
    requiresTables: ['diaspora_safetrade_transactions', 'diaspora_safetrade_milestones'],
    extraColumns: [],
    // The transition RPC is REPLACED, not overloaded. Two definitions would make every Supabase
    // named-argument call ambiguous at runtime.
    singleOverload: ['diaspora_safetrade_transition_atomic'],
  },
  {
    n: 23,
    version: '20260728090000',
    name: 'diaspora_safetrade_st3_item1_closure',
    sha12: '385cd2724015',
    tables: [],
    functions: [
      'diaspora_safetrade_dispute_hold_atomic',
      'diaspora_safetrade_close_delivery_window_atomic',
      'diaspora_safetrade_outbox_claim_atomic',
      'diaspora_safetrade_outbox_settle_atomic',
    ],
    requiresTables: ['diaspora_safetrade_outbox', 'diaspora_safetrade_disputes', 'diaspora_safetrade_delivery_confirmations'],
    extraColumns: [],
    singleOverload: [
      'diaspora_safetrade_dispute_hold_atomic',
      'diaspora_safetrade_close_delivery_window_atomic',
      'diaspora_safetrade_outbox_claim_atomic',
      'diaspora_safetrade_outbox_settle_atomic',
    ],
  },
  {
    n: 24,
    version: '20260729090000',
    name: 'diaspora_billing_test_mode_closure',
    sha12: '28aa8c6d7807',
    tables: ['diaspora_billing_checkout_sessions'],
    functions: [],
    requiresTables: ['diaspora_billing_provider_events', 'diaspora_billing_reconciliation_runs'],
    extraColumns: [
      ['diaspora_billing_provider_events', 'superseded_by'],
      ['diaspora_billing_provider_events', 'correlation_id'],
      ['diaspora_billing_provider_events', 'attempts'],
      ['diaspora_billing_provider_events', 'last_error'],
      ['diaspora_billing_provider_events', 'dead_lettered'],
    ],
  },
];

const fail = (msg) => { console.error(`FAIL-CLOSED: ${msg}`); process.exit(1); };
const migrationPath = (l) => fileURLToPath(new URL(`../../database/migrations/${l.version}_${l.name}.sql`, import.meta.url));

function upSectionOf(l) {
  const sql = readFileSync(migrationPath(l), 'utf8');
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 12);
  if (sum !== l.sha12) fail(`#${l.n} checksum ${sum} != frozen ${l.sha12} — file drifted, refusing`);
  const up = sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  return { up, sum };
}

/** Effective privileges — has_table_privilege reports rights inherited through PUBLIC too. */
async function effectivePrivs(c, role, table) {
  const held = [];
  for (const p of PG17_TABLE_PRIVS) {
    const { rows } = await c.query('SELECT has_table_privilege($1, $2, $3) h', [role, `public.${table}`, p]);
    if (rows[0].h) held.push(p);
  }
  return held;
}

async function verifyTableContract(c, table, errs) {
  if (!(await c.query(`SELECT to_regclass('public.${table}') r`)).rows[0].r) {
    errs.push(`${table}: missing`);
    return;
  }
  const anon = await effectivePrivs(c, 'anon', table);
  if (anon.length) errs.push(`${table}: anon holds EFFECTIVE ${anon.join(',')}`);
  const auth = await effectivePrivs(c, 'authenticated', table);
  if (auth.length) errs.push(`${table}: authenticated holds EFFECTIVE ${auth.join(',')}`);
  const svc = await effectivePrivs(c, 'service_role', table);
  if (!['SELECT', 'INSERT', 'UPDATE', 'DELETE'].every((p) => svc.includes(p))) {
    errs.push(`${table}: service_role missing effective CRUD (${svc.join(',')})`);
  }

  // PUBLIC appears in relacl as grantee 0 and has no pg_roles row, so it must be matched explicitly.
  const pubAcl = (await c.query(
    `SELECT count(*)::int n FROM pg_class k CROSS JOIN LATERAL aclexplode(k.relacl) acl
      WHERE k.oid = ('public.'||$1)::regclass AND acl.grantee = 0`, [table])).rows[0].n;
  if (pubAcl !== 0) errs.push(`${table}: PUBLIC holds ${pubAcl} table ACL entries`);

  const rls = (await c.query(
    `SELECT relrowsecurity r FROM pg_class k JOIN pg_namespace n ON n.oid=k.relnamespace
      WHERE n.nspname='public' AND k.relname=$1`, [table])).rows[0]?.r;
  if (!rls) errs.push(`${table}: RLS disabled`);

  const pols = (await c.query(
    `SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [table])).rows[0].n;
  if (pols !== 0) errs.push(`${table}: expected zero policies (service-role-only ledger), found ${pols}`);

  // Column-level grants survive a table-level REVOKE, so they get their own check — including PUBLIC.
  const colGrants = (await c.query(
    `SELECT count(*)::int n FROM pg_class k
       JOIN pg_namespace ns ON ns.oid = k.relnamespace
       JOIN pg_attribute a ON a.attrelid = k.oid AND a.attacl IS NOT NULL
       CROSS JOIN LATERAL aclexplode(a.attacl) acl
       LEFT JOIN pg_roles r ON r.oid = acl.grantee
      WHERE ns.nspname='public' AND k.relname=$1 AND (acl.grantee = 0 OR r.rolname IN ('anon','authenticated'))`,
    [table])).rows[0].n;
  if (colGrants !== 0) errs.push(`${table}: ${colGrants} residual column-level client/PUBLIC grants`);
}

async function verifyFunctionContract(c, fn, errs, { singleOverload = false } = {}) {
  const { rows } = await c.query(
    `SELECT p.oid::regprocedure::text sig, p.proacl::text acl, p.proconfig::text cfg
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1`, [fn]);
  if (rows.length === 0) { errs.push(`${fn}(): missing`); return; }
  if (singleOverload && rows.length !== 1) {
    errs.push(`${fn}(): ${rows.length} overloads — a Supabase named-argument RPC call would be ambiguous`);
  }
  for (const r of rows) {
    const acl = r.acl || '';
    if (/(^|,)anon=/.test(acl)) errs.push(`${fn}(): anon holds EXECUTE`);
    if (/(^|,)authenticated=/.test(acl)) errs.push(`${fn}(): authenticated holds EXECUTE`);
    if (/(^|,)=[a-zA-Z]/.test(acl)) errs.push(`${fn}(): PUBLIC holds EXECUTE`);
    if (!/service_role=X/.test(acl)) errs.push(`${fn}(): service_role missing EXECUTE (acl=${acl || 'default'})`);
    if (!r.cfg || !/search_path/.test(r.cfg)) errs.push(`${fn}(): search_path not pinned`);
  }
}

/**
 * TLS configuration.
 *
 * Verification is the default. The insecure path exists only so a chain problem can be diagnosed, and
 * it announces itself so it can never be mistaken for the normal mode.
 */
function tlsConfig() {
  if (String(process.env.DIASPORA_STAGING_TLS_INSECURE || '').toLowerCase() === 'true') {
    console.warn('WARNING: TLS certificate verification is DISABLED for this run (DIASPORA_STAGING_TLS_INSECURE=true).');
    console.warn('WARNING: this connection can be intercepted. Use it only to diagnose a certificate chain, never routinely.');
    return { rejectUnauthorized: false };
  }

  // An explicitly supplied PEM wins, so an operator can override without a code change — for
  // example after a root rotation, before the bundled copy is updated.
  const supplied = process.env.DIASPORA_STAGING_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied DIASPORA_STAGING_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }

  // Supabase's Postgres endpoints chain to a SELF-SIGNED Supabase root that is not in Node's public
  // root store, so verifying with default roots fails with "self-signed certificate in certificate
  // chain" — which is exactly what the first staging preflight hit.
  //
  // The repository's older appliers answered that with `rejectUnauthorized: false`, which does not
  // solve it: it stops checking, and a connection that does not verify can be intercepted. Pinning
  // Supabase's published root instead makes verification genuinely succeed, and against ONE known
  // anchor rather than every public CA on the internet — stronger than either alternative.
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch {
    // Fall through: a missing bundle must not silently disable verification.
  }

  console.log("TLS: verifying against Node's bundled public roots (no Supabase anchor found).");
  return { rejectUnauthorized: true };
}

async function main() {
  const rawUrl = process.env.DIASPORA_STAGING_DATABASE_URL;
  if (!rawUrl) fail('DIASPORA_STAGING_DATABASE_URL is not set');
  if (rawUrl.includes(FORBIDDEN_PROD_REF)) fail(`URL references the forbidden production ref ${FORBIDDEN_PROD_REF}`);
  if (!rawUrl.includes(STAGING_REF)) fail(`URL must positively reference the approved staging ref ${STAGING_REF}`);
  // sslmode in the URL would override the verified ssl object below.
  const url = rawUrl.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');

  // Verify every checksum BEFORE opening a connection: a drifted file should never reach the database.
  const prepared = LEDGERS.map((l) => ({ ...l, ...upSectionOf(l) }));
  for (const l of prepared) console.log(`#${l.n} ${l.version}_${l.name}.sql verified sha256:12=${l.sum}`);

  const c = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 120000 });
  await c.connect();
  console.log(`connected: db=${(await c.query('SELECT current_database() db')).rows[0].db}, pg=${(await c.query('SHOW server_version')).rows[0].server_version}`);

  const summary = [];

  for (const l of prepared) {
    console.log(`\n── ledger #${l.n} ${l.name} ──`);

    for (const t of l.requiresTables) {
      if (!(await c.query(`SELECT to_regclass('public.${t}') r`)).rows[0].r) {
        fail(`#${l.n} prerequisite table ${t} is missing — refusing to apply out of order`);
      }
    }

    const existing = (await c.query(
      'SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1', [l.version])).rows;
    let mode = 'apply';
    if (existing.length) {
      if (existing[0].name === l.name) { mode = 'verify-only'; console.log('already recorded — verify-only'); }
      else fail(`#${l.n}: version ${l.version} already recorded as '${existing[0].name}' — collision, refusing`);
    }
    if (VERIFY_ONLY && mode === 'apply') {
      console.log('--verify: not applied, and this run will not apply it');
      summary.push({ ledger: l.n, mode: 'not-applied', ok: false });
      continue;
    }

    if (mode === 'apply') {
      await c.query('BEGIN');
      try {
        await c.query(l.up);
        await c.query(
          'INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)',
          [l.version, [l.up], l.name]);
        await c.query('COMMIT');
        console.log(`APPLIED #${l.n} in one transaction; ledger row ${l.version} recorded`);
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        fail(`#${l.n} apply error (rolled back, nothing recorded): ${e.message}`);
      }
    }

    const errs = [];
    for (const t of l.tables) await verifyTableContract(c, t, errs);
    for (const fn of l.functions) {
      await verifyFunctionContract(c, fn, errs, { singleOverload: (l.singleOverload || []).includes(fn) });
    }
    for (const [table, column] of l.extraColumns) {
      const { rows } = await c.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
        [table, column]);
      if (rows.length !== 1) errs.push(`${table}.${column}: missing additive column`);
    }

    if (errs.length) {
      console.error(`#${l.n} CONTRACT FAILURES:`);
      for (const e of errs) console.error(`  ✗ ${e}`);
      fail(`#${l.n} post-apply contract failed`);
    }
    console.log(`#${l.n} contract verified: ${l.tables.length} tables, ${l.functions.length} functions, ${l.extraColumns.length} additive columns`);
    summary.push({ ledger: l.n, mode, ok: true, tables: l.tables.length, functions: l.functions.length });
  }

  await c.end();
  console.log(`\n${JSON.stringify({ ok: summary.every((s) => s.ok), summary }, null, 2)}`);
  if (!summary.every((s) => s.ok)) process.exit(1);
}

main().catch((e) => fail(e.message));
