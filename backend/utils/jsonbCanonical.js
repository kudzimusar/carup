/**
 * JSONB-canonical JSON — CARUP-PAY-03A-STG01-FINAL (D-PROV-1, D-HASH-1).
 *
 * PostgreSQL JSONB does not preserve object key order: it stores keys shorter-first (by UTF-8 byte
 * length), ties broken by byte comparison, and returns them in that order. A SHA-256 taken over a
 * writer's insertion-ordered `JSON.stringify` therefore cannot be recomputed from what JSONB stores and
 * what PostgREST serves. Hashing over this canonical order makes the digest reproducible from the
 * stored or delivered document. Arrays keep their order. Idempotent on JSONB-ordered input, so a
 * digest that was already reproducible is unchanged.
 */
export function toJsonbKeyOrder(value) {
  if (value && typeof value.toJSON === 'function') return toJsonbKeyOrder(value.toJSON());
  if (Array.isArray(value)) return value.map(toJsonbKeyOrder);
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value).sort((a, b) => {
    const la = Buffer.byteLength(a);
    const lb = Buffer.byteLength(b);
    return la !== lb ? la - lb : Buffer.compare(Buffer.from(a), Buffer.from(b));
  });
  const ordered = {};
  for (const key of keys) ordered[key] = toJsonbKeyOrder(value[key]);
  return ordered;
}

export function jsonbCanonicalJson(value) {
  return JSON.stringify(toJsonbKeyOrder(value));
}
