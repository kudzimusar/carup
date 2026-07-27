/**
 * Diaspora GTM — the scheduled sweep over `diaspora_drive_sync_attempts` (Issue #127, Phase 2E).
 *
 * WHAT ledger #21 PROMISED AND NOBODY KEPT
 * ----------------------------------------
 * `driveSyncQueue.js` writes `next_attempt_at` on every retryable failure and exposes
 * `listDueSyncAttempts` to read them back. Nothing ever called it. So "queued for retry" was a state
 * a user could be shown and the system had no mechanism to honour — worse than a plain error, because
 * it says wait and the waiting never ends.
 *
 * There are two distinct failures to fix here and only one of them is a retry:
 *
 *  1. A STUCK CLAIM. `claimSyncAttempt` moves a row to `in_flight` and clears `next_attempt_at`. If
 *     the process dies between the claim and the settle — which serverless does routinely, by timing
 *     the function out — the row stays `in_flight` forever. It is invisible to `listDueSyncAttempts`
 *     (which only looks at pending/failed), it can never be claimed again (the `.in('state', …)`
 *     filter is the lease), and `runSyncAttempt` answers every later request with "already in
 *     progress". A file that will never arrive, reported as being on its way.
 *
 *     The fix is a VISIBILITY TIMEOUT: an `in_flight` row whose `started_at` is older than the lease
 *     is presumed abandoned and returned to `failed` with a due time, so the normal retry path can
 *     take it. Bounded by `attempts`, so an operation that reliably kills its worker still reaches
 *     the ceiling rather than cycling forever.
 *
 *  2. AN EXHAUSTED RETRY. A row that is due, retryable, and already at the attempt ceiling is not
 *     going to succeed. It is dead-lettered here — `next_attempt_at` cleared so it is terminal, and a
 *     CRITICAL audit row written, because a user's document that will never arrive is exactly the
 *     class of event that trail exists for.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not re-execute uploads. `diaspora_drive_sync_attempts` stores a content CHECKSUM, not
 * content — by design, since buffering every user document in a table would be both a storage and a
 * privacy problem. So the bytes are simply not available to a background sweeper, and no amount of
 * scheduling changes that. Re-supplying content is the caller's act, and `runSyncAttempt`'s
 * idempotency key already makes that safe.
 *
 * Operations whose inputs ARE reconstructible from the row can be replayed, through an injected
 * `replayers` map keyed by operation. Nothing is registered by default: an unreplayable operation is
 * COUNTED and left alone, never silently dead-lettered, because "we have no code for this" is not the
 * attempt's fault and hiding it would remove the only evidence that the gap exists.
 */
import { resolveClient, appendCriticalAudit } from '../diasporaServiceUtils.js';
import {
  DRIVE_SYNC_ATTEMPTS_TABLE,
  SYNC_ATTEMPT_STATE,
  maxSyncAttempts,
  computeBackoffMs,
  sanitizeSyncAttempt,
} from './driveSyncQueue.js';

/**
 * How long an `in_flight` attempt may go unsettled before it is presumed abandoned.
 *
 * Must exceed the platform's function timeout comfortably. Too short and a slow-but-alive upload is
 * reclaimed underneath itself, producing exactly the double delivery the lease exists to prevent.
 */
export function driveAttemptVisibilityTimeoutMs(env = process.env) {
  const n = Number(env.DIASPORA_DRIVE_ATTEMPT_VISIBILITY_MS || 15 * 60 * 1000);
  if (!Number.isFinite(n) || n <= 0) return 15 * 60 * 1000;
  return Math.min(Math.trunc(n), 6 * 60 * 60 * 1000);
}

export const SWEEP_OUTCOMES = Object.freeze({
  RECLAIMED: 'reclaimed',
  DEAD_LETTERED: 'dead_lettered',
  REPLAYED: 'replayed',
  REPLAY_FAILED: 'replay_failed',
  UNREPLAYABLE: 'unreplayable',
});

/**
 * One sweep.
 *
 * @param {object} opts
 * @param {number} [opts.limit=100]
 * @param {Date|string} [opts.now]
 * @param {number} [opts.visibilityTimeoutMs]
 * @param {number} [opts.maxAttempts]
 * @param {Record<string, Function>} [opts.replayers] operation -> async (attempt, ctx) => result
 * @param {() => number} [opts.jitter] injectable so tests are exact rather than approximately right
 */
