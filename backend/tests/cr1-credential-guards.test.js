/**
 * CR-1 credential-remediation guards (static source assertions, no secrets touched).
 *
 * Proves the current tree stays free of the CR-1 defect classes:
 *  - no credential-bearing postgres:// URIs in executable scripts;
 *  - no hardcoded production project ref in executable paths (deny-guards excepted);
 *  - production-operation scripts fail closed without explicit env targets;
 *  - staging tooling still refuses the production ref (identity guards intact).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
const PROD_REF = ['vhmnajoeicasa', 'igiophh'].join(''); // split so this test file never trips the scanner
const CRED_URI = /postgres(?:ql)?:\/\/[A-Za-z0-9_.-]+:(?!PASS@|postgres@127|postgres@localhost)[^@\s'"`]{4,}@/;

test('apply_migration.js carries no credential URI and fails closed without env', () => {
  const src = read('backend/scripts/apply_migration.js');
  assert.equal(CRED_URI.test(src), false, 'no credential-bearing pg URI');
  assert.equal(src.includes(PROD_REF), false, 'no production project ref');
  assert.match(src, /SUPABASE_DB_URL \|\| process\.env\.DATABASE_URL/);
  assert.match(src, /process\.exit\(2\)/, 'fails closed when env missing');
});

test('production migration runner requires an explicit PRODUCTION_PROJECT_REF', () => {
  const src = read('database/scripts/apply_migrations_production.mjs');
  assert.equal(src.includes(PROD_REF), false, 'no hardcoded production ref');
  assert.match(src, /process\.env\.PRODUCTION_PROJECT_REF/);
  assert.match(src, /process\.exit\(2\)/, 'fails closed when ref missing');
});

test('production smoke requires explicit backend URL + project ref (no implicit fallbacks)', () => {
  const src = read('database/scripts/production_smoke.mjs');
  assert.equal(src.includes(PROD_REF), false, 'no hardcoded production ref');
  assert.equal(/carup-backend\.vercel\.app/.test(src), false, 'no implicit production backend fallback');
  assert.match(src, /process\.env\.PRODUCTION_BACKEND_URL/);
  assert.match(src, /process\.env\.PRODUCTION_PROJECT_REF/);
});

test('server startup log does not embed a database project ref', () => {
  const src = read('backend/server.js');
  assert.equal(src.includes(PROD_REF), false);
});

test('env.example contains no credential-shaped connection strings', () => {
  const src = read('backend/env.example');
  assert.equal(CRED_URI.test(src), false);
});

test('staging identity guards still refuse the production ref (deny-lists intact)', () => {
  const applyVerify = read('backend/scripts/diaspora-staging-apply-verify.mjs');
  assert.match(applyVerify, /FORBIDDEN_PROD_REF/);
  assert.equal(applyVerify.includes(PROD_REF), true, 'deny constant must remain literal');
  const uatGuard = read('backend/scripts/uat/referral-uat-guard.mjs');
  assert.match(uatGuard, /PRODUCTION_SUPABASE_REF/);
  const stagingUtils = read('backend/tests/staging/diaspora-staging-test-utils.js');
  assert.match(stagingUtils, /FORBIDDEN_REFS/);
});
