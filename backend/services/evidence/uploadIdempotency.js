/**
 * Backend evidence-upload IDEMPOTENCY guard.
 *
 * Problem: a flaky mobile network makes the offline upload queue retry the SAME capture; without a
 * guard the backend creates duplicate `vehicle_evidence` rows (and duplicate AI-analysis runs). This
 * service collapses retries that carry the same client-supplied key to a SINGLE evidence record.
 *
 * O2-X5A (bounded port by OC-5C from PR #208 rounds G–M). What changed, and why:
 *
 *   THE KEY IS SCOPED TO THE ACTOR. RC1 keyed its in-memory map by the raw client key and looked the
 *   key up across the whole table, so a SECOND user who sent the same Idempotency-Key was told
 *   `deduped` and handed the FIRST user's evidence row — for any vehicle (#208's J-2 measured it). The
 *   namespace is now (actor, key), exactly as the candidate unique index encodes it; a key without an
 *   actor identifies nothing and is never deduplicated.
 *
 *   THE KEY IS BOUND TO ITS RESOURCE AND ITS OPERATION. The same actor reusing a key for a different
 *   vehicle, or for a materially different upload (another class/subtype/type, other bytes, another
 *   object), is an explicit 409 — never a silent dedupe that discards the second upload.
 *
 *   CONTENT OUTRANKS LOCATION ONLY WHEN CARUP COMPUTED IT, IN THIS REQUEST. An inline retry stores its
 *   bytes at a NEW random path, so its location always differs; its checksum, which the server just
 *   computed from the bytes it holds, decides instead. A checksum a caller merely asserts beside a
 *   remote URL is a claim and never outranks the location. Nothing stored on the earlier row is
 *   consulted for this — #208 trusted a provenance block in client-writable metadata, then an HMAC over
 *   it keyed on the session secret; neither is ported (the provenance authority is
 *   provenanceService's chain, which already records the checksum).
 *
 *   NO FILTER SYNTAX IS BUILT FROM CLIENT INPUT. #208 looked the key up with
 *   `.or(\`idempotency_key.eq.${key},…\`)`, pasting the client's string into PostgREST filter syntax
 *   (a comma or parenthesis in a key added filter terms). The lookup is two parameterized `.eq` reads.
 *
 *   THE DATABASE SETTLES A RACE. Two concurrent first uploads by the same actor can both miss the
 *   lookup. Where the candidate migration
 *   (database/migration-candidates/oc5c/20261004174000_o2_vehicle_evidence_upload_idempotency.sql) is
 *   applied, its partial unique index on (uploaded_by, idempotency_key) rejects the loser, which reads
 *   the winner back. The writer preserves the native error (`toDatabaseError`) so that can be
 *   recognised. Until that candidate is applied somewhere, concurrent dedupe is NOT in force there;
 *   sequential dedupe works through the lookup, and a database without the column falls back to the
 *   metadata mirror (42703 only).
 *
 * @typedef {Object} IdempotencyRecord
 * @property {string} evidenceId
 * @property {string|null} vin
 * @property {Object|null} operation
 */
import { ConflictError, DatabaseError, ValidationError } from '../../utils/errors.js';

/** Process-local mapping, keyed by `idempotencyScopeKey(actorId, key)`. */
const inMemoryStore = new Map();

/** The one index that expresses upload idempotency. Named once, used everywhere. */
export const IDEMPOTENCY_CONSTRAINT = 'uq_vehicle_evidence_idempotency_key';

/** Machine-readable reasons for a key reused against a different resource / operation. */
export const IDEMPOTENCY_SCOPE_CONFLICT = 'IDEMPOTENCY_KEY_BOUND_TO_DIFFERENT_RESOURCE';
export const IDEMPOTENCY_OPERATION_CONFLICT = 'IDEMPOTENCY_KEY_BOUND_TO_DIFFERENT_OPERATION';

