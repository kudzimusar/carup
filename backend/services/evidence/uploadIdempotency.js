/**
 * Backend evidence-upload IDEMPOTENCY guard.
 *
 * Problem: a flaky mobile network makes the offline upload queue retry the SAME capture, and a
 * workbook import retries the same row; without a guard the backend creates duplicate
 * `vehicle_evidence` rows (and duplicate AI-analysis runs). This service collapses retries that
 * carry the same client-supplied key to a SINGLE evidence record.
 *
 * ARCHITECTURE AS IT NOW STANDS (this comment described an earlier, weaker design for three
 * rounds after that design was replaced; it is the current one):
 *
 *   1. `vehicle_evidence.idempotency_key` is a REAL COLUMN, and
 *      `uq_vehicle_evidence_idempotency_key` is a partial unique index on
 *      **(uploaded_by, idempotency_key)**. The database — not this process — is what settles a
 *      concurrent race. Added by
 *      `database/migrations/20260908120000_vehicle_evidence_upload_idempotency.sql`.
 *   2. `metadata->>idempotency_key` is a COMPATIBILITY MIRROR, not an authority. Rows written
 *      before the column existed are still found by the same lookup; nothing is read from metadata
 *      in preference to the column, and metadata enforces nothing.
 *   3. The in-memory map is a per-process FAST PATH only. It is scoped by actor exactly as the
 *      index is, so it can never collapse two different actors' uploads.
 *
 * MIGRATION GATE — the column and index are additive and are applied SEPARATELY. Until that
 * migration is applied to a given deployment, the writer degrades to the pre-migration shape
 * (PostgreSQL 42703) and database-enforced concurrent deduplication is simply UNAVAILABLE there.
 * Sequential dedupe still works via the lookup. No deployment may be described as having the
 * concurrency guarantee until its migration is applied and independently verified.
 *
 * COLLISION DOMAIN — the key is scoped to `(actor, key)` and BOUND to the resource it was first
 * used for. The endpoint accepts a client-supplied key, so a global namespace would let one
 * actor's raw string decide another's upload. Reusing a key for a different vehicle is an explicit
 * conflict, never a silent dedupe that returns the other vehicle's evidence.
 *
 * @typedef {Object} IdempotencyRecord
 * @property {string} evidenceId
 * @property {string|null} vin
 */
import { ConflictError, DatabaseError } from '../../utils/errors.js';

/** Process-local mapping, keyed by `idempotencyScopeKey(actorId, key)`. */
const inMemoryStore = new Map();

/** The one index that expresses upload idempotency. Named once, used everywhere. */
export const IDEMPOTENCY_CONSTRAINT = 'uq_vehicle_evidence_idempotency_key';

/** Machine-readable reason for a key reused against a different resource. */
export const IDEMPOTENCY_SCOPE_CONFLICT = 'IDEMPOTENCY_KEY_BOUND_TO_DIFFERENT_RESOURCE';

/**
 * The scope key. A client-supplied idempotency key is meaningless on its own — it only identifies
 * an operation WITHIN the actor that supplied it, which is exactly what the unique index encodes.
 */
export function idempotencyScopeKey(actorId, idempotencyKey) {
  // An explicit NUL separator: it cannot occur in a user id or a client key, so two
  // different (actor, key) pairs can never collide into one cache entry.
  return `${actorId ?? ''}\u0000${idempotencyKey}`;
}

/**
 * CarUp's public database error, WITHOUT destroying the native PostgreSQL identity.
 *
 * The route used to do `throw new DatabaseError(insertError.message)`. `DatabaseError` sets
 * `.code = 'DATABASE_ERROR'`, so the native `23505` and the constraint name were gone before
 * `isIdempotencyUniqueViolation` ever ran: the loser of a genuine race received a 500 instead of
 * the winner's evidence id. Measured on real PostgreSQL — the earlier concurrency proof passed
 * only because its test writer threw the RAW driver error, which the deployed path never does.
 *
 * The native error is preserved as a NON-ENUMERABLE `cause`, so the idempotency layer can identify
 * its own constraint while the serialized public error is byte-for-byte what it always was.
 */
export function toDatabaseError(error) {
  const err = new DatabaseError(error?.message || 'Database query failed');
  Object.defineProperty(err, 'cause', { value: error, enumerable: false, configurable: true, writable: true });
  return err;
}

