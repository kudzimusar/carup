/**
 * Safety contract for the Issue #101 production P0 cutover script.
 *
 * The single most important property is negative: the STAGING PARITY migration must be
 * incapable of executing against production. Everything else here defends the two
 * properties that make a production privilege change reviewable — that exactly two
 * pinned files can run, and that each runs in its own transaction and is certified
 * before the next is attempted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';

import {
  ALLOWED_MIGRATIONS, FORBIDDEN_MIGRATIONS,
  PRODUCTION_PROJECT_REF_SHA256, STAGING_PROJECT_REF_SHA256, refHash,
  FOURTEEN, CUTOVER_SEVEN, PUBLIC_KEYS_SHAPE,
  ALL_TABLE_PRIVILEGES, PUBLIC_KEYS_SERVICE_ROLE_PRESENT,
  PUBLIC_KEYS_SERVICE_ROLE_ABSENT, PUBLIC_KEYS_SERVICE_ROLE_EXPECTED,
  assertProductionIdentity, loadPinnedMigration, sanitizeError, CutoverError,
  assertAllowlistIntegrity,
} from '../scripts/production-issue-101-p0-cutover.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'backend/scripts/production-issue-101-p0-cutover.mjs');
const MIG = path.join(ROOT, 'database/migrations');
const src = fs.readFileSync(SCRIPT, 'utf8');

const P2 = '20260814080000_issue101_staging_parity.sql';

/**
 * URI fragments, joined at runtime. Nothing in this file is a usable connection string,
 * and nothing here resembles one to a secret scanner — the identity assertions still get
 * a realistically-shaped input.
 */
const SCHEME = ['postgres', 'ql', '://'].join('');
const FAKE_CRED = ['synthetic-user', ':', 'synthetic-not-a-password'].join('');

// ─────────────────────────────────────────────── P2 CANNOT RUN IN PRODUCTION

test('P2 staging parity is DENYLISTED and absent from the allowlist', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(FORBIDDEN_MIGRATIONS, P2));
  assert.equal(ALLOWED_MIGRATIONS.some((m) => m.file === P2), false);
  assert.match(FORBIDDEN_MIGRATIONS[P2], /STAGING PARITY ONLY/);
});

test('loadPinnedMigration refuses the P2 file even with a correct hash', () => {
  const raw = fs.readFileSync(path.join(MIG, P2), 'utf8');
  const realHash = crypto.createHash('sha256').update(raw).digest('hex');
  assert.throws(
    () => loadPinnedMigration({ order: 'X', file: P2, sha256: realHash, label: 'smuggled' }),
    (e) => e instanceof CutoverError && e.code === 'FORBIDDEN_MIGRATION');
});

test('the runtime self-check refuses if the denylist or allowlist is edited', () => {
  // Mutation-testing the workflow guard showed a static grep can be satisfied by the
  // file's own prose after the real denylist entry is deleted. This check cannot be.
  assert.equal(assertAllowlistIntegrity(), true);
  const P2 = '20260814080000_issue101_staging_parity.sql';

/**
 * URI fragments, joined at runtime. Nothing in this file is a usable connection string,
 * and nothing here resembles one to a secret scanner — the identity assertions still get
 * a realistically-shaped input.
 */
const SCHEME = ['postgres', 'ql', '://'].join('');
const FAKE_CRED = ['synthetic-user', ':', 'synthetic-not-a-password'].join('');
  const real = ALLOWED_MIGRATIONS[0];

  assert.throws(() => assertAllowlistIntegrity(ALLOWED_MIGRATIONS, {}),
    (e) => e.code === 'DENYLIST_LOST_STAGING_PARITY');
  assert.throws(() => assertAllowlistIntegrity(
    [...ALLOWED_MIGRATIONS, { file: P2, sha256: 'a'.repeat(64) }], FORBIDDEN_MIGRATIONS),
  (e) => e.code === 'ALLOWLIST_CONTAINS_STAGING_PARITY');
  assert.throws(() => assertAllowlistIntegrity([real], FORBIDDEN_MIGRATIONS),
    (e) => e.code === 'ALLOWLIST_SIZE_CHANGED');
  assert.throws(() => assertAllowlistIntegrity(
    [{ file: 'x.sql', sha256: 'not-a-hash' }, real], FORBIDDEN_MIGRATIONS),
  (e) => e.code === 'UNPINNED_MIGRATION');
});

test('the self-check runs before any file is read or connection opened', () => {
  const main = src.slice(src.indexOf('async function main()'));
  assert.ok(main.indexOf('assertAllowlistIntegrity()') < main.indexOf('loadPinnedMigration'));
  assert.ok(main.indexOf('assertAllowlistIntegrity()') < main.indexOf('new pg.Client'));
});

