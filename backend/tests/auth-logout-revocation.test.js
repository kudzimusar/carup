/**
 * PC01-K1-R1 — POST /api/auth/logout revokes the CURRENT session on the server.
 *
 * Sign Out used to clear only the browser's copy of the session; the token itself stayed valid until
 * it expired, so a copied token kept working. These drive the REAL server.js app (NODE_ENV=test → no
 * app.listen, CSRF bypassed) through real /api/auth/login and /api/auth/me against an in-memory
 * store that applies EVERY filter a query names, so a revocation scoped too widely would show.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-secret';

const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { hashPassword } = await import('../utils/passwordAuth.js');

let db;
function resetDb() {
  db = { users: [], user_sessions: [], trust_audit_events: [], other: [] };
}

function matches(row, filters) {
  return Object.entries(filters).every(([k, v]) => row[k] === v);
}

function handle(op) {
  const rows = db[op.table] ?? db.other;
  if (op.action === 'insert') {
    const list = Array.isArray(op.payload) ? op.payload : [op.payload];
    for (const r of list) (db[op.table] ? rows : db.other).push(db[op.table] ? { ...r } : { table: op.table, row: r });
    return { data: op.single ? list[0] : list, error: null };
  }
  if (!db[op.table]) return { data: op.single ? null : [], error: null };
  const hit = rows.filter((r) => matches(r, op.filters));
  if (op.action === 'update') {
    for (const r of hit) Object.assign(r, op.payload);
    return { data: op.single ? hit[0] ?? null : hit.map((r) => ({ ...r })), error: null };
  }
  if (op.single) {
    return hit[0]
      ? { data: { ...hit[0] }, error: null }
      : (op.maybe ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
  }
  return { data: hit.map((r) => ({ ...r })), error: null };
}

function installStore() {
  supabase.from = (table) => {
    const op = { table, action: 'select', filters: {}, payload: null, single: false, maybe: false };
    const chain = {
      select() { return chain; },
      insert(p) { op.action = 'insert'; op.payload = p; return chain; },
      update(p) { op.action = 'update'; op.payload = p; return chain; },
      delete() { op.action = 'delete'; return chain; },
      eq(k, v) { op.filters[k] = v; return chain; },
      in() { return chain; }, is() { return chain; }, gt() { return chain; }, gte() { return chain; },
      lt() { return chain; }, order() { return chain; }, limit() { return chain; }, range() { return chain; },
      maybeSingle() { op.single = true; op.maybe = true; return chain; },
      single() { op.single = true; return chain; },
      then(onF, onR) { return Promise.resolve(handle(op)).then(onF, onR); },
    };
    return chain;
  };
  supabase.rpc = async () => ({ data: null, error: null });
}

let server;
let baseUrl;
before(async () => {
  installStore();
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

const H = { 'Content-Type': 'application/json', 'x-bypass-rate-limit': 'true' };
async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...H, ...(token ? { 'x-session-token': token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const me = (token) => call('GET', '/api/auth/me', { token });
const logout = (token, extra = {}) => call('POST', '/api/auth/logout', { token, body: {}, ...extra });

async function seedUser(id, role = 'admin') {
  db.users.push({ id, name: id, email: `${id}@carup.test`, phone: '', role, is_verified: true, password_hash: await hashPassword('correct horse 123') });
}
async function login(id) {
  const res = await call('POST', '/api/auth/login', { body: { email: `${id}@carup.test`, password: 'correct horse 123' } });
  assert.equal(res.status, 200, `login ${id}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.token);
  return res.body.token;
}
const sessionOf = (token) => db.user_sessions.find((s) => s.token === token);

test('A — login creates a session; logout with it ends it, and the same token is then refused', async () => {
  await seedUser('u-admin');
  const tokenA = await login('u-admin');
  assert.equal((await me(tokenA)).status, 200);

  const out = await logout(tokenA);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { success: true, revoked: true });
  assert.ok(!JSON.stringify(out.body).includes(tokenA), 'the response carries no token');

  assert.equal(sessionOf(tokenA).is_valid, false, 'the row is kept and marked invalid, not deleted');
  const after = await me(tokenA);
  assert.equal(after.status, 401);
  assert.match(after.body.error, /Session is invalid or expired/);
});

test('B — the same person on two devices: logging out on A leaves B signed in', async () => {
  await seedUser('u-two');
  const tokenA = await login('u-two');
  const tokenB = await login('u-two');
  assert.notEqual(tokenA, tokenB);

  assert.equal((await logout(tokenA)).status, 200);
  assert.equal((await me(tokenA)).status, 401);
  assert.equal((await me(tokenB)).status, 200);
  assert.equal(sessionOf(tokenB).is_valid, true);
});

test('C — nothing in the request body can aim the revocation at another session or person', async () => {
  await seedUser('u-attacker', 'owner');
  await seedUser('u-victim');
  const attacker = await login('u-attacker');
  const victim = await login('u-victim');
  const victimSecond = await login('u-victim');

  const out = await call('POST', '/api/auth/logout', {
    token: attacker,
    body: { userId: 'u-victim', user_id: 'u-victim', token: victim, sessionToken: victim, role: 'admin' },
    headers: { 'x-user-id': 'u-victim', 'x-stakeholder-role': 'owner' },
  });
  assert.equal(out.status, 200);
  assert.equal(sessionOf(attacker).is_valid, false, 'only the authenticating session ended');
  assert.equal(sessionOf(victim).is_valid, true);
  assert.equal(sessionOf(victimSecond).is_valid, true);
  assert.equal((await me(victim)).status, 200);
});

test('C — an asserted identity without a session can revoke nothing', async () => {
  await seedUser('u-victim');
  const victim = await login('u-victim');
  const res = await call('POST', '/api/auth/logout', { body: { token: victim }, headers: { 'x-user-id': 'u-victim' } });
  assert.equal(res.status, 401);
  assert.equal(sessionOf(victim).is_valid, true);
});

test('D — a repeated, stale or expired logout fails safely and changes nothing', async () => {
  await seedUser('u-rep');
  const tokenA = await login('u-rep');
  const tokenB = await login('u-rep');
  assert.equal((await logout(tokenA)).status, 200);
  const snapshot = JSON.stringify(db.user_sessions);

  const again = await logout(tokenA);
  assert.equal(again.status, 401, 'a session that already ended cannot authenticate its own logout');
  assert.equal(JSON.stringify(db.user_sessions), snapshot, 'no row changed — nothing revived, nothing else ended');

  sessionOf(tokenB).expires_at = new Date(Date.now() - 60_000).toISOString();
  const expired = await logout(tokenB);
  assert.equal(expired.status, 401);
  assert.equal(sessionOf(tokenB).is_valid, true, 'an expired session is refused, not rewritten');

  assert.equal((await logout('never-issued-token')).status, 401);
});

test('E — the logout is audited without the token, and nothing logs the token', async () => {
  await seedUser('u-audit');
  const token = await login('u-audit');
  const captured = [];
  const originals = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[level] = console[level];
    console[level] = (...args) => { captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  }
  let res;
  try {
    res = await logout(token);
  } finally {
    for (const [level, fn] of Object.entries(originals)) console[level] = fn;
  }
  assert.equal(res.status, 200);
  const event = db.trust_audit_events.find((e) => e.event_type === 'SESSION_LOGOUT');
  assert.ok(event, 'a SESSION_LOGOUT audit event is recorded');
  assert.equal(event.actor_user_id, 'u-audit');
  assert.equal(event.source_route, '/api/auth/logout');
  const everything = JSON.stringify(db.trust_audit_events) + JSON.stringify(db.other) + captured.join('\n');
  assert.ok(!everything.includes(token), 'the session token appears in no audit row and no log line');
});
