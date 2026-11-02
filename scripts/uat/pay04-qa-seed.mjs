#!/usr/bin/env node
// CARUP-PAY-04-LR01 — QA seed for the DEDICATED PAY-04 local UAT stack (127.0.0.1:56322 / backend 127.0.0.1:5051).
// Synthetic QA identities only (reserved `.invalid` TLD). Nothing here is, or may be reported as, a real garage, a real
// customer, a real price or a real payment.
//
// Product paths are used wherever the product has one: login (registration: see the AUTH-05 note below); the simulated garage merchant account
// (operator route); the garage's payment instructions (garage-admin route). Garage onboarding is certified by GMO-1..8
// and is not under test here, so the rows it produces (garage tenant, membership, branch, workforce, published public
// profile) and the customers' vehicles are seeded in SQL, the same way the PAY-03B seed seeds tenants.
//
//   node scripts/uat/pay04-qa-seed.mjs            (idempotent; accounts persisted 0600 outside the repository)
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ACCOUNTS_FILE, API, AUTHORITY, EVIDENCE_DIR, call, identity, lit, login, requirePay04UatDatabase, sql } from './pay04-uat-lib.mjs';
import { hashPassword } from '../../backend/utils/passwordAuth.js';

mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });

// The database must be the one scripts/uat/pay04-local-db-build.sh built (ledger-proven), never another stack.
requirePay04UatDatabase();
const health = await (await fetch(`${API}/api/health`)).json();
console.log(`[runtime] backend ${API} commit ${health?.build?.commit_sha || 'unknown'}`);

const DEFS = {
  adminA: { name: 'PAY04 Garage A Admin [QA]', email: 'pay04.garage.a.admin@carup-uat.invalid', role: 'owner' },
  mechA: { name: 'PAY04 Garage A Mechanic [QA]', email: 'pay04.garage.a.mech@carup-uat.invalid', role: 'owner' },
  adminB: { name: 'PAY04 Garage B Admin [QA]', email: 'pay04.garage.b.admin@carup-uat.invalid', role: 'owner' },
  mechB: { name: 'PAY04 Garage B Mechanic [QA]', email: 'pay04.garage.b.mech@carup-uat.invalid', role: 'owner' },
  customer: { name: 'PAY04 Customer [QA]', email: 'pay04.customer@carup-uat.invalid', role: 'owner' },
  stranger: { name: 'PAY04 Other Customer [QA]', email: 'pay04.stranger@carup-uat.invalid', role: 'owner' },
  ops: { name: 'PAY04 Payments Operations Admin [QA]', email: 'pay04.ops.admin@carup-uat.invalid', role: 'admin' },
};
const accounts = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : {};
for (const [key, def] of Object.entries(DEFS)) accounts[key] ||= { ...def, password: randomBytes(18).toString('base64url') };

// Public registration (POST /api/auth/register) is ONE statement on the CA-K3-AUTH-05 dedicated session authority, whose
// pool is TLS-pinned to Supabase's CA and so cannot connect to a local stack (by design; production-only). The synthetic
// accounts are therefore created here with the backend's OWN password hashing, and every session below is minted by the
// real POST /api/auth/login (the AUTH-05 local/test session adapter, disabled in every declared deployment).
for (const key of Object.keys(DEFS)) {
  const acct = accounts[key];
  const exists = sql(`select count(*) from public.users where email = ${lit(acct.email)}`) === '1';
  if (!exists) {
    const id = `p4qa_${key.toLowerCase()}_${randomBytes(4).toString('hex')}`;
    const hash = await hashPassword(acct.password);
    sql(`insert into public.users (id, name, email, role, join_date, password_hash, is_verified)
         values (${lit(id)}, ${lit(acct.name)}, ${lit(acct.email)}, ${lit(acct.role)}, current_date, ${lit(hash)}, true)`);
  }
  sql(`update public.users set role = ${lit(acct.role)}, is_verified = true where email = ${lit(acct.email)} and role is distinct from ${lit(acct.role)}`);
  acct.userId = sql(`select id from public.users where email = ${lit(acct.email)}`);
  console.log(`[account] ${key}: ${acct.userId} role=${acct.role}`);
}

