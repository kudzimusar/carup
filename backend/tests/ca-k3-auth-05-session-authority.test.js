import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const migration = read('database/migrations/20261016010000_ca_k3_auth_05_session_identity_authority.sql');
const phaseC = read('database/migrations/20261015010000_ca_k3_auth_04_corporate_permission_authority.sql');
const runtime = read('backend/services/auth/sessionAuthority.js');

function gitBlob(text) {
  const b = Buffer.from(text);
  return createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
}

function jsFiles(root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const p = path.join(root, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...jsFiles(p));
    else if (st.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('AUTH-05 keeps accepted Phase-C migration byte-identical', () => {
  assert.equal(gitBlob(phaseC), '747404734641952ca7f80ccaddb2ee2eafa0a677');
});

test('AUTH-05 ordinary service_role has no direct user_sessions table privilege after migration', () => {
  assert.match(migration, /REVOKE ALL ON TABLE public\.user_sessions FROM PUBLIC, anon, authenticated, service_role, carup_session_authority/);
  assert.doesNotMatch(migration.split('-- +migrate Down')[0], /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*user_sessions[^;]*service_role/i);
});

test('AUTH-05 session writers are executable only by dedicated authority', () => {
  for (const name of [
    'session_authority_issue',
    'session_authority_set_active_organization',
    'session_authority_revoke_current',
    'session_authority_revoke_scope',
    'session_authority_record_password_reauth',
    'session_authority_clear_password_reauth',
  ]) {
    assert.match(migration, new RegExp('GRANT EXECUTE ON FUNCTION public\\.' + name + '[^;]+ TO carup_session_authority;'));
    assert.doesNotMatch(
      migration.split('-- +migrate Down')[0],
      new RegExp('GRANT EXECUTE ON FUNCTION public\\.' + name + '[^;]+ TO service_role;'),
    );
  }
});

test('AUTH-05 removes ordinary service_role from all five Phase-C mutation wrappers', () => {
  for (const name of [
    'corporate_authority_apply_direct',
    'corporate_authority_request_submit',
    'corporate_authority_request_decide',
    'corporate_authority_request_execute',
    'corporate_authority_request_cancel',
  ]) {
    assert.match(migration, new RegExp('REVOKE EXECUTE ON FUNCTION public\\.' + name + '[^;]+ FROM service_role;'));
    assert.match(migration, new RegExp('GRANT EXECUTE ON FUNCTION public\\.' + name + '[^;]+ TO carup_session_authority;'));
  }
});

test('runtime application code no longer reaches user_sessions directly outside the explicit local/test adapter', () => {
  const roots = [
    path.join(ROOT, 'backend/middleware'),
    path.join(ROOT, 'backend/routes'),
    path.join(ROOT, 'backend/services'),
  ];
  const files = [path.join(ROOT, 'backend/server.js'), ...roots.flatMap(jsFiles)];
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).replaceAll('\\\\', '/');
    if (rel === 'backend/services/auth/sessionAuthority.js') continue;
    const source = readFileSync(file, 'utf8');
    if (/\.from\(\s*['"]user_sessions['"]\s*\)/.test(source)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test('local/test compatibility seam is deployment-proof and cannot activate from NODE_ENV alone', async () => {
  const { isLegacySessionTestAdapterAllowed } = await import('../services/auth/sessionAuthority.js');
  assert.equal(isLegacySessionTestAdapterAllowed({ NODE_ENV: 'test' }), true);
  assert.equal(isLegacySessionTestAdapterAllowed({ NODE_ENV: 'test', CARUP_ENV: 'staging' }), false);
  assert.equal(isLegacySessionTestAdapterAllowed({ NODE_ENV: 'test', CARUP_ENV: 'production' }), false);
  assert.equal(isLegacySessionTestAdapterAllowed({ NODE_ENV: 'test', VERCEL_ENV: 'preview' }), false);
  assert.equal(isLegacySessionTestAdapterAllowed({ NODE_ENV: 'test', VERCEL_ENV: 'production' }), false);
});

test('dedicated runtime requires an independent database credential and never falls back to service_role', () => {
  assert.match(runtime, /SESSION_AUTH_DATABASE_URL/);
  assert.doesNotMatch(runtime, /process\\.env\\.(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|DATABASE_URL)\\b/);
  assert.match(runtime, /executeCorporateAuthorityRpc/);
});
