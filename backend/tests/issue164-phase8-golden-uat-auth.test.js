/**
 * Issue #164 Phase 8 — Golden UAT credential provisioning: safety properties.
 *
 * This script is the only thing in the programme that writes a credential, so its containment is
 * tested rather than assumed: it may touch ONLY the four synthetic Golden fixture identities, only on
 * canonical staging, and it must never embed, log or return a password.
 *
 * Run: node --test backend/tests/issue164-phase8-golden-uat-auth.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { GOLDEN_UAT_ACCOUNTS } = await import('../scripts/issue164-golden-uat-auth.mjs');
const SRC = readFileSync('backend/scripts/issue164-golden-uat-auth.mjs', 'utf8');

test('the account set is hard-pinned to the four synthetic Golden fixture identities', () => {
  assert.deepEqual([...GOLDEN_UAT_ACCOUNTS].sort(), [
    'golden-a-buyer-stg@carup-staging.test',
    'golden-a-owner-stg@carup-staging.test',
    'golden-b-buyer-stg@carup-staging.test',
    'golden-b-owner-stg@carup-staging.test',
  ]);
  // Every account is unmistakably synthetic — no production-like person.
  for (const email of GOLDEN_UAT_ACCOUNTS) {
    assert.match(email, /@carup-staging\.test$/);
    assert.match(email, /^golden-/);
  }
});

test('there is no account/email/SQL input — the subject cannot be widened at runtime', () => {
  // The only runtime input is the typed three-value mode.
  const argvReads = SRC.match(/process\.argv[^\n]*/g) || [];
  assert.equal(argvReads.length >= 1, true);
  for (const read of argvReads) {
    assert.ok(/--mode=/.test(read) || /argv\[1\]/.test(read),
      `the only argv input may be --mode= or the direct-invocation guard, found: ${read}`);
  }
  assert.ok(!/process\.env\.GOLDEN_UAT_EMAIL/.test(SRC), 'no email may be supplied by environment');
});

test('it reuses the exact-host staging guard and refuses production', () => {
  assert.match(SRC, /evaluateStagingGuard/, 'must reuse the canonical staging guard');
  assert.match(SRC, /blocked\(guard\.reason\)/, 'a failed guard must block before any write');
});

test('no password is embedded, logged, or returned', () => {
  // The credential comes only from the environment.
  assert.match(SRC, /process\.env\.GOLDEN_UAT_PASSWORD/);
  // It must never be interpolated into output.
  assert.ok(!/console\.log\([^)]*password[^)]*\)/i.test(SRC.replace(/password not recorded/g, '')),
    'the password must never be printed');
  assert.ok(!/password:\s*password/.test(SRC), 'the plaintext must never be placed in a payload');
  // Hashing goes through the governed helper, not a bespoke implementation.
  assert.match(SRC, /hashPassword/, 'must hash via the governed passwordAuth helper');
  assert.ok(!/createHash\(|md5|sha1/i.test(SRC), 'must not roll its own credential hashing');
});

test('it does not weaken authentication: no bypass, no x-user-id, no passwordless toggle', () => {
  // Assert on CODE, not prose: the doc comment legitimately names the shortcuts this script avoids,
  // so comments are stripped before the check (a comment saying "no x-user-id" must not fail it).
  const code = SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '');        // line comments
  assert.ok(!/x-user-id/i.test(code), 'must not introduce an x-user-id shortcut');
  assert.ok(!/ALLOW_PASSWORDLESS|passwordless/i.test(code), 'must not enable a passwordless login path');
  assert.ok(!/process\.env\.NODE_ENV\s*=/.test(code), 'must not mutate NODE_ENV to reach a weaker branch');
  // And it must not disable or reimplement the credential check.
  assert.ok(!/verifyPassword\s*=/.test(code), 'must not redefine the credential verifier');
});

test('it creates no identity and is removable (grant is paired with revoke)', () => {
  assert.ok(!/\.insert\(/.test(SRC), 'must never create a user — it provisions an existing identity only');
  assert.match(SRC, /'status', 'grant', 'revoke'/, 'must expose a revoke mode');
  assert.match(SRC, /password_hash: null/, 'revoke must clear the credential');
});

test('it refuses any identity that is not a synthetic staging fixture', () => {
  assert.match(SRC, /@carup-staging\\\.test\$/, 'must verify the fixture email domain before writing');
  assert.match(SRC, /refusing to touch/, 'a non-fixture identity must be refused');
});
