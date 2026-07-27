// Real-Postgres proof for the ledger #27 scheduler lease (Issue #127, Phase 2E).
//
// WHY THIS HARNESS EXISTS SEPARATELY
// ---------------------------------
// `database/test/diaspora_scheduler_lease_check.mjs` exercises everything about ledger #27 that a
// SINGLE connection can reach — the ACL contract, the claim's decision tree, the lease expiry, the
// zombie refusal, the backoff, the terminus, the renewal unique index. It cannot reach the one thing
// the whole design rests on, because PGlite is a single connection: with nobody else holding the row,
// `FOR UPDATE SKIP LOCKED` never actually SKIPS anything.
//
// That matters more than it sounds. A claim written WITHOUT `SKIP LOCKED` passes every assertion in
// that harness: with one session there is never contention, so the difference between "skip the
// locked row and return immediately" and "block until the other transaction commits, then claim it
// too" is invisible. The second behaviour is a double execution — and on the renewal sweep, a double
// execution is a duplicate charge.
//
// So this harness boots a REAL Postgres, opens TWO REAL CONNECTIONS, and proves:
//
//   1. PARTITION: with session A holding the job row inside an open transaction, session B's claim
//      returns LOCKED — immediately, without blocking. Both the outcome and the LATENCY are asserted,
//      because a claim that blocks is a paid serverless timeout even when it eventually answers
//      correctly.
//   2. EXACTLY ONCE: two sessions racing for the same job produce exactly ONE lease and ONE increment
//      of `total_runs`.
//   3. NO SELF-DEADLOCK: the loser's failure is a fast refusal, not a lock wait, so a burst of
//      dispatchers cannot pile up.
//   4. THE NEGATIVE CONTROL: the same race against a claim built WITHOUT `SKIP LOCKED` blocks and
//      then double-claims — proving assertion 1 is testing the migration's choice and not a property
//      Postgres would give us anyway.
//
// Standalone; not part of CI `node --test`. Needs `embedded-postgres` + `pg` from this dir's
// package.json.  Run:  cd backend/tests/realpg && npm install && node scheduler-lease-realpg.mjs
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DATA_DIR = fileURLToPath(new URL('./.pgdata-scheduler', import.meta.url));
const MIGRATION_27 = fileURLToPath(new URL(
  '../../../database/migrations/20260731100000_diaspora_scheduler_leases.sql', import.meta.url));
const PORT = 54399;

const results = [];
const rec = (name, ok, detail) => {
  results.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const epg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false });

function upBlock() {
  const raw = readFileSync(MIGRATION_27, 'utf-8');
  const idx = raw.indexOf('-- +migrate Down');
  return (idx >= 0 ? raw.slice(0, idx) : raw).replace('-- +migrate Up', '');
}

const connect = async () => {
  const client = new pg.Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await client.connect();
  return client;
};

const claimSql = `SELECT public.diaspora_scheduler_claim_atomic($1,$2,$3,$4,$5,$6,$7) AS r`;

