/**
 * PRODUCTION runner for the anon-grant revoke (PR #176, Issue #164 security lane).
 *
 * Applies exactly two migrations, each in its own transaction, each recorded in
 * `supabase_migrations.schema_migrations`:
 *
 *   20260825090000_revoke_anon_vehicle_evidence_select.sql
 *   20260825090100_revoke_anon_vehicles_select.sql
 *
 * ## What this closes
 *
 * Measured read-only against production before this runner existed: `anon` held SELECT on all 45
 * columns of `public.vehicles`, and `vehicles_public_read` is `USING (true)`, so
 * `GET /rest/v1/vehicles?select=*` returned **HTTP 206, content-range 0-0/352** — 352 real customer
 * rows, every column, including `owner_id`, `current_seller_id`, `plate_number`, `chassis_number`,
 * `engine_number` and `tenant_id`. `vehicle_evidence` carries the same grant on all 54 columns but is
 * empty in production, so it is a loaded surface rather than an active leak.
 *
 * RLS is ROW security, not a column contract. The policies were correct; the column privilege is the
 * hole, and removing the privilege is the fix.
 *
 * ## NOT A MIGRATION RUNNER
 *
 * There is no "apply everything pending" path. This script enumerates nothing — no readdirSync, no
 * glob — and reads exactly the two files named below, each pinned by SHA256 and verified before any
 * connection is opened. A drifted file is refused, not applied.
 *
 * ## Modes
 *
 *   preflight — READ ONLY. `BEGIN TRANSACTION READ ONLY` asserted from the server, then ROLLBACK.
 *               Reports the live anon posture and writes nothing. Run this first and read it.
 *   apply     — writes. Requires confirm_apply=YES_I_AUTHORIZE_THE_PRODUCTION_REVOKE AND, through
 *               the workflow, the protected `production` environment approval.
 *
 * `apply` is not a retry of `preflight`.
 *
 * ## Guards
 *
 *   · PRODUCTION_PROJECT_REF must be a 20-char ref, must not be the staging ref, and must appear in
 *     the connection string; a string referencing staging is refused outright.
 *   · The production ref is NEVER written in this repository (CR-1) — it arrives only as a secret.
 *   · The connection string is never printed.
 *   · TLS verifies against the bundled Supabase root, or PRODUCTION_CA_CERT when supplied.
 *   · Post-apply verification is FAIL-CLOSED: a ledger row without the privilege actually gone is
 *     drift, not success, and fails the job.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer'; // refused if present in the URL

/**
 * Explicit apply confirmation.
 *
 * This was a free-text phrase, and it failed in the way free-text confirmations fail: a dispatch
 * that dropped one leading word was rejected AFTER the human approval had already been granted,
 * costing several round-trips to diagnose. The phrase was also echoed UNMASKED into the Actions log
 * on every run, so it never functioned as a secret and added no authorization strength.
 *
 * The real authorization boundary is the protected `production` environment approval, which is
 * unchanged. This value is a deliberate second action, not a credential — so it is a fixed token
 * chosen from a dropdown, which cannot be mistyped or truncated.
 */
const CONFIRM_TOKEN = 'YES_I_AUTHORIZE_THE_PRODUCTION_REVOKE';

/**
 * The two files, frozen. `sha12` is the first 12 hex of the SHA256 of the whole file as merged to
 * main in #176. A checksum mismatch means the file changed after review; the run stops.
 */
const MIGRATIONS = [
  {
    version: '20260825090000',
    name: '20260825090000_revoke_anon_vehicle_evidence_select.sql',
    sha12: 'd602883e721e',
    table: 'vehicle_evidence',
  },
  {
    version: '20260825090100',
    name: '20260825090100_revoke_anon_vehicles_select.sql',
    sha12: '60d7fc3a4349',
    table: 'vehicles',
  },
];

const TARGETS = MIGRATIONS.map((m) => m.table);

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

const url = process.env.PRODUCTION_DATABASE_URL;
const prodRef = process.env.PRODUCTION_PROJECT_REF;
if (!url) fail('PRODUCTION_DATABASE_URL is not set.');
if (!prodRef || !/^[a-z0-9]{20}$/.test(prodRef)) fail('PRODUCTION_PROJECT_REF (20-char Supabase ref) is required.');
if (prodRef === STAGING_REF) fail('PRODUCTION_PROJECT_REF is the staging ref; refusing.');
if (!url.includes(prodRef)) fail('connection string does not reference PRODUCTION_PROJECT_REF; refusing.');
if (url.includes(STAGING_REF)) fail('connection string references the STAGING project; refusing.');

const MODE = process.env.MODE === 'apply' ? 'apply' : 'preflight';
if (MODE === 'apply') {
  // Normalised before comparison: surrounding whitespace and non-breaking spaces are stripped so a
  // copy/paste artifact can never be the reason a production remediation does not run.
  const supplied = String(process.env.CONFIRM_APPLY || '')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .trim();
  if (supplied !== CONFIRM_TOKEN) {
    fail(`apply mode requires confirm_apply=${CONFIRM_TOKEN}; received a different selection `
       + `(length ${supplied.length}). Re-dispatch with that option selected.`);
  }
}

function tlsConfig() {
  const supplied = process.env.PRODUCTION_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied PRODUCTION_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through */ }
  console.log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

/** Read one pinned migration, verify its checksum, and return only its `Up` section. */
function upSectionOf(m) {
  const sql = readFileSync(fileURLToPath(new URL(`../../database/migrations/${m.name}`, import.meta.url)), 'utf8');
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 12);
  if (sum !== m.sha12) fail(`${m.name} checksum ${sum} != frozen ${m.sha12} — file drifted, refusing.`);
  const up = sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  if (!/REVOKE\s/i.test(up)) fail(`${m.name} Up section contains no REVOKE — refusing to apply an unrecognised file.`);
  if (/\bCREATE\s+TABLE\b/i.test(up)) fail(`${m.name} contains CREATE TABLE; this cutover is read-side only. Refusing.`);
  return { up, sum };
}

