/**
 * Contract tests for the Issue #101 P0 hardening migration.
 *
 * These assert the SHAPE of the migration — that it closes both controls on every one
 * of the fourteen tables, that it preserves exactly the one read surface that has a
 * documented public intent, and that the evidence_sources_public remedy is ordered so
 * no window of broken reads exists. The behavioural proof (that anon actually cannot
 * write afterwards) belongs to the staging run and the PGlite harness, not here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseMigrationSource } from '../db/migrationParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = '20260814090000_issue101_p0_rls_and_view_hardening.sql';
const MIG = path.resolve(__dirname, '../../database/migrations', FILE);
const sql = fs.readFileSync(MIG, 'utf8');
const { up, down } = parseMigrationSource(sql, FILE);
/** Executable SQL only — the migration documents WHY it omits FORCE RLS and what TRUNCATE is. */
const upCode = up.replace(/^\s*--.*$/gm, ' ');

/** The 14 RLS-disabled tables measured in production run 31749657530. */
const FOURTEEN = [
  'cid_clearance_records', 'currency_rates', 'cvr_ownership_records', 'dealer_promotions',
  'evidence_class_taxonomy', 'ocr_customs_declarations', 'ocr_national_ids',
  'ocr_registration_books', 'performance_telemetry', 'signature_verification_logs',
  'system_failures', 'vid_inspections', 'zimra_declarations', 'zinara_licensing_records',
];

/** The only one of the fourteen with a documented public-read intent. */
const KEEPS_READ = 'evidence_class_taxonomy';

test('the migration satisfies the repository integrity contract', () => {
  assert.ok(up.length > 0, 'Up section must parse');
  assert.ok(/^-- \+migrate Up$/m.test(sql));
  assert.ok(/^-- \+migrate Down$/m.test(sql));
  assert.ok(down.length > 0, 'Down section must exist (documented, deliberate)');
});

test('its timestamp sorts after every migration it depends on', () => {
  const all = fs.readdirSync(path.dirname(MIG)).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort();
  assert.equal(all[all.length - 1], FILE, 'must be the newest timestamped migration');
});

// ---------------------------------------------------------------- B2: the 14

test('EVERY one of the fourteen gets RLS enabled', () => {
  for (const t of FOURTEEN) {
    assert.match(up, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`),
      `${t} must have RLS enabled`);
  }
});

test('EVERY one of the fourteen gets anon/authenticated revoked — the TRUNCATE control', () => {
  for (const t of FOURTEEN) {
    assert.match(up, new RegExp(`REVOKE ALL ON TABLE public\\.${t}\\s+FROM anon, authenticated`),
      `${t} must be revoked: RLS does not govern TRUNCATE`);
  }
});

test('EVERY one of the fourteen keeps service_role operational', () => {
  for (const t of FOURTEEN) {
    assert.match(up, new RegExp(`GRANT ALL\\s+ON TABLE public\\.${t}\\s+TO service_role`),
      `${t} must retain service_role`);
  }
});

test('exactly ONE of the fourteen keeps a read surface, and it is the documented one', () => {
  const granted = FOURTEEN.filter(t =>
    new RegExp(`GRANT SELECT ON TABLE public\\.${t} TO anon, authenticated`).test(up));
  assert.deepEqual(granted, [KEEPS_READ], 'only the documented public catalog keeps a read');
});

test('the preserved read has a policy, because RLS-on with no policy silently returns zero rows', () => {
  assert.match(up, /CREATE POLICY evidence_class_taxonomy_public_read/);
  assert.match(up, /FOR SELECT TO anon, authenticated\s*\n\s*USING \(true\)/);
  // and it is dropped first so the migration is re-runnable
  assert.match(up, /DROP POLICY IF EXISTS evidence_class_taxonomy_public_read/);
});

test('no policy is created for any table classified service-role-only', () => {
  const policyTargets = [...up.matchAll(/CREATE POLICY \w+\s+ON public\.(\w+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(policyTargets)].sort(), ['evidence_class_taxonomy', 'evidence_sources']);
});

test('FORCE RLS is never used', () => {
  assert.ok(!/FORCE ROW LEVEL SECURITY/i.test(upCode), 'FORCE RLS constrains the owner and is out of scope');
  assert.match(up, /FORCE ROW LEVEL SECURITY is deliberately OMITTED/, 'and the omission is explained');
});

test('no table is dropped and no row is written', () => {
  for (const re of [/DROP TABLE/i, /DELETE FROM/i, /INSERT INTO/i, /UPDATE\s+\w+\s+SET/i, /TRUNCATE/i]) {
    assert.ok(!re.test(upCode), `migration must not contain executable ${re}`);
  }
});

// ------------------------------------------------------- B3-P0: the view

test('the base-table grant is COLUMN-LEVEL and excludes the two hidden columns', () => {
  const m = /GRANT SELECT \(([^)]+)\)\s*\n?\s*ON TABLE public\.evidence_sources TO anon, authenticated/.exec(up);
  assert.ok(m, 'expected a column-level grant on the base table');
  const cols = m[1].split(',').map(s => s.trim()).filter(Boolean);
  assert.deepEqual(cols.sort(), [
    'active', 'code', 'country', 'display_name', 'id', 'organization',
    'permitted_evidence_classes', 'source_type', 'trust_tier', 'verification_status',
  ], 'must grant exactly the ten columns the view projects');
  for (const hidden of ['contact_reference', 'credential_reference']) {
    assert.ok(!cols.includes(hidden), `${hidden} must never be granted — the view exists to hide it`);
  }
});

test('the base policy mirrors the view WHERE clause', () => {
  assert.match(up, /CREATE POLICY evidence_sources_public_read\s+ON public\.evidence_sources\s+FOR SELECT TO anon, authenticated\s+USING \(active = true\)/);
});

test('the view is flipped to security_invoker so base RLS provably applies', () => {
  assert.match(up, /ALTER VIEW public\.evidence_sources_public SET \(security_invoker = true\)/);
});

test('the view becomes read-only for API roles', () => {
  assert.match(up, /REVOKE ALL ON TABLE public\.evidence_sources_public FROM anon, authenticated/);
  assert.match(up, /GRANT SELECT ON TABLE public\.evidence_sources_public TO anon, authenticated/);
  assert.match(up, /GRANT ALL\s+ON TABLE public\.evidence_sources_public TO service_role/);
});

test('ORDERING: base access is granted BEFORE security_invoker is set', () => {
  const grantIdx = up.indexOf('GRANT SELECT (id, code, display_name');
  const policyIdx = up.indexOf('CREATE POLICY evidence_sources_public_read');
  const invokerIdx = up.indexOf('SET (security_invoker = true)');
  assert.ok(grantIdx > 0 && policyIdx > grantIdx && invokerIdx > policyIdx,
    'grant -> policy -> security_invoker; any other order silently returns zero rows');
});

test('the Down section is documented and non-destructive', () => {
  assert.match(down, /DELIBERATE OPERATOR ACTION/);
  assert.ok(!/^\s*(ALTER|DROP|GRANT|REVOKE)\b/m.test(down.replace(/^--.*$/gm, '')),
    'the Down body must contain no executable reversal');
});
