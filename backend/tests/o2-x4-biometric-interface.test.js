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
import {
  APPROVED_KEY_DIGEST, BIOMETRIC_FINGERPRINT, BIOMETRIC_TEMPLATE_STORE, KEY_DIGEST_REVIEWED_LINES, REVIEWED_FINGERPRINT_FILES,
  fingerprintMentions, fingerprintViolations,
} from './helpers/o2FingerprintGuard.mjs';

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
  const sqlFiles = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.sql')) sqlFiles.push(full);
    }
  };
  walk(path.join(repo, 'database'));
  assert.ok(sqlFiles.some((f) => f.includes('20261004175000')), 'the biometric candidates are part of the scan');
  // "Fingerprint" has several NON-biometric meanings in CarUp SQL, each in a file reviewed byte for byte: see helpers/o2FingerprintGuard.mjs
  // and the negative tests below. Every other mention fails, comments included, and the two biometric patterns run on every file.
  const scanned = new Set();
  for (const file of sqlFiles) {
    const sql = readFileSync(file);
    const repoPath = path.relative(repo, file).split(path.sep).join('/');
    scanned.add(repoPath);
    assert.deepEqual(fingerprintViolations(sql, repoPath), [], `${repoPath} names a fingerprint outside the reviewed files, or changed one`);
    assert.doesNotMatch(sql.toString(), BIOMETRIC_FINGERPRINT, `${repoPath} must not define biometric fingerprint storage`);
    assert.doesNotMatch(sql.toString(), BIOMETRIC_TEMPLATE_STORE, `${repoPath} must not define a biometric template/embedding store`);
  }
  for (const file of Object.keys(REVIEWED_FINGERPRINT_FILES)) assert.ok(scanned.has(file), `the sweep reached ${file}`);
  for (const file of runtimeFiles()) {
    const src = readFileSync(file, 'utf8');
    if (file.includes(`${path.sep}services${path.sep}identity${path.sep}`) || /identity[^/]*Routes/.test(file)) {
      assert.doesNotMatch(src, /fingerprint/i, `${path.relative(backend, file)} (identity domain) must not touch fingerprints`);
    }
    assert.doesNotMatch(src, BIOMETRIC_FINGERPRINT, `${path.relative(backend, file)} must not implement biometric fingerprints`);
    assert.doesNotMatch(src, BIOMETRIC_TEMPLATE_STORE, `${path.relative(backend, file)} must not persist biometric templates`);
  }
});

// PAY-05-R1 (Moderator, issue #255): the exception is the exact schema declaration, never every same-named occurrence in a file.
// The O2-X4 guard. A cross-program security test guard defect, corrected after two independent O2 reviews refused word-level and
// line-level exceptions. Many of the cases below passed an earlier version of the guard, in the approved file or in a new one.
const NEW_FILE = 'database/migrations/29991231000000_a_new_migration.sql';
const KEY_FILE = APPROVED_KEY_DIGEST.file;
const R1_FILE = 'database/migrations/20261104100000_carup_pay05_r1_financial_integrity.sql';
const repoFile = (p) => readFileSync(path.join(repo, p), 'utf8');
const refused = (sql, file = NEW_FILE) => fingerprintViolations(sql, file).length > 0;

test('O2 guard: the Moderator\'s two-table fixture is refused, naming both declarations', () => {
  const fixture = "CREATE TABLE allowed (credential_fingerprint text CHECK (credential_fingerprint ~ '^[0-9a-f]{16}$'));\nCREATE TABLE prohibited (credential_fingerprint bytea);";
  for (const file of [NEW_FILE, KEY_FILE, R1_FILE]) {
    const violations = fingerprintViolations(file === NEW_FILE ? fixture : `${repoFile(file)}\n${fixture}`, file);
    assert.ok(violations.some((v) => v.includes('CREATE TABLE allowed')), file);
    assert.ok(violations.some((v) => v.includes('CREATE TABLE prohibited')), file);
  }
});

test('O2 guard: a reviewed file passes only as itself: one changed byte, or the same bytes elsewhere, is refused', () => {
  for (const file of Object.keys(REVIEWED_FINGERPRINT_FILES)) {
    const bytes = repoFile(file);
    assert.deepEqual(fingerprintViolations(bytes, file), [], `${file} as reviewed`);
    assert.ok(fingerprintMentions(bytes).length > 0, `${file} mentions a fingerprint, or it should not be on the list`);
    assert.ok(refused(`${bytes} `, file), `${file} with one more byte`);
    assert.ok(refused('SELECT 1;', file), `${file} with its mentions gone`);
    assert.ok(refused(bytes), `${file} copied to another path`);
    assert.ok(refused(bytes, `database/migrations/subdirectory/${path.basename(file)}`), `${file} under the same name in a subdirectory`);
  }
  assert.ok(refused(repoFile(KEY_FILE), R1_FILE), 'the bytes of one reviewed file under the name of another');
  assert.deepEqual(fingerprintViolations('SELECT 1;', NEW_FILE), [], 'a file that never mentions it needs no review');
  assert.deepEqual(fingerprintViolations('SELECT 1;', 'constructor'), [], 'the list is not read through a prototype');
});

