/**
 * Guards for the Issue #101 reachability probe (probe #2).
 *
 * Probe #1 answered DB AUTHORIZATION. This one answers REACHABILITY, which means it
 * must read role state, ownership, view internals and function bodies — a strictly
 * larger surface. These tests prove the larger surface did not weaken any safety
 * property: still no apply mode, still no mutation path, still read-only, still no
 * secret or function body emitted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  FOCUS_ROLES, FOCUS_VIEWS, REQUIRED_SECTIONS, ProbeError,
  assertProductionIdentity, assertComplete, sanitizeError,
} from '../scripts/production-issue-101-reachability.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../scripts/production-issue-101-reachability.mjs');
const src = fs.readFileSync(SCRIPT, 'utf8');

const PROD_REF = 'abcdefghijklmnopqrst';
const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FAKE_PASSWORD = ['Sup3r', 'Secret', 'Value'].join('');
const FAKE_HOST = ['db.', PROD_REF, '.example.invalid'].join('');
const FAKE_URI = ['postgres', '://', 'dbuser', ':', FAKE_PASSWORD, '@', FAKE_HOST, ':5432/postgres'].join('');

function expectErr(fn, code) {
  try { fn(); } catch (e) {
    assert.ok(e instanceof ProbeError || e instanceof Error);
    if (code) assert.equal(e.code, code);
    return e;
  }
  assert.fail('expected a throw');
}

// ------------------------------------------------------------- identity

test('staging identity is refused (both directions)', () => {
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${STAGING_REF}.x/postgres`, STAGING_REF).ok, false);
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${STAGING_REF}.x/postgres`, PROD_REF).ok, false);
});

test('production identity is required and fails closed', () => {
  assert.equal(assertProductionIdentity('', PROD_REF).ok, false);
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${PROD_REF}.x/postgres`, 'short').ok, false);
  assert.equal(assertProductionIdentity('postgres://u:p@db.other.x/postgres', PROD_REF).ok, false);
  assert.equal(assertProductionIdentity(`postgres://u:p@db.${PROD_REF}.x/postgres`, PROD_REF).ok, true);
});

// ------------------------------------------------------- no mutation path

test('no executable DDL/DML anywhere in the probe', () => {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  for (const re of [
    /\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\s+TABLE\b/i, /\bDROP\s+(TABLE|VIEW|FUNCTION)\b/i,
    /\bCREATE\s+(TABLE|VIEW|FUNCTION|POLICY)\b/i, /\bALTER\s+(TABLE|VIEW|DEFAULT)\b/i,
    /\bGRANT\b/i, /\bREVOKE\b/i, /\bCOMMIT\b/i, /\bSET\s+ROLE\b/i,
  ]) assert.ok(!re.test(code), `must contain no executable ${re}`);
});

test('transaction control is BEGIN READ ONLY / SET LOCAL / ROLLBACK only', () => {
  const q = [...src.matchAll(/client\.query\(\s*[`'"]([^`'"]+)/g)].map(m => m[1].trim());
  const ctl = q.filter(x => /^(BEGIN|COMMIT|ROLLBACK|SET|SHOW)/i.test(x));
  assert.ok(ctl.includes('BEGIN READ ONLY'));
  assert.ok(ctl.some(x => /^ROLLBACK$/i.test(x)));
  assert.ok(!ctl.some(x => /^COMMIT/i.test(x)));
  assert.ok(!ctl.some(x => /^SET\s+ROLE/i.test(x)), 'must never SET ROLE');
});

test('every query reads catalog metadata only — no application table is read', () => {
  const q = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map(m => m[1].trim());
  const sel = q.filter(x => /^select/i.test(x));
  assert.ok(sel.length >= 7, `expected the full catalog sweep, saw ${sel.length}`);
  for (const x of sel) {
    assert.ok(/pg_roles|pg_auth_members|pg_class|pg_policy|pg_proc|pg_depend|pg_rewrite|pg_trigger|pg_namespace|information_schema|pg_catalog/i.test(x),
      `catalog only: ${x.slice(0, 70)}`);
    assert.ok(!/\bfrom\s+public\.\w/i.test(x), 'must not read application tables');
  }
});

test('read-only state is asserted from the server and throws so finally runs', () => {
  assert.match(src, /show transaction_read_only/i);
  assert.match(src, /throw new ProbeError\('TRANSACTION_NOT_READ_ONLY'\)/);
  const start = src.indexOf("await client.query('BEGIN READ ONLY')");
  const end = src.indexOf('} finally {');
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/process\.exit/.test(body));
  assert.match(src.slice(end), /ROLLBACK[\s\S]*client\.end\(\)/);
});

test('a bounded statement timeout is set', () => assert.match(src, /SET LOCAL statement_timeout/));

test('no apply mode and no phrase gate', () => {
  assert.ok(!/process\.env\.MODE/.test(src));
  assert.ok(!/AUTHORIZATION_PHRASE/.test(src));
});

// ----------------------------------------------- secrets and function bodies

test('function bodies are classified but NEVER emitted', () => {
  // body is selected for classification...
  assert.match(src, /coalesce\(p\.prosrc, ''\) as body/);
  // ...but the mapped output object must not carry it
  const mapped = src.slice(src.indexOf('s.FUNCTION_REACHABILITY = fns.map'), src.indexOf('s.TOTALS = {'));
  assert.ok(!/\bbody:/.test(mapped), 'the emitted row must not include the body');
  assert.match(mapped, /body_length: body\.length/, 'only a length may be emitted');
  assert.match(mapped, /credential_suspected_REDACTED/);
});

test('a credential-bearing body is flagged, not printed', () => {
  assert.match(src, /credential-like text detected in body — REDACTED, not emitted/);
  // The guard is about INTERPOLATION of the body variable, not the word appearing
  // in prose — the redaction warning legitimately says "in body".
  const logged = [...src.matchAll(/console\.log\(([^\n]*)/g)].map(m => m[1]);
  for (const l of logged) {
    assert.ok(!/\$\{\s*body\s*\}/.test(l), `must not interpolate the raw body: ${l.slice(0, 80)}`);
    assert.ok(!/\$\{[^}]*\bf\.body\b[^}]*\}/.test(l), `must not interpolate f.body: ${l.slice(0, 80)}`);
    assert.ok(!/\$\{[^}]*\bprosrc\b[^}]*\}/.test(l), `must not interpolate prosrc: ${l.slice(0, 80)}`);
  }
  // And the emitted JSON receipt carries no body key.
  const mapped = src.slice(src.indexOf('s.FUNCTION_REACHABILITY = fns.map'), src.indexOf('s.TOTALS = {'));
  assert.ok(!/\bbody:/.test(mapped));
});

test('secret values are never interpolated into output', () => {
  const logged = [...src.matchAll(/console\.(log|error)\(([^\n]*)/g)].map(m => m[2]);
  for (const l of logged) {
    for (const f of ['url', 'prodRef', 'PRODUCTION_DATABASE_URL', 'PRODUCTION_PROJECT_REF', 'PRODUCTION_CA_CERT']) {
      assert.ok(!new RegExp(`\\$\\{[^}]*\\b${f}\\b[^}]*\\}`).test(l), `must not interpolate ${f}`);
    }
  }
});

test('sanitizeError drops hostile class names, codes and URIs', () => {
  const e = new Error('x'); e.name = `Err ${FAKE_URI}`; e.code = FAKE_URI;
  const out = sanitizeError(e);
  assert.equal(out, 'Error/UNSPECIFIED');
  for (const secret of [PROD_REF, FAKE_PASSWORD, FAKE_HOST, '@', ':']) assert.ok(!out.includes(secret));
  const p = new ProbeError('TRANSACTION_NOT_READ_ONLY');
  assert.equal(sanitizeError(p), 'ProbeError/TRANSACTION_NOT_READ_ONLY');
});

// ------------------------------------------------ coverage of the ask

test('all eight required sections are declared', () => {
  assert.deepEqual([...REQUIRED_SECTIONS].sort(), [
    'CONNECTIVITY', 'FUNCTION_REACHABILITY', 'POLICY_DETAIL', 'ROLE_MEMBERSHIPS',
    'ROLE_STATE', 'SEQUENCE_STATE', 'TABLE_STATE', 'VIEW_STATE',
  ]);
});

test('role state covers the roles that decide reachability', () => {
  assert.deepEqual(FOCUS_ROLES, ['anon', 'authenticated', 'authenticator', 'service_role', 'postgres']);
  for (const f of ['rolsuper', 'rolbypassrls', 'rolcanlogin', 'rolinherit']) assert.ok(src.includes(f));
  assert.match(src, /pg_auth_members/);
  assert.match(src, /has_database_privilege/);
  assert.match(src, /has_schema_privilege/);
});

test('table ownership is collected (probe #1 lacked it)', () => {
  assert.match(src, /pg_get_userbyid\(c\.relowner\) as owner/);
  assert.match(src, /relforcerowsecurity/);
});

test('view internals cover every requested attribute', () => {
  assert.deepEqual(FOCUS_VIEWS, ['communication_inbox_threads', 'evidence_sources_public', 'source_verification_coverage_public']);
  for (const f of ['security_invoker', 'security_barrier', 'is_updatable', 'extra_rules', 'instead_of_triggers', 'base_relations', 'base_rls_enabled', 'base_owner']) {
    assert.ok(src.includes(f), `view state must include ${f}`);
  }
});

test('sequence inventory covers owner, ACLs and owned-by mapping', () => {
  assert.match(src, /has_sequence_privilege/);
  assert.match(src, /owned_by/);
  assert.match(src, /sequences_anon_update/);
});

test('function reachability classifies the indirect-bridge question', () => {
  for (const f of ['security_definer', 'language', 'volatility', 'search_path', 'body_can_mutate', 'body_can_ddl', 'body_can_truncate', 'body_uses_dynamic_sql', 'indirect_bridge_candidate', 'is_trigger_function']) {
    assert.ok(src.includes(f), `function state must include ${f}`);
  }
});

// -------------------------------------------------------- fail-closed

function full() {
  const s = { TOTALS: { tables: 183 } };
  for (const k of REQUIRED_SECTIONS) s[k] = [];
  s.ROLE_STATE = [{ rolname: 'anon' }];
  s.VIEW_STATE = FOCUS_VIEWS.map(v => ({ view_name: v, focus: true }));
  return s;
}

test('a complete result passes', () => assert.equal(assertComplete(full()).ok, true));

test('a MISSING section fails rather than reporting completion', () => {
  for (const k of REQUIRED_SECTIONS) {
    const s = full(); delete s[k];
    const r = assertComplete(s);
    assert.equal(r.ok, false, `${k} missing must fail`);
    assert.match(r.reason, new RegExp(k));
  }
});

test('zero tables, zero roles, or a missing focus view fails', () => {
  const a = full(); a.TOTALS.tables = 0;
  assert.equal(assertComplete(a).ok, false);
  const b = full(); b.ROLE_STATE = [];
  assert.match(assertComplete(b).reason, /role state/);
  const c = full(); c.VIEW_STATE = c.VIEW_STATE.slice(0, 1);
  assert.match(assertComplete(c).reason, /focus view/);
});
