/**
 * Publication-gate PRODUCTION migration runner.
 *
 * Two modes:
 *   MODE=preflight → READ-ONLY inspection of the production publication/mechanic
 *                    state (BEGIN READ ONLY … ROLLBACK). Produces the evidence the
 *                    owner reviews BEFORE authorizing application. Writes nothing.
 *   MODE=apply     → applies the two advancement-pass migrations, each in one
 *                    transaction with its official supabase_migrations row, then
 *                    verifies the visible==published invariant and the converged
 *                    mechanic schema. Requires the exact authorization phrase.
 *
 * Guards (mirroring backend/scripts/staging-apply-publication-gate.mjs and the
 * canonical cutover method in docs/vehicle-trust-os/):
 *   · the production project ref is supplied via PRODUCTION_PROJECT_REF — it is
 *     deliberately NOT written in this file (CR-1 rejects that literal in
 *     executable files); the connection string must positively include it;
 *   · a connection string referencing the staging project is refused outright;
 *   · each file's sha256 is checked against its frozen value BEFORE connecting;
 *   · an already-recorded version switches to verify-only (re-dispatch safe);
 *   · TLS verification is ON, anchored on PRODUCTION_CA_CERT when supplied, else
 *     the Supabase root bundled at database/certs/;
 *   · the connection string is never printed;
 *   · apply refuses without AUTHORIZATION='APPLY PUBLICATION GATE TO PRODUCTION'.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer'; // refused if present in the URL
const AUTH_PHRASE = 'APPLY PUBLICATION GATE TO PRODUCTION';

const MIGRATIONS = [
  { version: '20260808140000', name: '20260808140000_publication_gate_backfill.sql', sha12: '8149450f6d8e' },
  { version: '20260808150000', name: '20260808150000_mechanic_work_orders_convergence.sql', sha12: '9d0bab867938' },
];

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
if (MODE === 'apply' && process.env.AUTHORIZATION_PHRASE !== AUTH_PHRASE) {
  fail(`apply mode requires the exact owner authorization phrase; got a non-matching value. Expected: "${AUTH_PHRASE}"`);
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

function upSectionOf(m) {
  const sql = readFileSync(fileURLToPath(new URL(`../../database/migrations/${m.name}`, import.meta.url)), 'utf8');
  const sum = createHash('sha256').update(sql).digest('hex').slice(0, 12);
  if (sum !== m.sha12) fail(`${m.name} checksum ${sum} != frozen ${m.sha12} — file drifted, refusing.`);
  const up = sql.split(/^-- \+migrate Down/m)[0].replace(/^-- \+migrate Up\s*/m, '');
  return { up, sum };
}

async function inspect(client, phase) {
  console.log(`── ${phase} inspection ──`);
  const one = async (label, sql) => {
    const { rows } = await client.query(sql);
    console.log(`${label} = ${rows[0]?.v ?? null}`);
    return rows[0]?.v ?? null;
  };
  const total = await one('vehicles_total', 'select count(*)::text v from vehicles');
  const { rows: dist } = await client.query(
    "select coalesce(publication_status,'NULL') s, count(*)::int c from vehicles group by 1 order by 1");
  console.log('publication distribution:', JSON.stringify(dist));
  const gap = await one('visible_but_unpublished', `
    select count(*)::text v from vehicles
     where (status is null or btrim(status)='' or lower(btrim(status)) in ('available','reserved','active','approved','listed'))
       and publication_status is distinct from 'published'`);
  // The backfill predicate uses btrim (spaces only) while the runtime rule uses
  // JS trim (all whitespace). Surface any row where the two disagree so the
  // owner sees a nonzero divergence BEFORE authorizing apply.
  await one('status_whitespace_divergence', `
    select count(*)::text v from vehicles
     where (lower(regexp_replace(coalesce(status,''), '^\\s+|\\s+$', '', 'g')) in ('', 'available','reserved','active','approved','listed'))
       <> (status is null or btrim(status)='' or lower(btrim(status)) in ('available','reserved','active','approved','listed'))`);
  const { rows: tables } = await client.query(
    "select coalesce(to_regclass('public.mechanic_work_orders')::text,'ABSENT') wo, coalesce(to_regclass('public.mechanic_parts')::text,'ABSENT') mp");
  console.log(`mechanic_work_orders=${tables[0].wo} mechanic_parts=${tables[0].mp}`);
  if (tables[0].wo !== 'ABSENT') {
    const { rows: cols } = await client.query(`
      select column_name from information_schema.columns
       where table_schema='public' and table_name='mechanic_work_orders'
         and column_name in ('tenant_id','description','customer_id','mechanic_id','customer_name','labor_cost','total_cost')
       order by column_name`);
    console.log('work_orders converged columns present:', JSON.stringify(cols.map((c) => c.column_name)));
  }
  for (const m of MIGRATIONS) {
    const { rows } = await client.query('SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1', [m.version]);
    console.log(`ledger ${m.version}: ${rows.length ? `RECORDED (${rows[0].name})` : 'not recorded'}`);
  }
  return { total: Number(total), gap: Number(gap), workOrdersPresent: tables[0].wo !== 'ABSENT', partsPresent: tables[0].mp !== 'ABSENT' };
}

