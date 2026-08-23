/**
 * Integration tests for the user_sessions auth-contract alignment migration
 * (database/migrations/20260617120000_user_sessions_auth_contract_align.sql).
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-secret';

const express = (await import('express')).default;
const { authorizeRole } = await import('../middleware/authMiddleware.js');
const { supabase } = await import('../db/supabase.js');
const { buildSessionRow } = await import('../services/auth/sessionRow.js');
const { extractSupabaseRef, assertStagingTarget } = await import('../../scripts/provision-staging-qa-accounts.mjs');

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION_PATH = 'database/migrations/20260617120000_user_sessions_auth_contract_align.sql';
const MIGRATION = readFileSync(resolve(REPO_ROOT, MIGRATION_PATH), 'utf8');
const STAGING_LEGACY_COLUMNS = ['id', 'user_id', 'active_role', 'active_organization_id', 'created_at', 'expires_at', 'ip_address', 'user_agent'];
const MIGRATION_ADDED_COLUMNS = ['token', 'is_valid'];
const POST_MIGRATION_COLUMNS = [...STAGING_LEGACY_COLUMNS, ...MIGRATION_ADDED_COLUMNS];
const future = () => new Date(Date.now() + 3600_000).toISOString();
const past = () => new Date(Date.now() - 3600_000).toISOString();

test('migration adds token + is_valid + a unique token index, idempotently and non-destructively', () => {
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS token TEXT/i);
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS is_valid BOOLEAN/i);
  assert.match(MIGRATION, /CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_token/i);
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS public\.user_sessions/i);
  assert.match(MIGRATION, /ROLLBACK/i);
  assert.equal(/DROP TABLE/i.test(MIGRATION), false);
});

test('migration is production-safe: no prod project ref, no hardcoded connection string', () => {
  assert.equal(/vhmnajoeicasaigiophh/.test(MIGRATION), false);
  assert.equal(/postgres(ql)?:\/\//.test(MIGRATION), false);
});

test('every column buildSessionRow writes exists after the migration; token + is_valid were the gap', () => {
  const written = Object.keys(buildSessionRow({ userId: 'u1', activeRole: 'owner', token: 'sk_live_x', expiresAt: future() }));
  for (const column of written) {
    assert.ok(POST_MIGRATION_COLUMNS.includes(column), `buildSessionRow writes '${column}' not in the post-migration schema`);
  }
  for (const column of MIGRATION_ADDED_COLUMNS) {
    assert.equal(STAGING_LEGACY_COLUMNS.includes(column), false);
    assert.ok(written.includes(column));
  }
});

const schemaEnforcingInsert = (columns) => (row) => {
  const bad = Object.keys(row).filter((key) => !columns.includes(key));
  if (bad.length) return { data: null, error: { code: '42703', message: `column "${bad[0]}" of relation "user_sessions" does not exist` } };
  return { data: row, error: null };
};

test('pre-migration schema rejects the login insert; post-migration accepts it', () => {
  const row = buildSessionRow({ userId: 'u1', activeRole: 'owner', token: 't', expiresAt: future() });
  assert.ok(schemaEnforcingInsert(STAGING_LEGACY_COLUMNS)(row).error);
  assert.equal(schemaEnforcingInsert(POST_MIGRATION_COLUMNS)(row).error, null);
});

let store;
function resolveOp(op) {
  if (op.table === 'user_sessions') {
    if (op.action === 'insert') {
      const row = op.payload;
      const bad = Object.keys(row).filter((key) => !POST_MIGRATION_COLUMNS.includes(key));
      if (bad.length) return { data: null, error: { code: '42703', message: `column "${bad[0]}" does not exist` } };
      store.sessions[row.token] = { ...row };
      return { data: op.single ? row : [row], error: null };
    }
    if (op.action === 'update') {
      const session = store.sessions[op.filters.token];
      if (session) Object.assign(session, op.payload);
      return { data: session || null, error: null };
    }
    const session = store.sessions[op.filters.token];
    return session ? { data: session, error: null } : { data: null, error: { message: 'no session' } };
  }
  if (op.table === 'users') {
    const user = store.users[op.filters.id];
    return user ? { data: user, error: null } : { data: null, error: { message: 'no user' } };
  }
  if (op.table === 'tenant_users') {
    const row = store.tenantUsers.find((item) =>
      item.user_id === op.filters.user_id && item.tenant_id === op.filters.tenant_id);
    return row ? { data: row, error: null } : { data: null, error: { message: 'no membership' } };
  }
  return { data: null, error: null };
}

let server;
let baseUrl;

before(async () => {
  supabase.from = (table) => {
    const op = { table, action: 'select', filters: {}, payload: null, single: false };
    const chain = {
      select() { return chain; },
      insert(payload) { op.action = 'insert'; op.payload = payload; return chain; },
      update(payload) { op.action = 'update'; op.payload = payload; return chain; },
      eq(key, value) { op.filters[key] = value; return chain; },
      is() { return chain; },
      single() { op.single = true; return chain; },
      then(onFulfilled, onRejected) { return Promise.resolve(resolveOp(op)).then(onFulfilled, onRejected); },
    };
    return chain;
  };
  const app = express();
  app.use(express.json());
  app.get('/api/auth/me', authorizeRole(), async (req, res) => {
    const { data: user, error } = await supabase.from('users').select('id, name, email, phone, role').eq('id', req.userContext.id).single();
    if (error || !user) return res.status(401).json({ error: 'Unauthorized. User record not found.' });
    return res.json({
      user: {
        ...user,
        role: req.userContext.role,
        active_tenant_id: req.userContext.tenantId || null,
      },
    });
  });
  await new Promise((resolveListen) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolveListen); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { if (server) await new Promise((resolveClose) => server.close(resolveClose)); });

beforeEach(() => {
  store = {
    sessions: {},
    users: { u1: { id: 'u1', name: 'Buyer', email: 'b@carup.test', phone: '', role: 'owner', is_verified: true } },
    tenantUsers: [{ user_id: 'u1', tenant_id: 'tenant-1', role: 'dealer' }],
  };
});

const getMe = async (headers) => {
  const response = await fetch(`${baseUrl}/api/auth/me`, { headers });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

test('login persists a session and the returned token exists in user_sessions', async () => {
  const token = 'sk_live_persist';
  const { error } = await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'owner', token, expiresAt: future() }));
  assert.equal(error, null);
  assert.ok(store.sessions[token]);
  assert.equal(store.sessions[token].is_valid, true);
});

test('/api/auth/me accepts the returned token', async () => {
  const token = 'sk_live_me';
  await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'owner', token, expiresAt: future() }));
  const { status, body } = await getMe({ 'x-session-token': token });
  assert.equal(status, 200);
  assert.equal(body.user.id, 'u1');
  assert.equal(body.user.role, 'owner');
});

test('/api/auth/me recovers the switched role and tenant from the token without client role headers', async () => {
  const token = 'sk_live_switched_context';
  await supabase.from('user_sessions').insert(buildSessionRow({
    userId: 'u1',
    activeRole: 'dealer',
    token,
    expiresAt: future(),
    tenantId: 'tenant-1',
  }));
  const { status, body } = await getMe({ 'x-session-token': token });
  assert.equal(status, 200);
  assert.equal(body.user.role, 'dealer');
  assert.equal(body.user.active_tenant_id, 'tenant-1');
});

test('a token rejects role and tenant headers that conflict with its active context', async () => {
  const token = 'sk_live_conflict';
  await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'owner', token, expiresAt: future() }));
  assert.equal((await getMe({ 'x-session-token': token, 'x-stakeholder-role': 'admin' })).status, 403);
  assert.equal((await getMe({ 'x-session-token': token, 'x-tenant-id': 'tenant-1' })).status, 403);
});

test('expired, invalidated, and unknown tokens are rejected', async () => {
  await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'owner', token: 'expired', expiresAt: past() }));
  assert.equal((await getMe({ 'x-session-token': 'expired' })).status, 401);
  const live = 'logout-token';
  await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'owner', token: live, expiresAt: future() }));
  assert.equal((await getMe({ 'x-session-token': live })).status, 200);
  await supabase.from('user_sessions').update({ is_valid: false }).eq('token', live);
  assert.equal((await getMe({ 'x-session-token': live })).status, 401);
  assert.equal((await getMe({ 'x-session-token': 'ghost' })).status, 401);
});

test('role-switch session creation writes token, active role, and tenant', async () => {
  const token = 'sk_live_switch';
  const { error } = await supabase.from('user_sessions').insert(buildSessionRow({
    userId: 'u1', activeRole: 'dealer', token, expiresAt: future(), tenantId: 'tenant-1',
  }));
  assert.equal(error, null);
  assert.equal(store.sessions[token].active_role, 'dealer');
  assert.equal(store.sessions[token].active_organization_id, 'tenant-1');
});

test('production is not touched — live DB guard refuses the production project ref', () => {
  assert.throws(
    () => assertStagingTarget(extractSupabaseRef('postgresql://postgres.vhmnajoeicasaigiophh:x@h.pooler.supabase.com:5432/postgres')),
    /PRODUCTION/i,
  );
});

test('live user_sessions contract (opt-in; STAGING only)', async (t) => {
  if (process.env.RUN_LIVE_SESSION_DB_CHECK !== '1') return t.skip('set RUN_LIVE_SESSION_DB_CHECK=1 with a STAGING SUPABASE_DB_URL');
  const url = process.env.SUPABASE_DB_URL;
  assert.ok(url);
  assertStagingTarget(extractSupabaseRef(url));
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const columns = await client.query("select column_name from information_schema.columns where table_schema='public' and table_name='user_sessions'");
    const names = columns.rows.map((row) => row.column_name);
    for (const column of MIGRATION_ADDED_COLUMNS) assert.ok(names.includes(column));
    const index = await client.query("select indexname from pg_indexes where tablename='user_sessions' and indexname='uq_user_sessions_token'");
    assert.ok(index.rows.length);
  } finally {
    await client.end();
  }
});