export async function sweepDriveSyncAttempts({
  limit = 100,
  now = null,
  visibilityTimeoutMs = null,
  maxAttempts = null,
  replayers = {},
  jitter = Math.random,
  tenantId = null,
  correlationId = null,
  actorId = null,
  supabaseClient = null,
} = {}) {
  const supabase = await resolveClient({ supabaseClient });
  const clock = now ? new Date(now) : new Date();
  const visibility = visibilityTimeoutMs ?? driveAttemptVisibilityTimeoutMs();
  const ceiling = maxAttempts ?? maxSyncAttempts();
  const batch = Math.min(Number(limit) || 100, 500);

  let query = supabase
    .from(DRIVE_SYNC_ATTEMPTS_TABLE)
    .select('*')
    .in('state', [SYNC_ATTEMPT_STATE.PENDING, SYNC_ATTEMPT_STATE.FAILED, SYNC_ATTEMPT_STATE.IN_FLIGHT])
    .order('created_at', { ascending: true });
  if (tenantId) query = query.eq('tenant_id', String(tenantId));
  const { data, error } = await query;
  if (error && error.code && error.code !== 'PGRST116') {
    throw new Error(`Failed to read Drive sync attempts: ${error.message}`);
  }

  const rows = (Array.isArray(data) ? data : (data ? [data] : [])).slice(0, batch);
  const outcomes = [];
  let reclaimed = 0;
  let deadLettered = 0;
  let replayed = 0;
  let replayFailed = 0;
  let unreplayable = 0;

  for (const row of rows) {
    // ── 1. Stuck claim ────────────────────────────────────────────────────
    if (row.state === SYNC_ATTEMPT_STATE.IN_FLIGHT) {
      const startedAt = Date.parse(row.started_at || '');
      const abandoned = Number.isFinite(startedAt) && (clock.getTime() - startedAt) > visibility;
      if (!abandoned) continue;

      if ((row.attempts ?? 0) >= ceiling) {
        await deadLetter(supabase, row, {
          clock, actorId, correlationId,
          reason: 'DRIVE_SYNC_ABANDONED_AT_CEILING',
          message: 'The worker holding this Drive operation did not finish, and the attempt ceiling is reached.',
        });
        outcomes.push({ id: row.id, outcome: SWEEP_OUTCOMES.DEAD_LETTERED, from: SYNC_ATTEMPT_STATE.IN_FLIGHT });
        deadLettered += 1;
        continue;
      }

      // Back to `failed`, which IS the retryable state, with a jittered due time. Not straight to
      // `pending`: `pending` means "never attempted" and would erase the fact that a worker died.
      const dueIn = computeBackoffMs(row.attempts ?? 1, { jitter });
      const { error: updateError } = await supabase
        .from(DRIVE_SYNC_ATTEMPTS_TABLE)
        .update({
          state: SYNC_ATTEMPT_STATE.FAILED,
          next_attempt_at: new Date(clock.getTime() + dueIn).toISOString(),
          last_error_code: 'DRIVE_SYNC_LEASE_EXPIRED',
          last_error: 'The worker holding this operation stopped before settling it; it was returned to the queue.',
        })
        .eq('id', row.id)
        // The lease is the filter: if another worker settled it since we read it, this matches nothing
        // and we leave its outcome alone rather than overwriting a success with a failure.
        .eq('state', SYNC_ATTEMPT_STATE.IN_FLIGHT);
      if (updateError) throw new Error(`Failed to reclaim Drive sync attempt: ${updateError.message}`);
      outcomes.push({ id: row.id, outcome: SWEEP_OUTCOMES.RECLAIMED, nextAttemptInMs: dueIn });
      reclaimed += 1;
      continue;
    }

    // ── 2. Due retries ────────────────────────────────────────────────────
    const dueAt = row.next_attempt_at ? Date.parse(row.next_attempt_at) : 0;
    if (Number.isFinite(dueAt) && dueAt > clock.getTime()) continue;

    if ((row.attempts ?? 0) >= ceiling) {
      await deadLetter(supabase, row, {
        clock, actorId, correlationId,
        reason: 'DRIVE_SYNC_RETRY_CEILING',
        message: 'This Drive operation reached its retry ceiling and will not be attempted again.',
      });
      outcomes.push({ id: row.id, outcome: SWEEP_OUTCOMES.DEAD_LETTERED, from: row.state });
      deadLettered += 1;
      continue;
    }

    const replayer = replayers[row.operation];
    if (typeof replayer !== 'function') {
      // Counted, not hidden. Upload replay needs content this table deliberately does not store.
      outcomes.push({ id: row.id, outcome: SWEEP_OUTCOMES.UNREPLAYABLE, operation: row.operation });
      unreplayable += 1;
      continue;
    }

    try {
      await replayer(sanitizeSyncAttempt(row), { supabase, now: clock, correlationId });
      outcomes.push({ id: row.id, outcome: SWEEP_OUTCOMES.REPLAYED, operation: row.operation });
      replayed += 1;
    } catch (err) {
      outcomes.push({ id: row.id, outcome: SWEEP_OUTCOMES.REPLAY_FAILED, operation: row.operation });
      replayFailed += 1;
      // The replayer owns its own bookkeeping (it goes through runSyncAttempt); the sweep only counts.
      void err;
    }
  }

  return {
    scanned: rows.length,
    reclaimed,
    deadLettered,
    replayed,
    replayFailed,
    unreplayable,
    outcomes,
  };
}

/**
 * Terminal. `next_attempt_at` is cleared so a dead letter cannot be picked up again, and the CRITICAL
 * audit row is fail-loud: a user's file that will never arrive is exactly what that trail is for.
 */
async function deadLetter(supabase, row, { clock, actorId, correlationId, reason, message }) {
  const { error } = await supabase
    .from(DRIVE_SYNC_ATTEMPTS_TABLE)
    .update({
      state: SYNC_ATTEMPT_STATE.DEAD_LETTERED,
      next_attempt_at: null,
      completed_at: clock.toISOString(),
      last_error_code: reason,
      last_error: message,
    })
    .eq('id', row.id)
    .neq('state', SYNC_ATTEMPT_STATE.SUCCEEDED)
    .neq('state', SYNC_ATTEMPT_STATE.DEAD_LETTERED);
  if (error) throw new Error(`Failed to dead-letter Drive sync attempt: ${error.message}`);

  await appendCriticalAudit(supabase, {
    actorId: actorId || null,
    tenantId: row.tenant_id,
    action: 'DRIVE_SYNC_DEAD_LETTERED',
    resourceType: 'diaspora_drive_sync_attempt',
    resourceId: row.id,
    metadata: {
      operation: row.operation,
      entityType: row.entity_type,
      entityId: row.entity_id,
      attempts: row.attempts,
      errorCode: reason,
      sweptBy: 'scheduler',
      correlationId: correlationId || null,
    },
  });
}
