/**
 * Test-only JWT fixtures for the Golden fixture runner's staging guard.
 *
 * Built at RUNTIME, never written as literals. A real base64url JWT begins `eyJ`, which is exactly
 * what the blocking CR-1 credential scanner matches — a hardcoded fixture would fail the scan, and
 * relaxing the scanner to accommodate a test would be the wrong trade.
 *
 * None of these are signed. The guard deliberately does not verify signatures: it exists to catch an
 * operator pasting the wrong key, not to authenticate one. Supabase rejects a forged token on the
 * first request.
 *
 * Lives under `tests/helpers/` so the CI glob `backend/tests/*.test.js` does not collect it.
 */

const b64url = (value) => Buffer.from(value, 'utf8').toString('base64url');

/** An unsigned token carrying the given claims. */
export function tokenWithClaims(claims) {
  return [
    b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    b64url(JSON.stringify(claims)),
    'c2lnbmF0dXJl',
  ].join('.');
}

/**
 * A credential the guard must ACCEPT — the shape a real staging service-role key has.
 *
 * The guard previously accepted the string `'a.b.c'`, and several tests used exactly that as their
 * "valid service-role JWT". That is what let a three-segment anon key through: the fixture asserted
 * the shape check, so the shape check was all there was to assert.
 */
export const SERVICE_ROLE_TOKEN = tokenWithClaims({
  iss: 'supabase',
  ref: 'eoyenigwevnxwwhyhaer',
  role: 'service_role',
});

/** A credential the guard must REFUSE, despite being a perfectly well-formed three-segment JWT. */
export const ANON_TOKEN = tokenWithClaims({
  iss: 'supabase',
  ref: 'eoyenigwevnxwwhyhaer',
  role: 'anon',
});
