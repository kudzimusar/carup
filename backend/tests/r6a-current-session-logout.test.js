/**
 * OC-NATIVE-LR1-R6-A-R1 — current-session termination.
 *
 * Proves the self-service logout surface revokes only the authenticated presenting
 * session, ignores client-supplied identity/target claims, emits no token material,
 * refuses unauthenticated callers, and fails closed when persistence/audit fails.
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
const authSecurityRouter = (await import('../routes/authSecurityRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { isPasswordlessLoginAllowed } = await import('../utils/passwordAuth.js');

const FUTURE = '2027-12-31T00:00:00.000Z';
let db;
const faults = { sessionUpdate: false, auditInsert: false };

function resetDb() {
  db = {
    users: [
      { id: 'user-a', role: 'owner', is_verified: true },
      { id: 'user-b', role: 'owner', is_verified: true },
    ],
    user_sessions: [
      { id: 'session-a-1', token: 'token-a-1', user_id: 'user-a', is_valid: true, expires_at: FUTURE, created_at: '2026-10-15T01:00:00.000Z', user_agent: 'A1', active_organization_id: null },
      { id: 'session-a-2', token: 'token-a-2', user_id: 'user-a', is_valid: true, expires_at: FUTURE, created_at: '2026-10-15T00:00:00.000Z', user_agent: 'A2', active_organization_id: null },
      { id: 'session-b-1', token: 'token-b-1', user_id: 'user-b', is_valid: true, expires_at: FUTURE, created_at: '2026-10-15T01:00:00.000Z', user_agent: 'B1', active_organization_id: null },
    ],
    trust_audit_events: [],
    organization_users: [],
    organization_audit_logs: [],
  };
}

function builder(table) {
  const state = { op: 'select', filters: {}, payload: null, single: false, maybe: false, limit: null };
  const chain = {
    select() { return chain; },
    insert(payload) { state.op = 'insert'; state.payload = payload; return chain; },
    update(payload) { state.op = 'update'; state.payload = payload; return chain; },
    eq(key, value) { state.filters[key] = value; return chain; },
    order() { return chain; },
    limit(value) { state.limit = value; return chain; },
    single() { state.single = true; return chain; },
    maybeSingle() { state.maybe = true; return chain; },
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
      const inserted = payloads.map((payload, index) => ({ id: payload.id || `${table}-${rows.length + index + 1}`, ...payload }));
      rows.push(...inserted);
      return { data: state.single ? inserted[0] : inserted, error: null };
    }

    if (state.op === 'update') {
      if (table === 'user_sessions' && faults.sessionUpdate) {
        return { data: null, error: { code: 'XX000', message: 'session store unavailable' } };
      }
      const hits = rows.filter(match);
      hits.forEach((row) => Object.assign(row, state.payload));
      return { data: state.single ? (hits[0] || null) : hits, error: null };
    }

    let selected = rows.filter(match);
    if (typeof state.limit === 'number') selected = selected.slice(0, state.limit);
    if (state.maybe) return { data: selected[0] || null, error: null };
    if (state.single) {
      return selected[0]
        ? { data: selected[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'not found' } };
    }
    return { data: selected, error: null };
  }

  return chain;
}

let server;
let port;

before(async () => {
  resetDb();
  supabase.from = (table) => builder(table);
  const app = express();
  app.use(express.json());
  app.use(authSecurityRouter);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
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

test('logout revokes only the presenting session, preserves other sessions, and revoked-token reuse is refused', async () => {
  const logout = await call('POST', '/api/auth/logout', { token: 'token-a-1' });
  assert.equal(logout.status, 200);
  assert.deepEqual(logout.body, { success: true });
  assert.equal(db.user_sessions.find((s) => s.id === 'session-a-1').is_valid, false);
  assert.equal(db.user_sessions.find((s) => s.id === 'session-a-2').is_valid, true);
  assert.equal(db.user_sessions.find((s) => s.id === 'session-b-1').is_valid, true);

  const revokedReuse = await call('GET', '/api/auth/sessions', { token: 'token-a-1' });
  assert.equal(revokedReuse.status, 401);

  const otherSession = await call('GET', '/api/auth/sessions', { token: 'token-a-2' });
  assert.equal(otherSession.status, 200);
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
  assert.equal(db.user_sessions.find((s) => s.id === 'session-a-2').is_valid, false, 'the presenting session is the only target');
  assert.equal(db.user_sessions.find((s) => s.id === 'session-a-1').is_valid, true);
  assert.equal(db.user_sessions.find((s) => s.id === 'session-b-1').is_valid, true, 'another account cannot be targeted');
});

test('unauthenticated logout is refused even when x-user-id fallback is enabled for tests', async () => {
  const bare = await call('POST', '/api/auth/logout');
  assert.equal(bare.status, 401);
  const asserted = await call('POST', '/api/auth/logout', { userId: 'user-a' });
  assert.equal(asserted.status, 401);
});

test('logout audit contains session ids but no token material', async () => {
  const res = await call('POST', '/api/auth/logout', { token: 'token-a-1' });
  assert.equal(res.status, 200);
  const audit = db.trust_audit_events.at(-1);
  assert.equal(audit.event_type, 'USER_SESSIONS_REVOKED');
  assert.deepEqual(audit.new_value.revoked_session_ids, ['session-a-1']);
  const serialized = JSON.stringify(audit);
  assert.doesNotMatch(serialized, /token-a-1|token-a-2|token-b-1/);
});

test('session-store failure never reports successful revocation', async () => {
  faults.sessionUpdate = true;
  const res = await call('POST', '/api/auth/logout', { token: 'token-a-1' });
  assert.equal(res.status, 500);
  assert.equal(db.user_sessions.find((s) => s.id === 'session-a-1').is_valid, true);
});

test('audit-store failure never reports successful revocation', async () => {
  faults.auditInsert = true;
  const res = await call('POST', '/api/auth/logout', { token: 'token-a-1' });
  assert.equal(res.status, 500);
  assert.equal(db.user_sessions.find((s) => s.id === 'session-a-1').is_valid, false, 'revocation occurred, but the unaudited operation is not reported as success');
});

test('the normal server CSRF guard is mounted before the auth-security router', () => {
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const csrf = source.indexOf('app.use(csrfMiddleware)');
  const authRouter = source.indexOf('app.use(authSecurityRouter)');
  assert.ok(csrf >= 0 && authRouter > csrf, 'mutating auth-security routes remain behind global CSRF middleware');
});

test('passwordless development login remains denied in declared Vercel deployments', () => {
  assert.equal(isPasswordlessLoginAllowed({
    NODE_ENV: 'test',
    VERCEL: '1',
    VERCEL_ENV: 'preview',
  }), false);
  assert.equal(isPasswordlessLoginAllowed({
    NODE_ENV: 'development',
    VERCEL: '1',
    VERCEL_ENV: 'production',
  }), false);
});
