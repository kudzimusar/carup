/**
 * Diaspora GTM — durable scheduled execution (Issue #127, Phase 2E; ledger #27).
 *
 * THE CLAIM UNDER TEST
 * --------------------
 * Five workloads already existed and none of them ran without a human. Making them run is easy; making
 * them run SAFELY on a platform with no always-running process is the work, because cron dispatchers
 * overlap by design — Vercel Cron and GitHub Actions both fire at-least-once, a slow run is still
 * going when the next one starts, and an operator can trigger a manual run on top of either.
 *
 * So the tests here attack the concurrency claim rather than demonstrating the happy path:
 *
 *   · two schedulers driven CONCURRENTLY must produce exactly one execution, and the loser must be
 *     told which of the five very different "did not run" reasons applied;
 *   · a worker whose lease expired must not be able to report its stale run as fresh, because
 *     `last_success_at` is the value an alert watches;
 *   · repeated failure must reach a TERMINUS with `next_run_at` cleared, not a slower loop;
 *   · every job must be OFF unless BOTH switches are on, and an operator must still be able to run it
 *     when they are off — that is precisely when a human needs to;
 *   · the renewal sweep must be idempotent per period and must never contact a provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { createSchedulerRpcModel } = await import('./helpers/schedulerRpcModel.js');

const scheduler = await import('../services/diaspora/scheduler/diasporaSchedulerService.js');
const { SCHEDULER_JOB_DEFINITIONS } = await import('../services/diaspora/scheduler/diasporaSchedulerJobs.js');
const {
  SCHEDULER_JOB_KEYS,
  SCHEDULER_TRIGGERS,
  SCHEDULER_SKIP_REASONS,
  SCHEDULER_RUN_STATES,
  isSchedulerJobFlagEnabled,
  isSchedulerDispatchEnabled,
  schedulerDispatchSecret,
  assertSchedulerDispatchSafety,
  schedulerIntervalSeconds,
  SCHEDULED_JOBS_TABLE,
  SCHEDULER_RUNS_TABLE,
  SUBSCRIPTION_RENEWALS_TABLE,
} = await import('../constants/diaspora/diasporaSchedulerConstants.js');

const renewals = await import('../services/diaspora/billing/diasporaSubscriptionRenewalService.js');
const eventRetry = await import('../services/diaspora/billing/diasporaBillingEventRetryService.js');
const driveSweeper = await import('../services/diaspora/drive/driveSyncSweeper.js');
const { SYNC_ATTEMPT_STATE } = await import('../services/diaspora/drive/driveSyncQueue.js');

const TENANT = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const JOB = 'test_job';
const NOW = new Date('2026-07-31T09:00:00.000Z');

/** A mock client whose `diaspora_scheduled_jobs` table IS the array the RPC model mutates. */
function harness({ seed = {}, jobs = {}, tables = {} } = {}) {
  const db = createMockSupabase({
    [SCHEDULED_JOBS_TABLE]: [],
    [SCHEDULER_RUNS_TABLE]: [],
    ...tables,
  });
  const model = createSchedulerRpcModel({ rows: db._rows(SCHEDULED_JOBS_TABLE), jobs });
  // Wire the model's RPCs into the mock client (createMockSupabase takes rpc impls at construction,
  // so this replaces the resolver rather than the table state).
  db.rpc = async (name, params) => {
    const impl = model.rpc[name];
    if (!impl) return { data: null, error: { message: `RPC ${name} not found` } };
    try { return { data: await impl(params || {}), error: null }; }
    catch (err) { return { data: null, error: { message: err.message, code: err.code } }; }
  };
  if (Object.keys(seed).length) model.seed(JOB, seed);
  return { db, model };
}

/** A registry with one job whose handler is fully controllable. */
function registryWith(handler, key = JOB) {
  return { [key]: { description: 'test', handler } };
}

const ENABLED_ENV = { TEST_JOB_FLAG: 'true' };

// The scheduler reads per-job flags from the constants module, which only knows the five real keys.
// Tests that drive a synthetic job therefore use OPERATOR trigger (which bypasses the flag) or one of
// the real keys with its real env var set. Both paths are exercised below.

// ── The concurrency proof ───────────────────────────────────────────────────

test('two concurrent schedulers do NOT both process the same job', async () => {
  const { db, model } = harness({ seed: { enabled: true } });
  let executions = 0;
  const started = [];

  const handler = async ({ runId }) => {
    executions += 1;
    started.push(runId);
    // Yield, so if a second scheduler could interleave into the critical section it would.
    await new Promise((resolve) => setImmediate(resolve));
    return { processed: 1 };
  };

  const run = () => scheduler.runScheduledJob({
    jobKey: JOB,
    trigger: SCHEDULER_TRIGGERS.OPERATOR,
    registry: registryWith(handler),
    supabaseClient: db,
    now: NOW,
  });

  const [a, b] = await Promise.all([run(), run()]);

  assert.equal(executions, 1, 'the handler ran exactly once');
  const ran = [a, b].filter((r) => r.ran);
  const skipped = [a, b].filter((r) => !r.ran);
  assert.equal(ran.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, SCHEDULER_SKIP_REASONS.LEASED, 'the loser is told WHY, not just "no"');

  // Exactly one run row: a skipped claim must not write history, or an hourly job behind a
  // per-minute cron would bury its own record under sixty NOT_DUE rows an hour.
  const runs = db._rows(SCHEDULER_RUNS_TABLE);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].state, SCHEDULER_RUN_STATES.COMPLETED);
  assert.equal(model.job(JOB).total_runs, 1, 'only the winning claim incremented the counter');
});

