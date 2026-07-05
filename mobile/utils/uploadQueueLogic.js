/**
 * Workstream G — PURE upload-queue logic (no React Native, no Zustand, no I/O).
 *
 * Why a plain `.js` (with JSDoc types) instead of `.ts`:
 *   `node --test` (backend/tests) cannot import a `.ts` module directly (no TS
 *   loader is wired in the backend), and the queue logic MUST be tested in a
 *   runtime that actually executes. Keeping these as dependency-free JS lets
 *   BOTH harnesses consume them unchanged:
 *     - backend/tests/upload-queue-logic.test.js  (node --test)
 *     - mobile/tests/upload-queue-logic.test.ts   (npx tsx, mirrors repo style)
 *   `mobile/store/uploadQueueStore.ts` imports these same functions, so the
 *   store and the tests share ONE source of truth for the durable invariants.
 *
 * Everything here is a pure function of its inputs (the only impurity allowed is
 * the caller passing an explicit `now` epoch-ms — never read from the clock here),
 * which is what makes it unit-testable without a device.
 *
 * @typedef {'queued'|'uploading'|'uploaded'|'failed'|'cancelled'} QueueItemStatus
 *
 * @typedef {Object} QueueItem
 * @property {string} localId            Client-generated stable id for this queue row.
 * @property {string} userId             Owning user (account-isolation key, part 1).
 * @property {string} tenantId           Owning tenant (account-isolation key, part 2).
 * @property {string} vin                Vehicle the evidence belongs to.
 * @property {string} evidenceType       e.g. 'odometer_photo', 'registration_document'.
 * @property {string} localFileRef       On-device file URI / ref (NOT the bytes).
 * @property {string} checksum           sha256 (or equivalent) of the captured file.
 * @property {number} pageOrder          Ordering within a multi-page document.
 * @property {string} idempotencyKey     Stable dedupe key (see computeIdempotencyKey).
 * @property {number} createdAt          Epoch ms when first enqueued.
 * @property {number} retryCount         How many upload attempts have failed.
 * @property {string|null} lastError     Last failure message (diagnostics only).
 * @property {number|null} nextRetryAt   Epoch ms before which the item is NOT ready.
 * @property {QueueItemStatus} status    Lifecycle state.
 * @property {string|null} backendEvidenceId  Server evidence id once uploaded.
 */

/**
 * Exponential-backoff defaults. base*2^retryCount, capped, so a permanently
 * failing item can never schedule itself further than MAX_BACKOFF_MS away and a
 * flapping network can never produce an unbounded retry delay.
 */
export const DEFAULT_BASE_BACKOFF_MS = 5_000; // 5s
export const DEFAULT_MAX_BACKOFF_MS = 60 * 60 * 1000; // 1h cap

/**
 * FNV-1a 32-bit hash → 8-char hex. Tiny, dependency-free, and deterministic
 * across JS engines (no reliance on Node's `crypto`, which RN lacks). Used only
 * to derive a stable, collision-resistant idempotency key — NOT for security.
 * @param {string} str
 * @returns {string} 8-char lowercase hex
 */
export function fnv1a32Hex(str) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in uint32 range with >>> 0.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute a STABLE idempotency key from the identity of the capture. The same
 * (userId, vin, evidenceType, checksum) capture ALWAYS yields the same key, so
 * re-enqueuing the identical photo cannot create a second queue row, and the
 * backend can collapse a double-submit to one evidence record. Fields are joined
 * with a delimiter that is escaped out of the inputs so distinct inputs can never
 * alias into the same joined string (e.g. 'a|b' + 'c' vs 'a' + 'b|c').
 *
 * @param {{userId:string, vin:string, evidenceType:string, checksum:string}} parts
 * @returns {string} idempotency key, e.g. 'uq_1f3a9c2b_<userId>_<vin>'
 */
