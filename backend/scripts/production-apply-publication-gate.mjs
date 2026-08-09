/**
 * Publication-gate PRODUCTION migration runner.
 *
 * Two modes:
 *   MODE=preflight → READ-ONLY inspection of the production publication/mechanic
 *                    state (BEGIN READ ONLY … ROLLBACK), PLUS the full PR #139
 *                    database dependency inventory (every table, column, CHECK
 *                    constraint, and API-role grant posture the #139 runtime
 *                    depends on) so the owner sees the complete gap — not just
 *                    the slice these migrations cover — BEFORE authorizing
 *                    application. Writes nothing.
 *   MODE=apply     → applies the four migrations (publication-gate backfill,
 *                    mechanic convergence, trust side tables, API-role write
 *                    hardening), each in one transaction with its official
 *                    supabase_migrations row, then verifies the
 *                    visible==published invariant, the converged mechanic
 *                    schema, and the hardened grant posture. Requires the
 *                    exact authorization phrase.
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
  { version: '20260809100000', name: '20260809100000_trust_side_tables.sql', sha12: '8daf5a2fb89b' },
  { version: '20260809110000', name: '20260809110000_api_role_write_hardening.sql', sha12: 'ccdefddea654' },
  // Events-outbox pg_cron scheduler (seam-E). FAIL-CLOSED: the migration
  // RAISES if pg_cron or pg_net is absent, so it can never be ledgered while
  // creating no scheduler. Preflight reports both extensions read-only and
  // the apply loop refuses before the transaction when either is missing.
  // Vault secrets (CARUP_EVENTS_ENDPOINT_URL + shared CARUP_WORKER_SECRET)
  // are a post-apply activation gate: the job no-ops safely until they exist.
  { version: '20260809120000', name: '20260809120000_events_outbox_pg_cron.sql', sha12: '2c0424ffba94' },
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

// The FULL set of database surfaces the #139 runtime reads or writes, beyond
// what the four migrations themselves touch. Applying migrations proves the
// mechanism; this inventory proves (or disproves) that production actually
// holds everything else #139 assumes — the audit's Phase 8 finding was that
// the two original migrations alone are NOT the entire requirement.
const DEP_TABLES = [
  'marketplace_inquiries', 'trust_audit_events', 'partsentry_review_requests',
  'dealer_leads', 'domain_events', 'notification_queue', 'message_threads',
  'vehicle_evidence', 'vehicle_ownership_history', 'finance_applications',
  'trust_score_history', 'rolling_integrity_checkpoints',
];
const DEP_COLUMNS = [
  // Communication orchestrator variant (NOT the legacy minimal queue).
  ['notification_queue', ['event_id', 'dedupe_key', 'tenant_id', 'thread_id', 'notification_type', 'channel', 'status', 'payload']],
  // Outbox contract the event worker drains.
  ['domain_events', ['dedupe_key', 'status', 'available_at', 'aggregate_type', 'tenant_id']],
  // 20260603132036 marketplace listing summary columns the gate projection reads.
  ['vehicles', ['publication_status', 'vehicle_condition_category', 'passport_verified', 'zimra_verified', 'safe_pay_ready', 'inspection_ready']],
  // Finance tenant stamping (audit fix SM-3).
  ['finance_applications', ['tenant_id']],
];
// CHECK-constraint values the fixed runtime emits; a production CHECK that
// lacks them makes those inserts fail at runtime, invisibly to migrations.
const DEP_CHECKS = [
  ['message_threads', 'thread_type', ['account', 'trust_safety']],
  ['vehicle_evidence', 'evidence_type', ['ownership_transfer_document', 'registration_document']],
];
// API-role grant posture the hardening migration must produce (and preflight
// reports as-is, so the owner sees production's exposure BEFORE apply).
const POSTURE_TABLES = ['mechanic_work_orders', 'mechanic_parts', 'vehicle_ownership_history', 'vehicles', 'vehicle_evidence', 'trust_score_history', 'rolling_integrity_checkpoints'];

async function inventoryDependencies(client) {
  console.log('── #139 dependency inventory ──');
  const dep = { missingTables: [], missingColumns: [], missingCheckValues: [], vinUnique: false };

  const { rows: tabs } = await client.query(
    `select t.name, (to_regclass('public.'||t.name) is not null) as present
       from unnest($1::text[]) as t(name)`, [DEP_TABLES]);
  for (const t of tabs) {
    console.log(`${t.present ? 'ok ' : 'MISSING'} table ${t.name}`);
    if (!t.present) dep.missingTables.push(t.name);
  }

  for (const [table, cols] of DEP_COLUMNS) {
    const { rows } = await client.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name=$1 and column_name = any($2)`, [table, cols]);
    const present = new Set(rows.map((r) => r.column_name));
    const missing = cols.filter((c) => !present.has(c));
    console.log(missing.length
      ? `MISSING columns ${table}: ${missing.join(', ')}`
      : `ok  columns ${table}: ${cols.length}/${cols.length}`);
    dep.missingColumns.push(...missing.map((c) => `${table}.${c}`));
  }

  for (const [table, column, values] of DEP_CHECKS) {
    const { rows } = await client.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = to_regclass('public.'||$1::text) and contype='c'
          and pg_get_constraintdef(oid) like '%'||$2||'%'`, [table, column]);
    const def = rows.map((r) => r.def).join(' ');
    const missing = def ? values.filter((v) => !def.includes(`'${v}'`)) : values.slice();
    console.log(missing.length
      ? `MISSING CHECK values ${table}.${column}: ${missing.join(', ')}${def ? '' : ' (no CHECK found)'}`
      : `ok  CHECK ${table}.${column} admits: ${values.join(', ')}`);
    dep.missingCheckValues.push(...missing.map((v) => `${table}.${column}='${v}'`));
  }

  const { rows: vin } = await client.query(
    `select count(*)::int c from pg_constraint
      where conrelid = to_regclass('public.vehicles') and contype in ('p','u')
        and (select array_agg(attname::text) from unnest(conkey) k join pg_attribute a
              on a.attrelid = conrelid and a.attnum = k) = array['vin']`);
  dep.vinUnique = vin[0].c > 0;
  console.log(`${dep.vinUnique ? 'ok ' : 'MISSING'} vehicles.vin PRIMARY KEY/UNIQUE (FK target for rolling_integrity_checkpoints)`);

  const { rows: posture } = await client.query(
    `select c.relname, c.relrowsecurity,
            coalesce((select string_agg(distinct g.grantee||':'||g.privilege_type, ',' order by g.grantee||':'||g.privilege_type)
                        from information_schema.role_table_grants g
                       where g.table_schema='public' and g.table_name=c.relname
                         and g.grantee in ('anon','authenticated')), 'none') as api_grants
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname = any($1)`, [POSTURE_TABLES]);
  dep.posture = {};
  for (const p of posture) {
    dep.posture[p.relname] = { rls: p.relrowsecurity, apiGrants: p.api_grants };
    console.log(`posture ${p.relname}: rls=${p.relrowsecurity ? 'on' : 'OFF'} api_grants=${p.api_grants}`);
  }

  const { rows: pend } = await client.query(
    "select coalesce(to_regclass('public.domain_events')::text,'ABSENT') t");
  if (pend[0].t !== 'ABSENT') {
    const { rows } = await client.query(
      "select count(*)::text v from domain_events where status='pending'");
    console.log(`advisory domain_events pending = ${rows[0].v} (outbox drain health, informational)`);
  }

  // Events-outbox scheduler (#20260809120000) — read-only capability
  // inventory. Secret VALUES never leave the database: booleans only.
  const { rows: sched } = await client.query(`
    select
      exists (select 1 from pg_extension where extname='pg_cron') as has_cron,
      exists (select 1 from pg_extension where extname='pg_net')  as has_net`);
  dep.pgCron = sched[0].has_cron;
  dep.pgNet = sched[0].has_net;
  console.log(`${dep.pgCron ? 'ok ' : 'MISSING'} pg_cron extension (#20260809120000 is fail-closed without it)`);
  console.log(`${dep.pgNet ? 'ok ' : 'MISSING'} pg_net extension (#20260809120000 is fail-closed without it)`);
  try {
    const { rows: v } = await client.query(`
      select
        exists (select 1 from vault.decrypted_secrets where name='CARUP_EVENTS_ENDPOINT_URL') as has_url,
        exists (select 1 from vault.decrypted_secrets where name='CARUP_WORKER_SECRET')       as has_secret`);
    console.log(`events scheduler Vault: endpoint_url_present=${v[0].has_url} worker_secret_present=${v[0].has_secret} (booleans only; activation gate, non-blocking)`);
  } catch {
    console.log('events scheduler Vault: not readable with this role (informational)');
  }
  try {
    const { rows: job } = await client.query(
      "select schedule, active from cron.job where jobname='carup-events-outbox-every-minute'");
    console.log(job.length
      ? `events cron job: present schedule='${job[0].schedule}' active=${job[0].active}`
      : 'events cron job: absent (created by #20260809120000)');
  } catch {
    console.log('events cron job: cron schema not readable (informational — absent until pg_cron is enabled)');
  }

  return dep;
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
  const dep = await inventoryDependencies(client);
  return { total: Number(total), gap: Number(gap), workOrdersPresent: tables[0].wo !== 'ABSENT', partsPresent: tables[0].mp !== 'ABSENT', dep };
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
      if (m.version === '20260809100000' && !before.dep.vinUnique) {
        fail('vehicles.vin has no PRIMARY KEY/UNIQUE constraint on production — the rolling_integrity_checkpoints FK cannot be created; refusing.');
      }
      if (m.version === '20260809110000') {
        const targets = ['mechanic_work_orders', 'mechanic_parts', 'vehicle_ownership_history', 'vehicles', 'vehicle_evidence'];
        const absent = targets.filter((t) => !before.dep.posture[t]);
        if (absent.length) fail(`hardening targets absent on production: ${absent.join(', ')} — refusing to apply blind.`);
      }
      if (m.version === '20260809120000' && (!before.dep.pgCron || !before.dep.pgNet)) {
        fail('pg_cron/pg_net not installed on production — #20260809120000 is fail-closed and would abort; enable both extensions (Dashboard -> Database -> Extensions) and re-run.');
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
    const post = await inspect(client, 'post-apply');

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

    // Hardened-posture contract, fail-closed like the mechanic contract: once
    // the trust/hardening migrations are recorded, the posture they promise
    // must actually hold — a ledger row without the posture is drift.
    const after = post.dep;
    const { rows: trustLedger } = await client.query(
      "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260809100000'");
    if (trustLedger.length) {
      const gone = ['trust_score_history', 'rolling_integrity_checkpoints'].filter((t) => after.missingTables.includes(t));
      if (gone.length) fail(`trust side tables recorded but absent: ${gone.join(', ')} — schema drift.`);
      console.log('ok  trust side tables present.');
    }
    const { rows: hardLedger } = await client.query(
      "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260809110000'");
    if (hardLedger.length) {
      const bad = [];
      for (const [table, expect] of [
        ['mechanic_work_orders', 'none'], ['mechanic_parts', 'none'],
        ['vehicle_ownership_history', 'none'], ['trust_score_history', 'none'],
        ['rolling_integrity_checkpoints', 'none'],
        // SELECT-only for both API roles — anything beyond that is residue.
        ['vehicles', 'anon:SELECT,authenticated:SELECT'],
        ['vehicle_evidence', 'anon:SELECT,authenticated:SELECT'],
      ]) {
        const p = after.posture[table];
        if (!p) { bad.push(`${table}: absent`); continue; }
        if (!p.rls) bad.push(`${table}: rls off`);
        if (p.apiGrants !== expect) bad.push(`${table}: api_grants=${p.apiGrants} (expected ${expect})`);
      }
      if (bad.length) fail(`hardening recorded but posture drifted: ${bad.join('; ')}`);
      console.log('ok  API-role hardened posture verified on all 7 tables.');
    }

    console.log('APPLY COMPLETE — pre-apply visible==published invariant holds; mechanic contract verified; trust tables + hardened posture verified.');
  }
} catch (e) {
  fail(`runner error: ${e.message}`);
} finally {
  await client.end().catch(() => {});
}
