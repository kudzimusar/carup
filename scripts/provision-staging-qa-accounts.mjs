/**
 * Secure, environment-driven provisioning for the Marketplace v1 STAGING QA role accounts.
 *
 * WHY THIS EXISTS
 * ---------------
 * The earlier `database/seeds/marketplace_v1_staging_qa_accounts.sql` committed a shared plaintext
 * password and reusable scrypt hashes. That is a credential-in-repo defect; on a publicly reachable
 * staging surface the committed secret must be treated as compromised. This script replaces that seed
 * with a mechanism that NEVER stores credentials in the repository:
 *
 *   - passwords are read from environment variables (one per account; nothing shared/committed),
 *   - scrypt hashes are generated AT RUNTIME via backend/utils/passwordAuth.js (same scheme as login),
 *   - it refuses to run unless the target Supabase project ref is exactly the staging ref,
 *   - it explicitly refuses the production ref,
 *   - it never logs a plaintext password or a password hash,
 *   - it does not write any generated credential to disk.
 *
 * USAGE (run locally by an operator against STAGING only — do NOT run in CI/prod):
 *   SUPABASE_DB_URL='<staging pooler url>' \
 *   QA_BUYER_PASSWORD='<strong unique>' \
 *   QA_SELLER_PASSWORD='<strong unique>' \
 *   QA_ADMIN_PASSWORD='<strong unique>' \
 *   node scripts/provision-staging-qa-accounts.mjs
 *
 * CLEANUP (remove QA sessions + accounts; listing data is owned by the listings seed's CLEANUP):
 *   delete from user_sessions where user_id in
 *     ('qa-staging-buyer-73','qa-staging-seller-73','qa-staging-admin-73');
 *   delete from users where id in
 *     ('qa-staging-buyer-73','qa-staging-admin-73');
 *   -- The seller row (qa-staging-seller-73) and the 3 QA listings it owns are removed by the
 *   -- CLEANUP block in database/seeds/marketplace_v1_staging_qa_seed.sql. Only remove QA-owned
 *   -- listing rows (owner_id = 'qa-staging-seller-73'); never touch non-QA data.
 */

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../backend/utils/passwordAuth.js';

export const STAGING_SUPABASE_REF = 'eoyenigwevnxwwhyhaer';
export const PRODUCTION_SUPABASE_REF = 'vhmnajoeicasaigiophh';
export const MIN_PASSWORD_LENGTH = 12;
const JOIN_DATE = '2026-06-17';

/**
 * The real public.users.users_role_check constraint (database/migrations/supabase_schema.sql) — and
 * the application role catalog (backend/server.js approvedRoles). 'member' is NOT permitted, so a QA
 * account can only use one of these. Kept here so the script fails BEFORE a DB write if a future edit
 * introduces an out-of-catalog role.
 */
export const ALLOWED_USER_ROLES = ['owner', 'dealer', 'mechanic', 'insurance', 'government', 'bank', 'admin'];

/**
 * QA account definitions — NO credentials here. The password for each account is supplied at runtime
 * via its `passwordEnv` environment variable.
 *
 * PRODUCT MODEL: CarUp has no distinct "buyer"/"member" role. An ordinary Marketplace buyer is just an
 * `owner` (the buyer endpoints use authorizeRole([]) — any authenticated user — and `owner` is not a
 * moderator role, so a buyer-as-owner still cannot moderate). The buyer QA account is therefore an
 * `owner` that owns NO listings; the seller QA account is an `owner` that owns the QA listings seeded by
 * database/seeds/marketplace_v1_staging_qa_seed.sql (owner_id = 'qa-staging-seller-73'). They are
 * distinguished by listing ownership, not by role. (See also the canonical staging UAT accounts
 * uat-owner@carup.local / uat-admin@carup.local documented in the companion .sql.)
 */
export const QA_SELLER_ID = 'qa-staging-seller-73';
export const QA_ACCOUNTS = [
  { id: 'qa-staging-buyer-73',  email: 'qa-buyer-73@staging.carup.local',  name: 'QA Staging Buyer',  phone: '+263772000074', role: 'owner', passwordEnv: 'QA_BUYER_PASSWORD' },
  { id: QA_SELLER_ID,           email: 'qa-seller-73@staging.carup.local', name: 'QA Staging Seller', phone: '+263772000073', role: 'owner', passwordEnv: 'QA_SELLER_PASSWORD' },
  { id: 'qa-staging-admin-73',  email: 'qa-admin-73@staging.carup.local',  name: 'QA Staging Admin',  phone: '+263772000075', role: 'admin', passwordEnv: 'QA_ADMIN_PASSWORD' },
];

/** Fail before any DB write if a provisioned role is not in the real users role catalog/constraint. */
export function assertAccountRolesAllowed(accounts = QA_ACCOUNTS) {
  const bad = accounts.filter((a) => !ALLOWED_USER_ROLES.includes(a.role));
  if (bad.length) {
    throw new Error(`Account role(s) violate users_role_check (${ALLOWED_USER_ROLES.join(', ')}): ${bad.map((a) => `${a.id}=${a.role}`).join(', ')}`);
  }
  return true;
}

// Reconcile by canonical EMAIL first, then canonical ID. A QA account may already exist with the
// canonical email but a DIFFERENT id — e.g. created through the app /register path, which mints a
// random `u_...` id. Matching on email keeps that existing row (and its id) and just refreshes the
// login/profile fields; otherwise we match the canonical id; only when neither exists do we INSERT.
// (`users` has UNIQUE(email) and a TEXT PRIMARY KEY(id), so a blind ON CONFLICT(id) upsert would hit
// the email uniqueness violation against an app-created row.)
const RECONCILE_FIND_SQL =
  'SELECT id FROM users WHERE email = $1 OR id = $2 ORDER BY (email = $1) DESC LIMIT 1';
