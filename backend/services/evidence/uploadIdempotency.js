/**
 * Workstream G — backend upload IDEMPOTENCY guard (NEW service).
 *
 * Problem: a flaky mobile network makes the offline upload queue retry the SAME
 * capture; without a guard the backend would create duplicate `vehicle_evidence`
 * rows (and duplicate AI-analysis runs). This service collapses retries that
 * carry the same `idempotencyKey` to a SINGLE evidence record.
 *
 * Approach (testable NOW, no migration required):
 *   1. An in-memory `Map<idempotencyKey, { evidenceId, vin }>` is the fast path
 *      and the source of truth WITHIN a process. It dedupes concurrent-ish (in
 *      this single-node Express gateway, effectively serial) retries immediately.
 *   2. If a Supabase client is supplied, we ALSO consult/record the mapping in
 *      `vehicle_evidence.metadata->>idempotency_key`. This survives a process
 *      restart and works against the existing in-memory supabase MOCK used by the
 *      test-suite (it only needs `.from().select().eq()...` + the rows the route
 *      already inserts), so no new table/migration is needed to exercise it.
 *
 * Concurrency honesty: step 1 is not atomic across truly parallel Node workers,
 * and step 2's "check-then-create" has a classic TOCTOU race under real
 * concurrency. The single-process Express gateway + the in-memory Map make this
 * safe for the current deployment and fully deterministic for tests, but a
 * PRODUCTION-grade version wants a dedicated, UNIQUE-constrained table
 * (`evidence_upload_idempotency`) so the database rejects the duplicate. The
 * suggested migration SQL is provided in the agent RETURN (not created here,
 * because this workstream must not add a migration).
 *
 * @typedef {Object} IdempotencyRecord
 * @property {string} evidenceId
 * @property {string|null} vin
 */

/** Process-local mapping: idempotencyKey -> { evidenceId, vin }. */
const inMemoryStore = new Map();

/**
 * Look up a prior evidence id for this key via the Supabase metadata column.
 * Returns null on any miss/error (errors are swallowed — a lookup failure must
 * degrade to "treat as new", never block the upload). Tolerant of both a shaped
 * `metadata.idempotency_key` and a top-level `idempotency_key` column so it works
 * whether the row stores the key in metadata (route default) or a real column.
 *
 * @param {*} supabase  Supabase-like client (real or in-memory mock) or null.
 * @param {string} idempotencyKey
 * @returns {Promise<IdempotencyRecord|null>}
 */
export async function lookupBySupabase(supabase, idempotencyKey) {
  if (!supabase || typeof supabase.from !== 'function') return null;
  try {
    const { data, error } = await supabase
      .from('vehicle_evidence')
      .select('id, vin, metadata, idempotency_key')
      // The COLUMN is canonical; `metadata` remains a compatibility mirror so rows written
      // before the column existed are still found by the same lookup.
      .or(`idempotency_key.eq.${idempotencyKey},metadata->>idempotency_key.eq.${idempotencyKey}`)
      .limit(1);

    if (error) return null;
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const match = rows.find((r) => {
      const fromMeta = r && r.metadata && r.metadata.idempotency_key;
      const fromCol = r && r.idempotency_key;
      return fromMeta === idempotencyKey || fromCol === idempotencyKey;
    });
    if (!match || !match.id) return null;
    return { evidenceId: match.id, vin: match.vin ?? null };
  } catch {
    return null;
  }
}

/**
 * Idempotent evidence creation.
 *
 * Given an `idempotencyKey`, returns an existing evidence id when the same key
 * was already used; otherwise invokes `createFn()` exactly once, records the
 * mapping (in-memory + best-effort Supabase metadata), and returns the new id.
 *
 * `createFn` MUST return the created evidence record (object with `.id`) or the
 * id string. It is the caller's job to ensure the row it creates carries
 * `metadata.idempotency_key === idempotencyKey` so the Supabase fallback can find
 * it after a restart (the wiring snippet in the RETURN does exactly that).
 *
 * If `idempotencyKey` is falsy, dedupe is SKIPPED and `createFn` is always run —
 * an upload without a client-supplied key is treated as unique (fail-open, never
 * blocks a legitimate upload that simply didn't send a key).
 *
 * @param {string|null|undefined} idempotencyKey
 * @param {string|null} vin
 * @param {() => Promise<{id:string}|string>} createFn
 * @param {{ supabase?: any, store?: Map<string, IdempotencyRecord> }} [opts]
 * @returns {Promise<{ evidenceId:string, vin:(string|null), deduped:boolean }>}
 */
