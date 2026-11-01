#!/usr/bin/env node
// CARUP-PAY-03B-LR01 Level 2 — the API-only steps of the ONE Owner-authorized Stripe SANDBOX rehearsal, driven through
// CarUp's own authenticated HTTP API (real sessions, CSRF) and the canonical database of the dedicated PAY-03B stack.
// One deliberate step per invocation:
//
//   node scripts/uat/pay03b-level2-rehearsal-driver.mjs status      (read-only summary of the canonical record)
//   node scripts/uat/pay03b-level2-rehearsal-driver.mjs advance     (the ONE authorized test-clock advance; administrator)
//   node scripts/uat/pay03b-level2-rehearsal-driver.mjs reconcile   (administrator fresh provider READ; no provider mutation)
//   node scripts/uat/pay03b-level2-rehearsal-driver.mjs readback    (read-only, sanitized canonical readback for the evidence)
//
// The cancellation (customer) and the governed refund (administrator) are browser flows in
// web/e2e/pay03b-stripe-sandbox-lifecycle.spec.ts; the Checkout is web/e2e/pay03b-stripe-sandbox-rehearsal.spec.ts.
// The advance re-checks the recorded Owner scope against the canonical database and the Level 2 ledger first, refuses
// if it already happened, and is never retried automatically. Results are appended, sanitized (ids, statuses, amounts
// only), to ~/carup-launch-evidence/pay03b/level2-driver-log.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const API = 'http://127.0.0.1:5041';
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres';
const EVIDENCE = `${homedir()}/carup-launch-evidence/pay03b`;
const LOG = `${EVIDENCE}/level2-driver-log.json`;
const fail = (m) => { console.error(`PAY-03B Level 2 driver: ${m}`); process.exit(1); };
const sql = (q) => execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const json = (q) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(r)), '[]') from (${q}) r`));

const decision = JSON.parse(readFileSync(`${EVIDENCE}/owner-decision-level2.json`, 'utf8'));
if (decision?.decisions?.level2_stripe_sandbox_rehearsal !== 'Authorize exact scope (Recommended)') fail('no recorded Owner authorization.');
const accounts = JSON.parse(readFileSync(`${EVIDENCE}/uat-accounts.json`, 'utf8'));
const expected = process.env.PAY03B_EXPECTED_SHA;
const health = await (await fetch(`${API}/api/health`)).json();
if (!expected || health?.build?.commit_sha !== expected) fail(`runtime is ${health?.build?.commit_sha}, expected ${expected}.`);

function state() {
  const sub = json(`select id, status, provider_status, gateway, provider_subscription_id, cancel_at_period_end, paid_through,
    current_period_end from public.pay03b_business_subscriptions where owner_tenant_id = ${lit(accounts.tenantC)}`);
  if (sub.length !== 1) return { subscriptions: sub.length };
  const invoices = json(`select i.id, i.provider_invoice_id, i.billing_reason, i.provider_status, i.amount_due_minor, i.amount_paid_minor,
      i.period_start, i.period_end, i.anomaly, p.reference as payment_reference, p.status as payment_status, p.amount as payment_amount
    from public.pay03b_subscription_invoices i left join public.payment_transactions p on p.reference = i.payment_reference
    where i.subscription_id = ${lit(sub[0].id)} order by i.period_start`);
  const ledger = existsSync(`${EVIDENCE}/level2-ledger.json`) ? JSON.parse(readFileSync(`${EVIDENCE}/level2-ledger.json`, 'utf8')) : { advances: [] };
  const ent = JSON.parse(sql(`select public.pay03b_resolve_tenant_entitlements(${lit(accounts.tenantC)}, 'dealer_storefront')::text`));
  return { subscription: sub[0], invoices, advances: (ledger.advances || []).length,
    access: { access: ent.access, reason: ent.reason, paid_through: ent.paid_through } };
}

async function csrf(identity) { return (await (await fetch(`${API}/api/security/csrf-token`, { headers: identity })).json()).csrfToken; }
async function login(who) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf({}) },
    body: JSON.stringify({ email: accounts[who].email, password: accounts[who].password }) });
  const body = await r.json();
  if (r.status !== 200 || !body.token) fail(`login ${who} failed (${r.status})`);
  return { token: body.token };
}
async function call(session, method, path, { body } = {}) {
  const identity = { 'x-session-token': session.token };
  const headers = { ...identity, 'content-type': 'application/json' };
  if (method !== 'GET') headers['x-csrf-token'] = await csrf(identity);
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let out = null; try { out = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json: out };
}
function record(step, outcome) {
  const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : [];
  log.push({ at: new Date().toISOString(), runtime_sha: expected, step, ...outcome });
  writeFileSync(LOG, JSON.stringify(log, null, 2), { mode: 0o600 });
}
const summary = (s) => JSON.stringify({ status: s.subscription?.status, provider: s.subscription?.provider_status,
  cancelAtPeriodEnd: s.subscription?.cancel_at_period_end, paidThrough: s.subscription?.paid_through, advances: s.advances,
  invoices: (s.invoices || []).map((i) => `${i.billing_reason}:${i.provider_status}:${i.payment_status}:${i.amount_paid_minor}`), access: s.access });

/** Sanitized canonical readback: object ids, statuses, amounts, periods, counts. Never keys, signatures, IPs or reasons. */
function readback(sub) {
  const subscription = json(`select s.id, s.subscription_reference, s.owner_organization_id, s.subscription_scope, p.plan_code, p.amount_minor,
      p.currency, s.product_code, s.status, s.provider_status, s.gateway, s.provider_account_id, s.provider_checkout_id,
      s.provider_subscription_id, c.provider_customer_id, s.current_period_start, s.current_period_end, s.paid_through, s.paid_plan_id = s.plan_id as paid_plan_is_plan,
      s.trial_end, s.grace_until, s.cancel_at_period_end, s.canceled_at, s.ended_at, s.cancellation_mode, s.suspended_reason, s.version,
      s.created_at, s.updated_at
    from public.pay03b_business_subscriptions s join public.pay03b_subscription_plans p on p.id = s.plan_id
    left join public.pay03b_billing_customers c on c.id = s.billing_customer_id where s.id = ${lit(sub.id)}`)[0];
  const invoices = json(`select provider_invoice_id, billing_reason, period_start, period_end, currency, amount_due_minor, amount_paid_minor,
      amount_remaining_minor, provider_status, anomaly, payment_reference, provider_payment_intent_id, attempt_count, first_observed_at, last_observed_at
    from public.pay03b_subscription_invoices where subscription_id = ${lit(sub.id)} order by period_start`);
  const payments = json(`select reference, gateway, amount, currency, status, pay01a_account_id, pay01a_intent_id, pay01a_refund_id,
      pay02_product_code, created_at, updated_at
    from public.payment_transactions where reference in (select payment_reference from public.pay03b_subscription_invoices
      where subscription_id = ${lit(sub.id)}) order by created_at`);
  return {
    read_at: new Date().toISOString(),
    method: 'psql against the dedicated PAY-03B stack (127.0.0.1:55422); read-only',
    runtime_sha: expected,
    subscription,
    billing_customers: json(`select provider_customer_id, gateway, provider_account_id, owner_organization_id = ${lit(subscription.owner_organization_id)} as same_organization
      from public.pay03b_billing_customers where owner_tenant_id = ${lit(accounts.tenantC)}`),
    invoices,
    payments,
    entitlements: JSON.parse(sql(`select public.pay03b_resolve_tenant_entitlements(${lit(accounts.tenantC)}, 'dealer_storefront')::text`)),
    transitions: json(`select from_status, to_status, paid_through, cause, event_id, recorded_at from public.pay03b_subscription_transitions
      where subscription_id = ${lit(sub.id)} order by recorded_at`),
    change_requests: json(`select change_type, requested_role, status, outcome_code, requested_at, completed_at
      from public.pay03b_subscription_change_requests where subscription_id = ${lit(sub.id)} order by requested_at`),
    provider_event_receipts: json(`select event_type, resulting_state, count(*)::int as events from public.pay03b_provider_event_receipts
      group by event_type, resulting_state order by event_type, resulting_state`),
    sync_exceptions: json(`select provider_invoice_id, error_code, status, observation_count from public.pay03b_subscription_sync_exceptions
      where subscription_id = ${lit(sub.id)}`),
    reconciliation_exceptions: json(`select payment_reference, status, prior_payment_status, last_observed_status
      from public.pay03b_payment_reconciliation_exceptions`),
    audit_events: json(`select event_type, actor_role, source_route, created_at from public.trust_audit_events
      where event_type like 'PAY03B_%' order by created_at`),
    duplicates: JSON.parse(sql(`select json_build_object(
      'subscriptions_for_organization', (select count(*) from public.pay03b_business_subscriptions where owner_tenant_id = ${lit(accounts.tenantC)}),
      'invoices_sharing_a_provider_id', (select count(*) from (select provider_invoice_id from public.pay03b_subscription_invoices
        group by provider_invoice_id having count(*) > 1) d),
      'payments_sharing_an_intent', (select count(*) from (select pay01a_intent_id from public.payment_transactions
        where pay01a_intent_id is not null group by pay01a_intent_id having count(*) > 1) d),
      'payment_rows_for_subscription', (select count(*) from public.payment_transactions where reference in (select payment_reference
        from public.pay03b_subscription_invoices where subscription_id = ${lit(sub.id)})),
      'all_payment_rows_in_database', (select count(*) from public.payment_transactions))::text`)),
  };
}

const step = process.argv[2];
const s = state();
if (s.subscriptions !== undefined) fail(`expected exactly one Level 2 subscription for tenant C, found ${s.subscriptions}.`);
if (s.subscription.gateway !== 'stripe_carup_japan_sandbox') fail('the Level 2 subscription is not on the Stripe sandbox gateway.');

if (step === 'status') {
  console.log(summary(s));
} else if (step === 'advance') {
  if (s.advances !== 0) fail('the one authorized test-clock advance has already been made.');
  if (s.invoices.length !== 1 || s.invoices[0].payment_status !== 'paid') fail('the first invoice must be paid before the advance.');
  if (s.subscription.status !== 'active' || s.subscription.cancel_at_period_end) fail('the subscription must be active and not cancelling.');
  const ops = await login('ops');
  const r = await call(ops, 'POST', '/api/pay03b/admin/stripe-sandbox/test-clock/advance', { body: { subscriptionId: s.subscription.id } });
  record('advance', { http: r.status, clockId: r.json?.clockId || null, clockStatus: r.json?.status || null,
    frozenTime: r.json?.frozenTime ?? null, code: r.json?.code || null });
  console.log(`advance: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
} else if (step === 'reconcile') {
  const ops = await login('ops');
  const r = await call(ops, 'POST', `/api/pay03b/admin/subscriptions/${s.subscription.id}/reconcile`);
  record('reconcile', { http: r.status, result: r.json?.result || r.json?.code || null });
  console.log(`reconcile: HTTP ${r.status} ${JSON.stringify(r.json?.result || r.json?.code || null)}`);
  console.log(summary(state()));
} else if (step === 'readback') {
  const out = readback(s.subscription);
  writeFileSync(`${EVIDENCE}/level2-canonical-readback.json`, JSON.stringify(out, null, 2), { mode: 0o600 });
  console.log(`canonical readback written: ${out.invoices.length} invoices, ${out.payments.length} canonical payments, duplicates ${JSON.stringify(out.duplicates)}`);
} else {
  fail('step must be one of: status | advance | reconcile | readback');
}
