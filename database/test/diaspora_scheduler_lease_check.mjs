/**
 * Diaspora ledger #27 — durable scheduled execution, verified by EXECUTING the migration on real
 * PostgreSQL 17.5 (PGlite). Issue #127, Phase 2E.
 *
 * WHAT IS ACTUALLY BEING PROVED
 * -----------------------------
 * The scheduler's entire safety argument is its claim. Two cron dispatchers overlap by design, and
 * the difference between "two reconciliations ran" (harmless) and "two renewal sweeps ran" (a
 * duplicate charge) is enforced nowhere except in SQL. So this harness executes the real migration
 * and then drives the real functions:
 *
 *   1. THE ACL CONTRACT (ledger #20), applied in the SAME migration that creates the tables. The
 *      bootstrap below models Supabase's `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon,
 *      authenticated` — the exact hazard that made ledgers #17/#19/#20 necessary, and that vanilla
 *      Postgres does not reproduce. Without modelling it, a migration that only revoked from PUBLIC
 *      would look correct here and leave anon with full grants on the live database.
 *   2. THE CLAIM'S DECISION TREE, in order, with each refusal reason distinguishable — because "did
 *      not run" has five very different meanings and an operator staring at a quiet job needs to know
 *      which one it was.
 *   3. THE LEASE, including that an EXPIRED one is takeable (a worker killed by a serverless timeout
 *      must not lock a job out forever) and that a zombie CANNOT settle a lease that was taken over
 *      (its stale run must not stamp `last_success_at`, the value an alert watches).
 *   4. THE TERMINUS: repeated failure ends at `needs_operator` with `next_run_at` NULL, and the CHECK
 *      constraint makes the alternative — a dead job that still carries a run time — unrepresentable.
 *   5. THE RENEWAL IDEMPOTENCY: the unique index really refuses a second row for the same period.
 *
 * HARNESS LIMIT, STATED PLAINLY: PGlite is a single connection, so `FOR UPDATE SKIP LOCKED` cannot be
 * shown SKIPPING here — nothing else can hold the row. Everything else about the claim is exercised.
 * The two-session partition proof lives in `backend/tests/realpg/scheduler-lease-realpg.mjs`, which
 * opens two real connections; the service-level guarantee is proved in
 * `backend/tests/diaspora-scheduler.test.js`.
 *
 * Run:  node database/test/diaspora_scheduler_lease_check.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const LEDGERS = { 27: '20260731100000_diaspora_scheduler_leases.sql' };

const results = { checks: [], ok: true };
const record = (label, passed, detail = null) => {
  results.checks.push({ label, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) results.ok = false;
  return passed;
};

function upOf(file) {
  const raw = readFileSync(join(MIG, file), 'utf-8');
  const idx = raw.indexOf('-- +migrate Down');
  return (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
}
const sha12 = (file) => createHash('sha256').update(readFileSync(join(MIG, file), 'utf-8')).digest('hex').slice(0, 12);

async function exec(db, label, sql, expectPass = true) {
  try { await db.exec(sql); return record(label, expectPass); }
  catch (e) { return record(label, !expectPass, String(e.message || e)); }
}

// The Supabase-compatible environment. `ALTER DEFAULT PRIVILEGES` is the load-bearing part: it is what
// makes a freshly created public-schema table readable by `anon` the instant it exists.
const BOOTSTRAP = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS extensions;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  CREATE OR REPLACE FUNCTION public.set_diaspora_trade_os_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END $$;
`;

const db = new PGlite();
console.log('Diaspora ledger #27 — scheduler leases, real-Postgres behaviour');
console.log(`  ledger #27 sha256:12 = ${sha12(LEDGERS[27])}\n`);

await exec(db, 'bootstrap: Supabase-compat roles + default privileges + updated_at helper', BOOTSTRAP);
await exec(db, 'ledger #27 applies', upOf(LEDGERS[27]));
// Idempotence matters: a partially-applied migration must be safe to re-run.
await exec(db, 'ledger #27 is idempotent (re-apply is a no-op)', upOf(LEDGERS[27]));

if (!results.ok) {
  console.log('\nSCHEMA DID NOT APPLY — aborting before behavioural assertions:');
  for (const f of results.checks.filter((c) => c.status === 'FAIL')) console.log(`  ✗ ${f.label} — ${f.detail}`);
  process.exit(1);
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const claim = async (params) => (await one(
  `SELECT public.diaspora_scheduler_claim_atomic($1::text,$2::text,$3::integer,$4::integer,$5::boolean,$6::boolean,$7::timestamptz) AS r`,
  params)).r;
const release = async (params) => (await one(
  `SELECT public.diaspora_scheduler_release_atomic($1::text,$2::text,$3::boolean,$4::text,$5::text,$6::uuid,$7::integer,$8::integer,$9::integer,$10::timestamptz) AS r`,
  params)).r;

const T0 = '2026-07-31T09:00:00Z';
const later = (seconds) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

// ── 1. The ACL contract, applied at CREATE time ─────────────────────────────
{
  const TABLES = ['diaspora_scheduled_jobs', 'diaspora_scheduler_runs', 'diaspora_subscription_renewals'];
  for (const table of TABLES) {
    const row = await one(
      `SELECT c.relrowsecurity AS rls, c.relacl::text AS acl,
              (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=$1)::int AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=$1`, [table]);
    record(`${table}: RLS is enabled`, row?.rls === true);
    // Zero policies = default-deny. A service-role-only ledger; RLS is the second line behind grants.
    record(`${table}: zero policies (default-deny)`, row?.policies === 0, `policies=${row?.policies}`);
    const acl = row?.acl || '';
    record(`${table}: anon holds NO privileges (Supabase default grant revoked)`,
      !/[,{]anon=/.test(acl), `acl=${acl}`);
    record(`${table}: authenticated holds NO privileges`, !/[,{]authenticated=/.test(acl), `acl=${acl}`);
    record(`${table}: service_role holds full privileges`, /service_role=arwdDxt/.test(acl), `acl=${acl}`);
  }

  for (const fn of ['diaspora_scheduler_claim_atomic', 'diaspora_scheduler_release_atomic']) {
    const rows = await all(
      `SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`, [fn]);
    record(`${fn}: exactly one definition (no accidental overload)`, rows.length === 1, `count=${rows.length}`);
    const acl = rows[0]?.acl || '';
    record(`${fn}: anon and authenticated hold no EXECUTE`,
      !/[,{]anon=/.test(acl) && !/[,{]authenticated=/.test(acl), `acl=${acl}`);
    record(`${fn}: service_role holds EXECUTE`, /service_role=X/.test(acl), `acl=${acl}`);
    record(`${fn}: search_path is pinned`, /search_path/.test(rows[0]?.cfg || ''), `cfg=${rows[0]?.cfg}`);
  }
}

// ── 2. Bootstrap and the disabled-by-default posture ────────────────────────
{
  const r = await claim(['billing_reconciliation', 'worker-a', 300, 3600, false, true, T0]);
  record('a first claim bootstraps the job row rather than failing', (await all(
    `SELECT 1 FROM public.diaspora_scheduled_jobs WHERE job_key='billing_reconciliation'`)).length === 1);
  // The row appearing is NOT permission to run it.
  record('a newly bootstrapped job is DISABLED, so the claim is refused', r.claimed === false && r.reason === 'DISABLED',
    JSON.stringify(r));

  await db.query(`UPDATE public.diaspora_scheduled_jobs SET enabled=true WHERE job_key='billing_reconciliation'`);
  const r2 = await claim(['billing_reconciliation', 'worker-a', 300, 3600, false, true, T0]);
  record('once enabled, the claim succeeds and leaves a lease', r2.claimed === true && Boolean(r2.leased_until));
}

// ── 3. The lease ────────────────────────────────────────────────────────────
{
  const other = await claim(['billing_reconciliation', 'worker-b', 300, 3600, false, true, later(10)]);
  record('a second worker is refused while the lease is live, and told WHY',
    other.claimed === false && other.reason === 'LEASED', JSON.stringify(other));

  // An expired lease must be takeable: a worker killed by a serverless timeout cannot be allowed to
  // lock a job out forever.
  const afterExpiry = await claim(['billing_reconciliation', 'worker-b', 300, 3600, false, true, later(400)]);
  record('an EXPIRED lease is takeable by another worker', afterExpiry.claimed === true, JSON.stringify(afterExpiry));

  // worker-a is now a zombie. Its late settle must not touch worker-b's lease.
  const zombie = await release(['billing_reconciliation', 'worker-a', true, null, null, null, 5, 60, 3600, later(420)]);
  record('a zombie cannot settle a lease that was taken over', zombie.released === false && zombie.reason === 'LEASE_LOST',
    JSON.stringify(zombie));
  const job = await one(`SELECT last_success_at, lease_owner FROM public.diaspora_scheduled_jobs WHERE job_key='billing_reconciliation'`);
  record('the zombie did NOT stamp last_success_at (the value an alert watches)', job.last_success_at === null);
  record('the live owner still holds the lease', job.lease_owner === 'worker-b');
}

// ── 4. Success reschedules; NOT_DUE is honoured ─────────────────────────────
{
  const ok = await release(['billing_reconciliation', 'worker-b', true, null, null, null, 5, 60, 3600, later(430)]);
  record('a successful release schedules the next run one interval out',
    ok.released === true && Math.abs(Date.parse(ok.next_run_at) - (Date.parse(later(430)) + 3600_000)) < 2000,
    JSON.stringify(ok));

  const early = await claim(['billing_reconciliation', 'worker-c', 300, 3600, false, true, later(440)]);
  record('a job that is not due yet is refused with NOT_DUE', early.claimed === false && early.reason === 'NOT_DUE',
    JSON.stringify(early));

  // An operator run ignores the schedule — the automatic path being stuck is exactly when a human
  // needs to be able to run it.
  const operator = await claim(['billing_reconciliation', 'operator-1', 300, 3600, true, false, later(450)]);
  record('an operator run ignores the schedule and the enabled switch', operator.claimed === true, JSON.stringify(operator));
  await release(['billing_reconciliation', 'operator-1', true, null, null, null, 5, 60, 3600, later(460)]);
}

// ── 5. Backoff and the terminus ─────────────────────────────────────────────
{
  await db.query(`INSERT INTO public.diaspora_scheduled_jobs (job_key, enabled, interval_seconds) VALUES ('drive_sync_retry', true, 300)`);
  let last = null;
  for (let i = 1; i <= 5; i += 1) {
    const c = await claim(['drive_sync_retry', `w${i}`, 300, 300, true, true, later(1000 + i * 10)]);
    if (!c.claimed) { record(`failure ${i}: claim succeeded`, false, JSON.stringify(c)); break; }
    last = await release(['drive_sync_retry', `w${i}`, false, 'downstream is down', 'DOWNSTREAM', null, 5, 60, 3600, later(1000 + i * 10 + 1)]);
    const row = await one(`SELECT state, consecutive_failures, next_run_at FROM public.diaspora_scheduled_jobs WHERE job_key='drive_sync_retry'`);
    if (i < 5) {
      record(`failure ${i}: backs off with a FUTURE due time, still idle`,
        row.state === 'idle' && row.next_run_at !== null, JSON.stringify(row));
    }
    record(`failure ${i}: the consecutive counter advanced`, Number(row.consecutive_failures) === i);
  }
  const dead = await one(`SELECT state, next_run_at, last_error, last_error_code FROM public.diaspora_scheduled_jobs WHERE job_key='drive_sync_retry'`);
  record('at the ceiling the job reaches the NEEDS_OPERATOR terminus', dead.state === 'needs_operator', JSON.stringify(dead));
  // Cleared, so no dispatcher can pick it up again. A dead job that keeps retrying is how a real
  // defect becomes background noise.
  record('the terminus clears next_run_at — it is terminal, not a slower loop', dead.next_run_at === null);
  record('the failure reason is durable', dead.last_error === 'downstream is down' && dead.last_error_code === 'DOWNSTREAM');
  record('the release reported the dead-letter', last?.dead_lettered === true, JSON.stringify(last));

  const blocked = await claim(['drive_sync_retry', 'auto', 300, 300, false, true, later(9999)]);
  record('a scheduled claim on a terminated job is refused with NEEDS_OPERATOR',
    blocked.claimed === false && blocked.reason === 'NEEDS_OPERATOR', JSON.stringify(blocked));
  const rescued = await claim(['drive_sync_retry', 'operator-2', 300, 300, true, false, later(9999)]);
  record('an operator can still rescue a terminated job', rescued.claimed === true, JSON.stringify(rescued));
}

// ── 5b. The backoff window cannot overflow int4 at a CONFIGURED max_failures ─
//
// This section exists because its absence hid a real defect. Every other failure-loop assertion above
// drives p_max_failures = 5, so the exponent never exceeded 2^4 — while schedulerMaxFailures() in
// backend/constants/diaspora/diasporaSchedulerConstants.js accepts DIASPORA_SCHEDULER_MAX_FAILURES up
// to 50. The window was computed as `base * (2 ^ (v_failures - 1))::integer` with LEAST() applied
// AROUND it, and a clamp cannot prevent an overflow inside its own argument: at v_failures = 27 with
// base 60 the product exceeds int4 and the RPC raised `integer out of range`.
//
// The failure mode was not a wrong delay. The release aborts, so the job stays leased with its
// counter frozen one short of the ceiling and next_run_at in the past — it can NEVER reach the
// terminus, and every tick after the lease expires re-claims and re-fails it forever.
//
// The JS model in backend/tests/helpers/schedulerRpcModel.js computes the same window in IEEE
// doubles, which cannot overflow, so it silently disagreed with the SQL exactly where the SQL broke.
// That is why no unit test could catch this either.
{
  await db.query(`INSERT INTO public.diaspora_scheduled_jobs (job_key, enabled, interval_seconds) VALUES ('billing_event_retry', true, 300)`);

  const MAX = 50;
  let crossed = null;
  let aborted = null;
  for (let i = 1; i <= 30; i += 1) {
    const c = await claim(['billing_event_retry', `w${i}`, 300, 300, true, true, later(5000 + i * 10)]);
    if (!c.claimed) { aborted = `claim refused at failure ${i}: ${JSON.stringify(c)}`; break; }
    try {
      const r = await release(['billing_event_retry', `w${i}`, false, 'downstream down', 'DOWN', null, MAX, 60, 3600, later(5000 + i * 10 + 1)]);
      if (i >= 27) crossed = { i, r };
    } catch (err) {
      aborted = `release RAISED at failure ${i}: ${err.message}`;
      break;
    }
  }

  record('the release RPC survives past 26 consecutive failures (no int4 overflow)', aborted === null, aborted || '');
  record('the counter actually crossed the old overflow boundary', crossed !== null, `reached=${crossed?.i ?? 'never'}`);

  const row = await one(`SELECT state, consecutive_failures, next_run_at FROM public.diaspora_scheduled_jobs WHERE job_key='billing_event_retry'`);
  record('with max_failures=50 the job keeps advancing rather than freezing at 26',
    Number(row.consecutive_failures) >= 27, JSON.stringify(row));

  // The clamp must still clamp: a huge exponent must not produce a huge window.
  const { w } = await one(
    `SELECT LEAST(GREATEST(3600,1)::bigint, GREATEST(60,1)::bigint * (2 ^ LEAST(49, 30))::bigint)::integer AS w`);
  record('the window stays clamped to backoff_max_seconds at a huge exponent', Number(w) === 3600, `w=${w}`);

  // Negative control: the ORIGINAL expression really does overflow, so the assertions above are not
  // passing because the boundary moved somewhere unreachable.
  let originalOverflowed = false;
  try {
    await db.query(`SELECT LEAST(GREATEST(3600,1), GREATEST(60,1) * (2 ^ (27 - 1))::integer)`);
  } catch (err) {
    originalOverflowed = /out of range/i.test(err.message);
  }
  record('NEGATIVE CONTROL: the pre-fix expression still overflows at 27', originalOverflowed === true);
}

// ── 6. The constraints make bad states unrepresentable ──────────────────────
{
  await exec(db, 'CHECK: a needs_operator job cannot carry a next_run_at',
    `UPDATE public.diaspora_scheduled_jobs SET state='needs_operator', next_run_at=now() WHERE job_key='drive_sync_retry'`, false);
  await exec(db, 'CHECK: a lease owner without an expiry is refused',
    `UPDATE public.diaspora_scheduled_jobs SET lease_owner='x', leased_until=NULL WHERE job_key='billing_reconciliation'`, false);
  await exec(db, 'CHECK: an interval faster than 30s is refused',
    `INSERT INTO public.diaspora_scheduled_jobs (job_key, interval_seconds) VALUES ('too_fast', 5)`, false);
  await exec(db, 'CHECK: an interval slower than a day is refused',
    `INSERT INTO public.diaspora_scheduled_jobs (job_key, interval_seconds) VALUES ('too_slow', 90000)`, false);
  await exec(db, 'CHECK: an unknown job state is refused',
    `INSERT INTO public.diaspora_scheduled_jobs (job_key, state) VALUES ('bad_state', 'whatever')`, false);
  await exec(db, 'CHECK: a terminal run must carry a finished_at',
    `INSERT INTO public.diaspora_scheduler_runs (job_key, trigger, state) VALUES ('x', 'scheduled', 'completed')`, false);
  await exec(db, 'a running run may have no finished_at',
    `INSERT INTO public.diaspora_scheduler_runs (job_key, trigger, state) VALUES ('x', 'scheduled', 'running')`, true);
  await exec(db, 'CHECK: an unknown trigger is refused',
    `INSERT INTO public.diaspora_scheduler_runs (job_key, trigger, state) VALUES ('x', 'whenever', 'running')`, false);
}

// ── 7. Renewal idempotency is the DATABASE's ────────────────────────────────
{
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const SUB = '33333333-3333-3333-3333-333333333333';
  await exec(db, 'a due renewal is recorded',
    `INSERT INTO public.diaspora_subscription_renewals (tenant_id, subscription_id, provider, period_end, state)
     VALUES ('${TENANT}','${SUB}','paynow','2026-08-01T00:00:00Z','needs_operator')`, true);
  // On the other side of a SELECT-then-INSERT window is a duplicate charge. The unique index is what
  // makes two overlapping sweeps produce one row.
  await exec(db, 'a SECOND record for the same period is REFUSED by the unique index',
    `INSERT INTO public.diaspora_subscription_renewals (tenant_id, subscription_id, provider, period_end, state)
     VALUES ('${TENANT}','${SUB}','paynow','2026-08-01T00:00:00Z','needs_operator')`, false);
  await exec(db, 'the NEXT period is a different row, not a duplicate',
    `INSERT INTO public.diaspora_subscription_renewals (tenant_id, subscription_id, provider, period_end, state)
     VALUES ('${TENANT}','${SUB}','paynow','2026-09-01T00:00:00Z','needs_operator')`, true);
  await exec(db, 'CHECK: an unknown renewal state is refused',
    `INSERT INTO public.diaspora_subscription_renewals (tenant_id, subscription_id, provider, period_end, state)
     VALUES ('${TENANT}','${SUB}','paynow','2026-10-01T00:00:00Z','charged')`, false);

  const cols = (await all(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='diaspora_subscription_renewals'`)).map((r) => r.column_name);
  // A schema that can express a charge will eventually be used to make one.
  const money = ['amount', 'amount_cents', 'currency', 'payment_ref', 'poll_url', 'card_last4'];
  record('the renewal table carries NO money fields (detection only; ADR-001 §9 gates collection)',
    money.every((c) => !cols.includes(c)), `columns=${cols.join(',')}`);
}

// ── 8. The Down block really drops only what the Up created ─────────────────
{
  const raw = readFileSync(join(MIG, LEDGERS[27]), 'utf-8');
  const down = raw.slice(raw.indexOf('-- +migrate Down')).replace('-- +migrate Down', '');
  await exec(db, 'the Down block applies', down);
  const left = await all(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND c.relname IN ('diaspora_scheduled_jobs','diaspora_scheduler_runs','diaspora_subscription_renewals')`);
  record('Down removed all three tables', left.length === 0, `left=${left.map((r) => r.relname).join(',')}`);
  const fns = await all(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'diaspora_scheduler_%'`);
  record('Down removed both functions', fns.length === 0, `left=${fns.map((r) => r.proname).join(',')}`);
}

// ── Report ───────────────────────────────────────────────────────────────────
const failed = results.checks.filter((c) => c.status === 'FAIL');
console.log(`${results.checks.length} assertions · ${results.checks.length - failed.length} passed · ${failed.length} failed\n`);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
} else {
  for (const c of results.checks) console.log(`  ✓ ${c.label}`);
}
console.log('');
console.log(JSON.stringify({ ledger27: sha12(LEDGERS[27]), ok: results.ok, total: results.checks.length, failed: failed.length }, null, 2));
process.exit(results.ok ? 0 : 1);
