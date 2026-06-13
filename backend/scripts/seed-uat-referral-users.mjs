#!/usr/bin/env node
/**
 * UAT-only seed: create/refresh an ADMIN and an OWNER test account for manual
 * Referral Engine testing. LOCAL / STAGING ONLY. Idempotent (upsert by email).
 *
 * Why this exists:
 *   /api/auth/switch-role only lets a user assume a role already verified for their
 *   context — and admin can only be assumed when users.role === 'admin' (the
 *   tenant-role path explicitly excludes 'admin'). So owner -> admin switching is
 *   blocked BY DESIGN. UAT therefore needs a real admin account that logs in
 *   normally via /login. This script seeds that account using the app's own
 *   password hashing and users columns — it does NOT change any auth, role, reward,
 *   wallet, trust, coupon, campaign, or marketing logic.
 *
 * Safety:
 *   - Refuses to run when NODE_ENV === 'production'.
 *   - Requires explicit confirmation: UAT_SEED_CONFIRM=yes.
 *   - Only writes two rows to `users` (upsert by email). Never touches referral data.
 *   - Does NOT load the Supabase client until the safety checks pass.
 *
 * Run (in a local/staging shell that has SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
 *   UAT_SEED_CONFIRM=yes node backend/scripts/seed-uat-referral-users.mjs
 */
import crypto from 'node:crypto';
import { hashPassword } from '../utils/passwordAuth.js';

const ADMIN = { email: 'uat-admin@carup.local', name: 'UAT Admin', role: 'admin', password: 'UatAdmin!2026' };
const OWNER = { email: 'uat-owner@carup.local', name: 'UAT Owner', role: 'owner', password: 'UatOwner!2026' };

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV=production. This script is local/staging only.');
  }
  if (process.env.UAT_SEED_CONFIRM !== 'yes') {
    throw new Error('Refusing to seed: set UAT_SEED_CONFIRM=yes to confirm a local/staging run.');
  }
}

async function upsertUser(supabase, spec) {
  const password_hash = await hashPassword(spec.password);
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
  assertSafeEnvironment();
  // Imported lazily so the safety gate runs before the Supabase client (which
  // throws on missing env) is initialized.
  const { supabase } = await import('../db/supabase.js');
  const admin = await upsertUser(supabase, ADMIN);
  const owner = await upsertUser(supabase, OWNER);
  console.log('\nUAT referral users ready (local/staging only):');
  console.log(`  ADMIN  [${admin.action}]  email=${ADMIN.email}  password=${ADMIN.password}  role=admin  id=${admin.id}`);
  console.log(`  OWNER  [${owner.action}]  email=${OWNER.email}  password=${OWNER.password}  role=owner  id=${owner.id}`);
  console.log(`\nUse the OWNER id as <OWNER_USER_ID> in the manual test checklist:\n  ${owner.id}\n`);
  console.log('Log in at /login with each account. The admin reaches /admin/referrals*; the owner reaches /dashboard/referrals.');
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exitCode = 1;
});