/**
 * A unique violation on THE IDEMPOTENCY INDEX specifically — not any unique violation.
 *
 * Treating every 23505 in the evidence write path as "someone else already created this" would
 * convert an unrelated constraint failure into a silent success and hand the caller another row's
 * id. Only this index means "a concurrent request won the same key"; every other unique failure,
 * and every FK, RLS or validation error, must propagate untouched.
 *
 * A NATIVE 23505 is required. A `DatabaseError` whose message merely mentions the index — with no
 * native code behind it — is deliberately NOT accepted: that is the shape a lossy translation
 * produces, and accepting it would re-open the hole this guard exists to close.
 */
export function isIdempotencyUniqueViolation(error) {
  // Read BOTH levels rather than `error.code || error.cause.code`: the wrapper's own code is the
  // truthy string 'DATABASE_ERROR', so an `||` short-circuits on it and the native code behind it
  // is never consulted — which is precisely how this guard was unreachable in the deployed path.
  const codes = [error?.code, error?.cause?.code].filter(Boolean);
  if (!codes.includes('23505')) return false;
  const constraint = error?.constraint || error?.cause?.constraint || null;
  if (constraint) return constraint === IDEMPOTENCY_CONSTRAINT;
  // Supabase/PostgREST does not always surface `constraint`; the message names the index.
  const message = String(error?.message || error?.cause?.message || error?.details || '');
  return message.includes(IDEMPOTENCY_CONSTRAINT);
}

/**
 * PostgreSQL 42703 — the column does not exist.
 *
 * Used for exactly one thing: letting the writer fall back to the pre-migration shape while the
 * additive migration has not yet been applied. Deliberately narrow, and never a general retry.
 */
export function isUndefinedColumnError(error, columnName) {
  const codes = [error?.code, error?.cause?.code].filter(Boolean);
  const message = String(error?.message || error?.cause?.message || error?.details || '');
  if (codes.includes('42703')) return !columnName || message.includes(columnName);
  return /column .* does not exist|could not find the .* column/i.test(message)
    && (!columnName || message.includes(columnName));
}

/**
 * Look up a prior evidence id for this key, WITHIN THIS ACTOR'S NAMESPACE.
 *
 * The actor scope is not an optimisation: an unscoped lookup returns whichever row in the whole
 * table happens to carry the string, which is how one actor's key came to suppress another's
 * upload and leak that other row's id and VIN back to them.
 *
 * Returns null on any miss/error — a lookup failure must degrade to "treat as new", never block a
 * legitimate upload. Tolerant of both the canonical column and the historical `metadata` mirror.
 *
 * @param {*} supabase  Supabase-like client (real or in-memory mock) or null.
 * @param {string} idempotencyKey
 * @param {{ actorId?: string|null }} [scope]
 * @returns {Promise<IdempotencyRecord|null>}
 */
export async function lookupBySupabase(supabase, idempotencyKey, { actorId = null } = {}) {
  if (!supabase || typeof supabase.from !== 'function') return null;
  if (!actorId) return null; // an unscoped key identifies nothing safely
  try {
    const { data, error } = await supabase
      .from('vehicle_evidence')
      .select('id, vin, uploaded_by, metadata, idempotency_key')
      .eq('uploaded_by', actorId)
      // The COLUMN is canonical; `metadata` remains a compatibility mirror so rows written
      // before the column existed are still found by the same lookup.
      .or(`idempotency_key.eq.${idempotencyKey},metadata->>idempotency_key.eq.${idempotencyKey}`)
      .limit(1);

    if (error) return null;
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const match = rows.find((r) => {
      if (!r) return false;
      // Belt-and-braces: never accept a row the store/driver returned outside this actor's scope.
      if (r.uploaded_by != null && r.uploaded_by !== actorId) return false;
      return r.metadata?.idempotency_key === idempotencyKey || r.idempotency_key === idempotencyKey;
    });
    if (!match || !match.id) return null;
    return { evidenceId: match.id, vin: match.vin ?? null };
  } catch {
    return null;
  }
}

/**
 * A key already bound to a different vehicle is a client error, not a duplicate.
 *
 * Silently returning the first VIN's evidence would tell the caller their upload succeeded while
 * discarding it, and would hand them a record for a vehicle they did not ask about.
 */
