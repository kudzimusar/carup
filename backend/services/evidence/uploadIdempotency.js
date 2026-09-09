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

/** Machine-readable reason for a key reused for a materially different evidence operation. */
export const IDEMPOTENCY_OPERATION_CONFLICT = 'IDEMPOTENCY_KEY_BOUND_TO_DIFFERENT_OPERATION';

/**
 * K2 — THE CANONICAL REQUEST FINGERPRINT.
 *
 * A key scoped to (actor, VIN) still could not tell two different uploads apart: measured, the same
 * actor re-using one key on the same vehicle for `auction_sheet`/checksum B was told `deduped:true`
 * and handed the `registration_book`/checksum A record — the second upload was silently discarded.
 *
 * These are the EXISTING canonical columns the evidence route already writes; no second taxonomy is
 * introduced. Presentation metadata is deliberately excluded — a caption or a note changing does not
 * make it a different upload.
 */
export const OPERATION_IDENTITY_FIELDS = Object.freeze(
  ['evidence_class', 'evidence_subtype', 'evidence_type', 'checksum', 'remote_ref']);

/**
 * M1 — WHEN A CHECKSUM MAY BE BELIEVED.
 *
 * The evidence route computes a checksum ONLY for an inline `req.body.file` (`checksumForBuffer`).
 * For a remote submission the value is whatever the caller put in `checksum`/`image_hash` — an
 * unverified assertion about bytes CarUp has never seen.
 *
 * The L-round let ANY checksum on both sides outrank the object location, so a caller could send
 * the same asserted checksum with a different `file_url` and the second, genuinely different
 * document was discarded. Measured.
 *
 * Content may outrank location only where the server established the content itself. This travels
 * as PROVENANCE rather than being inferred from the presence of a string, and it is recorded in
 * `metadata` — no column, no migration.
 */
export const CHECKSUM_SOURCES = Object.freeze({ SERVER_INLINE: 'server_inline', CLIENT_ASSERTED: 'client_asserted' });

/**
 * Classification is a CONTROLLED VOCABULARY — compared case-insensitively.
 * Content identity is NOT — a storage object key is case-sensitive, and lowercasing one would
 * make two genuinely different objects look identical.
 */
const VOCABULARY_FIELDS = Object.freeze(['evidence_class', 'evidence_subtype', 'evidence_type']);

/** Columns the lookup needs: identity + the key locations. */
const IDENTITY_COLUMNS = 'id, vin, uploaded_by, metadata, evidence_class, evidence_subtype, evidence_type, '
  + 'checksum, storage_bucket, file_path, file_url';

/**
 * L1/M2 — THE STABLE REMOTE REFERENCE.
 *
 * M2: the L-round stripped every query string from every locator. That is right for a SIGNED
 * storage URL, whose signature and expiry change per issue for the SAME object, and wrong for an
 * arbitrary external URL where the query can be the only thing naming the document — measured,
 * `…/document?id=A` and `…/document?id=B` collapsed to one reference and the second was discarded.
 * The rule now depends on what CarUp actually knows about the locator; see the branches below.
 *
 * The canonical evidence route computes a checksum only for an INLINE file. A remote submission —
 * which is exactly what the workbook evidence path sends: `file_url`, classification, MIME and a
 * key, with no checksum — legitimately stores `checksum = NULL`. So the K-round fingerprint could
 * not tell two different remote documents apart: measured, the same key with `FILE-B.pdf` was told
 * `deduped:true` and FILE-B was discarded.
 *
 * The reference is the row's own STORAGE IDENTITY, which CarUp already writes: `file_path` (the
 * object key, which the route defaults to the URL) qualified by `storage_bucket`. Nothing is
 * fetched, so no URL is ever dereferenced and no SSRF surface is created.
 *
 * A signed URL's query string carries a signature and an expiry that change on every issue for the
 * SAME object, so it is stripped — otherwise a legitimate retry would look like a different file.
 * Case is preserved: object keys are case-sensitive.
 */
