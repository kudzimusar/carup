/**
 * O2-X4 — biometrics, INTERFACE ONLY; provider status NOT SELECTED (ported by OC-5C from PR #208).
 *
 *   Biometrics provide evidence. Biometrics do not decide identity.
 *   Provider success ≠ biometric match ≠ identity verified.
 *
 * Held here (#208's interface pins, plus what the bounded port must prove about itself):
 *   · normalization applies the versioned SERVER thresholds — a vendor's optimism cannot leak through;
 *   · the unconfigured runtime reports not_configured (nothing ran, nothing pretends to have run) and
 *     any configured vendor name fails loudly, naming the decision record that exists;
 *   · the approval gate can only BLOCK (face mismatch, failed liveness), never grants, and leaves the
 *     human path open for indeterminate/unavailable; the name-binding stays an independent dimension;
 *   · NOTHING on this lineage calls a provider: no runtime module imports the provider contract, no
 *     biometric route is mounted, no consent/assessment service exists (deferred until selection);
 *   · no biometric fingerprint/template/embedding store anywhere — migrations, candidates or code;
 *   · the two migrations are CANDIDATES (not applied anywhere), each with a working Down (PGlite).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { APPROVED_KEY_DIGEST, fingerprintViolations } from './helpers/o2FingerprintGuard.mjs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  normalizeProviderResult,
  resolveBiometricProvider,
  nullBiometricProvider,
  BIOMETRIC_THRESHOLDS,
} = await import('../services/identity/biometrics/biometricProvider.js');
const { DecisionPolicyEngine } = await import('../services/identity/decisionPolicy.js');
const { getReasonConfig } = await import('../services/identity/reasonCodes.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(here, '..');
const repo = path.join(backend, '..');

const MATCH_RESULT = Object.freeze({
  provider: 'test-double', providerModel: 'double-1', providerReference: 'ref-1', state: 'completed',
  faceMatchScore: 0.93, livenessScore: 0.91,
});

test('X4: normalization applies the versioned server thresholds — provider optimism cannot leak through', () => {
  const match = normalizeProviderResult({ ...MATCH_RESULT });
  assert.equal(match.face_match_status, 'match');
  assert.equal(match.liveness_status, 'passed');
  assert.equal(match.threshold_policy_version, 'biometric_threshold.v1');
  assert.equal(normalizeProviderResult({ ...MATCH_RESULT, faceMatchScore: 0.6 }).face_match_status, 'indeterminate', 'between thresholds is indeterminate, never rounded up');
  assert.equal(normalizeProviderResult({ ...MATCH_RESULT, faceMatchScore: 0.2 }).face_match_status, 'mismatch');
  assert.equal(normalizeProviderResult({ ...MATCH_RESULT, livenessScore: 0.5 }).liveness_status, 'failed');
  assert.equal(normalizeProviderResult({ ...MATCH_RESULT, livenessVerdict: 'failed' }).liveness_status, 'failed', 'a provider failure verdict outranks any score');
  const failed = normalizeProviderResult({ provider: 'x', state: 'failed' });
  assert.deepEqual([failed.face_match_status, failed.liveness_status], ['provider_failed', 'provider_failed']);
  const notConfigured = normalizeProviderResult({ state: 'not_configured' });
  assert.deepEqual([notConfigured.face_match_status, notConfigured.liveness_status], ['not_run', 'not_run'], 'nothing ran, nothing pretends to have run');
  assert.ok(BIOMETRIC_THRESHOLDS.face_match_min_score > BIOMETRIC_THRESHOLDS.face_mismatch_max_score);
});

test('X4: the unconfigured runtime is honest, and any configured vendor fails loudly — naming a decision record that exists', async () => {
  const provider = resolveBiometricProvider({});
  assert.equal(provider, nullBiometricProvider);
  assert.equal(resolveBiometricProvider({ BIOMETRIC_PROVIDER: 'none' }), nullBiometricProvider);
  const normalized = normalizeProviderResult(await provider.createAssessment({}));
  assert.deepEqual([normalized.provider_state, normalized.face_match_status], ['not_configured', 'not_run']);
  for (const vendor of ['veriff', 'sumsub', 'mock', 'simulated', 'test-double']) {
    assert.throws(() => resolveBiometricProvider({ BIOMETRIC_PROVIDER: vendor }), /not implemented/, vendor);
  }
  let message = '';
  try { resolveBiometricProvider({ BIOMETRIC_PROVIDER: 'veriff' }); } catch (e) { message = e.message; }
  const docPath = message.match(/docs\/features\/o2\/[\w.]+\.md/)?.[0];
  assert.ok(docPath && existsSync(path.join(repo, docPath)), `the refusal names a record that exists (${docPath})`);
  assert.match(readFileSync(path.join(repo, docPath), 'utf8'), /\*\*Status: NOT SELECTED\.\*\*/);
});

