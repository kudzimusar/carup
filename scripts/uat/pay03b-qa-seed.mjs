#!/usr/bin/env node
// CARUP-PAY-03B-LR01 — QA seed for the DEDICATED PAY-03B local UAT stack (127.0.0.1:55422 / backend 127.0.0.1:5041).
// Synthetic QA identities only (reserved `.invalid` TLD). Nothing here is, or may be reported as, a real dealer,
// a real price or a real payment.
//
// Product paths are used wherever the product has one (registration, login). Tenants, legal organizations and
// tenant memberships have NO product creation path on this branch (finding: no onboarding path creates them),
// so they are seeded in SQL. Platform roles are elevated in SQL exactly like the PAY-03A seed. Simulator plans are
// registered through the governed RPC under the Level-1 authority of the Moderator directive (local simulator,
// no provider, no money) with explicitly labelled fixture values.
//
//   node scripts/uat/pay03b-qa-seed.mjs            (idempotent; accounts persisted 0600 outside the repository)
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const API = 'http://127.0.0.1:5041';
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres';
const EVIDENCE_DIR = `${homedir()}/carup-launch-evidence/pay03b`;
const ACCOUNTS_FILE = `${EVIDENCE_DIR}/uat-accounts.json`;
const AUTHORITY = 'MODERATOR-CARUP-PAY-03B-LR01-LEVEL1-LOCAL-SIMULATOR';
mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });

function sql(statement) {
  return execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
}
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

// The database must be the one scripts/uat/pay03b-local-db-build.sh built (ledger-proven), never another stack.
if (sql("select count(*) from carup_uat.migration_ledger where version = 'local-alignment:pay03b-001-enable-local-provider-simulator'") !== '1') {
  throw new Error('refusing: target is not the PAY-03B local UAT database built by pay03b-local-db-build.sh');
}
const health = await (await fetch(`${API}/api/health`)).json();
console.log(`[runtime] backend ${API} commit ${health?.build?.commit_sha || 'unknown'}`);

const DEFS = {
  dealerA: { name: 'PAY03B Dealer A Billing Admin [QA]', email: 'pay03b.dealer.a.billing@carup-uat.invalid', role: 'dealer' },
  dealerAStaff: { name: 'PAY03B Dealer A Sales Staff [QA]', email: 'pay03b.dealer.a.staff@carup-uat.invalid', role: 'dealer' },
  dealerB: { name: 'PAY03B Dealer B Billing Admin [QA]', email: 'pay03b.dealer.b.billing@carup-uat.invalid', role: 'dealer' },
  // Reserved for the Owner-authorized Level 2 Stripe sandbox rehearsal (kept apart from simulator subscriptions).
  dealerC: { name: 'PAY03B Dealer C Billing Admin [QA, Stripe sandbox rehearsal]', email: 'pay03b.dealer.c.billing@carup-uat.invalid', role: 'dealer' },
  ops: { name: 'PAY03B Commerce Operations Admin [QA]', email: 'pay03b.ops.admin@carup-uat.invalid', role: 'admin' },
};
const accounts = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : {};
for (const [key, def] of Object.entries(DEFS)) accounts[key] ||= { ...def, password: randomBytes(18).toString('base64url') };

// Same contract as the web client: a CSRF token fetched with the same identity headers accompanies every write.
async function csrf(identity = {}) {
  const res = await fetch(`${API}/api/security/csrf-token`, { headers: identity });
  const body = await res.json();
  if (!body?.csrfToken) throw new Error(`csrf token unavailable (${res.status})`);
  return body.csrfToken;
}

