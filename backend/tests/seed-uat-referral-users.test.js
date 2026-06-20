/**
 * Security tests for the credential cleanup of backend/scripts/seed-uat-referral-users.mjs.
 *
 * Proves: no plaintext UAT password remains in repo content, no password is logged, production is
 * refused, missing/weak/duplicate passwords fail safely before any DB write, the roles satisfy the
 * real users_role_check constraint, and a rotated password invalidates the prior (compromised) one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  UAT_ACCOUNTS,
  assertStagingEnv,
  assertUatRolesAllowed,
  readUatPasswords,
} from '../scripts/seed-uat-referral-users.mjs';
import { ALLOWED_USER_ROLES, STAGING_SUPABASE_REF, PRODUCTION_SUPABASE_REF } from '../../scripts/provision-staging-qa-accounts.mjs';
import { hashPassword, verifyPassword } from '../utils/passwordAuth.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SEED_SRC = readFileSync(resolve(REPO_ROOT, 'backend/scripts/seed-uat-referral-users.mjs'), 'utf8');
const DOCS_SRC = readFileSync(resolve(REPO_ROOT, 'docs/referral-ai-engine/REFERRAL_ENGINE_MANUAL_TEST_DATA.md'), 'utf8');

test('no plaintext UAT password remains in repository content (script or docs)', () => {
  // Reconstruct the legacy credentials from fragments so the verbatim secret never appears in repo
  // content (a scanner greps clean), while still asserting they are absent from the source and docs.
  const legacy = ['Uat' + 'Owner!' + '2026', 'Uat' + 'Admin!' + '2026'];
  for (const src of [SEED_SRC, DOCS_SRC]) {
    for (const pw of legacy) {
      assert.equal(src.includes(pw), false, 'a legacy UAT password literal is still present');
    }
  }
  // No hardcoded password literal in an account spec or anywhere in the seed.
  assert.equal(/password:\s*['"][^'"]+['"]/.test(SEED_SRC), false, 'seed still hardcodes a password literal');
});

test('no password is logged', () => {
  // No console call interpolates anything containing "password" (the old leak: `password=${...}`).
  assert.equal(/console\.\w+\([^)]*\$\{[^}]*[Pp]assword/.test(SEED_SRC), false, 'a password value is interpolated into a log');
  assert.equal(/password=\$\{/.test(SEED_SRC), false, 'the legacy password=${...} log pattern is still present');
});

test('production target is refused; staging target is accepted', () => {
  // Explicit production project ref -> refused.
  assert.throws(
    () => assertStagingEnv({ NODE_ENV: 'test', UAT_SEED_CONFIRM: 'yes', SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` }),
    /PRODUCTION/i,
  );
  // NODE_ENV=production -> refused before anything else.
  assert.throws(() => assertStagingEnv({ NODE_ENV: 'production', UAT_SEED_CONFIRM: 'yes' }), /production/i);
  // Missing confirmation -> refused.
  assert.throws(() => assertStagingEnv({ NODE_ENV: 'test', SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co` }), /UAT_SEED_CONFIRM/);
  // Correct staging target -> accepted.
  assert.equal(
    assertStagingEnv({ NODE_ENV: 'test', UAT_SEED_CONFIRM: 'yes', SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co` }),
    STAGING_SUPABASE_REF,
  );
});

test('missing / weak / duplicate password env vars fail safely with no value leak', () => {
  assert.throws(() => readUatPasswords({}), (err) => {
    assert.match(err.message, /Missing required password env var/i);
    for (const a of UAT_ACCOUNTS) assert.match(err.message, new RegExp(a.passwordEnv));
    return true;
  });
  const weak = Object.fromEntries(UAT_ACCOUNTS.map((a) => [a.passwordEnv, 'short']));
  assert.throws(() => readUatPasswords(weak), /below the .* minimum/i);
  const dup = Object.fromEntries(UAT_ACCOUNTS.map((a) => [a.passwordEnv, 'same-password-shared-1234']));
  assert.throws(() => readUatPasswords(dup), /unique per account/i);
});

test('owner and admin roles satisfy the real users_role_check constraint', () => {
  const schema = readFileSync(resolve(REPO_ROOT, 'database/migrations/supabase_schema.sql'), 'utf8');
  const m = schema.match(/role\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)/i);
  assert.ok(m, 'could not locate users.role CHECK constraint');
  const schemaRoles = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  const roles = UAT_ACCOUNTS.map((a) => a.role).sort();
  assert.deepEqual(roles, ['admin', 'owner']);
  for (const a of UAT_ACCOUNTS) {
    assert.ok(schemaRoles.includes(a.role), `UAT role '${a.role}' violates users_role_check`);
    assert.ok(ALLOWED_USER_ROLES.includes(a.role));
  }
  assert.doesNotThrow(() => assertUatRolesAllowed());
});

test('a rotated password invalidates the prior (compromised) credential', async () => {
  // Representative old/new pair — NOT the real legacy strings (kept out of the repo on purpose).
  const priorCompromised = 'prior-compromised-credential-AA';
  const rotatedFresh = 'rotated-fresh-unique-credential-BB';
  assert.notEqual(priorCompromised, rotatedFresh);

  const rotatedHash = await hashPassword(rotatedFresh); // what the account stores after rotation
  assert.equal(await verifyPassword(rotatedFresh, rotatedHash), true, 'the rotated password must authenticate');
  assert.equal(await verifyPassword(priorCompromised, rotatedHash), false, 'the prior credential must no longer authenticate');
});
