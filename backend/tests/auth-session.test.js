/**
 * Backend session-validation tests for GET /api/auth/me.
 *
 * Exercises the REAL authorizeRole middleware against a mocked Supabase, proving that the frontend
 * boot-validation endpoint returns 200 for a live session and 401 ("Session is invalid or expired")
 * for stale/expired/invalid tokens — the signal the frontend uses to clear a stale localStorage
 * session. Auth is not weakened; x-user-id fallback is not exercised.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-secret';

const express = (await import('express')).default;
const { authorizeRole } = await import('../middleware/authMiddleware.js');
const { supabase } = await import('../db/supabase.js');

let mockState;
function resetState() {
  mockState = { sessions: {}, users: {} };
}

function chain(resolver) {
  const state = { filters: {} };
  const c = {
    select() { return c; },
    eq(k, v) { state.filters[k] = v; return c; },
    is() { return c; },
    single() { state.single = true; return c; },
    then(resolve, reject) { return Promise.resolve(resolver(state)).then(resolve, reject); },
  };
  return c;
}

supabase.from = (table) => chain((state) => {
  if (table === 'user_sessions') {
    const row = mockState.sessions[state.filters.token];
    return row ? { data: row, error: null } : { data: null, error: { message: 'no session' } };
  }
  if (table === 'users') {
    const row = mockState.users[state.filters.id];
    return row ? { data: row, error: null } : { data: null, error: { message: 'no user' } };
  }
  return { data: null, error: null };
});

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  // Mirrors server.js GET /api/auth/me.
  app.get('/api/auth/me', authorizeRole(), async (req, res) => {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, phone, role')
      .eq('id', req.userContext.id)
      .single();
    if (error || !user) return res.status(401).json({ error: 'Unauthorized. User record not found.' });
    res.json({ user });
  });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(resetState);

async function getMe(headers) {
  const res = await fetch(`${baseUrl}/api/auth/me`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const future = () => new Date(Date.now() + 3600_000).toISOString();
const past = () => new Date(Date.now() - 3600_000).toISOString();

test('returns 200 and the user for a valid live session', async () => {
  mockState.sessions['live-tok'] = { user_id: 'u1', is_valid: true, expires_at: future() };
  mockState.users['u1'] = { id: 'u1', name: 'Buyer', email: 'b@carup.test', phone: '', role: 'owner', is_verified: true };
  const { status, body } = await getMe({ 'x-session-token': 'live-tok' });
  assert.equal(status, 200);
  assert.equal(body.user.id, 'u1');
  assert.equal(body.user.role, 'owner');
});

test('returns 401 for an expired session', async () => {
  mockState.sessions['expired-tok'] = { user_id: 'u1', is_valid: true, expires_at: past() };
  const { status, body } = await getMe({ 'x-session-token': 'expired-tok' });
  assert.equal(status, 401);
  assert.match(body.error, /Session is invalid or expired/i);
});

test('returns 401 for an invalidated session (is_valid=false)', async () => {
  mockState.sessions['revoked-tok'] = { user_id: 'u1', is_valid: false, expires_at: future() };
  const { status, body } = await getMe({ 'x-session-token': 'revoked-tok' });
  assert.equal(status, 401);
  assert.match(body.error, /Session is invalid or expired/i);
});

test('returns 401 for an unknown token (no session row)', async () => {
  const { status, body } = await getMe({ 'x-session-token': 'ghost-tok' });
  assert.equal(status, 401);
  assert.match(body.error, /Session is invalid or expired/i);
});

test('returns 401 when no session token is provided', async () => {
  const { status, body } = await getMe({});
  assert.equal(status, 401);
  assert.match(body.error, /No active user context|Unauthorized/i);
});