// ── the garages (GMO-certified onboarding outcome, seeded) ──
accounts.garageA ||= randomUUID();
accounts.garageB ||= randomUUID();
for (const [g, name, slug, admin, mech, code] of [
  [accounts.garageA, 'PAY04 QA Garage A [QA]', 'pay04-qa-garage-a', accounts.adminA, accounts.mechA, 'P4QA-A'],
  [accounts.garageB, 'PAY04 QA Garage B [QA]', 'pay04-qa-garage-b', accounts.adminB, accounts.mechB, 'P4QA-B'],
]) {
  sql(`insert into public.tenants (id, name, type, status) values (${lit(g)}, ${lit(name)}, 'garage', 'active') on conflict (id) do nothing`);
  sql(`insert into public.tenant_users (tenant_id, user_id, role) values (${lit(g)}, ${lit(admin.userId)}, 'admin'), (${lit(g)}, ${lit(mech.userId)}, 'admin')
       on conflict (tenant_id, user_id) do nothing`);
  let branch = sql(`select coalesce((select id::text from public.garage_branches where tenant_id = ${lit(g)} limit 1), '')`);
  if (!branch) {
    branch = sql(`insert into public.garage_branches (tenant_id, name, branch_code, timezone, is_active)
      values (${lit(g)}, ${lit(name.replace(' [QA]', '') + ' Central')}, ${lit(code)}, 'Africa/Harare', true) returning id`).split('\n')[0];
  }
  for (let day = 0; day <= 6; day += 1) {
    sql(`insert into public.garage_branch_opening_hours (tenant_id, branch_id, day_of_week, is_closed, opens_at, closes_at)
      select ${lit(g)}, ${lit(branch)}, ${day}, false, '07:00', '19:00'
      where not exists (select 1 from public.garage_branch_opening_hours where branch_id = ${lit(branch)} and day_of_week = ${day})`);
  }
  if (sql(`select count(*) from public.garage_workforce_profiles where tenant_id = ${lit(g)} and user_id = ${lit(mech.userId)}`) === '0') {
    const profile = sql(`insert into public.garage_workforce_profiles (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, created_by_user_id)
      values (${lit(g)}, ${lit(mech.userId)}, ${lit(code + '-M1')}, 'employee', 'active', '2026-10-01', ${lit(admin.userId)}) returning id`).split('\n')[0];
    sql(`insert into public.garage_workforce_branch_assignments (tenant_id, workforce_profile_id, branch_id, is_primary, assigned_by_user_id)
      values (${lit(g)}, ${lit(profile)}, ${lit(branch)}, true, ${lit(admin.userId)})`);
  }
  sql(`update public.tenant_users set role = 'mechanic' where tenant_id = ${lit(g)} and user_id = ${lit(mech.userId)} and role <> 'mechanic'`);
  sql(`insert into public.garage_public_profiles (tenant_id, display_name, slug, publication_status, location_city, service_categories, published_at, created_by_user_id)
       values (${lit(g)}, ${lit(name.replace(' [QA]', ''))}, ${lit(slug)}, 'published', 'Harare', '{brakes,servicing}', now(), ${lit(admin.userId)})
       on conflict (tenant_id) do nothing`);
  accounts[g === accounts.garageA ? 'branchA' : 'branchB'] = branch;
}

// ── the customers' vehicles ──
accounts.vinCustomer ||= `P4QA${randomBytes(4).toString('hex').toUpperCase()}00001`.slice(0, 17);
accounts.vinStranger ||= `P4QB${randomBytes(4).toString('hex').toUpperCase()}00002`.slice(0, 17);
sql(`insert into public.vehicles (vin, make, model, year, mileage, price, owner_id) values
  (${lit(accounts.vinCustomer)}, 'Toyota', 'Hilux', 2019, 92000, 1, ${lit(accounts.customer.userId)}),
  (${lit(accounts.vinStranger)}, 'Honda', 'Fit', 2020, 41000, 1, ${lit(accounts.stranger.userId)}) on conflict (vin) do nothing`);

// ── sessions (product login) ──
const tokens = {};
for (const key of Object.keys(DEFS)) { tokens[key] = await login(accounts[key]); console.log(`[login] ${key}: ok`); }

// ── the garage's simulated merchant (operator product path) and payment instructions (garage-admin product path) ──
const merchantRef = 'gsim_merchant_pay04_qa_garage_a';
if (sql(`select count(*) from public.pay04_garage_merchant_accounts where merchant_reference = ${lit(merchantRef)}`) === '0') {
  const r = await call('POST', '/api/pay04/admin/merchant-accounts', {
    tenant_id: accounts.garageA, merchant_reference: merchantRef, display_name: 'PAY04 QA Garage A (simulated merchant)',
    currencies: ['USD'], authority_note: `${AUTHORITY}: local simulator merchant for physical UAT only`,
  }, identity(accounts.ops, tokens.ops));
  if (r.status !== 201) throw new Error(`merchant registration failed: ${r.status} ${JSON.stringify(r.json)}`);
  console.log(`[merchant] registered ${r.json.account.id} (${r.json.account.status})`);
}
const instructions = await call('PUT', '/api/pay04/garage/payment-instructions', {
  payee_name: 'PAY04 QA Garage A (Pvt) Ltd',
  instructions: 'Pay at the front desk in cash, or by EcoCash / bank transfer quoting your invoice number. Ask for a receipt.',
  accepted_methods: ['cash', 'mobile_money', 'bank_transfer'], currencies: ['USD'],
}, identity(accounts.adminA, tokens.adminA, accounts.garageA));
if (instructions.status !== 200) throw new Error(`instructions failed: ${instructions.status} ${JSON.stringify(instructions.json)}`);
console.log(`[instructions] garage A version ${instructions.json.active.version}`);

writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), { mode: 0o600 });
writeFileSync(`${EVIDENCE_DIR}/qa-seed-summary.json`, JSON.stringify({
  recorded_at: new Date().toISOString(), authority: AUTHORITY, backend_commit: health?.build?.commit_sha || null,
  garages: { A: accounts.garageA, B: accounts.garageB }, merchant_reference: merchantRef,
  users: Object.fromEntries(Object.keys(DEFS).map((k) => [k, { userId: accounts[k].userId, role: accounts[k].role }])),
}, null, 2), { mode: 0o600 });
console.log('QA seed complete.');