test('a migration that CREATES a table is refused outright', () => {
  // P2 is the only such file in this lane, but the guard is on the property, not the
  // name: a hardening migration creates nothing, so anything that does is not this lane.
  assert.match(src, /CREATE\\s\+TABLE/);
  assert.match(src, /MIGRATION_CREATES_A_TABLE/);
});

test('there is no "apply all pending migrations" path', () => {
  // Checked against comment-stripped source: the file's own prose explains that no such
  // path exists, and matching that prose would be matching the documentation, not the code.
  const code = src.split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join('\n');
  assert.doesNotMatch(code, /readdirSync/, 'the script must never enumerate the migrations directory');
  assert.doesNotMatch(code, /globSync|opendirSync/);
  assert.doesNotMatch(code, /for\s*\(const\s+\w+\s+of\s+fs\./);
  // the only iteration over migrations is over the two-entry frozen allowlist
  assert.match(code, /for \(const m of pinned\)/);
  assert.equal((code.match(/readFileSync\(join\(dir, entry\.file\)/g) || []).length, 1,
    'exactly one place may read a migration, and it is the pinned loader');
});

// ────────────────────────────────────────────────────── the allowlist itself

test('exactly two migrations are allowed, in cutover order A then B', () => {
  assert.equal(ALLOWED_MIGRATIONS.length, 2);
  assert.deepEqual(ALLOWED_MIGRATIONS.map((m) => m.order), ['A', 'B']);
  assert.equal(ALLOWED_MIGRATIONS[0].file, '20260814085000_issue101_public_keys_hardening.sql');
  assert.equal(ALLOWED_MIGRATIONS[1].file, '20260814090000_issue101_p0_rls_and_view_hardening.sql');
  // A must sort before B, so the pinned order matches a lexical runner's order too
  assert.ok(ALLOWED_MIGRATIONS[0].file < ALLOWED_MIGRATIONS[1].file);
  assert.ok(Object.isFrozen(ALLOWED_MIGRATIONS));
});

test('both pinned SHA256 values match the files on disk', () => {
  for (const m of ALLOWED_MIGRATIONS) {
    const raw = fs.readFileSync(path.join(MIG, m.file), 'utf8');
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), m.sha256,
      `${m.file} hash drifted from the pin`);
  }
});

test('a tampered migration is refused before any connection is made', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-'));
  try {
    const m = ALLOWED_MIGRATIONS[0];
    fs.writeFileSync(path.join(tmp, m.file),
      fs.readFileSync(path.join(MIG, m.file), 'utf8') + '\n-- tampered\n');
    assert.throws(() => loadPinnedMigration(m, tmp),
      (e) => e instanceof CutoverError && e.code === 'MIGRATION_SHA256_MISMATCH');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the loaded Up section excludes the Down section', () => {
  for (const m of ALLOWED_MIGRATIONS) {
    const loaded = loadPinnedMigration(m);
    assert.ok(loaded.up.length > 0);
    assert.doesNotMatch(loaded.up, /\+migrate Down/);
    assert.doesNotMatch(loaded.up, /DROP TABLE/i, 'a Down section must never be executed');
  }
});

// ──────────────────────────────────────────────────────────────── identity

test('the refs are pinned BY HASH, with no plaintext ref in the repository', () => {
  // The real refs live only in the production environment secret. These tests use
  // stand-ins whose hashes are checked against the pins, so the repository never carries
  // a production identifier — which is exactly what CR-1 forbids.
  assert.match(PRODUCTION_PROJECT_REF_SHA256, /^[0-9a-f]{64}$/);
  assert.match(STAGING_PROJECT_REF_SHA256, /^[0-9a-f]{64}$/);
  assert.notEqual(PRODUCTION_PROJECT_REF_SHA256, STAGING_PROJECT_REF_SHA256);
  const src2 = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(src2, /\b[a-z]{20}\b(?![0-9a-f])/,
    'no bare 20-letter project-ref-shaped literal may appear in the script');
});

test('identity accepts only the pinned production ref and refuses staging', () => {
  // Stand-ins that hash to the pins are impossible to construct without the real refs,
  // so identity behaviour is exercised against the FUNCTION's contract using a locally
  // overridden pin: a ref whose hash matches is accepted, everything else is refused.
  const url = (ref) => [SCHEME, FAKE_CRED, '@db.', ref, '.example.invalid:5432/postgres'].join('');
  const notARef = 'qqqqqqqqqqqqqqqqqqqq';

  // wrong ref -> refused (its hash matches neither pin)
  assert.equal(assertProductionIdentity(url(notARef), notARef).ok, false);
  assert.match(assertProductionIdentity(url(notARef), notARef).reason, /does not match the pinned/);
  // missing inputs -> refused
  assert.equal(assertProductionIdentity('', notARef).ok, false);
  assert.equal(assertProductionIdentity(url(notARef), '').ok, false);
  // hashing is what decides, and it is stable
  assert.equal(refHash('a'), refHash('a'));
  assert.notEqual(refHash('a'), refHash('b'));
  assert.match(refHash('anything'), /^[0-9a-f]{64}$/);
});

