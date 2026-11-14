/**
 * TI-10 — POST /api/auth/logout revokes ONLY the presenting session.
 *
 * Reconciled from PR #226 (frozen lineage) onto current main's auth contract. Exercises
 * the REAL route + REAL authorizeSessionRole middleware against a mocked Supabase,
 * proving over real HTTP:
 *   1. logout revokes the presenting session, preserves the account's other session and
 *      every other account's session, and a replayed (revoked) token is refused;
 *   2. client body/header spoofing cannot redirect revocation to another account/session;
 *   3. unauthenticated logout is refused even with x-user-id fallback enabled;
 *   4. the audit row records session ids but never token material;
 *   5. a session-store failure leaves the session valid and reports 500 (no false success);
 *   6. an audit-store failure after revocation still reports 500 (unaudited ≠ success);
 *   7. the composed production mount — authRecoveryRouter(), which hosts this router — really
 *      exposes /api/auth/logout, and the global CSRF middleware is mounted before that batch.
 *
 * No credential material is printed: tokens below are fictional test strings and the
 * assertion suite proves none of them reach the audit payload.
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
const { authSessionRouter } = await import('../routes/authSessionRoutes.js');
const { authRecoveryRouter } = await import('../routes/authRecoveryRoutes.js');

const FUTURE = '2027-12-31T00:00:00.000Z';
let db;
const faults = { sessionUpdate: false, auditInsert: false };

function resetDb() {
  db = {
    user_sessions: [
      { id: 'session-a-1', token: 'token-a-1', user_id: 'user-a', is_valid: true, expires_at: FUTURE, created_at: '2026-10-15T01:00:00.000Z', active_role: 'owner', active_organization_id: null },
      { id: 'session-a-2', token: 'token-a-2', user_id: 'user-a', is_valid: true, expires_at: FUTURE, created_at: '2026-10-15T00:00:00.000Z', active_role: 'owner', active_organization_id: null },
      { id: 'session-b-1', token: 'token-b-1', user_id: 'user-b', is_valid: true, expires_at: FUTURE, created_at: '2026-10-15T01:00:00.000Z', active_role: 'owner', active_organization_id: null },
    ],
    users: [
      { id: 'user-a', role: 'owner', is_verified: true },
      { id: 'user-b', role: 'owner', is_verified: true },
    ],
    trust_audit_events: [],
  };
}

function builder(table) {
  const state = { op: 'select', filters: {}, payload: null, single: false };
  const chain = {
    select() { return chain; },
    insert(payload) { state.op = 'insert'; state.payload = payload; return chain; },
    update(payload) { state.op = 'update'; state.payload = payload; return chain; },
    eq(key, value) { state.filters[key] = value; return chain; },
    single() { state.single = true; return chain; },
    then(resolve, reject) {
      try { return Promise.resolve(run()).then(resolve, reject); }
      catch (error) { return reject ? reject(error) : Promise.reject(error); }
    },
  };

  function run() {
    const rows = (db[table] = db[table] || []);
    const match = (row) => Object.entries(state.filters).every(([key, value]) => row[key] === value);

    if (state.op === 'insert') {
      if (table === 'trust_audit_events' && faults.auditInsert) {
        return { data: null, error: { code: 'XX000', message: 'audit unavailable' } };
      }
      const payloads = Array.isArray(state.payload) ? state.payload : [state.payload];
      rows.push(...payloads);
      return { data: payloads, error: null };
    }

    if (state.op === 'update') {
      if (table === 'user_sessions' && faults.sessionUpdate) {
        return { data: null, error: { code: 'XX000', message: 'session store unavailable' } };
      }
      const affected = rows.filter(match);
      for (const row of affected) Object.assign(row, state.payload);
      return { data: affected, error: null };
    }

    const found = rows.filter(match);
    if (state.single) {
      return found.length > 0
        ? { data: found[0], error: null }
        : { data: null, error: { message: 'no row' } };
    }
    return { data: found, error: null };
  }

  return chain;
}

supabase.from = (table) => builder(table);

let server;
let port;

before(async () => {
  const app = express();
  app.use(express.json());
  // Mirror the production composition: the router is exercised exactly as the mounted
  // auth batch exposes it (directly here, and through authRecoveryRouter() in test 8).
  app.use(authSessionRouter());
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(() => server?.close());

beforeEach(() => {
  resetDb();
  faults.sessionUpdate = false;
  faults.auditInsert = false;
});

function call(method, path, { token, userId, body } = {}) {
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
        ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let bodyOut = null;
        try { bodyOut = raw ? JSON.parse(raw) : null; } catch { bodyOut = raw; }
        resolve({ status: res.statusCode, body: bodyOut });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function session(id) {
  return db.user_sessions.find((s) => s.id === id);
}

test('logout revokes only the presenting session; replay of the revoked token is refused; other sessions stay valid', async () => {
  const logout = await call('POST', '/api/auth/logout', { token: 'token-a-1' });
  assert.equal(logout.status, 200);
  assert.deepEqual(logout.body, { success: true });
  assert.equal(session('session-a-1').is_valid, false);
  assert.equal(session('session-a-2').is_valid, true, "the account's OTHER session survives");
  assert.equal(session('session-b-1').is_valid, true, "another account's session survives");

  // Token replay after revocation must be refused by the real session middleware.
  const replay = await call('POST', '/api/auth/logout', { token: 'token-a-1' });
  assert.equal(replay.status, 401);
  // ...and the surviving session must still be usable.
  const other = await call('POST', '/api/auth/logout', { token: 'token-a-2' });
  assert.equal(other.status, 200);
  assert.equal(session('session-a-2').is_valid, false);
  assert.equal(session('session-b-1').is_valid, true);
});

test('client body/header spoofing cannot redirect logout to another account or session', async () => {
  const res = await call('POST', '/api/auth/logout', {
    token: 'token-a-2',
    userId: 'user-b',
    body: {
      userId: 'user-b',
      sessionId: 'session-b-1',
      session_token: 'token-b-1',
      target_session_id: 'session-a-1',
    },
  });
  assert.equal(res.status, 200);
  assert.equal(session('session-a-2').is_valid, false, 'the presenting session is the ONLY target');
  assert.equal(session('session-a-1').is_valid, true);
  assert.equal(session('session-b-1').is_valid, true, 'another account cannot be targeted');
});

test('unauthenticated logout is refused even with the x-user-id test fallback enabled', async () => {
  const bare = await call('POST', '/api/auth/logout');
  assert.equal(bare.status, 401);
  const asserted = await call('POST', '/api/auth/logout', { userId: 'user-a' });
  assert.equal(asserted.status, 401, 'an asserted (unproven) identity cannot sign anyone out');
  assert.equal(session('session-a-1').is_valid, true, 'no session was touched');
});

test('the audit row records session ids but no token material', async () => {
  const res = await call('POST', '/api/auth/logout', { token: 'token-a-1' });
  assert.equal(res.status, 200);
  const audit = db.trust_audit_events.at(-1);
  assert.equal(audit.event_type, 'USER_SESSION_REVOKED');
  assert.equal(audit.actor_user_id, 'user-a');
  assert.deepEqual(audit.new_value.revoked_session_ids, ['session-a-1']);
  const serialized = JSON.stringify(db.trust_audit_events);
  assert.doesNotMatch(serialized, /token-a-1|token-a-2|token-b-1/, 'no credential material in the audit trail');
});

test('a session-store failure leaves the session valid and reports failure honestly', async () => {
  faults.sessionUpdate = true;
  const res = await call('POST', '/api/auth/logout', { token: 'token-a-1' });
  assert.equal(res.status, 500);
  assert.equal(session('session-a-1').is_valid, true, 'not revoked — the server still honors it');
  assert.match(res.body.error, /remain[s]? valid until expiry/i);
});

test('an audit-store failure after revocation is still reported as failure (unaudited ≠ success)', async () => {
  faults.auditInsert = true;
  const res = await call('POST', '/api/auth/logout', { token: 'token-a-1' });
  assert.equal(res.status, 500);
  assert.equal(session('session-a-1').is_valid, false, 'revocation DID occur');
  assert.match(res.body.error, /audit/i);
});

test('the normal server CSRF guard is mounted before the auth-session router', () => {
  const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const recoverySource = readFileSync(new URL('../routes/authRecoveryRoutes.js', import.meta.url), 'utf8');

  // server.js mounts the global CSRF middleware...
  const csrf = serverSource.indexOf('app.use(csrfMiddleware)');
  assert.ok(csrf >= 0, 'server.js mounts the global CSRF middleware');

  // ...and mounts the auth recovery router (the batch that hosts the session router) AFTER it.
  const recoveryMount = serverSource.indexOf('app.use(authRecoveryRouter())');
  assert.ok(recoveryMount > csrf, 'the auth batch is mounted after the global CSRF middleware');

  // The session router itself is composed into that batch.
  assert.ok(
    recoverySource.includes('router.use(authSessionRouter())'),
    'authRecoveryRoutes.js composes the auth-session router into the mounted auth batch',
  );
});

test('the production mount — authRecoveryRouter() — really exposes POST /api/auth/logout', async () => {
  // Compose the REAL production batch (the mounted auth recovery router, with its email/token
  // collaborators faked out — none of them are exercised by logout) and prove the session
  // endpoint is reachable through it, exactly as a production request would arrive.
  const fakeTokenService = {
    issue: async () => ({ rawToken: 'unused' }),
    consume: async () => ({ ok: false }),
    revokeLiveTokens: async () => {},
  };
  const composed = express();
  composed.use(express.json());
  composed.use(authRecoveryRouter({ tokenService: fakeTokenService, services: null }));
  const composedServer = await new Promise((resolve) => {
    const s = composed.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const port2 = composedServer.address().port;
    const call2 = (method, path, { token, body } = {}) => new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1', port: port2, path, method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-session-token': token } : {}),
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

    const logout = await call2('POST', '/api/auth/logout', { token: 'token-a-1' });
    assert.equal(logout.status, 200);
    assert.deepEqual(logout.body, { success: true });
    assert.equal(session('session-a-1').is_valid, false);

    const replay = await call2('POST', '/api/auth/logout', { token: 'token-a-1' });
    assert.equal(replay.status, 401, 'a replayed token is refused through the production mount too');
  } finally {
    composedServer.close();
  }
});