const BASE_SESSION = Object.freeze({
  workflow_phase: 'reviewer_action_required',
  evidence_classification: 'valid_identity_document',
  extraction_trust_status: 'partially_trusted',
  identity_binding_status: 'match',
  status: 'pending_manual_review',
});

test('X4: face mismatch and failed liveness BLOCK approval; indeterminate/unavailable keep the human path open; no assessment changes nothing', () => {
  const none = DecisionPolicyEngine.buildAssessmentSummary(BASE_SESSION, null, null, null);
  assert.equal(none.biometric, null, 'no assessment exists on this lineage — the dimension is absent, not "passed"');
  assert.equal(none.allowed_actions.includes('approve'), true, 'and the gate is inert: approval is decided by the other dimensions exactly as before');

  const mismatch = DecisionPolicyEngine.buildAssessmentSummary(BASE_SESSION, null, null, null, { face_match_status: 'mismatch', liveness_status: 'passed', provider: 'p', provider_state: 'completed' });
  assert.equal(mismatch.allowed_actions.includes('approve'), false, 'face mismatch cannot silently approve');
  assert.ok(mismatch.allowed_actions.includes('escalate'));

  const livenessFailed = DecisionPolicyEngine.buildAssessmentSummary(BASE_SESSION, null, null, null, { face_match_status: 'match', liveness_status: 'failed', provider: 'p', provider_state: 'completed' });
  assert.equal(livenessFailed.allowed_actions.includes('approve'), false, 'failed liveness cannot silently approve');
  assert.ok(livenessFailed.allowed_actions.includes('request_resubmission'), 'the applicant can retry — no auto-rejection');

  for (const soft of [
    { face_match_status: 'indeterminate', liveness_status: 'indeterminate', provider_state: 'completed' },
    { face_match_status: 'provider_failed', liveness_status: 'provider_failed', provider_state: 'unavailable' },
    { face_match_status: 'not_run', liveness_status: 'not_run', provider_state: 'not_configured' },
  ]) {
    const summary = DecisionPolicyEngine.buildAssessmentSummary(BASE_SESSION, null, null, null, soft);
    assert.equal(summary.allowed_actions.includes('approve'), true, `${soft.provider_state}: provider trouble routes to human judgment`);
  }

  // A provider MATCH grants nothing the other dimensions did not permit.
  const nameMismatch = DecisionPolicyEngine.buildAssessmentSummary({ ...BASE_SESSION, identity_binding_status: 'mismatch' }, null, null, null,
    { face_match_status: 'match', liveness_status: 'passed', provider_state: 'completed' });
  assert.equal(nameMismatch.allowed_actions.includes('approve'), false, 'biometric match is evidence, not an override');
});

test('X4: the biometric reason codes cannot approve a failure, and the unavailable copy does not pretend a provider ever existed', () => {
  assert.equal(getReasonConfig('FACE_MATCH_FAILED').approveAllowed, false);
  assert.equal(getReasonConfig('LIVENESS_FAILED').approveAllowed, false);
  const unavailable = getReasonConfig('BIOMETRIC_PROVIDER_UNAVAILABLE');
  assert.doesNotMatch(unavailable.defaultApplicantGuidance, /temporarily/i, '"temporarily" would claim a provider that is merely down');
  assert.match(unavailable.defaultApplicantGuidance, /manual review/);
});

