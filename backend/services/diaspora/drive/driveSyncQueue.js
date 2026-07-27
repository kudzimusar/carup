/**
 * Diaspora GTM — durable Drive sync attempts (Issue #127, Drive lane).
 *
 * Backed by `diaspora_drive_sync_attempts` (ledger #21). The problem it solves is stated in that
 * migration's own comment: without it, a Drive outage is a lost file and a green tick. With it, every
 * export/upload is a row whose state the user can be told the truth about — queued, retrying, or
 * dead-lettered and needing attention.
 *
 * FOUR PROPERTIES, EACH EARNED RATHER THAN ASSERTED
 * -------------------------------------------------
 *  1. IDEMPOTENCY is the database's, not the code's. `uq_diaspora_drive_attempt_idem
 *     (tenant_id, idempotency_key)` means a concurrent duplicate loses the insert race with 23505 and
 *     is then read back — so two simultaneous requests produce one attempt even with no application
 *     lock. Code that merely SELECTed first would have a race window between the check and the write.
 *  2. RETRYABILITY comes from the provider error's own `retryable` flag, not from parsing its message.
 *     A rate limit must back off; a revoked grant must not be retried 5 times before anyone notices.
 *  3. BACKOFF is exponential with full jitter and honours a provider `Retry-After` hint when present.
 *     The jitter source is injectable so tests are exact rather than approximately-probably-right.
 *  4. DEAD-LETTERING is a terminus: `next_attempt_at` is cleared so a dead letter cannot be picked up
 *     again by a drainer, and a CRITICAL audit row records that a user's file did not arrive.
 *
 * Nothing here ever sees token material. Attempts carry an opaque connection id, a content checksum
 * and a sanitized error — and `last_error` is scrubbed through `redactSecretMaterial` on the way in.
 */
import { ValidationError, DatabaseError } from '../../../utils/errors.js';
import { appendCriticalAudit, appendBestEffortAudit } from '../diasporaServiceUtils.js';
import { redactSecretMaterial } from './credentialVault.js';

export const DRIVE_SYNC_ATTEMPTS_TABLE = 'diaspora_drive_sync_attempts';

export const SYNC_ATTEMPT_STATE = Object.freeze({
  PENDING: 'pending',
  IN_FLIGHT: 'in_flight',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  DEAD_LETTERED: 'dead_lettered',
});

export const SYNC_ATTEMPT_OPERATION = Object.freeze({
  ENSURE_FOLDER: 'ensure_folder',
  UPLOAD: 'upload',
  UPDATE: 'update',
  METADATA: 'metadata',
  REVOKE: 'revoke',
});

const VALID_STATES = new Set(Object.values(SYNC_ATTEMPT_STATE));
const VALID_OPERATIONS = new Set(Object.values(SYNC_ATTEMPT_OPERATION));

/** Backoff shape. Overridable per call; the defaults are what production runs. */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 15 * 60 * 1000;
export const MAX_ERROR_LENGTH = 400;

export function maxSyncAttempts() {
  const configured = Number(process.env.DIASPORA_DRIVE_MAX_SYNC_ATTEMPTS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 5;
}

/**
 * Exponential backoff with FULL jitter.
 *
 * Full jitter (a uniform draw over [0, window]) rather than the exponential value itself, because the
 * failure mode this defends against is synchronised retries: every queued upload for a tenant fails
 * at the same moment when Drive rate-limits, and without jitter they all come back at the same moment
 * too, reproducing the overload that caused the failure.
 *
 * @param {number} attempts attempts already made (1 after the first failure)
 * @param {{baseMs?:number, maxMs?:number, jitter?:() => number, retryAfterMs?:number|null}} options
 *   `jitter` returns [0,1); injectable so tests assert exact values.
 */
export function computeBackoffMs(attempts, { baseMs = BACKOFF_BASE_MS, maxMs = BACKOFF_MAX_MS, jitter = Math.random, retryAfterMs = null } = {}) {
  const safeAttempts = Math.max(1, Number(attempts) || 1);
  const window = Math.min(maxMs, baseMs * (2 ** (safeAttempts - 1)));
  const jittered = Math.floor(window * jitter());
  // A provider that told us how long to wait knows better than our curve does.
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.min(maxMs, Math.max(retryAfterMs, jittered));
  return jittered;
}

function sanitizeErrorText(text) {
  if (!text) return null;
  const redacted = redactSecretMaterial(String(text));
  return redacted.length > MAX_ERROR_LENGTH ? `${redacted.slice(0, MAX_ERROR_LENGTH)}…` : redacted;
}

/** Projection for any caller. Carries the truth about state; carries nothing about credentials. */
export function sanitizeSyncAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    operation: row.operation,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    attempts: row.attempts ?? 0,
    nextAttemptAt: row.next_attempt_at || null,
    providerFileId: row.provider_file_id || null,
    providerFolderId: row.provider_folder_id || null,
    bytes: row.bytes ?? null,
    contentChecksum: row.content_checksum || null,
    lastErrorCode: row.last_error_code || null,
    lastError: row.last_error || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
  };
}

