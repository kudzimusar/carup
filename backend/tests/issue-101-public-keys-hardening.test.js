/**
 * Source contract for the Issue #101 public_keys P0 closure migration.
 *
 * The transition harness (database/test/issue101_public_keys_transition_check.mjs)
 * proves what the migration DOES on real PostgreSQL. These tests prove properties of
 * the FILE: that it stays narrow, reads no data, creates no policy, touches no other
 * relation, and never disagrees with the committed production receipt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseMigrationSource, deriveVersion } from '../db/migrationParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const FILE = '20260814085000_issue101_public_keys_hardening.sql';
const SQL = fs.readFileSync(path.join(ROOT, 'database/migrations', FILE), 'utf8');
const RECEIPT = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'database/parity/receipts/production-public-keys-run31774496416.json'), 'utf8'));

const parsed = parseMigrationSource(SQL, FILE);
const UP = parsed.up;
const DOWN = parsed.down || '';

/** Whole-line comment stripper; the file's prose describes what it does NOT do. */
const stripComments = (sql) => sql.split('\n').map((l) => (l.trim().startsWith('--') ? '' : l)).join('\n');
const CODE = stripComments(UP);

test('every comment occupies a whole line, so line-based stripping is sound', () => {
  const inline = SQL.split('\n').filter((l) => {
    const i = l.indexOf('--');
    return i > 0 && l.slice(0, i).trim().length > 0;
  });
  assert.deepEqual(inline, []);
});

// ───────────────────────────────────────────────────────────────── scope

test('the migration parses and carries both sections', () => {
  assert.equal(deriveVersion(FILE), FILE);
  assert.ok(UP.length > 0 && DOWN.length > 0);
});

test('it sorts BEFORE #155, matching the cutover order', () => {
  // Production cutover is public_keys hardening -> certify -> #155 -> certify. A runner
  // that walks migrations lexically must reach them in that same order.
  assert.ok(FILE < '20260814090000_issue101_p0_rls_and_view_hardening.sql');
  assert.ok(FILE > '20260814080000_issue101_staging_parity.sql');
});

test('exactly ONE relation is named in executable SQL', () => {
  const named = [...CODE.matchAll(/\bpublic\.([a-z_]+)/g)].map((m) => m[1]);
  const distinct = [...new Set(named)].sort();
  // Only two relations are named with a schema qualifier: public_keys (the target) and
  // users (named once, as the referenced side of the FK assertion).
  // signature_verification_logs is referenced by CONSTRAINT NAME only, never as a
  // relation — so the migration cannot alter it even accidentally.
  assert.deepEqual(distinct, ['public_keys', 'users']);
  assert.match(CODE, /signature_verification_logs_public_key_id_fkey/);
  assert.doesNotMatch(CODE, /public\.signature_verification_logs/);
  for (const stmt of CODE.split(';')) {
    if (/^\s*(ALTER TABLE|REVOKE|GRANT)\b/i.test(stmt)) {
      assert.match(stmt, /public\.public_keys/, `privilege statement must target public_keys only: ${stmt.trim().slice(0, 80)}`);
      assert.doesNotMatch(stmt, /public\.(users|signature_verification_logs)\b/);
    }
  }
});

test('no other Issue #101 table is touched', () => {
  for (const t of ['cid_clearance_records', 'currency_rates', 'cvr_ownership_records',
    'dealer_promotions', 'evidence_class_taxonomy', 'evidence_sources', 'evidence_sources_public',
    'ocr_customs_declarations', 'ocr_national_ids', 'ocr_registration_books',
    'performance_telemetry', 'system_failures', 'vid_inspections', 'zimra_declarations',
    'zinara_licensing_records']) {
    assert.ok(!CODE.includes(t), `${t} belongs to #155, not to this migration`);
  }
});

test('no sequence, role, schema or B1-SEQ object is named', () => {
  assert.doesNotMatch(CODE, /ON SEQUENCE/i);
  assert.doesNotMatch(CODE, /CREATE ROLE|ALTER ROLE|DROP ROLE/i);
  assert.doesNotMatch(CODE, /ALTER DEFAULT PRIVILEGES/i);
  assert.doesNotMatch(CODE, /ALL (TABLES|SEQUENCES) IN SCHEMA/i);
  for (const s of ['blockchain_events_id_seq', 'trust_score_history_id_seq',
    'vehicle_ownership_history_id_seq', 'notification_queue_id_seq']) {
    assert.ok(!CODE.includes(s));
  }
});

// ────────────────────────────────────────────────────────── target posture

test('the target posture is exactly what was specified', () => {
  assert.match(CODE, /ALTER TABLE public\.public_keys ENABLE ROW LEVEL SECURITY;/);
  assert.match(CODE, /REVOKE ALL ON TABLE public\.public_keys FROM anon, authenticated;/);
  assert.match(CODE, /REVOKE ALL ON TABLE public\.public_keys FROM service_role;/);
  assert.match(CODE, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.public_keys TO service_role;/);
  // the REVOKE from service_role must PRECEDE the grant, or the grant narrows nothing
  assert.ok(CODE.indexOf('FROM service_role') < CODE.indexOf('TO service_role'));
});