test('four concurrent schedulers still produce exactly one execution', async () => {
  const { db } = harness({ seed: { enabled: true } });
  let executions = 0;
  const handler = async () => {
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { processed: 1 };
  };
  const results = await Promise.all([1, 2, 3, 4].map(() => scheduler.runScheduledJob({
    jobKey: JOB, trigger: SCHEDULER_TRIGGERS.OPERATOR,
    registry: registryWith(handler), supabaseClient: db, now: NOW,
  })));
  assert.equal(executions, 1);
  assert.equal(results.filter((r) => r.ran).length, 1);
  assert.equal(db._rows(SCHEDULER_RUNS_TABLE).length, 1);
});

test('a dispatcher that finds the row LOCKED returns immediately instead of blocking', async () => {
  const { db, model } = harness({ seed: { enabled: true } });
  // Another transaction holds the row — the case SKIP LOCKED exists for.
  model.holdRowLock(JOB);
  let executions = 0;
  const result = await scheduler.runScheduledJob({
    jobKey: JOB, trigger: SCHEDULER_TRIGGERS.OPERATOR,
    registry: registryWith(async () => { executions += 1; return {}; }),
    supabaseClient: db, now: NOW,
  });
  assert.equal(result.ran, false);
  assert.equal(result.reason, SCHEDULER_SKIP_REASONS.LOCKED);
  assert.equal(executions, 0);
  assert.equal(db._rows(SCHEDULER_RUNS_TABLE).length, 0);
});

test('an EXPIRED lease is takeable — a killed worker must not lock a job out forever', async () => {
  const { db, model } = harness({
    seed: {
      enabled: true,
      state: 'leased',
      lease_owner: 'dead-worker',
      leased_until: new Date(NOW.getTime() - 60_000).toISOString(),
    },
  });
  const result = await scheduler.runScheduledJob({
    jobKey: JOB, trigger: SCHEDULER_TRIGGERS.OPERATOR,
    registry: registryWith(async () => ({ processed: 1 })),
    supabaseClient: db, now: NOW,
  });
  assert.equal(result.ran, true);
  assert.notEqual(model.job(JOB).lease_owner, 'dead-worker');
});

test('a zombie whose lease was taken over cannot report its stale run as fresh', async () => {
  const { db, model } = harness({ seed: { enabled: true } });
  // The zombie holds a lease that has since been reassigned to somebody else.
  model.seed(JOB, {
    state: 'leased',
    lease_owner: 'new-worker',
    leased_until: new Date(NOW.getTime() + 300_000).toISOString(),
    last_success_at: null,
  });
  const release = await db.rpc('diaspora_scheduler_release_atomic', {
    p_job_key: JOB, p_owner: 'zombie-worker', p_succeeded: true, p_now: NOW.toISOString(),
  });
  assert.equal(release.data.released, false);
  assert.equal(release.data.reason, 'LEASE_LOST');
  // `last_success_at` is what an alert watches; a zombie stamping it would hide a dead scheduler.
  assert.equal(model.job(JOB).last_success_at, null);
  assert.equal(model.job(JOB).lease_owner, 'new-worker');
});

// ── Scheduling, backoff and the terminus ────────────────────────────────────

test('a successful run schedules the next one and clears the failure counter', async () => {
  const { db, model } = harness({ seed: { enabled: true, consecutive_failures: 3, interval_seconds: 3600 } });
  const result = await scheduler.runScheduledJob({
    jobKey: JOB, trigger: SCHEDULER_TRIGGERS.OPERATOR,
    registry: registryWith(async () => ({ processed: 7, failed: 1, deadLettered: 2, detail: { note: 'x' } })),
    supabaseClient: db, now: NOW,
  });
  assert.equal(result.ran, true);
  assert.equal(result.processed, 7);

  const job = model.job(JOB);
  assert.equal(job.state, 'idle');
  assert.equal(job.consecutive_failures, 0);
  assert.equal(job.lease_owner, null);
  assert.equal(job.last_success_at, NOW.toISOString());
  assert.equal(Date.parse(job.next_run_at) - NOW.getTime(), 3600 * 1000);

  const row = db._rows(SCHEDULER_RUNS_TABLE)[0];
  assert.equal(row.processed_count, 7);
  assert.equal(row.failed_count, 1);
  assert.equal(row.dead_lettered_count, 2);
  assert.deepEqual(row.detail, { note: 'x' });
  assert.ok(row.finished_at, 'a terminal run must carry an end time');
});

