#!/usr/bin/env node
// CARUP-PAY-03B-LR01 — authenticated HTTP matrix against the PHYSICAL local runtime (backend 127.0.0.1:5041,
// dedicated stack 127.0.0.1:55422, LOCAL PROVIDER SIMULATOR — not Stripe). Real sessions (/api/auth/login),
// real CSRF tokens, real canonical database, simulator events delivered over the real HTTP webhook path.
// Writes sanitized results (no tokens, passwords or provider URLs) to the evidence directory.
//   PAY03B_EXPECTED_SHA=<candidate> node scripts/uat/pay03b-http-matrix.mjs
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const API = 'http://127.0.0.1:5041';
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres';
const EVIDENCE_DIR = `${homedir()}/carup-launch-evidence/pay03b`;
const accounts = JSON.parse(readFileSync(`${EVIDENCE_DIR}/uat-accounts.json`, 'utf8'));
const EXPECTED_SHA = process.env.PAY03B_EXPECTED_SHA || '';
const results = [];
const sql = (q) => execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (label) => `pay03b_uat_${label}_${randomBytes(6).toString('hex')}`;

// Every isSensitive route shares ONE per-IP counter; pace sensitive calls so the matrix never trips a 429.
// Mirrors the isSensitive limiters in backend/server.js (including the provider-calling dealer routes added for R12).
const SENSITIVE = [/^\/api\/pay03b\/dealer\/subscription\/(checkout|verify|change|change-preview|cancel|payment-method|invoices)(\/|\?|$)/,
  /^\/api\/pay03b\/admin\/(subscriptions|reconciliation-exceptions|stripe-sandbox)/, /^\/api\/auth\/login/];
let lastSensitive = 0;
async function paceIfSensitive(path) {
  if (!SENSITIVE.some((re) => re.test(path))) return;
  const wait = lastSensitive + 13_000 - Date.now();
  if (wait > 0) await pause(wait);
  lastSensitive = Date.now();
}

