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

// ── R6 DBA review 3 N1: node-pg honours ?host= / ?port= (and other) query parameters, so the
// target the runner approved was not always the server it connected to. ──
import ConnectionParameters from 'pg/lib/connection-parameters.js';
const SESSION_OK = Object.freeze({ schema: 'public', first_schema: 'public', read_only: 'off' });
import { verifyConnectedServer, runFromArgs } from '../scripts/dealership/applyDealerMigrations.mjs';

test('N1: connection-string query parameters cannot redirect an approved loopback target', () => {
  for (const url of [
    'postgresql://postgres@127.0.0.1:55492/postgres?host=aws-0-eu-central-1.pooler.supabase.com&port=6543',
    'postgresql://postgres@localhost:5432/postgres?host=db.abcdefghijklmnop.supabase.co',
    'postgresql://postgres@127.0.0.1:55492/postgres?port=6543',
    'postgresql://postgres@[::1]:55492/postgres?host=10.0.0.5&port=5432',
    'postgresql://postgres@127.0.0.1:55492/postgres?options=-c%20search_path%3Devil',
    'postgresql://postgres@127.0.0.1:55492/postgres?user=other',
    'postgresql://postgres@127.0.0.1:55492/postgres?dbname=other',
    'postgresql://postgres@127.0.0.1:55492/postgres?HOST=db.example.invalid',
  ]) {
    assert.throws(() => assertSafeTarget(url), /CONNECTION_QUERY_PARAMETER_REFUSED/, url);
  }
  const ok = assertSafeTarget('postgresql://postgres@127.0.0.1:55482/carup_dealer_isolated_ci?sslmode=disable');
  assert.deepEqual([ok.host, ok.port, ok.database, ok.loopback], ['127.0.0.1', '55482', 'carup_dealer_isolated_ci', true]);
});

test('N1: the approved target is exactly what node-pg itself would connect to', () => {
  for (const url of [
    'postgresql://postgres@127.0.0.1:55482/carup_dealer_isolated_ci',
    'postgres://u:p%40ss@localhost:55483/d%20b',
    'postgresql://postgres@[::1]:55482/db?sslmode=disable',
  ]) {
    const approved = assertSafeTarget(url);
    const pg = new ConnectionParameters({ connectionString: url });
    assert.deepEqual([approved.host, approved.port, approved.database], [pg.host, String(pg.port), pg.database], url);
  }
});

test('N1: where node-pg and the WHATWG parser disagree, the target is refused', () => {
  // node-pg percent-decodes the host (this reaches localhost) and keeps %2F in the database name.
  assert.throws(() => assertSafeTarget('postgresql://u@%6c%6fcalhost:55482/db'), /TARGET_PARSE_MISMATCH/);
  assert.throws(() => assertSafeTarget('postgresql://u@127.0.0.1:55482/d%2Fx'), /TARGET_PARSE_MISMATCH/);
});

test('N1: an implicit port or database is refused, so PGPORT / PGDATABASE can never pick the target', () => {
  assert.throws(() => assertSafeTarget('postgresql://u@127.0.0.1/db'), /EXPLICIT_PORT_REQUIRED/);
  assert.throws(() => assertSafeTarget('postgresql://u@127.0.0.1:55482'), /DATABASE_NAME_REQUIRED/);
  assert.throws(() => assertSafeTarget('postgresql://u@127.0.0.1:55482/'), /DATABASE_NAME_REQUIRED/);
  assert.throws(() => assertSafeTarget('postgresql://u@%2Ftmp%2Fsock:55482/db'), /NON_LOOPBACK_TARGET_REFUSED|INVALID_TARGET_URL/);
});

test('N1: after connecting, the server itself must be the approved target', () => {
  const loop = assertSafeTarget('postgresql://postgres@127.0.0.1:55482/carup_dealer_isolated_ci');
  assert.doesNotThrow(() => verifyConnectedServer(loop, { ...SESSION_OK, addr: '127.0.0.1', port: 55482, db: 'carup_dealer_isolated_ci' }));
  assert.doesNotThrow(() => verifyConnectedServer(loop, { ...SESSION_OK, addr: '::1', port: 55482, db: 'carup_dealer_isolated_ci' }));
  for (const [row, why] of [
    [{ ...SESSION_OK, addr: '10.0.0.5', port: 55482, db: 'carup_dealer_isolated_ci' }, 'a loopback URL that reached a remote server'],
    [{ ...SESSION_OK, addr: '127.0.0.1', port: 6543, db: 'carup_dealer_isolated_ci' }, 'another port (pooler / tunnel)'],
    [{ ...SESSION_OK, addr: '127.0.0.1', port: 55482, db: 'postgres' }, 'another database'],
    [{ ...SESSION_OK, addr: null, port: 55482, db: 'carup_dealer_isolated_ci' }, 'a Unix-socket session'],
  ]) {
    assert.throws(() => verifyConnectedServer(loop, row), /CONNECTED_SERVER_MISMATCH/, why);
  }
  const remote = assertSafeTarget('postgresql://postgres@clone.example.invalid:5432/rehearsal',
    { allowNonLoopback: true, confirmTarget: 'clone.example.invalid:5432/rehearsal' });
  assert.doesNotThrow(() => verifyConnectedServer(remote, { ...SESSION_OK, addr: '10.20.30.40', port: 5432, db: 'rehearsal' }));
  assert.throws(() => verifyConnectedServer(remote, { ...SESSION_OK, addr: '10.20.30.40', port: 6432, db: 'rehearsal' }), /CONNECTED_SERVER_MISMATCH/);
  assert.throws(() => verifyConnectedServer(remote, { ...SESSION_OK, addr: '10.20.30.40', port: 5432, db: 'postgres' }), /CONNECTED_SERVER_MISMATCH/);
});