test('X4: the name-binding dimension is unchanged and independent (source pin)', () => {
  const binding = readFileSync(path.join(backend, 'services/identity/identityBinding.js'), 'utf8');
  assert.match(binding, /account-holder vs document-holder/i, 'identityBinding remains name comparison');
  assert.doesNotMatch(binding, /\bface\b|biometric|liveness/i, 'it is not biometric and does not pretend to be');
  assert.match(readFileSync(path.join(backend, 'services/identity/decisionPolicy.js'), 'utf8'), /identity_binding_status/);
});

function runtimeFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(backend, 'services'));
  walk(path.join(backend, 'routes'));
  walk(path.join(backend, 'middleware'));
  files.push(path.join(backend, 'server.js'));
  return files;
}

test('OC-5C: NOTHING on this lineage calls a biometric provider — no importer, no route, no consent or assessment service', () => {
  const files = runtimeFiles();
  assert.ok(files.length > 150, `anti-vacuity: ${files.length} runtime files scanned`);
  const importers = files.filter((f) => !f.endsWith(path.join('biometrics', 'biometricProvider.js'))
    && /biometrics\/biometricProvider\.js|resolveBiometricProvider|createAssessment\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(importers.map((f) => path.relative(backend, f)), [], 'the provider contract has no runtime caller');
  assert.equal(existsSync(path.join(backend, 'services/identity/biometrics/biometricConsentService.js')), false, 'consent service DEFERRED');
  assert.equal(existsSync(path.join(backend, 'services/identity/biometrics/biometricAssessmentService.js')), false, 'assessment service DEFERRED');
  assert.equal(existsSync(path.join(backend, 'routes/identityBiometricRoutes.js')), false, 'no biometric route');
  assert.doesNotMatch(readFileSync(path.join(backend, 'server.js'), 'utf8'), /biometric/i, 'nothing biometric is mounted');
});

test('X4: no biometric fingerprint store and no template/embedding store anywhere — migrations, candidates or code', () => {
  const biometricFingerprint = /fingerprint[^\n]{0,40}(enroll|capture|template|biometric|scan)|biometric[^\n]{0,40}fingerprint|fingerprint_template/i;
  const templateStore = /face_embedding|facial_embedding|biometric_template|face_vector|face_encoding/i;
  const sqlFiles = [];
  for (const dir of ['database/migrations', 'database/migration-candidates']) {
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.sql')) sqlFiles.push(full);
      }
    };
    walk(path.join(repo, dir));
  }
  assert.ok(sqlFiles.some((f) => f.includes('20261004175000')), 'the biometric candidates are part of the scan');
  // "Fingerprint" has two NON-biometric meanings in CarUp SQL. The Trust presentation fingerprint (20260826120000) is a hash of
  // an audience-safe projection. A garage's Paynow integration-key digest (20261103100000) lets an operator tell two keys apart
  // without seeing either. The second exception is one schema node, not a word: see helpers/o2FingerprintGuard.mjs and the
  // negative tests below. Every other mention still fails, and the two biometric patterns still run on the raw text.
  for (const file of sqlFiles) {
    const sql = readFileSync(file, 'utf8');
    if (path.basename(file) >= '20260829') assert.deepEqual(fingerprintViolations(sql, path.basename(file)), [], `${path.basename(file)} must not define fingerprint storage`);
    assert.doesNotMatch(sql, biometricFingerprint, `${path.basename(file)} must not define biometric fingerprint storage`);
    assert.doesNotMatch(sql, templateStore, `${path.basename(file)} must not define a biometric template/embedding store`);
  }
  for (const file of runtimeFiles()) {
    const src = readFileSync(file, 'utf8');
    if (file.includes(`${path.sep}services${path.sep}identity${path.sep}`) || /identity[^/]*Routes/.test(file)) {
      assert.doesNotMatch(src, /fingerprint/i, `${path.relative(backend, file)} (identity domain) must not touch fingerprints`);
    }
    assert.doesNotMatch(src, biometricFingerprint, `${path.relative(backend, file)} must not implement biometric fingerprints`);
    assert.doesNotMatch(src, templateStore, `${path.relative(backend, file)} must not persist biometric templates`);
  }
});

