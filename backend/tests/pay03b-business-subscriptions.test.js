/**
 * CARUP-PAY-03B-LR01 — subscription service lifecycle against REAL PostgreSQL (the canonical migrations and their
 * SECURITY DEFINER functions), with the clearly labelled local provider simulator as the provider.
 *
 * Requires PAY03B_TEST_PGURL pointing at a DISPOSABLE database prepared by scripts/ci/pay03b-postgres-certification.sh
 * (database name pay01c_sandbox_ci on 127.0.0.1/localhost). Every run uses fresh identities, so it can run after the
 * SQL smokes on the same database. Skipped (with a reason) when no disposable database is configured.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const PGURL = process.env.PAY03B_TEST_PGURL || '';
const disposable = /^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\/pay01c_sandbox_ci$/.test(PGURL) && !PGURL.includes(':54322/');
const skip = disposable ? false : 'PAY03B_TEST_PGURL must name a disposable pay01c_sandbox_ci database (see scripts/ci/pay03b-postgres-certification.sh)';

const S = await import('../services/payment/pay03bSubscriptionService.js');
const R = await import('../services/payment/pay03bReconciliationService.js');
const { Pay03bLocalSimulatorProvider } = await import('../services/payment/pay03bLocalSimulator.js');
const { Pay03bError } = await import('../services/payment/pay03bContract.js');
const { createPgSupabase } = await import('./helpers/pgSupabaseShim.js');

const run = crypto.randomBytes(4).toString('hex');
const ids = {
  admin: `p3b_admin_${run}`, owner: `p3b_owner_${run}`, staff: `p3b_staff_${run}`, ownerB: `p3b_owner_b_${run}`, outsider: `p3b_out_${run}`,
  tenantA: crypto.randomUUID(), tenantB: crypto.randomUUID(), orgA: `org_p3b_a_${run}`, orgB: `org_p3b_b_${run}`,
};
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay03b-svc-'));
const env = {
  NODE_ENV: 'test', CARUP_ENV: 'test', CARUP_PAY03B_ENABLED: 'true', CARUP_PAY03B_PROVIDER_MODE: 'local_simulator',
  CARUP_PAY03B_SIMULATOR_STATE_FILE: path.join(stateDir, 'state.json'), CARUP_PAY03B_SIMULATOR_PERIOD_SECONDS: '120',
  CARUP_PAY03B_SIMULATOR_WEBHOOK_SECRET: 'simsec_serviceTestFixture0000', CARUP_PAY01A_RETURN_ORIGIN: 'http://127.0.0.1:5183',
  CARUP_PAY03B_ENTITLEMENT_ENFORCEMENT: 'true',
};
let db;
let sim;
const plans = {};

async function deliverWith(provider, events, database = null) {
  const results = [];
  for (const event of events) {
    const signed = sim.signEvent(event);
    const verified = sim.verifyWebhook(signed);
    results.push(await S.processPay03bProviderEvent({ db: database || db, provider, event: verified }));
  }
  return results;
}
const deliver = (events) => deliverWith(sim, events);

/** The simulator with some operations replaced (provider faults, drift, timing), everything else unchanged. */
function wrapProvider(overrides) {
  return Object.assign(Object.create(sim), overrides);
}

/** A database handle that records every canonical RPC call (name + arguments) and then makes it for real. */
function spyDatabase(calls) {
  const spy = Object.create(db);
  spy.rpc = async (name, args) => { calls.push({ name, args }); return db.rpc(name, args); };
  return spy;
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function newDealer(label) {
  const d = { tenantId: crypto.randomUUID(), orgId: `org_p3b_${label}_${run}`, ownerId: `p3b_owner_${label}_${run}` };
  await db.query(`INSERT INTO public.users (id, name, email, role, join_date) VALUES ($1, $2, $1 || '@carup-uat.invalid', 'dealer', '2026-11-01')`,
    [d.ownerId, `Dealer ${label} [SYNTHETIC]`]);
  await db.query(`INSERT INTO public.tenants (id, name, type, status) VALUES ($1, $2, 'dealership', 'active')`, [d.tenantId, `Svc ${label} [SYNTHETIC]`]);
  await db.query(`INSERT INTO public.organizations (id, name, type, created_at, status, tenant_id) VALUES ($1, $2, 'dealership', '2026-11-01', 'active', $3)`,
    [d.orgId, `Svc ${label} Motors [SYNTHETIC]`, d.tenantId]);
  await db.query(`INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'admin')`, [d.tenantId, d.ownerId]);
  return d;
}

async function subscribedDealer(label) {
  const d = await newDealer(label);
  const c = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: d.ownerId, tenantId: d.tenantId, planId: plans.std.id,
    acknowledgedTerms: terms(plans.std), requestKey: `svc_${label}_${run}_0001` });
  await deliver((await sim.completeCheckout(c.checkoutId, { outcome: 'success' })).events);
  const { rows: [row] } = await db.query('SELECT * FROM public.pay03b_business_subscriptions WHERE id = $1', [c.subscriptionId]);
  return { ...d, subscriptionId: c.subscriptionId, providerSubscriptionId: row.provider_subscription_id };
}

const terms = (plan) => ({ planVersion: plan.plan_version, amountMinor: Number(plan.amount_minor), currency: plan.currency,
  billingInterval: plan.billing_interval, intervalCount: plan.interval_count });

