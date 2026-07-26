#!/usr/bin/env node
/**
 * Provision deterministic, clearly-marked STAGING-ONLY test identities for the deployed-browser UAT
 * (goal §5), using ONLY the public staging registration API — no database credentials, no production
 * users, no secrets in the repo.
 *
 * Usage:
 *   STAGING_API_URL=https://carup-backend-staging.vercel.app/api \
 *   STAGING_UAT_PASSWORD='<generated-strong-pw>' \
 *   node backend/scripts/staging-create-test-identities.mjs
 *
 * It registers uat.buyer@ / uat.seller@ / uat.outsider@ (public registration yields role='owner';
 * the Diaspora buyer/seller journeys key off buyer_id/seller_id = the user id, not a privileged role)
 * and writes Playwright storage-state files under .staging-auth/ (gitignored). The password comes
 * from the environment and is never written to the repo or to disk.
 *
 * LIMITATION (documented, not worked around): public registration is fail-closed to 'owner' only, so
 * reviewer / tenant-admin / compliance-operator identities CANNOT be created here. Those require an
 * admin bootstrap or direct staging DB access in the release-operator session. Specs 34/35 self-skip
 * the reviewer/admin stages until those identities exist.
 */
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';

const API = process.env.STAGING_API_URL || 'https://carup-backend-staging.vercel.app/api';
const PW = process.env.STAGING_UAT_PASSWORD;
if (!PW || PW.length < 12) { console.error('Set STAGING_UAT_PASSWORD (>=12 chars) in env; it is never written to the repo.'); process.exit(2); }

const RUN = process.env.STAGING_RUN_ID || `uat-${new Date().toISOString().slice(0, 10)}`;
const IDS = [
  { role: 'buyer', email: 'uat.buyer@carup-staging.test', envVar: 'STAGING_UAT_BUYER_PASSWORD' },
  // The stock/RFQ seller surfaces gate on the dealer/seller stakeholder role; public registration is
  // fail-closed to 'owner', so the seller identity uses the product's own /auth/switch-role (approved
  // catalog includes 'dealer') — a real product path, not a bypass.
  { role: 'seller', email: 'uat.seller@carup-staging.test', envVar: 'STAGING_UAT_SELLER_PASSWORD', switchRole: 'dealer' },
  { role: 'outsider', email: 'uat.outsider@carup-staging.test', envVar: 'STAGING_UAT_OUTSIDER_PASSWORD' },
];

async function ensureUser(email, name) {
  // Register (idempotent: 409 means it already exists — fine).
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password: PW }),
  });
  if (reg.status !== 409 && !reg.ok) throw new Error(`register ${email} -> ${reg.status} ${(await reg.text()).slice(0, 160)}`);

  // Log in to obtain an authoritative session token + user.
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  if (!login.ok) throw new Error(`login ${email} -> ${login.status} ${(await login.text()).slice(0, 160)}`);
  return login.json(); // { user, token }
}

function storageState(webOrigin, user, token) {
  // Mirror how the SPA persists auth so a Playwright context starts already signed in.
  return {
    cookies: [],
    origins: [{
      origin: webOrigin,
      localStorage: [
        { name: 'carup_token', value: token },
        { name: 'carup_user', value: JSON.stringify(user) },
      ],
    }],
  };
}

async function main() {
  const webOrigin = (process.env.STAGING_WEB_URL || 'https://carup-staging.vercel.app').replace(/\/$/, '');
  mkdirSync('.staging-auth', { recursive: true });
  for (const id of IDS) {
    const name = `UAT ${id.role} [${RUN}]`;
    let { user, token } = await ensureUser(id.email, name);
    if (id.switchRole) {
      const sw = await fetch(`${API}/auth/switch-role`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-session-token': token, 'x-user-id': user.id, 'x-stakeholder-role': user.role },
        body: JSON.stringify({ userId: user.id, role: id.switchRole }),
      });
      if (!sw.ok) throw new Error(`switch-role ${id.email} -> ${sw.status} ${(await sw.text()).slice(0, 160)}`);
      const swBody = await sw.json();
      if (swBody.token) token = swBody.token;
      if (swBody.user) user = swBody.user; else user = { ...user, role: id.switchRole };
      console.log(`  switched ${id.role} active role -> ${user.role}`);
    }
    writeFileSync(`.staging-auth/${id.role}.json`, JSON.stringify(storageState(webOrigin, user, token), null, 2));
    console.log(`  provisioned ${id.role}: ${id.email} (role=${user.role}, id=${user.id})`);
  }
  writeFileSync('.staging-auth/.password', PW, { mode: 0o600 });
  chmodSync('.staging-auth/.password', 0o600);
  console.log('\nStorage states written to .staging-auth/ (gitignored; includes .password, 0600).');
  console.log('Export STAGING_UAT_BUYER_PASSWORD / _SELLER_ / _OUTSIDER_ (same value as STAGING_UAT_PASSWORD) for the Playwright run.');
  console.log('\nNOTE: reviewer / tenant-admin identities are NOT provisionable via public registration');
  console.log('      (fail-closed to owner). Provide them from the release-operator session (admin bootstrap or DB).');
}
main().catch((e) => { console.error('IDENTITY PROVISIONING FAILED:', e.message); process.exit(1); });
