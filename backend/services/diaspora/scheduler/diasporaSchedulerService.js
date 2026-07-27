/**
 * Diaspora GTM — durable scheduled execution (Issue #127, Phase 2E).
 *
 * NO ALWAYS-RUNNING PROCESS
 * -------------------------
 * `eventWorker.js` already learned this lesson and wrote it down: it refuses to start its
 * `setInterval` when `VERCEL` is set, because an interval in a serverless function is not a scheduler,
 * it is a coincidence that survives until the next cold start. So this module owns no timer, no loop
 * and no process. It exposes functions that a DISPATCHED invocation calls — a platform cron hitting
 * `POST /api/diaspora/scheduler/run`, or a scheduled GitHub Actions workflow doing the same. Whatever
 * pulls the trigger, the shape below is identical, and so is the safety.
 *
 * THE CLAIM IS THE WHOLE DESIGN
 * -----------------------------
 * Dispatchers overlap. Vercel Cron and GitHub Actions both fire at-least-once; a slow run is still
 * executing when the next one starts; an operator can trigger a manual run on top of either. So every
 * execution goes through `diaspora_scheduler_claim_atomic`, which takes the job row with
 * `SELECT … FOR UPDATE SKIP LOCKED` and leaves a time-limited lease behind:
 *
 *   · the loser returns IMMEDIATELY with a reason instead of blocking — a blocked serverless
 *     invocation is a paid timeout, and a queue of them is an outage;
 *   · a worker killed mid-run (routine on serverless) releases its claim when the lease expires,
 *     with nobody intervening;
 *   · release refuses to touch a lease owned by somebody else, so a zombie finishing late cannot
 *     report its stale run as fresh — and `last_success_at` is exactly the value an alert watches.
 *
 * WHY A RUN ROW
 * -------------
 * Same argument ledger #21 made for `diaspora_billing_reconciliation_runs`, one level up: "we ran and
 * found nothing" must be distinguishable from "we have not run in three weeks". A skipped claim does
 * NOT get a row — a dispatcher ticking every minute against an hourly job would otherwise write
 * sixty NOT_DUE rows an hour and bury the real history.
 *
 * DISABLED BY DEFAULT, TWICE
 * --------------------------
 * A scheduled run requires the deployment's environment flag AND the database's `enabled` column.
 * Operator-triggered runs bypass both — deliberately, because the automatic path being broken is the
 * single most likely reason someone needs a manual run — but still take the lease.
 */
import crypto from 'crypto';
import { resolveClient } from '../diasporaServiceUtils.js';
import {
  SCHEDULED_JOBS_TABLE,
  SCHEDULER_RUNS_TABLE,
  SCHEDULER_TRIGGERS,
  SCHEDULER_RUN_STATES,
  SCHEDULER_SKIP_REASONS,
  isSchedulerJobFlagEnabled,
  schedulerJobFlagEnvVar,
  schedulerLeaseSeconds,
  schedulerMaxFailures,
  schedulerBackoffBaseSeconds,
  schedulerBackoffMaxSeconds,
  schedulerIntervalSeconds,
  schedulerBatchLimit,
} from '../../../constants/diaspora/diasporaSchedulerConstants.js';
import { SCHEDULER_JOB_DEFINITIONS } from './diasporaSchedulerJobs.js';

export const CLAIM_RPC = 'diaspora_scheduler_claim_atomic';
export const RELEASE_RPC = 'diaspora_scheduler_release_atomic';

