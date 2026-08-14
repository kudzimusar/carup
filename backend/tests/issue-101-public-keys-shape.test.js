/**
 * Guards for the public_keys DEPENDENCY shape probe.
 *
 * Two properties matter most here and neither is inherited automatically:
 *   1. scope is exactly ONE relation — deploy-hardening-schema.js creates several
 *      tables alongside public_keys and none of them may be dragged in;
 *   2. public_keys holds key material, so the probe must read column NAMES and never
 *      column VALUES.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  DEPENDENCY_TABLES, REQUIRED_SECTIONS, ProbeError,
  assertProductionIdentity, assertComplete, sanitizeError,
} from '../scripts/production-issue-101-public-keys-shape.mjs';
import { TARGET_TABLES } from '../scripts/production-issue-101-schema-shape.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../scripts/production-issue-101-public-keys-shape.mjs');
const PARENT = path.resolve(__dirname, '../scripts/production-issue-101-schema-shape.mjs');
const src = fs.readFileSync(SCRIPT, 'utf8');
/** Doc prose wraps across comment lines; normalise before matching sentences. */
const prose = src.replace(/\s*\n\s*\*\s*/g, ' ').replace(/\s+/g, ' ');

const PROD_REF = 'abcdefghijklmnopqrst';
const STAGING_REF = 'eoyenigwevnxwwhyhaer';

// ------------------------------------------------------------------ scope

test('the scope is EXACTLY one relation', () => {
  assert.deepEqual(DEPENDENCY_TABLES, ['public_keys']);
});

test('no other hardening table is dragged in', () => {
  // deploy-hardening-schema.js also creates these; none may appear.
  for (const other of ['system_failures', 'performance_telemetry', 'signature_verification_logs',
                       'administrative_overrides', 'system_audit_logs', 'ai_inference_logs']) {
    assert.ok(!DEPENDENCY_TABLES.includes(other), `${other} must not be in scope`);
  }
  assert.ok(!/administrative_overrides/.test(src));
});