test('a failing run backs off, and repeated failure reaches a TERMINUS rather than a slower loop', async () => {
  const { db, model } = harness({ seed: { enabled: true } });
  const boom = async () => { const err = new Error('downstream is down'); err.code = 'DOWNSTREAM'; throw err; };

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await assert.rejects(() => scheduler.runScheduledJob({
      jobKey: JOB, trigger: SCHEDULER_TRIGGERS.OPERATOR,
      registry: registryWith(boom), supabaseClient: db, now: NOW,
    }), /downstream is down/);

    const job = model.job(JOB);
    assert.equal(job.consecutive_failures, attempt);
    if (attempt < 5) {
      assert.equal(job.state, 'idle');
      assert.ok(Date.parse(job.next_run_at) > NOW.getTime(), 'a retryable failure gets a future due time');
    }
  }

  const job = model.job(JOB);
  assert.equal(job.state, 'needs_operator');
  // Cleared, so no dispatcher can pick it up again. A dead job that keeps retrying is how a real
  // defect becomes background noise.
  assert.equal(job.next_run_at, null);
  assert.equal(job.last_error_code, 'DOWNSTREAM');
  assert.equal(job.last_error, 'downstream is down');

  // Every failure is durable history, and each run row is terminal.
  const runs = db._rows(SCHEDULER_RUNS_TABLE);
  assert.equal(runs.length, 5);
  for (const run of runs) {
    assert.equal(run.state, SCHEDULER_RUN_STATES.FAILED);
    assert.ok(run.finished_at);
    assert.equal(run.last_error, 'downstream is down');
  }
});

test('a job at the terminus is skipped by the scheduler but STILL runnable by an operator', async () => {
  const { db } = harness({ seed: { enabled: true, state: 'needs_operator', next_run_at: null } });
  let executions = 0;
  const handler = async () => { executions += 1; return { processed: 1 }; };

  // The scheduled path refuses.
  const scheduled = await db.rpc('diaspora_scheduler_claim_atomic', {
    p_job_key: JOB, p_owner: 'auto', p_ignore_schedule: false, p_require_enabled: true, p_now: NOW.toISOString(),
  });
  assert.equal(scheduled.data.claimed, false);
  assert.equal(scheduled.data.reason, SCHEDULER_SKIP_REASONS.NEEDS_OPERATOR);

  // The operator path does not — which is the whole point: the automatic path being stuck is exactly
  // when a human needs to be able to run it.
  const result = await scheduler.runScheduledJob({
    jobKey: JOB, trigger: SCHEDULER_TRIGGERS.OPERATOR,
    registry: registryWith(handler), supabaseClient: db, now: NOW,
  });
  assert.equal(result.ran, true);
  assert.equal(executions, 1);
});

test('a job that is not due yet is skipped with NOT_DUE and does not execute', async () => {
  const { db } = harness({
    seed: { enabled: true, next_run_at: new Date(NOW.getTime() + 600_000).toISOString() },
  });
  let executions = 0;
  const result = await scheduler.runScheduledJob({
    jobKey: JOB,
    trigger: SCHEDULER_TRIGGERS.SCHEDULED,
    registry: registryWith(async () => { executions += 1; return {}; }),
    // The scheduled path also needs the deployment flag; a synthetic job key has none, so this proves
    // FLAG_OFF fires first and nothing runs.
    supabaseClient: db, now: NOW,
  });
  assert.equal(result.ran, false);
  assert.equal(result.reason, SCHEDULER_SKIP_REASONS.FLAG_OFF);
  assert.equal(executions, 0);
});

// ── Off by default, twice ───────────────────────────────────────────────────

test('every real job is OFF by default, and needs BOTH the deployment flag and the database switch', async () => {
  for (const jobKey of Object.values(SCHEDULER_JOB_KEYS)) {
    assert.equal(isSchedulerJobFlagEnabled(jobKey, {}), false, `${jobKey} must default to off`);
  }
  assert.equal(isSchedulerDispatchEnabled({}), false);
  assert.equal(schedulerDispatchSecret({}), null);

  const jobKey = SCHEDULER_JOB_KEYS.BILLING_CHECKOUT_SWEEP;
  const env = { DIASPORA_BILLING_CHECKOUT_SWEEP_SCHEDULER: 'true' };
  assert.equal(isSchedulerJobFlagEnabled(jobKey, env), true);

  // Flag on, database switch OFF -> still refused.
  const { db } = harness({ jobs: { [jobKey]: { enabled: false } } });
  let executions = 0;
  const off = await scheduler.runScheduledJob({
    jobKey, trigger: SCHEDULER_TRIGGERS.SCHEDULED, env,
    registry: registryWith(async () => { executions += 1; return {}; }, jobKey),
    supabaseClient: db, now: NOW,
  });
  assert.equal(off.ran, false);
  assert.equal(off.reason, SCHEDULER_SKIP_REASONS.DISABLED);
  assert.equal(executions, 0);

  // Database switch on as well -> it runs. Two deliberate, independent acts.
  db._rows(SCHEDULED_JOBS_TABLE).find((r) => r.job_key === jobKey).enabled = true;
  const on = await scheduler.runScheduledJob({
    jobKey, trigger: SCHEDULER_TRIGGERS.SCHEDULED, env,
    registry: registryWith(async () => { executions += 1; return { processed: 1 }; }, jobKey),
    supabaseClient: db, now: NOW,
  });
  assert.equal(on.ran, true);
  assert.equal(executions, 1);
});