/** Sanitized error text for a durable column. Bounded, and never a payload. */
function safeError(message, max = 500) {
  const text = String(message == null ? '' : message);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * An opaque per-invocation worker identity.
 *
 * Deliberately NOT a hostname, a pod name or an IP. `lease_owner` is read by operators and exported to
 * dashboards; infrastructure topology is not their business and is not worth leaking to make a log
 * line prettier.
 */
export function newSchedulerOwner(prefix = 'sched') {
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * The registry. A job is a key plus a handler; everything else (cadence, batch size, flag) is
 * configuration. Kept injectable so tests drive real orchestration with a trivial handler rather than
 * standing up five domain services to prove the lease works.
 */
export function schedulerJobRegistry(overrides = null) {
  return overrides || SCHEDULER_JOB_DEFINITIONS;
}

export function listSchedulerJobKeys(registry = null) {
  return Object.keys(schedulerJobRegistry(registry));
}

/**
 * Run one job, end to end: claim → record → execute → settle.
 *
 * @param {object} opts
 * @param {string} opts.jobKey
 * @param {string} [opts.trigger='scheduled']  scheduled | operator | startup | backfill
 * @param {string} [opts.owner]                defaults to a fresh opaque id
 * @param {string|null} [opts.tenantId]        scope a run to one tenant (operator spot check)
 * @param {object} [opts.registry]             injected job registry
 * @param {object} [opts.supabaseClient]
 * @param {Date|string} [opts.now]             injected clock; also passed to the RPCs
 * @returns {{ran:boolean, jobKey:string, reason?:string, runId?:string, state?:string, result?:object}}
 */
export async function runScheduledJob({
  jobKey,
  trigger = SCHEDULER_TRIGGERS.SCHEDULED,
  owner = null,
  tenantId = null,
  initiatedBy = null,
  correlationId = null,
  limit = null,
  registry = null,
  env = process.env,
  now = null,
  supabaseClient = null,
  handlerContext = {},
} = {}) {
  const jobs = schedulerJobRegistry(registry);
  const definition = jobs[jobKey];
  if (!definition || typeof definition.handler !== 'function') {
    return { ran: false, jobKey, reason: SCHEDULER_SKIP_REASONS.UNKNOWN_JOB };
  }

  const supabase = await resolveClient({ supabaseClient });
  const clock = now ? new Date(now) : new Date();
  const isOperatorRun = trigger === SCHEDULER_TRIGGERS.OPERATOR;
  const workerId = owner || newSchedulerOwner();

  // The deployment-level gate. Checked BEFORE the claim so a disabled job costs one function call and
  // no database write at all — a cron ticking every minute against four disabled jobs should be
  // nearly free.
  if (!isOperatorRun && !isSchedulerJobFlagEnabled(jobKey, env)) {
    return {
      ran: false,
      jobKey,
      reason: SCHEDULER_SKIP_REASONS.FLAG_OFF,
      flag: schedulerJobFlagEnvVar(jobKey),
    };
  }

  const claim = await callRpc(supabase, CLAIM_RPC, {
    p_job_key: jobKey,
    p_owner: workerId,
    p_lease_seconds: schedulerLeaseSeconds(env),
    p_interval_seconds: schedulerIntervalSeconds(jobKey, env),
    // An operator run ignores both the schedule and the terminus: the automatic path being stuck is
    // precisely when a human needs to be able to run it.
    p_ignore_schedule: isOperatorRun,
    p_require_enabled: !isOperatorRun,
    p_now: clock.toISOString(),
  });

  if (!claim?.claimed) {
    return { ran: false, jobKey, reason: claim?.reason || SCHEDULER_SKIP_REASONS.LOCKED, detail: claim || null };
  }

  const run = await openRun(supabase, {
    jobKey, tenantId, trigger, leaseOwner: workerId, correlationId, initiatedBy, startedAt: clock,
  });

  let outcome = null;
  let failure = null;
  try {
    outcome = await definition.handler({
      supabase,
      supabaseClient: supabase,
      jobKey,
      tenantId,
      runId: run?.id || null,
      correlationId,
      trigger,
      now: clock,
      limit: limit ?? schedulerBatchLimit(jobKey, env),
      env,
      ...handlerContext,
    });
  } catch (err) {
    failure = err;
  }

  const finishedAt = new Date(clock.getTime());
  const counts = normalizeCounts(outcome);

  await closeRun(supabase, run?.id, {
    state: failure ? SCHEDULER_RUN_STATES.FAILED : SCHEDULER_RUN_STATES.COMPLETED,
    finished_at: finishedAt.toISOString(),
    processed_count: counts.processed,
    failed_count: counts.failed,
    dead_lettered_count: counts.deadLettered,
    last_error: failure ? safeError(failure.message) : null,
    detail: failure ? { error: safeError(failure.message, 300) } : (counts.detail || {}),
  });

  const release = await callRpc(supabase, RELEASE_RPC, {
    p_job_key: jobKey,
    p_owner: workerId,
    p_succeeded: !failure,
    p_error: failure ? safeError(failure.message) : null,
    p_error_code: failure ? String(failure.code || 'SCHEDULED_JOB_FAILED').slice(0, 64) : null,
    p_run_id: run?.id || null,
    p_max_failures: schedulerMaxFailures(env),
    p_backoff_base_seconds: schedulerBackoffBaseSeconds(env),
    p_backoff_max_seconds: schedulerBackoffMaxSeconds(env),
    p_now: finishedAt.toISOString(),
  });

  if (failure) {
    // The failure is recorded and the job has backed off. It is re-thrown so a manual operator run
    // reports the real diagnosis rather than a bare "failed"; the dispatcher catches it per job so one
    // bad job never stops the others.
    failure.schedulerJobKey = jobKey;
    failure.schedulerRunId = run?.id || null;
    failure.schedulerRelease = release;
    throw failure;
  }

  return {
    ran: true,
    jobKey,
    runId: run?.id || null,
    owner: workerId,
    trigger,
    state: SCHEDULER_RUN_STATES.COMPLETED,
    processed: counts.processed,
    failed: counts.failed,
    deadLettered: counts.deadLettered,
    nextRunAt: release?.next_run_at || null,
    leaseRetained: release?.released !== false,
    result: outcome || null,
  };
}

/**
 * Run every due job. This is what a cron invocation calls.
 *
 * One job's failure never stops the others: a broken reconciliation must not silently take the
 * abandoned-checkout sweep down with it, because the second failure would be invisible behind the
 * first.
 */
export async function runDueScheduledJobs({
  jobKeys = null,
  trigger = SCHEDULER_TRIGGERS.SCHEDULED,
  registry = null,
  env = process.env,
  now = null,
  correlationId = null,
  supabaseClient = null,
  handlerContext = {},
} = {}) {
  const jobs = schedulerJobRegistry(registry);
  const keys = Array.isArray(jobKeys) && jobKeys.length ? jobKeys : Object.keys(jobs);
  const results = [];

  for (const jobKey of keys) {
    // A fresh owner per job. One owner for the whole tick would let a job that overran its lease
    // release a lease another job legitimately holds.
    try {
      results.push(await runScheduledJob({
        jobKey, trigger, registry: jobs, env, now, correlationId, supabaseClient, handlerContext,
      }));
    } catch (err) {
      results.push({
        ran: true,
        jobKey,
        state: SCHEDULER_RUN_STATES.FAILED,
        error: safeError(err?.message, 300),
        errorCode: err?.code || 'SCHEDULED_JOB_FAILED',
        runId: err?.schedulerRunId || null,
      });
    }
  }

  return {
    dispatchedAt: (now ? new Date(now) : new Date()).toISOString(),
    considered: keys.length,
    ran: results.filter((r) => r.ran).length,
    skipped: results.filter((r) => !r.ran).length,
    failed: results.filter((r) => r.state === SCHEDULER_RUN_STATES.FAILED).length,
    results,
  };
}

/**
 * The operator view: per-job freshness and the needs-operator queue.
 *
 * `stale` is the load-bearing field. The most dangerous scheduler failure is not an error, it is
 * silence — a job that quietly stopped looks exactly like a job with nothing to do.
 */
export async function schedulerHealth({
  registry = null,
  env = process.env,
  now = null,
  staleMultiplier = 3,
  supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const jobs = schedulerJobRegistry(registry);
  const clock = now ? new Date(now) : new Date();

  const { data, error } = await supabase.from(SCHEDULED_JOBS_TABLE).select('*');
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to read scheduled jobs: ${error.message}`);
  }
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  const byKey = new Map(rows.map((row) => [row.job_key, row]));

  const jobsReport = Object.keys(jobs).map((jobKey) => {
    const row = byKey.get(jobKey) || null;
    const interval = Number(row?.interval_seconds) || schedulerIntervalSeconds(jobKey, env);
    const lastSuccess = row?.last_success_at ? Date.parse(row.last_success_at) : null;
    const ageSeconds = Number.isFinite(lastSuccess) ? Math.round((clock.getTime() - lastSuccess) / 1000) : null;
    // A job that has NEVER succeeded is stale — but only if it is actually switched on. Reporting an
    // intentionally-off job as stale trains operators to ignore the field.
    const flagOn = isSchedulerJobFlagEnabled(jobKey, env);
    const dbOn = Boolean(row?.enabled);
    const active = flagOn && dbOn;
    const stale = active && (ageSeconds === null || ageSeconds > interval * Math.max(1, staleMultiplier));

    return {
      jobKey,
      flagEnabled: flagOn,
      flag: schedulerJobFlagEnvVar(jobKey),
      databaseEnabled: dbOn,
      active,
      state: row?.state || 'unregistered',
      intervalSeconds: interval,
      lastSuccessAt: row?.last_success_at || null,
      lastAttemptAt: row?.last_attempt_at || null,
      lastFailureAt: row?.last_failure_at || null,
      lastErrorCode: row?.last_error_code || null,
      consecutiveFailures: Number(row?.consecutive_failures || 0),
      nextRunAt: row?.next_run_at || null,
      totalRuns: Number(row?.total_runs || 0),
      leaseHeld: Boolean(row?.leased_until && Date.parse(row.leased_until) > clock.getTime()),
      ageSeconds,
      stale,
      staleReason: !active ? null : (ageSeconds === null ? 'NEVER_SUCCEEDED' : (stale ? 'STALE' : null)),
      needsOperator: row?.state === 'needs_operator',
    };
  });

  return {
    checkedAt: clock.toISOString(),
    jobs: jobsReport,
    activeCount: jobsReport.filter((j) => j.active).length,
    staleCount: jobsReport.filter((j) => j.stale).length,
    needsOperatorCount: jobsReport.filter((j) => j.needsOperator).length,
  };
}

/** Recent runs, newest first. Sanitized by construction — the table holds counts, never payloads. */
export async function listSchedulerRuns({ jobKey = null, tenantId = null, limit = 20, supabaseClient = null } = {}) {
  const supabase = await resolveClient({ supabaseClient });
  let query = supabase
    .from(SCHEDULER_RUNS_TABLE)
    .select('id, job_key, tenant_id, trigger, state, started_at, finished_at, processed_count, failed_count, dead_lettered_count, last_error, correlation_id, initiated_by, detail')
    .order('started_at', { ascending: false })
    .limit(Math.min(Number(limit) || 20, 100));
  if (jobKey) query = query.eq('job_key', jobKey);
  if (tenantId) query = query.eq('tenant_id', String(tenantId));
  const { data, error } = await query;
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to list scheduler runs: ${error.message}`);
  }
  return Array.isArray(data) ? data : [];
}

// ── internals ───────────────────────────────────────────────────────────────

async function callRpc(supabase, name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const err = new Error(`${name} failed: ${safeError(error.message, 300)}`);
    err.code = error.code || 'SCHEDULER_RPC_FAILED';
    throw err;
  }
  return data;
}

