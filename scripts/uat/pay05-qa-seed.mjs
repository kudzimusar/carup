#!/usr/bin/env node
// CARUP-PAY-05-LR01 — QA seed for the PAY-05 local UAT (dedicated carup-pay04-supabase stack 127.0.0.1:56322, backend
// 127.0.0.1:5051, LOCAL PAYNOW PROTOCOL SIMULATOR 127.0.0.1:5061). Synthetic QA identities only (reserved `.invalid` TLD).
// Nothing here is, or may be reported as, a real garage, a real customer, a real Paynow merchant or a real payment.
//
// Seeded in SQL (certified elsewhere, not under test here, exactly as the PAY-04 seed): the synthetic users (the backend's
// own password hashing), the garages' GMO-certified onboarding outcome (tenant, membership, branch, workforce, published
// profile) and the customers' vehicles. Sessions come from the real POST /api/auth/login.
//
// The Paynow integrations are what PAY-05 is about, so the seed only OBTAINS them — from the simulator, as a garage would
// obtain its integration ID and key from Paynow — and keeps them 0600 in ~/carup-launch-evidence/pay05/runtime (never in
// the repository, never in published evidence). Connecting and verifying them is done through the product's routes by
// the HTTP matrix and the browser spec, as cases.
//
//   node scripts/uat/pay05-qa-seed.mjs            (idempotent per simulator run; accounts persisted 0600)
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ACCOUNTS_FILE, API, AUTHORITY, EVIDENCE_DIR, lit, login, requirePay05UatDatabase, simControl, sql } from './pay05-uat-lib.mjs';
import { hashPassword } from '../../backend/utils/passwordAuth.js';

mkdirSync(`${EVIDENCE_DIR}/runtime`, { recursive: true, mode: 0o700 });
const INTEGRATIONS_FILE = `${EVIDENCE_DIR}/runtime/simulated-integrations.json`;

requirePay05UatDatabase();
const health = await (await fetch(`${API}/api/health`)).json();
console.log(`[runtime] backend ${API} commit ${health?.build?.commit_sha || 'unknown'}`);

const DEFS = {
  adminA: { name: 'PAY05 Garage A Admin [QA]', email: 'pay05.garage.a.admin@carup-uat.invalid', role: 'owner' },
  mechA: { name: 'PAY05 Garage A Mechanic [QA]', email: 'pay05.garage.a.mech@carup-uat.invalid', role: 'owner' },
  adminB: { name: 'PAY05 Garage B Admin [QA]', email: 'pay05.garage.b.admin@carup-uat.invalid', role: 'owner' },
  mechB: { name: 'PAY05 Garage B Mechanic [QA]', email: 'pay05.garage.b.mech@carup-uat.invalid', role: 'owner' },
  adminC: { name: 'PAY05 Garage C Admin [QA]', email: 'pay05.garage.c.admin@carup-uat.invalid', role: 'owner' },
  mechC: { name: 'PAY05 Garage C Mechanic [QA]', email: 'pay05.garage.c.mech@carup-uat.invalid', role: 'owner' },
  customer: { name: 'PAY05 Customer [QA]', email: 'pay05.customer@carup-uat.invalid', role: 'owner' },
  stranger: { name: 'PAY05 Other Customer [QA]', email: 'pay05.stranger@carup-uat.invalid', role: 'owner' },
  ops: { name: 'PAY05 Payments Operations Admin [QA]', email: 'pay05.ops.admin@carup-uat.invalid', role: 'admin' },
  // a platform administrator who is ALSO a member of garage A: separation of duties forbids them verifying garage A
  opsMemberA: { name: 'PAY05 Ops Admin, Garage A Member [QA]', email: 'pay05.ops.member.a@carup-uat.invalid', role: 'admin' },
};
const accounts = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : {};
for (const [key, def] of Object.entries(DEFS)) accounts[key] ||= { ...def, password: randomBytes(18).toString('base64url') };

