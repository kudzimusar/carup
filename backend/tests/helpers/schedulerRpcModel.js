/**
 * A faithful JavaScript model of ledger #27's two scheduler RPCs, for service-level tests.
 *
 * WHY MODEL THE SQL RATHER THAN STUB IT
 * -------------------------------------
 * The claim is the entire safety argument of the scheduler, so a stub that always answers "claimed"
 * would make every concurrency test pass against an implementation with no concurrency control at
 * all. This model implements the same decision tree as
 * `diaspora_scheduler_claim_atomic` / `diaspora_scheduler_release_atomic`, in the same order, with the
 * same refusal reasons — so a service-level test genuinely exercises the orchestration around a
 * correct primitive.
 *
 * WHAT IT CAN AND CANNOT PROVE
 * ----------------------------
 * It proves the SERVICE never double-processes given a correct claim: JavaScript is single-threaded,
 * so the model's read-decide-write is atomic in exactly the way `SELECT … FOR UPDATE SKIP LOCKED`
 * makes the SQL atomic, and two schedulers driven concurrently through `Promise.all` really do
 * interleave at every `await`.
 *
 * It cannot prove the SQL itself is right — a model that agrees with a wrong migration is worthless.
 * That is what `database/test/diaspora_scheduler_lease_check.mjs` is for: it executes the real
 * migration on real PostgreSQL with two real concurrent sessions.
 *
 * `holdRowLock` simulates the one case JS cannot produce naturally: another transaction holding the
 * row when SKIP LOCKED runs, which is what makes the SQL return `LOCKED` rather than block.
 */

/**
 * @param {object} options
 * @param {Array} options.rows  the SAME array the mock Supabase client stores
 *   `diaspora_scheduled_jobs` in (`db._rows('diaspora_scheduled_jobs')`). Sharing the array rather
 *   than keeping a private copy is what makes `schedulerHealth()` — which reads through the query
 *   builder, not the RPC — observe the state the claim actually wrote. Two stores would let a health
 *   test pass while reporting fiction.
 * @param {object} [options.jobs] seed patches keyed by job_key
 */
