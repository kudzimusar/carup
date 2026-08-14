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
import { TARGET_TABLES, collectSchemaShape } from '../scripts/production-issue-101-schema-shape.mjs';

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

// ------------------------------------------------- governed dispatch wrapper

/**
 * The wrapper is the only thing standing between a reviewed probe and a production
 * credential, so its gates are asserted here rather than trusted by inspection.
 * The pin is deliberately checked against the workflow's OWN env, not a literal
 * copied into this file, so advancing the pin stays a one-place edit.
 */
const WORKFLOW = path.resolve(__dirname, '../../.github/workflows/issue-101-production-public-keys-shape.yml');
const wf = fs.readFileSync(WORKFLOW, 'utf8');

test('the workflow pins one immutable candidate and asserts it at runtime', () => {
  const pin = wf.match(/CANDIDATE_SHA:\s*([0-9a-f]{40})/)?.[1];
  assert.ok(pin, 'CANDIDATE_SHA must be a full 40-character SHA, never a branch or tag');
  // checkout ref and the env pin must be the same commit, else the assertion is theatre
  assert.match(wf, new RegExp(`ref:\\s*${pin}\\b`), 'checkout ref must equal CANDIDATE_SHA');
  assert.match(wf, /actual="\$\(git rev-parse HEAD\)"/);
  assert.match(wf, /!= "\$CANDIDATE_SHA"/);
  assert.equal(wf.match(/[0-9a-f]{40}/g).every((s) => s === pin), true,
    'no second, contradictory SHA may appear anywhere in the workflow');
});

test('dispatch is owner-gated, main-only, and behind the protected production environment', () => {
  assert.match(wf, /environment: production/);
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/);
  // github.actor survives re-runs by another collaborator; triggering_actor is live.
  assert.match(wf, /github\.actor == 'kudzimusar'/);
  assert.match(wf, /github\.triggering_actor == 'kudzimusar'/);
});

test('there is no apply path: manual dispatch only, no mode input, no phrase gate', () => {
  assert.match(wf, /on:\s*\n\s*workflow_dispatch:\s*\n/);
  assert.doesNotMatch(wf, /\n\s*inputs:/, 'a dispatch input is the first step towards an apply mode');
  assert.doesNotMatch(wf, /\bmode\b\s*:/i);
  assert.match(wf, /permissions:\s*\n\s*contents: read/);
});

test('the workflow runs THIS probe, not the eleven-table one', () => {
  assert.match(wf, /node backend\/scripts\/production-issue-101-public-keys-shape\.mjs\s*$/);
  assert.doesNotMatch(wf, /node backend\/scripts\/production-issue-101-schema-shape\.mjs/);
});

test('the runtime guard inspects the collector too, not just the wrapper', () => {
  // A mutation smuggled into the shared collector is invisible to a wrapper-only grep.
  const guard = wf.slice(wf.indexOf('no mutation path'), wf.indexOf('actions/setup-node'));
  assert.match(guard, /collector=backend\/scripts\/production-issue-101-schema-shape\.mjs/);
  assert.match(guard, /for f in "\$wrapper" "\$collector"/);
  assert.match(guard, /BEGIN READ ONLY/);
  assert.match(guard, /DEPENDENCY_TABLES = /);
  assert.match(guard, /collectSchemaShape\(client, DEPENDENCY_TABLES\)/);
  // a missing file must fail closed rather than silently pass an empty grep
  assert.match(guard, /if \[ ! -f "\$f" \]/);
});

test('dependency install cannot see the production credential', () => {
  const install = wf.slice(wf.indexOf('Install the pinned pg driver'), wf.indexOf('Require the production secrets'));
  assert.doesNotMatch(install, /PRODUCTION_DATABASE_URL/);
  assert.match(install, /--ignore-scripts/, 'lifecycle scripts must not execute during install');
  assert.match(wf, /PG_DRIVER_VERSION: \d+\.\d+\.\d+/, 'the driver version must be pinned exactly');
});

// ------------------------------------------- TOTALS scope-size parameterization

/**
 * REGRESSION. collectSchemaShape() parameterised its catalog QUERIES but not its
 * RECEIPT: targets_requested and targets_absent were hardcoded to TARGET_TABLES.length,
 * so this one-relation probe would have truthfully measured public_keys and then
 * emitted "targets_requested: 11" — a receipt claiming ten measurements that never
 * happened, in the very artefact P2 is built from.
 *
 * These exercise the REAL collector against a stub client rather than asserting on a
 * hand-built object, so the arithmetic is proven end to end.
 */
