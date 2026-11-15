/**
 * TI-10 — sign-out through the REAL server.js application stack.
 *
 * The router-level suite (auth-session-logout.test.js) mounts the session router on a bare express
 * app, so it cannot see the global middleware a production request crosses first. This file drives
 * the REAL exported `app` from server.js — its real CORS, rate limiter, body parsers, the real global
 * `csrfMiddleware`, the real GET /api/security/csrf-token issuer, the real mount of the auth batch
 * that hosts POST /api/auth/logout, and real protected routes — against an in-memory Supabase.
 *
 * It proves over HTTP:
 *   A. logout WITHOUT a valid CSRF token (missing, forged, bound to another session, cookie/header
 *      mismatch) is refused 403 by the composed stack and revokes nothing;
 *   B. logout WITH a valid, session-bound CSRF token succeeds and revokes ONLY the presenting session;
 *   C. token replay is refused SERVER-SIDE: after logout, the very same token the client might still
 *      hold is rejected by protected routes (GET /api/auth/me, POST /api/auth/switch-role) and by a
 *      second logout — while the account's other session keeps working;
 *   D. the same CSRF refusal holds with NODE_ENV=production, i.e. without the test-mode bypass and
 *      without the `x-verify-csrf` opt-in header.
 *
 * Under NODE_ENV=test the real csrfMiddleware bypasses itself unless the request carries
 * `x-verify-csrf: true`; A–C send that header so the production code path runs. D removes the
 * bypass altogether. Mutation check (recorded in the PR evidence): deleting `app.use(csrfMiddleware)`
 * from server.js turns A and D red.
 *
 * Tokens and identities below are fictional test strings; no credential material is printed.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { generateCsrfToken } = await import('../middleware/securityMiddleware.js');

const FUTURE = '2027-12-31T00:00:00.000Z';
const TOKEN_A1 = 'ti10-composed-token-a-1';
const TOKEN_A2 = 'ti10-composed-token-a-2';
const TOKEN_B1 = 'ti10-composed-token-b-1';

let db;
function resetDb() {
  db = {
    user_sessions: [
      { id: 'session-a-1', token: TOKEN_A1, user_id: 'user-a', is_valid: true, expires_at: FUTURE },
      { id: 'session-a-2', token: TOKEN_A2, user_id: 'user-a', is_valid: true, expires_at: FUTURE },
      { id: 'session-b-1', token: TOKEN_B1, user_id: 'user-b', is_valid: true, expires_at: FUTURE },
    ],
    users: [
      { id: 'user-a', name: 'Fictional Owner A', email: 'owner-a@example.invalid', phone: '', role: 'owner', is_verified: true },
      { id: 'user-b', name: 'Fictional Owner B', email: 'owner-b@example.invalid', phone: '', role: 'owner', is_verified: true },
    ],
    trust_audit_events: [],
  };
}

/** Minimal PostgREST-shaped builder: equality filters, single/maybeSingle, insert/update/delete. */
function builder(table) {
  const state = { op: 'select', filters: {}, payload: null, single: false, maybe: false };
  const run = () => {
    const rows = (db[table] = db[table] || []);
    const match = (row) => Object.entries(state.filters).every(([k, v]) => row[k] === v);
    if (state.op === 'insert') {
      const payloads = Array.isArray(state.payload) ? state.payload : [state.payload];
      rows.push(...payloads.map((p) => ({ ...p })));
      return { data: state.single ? payloads[0] : payloads, error: null };
    }
    if (state.op === 'update') {
      const affected = rows.filter(match);
      for (const row of affected) Object.assign(row, state.payload);
      return { data: state.single ? affected[0] ?? null : affected, error: null };
    }
    if (state.op === 'delete') {
      db[table] = rows.filter((row) => !match(row));
      return { data: null, error: null };
    }
    const found = rows.filter(match);
    if (state.single) {
      if (found.length > 0) return { data: found[0], error: null };
      return state.maybe ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    return { data: found, error: null };
  };
  const handlers = {
    insert: (p) => { state.op = 'insert'; state.payload = p; },
    upsert: (p) => { state.op = 'insert'; state.payload = p; },
    update: (p) => { state.op = 'update'; state.payload = p; },
    delete: () => { state.op = 'delete'; },
    eq: (k, v) => { state.filters[k] = v; },
    single: () => { state.single = true; },
    maybeSingle: () => { state.single = true; state.maybe = true; },
  };
  const chain = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return (onF, onR) => Promise.resolve().then(run).then(onF, onR);
      if (typeof prop !== 'string') return undefined;
      // Any other modifier (select, in, is, order, limit, …) narrows nothing in this fixture.
      return (...args) => { handlers[prop]?.(...args); return chain; };
    },
  });
  return chain;
}