test('PAY-03B service on real PostgreSQL', { skip }, async (t) => {
  db = createPgSupabase(PGURL);
  sim = new Pay03bLocalSimulatorProvider({ env });
  t.after(async () => {
    await db.query('UPDATE public.pay03b_runtime_guard SET local_simulator_enabled = false WHERE singleton');
    await db.end();
  });
  assert.equal((await db.query('select current_database() as d')).rows[0].d, 'pay01c_sandbox_ci');
  await db.query(`INSERT INTO public.pay03b_runtime_guard (singleton, local_simulator_enabled, enabled_by, enabled_at, note)
    VALUES (true, true, 'pay03b-business-subscriptions.test.js', clock_timestamp(), 'disposable test database only')
    ON CONFLICT (singleton) DO UPDATE SET local_simulator_enabled = true`);
  await db.query(`INSERT INTO public.users (id, name, email, role, join_date) VALUES
    ($1, 'Ops Admin [SYNTHETIC]', $1 || '@carup-uat.invalid', 'admin', '2026-11-01'),
    ($2, 'Dealer A Billing [SYNTHETIC]', $2 || '@carup-uat.invalid', 'dealer', '2026-11-01'),
    ($3, 'Dealer A Staff [SYNTHETIC]', $3 || '@carup-uat.invalid', 'dealer', '2026-11-01'),
    ($4, 'Dealer B Billing [SYNTHETIC]', $4 || '@carup-uat.invalid', 'dealer', '2026-11-01'),
    ($5, 'Outsider [SYNTHETIC]', $5 || '@carup-uat.invalid', 'dealer', '2026-11-01')`,
  [ids.admin, ids.owner, ids.staff, ids.ownerB, ids.outsider]);
  await db.query(`INSERT INTO public.tenants (id, name, type, status) VALUES ($1, 'Svc Dealer A [SYNTHETIC]', 'dealership', 'active'),
    ($2, 'Svc Dealer B [SYNTHETIC]', 'dealership', 'active')`, [ids.tenantA, ids.tenantB]);
  await db.query(`INSERT INTO public.organizations (id, name, type, created_at, status, tenant_id) VALUES
    ($1, 'Svc Dealer A Motors [SYNTHETIC]', 'dealership', '2026-11-01', 'active', $3),
    ($2, 'Svc Dealer B Autos [SYNTHETIC]', 'dealership', '2026-11-01', 'active', $4)`, [ids.orgA, ids.orgB, ids.tenantA, ids.tenantB]);
  await db.query(`INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'dealer'), ($4, $5, 'admin')`,
    [ids.tenantA, ids.owner, ids.staff, ids.tenantB, ids.ownerB]);
  const register = async (code, kind, tier, amount, price, entitlements, cancellation) => {
    const { data, error } = await db.rpc('pay03b_register_sandbox_plan_version', {
      p_plan_code: code, p_product_code: 'mkt.dealer.storefront_package', p_subscription_scope: 'dealer_storefront',
      p_subscriber_scope: 'dealer_organization', p_tier_rank: tier, p_display_name: `Svc ${code}`, p_pricing_kind: kind,
      p_billing_interval: kind === 'free' ? null : 'month', p_interval_count: kind === 'free' ? null : 1,
      p_amount_minor: amount, p_currency: 'JPY', p_currency_scale: 0, p_gateway: kind === 'free' ? null : 'pay03b_local_provider_simulator',
      p_provider_price_ref: price, p_entitlements: entitlements, p_trial_days: null, p_grace_days: null, p_change_policy: null,
      p_cancellation_policy: cancellation, p_refund_policy: 'governed_admin_refund', p_approval_evidence_ref: 'SERVICE-TEST-FIXTURE-AUTH',
      p_approved_by: 'service-test', p_created_by: 'service-test',
    });
    assert.equal(error, null, `register ${code}: ${error?.message}`);
    return data;
  };
  plans.baseline = await register('dealer_storefront_sandbox_baseline', 'free', 0, 0, null,
    { 'dealer.inventory.published_listing_capacity': 2 }, null);
  plans.std = await register(`dealer_svc_std_${run}`, 'sandbox_fixture', 10, 3000, `sim_price_std_${run}`,
    { 'dealer.inventory.published_listing_capacity': 10 }, null);
  plans.prem = await register(`dealer_svc_prem_${run}`, 'sandbox_fixture', 20, 6000, `sim_price_prem_${run}`,
    { 'dealer.inventory.published_listing_capacity': 50 }, { period_end: true, immediate: true });

  await t.test('authority: non-members are refused; staff without billing authority cannot buy; changed terms are refused', async () => {
    await assert.rejects(S.getPay03bDealerOverview({ db, env, actorId: ids.outsider, tenantId: ids.tenantA }),
      (e) => e.code === 'PAY03B_TENANT_MEMBERSHIP_REQUIRED' && e.status === 403);
    await assert.rejects(S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ids.staff, tenantId: ids.tenantA,
      planId: plans.std.id, acknowledgedTerms: terms(plans.std), requestKey: `svc_staff_${run}_0001` }),
    (e) => e.code === 'PAY03B_BILLING_AUTHORITY_REFUSED' && e.status === 403);
    await assert.rejects(S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA,
      planId: plans.std.id, acknowledgedTerms: { ...terms(plans.std), amountMinor: 100 }, requestKey: `svc_terms_${run}_0001` }),
    (e) => e.code === 'PAY03B_TERMS_CHANGED' && e.status === 409);
    const overview = await S.getPay03bDealerOverview({ db, env, actorId: ids.staff, tenantId: ids.tenantA });
    assert.equal(overview.billingAuthority, false);
    assert.equal(overview.organization.id, ids.orgA);
    assert.equal(overview.entitlements.access, false);
    assert.equal(overview.entitlements.effective['dealer.inventory.published_listing_capacity'], 2);
  });

  let subscriptionId;
  let firstEvents;
  await t.test('checkout is idempotent and single; the redirect alone grants nothing; the signed provider events do', async () => {
    const key = `svc_checkout_${run}_0001`;
    const first = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA,
      planId: plans.std.id, acknowledgedTerms: terms(plans.std), requestKey: key });
    assert.equal(first.simulated, true);
    assert.equal(first.live, false);
    assert.match(first.checkoutUrl, /\/api\/pay03b\/simulator\/checkout\/sim_cs_/);
    const replay = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA,
      planId: plans.std.id, acknowledgedTerms: terms(plans.std), requestKey: key });
    assert.equal(replay.subscriptionId, first.subscriptionId);
    assert.equal(replay.checkoutId, first.checkoutId);
    assert.equal(replay.idempotentReplay, true);
    await assert.rejects(S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA,
      planId: plans.prem.id, acknowledgedTerms: terms(plans.prem), requestKey: `svc_checkout_${run}_0002` }),
    (e) => e.code === 'PAY03B_SUBSCRIPTION_ALREADY_EXISTS');
    subscriptionId = first.subscriptionId;
    // The buyer comes back from checkout before paying: nothing is granted by the return trip.
    const early = await S.verifyPay03bDealerSubscription({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA });
    assert.equal(early.subscription.status, 'incomplete');
    assert.equal(early.entitlements.access, false);
    const done = await sim.completeCheckout(first.checkoutId, { outcome: 'success' });
    firstEvents = done.events;
    const results = await deliver(done.events);
    assert.equal(results[0].state, 'synchronized');
    const overview = await S.getPay03bDealerOverview({ db, env, actorId: ids.staff, tenantId: ids.tenantA });
    assert.equal(overview.subscription.status, 'active');
    assert.equal(overview.subscription.simulated, true);
    assert.equal(overview.entitlements.access, true);
    assert.equal(overview.entitlements.effective['dealer.inventory.published_listing_capacity'], 10);
    assert.equal(overview.invoices.length, 1);
    assert.equal(overview.invoices[0].paymentStatus, 'paid');
    const { rows } = await db.query(`SELECT gateway, amount, currency, status FROM public.payment_transactions WHERE reference = $1`,
      [overview.invoices[0].paymentReference]);
    assert.deepEqual(rows[0], { gateway: 'pay03b_local_provider_simulator', amount: 3000, currency: 'JPY', status: 'paid' });
    // Replaying a delivered event is a no-op.
    const [again] = await deliver([firstEvents[1]]);
    assert.equal(again.duplicateEvent, true);
  });

  await t.test('an abandoned checkout can be resumed (same plan, new key) or explicitly abandoned, never duplicated', async () => {
    const c = crypto.randomUUID();
    const orgC = `org_p3b_c_${run}`;
    const ownerC = `p3b_owner_c_${run}`;
    await db.query(`INSERT INTO public.users (id, name, email, role, join_date) VALUES ($1, 'Dealer C [SYNTHETIC]', $1 || '@carup-uat.invalid', 'dealer', '2026-11-01')`, [ownerC]);
    await db.query(`INSERT INTO public.tenants (id, name, type, status) VALUES ($1, 'Svc Dealer C [SYNTHETIC]', 'dealership', 'active')`, [c]);
    await db.query(`INSERT INTO public.organizations (id, name, type, created_at, status, tenant_id) VALUES ($1, 'Svc Dealer C Cars [SYNTHETIC]', 'dealership', '2026-11-01', 'active', $2)`, [orgC, c]);
    await db.query(`INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES ($1, $2, 'admin')`, [c, ownerC]);
    const first = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ownerC, tenantId: c, planId: plans.std.id,
      acknowledgedTerms: terms(plans.std), requestKey: `svc_abandon_${run}_0001` });
    // The page was reloaded and lost its key: the same plan resumes the SAME open checkout.
    const resumed = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ownerC, tenantId: c, planId: plans.std.id,
      acknowledgedTerms: terms(plans.std), requestKey: `svc_abandon_${run}_0002` });
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.checkoutId, first.checkoutId);
    assert.equal(resumed.subscriptionId, first.subscriptionId);
    await assert.rejects(S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ownerC, tenantId: c, planId: plans.prem.id,
      acknowledgedTerms: terms(plans.prem), requestKey: `svc_abandon_${run}_0003` }), (e) => e.code === 'PAY03B_SUBSCRIPTION_ALREADY_EXISTS');
    // Explicit abandon expires it at the provider; a fresh checkout is then possible.
    const abandoned = await S.abandonPay03bDealerCheckout({ db, env, provider: sim, actorId: ownerC, tenantId: c });
    assert.equal(abandoned.history[0]?.status ?? abandoned.subscription?.status, 'incomplete_expired');
    const fresh = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ownerC, tenantId: c, planId: plans.prem.id,
      acknowledgedTerms: terms(plans.prem), requestKey: `svc_abandon_${run}_0004` });
    assert.notEqual(fresh.subscriptionId, first.subscriptionId);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.pay03b_business_subscriptions WHERE owner_tenant_id = $1`, [c]);
    assert.equal(rows[0].n, 2);
    await assert.rejects(S.abandonPay03bDealerCheckout({ db, env, provider: sim, actorId: `p3b_staff_${run}`, tenantId: c }),
      (e) => e.code === 'PAY03B_TENANT_MEMBERSHIP_REQUIRED');
  });

  await t.test('renewal is collected once; a failed renewal never fabricates a payment; recovery restores', async () => {
    const ok = await sim.advanceToNextPeriod((await db.query('select provider_subscription_id from public.pay03b_business_subscriptions where id = $1',
      [subscriptionId])).rows[0].provider_subscription_id, { outcome: 'success' });
    await deliver(ok.events);
    let overview = await S.getPay03bDealerOverview({ db, env, actorId: ids.owner, tenantId: ids.tenantA });
    assert.equal(overview.invoices.filter((i) => i.paymentStatus === 'paid').length, 2);
    const paidThrough2 = overview.subscription.paidThrough;
    const providerSub = (await db.query('select provider_subscription_id from public.pay03b_business_subscriptions where id = $1',
      [subscriptionId])).rows[0].provider_subscription_id;
    const failed = await sim.advanceToNextPeriod(providerSub, { outcome: 'failure' });
    await deliver(failed.events);
    overview = await S.getPay03bDealerOverview({ db, env, actorId: ids.owner, tenantId: ids.tenantA });
    assert.equal(overview.subscription.status, 'past_due');
    const open = overview.invoices.find((i) => i.providerStatus === 'open');
    assert.equal(open.paymentStatus, 'pending', 'a failed renewal never fabricates a payment');
    assert.equal(overview.subscription.paidThrough, paidThrough2, 'coverage does not extend on a failed renewal');
    const recovered = await sim.payOpenInvoice(open.providerInvoiceId);
    await deliver(recovered.events);
    overview = await S.getPay03bDealerOverview({ db, env, actorId: ids.owner, tenantId: ids.tenantA });
    assert.equal(overview.subscription.status, 'active');
    assert.ok(Date.parse(overview.subscription.paidThrough) > Date.parse(paidThrough2));
    assert.equal(new Set(overview.invoices.map((i) => i.paymentReference)).size, 3, 'one canonical payment per invoice');
  });

  await t.test('F-L2-01: a target plan the subscription gateway cannot use is refused BEFORE any provider call (preview and change)', async () => {
    const d = await subscribedDealer('gw');
    const { data: stripeOnly, error } = await db.rpc('pay03b_register_sandbox_plan_version', {
      p_plan_code: 'svc_gw_stripe_only', p_product_code: 'mkt.dealer.storefront_package', p_subscription_scope: 'dealer_storefront',
      p_subscriber_scope: 'dealer_organization', p_tier_rank: 30, p_display_name: 'Svc Stripe-only plan', p_pricing_kind: 'sandbox_fixture',
      p_billing_interval: 'month', p_interval_count: 1, p_amount_minor: 9000, p_currency: 'JPY', p_currency_scale: 0,
      p_gateway: 'stripe_carup_japan_sandbox', p_provider_price_ref: 'price_svc_gw_stripe_only',
      p_entitlements: { 'dealer.inventory.published_listing_capacity': 99 }, p_trial_days: null, p_grace_days: null, p_change_policy: null,
      p_cancellation_policy: null, p_refund_policy: 'governed_admin_refund', p_approval_evidence_ref: 'SERVICE-TEST-FIXTURE-AUTH',
      p_approved_by: 'service-test', p_created_by: 'service-test',
    });
    assert.equal(error, null, `register svc_gw_stripe_only: ${error?.message}`);
    const calls = [];
    const spy = wrapProvider({
      getSubscription: async (...a) => { calls.push('getSubscription'); return sim.getSubscription(...a); },
      previewPlanChange: async (...a) => { calls.push('previewPlanChange'); return sim.previewPlanChange(...a); },
      changePlan: async (...a) => { calls.push('changePlan'); return sim.changePlan(...a); },
    });
    await assert.rejects(S.previewPay03bDealerPlanChange({ db, env, provider: spy, actorId: d.ownerId, tenantId: d.tenantId,
      targetPlanId: stripeOnly.id, mode: 'period_end' }), (e) => e.code === 'PAY03B_TARGET_PLAN_NOT_PURCHASABLE');
    await assert.rejects(S.changePay03bDealerPlan({ db, env, provider: spy, actorId: d.ownerId, tenantId: d.tenantId,
      targetPlanId: stripeOnly.id, mode: 'period_end', requestKey: `svc_gw_change_${run}_01` }),
    (e) => e.code === 'PAY03B_TARGET_PLAN_NOT_PURCHASABLE');
    assert.deepEqual(calls, [], 'a foreign gateway price reference never reaches the provider');
    await db.query("UPDATE public.pay03b_subscription_plans SET effective_to = clock_timestamp(), activation_status = 'retired' WHERE id = $1", [stripeOnly.id]);
  });

  await t.test('plan change at period end: provider-backed preview, no charge now, entitlements follow the PAID plan', async () => {
    const preview = await S.previewPay03bDealerPlanChange({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA,
      targetPlanId: plans.prem.id, mode: 'period_end' });
    assert.equal(preview.chargeNowMinor, 0);
    await assert.rejects(S.changePay03bDealerPlan({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA,
      targetPlanId: plans.prem.id, mode: 'immediate', requestKey: `svc_change_now_${run}_01` }),
    (e) => e.code === 'PAY03B_UPGRADE_POLICY_REFUSED');
    await assert.rejects(S.changePay03bDealerPlan({ db, env, provider: sim, actorId: ids.staff, tenantId: ids.tenantA,
      targetPlanId: plans.prem.id, mode: 'period_end', requestKey: `svc_change_staff_${run}_01` }),
    (e) => e.code === 'PAY03B_BILLING_AUTHORITY_REFUSED');
    const changed = await S.changePay03bDealerPlan({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA,
      targetPlanId: plans.prem.id, mode: 'period_end', requestKey: `svc_change_pe_${run}_01` });
    assert.equal(changed.overview.subscription.scheduledPlanChange, true);
    assert.equal(changed.overview.entitlements.effective['dealer.inventory.published_listing_capacity'], 10);
    const providerSub = (await db.query('select provider_subscription_id from public.pay03b_business_subscriptions where id = $1',
      [subscriptionId])).rows[0].provider_subscription_id;
    await deliver((await sim.advanceToNextPeriod(providerSub, { outcome: 'success' })).events);
    const overview = await S.getPay03bDealerOverview({ db, env, actorId: ids.owner, tenantId: ids.tenantA });
    assert.equal(overview.entitlements.effective['dealer.inventory.published_listing_capacity'], 50);
    assert.equal(overview.subscription.scheduledPlanChange, false);
  });

  await t.test('cancel at period end keeps paid access and can be resumed; immediate cancellation follows the terms', async () => {
    let out = await S.cancelPay03bDealerSubscription({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA,
      mode: 'period_end', requestKey: `svc_cancel_pe_${run}_01`, reason: 'Closing the storefront' });
    assert.equal(out.overview.subscription.cancelAtPeriodEnd, true);
    assert.equal(out.overview.entitlements.access, true);
    out = await S.cancelPay03bDealerSubscription({ db, env, provider: sim, actorId: ids.owner, tenantId: ids.tenantA,
      mode: 'resume', requestKey: `svc_resume_${run}_01` });
    assert.equal(out.overview.subscription.cancelAtPeriodEnd, false);
  });

  await t.test('administrator suspension is attributable and survives provider reconciliation', async () => {
    await assert.rejects(S.setPay03bAdminSuspension({ db, subscriptionId, adminActorId: ids.owner, action: 'suspend',
      reason: 'Dealer cannot use the admin path', requestKey: `svc_susp_bad_${run}_01` }), (e) => e.code === 'PAY03B_ADMIN_AUTHORITY_REFUSED');
    await S.setPay03bAdminSuspension({ db, subscriptionId, adminActorId: ids.admin, action: 'suspend',
      reason: 'Compliance review of the storefront', requestKey: `svc_susp_${run}_0001` });
    await S.reconcilePay03bAdminSubscription({ db, env, provider: sim, subscriptionId, adminActorId: ids.admin });
    let ent = await S.getPay03bTenantEntitlements({ db, tenantId: ids.tenantA });
    assert.equal(ent.access, false);
    assert.equal(ent.reason, 'admin_suspension');
    await S.setPay03bAdminSuspension({ db, subscriptionId, adminActorId: ids.admin, action: 'resume',
      reason: 'Compliance review closed, restoring', requestKey: `svc_resume_${run}_0001` });
    ent = await S.getPay03bTenantEntitlements({ db, tenantId: ids.tenantA });
    assert.equal(ent.access, true);
    const { rows } = await db.query(`SELECT event_type, actor_user_id FROM public.trust_audit_events
      WHERE new_value->>'subscriptionId' = $1 ORDER BY created_at`, [subscriptionId]);
    assert.ok(rows.some((r) => r.event_type === 'PAY03B_ADMIN_SUBSCRIPTION_SUSPENDED' && r.actor_user_id === ids.admin));
  });

  await t.test('F5 on a recurring invoice: an external partial refund holds access until a governed, freshly verified resolution', async () => {
    const b = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: ids.ownerB, tenantId: ids.tenantB,
      planId: plans.std.id, acknowledgedTerms: terms(plans.std), requestKey: `svc_checkout_b_${run}_01` });
    await deliver((await sim.completeCheckout(b.checkoutId, { outcome: 'success' })).events);
    const before = await S.getPay03bDealerOverview({ db, env, actorId: ids.ownerB, tenantId: ids.tenantB });
    assert.equal(before.entitlements.access, true);
    const { rows: [inv] } = await db.query(`SELECT provider_payment_intent_id, payment_reference FROM public.pay03b_subscription_invoices
      WHERE subscription_id = $1`, [b.subscriptionId]);
    await deliver((await sim.createExternalRefund({ paymentIntentId: inv.provider_payment_intent_id, amountMinor: 1000 })).events);
    const held = await S.getPay03bTenantEntitlements({ db, tenantId: ids.tenantB });
    assert.equal(held.access, false);
    assert.equal(held.reason, 'payment_reconciliation_hold');
    const { rows: [exc] } = await db.query(`SELECT id FROM public.pay03b_payment_reconciliation_exceptions
      WHERE payment_reference = $1 AND status = 'open'`, [inv.payment_reference]);
    // Restore is refused while the provider still shows the partial refund; revoke-final is accepted.
    await assert.rejects(R.resolvePay03bReconciliationException({ db, env, provider: sim, exceptionId: exc.id,
      resolution: 'restore_access_provider_unrefunded', note: 'Attempting restore while refund stands.', adminActorId: ids.admin }),
    (e) => e.code === 'PAY03B_RESTORE_REQUIRES_UNREFUNDED_PROVIDER_STATE');
    const resolved = await R.resolvePay03bReconciliationException({ db, env, provider: sim, exceptionId: exc.id,
      resolution: 'revoke_access_partial_refund_final', note: 'Dealer accepted the goodwill refund; access ends.', adminActorId: ids.admin });
    assert.equal(resolved.paymentStatus, 'partially_refunded');
    assert.equal((await S.getPay03bTenantEntitlements({ db, tenantId: ids.tenantB })).access, false);
  });

  await t.test('governed admin refund of the current invoice ends its paid coverage and is audited before the provider call', async () => {
    const overview = await S.getPay03bDealerOverview({ db, env, actorId: ids.owner, tenantId: ids.tenantA });
    const latest = overview.invoices.find((i) => i.paymentStatus === 'paid');
    await assert.rejects(S.refundPay03bAdminInvoice({ db, env, provider: sim, subscriptionId, invoiceId: latest.id,
      adminActorId: ids.admin, reason: 'short' }), (e) => e.code === 'PAY03B_ADMIN_REASON_REQUIRED');
    const after = await S.refundPay03bAdminInvoice({ db, env, provider: sim, subscriptionId, invoiceId: latest.id,
      adminActorId: ids.admin, reason: 'Governed sandbox refund of the latest storefront period' });
    const refunded = after.invoices.find((i) => i.id === latest.id);
    assert.equal(refunded.paymentStatus, 'refunded');
    assert.ok(Date.parse(after.subscription.paidThrough) < Date.parse(latest.periodEnd));
    const { rows } = await db.query(`SELECT event_type FROM public.trust_audit_events WHERE new_value->>'invoiceId' = $1
      ORDER BY created_at`, [latest.id]);
    assert.deepEqual(rows.map((r) => r.event_type), ['PAY03B_ADMIN_INVOICE_REFUND_REQUESTED', 'PAY03B_ADMIN_INVOICE_REFUND_RESULT']);
  });

  await t.test('webhook reference substitution is refused; unmatched provider objects change nothing', async () => {
    const other = await db.query(`SELECT provider_checkout_id FROM public.pay03b_business_subscriptions WHERE owner_tenant_id = $1`, [ids.tenantB]);
    const forged = { id: `sim_evt_forged_${run}`, type: 'checkout.session.completed', livemode: false, account: sim.accountId,
      data: { object: { id: other.rows[0].provider_checkout_id, object: 'checkout.session', mode: 'subscription',
        client_reference_id: (await db.query('select subscription_reference from public.pay03b_business_subscriptions where id = $1',
          [subscriptionId])).rows[0].subscription_reference } } };
    await assert.rejects(deliver([forged]), (e) => e.code === 'PAY03B_EVENT_REFERENCE_MISMATCH');
    const [ignored] = await deliver([{ id: `sim_evt_unmatched_${run}`, type: 'invoice.paid', livemode: false, account: sim.accountId,
      data: { object: { id: 'sim_in_999999', object: 'invoice', subscription: 'sim_sub_999999' } } }]);
    assert.equal(ignored.ignored, true);
  });

  await t.test('R1: a redelivered event finishes the invoice work an earlier attempt could not (no duplicate short-circuit)', async () => {
    const d = await newDealer('r1');
    const c = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: d.ownerId, tenantId: d.tenantId, planId: plans.std.id,
      acknowledgedTerms: terms(plans.std), requestKey: `svc_r1_${run}_0001` });
    const done = await sim.completeCheckout(c.checkoutId, { outcome: 'success' });
    const unreadable = wrapProvider({ getPaymentTruth: async () => { throw new Pay03bError('PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE', 502); } });
    await assert.rejects(deliverWith(unreadable, [done.events[0]]), (e) => e.code === 'PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE');
    assert.equal((await S.getPay03bTenantEntitlements({ db, tenantId: d.tenantId })).access, false,
      'nothing is granted while the invoice payment could not be read');
    // The provider retries the SAME event: it must re-read and finish, not answer "already processed".
    const [again] = await deliver([done.events[0]]);
    assert.equal(again.duplicateEvent, true);
    assert.equal(again.invoicesSynced, 1);
    assert.equal((await S.getPay03bTenantEntitlements({ db, tenantId: d.tenantId })).access, true);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM public.pay03b_provider_event_receipts WHERE event_id = $1', [done.events[0].id]);
    assert.equal(rows[0].n, 1, 'one receipt per provider event');
  });

  await t.test('R2: a transient failure on one invoice never stops the others and is rethrown so the event is redelivered', async () => {
    const d = await subscribedDealer('r2t');
    const { rows: [first] } = await db.query('SELECT provider_payment_intent_id FROM public.pay03b_subscription_invoices WHERE subscription_id = $1',
      [d.subscriptionId]);
    const renewal = await sim.advanceToNextPeriod(d.providerSubscriptionId, { outcome: 'success' });
    const flaky = wrapProvider({ getPaymentTruth: async (args) => {
      if (args.paymentIntentId === first.provider_payment_intent_id) throw new Pay03bError('PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE', 502);
      return sim.getPaymentTruth(args);
    } });
    await assert.rejects(deliverWith(flaky, [renewal.events[0]]), (e) => e.code === 'PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE');
    const overview = await S.getPay03bDealerOverview({ db, env, actorId: d.ownerId, tenantId: d.tenantId });
    assert.equal(overview.invoices.filter((i) => i.paymentStatus === 'paid').length, 2,
      'the renewal was recorded although the earlier invoice could not be re-read');
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.pay03b_subscription_sync_exceptions WHERE subscription_id = $1`,
      [d.subscriptionId]);
    assert.equal(rows[0].n, 0, 'a transient provider failure is retried, never quarantined');
  });

  await t.test('R2: an unrecordable invoice becomes a durable sync exception that suspends access without blocking the others', async () => {
    const d = await subscribedDealer('r2p');
    const renewal = await sim.advanceToNextPeriod(d.providerSubscriptionId, { outcome: 'success' });
    const forgedId = `sim_in_ungoverned_${run}`;
    const withForged = wrapProvider({ listSubscriptionInvoices: async (id) => {
      const real = await sim.listSubscriptionInvoices(id);
      return [...real, { ...real[0], id: forgedId, priceRef: `sim_price_ungoverned_${run}`, paymentIntentId: null, status: 'open',
        amountPaidMinor: 0, amountRemainingMinor: real[0].amountDueMinor, hostedInvoiceUrl: null }];
    } });
    const [res] = await deliverWith(withForged, [renewal.events[0]]);
    assert.equal(res.state, 'synchronized');
    assert.deepEqual(res.syncExceptions, [{ providerInvoiceId: forgedId, code: 'PAY03B_PROVIDER_PRICE_NOT_GOVERNED' }]);
    let overview = await S.getPay03bDealerOverview({ db, env, actorId: d.ownerId, tenantId: d.tenantId });
    assert.equal(overview.invoices.filter((i) => i.paymentStatus === 'paid').length, 2, 'the governed renewal still recorded');
    assert.equal(overview.entitlements.access, false, 'unknown financial state: paid access is suspended');
    assert.equal(overview.entitlements.reason, 'provider_sync_exception');
    await deliverWith(withForged, [renewal.events[0]]);
    const { rows: [x] } = await db.query(`SELECT status, observation_count, error_code FROM public.pay03b_subscription_sync_exceptions
      WHERE provider_invoice_id = $1`, [forgedId]);
    assert.deepEqual(x, { status: 'open', observation_count: 2, error_code: 'PAY03B_PROVIDER_PRICE_NOT_GOVERNED' });
    const admin = await S.readPay03bAdminSubscription({ db, subscriptionId: d.subscriptionId });
    assert.deepEqual(admin.syncExceptions.map((e) => [e.providerInvoiceId, e.errorCode, e.status]),
      [[forgedId, 'PAY03B_PROVIDER_PRICE_NOT_GOVERNED', 'open']]);
    // The provider no longer lists it (a deleted draft): a complete listing without it clears the exception.
    await S.reconcilePay03bAdminSubscription({ db, env, provider: sim, subscriptionId: d.subscriptionId, adminActorId: ids.admin });
    overview = await S.getPay03bDealerOverview({ db, env, actorId: d.ownerId, tenantId: d.tenantId });
    assert.equal(overview.entitlements.access, true);
    const { rows: [cleared] } = await db.query('SELECT status FROM public.pay03b_subscription_sync_exceptions WHERE provider_invoice_id = $1', [forgedId]);
    assert.equal(cleared.status, 'cleared');
  });

  await t.test('R6: provider observations are stamped BEFORE the provider is read (a slower, older read can never win)', async () => {
    const d = await newDealer('r6');
    const c = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: d.ownerId, tenantId: d.tenantId, planId: plans.std.id,
      acknowledgedTerms: terms(plans.std), requestKey: `svc_r6_${run}_0001` });
    await sim.completeCheckout(c.checkoutId, { outcome: 'success' });
    const reads = {};
    const slow = wrapProvider({
      getSubscription: async (id) => { reads.subscription = Date.now(); await pause(25); return sim.getSubscription(id); },
      listSubscriptionInvoices: async (id) => { reads.invoices = Date.now(); await pause(25); return sim.listSubscriptionInvoices(id); },
    });
    const calls = [];
    const { rows: [row] } = await db.query('SELECT * FROM public.pay03b_business_subscriptions WHERE id = $1', [c.subscriptionId]);
    await S.syncPay03bSubscriptionFromProvider({ db: spyDatabase(calls), provider: slow, subscriptionRow: row });
    const snap = calls.find((x) => x.name === 'pay03b_apply_subscription_snapshot' && x.args.p_provider_subscription_id);
    const inv = calls.find((x) => x.name === 'pay03b_record_subscription_invoice');
    assert.ok(Date.parse(snap.args.p_observed_at) <= reads.subscription, 'subscription observation stamped before its read');
    assert.ok(Date.parse(inv.args.p_observed_at) <= reads.invoices, 'invoice observation stamped before the listing');
  });

  await t.test('R10/R14: an opened invoice hold raises an operator alert; resolution evidence is stamped before the provider read', async () => {
    const d = await subscribedDealer('r10');
    const { rows: [inv] } = await db.query(`SELECT provider_payment_intent_id, payment_reference FROM public.pay03b_subscription_invoices
      WHERE subscription_id = $1`, [d.subscriptionId]);
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
    try {
      await deliver((await sim.createExternalRefund({ paymentIntentId: inv.provider_payment_intent_id, amountMinor: 500 })).events);
    } finally { console.warn = originalWarn; }
    const alert = warnings.find((w) => w.includes('PAY03B_PAYMENT_RECONCILIATION_HOLD_OPENED'));
    assert.ok(alert, 'an operator alert is logged when an invoice payment enters reconciliation hold');
    assert.ok(alert.includes(inv.payment_reference) && alert.includes(d.subscriptionId));
    const { rows: [exc] } = await db.query(`SELECT id FROM public.pay03b_payment_reconciliation_exceptions
      WHERE payment_reference = $1 AND status = 'open'`, [inv.payment_reference]);
    let readAt = null;
    const slow = wrapProvider({ getPaymentTruth: async (args) => { readAt = Date.now(); await pause(25); return sim.getPaymentTruth(args); } });
    const calls = [];
    await R.resolvePay03bReconciliationException({ db: spyDatabase(calls), env, provider: slow, exceptionId: exc.id,
      resolution: 'revoke_access_partial_refund_final', note: 'Partial refund stands; access for the period ends.', adminActorId: ids.admin });
    const resolve = calls.find((x) => x.name === 'pay03b_resolve_payment_reconciliation_exception');
    assert.ok(Date.parse(resolve.args.p_verified_at) <= readAt, 'verification time is taken before the provider read');
  });

  await t.test('R13: a provider checkout whose amount or currency differs from the governed plan is expired, never handed out', async () => {
    const d = await newDealer('r13');
    const drift = wrapProvider({ createSubscriptionCheckout: async (args) => ({ ...(await sim.createSubscriptionCheckout(args)),
      amountTotalMinor: Number(args.amountMinor) + 1, currency: args.currency }) });
    await assert.rejects(S.createPay03bDealerCheckout({ db, env, provider: drift, actorId: d.ownerId, tenantId: d.tenantId,
      planId: plans.std.id, acknowledgedTerms: terms(plans.std), requestKey: `svc_r13_${run}_0001` }),
    (e) => e.code === 'PAY03B_CHECKOUT_AMOUNT_MISMATCH' && e.status === 502);
    const { rows } = await db.query('SELECT status, provider_checkout_id FROM public.pay03b_business_subscriptions WHERE owner_tenant_id = $1', [d.tenantId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'incomplete_expired');
    assert.equal((await sim.getCheckout(rows[0].provider_checkout_id)).status, 'expired');
    const ok = await S.createPay03bDealerCheckout({ db, env, provider: sim, actorId: d.ownerId, tenantId: d.tenantId, planId: plans.std.id,
      acknowledgedTerms: terms(plans.std), requestKey: `svc_r13_${run}_0002` });
    assert.match(ok.checkoutUrl, /\/api\/pay03b\/simulator\/checkout\/sim_cs_/, 'nothing is left stuck: a fresh checkout is possible');
  });

  await t.test('listing capacity is enforced at the domain boundary from the tenant entitlement (sandbox enforcement only)', async () => {
    for (let i = 0; i < 2; i += 1) {
      await db.query(`INSERT INTO public.vehicles (vin, make, model, year, mileage, price, tenant_id, publication_status)
        VALUES ($1, 'Toyota', 'Hilux [SYNTHETIC]', 2021, 1000, 1, $2, 'published')`, [`P3BSVC${run}${i}`.toUpperCase(), ids.tenantB]);
    }
    await assert.rejects(S.assertPay03bListingCapacity({ db, env, tenantId: ids.tenantB, vehicleId: 'NEWVIN' }),
      (e) => e.code === 'PAY03B_LISTING_CAPACITY_REACHED' && e.status === 403 && e.details.capacity === 2);
    const off = await S.assertPay03bListingCapacity({ db, env: { ...env, CARUP_PAY03B_ENTITLEMENT_ENFORCEMENT: 'false' },
      tenantId: ids.tenantB, vehicleId: 'NEWVIN' });
    assert.equal(off.enforced, false, 'outside a governed sandbox the guard never changes existing dealer behaviour');
  });
});

test('R9: with enforcement on, a tenant with neither a baseline nor paid capacity is refused (fail closed), never uncapped', async () => {
  const stub = { rpc: async () => ({ data: { access: false, reason: 'no_subscription', baseline_entitlements: {}, subscription_entitlements: {} },
    error: null }) };
  await assert.rejects(S.assertPay03bListingCapacity({ db: stub, env: { CARUP_PAY03B_ENTITLEMENT_ENFORCEMENT: 'true' }, tenantId: 't_r9',
    vehicleId: 'VIN_R9' }), (e) => e.code === 'PAY03B_ENTITLEMENT_BASELINE_MISSING' && e.status === 503);
  const off = await S.assertPay03bListingCapacity({ db: stub, env: { CARUP_PAY03B_ENTITLEMENT_ENFORCEMENT: 'false' }, tenantId: 't_r9' });
  assert.equal(off.enforced, false);
});
