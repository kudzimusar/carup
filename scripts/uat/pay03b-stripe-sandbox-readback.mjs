#!/usr/bin/env node
// CARUP-PAY-03B-LR01 Level 2 — INDEPENDENT, READ-ONLY provider readback of the Owner-authorized Stripe sandbox
// rehearsal, through the Owner's own Stripe CLI login (`stripe get` only: GET requests, never a create, update or
// delete). Independent of CarUp: it does not use the backend, its adapters or its database writers.
//
//   node scripts/uat/pay03b-stripe-sandbox-readback.mjs      (run by the Owner in a window where `stripe login` is done)
//
// Output (sanitized): object ids, amounts, currencies, statuses, billing reasons and periods. Never URLs, client
// secrets, customer contact details or payment-method/card details. Written 0600 to the evidence directory and checked
// against the recorded Owner scope: 1 Checkout, 2 charges of JPY 500, 1 refund, nothing live.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const ACCOUNT = 'acct_1UVnGaEjgXqvlsJk';
const EVIDENCE = `${homedir()}/carup-launch-evidence/pay03b`;
const RECORD = `${EVIDENCE}/level2-provisioning.json`;
const DECISION = `${EVIDENCE}/owner-decision-level2.json`;
const fail = (m) => { console.error(`PAY-03B Level 2 readback: ${m}`); process.exit(1); };

if (!existsSync(RECORD) || !existsSync(DECISION)) fail('the Level 2 provisioning record and the Owner decision must exist.');
const record = JSON.parse(readFileSync(RECORD, 'utf8'));
const decision = JSON.parse(readFileSync(DECISION, 'utf8'));

