/**
 * Issue #164 Phase 8 — the Golden UAT credential scripts, exercised as REAL CLI INVOCATIONS.
 *
 * ## Why this file exists
 *
 * `issue164-phase8-golden-uat-auth.test.js` asserts regexes over the script's SOURCE and imports one
 * constant. It passed 7/7 against a `--mode=grant` path that could not execute at all — twice over:
 *
 *   1. importing `evaluateStagingGuard` ran the sibling's MODULE-SCOPE mode validation, which
 *      rejected `grant` and exited(2) before the auth script's own `main()` was reached;
 *   2. `let preHashed` was declared a second time inside the grant block, shadowing the binding the
 *      write actually reads, so a validated hash was discarded.
 *
 * Neither fault is visible to a source regex or to an imported pure function. Both live in
 * `process.argv` and in block scope, and only a real invocation reaches them. So these tests SPAWN
 * the scripts.
 *
 * No live credential is needed: every case here is refused by a guard BEFORE any network call, which
 * is itself the property under test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, chmodSync, rmSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AUTH = path.resolve(here, '../scripts/issue164-golden-uat-auth.mjs');
const FIXTURE = path.resolve(here, '../scripts/issue164-golden-vehicles.mjs');
const STAGING_URL = 'https://eoyenigwevnxwwhyhaer.supabase.co';
const FORBIDDEN_PROD_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');

const b64url = (v) => Buffer.from(v, 'utf8').toString('base64url');
const token = (claims) => [
  b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
  b64url(JSON.stringify(claims)),
  'c2ln',
].join('.');

const SERVICE_ROLE = token({ iss: 'supabase', ref: 'eoyenigwevnxwwhyhaer', role: 'service_role' });
const ANON = token({ iss: 'supabase', role: 'anon' });

/** A syntactically governed hash: scrypt:<32 hex>:<128 hex>. Not derived from any real password. */
const WELL_FORMED_HASH = `scrypt:${'a'.repeat(32)}:${'b'.repeat(128)}`;