// PAY-05-R1 (Moderator, issue #255): the exception is the exact schema declaration, never every same-named occurrence in a file.
const KEY_FILE = APPROVED_KEY_DIGEST.file;
const keyFileSql = () => readFileSync(path.join(repo, 'database/migrations', KEY_FILE), 'utf8');

test('O2 guard: the Moderator\'s two-table fixture: a permitted digest beside a prohibited column of the same name is caught', () => {
  const fixture = `CREATE TABLE allowed (credential_fingerprint text CHECK (credential_fingerprint ~ '^[0-9a-f]{16}$'));
CREATE TABLE prohibited (credential_fingerprint bytea);`;
  const violations = fingerprintViolations(fixture, KEY_FILE);
  assert.ok(violations.some((v) => v.includes('prohibited') && v.includes('bytea')), `the bytea column must be named: ${violations.join('; ')}`);
  // and the same declaration text on an unapproved table is not the approved node either
  assert.ok(violations.some((v) => v.includes('allowed')), 'only the approved table carries the exception');
});

test('O2 guard: the approved declaration passes only as itself: this table, this text, this file, once', () => {
  const approved = `CREATE TABLE IF NOT EXISTS public.pay05_merchant_integrations (
  id uuid PRIMARY KEY,
  ${APPROVED_KEY_DIGEST.declaration},
  status text NOT NULL
);`;
  assert.deepEqual(fingerprintViolations(approved, KEY_FILE), []);
  assert.notDeepEqual(fingerprintViolations(approved, 'some_other_file.sql'), [], 'not from another file');
  assert.notDeepEqual(fingerprintViolations(approved.replace('{16}', '{64}'), KEY_FILE), [], 'not a wider digest');
  assert.notDeepEqual(fingerprintViolations(approved.replace(" CHECK (credential_fingerprint ~ '^[0-9a-f]{16}$')", ''), KEY_FILE), [], 'not without its pin');
  assert.notDeepEqual(fingerprintViolations(approved.replace('text NOT NULL CHECK', 'bytea NOT NULL CHECK'), KEY_FILE), [], 'not another type');
  assert.notDeepEqual(fingerprintViolations(approved + approved, KEY_FILE), [], 'not twice');
});

test('O2 guard: every other way of storing it is caught, in the approved file itself', () => {
  const base = keyFileSql();
  assert.deepEqual(fingerprintViolations(base, KEY_FILE), [], 'the real PAY-05 file passes');
  for (const [what, addition] of Object.entries({
    'a same-named column in another table': 'CREATE TABLE prohibited (credential_fingerprint bytea);',
    'a differently named one': 'CREATE TABLE b (face_fingerprint text);',
    'an added column': 'ALTER TABLE public.garage_invoices ADD COLUMN credential_fingerprint bytea;',
    'an added column on the approved table': 'ALTER TABLE public.pay05_merchant_integrations ADD COLUMN IF NOT EXISTS raw_fingerprint bytea;',
    'a renamed column': 'ALTER TABLE public.garage_invoices RENAME COLUMN notes TO credential_fingerprint;',
    'a table from a query': 'CREATE TABLE copied AS SELECT credential_fingerprint FROM public.pay05_merchant_integrations;',
    'a view': 'CREATE VIEW exposed AS SELECT credential_fingerprint FROM public.pay05_merchant_integrations;',
    'one inside a function body': "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN CREATE TABLE inner_t (credential_fingerprint bytea); END $$;",
    'a bare mention': 'SELECT fingerprint_hash FROM other;',
  })) {
    assert.notDeepEqual(fingerprintViolations(`${base}\n${addition}`, KEY_FILE), [], `${what} must be caught`);
  }
});