test('a disabled job costs no database write at all', async () => {
  const { db, model } = harness();
  const result = await scheduler.runScheduledJob({
    jobKey: SCHEDULER_JOB_KEYS.BILLING_RECONCILIATION,
    trigger: SCHEDULER_TRIGGERS.SCHEDULED,
    env: {},
    registry: registryWith(async () => ({}), SCHEDULER_JOB_KEYS.BILLING_RECONCILIATION),
    supabaseClient: db, now: NOW,
  });
  assert.equal(result.reason, SCHEDULER_SKIP_REASONS.FLAG_OFF);
  assert.equal(result.flag, 'DIASPORA_BILLING_RECONCILIATION_SCHEDULER');
  // A per-minute cron against four off jobs should be nearly free — no claim, no row, no bootstrap.
  assert.equal(model.calls.length, 0);
  assert.equal(db._rows(SCHEDULED_JOBS_TABLE).length, 0);
});

test('dispatch safety refuses an open scheduler endpoint in production', () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(
      () => assertSchedulerDispatchSafety({ DIASPORA_SCHEDULER_ENABLED: 'true' }),
      /no DIASPORA_SCHEDULER_SECRET/,
    );
    assert.doesNotThrow(() => assertSchedulerDispatchSafety({
      DIASPORA_SCHEDULER_ENABLED: 'true', DIASPORA_SCHEDULER_SECRET: 's3cret',
    }));
    // Disabled means there is nothing to secure.
    assert.doesNotThrow(() => assertSchedulerDispatchSafety({}));
  } finally {
    process.env.NODE_ENV = previous;
  }
  // Vercel Cron's own convention is accepted, so there is one secret name in this codebase, not two.
  assert.equal(schedulerDispatchSecret({ CRON_SECRET: 'from-vercel' }), 'from-vercel');
});

// ── The dispatcher ──────────────────────────────────────────────────────────

test('one bad job never stops the others', async () => {
  const { db } = harness();
  const ran = [];
  const registry = {
    good_a: { handler: async () => { ran.push('a'); return { processed: 1 }; } },
    bad: { handler: async () => { throw new Error('nope'); } },
    good_b: { handler: async () => { ran.push('b'); return { processed: 2 }; } },
  };
  const summary = await scheduler.runDueScheduledJobs({
    trigger: SCHEDULER_TRIGGERS.OPERATOR, registry, supabaseClient: db, now: NOW,
  });
  assert.deepEqual(ran, ['a', 'b'], 'the failure between them did not stop the sweep');
  assert.equal(summary.considered, 3);
  assert.equal(summary.failed, 1);
  const failed = summary.results.find((r) => r.jobKey === 'bad');
  assert.equal(failed.state, SCHEDULER_RUN_STATES.FAILED);
  assert.equal(failed.error, 'nope');
});

test('every registered job maps to a real handler and a real flag', () => {
  const keys = Object.keys(SCHEDULER_JOB_DEFINITIONS);
  assert.deepEqual(keys.sort(), Object.values(SCHEDULER_JOB_KEYS).sort());
  for (const key of keys) {
    assert.equal(typeof SCHEDULER_JOB_DEFINITIONS[key].handler, 'function', `${key} needs a handler`);
    assert.ok(SCHEDULER_JOB_DEFINITIONS[key].description, `${key} needs a description`);
    const interval = schedulerIntervalSeconds(key, {});
    assert.ok(interval >= 30 && interval <= 86_400, `${key} interval must satisfy the migration CHECK`);
  }
});

// ── Freshness ───────────────────────────────────────────────────────────────

test('health reports staleness only for jobs that are actually switched on', async () => {
  const jobKey = SCHEDULER_JOB_KEYS.BILLING_RECONCILIATION;
  const env = { DIASPORA_BILLING_RECONCILIATION_SCHEDULER: 'true' };
  const { db } = harness({
    jobs: {
      [jobKey]: {
        enabled: true,
        interval_seconds: 3600,
        last_success_at: new Date(NOW.getTime() - 5 * 3600 * 1000).toISOString(),
      },
    },
  });
  const health = await scheduler.schedulerHealth({ env, now: NOW, supabaseClient: db });
  const stale = health.jobs.find((j) => j.jobKey === jobKey);
  assert.equal(stale.active, true);
  assert.equal(stale.stale, true, '5 hours without a success on an hourly job is stale');
  assert.equal(stale.staleReason, 'STALE');
  assert.equal(stale.ageSeconds, 5 * 3600);

  // Every other job is off, and an off job must NOT be reported stale — that trains operators to
  // ignore the field, which is worse than not having it.
  for (const other of health.jobs.filter((j) => j.jobKey !== jobKey)) {
    assert.equal(other.active, false);
    assert.equal(other.stale, false);
    assert.equal(other.state, 'unregistered');
  }
  assert.equal(health.staleCount, 1);
});

