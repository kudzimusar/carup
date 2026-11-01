/**
 * CARUP-PAY-03B-LR01 — authenticated HTTP boundary for dealer subscriptions, administrator oversight, F5 operator
 * routes and the local provider simulator, against REAL PostgreSQL (disposable database; see
 * pay03b-business-subscriptions.test.js for the requirement). The real session middleware (authorizeSessionRole)
 * runs; only the session-token lookup is served from memory because the disposable schema carries the legacy
 * user_sessions shape. Users, tenant memberships, organizations and every PAY-03B rule are real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const PGURL = process.env.PAY03B_TEST_PGURL || '';
const disposable = /^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\/pay01c_sandbox_ci$/.test(PGURL) && !PGURL.includes(':54322/');
const skip = disposable ? false : 'PAY03B_TEST_PGURL must name a disposable pay01c_sandbox_ci database';

const { supabase } = await import('../db/supabase.js');
const pay03bRoutes = (await import('../routes/pay03bRoutes.js')).default;
const { Pay03bLocalSimulatorProvider } = await import('../services/payment/pay03bLocalSimulator.js');
const { createPgSupabase } = await import('./helpers/pgSupabaseShim.js');

const run = crypto.randomBytes(4).toString('hex');
const u = { admin: `h3b_admin_${run}`, owner: `h3b_owner_${run}`, staff: `h3b_staff_${run}`, other: `h3b_other_${run}` };
const tA = crypto.randomUUID();
const tB = crypto.randomUUID();
const tokens = Object.fromEntries(Object.keys(u).map((k) => [k, `tok_${k}_${crypto.randomBytes(12).toString('hex')}`]));

test('PAY-03B HTTP boundary on real PostgreSQL', { skip }, async (t) => {
  const db = createPgSupabase(PGURL);
  const sessions = new Map(Object.entries(tokens).map(([k, token]) => [token, { user_id: u[k], is_valid: true,
    expires_at: new Date(Date.now() + 3600_000).toISOString() }]));
  const originalFrom = supabase.from;
  supabase.from = (table) => {
    if (table !== 'user_sessions') return db.from(table);
    let token = null;
    const chain = { select: () => chain, eq: (col, value) => { if (col === 'token') token = value; return chain; },
      single: async () => (sessions.has(token) ? { data: sessions.get(token), error: null } : { data: null, error: { code: 'PGRST116' } }) };
    return chain;
  };
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => {
    if ((req.originalUrl || '').startsWith('/api/pay03b/simulator/webhook')) req.rawBodyBytes = Buffer.from(buf);
  } }));
  app.use(express.urlencoded({ extended: true }));
  app.use(pay03bRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = {
    NODE_ENV: 'test', CARUP_ENV: 'test', CARUP_PAY03B_ENABLED: 'true', CARUP_PAY03B_PROVIDER_MODE: 'local_simulator',
    CARUP_PAY03B_SIMULATOR_STATE_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pay03b-http-')), 'state.json'),
    CARUP_PAY03B_SIMULATOR_PERIOD_SECONDS: '120', CARUP_PAY03B_SIMULATOR_WEBHOOK_SECRET: 'simsec_httpTestFixture000000',
    CARUP_PAY03B_SIMULATOR_PUBLIC_ORIGIN: base, CARUP_PAY01A_RETURN_ORIGIN: 'http://127.0.0.1:5183',
  };
  app.locals.pay03bDb = db;
  app.locals.pay03bEnv = env;
  app.locals.pay03bProvider = new Pay03bLocalSimulatorProvider({ env });
  t.after(async () => {
    supabase.from = originalFrom;
    server.close();
    await db.query('UPDATE public.pay03b_runtime_guard SET local_simulator_enabled = false WHERE singleton');
    await db.end();
  });

  await db.query(`INSERT INTO public.pay03b_runtime_guard (singleton, local_simulator_enabled, enabled_by, enabled_at, note)
    VALUES (true, true, 'pay03b-tenant-entitlements.test.js', clock_timestamp(), 'disposable test database only')
    ON CONFLICT (singleton) DO UPDATE SET local_simulator_enabled = true`);
  await db.query(`INSERT INTO public.users (id, name, email, role, join_date) VALUES
    ($1, 'HTTP Admin [SYNTHETIC]', $1 || '@carup-uat.invalid', 'admin', '2026-11-01'),
    ($2, 'HTTP Dealer Billing [SYNTHETIC]', $2 || '@carup-uat.invalid', 'dealer', '2026-11-01'),
    ($3, 'HTTP Dealer Staff [SYNTHETIC]', $3 || '@carup-uat.invalid', 'dealer', '2026-11-01'),
    ($4, 'HTTP Other Dealer [SYNTHETIC]', $4 || '@carup-uat.invalid', 'dealer', '2026-11-01')`, [u.admin, u.owner, u.staff, u.other]);
  await db.query(`INSERT INTO public.tenants (id, name, type, status) VALUES ($1, 'HTTP Dealer A', 'dealership', 'active'),
    ($2, 'HTTP Dealer B', 'dealership', 'active')`, [tA, tB]);
  await db.query(`INSERT INTO public.organizations (id, name, type, created_at, status, tenant_id) VALUES
    ($1, 'HTTP Dealer A Motors [SYNTHETIC]', 'dealership', '2026-11-01', 'active', $3),
    ($2, 'HTTP Dealer B Autos [SYNTHETIC]', 'dealership', '2026-11-01', 'active', $4)`, [`org_h3b_a_${run}`, `org_h3b_b_${run}`, tA, tB]);
  await db.query(`INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'dealer'), ($4, $5, 'admin')`,
    [tA, u.owner, u.staff, tB, u.other]);
  const { data: plan, error } = await db.rpc('pay03b_register_sandbox_plan_version', {
    p_plan_code: `dealer_http_std_${run}`, p_product_code: 'mkt.dealer.storefront_package', p_subscription_scope: 'dealer_storefront',
    p_subscriber_scope: 'dealer_organization', p_tier_rank: 10, p_display_name: 'HTTP Sandbox Standard', p_pricing_kind: 'sandbox_fixture',
    p_billing_interval: 'month', p_interval_count: 1, p_amount_minor: 3000, p_currency: 'JPY', p_currency_scale: 0,
    p_gateway: 'pay03b_local_provider_simulator', p_provider_price_ref: `sim_price_http_${run}`,
    p_entitlements: { 'dealer.inventory.published_listing_capacity': 10 }, p_trial_days: null, p_grace_days: null,
    p_change_policy: null, p_cancellation_policy: null, p_refund_policy: 'governed_admin_refund',
    p_approval_evidence_ref: 'HTTP-TEST-FIXTURE-AUTH', p_approved_by: 'http-test', p_created_by: 'http-test' });
  assert.equal(error, null);
  const terms = { planVersion: plan.plan_version, amountMinor: 3000, currency: 'JPY', billingInterval: 'month', intervalCount: 1 };
  const call = (method, url, { who = null, tenant = null, body, key } = {}) => fetch(`${base}${url}`, {
    method, redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(who ? { 'x-session-token': tokens[who] } : {}),
      ...(tenant ? { 'x-tenant-id': tenant } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  await t.test('public catalogue needs no session and never shows a sandbox price as an offer', async () => {
    const res = await call('GET', '/api/pay03b/catalogue');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.products.length, 7);
    assert.equal(JSON.stringify(body).includes('sandbox_fixture'), false);
    assert.ok(body.products.flatMap((p) => p.plans).every((p) => p.amountMinor === null));
  });

  await t.test('dealer routes: anonymous 401, missing tenant 400, foreign tenant 403 (middleware), staff read-only', async () => {
    assert.equal((await call('GET', '/api/pay03b/dealer/subscription')).status, 401);
    const noTenant = await call('GET', '/api/pay03b/dealer/subscription', { who: 'owner' });
    assert.equal(noTenant.status, 400);
    assert.equal((await noTenant.json()).code, 'PAY03B_TENANT_CONTEXT_REQUIRED');
    assert.equal((await call('GET', '/api/pay03b/dealer/subscription', { who: 'owner', tenant: tB })).status, 403);
    const staff = await call('GET', '/api/pay03b/dealer/subscription', { who: 'staff', tenant: tA });
    assert.equal(staff.status, 200);
    assert.equal(staff.headers.get('cache-control'), 'private, no-store');
    const overview = await staff.json();
    assert.equal(overview.billingAuthority, false);
    assert.equal(overview.providerMode, 'local_simulator');
    const staffBuy = await call('POST', '/api/pay03b/dealer/subscription/checkout', { who: 'staff', tenant: tA, key: `h3b_staff_${run}_000001`,
      body: { planId: plan.id, acknowledgedTerms: terms } });
    assert.equal(staffBuy.status, 403);
    assert.equal((await staffBuy.json()).code, 'PAY03B_BILLING_AUTHORITY_REFUSED');
  });

  let checkout;
  await t.test('billing admin checkout ignores browser money fields and goes through the simulated provider page', async () => {
    const res = await call('POST', '/api/pay03b/dealer/subscription/checkout', { who: 'owner', tenant: tA, key: `h3b_buy_${run}_0000001`,
      body: { planId: plan.id, acknowledgedTerms: terms, amountMinor: 1, currency: 'USD', priceRef: 'price_cheap', merchant: 'someone' } });
    assert.equal(res.status, 201);
    checkout = await res.json();
    assert.equal(checkout.amountMinor, 3000);
    assert.equal(checkout.currency, 'JPY');
    assert.equal(checkout.simulated, true);
    const page = await fetch(checkout.checkoutUrl);
    const html = await page.text();
    assert.match(html, /SIMULATED PROVIDER — NOT STRIPE/);
    assert.match(html, /JPY 3,000/);
    const pay = await fetch(`${base}/api/pay03b/simulator/checkout/${checkout.checkoutId}/complete`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'outcome=success' });
    assert.equal(pay.status, 303);
    assert.equal(pay.headers.get('location'), 'http://127.0.0.1:5183/dealer/subscription?pay03b=returned');
    const overview = await (await call('POST', '/api/pay03b/dealer/subscription/verify', { who: 'owner', tenant: tA })).json();
    assert.equal(overview.subscription.status, 'active');
    assert.equal(overview.entitlements.access, true);
    assert.equal(overview.invoices[0].paymentStatus, 'paid');
  });

  await t.test('a forged simulator webhook is refused; signed events are delivered over HTTP exactly once', async () => {
    const forged = await fetch(`${base}/api/pay03b/simulator/webhook`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pay03b-simulator-signature': 't=1,v1=00' },
      body: JSON.stringify({ id: 'sim_evt_forged', type: 'invoice.paid', livemode: false, account: 'acct_pay03b_local_simulator', data: { object: {} } }) });
    assert.equal(forged.status, 400);
    assert.equal((await forged.json()).code, 'PAY03B_SIMULATOR_SIGNATURE_INVALID');
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.pay03b_provider_event_receipts r
      JOIN public.pay03b_business_subscriptions s ON s.id = r.subscription_id WHERE s.owner_tenant_id = $1`, [tA]);
    assert.ok(rows[0].n >= 1);
  });

  await t.test('administrator routes: dealers are refused; admins see the subscription, the canonical source of truth and F5 inventory', async () => {
    assert.equal((await call('GET', '/api/pay03b/admin/subscriptions', { who: 'owner' })).status, 403);
    const list = await (await call('GET', '/api/pay03b/admin/subscriptions', { who: 'admin' })).json();
    const mine = list.subscriptions.find((s) => s.id === checkout.subscriptionId);
    assert.equal(mine.access, true);
    assert.match(list.sourceOfTruth, /payment_transactions/);
    const detail = await (await call('GET', `/api/pay03b/admin/subscriptions/${checkout.subscriptionId}`, { who: 'admin' })).json();
    assert.ok(detail.transitions.length >= 2);
    assert.equal(detail.invoices.length, 1);
    const exceptions = await call('GET', '/api/pay03b/admin/reconciliation-exceptions?status=open', { who: 'admin' });
    assert.equal(exceptions.status, 200);
    assert.equal((await call('GET', '/api/pay03b/admin/reconciliation-exceptions?status=everything', { who: 'admin' })).status, 400);
  });

  await t.test('administrator actions take the actor from the session, never from the body', async () => {
    const res = await call('POST', `/api/pay03b/admin/subscriptions/${checkout.subscriptionId}/suspension`, { who: 'admin',
      key: `h3b_susp_${run}_000001`, body: { action: 'suspend', reason: 'HTTP test compliance review', adminActorId: u.owner } });
    assert.equal(res.status, 200);
    const { rows } = await db.query(`SELECT requested_by FROM public.pay03b_subscription_change_requests
      WHERE subscription_id = $1 AND change_type = 'admin_suspend'`, [checkout.subscriptionId]);
    assert.equal(rows[0].requested_by, u.admin);
    const blocked = await (await call('GET', '/api/pay03b/dealer/subscription', { who: 'owner', tenant: tA })).json();
    assert.equal(blocked.entitlements.access, false);
    assert.equal(blocked.entitlements.reason, 'admin_suspension');
  });

  await t.test('simulator routes do not exist outside simulator mode', async () => {
    app.locals.pay03bEnv = { ...env, CARUP_PAY03B_PROVIDER_MODE: '' };
    app.locals.pay03bProvider = null;
    try {
      assert.equal((await fetch(`${base}/api/pay03b/simulator/checkout/${checkout.checkoutId}`)).status, 404);
    } finally {
      app.locals.pay03bEnv = env;
      app.locals.pay03bProvider = new Pay03bLocalSimulatorProvider({ env });
    }
  });
});