function run(script, args, env = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
      SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
      SUPABASE_ANON_KEY: 'test-anon-key', JWT_SECRET: 'test-jwt-secret',
      ...env,
    },
  });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function withHashFile(contents, mode = 0o600) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-uat-cli-'));
  const file = path.join(dir, 'golden-uat.hash');
  writeFileSync(file, contents, { mode });
  chmodSync(file, mode);
  return { file, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── THE REGRESSION: --mode=grant must reach its own main() ────────────────────────────────────────

test('CLI: --mode=grant is not rejected as an unknown mode', () => {
  const h = withHashFile(WELL_FORMED_HASH);
  try {
    const { out } = run(AUTH, ['--mode=grant', `--hash-file=${h.file}`]);
    // The old defect: the sibling's module-scope validation killed the process here.
    assert.doesNotMatch(out, /unknown --mode=grant/,
      'importing evaluateStagingGuard must not interpret the caller\'s mode');
    // It must get far enough to prove the staging identity.
    assert.match(out, /staging identity OK/, `expected to reach the guard, got: ${out.slice(0, 300)}`);
  } finally { h.cleanup(); }
});

// THE MUTATION TEST for the shadowing defect. The source is reported from the same binding the write
// reads, before any DB access, so this fails the instant that binding stops receiving the hash.
test('CLI: a --hash-file credential actually reaches the binding the write uses', () => {
  const h = withHashFile(WELL_FORMED_HASH);
  try {
    const { out } = run(AUTH, ['--mode=grant', `--hash-file=${h.file}`]);
    assert.match(out, /credential source: hash-file/,
      'the validated hash must reach main() scope — a shadowed binding reports "env" here');
    assert.doesNotMatch(out, /credential source: env/);
  } finally { h.cleanup(); }
});

test('CLI: the plaintext path reports the env source', () => {
  const { out } = run(AUTH, ['--mode=grant'], { GOLDEN_UAT_PASSWORD: 'a-long-enough-password' });
  assert.match(out, /credential source: env/);
});

test('CLI: --mode=status and --mode=revoke also reach their own main()', () => {
  for (const mode of ['status', 'revoke']) {
    const { out } = run(AUTH, [`--mode=${mode}`]);
    assert.doesNotMatch(out, new RegExp(`unknown --mode=${mode}`));
    assert.match(out, /staging identity OK/, `${mode} must reach the guard`);
  }
});

test('CLI: an unknown mode is still refused when the script is RUN', () => {
  const { out, status } = run(AUTH, ['--mode=nonsense']);
  assert.match(out, /unknown --mode=nonsense/);
  assert.equal(status, 2);
});

test('CLI: the fixture runner still validates its own modes, and a typo cannot start the sequence', () => {
  const { out, status } = run(FIXTURE, ['--mode=sequnce']);
  assert.match(out, /unknown --mode=sequnce/, 'a near-miss must not fall through to the destructive path');
  assert.equal(status, 2);
  assert.doesNotMatch(out, /STEP baseline/, 'no sequence step may have run');
});

// ── Environment containment ───────────────────────────────────────────────────────────────────────

test('CLI: the production ref is refused before anything else', () => {
  const h = withHashFile(WELL_FORMED_HASH);
  try {
    const { out, status } = run(AUTH, ['--mode=grant', `--hash-file=${h.file}`],
      { SUPABASE_URL: `https://${FORBIDDEN_PROD_REF}.supabase.co` });
    assert.match(out, /forbidden production ref/);
    assert.equal(status, 2);
    assert.doesNotMatch(out, /staging identity OK/);
  } finally { h.cleanup(); }
});

test('CLI: a non-service_role credential is refused before any client is built', () => {
  const h = withHashFile(WELL_FORMED_HASH);
  try {
    const { out, status } = run(AUTH, ['--mode=grant', `--hash-file=${h.file}`],
      { SUPABASE_SERVICE_ROLE_KEY: ANON });
    assert.match(out, /service_role/);
    assert.equal(status, 2);
    assert.doesNotMatch(out, /Supabase client initialized/);
  } finally { h.cleanup(); }
});

test('CLI: a look-alike host is refused', () => {
  const { out, status } = run(AUTH, ['--mode=status'],
    { SUPABASE_URL: 'https://evil.example.com/?ref=eoyenigwevnxwwhyhaer' });
  assert.match(out, /host must be exactly/);
  assert.equal(status, 2);
});

// ── Credential hygiene ────────────────────────────────────────────────────────────────────────────

test('CLI: a malformed hash is refused BEFORE any database access', () => {
  for (const bad of [
    'not-a-scrypt-hash',
    'bcrypt:aaaa:bbbb',
    `scrypt::${'b'.repeat(128)}`,
    `scrypt:${'a'.repeat(32)}:${'b'.repeat(64)}`,   // TRUNCATED key — the silent-lockout case
    `scrypt:${'a'.repeat(31)}:${'b'.repeat(128)}`,  // short salt
    `scrypt:${'A'.repeat(32)}:${'b'.repeat(128)}`,  // non-lowercase hex
  ]) {
    const h = withHashFile(bad);
    try {
      const { out, status } = run(AUTH, ['--mode=grant', `--hash-file=${h.file}`]);
      assert.match(out, /not a governed scrypt hash/, `must refuse: ${bad.slice(0, 24)}…`);
      assert.equal(status, 2);
      assert.doesNotMatch(out, /users read/, 'must refuse before touching the database');
    } finally { h.cleanup(); }
  }
});

test('CLI: no hash content is ever echoed, on any path', () => {
  const secretish = `scrypt:${'a'.repeat(32)}:${'b'.repeat(128)}`;
  const h = withHashFile(secretish);
  try {
    const { out } = run(AUTH, ['--mode=grant', `--hash-file=${h.file}`]);
    assert.equal(out.includes(secretish), false, 'the hash must never appear in output');
    assert.equal(out.includes('b'.repeat(128)), false, 'the derived key must never appear');
    assert.equal(out.includes('a'.repeat(32)), false, 'the salt must never appear');
  } finally { h.cleanup(); }
});

test('CLI: a group/world-accessible or symlinked hash file is refused', () => {
  const loose = withHashFile(WELL_FORMED_HASH, 0o644);
  try {
    const { out, status } = run(AUTH, ['--mode=grant', `--hash-file=${loose.file}`]);
    assert.match(out, /group\/world accessible/);
    assert.equal(status, 2);
  } finally { loose.cleanup(); }

  const real = withHashFile(WELL_FORMED_HASH);
  const link = path.join(real.dir, 'linked.hash');
  try {
    symlinkSync(real.file, link);
    const { out, status } = run(AUTH, ['--mode=grant', `--hash-file=${link}`]);
    assert.match(out, /symlink/);
    assert.equal(status, 2);
  } finally { real.cleanup(); }
});

test('CLI: grant with neither a hash file nor a password is refused', () => {
  const { out, status } = run(AUTH, ['--mode=grant'], { GOLDEN_UAT_PASSWORD: '' });
  assert.match(out, /--hash-file=<path> or GOLDEN_UAT_PASSWORD/);
  assert.equal(status, 2);
});

test('CLI: the plaintext path still enforces a minimum length', () => {
  const { out, status } = run(AUTH, ['--mode=grant'], { GOLDEN_UAT_PASSWORD: 'short' });
  assert.match(out, /at least 12 characters/);
  assert.equal(status, 2);
});

// ── Subject containment ───────────────────────────────────────────────────────────────────────────

test('CLI: no argv input can widen the subject beyond the four pinned identities', () => {
  const h = withHashFile(WELL_FORMED_HASH);
  try {
    // Every one of these is an attempt to name a different subject. None may be honoured, and the
    // run must not proceed past the guards on the strength of them.
    const attempts = [
      ['--mode=grant', `--hash-file=${h.file}`, '--email=attacker@example.com'],
      ['--mode=grant', `--hash-file=${h.file}`, '--account=admin'],
      ['--mode=grant', `--hash-file=${h.file}`, "--where=1=1"],
    ];
    for (const args of attempts) {
      const { out } = run(AUTH, args, { GOLDEN_UAT_EMAIL: 'attacker@example.com' });
      assert.doesNotMatch(out, /attacker@example\.com/, `an injected subject must never be echoed: ${args.join(' ')}`);
      assert.doesNotMatch(out, /credential_set/, 'no credential may be written on these runs');
    }
  } finally { h.cleanup(); }
});

test('CLI: supplying BOTH credential sources is refused rather than silently resolved', () => {
  const h = withHashFile(WELL_FORMED_HASH);
  try {
    const { out, status } = run(AUTH, ['--mode=grant', `--hash-file=${h.file}`],
      { GOLDEN_UAT_PASSWORD: 'a-long-enough-password' });
    assert.match(out, /not both/);
    assert.equal(status, 2);
    assert.doesNotMatch(out, /credential source:/, 'no credential may be resolved on an ambiguous run');
  } finally { h.cleanup(); }
});