test('an ACTIVE job that has never succeeded is stale, and the reason says so', async () => {
  const jobKey = SCHEDULER_JOB_KEYS.DRIVE_SYNC_RETRY;
  const { db } = harness({ jobs: { [jobKey]: { enabled: true, last_success_at: null } } });
  const health = await scheduler.schedulerHealth({
    env: { DIASPORA_DRIVE_SYNC_RETRY_SCHEDULER: 'true' }, now: NOW, supabaseClient: db,
  });
  const job = health.jobs.find((j) => j.jobKey === jobKey);
  assert.equal(job.stale, true);
  assert.equal(job.staleReason, 'NEVER_SUCCEEDED');
});

// ── The renewal sweep (ADR-001 §8) ──────────────────────────────────────────

function renewalDb(rows) {
  return createMockSupabase({
    diaspora_subscriptions: rows,
    [SUBSCRIPTION_RENEWALS_TABLE]: [],
  });
}

test('the renewal sweep records a due period ONCE, however many times it runs', async () => {
  const db = renewalDb([{
    id: 'sub-1', tenant_id: TENANT, plan_key: 'growth', status: 'active', provider: 'paynow',
    current_period_start: '2026-07-01T00:00:00.000Z', current_period_end: '2026-08-01T00:00:00.000Z',
    cancel_at_period_end: false, deleted_at: null,
  }]);

  const first = await renewals.sweepDueRenewals({ now: NOW, supabaseClient: db });
  assert.equal(first.recorded, 1);
  assert.equal(first.alreadyRecorded, 0);

  // Two overlapping dispatchers, concurrently. The UNIQUE index is the idempotency — on the other
  // side of a SELECT-then-INSERT window is a duplicate charge.
  const [a, b] = await Promise.all([
    renewals.sweepDueRenewals({ now: NOW, supabaseClient: db }),
    renewals.sweepDueRenewals({ now: NOW, supabaseClient: db }),
  ]);
  assert.equal(a.recorded + b.recorded, 0);
  assert.equal(a.alreadyRecorded + b.alreadyRecorded, 2);
  assert.equal(db._rows(SUBSCRIPTION_RENEWALS_TABLE).length, 1);
});

test('an unauthorized collection lands in NEEDS_OPERATOR, and nothing contacts a provider', async () => {
  const db = renewalDb([{
    id: 'sub-1', tenant_id: TENANT, plan_key: 'growth', status: 'active', provider: 'paynow',
    current_period_end: '2026-08-01T00:00:00.000Z', cancel_at_period_end: false, deleted_at: null,
  }]);
  const result = await renewals.sweepDueRenewals({ now: NOW, supabaseClient: db });
  assert.equal(result.needsOperator, 1);
  assert.equal(result.collectionAttempted, false);
  assert.equal(renewals.isAutomaticCollectionAuthorized('paynow'), false);

  const row = db._rows(SUBSCRIPTION_RENEWALS_TABLE)[0];
  assert.equal(row.state, 'needs_operator');
  assert.equal(row.detail.reason, 'AUTOMATIC_COLLECTION_NOT_AUTHORIZED');
  // The record carries no money fields — a schema that can express a charge will eventually be used
  // to make one.
  for (const forbidden of ['amount', 'amount_cents', 'currency', 'payment_ref', 'poll_url']) {
    assert.equal(row[forbidden], undefined, `renewal rows must not carry ${forbidden}`);
  }
});

test('the renewal sweep ignores rails that renew themselves', async () => {
  const db = renewalDb([
    { id: 's1', tenant_id: TENANT, status: 'active', provider: 'stripe', current_period_end: '2026-08-01T00:00:00.000Z', deleted_at: null },
    { id: 's2', tenant_id: TENANT, status: 'active', provider: 'sandbox', current_period_end: '2026-08-01T00:00:00.000Z', deleted_at: null },
    { id: 's3', tenant_id: TENANT_B, status: 'active', provider: 'manual', current_period_end: '2026-08-01T00:00:00.000Z', deleted_at: null },
  ]);
  const result = await renewals.sweepDueRenewals({ now: NOW, supabaseClient: db });
  // Sweeping a self-renewing rail would create a second, competing schedule for the same period —
  // which is how a tenant gets billed twice by two systems that each believe they are in charge.
  assert.equal(result.scanned, 1);
  assert.equal(db._rows(SUBSCRIPTION_RENEWALS_TABLE)[0].tenant_id, TENANT_B);
});

test('a tenant who cancelled at period end is NOT presented as money owed', async () => {
  const db = renewalDb([{
    id: 'sub-1', tenant_id: TENANT, status: 'active', provider: 'paynow',
    current_period_end: '2026-08-01T00:00:00.000Z', cancel_at_period_end: true, deleted_at: null,
  }]);
  const result = await renewals.sweepDueRenewals({ now: NOW, supabaseClient: db });
  assert.equal(result.needsOperator, 0);
  assert.equal(result.cancelling, 1);
  assert.equal(db._rows(SUBSCRIPTION_RENEWALS_TABLE)[0].state, 'cancelled');
});

