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

/**
 * Dependency-specific ordering. Asserting "this is the newest migration in the repo"
 * would be true today and broken by the next unrelated migration, so instead we assert
 * exactly what this migration needs: that every migration which CREATES one of its
 * targets sorts before it.
 *
 * Verified on origin/main: only SIX of the fourteen targets are created by a migration
 * at all. The other eight are created out-of-band by scripts/deploy-missing-schemas.js,
 * which no ordering assertion can cover — the migration's runtime PRECONDITION 1 covers
 * them instead, by name.
 */
const MIGRATION_CREATED_TARGETS = {
  '004_add_tamper_proofing.sql': ['performance_telemetry', 'signature_verification_logs', 'system_failures'],
  '006_domain1.sql': ['dealer_promotions'],
  '011_phase6_schema.sql': ['currency_rates'],
  '20260621120000_vehicle_life_evidence_taxonomy_provenance.sql':
    ['evidence_class_taxonomy', 'evidence_sources', 'evidence_sources_public'],
};
const OUT_OF_BAND_TARGETS = [
  'cid_clearance_records', 'cvr_ownership_records', 'vid_inspections',
  'zimra_declarations', 'zinara_licensing_records',
  'ocr_customs_declarations', 'ocr_national_ids', 'ocr_registration_books',
];

test('every dependency migration exists and sorts BEFORE this migration', () => {
  const dir = path.dirname(MIG);
  for (const dep of Object.keys(MIGRATION_CREATED_TARGETS)) {
    assert.ok(fs.existsSync(path.join(dir, dep)), `dependency ${dep} must exist`);
    assert.ok(dep < FILE, `${dep} must sort before ${FILE} in the runner's lexical order`);
  }
});

test('each dependency migration really does create the targets claimed for it', () => {
  const dir = path.dirname(MIG);
  for (const [dep, targets] of Object.entries(MIGRATION_CREATED_TARGETS)) {
    const body = fs.readFileSync(path.join(dir, dep), 'utf8');
    for (const target of targets) {
      const creates = new RegExp(`CREATE (TABLE|OR REPLACE VIEW|VIEW)( IF NOT EXISTS)? (public\\.)?${target}\\b`, 'i');
      assert.match(body, creates, `${dep} should create ${target}`);
    }
  }
});

test('the out-of-band targets are enumerated and covered by a runtime precondition', () => {
  const dir = path.dirname(MIG);
  const migrations = fs.readdirSync(dir).filter(f => f.endsWith('.sql') && f !== FILE);
  for (const target of OUT_OF_BAND_TARGETS) {
    const creator = migrations.find(f =>
      new RegExp(`CREATE TABLE( IF NOT EXISTS)? (public\\.)?${target}\\b`, 'i')
        .test(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.equal(creator, undefined,
      `${target} is expected to be created out-of-band; ${creator} now creates it — move it into MIGRATION_CREATED_TARGETS`);
    // and the migration must name it in the existence precondition
    assert.ok(up.includes(`'${target}'`), `${target} must appear in the target precondition list`);
  }
});

test('every one of the fourteen is covered by exactly one dependency classification', () => {
  const declared = [...Object.values(MIGRATION_CREATED_TARGETS).flat(), ...OUT_OF_BAND_TARGETS]
    .filter(n => FOURTEEN.includes(n));
  assert.deepEqual([...new Set(declared)].sort(), [...FOURTEEN].sort());
});

test('PRECONDITION 0 asserts service_role BYPASSRLS before any change', () => {
  const firstAlter = up.indexOf('ALTER TABLE public.');
  const firstRevoke = up.indexOf('REVOKE ');
  const firstPolicy = up.indexOf('CREATE POLICY');
  const precondition = up.indexOf('rolbypassrls');
  assert.ok(precondition > 0, 'the precondition must exist');
  for (const [name, idx] of [['ALTER TABLE', firstAlter], ['REVOKE', firstRevoke], ['CREATE POLICY', firstPolicy]]) {
    assert.ok(precondition < idx, `the BYPASSRLS precondition must precede the first ${name}`);
  }
  assert.match(up, /RAISE EXCEPTION[\s\S]*BYPASSRLS/);
  assert.match(up, /ERRCODE = 'insufficient_privilege'/);
});

test('PRECONDITION 1 names every target and fails loudly when one is absent', () => {
  for (const t of FOURTEEN) assert.ok(up.includes(`'${t}'`), `${t} must be in the existence precondition`);
  for (const o of ['evidence_sources', 'evidence_sources_public']) {
    assert.ok(up.includes(`'${o}'`), `${o} must be in the existence precondition`);
  }
  assert.match(up, /ERRCODE = 'undefined_table'/);
  assert.match(up, /Refusing to apply a partial hardening/);
  const firstAlter = up.indexOf('ALTER TABLE public.');
  assert.ok(up.indexOf('to_regclass') < firstAlter, 'existence checks must precede the first change');
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
