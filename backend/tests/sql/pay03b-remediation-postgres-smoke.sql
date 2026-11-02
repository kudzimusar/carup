-- CARUP-PAY-03B-LR01 — independent-challenge remediation (R1-R14), disposable PostgreSQL certification.
-- Runs after pay03b-subscriptions-postgres-smoke.sql on the same disposable database (pay01c_sandbox_ci).

DO $$ BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN RAISE EXCEPTION 'PAY03B_DB_IDENTITY_REFUSED: %', current_database(); END IF;
END $$;

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_code IN SQLERRM) = 0 THEN RAISE EXCEPTION 'PAY03B_REM_WRONG_REFUSAL: expected % got %', p_code, SQLERRM; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'PAY03B_REM_NOT_REFUSED: expected %', p_code;
END $$;

CREATE FUNCTION pg_temp.inv(p_sub uuid, p_invoice text, p_reason text, p_price text, p_ps timestamptz, p_pe timestamptz,
  p_due bigint, p_paid bigint, p_status text, p_pi text, p_pay_status text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.pay03b_record_subscription_invoice(p_sub, p_invoice, p_reason, p_price, p_ps, p_pe, 'JPY', p_due, p_paid,
    greatest(p_due - p_paid, 0), p_status, p_pi, 1, NULL, clock_timestamp(), p_pay_status, NULL,
    CASE WHEN p_pay_status IS NULL THEN NULL ELSE 0 END, CASE WHEN p_pay_status IS NULL THEN NULL ELSE 0 END,
    CASE WHEN p_pay_status IS NULL THEN NULL ELSE '{}'::text[] END, NULL, 'provider_readback', NULL, NULL);
$$;

INSERT INTO public.users (id, name, email, role, join_date) VALUES
  ('rem_ops_admin', 'Rem Ops Admin [SYNTHETIC]', 'rem.ops@carup-uat.invalid', 'admin', '2026-11-01'),
  ('rem_member_admin', 'Rem Admin who is also a dealer member [SYNTHETIC]', 'rem.member.admin@carup-uat.invalid', 'admin', '2026-11-01'),
  ('rem_owner', 'Rem Dealer Billing [SYNTHETIC]', 'rem.owner@carup-uat.invalid', 'dealer', '2026-11-01')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenants (id, name, type, status) VALUES ('c3000000-0000-4000-8000-0000000000e1', 'Rem Dealer [SYNTHETIC]', 'dealership', 'active');
INSERT INTO public.organizations (id, name, type, created_at, status, tenant_id)
  VALUES ('org_pay03b_rem', 'Rem Dealer Motors [SYNTHETIC]', 'dealership', '2026-11-01', 'active', 'c3000000-0000-4000-8000-0000000000e1');
INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES
  ('c3000000-0000-4000-8000-0000000000e1', 'rem_owner', 'admin'),
  ('c3000000-0000-4000-8000-0000000000e1', 'rem_member_admin', 'dealer');

DO $$
DECLARE v_plan uuid; v_trial uuid; v_sub uuid; v_r jsonb; v_e jsonb; v_pay text; v_exc uuid; v_now timestamptz := clock_timestamp();
BEGIN
  v_plan := (public.pay03b_register_sandbox_plan_version('dealer_storefront_rem_std', 'mkt.dealer.storefront_package', 'dealer_storefront',
    'dealer_organization', 10, 'Rem Standard', 'sandbox_fixture', 'month', 1::smallint, 3000, 'JPY', 0::smallint, 'stripe_carup_japan_sandbox',
    'price_pay03b_rem_std', '{"dealer.inventory.published_listing_capacity":10}'::jsonb, NULL, NULL, NULL, NULL, 'governed_admin_refund',
    'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke')->>'id')::uuid;
  v_sub := (public.pay03b_claim_business_subscription_checkout('c3000000-0000-4000-8000-0000000000e1', 'org_pay03b_rem', 'rem_owner', v_plan,
    'pay03b_rem_claim_000001', 'stripe_carup_japan_sandbox')->'subscription'->>'id')::uuid;
  PERFORM public.pay03b_bind_billing_customer('c3000000-0000-4000-8000-0000000000e1', 'org_pay03b_rem', 'stripe_carup_japan_sandbox', 'cus_pay03brem', 'rem_owner');
  PERFORM public.pay03b_attach_subscription_checkout(v_sub, 'cs_test_pay03brem', 'cus_pay03brem');

  -- R6: observations stamped in the future beyond a few seconds are refused (clock skew cannot make reads "stale").
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_apply_subscription_snapshot(%L, 'sub_pay03brem', 'active', 'price_pay03b_rem_std',
    clock_timestamp(), clock_timestamp() + interval '30 days', false, NULL, NULL, NULL, clock_timestamp() + interval '1 minute', NULL, NULL, NULL)$q$, v_sub),
    'PAY03B_PROVIDER_OBSERVATION_TIME_INVALID');

  -- R1: the same event id delivered again re-applies the (fresh) state instead of being skipped.
  PERFORM public.pay03b_apply_subscription_snapshot(v_sub, 'sub_pay03brem', 'incomplete', 'price_pay03b_rem_std', v_now, v_now + interval '30 days',
    false, NULL, NULL, NULL, v_now - interval '10 minutes', 'evt_pay03brem1', 'customer.subscription.created', NULL);
  v_r := public.pay03b_apply_subscription_snapshot(v_sub, 'sub_pay03brem', 'active', 'price_pay03b_rem_std', v_now, v_now + interval '30 days',
    false, NULL, NULL, NULL, v_now - interval '9 minutes', 'evt_pay03brem1', 'customer.subscription.created', NULL);
  IF v_r->>'status' IS DISTINCT FROM 'active' OR (v_r->>'duplicate_event')::boolean IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.pay03b_provider_event_receipts WHERE event_id = 'evt_pay03brem1') <> 1 THEN
    RAISE EXCEPTION 'PAY03B_REM_R1_DUPLICATE_SKIPPED_WORK: %', v_r;
  END IF;

  -- R3: a draft invoice's amount follows the provider until finalization, and its anomaly is recomputed.
  v_r := pg_temp.inv(v_sub, 'in_pay03brem1', 'subscription_create', 'price_pay03b_rem_std', v_now, v_now + interval '30 days', 2500, 0, 'draft', NULL, NULL);
  IF v_r->'invoice'->>'anomaly' IS DISTINCT FROM 'amount_mismatch' THEN RAISE EXCEPTION 'PAY03B_REM_R3_DRAFT_ANOMALY_MISSING: %', v_r; END IF;
  v_r := pg_temp.inv(v_sub, 'in_pay03brem1', 'subscription_create', 'price_pay03b_rem_std', v_now, v_now + interval '30 days', 3000, 3000, 'paid', 'pi_pay03brem1', 'paid');
  IF (v_r->'invoice'->>'amount_due_minor')::bigint IS DISTINCT FROM 3000 OR v_r->'invoice'->>'anomaly' IS NOT NULL OR v_r->'payment'->>'status' IS DISTINCT FROM 'paid'
     OR NOT (public.pay03b_resolve_tenant_entitlements('c3000000-0000-4000-8000-0000000000e1', 'dealer_storefront')->>'access')::boolean THEN
    RAISE EXCEPTION 'PAY03B_REM_R3_DRAFT_AMOUNT_FROZEN: %', v_r;
  END IF;

  -- R4: a manual invoice never extends paid coverage, whatever its amount or period.
  v_r := pg_temp.inv(v_sub, 'in_pay03brem_manual', 'manual', 'price_pay03b_rem_std', v_now, v_now + interval '4 years', 1, 1, 'paid', 'pi_pay03brem_manual', 'paid');
  IF v_r->'invoice'->>'anomaly' IS DISTINCT FROM 'manual_invoice_not_coverage'
     OR (SELECT paid_through FROM public.pay03b_business_subscriptions WHERE id = v_sub) > v_now + interval '31 days' THEN
    RAISE EXCEPTION 'PAY03B_REM_R4_MANUAL_INVOICE_GRANTED_COVERAGE: %', v_r;
  END IF;
  -- R4, second line on its own: even a manual invoice that lost its anomaly is not coverage (the derivation counts
  -- only subscription create/cycle/update invoices).
  UPDATE public.pay03b_subscription_invoices SET anomaly = NULL WHERE provider_invoice_id = 'in_pay03brem_manual';
  PERFORM public.pay03b_refresh_paid_coverage(v_sub, 'smoke_second_line_check', NULL);
  IF (SELECT paid_through FROM public.pay03b_business_subscriptions WHERE id = v_sub) > v_now + interval '31 days' THEN
    RAISE EXCEPTION 'PAY03B_REM_R4_COVERAGE_COUNTS_MANUAL_INVOICES';
  END IF;
  UPDATE public.pay03b_subscription_invoices SET anomaly = 'manual_invoice_not_coverage' WHERE provider_invoice_id = 'in_pay03brem_manual';

  -- R2: an uncollectible invoice that is later paid is credited (uncollectible is not terminal).
  v_r := pg_temp.inv(v_sub, 'in_pay03brem2', 'subscription_cycle', 'price_pay03b_rem_std', v_now + interval '30 days', v_now + interval '60 days', 3000, 0, 'uncollectible', 'pi_pay03brem2', 'pending');
  IF v_r->'payment'->>'status' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'PAY03B_REM_R2_UNCOLLECTIBLE_CANCELLED_PAYMENT: %', v_r; END IF;
  v_r := pg_temp.inv(v_sub, 'in_pay03brem2', 'subscription_cycle', 'price_pay03b_rem_std', v_now + interval '30 days', v_now + interval '60 days', 3000, 3000, 'paid', 'pi_pay03brem2', 'paid');
  IF v_r->'invoice'->>'provider_status' IS DISTINCT FROM 'paid' OR v_r->'payment'->>'status' IS DISTINCT FROM 'paid'
     OR (SELECT paid_through FROM public.pay03b_business_subscriptions WHERE id = v_sub) < v_now + interval '59 days' THEN
    RAISE EXCEPTION 'PAY03B_REM_R2_UNCOLLECTIBLE_THEN_PAID_REFUSED: %', v_r;
  END IF;

  -- R2: a credit-only proration invoice (nothing due) is recorded as a non-coverage anomaly instead of being refused.
  v_r := pg_temp.inv(v_sub, 'in_pay03brem_credit', 'subscription_update', 'price_pay03b_rem_std', v_now + interval '40 days',
    v_now + interval '60 days', 0, 0, 'paid', NULL, NULL);
  IF v_r->'invoice'->>'anomaly' IS DISTINCT FROM 'credit_only_proration'
     OR (SELECT paid_through FROM public.pay03b_business_subscriptions WHERE id = v_sub) > v_now + interval '61 days' THEN
    RAISE EXCEPTION 'PAY03B_REM_R2_CREDIT_ONLY_PRORATION_WRONG: %', v_r;
  END IF;

  -- R1 (invoice writer): the same event id delivered again re-applies the newer invoice state, never "already done".
  v_r := public.pay03b_record_subscription_invoice(v_sub, 'in_pay03brem3', 'subscription_cycle', 'price_pay03b_rem_std',
    v_now + interval '60 days', v_now + interval '90 days', 'JPY', 3000, 0, 3000, 'open', 'pi_pay03brem3', 1, NULL, clock_timestamp(),
    'pending', NULL, 0, 0, '{}'::text[], NULL, 'signed_webhook', 'evt_pay03brem_inv3', 'invoice.payment_failed');
  v_r := public.pay03b_record_subscription_invoice(v_sub, 'in_pay03brem3', 'subscription_cycle', 'price_pay03b_rem_std',
    v_now + interval '60 days', v_now + interval '90 days', 'JPY', 3000, 3000, 0, 'paid', 'pi_pay03brem3', 2, NULL, clock_timestamp(),
    'paid', NULL, 0, 0, '{}'::text[], NULL, 'signed_webhook', 'evt_pay03brem_inv3', 'invoice.payment_failed');
  IF (v_r->>'duplicate_event')::boolean IS DISTINCT FROM true OR v_r->'payment'->>'status' IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'PAY03B_REM_R1_INVOICE_DUPLICATE_SKIPPED_WORK: %', v_r;
  END IF;

  -- R2: a permanent per-invoice problem is a durable, operator-visible sync exception that suspends paid access
  -- until the invoice records cleanly, without blocking anything else.
  PERFORM public.pay03b_record_sync_exception(v_sub, 'in_pay03brem_bad', 'PAY03B_PROVIDER_PRICE_NOT_GOVERNED');
  v_e := public.pay03b_resolve_tenant_entitlements('c3000000-0000-4000-8000-0000000000e1', 'dealer_storefront');
  IF (v_e->>'access')::boolean IS NOT FALSE OR v_e->>'reason' IS DISTINCT FROM 'provider_sync_exception' THEN RAISE EXCEPTION 'PAY03B_REM_R2_SYNC_EXCEPTION_KEPT_ACCESS: %', v_e; END IF;
  PERFORM public.pay03b_record_sync_exception(v_sub, 'in_pay03brem_bad', 'PAY03B_PROVIDER_PRICE_NOT_GOVERNED');
  IF (SELECT observation_count FROM public.pay03b_subscription_sync_exceptions WHERE subscription_id = v_sub AND status = 'open') <> 2 THEN
    RAISE EXCEPTION 'PAY03B_REM_R2_SYNC_EXCEPTION_NOT_DEDUPED';
  END IF;
  PERFORM public.pay03b_clear_sync_exceptions(v_sub, 'in_pay03brem_bad');
  IF NOT (public.pay03b_resolve_tenant_entitlements('c3000000-0000-4000-8000-0000000000e1', 'dealer_storefront')->>'access')::boolean THEN
    RAISE EXCEPTION 'PAY03B_REM_R2_CLEARED_SYNC_EXCEPTION_STILL_BLOCKS';
  END IF;

  -- R5: a platform admin who is a member of the paying tenant cannot resolve that tenant's held invoice payment.
  SELECT payment_reference INTO v_pay FROM public.pay03b_subscription_invoices WHERE provider_invoice_id = 'in_pay03brem1';
  PERFORM public.pay03b_record_subscription_invoice(v_sub, 'in_pay03brem1', 'subscription_create', 'price_pay03b_rem_std', v_now,
    v_now + interval '30 days', 'JPY', 3000, 3000, 0, 'paid', 'pi_pay03brem1', 1, NULL, clock_timestamp(), 'reconciliation_hold', NULL,
    500, 0, ARRAY['re_pay03brempart'], 'partial_refund_succeeded', 'signed_webhook', NULL, NULL);
  SELECT id INTO v_exc FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_pay AND status = 'open';
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'revoke_access_partial_refund_final', 'rem_member_admin', 'admin', 'Member of the paying tenant tries to resolve.', 'reconciliation_hold',
    500, 0, ARRAY['re_pay03brempart'], clock_timestamp())$q$, v_exc), 'PAY03B_RESOLUTION_SELF_DEALING_REFUSED');

  -- R10: a provider observation newer than the operator's verification refuses the resolution (stale evidence).
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'revoke_access_partial_refund_final', 'rem_ops_admin', 'admin', 'Verification older than the latest observation.', 'reconciliation_hold',
    500, 0, ARRAY['re_pay03brempart'], clock_timestamp() - interval '5 minutes')$q$, v_exc), 'PAY03B_PROVIDER_VERIFICATION_SUPERSEDED');

  -- R11: nothing outside the governed functions can lift a hold, and leaving a hold for 'refunded' needs full-refund evidence.
  PERFORM pg_temp.expect_error(format($q$UPDATE public.payment_transactions SET status = 'paid' WHERE reference = %L$q$, v_pay),
    'PAY03B_HOLD_RELEASE_REQUIRES_GOVERNED_PATH');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_record_subscription_invoice(%L, 'in_pay03brem1', 'subscription_create',
    'price_pay03b_rem_std', clock_timestamp(), clock_timestamp() + interval '30 days', 'JPY', 3000, 3000, 0, 'paid', 'pi_pay03brem1', 1, NULL,
    clock_timestamp(), 'refunded', 're_pay03brempart', 700, 0, ARRAY['re_pay03brempart'], NULL, 'signed_webhook', NULL, NULL)$q$, v_sub),
    'PAY03B_FULL_REFUND_EVIDENCE_REQUIRED');
  IF (SELECT status FROM public.payment_transactions WHERE reference = v_pay) IS DISTINCT FROM 'reconciliation_hold' THEN
    RAISE EXCEPTION 'PAY03B_REM_R11_HOLD_LIFTED';
  END IF;
  PERFORM public.pay03b_resolve_payment_reconciliation_exception(v_exc, 'revoke_access_partial_refund_final', 'rem_ops_admin', 'admin',
    'Goodwill partial refund accepted by the dealer; the period is not covered.', 'reconciliation_hold', 500, 0, ARRAY['re_pay03brempart'], clock_timestamp());
  IF (SELECT status FROM public.payment_transactions WHERE reference = v_pay) IS DISTINCT FROM 'partially_refunded' THEN
    RAISE EXCEPTION 'PAY03B_REM_R11_GOVERNED_RESOLUTION_BLOCKED';
  END IF;
  -- R11: the governed invoice writer can still move a final partial refund to 'refunded' when the provider shows the
  -- full amount refunded (it marks its own UPDATE; nothing else can).
  PERFORM public.pay03b_record_subscription_invoice(v_sub, 'in_pay03brem1', 'subscription_create', 'price_pay03b_rem_std', v_now,
    v_now + interval '30 days', 'JPY', 3000, 3000, 0, 'paid', 'pi_pay03brem1', 1, NULL, clock_timestamp(), 'refunded', 're_pay03brempart',
    3000, 0, ARRAY['re_pay03brempart', 're_pay03bremrest'], NULL, 'signed_webhook', NULL, NULL);
  IF (SELECT status FROM public.payment_transactions WHERE reference = v_pay) IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'PAY03B_REM_R11_GOVERNED_FULL_REFUND_BLOCKED';
  END IF;

  -- R6: a cancelled subscription is terminal for provider observations (a stale "active" read cannot revive it).
  PERFORM public.pay03b_apply_subscription_snapshot(v_sub, 'sub_pay03brem', 'canceled', 'price_pay03b_rem_std', v_now, v_now + interval '30 days',
    false, v_now, v_now, NULL, clock_timestamp() - interval '2 seconds', NULL, NULL, NULL);
  v_r := public.pay03b_apply_subscription_snapshot(v_sub, 'sub_pay03brem', 'active', 'price_pay03b_rem_std', v_now, v_now + interval '30 days',
    false, NULL, NULL, NULL, clock_timestamp(), NULL, NULL, NULL);
  IF v_r->>'status' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'PAY03B_REM_R6_CANCELLED_REVIVED: %', v_r; END IF;

  -- R14: an administrator replay with the same key but a different action is a conflict, not a silent no-op.
  PERFORM public.pay03b_admin_set_subscription_suspension(v_sub, 'rem_ops_admin', 'suspend', 'Remediation smoke suspension', 'pay03b_rem_admin_0001');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_admin_set_subscription_suspension(%L, 'rem_ops_admin', 'resume',
    'Remediation smoke resume with a reused key', 'pay03b_rem_admin_0001')$q$, v_sub), 'PAY03B_CHANGE_IDEMPOTENCY_CONFLICT');
  -- R14: lifting the suspension restores the PROVIDER-backed state through the shared mapping (cancelled stays cancelled).
  v_r := public.pay03b_admin_set_subscription_suspension(v_sub, 'rem_ops_admin', 'resume', 'Remediation smoke resume after review',
    'pay03b_rem_admin_0002');
  IF v_r->'subscription'->>'status' IS DISTINCT FROM 'cancelled' OR v_r->'subscription'->>'suspended_reason' IS NOT NULL THEN
    RAISE EXCEPTION 'PAY03B_REM_R14_RESUME_IGNORED_PROVIDER_STATE: %', v_r;
  END IF;
  -- R6, second line on its own: an agreement CarUp already holds as cancelled stays cancelled even when its last known
  -- provider status is not terminal (for example an immediate cancellation recorded before the provider's own read).
  UPDATE public.pay03b_business_subscriptions SET provider_status = 'active', version = version + 1 WHERE id = v_sub;
  v_r := public.pay03b_apply_subscription_snapshot(v_sub, 'sub_pay03brem', 'active', 'price_pay03b_rem_std', v_now, v_now + interval '30 days',
    false, NULL, NULL, NULL, clock_timestamp(), NULL, NULL, NULL);
  IF v_r->>'status' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'PAY03B_REM_R6_CANCELLED_STATUS_REVIVED: %', v_r; END IF;

  -- R8: an approved trial never lasts longer than the plan's trial days, whatever the provider's trial_end says.
  v_trial := (public.pay03b_register_sandbox_plan_version('dealer_storefront_rem_trial', 'mkt.dealer.storefront_package', 'dealer_storefront',
    'dealer_organization', 12, 'Rem Trial', 'sandbox_fixture', 'month', 1::smallint, 3000, 'JPY', 0::smallint, 'stripe_carup_japan_sandbox',
    'price_pay03b_rem_trial', '{"dealer.inventory.published_listing_capacity":10}'::jsonb, 7, NULL, NULL, NULL, 'governed_admin_refund',
    'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke')->>'id')::uuid;
  IF (public.pay03b_subscription_access(
        ROW(gen_random_uuid(), 'pay03b_sub_' || gen_random_uuid(), 'c3000000-0000-4000-8000-0000000000e1', 'org_pay03b_rem', 'dealer_storefront',
            v_trial, 'mkt.dealer.storefront_package', 'trialing', 'stripe_carup_japan_sandbox', 'acct_1UVnGaEjgXqvlsJk', NULL, NULL, NULL,
            'trialing', 'rem_owner', 'pay03b_rem_trial_00001', NULL, NULL, NULL, NULL, v_now + interval '300 days', NULL, false, NULL, NULL,
            NULL, NULL, NULL, 1, v_now - interval '8 days', v_now)::public.pay03b_business_subscriptions, v_now)->>'access')::boolean THEN
    RAISE EXCEPTION 'PAY03B_REM_R8_TRIAL_UNCAPPED';
  END IF;
  -- R14: ONE provider-status mapping (snapshot writer and administrator resume): a provider trial or grace is honoured
  -- only when the plan approves it.
  SELECT public.pay03b_map_provider_status(pl, 'trialing') INTO v_e FROM public.pay03b_subscription_plans pl WHERE pl.id = v_plan;
  IF v_e IS DISTINCT FROM '{"status": "suspended", "reason": "unauthorized_provider_trial"}'::jsonb THEN
    RAISE EXCEPTION 'PAY03B_REM_R14_UNAPPROVED_TRIAL_HONOURED: %', v_e;
  END IF;
  SELECT public.pay03b_map_provider_status(pl, 'past_due') INTO v_e FROM public.pay03b_subscription_plans pl WHERE pl.id = v_plan;
  IF v_e IS DISTINCT FROM '{"status": "past_due"}'::jsonb THEN RAISE EXCEPTION 'PAY03B_REM_R14_UNAPPROVED_GRACE_HONOURED: %', v_e; END IF;
  SELECT public.pay03b_map_provider_status(pl, 'trialing') INTO v_e FROM public.pay03b_subscription_plans pl WHERE pl.id = v_trial;
  IF v_e IS DISTINCT FROM '{"status": "trialing"}'::jsonb THEN RAISE EXCEPTION 'PAY03B_REM_R14_APPROVED_TRIAL_REFUSED: %', v_e; END IF;
  RAISE NOTICE 'PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: R1 R2 R3 R4 R5 R6 R8 R10 R11 R14 verified on the canonical functions';
END $$;

-- L2-03 (Level 2 Stripe sandbox finding): a governed full refund of a PAID invoice revokes that period's paid coverage,
-- and the lifecycle transition that records the revocation names the canonical payment outcome. The provider invoice
-- itself stays 'paid' after its charge is refunded, so a cause derived from the invoice status alone read 'invoice_paid'.
INSERT INTO public.tenants (id, name, type, status) VALUES ('c3000000-0000-4000-8000-0000000000e2', 'Rem Dealer Two [SYNTHETIC]', 'dealership', 'active');
INSERT INTO public.organizations (id, name, type, created_at, status, tenant_id)
  VALUES ('org_pay03b_rem2', 'Rem Dealer Two Motors [SYNTHETIC]', 'dealership', '2026-11-01', 'active', 'c3000000-0000-4000-8000-0000000000e2');
INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES ('c3000000-0000-4000-8000-0000000000e2', 'rem_owner', 'admin');

DO $$
DECLARE v_plan uuid; v_sub uuid; v_now timestamptz := clock_timestamp(); v_last text;
BEGIN
  SELECT id INTO v_plan FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_rem_std' AND effective_to IS NULL;
  v_sub := (public.pay03b_claim_business_subscription_checkout('c3000000-0000-4000-8000-0000000000e2', 'org_pay03b_rem2', 'rem_owner', v_plan,
    'pay03b_rem_claim_000002', 'stripe_carup_japan_sandbox')->'subscription'->>'id')::uuid;
  PERFORM public.pay03b_bind_billing_customer('c3000000-0000-4000-8000-0000000000e2', 'org_pay03b_rem2', 'stripe_carup_japan_sandbox', 'cus_pay03brem2', 'rem_owner');
  PERFORM public.pay03b_attach_subscription_checkout(v_sub, 'cs_test_pay03brem2', 'cus_pay03brem2');
  PERFORM public.pay03b_apply_subscription_snapshot(v_sub, 'sub_pay03brem2', 'active', 'price_pay03b_rem_std', v_now, v_now + interval '30 days',
    false, NULL, NULL, NULL, clock_timestamp(), NULL, NULL, NULL);
  PERFORM pg_temp.inv(v_sub, 'in_pay03brem2a', 'subscription_create', 'price_pay03b_rem_std', v_now, v_now + interval '30 days',
    3000, 3000, 'paid', 'pi_pay03brem2a', 'paid');
  PERFORM pg_temp.inv(v_sub, 'in_pay03brem2b', 'subscription_cycle', 'price_pay03b_rem_std', v_now + interval '30 days', v_now + interval '60 days',
    3000, 3000, 'paid', 'pi_pay03brem2b', 'paid');
  IF (SELECT paid_through FROM public.pay03b_business_subscriptions WHERE id = v_sub) IS DISTINCT FROM v_now + interval '60 days' THEN
    RAISE EXCEPTION 'PAY03B_REM_L2_03_SETUP: the paid renewal does not extend coverage';
  END IF;
  -- The provider-confirmed full refund of the renewal, as the governed administrator refund's provider read records it.
  PERFORM public.pay03b_record_subscription_invoice(v_sub, 'in_pay03brem2b', 'subscription_cycle', 'price_pay03b_rem_std',
    v_now + interval '30 days', v_now + interval '60 days', 'JPY', 3000, 3000, 0, 'paid', 'pi_pay03brem2b', 1, NULL, clock_timestamp(),
    'refunded', 're_pay03brem2b', 3000, 0, ARRAY['re_pay03brem2b'], NULL, 'provider_readback', NULL, NULL);
  IF (SELECT paid_through FROM public.pay03b_business_subscriptions WHERE id = v_sub) IS DISTINCT FROM v_now + interval '30 days' THEN
    RAISE EXCEPTION 'PAY03B_REM_L2_03_COVERAGE_NOT_REVOKED';
  END IF;
  SELECT cause INTO v_last FROM public.pay03b_subscription_transitions WHERE subscription_id = v_sub ORDER BY recorded_at DESC LIMIT 1;
  IF v_last IS DISTINCT FROM 'invoice_paid:payment_refunded' THEN
    RAISE EXCEPTION 'PAY03B_REM_L2_03_TRANSITION_CAUSE: the coverage revocation is recorded as %', v_last;
  END IF;
  IF (SELECT count(*) FROM public.pay03b_subscription_transitions WHERE subscription_id = v_sub AND cause = 'invoice_paid') <> 2 THEN
    RAISE EXCEPTION 'PAY03B_REM_L2_03_PAID_CAUSE_CHANGED: an ordinary paid invoice must still be recorded as invoice_paid';
  END IF;
  RAISE NOTICE 'PAY03B_REMEDIATION_POSTGRES_SMOKE_PASS: L2-03 a refund-driven coverage revocation names the canonical payment outcome';
END $$;
