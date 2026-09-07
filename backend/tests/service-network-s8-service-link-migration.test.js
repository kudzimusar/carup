import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Runs the Service Network S8 proof inside the ordinary backend suite.
 *
 * It proves at the database level that a resource has exactly one stable link, that the
 * governed resource-type and purpose vocabularies are CHECK-enforced (so no capability
 * can be minted over an insurance or finance resource), that a grant without an expiry
 * is refused outright — there is no standing access — and that only hashes are stored.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', '..', 'database', 'test', 'service_network_s8_check.mjs');

test('S8 service links and capability grants hold against REAL PostgreSQL', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const combined = `${error.stdout || ''}${error.stderr || ''}`;
    assert.fail(`service_network_s8_check.mjs failed:\n${combined}`);
  }
  assert.match(output, /All Service Network S8 migration checks passed\./);
  assert.equal(/\bFAIL\b/.test(output), false, `harness reported a failure:\n${output}`);
});
