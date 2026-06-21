/**
 * Security regression tests for the public-registration privilege-escalation fix.
 *
 * Drives the REAL server.js app (NODE_ENV=test → no app.listen, CSRF bypassed) against an in-memory
 * Supabase mock. Proves POST /api/auth/register can never create a privileged account: it always
 * assigns 'owner', rejects any other role before any user/session row is written, and ignores
 * elevation headers — while ordinary owner registration, sessions, /api/auth/me, existing admin
 * login, and governed admin role-switch all keep working.
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

let store;
function resetStore() {
  store = { users: [], sessions: {}, misc: [] };
}

function handle(op) {
  const t = op.table;
  if (t === 'users') {
    if (op.action === 'insert') {
      const row = Array.isArray(op.payload) ? op.payload[0] : op.payload;
      if (store.users.some((u) => u.email === row.email)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "users_email_key"' } };
      }
      store.users.push({ ...row });
      return { data: op.single ? row : [row], error: null };
    }
    if (op.action === 'update') {
      const u = store.users.find((x) => (op.filters.id ? x.id === op.filters.id : x.email === op.filters.email));
      if (u) Object.assign(u, op.payload);
      return { data: u || null, error: null };
    }
    const u = store.users.find((x) =>
      ('email' in op.filters ? x.email === op.filters.email : true) && ('id' in op.filters ? x.id === op.filters.id : true));
    return u ? { data: u, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
  }
  if (t === 'user_sessions') {
    if (op.action === 'insert') {
      const row = Array.isArray(op.payload) ? op.payload[0] : op.payload;
      store.sessions[row.token] = { ...row };
      return { data: op.single ? row : [row], error: null };
    }
    const s = store.sessions[op.filters.token];
    return s ? { data: s, error: null } : { data: null, error: { message: 'no session' } };
  }
  if (t === 'tenant_users') {
    return { data: null, error: { message: 'no tenant membership' } }; // switch-role tenant path: none
  }
  // login_attempts, audit/trust_audit events, anything else — accept writes, return empty reads.
  if (op.action === 'insert') { store.misc.push({ table: t, row: op.payload }); return { data: null, error: null }; }
  return { data: null, error: null };
}

function installMock() {
  supabase.from = (table) => {
    const op = { table, action: 'select', filters: {}, payload: null, single: false };
    const chain = {
      select() { return chain; },
      insert(p) { op.action = 'insert'; op.payload = p; return chain; },
      update(p) { op.action = 'update'; op.payload = p; return chain; },
      delete() { op.action = 'delete'; return chain; },
      eq(k, v) { op.filters[k] = v; return chain; },
      in() { return chain; },
      is() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { op.single = true; return chain; },
      single() { op.single = true; return chain; },
      then(onF, onR) { return Promise.resolve(handle(op)).then(onF, onR); },
    };
    return chain;
  };
}

let server;
let baseUrl;
const PRIVILEGED_ROLES = ['admin', 'government', 'bank', 'insurance', 'dealer', 'mechanic'];

before(async () => {
  installMock();
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetStore);

const H = { 'Content-Type': 'application/json', 'x-bypass-rate-limit': 'true' };
async function post(path, body, extraHeaders = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { ...H, ...extraHeaders }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function getMe(token) {
  const res = await fetch(`${baseUrl}/api/auth/me`, { headers: { ...H, 'x-session-token': token } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('omitted role creates an owner', async () => {
  const { status, body } = await post('/api/auth/register', { name: 'No Role', email: 'norole@x.test', password: 'password123' });
  assert.equal(status, 200);
  assert.equal(body.user.role, 'owner');
  assert.equal(store.users[0].role, 'owner');
});

test('explicit role=owner creates an owner', async () => {
  const { status, body } = await post('/api/auth/register', { name: 'Owner', email: 'owner@x.test', password: 'password123', role: 'owner' });
  assert.equal(status, 200);
  assert.equal(body.user.role, 'owner');
  assert.equal(store.users[0].role, 'owner');
});

test('every privileged role is rejected and creates NO user and NO session', async () => {
  for (const role of PRIVILEGED_ROLES) {
    const { status } = await post('/api/auth/register', { name: 'X', email: `${role}@x.test`, password: 'password123', role });
    assert.ok(status === 403 || status === 400, `role '${role}' should be rejected, got ${status}`);
    assert.equal(store.users.length, 0, `no user row should exist after rejecting '${role}'`);
    assert.equal(Object.keys(store.sessions).length, 0, `no session row should exist after rejecting '${role}'`);
  }
});

test('an unknown role is rejected and creates nothing', async () => {
  const { status } = await post('/api/auth/register', { name: 'X', email: 'wiz@x.test', password: 'password123', role: 'wizard' });
  assert.ok(status === 403 || status === 400);
  assert.equal(store.users.length, 0);
  assert.equal(Object.keys(store.sessions).length, 0);
});

test('tenant / stakeholder headers cannot elevate registration', async () => {
  // Even with privileged elevation headers, an omitted role still yields owner...
  const ok = await post('/api/auth/register', { name: 'Hdr', email: 'hdr@x.test', password: 'password123' },
    { 'x-stakeholder-role': 'admin', 'x-tenant-id': 't1', 'x-user-id': 'someone' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, 'owner');
  // ...and a body role=admin is still rejected regardless of headers.
  resetStore();
  const bad = await post('/api/auth/register', { name: 'Hdr2', email: 'hdr2@x.test', password: 'password123', role: 'admin' },
    { 'x-stakeholder-role': 'admin', 'x-tenant-id': 't1' });
  assert.ok(bad.status === 403 || bad.status === 400);
  assert.equal(store.users.length, 0);
});

test('successful owner registration persists a session whose token works with /api/auth/me', async () => {
  const reg = await post('/api/auth/register', { name: 'Buyer', email: 'buyer@x.test', password: 'password123' });
  assert.equal(reg.status, 200);
  const token = reg.body.token;
  assert.ok(token && store.sessions[token], 'a session row was persisted for the returned token');
  const me = await getMe(token);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'buyer@x.test');
  assert.equal(me.body.user.role, 'owner');
});

test('existing admin login remains functional (governed admin provisioned out-of-band)', async () => {
  // Admin created through a governed path (NOT the public register route).
  store.users.push({ id: 'u_admin', name: 'Admin', email: 'admin@x.test', phone: '', role: 'admin', is_verified: true, password_hash: await hashPassword('adminpass123') });
  const login = await post('/api/auth/login', { email: 'admin@x.test', password: 'adminpass123' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'admin');
  const me = await getMe(login.body.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'admin');
});

test('governed admin role-switch still works for a real admin (outside the public route)', async () => {
  store.users.push({ id: 'u_admin2', name: 'Admin2', email: 'admin2@x.test', phone: '', role: 'admin', is_verified: true, password_hash: await hashPassword('adminpass123') });
  const login = await post('/api/auth/login', { email: 'admin2@x.test', password: 'adminpass123' });
  assert.equal(login.status, 200);
  const sw = await post('/api/auth/switch-role', { userId: 'u_admin2', role: 'admin' }, { 'x-session-token': login.body.token });
  assert.equal(sw.status, 200);
  assert.equal(sw.body.user.role, 'admin');
});