test('O2 guard: the reviewed content is the one approved node and reads of it', () => {
  const key = repoFile(KEY_FILE);
  const start = key.indexOf(`CREATE TABLE IF NOT EXISTS ${APPROVED_KEY_DIGEST.table} (`);
  assert.ok(start >= 0, 'the approved table');
  assert.ok(key.slice(start, key.indexOf('\n);', start)).includes(`  ${APPROVED_KEY_DIGEST.declaration},`), 'the declaration is on the approved table');
  assert.equal(key.split(APPROVED_KEY_DIGEST.declaration).length, 2, 'and only there');
  assert.deepEqual(Object.keys(KEY_DIGEST_REVIEWED_LINES).sort(), [KEY_FILE, R1_FILE].sort());
  for (const [file, lines] of Object.entries(KEY_DIGEST_REVIEWED_LINES)) assert.deepEqual(fingerprintMentions(repoFile(file)), [...lines], `${file}: a re-pin cannot add a mention unnoticed`);
  assert.ok(KEY_DIGEST_REVIEWED_LINES[KEY_FILE].includes(`${APPROVED_KEY_DIGEST.declaration},`));
  assert.ok(!KEY_DIGEST_REVIEWED_LINES[R1_FILE].some((line) => /\bbytea\b|\bCHECK\b|^credential_fingerprint /.test(line)), 'the R1 file declares nothing');
});

test('O2 guard: in a reviewed file, moving a reviewed line or hiding one is refused', () => {
  const key = repoFile(KEY_FILE);
  const lines = key.split('\n');
  const at = lines.findIndex((l) => l.includes('credential_tag, credential_key_version, credential_fingerprint'));
  const moved = lines.filter((_, n) => n !== at).join('\n');
  assert.ok(refused(`${moved}\nCREATE TABLE "my table" (\n${lines[at]}\n  AS SELECT 1, 2, face_bytes, 4, 5, 6 FROM raw_captures;`, KEY_FILE), 'a moved line builds a real column');
  const check = 'OR NEW.credential_fingerprint IS DISTINCT FROM OLD.credential_fingerprint';
  assert.ok(refused(key.replace(check, `/*\n${check}\n*/`), KEY_FILE), 'a reviewed line disabled in a block comment');
  assert.ok(refused(key.replace(APPROVED_KEY_DIGEST.declaration, () => APPROVED_KEY_DIGEST.declaration.replace('text NOT', 'text NOT')), KEY_FILE), 'a no-break space, which PostgreSQL reads as part of a name');
  assert.ok(refused(key.replace(APPROVED_KEY_DIGEST.declaration, () => APPROVED_KEY_DIGEST.declaration.replace('{16}', '{64}')), KEY_FILE), 'a wider digest');
});

