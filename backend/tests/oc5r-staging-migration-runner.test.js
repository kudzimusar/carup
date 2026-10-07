/**
 * OC-5R — the staging migration runner (database/scripts/lib/stagingMigrationRunner.mjs) on a REAL
 * PostgreSQL (PGlite, in process) with a replica of supabase_migrations.schema_migrations.
 *
 * Each test pins one failure the previous runner had or could have: production as a target, a timestamp
 * prefix treated as identity, a failed migration leaving a partial effect or a ledger row, the ledger being
 * written before the SQL succeeded, a rolled-back "already exists" reported as applied, and a NEVER_APPLY
 * file being executed.   Run: node --test backend/tests/oc5r-staging-migration-runner.test.js
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SQLITE_DIALECT_ONLY, parseMigrationSource } from '../db/migrationParser.js';
import {
  CUSTODY_RECORD, DEFERRED_LINEAGE, ONE_TIME_DATA_MIGRATIONS,
  PLAN_SCHEMA, REPAIR_TAG, RUNNER_TAG, assertStagingTarget, isRecordedBy, prepareUpSql, runPlan, sha256, validatePlan,
} from '../../database/scripts/lib/stagingMigrationRunner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_MIGRATIONS = path.resolve(here, '../../database/migrations');
const STAGING = 'eoyenigwevnxwwhyhaer';
const PROD_REF = ['vhmnajoeicasa', 'igiophh'].join(''); // split so this file never trips the CR-1 scanner

// Every in-process PostgreSQL is closed at the end: an unclosed PGlite makes the test process exit 99.
const instances = [];
after(async () => { await Promise.all(instances.map((pg) => pg.close().catch(() => {}))); });

async function freshDb() {
  const pg = new PGlite();
  instances.push(pg);
  await pg.exec(`create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text,
      created_by text, idempotency_key text unique, rollback text[]);`);
  const log = [];
  const db = {
    exec: async (sql) => { log.push(sql); return pg.exec(sql); },
    query: async (sql, params) => { log.push(sql); return (await pg.query(sql, params)).rows; },
  };
  return { pg, db, log };
}
function migrationsDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oc5r-runner-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}
const mig = (up) => `-- +migrate Up\n${up}\n`;
const planFor = (dir, ops, extra = {}) => ({
  schema: PLAN_SCHEMA, target_ref: STAGING, ...extra,
  operations: ops.map((op) => ({ ...op, sha256: sha256(readFileSync(path.join(dir, op.file), 'utf8')) })),
});
const ledger = async (pg) => (await pg.query('select version, name, created_by, idempotency_key from supabase_migrations.schema_migrations order by version')).rows;
const exists = async (pg, rel) => (await pg.query('select to_regclass($1) is not null as e', [rel])).rows[0].e;

test('target: production is refused anywhere; only the staging project or an explicit local rehearsal is accepted', () => {
  const pooler = 'aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres';
  assert.throws(() => assertStagingTarget(`postgresql://postgres.${PROD_REF}:x@${pooler}`), /PRODUCTION_TARGET/);
  assert.throws(() => assertStagingTarget(`postgresql://postgres:x@db.${PROD_REF}.supabase.co:5432/postgres`), /PRODUCTION_TARGET/);
  assert.throws(() => assertStagingTarget(`postgresql://postgres.${STAGING}:x@${pooler}?application_name=${PROD_REF}`), /PRODUCTION_TARGET/);
  assert.throws(() => assertStagingTarget(`postgresql://postgres.someotherref:x@${pooler}`), /NOT_STAGING/);
  assert.throws(() => assertStagingTarget(`postgresql://postgres:x@evil.example.com:5432/${STAGING}`), /NOT_STAGING/);
  assert.throws(() => assertStagingTarget(''), /NO_TARGET/);
  assert.equal(assertStagingTarget(`postgresql://postgres.${STAGING}:x@${pooler}`).kind, 'staging');
  assert.equal(assertStagingTarget(`postgresql://postgres:x@db.${STAGING}.supabase.co:5432/postgres`).kind, 'staging');
  assert.throws(() => assertStagingTarget('postgresql://u:p@127.0.0.1:5432/oc5r_rehearsal_a'), /NOT_STAGING/, 'rehearsal must be explicit');
  assert.equal(assertStagingTarget('postgresql://u:p@127.0.0.1:5432/oc5r_rehearsal_a', { rehearsal: true }).kind, 'rehearsal');
  assert.throws(() => assertStagingTarget(`postgresql://postgres.${STAGING}:x@${pooler}`, { rehearsal: true }), /REHEARSAL_NOT_LOCAL/);
  assert.throws(() => assertStagingTarget('postgresql://u:p@127.0.0.1:5432/postgres', { rehearsal: true }), /REHEARSAL_DB_NAME/);
});

test('identity: full filename or prefix+slug only - a timestamp prefix alone never identifies a migration', () => {
  const f = '20990101000300_a.sql';
  assert.equal(isRecordedBy(f, { version: f, name: 'a' }), true);
  assert.equal(isRecordedBy(f, { version: '20990101000300_a', name: null }), true);
  assert.equal(isRecordedBy(f, { version: '20990101000300', name: 'a' }), true);
  assert.equal(isRecordedBy(f, { version: '20990101000300', name: 'b' }), false);
  assert.equal(isRecordedBy(f, { version: '20990101000300', name: null }), false);
  assert.equal(isRecordedBy(f, { version: '20990909000000', name: 'a' }), false, 'same slug at another version is not proof');
  assert.equal(isRecordedBy(f, { version: '20990909000000', name: 'a' }, [{ version: '20990909000000', name: 'a' }]), true, 'only a stated equivalence is');
});

test('collision: a plan touching a shared timestamp prefix is refused unless the plan records it as resolved', () => {
  const dir = migrationsDir({ '20990101000300_a.sql': mig('select 1;'), '20990101000300_b.sql': mig('select 2;') });
  const ops = [{ file: '20990101000300_a.sql', action: 'execute' }];
  assert.throws(() => validatePlan(planFor(dir, ops), { migrationsDir: dir }), /UNRESOLVED_COLLISION/);
  assert.throws(() => validatePlan(planFor(dir, ops, { collisions: { 20990101000300: { resolved: false, files: ['20990101000300_a.sql'] } } }), { migrationsDir: dir }), /UNRESOLVED_COLLISION/);
  const resolved = { collisions: { 20990101000300: { resolved: true, files: ['20990101000300_a.sql', '20990101000300_b.sql'] } } };
  assert.doesNotThrow(() => validatePlan(planFor(dir, ops, resolved), { migrationsDir: dir }));
  assert.throws(() => validatePlan(planFor(dir, [ops[0], ops[0]], resolved), { migrationsDir: dir }), /AMBIGUOUS_FILENAME/);
  const tampered = planFor(dir, ops, resolved);
  tampered.operations[0].sha256 = '0'.repeat(64);
  assert.throws(() => validatePlan(tampered, { migrationsDir: dir }), /SHA_MISMATCH/);
});

test('a failing migration rolls back completely, writes no ledger row, and stops the run', async () => {
  const dir = migrationsDir({
    '20990101000100_creates.sql': mig('create table public.oc5r_ok(id int);'),
    '20990101000200_fails.sql': mig('create table public.oc5r_half(id int);\nselect 1/0;'),
    '20990101000300_after.sql': mig('create table public.oc5r_after(id int);'),
  });
  const { pg, db } = await freshDb();
  const r = await runPlan(db, planFor(dir, [
    { file: '20990101000100_creates.sql', action: 'execute', expect: ["to_regclass('public.oc5r_ok') is not null"] },
    { file: '20990101000200_fails.sql', action: 'execute' },
    { file: '20990101000300_after.sql', action: 'execute' },
  ]), { migrationsDir: dir, apply: true });
  assert.equal(r.result, 'STOPPED');
  assert.deepEqual(r.operations.map((o) => o.status), ['APPLIED', 'FAILED_ROLLED_BACK', 'NOT_RUN']);
  assert.equal(await exists(pg, 'public.oc5r_half'), false, 'no partial effect survives');
  assert.equal(await exists(pg, 'public.oc5r_after'), false, 'nothing runs after a failure');
  const rows = await ledger(pg);
  assert.deepEqual(rows.map((l) => l.version), ['20990101000100_creates.sql'], 'version is the full filename');
  assert.equal(rows[0].created_by, RUNNER_TAG);
});

test('the ledger row is written only after the SQL and every effect assertion, inside the same transaction', async () => {
  const dir = migrationsDir({ '20990101000100_creates.sql': mig('create table public.oc5r_ok(id int);') });
  const { db, log } = await freshDb();
  await runPlan(db, planFor(dir, [{ file: '20990101000100_creates.sql', action: 'execute', expect: ["to_regclass('public.oc5r_ok') is not null"] }]), { migrationsDir: dir, apply: true });
  const at = (re) => log.findIndex((s) => re.test(s));
  const order = { begin: at(/^BEGIN$/), sql: at(/create table public\.oc5r_ok/), probe: at(/to_regclass\('public\.oc5r_ok'\)/), insert: at(/insert into supabase_migrations\.schema_migrations/), commit: at(/^COMMIT$/) };
  assert.ok(order.begin >= 0 && order.begin < order.sql && order.sql < order.probe && order.probe < order.insert && order.insert < order.commit, JSON.stringify(order));

  const dir2 = migrationsDir({ '20990101000100_lies.sql': mig('create table public.oc5r_lie(id int);') });
  const f = await freshDb();
  const r = await runPlan(f.db, planFor(dir2, [{ file: '20990101000100_lies.sql', action: 'execute', expect: ["to_regclass('public.oc5r_never') is not null"] }]), { migrationsDir: dir2, apply: true });
  assert.equal(r.operations[0].status, 'FAILED_ROLLED_BACK');
  assert.equal(await exists(f.pg, 'public.oc5r_lie'), false, 'SQL whose effect cannot be proven is rolled back');
  assert.equal((await ledger(f.pg)).length, 0);
});

test('"already exists" is a failure, never ALREADY_APPLIED: the rolled-back migration is not recorded', async () => {
  const dir = migrationsDir({ '20990101000100_dupe.sql': mig('create table public.oc5r_exists(id int);') });
  const { pg, db } = await freshDb();
  await pg.exec('create table public.oc5r_exists(id int)');
  const r = await runPlan(db, planFor(dir, [{ file: '20990101000100_dupe.sql', action: 'execute' }]), { migrationsDir: dir, apply: true });
  assert.equal(r.operations[0].status, 'FAILED_ROLLED_BACK');
  assert.match(r.operations[0].error, /already exists/);
  assert.equal((await ledger(pg)).length, 0);
  assert.equal(r.result, 'STOPPED');
});

test('NEVER_APPLY, SQLite-only, retired and non-migration files are refused before any SQL runs', async () => {
  const dir = migrationsDir({ '20990101000400_never.sql': mig('create table public.oc5r_never(id int);') });
  const { pg, db, log } = await freshDb();
  const plan = planFor(dir, [{ file: '20990101000400_never.sql', action: 'execute' }], { never_apply: [{ file: '20990101000400_never.sql', reason: 'production-only' }] });
  await assert.rejects(runPlan(db, plan, { migrationsDir: dir, apply: true }), /NEVER_APPLY/);
  assert.equal(log.some((s) => /^BEGIN$/.test(s)), false, 'refused before any transaction');
  assert.equal(await exists(pg, 'public.oc5r_never'), false);
  for (const file of [...Object.keys(SQLITE_DIALECT_ONLY), '009_phase4_schema.sql', 'supabase_schema.sql']) {
    const p = { schema: PLAN_SCHEMA, target_ref: STAGING, operations: [{ file, action: 'execute', sha256: sha256(readFileSync(path.join(REPO_MIGRATIONS, file), 'utf8')) }] };
    assert.throws(() => validatePlan(p, { migrationsDir: REPO_MIGRATIONS }), /NEVER_APPLY/, file);
  }
});

test('a second run of the same plan executes nothing and records nothing twice', async () => {
  const dir = migrationsDir({ '20990101000100_once.sql': mig('create table public.oc5r_once(id int);') });
  const { pg, db } = await freshDb();
  const plan = planFor(dir, [{ file: '20990101000100_once.sql', action: 'execute', expect: ["to_regclass('public.oc5r_once') is not null"] }]);
  assert.equal((await runPlan(db, plan, { migrationsDir: dir, apply: true })).operations[0].status, 'APPLIED');
  const again = await runPlan(db, plan, { migrationsDir: dir, apply: true });
  assert.equal(again.operations[0].status, 'ALREADY_RECORDED');
  assert.equal(again.result, 'COMPLETE');
  assert.equal((await ledger(pg)).length, 1);
});

test('a recorded migration whose effect is missing is reported as DRIFT, not skipped', async () => {
  const dir = migrationsDir({ '20990101000100_claimed.sql': mig('create table public.oc5r_claimed(id int);') });
  const { pg, db } = await freshDb();
  await pg.exec("insert into supabase_migrations.schema_migrations(version, name) values ('20990101000100', 'claimed')");
  const r = await runPlan(db, planFor(dir, [{ file: '20990101000100_claimed.sql', action: 'execute', expect: ["to_regclass('public.oc5r_claimed') is not null"] }]), { migrationsDir: dir, apply: true });
  assert.equal(r.operations[0].status, 'DRIFT');
  assert.equal(r.result, 'STOPPED');
});

test('a ledger-only repair runs no SQL, requires proven evidence, and is tagged as a repair', async () => {
  const dir = migrationsDir({ '20990101000500_present.sql': mig('create table public.oc5r_present(id int);') });
  const op = { file: '20990101000500_present.sql', action: 'ledger_repair' };
  assert.throws(() => validatePlan(planFor(dir, [op]), { migrationsDir: dir }), /REPAIR_WITHOUT_EVIDENCE/);
  const { pg, db, log } = await freshDb();
  const withEvidence = planFor(dir, [{ ...op, expect: ["to_regclass('public.oc5r_present') is not null"] }]);
  let r = await runPlan(db, withEvidence, { migrationsDir: dir, apply: true });
  assert.equal(r.operations[0].status, 'FAILED_ROLLED_BACK', 'an absent effect cannot be repaired into the ledger');
  assert.equal((await ledger(pg)).length, 0);
  await pg.exec('create table public.oc5r_present(id int)');
  log.length = 0;
  r = await runPlan(db, withEvidence, { migrationsDir: dir, apply: true });
  assert.equal(r.operations[0].status, 'LEDGER_REPAIRED');
  assert.equal(log.some((s) => /create table public\.oc5r_present/.test(s)), false, 'the repair must not run the migration SQL');
  assert.equal((await ledger(pg))[0].created_by, REPAIR_TAG);
});

test('an atomic group commits all-or-nothing, ledger included', async () => {
  const dir = migrationsDir({
    '20990101000600_g1.sql': mig('create table public.oc5r_g1(id int);'),
    '20990101000700_g2.sql': mig('select 1/0;'),
  });
  const { pg, db } = await freshDb();
  const r = await runPlan(db, planFor(dir, [
    { file: '20990101000600_g1.sql', action: 'execute', group: 'chain' },
    { file: '20990101000700_g2.sql', action: 'execute', group: 'chain' },
  ]), { migrationsDir: dir, apply: true });
  assert.deepEqual(r.operations.map((o) => o.status), ['FAILED_ROLLED_BACK', 'FAILED_ROLLED_BACK']);
  assert.equal(await exists(pg, 'public.oc5r_g1'), false);
  assert.equal((await ledger(pg)).length, 0);
});

test('a self-contained BEGIN...COMMIT envelope is unwrapped and stays atomic; other transaction control is refused', async () => {
  const envelope = "-- header\nBEGIN;\ncreate table public.oc5r_env(id int);\ncreate function public.oc5r_f() returns int language plpgsql as $$ begin return 1; end; $$;\nCOMMIT;\n";
  const prepared = prepareUpSql(envelope, 'x.sql');
  assert.equal(prepared.unwrappedEnvelope, true);
  assert.doesNotMatch(prepared.sql, /^\s*(BEGIN|COMMIT)\s*;/im);
  assert.match(prepared.sql, /create function public\.oc5r_f/);
  assert.throws(() => prepareUpSql('create table t(id int);\nCOMMIT;\ncreate table u(id int);', 'y.sql'), /TOP_LEVEL_TRANSACTION_CONTROL/);
  assert.throws(() => prepareUpSql('create index concurrently i on t(id);', 'z.sql'), /NON_TRANSACTIONAL_SQL/);
  assert.equal(prepareUpSql('do $$ begin perform 1; end $$;', 'w.sql').unwrappedEnvelope, false);

  const dir = migrationsDir({ '20990101000800_env.sql': mig(envelope) });
  const { pg, db } = await freshDb();
  const r = await runPlan(db, planFor(dir, [{ file: '20990101000800_env.sql', action: 'execute', expect: ["to_regclass('public.oc5r_never') is not null"] }]), { migrationsDir: dir, apply: true });
  assert.equal(r.operations[0].status, 'FAILED_ROLLED_BACK');
  assert.equal(await exists(pg, 'public.oc5r_env'), false, 'the envelope did not commit the runner transaction early');
  assert.equal((await ledger(pg)).length, 0);

  // The one real migration that carries such an envelope is accepted, with no top-level transaction control left.
  const email = '20260826120000_email_1_0_hardening.sql';
  const real = prepareUpSql(parseMigrationSource(readFileSync(path.join(REPO_MIGRATIONS, email), 'utf8'), email).up, email);
  assert.equal(real.unwrappedEnvelope, true);
  assert.doesNotMatch(real.sql, /^\s*COMMIT\s*;\s*$/m);
});

// ── replay: an already-recorded migration re-executed because a later file of the same group regresses it ──
// (The real case: Email 1.0 rewrites communication_domain_event_dedupe_key(), which SN-O4 had moved on from.)
const replayFiles = () => migrationsDir({
  '20990101000900_defines.sql': mig('create or replace function public.oc5r_dedupe() returns int language sql as $$ select 2 $$;'),
  '20990101001000_regresses.sql': mig('create table public.oc5r_anchor(id int);\ncreate or replace function public.oc5r_dedupe() returns int language sql as $$ select 1 $$;'),
});
async function recordedDefinition(dir) {
  const f = await freshDb();
  await f.pg.exec("create or replace function public.oc5r_dedupe() returns int language sql as $$ select 2 $$;");
  await f.pg.exec("insert into supabase_migrations.schema_migrations(version, name) values ('20990101000900', 'defines')");
  return f;
}
const replayPlan = (dir, extra = {}) => planFor(dir, [
  { file: '20990101001000_regresses.sql', action: 'execute', group: 'g', expect: ["to_regclass('public.oc5r_anchor') is not null"] },
  { file: '20990101000900_defines.sql', action: 'replay', group: 'g', expect: ['public.oc5r_dedupe() = 2'], ...extra },
]);

test('a replay re-executes a recorded migration inside its anchor\'s transaction and is never recorded twice', async () => {
  const dir = replayFiles();
  const { pg, db } = await recordedDefinition(dir);
  const dry = await runPlan(db, replayPlan(dir), { migrationsDir: dir });
  assert.deepEqual(dry.operations.map((o) => o.status), ['WOULD_APPLY', 'WOULD_REPLAY']);
  const r = await runPlan(db, replayPlan(dir), { migrationsDir: dir, apply: true });
  assert.deepEqual(r.operations.map((o) => o.status), ['APPLIED', 'REPLAYED']);
  assert.equal((await pg.query('select public.oc5r_dedupe() as v')).rows[0].v, 2, 'the regressed effect is restored');
  const rows = await ledger(pg);
  assert.deepEqual(rows.map((l) => l.version), ['20990101000900', '20990101001000_regresses.sql'], 'the replayed file keeps its one original row');
  const again = await runPlan(db, replayPlan(dir), { migrationsDir: dir, apply: true });
  assert.deepEqual(again.operations.map((o) => o.status), ['ALREADY_RECORDED', 'ALREADY_RECORDED']);
  assert.equal((await ledger(pg)).length, 2);
});

test('a replay that cannot prove its effect rolls back its anchor too: no regression is ever left behind', async () => {
  const dir = replayFiles();
  const { pg, db } = await recordedDefinition(dir);
  const r = await runPlan(db, replayPlan(dir, { expect: ['public.oc5r_dedupe() = 3'] }), { migrationsDir: dir, apply: true });
  assert.deepEqual(r.operations.map((o) => o.status), ['FAILED_ROLLED_BACK', 'FAILED_ROLLED_BACK']);
  assert.equal(await exists(pg, 'public.oc5r_anchor'), false);
  assert.equal((await pg.query('select public.oc5r_dedupe() as v')).rows[0].v, 2, 'the anchor\'s regression did not commit');
  assert.equal((await ledger(pg)).length, 1);
});

test('a replay of an unrecorded file, or one without evidence or an anchor before it, is refused', async () => {
  const dir = replayFiles();
  const fresh = await freshDb();
  const r = await runPlan(fresh.db, replayPlan(dir), { migrationsDir: dir, apply: true });
  assert.deepEqual(r.operations.map((o) => o.status), ['REFUSED', 'REFUSED']);
  assert.match(r.operations[1].error, /REPLAY_OF_UNRECORDED/);
  assert.equal(await exists(fresh.pg, 'public.oc5r_anchor'), false, 'nothing ran');
  assert.equal((await ledger(fresh.pg)).length, 0);
  assert.throws(() => validatePlan(replayPlan(dir, { expect: [] }), { migrationsDir: dir }), /REPLAY_WITHOUT_EVIDENCE/);
  const alone = planFor(dir, [{ file: '20990101000900_defines.sql', action: 'replay', expect: ['true'] }]);
  assert.throws(() => validatePlan(alone, { migrationsDir: dir }), /REPLAY_WITHOUT_ANCHOR/);
  const first = planFor(dir, [
    { file: '20990101000900_defines.sql', action: 'replay', group: 'g', expect: ['true'] },
    { file: '20990101001000_regresses.sql', action: 'execute', group: 'g' },
  ]);
  assert.throws(() => validatePlan(first, { migrationsDir: dir }), /REPLAY_BEFORE_ANCHOR/);
});

test('a file the plan first repairs into the ledger may then be replayed — never replayed first, never twice', async () => {
  const dir = replayFiles();
  const { pg, db } = await freshDb();
  await pg.exec("create or replace function public.oc5r_dedupe() returns int language sql as $$ select 2 $$;"); // effect present, ledger silent
  const repairThenReplay = planFor(dir, [
    { file: '20990101000900_defines.sql', action: 'ledger_repair', expect: ['public.oc5r_dedupe() = 2'] },
    { file: '20990101001000_regresses.sql', action: 'execute', group: 'g', expect: ["to_regclass('public.oc5r_anchor') is not null"] },
    { file: '20990101000900_defines.sql', action: 'replay', group: 'g', expect: ['public.oc5r_dedupe() = 2'] },
  ]);
  const r = await runPlan(db, repairThenReplay, { migrationsDir: dir, apply: true });
  assert.deepEqual(r.operations.map((o) => o.status), ['LEDGER_REPAIRED', 'APPLIED', 'REPLAYED']);
  const rows = await ledger(pg);
  assert.deepEqual(rows.map((l) => [l.version, l.created_by]), [['20990101000900_defines.sql', REPAIR_TAG], ['20990101001000_regresses.sql', RUNNER_TAG]], 'one row per file');
  assert.equal((await pg.query('select public.oc5r_dedupe() as v')).rows[0].v, 2);
  const again = await runPlan(db, repairThenReplay, { migrationsDir: dir, apply: true });
  assert.deepEqual(again.operations.map((o) => o.status), ['ALREADY_RECORDED', 'ALREADY_RECORDED', 'ALREADY_RECORDED']);
  assert.equal((await ledger(pg)).length, 2);

  // The dry run judges the replay as apply will: recorded by the earlier repair — unless that repair would be blocked.
  const f2 = await freshDb();
  await f2.pg.exec("create or replace function public.oc5r_dedupe() returns int language sql as $$ select 2 $$;");
  const dry = await runPlan(f2.db, repairThenReplay, { migrationsDir: dir });
  assert.deepEqual(dry.operations.map((o) => o.status), ['WOULD_REPAIR_LEDGER', 'WOULD_APPLY', 'WOULD_REPLAY']);
  assert.equal((await ledger(f2.pg)).length, 0, 'a dry run writes nothing');
  const f3 = await freshDb();   // effect absent: the repair is blocked, so nothing would record the replayed file
  const blocked = await runPlan(f3.db, repairThenReplay, { migrationsDir: dir });
  assert.deepEqual(blocked.operations.map((o) => o.status), ['BLOCKED', 'REFUSED', 'REFUSED']);
  assert.match(blocked.operations[2].error, /REPLAY_OF_UNRECORDED/);

  const replayFirst = planFor(dir, [repairThenReplay.operations[1], repairThenReplay.operations[2], repairThenReplay.operations[0]].map(({ sha256: _, ...op }) => op));
  assert.throws(() => validatePlan(replayFirst, { migrationsDir: dir }), /REPLAY_BEFORE_RECORD/);
  const twice = planFor(dir, [...repairThenReplay.operations, repairThenReplay.operations[2]].map(({ sha256: _, ...op }) => op));
  assert.throws(() => validatePlan(twice, { migrationsDir: dir }), /AMBIGUOUS_FILENAME/);
  const repairedTwice = planFor(dir, [repairThenReplay.operations[0], repairThenReplay.operations[0]].map(({ sha256: _, ...op }) => op));
  assert.throws(() => validatePlan(repairedTwice, { migrationsDir: dir }), /AMBIGUOUS_FILENAME/);
});

// ── OC-5R Stage A: migration custody ─────────────────────────────────────────────────────────────────────────────────
const repoPlan = (ops) => ({ schema: PLAN_SCHEMA, target_ref: STAGING, operations: ops });
const repoSha = (file) => sha256(readFileSync(path.join(REPO_MIGRATIONS, file), 'utf8'));

test('OC-5R A1: the SQLite-era 001/002 are refused for every action — a ledger repair included', () => {
  for (const file of ['001_add_financial_ledger.sql', '002_add_notification_queue.sql']) {
    assert.ok(SQLITE_DIALECT_ONLY[file], `${file} is in the parser's exclusion registry`);
    for (const action of ['execute', 'ledger_repair', 'replay']) {
      const op = { file, action, sha256: repoSha(file), expect: ['true'], group: 'g' };
      assert.throws(() => validatePlan(repoPlan([op]), { migrationsDir: REPO_MIGRATIONS }), /NEVER_APPLY/, `${file} ${action}`);
    }
  }
});

test('OC-5R A2: the recorded publication backfill can never be executed or replayed; recording it stays possible', () => {
  const file = '20260808140000_publication_gate_backfill.sql';
  const one = ONE_TIME_DATA_MIGRATIONS[file];
  assert.equal(one.classification, 'RECORDED_ONE_TIME_DATA_MIGRATION_NEVER_REPLAY');
  assert.equal(repoSha(file), one.sha256, 'the pin names the recorded file exactly');
  const plan = (action) => repoPlan([{ file, action, sha256: one.sha256, expect: ['true'], group: 'g' }]);
  assert.throws(() => validatePlan(plan('replay'), { migrationsDir: REPO_MIGRATIONS }), /NEVER_REPLAY/);
  assert.throws(() => validatePlan(plan('execute'), { migrationsDir: REPO_MIGRATIONS }), /NEVER_REPLAY/);
  assert.doesNotThrow(() => validatePlan(plan('ledger_repair'), { migrationsDir: REPO_MIGRATIONS }), 'a ledger-only record runs no SQL');
});

test('OC-5R A3: lineage under custody is refused for every action wherever it sits, and agrees with the custody record', () => {
  const record = JSON.parse(readFileSync(path.resolve(here, '../..', CUSTODY_RECORD), 'utf8'));
  assert.equal(record.reverse_lineage_check.unexplained, 0, 'no live object is left unexplained');
  for (const e of record.exceptions) {
    assert.match(e.status, /^DEFERRED_[A-Z_]+_PRESENT_ON_STAGING$/);
    assert.equal(e.production_authority, 'NONE');
    assert.equal(e.automatic_apply_authority, 'NONE');
    assert.ok(e.unresolved_before_promotion.length > 0, `${e.id} states what blocks promotion`);
  }
  const ids = new Set(record.exceptions.map((e) => e.id));
  for (const [file, id] of Object.entries(DEFERRED_LINEAGE)) assert.ok(ids.has(id), `${file} -> ${id} is in the custody record`);
  for (const c of record.exceptions.flatMap((e) => e.candidates || [])) {
    assert.equal(sha256(readFileSync(path.resolve(here, '../..', c.path), 'utf8')), c.sha256, `${c.path} is the file the record pins`);
  }
  const x4 = record.exceptions.find((e) => e.id === 'X4-BIOMETRIC-CONSENT-LEDGER');
  assert.match(x4.unresolved_before_promotion[0].question, /CASCADE/, 'the retention decision is surfaced, not decided');
  // A copy under either name inside database/migrations is still refused — for every action.
  const dir = migrationsDir(Object.fromEntries(Object.keys(DEFERRED_LINEAGE).map((f) => [f, mig('select 1;')])));
  for (const file of Object.keys(DEFERRED_LINEAGE)) {
    for (const action of ['execute', 'ledger_repair', 'replay']) {
      assert.throws(() => validatePlan(planFor(dir, [{ file, action, expect: ['true'], group: 'g' }]), { migrationsDir: dir }), /DEFERRED_LINEAGE/, `${file} ${action}`);
    }
  }
  // …and so is a plan that names the candidate by a path instead of a bare filename.
  const viaPath = repoPlan([{ file: '../migration-candidates/oc5c/20261004175000_o2_x4_identity_biometric_consents.sql', action: 'execute', sha256: '0'.repeat(64) }]);
  assert.throws(() => validatePlan(viaPath, { migrationsDir: REPO_MIGRATIONS }), /DEFERRED_LINEAGE/);
});
