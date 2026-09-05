/**
 * Migration integrity regression suite.
 *
 * Guards the contract established by the Post-Reunification Migration Integrity
 * Closure lane: a migration that cannot be parsed unambiguously must FAIL LOUD,
 * never be silently skipped and never be counted as success.
 *
 * Historical defect this locks out (backend/db/migrate.js, pre-closure):
 *   parseMigration() returned `up: ''` when no `-- +migrate Up` marker was present;
 *   runMigrations() then did `if (!up) { console.warn(...); continue; }`, so the file
 *   was skipped AND left unrecorded AND the run still printed
 *   "All pending migrations applied successfully."
 * Meanwhile database/test/migration_pglite_check.mjs and the dispatcher runners
 * treated the very same marker-less file as "the whole file is the Up section".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  MigrationIntegrityError,
  NON_MIGRATION_FILES,
  KNOWN_TIMESTAMP_PREFIX_COLLISIONS,
  PROVENANCE_PINNED_UNMARKED,
  assertDeterministicVersions,
  deriveVersion,
  findTimestampPrefixCollisions,
  isNonMigrationFile,
  isProvenancePinned,
  isRetiredMigration,
  RETIRED_UNAPPLIABLE,
  parseMigrationSource,
} from '../db/migrationParser.js';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../database/migrations');

function expectIntegrityError(fn, code) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof MigrationIntegrityError, `expected MigrationIntegrityError, got ${err.name}`);
    assert.equal(err.code, code);
    return err;
  }
  assert.fail(`expected MigrationIntegrityError(${code}) but nothing was thrown`);
}

// ---------------------------------------------------------------- failure modes

test('a migration with no Up marker FAILS rather than being skipped', () => {
  const err = expectIntegrityError(
    () => parseMigrationSource('CREATE TABLE t (id int);\n', '001_no_marker.sql'),
    'MISSING_UP_MARKER',
  );
  assert.match(err.message, /001_no_marker\.sql/);
});

test('an empty Up section FAILS', () => {
  expectIntegrityError(
    () => parseMigrationSource('-- +migrate Up\n\n\n-- +migrate Down\nDROP TABLE t;\n', '002_empty_up.sql'),
    'EMPTY_UP_SECTION',
  );
});

test('an Up marker with nothing after it at all FAILS', () => {
  expectIntegrityError(() => parseMigrationSource('-- +migrate Up\n', '003_only_marker.sql'), 'EMPTY_UP_SECTION');
});

test('Down appearing before Up FAILS (malformed boundaries)', () => {
  expectIntegrityError(
    () => parseMigrationSource('-- +migrate Down\nDROP TABLE t;\n-- +migrate Up\nCREATE TABLE t (id int);\n', '004_inverted.sql'),
    'DOWN_BEFORE_UP',
  );
});

test('two Up markers FAIL (ambiguous boundaries)', () => {
  expectIntegrityError(
    () => parseMigrationSource('-- +migrate Up\nSELECT 1;\n-- +migrate Up\nSELECT 2;\n', '005_double_up.sql'),
    'DUPLICATE_UP_MARKER',
  );
});

test('two Down markers FAIL (ambiguous boundaries)', () => {
  expectIntegrityError(
    () => parseMigrationSource('-- +migrate Up\nSELECT 1;\n-- +migrate Down\nSELECT 2;\n-- +migrate Down\nSELECT 3;\n', '006_double_down.sql'),
    'DUPLICATE_DOWN_MARKER',
  );
});

test('an enumerated non-migration FAILS if something tries to execute it', () => {
  expectIntegrityError(() => parseMigrationSource('CREATE TABLE t (id int);', 'supabase_schema.sql'), 'NON_MIGRATION_FILE');
});

test('duplicate versions in a migration set FAIL', () => {
  expectIntegrityError(
    () => assertDeterministicVersions(['20260101000000_a.sql', '20260101000000_a.sql']),
    'AMBIGUOUS_VERSION',
  );
});

// ---------------------------------------------------------------- happy paths

test('a well-formed migration parses into Up and Down', () => {
  const { up, down } = parseMigrationSource(
    '-- +migrate Up\nCREATE TABLE t (id int);\n\n-- +migrate Down\nDROP TABLE t;\n',
    '007_ok.sql',
  );
  assert.equal(up, 'CREATE TABLE t (id int);');
  assert.equal(down, 'DROP TABLE t;');
});

test('a migration with Up but no Down is valid and yields an empty Down', () => {
  const { up, down } = parseMigrationSource('-- +migrate Up\nCREATE TABLE t (id int);\n', '008_up_only.sql');
  assert.equal(up, 'CREATE TABLE t (id int);');
  assert.equal(down, '');
});

test('SQL that merely mentions the marker text inline is not treated as a boundary', () => {
  const { up } = parseMigrationSource(
    "-- +migrate Up\nINSERT INTO notes (body) VALUES ('-- +migrate Down inside a literal');\n",
    '009_inline.sql',
  );
  assert.match(up, /inside a literal/);
});

test('the version of a migration is its full filename, not its timestamp prefix', () => {
  assert.equal(deriveVersion('20260621120000_feature_rollout_overrides.sql'), '20260621120000_feature_rollout_overrides.sql');
  assert.notEqual(
    deriveVersion('20260621120000_feature_rollout_overrides.sql'),
    deriveVersion('20260621120000_referral_pin_function_search_path.sql'),
  );
  assertDeterministicVersions([
    '20260621120000_feature_rollout_overrides.sql',
    '20260621120000_referral_pin_function_search_path.sql',
  ]);
});

// ------------------------------------------------------- the real repository

test('EVERY executable migration in database/migrations parses cleanly', () => {
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  assert.ok(files.length > 100, `expected the full migration set, saw ${files.length}`);

  const failures = [];
  let parsed = 0;
  for (const file of files) {
    if (isNonMigrationFile(file) || isRetiredMigration(file)) continue;
    try {
      const { up } = parseMigrationSource(fs.readFileSync(path.join(migrationsDir, file), 'utf8'), file);
      assert.ok(up.length > 0);
      parsed += 1;
    } catch (err) {
      failures.push(`${file}: ${err.code || err.message}`);
    }
  }
  assert.deepEqual(failures, [], `migrations failing the integrity contract:\n${failures.join('\n')}`);
  assert.equal(parsed, files.length - Object.keys(NON_MIGRATION_FILES).length - Object.keys(RETIRED_UNAPPLIABLE).length);
});

test('the repository migration set has deterministic versions', () => {
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  assertDeterministicVersions(files.filter(f => !isNonMigrationFile(f) && !isRetiredMigration(f)));
});

test('no NEW timestamp-prefix collision is introduced', () => {
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const collisions = findTimestampPrefixCollisions(files.filter(f => !isNonMigrationFile(f) && !isRetiredMigration(f)));
  const unexpected = collisions.filter(c => !KNOWN_TIMESTAMP_PREFIX_COLLISIONS.includes(c));
  assert.deepEqual(
    unexpected,
    [],
    `new timestamp-prefix collision(s): ${unexpected.join(', ')}. Prefixes are not versions, but a new ` +
      'collision usually signals an accidentally duplicated timestamp — give the migration a distinct one.',
  );
});

// ------------------------------------------- governed provenance exceptions

test('every provenance-pinned migration still matches its committed production receipt', () => {
  for (const [file, pin] of Object.entries(PROVENANCE_PINNED_UNMARKED)) {
    const full = path.join(migrationsDir, file);
    assert.ok(fs.existsSync(full), `provenance-pinned ${file} no longer exists`);
    const bytes = fs.readFileSync(full, 'utf8');
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(actual, pin.sha256, `${file} drifted from its production receipt (${pin.receipt})`);
    assert.ok(pin.receipt && pin.receipt.length > 10, `${file} must name its receipt`);
  }
});

test('a provenance-pinned migration parses as a governed exception, not a skip', () => {
  const file = '20260619201406_production_access_containment.sql';
  assert.ok(isProvenancePinned(file));
  const { up, down, governedException } = parseMigrationSource(
    fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
    file,
  );
  assert.equal(governedException, true);
  assert.ok(up.length > 0, 'the whole file is the Up section — the semantics it was applied under');
  assert.equal(down, '');
});

test('editing a provenance-pinned migration FAILS loudly instead of being accepted', () => {
  const file = '20260619201406_production_access_containment.sql';
  const tampered = `${fs.readFileSync(path.join(migrationsDir, file), 'utf8')}\n-- sneaky edit\n`;
  expectIntegrityError(() => parseMigrationSource(tampered, file), 'PROVENANCE_PIN_BROKEN');
});

test('adding an Up marker to a provenance-pinned migration is itself refused', () => {
  const file = '20260618040000_verification_case_management.sql';
  const withMarker = `-- +migrate Up\n${fs.readFileSync(path.join(migrationsDir, file), 'utf8')}`;
  expectIntegrityError(() => parseMigrationSource(withMarker, file), 'PROVENANCE_PIN_BROKEN');
});

test('the pinned set and the marker-repaired set are disjoint', () => {
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  for (const file of files) {
    if (!isProvenancePinned(file)) continue;
    const bytes = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    assert.ok(
      !bytes.split('\n').some(l => l.trim() === '-- +migrate Up'),
      `${file} is provenance-pinned and must NOT have been marker-repaired`,
    );
  }
});

test('a retired unappliable migration is refused, not armed', () => {
  const file = '009_phase4_schema.sql';
  assert.ok(isRetiredMigration(file));
  const bytes = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  expectIntegrityError(() => parseMigrationSource(bytes, file), 'RETIRED_MIGRATION');
  // It must stay pristine — arming it would turn a silent skip into a hard 42703.
  assert.ok(
    !bytes.split('\n').some(l => l.trim() === '-- +migrate Up'),
    '009 is retired and must not have been marker-repaired',
  );
});

test('every retired migration still exists and states why it is unappliable', () => {
  for (const [file, reason] of Object.entries(RETIRED_UNAPPLIABLE)) {
    assert.ok(fs.existsSync(path.join(migrationsDir, file)), `retired ${file} no longer exists`);
    assert.match(reason, /supersed|unappliable|42703/i, `${file} must state why it is retired`);
  }
});

test('every enumerated non-migration exemption still exists and carries a reason', () => {
  for (const [file, reason] of Object.entries(NON_MIGRATION_FILES)) {
    assert.ok(fs.existsSync(path.join(migrationsDir, file)), `exempted ${file} no longer exists — remove the exemption`);
    assert.ok(reason && reason.length > 20, `exemption for ${file} must state why`);
  }
});

test('the canonical Postgres ledger is never named public.schema_migrations in the runner', async () => {
  const runner = fs.readFileSync(path.resolve(__dirname, '../db/migrate.js'), 'utf8');
  assert.ok(!/public\.schema_migrations/.test(runner), 'runner must not reference public.schema_migrations');
  // The local runner is SQLite-only (backend/db/carup.db); the canonical Postgres
  // ledger for this project remains supabase_migrations.schema_migrations.
  const db = fs.readFileSync(path.resolve(__dirname, '../db/database.js'), 'utf8');
  assert.match(db, /sqlite/i, 'the local runner is expected to be SQLite-backed');
});

/**
 * pgcrypto is installed in the `extensions` schema on Supabase, not `public`. A function that
 * calls digest() while pinning `SET search_path = public, pg_temp` therefore fails EVERY call with
 * SQLSTATE 42883, and neither a mock nor an embedded-Postgres harness catches it — those install
 * pgcrypto into `public`, where the bare name resolves.
 *
 * 20260725120000_diaspora_rpc_pgcrypto_search_path_fix.sql had to repair exactly this for five
 * atomic RPCs. The T3 logistics award RPC then reintroduced it, and it was caught only by calling
 * the function on the real staging database. This gate makes the next one fail here instead.
 */