test('O2 guard: anywhere else, every mention is refused: no spelling, comment or name is exempt', () => {
  const t = APPROVED_KEY_DIGEST.table;
  for (const [what, sql] of Object.entries({
    'the approved declaration on another table': `CREATE TABLE copy (\n  ${APPROVED_KEY_DIGEST.declaration}\n);`,
    'the approved declaration in a table named like the approved one': `CREATE TABLE "${t}" (\n  ${APPROVED_KEY_DIGEST.declaration}\n);`,
    'upper case': 'CREATE TABLE s (FINGERPRINT BYTEA);',
    'ALTER COLUMN TYPE': `ALTER TABLE ${t} ALTER COLUMN credential_fingerprint TYPE bytea USING credential_fingerprint::bytea;`,
    'a rename away': `ALTER TABLE ${t} RENAME COLUMN credential_fingerprint TO key_digest;`,
    'a quoted table with a space': 'CREATE TABLE "my table" (credential_fingerprint bytea);',
    'spaces around the dot': 'CREATE TABLE public . prohibited (credential_fingerprint bytea);',
    'a comment for a separator': 'CREATE TABLE/**/prohibited (credential_fingerprint bytea);',
    'a function exposing it': 'CREATE FUNCTION leak() RETURNS TABLE (credential_fingerprint text) LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;',
    'a column grant': 'GRANT SELECT (credential_fingerprint) ON pay05_merchant_integrations TO anon;',
    'a composite type': 'CREATE TYPE c AS (credential_fingerprint bytea);',
    'SELECT INTO': 'SELECT credential_fingerprint INTO copied FROM pay05_merchant_integrations;',
    'a view': 'CREATE VIEW v AS SELECT credential_fingerprint FROM pay05_merchant_integrations;',
    'dynamic SQL': "DO $$ BEGIN EXECUTE format('CREATE TABLE %I (credential_fingerprint bytea)', 'x'); END $$;",
    'strings that look like a block comment': "CREATE TABLE s (a text DEFAULT '/*', fingerprint bytea, b text DEFAULT '*/');",
    'a string that looks like a line comment': "CREATE TABLE s (a text DEFAULT '--', fingerprint bytea);",
    'a whole-line comment': '-- a fingerprint\nSELECT 1;',
    'a trailing comment': 'SELECT 1; -- fingerprint',
    'a block comment': '/* fingerprint */ SELECT 1;',
    'SQL after a carriage return inside a line comment': '-- harmless\rCREATE TABLE x (fingerprint bytea);',
    'a quoted name across a line that looks like a comment': 'CREATE TABLE prohibited ("\n-- credential_fingerprint" bytea\n);',
    'dollar-quoted SQL behind a line that looks like a comment': "DO $do$ BEGIN EXECUTE replace($q$\n-- CREATE TABLE prohibited (credential_fingerprint bytea);\n$q$, '--', ''); END $do$;",
    'Trust\'s name declared': 'ALTER TABLE t ADD COLUMN presentation_fingerprint bytea;',
    'Trust\'s name in a type': 'CREATE TYPE c AS (presentation_fingerprint bytea);',
    'Trust\'s name changed in type': 'ALTER TABLE t ALTER COLUMN presentation_fingerprint TYPE bytea;',
    'Trust\'s name inside a quoted column': 'CREATE TABLE p ("iris v_fingerprint" bytea);',
    'Trust\'s name as a table': 'CREATE TABLE public.presentation_fingerprint (raw bytea);',
    'Trust\'s name, read by a file nobody reviewed': 'SELECT v_fingerprint, presentation_fingerprint FROM t;',
    'a Unicode-escaped name that PostgreSQL reads as the column': 'CREATE TABLE s (U&"credential_f\\0069ngerprint" bytea);',
    'the same in lower case, with its own escape character': 'CREATE TABLE s (u&"credential_f!0069ngerprint" UESCAPE \'!\' bytea);',
    'a Unicode-escaped string': "SELECT U&'\\0066ingerprint';",
  })) assert.ok(refused(sql), what);
  const [message] = fingerprintViolations('-- a fingerprint\nSELECT 1;', NEW_FILE);
  assert.match(message, /backend\/tests\/helpers\/o2FingerprintGuard\.mjs/, 'the message says where a reviewed file is listed');
  assert.match(message, /O2 review/, 'and who reviews it');
});

test('O2 guard: Trust\'s fingerprint stays allowed in the files that use it', () => {
  for (const file of ['20260826120000_email_1_0_hardening.sql', '20261004180600_service_network_o4_event_dedupe.sql', '20261024140000_garage_communications_events_and_template.sql']) {
    const repoPath = `database/migrations/${file}`;
    assert.ok(Object.hasOwn(REVIEWED_FINGERPRINT_FILES, repoPath), file);
    assert.match(repoFile(repoPath), /v_fingerprint/);
    assert.deepEqual(fingerprintViolations(repoFile(repoPath), repoPath), []);
  }
});

test('O2 guard: the biometric patterns refuse each form they exist for, even in a reviewed file', () => {
  for (const sample of ['fingerprint_template', 'presentation_fingerprint_template', 'fingerprint enroll', 'fingerprint capture', 'fingerprint scan', 'fingerprint biometric', 'biometric fingerprint', 'BIOMETRIC FINGERPRINT']) {
    assert.match(sample, BIOMETRIC_FINGERPRINT, sample);
  }
  for (const sample of ['face_embedding', 'facial_embedding', 'biometric_template', 'face_vector', 'face_encoding', 'FACE_EMBEDDING']) {
    assert.match(sample, BIOMETRIC_TEMPLATE_STORE, sample);
  }
  assert.doesNotMatch('device_fingerprint TEXT NOT NULL', BIOMETRIC_FINGERPRINT);
  assert.doesNotMatch('credential_fingerprint', BIOMETRIC_FINGERPRINT);
  // byte-identical to the frozen head: a narrower pattern fails here, not only when something slips past it
  assert.equal(BIOMETRIC_FINGERPRINT.source, 'fingerprint[^\\n]{0,40}(enroll|capture|template|biometric|scan)|biometric[^\\n]{0,40}fingerprint|fingerprint_template');
  assert.equal(BIOMETRIC_TEMPLATE_STORE.source, 'face_embedding|facial_embedding|biometric_template|face_vector|face_encoding');
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
