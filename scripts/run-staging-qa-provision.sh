#!/usr/bin/env bash
#
# Local STAGING-ONLY runbook — provision + verify the 3 Marketplace v1 QA accounts (PR #73).
#
# Run from the CarUp repo root, in an interactive terminal:
#   export SUPABASE_DB_URL='<STAGING eoyenigwevnxwwhyhaer Session Pooler URL>'   # set in YOUR shell, not here
#   bash scripts/run-staging-qa-provision.sh                                     # use `bash`, do not `source`
#
# Guarantees:
#   - SUPABASE_DB_URL is read ONLY from your shell env (never pasted, prompted, or printed).
#   - Refuses the production project ref (vhmnajoeicasaigiophh); the provisioning script additionally
#     enforces the exact staging ref (eoyenigwevnxwwhyhaer) and refuses everything else.
#   - Prompts for three UNIQUE passwords with no echo; validates length + uniqueness.
#   - Never prints or persists any password, hash, or DB URL.
#   - Output is ONLY the three account emails and a PASS/FAIL verification summary.
#   - Does not touch production. Does not commit or merge anything.
#
set -euo pipefail
trap 'unset QA_BUYER_PASSWORD QA_SELLER_PASSWORD QA_ADMIN_PASSWORD 2>/dev/null || true' EXIT

# 1) DB URL must come from the local shell env only.
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the STAGING (eoyenigwevnxwwhyhaer) Session Pooler URL in your shell, then re-run.}"
case "$SUPABASE_DB_URL" in
  *vhmnajoeicasaigiophh*) echo "ABORT: SUPABASE_DB_URL targets the PRODUCTION project. Refusing."; exit 1 ;;
esac

# 2) Prompt for three UNIQUE strong passwords (no echo).
read -rsp 'Buyer  password (min 12 chars): ' QA_BUYER_PASSWORD;  echo
read -rsp 'Seller password (min 12 chars): ' QA_SELLER_PASSWORD; echo
read -rsp 'Admin  password (min 12 chars): ' QA_ADMIN_PASSWORD;  echo
export QA_BUYER_PASSWORD QA_SELLER_PASSWORD QA_ADMIN_PASSWORD
for v in QA_BUYER_PASSWORD QA_SELLER_PASSWORD QA_ADMIN_PASSWORD; do
  val="${!v}"
  if [ "${#val}" -lt 12 ]; then echo "ABORT: $v must be at least 12 characters."; exit 1; fi
done
if [ "$QA_BUYER_PASSWORD" = "$QA_SELLER_PASSWORD" ] || \
   [ "$QA_BUYER_PASSWORD" = "$QA_ADMIN_PASSWORD" ]  || \
   [ "$QA_SELLER_PASSWORD" = "$QA_ADMIN_PASSWORD" ]; then
  echo "ABORT: the three passwords must be unique per role."; exit 1
fi

# 3) Provision (enforces staging ref eoyenigwevnxwwhyhaer; refuses production; never logs a password/hash).
#    Suppress its stdout so the only meaningful output is the verification summary below; errors still
#    surface on stderr and abort via `set -e`.
echo "Provisioning QA accounts on staging..." >&2
node scripts/provision-staging-qa-accounts.mjs >/dev/null

# 4) Verify accounts + roles + ownership + login. Prints ONLY emails and PASS/FAIL.
node --input-type=module <<'NODE'
import pg from 'pg';

const DB = process.env.SUPABASE_DB_URL;
const BE = 'https://carup-backend-staging-git-feature-marke-6e59d7-pay-pass-project.vercel.app';
const ACCOUNTS = [
  { id: 'qa-staging-buyer-73',  email: 'qa-buyer-73@staging.carup.local',  role: 'owner',  pwEnv: 'QA_BUYER_PASSWORD' },
  { id: 'qa-staging-seller-73', email: 'qa-seller-73@staging.carup.local', role: 'owner',  pwEnv: 'QA_SELLER_PASSWORD' },
  { id: 'qa-staging-admin-73',  email: 'qa-admin-73@staging.carup.local',  role: 'admin',  pwEnv: 'QA_ADMIN_PASSWORD' },
];
const QA_VINS = ['JTDKARFP0H3000731', 'MAJFP1CD0HC000733', 'WBA8E9C50HK000732'];
const results = [];
const add = (label, pass) => results.push([label, !!pass]);

const client = new pg.Client({ connectionString: DB });
try {
  await client.connect();
  const ids = ACCOUNTS.map((a) => a.id);
  const { rows } = await client.query(
    'select id, role, (password_hash is not null) as has_pw from users where id = any($1::text[])', [ids]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const a of ACCOUNTS) {
    const r = byId[a.id];
    add(`account exists: ${a.email}`, !!r);
    add(`  role == ${a.role}`, r && r.role === a.role);
    add('  password_hash is set', r && r.has_pw === true);
  }
  const { rows: sv } = await client.query(
    'select vin from vehicles where owner_id = $1 order by vin', ['qa-staging-seller-73']);
  const sellerVins = sv.map((r) => r.vin).sort();
  add('seller owns exactly the 3 QA listings', JSON.stringify(sellerVins) === JSON.stringify([...QA_VINS].sort()));
  const { rows: ba } = await client.query(
    'select count(*)::int as c from vehicles where owner_id = any($1::text[])', [['qa-staging-buyer-73', 'qa-staging-admin-73']]);
  add('buyer/admin own no listings', ba[0].c === 0);
} catch (err) {
  add(`DB verification (code ${err.code || 'error'})`, false); // err has no password
} finally {
  try { await client.end(); } catch { /* ignore */ }
}

for (const a of ACCOUNTS) {
  let ok = false;
  try {
    const res = await fetch(`${BE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: a.email, password: process.env[a.pwEnv] || '' }),
    });
    ok = res.status === 200;
  } catch { ok = false; }
  add(`login 200: ${a.email}`, ok);
}

let allPass = true;
console.log('\n=== Staging QA provisioning — verification summary ===');
console.log('Accounts: ' + ACCOUNTS.map((a) => a.email).join(', '));
for (const [label, pass] of results) { if (!pass) allPass = false; console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); }
console.log(`\nOVERALL: ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
NODE
