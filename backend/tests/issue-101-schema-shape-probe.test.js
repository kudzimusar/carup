/**
 * Guards for the Issue #101 production schema-shape probe.
 *
 * This probe reads DDL metadata, which is a wider surface than the earlier probes —
 * so the guards focus on SCOPE (only the eleven named tables), on read-only-ness, and
 * on the fail-closed rule that a shape which cannot be reconstructed must not be
 * reported as if it could.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  TARGET_TABLES, REQUIRED_SECTIONS, ProbeError, collectSchemaShape,
  assertProductionIdentity, assertComplete, sanitizeError,
} from '../scripts/production-issue-101-schema-shape.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../scripts/production-issue-101-schema-shape.mjs');
const src = fs.readFileSync(SCRIPT, 'utf8');

const PROD_REF = 'abcdefghijklmnopqrst';
const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FAKE_PASSWORD = ['Sup3r', 'Secret', 'Value'].join('');
const FAKE_URI = ['postgres', '://', 'dbuser', ':', FAKE_PASSWORD, '@', 'db.', PROD_REF, '.example.invalid/postgres'].join('');

// ------------------------------------------------------------------ scope

test('the scope is exactly the eleven absent-from-staging tables', () => {
  assert.equal(TARGET_TABLES.length, 11);
  assert.deepEqual([...TARGET_TABLES].sort(), [
    'cid_clearance_records', 'cvr_ownership_records', 'ocr_customs_declarations',
    'ocr_national_ids', 'ocr_registration_books', 'performance_telemetry',
    'signature_verification_logs', 'system_failures', 'vid_inspections',
    'zimra_declarations', 'zinara_licensing_records',
  ]);
  // administrative_overrides is explicitly NOT in scope — deploy-missing-schemas.js
  // creates it, and this lane must not reconstruct it.
  assert.ok(!TARGET_TABLES.includes('administrative_overrides'));
});

test('EVERY catalog query is bound to the target allowlist', () => {
  const queries = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1]);
  assert.ok(queries.length >= 8, `expected the full shape sweep, saw ${queries.length}`);
  for (const q of queries) {
    if (/^\s*(BEGIN|SET|SHOW|ROLLBACK)/i.test(q)) continue;
    // Bound either by `= any($1::text[])` or by `unnest($1::text[])` — both restrict
    // the query to the allowlist; neither permits an unscoped catalog sweep.
    assert.match(q, /(any|unnest)\(\$1::text\[\]\)/,
      `every scoped query must bind the allowlist: ${q.slice(0, 80)}`);
  }
});

test('the scope guard rejects any out-of-scope relation in the result', () => {
  const s = base();
  s.COLUMNS.push({ table_name: 'administrative_overrides', column_name: 'x' });
  const r = assertComplete(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /out-of-scope relation/);
  assert.match(r.reason, /administrative_overrides/);
});

// -------------------------------------------------------------- read-only

test('no executable DDL/DML exists anywhere in the probe', () => {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  for (const re of [
    /\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i, /\bDROP\s+(TABLE|VIEW|FUNCTION)\b/i,
    /\bCREATE\s+(TABLE|VIEW|FUNCTION|POLICY|INDEX)\b/i, /\bALTER\s+(TABLE|VIEW)\b/i,
    /\bGRANT\b/i, /\bREVOKE\b/i, /\bCOMMIT\b/i, /\bSET\s+ROLE\b/i,
  ]) assert.ok(!re.test(code), `must contain no executable ${re}`);
});

test('transaction control is BEGIN READ ONLY / SET LOCAL / ROLLBACK only', () => {
  const q = [...src.matchAll(/client\.query\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1].trim());
  const ctl = q.filter((x) => /^(BEGIN|COMMIT|ROLLBACK|SET|SHOW)/i.test(x));
  assert.ok(ctl.includes('BEGIN READ ONLY'));
  assert.ok(ctl.some((x) => /^ROLLBACK$/i.test(x)));
  assert.ok(!ctl.some((x) => /^COMMIT/i.test(x)));
});

test('the read-only state is asserted from the server and throws so finally runs', () => {
  assert.match(src, /show transaction_read_only/i);
  assert.match(src, /throw new ProbeError\('TRANSACTION_NOT_READ_ONLY'\)/);
  const start = src.indexOf("await client.query('BEGIN READ ONLY')");
  const end = src.indexOf('} finally {');
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/process\.exit/.test(body));
  assert.match(src.slice(end), /ROLLBACK[\s\S]*client\.end\(\)/);
});

test('no application rows are read and no function is invoked', () => {
  const queries = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1]);
  for (const q of queries) {
    if (/^\s*(BEGIN|SET|SHOW|ROLLBACK)/i.test(q)) continue;
    assert.match(q, /pg_class|pg_constraint|pg_indexes|pg_policy|pg_depend|pg_trigger|pg_attribute|pg_namespace|information_schema|aclexplode|acldefault|pg_roles/i,
      `catalog only: ${q.slice(0, 70)}`);
    assert.ok(!/\bfrom\s+public\.\w/i.test(q), 'must not read application tables');
  }
  // trigger functions are named, never called
  assert.match(src, /tgfoid::regprocedure::text/);
  assert.match(src, /never invoked|never called/i);
});

test('no apply mode exists', () => {
  assert.ok(!/process\.env\.MODE/.test(src));
  assert.ok(!/AUTHORIZATION_PHRASE/.test(src));
});

// --------------------------------------------------------------- identity

test('staging identity is refused; production identity required', () => {
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${STAGING_REF}.x/postgres`, STAGING_REF).ok, false);
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${STAGING_REF}.x/postgres`, PROD_REF).ok, false);
  assert.equal(assertProductionIdentity('', PROD_REF).ok, false);
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${PROD_REF}.x/postgres`, 'short').ok, false);
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${PROD_REF}.x/postgres`, PROD_REF).ok, true);
});

test('secrets are never printed and hostile errors are sanitised', () => {
  const logged = [...src.matchAll(/console\.(log|error)\(([^\n]*)/g)].map((m) => m[2]);
  for (const l of logged) {
    for (const f of ['url', 'prodRef', 'PRODUCTION_DATABASE_URL', 'PRODUCTION_PROJECT_REF', 'PRODUCTION_CA_CERT']) {
      assert.ok(!new RegExp(`\\$\\{[^}]*\\b${f}\\b[^}]*\\}`).test(l), `must not interpolate ${f}`);
    }
  }
  const e = new Error('x'); e.name = `Err ${FAKE_URI}`; e.code = FAKE_URI;
  const out = sanitizeError(e);
  assert.equal(out, 'Error/UNSPECIFIED');
  for (const secret of [PROD_REF, FAKE_PASSWORD, '@', ':']) assert.ok(!out.includes(secret));
  assert.equal(sanitizeError(new ProbeError('TRANSACTION_NOT_READ_ONLY')), 'ProbeError/TRANSACTION_NOT_READ_ONLY');
});

// ------------------------------------------------------------ completeness

function base() {
  const s = { TOTALS: { targets_present: 11 } };
  for (const k of REQUIRED_SECTIONS) s[k] = [];
  s.TABLE_IDENTITY = TARGET_TABLES.map((t) => ({ table_name: t, exists: true }));
  s.COLUMNS = TARGET_TABLES.map((t) => ({ table_name: t, column_name: 'id' }));
  return s;
}

test('the collector is parameterisable so a dependency-only probe reuses it', () => {
  // The default is the eleven; passing an explicit set lets the public_keys
  // dependency probe use the IDENTICAL catalog model instead of a second one.
  assert.match(src, /collectSchemaShape\(client, targets = TARGET_TABLES\)/);
  assert.match(src, /assertComplete\(s, targets = TARGET_TABLES\)/);
  const s = base();
  s.TABLE_IDENTITY = [{ table_name: 'public_keys', exists: true }];
  s.COLUMNS = [{ table_name: 'public_keys', column_name: 'id' }];
  assert.equal(assertComplete(s, ['public_keys']).ok, true, 'a single-target run is valid');
  // and scope is still enforced against the SUPPLIED set
  s.COLUMNS.push({ table_name: 'system_failures', column_name: 'x' });
  assert.match(assertComplete(s, ['public_keys']).reason, /out-of-scope relation/);
});

test('all ten shape sections are required', () => {
  assert.deepEqual([...REQUIRED_SECTIONS].sort(), [
    'COLUMNS', 'CONSTRAINTS', 'FOREIGN_KEYS', 'INDEXES', 'POLICIES',
    'RELATION_ACL', 'SEQUENCE_DEFINITIONS', 'SEQUENCE_DEPENDENCIES',
    'TABLE_IDENTITY', 'TRIGGERS',
  ]);
});

// ========== RECONSTRUCTION-COMPLETENESS CORRECTIONS (PR #156 review) ==========

// --- 1. structural sequence shape, and NO application state ---

test('SEQ: pg_sequence structural fields are all collected', () => {
  const q = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1])
    .find((x) => /pg_sequence/.test(x));
  assert.ok(q, 'a pg_sequence query must exist');
  for (const f of ['seqstart', 'seqincrement', 'seqmin', 'seqmax', 'seqcache', 'seqcycle',
                   'seqtypid', 'sequence_schema', 'sequence_name', 'owning_table',
                   'owning_column', 'dependency_type']) {
    assert.match(q, new RegExp(f), `SEQUENCE_DEFINITIONS must capture ${f}`);
  }
});

test('SEQ: sequence VALUES are never read — shape only, not state', () => {
  // Checked against the SQL actually sent, not the source text: the report header
  // legitimately contains the words "no last_value is ever read" as documentation.
  const queries = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1]);
  for (const q of queries) {
    for (const forbidden of ['last_value', 'currval', 'nextval', 'setval', 'pg_sequence_last_value']) {
      assert.ok(!q.toLowerCase().includes(forbidden),
        `no query may read ${forbidden} — that is application state, not DDL shape: ${q.slice(0, 70)}`);
    }
  }
  // pg_sequences (the view exposing last_value) must never be used; pg_sequence is fine.
  assert.ok(!/\bpg_sequences\b/.test(src), 'must use pg_sequence (catalog), never pg_sequences (exposes last_value)');
  // and the guarantee is documented in the receipt
  assert.match(src, /no last_value is ever read/);
});

test('SEQ: a dependency without a structural definition FAILS completeness', () => {
  const s = base();
  s.SEQUENCE_DEPENDENCIES = [{ table_name: 'system_failures', sequence_name: 'system_failures_id_seq', sequence_acl: [] }];
  const r = assertComplete(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /lack structural definition/);
  assert.match(r.reason, /system_failures_id_seq/);
});

test('SEQ: a definition missing any DDL parameter FAILS completeness', () => {
  for (const missing of ['data_type', 'seqstart', 'seqincrement', 'seqmin', 'seqmax', 'seqcache']) {
    const s = base();
    const def = {
      sequence_name: 'x_id_seq', owning_table: 'system_failures', data_type: 'bigint',
      seqstart: '1', seqincrement: '1', seqmin: '1', seqmax: '9223372036854775807',
      seqcache: '1', seqcycle: false,
    };
    delete def[missing];
    s.SEQUENCE_DEFINITIONS = [def];
    s.SEQUENCE_DEPENDENCIES = [{ table_name: 'system_failures', sequence_name: 'x_id_seq', sequence_acl: [] }];
    const r = assertComplete(s);
    assert.equal(r.ok, false, `${missing} missing must fail`);
    assert.match(r.reason, new RegExp(missing));
  }
  // seqcycle must be a real boolean, not merely present
  const s2 = base();
  s2.SEQUENCE_DEFINITIONS = [{ sequence_name: 'x_id_seq', owning_table: 'system_failures', data_type: 'bigint', seqstart: '1', seqincrement: '1', seqmin: '1', seqmax: '9', seqcache: '1', seqcycle: 'no' }];
  s2.SEQUENCE_DEPENDENCIES = [{ table_name: 'system_failures', sequence_name: 'x_id_seq', sequence_acl: [] }];
  assert.match(assertComplete(s2).reason, /seqcycle/);
});

// --- 2. exact ACL: grantor + grant option survive ---

test('ACL: grantor, grantee, privilege_type and is_grantable are all collected', () => {
  assert.match(src, /'grantor',\s*a\.grantor::regrole::text/);
  assert.match(src, /'grantee',\s*case when a\.grantee = 0 then 'PUBLIC'/);
  assert.match(src, /'privilege_type', a\.privilege_type/);
  assert.match(src, /'is_grantable',\s*a\.is_grantable/);
  // and the helper is used for BOTH relations and sequences
  assert.ok((src.match(/aclJson\(/g) || []).length >= 3, 'aclJson must define and be reused');
});

test('ACL: SELECT and SELECT WITH GRANT OPTION do not collapse in the receipt', () => {
  const plain = { grantor: 'postgres', grantee: 'anon', privilege_type: 'SELECT', is_grantable: false };
  const grantable = { grantor: 'postgres', grantee: 'anon', privilege_type: 'SELECT', is_grantable: true };
  assert.notEqual(JSON.stringify(plain), JSON.stringify(grantable),
    'the two privileges must serialize differently');
  const s = base();
  s.RELATION_ACL = [{ table_name: 'system_failures', acl_is_default: false, acl: [plain, grantable] }];
  assert.equal(assertComplete(s).ok, true);
  const round = JSON.parse(JSON.stringify(s.RELATION_ACL[0].acl));
  assert.equal(round.filter((a) => a.is_grantable).length, 1, 'grant option survives serialization');
  assert.equal(round.filter((a) => !a.is_grantable).length, 1);
});

test('ACL: losing is_grantable or grantor FAILS completeness', () => {
  for (const field of ['grantor', 'grantee', 'privilege_type', 'is_grantable']) {
    const entry = { grantor: 'postgres', grantee: 'anon', privilege_type: 'SELECT', is_grantable: false };
    delete entry[field];
    const s = base();
    s.RELATION_ACL = [{ table_name: 'system_failures', acl: [entry] }];
    const r = assertComplete(s);
    assert.equal(r.ok, false, `${field} missing must fail`);
    assert.match(r.reason, new RegExp(field === 'is_grantable' ? 'grant-option' : field));
  }
});

test('ACL: the same gate applies to SEQUENCE ACLs', () => {
  const s = base();
  s.SEQUENCE_DEFINITIONS = [{ sequence_name: 'q', owning_table: 'system_failures', data_type: 'bigint', seqstart: '1', seqincrement: '1', seqmin: '1', seqmax: '9', seqcache: '1', seqcycle: false }];
  s.SEQUENCE_DEPENDENCIES = [{ table_name: 'system_failures', sequence_name: 'q',
    sequence_acl: [{ grantor: 'postgres', grantee: 'anon', privilege_type: 'USAGE' }] }];
  assert.match(assertComplete(s).reason, /grant-option/);
});

// --- 3. type / identity reconstruction ---

test('TYPE: udt_schema, domain and identity configuration are collected', () => {
  const q = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1])
    .find((x) => /information_schema\.columns/.test(x));
  for (const f of ['udt_schema', 'udt_name', 'domain_schema', 'domain_name',
                   'identity_start', 'identity_increment', 'identity_minimum',
                   'identity_maximum', 'identity_cycle', 'is_generated',
                   'generation_expression', 'collation_name', 'numeric_precision']) {
    assert.match(q, new RegExp(f), `columns must capture ${f}`);
  }
});

test('TYPE: custom types/domains are reported as P2 dependencies, never guessed', () => {
  assert.match(src, /CUSTOM_TYPE_DEPENDENCIES/);
  assert.match(src, /must not be guessed in P2/);
  assert.match(src, /custom_type_or_domain_columns/);
});

// --- 4. constraint <-> backing index linkage ---

test('INDEX: constraints expose their backing index', () => {
  assert.match(src, /nullif\(con\.conindid, 0\)::regclass::text as backing_index/);
});

test('INDEX: every index is classified constraint-backed or independent', () => {
  assert.match(src, /constraint_backed/);
  assert.match(src, /backing_for_constraint/);
  assert.match(src, /left join pg_constraint con on con\.conindid = i\.indexrelid/);
  assert.match(src, /must NOT be recreated as standalone indexes/);
  assert.match(src, /constraint_backed_indexes/);
  assert.match(src, /independent_indexes/);
});

test('INDEX: a constraint whose backing index is unreconcilable FAILS completeness', () => {
  const s = base();
  s.CONSTRAINTS = [{ table_name: 'system_failures', constraint_name: 'sf_pkey', backing_index: 'public.sf_pkey_idx' }];
  const r = assertComplete(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /backing index that is not in the index inventory/);
  // ...and passes once the index IS present
  s.INDEXES = [{ table_name: 'system_failures', index_name: 'sf_pkey_idx', constraint_backed: true }];
  assert.equal(assertComplete(s).ok, true);
});

test('a complete shape passes', () => assert.equal(assertComplete(base()).ok, true));

test('a MISSING section fails rather than reporting completion', () => {
  for (const k of REQUIRED_SECTIONS) {
    const s = base(); delete s[k];
    const r = assertComplete(s);
    assert.equal(r.ok, false, `${k} missing must fail`);
    assert.match(r.reason, new RegExp(k));
  }
});

test('a PRESENT table with no columns FAILS — a shape cannot be reconstructed from nothing', () => {
  const s = base();
  s.COLUMNS = s.COLUMNS.filter((c) => c.table_name !== 'ocr_national_ids');
  const r = assertComplete(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no columns captured/);
  assert.match(r.reason, /ocr_national_ids/);
});

test('incomplete target coverage fails', () => {
  const s = base();
  s.TABLE_IDENTITY = s.TABLE_IDENTITY.slice(0, 5);
  assert.match(assertComplete(s).reason, /did not cover all 11 target/);
});

test('an ABSENT table is reported, not silently dropped', () => {
  const s = base();
  s.TABLE_IDENTITY = s.TABLE_IDENTITY.map((t, i) => i === 0 ? { ...t, exists: false } : t);
  s.COLUMNS = s.COLUMNS.filter((c) => c.table_name !== s.TABLE_IDENTITY[0].table_name);
  assert.equal(assertComplete(s).ok, true, 'absent tables are a legitimate finding');
  assert.match(src, /absent_names/, 'and they must be named in the totals');
});

/**
 * The eleven-table receipt is what run 31770747669 already certified, so it is pinned
 * here independently of the wrapper's suite: parameterising the collector for a
 * one-relation caller must not have moved this probe's own numbers by one.
 */
