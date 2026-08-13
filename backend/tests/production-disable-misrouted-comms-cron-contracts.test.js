import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Contract tests for the misrouted-production-comms-cron remediation.
 *
 * This script is authorized to make exactly ONE production write, so the blast
 * radius is pinned here against the shipped source (the runner cannot be
 * imported — top-level env guards call process.exit).
 *
 * The invariant being defended: it may unschedule one named job and nothing
 * else. In particular it must NOT repoint the endpoint at production, because
 * that would activate a production queue processor over an 82-event backlog
 * that has never been drained.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(here, '..', 'scripts', 'production-disable-misrouted-comms-cron.mjs');
const src = fs.readFileSync(scriptPath, 'utf8');

/**
 * Forbidden-pattern assertions must judge CODE, not prose. The script's header
 * deliberately explains what it refuses to do — it names domain_events, the
 * worker endpoint and cron.unschedule precisely so a reader understands the
 * blast radius. Scanning raw source would make good documentation fail the
 * safety tests, which is exactly backwards.
 *
 * Block comments are removed wholesale. Line comments are removed only when the
 * `//` starts a line, so the `https?://` inside the hostname-capture SQL string
 * survives intact.
 */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');

test('exactly one cron.unschedule call exists, on the pinned job name', () => {
  const calls = code.match(/cron\.unschedule\(/g) || [];
  assert.equal(calls.length, 1, 'exactly one cron.unschedule call is permitted');
  assert.match(src, /select cron\.unschedule\(\$1\) as unscheduled', \[TARGET_JOB\]/,
    'unschedule must be parameterised on the pinned TARGET_JOB');
  assert.match(src, /const TARGET_JOB = 'carup-communication-worker-every-minute'/);
  assert.match(src, /const EXPECTED_SCHEDULE = '\* \* \* \* \*'/);
  assert.match(src, /const MISROUTED_HOST = 'carup-backend-staging\.vercel\.app'/);
});

test('no cron.schedule — the job is disabled, never recreated or repointed', () => {
  assert.ok(!/cron\.schedule\s*\(/.test(code), 'must not schedule any job');
  assert.ok(!/carup-backend\.vercel\.app/.test(code),
    'must not reference the production backend host: repointing would activate production Communications');
});

test('the endpoint host is asserted to be staging BEFORE any mutation', () => {
  const hostCheck = src.indexOf('if (host !== MISROUTED_HOST)');
  const mutation = src.indexOf('cron.unschedule($1)');
  assert.ok(hostCheck > -1, 'must assert the endpoint host');
  assert.ok(mutation > -1, 'must contain the mutation');
  assert.ok(hostCheck < mutation, 'the host assertion must precede the mutation');

  // Same ordering for the job-shape preconditions.
  for (const guard of ['jobs.length !== 1', "job.schedule !== EXPECTED_SCHEDULE", 'job.active !== true']) {
    const at = src.indexOf(guard);
    assert.ok(at > -1 && at < mutation, `precondition '${guard}' must precede the mutation`);
  }
});

test('no Vault mutation and no secret rotation', () => {
  for (const forbidden of [/vault\.create_secret/i, /vault\.update_secret/i, /vault\.delete_secret/i, /rotate/i]) {
    assert.ok(!forbidden.test(code), `must not contain ${forbidden}`);
  }
});

test('no INSERT/UPDATE/DELETE on application data, and no extension changes', () => {
  for (const forbidden of [
    /\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i,
    /\bcreate\s+extension\b/i, /\bdrop\s+extension\b/i, /\balter\s+extension\b/i,
    /\bdrop\s+table\b/i, /\btruncate\b/i, /\bgrant\b/i,
  ]) {
    assert.ok(!forbidden.test(code), `must not contain ${forbidden}`);
  }
});

test('no migration runner, no domain_events touch, no queue processing', () => {
  assert.ok(!/schema_migrations/i.test(code), 'must not touch the migration ledger');
  assert.ok(!/domain_events/i.test(code), 'must not touch domain_events');
  assert.ok(!/notification_queue/i.test(code), 'must not touch the notification queue');
  assert.ok(!/upSectionOf|MIGRATIONS\b/.test(code), 'must not invoke a migration runner');
  assert.ok(!/internal\/communications\/process/.test(code), 'must not invoke the communications worker');
});

test('the transaction rolls back when a precondition fails, before any write', () => {
  assert.match(src, /await client\.query\('BEGIN'\)/);
  assert.match(src, /await client\.query\('ROLLBACK'\)/);
  assert.match(src, /await client\.query\('COMMIT'\)/);
  // COMMIT happens only after the post-state check.
  const post = src.indexOf("if (after[0].c !== 0)");
  const commit = src.indexOf("await client.query('COMMIT')");
  assert.ok(post > -1 && post < commit, 'post-state verification must precede COMMIT');
  // fail() exits non-zero.
  assert.match(src, /function fail\(msg\) \{[\s\S]*?process\.exit\(1\)/);
});

test('production identity is positively asserted and staging is refused', () => {
  assert.match(src, /const STAGING_REF = 'eoyenigwevnxwwhyhaer'/);
  assert.match(src, /if \(prodRef === STAGING_REF\) fail/);
  assert.match(src, /if \(!url\.includes\(prodRef\)\) fail/);
  assert.match(src, /if \(url\.includes\(STAGING_REF\)\) fail/);
  assert.match(src, /rejectUnauthorized: true/, 'TLS verification must be on');
});

test('the script itself requires the exact authorization phrase', () => {
  assert.match(src, /const AUTH_PHRASE = 'DISABLE MISROUTED PRODUCTION COMMUNICATIONS SCHEDULER'/);
  assert.match(src, /process\.env\.AUTHORIZATION_PHRASE !== AUTH_PHRASE/);
});

test('the decrypted secret is reduced to a hostname in SQL and never logged', () => {
  const columnUses = code.replace(/vault\.decrypted_secrets/g, 'vault.SECRETS_VIEW').match(/decrypted_secret\b/g) || [];
  assert.equal(columnUses.length, 1, 'the decrypted_secret COLUMN may be referenced exactly once');
  assert.match(src, /substring\(decrypted_secret from '\^https\?:\/\/\(\[\^\/\]\+\)'\)/);
  assert.ok(!/regexp_replace\s*\(\s*decrypted_secret/.test(code));
  for (const line of code.match(/console\.log\([^\n]*\)/g) || []) {
    assert.ok(!/decrypted_secret/.test(line), `log must not reference decrypted_secret: ${line}`);
  }
});