/**
 * The live anon posture, from the catalog rather than from policy text.
 *
 * `has_table_privilege` resolves grants made directly, to PUBLIC, and through role membership;
 * `has_column_privilege` additionally catches a column-level grant, which does not appear in
 * `information_schema.table_privileges` at all and is exactly how this class of hole hides.
 */
async function anonPosture(client) {
  const { rows } = await client.query(`
    select c.relname                                                     as table_name,
           has_table_privilege('anon', c.oid, 'SELECT')                  as anon_table_select,
           (select count(*) from pg_attribute a
              where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                and has_column_privilege('anon', c.oid, a.attnum, 'SELECT')) as anon_readable_columns,
           (select count(*) from pg_attribute a
              where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as total_columns,
           c.relrowsecurity                                              as rls_enabled,
           (select count(*) from pg_policies p
              where p.schemaname = 'public' and p.tablename = c.relname
                and p.cmd in ('SELECT','ALL')
                and ('anon' = any(p.roles) or 'public' = any(p.roles)))  as anon_select_policies,
           coalesce((select s.n_live_tup from pg_stat_user_tables s where s.relid = c.oid), 0) as approx_rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any($1::text[])
     order by c.relname`, [TARGETS]);
  return rows;
}

function reportPosture(label, rows) {
  console.log(`\n── ${label} ──`);
  for (const r of rows) {
    console.log(
      `  ${r.table_name.padEnd(18)} anon_select=${String(r.anon_table_select).padEnd(5)} ` +
      `readable_columns=${r.anon_readable_columns}/${r.total_columns}  ` +
      `rls=${r.rls_enabled}  anon_select_policies=${r.anon_select_policies}  approx_rows=${r.approx_rows}`);
  }
}

const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 120000 });
try {
  await client.connect();

  // Identity, from the server. `current_database()` alone proves nothing about WHICH project this
  // is — the ref pin above is what does that, and it is asserted before the connection is opened.
  const { rows: ident } = await client.query('select current_database() db');
  console.log(`Connected (db=${ident[0].db}, mode=${MODE}).`);

  for (const t of TARGETS) {
    const { rows } = await client.query("select coalesce(to_regclass('public.' || $1)::text,'ABSENT') t", [t]);
    if (rows[0].t === 'ABSENT') fail(`public.${t} is absent — wrong database. Refusing.`);
  }

  if (MODE === 'preflight') {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const before = await anonPosture(client);
    reportPosture('PRODUCTION PREFLIGHT (read-only) — current anon posture', before);
    const exposed = before.filter((r) => r.anon_table_select || Number(r.anon_readable_columns) > 0);
    console.log(exposed.length
      ? `\n${exposed.length} of ${before.length} target table(s) are readable by anon today. This is what apply removes.`
      : '\nNeither target is readable by anon; apply would be a no-op.');
    await client.query('ROLLBACK');
    console.log('\nPREFLIGHT COMPLETE — nothing was written. Review the evidence above before authorizing apply.');
  } else {
    const before = await anonPosture(client);
    reportPosture('pre-apply', before);

    for (const m of MIGRATIONS) {
      const { up, sum } = upSectionOf(m);
      const { rows: existing } = await client.query(
        'SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1', [m.version]);
      if (existing.length) { console.log(`#${m.version} already recorded — verify-only.`); continue; }

      console.log(`Applying #${m.version} (${m.name}, sha256:12 ${sum}) in one transaction…`);
      await client.query('BEGIN');
      try {
        await client.query(up);
        await client.query(
          'INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)',
          [m.version, [up], m.name]);
        await client.query('COMMIT');
        console.log(`#${m.version} applied and recorded.`);
      } catch (e) {
        await client.query('ROLLBACK');
        fail(`#${m.version} failed and rolled back: ${e.message}`);
      }
    }

    const after = await anonPosture(client);
    reportPosture('post-apply', after);

    // FAIL-CLOSED CONTRACT. A ledger row is not the outcome; the removed privilege is. Whenever a
    // migration is recorded, its table must be unreadable by anon at BOTH the table and the column
    // level — the column check is the one that matters, because a column-level grant survives a
    // table-level revoke and is invisible to information_schema.table_privileges.
    const failures = [];
    for (const m of MIGRATIONS) {
      const { rows: ledger } = await client.query(
        'SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=$1', [m.version]);
      if (!ledger.length) { failures.push(`#${m.version} was not recorded`); continue; }
      const row = after.find((r) => r.table_name === m.table);
      if (!row) { failures.push(`${m.table} vanished from the catalog after apply`); continue; }
      if (row.anon_table_select) failures.push(`${m.table}: anon still holds table SELECT`);
      if (Number(row.anon_readable_columns) !== 0) {
        failures.push(`${m.table}: anon can still read ${row.anon_readable_columns} column(s)`);
      }
    }
    if (failures.length) fail(`POST-APPLY VERIFICATION FAILED — ${failures.join('; ')}. This is drift, not success.`);

    console.log('\nok  anon holds no table-level and no column-level SELECT on either target.');
    console.log('APPLY COMPLETE. Run the anon HTTP negative probes next: /rest/v1/vehicles must return');
    console.log('    401 with SQLSTATE 42501, not 206 with rows.');
  }
} catch (e) {
  fail(`runner error: ${e.message}`);
} finally {
  await client.end().catch(() => {});
}