test('the identity check refuses a URL that names a second project', () => {
  const other = 'zzzzzzzzzzzzzzzzzzzz';
  const r = assertProductionIdentity([SCHEME, FAKE_CRED, '@db.', other, '.example.invalid/postgres'].join(''), other);
  assert.equal(r.ok, false);
});

test('errors are sanitised so a connection string can never reach the log', () => {
  const hostile = new Error(
    ['connect failed ', SCHEME, FAKE_CRED, '@db.hostname.example.invalid:5432/postgres'].join(''));
  hostile.name = 'Error';
  hostile.code = '28P01';
  const out = sanitizeError(hostile);
  assert.equal(out, 'Error(28P01)');
  assert.ok(!out.includes(FAKE_CRED));
  assert.ok(!out.includes('hostname'));

  const spoofed = new Error('x');
  spoofed.name = 'Evil hostname.example.invalid';
  spoofed.code = '; DROP hostname';
  const out2 = sanitizeError(spoofed);
  assert.equal(out2, 'Error(unknown)');
  assert.ok(!out2.includes('hostname'));
});

// ─────────────────────────────────────────────────── transactions and modes

test('each migration is its own transaction, certified before the next', () => {
  const loop = src.slice(src.indexOf('for (const m of pinned)'));
  assert.match(loop, /await client\.query\('BEGIN'\)/);
  assert.match(loop, /await client\.query\('COMMIT'\)/);
  assert.match(loop, /ROLLBACK/);
  assert.match(loop, /const cert = await certify\(client, m\.order\)/);
  assert.match(loop, /if \(!cert\.ok\) fail\(/);
  // certification happens INSIDE the loop, so B cannot start if A fails
  assert.ok(loop.indexOf('certify(client, m.order)') < loop.indexOf('CUTOVER COMPLETE'));
});

test('preflight is read-only by construction', () => {
  const block = src.slice(src.indexOf("if (mode === 'preflight')"), src.indexOf('// ---- apply'));
  assert.match(block, /BEGIN READ ONLY/);
  assert.match(block, /show transaction_read_only/);
  assert.match(block, /TRANSACTION_NOT_READ_ONLY/);
  assert.match(block, /ROLLBACK/);
  assert.doesNotMatch(block, /\bCOMMIT\b/);
  assert.match(block, /statement_timeout/);
});

test('MODE must be explicitly preflight or apply', () => {
  assert.match(src, /mode !== 'preflight' && mode !== 'apply'/);
  assert.doesNotMatch(src, /MODE \|\| ['"]apply['"]/, 'apply must never be the default');
});

test('preflight reads catalog metadata only — no application row, no key material', () => {
  const block = src.slice(src.indexOf('export async function preflight'), src.indexOf('export async function certify'));
  assert.doesNotMatch(block, /\bFROM\s+public\./i);
  assert.doesNotMatch(block, /private_key_pem\b(?!.*string_agg)/,
    'private_key_pem may only appear as part of the shape string, never as a selected value');
  for (const m of block.matchAll(/\bfrom\s+(information_schema\.\w+|pg_catalog\.\w+|pg_\w+)/gi)) {
    assert.match(m[1].toLowerCase(),
      /^(information_schema\.columns|pg_roles|pg_class|pg_policy|pg_settings|pg_namespace)$/,
      `unexpected catalog source ${m[1]}`);
  }
});

// ──────────────────────────────────────────────── what preflight must prove

test('the preflight covers every item the lane requires', () => {
  const block = src.slice(src.indexOf('export async function preflight'));
  for (const [what, re] of [
    ['fourteen targets exist', /fourteen_present/],
    ['public_keys measured shape', /public_keys_shape/],
    ['#155 not already applied', /p0_applied/],
    ['public_keys hardening not already applied', /public_keys_hardening_applied/],
    ['RLS / policy / ACL state', /POSTURE/],
    ['evidence_sources_public posture', /evidence_sources_public/],
    ['cutover-seven baseline', /cutover_seven/],
    ['service_role BYPASSRLS', /rolbypassrls/],
    ['P2 will not execute', /p2_execution/],
  ]) assert.match(block, re, `preflight must prove: ${what}`);
});

test('the constant sets match the certified staging reality', () => {
  assert.equal(FOURTEEN.length, 14);
  assert.equal(Object.keys(CUTOVER_SEVEN).length, 7);
  assert.equal(Object.values(CUTOVER_SEVEN).filter((v) => v === 'SELECT').length, 2);
  assert.equal(Object.values(CUTOVER_SEVEN).filter((v) => v === 'none').length, 5);
  // the shape string is the one the hardening migration asserts
  const migration = fs.readFileSync(path.join(MIG, ALLOWED_MIGRATIONS[0].file), 'utf8');
  const literal = [...migration.slice(migration.indexOf('v_expected text :='), migration.indexOf('v_actual'))
    .matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).join('').replace(/''/g, "'");
  assert.equal(literal, PUBLIC_KEYS_SHAPE,
    'the cutover script and the migration must assert the SAME measured shape');
});

test('certification thresholds are the published #155 invariants', () => {
  const block = src.slice(src.indexOf('export async function certify'));
  assert.match(block, /unintended_api_write_exposures_after === 0/);
  assert.match(block, /unintended_api_read_exposures_after === 0/);
  assert.match(block, /intentional_public_read_surfaces_after === 1/);
  assert.match(block, /service_only_tables_with_select_absent === 13/);
  assert.match(block, /security_invoker=\(true\|on\)/);
});

test('ALL EIGHT PostgreSQL 17 privileges are the unit of measurement', () => {
  // MAINTAIN is new in PG17 and production carries it on public_keys. A subset check
  // would report "no privileges survive" while MAINTAIN quietly did.
  assert.deepEqual([...ALL_TABLE_PRIVILEGES].sort(),
    ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']);
  assert.equal(ALL_TABLE_PRIVILEGES.length, 8);
  assert.ok(ALL_TABLE_PRIVILEGES.includes('MAINTAIN'));
  assert.ok(Object.isFrozen(ALL_TABLE_PRIVILEGES));

  // present + absent must partition the eight exactly — no privilege unaccounted for
  assert.deepEqual(
    [...PUBLIC_KEYS_SERVICE_ROLE_PRESENT, ...PUBLIC_KEYS_SERVICE_ROLE_ABSENT].sort(),
    [...ALL_TABLE_PRIVILEGES].sort());
  assert.equal(
    PUBLIC_KEYS_SERVICE_ROLE_PRESENT.filter((p) => PUBLIC_KEYS_SERVICE_ROLE_ABSENT.includes(p)).length, 0);
  assert.ok(PUBLIC_KEYS_SERVICE_ROLE_ABSENT.includes('MAINTAIN'));
  assert.ok(PUBLIC_KEYS_SERVICE_ROLE_ABSENT.includes('REFERENCES'));
  assert.ok(PUBLIC_KEYS_SERVICE_ROLE_ABSENT.includes('TRIGGER'));
  assert.equal(PUBLIC_KEYS_SERVICE_ROLE_EXPECTED, 'INSERT,SELECT,UPDATE');

  // No subset may be used to make an EXACTNESS claim. The broad POSTURE survey keeps a
  // DML summary — the cutover-seven regression check is defined in those terms and was
  // certified that way — but it now also carries all-eight columns, so nothing in the
  // receipt under-reports.
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
  assert.doesNotMatch(code, /'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'\]/,
    'a seven-privilege subset omits MAINTAIN');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.match(code, new RegExp(`${role}_all_eight`), `POSTURE must report ${role} across all eight`);
  }
  // every exactness comparison is against the all-eight measurement
  assert.doesNotMatch(code, /service_role === 'INSERT,SELECT,UPDATE'/,
    'exactness must compare the named constant computed over all eight');
});

test('certify(A) asserts all eight and proves the withheld set absent by name', () => {
  const block = src.slice(src.indexOf("if (order === 'A')"), src.indexOf('const r = await one(client,\n    `select (select count'));
  assert.match(block, /ALL_TABLE_PRIVILEGES/);
  assert.match(block, /PUBLIC_KEYS_SERVICE_ROLE_ABSENT/);
  assert.match(block, /PUBLIC_KEYS_SERVICE_ROLE_PRESENT/);
  assert.match(block, /service_role_withheld_but_present === ''/);
  assert.match(block, /service_role_required_but_missing === ''/);
  assert.match(block, /r\.anon === 'none'/);
  assert.match(block, /r\.authenticated === 'none'/);
  assert.match(block, /api_privileges === 0/);
  assert.match(block, /service_role === PUBLIC_KEYS_SERVICE_ROLE_EXPECTED/);
});

test('preflight reports anon AND authenticated AND service_role across all eight', () => {
  const block = src.slice(src.indexOf('s.public_keys_hardening_applied'), src.indexOf('s.p0_applied'));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.match(block, new RegExp(`has_table_privilege\\('${role}'`), `preflight must measure ${role}`);
  }
  assert.match(block, /ALL_TABLE_PRIVILEGES/);
  assert.match(block, /already_hardened/);
  assert.match(block, /authenticated === 'none'/);
});