/** The one index that expresses upload idempotency. Named once, used everywhere. */
export const IDEMPOTENCY_CONSTRAINT = 'uq_vehicle_evidence_idempotency_key';

/**
 * A unique violation on THE IDEMPOTENCY INDEX specifically — not any unique violation.
 *
 * I-1: treating every 23505 in the evidence write path as "someone else already created this"
 * would convert an unrelated constraint failure into a silent success and hand the caller
 * another row's id. Only this index means "a concurrent request won the same key"; every other
 * unique failure, and every FK, RLS or validation error, must propagate untouched.
 */
export function isIdempotencyUniqueViolation(error) {
  const code = error?.code || error?.cause?.code || null;
  if (code !== '23505') return false;
  const constraint = error?.constraint || error?.cause?.constraint || null;
  if (constraint) return constraint === IDEMPOTENCY_CONSTRAINT;
  // Supabase/PostgREST does not always surface `constraint`; the message names the index.
  const message = String(error?.message || error?.details || '');
  return message.includes(IDEMPOTENCY_CONSTRAINT);
}

/**
 * PostgreSQL 42703 — the column does not exist.
 *
 * Used for exactly one thing: letting the writer fall back to the pre-migration shape while the
 * additive migration has not yet been applied. Deliberately narrow, and never a general retry.
 */
export function isUndefinedColumnError(error, columnName) {
  const code = error?.code || error?.cause?.code || null;
  const message = String(error?.message || error?.details || '');
  if (code === '42703') return !columnName || message.includes(columnName);
  return /column .* does not exist|could not find the .* column/i.test(message)
    && (!columnName || message.includes(columnName));
}

export async function withUploadIdempotency(idempotencyKey, vin, createFn, opts = {}) {
  if (typeof createFn !== 'function') {
    throw new Error('withUploadIdempotency requires a createFn');
  }

  const store = opts.store || inMemoryStore;
  const supabase = opts.supabase || null;

  // No key supplied → cannot dedupe; treat as a fresh upload (fail-open).
  if (!idempotencyKey) {
    const created = await createFn();
    const evidenceId = typeof created === 'string' ? created : created?.id;
    return { evidenceId, vin: vin ?? null, deduped: false };
  }

  // 1) Fast path: process-local map.
  if (store.has(idempotencyKey)) {
    const hit = store.get(idempotencyKey);
    return { evidenceId: hit.evidenceId, vin: hit.vin ?? vin ?? null, deduped: true };
  }

  // 2) Durable-ish path: Supabase metadata lookup (survives restart; works with mock).
  const priorRemote = await lookupBySupabase(supabase, idempotencyKey);
  if (priorRemote) {
    store.set(idempotencyKey, priorRemote); // warm the cache
    return { evidenceId: priorRemote.evidenceId, vin: priorRemote.vin ?? vin ?? null, deduped: true };
  }

  // 3) Miss → create. The two steps above are a CHECK; this is the ACT, and between them another
  //    worker can win. That race cannot be closed in this process, so the database settles it:
  //    `uq_vehicle_evidence_idempotency_key` is a partial unique index on the supplied key, and a
  //    unique violation here means a concurrent request already created this exact evidence. We
  //    then read the winner back and report `deduped`, exactly as the sequential path does — one
  //    evidence effect for one key, whichever request got there first.
  let created;
  try {
    created = await createFn();
  } catch (error) {
    if (isIdempotencyUniqueViolation(error)) {
      const winner = await lookupBySupabase(supabase, idempotencyKey);
      if (winner) {
        store.set(idempotencyKey, winner);
        return { evidenceId: winner.evidenceId, vin: winner.vin ?? vin ?? null, deduped: true };
      }
    }
    throw error;
  }
  const evidenceId = typeof created === 'string' ? created : created?.id;
  if (!evidenceId) {
    throw new Error('createFn did not return an evidence id');
  }
  const resolvedVin = (created && created.vin) || vin || null;
  store.set(idempotencyKey, { evidenceId, vin: resolvedVin });
  return { evidenceId, vin: resolvedVin, deduped: false };
}

/** Test/util: clear the process-local mapping. */
export function __clearUploadIdempotencyStore() {
  inMemoryStore.clear();
}

/** Test/util: read the process-local mapping size. */
export function __uploadIdempotencyStoreSize() {
  return inMemoryStore.size;
}