const RECONCILE_UPDATE_SQL =
  'UPDATE users SET name = $1, email = $2, phone = $3, role = $4, password_hash = $5 WHERE id = $6';
const RECONCILE_INSERT_SQL =
  'INSERT INTO users (id, name, email, phone, role, password_hash, join_date) VALUES ($1, $2, $3, $4, $5, $6, $7)';
export { RECONCILE_FIND_SQL, RECONCILE_UPDATE_SQL, RECONCILE_INSERT_SQL };

/**
 * Upsert one QA account, reconciling by canonical email OR canonical id. Parameterized — the hash is
 * bound as a value, never interpolated or logged. Returns { id, action: 'created' | 'updated' }.
 */
export async function reconcileAccount(client, r, joinDate = JOIN_DATE) {
  const found = await client.query(RECONCILE_FIND_SQL, [r.email, r.id]);
  if (found.rows.length) {
    const existingId = found.rows[0].id;
    await client.query(RECONCILE_UPDATE_SQL, [r.name, r.email, r.phone, r.role, r.password_hash, existingId]);
    return { id: existingId, action: 'updated' };
  }
  await client.query(RECONCILE_INSERT_SQL, [r.id, r.name, r.email, r.phone, r.role, r.password_hash, joinDate]);
  return { id: r.id, action: 'created' };
}

/** Extract the 20-char Supabase project ref from a DB URL (pooler `postgres.<ref>`) or a `<ref>.supabase.co` URL. */
export function extractSupabaseRef(source) {
  if (!source || typeof source !== 'string') return null;
  const host = source.match(/(?:db\.)?([a-z0-9]{20})\.supabase\.(?:co|com)/i);
  if (host) return host[1].toLowerCase();
  const poolerUser = source.match(/postgres\.([a-z0-9]{20})/i);
  if (poolerUser) return poolerUser[1].toLowerCase();
  return null;
}

/** Fail closed unless the target is exactly the approved staging ref; never the production ref. */
export function assertStagingTarget(ref) {
  if (!ref) {
    throw new Error('Could not determine the target Supabase project ref from SUPABASE_DB_URL. Refusing to run.');
  }
  if (ref === PRODUCTION_SUPABASE_REF) {
    throw new Error(`Refusing to run against the PRODUCTION Supabase project (${ref}). QA accounts must never exist in production.`);
  }
  if (ref !== STAGING_SUPABASE_REF) {
    throw new Error(`Refusing: target ref "${ref}" is not the approved staging ref (${STAGING_SUPABASE_REF}).`);
  }
  return ref;
}

/**
 * Read one password per QA account from env. Throws (without echoing any value) when any are missing
 * or shorter than MIN_PASSWORD_LENGTH, so nothing is provisioned with a weak/blank secret.
 */
export function readQaPasswords(env = process.env) {
  const byId = {};
  const missing = [];
  const weak = [];
  for (const acct of QA_ACCOUNTS) {
    const value = env[acct.passwordEnv];
    if (value == null || value === '') { missing.push(acct.passwordEnv); continue; }
    if (String(value).length < MIN_PASSWORD_LENGTH) { weak.push(acct.passwordEnv); continue; }
    byId[acct.id] = String(value);
  }
  if (missing.length) {
    throw new Error(`Missing required password env var(s): ${missing.join(', ')}. Set a unique strong password per QA account; nothing is provisioned without them.`);
  }
  if (weak.length) {
    throw new Error(`Password env var(s) below the ${MIN_PASSWORD_LENGTH}-char minimum: ${weak.join(', ')}.`);
  }
  return byId;
}

/** Build the rows to upsert, hashing each password at runtime. Returned rows carry the hash, never the plaintext. */
export async function buildQaAccountRows(passwordsById) {
  assertAccountRolesAllowed(); // never attempt an upsert that would violate users_role_check
  const rows = [];
  for (const acct of QA_ACCOUNTS) {
    const password = passwordsById[acct.id];
    if (!password) throw new Error(`No password provided for ${acct.id}.`);
    const password_hash = await hashPassword(password); // scrypt:<salt>:<hex>, random salt per call
    rows.push({ id: acct.id, name: acct.name, email: acct.email, phone: acct.phone, role: acct.role, password_hash });
  }
  return rows;
}

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    // No hardcoded fallback — unlike the legacy deploy-migration scripts (see SECURITY note in PR #73).
    console.error('❌ SUPABASE_DB_URL is required (no hardcoded fallback). Aborting.');
    process.exit(1);
  }
  try {
    const ref = assertStagingTarget(extractSupabaseRef(connectionString) || extractSupabaseRef(process.env.SUPABASE_URL));
    const passwords = readQaPasswords(process.env);
    const rows = await buildQaAccountRows(passwords); // hashes generated here; plaintext stays in memory only

    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      for (const r of rows) {
        const result = await reconcileAccount(client, r); // reconciles by canonical email OR id
        console.log(`✅ provisioned ${r.email} (role=${r.role}, ${result.action})`); // no password/hash in logs
      }
    } finally {
      await client.end();
    }
    console.log(`Done. ${rows.length} QA accounts upserted on staging ref ${ref}.`);
  } catch (err) {
    // err.message is constructed above to never contain a password or hash.
    console.error('❌ Refusing/failed:', err.message);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