async function findByIdempotencyKey(client, tenantId, idempotencyKey) {
  const { data } = await client
    .from(DRIVE_SYNC_ATTEMPTS_TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  return data || null;
}

/**
 * Create (or find) the attempt for an idempotency key.
 *
 * @returns {{attempt:object, idempotentReplay:boolean}}
 */
export async function enqueueSyncAttempt(client, {
  tenantId,
  userId = null,
  connectionId = null,
  operation,
  entityType = null,
  entityId = null,
  idempotencyKey,
  contentChecksum = null,
  metadata = {},
} = {}) {
  if (!tenantId) throw new ValidationError('A tenant context is required to record a Drive sync attempt');
  if (!idempotencyKey) throw new ValidationError('An idempotency key is required to record a Drive sync attempt');
  if (!VALID_OPERATIONS.has(operation)) throw new ValidationError(`Unsupported Drive sync operation: ${operation}`);

  const { data, error } = await client
    .from(DRIVE_SYNC_ATTEMPTS_TABLE)
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      connection_id: connectionId,
      operation,
      entity_type: entityType,
      entity_id: entityId === null || entityId === undefined ? null : String(entityId),
      content_checksum: contentChecksum,
      idempotency_key: String(idempotencyKey),
      state: SYNC_ATTEMPT_STATE.PENDING,
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      metadata: metadata || {},
    })
    .select()
    .single();

  if (error) {
    // 23505 is not a failure — it is the concurrency control working. Read back the winner.
    if (error.code === '23505') {
      const existing = await findByIdempotencyKey(client, tenantId, String(idempotencyKey));
      if (existing) return { attempt: existing, idempotentReplay: true };
    }
    throw new DatabaseError(`Failed to record Drive sync attempt: ${sanitizeErrorText(error.message)}`);
  }
  return { attempt: data, idempotentReplay: false };
}

/**
 * Take ownership of an attempt: pending/failed → in_flight, attempts += 1.
 *
 * The `.in('state', ...)` filter is the lease: a row already `in_flight` or terminal cannot be
 * claimed, so two drainers cannot both deliver the same file.
 */
