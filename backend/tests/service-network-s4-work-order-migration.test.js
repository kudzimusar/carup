import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Runs the Service Network S4 convergence proof inside the ordinary backend suite.
 *
 * It applies the LEGACY 006 mechanic shape and the real 20260808150000 convergence
 * migration first, so S4 is proven over the harder historical shape: every added
 * column nullable, legacy rows surviving with no fabricated service case, completion
 * time or currency, one work order per Service Case and one LIVE assignment per work
 * order as database guarantees, and a Down that removes the additions without
 * destroying work orders.
 *
 * It also pins a measured schema truth: over that shape mechanic_work_orders carries
 * NO status CHECK (the Title-Case constraint lives only in the retired
 * 009_phase4_schema.sql), which is why the status vocabulary and terminal-state
 * immutability are enforced in the service layer.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', '..', 'database', 'test', 'service_network_s4_check.mjs');

test('S4 work-order convergence holds against REAL PostgreSQL over the legacy shape', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const combined = `${error.stdout || ''}${error.stderr || ''}`;
    assert.fail(`service_network_s4_check.mjs failed:\n${combined}`);
  }
  assert.match(output, /All Service Network S4 migration checks passed\./);
  assert.equal(/\bFAIL\b/.test(output), false, `harness reported a failure:\n${output}`);
});