const IDENTITY_Q = /to_regclass/;
const COLUMNS_Q = /information_schema\.columns/;

function stubClient({ identity, columns = [] }) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (IDENTITY_Q.test(sql)) return { rows: identity };
      if (COLUMNS_Q.test(sql)) return { rows: columns };
      return { rows: [] };
    },
  };
}

const row = (table_name, exists, extra = {}) => ({
  table_name, exists, owner: exists ? 'postgres' : null,
  rls_enabled: false, rls_forced: false, relkind: exists ? 'r' : null, ...extra,
});

test('REGRESSION 1 — one-relation scope, present: TOTALS reports 1, not 11', async () => {
  const c = stubClient({
    identity: [row('public_keys', true)],
    columns: [{ table_name: 'public_keys', column_name: 'id', udt_schema: 'pg_catalog', udt_name: 'uuid' }],
  });
  const s = await collectSchemaShape(c, DEPENDENCY_TABLES);
  assert.equal(s.TOTALS.targets_requested, 1);
  assert.equal(s.TOTALS.targets_present, 1);
  assert.equal(s.TOTALS.targets_absent, 0);
  assert.deepEqual(s.TOTALS.absent_names, []);
  // and the catalog queries really were bound to the one-element scope
  for (const { params } of c.calls) {
    if (params) assert.deepEqual(params[0], ['public_keys']);
  }
});

test('REGRESSION 2 — one-relation scope, absent: 1 requested, 0 present, 1 absent', async () => {
  const c = stubClient({ identity: [row('public_keys', false)] });
  const s = await collectSchemaShape(c, DEPENDENCY_TABLES);
  assert.equal(s.TOTALS.targets_requested, 1);
  assert.equal(s.TOTALS.targets_present, 0);
  assert.equal(s.TOTALS.targets_absent, 1);
  assert.deepEqual(s.TOTALS.absent_names, ['public_keys']);
});

test('REGRESSION 3 — the default eleven-table scope is unchanged', async () => {
  const c = stubClient({ identity: TARGET_TABLES.map((t) => row(t, true)) });
  const s = await collectSchemaShape(c); // no targets argument: the #156 default
  assert.equal(TARGET_TABLES.length, 11);
  assert.equal(s.TOTALS.targets_requested, 11);
  assert.equal(s.TOTALS.targets_present, 11);
  assert.equal(s.TOTALS.targets_absent, 0);
  // absent tables are still named under the default scope
  const c2 = stubClient({ identity: TARGET_TABLES.map((t, i) => row(t, i !== 0)) });
  const s2 = await collectSchemaShape(c2);
  assert.equal(s2.TOTALS.targets_requested, 11);
  assert.equal(s2.TOTALS.targets_absent, 1);
  assert.deepEqual(s2.TOTALS.absent_names, [TARGET_TABLES[0]]);
});

test('REGRESSION 4 — an out-of-scope relation cannot influence TOTALS', async () => {
  // A hostile or buggy server answering the identity query with an extra row must not
  // be able to inflate the receipt, and must not pass the completeness gate either.
  const c = stubClient({
    identity: [row('public_keys', true), row('administrative_overrides', true)],
    columns: [{ table_name: 'public_keys', column_name: 'id', udt_schema: 'pg_catalog', udt_name: 'uuid' }],
  });
  const s = await collectSchemaShape(c, DEPENDENCY_TABLES);
  assert.equal(s.TOTALS.targets_requested, 1, 'requested follows the SUPPLIED scope, not the returned rows');
  assert.equal(s.TOTALS.targets_present, 1, 'the stray relation is not counted as present');
  assert.equal(s.TOTALS.targets_absent, 0);
  assert.deepEqual(s.TOTALS.absent_names, []);
  assert.equal(s.TOTALS.distinct_owners.length, 1);
  // The gate rejects it too. Here the arity check fires first — one target was
  // requested, two rows came back — which is itself the correct refusal.
  const gate = assertComplete(s, DEPENDENCY_TABLES);
  assert.equal(gate.ok, false, 'the stray row must also fail the completeness gate');
  assert.match(gate.reason, /did not cover all 1 target/);

  // A SUBSTITUTED row has the right arity, so it reaches the scope guard proper —
  // which must name the intruder rather than silently accepting a same-sized answer.
  const c2 = stubClient({
    identity: [row('administrative_overrides', true)],
    columns: [{ table_name: 'administrative_overrides', column_name: 'id', udt_schema: 'pg_catalog', udt_name: 'uuid' }],
  });
  const s2 = await collectSchemaShape(c2, DEPENDENCY_TABLES);
  assert.equal(s2.TOTALS.targets_requested, 1);
  assert.equal(s2.TOTALS.targets_present, 0, 'a relation outside the supplied scope is never counted present');
  assert.equal(s2.TOTALS.targets_absent, 1);
  assert.deepEqual(s2.TOTALS.absent_names, [], 'and it is not misreported as an absent target either');
  const gate2 = assertComplete(s2, DEPENDENCY_TABLES);
  assert.equal(gate2.ok, false);
  assert.match(gate2.reason, /administrative_overrides/);
});

