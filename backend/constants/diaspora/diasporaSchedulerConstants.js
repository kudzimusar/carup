/**
 * Diaspora GTM — scheduler flags and job identities (Issue #127, Phase 2E).
 *
 * EVERY JOB IS OFF BY DEFAULT, TWICE.
 * ----------------------------------
 * A job runs on a schedule only when BOTH are true:
 *   1. its environment flag is `true` in this deployment, and
 *   2. `diaspora_scheduled_jobs.enabled` is `true` for that job key in this database.
 *
 * The two gates answer different questions and are deliberately not merged. The env flag is a
 * deployment-time decision ("this build, in this environment, may do this"); the database flag is a
 * runtime kill switch an operator can pull during an incident without a redeploy — which on a
 * serverless platform is the difference between stopping a runaway job in ten seconds and in ten
 * minutes.
 *
 * Operator-triggered runs bypass both, and always have: `POST /api/diaspora/subscription/reconcile`
 * already worked regardless of `DIASPORA_BILLING_RECONCILIATION_SCHEDULER`, and taking that away
 * would remove the only tool available when the automatic path is the thing that is broken. An
 * operator run still takes the lease, so it cannot collide with a scheduled one.
 *
 * NOTHING HERE MOVES MONEY. The renewal sweep detects that a period came due and records it for a
 * human; ADR-001 §9 keeps every live provider unapproved, and no scheduled job calls a charge API.
 */
import { isProduction } from './diasporaBillingConstants.js';

/** Job keys. These are the primary key of `diaspora_scheduled_jobs`, so they are frozen forever. */
export const SCHEDULER_JOB_KEYS = Object.freeze({
  BILLING_RECONCILIATION: 'billing_reconciliation',
  BILLING_CHECKOUT_SWEEP: 'billing_checkout_sweep',
  BILLING_EVENT_RETRY: 'billing_event_retry',
  DRIVE_SYNC_RETRY: 'drive_sync_retry',
  SUBSCRIPTION_RENEWAL_SWEEP: 'subscription_renewal_sweep',
});

export const SCHEDULER_TRIGGERS = Object.freeze({
  SCHEDULED: 'scheduled',
  OPERATOR: 'operator',
  STARTUP: 'startup',
  BACKFILL: 'backfill',
});

export const SCHEDULER_RUN_STATES = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

/** Why a claim was refused. Five very different meanings of "it did not run". */
export const SCHEDULER_SKIP_REASONS = Object.freeze({
  LOCKED: 'LOCKED',                 // another dispatcher holds the row lock right now
  LEASED: 'LEASED',                 // another worker is mid-run and its lease is still valid
  NOT_DUE: 'NOT_DUE',               // the schedule says later
  DISABLED: 'DISABLED',             // the database kill switch is off
  FLAG_OFF: 'FLAG_OFF',             // this deployment's environment flag is off
  NEEDS_OPERATOR: 'NEEDS_OPERATOR', // the terminus: repeated failure, a human must intervene
  UNKNOWN_JOB: 'UNKNOWN_JOB',
});

export const SCHEDULED_JOBS_TABLE = 'diaspora_scheduled_jobs';
export const SCHEDULER_RUNS_TABLE = 'diaspora_scheduler_runs';
export const SUBSCRIPTION_RENEWALS_TABLE = 'diaspora_subscription_renewals';

/**
 * Per-job environment flag. Default OFF for every one of them.
 *
 * `DIASPORA_BILLING_RECONCILIATION_SCHEDULER` already existed and keeps its name — renaming it would
 * silently disable it in any environment that had already set it, which is exactly the class of
 * change that is invisible until an audit is three weeks stale.
 */
const JOB_FLAG_ENV = Object.freeze({
  [SCHEDULER_JOB_KEYS.BILLING_RECONCILIATION]: 'DIASPORA_BILLING_RECONCILIATION_SCHEDULER',
  [SCHEDULER_JOB_KEYS.BILLING_CHECKOUT_SWEEP]: 'DIASPORA_BILLING_CHECKOUT_SWEEP_SCHEDULER',
  [SCHEDULER_JOB_KEYS.BILLING_EVENT_RETRY]: 'DIASPORA_BILLING_EVENT_RETRY_SCHEDULER',
  [SCHEDULER_JOB_KEYS.DRIVE_SYNC_RETRY]: 'DIASPORA_DRIVE_SYNC_RETRY_SCHEDULER',
  [SCHEDULER_JOB_KEYS.SUBSCRIPTION_RENEWAL_SWEEP]: 'DIASPORA_SUBSCRIPTION_RENEWAL_SCHEDULER',
});

export function schedulerJobFlagEnvVar(jobKey) {
  return JOB_FLAG_ENV[jobKey] || null;
}

/** True only when this deployment explicitly opted the job in. Unknown job -> false, never true. */
export function isSchedulerJobFlagEnabled(jobKey, env = process.env) {
  const name = JOB_FLAG_ENV[jobKey];
  if (!name) return false;
  return String(env[name] || '').toLowerCase() === 'true';
}

