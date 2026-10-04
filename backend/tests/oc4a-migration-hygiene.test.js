/**
 * OC-4A 1.5 — migration hygiene.
 *
 *   - 003_add_user_sessions.sql and 004_add_tamper_proofing.sql are SQLite (the legacy local dev
 *     database, backend/db/carup.db) living in the PostgreSQL migrations directory. They are NOT edited
 *     (documents and audits cite them as they are): they are enumerated, sha256-PINNED, and refused for
 *     any PostgreSQL target — by the canonical parser, both PostgreSQL runners and the PGlite harness.
 *   - A new SQLite-only file cannot slip in unenumerated: the directory is scanned for SQLite syntax.
 *   - PGlite is first-class (the ledger/evidence harness, database/test checks, a CI job), so it is a
 *     declared root devDependency, pinned to the exact version the lockfile already resolved.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const MIGRATIONS = path.join(REPO, 'database/migrations');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const { SQLITE_DIALECT_ONLY, isSqliteDialectOnly, assertNotSqliteDialect, parseMigrationSource, MigrationIntegrityError } = await import('../db/migrationParser.js');
const { migrationUpSql } = await import('./helpers/pgliteLedgerHarness.js');

const SQLITE_FILES = ['003_add_user_sessions.sql', '004_add_tamper_proofing.sql'];
const opened = [];
after(async () => { for (const db of opened) await db.close(); });

test('OC-4A 1.5 — the SQLite-era files are enumerated, pinned to their exact bytes, and each states why', () => {
  assert.deepEqual(Object.keys(SQLITE_DIALECT_ONLY).sort(), SQLITE_FILES);
  for (const file of SQLITE_FILES) {
    const bytes = readFileSync(path.join(MIGRATIONS, file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), SQLITE_DIALECT_ONLY[file].sha256, `${file} is unchanged`);
    assert.ok(SQLITE_DIALECT_ONLY[file].reason.length > 40, `${file} carries a reason`);
  }
});

test('OC-4A 1.5 — the canonical parser refuses them for PostgreSQL (the default target) and accepts them only for SQLite', () => {
  for (const file of SQLITE_FILES) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    assert.throws(() => parseMigrationSource(sql, file), (err) => err instanceof MigrationIntegrityError && err.code === 'SQLITE_DIALECT_ONLY');
    assert.throws(() => parseMigrationSource(sql, file, { dialect: 'postgres' }), (err) => err.code === 'SQLITE_DIALECT_ONLY');
    assert.ok(parseMigrationSource(sql, file, { dialect: 'sqlite' }).up.length > 0, 'the local SQLite runner keeps its own files');
    // Editing one fails even for the SQLite runner: write a PostgreSQL migration instead.
    assert.throws(() => parseMigrationSource(`${sql}\n-- edited`, file, { dialect: 'sqlite' }), (err) => err.code === 'SQLITE_DIALECT_PIN_BROKEN');
  }
  assert.throws(() => parseMigrationSource('-- +migrate Up\nSELECT 1;', 'x.sql', { dialect: 'oracle' }), (err) => err.code === 'UNKNOWN_DIALECT');
  assert.equal(assertNotSqliteDialect('database/migrations/20260617120000_user_sessions_auth_contract_align.sql'), 'database/migrations/20260617120000_user_sessions_auth_contract_align.sql');
});

test('OC-4A 1.5 — a fresh PostgreSQL harness cannot execute them: refused by name before a byte runs (it used to be a raw syntax error)', async () => {
  // Positive control: the raw SQL really is not PostgreSQL.
  const db = new PGlite();
  opened.push(db);
  const raw = readFileSync(path.join(MIGRATIONS, '004_add_tamper_proofing.sql'), 'utf8').split(/^-- \+migrate Down/m)[0];
  await assert.rejects(() => db.exec(raw), (err) => err.code === '42601', 'SQLite syntax does not parse on PostgreSQL');
  for (const file of SQLITE_FILES) {
    assert.throws(() => migrationUpSql(file), (err) => err.code === 'SQLITE_DIALECT_ONLY', `${file} refused by the PGlite harness`);
  }
});

const SQLITE_SYNTAX = [
  /\bAUTOINCREMENT\b/i,
  /CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS/i,
  /\bRAISE\s*\(\s*(ABORT|FAIL|IGNORE|ROLLBACK)\b/i,
  /datetime\(\s*'now'/i,
  /^\s*PRAGMA\b/im,
];
const stripComments = (sql) => sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('OC-4A 1.5 — every file carrying SQLite-only syntax is enumerated, and every enumerated file carries it (no stale entries)', () => {
  const carriers = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
    .filter((f) => SQLITE_SYNTAX.some((re) => re.test(stripComments(readFileSync(path.join(MIGRATIONS, f), 'utf8'))))).sort();
  assert.deepEqual(carriers, SQLITE_FILES, 'a new SQLite-only file must be enumerated (or rewritten for PostgreSQL)');
  for (const file of SQLITE_FILES) assert.ok(isSqliteDialectOnly(file));
});

test('OC-4A 1.5 pin — no PostgreSQL runner or harness lists a SQLite-only file, and each one asserts the refusal', () => {
  const sources = [
    ...readdirSync(path.join(REPO, 'database/scripts')).filter((f) => f.endsWith('.mjs')).map((f) => `database/scripts/${f}`),
    ...readdirSync(path.join(REPO, 'database/test')).filter((f) => f.endsWith('.mjs')).map((f) => `database/test/${f}`),
    'backend/tests/helpers/pgliteLedgerHarness.js',
  ];
  assert.ok(sources.length > 20, `anti-vacuity: ${sources.length}`);
  for (const rel of sources) {
    const text = read(rel);
    for (const file of SQLITE_FILES) assert.ok(!text.includes(`'${file}'`) && !text.includes(`"${file}"`), `${rel} names ${file}`);
  }
  for (const rel of ['database/scripts/apply_migrations_staging.mjs', 'database/scripts/apply_migrations_production.mjs', 'backend/tests/helpers/pgliteLedgerHarness.js']) {
    assert.match(read(rel), /assertNotSqliteDialect\(/, `${rel} asserts the refusal`);
  }
  // The ONLY runner that parses for SQLite is the local SQLite runner.
  assert.match(read('backend/db/migrate.js'), /parseMigrationSource\(content, path\.basename\(filePath\), \{ dialect: 'sqlite' \}\)/);
});

test('OC-4A 1.5 — PGlite is a declared root devDependency, pinned to exactly the version the lockfile resolves', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const declared = pkg.devDependencies?.['@electric-sql/pglite'];
  assert.match(String(declared), /^\d+\.\d+\.\d+$/, 'an exact version, not a range');
  assert.equal(lock.packages[''].devDependencies['@electric-sql/pglite'], declared, 'the lockfile root agrees');
  assert.equal(lock.packages['node_modules/@electric-sql/pglite'].version, declared, 'the declared version is the resolved one');
  const installed = JSON.parse(readFileSync(path.join(REPO, 'node_modules/@electric-sql/pglite/package.json'), 'utf8')).version;
  assert.equal(installed, declared);
});
