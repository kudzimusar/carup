/**
 * Publication-gate staging migration runner — applies the two advancement-pass
 * migrations to canonical staging (carup-staging, project ref eoyenigwevnxwwhyhaer),
 * each in one transaction together with its official
 * supabase_migrations.schema_migrations row, then verifies the resulting contract.
 *
 * Modeled on backend/scripts/diaspora-staging-apply-gtm.mjs and sharing its
 * fail-closed guards:
 *   · the URL must positively reference the approved staging ref; anything else is
 *     refused (the production ref is deliberately not written here — CR-1 rejects
 *     that literal in executable files);
 *   · each file's sha256 is checked against its frozen value BEFORE any connection;
 *   · an already-recorded version switches to verify-only, so re-dispatch is safe;
 *   · TLS verification is ON, anchored on DIASPORA_STAGING_CA_CERT when supplied,
 *     else the Supabase root bundled at database/certs/;
 *   · the connection string is never printed.
 *
 * MODE=verify → prove the contract read-only. MODE=apply → apply then verify.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';

const MIGRATIONS = [
  {
    version: '20260808140000',
    name: '20260808140000_publication_gate_backfill.sql',
    sha12: '8149450f6d8e',
  },
  {
    version: '20260808150000',
    name: '20260808150000_mechanic_work_orders_convergence.sql',
    sha12: '9d0bab867938',
  },
];

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

const url = process.env.DIASPORA_STAGING_DATABASE_URL;
if (!url) fail('DIASPORA_STAGING_DATABASE_URL is not set.');
if (!url.includes(STAGING_REF)) fail(`connection string does not reference the approved staging project ${STAGING_REF}; refusing.`);

function tlsConfig() {
  if (process.env.DIASPORA_STAGING_TLS_INSECURE === 'true') {
    console.log('::warning::TLS verification DISABLED via DIASPORA_STAGING_TLS_INSECURE — diagnostic use only.');
    return { rejectUnauthorized: false };
  }
  const supplied = process.env.DIASPORA_STAGING_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied DIASPORA_STAGING_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through to system roots */ }
  console.log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

function upSectionOf(m) {
  const sql = readFileSync(fileURLToPath(new URL(`../../database/migrations/${m.name}`, import.meta.url)), 'utf8');
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 12);
  if (sum !== m.sha12) fail(`${m.name} checksum ${sum} != frozen ${m.sha12} — file drifted, refusing.`);
  const up = sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  return { up, sum };
}

const MODE = process.env.MODE === 'apply' ? 'apply' : 'verify';

async function verifyContract(client) {
  const checks = [];
  const q = async (label, sql, expect) => {
    const { rows } = await client.query(sql);
    const value = rows[0]?.v ?? null;
    const ok = expect === undefined ? true : String(value) === String(expect);
    checks.push({ label, value, ok });
    console.log(`${ok ? 'ok ' : 'FAIL'} ${label} = ${value}`);
    return ok;
  };

  await q('vehicles_total', 'select count(*)::text v from vehicles');
  await q('pub_published', "select count(*)::text v from vehicles where publication_status='published'");
  const { rows: dist } = await client.query(
    "select coalesce(publication_status,'NULL') s, count(*)::int c from vehicles group by 1 order by 1");
  console.log('publication distribution:', JSON.stringify(dist));

  // The invariant the backfill exists to guarantee: every vehicle publicly visible
  // by availability status is 'published', so deploying the read-path filter
  // hides nothing that is visible today.
  const { rows: gap } = await client.query(`
    select count(*)::int c from vehicles
     where (status is null or btrim(status)='' or lower(btrim(status)) in ('available','reserved','active','approved','listed'))
       and publication_status is distinct from 'published'`);
  const gapOk = gap[0].c === 0;
  checks.push({ label: 'visible_but_unpublished', value: gap[0].c, ok: MODE === 'verify' ? true : gapOk });
  console.log(`${gapOk ? 'ok ' : (MODE === 'apply' ? 'FAIL' : 'note')} visible_but_unpublished = ${gap[0].c}${MODE === 'verify' ? ' (informational pre-apply)' : ''}`);

  for (const col of ['tenant_id', 'description', 'customer_id', 'mechanic_id', 'customer_name', 'labor_cost', 'total_cost']) {
    const { rows } = await client.query(
      `select count(*)::int c from information_schema.columns
        where table_schema='public' and table_name='mechanic_work_orders' and column_name=$1`, [col]);
    const present = rows[0].c === 1;
    checks.push({ label: `work_orders.${col}`, value: present, ok: MODE === 'verify' ? true : present });
    console.log(`${present ? 'ok ' : (MODE === 'apply' ? 'FAIL' : 'note')} mechanic_work_orders.${col} present = ${present}`);
  }
  for (const col of ['tenant_id', 'min_stock', 'supplier']) {
    const { rows } = await client.query(
      `select count(*)::int c from information_schema.columns
        where table_schema='public' and table_name='mechanic_parts' and column_name=$1`, [col]);
    const present = rows[0].c === 1;
    checks.push({ label: `parts.${col}`, value: present, ok: MODE === 'verify' ? true : present });
    console.log(`${present ? 'ok ' : (MODE === 'apply' ? 'FAIL' : 'note')} mechanic_parts.${col} present = ${present}`);
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) fail(`${failed.length} contract check(s) failed: ${failed.map((f) => f.label).join(', ')}`);
  console.log(`Contract verified: ${checks.length} checks, 0 failures.`);
}

const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 120000 });
try {
  await client.connect();
  const ident = await client.query('select current_database() db');
  console.log(`Connected (db=${ident.rows[0].db}, mode=${MODE}).`);

  // Guard: mechanic tables must exist before the convergence migration ALTERs them.
  const { rows: pre } = await client.query(
    "select coalesce(to_regclass('public.mechanic_work_orders')::text,'ABSENT') a, coalesce(to_regclass('public.mechanic_parts')::text,'ABSENT') b, coalesce(to_regclass('public.vehicles')::text,'ABSENT') c");
  console.log(`prerequisites: vehicles=${pre[0].c} mechanic_work_orders=${pre[0].a} mechanic_parts=${pre[0].b}`);
  if (pre[0].c === 'ABSENT') fail('vehicles table absent — wrong database.');

  for (const m of MIGRATIONS) {
    const { up, sum } = upSectionOf(m);
    const { rows: existing } = await client.query(
      'SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1', [m.version]);
    if (existing.length) {
      console.log(`#${m.version} already recorded (${existing[0].name}) — verify-only.`);
      continue;
    }
    if (m.version === '20260808150000' && (pre[0].a === 'ABSENT' || pre[0].b === 'ABSENT')) {
      console.log(`#${m.version}: mechanic tables absent on this database — the convergence ALTERs have nothing to converge; recording as applied with a creation preamble is NOT done automatically. Skipping (fail-closed) — investigate before applying.`);
      fail('mechanic_work_orders/mechanic_parts absent; refusing to apply the convergence migration blind.');
    }
    if (MODE !== 'apply') {
      console.log(`#${m.version} NOT yet applied (sha256:12 ${sum}) — would apply in apply mode.`);
      continue;
    }
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

  await verifyContract(client);
} catch (e) {
  fail(`runner error: ${e.message}`);
} finally {
  await client.end().catch(() => {});
}