export function computeIdempotencyKey({ userId, vin, evidenceType, checksum }) {
  const safe = (v) => String(v ?? '').replace(/\|/g, '%7C');
  const canonical = [safe(userId), safe(vin), safe(evidenceType), safe(checksum)].join('|');
  const digest = fnv1a32Hex(canonical);
  // Prefix the digest with userId+vin so two different users colliding on the
  // 32-bit digest still produce different keys, and the key is human-greppable.
  return `uq_${digest}_${safe(userId)}_${safe(vin)}`;
}

/**
 * Exponential backoff with a hard cap. nextRetryAt = now + base*2^retryCount,
 * clamped to [0, maxMs]. retryCount is treated as a non-negative integer; the
 * 2^retryCount term is computed so it cannot overflow into Infinity before the
 * cap is applied.
 *
 * @param {number} retryCount  Number of prior failures (0 ⇒ first retry).
 * @param {number} [now]       Epoch ms (defaults to Date.now()).
 * @param {number} [baseMs]
 * @param {number} [maxMs]
 * @returns {number} epoch-ms timestamp at which the item becomes retry-ready.
 */
export function nextBackoffMs(
  retryCount,
  now = Date.now(),
  baseMs = DEFAULT_BASE_BACKOFF_MS,
  maxMs = DEFAULT_MAX_BACKOFF_MS,
) {
  const n = Math.max(0, Math.floor(Number(retryCount) || 0));
  // Cap the exponent so 2^exp stays finite; anything past the cap is clamped anyway.
  const cappedExp = Math.min(n, 30);
  const raw = baseMs * Math.pow(2, cappedExp);
  const delay = Math.min(Math.max(0, raw), maxMs);
  return now + delay;
}

const READY_STATUSES = new Set(['queued', 'failed']);

/**
 * Select the items that are eligible to be (re)uploaded right now: status in
 * {queued, failed} AND (no scheduled nextRetryAt OR nextRetryAt <= now). Items
 * that are uploading/uploaded/cancelled are never returned. Pure: it neither
 * mutates nor reads the clock itself.
 *
 * @template {{status:string, nextRetryAt:(number|null|undefined)}} T
 * @param {T[]} items
 * @param {number} [now] Epoch ms (defaults to Date.now()).
 * @returns {T[]} ready items, original order preserved.
 */
export function selectReady(items, now = Date.now()) {
  if (!Array.isArray(items)) return [];
  return items.filter((it) => {
    if (!it || !READY_STATUSES.has(it.status)) return false;
    const at = it.nextRetryAt;
    return at == null || at <= now;
  });
}

/**
 * Account-isolation predicate. An item is "owned" by the active session only if
 * BOTH userId AND tenantId match. This is the guard that guarantees account B can
 * never see account A's queued captures even if a stale persisted blob is loaded.
 *
 * @param {{userId:string, tenantId:string}} item
 * @param {string} userId   Active session user id.
 * @param {string} tenantId Active session tenant id.
 * @returns {boolean}
 */
export function isAccountOwned(item, userId, tenantId) {
  if (!item) return false;
  return item.userId === userId && item.tenantId === tenantId;
}

/**
 * Filter a list down to items owned by the active (userId, tenantId).
 * @template {{userId:string, tenantId:string}} T
 * @param {T[]} items
 * @param {string} userId
 * @param {string} tenantId
 * @returns {T[]}
 */
export function filterOwned(items, userId, tenantId) {
  if (!Array.isArray(items)) return [];
  return items.filter((it) => isAccountOwned(it, userId, tenantId));
}

/**
 * Does the queue already contain a live (non-terminal) item for this idempotency
 * key? Used by enqueue to refuse a duplicate of the SAME capture. 'cancelled' and
 * 'failed' are NOT treated as live blockers here — a failed item is retried via
 * its existing row (the store updates in place), and a cancelled item should be
 * re-enqueueable; the live states are queued/uploading/uploaded.
 *
 * @param {{idempotencyKey:string, status:string}[]} items
 * @param {string} idempotencyKey
 * @returns {boolean}
 */
export function hasLiveItemForKey(items, idempotencyKey) {
  if (!Array.isArray(items)) return false;
  const live = new Set(['queued', 'uploading', 'uploaded']);
  return items.some((it) => it && it.idempotencyKey === idempotencyKey && live.has(it.status));
}
