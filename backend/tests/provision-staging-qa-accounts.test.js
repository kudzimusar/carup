/**
 * Security tests for scripts/provision-staging-qa-accounts.mjs and the credential-free QA seed.
 *
 * Proves the PR #73 security correction: provisioning is environment-driven, refuses production,
 * never embeds a plaintext password in generated SQL/rows, assigns correct roles + valid hashes,
 * and the role model keeps the buyer non-privileged while admin moderation stays platform-role gated.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  STAGING_SUPABASE_REF,
  PRODUCTION_SUPABASE_REF,
  QA_ACCOUNTS,
  QA_SELLER_ID,
  UPSERT_SQL,
  extractSupabaseRef,
  assertStagingTarget,
  readQaPasswords,
  buildQaAccountRows,
} from '../../scripts/provision-staging-qa-accounts.mjs';
import { verifyPassword } from '../utils/passwordAuth.js';
import { assertModerator } from '../services/marketplace/marketplaceModerationService.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// A throwaway password used only inside these tests — NOT a real/staging credential.
const TEST_PW = 'unit-test-password-not-a-real-secret';

test('production Supabase ref is rejected (string + URL forms)', () => {
  assert.throws(() => assertStagingTarget(PRODUCTION_SUPABASE_REF), /PRODUCTION/i);
  const prodUrl = `postgresql://postgres.${PRODUCTION_SUPABASE_REF}:pw@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`;
  assert.equal(extractSupabaseRef(prodUrl), PRODUCTION_SUPABASE_REF);
  assert.throws(() => assertStagingTarget(extractSupabaseRef(prodUrl)), /PRODUCTION/i);
});

test('an unknown / undeterminable ref is rejected (fail closed)', () => {
  assert.throws(() => assertStagingTarget(null), /Could not determine/i);
  assert.throws(() => assertStagingTarget('someotherproject0000'), /not the approved staging ref/i);
});

test('the approved staging ref is accepted (pooler + supabase.co URL forms)', () => {
  assert.equal(assertStagingTarget(STAGING_SUPABASE_REF), STAGING_SUPABASE_REF);
  assert.equal(extractSupabaseRef(`postgresql://postgres.${STAGING_SUPABASE_REF}:pw@host.pooler.supabase.com:5432/postgres`), STAGING_SUPABASE_REF);
  assert.equal(extractSupabaseRef(`https://${STAGING_SUPABASE_REF}.supabase.co`), STAGING_SUPABASE_REF);
});

test('missing password env vars cause a safe failure that leaks no values', () => {
  assert.throws(() => readQaPasswords({}), (err) => {
    assert.match(err.message, /Missing required password env var/i);
    for (const acct of QA_ACCOUNTS) assert.match(err.message, new RegExp(acct.passwordEnv));
    return true;
  });
  // Weak (too-short) passwords are rejected too.
  const weakEnv = Object.fromEntries(QA_ACCOUNTS.map((a) => [a.passwordEnv, 'short']));
  assert.throws(() => readQaPasswords(weakEnv), /below the .* minimum/i);
});

test('all three accounts receive valid roles and runtime-generated valid hashes', async () => {
  const env = Object.fromEntries(QA_ACCOUNTS.map((a) => [a.passwordEnv, `${TEST_PW}-${a.id}`]));
  const rows = await buildQaAccountRows(readQaPasswords(env));
  assert.equal(rows.length, 3);

  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId['qa-staging-buyer-73'].role, 'member');
  assert.equal(byId['qa-staging-seller-73'].role, 'owner');
  assert.equal(byId['qa-staging-admin-73'].role, 'admin');

  for (const acct of QA_ACCOUNTS) {
    const row = byId[acct.id];
    assert.match(row.password_hash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
    assert.equal(await verifyPassword(`${TEST_PW}-${acct.id}`, row.password_hash), true);
    // each account must have all required login/profile fields populated
    for (const field of ['email', 'name', 'phone', 'role', 'password_hash']) {
      assert.ok(row[field], `${acct.id} missing ${field}`);
    }
  }
});

test('no plaintext password is embedded in generated SQL or rows', async () => {
  const env = Object.fromEntries(QA_ACCOUNTS.map((a) => [a.passwordEnv, `${TEST_PW}-${a.id}`]));
  const rows = await buildQaAccountRows(readQaPasswords(env));

  // The static upsert is fully parameterized ($1..$7) — no inline credential possible.
  assert.match(UPSERT_SQL, /\$1.*\$2.*\$3.*\$4.*\$5.*\$6.*\$7/s);
  assert.equal(/scrypt:/.test(UPSERT_SQL), false);

  // The materialized rows carry hashes, never plaintext.
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes(TEST_PW), false, 'plaintext password leaked into generated rows');
  assert.match(serialized, /scrypt:/);
});

test('the on-conflict clause updates every required login/profile field', () => {
  for (const field of ['name', 'email', 'phone', 'role', 'password_hash']) {
    assert.match(UPSERT_SQL, new RegExp(`${field}\\s*=\\s*EXCLUDED\\.${field}`));
  }
});

test('buyer (member) cannot moderate; seller (owner) cannot moderate; admin can; gating is platform-role based', () => {
  const roleOf = (id) => QA_ACCOUNTS.find((a) => a.id === id).role;
  assert.throws(() => assertModerator({ platformRole: roleOf('qa-staging-buyer-73') }), /required/i);
  assert.throws(() => assertModerator({ platformRole: roleOf('qa-staging-seller-73') }), /required/i);
  assert.doesNotThrow(() => assertModerator({ platformRole: roleOf('qa-staging-admin-73') }));
  // A tenant/effective-role elevation must NOT confer moderation: only platformRole/baseRole counts.
  assert.throws(() => assertModerator({ role: 'admin', platformRole: 'member' }), /required/i);
  assert.throws(() => assertModerator({}), /required/i);
});

test('seller owns only the intended QA listings; buyer/admin own nothing', () => {
  const seed = readFileSync(resolve(REPO_ROOT, 'database/seeds/marketplace_v1_staging_qa_seed.sql'), 'utf8');
  const referencedQaIds = [...seed.matchAll(/qa-staging-[a-z]+-73/g)].map((m) => m[0]);
  assert.ok(referencedQaIds.length > 0);
  for (const id of new Set(referencedQaIds)) {
    assert.equal(id, QA_SELLER_ID, `unexpected QA id "${id}" referenced in the listings seed`);
  }
  assert.equal(seed.includes('qa-staging-buyer-73'), false);
  assert.equal(seed.includes('qa-staging-admin-73'), false);
});

test('the committed QA accounts seed contains NO credentials (hash or plaintext)', () => {
  const sql = readFileSync(resolve(REPO_ROOT, 'database/seeds/marketplace_v1_staging_qa_accounts.sql'), 'utf8');
  assert.equal(/scrypt:[0-9a-f]/.test(sql), false, 'a scrypt hash is still committed in the seed');
  assert.equal(/password_hash\s*,?\s*['"]?scrypt/i.test(sql), false);
  // No INSERT that sets a password_hash literal value remains.
  assert.equal(/VALUES\s*\([^)]*scrypt/i.test(sql), false);
});