test('the DEFAULT scope still reports eleven requested targets', async () => {
  const calls = [];
  const stub = {
    async query(sql, params) {
      calls.push(params);
      if (/to_regclass/.test(sql)) {
        return { rows: TARGET_TABLES.map((t) => ({ table_name: t, exists: true, owner: 'postgres', rls_enabled: false, rls_forced: false })) };
      }
      return { rows: [] };
    },
  };
  const s = await collectSchemaShape(stub); // no targets argument
  assert.equal(TARGET_TABLES.length, 11);
  assert.equal(s.TOTALS.targets_requested, 11);
  assert.equal(s.TOTALS.targets_present, 11);
  assert.equal(s.TOTALS.targets_absent, 0);
  assert.deepEqual(s.TOTALS.absent_names, []);
  // the default really reached the catalog queries as the eleven-element array
  for (const p of calls) if (p) assert.deepEqual(p[0], TARGET_TABLES);
});

test('under the DEFAULT scope an absent target is still named', async () => {
  const stub = {
    async query(sql) {
      if (/to_regclass/.test(sql)) {
        return { rows: TARGET_TABLES.map((t, i) => ({ table_name: t, exists: i > 1, owner: i > 1 ? 'postgres' : null, rls_enabled: false, rls_forced: false })) };
      }
      return { rows: [] };
    },
  };
  const s = await collectSchemaShape(stub);
  assert.equal(s.TOTALS.targets_requested, 11);
  assert.equal(s.TOTALS.targets_present, 9);
  assert.equal(s.TOTALS.targets_absent, 2);
  assert.deepEqual(s.TOTALS.absent_names, TARGET_TABLES.slice(0, 2));
});