async function call(method, path, body, identity = {}) {
  const headers = { ...identity, 'content-type': 'application/json' };
  if (method !== 'GET') headers['x-csrf-token'] = await csrf(identity);
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

for (const [key, acct] of Object.entries(accounts)) {
  const exists = sql(`select count(*) from public.users where email = ${lit(acct.email)}`) === '1';
  if (!exists) {
    const r = await call('POST', '/api/auth/register', { name: acct.name, email: acct.email, password: acct.password });
    if (r.status >= 300) throw new Error(`register ${key} failed: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  }
  sql(`update public.users set role = ${lit(acct.role)}, is_verified = true where email = ${lit(acct.email)} and role is distinct from ${lit(acct.role)}`);
  acct.userId = sql(`select id from public.users where email = ${lit(acct.email)}`);
  console.log(`[account] ${key}: ${acct.userId} role=${acct.role}`);
}

accounts.tenantA ||= randomUUID();
accounts.tenantB ||= randomUUID();
accounts.tenantC ||= randomUUID();
accounts.orgA ||= 'org_pay03b_qa_dealer_a';
accounts.orgB ||= 'org_pay03b_qa_dealer_b';
accounts.orgC ||= 'org_pay03b_qa_dealer_c';
sql(`insert into public.tenants (id, name, type, status) values
  (${lit(accounts.tenantA)}, 'PAY03B QA Dealer A [QA]', 'dealership', 'active'),
  (${lit(accounts.tenantB)}, 'PAY03B QA Dealer B [QA]', 'dealership', 'active'),
  (${lit(accounts.tenantC)}, 'PAY03B QA Dealer C [QA]', 'dealership', 'active') on conflict (id) do nothing`);
sql(`insert into public.organizations (id, name, type, created_at, status, tenant_id) values
  (${lit(accounts.orgA)}, 'PAY03B QA Dealer A Motors Ltd [QA]', 'dealership', '2026-11-01', 'active', ${lit(accounts.tenantA)}),
  (${lit(accounts.orgB)}, 'PAY03B QA Dealer B Autos Ltd [QA]', 'dealership', '2026-11-01', 'active', ${lit(accounts.tenantB)}),
  (${lit(accounts.orgC)}, 'PAY03B QA Dealer C Cars Ltd [QA]', 'dealership', '2026-11-01', 'active', ${lit(accounts.tenantC)})
  on conflict (id) do nothing`);
sql(`insert into public.tenant_users (tenant_id, user_id, role) values
  (${lit(accounts.tenantA)}, ${lit(accounts.dealerA.userId)}, 'admin'),
  (${lit(accounts.tenantA)}, ${lit(accounts.dealerAStaff.userId)}, 'dealer'),
  (${lit(accounts.tenantB)}, ${lit(accounts.dealerB.userId)}, 'admin'),
  (${lit(accounts.tenantC)}, ${lit(accounts.dealerC.userId)}, 'admin') on conflict (tenant_id, user_id) do nothing`);

function registerPlan(code, { kind, tier, amount, price, capacity, cancellation = null, display }) {
  const current = sql(`select coalesce((select id::text from public.pay03b_subscription_plans where plan_code = ${lit(code)} and effective_to is null), '')`);
  if (current) return current;
  return sql(`select (public.pay03b_register_sandbox_plan_version(
    ${lit(code)}, 'mkt.dealer.storefront_package', 'dealer_storefront', 'dealer_organization', ${tier}, ${lit(display)},
    ${lit(kind)}, ${kind === 'free' ? 'NULL' : "'month'"}, ${kind === 'free' ? 'NULL' : '1::smallint'}, ${amount}, 'JPY', 0::smallint,
    ${kind === 'free' ? 'NULL' : "'pay03b_local_provider_simulator'"}, ${price ? lit(price) : 'NULL'},
    jsonb_build_object('dealer.inventory.published_listing_capacity', ${capacity}), NULL, NULL, NULL,
    ${cancellation ? lit(JSON.stringify(cancellation)) + '::jsonb' : 'NULL'}, 'governed_admin_refund',
    ${lit(AUTHORITY)}, 'Moderator directive CARUP-PAY-03B-LR01 (Level 1)', 'scripts/uat/pay03b-qa-seed.mjs')->>'id')`);
}
accounts.plans = {
  baseline: registerPlan('dealer_storefront_sandbox_baseline', { kind: 'free', tier: 0, amount: 0, capacity: 3,
    display: 'Free baseline (local simulator fixture)' }),
  standard: registerPlan('dealer_storefront_simulator_standard', { kind: 'sandbox_fixture', tier: 10, amount: 3000,
    price: 'sim_price_pay03b_uat_standard', capacity: 10, display: 'Storefront Standard (simulator test plan)' }),
  premium: registerPlan('dealer_storefront_simulator_premium', { kind: 'sandbox_fixture', tier: 20, amount: 6000,
    price: 'sim_price_pay03b_uat_premium', capacity: 25, cancellation: { period_end: true, immediate: true },
    display: 'Storefront Premium (simulator test plan)' }),
};
console.log('[plans]', JSON.stringify(accounts.plans));

for (const [key, acct] of Object.entries(accounts)) {
  if (!acct?.email) continue;
  const r = await call('POST', '/api/auth/login', { email: acct.email, password: acct.password });
  if (r.status !== 200 || !r.json?.token) throw new Error(`login ${key} failed: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  console.log(`[login] ${key}: ok active_tenant=${r.json?.user?.active_tenant_id || 'none'}`);
}
writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), { mode: 0o600 });
writeFileSync(`${EVIDENCE_DIR}/qa-seed-summary.json`, JSON.stringify({
  recorded_at: new Date().toISOString(), authority: AUTHORITY, tenants: { A: accounts.tenantA, B: accounts.tenantB },
  organizations: { A: accounts.orgA, B: accounts.orgB }, plans: accounts.plans,
  users: Object.fromEntries(Object.entries(DEFS).map(([k]) => [k, { userId: accounts[k].userId, role: accounts[k].role }])),
}, null, 2));
console.log('QA seed complete.');
