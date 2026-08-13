/**
 * Guards for the Issue #101 production security inventory probe.
 *
 * The probe is a READ-ONLY diagnostic that runs against the production database
 * under owner dispatch. These tests prove — without a database — that it cannot
 * become anything else: no apply mode, no mutation path, no secret emission,
 * a structurally read-only transaction, a pinned candidate SHA, and a fail-closed
 * completeness gate so a partial inventory can never read as a complete one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  P0_TABLES,
  CUTOVER_SEVEN,
  REQUIRED_SECTIONS,
  REQUIRED_SERVICE_ROLE_PRIVS,
  TABLE_PRIVS,
  ProbeError,
  assertProductionIdentity,
  assertInventoryComplete,
  sanitizeError,
} from '../scripts/production-issue-101-inventory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../scripts/production-issue-101-inventory.mjs');
const src = fs.readFileSync(SCRIPT, 'utf8');

const PROD_REF = 'abcdefghijklmnopqrst';        // 20-char shape, not a real ref
const STAGING_REF = 'eoyenigwevnxwwhyhaer';

// Leak-test fixtures are ASSEMBLED AT RUNTIME from fragments. CR-1 forbids a real
// production project ref or a credential-bearing postgres URI appearing literally
// in any executable file — including a test that exists to prove they never leak.
const FAKE_PASSWORD = ['Sup3r', 'Secret', 'Value'].join('');
const FAKE_HOST = ['db.', PROD_REF, '.example.invalid'].join('');
const FAKE_URI = ['postgres', '://', 'dbuser', ':', FAKE_PASSWORD, '@', FAKE_HOST, ':5432/postgres'].join('');

// ------------------------------------------------------------ identity gate

test('staging identity is rejected — staging ref supplied as the production ref', () => {
  const r = assertProductionIdentity(`postgres://u:p@db.${STAGING_REF}.supabase.co:5432/postgres`, STAGING_REF);
  assert.equal(r.ok, false);
  assert.match(r.reason, /STAGING/i);
});

test('staging identity is rejected — connection string points at staging', () => {
  const r = assertProductionIdentity(`postgres://u:p@db.${STAGING_REF}.supabase.co:5432/postgres`, PROD_REF);
  assert.equal(r.ok, false);
  assert.match(r.reason, /does not reference PRODUCTION_PROJECT_REF|STAGING/i);
});

test('production identity is required — missing ref fails closed', () => {
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${PROD_REF}.supabase.co/postgres`, '').ok, false);
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${PROD_REF}.supabase.co/postgres`, undefined).ok, false);
});

test('production identity is required — malformed ref fails closed', () => {
  const r = assertProductionIdentity(`postgres://u:p@db.short.supabase.co/postgres`, 'short');
  assert.equal(r.ok, false);
  assert.match(r.reason, /20-char/);
});

test('production identity is required — URL must positively contain the ref', () => {
  const r = assertProductionIdentity('postgres://u:p@db.someotherproject.supabase.co/postgres', PROD_REF);
  assert.equal(r.ok, false);
  assert.match(r.reason, /does not reference PRODUCTION_PROJECT_REF/);
});

test('a missing connection string fails closed', () => {
  assert.equal(assertProductionIdentity('', PROD_REF).ok, false);
  assert.equal(assertProductionIdentity(undefined, PROD_REF).ok, false);
});

test('a well-formed production identity is accepted', () => {
  const r = assertProductionIdentity(`postgres://u:p@db.${PROD_REF}.supabase.co:5432/postgres?sslmode=require`, PROD_REF);
  assert.equal(r.ok, true);
});

// --------------------------------------------------------- no mutation path

test('the script contains NO executable DDL/DML statement', () => {
  // Strip comments and string literals so prose and error text cannot false-positive.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  const forbidden = [
    /\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\s+TABLE\b/i, /\bDROP\s+(TABLE|VIEW|FUNCTION|SCHEMA|INDEX)\b/i,
    /\bCREATE\s+(TABLE|VIEW|FUNCTION|INDEX|SCHEMA|POLICY)\b/i,
    /\bALTER\s+(TABLE|VIEW|FUNCTION|DEFAULT|ROLE)\b/i,
    /\bGRANT\b/i, /\bREVOKE\b/i, /\bCOMMIT\b/i,
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(code), `script must contain no executable ${re} statement`);
  }
});

test('the only transaction control is BEGIN READ ONLY / SET LOCAL / ROLLBACK', () => {
  const queries = [...src.matchAll(/client\.query\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1].trim());
  assert.ok(queries.length > 0, 'expected client.query call sites');
  const control = queries.filter((q) => /^(BEGIN|COMMIT|ROLLBACK|SET|SHOW)/i.test(q));
  assert.ok(control.includes('BEGIN READ ONLY'), 'must open BEGIN READ ONLY');
  assert.ok(control.some((q) => /^ROLLBACK$/i.test(q)), 'must close with ROLLBACK');
  assert.ok(!control.some((q) => /^COMMIT/i.test(q)), 'must never COMMIT');
});

test('every inventory query is a read against catalog/metadata only', () => {
  const queries = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1].trim());
  const selects = queries.filter((q) => /^select/i.test(q));
  assert.ok(selects.length >= 5, `expected several catalog SELECTs, saw ${selects.length}`);
  for (const q of selects) {
    assert.ok(
      /pg_class|pg_policy|pg_default_acl|pg_proc|pg_roles|pg_namespace|information_schema/i.test(q),
      `query must read catalog metadata, got: ${q.slice(0, 80)}`,
    );
  }
});

test('the transaction read-only state is asserted from the server, not assumed', () => {
  assert.match(src, /show transaction_read_only/i);
  assert.match(src, /TRANSACTION_NOT_READ_ONLY/);
});

test('a conservative statement timeout is set inside the transaction', () => {
  assert.match(src, /SET LOCAL statement_timeout/);
});

// ------------------------------------------------------------ no apply mode

test('the script has no apply mode and no authorization phrase', () => {
  assert.ok(!/MODE\s*===?\s*['"]apply['"]/.test(src), 'must not branch on an apply mode');
  assert.ok(!/AUTHORIZATION_PHRASE/.test(src), 'must not accept an authorization phrase');
  assert.ok(!/process\.env\.MODE/.test(src), 'must not read a MODE input at all');
});

// -------------------------------------------------------------- no secrets

test('secret values are never emitted', () => {
  const logged = [...src.matchAll(/console\.(log|error)\(([^\n]*)/g)].map((m) => m[2]);
  for (const line of logged) {
    for (const forbidden of ['url', 'prodRef', 'PRODUCTION_DATABASE_URL', 'PRODUCTION_PROJECT_REF', 'PRODUCTION_CA_CERT', 'connectionString']) {
      assert.ok(
        !new RegExp(`\\$\\{[^}]*\\b${forbidden}\\b[^}]*\\}`).test(line),
        `console output must never interpolate ${forbidden}: ${line.slice(0, 100)}`,
      );
    }
  }
  // The receipt is built only from catalog sections.
  assert.match(src, /JSON\.stringify\(sections/);
});

test('no application row contents are selected', () => {
  const queries = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1]);
  for (const q of queries) {
    assert.ok(!/\bfrom\s+public\.\w+/i.test(q), `must not read application tables: ${q.slice(0, 80)}`);
    assert.ok(!/count\(\*\)\s*from\s+(?!pg_policy)\w/i.test(q) || /pg_/.test(q), 'row counts of application tables are out of scope');
  }
});

// ------------------------------------------------- completeness (fail-closed)

function fullSections(tableCount = 3) {
  const s = { TOTALS: { public_tables: tableCount } };
  for (const name of REQUIRED_SECTIONS) s[name] = [];
  s.ANON_AUTH_TABLE_GRANTS = Array.from({ length: tableCount }, (_, i) => ({ table: `t${i}` }));
  s.P0_TABLE_POSTURE = P0_TABLES.map((t) => ({ table: t, exists: false }));
  s.CUTOVER_SEVEN_REGRESSION = CUTOVER_SEVEN.map((t) => ({ table: t, regressed: false }));
  return s;
}

test('a complete inventory passes the gate', () => {
  assert.equal(assertInventoryComplete(fullSections()).ok, true);
});

test('all twelve required sections are declared', () => {
  for (const name of [
    'RLS_DISABLED_IN_PUBLIC', 'ANON_AUTH_TABLE_GRANTS', 'TRUNCATE_EXPOSURE', 'POLICIES',
    'DEFAULT_ACL', 'SECURITY_DEFINER_VIEWS', 'SECURITY_DEFINER_FUNCTIONS',
    'VIEW_SECURITY_INVOKER_POSTURE', 'FUNCTION_SEARCH_PATH', 'FUNCTION_EXECUTE_GRANTS',
    'P0_TABLE_POSTURE', 'CUTOVER_SEVEN_REGRESSION',
  ]) {
    assert.ok(REQUIRED_SECTIONS.includes(name), `${name} must be a required section`);
  }
  assert.equal(REQUIRED_SECTIONS.length, 12);
});

test('a MISSING section fails rather than reporting completion', () => {
  for (const name of REQUIRED_SECTIONS) {
    const s = fullSections();
    delete s[name];
    const r = assertInventoryComplete(s);
    assert.equal(r.ok, false, `${name} missing must fail`);
    assert.match(r.reason, new RegExp(name));
  }
});

test('a PARTIAL inventory fails — zero tables observed', () => {
  const s = fullSections();
  s.TOTALS.public_tables = 0;
  const r = assertInventoryComplete(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /zero public tables/);
});

test('a PARTIAL inventory fails — P0 coverage incomplete', () => {
  const s = fullSections();
  s.P0_TABLE_POSTURE = s.P0_TABLE_POSTURE.slice(0, 2);
  assert.equal(assertInventoryComplete(s).ok, false);
});

test('a PARTIAL inventory fails — cutover-seven coverage incomplete', () => {
  const s = fullSections();
  s.CUTOVER_SEVEN_REGRESSION = s.CUTOVER_SEVEN_REGRESSION.slice(0, 3);
  assert.equal(assertInventoryComplete(s).ok, false);
});

test('a malformed TOTALS block fails', () => {
  const s = fullSections();
  delete s.TOTALS;
  assert.equal(assertInventoryComplete(s).ok, false);
});

test('the five P0 tables and seven cutover tables are exactly the expected sets', () => {
  assert.deepEqual([...P0_TABLES].sort(), ['kyc_profiles', 'public_keys', 'security_events', 'stolen_vehicles', 'tenant_api_keys']);
  assert.deepEqual([...CUTOVER_SEVEN].sort(), [
    'mechanic_parts', 'mechanic_work_orders', 'rolling_integrity_checkpoints',
    'trust_score_history', 'vehicle_evidence', 'vehicle_ownership_history', 'vehicles',
  ]);
});

test('the RLS section is labelled a catalog equivalent, never literal advisor output', () => {
  assert.match(src, /PRODUCTION CATALOG EQUIVALENT — rls_disabled_in_public/);
  assert.match(src, /NOT literal Supabase get_advisors output/i);
});


// ============================================================ CORRECTIVE GUARDS

// --- 1. the grant census must cover EVERY public table -----------------------

test('the grant census must cover every public table (fail-closed invariant)', () => {
  const s = fullSections(10);
  s.ANON_AUTH_TABLE_GRANTS = s.ANON_AUTH_TABLE_GRANTS.slice(0, 4); // write-carrying subset only
  const r = assertInventoryComplete(s);
  assert.equal(r.ok, false, 'a partial census must fail');
  assert.match(r.reason, /covers 4 of 10 public tables/);
  assert.match(r.reason, /SELECT-only, REFERENCES-only or TRIGGER-only/);
});

test('a census equal in length to public_tables passes', () => {
  assert.equal(assertInventoryComplete(fullSections(7)).ok, true);
});

test('the census emits all four roles across all seven privileges', () => {
  assert.deepEqual(TABLE_PRIVS, ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']);
  for (const role of ['anon', 'authenticated', 'public', 'service_role']) {
    assert.ok(new RegExp(`${role}:\\s*t\\.${role}`).test(src) || src.includes(`${role}: t.${role}`),
      `census row must carry ${role}`);
  }
  // and the census is built from every table, not a filtered subset
  assert.match(src, /sections\.ANON_AUTH_TABLE_GRANTS = tables\.map\(/);
});

test('derived write/exposure totals remain separate from the census', () => {
  assert.match(src, /api_writable_tables:[^\n]*api_write_exposed/);
  assert.match(src, /api_exposed_tables_any_privilege/);
  assert.match(src, /grant_census_rows/);
});

// --- 2. materialized views are not SECURITY DEFINER views --------------------

test('SECURITY_DEFINER_VIEWS includes ordinary views only', () => {
  assert.match(src, /\.filter\(\(v\) => v\.kind === 'view' && !v\.security_invoker\)/);
});

test('materialized views remain in VIEW_SECURITY_INVOKER_POSTURE', () => {
  assert.match(src, /kind: v\.kind === 'm' \? 'materialized' : 'view'/);
  assert.match(src, /materialized_views:/);
});

// --- 3. cutover-seven detects BOTH regression directions ---------------------

test('cutover regression reports all four roles', () => {
  for (const f of ['anon', 'authenticated', 'public:', 'service_role:']) {
    assert.ok(src.includes(f), `cutover row must report ${f}`);
  }
  assert.match(src, /expected_service_role/);
});

test('cutover regression detects reopened API access', () => {
  assert.match(src, /api_access_reopened/);
  assert.match(src, /PUBLIC expected \[none\]/);
});

test('cutover regression detects LOST service-role access', () => {
  assert.match(src, /service_role_access_lost/);
  assert.match(src, /service_role LOST \$\{required\} — backend access broken/);
  assert.deepEqual(REQUIRED_SERVICE_ROLE_PRIVS, ['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
});

// --- 4. no uncontrolled error output ----------------------------------------

test('sanitizeError never leaks a message containing credentials', () => {
  const leaky = new Error(
    `connection to server at "${FAKE_HOST}" failed: ` +
    'password authentication failed for user "dbuser"; ' +
    `connectionString=${FAKE_URI}`,
  );
  leaky.code = '28P01';
  const out = sanitizeError(leaky);
  assert.equal(out, 'Error/28P01');
  for (const secret of [PROD_REF, FAKE_PASSWORD, FAKE_HOST, FAKE_URI, 'dbuser', 'password']) {
    assert.ok(!out.includes(secret), 'sanitized output leaked a fixture value');
  }
});

test('sanitizeError bounds a hostile error code AND a hostile class name', () => {
  // Regression: stripping non-letters from `name` would concatenate the URL and
  // preserve the project ref verbatim. An unknown class must collapse to 'Error'.
  const hostile = new Error('boom');
  hostile.name = `Err ${FAKE_URI}`;
  hostile.code = FAKE_URI;
  const out = sanitizeError(hostile);
  assert.equal(out, 'Error/UNSPECIFIED');
  for (const secret of [PROD_REF, FAKE_PASSWORD, FAKE_HOST, FAKE_URI, '@', ':']) {
    assert.ok(!out.includes(secret), 'sanitized output leaked a fixture value');
  }
});

test('sanitizeError drops a lowercase project-ref-shaped code', () => {
  const e = new Error('x'); e.code = PROD_REF; // 20-char lowercase, ref-shaped
  assert.equal(sanitizeError(e), 'Error/UNSPECIFIED');
});

test('sanitizeError tolerates non-Error throwables', () => {
  assert.equal(sanitizeError(undefined), 'Error/UNSPECIFIED');
  assert.equal(sanitizeError(FAKE_URI), 'Error/UNSPECIFIED');
  // An unrecognised class collapses to 'Error'; a well-formed code survives.
  assert.equal(sanitizeError({ name: 'X', code: 'ECONNREFUSED' }), 'Error/ECONNREFUSED');
  assert.equal(sanitizeError({ name: 'TypeError', code: 'ECONNREFUSED' }), 'TypeError/ECONNREFUSED');
});

test('the top-level catch emits only the sanitized form', () => {
  assert.match(src, /inventory failed \(sanitized\): \$\{sanitizeError\(err\)\}/);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/err\.message/.test(code), 'err.message must never be emitted in executable code');
  assert.ok(!/\$\{[^}]*\berr\b[^}]*\}/.test(code.replace('${sanitizeError(err)}', '')),
    'no console output may interpolate the raw error');
});

test('the read-only assertion THROWS so finally still rolls back', () => {
  assert.match(src, /throw new ProbeError\('TRANSACTION_NOT_READ_ONLY'\)/);
  // process.exit must not be reachable from inside the transaction body
  const start = src.indexOf("await client.query('BEGIN READ ONLY')");
  const end = src.indexOf('} finally {');
  assert.ok(start > 0 && end > start, 'expected a try/finally around the transaction');
  // Strip comments: the body documents WHY process.exit() is avoided here.
  const txnBody = src.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/process\.exit/.test(txnBody), 'no process.exit inside the transaction');
  assert.ok(!/\bfail\(/.test(txnBody), 'no fail() inside the transaction — it would skip finally');
  assert.match(src.slice(end), /ROLLBACK[\s\S]*client\.end\(\)/);
});

test('ProbeError carries a code and no data', () => {
  const e = new ProbeError('TRANSACTION_NOT_READ_ONLY');
  assert.equal(e.code, 'TRANSACTION_NOT_READ_ONLY');
  assert.equal(sanitizeError(e), 'ProbeError/TRANSACTION_NOT_READ_ONLY');
});