test('O2 guard: reference-only files may read the approved column and nothing else', () => {
  const r1 = '20261104100000_carup_pay05_r1_financial_integrity.sql';
  assert.deepEqual(fingerprintViolations(readFileSync(path.join(repo, 'database/migrations', r1), 'utf8'), r1), [], 'the R1 migration only reads it');
  assert.deepEqual(fingerprintViolations("SELECT NEW.credential_fingerprint, v_item->>'fingerprint';", r1), []);
  assert.notDeepEqual(fingerprintViolations('CREATE TABLE r (credential_fingerprint text);', r1), [], 'a reference file cannot declare it');
  assert.notDeepEqual(fingerprintViolations("SELECT NEW.credential_fingerprint;", 'an_unreviewed_file.sql'), [], 'an unreviewed file cannot mention it');
});

test('O2 guard: Trust\'s fingerprint stays allowed; biometric patterns stay refused', () => {
  assert.deepEqual(fingerprintViolations('SELECT v_fingerprint, presentation_fingerprint FROM t; -- a fingerprint in a comment', 'a_trust_file.sql'), []);
  assert.notDeepEqual(fingerprintViolations('CREATE TABLE identity_biometrics (fingerprint BYTEA);', 'a_file.sql'), [], 'a fingerprint column is caught');
  assert.notDeepEqual(fingerprintViolations('ALTER TABLE t ADD COLUMN presentation_fingerprint bytea;', 'a_file.sql'), [], 'Trust\'s NAME does not excuse declaring it');
});

const CANDIDATES = path.join(repo, 'database/migration-candidates/oc5c');
const sections = (file) => {
  const raw = readFileSync(path.join(CANDIDATES, file), 'utf8');
  const [up, down] = raw.split(/^-- \+migrate Down/m);
  return { raw, up: up.replace('-- +migrate Up', ''), down };
};

test('OC-5C: both biometric migrations are CANDIDATES — not promoted, held under custody — and each Up/Down/Up works on PostgreSQL', async () => {
  const consents = sections('20261004175000_o2_x4_identity_biometric_consents.sql');
  const assessments = sections('20261004175100_o2_x4_verification_assessments_biometrics.sql');
  // OC-5R: canonical staging carries both (applied by PR #208's runs). The header must say "not promoted" and name the
  // custody exception — never the false "not applied anywhere".
  for (const c of [consents, assessments]) {
    assert.match(c.raw, /NOT PROMOTED into the canonical lineage/);
    assert.match(c.raw, /X4-BIOMETRIC-CONSENT-LEDGER/);
    assert.doesNotMatch(c.raw, /NOT APPLIED ANYWHERE/);
  }
  assert.match(consents.raw, /OPEN before promotion \(owner\)/, 'the CASCADE-vs-RESTRICT question is surfaced, not decided');
  for (const file of readdirSync(path.join(repo, 'database/migrations'))) {
    assert.doesNotMatch(file, /biometric/i, `${file}: no biometric migration is in the applied set`);
  }

  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE TABLE users (id text PRIMARY KEY);
      CREATE TABLE verification_assessments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid);
    `);
    for (const c of [consents, assessments]) {
      await db.exec(c.up);
      await db.exec(c.up); // idempotent
    }
    await db.query("INSERT INTO users(id) VALUES ('u1')");
    await db.query(`INSERT INTO identity_biometric_consents (user_id, status, purposes, policy_version, consent_text_version, source, actor_kind, actor_user_id)
      VALUES ('u1','granted','["liveness"]'::jsonb,'biometric_consent.v1','biometric_consent_text.v1','registration','user','u1')`);
    await assert.rejects(() => db.query("UPDATE identity_biometric_consents SET status = 'withdrawn'"), /append-only/, 'the consent ledger is append-only');
    const { rows: cols } = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'verification_assessments' AND column_name IN ('face_match_status','liveness_status','consent_id')");
    assert.equal(cols.length, 3);
    await db.exec(assessments.down);
    await db.exec(consents.down);
    const { rows: gone } = await db.query("SELECT to_regclass('public.identity_biometric_consents') AS t");
    assert.equal(gone[0].t, null);
    const { rows: noCols } = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'verification_assessments' AND column_name = 'face_match_status'");
    assert.equal(noCols.length, 0);
    await db.exec(consents.up);
    await db.exec(assessments.up);
  } finally {
    await db.close();
  }
});
