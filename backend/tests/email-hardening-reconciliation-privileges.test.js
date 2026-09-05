import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Runs the REAL-GRANTS proof for the private reconciliation work queue inside the ordinary test
 * suite, so `node --test backend/tests/*.test.js` — and therefore CI — executes it on every run.
 *
 * The check boots real PostgreSQL (PGlite), emulates Supabase's default privileges (new public
 * tables are born fully granted to anon/authenticated), applies the Email hardening migration, and
 * proves with SET ROLE and has_*_privilege() that no client role can read, forge, alter or suppress
 * reconciliation work; that the triggers fire on exactly the real transitions; that historical rows
 * enqueue nothing; and that the generational retire primitive holds each guard independently.
 *
 * It exists as a standalone script (database/test/email_reconciliation_privilege_check.mjs) in the
 * same style as the Issue #101 behavioural proofs, so it can also be run directly.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', '..', 'database', 'test', 'email_reconciliation_privilege_check.mjs');

test('the private reconciliation work queue holds against REAL PostgreSQL grants and triggers', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 180_000 });
  } catch (error) {
    assert.fail(`privilege check failed:\n${error.stdout || ''}${error.stderr || ''}${error.message}`);
  }
  assert.ok(output.includes('"ok": true'), `privilege check did not report ok:\n${output.slice(-2000)}`);
  assert.equal(/^FAIL\s/m.test(output), false, `individual checks failed:\n${output.slice(-2000)}`);
});
