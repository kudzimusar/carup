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

async function deliver(events) {
  const results = [];
  for (const event of events) {
    const signed = sim.signEvent(event);
    const verified = sim.verifyWebhook(signed);
    results.push(await S.processPay03bProviderEvent({ db, provider: sim, event: verified }));
  }
  return results;
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
