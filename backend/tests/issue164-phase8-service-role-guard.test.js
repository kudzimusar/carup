/**
 * Issue #164 Phase 8 — the Golden fixture runner must require a real service_role credential.
 *
 * The guard validated the credential by SHAPE only:
 *
 *     key.split('.').length === 3
 *
 * A legacy Supabase anon JWT is also three segments, so an operator who pasted the anon key instead
 * of the service-role key passed the guard. The run would then proceed under RLS, and the fixture
 * would fail by silently seeing no rows — a wrong-credential fault wearing the costume of missing
 * data. These tests fail on the physically-tested baseline `993c1179` and on candidate `1430546b`,
 * where every JWT below is accepted regardless of its role.
 *
 * Every token here is BUILT AT RUNTIME rather than written as a literal. A real base64url JWT begins
 * `eyJ`, which is exactly what the blocking CR-1 credential scanner matches — a hardcoded fixture
 * would fail the scan, and relaxing the scanner to accommodate a test would be the wrong trade.
 * None of these are signed; the guard deliberately does not verify signatures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateServiceRoleKey, evaluateStagingGuard } from '../scripts/issue164-golden-vehicles.mjs';

const STAGING_URL = 'https://eoyenigwevnxwwhyhaer.supabase.co';
const FORBIDDEN_PROD_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');

const b64url = (value) => Buffer.from(value, 'utf8').toString('base64url');

/** An UNSIGNED token with the given claims. The signature segment is inert filler. */
function tokenWithClaims(claims) {
  return [
    b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    b64url(JSON.stringify(claims)),
    'c2lnbmF0dXJl',
  ].join('.');
}

const SERVICE_ROLE_KEY = tokenWithClaims({ iss: 'supabase', ref: 'eoyenigwevnxwwhyhaer', role: 'service_role' });
const ANON_KEY = tokenWithClaims({ iss: 'supabase', ref: 'eoyenigwevnxwwhyhaer', role: 'anon' });
const AUTHENTICATED_KEY = tokenWithClaims({ iss: 'supabase', sub: 'user-123', role: 'authenticated' });

// ── the credential check itself ───────────────────────────────────────────────────────────────────

test('a service_role JWT is accepted', () => {
  const result = evaluateServiceRoleKey(SERVICE_ROLE_KEY);
  assert.equal(result.ok, true, result.reason);
});

test('THE DEFECT: an anon JWT is rejected, though it satisfies the old shape check', () => {
  assert.equal(ANON_KEY.split('.').length, 3, 'the anon key must still LOOK like a JWT');
  const result = evaluateServiceRoleKey(ANON_KEY);
  assert.equal(result.ok, false);
  assert.match(result.reason, /service_role/);
});

test('an authenticated (end-user) JWT is rejected', () => {
  assert.equal(AUTHENTICATED_KEY.split('.').length, 3);
  assert.equal(evaluateServiceRoleKey(AUTHENTICATED_KEY).ok, false);
});

test('a JWT carrying no role claim at all is rejected', () => {
  assert.equal(evaluateServiceRoleKey(tokenWithClaims({ iss: 'supabase' })).ok, false);
});

test('a malformed JWT is rejected', () => {
  const malformed = [
    'a.b.c',                                                   // segments that are not base64url JSON
    `${b64url('{}')}.${b64url('not json at all')}.sig`,        // payload is not JSON
    `${b64url('{}')}.${b64url('["array"]')}.sig`,              // payload is not a claim set
    `${b64url('{}')}..sig`,                                    // empty payload segment
  ];
  for (const key of malformed) {
    assert.equal(evaluateServiceRoleKey(key).ok, false, `must reject: ${key.slice(0, 12)}…`);
  }
});

test('a publishable / non-JWT key is rejected', () => {
  for (const key of ['sb_publishable_abc123', 'sb_secret_abc123', 'not-a-jwt', 'a.b', 'a.b.c.d', '']) {
    assert.equal(evaluateServiceRoleKey(key).ok, false, `must reject: ${key || '(empty)'}`);
  }
});

test('no refusal echoes token material, or varies with the decoded claim', () => {
  const custom = tokenWithClaims({ role: 'some_internal_role_name' });
  const reasons = [ANON_KEY, AUTHENTICATED_KEY, custom].map((k) => evaluateServiceRoleKey(k).reason);

  // The message is INVARIANT across roles. That is the property that matters: a refusal which cannot
  // vary with the token's contents cannot be reporting them. (It does mention "anon" as a static
  // hint about the likely mistake — the same words for every rejected role, decoded or not.)
  assert.equal(new Set(reasons).size, 1, 'the refusal must not depend on what the token contained');

  for (const [i, key] of [ANON_KEY, AUTHENTICATED_KEY, custom].entries()) {
    assert.equal(reasons[i].includes(key), false, 'the token must never appear in the message');
    assert.equal(reasons[i].includes(key.split('.')[1]), false, 'the payload segment must never appear');
  }
  assert.doesNotMatch(reasons[2], /some_internal_role_name/, 'an unrecognised role must not be echoed');
});

// ── the full staging guard, end to end ────────────────────────────────────────────────────────────

test('the staging guard accepts the approved host with a service_role key', () => {
  const result = evaluateStagingGuard({ SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.host, 'eoyenigwevnxwwhyhaer.supabase.co');
});

test('the staging guard rejects an anon key on the approved host', () => {
  const result = evaluateStagingGuard({ SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_ROLE_KEY: ANON_KEY });
  assert.equal(result.ok, false);
  assert.match(result.reason, /service_role/);
});

test('the staging guard rejects a wrong staging host even with a valid service_role key', () => {
  for (const url of [
    'https://some-other-project.supabase.co',
    'https://evil.example.com/?ref=eoyenigwevnxwwhyhaer',
    'http://eoyenigwevnxwwhyhaer.supabase.co',
  ]) {
    const result = evaluateStagingGuard({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY });
    assert.equal(result.ok, false, `must reject ${url}`);
  }
});

test('the staging guard rejects the production ref before anything else', () => {
  const result = evaluateStagingGuard({
    SUPABASE_URL: `https://${FORBIDDEN_PROD_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /forbidden production ref/);
});

test('a production-shaped database URL anywhere in scope still refuses the run', () => {
  for (const variable of ['SUPABASE_DB_URL', 'DATABASE_URL', 'DIASPORA_STAGING_DATABASE_URL']) {
    const result = evaluateStagingGuard({
      SUPABASE_URL: STAGING_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      [variable]: `postgresql://db.${FORBIDDEN_PROD_REF}.supabase.co:5432/postgres`,
    });
    assert.equal(result.ok, false, `${variable} must refuse`);
    assert.match(result.reason, /forbidden production ref/);
  }
});
