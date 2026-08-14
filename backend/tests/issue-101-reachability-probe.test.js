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
  FOCUS_ROLES, FOCUS_VIEWS, REQUIRED_SECTIONS, ProbeError, PGRST_SCHEMA_KEYS,
  assertProductionIdentity, assertComplete, sanitizeError, parseExposedSchemas,
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
    assert.ok(/pg_roles|pg_auth_members|pg_class|pg_policy|pg_proc|pg_depend|pg_rewrite|pg_trigger|pg_namespace|pg_settings|pg_db_role_setting|pg_event_trigger|pg_database|pg_attribute|information_schema|pg_catalog|aclexplode|acldefault/i.test(x),
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

test('all ten required sections are declared', () => {
  assert.deepEqual([...REQUIRED_SECTIONS].sort(), [
    'API_EXPOSURE', 'CONNECTIVITY', 'FUNCTION_REACHABILITY', 'POLICY_DETAIL',
    'ROLE_MEMBERSHIPS', 'ROLE_MEMBERSHIP_COMPLETENESS', 'ROLE_STATE',
    'SEQUENCE_STATE', 'TABLE_STATE', 'VIEW_STATE',
  ]);
});

// ================= CORRECTIVE GUARDS (PR #153 review) =====================

test('C1: PUBLIC is never measured via has_*_privilege pseudo-grantee', () => {
  assert.ok(!/has_sequence_privilege\(\s*'public'/i.test(src), "must not pass 'public' to has_sequence_privilege");
  assert.ok(!/has_function_privilege\(\s*'public'/i.test(src), "must not pass 'public' to has_function_privilege");
  assert.ok(!/has_table_privilege\(\s*'public'/i.test(src), "must not pass 'public' to has_table_privilege");
});

test('C1: exact ACL decomposition with grantee 0 = PUBLIC and acldefault fallback', () => {
  assert.match(src, /aclexplode/);
  assert.match(src, /a\.grantee = 0 then 'PUBLIC'/);
  assert.match(src, /acldefault\('S', c\.relowner\)/, 'sequence ACL must fall back to acldefault');
  assert.match(src, /acldefault\('f', p\.proowner\)/, 'function ACL must fall back to acldefault');
  assert.match(src, /BUILT-IN DEFAULT GRANTS EXECUTE TO PUBLIC/i, 'the acldefault consequence must be documented');
});

test('C2: API reachability is never asserted from DB grants', () => {
  assert.match(src, /DB_CALLABLE_IF_SCHEMA_EXPOSED/);
  assert.ok(!/\bAPI_REACHABLE\b\s*[:=]/.test(src), 'must never emit an API_REACHABLE verdict');
  assert.match(src, /pgrst/i, 'must attempt to read exposed-schema configuration');
  assert.match(src, /classification_rule/);
});

test('C3: role membership is transitive, not one-hop', () => {
  assert.match(src, /with recursive/i);
  assert.match(src, /pg_has_role/);
  assert.match(src, /reachable_role/);
  assert.match(src, /depth/);
});

test('C4: view dependencies span all schemas and name them', () => {
  const dep = src.slice(src.indexOf('const { rows: deps }'), src.indexOf('const depsByView'));
  assert.ok(!/bn\.nspname = 'public'/.test(dep), 'dependency query must not be restricted to public');
  assert.match(dep, /bn\.nspname\s+as base_schema/);
  assert.match(src, /base_schema/);
});

test('C4: INSTEAD OF triggers are identified specifically', () => {
  assert.match(src, /tgtype & 64/, 'must test TRIGGER_TYPE_INSTEAD');
  assert.match(src, /ordinary_triggers/, 'ordinary triggers must be counted separately and exclusively');
  assert.match(src, /'instead_of', \(t\.tgtype & 64\) <> 0/);
});

test('C4: view security evidence is preserved', () => {
  for (const f of ['security_invoker', 'security_barrier', 'is_updatable', 'is_insertable_into']) {
    assert.ok(src.includes(f), `view state must keep ${f}`);
  }
});

test('C5: function output is evidence/candidate, never proof of absence', () => {
  assert.match(src, /mutation_evidence/);
  assert.match(src, /ddl_evidence/);
  assert.match(src, /truncate_evidence/);
  assert.match(src, /dynamic_sql_evidence/);
  assert.match(src, /absence_not_proven/);
  assert.match(src, /resolved_callees/);
  assert.match(src, /never establish ABSENCE/i);
  assert.ok(!/body_can_mutate/.test(src), 'the old proof-shaped naming must be gone');
});

test('C7: PUBLIC EXECUTE is tracked separately from anon/authenticated', () => {
  assert.match(src, /public_execute:/);
  assert.match(src, /public_execute_source/);
  assert.match(src, /functions_public_execute_via_acldefault/);
  assert.match(src, /does NOT remove a privilege inherited through PUBLIC/i);
});

test('sequences report PUBLIC and acl-default provenance', () => {
  assert.match(src, /PUBLIC: privsFor\(q\.acl, 'PUBLIC'\)/);
  assert.match(src, /acl_is_default/);
  assert.match(src, /sequences_public_grant/);
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
  for (const f of ['security_definer', 'language', 'volatility', 'search_path',
                   'mutation_evidence', 'ddl_evidence', 'truncate_evidence',
                   'dynamic_sql_evidence', 'indirect_bridge_candidate', 'is_trigger_function',
                   'reachability_classification']) {
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


// ============ FINAL SECURITY CORRECTION (PR #153 review round 2) ============

// --- 1. SECURITY BLOCKER: pgrst secrets must be unreachable by construction ---

test('SECURITY: only schema-exposure keys are allowlisted — no secret GUCs', () => {
  assert.deepEqual(PGRST_SCHEMA_KEYS, ['pgrst.db_schemas', 'pgrst.db_schema']);
  for (const secret of ['jwt_secret', 'db_uri', 'db_anon_role', 'app.settings']) {
    assert.ok(!PGRST_SCHEMA_KEYS.some((k) => k.includes(secret)), `${secret} must never be allowlisted`);
  }
});

test('SECURITY: no wildcard pgrst.* selection anywhere', () => {
  assert.ok(!/like\s+'pgrst\.%'/i.test(src), "must not select pgrst.% from pg_settings");
  assert.ok(!/like\s+'pgrst_%'/i.test(src), 'must not select pgrst_% either');
  assert.ok(!/\/\^pgrst\\\./.test(src), 'must not regex-filter pgrst. prefixes in Node');
  // Every pg_settings / pg_db_role_setting read must be keyed to the allowlist.
  const queries = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1]);
  for (const q of queries) {
    if (/pg_settings|pg_db_role_setting/.test(q)) {
      assert.match(q, /any\(\$1::text\[\]\)/, `must bind the allowlist: ${q.slice(0, 90)}`);
    }
  }
});

test('SECURITY: pg_db_role_setting is filtered IN SQL before values reach Node', () => {
  const q = [...src.matchAll(/client\.query\(\s*`([^`]+)`/g)].map((m) => m[1])
    .find((x) => /pg_db_role_setting/.test(x));
  assert.ok(q, 'expected a pg_db_role_setting query');
  assert.match(q, /split_part\(cfg, '=', 1\) = any\(\$1::text\[\]\)/,
    'the key filter must be applied in SQL, not after the value is returned');
});

test('SECURITY: a synthetic pgrst.jwt_secret cannot reach any emitted structure', () => {
  const FAKE_SECRET = ['nOtA', 'ReaL', 'JwtSecret', '9f2b'].join('-');
  // Simulate exactly what the database could hand back for both read paths.
  const pgSettingsRows = [
    { name: 'pgrst.jwt_secret', setting: FAKE_SECRET },
    { name: 'pgrst.db_uri', setting: `postgres://u:${FAKE_SECRET}@h/db` },
    { name: 'pgrst.db_schemas', setting: 'public, graphql_public' },
  ];
  // The allowlist is what the SQL binds; only matching rows can ever be returned.
  const allowed = pgSettingsRows.filter((r) => PGRST_SCHEMA_KEYS.includes(r.name));
  assert.deepEqual(allowed.map((r) => r.name), ['pgrst.db_schemas']);
  const parsed = parseExposedSchemas(allowed[0].setting);
  const emitted = JSON.stringify({
    exposed_schemas: parsed,
    determinable: true,
    evidence_source: `pg_settings.${allowed[0].name}`,
  });
  assert.ok(!emitted.includes(FAKE_SECRET), 'the fake secret must not appear in the emitted structure');
  assert.ok(!emitted.includes('jwt_secret'), 'the secret key name must not appear either');
  assert.ok(!emitted.includes('db_uri'));

  // And the same for the role-setting path, where the SQL key filter is the control.
  const roleCfg = [`pgrst.jwt_secret=${FAKE_SECRET}`, 'pgrst.db_schemas=public'];
  const filtered = roleCfg.filter((c) => PGRST_SCHEMA_KEYS.includes(c.split('=')[0]));
  assert.deepEqual(filtered, ['pgrst.db_schemas=public']);
  assert.ok(!JSON.stringify(filtered).includes(FAKE_SECRET));
});

test('SECURITY: no console line can print a pgrst setting value', () => {
  const logged = [...src.matchAll(/console\.log\(([^\n]*)/g)].map((m) => m[1]);
  for (const l of logged) {
    assert.ok(!/\bsetting\b/.test(l), `must not print a raw setting value: ${l.slice(0, 80)}`);
    assert.ok(!/setconfig|schema_settings/.test(l), `must not print raw role config: ${l.slice(0, 80)}`);
  }
});

// --- 2. determinable is earned only by a parsed schema value ---------------

test('determinable requires a PARSED exposed-schema value', () => {
  assert.match(src, /exposed_schemas/);
  assert.match(src, /evidence_source/);
  assert.match(src, /schema_setting_present/);
  // A present-but-unparseable setting must not promote determinable.
  assert.equal(parseExposedSchemas(''), null);
  assert.equal(parseExposedSchemas('   '), null);
  assert.equal(parseExposedSchemas(undefined), null);
  assert.deepEqual(parseExposedSchemas('public'), ['public']);
  assert.deepEqual(parseExposedSchemas(' public , graphql_public '), ['public', 'graphql_public']);
  // determinable is only ever assigned alongside a successful parse.
  const assigns = [...src.matchAll(/determinable = true/g)];
  assert.ok(assigns.length > 0);
  for (const m of assigns) {
    const before = src.slice(Math.max(0, m.index - 300), m.index);
    assert.match(before, /if \(parsed\)/, 'determinable=true must be guarded by a successful parse');
  }
});

test('a watch trigger or unrelated setting can no longer promote determinable', () => {
  assert.ok(!/pgrst_watch_event_trigger/.test(src), 'the watch-trigger signal must be gone');
  assert.ok(!/pgrst_settings/.test(src), 'the arbitrary settings bag must be gone');
});

test('when not determinable the classification stays DB_CALLABLE_IF_SCHEMA_EXPOSED', () => {
  assert.match(src, /API_REACHABLE must never be asserted/);
  assert.match(src, /out-of-band OpenAPI\/API census is required/);
});

// --- 3. trigger sets are mutually exclusive -------------------------------

test('instead_of and ordinary trigger sets are mutually exclusive', () => {
  assert.match(src, /\(t\.tgtype & 64\) <> 0\)::int as instead_of_triggers/);
  assert.match(src, /\(t\.tgtype & 64\) = 0\)::int as ordinary_triggers/);
  assert.ok(!/not t\.tgisinternal\)::int as other_triggers/.test(src),
    'the old all-triggers counter must be gone');
  assert.match(src, /views_with_ordinary_triggers/);
});

// --- 4. no arbitrary depth cap; completeness proven -----------------------

test('the transitive closure has no arbitrary depth cap', () => {
  assert.ok(!/c\.depth < 8/.test(src), 'the depth-8 cap must be gone');
  assert.match(src, /No depth cap/);
  assert.match(src, /not \(m\.roleid::regrole::text = any\(c\.path\)\)/, 'cycle guard must remain');
});

test('closure completeness is proven against pg_has_role and gaps are flagged', () => {
  assert.ok(REQUIRED_SECTIONS.includes('ROLE_MEMBERSHIP_COMPLETENESS'));
  assert.match(src, /path_materialised/);
  assert.match(src, /role_paths_unmaterialised/);
  assert.match(src, /reachable per pg_has_role but NO path materialised/);
});

test('the completeness section is required for a complete run', () => {
  const s = { TOTALS: { tables: 1 } };
  for (const k of REQUIRED_SECTIONS) s[k] = [];
  s.ROLE_STATE = [{ rolname: 'anon' }];
  s.VIEW_STATE = FOCUS_VIEWS.map((v) => ({ view_name: v, focus: true }));
  assert.equal(assertComplete(s).ok, true);
  delete s.ROLE_MEMBERSHIP_COMPLETENESS;
  assert.match(assertComplete(s).reason, /ROLE_MEMBERSHIP_COMPLETENESS/);
});