async function main() {
  await epg.initialise();
  await epg.start();
  await epg.createDatabase('postgres').catch(() => {});

  const admin = await connect();

  // Supabase-compatible environment. ALTER DEFAULT PRIVILEGES is the hazard ledgers #17/#19/#20 were
  // written to compensate for; modelling it is what makes the ACL assertions meaningful.
  await admin.query(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
    CREATE OR REPLACE FUNCTION public.set_diaspora_trade_os_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END $$;
  `);

  await admin.query(upBlock());
  rec('ledger #27 applies verbatim on real Postgres', true);

  await admin.query(`INSERT INTO public.diaspora_scheduled_jobs (job_key, enabled, interval_seconds) VALUES ('race_job', true, 300)`);

  const a = await connect();
  const b = await connect();

  // ── 1. SKIP LOCKED really skips, and does so IMMEDIATELY ──────────────────
  {
    await a.query('BEGIN');
    await a.query(`SELECT 1 FROM public.diaspora_scheduled_jobs WHERE job_key='race_job' FOR UPDATE`);

    const startedAt = Date.now();
    const { rows } = await b.query(claimSql, ['race_job', 'worker-b', 300, 300, false, true, new Date().toISOString()]);
    const elapsedMs = Date.now() - startedAt;
    const result = rows[0].r;

    rec('a contended claim returns LOCKED rather than claiming the row',
      result.claimed === false && result.reason === 'LOCKED', JSON.stringify(result));
    // A claim that blocks is a paid timeout even when it eventually answers correctly, and a queue of
    // blocked serverless invocations is an outage.
    rec('the contended claim returned IMMEDIATELY (it did not wait on the lock)',
      elapsedMs < 1000, `${elapsedMs}ms`);

    await a.query('ROLLBACK');
  }

  // ── 2. Two racing sessions produce exactly ONE lease ──────────────────────
  {
    await admin.query(`UPDATE public.diaspora_scheduled_jobs
                          SET state='idle', lease_owner=NULL, leased_until=NULL, next_run_at=NULL, total_runs=0
                        WHERE job_key='race_job'`);
    const now = new Date().toISOString();

    // Both statements are issued before either is awaited, so they are genuinely in flight together.
    const pa = a.query(claimSql, ['race_job', 'worker-a', 300, 300, false, true, now]);
    const pb = b.query(claimSql, ['race_job', 'worker-b', 300, 300, false, true, now]);
    const [ra, rb] = await Promise.all([pa, pb]);
    const outcomes = [ra.rows[0].r, rb.rows[0].r];

    const claimed = outcomes.filter((o) => o.claimed);
    rec('exactly one of two racing sessions claims the job', claimed.length === 1, JSON.stringify(outcomes));
    rec('the loser is told which kind of "no" it was',
      outcomes.some((o) => !o.claimed && ['LOCKED', 'LEASED'].includes(o.reason)), JSON.stringify(outcomes));

    const job = (await admin.query(`SELECT total_runs, lease_owner FROM public.diaspora_scheduled_jobs WHERE job_key='race_job'`)).rows[0];
    // The counter is the durable evidence: two increments would mean two executions.
    rec('total_runs advanced exactly once', Number(job.total_runs) === 1, `total_runs=${job.total_runs}`);
    rec('the surviving lease belongs to the winner', job.lease_owner === claimed[0]?.lease_owner,
      `db=${job.lease_owner} winner=${claimed[0]?.lease_owner}`);
  }

  // ── 3. Ten concurrent dispatchers, one execution ──────────────────────────
  {
    await admin.query(`UPDATE public.diaspora_scheduled_jobs
                          SET state='idle', lease_owner=NULL, leased_until=NULL, next_run_at=NULL, total_runs=0
                        WHERE job_key='race_job'`);
    const now = new Date().toISOString();
    const clients = [];
    for (let i = 0; i < 10; i += 1) clients.push(await connect());
    const outcomes = (await Promise.all(clients.map((c, i) =>
      c.query(claimSql, ['race_job', `w${i}`, 300, 300, false, true, now]).then((r) => r.rows[0].r))));
    for (const c of clients) await c.end();

    const claimed = outcomes.filter((o) => o.claimed);
    rec('ten concurrent dispatchers yield exactly one claim', claimed.length === 1,
      `claimed=${claimed.length} reasons=${[...new Set(outcomes.filter((o) => !o.claimed).map((o) => o.reason))].join(',')}`);
    const job = (await admin.query(`SELECT total_runs FROM public.diaspora_scheduled_jobs WHERE job_key='race_job'`)).rows[0];
    rec('and total_runs advanced exactly once under ten-way contention', Number(job.total_runs) === 1,
      `total_runs=${job.total_runs}`);
  }

  // ── 4. NEGATIVE CONTROL: without SKIP LOCKED the same race double-claims ──
  //
  // Without this, assertion 1 proves nothing: it would pass just as happily against a claim that
  // Postgres happened to serialize for unrelated reasons. Here the SAME race is run against a
  // deliberately weakened claim, and it must FAIL in exactly the way the real one does not.
  {
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.unsafe_claim_without_skip_locked(p_job_key text, p_owner text)
      RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
      DECLARE v_job public.diaspora_scheduled_jobs%ROWTYPE;
      BEGIN
        -- The ONLY difference from the real claim: no SKIP LOCKED, so a contending session waits and
        -- then proceeds as though it had been first.
        SELECT * INTO v_job FROM public.diaspora_scheduled_jobs WHERE job_key = p_job_key FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('claimed', false, 'reason', 'LOCKED'); END IF;
        UPDATE public.diaspora_scheduled_jobs SET total_runs = total_runs + 1 WHERE job_key = p_job_key;
        RETURN jsonb_build_object('claimed', true, 'lease_owner', p_owner);
      END $$;
    `);
    await admin.query(`UPDATE public.diaspora_scheduled_jobs SET total_runs=0 WHERE job_key='race_job'`);

    await a.query('BEGIN');
    await a.query(`SELECT public.unsafe_claim_without_skip_locked('race_job','worker-a') AS r`);
    const startedAt = Date.now();
    const pending = b.query(`SELECT public.unsafe_claim_without_skip_locked('race_job','worker-b') AS r`);
    // Give it long enough that "did not answer" is a real observation rather than a scheduling artefact.
    const raced = await Promise.race([
      pending.then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 750)),
    ]);
    rec('CONTROL: a claim WITHOUT SKIP LOCKED blocks on a contended row', raced === 'blocked',
      `observed=${raced} after ${Date.now() - startedAt}ms`);

    await a.query('COMMIT');
    const unsafe = (await pending).rows[0].r;
    const job = (await admin.query(`SELECT total_runs FROM public.diaspora_scheduled_jobs WHERE job_key='race_job'`)).rows[0];
    rec('CONTROL: and then DOUBLE-claims — which is what SKIP LOCKED prevents',
      unsafe.claimed === true && Number(job.total_runs) === 2, `total_runs=${job.total_runs}`);
    await admin.query(`DROP FUNCTION public.unsafe_claim_without_skip_locked(text, text)`);
  }

  // ── 5. The renewal unique index under real concurrency ────────────────────
  {
    const TENANT = '11111111-1111-1111-1111-111111111111';
    const SUB = '33333333-3333-3333-3333-333333333333';
    const insert = `INSERT INTO public.diaspora_subscription_renewals (tenant_id, subscription_id, provider, period_end, state)
                    VALUES ($1,$2,'paynow','2026-08-01T00:00:00Z','needs_operator')`;
    const outcomes = await Promise.allSettled([
      a.query(insert, [TENANT, SUB]),
      b.query(insert, [TENANT, SUB]),
    ]);
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    rec('two concurrent renewal sweeps produce ONE row (23505 on the loser)',
      rejected.length === 1 && rejected[0].reason.code === '23505',
      `codes=${rejected.map((r) => r.reason.code).join(',')}`);
    const count = Number((await admin.query(
      `SELECT count(*) c FROM public.diaspora_subscription_renewals WHERE subscription_id=$1`, [SUB])).rows[0].c);
    rec('exactly one renewal row exists for the period', count === 1, `rows=${count}`);
  }

  await a.end();
  await b.end();
  await admin.end();
  await epg.stop();

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n════ REAL-POSTGRES SCHEDULER LEASE PROOF: ${passed}/${results.length} passed ════`);
  if (passed !== results.length) process.exit(1);
}

main().catch(async (e) => {
  console.error('HARNESS ERROR:', e.message);
  try { await epg.stop(); } catch { /* already down */ }
  process.exit(2);
});
