#!/usr/bin/env node
/**
 * UAT-only seed: create/refresh an ADMIN and an OWNER STAGING test account for manual
 * Referral Engine testing. Idempotent (upsert by email). Environment-driven — NO credentials
 * are committed, written, printed, or logged.
 *
 * Why this exists:
 *   /api/auth/switch-role only lets a user assume a role already verified for their context — and
 *   admin can only be assumed when users.role === 'admin' (the tenant-role path explicitly excludes
 *   'admin'). So owner -> admin switching is blocked BY DESIGN. UAT therefore needs a real admin
 *   account that logs in normally via /login. This script seeds it using the app's own password
 *   hashing and users columns; it does NOT change any auth, role, reward, wallet, trust, coupon,
 *   campaign, or marketing logic.
 *
 * SECURITY (credential cleanup, PR #73):
 *   This script previously HARD-CODED and PRINTED the UAT passwords. Those legacy values are
 *   COMPROMISED (committed + logged while staging browser protection was disabled) and must never be
 *   reused. Passwords now come ONLY from env, are hashed at runtime, and are never emitted.
 *   The uat-owner@carup.local / uat-admin@carup.local accounts MUST be rotated (re-run this with fresh
 *   UAT_OWNER_PASSWORD / UAT_ADMIN_PASSWORD) before any further QA.
 *
 * Safety:
 *   - Refuses to run when NODE_ENV === 'production'.
 *   - Requires explicit confirmation: UAT_SEED_CONFIRM=yes.
 *   - Targets the STAGING Supabase only (ref eoyenigwevnxwwhyhaer); explicitly refuses production
 *     (ref vhmnajoeicasaigiophh) — derived from SUPABASE_URL / SUPABASE_DB_URL.
 *   - Refuses missing / weak / duplicate passwords BEFORE any DB write.
 *   - Only writes two rows to `users` (upsert by email). Never touches referral data.
 *   - Does NOT load the Supabase client until the safety checks pass.
 *
 * Run (staging shell with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the STAGING project):
 *   UAT_SEED_CONFIRM=yes \
 *   UAT_OWNER_PASSWORD='<strong unique>' UAT_ADMIN_PASSWORD='<strong unique>' \
 *   node backend/scripts/seed-uat-referral-users.mjs
 */
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../utils/passwordAuth.js';
import {
  ALLOWED_USER_ROLES,
  MIN_PASSWORD_LENGTH,
  extractSupabaseRef,
  assertStagingTarget,
} from '../../scripts/provision-staging-qa-accounts.mjs';

// Roles only — NO passwords. The password for each comes from its env var at runtime.
export const UAT_ACCOUNTS = [
  { email: 'uat-admin@carup.local', name: 'UAT Admin', role: 'admin', passwordEnv: 'UAT_ADMIN_PASSWORD' },
  { email: 'uat-owner@carup.local', name: 'UAT Owner', role: 'owner', passwordEnv: 'UAT_OWNER_PASSWORD' },
];

/** Refuse production / unconfirmed runs and confirm the Supabase target is exactly the staging ref. */
export function assertStagingEnv(env = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error("Refusing to seed: NODE_ENV === 'production'. This script is staging only.");
  }
  if (env.UAT_SEED_CONFIRM !== 'yes') {
    throw new Error('Refusing to seed: set UAT_SEED_CONFIRM=yes to confirm a staging run.');
  }
  const ref = extractSupabaseRef(env.SUPABASE_URL) || extractSupabaseRef(env.SUPABASE_DB_URL);
  return assertStagingTarget(ref); // allows only eoyenigwevnxwwhyhaer; explicitly refuses vhmnajoeicasaigiophh
}

/** Roles must satisfy the real users_role_check constraint. */
export function assertUatRolesAllowed(accounts = UAT_ACCOUNTS) {
  const bad = accounts.filter((a) => !ALLOWED_USER_ROLES.includes(a.role));
  if (bad.length) {
    throw new Error(`UAT role(s) violate users_role_check (${ALLOWED_USER_ROLES.join(', ')}): ${bad.map((a) => `${a.email}=${a.role}`).join(', ')}`);
  }
  return true;
}

/** Read one password per UAT account from env. Throws (no values echoed) on missing/weak/duplicate. */
export function readUatPasswords(env = process.env) {
  const byEmail = {};
  const missing = [];
  const weak = [];
  for (const a of UAT_ACCOUNTS) {
    const value = env[a.passwordEnv];
    if (value == null || value === '') { missing.push(a.passwordEnv); continue; }
    if (String(value).length < MIN_PASSWORD_LENGTH) { weak.push(a.passwordEnv); continue; }
    byEmail[a.email] = String(value);
  }
  if (missing.length) throw new Error(`Missing required password env var(s): ${missing.join(', ')}.`);
  if (weak.length) throw new Error(`Password env var(s) below the ${MIN_PASSWORD_LENGTH}-char minimum: ${weak.join(', ')}.`);
  const values = Object.values(byEmail);
  if (new Set(values).size !== values.length) throw new Error('UAT passwords must be unique per account.');
  return byEmail;
}

async function upsertUser(supabase, spec, password) {
  const password_hash = await hashPassword(password); // hashed at runtime; plaintext never stored/logged
  const { data: existing } = await supabase.from('users').select('id').eq('email', spec.email).maybeSingle();
  if (existing?.id) {
    const { error } = await supabase.from('users').update({ name: spec.name, role: spec.role, password_hash }).eq('id', existing.id);
    if (error) throw error;
    return { id: existing.id, action: 'updated' };
  }
  const id = 'u_' + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  const { error } = await supabase.from('users').insert({
    id, name: spec.name, email: spec.email, phone: '', role: spec.role, password_hash, join_date: new Date().toISOString(),
  });
  if (error) throw error;
  return { id, action: 'created' };
}

async function main() {
  assertStagingEnv();
  assertUatRolesAllowed();
  const passwords = readUatPasswords(); // fails before any DB write if missing/weak/duplicate
  // Imported lazily so the safety gates run before the Supabase client (which throws on missing env).
  const { supabase } = await import('../db/supabase.js');

  const results = [];
  for (const a of UAT_ACCOUNTS) {
    const r = await upsertUser(supabase, a, passwords[a.email]);
    results.push({ email: a.email, role: a.role, action: r.action, id: r.id }); // NO password, NO hash
  }

  console.log('\nUAT referral users ready (staging only). Passwords come from your env — none are printed:');
  for (const r of results) {
    console.log(`  ${r.action.padEnd(7)} ${r.email}  role=${r.role}  id=${r.id}`);
  }
  const owner = results.find((r) => r.role === 'owner');
  if (owner) console.log(`\nUse the OWNER id as <OWNER_USER_ID> in the manual checklist:\n  ${owner.id}`);
  console.log('\nLog in at /login with the env-supplied passwords. Admin -> /admin/referrals*; owner -> /dashboard/referrals.\n');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Seed failed:', err.message); // err.message never contains a password
    process.exitCode = 1;
  });
}