test('FORCE RLS is left alone and no policy is created', () => {
  assert.doesNotMatch(CODE, /FORCE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(CODE, /CREATE POLICY/i);
  assert.doesNotMatch(CODE, /DROP POLICY/i);
  assert.doesNotMatch(CODE, /DISABLE ROW LEVEL SECURITY/i);
});

test('service_role never receives DELETE or TRUNCATE, and the API roles receive nothing', () => {
  for (const stmt of CODE.split(';')) {
    if (!/^\s*GRANT\b/i.test(stmt)) continue;
    assert.doesNotMatch(stmt, /\bDELETE\b/i, `grant must not include DELETE: ${stmt.trim()}`);
    assert.doesNotMatch(stmt, /\bTRUNCATE\b/i, `grant must not include TRUNCATE: ${stmt.trim()}`);
    assert.doesNotMatch(stmt, /\bALL\b/i, `grant must be explicit, not ALL: ${stmt.trim()}`);
    assert.doesNotMatch(stmt, /\b(anon|authenticated)\b/i, `no grant may reach an API role: ${stmt.trim()}`);
  }
});

// ───────────────────────────────────────────────────────── no data, no keys

test('no row is read, written or destroyed', () => {
  assert.doesNotMatch(CODE, /^\s*(INSERT|UPDATE|DELETE|COPY|TRUNCATE)\b/mi);
  // No SELECT anywhere reads an application relation. `FROM` also appears in
  // `IS DISTINCT FROM` and in `REVOKE ... FROM <role>`, so the check is anchored on the
  // schema-qualified form, which only a real table read would use.
  assert.doesNotMatch(CODE, /\bFROM\s+public\./i,
    'no statement may read from a public relation — catalog metadata only');
  const catalogSources = [...CODE.matchAll(/\bFROM\s+(information_schema\.\w+|pg_catalog\.\w+|pg_\w+)/gi)]
    .map((m) => m[1].toLowerCase());
  assert.ok(catalogSources.length > 0, 'the preconditions must read the catalog');
  for (const s of catalogSources) {
    assert.match(s, /^(information_schema\.columns|pg_constraint|pg_class|pg_policy|pg_catalog\.pg_roles)$/,
      `unexpected catalog source: ${s}`);
  }
});

test('no key material appears anywhere in the file', () => {
  assert.doesNotMatch(SQL, /-----BEGIN/);
  assert.doesNotMatch(SQL, /PRIVATE KEY/);
  // private_key_pem is named, but only as a column identifier in the shape assertion
  assert.match(UP, /private_key_pem/);
  assert.doesNotMatch(CODE, /private_key_pem\s*=/);
});

test('Issue #158 is explicitly not solved here', () => {
  assert.match(UP, /Issue #158/);
  assert.doesNotMatch(CODE, /DROP COLUMN|ALTER COLUMN|ADD COLUMN/i);
});

// ──────────────────────────────────────────────────────────── fail-loud

test('all three preconditions run BEFORE the first privilege change', () => {
  const firstChange = Math.min(
    ...[/^ALTER TABLE/m, /^REVOKE/m, /^GRANT/m]
      .map((re) => { const i = CODE.search(re); return i === -1 ? Infinity : i; }));
  assert.ok(Number.isFinite(firstChange), 'the migration must change something');
  for (const tag of ['$pk_service_role$', '$pk_shape$', '$pk_constraints$']) {
    const at = CODE.indexOf(tag);
    assert.ok(at > -1, `missing precondition ${tag}`);
    assert.ok(at < firstChange, `${tag} must precede the first privilege change`);
  }
});

test('the shape assertion is byte-derived from the production receipt', () => {
  const expected = RECEIPT.COLUMNS
    .sort((a, b) => a.ordinal_position - b.ordinal_position)
    .map((c) => `${c.column_name}:${c.udt_name}:${c.is_nullable}:${c.column_default ?? ''}`)
    .join(';');
  // The migration builds the same string from concatenated literals. Those literals
  // contain ';' and doubled quotes ('' for a literal apostrophe), so the block is taken
  // between the declaration and the next one rather than by a naive delimiter split.
  const decl = UP.slice(UP.indexOf('v_expected text :='), UP.indexOf('v_actual'));
  const literal = [...decl.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).join('');
  const normalised = literal.replace(/''/g, "'");
  assert.equal(normalised.replace(/;$/, ''), expected.replace(/;$/, ''),
    'the expected shape in the migration must equal the measured production columns');
  assert.equal(RECEIPT.COLUMNS.length, 8);
  assert.equal(RECEIPT.COLUMNS.find((c) => c.column_name === 'private_key_pem').ordinal_position, 4);
});

test('both cascades are asserted by name and by on-delete action', () => {
  const block = CODE.slice(CODE.indexOf('$pk_constraints$'));
  assert.match(block, /public_keys_user_id_fkey/);
  assert.match(block, /signature_verification_logs_public_key_id_fkey/);
  assert.equal((block.match(/confdeltype = 'c'/g) || []).length, 2,
    'both foreign keys must be asserted as ON DELETE CASCADE');
  assert.match(block, /public_keys_pkey/);
  assert.match(block, /public_keys_status_check/);
});

test('a postcondition proves the end state before commit', () => {
  const block = CODE.slice(CODE.indexOf('$pk_postcondition$'));
  assert.match(block, /NOT v_rls/);
  assert.match(block, /v_policies <> 0/);
  assert.match(block, /v_api <> 0/);
  assert.match(block, /v_svc <> 'INSERT,SELECT,UPDATE'/);
  assert.match(block, /TRUNCATE/, 'the API-role check must include TRUNCATE');
});

test('atomicity is not broken by the file itself', () => {
  assert.doesNotMatch(CODE, /^\s*(BEGIN|COMMIT)\s*;/mi);
  assert.doesNotMatch(CODE, /CONCURRENTLY|VACUUM/i);
});

// ──────────────────────────────────────────────────────────────── rollback

test('Down is documented and deliberately inert', () => {
  // Re-granting would re-open the exposure, so reversal is an operator decision.
  assert.match(DOWN, /SELECT 1;/);
  assert.doesNotMatch(stripComments(DOWN), /GRANT|REVOKE|ALTER|DROP/i);
  assert.match(DOWN, /production-public-keys-run31774496416\.json/,
    'the rollback source of truth must be named');
});