test('REGRESSION 4b — a stray reaching ONLY TABLE_IDENTITY is still caught', async () => {
  // Mutation-testing found REGRESSION 4 could pass for the wrong reason: its stray also
  // appeared in COLUMNS, so the COLUMNS guard caught it and TABLE_IDENTITY's own guard
  // was never exercised. These two cases isolate TABLE_IDENTITY.

  // (i) the stray is ABSENT, so no other section carries it and no zero-columns gate
  //     applies — TABLE_IDENTITY's scope guard is the only thing that can refuse it.
  const c = stubClient({ identity: [row('administrative_overrides', false)] });
  const s = await collectSchemaShape(c, DEPENDENCY_TABLES);
  const gate = assertComplete(s, DEPENDENCY_TABLES);
  assert.equal(gate.ok, false, 'an out-of-scope relation in TABLE_IDENTITY alone must be refused');
  assert.match(gate.reason, /TABLE_IDENTITY.*administrative_overrides/);

  // (ii) an ABSENT stray must not be misreported as an absent TARGET — absent_names is
  //      what P2 reads to decide which tables to create.
  const c2 = stubClient({ identity: [row('public_keys', false), row('administrative_overrides', false)] });
  const s2 = await collectSchemaShape(c2, DEPENDENCY_TABLES);
  assert.deepEqual(s2.TOTALS.absent_names, ['public_keys'],
    'absent_names must list only supplied targets, never a stray the server volunteered');
  assert.equal(s2.TOTALS.targets_absent, 1);
  assert.equal(s2.TOTALS.targets_requested, 1);
});

test('REGRESSION 5 — the emitted JSON receipt cannot report a count other than 1', async () => {
  const c = stubClient({
    identity: [row('public_keys', true)],
    columns: [{ table_name: 'public_keys', column_name: 'id', udt_schema: 'pg_catalog', udt_name: 'uuid' }],
  });
  // serialised exactly as the wrapper serialises it, then re-parsed
  const receipt = JSON.parse(JSON.stringify(await collectSchemaShape(c, DEPENDENCY_TABLES), null, 2));
  assert.equal(receipt.TOTALS.targets_requested, 1);
  assert.equal(receipt.TABLE_IDENTITY.length, 1);
  assert.deepEqual(receipt.TABLE_IDENTITY.map((t) => t.table_name), ['public_keys']);
  assert.equal(JSON.stringify(receipt).includes('"targets_requested": 11'), false);

  // and the shipped wrapper really is that pairing: one collector call bound to
  // DEPENDENCY_TABLES, whose result is the object placed between the markers.
  assert.match(src, /s = await collectSchemaShape\(client, DEPENDENCY_TABLES\)/);
  assert.equal((src.match(/collectSchemaShape\(client/g) || []).length, 1, 'exactly one collector call site');
  assert.doesNotMatch(src, /collectSchemaShape\(client\)/, 'the collector is never called with the default scope');
  const emitted = src.slice(src.indexOf('ISSUE_101_PUBLIC_KEYS_SHAPE_JSON_BEGIN'), src.indexOf('ISSUE_101_PUBLIC_KEYS_SHAPE_JSON_END'));
  assert.match(emitted, /JSON\.stringify\(s, null, 2\)/);
});
