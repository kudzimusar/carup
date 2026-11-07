// CARUP-DEALER-ONB-001-LR01-R6 DBA review 2 #9: the dealership migration runner refuses shared
// databases by default and runs one transaction per migration. Pure tests + a recording client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseRunnerArgs, assertSafeTarget, splitMigration, listDealerMigrations, planMigrations, runDealerMigrations,
} from '../scripts/dealership/applyDealerMigrations.mjs';

test('the target comes only from --url or DEALER_MIGRATION_DATABASE_URL, never DATABASE_URL', () => {
  assert.throws(() => parseRunnerArgs([], { DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/x' }), /TARGET_URL_REQUIRED/);
  assert.equal(parseRunnerArgs([], { DEALER_MIGRATION_DATABASE_URL: 'postgresql://u@127.0.0.1/d' }).url, 'postgresql://u@127.0.0.1/d');
  const o = parseRunnerArgs(['--url', 'postgresql://u@127.0.0.1:55482/d', '--direction=down', '--dry-run']);
  assert.deepEqual([o.direction, o.dryRun, o.allowNonLoopback], ['down', true, false]);
  assert.throws(() => parseRunnerArgs(['--url', 'postgresql://u@127.0.0.1/d', '--direction', 'sideways']), /INVALID_DIRECTION/);
  assert.throws(() => parseRunnerArgs(['--url', 'postgresql://u@127.0.0.1/d', '--force']), /UNKNOWN_ARGUMENT/);
  assert.throws(() => parseRunnerArgs(['--url', 'postgresql://u@127.0.0.1/d', '--only', '../../etc/passwd']), /INVALID_MIGRATION_NAME/);
});

test('loopback targets are accepted; every other host is refused by default', () => {
  for (const h of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(assertSafeTarget(`postgresql://u@${h}:55482/db`).loopback, true);
  for (const url of [
    'postgresql://postgres:x@db.abcdefghijklmnop.supabase.co:5432/postgres',
    'postgresql://u@10.0.0.5:5432/db',
    'postgresql://u@staging.example.invalid/db',
  ]) assert.throws(() => assertSafeTarget(url), /NON_LOOPBACK_TARGET_REFUSED/);
});

test('a non-loopback target needs BOTH the flag and an exact typed confirmation', () => {
  const url = 'postgresql://postgres:x@clone.example.invalid:5432/rehearsal';
  assert.throws(() => assertSafeTarget(url, { allowNonLoopback: true }), /TARGET_CONFIRMATION_MISMATCH/);
  assert.throws(() => assertSafeTarget(url, { allowNonLoopback: true, confirmTarget: 'clone.example.invalid/rehearsal' }), /TARGET_CONFIRMATION_MISMATCH/);
  assert.throws(() => assertSafeTarget(url, { confirmTarget: 'clone.example.invalid:5432/rehearsal' }), /NON_LOOPBACK_TARGET_REFUSED/);
  assert.equal(assertSafeTarget(url, { allowNonLoopback: true, confirmTarget: 'clone.example.invalid:5432/rehearsal' }).target,
    'clone.example.invalid:5432/rehearsal');
});

test('a transaction-pooler endpoint is refused even when confirmed', () => {
  for (const url of [
    'postgresql://u@aws-0-eu.pooler.supabase.com:6543/postgres',
    'postgresql://u@aws-0-eu.pooler.supabase.com:5432/postgres',
    'postgresql://u@127.0.0.1:6543/postgres',
  ]) {
    assert.throws(() => assertSafeTarget(url, { allowNonLoopback: true, confirmTarget: 'x' }), /DIRECT_SESSION_CONNECTION_REQUIRED/);
  }
});

test('both migration markers are mandatory and the dealership list is ordered', () => {
  assert.throws(() => splitMigration('CREATE TABLE x();', 'x'), /MIGRATION_MARKERS_REQUIRED/);
  assert.throws(() => splitMigration('-- +migrate Up\nSELECT 1;', 'x'), /MIGRATION_MARKERS_REQUIRED/);
  const s = splitMigration('-- +migrate Up\nSELECT 1;\n-- +migrate Down\nSELECT 2;\n');
  assert.match(s.up, /SELECT 1/); assert.match(s.down, /SELECT 2/); assert.doesNotMatch(s.up, /SELECT 2/);
  const names = listDealerMigrations();
  assert.ok(names.length >= 22, 'all dealership migrations are listed');
  assert.deepEqual(names, [...names].sort());
  assert.ok(names.every((n) => n.startsWith('20261103')));
  for (const n of names) splitMigration(readFile(n), n);
  assert.deepEqual(planMigrations({ direction: 'down' }), [...names].reverse());
  assert.throws(() => planMigrations({ only: '20261103999999_dealer_missing.sql' }), /UNKNOWN_MIGRATION/);
});

function readFile(n) {
  return readFileSync(new URL(`../../database/migrations/${n}`, import.meta.url), 'utf8');
}

test('one transaction per migration; a failure rolls back that migration and stops the run', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dealer-runner-'));
  writeFileSync(path.join(dir, '20261103000001_dealer_a.sql'), '-- +migrate Up\nUP A;\n-- +migrate Down\nDOWN A;\n');
  writeFileSync(path.join(dir, '20261103000002_dealer_b.sql'), '-- +migrate Up\nUP B FAILS;\n-- +migrate Down\nDOWN B;\n');
  writeFileSync(path.join(dir, '20261103000003_dealer_c.sql'), '-- +migrate Up\nUP C;\n-- +migrate Down\nDOWN C;\n');
  const calls = [];
  const client = { async query(sql) { calls.push(sql.trim()); if (sql.includes('FAILS')) throw Object.assign(new Error('boom'), { code: '55P03' }); return { rows: [] }; } };
  await assert.rejects(runDealerMigrations(client, planMigrations({}, dir), 'up', { dir, log: () => {} }),
    (e) => e.code === '55P03' && e.migration === '20261103000002_dealer_b.sql');
  assert.deepEqual(calls.map((c) => c.split('\n').filter((l) => !l.startsWith('-- +migrate')).join(' ')),
    ['BEGIN', 'UP A;', 'COMMIT', 'BEGIN', 'UP B FAILS;', 'ROLLBACK']);
  calls.length = 0;
  await runDealerMigrations({ async query(sql) { calls.push(sql.trim()); return { rows: [] }; } },
    planMigrations({ direction: 'down' }, dir), 'down', { dir, log: () => {} });
  assert.deepEqual(calls.filter((c) => c.includes('DOWN')).map((c) => c.split('\n').pop()), ['DOWN C;', 'DOWN B;', 'DOWN A;']);
});