for (const key of Object.keys(DEFS)) {
  const acct = accounts[key];
  if (sql(`select count(*) from public.users where email = ${lit(acct.email)}`) !== '1') {
    const id = `p5qa_${key.toLowerCase()}_${randomBytes(4).toString('hex')}`;
    const hash = await hashPassword(acct.password);
    sql(`insert into public.users (id, name, email, role, join_date, password_hash, is_verified)
         values (${lit(id)}, ${lit(acct.name)}, ${lit(acct.email)}, ${lit(acct.role)}, current_date, ${lit(hash)}, true)`);
  }
  sql(`update public.users set role = ${lit(acct.role)}, is_verified = true where email = ${lit(acct.email)} and role is distinct from ${lit(acct.role)}`);
  acct.userId = sql(`select id from public.users where email = ${lit(acct.email)}`);
  console.log(`[account] ${key}: ${acct.userId} role=${acct.role}`);
}

// ── the garages (GMO-certified onboarding outcome, seeded) ──
const GARAGES = [
  ['A', 'PAY05 QA Garage A [QA]', 'pay05-qa-garage-a', accounts.adminA, accounts.mechA, 'P5QA-A'],
  ['B', 'PAY05 QA Garage B [QA]', 'pay05-qa-garage-b', accounts.adminB, accounts.mechB, 'P5QA-B'],
  ['C', 'PAY05 QA Garage C [QA]', 'pay05-qa-garage-c', accounts.adminC, accounts.mechC, 'P5QA-C'],
];
for (const [letter, name, slug, admin, mech, codeName] of GARAGES) {
  const g = (accounts[`garage${letter}`] ||= randomUUID());
  sql(`insert into public.tenants (id, name, type, status) values (${lit(g)}, ${lit(name)}, 'garage', 'active') on conflict (id) do nothing`);
  sql(`insert into public.tenant_users (tenant_id, user_id, role) values (${lit(g)}, ${lit(admin.userId)}, 'admin'), (${lit(g)}, ${lit(mech.userId)}, 'admin')
       on conflict (tenant_id, user_id) do nothing`);
  let branch = sql(`select coalesce((select id::text from public.garage_branches where tenant_id = ${lit(g)} limit 1), '')`);
  if (!branch) {
    branch = sql(`insert into public.garage_branches (tenant_id, name, branch_code, timezone, is_active)
      values (${lit(g)}, ${lit(name.replace(' [QA]', '') + ' Harare')}, ${lit(codeName)}, 'Africa/Harare', true) returning id`).split('\n')[0];
  }
  for (let day = 0; day <= 6; day += 1) {
    sql(`insert into public.garage_branch_opening_hours (tenant_id, branch_id, day_of_week, is_closed, opens_at, closes_at)
      select ${lit(g)}, ${lit(branch)}, ${day}, false, '07:00', '19:00'
      where not exists (select 1 from public.garage_branch_opening_hours where branch_id = ${lit(branch)} and day_of_week = ${day})`);
  }
  if (sql(`select count(*) from public.garage_workforce_profiles where tenant_id = ${lit(g)} and user_id = ${lit(mech.userId)}`) === '0') {
    const profile = sql(`insert into public.garage_workforce_profiles (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, created_by_user_id)
      values (${lit(g)}, ${lit(mech.userId)}, ${lit(codeName + '-M1')}, 'employee', 'active', '2026-10-01', ${lit(admin.userId)}) returning id`).split('\n')[0];
    sql(`insert into public.garage_workforce_branch_assignments (tenant_id, workforce_profile_id, branch_id, is_primary, assigned_by_user_id)
      values (${lit(g)}, ${lit(profile)}, ${lit(branch)}, true, ${lit(admin.userId)})`);
  }
  sql(`update public.tenant_users set role = 'mechanic' where tenant_id = ${lit(g)} and user_id = ${lit(mech.userId)} and role <> 'mechanic'`);
  sql(`insert into public.garage_public_profiles (tenant_id, display_name, slug, publication_status, location_city, service_categories, published_at, created_by_user_id)
       values (${lit(g)}, ${lit(name.replace(' [QA]', ''))}, ${lit(slug)}, 'published', 'Harare', '{brakes,servicing}', now(), ${lit(admin.userId)})
       on conflict (tenant_id) do nothing`);
  accounts[`branch${letter}`] = branch;
}
// the operator who is also a garage A member (a non-admin membership is enough to forbid verifying garage A)
sql(`insert into public.tenant_users (tenant_id, user_id, role) values (${lit(accounts.garageA)}, ${lit(accounts.opsMemberA.userId)}, 'mechanic')
     on conflict (tenant_id, user_id) do nothing`);

