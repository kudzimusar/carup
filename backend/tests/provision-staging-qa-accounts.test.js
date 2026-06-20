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
  RECONCILE_FIND_SQL,
  RECONCILE_UPDATE_SQL,
  RECONCILE_INSERT_SQL,
  ALLOWED_USER_ROLES,
  extractSupabaseRef,
  assertStagingTarget,
  assertAccountRolesAllowed,
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
  // Buyer is an `owner` (no distinct buyer/member role exists; 'member' violates users_role_check).
  assert.equal(byId['qa-staging-buyer-73'].role, 'owner');
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

  // The reconcile statements are fully parameterized — no inline credential possible.
  assert.match(RECONCILE_INSERT_SQL, /\$1.*\$2.*\$3.*\$4.*\$5.*\$6.*\$7/s);
  assert.match(RECONCILE_UPDATE_SQL, /\$1.*\$2.*\$3.*\$4.*\$5.*\$6/s);
  for (const sql of [RECONCILE_FIND_SQL, RECONCILE_UPDATE_SQL, RECONCILE_INSERT_SQL]) {
    assert.equal(/scrypt:/.test(sql), false);
  }

  // The materialized rows carry hashes, never plaintext.
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes(TEST_PW), false, 'plaintext password leaked into generated rows');
  assert.match(serialized, /scrypt:/);
});

test('reconciles by canonical email OR id and refreshes every login/profile field', () => {
  // Match on email (preferred) or canonical id — so an app-created row (canonical email, random id)
  // is reconciled in place rather than colliding on the email UNIQUE constraint.
  assert.match(RECONCILE_FIND_SQL, /where\s+email\s*=\s*\$1\s+or\s+id\s*=\s*\$2/i);
  assert.match(RECONCILE_FIND_SQL, /order by\s*\(email\s*=\s*\$1\)\s*desc/i);
  // The UPDATE refreshes the required login/profile fields, keyed on the resolved id.
  for (const field of ['name', 'email', 'phone', 'role', 'password_hash']) {
    assert.match(RECONCILE_UPDATE_SQL, new RegExp(`${field}\\s*=\\s*\\$`));
  }
  assert.match(RECONCILE_UPDATE_SQL, /where\s+id\s*=\s*\$6/i);
});

test('buyer (owner) and seller (owner) cannot moderate; admin can; gating is platform-role based', () => {
  const roleOf = (id) => QA_ACCOUNTS.find((a) => a.id === id).role;
  assert.equal(roleOf('qa-staging-buyer-73'), 'owner');
  assert.equal(roleOf('qa-staging-seller-73'), 'owner');
  assert.throws(() => assertModerator({ platformRole: roleOf('qa-staging-buyer-73') }), /required/i);
  assert.throws(() => assertModerator({ platformRole: roleOf('qa-staging-seller-73') }), /required/i);
  assert.doesNotThrow(() => assertModerator({ platformRole: roleOf('qa-staging-admin-73') }));
  // A tenant/effective-role elevation must NOT confer moderation: only platformRole/baseRole counts.
  assert.throws(() => assertModerator({ role: 'admin', platformRole: 'owner' }), /required/i);
  assert.throws(() => assertModerator({}), /required/i);
});

test('every provisioned role is valid against the REAL users role catalog/constraint (not a mock)', async () => {
  // Source of truth #1 — the DB CHECK constraint DDL committed to the repo.
  const schema = readFileSync(resolve(REPO_ROOT, 'database/migrations/supabase_schema.sql'), 'utf8');
  const m = schema.match(/role\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)/i);
  assert.ok(m, 'could not locate the users.role CHECK constraint in supabase_schema.sql');
  const schemaRoles = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  // Source of truth #2 — the application role catalog enforced on role switch.
  const serverJs = readFileSync(resolve(REPO_ROOT, 'backend/server.js'), 'utf8');
  const cm = serverJs.match(/approvedRoles\s*=\s*\[([^\]]*)\]/);
  assert.ok(cm, 'could not locate approvedRoles in server.js');
  const catalogRoles = cm[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  const asSet = (a) => JSON.stringify([...a].sort());
  // The script constant must equal BOTH real sources (catches drift from the real constraint).
  assert.equal(asSet(ALLOWED_USER_ROLES), asSet(schemaRoles), 'ALLOWED_USER_ROLES drifted from the schema constraint');
  assert.equal(asSet(ALLOWED_USER_ROLES), asSet(catalogRoles), 'ALLOWED_USER_ROLES drifted from server.js approvedRoles');
  assert.equal(schemaRoles.includes('member'), false, "'member' must NOT be an allowed role");

  // Every account this script would provision must satisfy the real constraint.
  for (const a of QA_ACCOUNTS) {
    assert.ok(schemaRoles.includes(a.role), `account ${a.id} role '${a.role}' violates users_role_check`);
  }
  assert.doesNotThrow(() => assertAccountRolesAllowed());
  // The guard must reject the original defect (buyer as 'member').
  assert.throws(
    () => assertAccountRolesAllowed([{ id: 'x', role: 'member' }]),
    /users_role_check/i
  );

  // Real integration check: when a DB is reachable, validate against the LIVE pg_constraint too.
  if (process.env.SUPABASE_DB_URL) {
    const pg = (await import('pg')).default;
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
    await client.connect();
    try {
      const { rows } = await client.query(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'users_role_check'"
      );
      assert.ok(rows.length, 'users_role_check not found in the live database');
      const live = [...rows[0].def.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
      for (const a of QA_ACCOUNTS) {
        assert.ok(live.includes(a.role), `account ${a.id} role '${a.role}' rejected by the LIVE constraint`);
      }
    } finally {
      await client.end();
    }
  }
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