async function csrf(identity) {
  const res = await fetch(`${API}/api/security/csrf-token`, { headers: identity });
  return (await res.json()).csrfToken;
}
async function call(method, path, { as = null, tenant = undefined, body, idem } = {}) {
  await paceIfSensitive(path);
  const identity = as ? { 'x-session-token': sessions[as].token } : {};
  const tenantId = tenant === undefined ? (as ? sessions[as].tenant : null) : tenant;
  if (tenantId) identity['x-tenant-id'] = tenantId;
  const headers = { ...identity, 'content-type': 'application/json', ...(idem ? { 'idempotency-key': idem } : {}) };
  if (method !== 'GET') headers['x-csrf-token'] = await csrf(identity);
  const res = await fetch(`${API}${path}`, { method, headers, redirect: 'manual', body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
  return { status: res.status, json, location: res.headers.get('location') };
}
function record(id, title, pass, observed) {
  results.push({ id, title, pass: Boolean(pass), observed });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${title}${pass ? '' : ` :: ${JSON.stringify(observed).slice(0, 300)}`}`);
}

const sessions = {};
const health = await (await fetch(`${API}/api/health`)).json();
if (EXPECTED_SHA && health?.build?.commit_sha !== EXPECTED_SHA) throw new Error(`runtime is ${health?.build?.commit_sha}, expected ${EXPECTED_SHA}`);
for (const who of ['dealerA', 'dealerAStaff', 'dealerB', 'ops']) {
  await paceIfSensitive('/api/auth/login');
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf({}) },
    body: JSON.stringify({ email: accounts[who].email, password: accounts[who].password }) });
  const body = await r.json();
  if (r.status !== 200 || !body.token) throw new Error(`login ${who} failed (${r.status})`);
  sessions[who] = { token: body.token, tenant: body.user?.active_tenant_id || null };
}
const P = accounts.plans;
const planRow = (id) => JSON.parse(sql(`select row_to_json(p) from public.pay03b_subscription_plans p where id = ${lit(id)}`));
const terms = (id) => { const p = planRow(id); return { planVersion: p.plan_version, amountMinor: Number(p.amount_minor), currency: p.currency, billingInterval: p.billing_interval, intervalCount: p.interval_count }; };
const subFor = (tenant) => sql(`select coalesce((select id::text from public.pay03b_business_subscriptions where owner_tenant_id = ${lit(tenant)}
  and status not in ('incomplete_expired','cancelled','expired') order by created_at desc limit 1), '')`);
const providerSub = (id) => sql(`select provider_subscription_id from public.pay03b_business_subscriptions where id = ${lit(id)}`);

// ---------------------------------------------------------------------------------------------------- matrix
let r = await call('GET', '/api/pay03b/catalogue');
record('H01', 'public catalogue: 7 products, no price shown as an offer', r.status === 200 && r.json.products.length === 7
  && r.json.products.flatMap((p) => p.plans).every((p) => p.amountMinor === null), { status: r.status, products: r.json.products?.length });
r = await call('GET', '/api/pay03b/dealer/subscription');
record('H02', 'anonymous dealer overview refused (401)', r.status === 401, { status: r.status });
r = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerA' });
record('H03', 'billing admin overview: legal organization bound, baseline capacity only, no paid access',
  r.status === 200 && r.json.billingAuthority === true && r.json.organization.id === accounts.orgA && r.json.entitlements.access === false
  && r.json.entitlements.effective['dealer.inventory.published_listing_capacity'] === 3 && r.json.providerMode === 'local_simulator',
  { status: r.status, org: r.json.organization?.id, access: r.json.entitlements?.access, capacity: r.json.entitlements?.effective });
r = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerAStaff' });
record('H04', 'staff member sees the organization read-only (no billing authority)', r.status === 200 && r.json.billingAuthority === false, { status: r.status });
r = await call('POST', '/api/pay03b/dealer/subscription/checkout', { as: 'dealerAStaff', idem: key('staff'), body: { planId: P.standard, acknowledgedTerms: terms(P.standard) } });
record('H05', 'staff without billing authority cannot subscribe (403)', r.status === 403 && r.json.code === 'PAY03B_BILLING_AUTHORITY_REFUSED', r.json);
r = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerA', tenant: accounts.tenantB });
record('H06', 'dealer A cannot act in dealer B\'s tenant (403 at the session boundary)', r.status === 403, { status: r.status });
r = await call('POST', '/api/pay03b/dealer/subscription/checkout', { as: 'dealerA', idem: key('terms'), body: { planId: P.standard, acknowledgedTerms: { ...terms(P.standard), amountMinor: 1 } } });
record('H07', 'stale/forged acknowledged terms refused (409), browser price never used', r.status === 409 && r.json.code === 'PAY03B_TERMS_CHANGED', r.json);
const buyKey = key('buy');
r = await call('POST', '/api/pay03b/dealer/subscription/checkout', { as: 'dealerA', idem: buyKey, body: { planId: P.standard, acknowledgedTerms: terms(P.standard), amountMinor: 1, currency: 'USD' } });
const checkout = r.json;
record('H08a', 'checkout created on the SIMULATED provider with server-side amount and currency', r.status === 201 && checkout.simulated === true
  && checkout.amountMinor === 3000 && checkout.currency === 'JPY' && /^sim_cs_/.test(checkout.checkoutId), { status: r.status, simulated: checkout.simulated, amountMinor: checkout.amountMinor, currency: checkout.currency });
r = await call('POST', '/api/pay03b/dealer/subscription/checkout', { as: 'dealerA', idem: buyKey, body: { planId: P.standard, acknowledgedTerms: terms(P.standard) } });
record('H08b', 'same Idempotency-Key replays the same subscription and checkout', [200, 201].includes(r.status) && r.json.checkoutId === checkout.checkoutId && r.json.idempotentReplay === true, { status: r.status, same: r.json.checkoutId === checkout.checkoutId });
r = await call('POST', '/api/pay03b/dealer/subscription/checkout', { as: 'dealerA', idem: key('second'), body: { planId: P.premium, acknowledgedTerms: terms(P.premium) } });
record('H08c', 'a second, conflicting subscription for the same organization is refused (409)', r.status === 409 && r.json.code === 'PAY03B_SUBSCRIPTION_ALREADY_EXISTS', r.json);
r = await call('POST', '/api/pay03b/dealer/subscription/verify', { as: 'dealerA' });
record('H09a', 'returning before payment grants nothing (redirect is not proof)', r.status === 200 && r.json.subscription.status === 'incomplete' && r.json.entitlements.access === false, { status: r.json.subscription?.status });
const page = await (await fetch(checkout.checkoutUrl)).text();
record('H09b', 'provider page is visibly the SIMULATED provider, never Stripe', /SIMULATED PROVIDER — NOT STRIPE/.test(page) && /JPY 3,000/.test(page), { banner: /SIMULATED PROVIDER/.test(page) });
const paid = await fetch(`${API}/api/pay03b/simulator/checkout/${checkout.checkoutId}/complete`, { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'outcome=success' });
record('H09c', 'simulated payment returns the buyer to CarUp (303)', paid.status === 303 && /\/dealer\/subscription\?pay03b=returned$/.test(paid.headers.get('location') || ''), { status: paid.status });
r = await call('POST', '/api/pay03b/dealer/subscription/verify', { as: 'dealerA' });
const subA = r.json.subscription?.id;
const invoice1 = r.json.invoices?.[0];
record('H10', 'provider-confirmed (signed event + fresh read): active, entitled, invoice paid through one canonical payment',
  r.json.subscription?.status === 'active' && r.json.entitlements.access === true
  && r.json.entitlements.effective['dealer.inventory.published_listing_capacity'] === 10 && invoice1?.paymentStatus === 'paid'
  && sql(`select gateway||'|'||amount::bigint||'|'||currency||'|'||status from public.payment_transactions where reference = ${lit(invoice1?.paymentReference)}`) === 'pay03b_local_provider_simulator|3000|JPY|paid',
  { status: r.json.subscription?.status, access: r.json.entitlements?.access, invoice: invoice1?.paymentStatus });
const forged = await fetch(`${API}/api/pay03b/simulator/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pay03b-simulator-signature': 't=1,v1=00' },
  body: JSON.stringify({ id: 'sim_evt_forged', type: 'invoice.paid', livemode: false, account: 'acct_pay03b_local_simulator', data: { object: {} } }) });
record('H11', 'forged provider webhook refused (400)', forged.status === 400, { status: forged.status });
r = await call('GET', '/api/pay03b/admin/subscriptions', { as: 'dealerA' });
const dealerOnAdmin = r.status;
r = await call('GET', '/api/pay03b/admin/subscriptions', { as: 'ops' });
record('H12', 'administrator oversight: dealers refused (403); admin sees the entitled subscription and the source of truth',
  dealerOnAdmin === 403 && r.status === 200 && r.json.subscriptions.some((s) => s.id === subA && s.access === true) && /payment_transactions/.test(r.json.sourceOfTruth),
  { dealerOnAdmin, admin: r.status });
r = await call('POST', `/api/pay03b/simulator/subscriptions/${providerSub(subA)}/advance`, { as: 'ops', body: { outcome: 'success' } });
const after1 = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerA' });
record('H13', 'renewal collected exactly once: second paid invoice, second canonical payment, coverage extended',
  r.status === 200 && after1.json.invoices.filter((i) => i.paymentStatus === 'paid').length === 2
  && new Set(after1.json.invoices.map((i) => i.paymentReference)).size === 2, { delivered: r.json.delivered, invoices: after1.json.invoices?.length });
r = await call('POST', `/api/pay03b/simulator/subscriptions/${providerSub(subA)}/advance`, { as: 'ops', body: { outcome: 'failure' } });
let ov = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerA' });
const open = ov.json.invoices.find((i) => i.providerStatus === 'open');
record('H14a', 'failed renewal: past_due, invoice open, payment pending (never fabricated), paid coverage unchanged',
  ov.json.subscription.status === 'past_due' && open?.paymentStatus === 'pending', { status: ov.json.subscription?.status, open: open?.paymentStatus });
r = await call('POST', `/api/pay03b/dealer/subscription/invoices/${open.id}/pay`, { as: 'dealerA' });
const invoicePage = await (await fetch(r.json.url)).text();
const payInvoice = await fetch(`${API}/api/pay03b/simulator/invoice/${open.providerInvoiceId}/pay`, { method: 'POST', redirect: 'manual' });
ov = await call('POST', '/api/pay03b/dealer/subscription/verify', { as: 'dealerA' });
record('H14b', 'recovery: billing admin pays the open invoice on the provider page; subscription active again',
  /SIMULATED PROVIDER/.test(invoicePage) && payInvoice.status === 303 && ov.json.subscription.status === 'active'
  && ov.json.invoices.find((i) => i.id === open.id)?.paymentStatus === 'paid', { status: ov.json.subscription?.status });
r = await call('GET', `/api/pay03b/dealer/subscription/change-preview?targetPlanId=${P.premium}&mode=period_end`, { as: 'dealerA' });
const preview = r.json;
r = await call('POST', '/api/pay03b/dealer/subscription/change', { as: 'dealerA', idem: key('upnow'), body: { targetPlanId: P.premium, mode: 'immediate' } });
const immediate = r.json;
r = await call('POST', '/api/pay03b/dealer/subscription/change', { as: 'dealerA', idem: key('uppe'), body: { targetPlanId: P.premium, mode: 'period_end' } });
record('H15a', 'plan change: provider-backed preview (no charge now), immediate upgrade refused by policy, period-end change scheduled without new entitlements',
  preview.chargeNowMinor === 0 && immediate.code === 'PAY03B_UPGRADE_POLICY_REFUSED' && r.json.overview?.subscription?.scheduledPlanChange === true
  && r.json.overview?.entitlements?.effective['dealer.inventory.published_listing_capacity'] === 10,
  { preview: preview.chargeNowMinor, immediate: immediate.code, scheduled: r.json.overview?.subscription?.scheduledPlanChange });
await call('POST', `/api/pay03b/simulator/subscriptions/${providerSub(subA)}/advance`, { as: 'ops', body: { outcome: 'success' } });
ov = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerA' });
record('H15b', 'after the premium renewal is PAID, premium entitlements apply', ov.json.entitlements.effective['dealer.inventory.published_listing_capacity'] === 25,
  { capacity: ov.json.entitlements?.effective });
r = await call('POST', '/api/pay03b/dealer/subscription/cancel', { as: 'dealerA', idem: key('cancelpe'), body: { mode: 'period_end', reason: 'UAT: closing the storefront' } });
const cancelPe = r.json.overview;
r = await call('POST', '/api/pay03b/dealer/subscription/cancel', { as: 'dealerA', idem: key('resume'), body: { mode: 'resume' } });
record('H16', 'cancel at period end keeps paid access; resume restores renewal', cancelPe?.subscription?.cancelAtPeriodEnd === true
  && cancelPe?.entitlements?.access === true && r.json.overview?.subscription?.cancelAtPeriodEnd === false, { cancelled: cancelPe?.subscription?.cancelAtPeriodEnd });
r = await call('POST', `/api/pay03b/admin/subscriptions/${subA}/suspension`, { as: 'ops', idem: key('susp'), body: { action: 'suspend', reason: 'UAT compliance review of the storefront' } });
const suspended = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerA' });
await call('POST', `/api/pay03b/admin/subscriptions/${subA}/reconcile`, { as: 'ops' });
const stillSuspended = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerA' });
r = await call('POST', `/api/pay03b/admin/subscriptions/${subA}/suspension`, { as: 'ops', idem: key('resume2'), body: { action: 'resume', reason: 'UAT compliance review closed' } });
const resumed = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerA' });
record('H17', 'administrator suspension: attributable, survives provider reconciliation, reversible only by an admin',
  suspended.json.entitlements.reason === 'admin_suspension' && stillSuspended.json.entitlements.access === false && resumed.json.entitlements.access === true
  && sql(`select requested_by from public.pay03b_subscription_change_requests where subscription_id = ${lit(subA)} and change_type = 'admin_suspend' order by requested_at desc limit 1`) === accounts.ops.userId,
  { suspended: suspended.json.entitlements?.reason, afterReconcile: stillSuspended.json.entitlements?.access, resumed: resumed.json.entitlements?.access });

// F5 on a recurring invoice (dealer B)
r = await call('POST', '/api/pay03b/dealer/subscription/checkout', { as: 'dealerB', idem: key('buyb'), body: { planId: P.standard, acknowledgedTerms: terms(P.standard) } });
await fetch(`${API}/api/pay03b/simulator/checkout/${r.json.checkoutId}/complete`, { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'outcome=success' });
ov = await call('POST', '/api/pay03b/dealer/subscription/verify', { as: 'dealerB' });
const subB = ov.json.subscription.id;
const intentB = sql(`select provider_payment_intent_id from public.pay03b_subscription_invoices where subscription_id = ${lit(subB)} limit 1`);
r = await call('POST', '/api/pay03b/simulator/refunds', { as: 'ops', body: { paymentIntentId: intentB, amountMinor: 1000 } });
const held = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerB' });
const exceptions = await call('GET', '/api/pay03b/admin/reconciliation-exceptions?status=open', { as: 'ops' });
const exc = exceptions.json.exceptions?.find((x) => x.paymentReference === held.json.invoices?.[0]?.paymentReference);
record('H18a', 'F5: an external partial refund holds the invoice payment, suspends paid access, and raises an operator alert',
  held.json.entitlements.access === false && held.json.entitlements.reason === 'payment_reconciliation_hold' && exc?.status === 'open'
  && exc?.detectedRefundedMinor === 1000 && exceptions.json.openCount >= 1, { reason: held.json.entitlements?.reason, exception: exc?.status });
r = await call('POST', `/api/pay03b/admin/reconciliation-exceptions/${exc.id}/resolve`, { as: 'ops', body: { resolution: 'restore_access_provider_unrefunded', note: 'UAT: attempting restore while the refund stands' } });
const refusedRestore = r.json.code;
r = await call('POST', `/api/pay03b/admin/reconciliation-exceptions/${exc.id}/resolve`, { as: 'ops', body: { resolution: 'revoke_access_partial_refund_final', note: 'UAT: goodwill partial refund accepted; access ends' } });
record('H18b', 'F5 resolution: restore refused while the provider shows the refund; revoke-final recorded with the admin as resolver',
  refusedRestore === 'PAY03B_RESTORE_REQUIRES_UNREFUNDED_PROVIDER_STATE' && r.json.paymentStatus === 'partially_refunded'
  && r.json.exception?.resolvedBy === accounts.ops.userId, { refusedRestore, paymentStatus: r.json.paymentStatus });
const latestPaid = (await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerA' })).json.invoices.find((i) => i.paymentStatus === 'paid');
r = await call('POST', `/api/pay03b/admin/subscriptions/${subA}/invoices/${latestPaid.id}/refund`, { as: 'ops', body: { reason: 'UAT governed refund of the latest storefront period' } });
record('H19', 'governed admin refund: invoice payment refunded; that period no longer covered; audited before and after',
  r.status === 200 && r.json.invoices.find((i) => i.id === latestPaid.id)?.paymentStatus === 'refunded'
  && sql(`select count(*) from public.trust_audit_events where new_value->>'invoiceId' = ${lit(latestPaid.id)}`) === '2', { status: r.status });
r = await call('GET', `/api/pay03b/admin/subscriptions/${subA}`, { as: 'dealerB' });
const bOverview = await call('GET', '/api/pay03b/dealer/subscription', { as: 'dealerB' });
record('H20', 'cross-tenant isolation: dealer B cannot read dealer A, and only ever sees its own organization', r.status === 403
  && bOverview.json.organization.id === accounts.orgB && bOverview.json.subscription.id === subB, { adminAsDealerB: r.status });
r = await call('GET', '/api/pay03a/vehicles', { as: 'dealerA' });
record('H21', 'PAY-03A report commerce route still served on the same runtime (regression)', r.status === 200 && Array.isArray(r.json.vehicles), { status: r.status });
record('H22', 'no Stripe object was ever created (all provider identifiers are simulator-namespaced)',
  sql(`select count(*) from public.pay03b_business_subscriptions where provider_subscription_id like 'sub\\_%' or provider_checkout_id like 'cs\\_%'`) === '0'
  && sql(`select count(*) from public.payment_transactions where reference like 'pay03b_inv_%' and gateway <> 'pay03b_local_provider_simulator'`) === '0', {});

const passed = results.filter((x) => x.pass).length;
writeFileSync(`${EVIDENCE_DIR}/http-matrix.json`, JSON.stringify({ recorded_at: new Date().toISOString(), runtime: API,
  commit_sha: health.build.commit_sha, provider: 'LOCAL PROVIDER SIMULATOR (not Stripe)', passed, total: results.length, results }, null, 2));
console.log(`HTTP matrix: ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
