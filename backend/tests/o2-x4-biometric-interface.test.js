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
  for (const file of sqlFiles) {
    const sql = readFileSync(file, 'utf8');
    if (path.basename(file) >= '20260829') assert.doesNotMatch(sql, /fingerprint/i, `${path.basename(file)} must not define fingerprint storage`);
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

const CANDIDATES = path.join(repo, 'database/migration-candidates/oc5c');
const sections = (file) => {
  const raw = readFileSync(path.join(CANDIDATES, file), 'utf8');
  const [up, down] = raw.split(/^-- \+migrate Down/m);
  return { raw, up: up.replace('-- +migrate Up', ''), down };
};

test('OC-5C: both biometric migrations are CANDIDATES — not applied anywhere — and each Up/Down/Up works on PostgreSQL', async () => {
  const consents = sections('20261004175000_o2_x4_identity_biometric_consents.sql');
  const assessments = sections('20261004175100_o2_x4_verification_assessments_biometrics.sql');
  for (const c of [consents, assessments]) assert.match(c.raw, /NOT APPLIED ANYWHERE/);
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