function scopeConflict(idempotencyKey, existingVin, requestedVin) {
  return new ConflictError(
    'This idempotency key was already used for a different vehicle. Use a new key for a new upload.',
    { reason: IDEMPOTENCY_SCOPE_CONFLICT, idempotency_key: idempotencyKey, bound_vin: existingVin, requested_vin: requestedVin },
  );
}

/** True when a durable/cached hit refers to the same resource the caller is uploading for. */
function sameResource(hitVin, requestedVin) {
  if (!requestedVin || !hitVin) return true; // nothing to contradict
  return String(hitVin) === String(requestedVin);
}

/**
 * Idempotent evidence creation.
 *
 * Given an `idempotencyKey` and the acting `actorId`, returns the existing evidence id when THIS
 * ACTOR already used that key for THIS vehicle; otherwise invokes `createFn()` exactly once and
 * records the mapping.
 *
 * `createFn` MUST return the created evidence record (object with `.id`) or the id string, and the
 * row it creates must carry both `idempotency_key` (canonical) and `metadata.idempotency_key`
 * (compatibility mirror).
 *
 * Dedupe is SKIPPED — `createFn` always runs — when either the key or the actor is absent. An
 * upload without a key is unique by definition, and a key without an actor has no namespace it
 * could safely be deduplicated within; failing open there creates at worst a duplicate, whereas
 * failing the other way suppresses somebody else's legitimate upload.
 *
 * @param {string|null|undefined} idempotencyKey
 * @param {string|null} vin
 * @param {() => Promise<{id:string}|string>} createFn
 * @param {{ supabase?: any, store?: Map<string, IdempotencyRecord>, actorId?: string|null }} [opts]
 * @returns {Promise<{ evidenceId:string, vin:(string|null), deduped:boolean }>}
 */
export async function withUploadIdempotency(idempotencyKey, vin, createFn, opts = {}) {
  if (typeof createFn !== 'function') {
    throw new Error('withUploadIdempotency requires a createFn');
  }

  const store = opts.store || inMemoryStore;
  const supabase = opts.supabase || null;
  const actorId = opts.actorId ?? null;

  const fresh = async () => {
    const created = await createFn();
    const evidenceId = typeof created === 'string' ? created : created?.id;
    return { created, evidenceId };
  };

  // No key, or no actor to scope it to → cannot dedupe safely; treat as a fresh upload.
  if (!idempotencyKey || !actorId) {
    const { created, evidenceId } = await fresh();
    return { evidenceId, vin: (created && created.vin) || vin || null, deduped: false };
  }

  const scoped = idempotencyScopeKey(actorId, idempotencyKey);

  const settle = (hit) => {
    if (!sameResource(hit.vin, vin)) throw scopeConflict(idempotencyKey, hit.vin, vin);
    return { evidenceId: hit.evidenceId, vin: hit.vin ?? vin ?? null, deduped: true };
  };

  // 1) Fast path: process-local map, scoped exactly as the index is.
  if (store.has(scoped)) return settle(store.get(scoped));

  // 2) Durable path: the indexed column, with the historical metadata mirror as a fallback.
  const priorRemote = await lookupBySupabase(supabase, idempotencyKey, { actorId });
  if (priorRemote) {
    store.set(scoped, priorRemote); // warm the cache
    return settle(priorRemote);
  }

  // 3) Miss → create. The two steps above are a CHECK; this is the ACT, and between them another
  //    worker can win. That race cannot be closed in this process, so the database settles it:
  //    `uq_vehicle_evidence_idempotency_key` is a partial unique index on
  //    (uploaded_by, idempotency_key), and a violation here means a concurrent request by the SAME
  //    actor already created this exact evidence. We read the winner back and report `deduped`,
  //    exactly as the sequential path does — one evidence effect for one key, whoever got there
  //    first. This only works because the writer preserves the native error identity; see
  //    `toDatabaseError`.
  let created;
  try {
    ({ created } = await fresh());
  } catch (error) {
    if (isIdempotencyUniqueViolation(error)) {
      const winner = await lookupBySupabase(supabase, idempotencyKey, { actorId });
      if (winner) {
        store.set(scoped, winner);
        return settle(winner);
      }
    }
    throw error;
  }
  const evidenceId = typeof created === 'string' ? created : created?.id;
  if (!evidenceId) {
    throw new Error('createFn did not return an evidence id');
  }
  const resolvedVin = (created && created.vin) || vin || null;
  store.set(scoped, { evidenceId, vin: resolvedVin });
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
