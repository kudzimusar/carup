/**
 * O2-X4 — biometric assessment: evidence, never decision (runtime, real routers + services).
 *
 * Held here:
 *   · the provider is NEVER called without an active consent, and a withdrawn consent stops
 *     new processing (the provider spy proves the negative);
 *   · the result lands as an append-only assessment row — the SESSION is untouched, so a
 *     provider "match" cannot set verified and a selfie upload alone means nothing;
 *   · client-submitted scores/statuses are inert — the route takes only the session id;
 *   · normalization applies the SERVER-owned versioned thresholds; provenance and consent id
 *     ride every row;
 *   · injected providers are TEST-ONLY (refused outside NODE_ENV=test), an unknown configured
 *     vendor fails loudly, and the unconfigured runtime reports not_configured — never a
 *     synthesized match (the X1 truth rule, on faces);
 *   · decision policy: mismatch/failed-liveness BLOCK approve; indeterminate/unavailable keep
 *     the human path open (safe fallback, no auto-rejection); name-binding stays a separate,
 *     unchanged dimension;
 *   · cross-user isolation: another user's session/assessment is unreachable.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const { supabase } = await import('../db/supabase.js');
const biometricRouter = (await import('../routes/identityBiometricRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const {
  BIOMETRIC_THRESHOLDS,
  BIOMETRIC_CONSENT_TEXT_VERSION,
  normalizeProviderResult,
  resolveBiometricProvider,
  nullBiometricProvider,
} = await import('../services/identity/biometrics/biometricProvider.js');
const { runBiometricAssessment, fetchLatestBiometricAssessment } = await import('../services/identity/biometrics/biometricAssessmentService.js');
const { DecisionPolicyEngine } = await import('../services/identity/decisionPolicy.js');

const FUTURE = '2027-01-01T00:00:00.000Z';

let db;
function resetDb() {
  db = {
    users: [
      { id: 'user-a', role: 'owner', is_verified: true },
      { id: 'user-b', role: 'owner', is_verified: true },
    ],
    verification_sessions: [
      {
        id: 'vs-a', user_id: 'user-a', status: 'pending_manual_review', document_type: 'national_id',
        front_storage_path: 'a/front.jpg', selfie_storage_path: 'a/selfie.jpg',
      },
      {
        id: 'vs-b', user_id: 'user-b', status: 'pending_manual_review', document_type: 'national_id',
        front_storage_path: 'b/front.jpg', selfie_storage_path: 'b/selfie.jpg',
      },
    ],
    identity_biometric_consents: [],
    verification_assessments: [],
    trust_audit_events: [],
    calls: [],
  };
}

let seq = 0;
function builder(table) {
  const st = { op: 'select', filters: {}, payload: null, single: false, maybe: false };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    order() { return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run()).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  function run() {
    db.calls.push({ table, op: st.op, filters: { ...st.filters } });
    const rows = (db[table] = db[table] || []);
    const match = (r) => Object.entries(st.filters).every(([k, v]) => r[k] === v);
    if (st.op === 'insert') {
      const row = { id: st.payload.id || `${table}-${++seq}`, seq: ++seq, created_at: st.payload.created_at || new Date().toISOString(), ...st.payload };
      rows.push(row);
      return { data: st.single ? row : [row], error: null };
    }
    if (st.op === 'update') {
      const hits = rows.filter(match);
      hits.forEach((r) => Object.assign(r, st.payload));
      return { data: st.single ? hits[0] || null : hits, error: null };
    }
    const out = rows.filter(match);
    if (st.maybe) return { data: out[0] || null, error: null };
    if (st.single) return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'not found' } };
    return { data: out, error: null };
  }
  return chain;
}

let server; let port;
before(async () => {
  resetDb();
  supabase.from = (t) => builder(t);
  const app = express();
  app.use(express.json());
  app.use(biometricRouter);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
});
after(() => { server?.close(); });
beforeEach(() => { resetDb(); });

function call(method, path, { userId, body } = {}) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        'content-type': 'application/json',
        ...(userId ? { 'x-user-id': userId } : {}),
        ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function grantConsent(userId) {
  const res = await call('POST', '/api/identity/biometric-consent', {
    userId,
    body: { consent: true, consent_text_version: BIOMETRIC_CONSENT_TEXT_VERSION, purposes: ['face_document_match', 'liveness'] },
  });
  assert.equal(res.status, 201);
  return res.body.consent;
}

function providerSpy(result) {
  const calls = [];
  return {
    name: 'test-double',
    calls,
    async createAssessment(input) { calls.push(input); return result; },
  };
}

const MATCH_RESULT = Object.freeze({
  provider: 'test-double', providerModel: 'double-1', providerReference: 'ref-1', state: 'completed',
  faceMatchScore: 0.93, livenessScore: 0.91,
});

// ---------------------------------------------------------------------------------------
// Normalization + thresholds (server-owned, versioned)
// ---------------------------------------------------------------------------------------

test('X4: normalization applies the versioned server thresholds — provider optimism cannot leak through', () => {
  const match = normalizeProviderResult({ ...MATCH_RESULT });
  assert.equal(match.face_match_status, 'match');
  assert.equal(match.liveness_status, 'passed');
  assert.equal(match.threshold_policy_version, 'biometric_threshold.v1');

  const mid = normalizeProviderResult({ ...MATCH_RESULT, faceMatchScore: 0.6 });
  assert.equal(mid.face_match_status, 'indeterminate', 'between thresholds is indeterminate, never rounded up');

  const low = normalizeProviderResult({ ...MATCH_RESULT, faceMatchScore: 0.2 });
  assert.equal(low.face_match_status, 'mismatch');

  const livenessFail = normalizeProviderResult({ ...MATCH_RESULT, livenessScore: 0.5 });
  assert.equal(livenessFail.liveness_status, 'failed');

  const failed = normalizeProviderResult({ provider: 'x', state: 'failed' });
  assert.equal(failed.face_match_status, 'provider_failed');
  assert.equal(failed.liveness_status, 'provider_failed');

  const notConfigured = normalizeProviderResult({ state: 'not_configured' });
  assert.equal(notConfigured.face_match_status, 'not_run', 'nothing ran, nothing pretends to have run');
  assert.equal(notConfigured.liveness_status, 'not_run');
  assert.ok(BIOMETRIC_THRESHOLDS.face_match_min_score > BIOMETRIC_THRESHOLDS.face_mismatch_max_score);
});

test('X4: the unconfigured runtime is honest, and an unknown configured vendor fails loudly', async () => {
  const provider = resolveBiometricProvider({});
  assert.equal(provider, nullBiometricProvider);
  const normalized = normalizeProviderResult(await provider.createAssessment({}));
  assert.equal(normalized.provider_state, 'not_configured');
  assert.equal(normalized.face_match_status, 'not_run');

  assert.throws(() => resolveBiometricProvider({ BIOMETRIC_PROVIDER: 'veriff' }), /not implemented/);
  assert.throws(() => resolveBiometricProvider({ BIOMETRIC_PROVIDER: 'sumsub' }), /not implemented/);
});

// ---------------------------------------------------------------------------------------
// Consent gate + provider spy
// ---------------------------------------------------------------------------------------

test('X4: the provider is NEVER called without active consent; withdrawal stops new processing', async () => {
  const spy = providerSpy(MATCH_RESULT);

  await assert.rejects(
    () => runBiometricAssessment(undefined, { id: 'user-a' }, 'vs-a', { provider: spy }),
    /BIOMETRIC_CONSENT_REQUIRED/,
  );
  assert.equal(spy.calls.length, 0, 'no consent → the provider never hears about it');

  await grantConsent('user-a');
  const run1 = await runBiometricAssessment(undefined, { id: 'user-a' }, 'vs-a', { provider: spy });
  assert.equal(spy.calls.length, 1);
  assert.equal(run1.applicant_view.face_match_status, 'match');

  const withdraw = await call('POST', '/api/identity/biometric-consent/withdraw', { userId: 'user-a', body: {} });
  assert.equal(withdraw.status, 200);
  await assert.rejects(
    () => runBiometricAssessment(undefined, { id: 'user-a' }, 'vs-a', { provider: spy }),
    /BIOMETRIC_CONSENT_REQUIRED/,
  );
  assert.equal(spy.calls.length, 1, 'withdrawn consent prevents NEW biometric processing');
});

test('X4: the result is an ASSESSMENT row with provenance + consent id — the session row is untouched', async () => {
  const consent = await grantConsent('user-a');
  const spy = providerSpy(MATCH_RESULT);
  const sessionBefore = JSON.stringify(db.verification_sessions.find((s) => s.id === 'vs-a'));

  await runBiometricAssessment(undefined, { id: 'user-a' }, 'vs-a', { provider: spy });

  const row = db.verification_assessments.at(-1);
  assert.equal(row.assessment_source, 'biometric_provider');
  assert.equal(row.provider, 'test-double');
  assert.equal(row.provider_model, 'double-1');
  assert.equal(row.provider_reference, 'ref-1');
  assert.equal(row.face_match_status, 'match');
  assert.equal(row.liveness_status, 'passed');
  assert.equal(row.threshold_policy_version, 'biometric_threshold.v1');
  assert.equal(row.consent_id, consent.id);

  const sessionAfter = JSON.stringify(db.verification_sessions.find((s) => s.id === 'vs-a'));
  assert.equal(sessionAfter, sessionBefore, 'a provider match never touches the session — no status, no verified');
  assert.equal(db.calls.filter((c) => c.table === 'verification_sessions' && c.op !== 'select').length, 0);

  const audit = db.trust_audit_events.find((a) => a.event_type === 'BIOMETRIC_ASSESSMENT_RECORDED');
  assert.ok(audit, 'the assessment is audited');
});

test('X4: client-submitted scores and verdicts are inert — the route accepts only the session id', async () => {
  await grantConsent('user-a');
  // No injected provider over HTTP: the registry resolves the honest null provider.
  const res = await call('POST', '/api/identity/verification-sessions/vs-a/biometrics', {
    userId: 'user-a',
    body: { face_match_score: 0.99, face_match_status: 'match', liveness_status: 'passed', livenessScore: 1 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.biometric.provider_state, 'not_configured');
  assert.equal(res.body.biometric.face_match_status, 'not_run', 'the forged body changed nothing');

  const row = db.verification_assessments.at(-1);
  assert.equal(row.face_match_score ?? null, null);
  assert.deepEqual(row.risk_flags, ['biometric_not_configured']);
});

test('X4: injected providers are test-only — any other environment refuses them', async () => {
  await grantConsent('user-a');
  const savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(
      () => runBiometricAssessment(undefined, { id: 'user-a' }, 'vs-a', { provider: providerSpy(MATCH_RESULT) }),
      /test suite/,
    );
  } finally {
    process.env.NODE_ENV = savedEnv;
  }
});

test('X4: cross-user isolation — another user\'s session and assessments are unreachable', async () => {
  await grantConsent('user-a');
  await runBiometricAssessment(undefined, { id: 'user-a' }, 'vs-a', { provider: providerSpy(MATCH_RESULT) });

  const foreign = await call('POST', '/api/identity/verification-sessions/vs-a/biometrics', { userId: 'user-b', body: {} });
  assert.equal(foreign.status, 404, "user B cannot run an assessment on user A's session");

  const consentB = await call('GET', '/api/identity/biometric-consent', { userId: 'user-b' });
  assert.equal(consentB.body.consent.active, false, "user A's consent is not user B's");
});

// ---------------------------------------------------------------------------------------
// Decision policy: evidence gates approval and never grants it
// ---------------------------------------------------------------------------------------

const BASE_SESSION = Object.freeze({
  workflow_phase: 'reviewer_action_required',
  evidence_classification: 'valid_identity_document',
  extraction_trust_status: 'partially_trusted',
  identity_binding_status: 'match',
  status: 'pending_manual_review',
});

test('X4: face mismatch and failed liveness BLOCK approval; indeterminate/unavailable keep the human path open', () => {
  const mismatch = DecisionPolicyEngine.buildAssessmentSummary(BASE_SESSION, null, null, null, {
    face_match_status: 'mismatch', liveness_status: 'passed', provider: 'p', provider_state: 'completed',
  });
  assert.equal(mismatch.allowed_actions.includes('approve'), false, 'face mismatch cannot silently approve');
  assert.ok(mismatch.allowed_actions.includes('escalate'));

  const livenessFailed = DecisionPolicyEngine.buildAssessmentSummary(BASE_SESSION, null, null, null, {
    face_match_status: 'match', liveness_status: 'failed', provider: 'p', provider_state: 'completed',
  });
  assert.equal(livenessFailed.allowed_actions.includes('approve'), false, 'failed liveness cannot silently approve');
  assert.ok(livenessFailed.allowed_actions.includes('request_resubmission'), 'the applicant can retry — no auto-rejection');

  for (const soft of [
    { face_match_status: 'indeterminate', liveness_status: 'indeterminate', provider_state: 'completed' },
    { face_match_status: 'provider_failed', liveness_status: 'provider_failed', provider_state: 'unavailable' },
    { face_match_status: 'not_run', liveness_status: 'not_run', provider_state: 'not_configured' },
  ]) {
    const summary = DecisionPolicyEngine.buildAssessmentSummary(BASE_SESSION, null, null, null, soft);
    assert.equal(summary.allowed_actions.includes('approve'), true,
      `${soft.provider_state}: provider trouble routes to human judgment, never auto-rejection`);
  }

  // A provider MATCH grants nothing the other dimensions did not already permit: with a name
  // MISMATCH the case still cannot be approved, biometrics notwithstanding.
  const nameMismatch = DecisionPolicyEngine.buildAssessmentSummary(
    { ...BASE_SESSION, identity_binding_status: 'mismatch' }, null, null, null,
    { face_match_status: 'match', liveness_status: 'passed', provider_state: 'completed' },
  );
  assert.equal(nameMismatch.allowed_actions.includes('approve'), false,
    'biometric match is evidence, not an override — the independent name-binding still gates');
});

test('X4: the name-binding dimension is unchanged and independent (source pin)', () => {
  const binding = readFileSync(new URL('../services/identity/identityBinding.js', import.meta.url), 'utf8');
  assert.match(binding, /account-holder vs document-holder/i, 'identityBinding remains name comparison');
  assert.doesNotMatch(binding, /\bface\b|biometric|liveness/i, 'it is not biometric and does not pretend to be');

  const policy = readFileSync(new URL('../services/identity/decisionPolicy.js', import.meta.url), 'utf8');
  assert.match(policy, /identity_binding_status/, 'the binding dimension survives alongside biometrics');
});

test('X4: latest-assessment fetch is session-scoped and source-filtered', async () => {
  await grantConsent('user-a');
  await runBiometricAssessment(undefined, { id: 'user-a' }, 'vs-a', { provider: providerSpy(MATCH_RESULT) });
  db.verification_assessments.push({ id: 'other', session_id: 'vs-a', assessment_source: 'system', face_match_status: 'mismatch' });

  const latest = await fetchLatestBiometricAssessment(undefined, 'vs-a');
  assert.equal(latest.assessment_source, 'biometric_provider', 'system rows never masquerade as biometric evidence');
  assert.equal(await fetchLatestBiometricAssessment(undefined, 'vs-b'), null);
});
