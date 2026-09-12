/**
 * Integration tests for the user_sessions auth-contract alignment migration
 * (database/migrations/20260617120000_user_sessions_auth_contract_align.sql).
 *
 * Reproduces the staging blocker (login 500 because user_sessions lacks token/is_valid), proves the
 * migration closes the drift, and exercises the REAL authMiddleware over a post-migration-shaped
 * store: login persists a session, the token is found, /api/auth/me accepts it, invalid/expired
 * tokens are rejected, logout invalidates, and role-switch session creation still works.
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
// O2-X3 extends the same contract: buildSessionRow now also writes auth_method, added by the
// assurance migration. The contract this suite holds is "schema ⊇ every column buildSessionRow
// writes", so the authoritative schema here is BOTH migrations applied in order.
const ASSURANCE_MIGRATION_PATH = 'database/migrations/20260903201000_user_sessions_authentication_assurance.sql';
const ASSURANCE_MIGRATION = readFileSync(resolve(REPO_ROOT, ASSURANCE_MIGRATION_PATH), 'utf8');

// The columns observed on the staging user_sessions table, and the ones the migrations add.
const STAGING_LEGACY_COLUMNS = ['id', 'user_id', 'active_role', 'active_organization_id', 'created_at', 'expires_at', 'ip_address', 'user_agent'];
const MIGRATION_ADDED_COLUMNS = ['token', 'is_valid'];
const ASSURANCE_ADDED_COLUMNS = ['auth_method', 'step_up_at', 'step_up_method'];
const POST_MIGRATION_COLUMNS = [...STAGING_LEGACY_COLUMNS, ...MIGRATION_ADDED_COLUMNS, ...ASSURANCE_ADDED_COLUMNS];

const future = () => new Date(Date.now() + 3600_000).toISOString();
const past = () => new Date(Date.now() - 3600_000).toISOString();

// ---- static migration guarantees ----
test('migration adds token + is_valid + a unique token index, idempotently and non-destructively', () => {
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS token TEXT/i);
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS is_valid BOOLEAN/i);
  assert.match(MIGRATION, /CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_token/i);
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS public\.user_sessions/i);
  assert.match(MIGRATION, /ROLLBACK/i);
  // Non-destructive: never rebuilds the table.
  assert.equal(/DROP TABLE/i.test(MIGRATION), false);
});

test('migration is production-safe: no prod project ref, no hardcoded connection string', () => {
  assert.equal(/vhmnajoeicasaigiophh/.test(MIGRATION), false);
  assert.equal(/postgres(ql)?:\/\//.test(MIGRATION), false);
});

// ---- contract: the drift covers exactly the columns the backend writes ----
test('every column buildSessionRow writes exists after the migration; token + is_valid were the gap', () => {
  const written = Object.keys(buildSessionRow({ userId: 'u1', activeRole: 'owner', token: 'sk_live_x', expiresAt: future() }));
  for (const col of written) {
    assert.ok(POST_MIGRATION_COLUMNS.includes(col), `buildSessionRow writes '${col}' not in the post-migration schema`);
  }
  for (const col of MIGRATION_ADDED_COLUMNS) {
    assert.equal(STAGING_LEGACY_COLUMNS.includes(col), false, `${col} should have been missing pre-migration`);
    assert.ok(written.includes(col), `buildSessionRow must write '${col}'`);
  }
});

// ---- before/after: reproduce the 500, prove the fix ----
const schemaEnforcingInsert = (columns) => (row) => {
  const bad = Object.keys(row).filter((k) => !columns.includes(k));
  if (bad.length) return { data: null, error: { code: '42703', message: `column "${bad[0]}" of relation "user_sessions" does not exist` } };
  return { data: row, error: null };
};

test('pre-migration schema rejects the login insert (reproduces the 500); post-migration accepts it', () => {
  const row = buildSessionRow({ userId: 'u1', activeRole: 'owner', token: 't', expiresAt: future() });
  const before = schemaEnforcingInsert(STAGING_LEGACY_COLUMNS)(row);
  assert.ok(before.error, 'pre-migration insert should fail');
  assert.match(before.error.message, /does not exist/);
  const afterFix = schemaEnforcingInsert(POST_MIGRATION_COLUMNS)(row);
  assert.equal(afterFix.error, null);
});

// ---- behavioral: real authMiddleware over a post-migration-shaped Supabase mock ----
let store;
function resolveOp(op) {
  if (op.table === 'user_sessions') {
    if (op.action === 'insert') {
      const row = op.payload;
      const bad = Object.keys(row).filter((k) => !POST_MIGRATION_COLUMNS.includes(k));
      if (bad.length) return { data: null, error: { code: '42703', message: `column "${bad[0]}" does not exist` } };
      store.sessions[row.token] = { ...row };
      return { data: op.single ? row : [row], error: null };
    }
    if (op.action === 'update') {
      const s = store.sessions[op.filters.token];
      if (s) Object.assign(s, op.payload);
      return { data: s || null, error: null };
    }
    const s = store.sessions[op.filters.token];
    return s ? { data: s, error: null } : { data: null, error: { message: 'no session' } };
  }
  if (op.table === 'users') {
    const u = store.users[op.filters.id];
    return u ? { data: u, error: null } : { data: null, error: { message: 'no user' } };
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
      insert(p) { op.action = 'insert'; op.payload = p; return chain; },
      update(p) { op.action = 'update'; op.payload = p; return chain; },
      eq(k, v) { op.filters[k] = v; return chain; },
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
    res.json({ user });
  });
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });

beforeEach(() => {
  store = { sessions: {}, users: { u1: { id: 'u1', name: 'Buyer', email: 'b@carup.test', phone: '', role: 'owner', is_verified: true } } };
});

const getMe = async (headers) => {
  const res = await fetch(`${baseUrl}/api/auth/me`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('login persists a session and the returned token exists in user_sessions', async () => {
  const token = 'sk_live_persist';
  const { error } = await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'owner', token, expiresAt: future() }));
  assert.equal(error, null, 'the login insert must succeed against the post-migration schema');
  assert.ok(store.sessions[token], 'session row persisted');
  assert.equal(store.sessions[token].token, token);
  assert.equal(store.sessions[token].is_valid, true);
});

test('/api/auth/me accepts the returned token', async () => {
  const token = 'sk_live_me';
  await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'owner', token, expiresAt: future() }));
  const { status, body } = await getMe({ 'x-session-token': token });
  assert.equal(status, 200);
  assert.equal(body.user.id, 'u1');
});

test('expired, invalidated (logout), and unknown tokens are all rejected', async () => {
  await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'owner', token: 'expired', expiresAt: past() }));
  assert.equal((await getMe({ 'x-session-token': 'expired' })).status, 401);

  const live = 'logout-tok';
  await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'owner', token: live, expiresAt: future() }));
  assert.equal((await getMe({ 'x-session-token': live })).status, 200);
  await supabase.from('user_sessions').update({ is_valid: false }).eq('token', live); // logout/invalidation
  assert.equal((await getMe({ 'x-session-token': live })).status, 401);

  assert.equal((await getMe({ 'x-session-token': 'ghost' })).status, 401);
});

test('role-switch session creation still works (writes token + is_valid + the switched role)', async () => {
  const token = 'sk_live_switch';
  const { error } = await supabase.from('user_sessions').insert(buildSessionRow({ userId: 'u1', activeRole: 'admin', token, expiresAt: future() }));
  assert.equal(error, null);
  assert.equal(store.sessions[token].active_role, 'admin');
  assert.equal(store.sessions[token].token, token);
  assert.equal(store.sessions[token].is_valid, true);
});

// ---- production is not touched: the live check refuses the prod project ----
test('production is not touched — the live DB guard refuses the production project ref', () => {
  assert.throws(
    () => assertStagingTarget(extractSupabaseRef('postgresql://postgres.vhmnajoeicasaigiophh:x@h.pooler.supabase.com:5432/postgres')),
    /PRODUCTION/i,
  );
});

// ---- optional live-DB integration: STRICTLY opt-in and STAGING-only ----
// db/supabase.js calls dotenv.config(), so .env can populate SUPABASE_DB_URL with the PRODUCTION
// project. This check therefore NEVER auto-connects: it requires an explicit flag (not present in
// .env) AND refuses any non-staging ref before opening a connection.
test('live user_sessions has token + is_valid + the unique token index (opt-in; STAGING only)', async (t) => {
  if (process.env.RUN_LIVE_SESSION_DB_CHECK !== '1') {
    return t.skip('set RUN_LIVE_SESSION_DB_CHECK=1 with a STAGING SUPABASE_DB_URL to run this live check');
  }
  const url = process.env.SUPABASE_DB_URL;
  assert.ok(url, 'a STAGING SUPABASE_DB_URL is required');
  assertStagingTarget(extractSupabaseRef(url)); // refuses production; allows only eoyenigwevnxwwhyhaer
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const cols = await client.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='user_sessions'");
    const names = cols.rows.map((r) => r.column_name);
    for (const c of MIGRATION_ADDED_COLUMNS) assert.ok(names.includes(c), `live user_sessions missing '${c}' — apply the migration`);
    const idx = await client.query("select indexname from pg_indexes where tablename='user_sessions' and indexname='uq_user_sessions_token'");
    assert.ok(idx.rows.length, 'unique token index missing — apply the migration');
  } finally {
    await client.end();
  }
});
