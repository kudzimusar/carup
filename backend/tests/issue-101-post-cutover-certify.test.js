/**
 * Safety contract for the Issue #101 production post-cutover certifier.
 *
 * The behavioural harness proves the certifier CATCHES things. These tests prove the
 * properties a behavioural run cannot observe: that there is no apply path at all, that
 * every query reads the catalog rather than a public relation, and that no production
 * identifier sits in an executable path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  ALL_TABLE_PRIVILEGES, FOURTEEN, CUTOVER_SEVEN, KEEPS_PUBLIC_READ, VIEW_ALLOWED_GRANTEES,
  PUBLIC_KEYS_SERVICE_ROLE_EXPECTED, PUBLIC_KEYS_SERVICE_ROLE_ABSENT,
  VIEW_PROJECTED_COLUMNS, VIEW_HIDDEN_COLUMNS,
  PRODUCTION_PROJECT_REF_SHA256, STAGING_PROJECT_REF_SHA256, refHash,
  assertProductionIdentity, sanitizeError, evaluate,
} from '../scripts/production-issue-101-post-cutover-certify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'backend/scripts/production-issue-101-post-cutover-certify.mjs');
const src = fs.readFileSync(SCRIPT, 'utf8');
const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');

// ───────────────────────────────────────────────────── no apply path at all

test('there is no apply path, no mode and no phrase gate', () => {
  // Deliberately blunt: the token must not appear in executable code at all, so a
  // future edit cannot reintroduce a write path under a familiar name. The script's own
  // status line is worded to avoid it rather than the test being loosened to allow it.
  assert.doesNotMatch(code, /\bMODE\b/);
  assert.doesNotMatch(code, /apply/i);
  assert.doesNotMatch(code, /process\.env\.CONFIRMATION/);
  assert.doesNotMatch(code, /process\.env\.[A-Z_]*MODE/);
  // no mutating statement anywhere
  assert.doesNotMatch(code, /client\.query\(\s*['"`](COMMIT|INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|SET ROLE)/i);
  assert.doesNotMatch(code, /apply_migration|readFileSync\(join\(.*migrations/);
});

test('the transaction is read-only, asserted from the server, and rolled back', () => {
  assert.match(code, /BEGIN READ ONLY/);
  assert.match(code, /show transaction_read_only/);
  assert.match(code, /TRANSACTION_NOT_READ_ONLY/);
  assert.match(code, /statement_timeout/);
  assert.match(code, /ROLLBACK/);
  assert.doesNotMatch(code, /\bCOMMIT\b/);
  // ROLLBACK must be in a finally, so it runs even when collection throws
  assert.match(code, /finally\s*\{[\s\S]{0,160}ROLLBACK/);
});

// ──────────────────────────────────────────── catalog only, no rows, no keys

test('every query reads the catalog — never a public relation', () => {
  assert.doesNotMatch(code, /\bFROM\s+public\./i,
    'no statement may read from a public relation');
  const sources = [...code.matchAll(/\bfrom\s+(information_schema\.\w+|pg_catalog\.\w+|pg_\w+)/gi)]
    .map((m) => m[1].toLowerCase());
  assert.ok(sources.length > 0);
  for (const s of sources) {
    assert.match(s, /^(information_schema\.columns|pg_class|pg_namespace|pg_policy|pg_attribute|pg_settings|pg_roles|pg_catalog\.pg_roles)$/,
      `unexpected source ${s}`);
  }
});

test('no column VALUE is ever selected — only names and catalog metadata', () => {
  // the hidden columns are named as identifiers in has_column_privilege, never selected
  assert.match(code, /has_column_privilege/);
  for (const c of VIEW_HIDDEN_COLUMNS) {
    assert.doesNotMatch(code, new RegExp(`select[^;]*\\b${c}\\b[^;]*from`, 'i'),
      `${c} must never appear in a SELECT list`);
  }
  assert.doesNotMatch(code, /private_key_pem/, 'the key column is not even named');
});

// ─────────────────────────────────────────────── all eight, and the constants

test('ALL EIGHT PostgreSQL 17 privileges are the unit of measurement', () => {
  assert.deepEqual([...ALL_TABLE_PRIVILEGES].sort(),
    ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']);
  assert.ok(Object.isFrozen(ALL_TABLE_PRIVILEGES));
  assert.ok(PUBLIC_KEYS_SERVICE_ROLE_ABSENT.includes('MAINTAIN'));
  assert.deepEqual(
    [...PUBLIC_KEYS_SERVICE_ROLE_EXPECTED.split(','), ...PUBLIC_KEYS_SERVICE_ROLE_ABSENT].sort(),
    [...ALL_TABLE_PRIVILEGES].sort(),
    'present + absent must partition the eight exactly');
});

test('the fourteen, the taxonomy exception and the cutover-seven are the certified sets', () => {
  assert.equal(FOURTEEN.length, 14);
  assert.ok(FOURTEEN.includes(KEEPS_PUBLIC_READ));
  assert.equal(KEEPS_PUBLIC_READ, 'evidence_class_taxonomy');
  assert.equal(Object.keys(CUTOVER_SEVEN).length, 7);
  assert.equal(Object.values(CUTOVER_SEVEN).filter((v) => v === 'SELECT').length, 2);
  assert.equal(VIEW_PROJECTED_COLUMNS.length, 10);
  assert.deepEqual([...VIEW_HIDDEN_COLUMNS], ['contact_reference', 'credential_reference']);
  for (const c of VIEW_HIDDEN_COLUMNS) assert.ok(!VIEW_PROJECTED_COLUMNS.includes(c));
});

// ──────────────────────────────────────────────────── evaluate() is strict

test('evaluate() fails closed on an empty or partial collection', () => {
  const empty = evaluate({ FOURTEEN: [], CUTOVER_SEVEN: [], VIEW_COLUMNS: [] });
  assert.equal(empty.ok, false);
  assert.ok(empty.problems.length > 0);
  // an absent public_keys / view must be reported, not skipped
  assert.ok(empty.problems.some((p) => /public_keys is absent/.test(p)));
  assert.ok(empty.problems.some((p) => /evidence_sources_public is absent/.test(p)));
  assert.ok(empty.problems.some((p) => /evidence_sources is absent/.test(p)));
});

test('evaluate() requires the taxonomy exception to be exactly SELECT', () => {
  const base = {
    FOURTEEN: FOURTEEN.map((t) => ({
      table_name: t, rls: true, force_rls: false, policies: t === KEEPS_PUBLIC_READ ? 1 : 0,
      anon: t === KEEPS_PUBLIC_READ ? 'SELECT' : 'none',
      authenticated: t === KEEPS_PUBLIC_READ ? 'SELECT' : 'none',
      service_role: 'DELETE,INSERT,SELECT,UPDATE',
    })),
    PUBLIC_KEYS: {
      rls: true, force_rls: false, policies: 0, anon: 'none', authenticated: 'none',
      service_role: 'INSERT,SELECT,UPDATE', service_role_withheld_but_present: '',
    },
    VIEW: {
      relkind: 'v', security_invoker: true, reloptions: '{security_invoker=true}',
      owner: 'db_owner',
      acl: [{ grantee: 'anon', privilege_type: 'SELECT', is_grantable: false },
        { grantee: 'authenticated', privilege_type: 'SELECT', is_grantable: false },
        { grantee: 'service_role', privilege_type: 'SELECT', is_grantable: false },
        { grantee: 'db_owner', privilege_type: 'SELECT', is_grantable: false }],
    },
    VIEW_COLUMNS: [...VIEW_PROJECTED_COLUMNS],
    EVIDENCE_SOURCES: {
      rls: true,
      policies: [{
        policy: 'evidence_sources_public_read', command: 'SELECT',
        roles: ['anon', 'authenticated'], using: '(active = true)',
      }],
    },
    EVIDENCE_SOURCES_COLUMN_GRANTS: [
      ...VIEW_PROJECTED_COLUMNS.map((c) => ({ column_name: c, select_granted_to: 'anon,authenticated' })),
      ...VIEW_HIDDEN_COLUMNS.map((c) => ({ column_name: c, select_granted_to: 'none' })),
    ],
    CUTOVER_SEVEN: Object.entries(CUTOVER_SEVEN).map(([t, e]) => ({
      table_name: t, rls: true, policies: 0,
      anon: e, authenticated: e, service_role: 'DELETE,INSERT,SELECT,UPDATE',
    })),
  };
  const ok = evaluate(base);
  assert.equal(ok.ok, true, `expected clean, got ${JSON.stringify(ok.problems)}`);
  assert.equal(ok.metrics.intentional_public_read_surfaces_after, 1);
  assert.equal(ok.metrics.service_only_tables_with_select_absent, 13);

  // taxonomy gaining a write must fail
  const w = JSON.parse(JSON.stringify(base));
  w.FOURTEEN.find((t) => t.table_name === KEEPS_PUBLIC_READ).anon = 'SELECT,UPDATE';
  assert.equal(evaluate(w).ok, false);

  // a grantable grant on the view must fail
  const g = JSON.parse(JSON.stringify(base));
  g.VIEW.acl[0].is_grantable = true;
  assert.equal(evaluate(g).ok, false);

  // the base policy must be active = true and SELECT-only
  const p = JSON.parse(JSON.stringify(base));
  p.EVIDENCE_SOURCES.policies[0].using = '(true)';
  assert.equal(evaluate(p).ok, false);
  const p2 = JSON.parse(JSON.stringify(base));
  p2.EVIDENCE_SOURCES.policies[0].command = 'ALL';
  assert.equal(evaluate(p2).ok, false);

  // a hidden column projected by the view must fail
  const h = JSON.parse(JSON.stringify(base));
  h.VIEW_COLUMNS.push('contact_reference');
  assert.equal(evaluate(h).ok, false);

  // ── the six review findings, at the pure-function level ──
  const bad = (mutate) => { const c = JSON.parse(JSON.stringify(base)); mutate(c); return evaluate(c); };

  // F1 cutover-seven RLS off
  const f1 = bad((c) => { c.CUTOVER_SEVEN[0].rls = false; });
  assert.equal(f1.ok, false);
  assert.ok(f1.problems.some((p) => /RLS is not enabled/.test(p)));

  // F2 a cutover-seven target missing
  const f2 = bad((c) => { c.CUTOVER_SEVEN.pop(); });
  assert.equal(f2.ok, false);
  assert.ok(f2.problems.some((p) => /target\(s\) absent/.test(p)));
  assert.ok(f2.problems.some((p) => /6\/7 targets present/.test(p)));

  // F3 PUBLIC on the view, an unexpected role, and service_role losing SELECT
  const f3 = bad((c) => c.VIEW.acl.push({ grantee: 'PUBLIC', privilege_type: 'SELECT', is_grantable: false }));
  assert.equal(f3.ok, false);
  assert.ok(f3.problems.some((p) => /unexpected grantee\(s\) PUBLIC/.test(p)));
  const f3b = bad((c) => c.VIEW.acl.push({ grantee: 'interloper', privilege_type: 'SELECT', is_grantable: false }));
  assert.equal(f3b.ok, false);
  const f3c = bad((c) => { c.VIEW.acl = c.VIEW.acl.filter((a) => a.grantee !== 'service_role'); });
  assert.equal(f3c.ok, false);
  assert.ok(f3c.problems.some((p) => /service_role lost SELECT/.test(p)));
  // the OWNER, whatever it is called, must NOT be flagged
  const ownerOk = bad((c) => { c.VIEW.owner = 'some_other_owner';
    c.VIEW.acl = c.VIEW.acl.map((a) => (a.grantee === 'db_owner' ? { ...a, grantee: 'some_other_owner' } : a)); });
  assert.equal(ownerOk.ok, true, `owner must be derived: ${JSON.stringify(ownerOk.problems)}`);

  // F4 an eleventh projected column
  const f4 = bad((c) => c.VIEW_COLUMNS.push('internal_note'));
  assert.equal(f4.ok, false);
  assert.ok(f4.problems.some((p) => /UNEXPECTED column\(s\): internal_note/.test(p)));

  // F5 base policy roles widened, and narrowed
  const f5 = bad((c) => { c.EVIDENCE_SOURCES.policies[0].roles = ['PUBLIC']; });
  assert.equal(f5.ok, false);
  assert.ok(f5.problems.some((p) => /roles are \[PUBLIC\]/.test(p)));
  const f5b = bad((c) => { c.EVIDENCE_SOURCES.policies[0].roles = ['anon']; });
  assert.equal(f5b.ok, false);

  // F6 a projected base column losing its grant, for one role and for both
  const f6 = bad((c) => { c.EVIDENCE_SOURCES_COLUMN_GRANTS
    .find((x) => x.column_name === 'display_name').select_granted_to = 'authenticated'; });
  assert.equal(f6.ok, false);
  assert.ok(f6.problems.some((p) => /display_name\(authenticated\)/.test(p)));
  const f6b = bad((c) => { c.EVIDENCE_SOURCES_COLUMN_GRANTS
    .find((x) => x.column_name === 'country').select_granted_to = 'none'; });
  assert.equal(f6b.ok, false);
});

test('the six review findings are each asserted, not merely collected', () => {
  const ev = src.slice(src.indexOf('export function evaluate'));

  // F1 — cutover-seven RLS must be ASSERTED, not just gathered
  assert.match(ev, /cutover \$\{t\.table_name\}: RLS is not enabled/);
  // F2 — 7/7 presence, both as a named-absentee list and as a count
  assert.match(ev, /cutover-seven: \$\{missingCutover\.length\} target\(s\) absent/);
  assert.match(ev, /m\.cutover_seven_present !== Object\.keys\(CUTOVER_SEVEN\)\.length/);
  assert.match(ev, /m\.cutover_seven_rls_on !== Object\.keys\(CUTOVER_SEVEN\)\.length/);
  // F3 — the WHOLE view ACL, including PUBLIC and any other grantee, plus service_role
  assert.match(ev, /unexpected grantee\(s\)/);
  assert.match(ev, /allowedGrantees/);
  assert.match(ev, /service_role lost SELECT/);
  // F4 — projection must EQUAL the allowlist
  assert.match(ev, /extraProjected/);
  assert.match(ev, /view projects UNEXPECTED column\(s\)/);
  assert.match(ev, /m\.view_projection_exact/);
  // F5 — base policy roles exactly anon + authenticated
  assert.match(ev, /JSON\.stringify\(roles\) !== JSON\.stringify\(\['anon', 'authenticated'\]\)/);
  // F6 — every projected base column SELECT-able by BOTH API roles
  assert.match(ev, /underGranted/);
  assert.match(ev, /not SELECT-able by both API roles/);
});

test('the view owner is derived, never hardcoded', () => {
  // Hardcoding an owner name would false-fail wherever the owner differs, and would
  // silently accept a different role that happened to share the name.
  assert.deepEqual([...VIEW_ALLOWED_GRANTEES], ['anon', 'authenticated', 'service_role']);
  assert.ok(!VIEW_ALLOWED_GRANTEES.includes('postgres'));
  assert.match(src, /\[\.\.\.VIEW_ALLOWED_GRANTEES, v\.owner\]/);
  assert.match(src, /pg_get_userbyid\(c\.relowner\) as owner/);
});

test('the PUBLIC pseudo-role is rendered by name in both ACL and policy roles', () => {
  // aclexplode reports grantee 0, and a policy with no TO clause carries polroles {0}.
  // Both must surface as PUBLIC — "unknown (OID=0)" tells a reviewer nothing.
  assert.match(src, /when a\.grantee = 0 then 'PUBLIC'/);
  assert.match(src, /when r = 0 then 'PUBLIC'/);
});

// ─────────────────────────────────────────────────────── identity and secrets

test('refs are pinned by hash and no plaintext ref exists in the script', () => {
  assert.match(PRODUCTION_PROJECT_REF_SHA256, /^[0-9a-f]{64}$/);
  assert.match(STAGING_PROJECT_REF_SHA256, /^[0-9a-f]{64}$/);
  assert.notEqual(PRODUCTION_PROJECT_REF_SHA256, STAGING_PROJECT_REF_SHA256);
  assert.doesNotMatch(src, /\b[a-z]{20}\b(?![0-9a-f])/,
    'no bare 20-letter project-ref-shaped literal may appear');
  assert.equal(refHash('a'), refHash('a'));
  assert.notEqual(refHash('a'), refHash('b'));
});

test('identity refuses a wrong ref and missing inputs', () => {
  const notARef = 'qqqqqqqqqqqqqqqqqqqq';
  const url = `postgres${'ql://'}u:p@db.${notARef}.example.invalid/postgres`;
  assert.equal(assertProductionIdentity(url, notARef).ok, false);
  assert.equal(assertProductionIdentity('', notARef).ok, false);
  assert.equal(assertProductionIdentity(url, '').ok, false);
});

test('errors are sanitised', () => {
  const e = new Error('connect failed to db.hostname.example.invalid');
  e.name = 'Error'; e.code = '28P01';
  assert.equal(sanitizeError(e), 'Error(28P01)');
  const spoof = new Error('x'); spoof.name = 'Evil hostname'; spoof.code = '; DROP';
  assert.equal(sanitizeError(spoof), 'Error(unknown)');
});

// ────────────────────────────────────────────────────────────── the workflow

const WORKFLOW = path.join(ROOT, '.github/workflows/issue-101-production-post-cutover-certify.yml');

test('the workflow is protected, pinned, main-only and has no inputs', () => {
  const wf = fs.readFileSync(WORKFLOW, 'utf8');
  const pin = wf.match(/CANDIDATE_SHA:\s*([0-9a-f]{40})/)?.[1];
  assert.ok(pin, 'CANDIDATE_SHA must be a full 40-character SHA');
  assert.match(wf, new RegExp(`ref:\\s*${pin}\\b`));
  assert.equal(wf.match(/[0-9a-f]{40}/g).every((s) => s === pin), true,
    'no second, contradictory SHA may appear');
  assert.match(wf, /environment: production/);
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/);
  assert.match(wf, /github\.actor == 'kudzimusar'/);
  assert.match(wf, /github\.triggering_actor == 'kudzimusar'/);
  assert.match(wf, /permissions:\s*\n\s*contents: read/);
  // read-only means no dispatch inputs at all — there is nothing to choose
  assert.doesNotMatch(wf, /\n\s*inputs:/);
  assert.match(wf, /on:\s*\n\s*workflow_dispatch:\s*\n/);
  assert.match(wf, /node backend\/scripts\/production-issue-101-post-cutover-certify\.mjs\s*$/);
});

test('the workflow guard refuses a script that could write', () => {
  const wf = fs.readFileSync(WORKFLOW, 'utf8');
  const guard = wf.slice(wf.indexOf('no mutation path'), wf.indexOf('actions/setup-node'));
  assert.match(guard, /BEGIN READ ONLY/);
  assert.match(guard, /if \[ ! -f/, 'a missing file must fail closed');
  assert.match(guard, /COMMIT\|GRANT\|REVOKE\|INSERT\|UPDATE\|DELETE\|TRUNCATE\|CREATE\|ALTER\|DROP\|SET ROLE/);
  assert.match(guard, /MAINTAIN/, 'the guard must confirm the all-eight array is intact');
});
