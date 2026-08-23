/**
 * Issue #164 Phase 8 — offline Golden UAT credential hasher: safety properties.
 *
 * This tool touches a plaintext password, so its containment is proven rather than asserted: the
 * password must never be accepted as an argument, never echoed, never written anywhere, and the hash
 * it produces must verify through the REAL, unmodified login path (no bespoke hashing, no bypass).
 *
 * Run: node --test backend/tests/issue164-phase8-golden-uat-hash.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

process.env.NODE_ENV = 'test';

const SRC = readFileSync('backend/scripts/issue164-golden-uat-hash.mjs', 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const OUT = '/tmp/issue164-uat-hash-test.hash';

test('the password is never taken from an argument or the environment', () => {
  // argv is only read for --out=; there is no --password= and no env fallback, so the plaintext can
  // never enter shell history or a process listing.
  assert.ok(!/--password/.test(code), 'must not accept a password argument');
  assert.ok(!/process\.env\.[A-Z_]*PASSWORD/.test(code), 'must not read a password from the environment');
  const argvReads = code.match(/process\.argv[^\n]*/g) || [];
  for (const read of argvReads) {
    assert.ok(/--out=/.test(read) || /argv\[1\]/.test(read), `unexpected argv read: ${read}`);
  }
});

test('the plaintext is never echoed, logged, or written', () => {
  // Raw mode with no echo is what keeps it off the screen.
  assert.match(code, /setRawMode\(true\)/, 'terminal input must be read without echo');
  // The only write is the hash.
  const writes = code.match(/writeFileSync\([^)]*\)/g) || [];
  assert.equal(writes.length, 1, 'exactly one file write (the hash) is permitted');
  assert.ok(/writeFileSync\(outPath, `\$\{hash\}/.test(code), 'the written value must be the hash');
  assert.ok(!/console\.log\([^)]*password/i.test(code), 'the password must never be printed');
  // Nor may the hash itself be printed to stdout.
  assert.ok(!/console\.log\([^)]*\bhash\b[^)]*\)/.test(code.replace(/hash\.split\(':'\)\[0\]/g, 'SCHEME')),
    'the hash must go to the file, not stdout');
});

test('it uses the governed hasher and rolls no crypto of its own', () => {
  assert.match(code, /hashPassword/, 'must hash via the governed passwordAuth helper');
  assert.ok(!/createHash\(|createHmac\(|md5|sha1|pbkdf2|scryptSync/i.test(code),
    'must not implement its own credential hashing');
});

test('the file is written owner-only (0600)', () => {
  assert.match(code, /mode:\s*0o600/, 'the hash file must be owner-only');
});

test('a short password is refused and nothing is written', () => {
  if (existsSync(OUT)) unlinkSync(OUT);
  let failed = false;
  try {
    execFileSync('node', ['backend/scripts/issue164-golden-uat-hash.mjs', `--out=${OUT}`],
      { input: 'short', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { failed = true; }
  assert.equal(failed, true, 'a sub-minimum password must exit non-zero');
  assert.equal(existsSync(OUT), false, 'nothing may be written when the password is refused');
});

test('the produced hash verifies through the REAL login path', async () => {
  if (existsSync(OUT)) unlinkSync(OUT);
  const password = 'GoldenUatTest-2026!';
  const stdout = execFileSync('node', ['backend/scripts/issue164-golden-uat-hash.mjs', `--out=${OUT}`],
    { input: password, encoding: 'utf8' });

  // stdout must disclose neither the password nor the hash.
  assert.ok(!stdout.includes(password), 'stdout must not contain the password');
  const hash = readFileSync(OUT, 'utf8').trim();
  assert.ok(!stdout.includes(hash), 'stdout must not contain the hash');
  assert.match(hash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/, 'the hash must be a governed scrypt digest');

  // Owner-only permissions.
  assert.equal(statSync(OUT).mode & 0o777, 0o600);

  // The decisive property: this credential authenticates through the exact function
  // POST /api/auth/login calls — and a wrong password still fails.
  const { evaluateLoginCredentials } = await import('../utils/passwordAuth.js');
  const good = await evaluateLoginCredentials({ user: { password_hash: hash }, password, env: { NODE_ENV: 'production' } });
  const bad = await evaluateLoginCredentials({ user: { password_hash: hash }, password: 'not-the-password', env: { NODE_ENV: 'production' } });
  assert.deepEqual(good, { ok: true, method: 'password' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid_password');

  unlinkSync(OUT);
});