async function openRun(supabase, { jobKey, tenantId, trigger, leaseOwner, correlationId, initiatedBy, startedAt }) {
  const { data, error } = await supabase
    .from(SCHEDULER_RUNS_TABLE)
    .insert({
      job_key: jobKey,
      tenant_id: tenantId || null,
      trigger,
      state: SCHEDULER_RUN_STATES.RUNNING,
      lease_owner: leaseOwner,
      started_at: startedAt.toISOString(),
      processed_count: 0,
      failed_count: 0,
      dead_lettered_count: 0,
      correlation_id: correlationId || null,
      initiated_by: initiatedBy || null,
      detail: {},
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to open scheduler run: ${safeError(error.message, 300)}`);
  return data;
}

async function closeRun(supabase, runId, patch) {
  if (!runId) return null;
  const { data, error } = await supabase
    .from(SCHEDULER_RUNS_TABLE)
    .update(patch)
    .eq('id', runId)
    .select()
    .maybeSingle();
  // A run left in `running` forever is indistinguishable from a dispatcher that stopped, so a failure
  // to close it is worth surfacing rather than swallowing.
  if (error) throw new Error(`Failed to close scheduler run: ${safeError(error.message, 300)}`);
  return data || null;
}

/** Handlers report whatever suits their domain; the run row needs three numbers and a detail blob. */
function normalizeCounts(outcome) {
  if (!outcome || typeof outcome !== 'object') {
    return { processed: 0, failed: 0, deadLettered: 0, detail: {} };
  }
  return {
    processed: Number(outcome.processed ?? outcome.scanned ?? 0) || 0,
    failed: Number(outcome.failed ?? 0) || 0,
    deadLettered: Number(outcome.deadLettered ?? outcome.dead_lettered ?? 0) || 0,
    detail: outcome.detail && typeof outcome.detail === 'object' ? outcome.detail : {},
  };
}