/** One read through the Stripe CLI (test mode; `get` is a GET request by construction). */
function get(path, params = {}) {
  const args = ['get', path];
  for (const [k, v] of Object.entries(params)) args.push('-d', `${k}=${v}`);
  let out;
  try { out = execFileSync('stripe', args, { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) { fail(`stripe get ${path} failed (${String(err.stderr || err.message).split('\n')[0].slice(0, 160)})`); }
  const json = JSON.parse(out);
  if (json?.error) fail(`stripe get ${path}: ${json.error.type || 'error'} ${json.error.code || ''}`.trim());
  return json;
}
const list = (path, params) => get(path, { limit: 100, ...params }).data || [];
const iso = (s) => (s === null || s === undefined ? null : new Date(Number(s) * 1000).toISOString());
const id = (v) => (typeof v === 'string' ? v : v?.id || null);

const account = get('/v1/account');
if (account.id !== ACCOUNT) fail('the Stripe CLI is not logged in to the authorized CarUp Japan sandbox account.');

const product = get(`/v1/products/${record.productId}`);
const price = get(`/v1/prices/${record.priceId}`);
const clock = get(`/v1/test_helpers/test_clocks/${record.clockId}`);
const customers = list('/v1/customers', { test_clock: record.clockId });
const out = {
  read_at: new Date().toISOString(),
  method: 'Stripe CLI `stripe get` (read-only), Owner login; independent of the CarUp backend',
  account: { id: account.id },
  product: { id: product.id, livemode: product.livemode, active: product.active },
  price: { id: price.id, livemode: price.livemode, unit_amount: price.unit_amount, currency: price.currency,
    interval: price.recurring?.interval || null, interval_count: price.recurring?.interval_count || null },
  test_clock: { id: clock.id, livemode: clock.livemode, status: clock.status, frozen_time: iso(clock.frozen_time),
    provisioned_frozen_time: iso(record.clockFrozenTime) },
  customers: [],
};
for (const c of customers) {
  const sessions = list('/v1/checkout/sessions', { customer: c.id });
  const subscriptions = list('/v1/subscriptions', { customer: c.id, status: 'all' });
  const invoices = list('/v1/invoices', { customer: c.id });
  const charges = list('/v1/charges', { customer: c.id });
  const refunds = charges.flatMap((ch) => list('/v1/refunds', { charge: ch.id }));
  out.customers.push({
    id: c.id, livemode: c.livemode, test_clock: id(c.test_clock),
    carup_owner_organization_id: c.metadata?.carup_owner_organization_id || null,
    checkout_sessions: sessions.map((s) => ({ id: s.id, livemode: s.livemode, mode: s.mode, status: s.status,
      payment_status: s.payment_status, amount_total: s.amount_total, currency: s.currency, subscription: id(s.subscription),
      client_reference_id: s.client_reference_id })),
    subscriptions: subscriptions.map((s) => ({ id: s.id, livemode: s.livemode, status: s.status,
      cancel_at_period_end: s.cancel_at_period_end, canceled_at: iso(s.canceled_at),
      current_period_start: iso(s.current_period_start ?? s.items?.data?.[0]?.current_period_start),
      current_period_end: iso(s.current_period_end ?? s.items?.data?.[0]?.current_period_end),
      price: id(s.items?.data?.[0]?.price), carup_subscription_reference: s.metadata?.carup_subscription_reference || null })),
    invoices: invoices.map((i) => ({ id: i.id, livemode: i.livemode, status: i.status, billing_reason: i.billing_reason,
      amount_due: i.amount_due, amount_paid: i.amount_paid, currency: i.currency,
      subscription: id(i.subscription) || i.parent?.subscription_details?.subscription || null,
      period_start: iso(i.lines?.data?.[0]?.period?.start), period_end: iso(i.lines?.data?.[0]?.period?.end) })),
    charges: charges.map((ch) => ({ id: ch.id, livemode: ch.livemode, status: ch.status, paid: ch.paid, amount: ch.amount,
      currency: ch.currency, amount_refunded: ch.amount_refunded, refunded: ch.refunded, payment_intent: id(ch.payment_intent) })),
    refunds: refunds.map((r) => ({ id: r.id, status: r.status, amount: r.amount, currency: r.currency, charge: id(r.charge),
      payment_intent: id(r.payment_intent), reason: r.reason || null, carup_programme: r.metadata?.carup_programme || null })),
  });
}

// Scope check against the recorded Owner decision (exact limits, nothing live).
const limits = decision.limits || {};
const all = (k) => out.customers.flatMap((c) => c[k]);
const findings = [];
const objects = [out.product, out.price, out.test_clock, ...out.customers, ...all('checkout_sessions'), ...all('subscriptions'),
  ...all('invoices'), ...all('charges')];
if (objects.some((o) => o.livemode !== false)) findings.push('a live object exists');
if (out.customers.length > 1) findings.push(`customers on the test clock: ${out.customers.length} (authorized 1)`);
if (all('checkout_sessions').length > (limits.checkout_sessions ?? 1)) findings.push(`checkout sessions: ${all('checkout_sessions').length}`);
const succeeded = all('charges').filter((ch) => ch.status === 'succeeded');
if (succeeded.length > (limits.expected_charges_jpy || [500, 500]).length) findings.push(`succeeded charges: ${succeeded.length}`);
if (succeeded.some((ch) => ch.amount !== 500 || ch.currency !== 'jpy')) findings.push('a charge other than JPY 500');
if (all('refunds').length > (limits.refunds ?? 1)) findings.push(`refunds: ${all('refunds').length}`);
if (price.unit_amount !== 500 || price.currency !== 'jpy') findings.push('price is not JPY 500');
out.scope = { authorized: limits, result: findings.length ? 'SCOPE_EXCEEDED' : 'WITHIN_AUTHORIZED_SCOPE', findings,
  counts: { customers: out.customers.length, checkout_sessions: all('checkout_sessions').length, subscriptions: all('subscriptions').length,
    invoices: all('invoices').length, succeeded_charges: succeeded.length, refunds: all('refunds').length } };

writeFileSync(`${EVIDENCE}/level2-provider-readback.json`, JSON.stringify(out, null, 2), { mode: 0o600 });
console.log(`PAY-03B Level 2 provider readback: ${out.scope.result} ${JSON.stringify(out.scope.counts)}`);
if (findings.length) { console.log(findings.join('\n')); process.exit(2); }
