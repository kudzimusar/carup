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
  TARGET_TABLES, REQUIRED_SECTIONS, ProbeError,
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

test('all nine shape sections are required', () => {
  assert.deepEqual([...REQUIRED_SECTIONS].sort(), [
    'COLUMNS', 'CONSTRAINTS', 'FOREIGN_KEYS', 'INDEXES', 'POLICIES',
    'RELATION_ACL', 'SEQUENCE_DEPENDENCIES', 'TABLE_IDENTITY', 'TRIGGERS',
  ]);
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
  assert.match(assertComplete(s).reason, /all eleven targets/);
});

test('an ABSENT table is reported, not silently dropped', () => {
  const s = base();
  s.TABLE_IDENTITY = s.TABLE_IDENTITY.map((t, i) => i === 0 ? { ...t, exists: false } : t);
  s.COLUMNS = s.COLUMNS.filter((c) => c.table_name !== s.TABLE_IDENTITY[0].table_name);
  assert.equal(assertComplete(s).ok, true, 'absent tables are a legitimate finding');
  assert.match(src, /absent_names/, 'and they must be named in the totals');
});
