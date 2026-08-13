import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Contract tests for the production communications-scheduler diagnostic.
 *
 * The runner cannot be imported (top-level env guards call process.exit), so
 * these assert against the shipped source — the same bytes the protected
 * dispatcher executes.
 *
 * What must hold, because this probe reads a production Vault:
 *   · it is preflight-only and lives inside the READ ONLY transaction;
 *   · it performs no writes and no scheduler mutation of any kind;
 *   · existence checks prefer vault.secrets (no decryption);
 *   · the endpoint is reduced to a hostname INSIDE PostgreSQL via substring
 *     with a capture group, so a malformed value yields NULL rather than
 *     falling through as the original secret;
 *   · decrypted_secret is never selected bare and never logged.
 */

const runnerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'production-apply-publication-gate.mjs');
const src = fs.readFileSync(runnerPath, 'utf8');

function probeSource() {
  const m = src.match(/async function communicationsSchedulerProbe\(client\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'runner must ship communicationsSchedulerProbe');
  return m[0];
}

test('the probe is invoked only on the preflight path, inside the READ ONLY transaction', () => {
  const preflight = src.match(/if \(MODE === 'preflight'\) \{[\s\S]*?await client\.query\('ROLLBACK'\);/);
  assert.ok(preflight, 'preflight block must exist');
  assert.match(preflight[0], /BEGIN TRANSACTION READ ONLY/);
  assert.match(preflight[0], /await communicationsSchedulerProbe\(client\)/);

  // Exactly one call site, and it is the one inside the preflight block above.
  const callSites = src.match(/await communicationsSchedulerProbe\(/g) || [];
  assert.equal(callSites.length, 1, 'the probe must have a single, preflight-only call site');
});

test('the probe performs no write or scheduler mutation', () => {
  const body = probeSource();
  for (const forbidden of [
    /\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i,
    /\bcron\.schedule\b/i, /\bcron\.unschedule\b/i,
    /\bvault\.create_secret\b/i, /\bvault\.update_secret\b/i,
    /\bcreate\s+extension\b/i, /\bgrant\b/i, /\balter\b/i, /\bdrop\b/i,
  ]) {
    assert.ok(!forbidden.test(body), `probe must not contain ${forbidden}`);
  }
});

test('existence checks prefer vault.secrets and never decrypt', () => {
  const body = probeSource();
  assert.match(body, /from vault\.secrets/, 'name/existence checks must read vault.secrets');
  const namesQuery = body.match(/select name from vault\.secrets[\s\S]*?order by name/);
  assert.ok(namesQuery, 'must select NAMES only from vault.secrets');
  assert.ok(!/decrypted_secret/.test(namesQuery[0]), 'the names query must not touch decrypted_secret');
  for (const n of ['CARUP_WORKER_ENDPOINT_URL', 'CARUP_WORKER_SECRET', 'COMMUNICATION_WORKER_SECRET', 'CRON_SECRET']) {
    assert.ok(namesQuery[0].includes(n), `names query must check ${n}`);
  }
});

test('the endpoint is reduced to a hostname in SQL, and a malformed value cannot leak', () => {
  const body = probeSource();
  // The view name `vault.decrypted_secrets` legitimately contains this substring, so
  // neutralise it first: what must be unique is the bare COLUMN reference, and its one
  // permitted use is inside the anchored substring capture.
  const columnUses = body.replace(/vault\.decrypted_secrets/g, 'vault.SECRETS_VIEW').match(/decrypted_secret\b/g) || [];
  assert.equal(columnUses.length, 1,
    'the decrypted_secret COLUMN may be referenced exactly once — inside the hostname capture');
  assert.match(body, /substring\(decrypted_secret from '\^https\?:\/\/\(\[\^\/\]\+\)'\)/,
    'must use anchored substring with a capture group (regexp_replace could return the original on a malformed value)');
  assert.ok(!/regexp_replace\s*\(\s*decrypted_secret/.test(body),
    'must not use regexp_replace on decrypted_secret');
  // A non-matching value becomes a literal marker, never the raw secret.
  assert.match(body, /coalesce\(substring\(decrypted_secret[\s\S]*?'NON_URL'\)/);
});

test('only hostname-shaped values can ever be printed for the endpoint', () => {
  const body = probeSource();
  const logLine = body.match(/console\.log\(`comms endpoint_host \(hostname only\): \$\{([^}]+)\}`\)/);
  assert.ok(logLine, 'endpoint log must exist');
  assert.equal(logLine[1].trim(), 'finding.host', 'must log only the derived host field');
  assert.match(body, /finding\.host = rows\.length \? rows\[0\]\.endpoint_host : 'UNSET'/,
    'host must come from the SQL-derived endpoint_host, or the UNSET marker');
});

test('no probe output interpolates a secret-bearing field', () => {
  const body = probeSource();
  const logs = body.match(/console\.log\([^\n]*\)/g) || [];
  for (const line of logs) {
    assert.ok(!/decrypted_secret/.test(line), `log must not reference decrypted_secret: ${line}`);
    assert.ok(!/\bsecret\s*\}/.test(line), `log must not interpolate a secret value: ${line}`);
  }
});

test('the probe emits a machine-readable decision from the documented set', () => {
  const body = probeSource();
  assert.match(body, /COMMS_SCHEDULER_PROBE_DECISION=\$\{decision\}/);
  for (const d of ['CONFIRMED', 'DISPROVED', 'INCONCLUSIVE']) {
    assert.ok(body.includes(`'${d}'`), `decision set must include ${d}`);
  }
  // CONFIRMED is reachable only with an active, every-minute job on the suspect host.
  const confirmed = body.match(/if \(finding\.host === COMMS_SUSPECT_HOST\) \{[\s\S]*?decision = 'CONFIRMED';/);
  assert.ok(confirmed, 'CONFIRMED must be gated on the suspect host');
  assert.match(body, /finding\.job\.active !== true[\s\S]*?decision = 'DISPROVED'/);
  assert.match(body, /finding\.job\.schedule !== COMMS_EXPECTED_SCHEDULE[\s\S]*?decision = 'DISPROVED'/);
});

test('the probe targets the communications scheduler by its exact canonical name', () => {
  assert.match(src, /const COMMS_JOB_NAME = 'carup-communication-worker-every-minute'/);
  assert.match(src, /const COMMS_EXPECTED_SCHEDULE = '\* \* \* \* \*'/);
  assert.match(src, /const COMMS_SUSPECT_HOST = 'carup-backend-staging\.vercel\.app'/);
});