let server;
let baseUrl;

before(async () => {
  supabase.from = (table) => builder(table);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });
beforeEach(resetDb);

const session = (id) => db.user_sessions.find((s) => s.id === id);
const revocationAudits = () => db.trust_audit_events.filter((e) => e.event_type === 'USER_SESSION_REVOKED');

/** `x-verify-csrf: true` switches the real csrfMiddleware from its test-mode bypass to enforcement. */
const ENFORCE = { 'x-verify-csrf': 'true', 'x-bypass-rate-limit': 'true' };

async function request(method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Obtain a CSRF token exactly as the web client does: from the real issuer, with the same identity headers. */
async function csrfFor(sessionToken, extra = {}) {
  const res = await request('GET', '/api/security/csrf-token', { headers: { ...extra, 'x-session-token': sessionToken } });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.csrfToken, 'string');
  return res.body.csrfToken;
}

const logout = (sessionToken, csrfHeaders = {}, extra = ENFORCE) =>
  request('POST', '/api/auth/logout', { headers: { ...extra, 'x-session-token': sessionToken, ...csrfHeaders } });
const me = (sessionToken) =>
  request('GET', '/api/auth/me', { headers: { 'x-bypass-rate-limit': 'true', 'x-session-token': sessionToken } });

function assertNothingRevoked() {
  for (const id of ['session-a-1', 'session-a-2', 'session-b-1']) assert.equal(session(id).is_valid, true, `${id} untouched`);
  assert.equal(revocationAudits().length, 0, 'no revocation was audited');
}

// --- A. CSRF is enforced on logout by the composed stack ---------------------------------------

test('composed stack: logout without a CSRF token is refused 403 and revokes nothing', async () => {
  const res = await logout(TOKEN_A1);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /CSRF/i);
  assertNothingRevoked();
  assert.equal((await me(TOKEN_A1)).status, 200, 'the session still answers — the refusal did not revoke it');
});

test('composed stack: a forged, foreign-bound or mismatched CSRF token is refused 403 and revokes nothing', async () => {
  const forged = await logout(TOKEN_A1, { 'x-csrf-token': 'forged.0000' });
  assert.equal(forged.status, 403, 'a forged token is refused');

  // A genuine token, but issued to ANOTHER session: replaying it against session a-1 must fail.
  const foreign = await csrfFor(TOKEN_B1);
  const crossSession = await logout(TOKEN_A1, { 'x-csrf-token': foreign });
  assert.equal(crossSession.status, 403, 'a token bound to another session is refused');

  // A genuine token for this session, but the double-submit cookie disagrees with the header.
  const valid = await csrfFor(TOKEN_A1);
  const mismatched = await logout(TOKEN_A1, { 'x-csrf-token': valid, cookie: `csrf-token=${encodeURIComponent(foreign)}` });
  assert.equal(mismatched.status, 403, 'a cookie/header mismatch is refused');

  // A token signed with a different secret (an attacker without JWT_SECRET) is refused.
  const savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'ti10-attacker-guess';
  const wrongSecret = generateCsrfToken('guest', TOKEN_A1);
  if (savedSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = savedSecret;
  const resigned = await logout(TOKEN_A1, { 'x-csrf-token': wrongSecret });
  assert.equal(resigned.status, 403, 'a token signed with the wrong secret is refused');

  assertNothingRevoked();
});

// --- B. A valid CSRF token signs out and revokes only the presenting session --------------------

test('composed stack: a valid session-bound CSRF token signs out and revokes ONLY the presenting session', async () => {
  const csrf = await csrfFor(TOKEN_A1);
  const res = await logout(TOKEN_A1, { 'x-csrf-token': csrf });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true });
  assert.equal(session('session-a-1').is_valid, false, 'the presenting session is revoked server-side');
  assert.equal(session('session-a-2').is_valid, true, "the account's other session survives");
  assert.equal(session('session-b-1').is_valid, true, "another account's session survives");
  assert.equal(revocationAudits().length, 1);
  assert.deepEqual(revocationAudits()[0].new_value.revoked_session_ids, ['session-a-1']);
});

