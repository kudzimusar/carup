/**
 * The ONE canonical serialization for hash inputs of CarUp's hash-chained audit records (OC-3D).
 *
 * A hash is only as stable as the bytes it is computed over. CarUp's v1 hashes were computed over
 * `JSON.stringify(...)` — JavaScript insertion order — while PostgreSQL JSONB re-orders object keys
 * (by length, then bytewise). A record written as `{ reason, file_size }` reads back as
 * `{ reason, file_size }` or `{ file_size, reason }` depending on the store, so a verifier that
 * re-serializes what it read can see a different hash for untouched data. Neither JS insertion order
 * nor JSONB output order is a security contract.
 *
 * canonicalSerialize(value):
 *   1. normalizes exactly as JSON persistence does (Date → ISO-8601 string via toJSON, undefined
 *      object members dropped, undefined/function array slots → null, non-finite numbers → null,
 *      `toJSON` honoured; a top-level value with no JSON form, or a BigInt, throws);
 *   2. writes the normalized value with object keys sorted by UTF-16 code units at every depth
 *      (the RFC 8785 / JCS member order), arrays in order, strings and numbers in ECMAScript JSON
 *      form, no whitespace.
 * The same function is used to WRITE a hash and to VERIFY it. Unicode is not normalized (NFC vs NFD
 * stay distinct values), matching JCS.
 */
import crypto from 'crypto';

/** v1: the historical concatenation hash. Never reinterpreted; verified as it was written. */
export const LEDGER_HASH_VERSION_LEGACY = 1;
/** v2: sha256 over a domain-separated canonical envelope; stored with an in-band `v2:` prefix. */
export const LEDGER_HASH_VERSION_CANONICAL = 2;
export const V2_HASH_PREFIX = 'v2:';

/** The persisted-JSON form of a value — what storage receives and what a verifier reads back. */
export function persistedJsonValue(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('value is not JSON-persistable');
  return JSON.parse(serialized);
}

function writeCanonical(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(writeCanonical).join(',')}]`;
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      const keys = Object.keys(value).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${writeCanonical(value[key])}`).join(',')}}`;
    }
    default:
      // Unreachable after persistedJsonValue(); fail closed rather than guess.
      throw new Error(`value of type ${typeof value} has no canonical form`);
  }
}

/** Deterministic serialization: same value → same string, whatever the key order. */
export function canonicalSerialize(value) {
  return writeCanonical(persistedJsonValue(value));
}

/** sha256 hex of a domain label plus the canonical serialization of `value`. */
export function canonicalDigest(domain, value) {
  return crypto.createHash('sha256').update(`${domain}\n${canonicalSerialize(value)}`).digest('hex');
}

/**
 * Which hash scheme a stored hash was written with. A v2 hash carries the `v2:` prefix; anything
 * else is the historical v1 form (64 hex characters).
 */
export function hashVersionOf(storedHash) {
  return String(storedHash ?? '').startsWith(V2_HASH_PREFIX) ? LEDGER_HASH_VERSION_CANONICAL : LEDGER_HASH_VERSION_LEGACY;
}

export default {
  LEDGER_HASH_VERSION_LEGACY,
  LEDGER_HASH_VERSION_CANONICAL,
  V2_HASH_PREFIX,
  persistedJsonValue,
  canonicalSerialize,
  canonicalDigest,
  hashVersionOf,
};