test('N1: the runner checks the connected server BEFORE any migration statement and then disconnects', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dealer-runner-n1-'));
  writeFileSync(path.join(dir, '20261103000001_dealer_a.sql'), '-- +migrate Up\nUP A;\n-- +migrate Down\nDOWN A;\n');
  const fake = (identity) => {
    const seen = { sql: [], ended: false, config: null };
    return { seen, createClient: (config) => { seen.config = config; return {
      async connect() {}, async end() { seen.ended = true; },
      async query(sql) { seen.sql.push(sql.trim()); return { rows: [identity] }; } }; } };
  };
  const url = 'postgresql://postgres@127.0.0.1:55482/carup_dealer_isolated_ci';
  const bad = fake({ ...SESSION_OK, addr: '10.0.0.5', port: 55482, db: 'carup_dealer_isolated_ci', usr: 'postgres', v: '17' });
  await assert.rejects(runFromArgs(['--url', url], {}, { createClient: bad.createClient, dir, log: () => {} }), /CONNECTED_SERVER_MISMATCH/);
  assert.equal(bad.seen.sql.some((s) => s === 'BEGIN' || s.includes('UP A')), false, 'no migration statement after a mismatch');
  assert.equal(bad.seen.ended, true, 'the refused connection is closed');
  const good = fake({ ...SESSION_OK, addr: '127.0.0.1', port: 55482, db: 'carup_dealer_isolated_ci', usr: 'postgres', v: '17' });
  await runFromArgs(['--url', url], {}, { createClient: good.createClient, dir, log: () => {} });
  assert.ok(good.seen.sql.includes('BEGIN') && good.seen.sql.some((s) => s.includes('UP A')) && good.seen.ended);
  assert.equal(good.seen.config.connectionString, url, 'the client connects with the validated URL');
  await assert.rejects(runFromArgs(['--url', url + '?port=55483'], {}, { createClient: good.createClient, dir, log: () => {} }),
    /CONNECTION_QUERY_PARAMETER_REFUSED/);
});

// ── R6 DBA review 4 R2: PGOPTIONS='-c search_path=shadow,public' made the runner create objects in
// another schema while it reported APPLIED. ──
import { assertNoSessionOptionEnv, SESSION_OPTION_ENV } from '../scripts/dealership/applyDealerMigrations.mjs';

test('R2: session options injected through the environment are refused before connecting', async () => {
  for (const key of SESSION_OPTION_ENV) {
    assert.throws(() => assertNoSessionOptionEnv({ [key]: '-c search_path=shadow,public' }), /SESSION_OPTION_ENVIRONMENT_REFUSED/, key);
  }
  assert.ok(SESSION_OPTION_ENV.includes('PGOPTIONS'));
  assert.equal(assertNoSessionOptionEnv({ PGOPTIONS: '' }), true, 'an empty value is harmless');
  const saved = process.env.PGOPTIONS;
  process.env.PGOPTIONS = '-c search_path=shadow,public';
  try {
    assert.throws(() => assertNoSessionOptionEnv({}), /SESSION_OPTION_ENVIRONMENT_REFUSED/, 'the real process environment is checked too');
    let created = false;
    await assert.rejects(runFromArgs(['--url', 'postgresql://postgres@127.0.0.1:55482/carup_dealer_isolated_ci'], {},
      { createClient: () => { created = true; return {}; }, log: () => {} }), /SESSION_OPTION_ENVIRONMENT_REFUSED/);
    assert.equal(created, false, 'no connection is attempted');
  } finally {
    if (saved === undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = saved;
  }
});

test('R2: after connecting, objects must land in public and the session must be writable', () => {
  const loop = assertSafeTarget('postgresql://postgres@127.0.0.1:55482/carup_dealer_isolated_ci');
  const base = { addr: '127.0.0.1', port: 55482, db: 'carup_dealer_isolated_ci' };
  assert.doesNotThrow(() => verifyConnectedServer(loop, { ...SESSION_OK, ...base }));
  for (const [row, why] of [
    [{ ...SESSION_OK, ...base, schema: 'shadow', first_schema: 'shadow' }, 'search_path = shadow, public'],
    [{ ...SESSION_OK, ...base, schema: 'public', first_schema: 'shadow' }, 'an empty shadow schema first on the path'],
    [{ ...SESSION_OK, ...base, schema: null, first_schema: null }, 'no schema on the path at all'],
    [{ ...SESSION_OK, ...base, read_only: 'on' }, 'a read-only session default'],
  ]) {
    assert.throws(() => verifyConnectedServer(loop, row), /CONNECTED_SERVER_MISMATCH/, why);
  }
});