test('a migration function that calls digest() pins `extensions` on its search_path', () => {
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const offenders = [];

  // A function whose defining migration is already applied must NOT have its bytes edited — the
  // repair is a later, additive `ALTER FUNCTION ... SET search_path = ... extensions ...`. Collect
  // everything repaired that way so the historical five are recognised as fixed, not re-reported.
  const repaired = new Set();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    if (!/ALTER\s+FUNCTION/i.test(sql) || !/\bextensions\b/i.test(sql)) continue;
    for (const match of sql.matchAll(/'([a-z0-9_]+)'/gi)) repaired.add(match[1].toLowerCase());
    for (const match of sql.matchAll(/ALTER\s+FUNCTION\s+(?:public\.)?([a-z0-9_]+)/gi)) {
      repaired.add(match[1].toLowerCase());
    }
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // Split into CREATE FUNCTION bodies so one repaired function does not excuse another.
    const bodies = sql.split(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i).slice(1);
    for (const body of bodies) {
      // Only the definition, up to the end of its AS $...$ header block.
      const header = body.split(/\bAS\s+\$/i)[0];
      const usesDigest = /\bdigest\s*\(/i.test(body);
      const pinsSearchPath = /SET\s+search_path\s*=/i.test(header);
      if (!usesDigest || !pinsSearchPath) continue;
      const searchPath = header.match(/SET\s+search_path\s*=\s*([^\n]+)/i)?.[1] || '';
      if (!/\bextensions\b/i.test(searchPath)) {
        const name = body.trim().split(/[\s(]/)[0];
        const bare = name.replace(/^public\./i, '').toLowerCase();
        if (repaired.has(bare)) continue;
        offenders.push(`${file} :: ${name} :: search_path = ${searchPath.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'These functions call pgcrypto digest() but pin a search_path without `extensions`. On Supabase '
    + 'that fails every call with 42883. Use `SET search_path = public, extensions, pg_temp`:\n  '
    + offenders.join('\n  '),
  );
});
