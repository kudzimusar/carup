#!/usr/bin/env node
// CARUP-PAY-03B-LR01 Level 2 — provision EXACTLY the Owner-authorized Stripe SANDBOX objects, once.
// Run only by scripts/uat/pay03b-local-runtime.sh (--stripe-sandbox), which passes the sk_test key in the
// environment (never argv, never printed). Authorized scope (owner-decision-level2.json): 1 Product, 1 monthly
// Price (JPY 500, sandbox test plan, not a tariff), 1 test clock. Idempotent: a recorded object is re-verified and
// reused, never created twice. Registers the sandbox plan version in the dedicated PAY-03B local database.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import Stripe from 'stripe';

const ACCOUNT = 'acct_1UVnGaEjgXqvlsJk';
const EVIDENCE = `${homedir()}/carup-launch-evidence/pay03b`;
const DECISION = JSON.parse(readFileSync(`${EVIDENCE}/owner-decision-level2.json`, 'utf8'));
const RECORD = `${EVIDENCE}/level2-provisioning.json`;
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres';
const fail = (m) => { console.error(`PAY-03B Level 2 provisioning: ${m}`); process.exit(1); };

if (DECISION?.decisions?.level2_stripe_sandbox_rehearsal !== 'Authorize exact scope (Recommended)') fail('no recorded Owner authorization.');
const key = process.env.PAY03B_STRIPE_SECRET || '';
if (!key.startsWith('sk_test_')) fail('a test-only secret key is required.');
const stripe = new Stripe(key);
const account = await stripe.accounts.retrieve();
if (account?.id !== ACCOUNT) fail('the key does not belong to the authorized CarUp Japan sandbox account.');

const sql = (q) => execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
if (sql("select count(*) from carup_uat.migration_ledger where version = 'local-alignment:pay03b-001-enable-local-provider-simulator'") !== '1') {
  fail('the dedicated PAY-03B local database is not present.');
}

let record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : null;
if (record?.productId && record?.priceId && record?.clockId) {
  const [product, price, clock] = await Promise.all([stripe.products.retrieve(record.productId), stripe.prices.retrieve(record.priceId),
    stripe.testHelpers.testClocks.retrieve(record.clockId)]);
  if (product.livemode || price.livemode || clock.livemode || price.unit_amount !== 500 || price.currency !== 'jpy'
    || price.recurring?.interval !== 'month' || price.product !== product.id) fail('recorded objects no longer match the authorized scope.');
  console.log(`reusing recorded sandbox objects (product ${product.id}, price ${price.id}, clock ${clock.id}, status ${clock.status})`);
} else {
  const metadata = { carup_programme: 'PAY-03B', carup_environment: 'sandbox', carup_product_code: 'mkt.dealer.storefront_package',
    carup_note: 'Owner-authorized Level 2 rehearsal; sandbox test plan, not a tariff' };
  const product = await stripe.products.create({ name: 'CarUp Dealer Storefront — SANDBOX TEST PLAN (PAY-03B rehearsal, not a tariff)', metadata },
    { idempotencyKey: 'carup_pay03b_l2_product_v1' });
  const price = await stripe.prices.create({ product: product.id, currency: 'jpy', unit_amount: 500,
    recurring: { interval: 'month', interval_count: 1 }, metadata }, { idempotencyKey: 'carup_pay03b_l2_price_v1' });
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000),
    name: 'CarUp PAY-03B Level 2 rehearsal' }, { idempotencyKey: 'carup_pay03b_l2_clock_v1' });
  if (product.livemode || price.livemode || clock.livemode) fail('a live object was returned; stopping.');
  record = { recorded_at: new Date().toISOString(), accountId: ACCOUNT, productId: product.id, priceId: price.id,
    clockId: clock.id, clockFrozenTime: clock.frozen_time, unitAmountMinor: 500, currency: 'JPY', interval: 'month' };
  writeFileSync(RECORD, JSON.stringify(record, null, 2), { mode: 0o600 });
  console.log(`created sandbox objects: product ${product.id}, price ${price.id}, test clock ${clock.id}`);
}
const existing = sql(`select count(*) from public.pay03b_subscription_plans where provider_price_ref = '${record.priceId}'`);
if (existing === '0') {
  sql(`select public.pay03b_register_sandbox_plan_version('dealer_storefront_stripe_sandbox_l2', 'mkt.dealer.storefront_package',
    'dealer_storefront', 'dealer_organization', 10, 'Storefront Standard — Stripe SANDBOX test plan (JPY 500)', 'sandbox_fixture',
    'month', 1::smallint, 500, 'JPY', 0::smallint, 'stripe_carup_japan_sandbox', '${record.priceId}',
    '{"dealer.inventory.published_listing_capacity":10}'::jsonb, NULL, NULL, NULL, NULL, 'governed_admin_refund',
    'OWNER-DECISION-PAY03B-L2-${DECISION.recorded_at}', 'Owner (AskUserQuestion, CARUP-PAY-03B-LR01)', 'scripts/uat/pay03b-stripe-sandbox-provision.mjs')`);
  console.log('registered sandbox plan dealer_storefront_stripe_sandbox_l2 (JPY 500/month, capacity 10)');
}
writeFileSync(`${EVIDENCE}/level2-clock-id`, record.clockId, { mode: 0o600 });