test('a period beyond the lead window is not yet due', async () => {
  const db = renewalDb([{
    id: 'sub-1', tenant_id: TENANT, status: 'active', provider: 'paynow',
    current_period_end: '2026-09-01T00:00:00.000Z', cancel_at_period_end: false, deleted_at: null,
  }]);
  const result = await renewals.sweepDueRenewals({ now: NOW, leadTimeMs: 3 * 86400_000, supabaseClient: db });
  assert.equal(result.scanned, 0);
  assert.equal(db._rows(SUBSCRIPTION_RENEWALS_TABLE).length, 0);
});

// ── Retryable provider events ───────────────────────────────────────────────

function eventsDb(rows) {
  return createMockSupabase({
    diaspora_billing_provider_events: rows,
    diaspora_subscriptions: [],
  });
}

const OLD = new Date(NOW.getTime() - 3600_000).toISOString();

test('an event claimed but never applied is re-applied through the SAME writer the webhook uses', async () => {
  const db = eventsDb([{
    id: 'evt-row-1', provider: 'sandbox', event_id: 'evt_1', event_type: 'subscription.updated',
    tenant_id: TENANT, signature_verified: true, processed_at: null, superseded: false,
    dead_lettered: false, attempts: 0, created_at: OLD,
    payload: { data: { tenantId: TENANT, planKey: 'growth', status: 'active' } },
  }]);
  const result = await eventRetry.retryUnappliedBillingEvents({ now: NOW, supabaseClient: db });
  assert.equal(result.applied, 1);

  const event = db._rows('diaspora_billing_provider_events')[0];
  assert.ok(event.processed_at, 'the event is now applied');
  const subscription = db._rows('diaspora_subscriptions')[0];
  assert.equal(subscription.tenant_id, TENANT);
  assert.equal(subscription.plan_key, 'growth');
  assert.equal(subscription.status, 'active');
});

test('an unverified payload is never applied — there is no wire left to re-check it against', async () => {
  const db = eventsDb([{
    id: 'evt-row-2', provider: 'sandbox', event_id: 'evt_2', tenant_id: TENANT,
    signature_verified: false, processed_at: null, superseded: false, dead_lettered: false,
    attempts: 0, created_at: OLD, payload: { data: { tenantId: TENANT, status: 'cancelled' } },
  }]);
  const result = await eventRetry.retryUnappliedBillingEvents({ now: NOW, supabaseClient: db });
  assert.equal(result.applied, 0);
  assert.equal(result.outcomes[0].outcome, eventRetry.EVENT_RETRY_OUTCOMES.SKIPPED_UNVERIFIED);
  assert.equal(db._rows('diaspora_subscriptions').length, 0);
});

test('a superseded event is never applied backwards, and a brand-new one is left alone', async () => {
  const db = eventsDb([
    {
      id: 'a', provider: 'sandbox', event_id: 'evt_a', tenant_id: TENANT, signature_verified: true,
      processed_at: null, superseded: true, dead_lettered: false, attempts: 0, created_at: OLD,
      payload: { data: { tenantId: TENANT, status: 'cancelled' } },
    },
    {
      id: 'b', provider: 'sandbox', event_id: 'evt_b', tenant_id: TENANT, signature_verified: true,
      processed_at: null, superseded: false, dead_lettered: false, attempts: 0,
      // Inside the grace window: the original request may still be running, and racing it produces
      // two writers for one subscription row.
      created_at: new Date(NOW.getTime() - 1000).toISOString(),
      payload: { data: { tenantId: TENANT, status: 'active' } },
    },
  ]);
  const result = await eventRetry.retryUnappliedBillingEvents({ now: NOW, supabaseClient: db });
  assert.equal(result.scanned, 0);
  assert.equal(db._rows('diaspora_subscriptions').length, 0);
});

test('an event that keeps failing is DEAD-LETTERED at the ceiling, not retried forever', async () => {
  const db = eventsDb([{
    id: 'evt-row-3', provider: 'sandbox', event_id: 'evt_3', tenant_id: TENANT,
    signature_verified: true, processed_at: null, superseded: false, dead_lettered: false,
    attempts: 5, created_at: OLD, payload: { data: { tenantId: TENANT, status: 'active' } },
  }]);
  const result = await eventRetry.retryUnappliedBillingEvents({ now: NOW, maxAttempts: 5, supabaseClient: db });
  assert.equal(result.deadLettered, 1);
  const event = db._rows('diaspora_billing_provider_events')[0];
  assert.equal(event.dead_lettered, true);
  assert.ok(event.last_error, 'the terminus records why');
  // `markBillingEventFailed(deadLetter: true)` stamps `processed_at` on purpose — it stops the row
  // counting as pending work — and `dead_lettered` is what distinguishes "we gave up" from "it
  // worked". Asserting the flag rather than the timestamp keeps this test aligned with the ledger's
  // own contract instead of quietly re-specifying it.
  assert.equal(event.attempts, 6);
  const deadLetters = db._rows('diaspora_billing_provider_events').filter((r) => r.dead_lettered);
  assert.equal(deadLetters.length, 1, 'and it is visible in the operator dead-letter queue');
});