test('public_keys is NOT added to the #155 fourteen-table target set', () => {
  assert.ok(!TARGET_TABLES.includes('public_keys'),
    'public_keys is a dependency-only parity object, not a remediation target');
  assert.match(src, /DEPENDENCY-ONLY parity object/);
  assert.match(prose, /NOT joining #155's fourteen-table remediation target set/);
});

test('the scope guard rejects any other relation appearing in the result', () => {
  const s = base();
  s.COLUMNS.push({ table_name: 'system_failures', column_name: 'x' });
  const r = assertComplete(s, DEPENDENCY_TABLES);
  assert.equal(r.ok, false);
  assert.match(r.reason, /out-of-scope relation/);
});

// ------------------------------------------------------------------ reuse

test('it reuses the #156 catalog model rather than inventing another', () => {
  assert.match(src, /from '\.\/production-issue-101-schema-shape\.mjs'/);
  assert.match(src, /collectSchemaShape\(client, DEPENDENCY_TABLES\)/);
  assert.match(src, /assertComplete\(s, DEPENDENCY_TABLES\)/);
  // it must NOT carry its own catalog SQL
  assert.ok(!/pg_constraint|information_schema\.columns|pg_sequence\b/.test(src),
    'the probe must not re-implement catalog queries');
});

test('every proven category is still required', () => {
  assert.deepEqual([...REQUIRED_SECTIONS].sort(), [
    'COLUMNS', 'CONSTRAINTS', 'FOREIGN_KEYS', 'INDEXES', 'POLICIES',
    'RELATION_ACL', 'SEQUENCE_DEFINITIONS', 'SEQUENCE_DEPENDENCIES',
    'TABLE_IDENTITY', 'TRIGGERS',
  ]);
});

// ----------------------------------------------------------- key material

test('KEY MATERIAL: column values are never read — names and types only', () => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  // no SQL at all in this file, so no SELECT of a column value is possible
  assert.ok(!/client\.query\(\s*`\s*select/i.test(code) || !/from\s+public\./i.test(code),
    'must not select from an application table');
  for (const forbidden of ['private_key_pem', 'key_material', 'secret_key']) {
    assert.ok(!new RegExp(`select[^;]*${forbidden}`, 'i').test(code),
      `must never select ${forbidden}`);
  }
  assert.match(prose, /column NAMES and types, never column VALUES/);
  assert.match(src, /no key material/);
});

test('the parent collector reads no application table either', () => {
  const parent = fs.readFileSync(PARENT, 'utf8');
  const queries = [...parent.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1]);
  for (const q of queries) {
    if (/^\s*(BEGIN|SET|SHOW|ROLLBACK)/i.test(q)) continue;
    assert.ok(!/\bfrom\s+public\.\w/i.test(q), `catalog only: ${q.slice(0, 70)}`);
  }
});

// ---------------------------------------------------------------- safety

test('transaction control and read-only assertion are preserved', () => {
  const q = [...src.matchAll(/client\.query\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1].trim());
  assert.ok(q.includes('BEGIN READ ONLY'));
  assert.ok(q.some((x) => /^ROLLBACK$/i.test(x)));
  assert.ok(!q.some((x) => /^COMMIT/i.test(x)));
  assert.match(src, /show transaction_read_only/i);
  assert.match(src, /throw new ProbeError\('TRANSACTION_NOT_READ_ONLY'\)/);
  assert.match(src, /SET LOCAL statement_timeout/);
  const start = src.indexOf("await client.query('BEGIN READ ONLY')");
  const end = src.indexOf('} finally {');
  assert.ok(start > 0 && end > start);
  assert.match(src.slice(end), /ROLLBACK[\s\S]*client\.end\(\)/);
});

test('no apply mode, no DDL/DML, no SET ROLE', () => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``');
  assert.ok(!/process\.env\.MODE/.test(code));
  assert.ok(!/AUTHORIZATION_PHRASE/.test(code));
  for (const re of [/\bINSERT\s+INTO\b/i, /\bDELETE\s+FROM\b/i, /\bCREATE\s+TABLE\b/i,
                    /\bALTER\s+TABLE\b/i, /\bGRANT\b/i, /\bREVOKE\b/i, /\bSET\s+ROLE\b/i]) {
    assert.ok(!re.test(code), `must contain no ${re}`);
  }
});

test('identity: staging refused, production required, secrets sanitised', () => {
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${STAGING_REF}.x/postgres`, STAGING_REF).ok, false);
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${STAGING_REF}.x/postgres`, PROD_REF).ok, false);
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${PROD_REF}.x/postgres`, PROD_REF).ok, true);
  const e = new Error('x'); e.name = 'Err'; e.code = 'postgres://u:p@h/db';
  assert.equal(sanitizeError(e), 'Error/UNSPECIFIED');
  const logged = [...src.matchAll(/console\.(log|error)\(([^\n]*)/g)].map((m) => m[2]);
  for (const l of logged) {
    for (const f of ['url', 'prodRef', 'PRODUCTION_DATABASE_URL', 'PRODUCTION_PROJECT_REF']) {
      assert.ok(!new RegExp(`\\$\\{[^}]*\\b${f}\\b[^}]*\\}`).test(l), `must not interpolate ${f}`);
    }
  }
});

// ---------------------------------------------------------- completeness

function base() {
  const s = { TOTALS: { targets_present: 1 } };
  for (const k of REQUIRED_SECTIONS) s[k] = [];
  s.TABLE_IDENTITY = [{ table_name: 'public_keys', exists: true }];
  s.COLUMNS = [{ table_name: 'public_keys', column_name: 'id' }];
  return s;
}

test('a complete single-target shape passes', () => {
  assert.equal(assertComplete(base(), DEPENDENCY_TABLES).ok, true);
});

test('a present public_keys with zero columns FAILS', () => {
  const s = base(); s.COLUMNS = [];
  const r = assertComplete(s, DEPENDENCY_TABLES);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no columns captured/);
});

test('an ABSENT public_keys is a legitimate explicit finding', () => {
  const s = base();
  s.TABLE_IDENTITY = [{ table_name: 'public_keys', exists: false }];
  s.COLUMNS = [];
  assert.equal(assertComplete(s, DEPENDENCY_TABLES).ok, true);
});

test('the inherited gates still apply to this probe', () => {
  const s = base();
  s.RELATION_ACL = [{ table_name: 'public_keys', acl: [{ grantor: 'postgres', grantee: 'anon', privilege_type: 'SELECT' }] }];
  assert.match(assertComplete(s, DEPENDENCY_TABLES).reason, /grant-option/);
  const s2 = base();
  s2.SEQUENCE_DEPENDENCIES = [{ table_name: 'public_keys', sequence_name: 'pk_id_seq', sequence_acl: [] }];
  assert.match(assertComplete(s2, DEPENDENCY_TABLES).reason, /lack structural definition/);
});