/** The canonical columns that identify ONE evidence operation (presentation metadata excluded). */
export const OPERATION_IDENTITY_FIELDS = Object.freeze(
  ['evidence_class', 'evidence_subtype', 'evidence_type', 'checksum', 'remote_ref']);

/** Where THIS request's checksum came from. Decided per request, never read back from a stored row. */
export const CHECKSUM_SOURCES = Object.freeze({ SERVER_INLINE: 'server_inline', CLIENT_ASSERTED: 'client_asserted' });

/** A client key is an opaque token: bounded and printable, never a payload. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
export function normalizeIdempotencyKey(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const key = String(raw).trim();
  if (!key) return null;
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new ValidationError(`An idempotency key must be printable and at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`);
  }
  return key;
}

/** Classification is a CONTROLLED VOCABULARY (case-insensitive); content identity is not. */
const VOCABULARY_FIELDS = Object.freeze(['evidence_class', 'evidence_subtype', 'evidence_type']);

/** Columns the lookup needs: identity + the key locations. */
const IDENTITY_COLUMNS = 'id, vin, uploaded_by, metadata, evidence_class, evidence_subtype, evidence_type, '
  + 'checksum, storage_bucket, file_path, file_url';

/**
 * CarUp's OWN configured storage origin, from the same `SUPABASE_URL` the client is built from. Read
 * at call time. No hard-coded hostname, no network call, no DNS.
 */
export function isTrustedStorageOrigin(url) {
  const configured = process.env.SUPABASE_URL || '';
  if (!configured) return false;
  let origin; let candidate;
  try { origin = new URL(configured).origin; } catch { return false; }
  try { candidate = new URL(url).origin; } catch { return false; }
  return candidate === origin;
}

/**
 * THE STABLE REMOTE REFERENCE of an evidence row: what object it names, derived from what CarUp
 * already stores (`storage_bucket` + `file_path`, or the URL). Nothing is fetched — no SSRF surface.
 *   - a URL on CarUp's own storage origin names its object in the PATH, so the transient signature and
 *     expiry query of a signed URL are dropped (a re-sign is the same object);
 *   - any other URL is OPAQUE: its query may be the only thing naming the document;
 *   - a storage-relative key is used verbatim (object keys are case-sensitive);
 *   - a fragment never selects a different resource and is dropped everywhere.
 */
export function deriveRemoteReference(row = {}) {
  const bucket = row.storage_bucket == null ? '' : String(row.storage_bucket).trim();
  const rawPath = row.file_path == null ? '' : String(row.file_path).trim();
  const rawUrl = row.file_url == null ? '' : String(row.file_url).trim();
  const dropFragment = (v) => v.split('#')[0];
  const isUrl = (v) => /^[a-z][a-z0-9+.-]*:\/\//i.test(v);

  // When there are two locators, the URL decides identity (contradictions are refused up front by
  // assertLocatorConsistency, so reaching here with both set means they agree).
  if (rawUrl !== '' && isUrl(rawUrl)) {
    const withoutFragment = dropFragment(rawUrl);
    if (isTrustedStorageOrigin(withoutFragment)) {
      const storage = withoutFragment.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/);
      if (storage) {
        const [, urlBucket, key] = storage;
        return `${bucket || urlBucket}/${key}`;
      }
    }
    return withoutFragment;
  }
  const key = dropFragment(rawPath || rawUrl);
  if (key === '') return null;
  return bucket ? `${bucket}/${key}` : key;
}