/**
 * The dispatcher endpoint's own switch. Default OFF.
 *
 * Separate from the per-job flags so that an incident can stop ALL scheduled work with one variable,
 * without having to remember which five to unset.
 */
export function isSchedulerDispatchEnabled(env = process.env) {
  return String(env.DIASPORA_SCHEDULER_ENABLED || '').toLowerCase() === 'true';
}

/**
 * The shared secret a dispatched invocation must present.
 *
 * Falls back to `CRON_SECRET`, which is what Vercel Cron sends and what `communicationRoutes.js`
 * already accepts — one convention, not two. Returns null when neither is set, and the route then
 * refuses every request: an unauthenticated endpoint that runs billing jobs is a denial-of-service
 * primitive at best.
 */
export function schedulerDispatchSecret(env = process.env) {
  const secret = env.DIASPORA_SCHEDULER_SECRET || env.CRON_SECRET || '';
  return secret ? String(secret) : null;
}

/**
 * How long a claim is held before another dispatcher may take over.
 *
 * Must comfortably exceed the longest expected run and stay under the platform's function timeout: a
 * lease shorter than the run lets a second worker start while the first is still writing, and a lease
 * much longer than the timeout locks the job out for minutes after a crash.
 */
export function schedulerLeaseSeconds(env = process.env) {
  const n = Number(env.DIASPORA_SCHEDULER_LEASE_SECONDS || 300);
  if (!Number.isFinite(n) || n <= 0) return 300;
  return Math.min(Math.trunc(n), 3600);
}

/** Consecutive failures before a job stops rescheduling itself and waits for a human. */
export function schedulerMaxFailures(env = process.env) {
  const n = Number(env.DIASPORA_SCHEDULER_MAX_FAILURES || 5);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(Math.trunc(n), 50);
}

export function schedulerBackoffBaseSeconds(env = process.env) {
  const n = Number(env.DIASPORA_SCHEDULER_BACKOFF_BASE_SECONDS || 60);
  if (!Number.isFinite(n) || n <= 0) return 60;
  return Math.min(Math.trunc(n), 3600);
}

export function schedulerBackoffMaxSeconds(env = process.env) {
  const n = Number(env.DIASPORA_SCHEDULER_BACKOFF_MAX_SECONDS || 3600);
  if (!Number.isFinite(n) || n <= 0) return 3600;
  return Math.min(Math.trunc(n), 86400);
}

/**
 * Default cadence per job, in seconds. Bounded by the migration's CHECK (30s..24h).
 *
 * Reconciliation is daily because it is a full provider read per subscription and ADR-001 §7 asks it
 * to catch drift, not to be a second webhook. The sweeps are hourly because their windows are
 * measured in tens of minutes. Drive retries are every five minutes because a user is waiting.
 */
export const SCHEDULER_DEFAULT_INTERVALS = Object.freeze({
  [SCHEDULER_JOB_KEYS.BILLING_RECONCILIATION]: 86_400,
  [SCHEDULER_JOB_KEYS.BILLING_CHECKOUT_SWEEP]: 3_600,
  [SCHEDULER_JOB_KEYS.BILLING_EVENT_RETRY]: 900,
  [SCHEDULER_JOB_KEYS.DRIVE_SYNC_RETRY]: 300,
  [SCHEDULER_JOB_KEYS.SUBSCRIPTION_RENEWAL_SWEEP]: 3_600,
});

export function schedulerIntervalSeconds(jobKey, env = process.env) {
  const override = Number(env[`DIASPORA_SCHEDULER_INTERVAL_${String(jobKey).toUpperCase()}`]);
  const fallback = SCHEDULER_DEFAULT_INTERVALS[jobKey] || 3_600;
  const chosen = Number.isFinite(override) && override > 0 ? Math.trunc(override) : fallback;
  // The migration's CHECK refuses anything outside this band; clamping here turns a would-be 23514
  // into a value an operator can actually see in the job row.
  return Math.min(Math.max(chosen, 30), 86_400);
}

/** Bounded batch per run. A run that could touch unbounded rows is a run that will time out mid-way. */
export function schedulerBatchLimit(jobKey, env = process.env) {
  const override = Number(env[`DIASPORA_SCHEDULER_BATCH_${String(jobKey).toUpperCase()}`]);
  const chosen = Number.isFinite(override) && override > 0 ? Math.trunc(override) : 100;
  return Math.min(chosen, 500);
}

/**
 * Fail-closed safety assertion, mirroring `assertBillingTestModeSafety`.
 *
 * A dispatcher with no secret in production is refused outright rather than allowed to serve an open
 * endpoint that runs billing jobs.
 */
export function assertSchedulerDispatchSafety(env = process.env) {
  if (!isSchedulerDispatchEnabled(env)) return;
  if (isProduction() && !schedulerDispatchSecret(env)) {
    throw new Error(
      'DIASPORA_SCHEDULER_ENABLED is set in production but no DIASPORA_SCHEDULER_SECRET (or CRON_SECRET) is configured',
    );
  }
}