export async function claimSyncAttempt(client, attemptId, { now = () => new Date() } = {}) {
  const { data: current } = await client.from(DRIVE_SYNC_ATTEMPTS_TABLE).select('*').eq('id', attemptId).maybeSingle();
  if (!current) throw new ValidationError('No such Drive sync attempt');
  if (![SYNC_ATTEMPT_STATE.PENDING, SYNC_ATTEMPT_STATE.FAILED].includes(current.state)) {
    return { attempt: current, claimed: false };
  }
  const { data, error } = await client
    .from(DRIVE_SYNC_ATTEMPTS_TABLE)
    .update({
      state: SYNC_ATTEMPT_STATE.IN_FLIGHT,
      attempts: (current.attempts ?? 0) + 1,
      started_at: now().toISOString(),
      next_attempt_at: null,
    })
    .eq('id', attemptId)
    .in('state', [SYNC_ATTEMPT_STATE.PENDING, SYNC_ATTEMPT_STATE.FAILED])
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Failed to claim Drive sync attempt: ${sanitizeErrorText(error.message)}`);
  if (!data) return { attempt: current, claimed: false }; // lost the race to another drainer
  return { attempt: data, claimed: true };
}

/** Terminal success. */
export async function recordSyncSuccess(client, attemptId, {
  providerFileId = null, providerFolderId = null, bytes = null, contentChecksum = null, now = () => new Date(),
} = {}) {
  const patch = {
    state: SYNC_ATTEMPT_STATE.SUCCEEDED,
    completed_at: now().toISOString(),
    next_attempt_at: null,
    last_error_code: null,
    last_error: null,
  };
  if (providerFileId !== null) patch.provider_file_id = providerFileId;
  if (providerFolderId !== null) patch.provider_folder_id = providerFolderId;
  if (bytes !== null) patch.bytes = bytes;
  if (contentChecksum !== null) patch.content_checksum = contentChecksum;
  const { data, error } = await client.from(DRIVE_SYNC_ATTEMPTS_TABLE).update(patch).eq('id', attemptId).select().maybeSingle();
  if (error) throw new DatabaseError(`Failed to record Drive sync success: ${sanitizeErrorText(error.message)}`);
  return data || null;
}

/**
 * Record a failure and decide the attempt's fate.
 *
 * Three outcomes, and the difference between them is the whole point of the table:
 *   - retryable and under the ceiling  → `failed` + a future `next_attempt_at`
 *   - NOT retryable (revoked, quota, bad scope) → `dead_lettered` immediately; retrying cannot help
 *   - retryable but at the ceiling      → `dead_lettered`
 */
export async function recordSyncFailure(client, attemptId, {
  error,
  maxAttempts = maxSyncAttempts(),
  now = () => new Date(),
  jitter = Math.random,
  baseMs = BACKOFF_BASE_MS,
  maxMs = BACKOFF_MAX_MS,
  auditContext = null,
} = {}) {
  const { data: current } = await client.from(DRIVE_SYNC_ATTEMPTS_TABLE).select('*').eq('id', attemptId).maybeSingle();
  if (!current) throw new ValidationError('No such Drive sync attempt');

  const attempts = current.attempts ?? 0;
  const retryable = Boolean(error?.retryable);
  const withinCeiling = attempts < maxAttempts;
  const deadLetter = !retryable || !withinCeiling;

  const patch = {
    last_error_code: String(error?.code || 'DRIVE_PROVIDER_ERROR').slice(0, 64),
    last_error: sanitizeErrorText(error?.message),
  };
  if (deadLetter) {
    patch.state = SYNC_ATTEMPT_STATE.DEAD_LETTERED;
    // A dead letter must never be picked up again — clearing the schedule is what makes it terminal.
    patch.next_attempt_at = null;
    patch.completed_at = now().toISOString();
  } else {
    patch.state = SYNC_ATTEMPT_STATE.FAILED;
    patch.next_attempt_at = new Date(now().getTime() + computeBackoffMs(attempts, {
      baseMs, maxMs, jitter, retryAfterMs: error?.retryAfterMs ?? null,
    })).toISOString();
  }

  const { data, error: dbError } = await client.from(DRIVE_SYNC_ATTEMPTS_TABLE).update(patch).eq('id', attemptId).select().maybeSingle();
  if (dbError) throw new DatabaseError(`Failed to record Drive sync failure: ${sanitizeErrorText(dbError.message)}`);

  if (deadLetter && auditContext) {
    // A user's file did not arrive and will not be retried. That is exactly the class of event the
    // CRITICAL audit trail exists for, so this write is fail-loud rather than best effort.
    await appendCriticalAudit(client, {
      actorId: auditContext.actorId || null,
      tenantId: current.tenant_id,
      action: 'DRIVE_SYNC_DEAD_LETTERED',
      resourceType: 'diaspora_drive_sync_attempt',
      resourceId: attemptId,
      metadata: {
        operation: current.operation,
        entityType: current.entity_type,
        entityId: current.entity_id,
        attempts: current.attempts,
        errorCode: patch.last_error_code,
        retryable,
      },
    });
  }
  return data || null;
}

/** Attempts that are due for another try, oldest first. */
export async function listDueSyncAttempts(client, { tenantId = null, now = new Date(), limit = 25 } = {}) {
  let query = client.from(DRIVE_SYNC_ATTEMPTS_TABLE).select('*').in('state', [SYNC_ATTEMPT_STATE.PENDING, SYNC_ATTEMPT_STATE.FAILED]);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data } = await query.order('created_at', { ascending: true });
  const due = (data || []).filter((row) => !row.next_attempt_at || Date.parse(row.next_attempt_at) <= now.getTime());
  return due.slice(0, limit);
}

/** Everything recorded for one entity, newest first — what an operator console reads. */
export async function listSyncAttemptsForEntity(client, { tenantId, entityType, entityId }) {
  const { data } = await client
    .from(DRIVE_SYNC_ATTEMPTS_TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('entity_type', entityType)
    .eq('entity_id', String(entityId))
    .order('created_at', { ascending: false });
  return (data || []).map(sanitizeSyncAttempt);
}

/**
 * Run one Drive operation under durable tracking.
 *
 * `execute()` performs the actual provider call and returns `{ providerFileId?, providerFolderId?,
 * bytes?, contentChecksum?, result }`. This function owns enqueue → claim → settle so no caller can
 * forget half of it.
 *
 * An already-succeeded attempt short-circuits: the operation is NOT performed again and the recorded
 * outcome is returned. That is what makes a retried HTTP request safe.
 */
export async function runSyncAttempt(client, descriptor, execute, options = {}) {
  const { attempt, idempotentReplay } = await enqueueSyncAttempt(client, descriptor);

  if (attempt.state === SYNC_ATTEMPT_STATE.SUCCEEDED) {
    return { attempt: sanitizeSyncAttempt(attempt), idempotentReplay: true, replayed: true, result: null };
  }
  if (attempt.state === SYNC_ATTEMPT_STATE.IN_FLIGHT) {
    // Another worker holds the lease. Reporting "in flight" is the truthful answer; claiming success
    // would be a lie and re-running it would double-deliver.
    throw new ValidationError('This Drive operation is already in progress. Try again shortly.');
  }
  if (attempt.state === SYNC_ATTEMPT_STATE.DEAD_LETTERED) {
    throw new ValidationError('This Drive operation previously failed permanently and will not be retried automatically.');
  }

  const claim = await claimSyncAttempt(client, attempt.id, options);
  if (!claim.claimed) {
    throw new ValidationError('This Drive operation is already in progress. Try again shortly.');
  }

  try {
    const outcome = await execute(claim.attempt);
    const settled = await recordSyncSuccess(client, attempt.id, {
      providerFileId: outcome?.providerFileId ?? null,
      providerFolderId: outcome?.providerFolderId ?? null,
      bytes: outcome?.bytes ?? null,
      contentChecksum: outcome?.contentChecksum ?? null,
      now: options.now,
    });
    if (options.auditContext) {
      await appendBestEffortAudit(client, {
        actorId: options.auditContext.actorId || null,
        tenantId: descriptor.tenantId,
        action: 'DRIVE_SYNC_ATTEMPT_SUCCEEDED',
        resourceType: 'diaspora_drive_sync_attempt',
        resourceId: attempt.id,
        metadata: { operation: descriptor.operation, entityType: descriptor.entityType, entityId: descriptor.entityId },
      });
    }
    return { attempt: sanitizeSyncAttempt(settled), idempotentReplay, replayed: false, result: outcome?.result ?? null };
  } catch (err) {
    try {
      await recordSyncFailure(client, attempt.id, { ...options, error: err });
    } catch (bookkeepingError) {
      // Never let bookkeeping replace the real diagnosis; surface both.
      err.bookkeepingError = bookkeepingError.message;
    }
    throw err;
  }
}