/** The canonical storage key a TRUSTED storage URL names, or null when the URL is not one. */
export function storageKeyFromTrustedUrl(url) {
  const raw = url == null ? '' : String(url).trim().split('#')[0];
  if (raw === '' || !isTrustedStorageOrigin(raw)) return null;
  const m = raw.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/[^/?#]+\/([^?#]+)/);
  return m ? m[1] : null;
}

/**
 * REFUSE CONTRADICTORY DUAL LOCATORS. `file_url` and `file_path` are accepted independently; if they
 * disagree about which object this evidence is, the server cannot answer truthfully. Consistent: only
 * one supplied; both identical; or the path is the object key the TRUSTED storage URL itself names.
 */
export function assertLocatorConsistency({ file_url: fileUrl = null, file_path: filePath = null } = {}) {
  const url = fileUrl == null ? '' : String(fileUrl).trim();
  const path = filePath == null ? '' : String(filePath).trim();
  if (url === '' || path === '') return;
  if (url === path) return;
  const key = storageKeyFromTrustedUrl(url);
  if (key !== null && (key === path || key.endsWith(`/${path}`) || path.endsWith(`/${key}`))) return;
  throw new ValidationError(
    'file_url and file_path describe different objects. Supply one locator, or a storage path that matches the storage URL it accompanies.',
  );
}

/** The scope key: a client key only identifies an operation WITHIN the actor that supplied it. */
export function idempotencyScopeKey(actorId, idempotencyKey) {
  // A NUL separator cannot occur in a user id or a (validated) client key: no two pairs collide.
  return `${actorId ?? ''}\u0000${idempotencyKey}`;
}

/**
 * CarUp's public database error, WITHOUT destroying the native PostgreSQL identity: the native error
 * rides as a NON-ENUMERABLE `cause`, so the idempotency layer can recognise its own constraint while
 * the serialized public error is byte-for-byte what it always was. (`new DatabaseError(message)` alone
 * replaced the native 23505 with 'DATABASE_ERROR', and a race loser got a 500 instead of the winner.)
 */
export function toDatabaseError(error) {
  const err = new DatabaseError(error?.message || 'Database query failed');
  Object.defineProperty(err, 'cause', { value: error, enumerable: false, configurable: true, writable: true });
  return err;
}

/**
 * A unique violation on THE IDEMPOTENCY INDEX specifically — never "any unique violation", which would
 * turn an unrelated constraint failure into a silent success with another row's id. A NATIVE 23505 is
 * required (a message that merely names the index is not accepted).
 */
export function isIdempotencyUniqueViolation(error) {
  const codes = [error?.code, error?.cause?.code].filter(Boolean);
  if (!codes.includes('23505')) return false;
  const constraint = error?.constraint || error?.cause?.constraint || null;
  if (constraint) return constraint === IDEMPOTENCY_CONSTRAINT;
  const message = String(error?.cause?.message || error?.message || error?.details || error?.cause?.details || '');
  return message.includes(IDEMPOTENCY_CONSTRAINT);
}

/** PostgreSQL 42703 for one named column — the ONLY condition the pre-migration fallback answers. */
export function isUndefinedColumnError(error, columnName) {
  const codes = [error?.code, error?.cause?.code].filter(Boolean);
  const message = String(error?.message || error?.cause?.message || error?.details || '');
  if (codes.includes('42703')) return !columnName || message.includes(columnName);
  return /column .* does not exist|could not find the .* column/i.test(message)
    && (!columnName || message.includes(columnName));
}

/**
 * THE KEYED EVIDENCE WRITER the upload route uses. Writes the canonical `idempotency_key` column where
 * it exists; a database without it (the candidate not applied — PostgreSQL 42703 for that column, and
 * only that) takes the pre-migration row, whose metadata mirror still carries the key. The native error
 * is preserved (`toDatabaseError`) so a concurrent duplicate on the unique index is recognisable.
 */
export async function insertEvidenceWithKey(supabase, row, idempotencyKey) {
  const withKey = idempotencyKey ? { ...row, idempotency_key: idempotencyKey } : row;
  let { data, error } = await supabase.from('vehicle_evidence').insert(withKey).select('*').single();
  if (error && idempotencyKey && isUndefinedColumnError(error, 'idempotency_key')) {
    ({ data, error } = await supabase.from('vehicle_evidence').insert(row).select('*').single());
  }
  if (error) throw toDatabaseError(error);
  return data;
}

function recordFrom(match) {
  return {
    evidenceId: match.id,
    vin: match.vin ?? null,
    operation: {
      evidence_class: match.evidence_class ?? null,
      evidence_subtype: match.evidence_subtype ?? null,
      evidence_type: match.evidence_type ?? null,
      checksum: match.checksum ?? null,
      remote_ref: deriveRemoteReference(match),
    },
  };
}

/** One parameterized read within the actor's namespace. `{ failed, error, record }`. */
async function readOne(supabase, actorId, column, idempotencyKey, selectColumns) {
  try {
    const { data, error } = await supabase
      .from('vehicle_evidence')
      .select(selectColumns)
      .eq('uploaded_by', actorId)
      .eq(column, idempotencyKey)
      .limit(1);
    if (error) return { failed: true, error, record: null };
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    // Belt-and-braces: never accept a row outside this actor's scope or without the exact key.
    const match = rows.find((r) => r && String(r.uploaded_by) === String(actorId)
      && (r.idempotency_key === idempotencyKey || r.metadata?.idempotency_key === idempotencyKey));
    return { failed: false, error: null, record: match?.id ? recordFrom(match) : null };
  } catch (error) {
    return { failed: true, error, record: null };
  }
}

/**
 * Look up a prior evidence row for this key, WITHIN THIS ACTOR'S NAMESPACE: the canonical column
 * first, then the historical metadata mirror. A database without the column (the candidate migration
 * not yet applied — PostgreSQL 42703, and only that) reads the mirror alone. Any other failure
 * degrades to "treat as new" — a lookup failure never blocks a legitimate upload.
 */
export async function lookupBySupabase(supabase, idempotencyKey, { actorId = null } = {}) {
  if (!supabase || typeof supabase.from !== 'function') return null;
  if (!actorId || !idempotencyKey) return null; // an unscoped key identifies nothing safely

  const byColumn = await readOne(supabase, actorId, 'idempotency_key', idempotencyKey, `${IDENTITY_COLUMNS}, idempotency_key`);
  if (!byColumn.failed && byColumn.record) return byColumn.record;
  if (byColumn.failed && !isUndefinedColumnError(byColumn.error, 'idempotency_key')) return null;

  const mirrorColumns = byColumn.failed ? IDENTITY_COLUMNS : `${IDENTITY_COLUMNS}, idempotency_key`;
  const byMirror = await readOne(supabase, actorId, 'metadata->>idempotency_key', idempotencyKey, mirrorColumns);
  return byMirror.failed ? null : byMirror.record;
}

/** A key already bound to a different vehicle is a client error, not a duplicate. */
function scopeConflict(idempotencyKey, existingVin, requestedVin) {
  return new ConflictError(
    'This idempotency key was already used for a different vehicle. Use a new key for a new upload.',
    { reason: IDEMPOTENCY_SCOPE_CONFLICT, idempotency_key: idempotencyKey, bound_vin: existingVin, requested_vin: requestedVin },
  );
}

function sameResource(hitVin, requestedVin) {
  if (!requestedVin || !hitVin) return true; // nothing to contradict
  return String(hitVin).toUpperCase() === String(requestedVin).toUpperCase();
}

const normVocab = (v) => (v == null || v === '' ? null : String(v).trim().toLowerCase());
const normExact = (v) => (v == null || v === '' ? null : String(v).trim());
const normField = (field, v) => (VOCABULARY_FIELDS.includes(field) ? normVocab(v) : normExact(v));

/**
 * Is the stored record the SAME evidence operation the caller is asking for? Returns the first
 * canonical field that DISAGREES, or null. A field is compared only when BOTH sides supply it (a
 * historical row cannot contradict what it never recorded). The location is set aside only when THIS
 * request's checksum was computed by CarUp from bytes it holds AND equals the stored checksum.
 */
function operationMismatch(hitOperation, requestedOperation) {
  if (!hitOperation || !requestedOperation) return null;
  const requestedChecksum = normExact(requestedOperation.checksum);
  const contentProven = requestedOperation.checksum_source === CHECKSUM_SOURCES.SERVER_INLINE
    && requestedChecksum !== null
    && requestedChecksum === normExact(hitOperation.checksum);
  for (const field of OPERATION_IDENTITY_FIELDS) {
    if (field === 'remote_ref' && contentProven) continue;
    const stored = normField(field, hitOperation[field]);
    const asked = normField(field, requestedOperation[field]);
    if (stored === null || asked === null) continue;
    if (stored !== asked) return { field, stored: hitOperation[field], requested: requestedOperation[field] };
  }
  return null;
}

function operationConflict(idempotencyKey, mismatch) {
  return new ConflictError(
    'This idempotency key was already used for a different evidence upload. Use a new key for a new upload.',
    { reason: IDEMPOTENCY_OPERATION_CONFLICT, idempotency_key: idempotencyKey, field: mismatch.field },
  );
}

/**
 * Idempotent evidence creation. Returns the existing evidence id when THIS ACTOR already used this key
 * for THIS vehicle and THIS operation; otherwise runs `createFn()` exactly once.
 *
 * `createFn` returns the created record (object with `.id`) or the id. The row it creates must carry
 * `metadata.idempotency_key` (and `idempotency_key` where the column exists).
 *
 * Dedupe is SKIPPED — `createFn` always runs — when the key or the actor is absent: failing open there
 * creates at worst a duplicate, whereas the other way suppresses somebody's legitimate upload.
 *
 * @param {string|null|undefined} idempotencyKey
 * @param {string|null} vin
 * @param {() => Promise<{id:string}|string>} createFn
 * @param {{ supabase?: any, store?: Map<string, IdempotencyRecord>, actorId?: string|null, operation?: Object|null }} [opts]
 * @returns {Promise<{ evidenceId:string, vin:(string|null), deduped:boolean }>}
 */
export async function withUploadIdempotency(idempotencyKey, vin, createFn, opts = {}) {
  if (typeof createFn !== 'function') throw new Error('withUploadIdempotency requires a createFn');

  const store = opts.store || inMemoryStore;
  const supabase = opts.supabase || null;
  const actorId = opts.actorId ?? null;
  const requestedOperation = opts.operation || null;

  const fresh = async () => {
    const created = await createFn();
    const evidenceId = typeof created === 'string' ? created : created?.id;
    return { created, evidenceId };
  };

  if (!idempotencyKey || !actorId) {
    const { created, evidenceId } = await fresh();
    return { evidenceId, vin: (created && created.vin) || vin || null, deduped: false };
  }

  const scoped = idempotencyScopeKey(actorId, idempotencyKey);
  const settle = (hit) => {
    if (!sameResource(hit.vin, vin)) throw scopeConflict(idempotencyKey, hit.vin, vin);
    const mismatch = operationMismatch(hit.operation, requestedOperation);
    if (mismatch) throw operationConflict(idempotencyKey, mismatch);
    return { evidenceId: hit.evidenceId, vin: hit.vin ?? vin ?? null, deduped: true };
  };

  // 1) Fast path: the process-local map, scoped exactly as the index is.
  if (store.has(scoped)) return settle(store.get(scoped));

  // 2) Durable path: the indexed column, then the historical metadata mirror.
  const prior = await lookupBySupabase(supabase, idempotencyKey, { actorId });
  if (prior) {
    store.set(scoped, prior);
    return settle(prior);
  }

  // 3) Miss → create. Between the check and this act another worker can win; where the candidate
  //    index exists the database rejects the loser, which reads the winner back.
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
  if (!evidenceId) throw new Error('createFn did not return an evidence id');
  const resolvedVin = (created && created.vin) || vin || null;
  // The cached entry carries the operation: a warm cache that stored only the id would skip the
  // operation comparison on the fast path. The stored-checksum source is not kept — it is never read.
  store.set(scoped, {
    evidenceId,
    vin: resolvedVin,
    operation: requestedOperation
      ? Object.fromEntries(OPERATION_IDENTITY_FIELDS.map((f) => [f, requestedOperation[f] ?? null]))
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