export function deriveRemoteReference(row = {}) {
  const bucket = row.storage_bucket == null ? '' : String(row.storage_bucket).trim();
  const rawPath = row.file_path == null ? '' : String(row.file_path).trim();
  const rawUrl = row.file_url == null ? '' : String(row.file_url).trim();
  const locator = rawPath || rawUrl;
  if (locator === '') return null;

  // The fragment is dropped in every case, deliberately: `#page=2` addresses a position inside an
  // already-retrieved document on the client, and never selects a different resource.
  const dropFragment = (v) => v.split('#')[0];

  // (1) A storage-relative object key — the strongest identity CarUp has. Verbatim, case-sensitive.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(locator)) {
    const key = dropFragment(locator);
    return key === '' ? null : (bucket ? `${bucket}/${key}` : key);
  }

  const withoutFragment = dropFragment(locator);

  // (2) A recognised storage URL: the object key is in the PATH, derivable with no network call,
  //     so the transient signature/expiry query is dropped.
  const storage = withoutFragment.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/);
  if (storage) {
    const [, urlBucket, key] = storage;
    return `${bucket || urlBucket}/${key}`;
  }

  // (3) Any other URL is OPAQUE. Its query may be the only thing naming the document
  //     (`…/document?id=A` vs `?id=B`), so it is kept in full rather than discarded.
  return withoutFragment;
}

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

  // 1) CANONICAL: the indexed column, with the historical metadata mirror as an alternative.
  const canonical = await runLookup(supabase, idempotencyKey, actorId, { withColumn: true });
  if (!canonical.failed) return canonical.record;

  // 2) K1 — PRE-MIGRATION COMPATIBILITY, AND NOTHING ELSE.
  //
  // The migration is applied separately, so this code runs against databases that do not yet have
  // `idempotency_key`. Naming an absent column makes PostgREST fail the whole SELECT, so the
  // canonical read returned nothing and the durable metadata dedupe that existed BEFORE the column
  // was authored stopped working: measured on a pre-migration database, a retry after a process
  // restart created a SECOND evidence row for one operation. On Vercel that is one cold start.
  //
  // This retry fires for exactly one condition — the column does not exist. An RLS refusal, an
  // auth failure, a malformed filter, a network fault, an FK error or any other database error
  // returns null (treat as new) exactly as before, and never reaches the compatibility read.
  if (!isUndefinedColumnError(canonical.error, 'idempotency_key')) return null;
  const legacy = await runLookup(supabase, idempotencyKey, actorId, { withColumn: false });
  return legacy.failed ? null : legacy.record;
}

/**
 * One lookup attempt. `withColumn:false` names NO column the pre-migration schema lacks — it reads
 * the metadata mirror only. Returns `{ failed, error, record }` so the caller can tell "no match"
 * (a legitimate miss) from "the query itself failed" (which may deserve the compatibility read).
 */