export function createSchedulerRpcModel({ rows = [], jobs = {} } = {}) {
  for (const [key, seed] of Object.entries(jobs)) {
    const existing = rows.find((r) => r.job_key === key);
    if (existing) Object.assign(existing, seed);
    else rows.push({ ...blankJob(key), ...seed });
  }

  const lockedKeys = new Set();
  const calls = [];
  const find = (jobKey) => rows.find((r) => r.job_key === jobKey) || null;

  function blankJob(jobKey) {
    return {
      job_key: jobKey,
      enabled: false,
      state: 'idle',
      lease_owner: null,
      leased_until: null,
      next_run_at: null,
      interval_seconds: 3600,
      last_attempt_at: null,
      last_success_at: null,
      last_failure_at: null,
      last_error: null,
      last_error_code: null,
      consecutive_failures: 0,
      total_runs: 0,
      last_run_id: null,
      metadata: {},
    };
  }

  const model = {
    rows,
    calls,
    /** Simulate a concurrent transaction holding this job row, so SKIP LOCKED skips it. */
    holdRowLock(jobKey) { lockedKeys.add(jobKey); },
    releaseRowLock(jobKey) { lockedKeys.delete(jobKey); },
    job(jobKey) { return find(jobKey); },
    seed(jobKey, patch) {
      const existing = find(jobKey);
      if (existing) return Object.assign(existing, patch);
      const created = { ...blankJob(jobKey), ...patch };
      rows.push(created);
      return created;
    },

    rpc: {
      diaspora_scheduler_claim_atomic(params) {
        const {
          p_job_key: jobKey,
          p_owner: owner,
          p_lease_seconds: leaseSeconds = 300,
          p_interval_seconds: intervalSeconds = null,
          p_ignore_schedule: ignoreSchedule = false,
          p_require_enabled: requireEnabled = true,
          p_now: nowIso = null,
        } = params || {};
        calls.push({ rpc: 'claim', jobKey, owner });
        if (!jobKey || !owner) {
          const err = new Error('DIASPORA_SCHEDULER/JOB_KEY_AND_OWNER_REQUIRED');
          err.code = 'P0001';
          throw err;
        }
        const now = nowIso ? new Date(nowIso) : new Date();

        // INSERT ... ON CONFLICT DO NOTHING
        if (!find(jobKey)) {
          rows.push({ ...blankJob(jobKey), interval_seconds: intervalSeconds || 3600 });
        }

        // SELECT ... FOR UPDATE SKIP LOCKED
        if (lockedKeys.has(jobKey)) return { claimed: false, reason: 'LOCKED', job_key: jobKey };
        const job = find(jobKey);

        if (requireEnabled && !job.enabled) return { claimed: false, reason: 'DISABLED', job_key: jobKey };
        if (job.state === 'needs_operator' && !ignoreSchedule) {
          return { claimed: false, reason: 'NEEDS_OPERATOR', job_key: jobKey, consecutive_failures: job.consecutive_failures };
        }
        if (job.leased_until && new Date(job.leased_until) > now && job.lease_owner !== owner) {
          return { claimed: false, reason: 'LEASED', job_key: jobKey, leased_until: job.leased_until };
        }
        if (!ignoreSchedule && job.next_run_at && new Date(job.next_run_at) > now) {
          return { claimed: false, reason: 'NOT_DUE', job_key: jobKey, next_run_at: job.next_run_at };
        }

        const lease = Math.min(Math.max(Number(leaseSeconds) || 300, 5), 3600);
        job.state = 'leased';
        job.lease_owner = owner;
        job.leased_until = new Date(now.getTime() + lease * 1000).toISOString();
        job.last_attempt_at = now.toISOString();
        job.total_runs += 1;
        if (intervalSeconds) job.interval_seconds = intervalSeconds;

        return {
          claimed: true,
          job_key: jobKey,
          lease_owner: owner,
          leased_until: job.leased_until,
          consecutive_failures: job.consecutive_failures,
          interval_seconds: job.interval_seconds,
          last_success_at: job.last_success_at,
          total_runs: job.total_runs,
        };
      },

      diaspora_scheduler_release_atomic(params) {
        const {
          p_job_key: jobKey,
          p_owner: owner,
          p_succeeded: succeeded,
          p_error: error = null,
          p_error_code: errorCode = null,
          p_run_id: runId = null,
          p_max_failures: maxFailures = 5,
          p_backoff_base_seconds: base = 60,
          p_backoff_max_seconds: max = 3600,
          p_now: nowIso = null,
        } = params || {};
        calls.push({ rpc: 'release', jobKey, owner, succeeded });
        const job = find(jobKey);
        if (!job) {
          const err = new Error('DIASPORA_SCHEDULER/NOT_FOUND_JOB');
          err.code = 'P0001';
          throw err;
        }
        if (job.lease_owner !== owner) {
          return { released: false, reason: 'LEASE_LOST', job_key: jobKey, current_owner: job.lease_owner };
        }
        const now = nowIso ? new Date(nowIso) : new Date();

        if (succeeded) {
          job.state = 'idle';
          job.lease_owner = null;
          job.leased_until = null;
          job.last_success_at = now.toISOString();
          job.last_error = null;
          job.last_error_code = null;
          job.consecutive_failures = 0;
          job.next_run_at = new Date(now.getTime() + job.interval_seconds * 1000).toISOString();
          job.last_run_id = runId || job.last_run_id;
          return { released: true, job_key: jobKey, state: job.state, next_run_at: job.next_run_at, last_success_at: job.last_success_at };
        }

        const failures = job.consecutive_failures + 1;
        let state;
        let next;
        if (failures >= Math.max(Number(maxFailures) || 5, 1)) {
          state = 'needs_operator';
          next = null;  // the terminus
        } else {
          state = 'idle';
          // Mirror ledger #27 EXACTLY, including its exponent cap.
          //
          // This previously computed `base * 2 ** (failures - 1)` uncapped. In IEEE doubles that can
          // never overflow, so the model silently disagreed with the SQL precisely where the SQL
          // broke: the migration multiplied in int4 and raised `integer out of range` at 27
          // consecutive failures — a value schedulerMaxFailures() explicitly permits, since it clamps
          // to 50. A model more permissive than the thing it models makes every test using it
          // optimistic, which is how that overflow survived a fully green suite.
          const window = Math.min(
            Math.max(Number(max) || 3600, 1),
            Math.max(Number(base) || 60, 1) * (2 ** Math.min(failures - 1, 30)),
          );
          next = new Date(now.getTime() + Math.max(1, Math.floor(Math.random() * window)) * 1000).toISOString();
        }
        job.state = state;
        job.lease_owner = null;
        job.leased_until = null;
        job.last_failure_at = now.toISOString();
        job.last_error = String(error || 'unspecified failure').slice(0, 500);
        job.last_error_code = String(errorCode || 'SCHEDULED_JOB_FAILED').slice(0, 64);
        job.consecutive_failures = failures;
        job.next_run_at = next;
        job.last_run_id = runId || job.last_run_id;
        return {
          released: true, job_key: jobKey, state, consecutive_failures: failures,
          next_run_at: next, dead_lettered: state === 'needs_operator',
        };
      },
    },
  };

  return model;
}