// --- C. Token replay is refused by the SERVER, independent of client-side deletion ---------------

test('replay: after logout the SAME token the client still holds is rejected by protected routes', async () => {
  // Precondition: the token works on protected routes before sign-out (so a later 401 is revocation).
  assert.equal((await me(TOKEN_A1)).status, 200);

  const csrf = await csrfFor(TOKEN_A1);
  assert.equal((await logout(TOKEN_A1, { 'x-csrf-token': csrf })).status, 200);

  // The "client" below never deleted anything: it re-presents the exact token it was holding.
  const meReplay = await me(TOKEN_A1);
  assert.equal(meReplay.status, 401, 'GET /api/auth/me refuses the revoked token');
  assert.equal(meReplay.body?.user, undefined, 'no account data is returned for a revoked token');

  const switchReplay = await request('POST', '/api/auth/switch-role', {
    headers: { ...ENFORCE, 'x-session-token': TOKEN_A1, 'x-csrf-token': await csrfFor(TOKEN_A1) },
    body: { role: 'owner' },
  });
  assert.equal(switchReplay.status, 401, 'a state-changing protected route refuses the revoked token (CSRF passed, auth did not)');

  const logoutReplay = await logout(TOKEN_A1, { 'x-csrf-token': await csrfFor(TOKEN_A1) });
  assert.equal(logoutReplay.status, 401, 'a second logout with the revoked token is refused');

  // The x-user-id fallback cannot resurrect a revoked session either (test mode keeps it enabled).
  const withFallback = await request('GET', '/api/auth/me', {
    headers: { 'x-bypass-rate-limit': 'true', 'x-session-token': TOKEN_A1, 'x-user-id': 'user-a' },
  });
  assert.equal(withFallback.status, 401, 'a presented-but-revoked token is refused even alongside x-user-id');

  // Server-side, not client-side: the account's other session is still fully usable.
  assert.equal((await me(TOKEN_A2)).status, 200);
  assert.equal(session('session-a-1').is_valid, false);
});

// --- D. Production mode: no test bypass, no opt-in header --------------------------------------

test('NODE_ENV=production: the composed stack enforces CSRF on logout without any test opt-in', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET };
  process.env.NODE_ENV = 'production';
  // Production refuses to sign CSRF tokens without a secret; use a fictional test-only value.
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'ti10-test-only-jwt-secret';
  try {
    const refused = await logout(TOKEN_A1, {}, {});
    assert.equal(refused.status, 403, 'no CSRF token → refused, with no x-verify-csrf header involved');
    assertNothingRevoked();

    const csrf = await csrfFor(TOKEN_A1);
    const accepted = await logout(TOKEN_A1, { 'x-csrf-token': csrf }, {});
    assert.equal(accepted.status, 200);
    assert.equal(session('session-a-1').is_valid, false);
    assert.equal((await me(TOKEN_A1)).status, 401, 'and the revoked token is refused afterwards');
  } finally {
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.JWT_SECRET === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = saved.JWT_SECRET;
  }
});