// ── the customers' vehicles ──
accounts.vinCustomer ||= `P5QA${randomBytes(4).toString('hex').toUpperCase()}00001`.slice(0, 17);
accounts.vinStranger ||= `P5QB${randomBytes(4).toString('hex').toUpperCase()}00002`.slice(0, 17);
sql(`insert into public.vehicles (vin, make, model, year, mileage, price, owner_id) values
  (${lit(accounts.vinCustomer)}, 'Toyota', 'Corolla', 2018, 88000, 1, ${lit(accounts.customer.userId)}),
  (${lit(accounts.vinStranger)}, 'Nissan', 'NP300', 2021, 39000, 1, ${lit(accounts.stranger.userId)}) on conflict (vin) do nothing`);

// ── sessions (product login): proves every synthetic account can sign in ──
for (const key of Object.keys(DEFS)) { await login(accounts[key]); console.log(`[login] ${key}: ok`); }

// ── what Paynow would issue each garage: integration ID + key, one per currency (the simulator issues them) ──
// The simulator keeps integrations in memory, so they are re-issued whenever the simulator was restarted.
const want = {
  A_USD: { currency: 'USD', methods: ['web', 'ecocash', 'onemoney', 'innbucks', 'omari'], name: 'PAY05 QA Garage A USD (simulated Paynow integration)' },
  A_ZWG: { currency: 'ZWG', methods: ['web', 'ecocash', 'onemoney'], name: 'PAY05 QA Garage A ZWG (simulated Paynow integration)' },
  B_USD: { currency: 'USD', methods: ['web', 'ecocash'], name: 'PAY05 QA Garage B USD (simulated Paynow integration)' },
  C_USD: { currency: 'USD', methods: ['web', 'ecocash', 'onemoney', 'innbucks', 'omari'], name: 'PAY05 QA Garage C USD (simulated Paynow integration)' },
  C_ZWG: { currency: 'ZWG', methods: ['web', 'ecocash'], name: 'PAY05 QA Garage C ZWG (simulated Paynow integration)' },
};
// Issued afresh on every seed run: issuing is free, and a simulator restart loses them (the probe would then refuse).
const integrations = {};
for (const [k, spec] of Object.entries(want)) {
  const r = await simControl('POST', '/integrations', spec);
  integrations[k] = { integration_id: String(r.integrationId), integration_key: String(r.key),
    currency: spec.currency, methods: spec.methods };
  if (!/^[0-9]{1,12}$/.test(integrations[k].integration_id) || integrations[k].integration_key.length < 16) {
    throw new Error(`simulator issued an unexpected integration for ${k}`);
  }
  console.log(`[paynow-simulator] issued ${k}: integration ${integrations[k].integration_id} (${spec.currency}; ${spec.methods.join(', ')})`);
}
writeFileSync(INTEGRATIONS_FILE, JSON.stringify({ issued_at: new Date().toISOString(), integrations }, null, 2), { mode: 0o600 });

writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), { mode: 0o600 });
writeFileSync(`${EVIDENCE_DIR}/qa-seed-summary.json`, JSON.stringify({
  recorded_at: new Date().toISOString(), authority: AUTHORITY, backend_commit: health?.build?.commit_sha || null,
  garages: { A: accounts.garageA, B: accounts.garageB, C: accounts.garageC },
  simulated_integrations: Object.fromEntries(Object.entries(integrations).map(([k, v]) => [k, { integration_id: v.integration_id, currency: v.currency, methods: v.methods }])),
  users: Object.fromEntries(Object.keys(DEFS).map((k) => [k, { userId: accounts[k].userId, role: accounts[k].role }])),
}, null, 2), { mode: 0o600 });
console.log('QA seed complete.');
