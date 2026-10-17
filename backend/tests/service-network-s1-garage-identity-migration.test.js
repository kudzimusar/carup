import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Runs the Service Network S1 migration proof inside the ordinary backend suite, so
 * `node --test backend/tests/*.test.js` — and therefore CI — executes it on every run.
 *
 * The backend suite runs against an in-memory mock, and a mock that models a constraint is a
 * statement about the mock. What this harness proves are properties only real PostgreSQL has:
 * the FORCE ROW LEVEL SECURITY posture, real has_table_privilege() answers for anon /
 * authenticated / service_role, a UNIQUE index actually raising 23505, CHECK constraints
 * refusing invented publication states, and a Down/re-Up cycle that truly round-trips.
 *
 * It exists as a standalone script (database/test/service_network_s1_check.mjs) in the same
 * style as the Issue #101 behavioural proofs, so it can also be run directly.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', '..', 'database', 'test', 'service_network_s1_check.mjs');

test('S1 garage identity migration holds against REAL PostgreSQL grants, constraints and rollback', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const combined = `${error.stdout || ''}${error.stderr || ''}`;
    assert.fail(`service_network_s1_check.mjs failed:\n${combined}`);
  }
  assert.match(output, /All Service Network S1 migration checks passed\./);
  assert.equal(/\bFAIL\b/.test(output), false, `harness reported a failure:\n${output}`);
});
