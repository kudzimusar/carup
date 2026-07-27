/**
 * Diaspora GTM — the shapes of a real credential, in one place (Issue #127, Drive lane).
 *
 * Two distinct jobs, deliberately kept as two lists:
 *
 *  1. SQL_MIRROR_PATTERNS — a CHARACTER-FOR-CHARACTER mirror of the CHECK constraint
 *     `ck_diaspora_credential_reference_not_a_secret` on `diaspora_credential_references`
 *     (migration 20260727120000, ledger #21). Each entry records the SQL fragment it mirrors so
 *     drift between the two is a diff, not a discovery. The invariant that matters is one-directional:
 *     JS must never ACCEPT a value SQL would reject. JS rejecting more than SQL is safe.
 *
 *  2. REDACTION_PATTERNS — used only to scrub strings on their way to a log, an error message or an
 *     API response. These are unanchored and must therefore be far more specific: a sloppy pattern
 *     here silently mangles ordinary prose (an unanchored `ey[A-Za-z0-9_-]+\.` matches "keyboard.").
 *
 * `database/test/diaspora_drive_vault_reference_check.mjs` runs both lists against real PostgreSQL to
 * prove list 1 still matches the deployed constraint.
 */

/** `ck_diaspora_credential_reference_len CHECK (length(vault_reference) BETWEEN 3 AND 512)` */
export const VAULT_REFERENCE_MIN_LENGTH = 3;
export const VAULT_REFERENCE_MAX_LENGTH = 512;

/**
 * Exact mirror of the SQL CHECK, split per alternative so a rejection can name the class.
 *
 * SQL: `vault_reference !~ '^(1//|ya29\.|sk_live_|sk_test_|rk_live_|pk_live_|whsec_|AIza)'`
 *      `AND vault_reference !~ '^ey[A-Za-z0-9_-]+\.'`
 *      `AND vault_reference !~ '-----BEGIN'`
 *
 * `sql` is the fragment as it appears VERBATIM in the constraint definition Postgres reports, so the
 * PGlite harness can assert its continued presence with a substring check. The first eight are
 * alternatives inside one anchored `^(…)` group, which is why they carry no `^` of their own.
 */
export const SQL_MIRROR_PATTERNS = Object.freeze([
  { name: 'google oauth refresh token', sql: '1//', anchored: true, pattern: /^1\/\// },
  { name: 'google oauth access token', sql: 'ya29\\.', anchored: true, pattern: /^ya29\./ },
  { name: 'stripe live secret key', sql: 'sk_live_', anchored: true, pattern: /^sk_live_/ },
  { name: 'stripe test secret key', sql: 'sk_test_', anchored: true, pattern: /^sk_test_/ },
  { name: 'stripe restricted key', sql: 'rk_live_', anchored: true, pattern: /^rk_live_/ },
  { name: 'stripe publishable live key', sql: 'pk_live_', anchored: true, pattern: /^pk_live_/ },
  { name: 'webhook signing secret', sql: 'whsec_', anchored: true, pattern: /^whsec_/ },
  { name: 'google api key', sql: 'AIza', anchored: true, pattern: /^AIza/ },
  { name: 'jwt', sql: '^ey[A-Za-z0-9_-]+\\.', anchored: true, pattern: /^ey[A-Za-z0-9_-]+\./ },
  // The only unanchored SQL clause: a PEM block anywhere in the value disqualifies it.
  { name: 'pem private key block', sql: '-----BEGIN', anchored: false, pattern: /-----BEGIN/ },
]);

/**
 * JS-only additions. These are credential shapes ledger #21 did not enumerate; rejecting them here is
 * strictly safer than the database and never causes the dangerous direction of drift.
 */
export const ADDITIONAL_REFERENCE_PATTERNS = Object.freeze([
  { name: 'google oauth client secret', pattern: /^GOCSPX-/ },
  { name: 'aws access key id', pattern: /^(AKIA|ASIA)[A-Z0-9]{16}/ },
  { name: 'github token', pattern: /^gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'slack token', pattern: /^xox[baprs]-/ },
  { name: 'bearer header', pattern: /^Bearer\s/i },
]);

/** Everything `assertOpaqueReference` refuses. */
export const TOKEN_SHAPED_REFERENCE_PATTERNS = Object.freeze([
  ...SQL_MIRROR_PATTERNS,
  ...ADDITIONAL_REFERENCE_PATTERNS,
]);

/**
 * Unanchored patterns for scrubbing outbound strings. Every one requires enough surrounding
 * structure that a false positive on ordinary English is not plausible.
 */
export const REDACTION_PATTERNS = Object.freeze([
  { name: 'google refresh token', pattern: /1\/\/[A-Za-z0-9_-]{10,}/g },
  { name: 'google access token', pattern: /ya29\.[A-Za-z0-9._-]{10,}/g },
  { name: 'google api key', pattern: /AIza[A-Za-z0-9_-]{20,}/g },
  { name: 'google client secret', pattern: /GOCSPX-[A-Za-z0-9_-]{10,}/g },
  { name: 'stripe secret key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { name: 'webhook signing secret', pattern: /\bwhsec_[A-Za-z0-9]{10,}/g },
  // A JWT needs all three segments before we call it one, so "keyboard." cannot trip it.
  { name: 'jwt', pattern: /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g },
  { name: 'pem block', pattern: /-----BEGIN[\s\S]*?-----END[^-]*-----/g },
  { name: 'authorization header value', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/g },
]);