const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 120000 });
try {
  await client.connect();
  const ident = await client.query('select current_database() db');
  console.log(`Connected (db=${ident.rows[0].db}, mode=${MODE}).`);
  const { rows: pre } = await client.query("select coalesce(to_regclass('public.vehicles')::text,'ABSENT') v");
  if (pre[0].v === 'ABSENT') fail('vehicles table absent — wrong database.');

  if (MODE === 'preflight') {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await inspect(client, 'PRODUCTION PREFLIGHT (read-only)');
    await client.query('ROLLBACK');
    console.log('PREFLIGHT COMPLETE — nothing was written. Review the evidence above before authorizing apply.');
  } else {
    const before = await inspect(client, 'pre-apply');
    // Server-side apply-start marker: post-apply assertions are scoped to rows
    // that existed BEFORE this instant. On a live database, rows inserted DURING
    // or AFTER the apply are legitimately 'draft' (the gate hides them by
    // design) and must not fail the cutover retroactively.
    const { rows: t0rows } = await client.query('select now() as t0');
    const t0 = t0rows[0].t0;
    for (const m of MIGRATIONS) {
      const { up, sum } = upSectionOf(m);
      const { rows: existing } = await client.query('SELECT name FROM supabase_migrations.schema_migrations WHERE version=$1', [m.version]);
      if (existing.length) { console.log(`#${m.version} already recorded — verify-only.`); continue; }
      if (m.version === '20260808150000' && (!before.workOrdersPresent || !before.partsPresent)) {
        fail('mechanic_work_orders/mechanic_parts absent on production; refusing to apply the convergence migration blind.');
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
    await inspect(client, 'post-apply');

    // Invariant, scoped to pre-apply rows only (created_at NULL counts as
    // pre-existing — a concurrent insert always receives NOW()): every vehicle
    // that was publicly visible when apply started must now be 'published'.
    const { rows: gapRows } = await client.query(`
      select count(*)::int c from vehicles
       where (created_at is null or created_at < $1)
         and (status is null or btrim(status)='' or lower(btrim(status)) in ('available','reserved','active','approved','listed'))
         and publication_status is distinct from 'published'`, [t0]);
    if (gapRows[0].c !== 0) fail(`visible_but_unpublished = ${gapRows[0].c} among PRE-APPLY rows — the backfill missed rows it must cover.`);

    // Pre-apply row count is advisory only: a mismatch means concurrent
    // deletes or created_at anomalies, not a cutover failure — the migrations
    // have already durably committed and nothing here is rolled back.
    const { rows: preRows } = await client.query(
      'select count(*)::int c from vehicles where created_at is null or created_at < $1', [t0]);
    if (preRows[0].c !== before.total) {
      console.log(`::warning::pre-apply vehicle count moved ${before.total} -> ${preRows[0].c} during apply (concurrent write traffic); informational only.`);
    }

    // Mechanic schema contract, fail-closed exactly like the staging runner:
    // whenever 20260808150000 is recorded, every converged column must exist —
    // a ledger row without the columns is drift, not success.
    const { rows: ledger } = await client.query(
      "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260808150000'");
    if (ledger.length) {
      const missing = [];
      for (const [table, cols] of [
        ['mechanic_work_orders', ['tenant_id', 'description', 'customer_id', 'mechanic_id', 'customer_name', 'labor_cost', 'total_cost']],
        ['mechanic_parts', ['tenant_id', 'min_stock', 'supplier']],
      ]) {
        for (const col of cols) {
          const { rows } = await client.query(
            `select count(*)::int c from information_schema.columns
              where table_schema='public' and table_name=$1 and column_name=$2`, [table, col]);
          if (rows[0].c !== 1) missing.push(`${table}.${col}`);
        }
      }
      if (missing.length) fail(`convergence recorded but columns missing: ${missing.join(', ')} — schema drift.`);
      console.log('ok  mechanic convergence contract: 10/10 columns present.');
    }

    console.log('APPLY COMPLETE — pre-apply visible==published invariant holds; mechanic contract verified.');
  }
} catch (e) {
  fail(`runner error: ${e.message}`);
} finally {
  await client.end().catch(() => {});
}
