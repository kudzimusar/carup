import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Runs the Service Network S2 migration proof inside the ordinary backend suite so
 * `node --test backend/tests/*.test.js` — and therefore CI — executes it every run.
 *
 * What only real PostgreSQL can prove here: FORCE RLS with zero policies, real
 * has_table_privilege()/has_sequence_privilege() answers, the partial UNIQUE index on
 * source_inquiry_id actually raising 23505 on a retry while NULL origins stay distinct,
 * the status CHECK refusing states outside the frozen six, and the append-only trigger
 * genuinely refusing UPDATE and DELETE on case history.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', '..', 'database', 'test', 'service_network_s2_check.mjs');

test('S2 service case migration holds against REAL PostgreSQL constraints, grants and rollback', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const combined = `${error.stdout || ''}${error.stderr || ''}`;
    assert.fail(`service_network_s2_check.mjs failed:\n${combined}`);
  }
  assert.match(output, /All Service Network S2 migration checks passed\./);
  assert.equal(/\bFAIL\b/.test(output), false, `harness reported a failure:\n${output}`);
});