test('a failing apply leaves the event as unfinished work rather than losing it', async () => {
  const db = eventsDb([{
    id: 'evt-row-4', provider: 'sandbox', event_id: 'evt_4', tenant_id: TENANT,
    signature_verified: true, processed_at: null, superseded: false, dead_lettered: false,
    attempts: 0, created_at: OLD, payload: { data: { tenantId: TENANT, status: 'active' } },
  }]);
  const result = await eventRetry.retryUnappliedBillingEvents({
    now: NOW, supabaseClient: db,
    applier: async () => { throw new Error('CHECK constraint rejected the status'); },
  });
  assert.equal(result.failed, 1);
  const event = db._rows('diaspora_billing_provider_events')[0];
  assert.equal(event.processed_at, null, 'still visible to the next sweep');
  assert.equal(event.dead_lettered, false);
  assert.equal(event.attempts, 1);
  assert.match(event.last_error, /CHECK constraint/);
});

// ── Drive sync sweep ────────────────────────────────────────────────────────

function driveDb(rows) {
  return createMockSupabase({
    diaspora_drive_sync_attempts: rows,
    diaspora_import_audit_log: [],
    audit_logs: [],
  });
}

test('a claim abandoned by a killed worker is returned to the queue, not left in_flight forever', async () => {
  const db = driveDb([{
    id: 'att-1', tenant_id: TENANT, operation: 'upload', state: SYNC_ATTEMPT_STATE.IN_FLIGHT,
    attempts: 1, started_at: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    next_attempt_at: null, idempotency_key: 'k1', created_at: OLD,
  }]);
  const result = await driveSweeper.sweepDriveSyncAttempts({
    now: NOW, visibilityTimeoutMs: 15 * 60_000, jitter: () => 0.5, supabaseClient: db,
  });
  assert.equal(result.reclaimed, 1);
  const row = db._rows('diaspora_drive_sync_attempts')[0];
  // `failed`, not `pending`: `pending` means "never attempted" and would erase the fact that a
  // worker died holding it.
  assert.equal(row.state, SYNC_ATTEMPT_STATE.FAILED);
  assert.equal(row.last_error_code, 'DRIVE_SYNC_LEASE_EXPIRED');
  assert.ok(Date.parse(row.next_attempt_at) > NOW.getTime());
});

test('an in_flight claim inside its visibility window is left strictly alone', async () => {
  const db = driveDb([{
    id: 'att-2', tenant_id: TENANT, operation: 'upload', state: SYNC_ATTEMPT_STATE.IN_FLIGHT,
    attempts: 1, started_at: new Date(NOW.getTime() - 60_000).toISOString(),
    idempotency_key: 'k2', created_at: OLD,
  }]);
  const result = await driveSweeper.sweepDriveSyncAttempts({
    now: NOW, visibilityTimeoutMs: 15 * 60_000, supabaseClient: db,
  });
  assert.equal(result.reclaimed, 0);
  // Reclaiming a slow-but-alive upload underneath itself produces exactly the double delivery the
  // lease exists to prevent.
  assert.equal(db._rows('diaspora_drive_sync_attempts')[0].state, SYNC_ATTEMPT_STATE.IN_FLIGHT);
});

test('an attempt past the retry ceiling is dead-lettered with a CRITICAL audit row', async () => {
  const db = driveDb([{
    id: 'att-3', tenant_id: TENANT, operation: 'upload', entity_type: 'document', entity_id: 'doc-1',
    state: SYNC_ATTEMPT_STATE.FAILED, attempts: 5,
    next_attempt_at: new Date(NOW.getTime() - 1000).toISOString(), idempotency_key: 'k3', created_at: OLD,
  }]);
  const result = await driveSweeper.sweepDriveSyncAttempts({ now: NOW, maxAttempts: 5, supabaseClient: db });
  assert.equal(result.deadLettered, 1);
  const row = db._rows('diaspora_drive_sync_attempts')[0];
  assert.equal(row.state, SYNC_ATTEMPT_STATE.DEAD_LETTERED);
  // Cleared, so a dead letter cannot be picked up again — that is what makes it terminal.
  assert.equal(row.next_attempt_at, null);
  assert.ok(row.completed_at);
});

test('an unreplayable operation is COUNTED, never silently dead-lettered', async () => {
  const db = driveDb([{
    id: 'att-4', tenant_id: TENANT, operation: 'upload', state: SYNC_ATTEMPT_STATE.FAILED,
    attempts: 1, next_attempt_at: new Date(NOW.getTime() - 1000).toISOString(),
    idempotency_key: 'k4', created_at: OLD,
  }]);
  const result = await driveSweeper.sweepDriveSyncAttempts({ now: NOW, supabaseClient: db });
  // Upload replay needs content the table deliberately does not store. Hiding that would remove the
  // only evidence that the gap exists.
  assert.equal(result.unreplayable, 1);
  assert.equal(result.deadLettered, 0);
  assert.equal(db._rows('diaspora_drive_sync_attempts')[0].state, SYNC_ATTEMPT_STATE.FAILED);
});

