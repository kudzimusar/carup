/**
 * CARUP-DEALER-ONB-001-LR01-R6 DBA #4: bounded retry of a WHOLE-TRANSACTION dealership RPC that
 * PostgreSQL aborted for a concurrency reason only.
 *
 * Each `db.rpc(...)` is one PostgREST transaction. When PostgreSQL reports
 *   40P01 deadlock_detected      — it chose this transaction as the deadlock victim, or
 *   40001 serialization_failure  — it could not serialise this transaction,
 * the WHOLE transaction has already been rolled back: nothing was written, so running the same
 * call again is safe and cannot double-apply. Every other outcome — success, a business refusal
 * (RAISE EXCEPTION → SQLSTATE P0001, e.g. DEALER_LISTING_AUTHORITY_NOT_CURRENT), a privilege or
 * constraint error, lock_timeout (55P03), a network fault or a thrown exception — is returned or
 * re-thrown unchanged after the FIRST attempt. A refusal is never retried into a different answer.
 *
 * The lock order in docs/dealership/R6_DBA_OPERATIONS_AND_LOCK_ORDER.md removes the known
 * deadlock cycles; this is the defence for the residual cases (e.g. a caller locking several
 * programme VINs out of ascending order). Attempts are bounded (default 3 in total) with full
 * jitter, so a persistent conflict surfaces as the original error within ~0.5 s.
 */

export const RETRYABLE_SQLSTATES = Object.freeze(['40P01', '40001']);
export const DEFAULT_TRANSIENT_RETRY = Object.freeze({ maxAttempts: 3, baseDelayMs: 40, maxDelayMs: 250 });

/** True only for the two SQLSTATEs whose transaction PostgreSQL has already rolled back. */
export function isTransientSqlConflict(error) {
  return Boolean(error) && typeof error === 'object' && RETRYABLE_SQLSTATES.includes(error.code);
}

/** Full-jitter exponential backoff: uniform in [1, min(maxDelayMs, baseDelayMs * 2^(attempt-1))]. */
export function transientRetryDelayMs(attempt, { baseDelayMs, maxDelayMs } = DEFAULT_TRANSIENT_RETRY, random = Math.random) {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return 1 + Math.floor(Math.max(0, Math.min(0.999999, random())) * cap);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call `db.rpc(fn, args)`; on 40P01/40001 only, wait a jittered delay and call again, at most
 * `maxAttempts` calls in total. Returns the LAST `{ data, error }` exactly as supabase-js gave it.
 */
export async function rpcWithTransientRetry(db, fn, args, {
  maxAttempts = DEFAULT_TRANSIENT_RETRY.maxAttempts,
  baseDelayMs = DEFAULT_TRANSIENT_RETRY.baseDelayMs,
  maxDelayMs = DEFAULT_TRANSIENT_RETRY.maxDelayMs,
  sleep = defaultSleep,
  random = Math.random,
  onRetry = null,
} = {}) {
  const attempts = Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 5 ? maxAttempts : 1;
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await db.rpc(fn, args);
    if (!isTransientSqlConflict(result?.error) || attempt === attempts) return result;
    const delayMs = transientRetryDelayMs(attempt, { baseDelayMs, maxDelayMs }, random);
    if (typeof onRetry === 'function') onRetry({ fn, attempt, code: result.error.code, delayMs });
    await sleep(delayMs);
  }
  return result;
}
