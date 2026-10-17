import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Runs the Service Network S5 proof inside the ordinary backend suite.
 *
 * The load-bearing check is the mileage authority (plan §13.1): the harness writes a
 * mileage OBSERVATION against real PostgreSQL and re-reads vehicles.mileage to prove it
 * did not move — i.e. that Service Network introduced no second canonical odometer
 * writer. It also proves money integrity is a database guarantee (a cost without a
 * currency is refused), that the provenance CHECK refuses invented strengths such as
 * "verified repair", and that part/evidence links cannot be double-attached.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', '..', 'database', 'test', 'service_network_s5_check.mjs');

test('S5 service records hold against REAL PostgreSQL, and no second odometer writer exists', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const combined = `${error.stdout || ''}${error.stderr || ''}`;
    assert.fail(`service_network_s5_check.mjs failed:\n${combined}`);
  }
  assert.match(output, /All Service Network S5 migration checks passed\./);
  assert.equal(/\bFAIL\b/.test(output), false, `harness reported a failure:\n${output}`);
});
