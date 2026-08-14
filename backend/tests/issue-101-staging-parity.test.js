/**
 * Source contract for the Issue #101 P2 staging-parity migration.
 *
 * The behavioural harnesses (database/test/issue101_parity_check.mjs and
 * issue101_parity_then_p0_chain.mjs) prove what the migration DOES on real PostgreSQL.
 * These tests prove properties of the FILE that a behavioural run cannot observe:
 * that it opens no transaction of its own, seeds nothing, adopts nothing, names no
 * out-of-scope sequence, and never disagrees with the committed production receipts.
 *
 * Expected counts are DERIVED from the receipts, never typed in, so a receipt and a
 * migration cannot drift apart without failing here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseMigrationSource, deriveVersion } from '../db/migrationParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const FILE = '20260814080000_issue101_staging_parity.sql';
const SQL = fs.readFileSync(path.join(ROOT, 'database/migrations', FILE), 'utf8');

const RECEIPTS = path.join(ROOT, 'database/parity/receipts');
const ELEVEN = JSON.parse(fs.readFileSync(path.join(RECEIPTS, 'production-eleven-run31770747669.json'), 'utf8'));
const PK = JSON.parse(fs.readFileSync(path.join(RECEIPTS, 'production-public-keys-run31774496416.json'), 'utf8'));

const parsed = parseMigrationSource(SQL, FILE);
const UP = parsed.up;
const DOWN = parsed.down || '';

/**
 * Remove whole-line `--` comments.
 *
 * This matters more than it looks. The migration's header documents, in prose, exactly
 * what it does NOT do — "production grants anon and authenticated all eight privileges",
 * "UPDATE is deliberately withheld", "#155's exception is evidence_class_taxonomy". A
 * naive `doesNotMatch` over the raw text matches that commentary and reports the file as
 * doing the very thing it documents itself as avoiding. Negative assertions must run
 * against executable SQL only.
 *
 * Line-based rather than character-based ON PURPOSE. A scanner that tracks quote state
 * is defeated by an apostrophe inside prose ("#155's"), which flips it into a phantom
 * string and silently stops stripping from there on — which is exactly the bug this
 * replaced. Every comment in this file occupies a whole line, and the test below proves
 * that, so the simple rule is also the correct one.
 */
function stripComments(sql) {
  return sql.split('\n').map((l) => (l.trim().startsWith('--') ? '' : l)).join('\n');
}
const CODE = stripComments(UP);
const DOWN_CODE = stripComments(DOWN);

const DEPENDENCY_ONLY = ['public_keys'];
const TARGET_PARITY = ELEVEN.TABLE_IDENTITY.map((t) => t.table_name).sort();
const TWELVE = [...DEPENDENCY_ONLY, ...TARGET_PARITY];

/** Staging's pre-existing sequences. B1-SEQ owns these; this migration must not name one. */
const PREEXISTING_SEQUENCES = [
  'blockchain_events_id_seq', 'financial_ledger_id_seq', 'notification_queue_id_seq',
  'organization_audit_logs_id_seq', 'partsentry_logs_id_seq', 'role_switch_logs_id_seq',
  'trust_score_history_id_seq', 'vehicle_ownership_history_id_seq',
];

const countOf = (re) => (UP.match(re) || []).length;

// ─────────────────────────────────────────────────────────── shape and scope

test('every comment occupies a whole line, so line-based stripping is sound', () => {
  // The negative assertions below run against comment-stripped SQL. That is only valid
  // if no statement shares a line with a trailing comment.
  const inline = SQL.split('\n').filter((l) => {
    const i = l.indexOf('--');
    return i > 0 && l.slice(0, i).trim().length > 0;
  });
  assert.deepEqual(inline, [], 'a trailing comment would survive stripping and skew a negative assertion');
});

test('the migration parses and versions correctly', () => {
  assert.equal(deriveVersion(FILE), FILE);
  assert.ok(UP.length > 0 && DOWN.length > 0, 'both Up and Down sections must be present');
});