async function runLookup(supabase, idempotencyKey, actorId, { withColumn }) {
  try {
    let q = supabase
      .from('vehicle_evidence')
      .select(withColumn ? `${IDENTITY_COLUMNS}, idempotency_key` : IDENTITY_COLUMNS)
      .eq('uploaded_by', actorId);
    q = withColumn
      ? q.or(`idempotency_key.eq.${idempotencyKey},metadata->>idempotency_key.eq.${idempotencyKey}`)
      : q.eq('metadata->>idempotency_key', idempotencyKey);
    const { data, error } = await q.limit(1);
    if (error) return { failed: true, error, record: null };

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const match = rows.find((r) => {
      if (!r) return false;
      // Belt-and-braces: never accept a row outside this actor's scope.
      if (r.uploaded_by != null && r.uploaded_by !== actorId) return false;
      return r.metadata?.idempotency_key === idempotencyKey
        || (withColumn && r.idempotency_key === idempotencyKey);
    });
    if (!match || !match.id) return { failed: false, error: null, record: null };
    return {
      failed: false,
      error: null,
      record: {
        evidenceId: match.id,
        vin: match.vin ?? null,
        operation: {
          evidence_class: match.evidence_class ?? null,
          evidence_subtype: match.evidence_subtype ?? null,
          evidence_type: match.evidence_type ?? null,
          checksum: match.checksum ?? null,
          // M1 — provenance travels in metadata (no column, no migration). A row written before
          // this existed has none, and is therefore treated as unverified.
          checksum_source: match.metadata?.checksum_source ?? null,
          remote_ref: deriveRemoteReference(match),
        },
      },
    };
  } catch (error) {
    return { failed: true, error, record: null };
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

const normVocab = (v) => (v == null || v === '' ? null : String(v).trim().toLowerCase());
/** Content identity keeps its case — an object key is case-sensitive. */
const normExact = (v) => (v == null || v === '' ? null : String(v).trim());
const normField = (field, v) => (VOCABULARY_FIELDS.includes(field) ? normVocab(v) : normExact(v));

/**
 * K2 — is the stored record the SAME evidence operation the caller is asking for?
 *
 * Returns the first canonical field that DISAGREES, or null when nothing contradicts.
 *
 * COMPATIBILITY RULE, stated explicitly because it is a deliberate weakening: a field is compared
 * only when BOTH sides supply it. A historical row written before a column was populated cannot
 * contradict anything, so it does not raise a conflict — refusing every such retry would break the
 * durable sequential guarantee K1 exists to preserve. The floor is therefore the J-round's
 * VIN-scoped behaviour, never worse; every field either side actually supplies makes it stricter.
 * A field we CAN compare and that differs is always a conflict — we never return a record we can
 * prove is a different upload.
 */
function operationMismatch(hitOperation, requestedOperation) {
  if (!hitOperation || !requestedOperation) return null;

  // L1/M1 — CONTENT IDENTITY OUTRANKS LOCATION, BUT ONLY WHERE IT IS ACTUALLY KNOWN. The same
  // document re-uploaded to a new object key is the same evidence, so a VERIFIED checksum on both
  // sides must not let a differing `remote_ref` manufacture a conflict. But a checksum merely
  // supplied beside a remote URL is a caller's claim, not knowledge.
  // M1: both sides must be SERVER-COMPUTED. A historical row carries no provenance and is
  // therefore not trusted here — the conservative direction, which compares the location instead.
  const verified = (op) => normExact(op?.checksum) !== null
    && op?.checksum_source === CHECKSUM_SOURCES.SERVER_INLINE;
  const bothChecksumsVerified = verified(hitOperation) && verified(requestedOperation);

  for (const field of OPERATION_IDENTITY_FIELDS) {
    if (field === 'remote_ref' && bothChecksumsVerified) continue;
    const stored = normField(field, hitOperation[field]);
    const asked = normField(field, requestedOperation[field]);
    if (stored === null || asked === null) continue; // cannot contradict
    if (stored !== asked) return { field, stored: hitOperation[field], requested: requestedOperation[field] };
  }
  return null;
}

function operationConflict(idempotencyKey, mismatch) {
  return new ConflictError(
    'This idempotency key was already used for a different evidence upload. Use a new key for a new upload.',
    {
      reason: IDEMPOTENCY_OPERATION_CONFLICT,
      idempotency_key: idempotencyKey,
      field: mismatch.field,
      bound_value: mismatch.stored,
      requested_value: mismatch.requested,
    },
  );
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
 * @param {{ supabase?: any, store?: Map<string, IdempotencyRecord>, actorId?: string|null,
 *           operation?: {evidence_class?:string|null, evidence_subtype?:string|null,
 *                        evidence_type?:string|null, checksum?:string|null}|null }} [opts]
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

  const requestedOperation = opts.operation || null;

  const settle = (hit) => {
    if (!sameResource(hit.vin, vin)) throw scopeConflict(idempotencyKey, hit.vin, vin);
    const mismatch = operationMismatch(hit.operation, requestedOperation);
    if (mismatch) throw operationConflict(idempotencyKey, mismatch);
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
  // The cached entry carries the operation too: a warm cache that stored only the id would skip the
  // K2 comparison entirely and re-open the hole on the fast path.
  store.set(scoped, {
    evidenceId,
    vin: resolvedVin,
    operation: requestedOperation
      ? { ...requestedOperation }
      : Object.fromEntries(OPERATION_IDENTITY_FIELDS.map((f) => [f, (created && created[f]) ?? null])),
  });
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
