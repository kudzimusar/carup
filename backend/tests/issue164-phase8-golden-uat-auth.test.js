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
  // Runtime inputs are the typed mode and the credential SOURCE (`--hash-file`, added so a
  // pre-computed hash can go from the owner's file straight to password_hash without passing through
  // anyone else's hands). Neither can influence WHICH accounts are touched, and that is the property
  // this test defends — the earlier form banned every argv read, which conflated "an input exists"
  // with "the subject can be widened".
  const argvReads = SRC.match(/process\.argv[^\n]*/g) || [];
  assert.equal(argvReads.length >= 1, true);
  for (const read of argvReads) {
    assert.ok(/--mode=/.test(read) || /--hash-file=/.test(read) || /argv\[1\]/.test(read),
      `argv may supply only the mode or the credential source, found: ${read}`);
  }
  assert.ok(!/process\.env\.GOLDEN_UAT_EMAIL/.test(SRC), 'no email may be supplied by environment');

  // THE SUBJECT ITSELF: a frozen literal of four addresses, with no runtime input anywhere near it.
  const pinned = SRC.match(/const GOLDEN_UAT_ACCOUNTS = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(pinned, 'the account list must be a frozen literal');
  assert.ok(!/process\.(argv|env)/.test(pinned[1]), 'the account list must not read argv or env');
  assert.equal((pinned[1].match(/@carup-staging\.test/g) || []).length, 4, 'exactly four pinned accounts');

  // And the only rows ever written are selected from that list. Asserted POSITIVELY: the earlier
  // negative-lookahead form passed when the `.in(...)` was deleted altogether, so it caught a WRONG
  // scope but not a MISSING one — the more dangerous of the two.
  assert.match(SRC, /\.from\('users'\)[\s\S]{0,160}\.in\('email', GOLDEN_UAT_ACCOUNTS\)/,
    'the users read must be explicitly scoped to the pinned list');
  const unscopedReads = (SRC.match(/\.from\('users'\)\s*\.select\([^)]*\)(?!\s*\.in\()/g) || []);
  assert.deepEqual(unscopedReads, [], 'no users read may be unscoped');
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

// ── Codex round 3 P1: revocation must survive identity drift ─────────────────────────────────────
// `found` was loaded by the four pinned EMAILS only. If a granted fixture's email changes, an
// email-keyed revoke reports it absent and leaves the shared UAT hash live on it; and if the pinned
// email was meanwhile reassigned, that same path clears the REPLACEMENT user's password instead.
// Identity here is the deterministic id — the email is a label on it.

test('the users read is keyed on the deterministic ids as well as the pinned emails', () => {
  assert.match(SRC, /GOLDEN_UAT_IDS/, 'the deterministic id set must exist');
  assert.match(SRC, /\.in\('id', GOLDEN_UAT_IDS\)/, 'rows must also be resolvable by fixture id');
  assert.match(SRC, /\.in\('email', GOLDEN_UAT_ACCOUNTS\)/, 'the email read remains, for drift visibility');
});

test('revoke targets the deterministic id, never the email', () => {
  const revoke = SRC.slice(SRC.indexOf("if (MODE === 'revoke')"));
  assert.match(revoke, /for \(const userId of GOLDEN_UAT_IDS\)/,
    'revocation must iterate the fixture ids');
  assert.match(revoke, /\.eq\('id', userId\)/, 'and update by that id');
  assert.doesNotMatch(revoke, /r\.email === email/,
    'a renamed row must not defeat revocation, and a reassigned email must not be cleared');
});

test('a row outside the fixture id set is reported, never written to', () => {
  const revoke = SRC.slice(SRC.indexOf("if (MODE === 'revoke')"));
  assert.match(revoke, /unrelatedRowsHoldingAPinnedEmail/,
    'a stranger holding a pinned address must be surfaced, not touched');
});

test('status resolves by id first, so a renamed row still reports against its fixture identity', () => {
  // Slice from the status branch to the NEXT grant branch AFTER it — an earlier `MODE === 'grant'`
  // guard appears above status, so an unanchored indexOf produces an empty (backwards) slice and the
  // assertion would have been vacuous rather than wrong.
  const statusAt = SRC.indexOf("if (MODE === 'status')");
  const grantAfter = SRC.indexOf("if (MODE === 'grant')", statusAt);
  assert.ok(statusAt > -1 && grantAfter > statusAt, 'the status branch must precede a grant branch');
  const status = SRC.slice(statusAt, grantAfter);
  assert.match(status, /GOLDEN_UAT_IDS\[index\]/,
    'status must resolve by fixture id first, so a renamed row still reports against its identity');
});
