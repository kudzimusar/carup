/**
 * O2-X3 — authentication assurance and step-up (runtime, real routers + real middleware).
 *
 * Held here:
 *   · assurance derives ONLY from the user_sessions row — forged headers/bodies change nothing;
 *   · no fake strong auth exists: STRONG_AUTHENTICATOR_AVAILABLE is false, the critical class
 *     records its deferral to recent password re-proof EXPLICITLY, and no method outside the
 *     allowlist can be recorded;
 *   · step-up verifies the real credential server-side before stamping the presenting session;
 *   · guarded routes refuse stale/absent step-up with a legible refusal, and an asserted
 *     (x-user-id) identity cannot exercise any step-up-gated or security surface;
 *   · step-up NEVER substitutes for the domain's own authorization (capability still refused);
 *   · revocation: self revoke-others keeps the presenting session; an invalidated session is
 *     rejected by the REAL authMiddleware afterwards;
 *   · recovery: routine password reset stays an authentication event (no identity-lifecycle
 *     import in the recovery router), while suspected takeover is the governed lifecycle path.
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
const { hashPassword } = await import('../utils/passwordAuth.js');
const authSecurityRouter = (await import('../routes/authSecurityRoutes.js')).default;
const lifecycleAdminRouter = (await import('../routes/identityLifecycleAdminRoutes.js')).default;
const { createPassportOwnershipTransferRouter } = await import('../routes/passportOwnershipTransferRoutes.js');
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const {
  ACTION_CLASSES,
  ACTION_CLASS_POLICY,
  AUTHENTICATION_STRENGTHS,
  STRONG_AUTHENTICATOR_AVAILABLE,
  STEP_UP_TTL_MS,
  deriveSessionAssurance,
  satisfiesActionClass,
  recordStepUp,
} = await import('../services/auth/authenticationAssuranceService.js');

const FUTURE = '2027-01-01T00:00:00.000Z';
const PASSWORD = 'correct-horse-battery';
let PASSWORD_HASH;

let db;
function resetDb() {
  db = {
    users: [
      { id: 'admin-1', role: 'admin', is_verified: true, password_hash: PASSWORD_HASH },
      { id: 'owner-1', role: 'owner', is_verified: true, password_hash: PASSWORD_HASH },
      { id: 'subject-9', role: 'owner', is_verified: true, password_hash: PASSWORD_HASH },
    ],
    user_sessions: [
      { id: 's-admin', token: 'admin-token', user_id: 'admin-1', is_valid: true, expires_at: FUTURE, created_at: '2026-09-03T08:00:00.000Z', auth_method: 'password', step_up_at: null, step_up_method: null },
      { id: 's-owner', token: 'owner-token', user_id: 'owner-1', is_valid: true, expires_at: FUTURE, created_at: '2026-09-03T08:00:00.000Z', auth_method: 'password', step_up_at: null, step_up_method: null },
      { id: 's-owner-2', token: 'owner-token-2', user_id: 'owner-1', is_valid: true, expires_at: FUTURE, created_at: '2026-09-03T07:00:00.000Z', auth_method: 'password', step_up_at: null, step_up_method: null },
      { id: 's-subj', token: 'subject-token', user_id: 'subject-9', is_valid: true, expires_at: FUTURE, created_at: '2026-09-03T08:00:00.000Z', auth_method: 'password', step_up_at: null, step_up_method: null },
    ],
    verification_sessions: [
      { id: 'vs-subj', user_id: 'subject-9', status: 'verified', ocr_result: {}, created_at: '2026-09-01T00:00:00.000Z' },
    ],
    identity_lifecycle_events: [],
    trust_audit_events: [],
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
      if (st.single) return hits[0] ? { data: hits[0], error: null } : { data: null, error: { message: 'not found' } };
      return { data: hits, error: null };
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
  PASSWORD_HASH = await hashPassword(PASSWORD);
  resetDb();
  supabase.from = (t) => builder(t);
  const app = express();
  app.use(express.json());
  app.use(authSecurityRouter);
  app.use(lifecycleAdminRouter);
  // The transfer transition route with a stub domain client: the guard runs first, so a
  // request that clears it reaches the stub (marker error), and one that does not never does.
  app.use(createPassportOwnershipTransferRouter({
    client: { from: () => { throw new Error('DOMAIN_REACHED'); }, rpc: () => { throw new Error('DOMAIN_REACHED'); } },
  }));
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
});
after(() => { server?.close(); });
beforeEach(() => { resetDb(); });

function call(method, path, { token, userId, body, headers = {} } = {}) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-session-token': token } : {}),
        ...(userId ? { 'x-user-id': userId } : {}),
        ...headers,
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

// ---------------------------------------------------------------------------------------
// Pure policy
// ---------------------------------------------------------------------------------------

test('X3: no fake strong auth — availability is false, the critical class records its deferral, the method allowlist refuses webauthn', async () => {
  assert.equal(STRONG_AUTHENTICATOR_AVAILABLE, false);
  assert.equal(ACTION_CLASS_POLICY[ACTION_CLASSES.CRITICAL].requiredStrength, AUTHENTICATION_STRENGTHS.RECENT_REAUTH);
  assert.equal(ACTION_CLASS_POLICY[ACTION_CLASSES.CRITICAL].deferredStrongAuthenticator, true,
    'the deferral is explicit policy, never silence');
  await assert.rejects(
    () => recordStepUp(undefined, { token: 'admin-token', userId: 'admin-1', method: 'webauthn' }),
    /Unsupported step-up method/,
  );
});

test('X3: assurance derives from the session row alone, with real TTLs per class', () => {
  const nowMs = Date.parse('2026-09-03T12:00:00.000Z');
  const fresh = deriveSessionAssurance({ created_at: 'T0', step_up_at: '2026-09-03T11:56:00.000Z', step_up_method: 'password_reauth' }, nowMs);
  assert.equal(satisfiesActionClass(fresh, ACTION_CLASSES.SENSITIVE, nowMs).ok, true);
  assert.equal(satisfiesActionClass(fresh, ACTION_CLASSES.CRITICAL, nowMs).ok, true, 'within the 5-minute critical TTL');

  const staleForCritical = deriveSessionAssurance({ step_up_at: '2026-09-03T11:50:00.000Z', step_up_method: 'password_reauth' }, nowMs);
  assert.equal(satisfiesActionClass(staleForCritical, ACTION_CLASSES.SENSITIVE, nowMs).ok, true);
  assert.equal(satisfiesActionClass(staleForCritical, ACTION_CLASSES.CRITICAL, nowMs).ok, false, 'critical demands fresher proof');

  const none = deriveSessionAssurance({ created_at: 'T0' }, nowMs);
  assert.equal(satisfiesActionClass(none, ACTION_CLASSES.ORDINARY, nowMs).ok, true);
  assert.equal(satisfiesActionClass(none, ACTION_CLASSES.SENSITIVE, nowMs).ok, false);

  // An unknown method persisted by anything is worth nothing.
  const bogus = deriveSessionAssurance({ step_up_at: '2026-09-03T11:59:00.000Z', step_up_method: 'totally-made-up' }, nowMs);
  assert.equal(satisfiesActionClass(bogus, ACTION_CLASSES.SENSITIVE, nowMs).ok, false);

  assert.ok(STEP_UP_TTL_MS[ACTION_CLASSES.CRITICAL] < STEP_UP_TTL_MS[ACTION_CLASSES.SENSITIVE]);
});

// ---------------------------------------------------------------------------------------
// Step-up endpoint + forgery
// ---------------------------------------------------------------------------------------

test('X3: step-up verifies the real credential, stamps the presenting session, and unlocks the sensitive class', async () => {
  const wrong = await call('POST', '/api/auth/step-up', { token: 'owner-token', body: { password: 'nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(db.user_sessions.find((s) => s.id === 's-owner').step_up_at, null, 'a failed credential stamps nothing');

  const blockedBefore = await call('POST', '/api/auth/sessions/revoke-others', { token: 'owner-token' });
  assert.equal(blockedBefore.status, 403);
  assert.equal(blockedBefore.body.code, 'STEP_UP_REQUIRED');
  assert.equal(blockedBefore.body.required_strength, 'recent_reauth');

  const right = await call('POST', '/api/auth/step-up', { token: 'owner-token', body: { password: PASSWORD } });
  assert.equal(right.status, 200);
  assert.equal(right.body.method, 'password_reauth');
  assert.ok(db.user_sessions.find((s) => s.id === 's-owner').step_up_at, 'the presenting session row is stamped');

  const allowed = await call('POST', '/api/auth/sessions/revoke-others', { token: 'owner-token' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.revoked_count, 1, 'the other session went; the presenting one stayed');
  assert.equal(db.user_sessions.find((s) => s.id === 's-owner').is_valid, true);
  assert.equal(db.user_sessions.find((s) => s.id === 's-owner-2').is_valid, false);
});

test('X3: forged client assurance changes nothing — headers and body claims are never read', async () => {
  const res = await call('POST', '/api/auth/sessions/revoke-others', {
    token: 'owner-token',
    headers: {
      'x-step-up-at': new Date().toISOString(),
      'x-step-up-method': 'webauthn',
      'x-authentication-strength': 'strong_authenticator',
    },
    body: { step_up_at: new Date().toISOString(), step_up_method: 'webauthn', authentication_strength: 'strong_authenticator' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'STEP_UP_REQUIRED');
  assert.equal(res.body.current_strength, 'session', 'the server derived from the row, not from the claims');
});

test('X3: an invalidated session is rejected by the REAL auth middleware afterwards', async () => {
  await call('POST', '/api/auth/step-up', { token: 'owner-token', body: { password: PASSWORD } });
  await call('POST', '/api/auth/sessions/revoke-others', { token: 'owner-token' });
  const revokedUse = await call('GET', '/api/auth/sessions', { token: 'owner-token-2' });
  assert.equal(revokedUse.status, 401, 'a revoked session cannot come back');
  const liveUse = await call('GET', '/api/auth/sessions', { token: 'owner-token' });
  assert.equal(liveUse.status, 200);
});

test('X3: an asserted x-user-id identity cannot exercise any security surface', async () => {
  for (const [method, path, body] of [
    ['POST', '/api/auth/step-up', { password: PASSWORD }],
    ['GET', '/api/auth/sessions'],
    ['POST', '/api/auth/sessions/revoke-others'],
    ['POST', '/api/admin/identity/lifecycle/subject-9/transition', { next_state: 'suspended', reason_code: 'SECURITY_REVIEW' }],
    ['POST', '/api/admin/account-security/subject-9/revoke-sessions', { reason: 'lost device' }],
  ]) {
    const res = await call(method, path, { userId: 'admin-1', body });
    assert.equal(res.status, 401, `${method} ${path} must refuse the fallback identity`);
  }
});

// ---------------------------------------------------------------------------------------
// Lifecycle admin routes: capability + step-up layering
// ---------------------------------------------------------------------------------------

async function stepUp(token) {
  const res = await call('POST', '/api/auth/step-up', { token, body: { password: PASSWORD } });
  assert.equal(res.status, 200);
}

test('X3: the lifecycle transition route layers proven session → capability → step-up → policy', async () => {
  // Proven session but no step-up: refused by the assurance guard.
  const noStepUp = await call('POST', '/api/admin/identity/lifecycle/subject-9/transition', {
    token: 'admin-token', body: { next_state: 'suspended', reason_code: 'SECURITY_REVIEW' },
  });
  assert.equal(noStepUp.status, 403);
  assert.equal(noStepUp.body.code, 'STEP_UP_REQUIRED');

  // Step-up alone does NOT substitute for authorization: an owner with fresh step-up is
  // still refused by the role/capability layers, never admitted by assurance.
  await stepUp('owner-token');
  const noCapability = await call('POST', '/api/admin/identity/lifecycle/subject-9/transition', {
    token: 'owner-token', body: { next_state: 'suspended', reason_code: 'SECURITY_REVIEW' },
  });
  assert.equal(noCapability.status, 403);
  assert.notEqual(noCapability.body.code, 'STEP_UP_REQUIRED', 'the refusal is authorization, not assurance');

  // Admin with fresh step-up: the governed transition runs, sessions cascade on compromised.
  await stepUp('admin-token');
  const compromised = await call('POST', '/api/admin/identity/lifecycle/subject-9/transition', {
    token: 'admin-token', body: { next_state: 'compromised', reason_code: 'SUSPECTED_ACCOUNT_TAKEOVER' },
  });
  assert.equal(compromised.status, 200);
  assert.equal(compromised.body.lifecycle.effective_state, 'compromised');
  assert.equal(compromised.body.revoked_sessions, 1);
  assert.equal(db.user_sessions.find((s) => s.id === 's-subj').is_valid, false);

  // The applicant cannot drive their own lifecycle even with a proven, stepped-up session.
  db.user_sessions.push({ id: 's-subj2', token: 'subject-token-2', user_id: 'subject-9', is_valid: true, expires_at: FUTURE, created_at: 'T', auth_method: 'password', step_up_at: null, step_up_method: null });
  await stepUp('subject-token-2');
  const selfServe = await call('POST', '/api/admin/identity/lifecycle/subject-9/transition', {
    token: 'subject-token-2', body: { next_state: 'verified', reason_code: 'VERIFICATION_APPROVED' },
  });
  assert.ok([401, 403].includes(selfServe.status), 'the subject is refused before policy even speaks');
});

test('X3: governed admin revocation requires reason + step-up, and audits session ids only', async () => {
  await stepUp('admin-token');
  const missingReason = await call('POST', '/api/admin/account-security/subject-9/revoke-sessions', {
    token: 'admin-token', body: {},
  });
  assert.equal(missingReason.status, 400);

  const res = await call('POST', '/api/admin/account-security/subject-9/revoke-sessions', {
    token: 'admin-token', body: { reason: 'device reported stolen' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.revoked_count, 1);
  const audit = db.trust_audit_events.at(-1);
  assert.equal(audit.event_type, 'USER_SESSIONS_REVOKED');
  assert.doesNotMatch(JSON.stringify(audit), /subject-token/, 'no token material in audit');
});

test('X3: the transfer transition route is CRITICAL class — stale sensitive-grade step-up is refused; fresh step-up reaches the domain', async () => {
  // No step-up at all → the guard refuses before the domain sees anything.
  const bare = await call('PATCH', '/api/ownership-transfers/tr-1', {
    token: 'admin-token', body: { state: 'complete' },
  });
  assert.equal(bare.status, 403);
  assert.equal(bare.body.code, 'STEP_UP_REQUIRED');
  assert.equal(bare.body.action_class, 'critical_authority_action');

  // A step-up fresh for SENSITIVE but stale for CRITICAL (older than 5 minutes) still refuses.
  db.user_sessions.find((s) => s.id === 's-admin').step_up_at = new Date(Date.now() - 8 * 60 * 1000).toISOString();
  db.user_sessions.find((s) => s.id === 's-admin').step_up_method = 'password_reauth';
  const stale = await call('PATCH', '/api/ownership-transfers/tr-1', {
    token: 'admin-token', body: { state: 'complete' },
  });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, 'STEP_UP_REQUIRED');

  // Fresh step-up clears the guard; the request reaches the DOMAIN, whose own governance rules
  // next — here the transfer service's completion contract refuses for want of a registry
  // authority. Step-up granted nothing by itself.
  await stepUp('admin-token');
  const through = await call('PATCH', '/api/ownership-transfers/tr-1', {
    token: 'admin-token', body: { state: 'complete' },
  });
  assert.notEqual(through.body?.error?.code ?? through.body?.code, 'STEP_UP_REQUIRED');
  assert.match(JSON.stringify(through.body), /registryAuthority and completionReference/,
    'the domain service is the next and final word');
});

// ---------------------------------------------------------------------------------------
// Recovery classification
// ---------------------------------------------------------------------------------------

test('X3: routine recovery is an authentication event — the recovery router touches no identity lifecycle; suspected takeover is the governed lifecycle path', async () => {
  const recovery = readFileSync(new URL('../routes/authRecoveryRoutes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(recovery, /identityLifecycle|identity_lifecycle/,
    'an ordinary forgotten password never downgrades identity proofing');
  assert.match(recovery, /update\(\{ is_valid: false \}\)/,
    'a reset still signs out every prior session (the existing pinned behaviour)');

  const { LIFECYCLE_REASON_CODES } = await import('../services/identity/identityLifecycleService.js');
  assert.ok(LIFECYCLE_REASON_CODES.SUSPECTED_ACCOUNT_TAKEOVER, 'takeover has its own governed reason code');
  assert.notEqual(LIFECYCLE_REASON_CODES.SUSPECTED_ACCOUNT_TAKEOVER.code, 'SECURITY_REVIEW');
});