test('exactly twelve tables are created: 1 dependency-only + 11 parity targets', () => {
  const created = [...UP.matchAll(/^CREATE TABLE public\.(\w+) \(/gm)].map((m) => m[1]);
  assert.equal(created.length, 12);
  assert.deepEqual([...created].sort(), [...TWELVE].sort());
  assert.equal(created.filter((t) => DEPENDENCY_ONLY.includes(t)).length, 1);
  assert.equal(created.filter((t) => TARGET_PARITY.includes(t)).length, 11);
});

test('public_keys is created BEFORE signature_verification_logs references it', () => {
  assert.ok(UP.indexOf('CREATE TABLE public.public_keys (')
    < UP.indexOf('CREATE TABLE public.signature_verification_logs ('),
  'the referent must exist before the FK that points at it');
});

test('no CREATE adopts a pre-existing object', () => {
  // IF NOT EXISTS would silently accept drift of unknown shape — the exact failure mode
  // this migration exists to avoid.
  assert.doesNotMatch(CODE, /CREATE\s+(TABLE|INDEX|SEQUENCE|VIEW)\s+IF\s+NOT\s+EXISTS/i);
});

test('atomicity is not broken by the file itself', () => {
  // The runner wraps each migration in BEGIN/COMMIT. A COMMIT here, or any statement
  // that cannot run inside a transaction block, would split it into pieces.
  assert.doesNotMatch(CODE, /^\s*(BEGIN|COMMIT)\s*;/mi);
  assert.doesNotMatch(CODE, /CONCURRENTLY/i);
  assert.doesNotMatch(CODE, /^\s*VACUUM\b/mi);
  assert.doesNotMatch(CODE, /CREATE\s+DATABASE|CREATE\s+TABLESPACE/i);
});

// ─────────────────────────────────────────────────────── parity with receipts

test('the created index count matches the measured independent indexes', () => {
  const independent = new Set([...ELEVEN.INDEXES, ...PK.INDEXES]
    .filter((i) => !i.constraint_backed).map((i) => i.index_name));
  assert.equal(independent.size, 9);
  assert.equal(countOf(/^CREATE INDEX /gm), independent.size);
  for (const name of independent) {
    assert.match(UP, new RegExp(`CREATE INDEX ${name}\\b`), `missing independent index ${name}`);
  }
});

test('constraint-created indexes are NOT restated as CREATE INDEX', () => {
  // PRIMARY KEY and UNIQUE build their own index; restating them would double the
  // physical index count against production.
  const backed = new Set([...ELEVEN.INDEXES, ...PK.INDEXES]
    .filter((i) => i.constraint_backed).map((i) => i.index_name));
  assert.equal(backed.size, 18); // 17 for the eleven + public_keys_pkey
  for (const name of backed) {
    assert.doesNotMatch(UP, new RegExp(`CREATE (UNIQUE )?INDEX ${name}\\b`),
      `${name} is created by its constraint and must not be restated`);
  }
});

test('every measured foreign key is reproduced, with its on-delete semantics', () => {
  const fks = [...ELEVEN.FOREIGN_KEYS, ...PK.FOREIGN_KEYS];
  assert.equal(fks.length, 11, '10 from the eleven + public_keys -> users');
  for (const f of fks) {
    assert.match(UP, new RegExp(`CONSTRAINT ${f.constraint_name} FOREIGN KEY`), `missing FK ${f.constraint_name}`);
  }
  // The FK that made public_keys necessary at all.
  assert.match(UP,
    /CONSTRAINT signature_verification_logs_public_key_id_fkey FOREIGN KEY \(public_key_id\) REFERENCES public\.public_keys\(id\) ON DELETE CASCADE/);
  assert.equal(countOf(/CONSTRAINT \w+ FOREIGN KEY/g), 11, 'no FK may be added or omitted');
});

test('every measured PK/UNIQUE/CHECK is reproduced by name', () => {
  const cons = [...ELEVEN.CONSTRAINTS, ...PK.CONSTRAINTS];
  assert.equal(cons.length, 27); // 25 + 2
  for (const c of cons) {
    assert.match(UP, new RegExp(`CONSTRAINT ${c.constraint_name}\\b`), `missing constraint ${c.constraint_name}`);
  }
});

test('the three measured sequences are created with their production parameters', () => {
  assert.equal(ELEVEN.SEQUENCE_DEFINITIONS.length, 3);
  assert.equal(countOf(/^CREATE SEQUENCE public\./gm), 3);
  for (const s of ELEVEN.SEQUENCE_DEFINITIONS) {
    const block = UP.slice(UP.indexOf(`CREATE SEQUENCE public.${s.sequence_name}`));
    assert.ok(block.startsWith(`CREATE SEQUENCE public.${s.sequence_name}`), `missing sequence ${s.sequence_name}`);
    const decl = block.slice(0, block.indexOf(';') + 1);
    assert.match(decl, /AS bigint/);
    assert.match(decl, new RegExp(`START WITH ${s.seqstart}\\b`));
    assert.match(decl, new RegExp(`INCREMENT BY ${s.seqincrement}\\b`));
    assert.match(decl, new RegExp(`MINVALUE ${s.seqmin}\\b`));
    assert.match(decl, new RegExp(`MAXVALUE ${s.seqmax}\\b`));
    assert.match(decl, new RegExp(`CACHE ${s.seqcache}\\b`));
    assert.match(decl, /NO CYCLE/);
    assert.match(UP, new RegExp(
      `ALTER SEQUENCE public\\.${s.sequence_name} OWNED BY public\\.${s.owning_table}\\.${s.owning_column};`));
  }
});

test('public_keys reproduces the production column order, private_key_pem at ordinal 4', () => {
  const body = UP.slice(UP.indexOf('CREATE TABLE public.public_keys ('));
  const decl = body.slice(0, body.indexOf('\n);'));
  const names = [...decl.matchAll(/^ {2}(\w+) +\S/gm)].map((m) => m[1])
    .filter((n) => n !== 'CONSTRAINT');
  const expected = PK.COLUMNS.sort((a, b) => a.ordinal_position - b.ordinal_position)
    .map((c) => c.column_name);
  assert.deepEqual(names, expected);
  assert.equal(names[3], 'private_key_pem', 'ordinal 4 — the deploy-script layout, not 004+005');
});

// ────────────────────────────────────────────────────── fail-loud before change

test('all three preconditions raise BEFORE the first CREATE', () => {
  const firstCreate = UP.search(/^CREATE (TABLE|SEQUENCE|INDEX)/m);
  for (const tag of ['$parity_service_role$', '$parity_absent$', '$parity_referents$']) {
    const at = UP.indexOf(tag);
    assert.ok(at > -1, `missing precondition block ${tag}`);
    assert.ok(at < firstCreate, `${tag} must run before the first CREATE`);
  }
  assert.equal(countOf(/RAISE EXCEPTION/g) >= 4, true, 'each precondition plus the postcondition must raise');
});

test('the absence precondition names all twelve and refuses on ANY of them', () => {
  const block = UP.slice(UP.indexOf('$parity_absent$'));
  for (const t of TWELVE) assert.ok(block.includes(`'${t}'`), `absence guard omits ${t}`);
  assert.match(block, /IS NOT NULL/);
  assert.match(block, /ERRCODE = 'duplicate_table'/);
});

test('the absence precondition is what blocks an accidental production apply', () => {
  // Production holds all twelve, so the guard fires there before any change. This is a
  // property of the data, so the intent is asserted in the file rather than inferred.
  const block = UP.slice(UP.indexOf('$parity_absent$'), UP.indexOf('$parity_referents$'));
  assert.match(block, /PRODUCTION/);
});

test('service_role and its BYPASSRLS are required up front', () => {
  const block = UP.slice(UP.indexOf('$parity_service_role$'));
  assert.match(block, /rolname = 'service_role' AND rolbypassrls/);
  assert.match(block, /ERRCODE = 'insufficient_privilege'/);
});

test('FK referents are checked for existence, type AND a referencable key', () => {
  const block = UP.slice(UP.indexOf('$parity_referents$'), UP.indexOf('SECTION A'));
  for (const t of ['users', 'vehicles', 'ocr_documents']) assert.ok(block.includes(`'${t}'`));
  assert.match(block, /<> 'text'/, 'the referent type must be checked, not assumed');
  assert.match(block, /contype IN \('p', 'u'\)/, 'a FK needs a PK/UNIQUE on the referenced column');
});

// ──────────────────────────────────────────────────────────── security posture

test('all twelve get RLS enabled and both API roles revoked', () => {
  for (const t of TWELVE) {
    assert.match(UP, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`), `${t}: RLS`);
    assert.match(UP, new RegExp(`REVOKE ALL ON TABLE public\\.${t}\\s+FROM anon, authenticated;`), `${t}: REVOKE`);
  }
  assert.equal(countOf(/ENABLE ROW LEVEL SECURITY/g), 12);
});

test('no anon or authenticated policy is created anywhere', () => {
  assert.doesNotMatch(CODE, /CREATE POLICY/i);
  assert.doesNotMatch(CODE, /GRANT[^;]*\bTO\b[^;]*\b(anon|authenticated)\b/i);
});

test('public_keys gets the narrow grant, and the REVOKE that makes it narrow', () => {
  // Staging's permissive default privileges hand service_role ALL on a new table, so a
  // GRANT without a preceding REVOKE would narrow nothing at all.
  const at = (re) => UP.search(re);
  const revoke = at(/REVOKE ALL ON TABLE public\.public_keys FROM service_role;/);
  const grant = at(/GRANT\s+SELECT, INSERT, UPDATE ON TABLE public\.public_keys TO service_role;/);
  assert.ok(revoke > -1, 'service_role must be revoked before the narrow grant');
  assert.ok(grant > revoke, 'the grant must follow the revoke, or it is decorative');
  assert.doesNotMatch(CODE, /GRANT\s+ALL ON TABLE public\.public_keys/);
});

test('the eleven keep the broad service_role grant #155 expects', () => {
  for (const t of TARGET_PARITY) {
    assert.match(UP, new RegExp(`GRANT\\s+ALL ON TABLE public\\.${t}\\s+TO service_role;`), `${t}: service_role`);
  }
});

test('the three new sequences are closed to the API roles at birth', () => {
  for (const s of ELEVEN.SEQUENCE_DEFINITIONS.map((x) => x.sequence_name)) {
    assert.match(UP, new RegExp(`REVOKE ALL ON SEQUENCE public\\.${s}\\s+FROM anon, authenticated;`));
    assert.match(UP, new RegExp(`REVOKE ALL ON SEQUENCE public\\.${s}\\s+FROM service_role;`));
    assert.match(UP, new RegExp(`GRANT\\s+USAGE, SELECT ON SEQUENCE public\\.${s}\\s+TO service_role;`));
  }
  assert.doesNotMatch(CODE, /GRANT[^;]*UPDATE[^;]*ON SEQUENCE/i, 'setval is not a backend path');
});

test('B1-SEQ is untouched: no pre-existing staging sequence is named', () => {
  for (const s of PREEXISTING_SEQUENCES) {
    assert.ok(!CODE.includes(s), `${s} belongs to the B1-SEQ lane and must not appear`);
    assert.ok(!DOWN_CODE.includes(s), `${s} must not appear in the rollback either`);
  }
  // and no blanket statement could reach them
  assert.doesNotMatch(CODE, /ALL SEQUENCES IN SCHEMA/i);
  assert.doesNotMatch(CODE, /ALTER DEFAULT PRIVILEGES/i);
});

test('#155 is not duplicated or pre-empted', () => {
  // evidence_class_taxonomy already exists on staging and is not one of the twelve;
  // duplicating its public-read policy here would fork the canonical hardening.
  assert.ok(!CODE.includes('evidence_class_taxonomy'), 'named only in commentary, never executed against');
  assert.ok(!CODE.includes('evidence_sources'));
  assert.ok(!CODE.includes('security_invoker'));
});

// ───────────────────────────────────────────────────────────── no data, no keys

test('nothing is seeded and no key material appears', () => {
  assert.doesNotMatch(CODE, /^\s*(INSERT|COPY|UPDATE|DELETE)\b/mi);
  assert.doesNotMatch(SQL, /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
  assert.doesNotMatch(SQL, /-----BEGIN/);
  // private_key_pem exists as a COLUMN and must not acquire a value or a default
  assert.match(CODE, /private_key_pem text,/);
  assert.doesNotMatch(CODE, /private_key_pem[^,\n]*DEFAULT/);
});

test('Issue #158 is not solved here', () => {
  // The column is deliberately reproduced; removing it belongs to its own lane.
  assert.match(UP, /Issue #158/);
  assert.doesNotMatch(CODE, /DROP COLUMN/i);
});

// ──────────────────────────────────────────────────────────────────── rollback

test('Down drops exactly the twelve, with public_keys last', () => {
  const dropped = [...DOWN.matchAll(/DROP TABLE IF EXISTS public\.(\w+);/g)].map((m) => m[1]);
  assert.equal(dropped.length, 12);
  assert.deepEqual([...dropped].sort(), [...TWELVE].sort());
  assert.equal(dropped[dropped.length - 1], 'public_keys',
    'signature_verification_logs references it, so it drops last');
  assert.ok(dropped.indexOf('signature_verification_logs') < dropped.indexOf('public_keys'));
});

test('Down touches nothing else', () => {
  assert.doesNotMatch(DOWN_CODE, /DROP (SEQUENCE|SCHEMA|ROLE|DATABASE)/i);
  assert.doesNotMatch(DOWN_CODE, /TRUNCATE/i);
  for (const t of ['users', 'vehicles', 'ocr_documents', 'evidence_sources']) {
    assert.ok(!DOWN.includes(`public.${t};`), `Down must not drop ${t}`);
  }
});

// ────────────────────────────────────────────────────────────── receipt fidelity

test('the committed receipts are the runs this migration cites', () => {
  assert.equal(ELEVEN.TOTALS.targets_requested, 11);
  assert.equal(ELEVEN.TOTALS.targets_present, 11);
  assert.equal(ELEVEN.TOTALS.columns, 100);
  assert.equal(PK.TOTALS.targets_requested, 1);
  assert.equal(PK.TOTALS.targets_present, 1);
  assert.equal(PK.TOTALS.columns, 8);
  assert.match(UP, /31770747669/);
  assert.match(UP, /31774496416/);
});

test('the receipts carry no credential, key or connection string', () => {
  for (const f of fs.readdirSync(RECEIPTS)) {
    const raw = fs.readFileSync(path.join(RECEIPTS, f), 'utf8');
    assert.doesNotMatch(raw, /-----BEGIN/);
    assert.doesNotMatch(raw, /postgres(ql)?:\/\//);
    assert.doesNotMatch(raw, /eyJ[A-Za-z0-9_-]{20,}/, 'no JWT may appear in committed evidence');
  }
});

test('the postcondition asserts the same totals the receipts imply', () => {
  const block = UP.slice(UP.indexOf('$parity_postcondition$'));
  const cols = ELEVEN.TOTALS.columns + PK.TOTALS.columns;
  const fks = ELEVEN.FOREIGN_KEYS.length + PK.FOREIGN_KEYS.length;
  assert.match(block, /v_tables <> 12/);
  assert.match(block, new RegExp(`v_cols <> ${cols}`));
  assert.match(block, new RegExp(`v_fks <> ${fks}`));
  assert.match(block, /v_seqs <> 3/);
  assert.match(block, /v_rls <> 12/);
  assert.match(block, /v_exposed <> 0/);
  assert.match(block, /v_pol <> 0/);
});