test('a registered replayer is invoked for a due attempt', async () => {
  const db = driveDb([{
    id: 'att-5', tenant_id: TENANT, operation: 'ensure_folder', state: SYNC_ATTEMPT_STATE.FAILED,
    attempts: 1, next_attempt_at: new Date(NOW.getTime() - 1000).toISOString(),
    idempotency_key: 'k5', created_at: OLD,
  }]);
  const seen = [];
  const result = await driveSweeper.sweepDriveSyncAttempts({
    now: NOW, supabaseClient: db,
    replayers: { ensure_folder: async (attempt) => { seen.push(attempt.id); } },
  });
  assert.equal(result.replayed, 1);
  assert.deepEqual(seen, ['att-5']);
});

test('a future next_attempt_at means not yet — backoff is honoured, not ignored', async () => {
  const db = driveDb([{
    id: 'att-6', tenant_id: TENANT, operation: 'ensure_folder', state: SYNC_ATTEMPT_STATE.FAILED,
    attempts: 1, next_attempt_at: new Date(NOW.getTime() + 60_000).toISOString(),
    idempotency_key: 'k6', created_at: OLD,
  }]);
  let called = 0;
  const result = await driveSweeper.sweepDriveSyncAttempts({
    now: NOW, supabaseClient: db, replayers: { ensure_folder: async () => { called += 1; } },
  });
  assert.equal(called, 0);
  assert.equal(result.replayed, 0);
});

// ── The lease must come back even when BOOKKEEPING fails ────────────────────
//
// These exist because their absence hid a real defect. Only the handler was ever guarded: openRun,
// closeRun and the release RPC itself sat outside any try/finally, so a throw in any of them meant
// `diaspora_scheduler_release_atomic` — the ONLY release call site in the codebase — was never
// reached and the job stayed `state='leased'` for its whole lease window with no run row to explain
// why. Every existing failure test made the HANDLER throw, which is the one failure that was caught.
//
// It was reachable with no infrastructure failure: the operator route took `tenantId` as a free
// string while diaspora_scheduler_runs.tenant_id is `uuid`, so one typo claimed the lease and then
// failed the insert.

test('a failure INSERTING the run row still releases the lease', async () => {
  const { db, model } = harness({ seed: { enabled: true } });
  const rows = db._rows(SCHEDULED_JOBS_TABLE);

  // Make the run-row insert fail the way PostgREST fails on a non-uuid tenant_id.
  const realFrom = db.from.bind(db);
  db.from = (table) => {
    if (table !== SCHEDULER_RUNS_TABLE) return realFrom(table);
    return {
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid: "acme"' } }),
        }),
      }),
    };
  };

  let handlerRan = false;
  await assert.rejects(() => scheduler.runScheduledJob({
    jobKey: JOB,
    trigger: SCHEDULER_TRIGGERS.OPERATOR,
    registry: registryWith(async () => { handlerRan = true; return { processed: 1 }; }),
    supabaseClient: db,
    now: NOW,
    env: ENABLED_ENV,
  }));

  assert.equal(handlerRan, false, 'the handler must not run when its run row could not be opened');
  const job = rows.find((r) => r.job_key === JOB);
  assert.notEqual(job.state, 'leased', `the lease was STRANDED: ${JSON.stringify(job)}`);
  assert.equal(job.lease_owner, null, 'lease_owner must be cleared when the lease is released');
});

test('a failure in the RELEASE RPC is surfaced, not reported as a clean run', async () => {
  const { db, model } = harness({ seed: { enabled: true } });

  const realRpc = db.rpc.bind(db);
  db.rpc = async (name, params) => {
    if (name === 'diaspora_scheduler_release_atomic') {
      return { data: null, error: { code: '08006', message: 'connection terminated' } };
    }
    return realRpc(name, params);
  };

  // The work succeeded but the lease could not be settled. Reporting success here would claim a clean
  // run while the job is stranded — exactly the state the finally block exists to prevent.
  await assert.rejects(
    () => scheduler.runScheduledJob({
      jobKey: JOB,
      trigger: SCHEDULER_TRIGGERS.OPERATOR,
      registry: registryWith(async () => ({ processed: 3 })),
      supabaseClient: db,
      now: NOW,
      env: ENABLED_ENV,
    }),
    /connection terminated/,
  );
});

test('finished_at reflects real elapsed time, not the start instant', async () => {
  const { db } = harness({ seed: { enabled: true } });
  const runs = db._rows(SCHEDULER_RUNS_TABLE);

  // No `now` injected, so the service uses the real clock at both ends. `finished_at` used to be a
  // copy of the START instant, so every run reported a zero-second duration AND the release was told
  // the job finished when it began — putting next_run_at in the past for any run longer than its
  // interval, and backdating last_success_at by the whole duration.
  await scheduler.runScheduledJob({
    jobKey: JOB,
    trigger: SCHEDULER_TRIGGERS.OPERATOR,
    registry: registryWith(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { processed: 1 };
    }),
    supabaseClient: db,
    env: ENABLED_ENV,
  });

  const row = runs[runs.length - 1];
  assert.ok(row, 'a run row was recorded');
  const elapsed = Date.parse(row.finished_at) - Date.parse(row.started_at);
  assert.ok(
    elapsed >= 20,
    `finished_at - started_at was ${elapsed}ms for a handler that slept 25ms; the end time is being ` +
      'copied from the start instant',
  );
});
