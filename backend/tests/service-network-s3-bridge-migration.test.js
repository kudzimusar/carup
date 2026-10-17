import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Runs the Service Network S3 marketplace-bridge migration proof inside the ordinary
 * backend suite so CI executes it on every run.
 *
 * What only real PostgreSQL proves here: that the additive column lands on the REAL
 * marketplace_inquiries table (uuid, nullable), that a legacy service inquiry created
 * before the bridge keeps its seller columns and gains NO fabricated routing, that the
 * index is genuinely partial, and that Down is additive-safe — it drops the column
 * without destroying marketplace leads.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', '..', 'database', 'test', 'service_network_s3_check.mjs');

test('S3 marketplace bridge migration holds against REAL PostgreSQL, including legacy rows', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const combined = `${error.stdout || ''}${error.stderr || ''}`;
    assert.fail(`service_network_s3_check.mjs failed:\n${combined}`);
  }
  assert.match(output, /All Service Network S3 migration checks passed\./);
  assert.equal(/\bFAIL\b/.test(output), false, `harness reported a failure:\n${output}`);
});
