-- CARUP-PAY-03B-LR01 — disposable PostgreSQL certification of the canonical business subscription authority.
-- Runs after pay03b-f5-reconciliation-postgres-smoke.sql on the same disposable database (pay01c_sandbox_ci).
-- All identities, organizations and provider identifiers below are synthetic fixtures of this disposable DB.

DO $$
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY03B_DB_IDENTITY_REFUSED: %', current_database();
  END IF;
END $$;

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_code IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'PAY03B_SUB_WRONG_REFUSAL: expected % got %', p_code, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'PAY03B_SUB_NOT_REFUSED: expected %', p_code;
END $$;

CREATE FUNCTION pg_temp.snap(p_sub uuid, p_provider_sub text, p_status text, p_price text, p_ps timestamptz,
  p_pe timestamptz, p_cape boolean, p_canceled timestamptz, p_ended timestamptz, p_observed timestamptz, p_evt text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.pay03b_apply_subscription_snapshot(p_sub, p_provider_sub, p_status, p_price, p_ps, p_pe, p_cape,
    p_canceled, p_ended, NULL, p_observed, p_evt, CASE WHEN p_evt IS NULL THEN NULL ELSE 'customer.subscription.updated' END, NULL);
$$;

CREATE FUNCTION pg_temp.inv(p_sub uuid, p_invoice text, p_reason text, p_price text, p_ps timestamptz, p_pe timestamptz,
  p_due bigint, p_paid bigint, p_status text, p_pi text, p_pay_status text, p_evt text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.pay03b_record_subscription_invoice(p_sub, p_invoice, p_reason, p_price, p_ps, p_pe, 'JPY', p_due, p_paid,
    greatest(p_due - p_paid, 0), p_status, p_pi, CASE WHEN p_status = 'open' THEN 1 ELSE 0 END, NULL, clock_timestamp(),
    p_pay_status, NULL, CASE WHEN p_pay_status IS NULL THEN NULL ELSE 0 END, CASE WHEN p_pay_status IS NULL THEN NULL ELSE 0 END,
    CASE WHEN p_pay_status IS NULL THEN NULL ELSE '{}'::text[] END, NULL,
    CASE WHEN p_evt IS NULL THEN 'provider_readback' ELSE 'signed_webhook' END,
    p_evt, CASE WHEN p_evt IS NULL THEN NULL ELSE 'invoice.updated' END);
$$;

CREATE FUNCTION pg_temp.ent(p_tenant uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.pay03b_resolve_tenant_entitlements(p_tenant, 'dealer_storefront');
$$;

-- Fixtures: three dealership tenants + one garage, organizations bound to them, platform and tenant identities.
INSERT INTO public.users (id, name, email, role, join_date) VALUES
  ('sub_ops_admin', 'Sub Ops Admin [SYNTHETIC]', 'sub.ops.admin@carup-uat.invalid', 'admin', '2026-11-01'),
  ('sub_dealer_a_owner', 'Dealer A Billing Admin [SYNTHETIC]', 'sub.dealer.a.owner@carup-uat.invalid', 'dealer', '2026-11-01'),
  ('sub_dealer_a_staff', 'Dealer A Sales Staff [SYNTHETIC]', 'sub.dealer.a.staff@carup-uat.invalid', 'dealer', '2026-11-01'),
  ('sub_dealer_b_owner', 'Dealer B Billing Admin [SYNTHETIC]', 'sub.dealer.b.owner@carup-uat.invalid', 'dealer', '2026-11-01'),
  ('sub_dealer_c_owner', 'Dealer C Billing Admin [SYNTHETIC]', 'sub.dealer.c.owner@carup-uat.invalid', 'dealer', '2026-11-01'),
  ('sub_two_tenant_admin', 'Admin of A and B [SYNTHETIC]', 'sub.two.tenant@carup-uat.invalid', 'dealer', '2026-11-01'),
  ('sub_garage_owner', 'Garage Billing Admin [SYNTHETIC]', 'sub.garage.owner@carup-uat.invalid', 'mechanic', '2026-11-01')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenants (id, name, type, status) VALUES
  ('b3000000-0000-4000-8000-00000000000a', 'PAY03B Dealer A [SYNTHETIC]', 'dealership', 'active'),
  ('b3000000-0000-4000-8000-00000000000b', 'PAY03B Dealer B [SYNTHETIC]', 'dealership', 'active'),
  ('b3000000-0000-4000-8000-00000000000c', 'PAY03B Dealer C [SYNTHETIC]', 'dealership', 'active'),
  ('b3000000-0000-4000-8000-00000000000d', 'PAY03B Garage D [SYNTHETIC]', 'garage', 'active');
INSERT INTO public.organizations (id, name, type, created_at, status, tenant_id) VALUES
  ('org_pay03b_dealer_a', 'PAY03B Dealer A Motors Ltd [SYNTHETIC]', 'dealership', '2026-11-01', 'active', 'b3000000-0000-4000-8000-00000000000a'),
  ('org_pay03b_dealer_b', 'PAY03B Dealer B Autos Ltd [SYNTHETIC]', 'dealership', '2026-11-01', 'active', 'b3000000-0000-4000-8000-00000000000b'),
  ('org_pay03b_dealer_c', 'PAY03B Dealer C Cars Ltd [SYNTHETIC]', 'dealership', '2026-11-01', 'active', 'b3000000-0000-4000-8000-00000000000c'),
  ('org_pay03b_garage_d', 'PAY03B Garage D Workshop [SYNTHETIC]', 'garage', '2026-11-01', 'active', 'b3000000-0000-4000-8000-00000000000d');
INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES
  ('b3000000-0000-4000-8000-00000000000a', 'sub_dealer_a_owner', 'admin'),
  ('b3000000-0000-4000-8000-00000000000a', 'sub_dealer_a_staff', 'dealer'),
  ('b3000000-0000-4000-8000-00000000000b', 'sub_dealer_b_owner', 'admin'),
  ('b3000000-0000-4000-8000-00000000000c', 'sub_dealer_c_owner', 'admin'),
  ('b3000000-0000-4000-8000-00000000000a', 'sub_two_tenant_admin', 'admin'),
  ('b3000000-0000-4000-8000-00000000000b', 'sub_two_tenant_admin', 'admin'),
  ('b3000000-0000-4000-8000-00000000000d', 'sub_garage_owner', 'admin');

-- S1/S2. ACLs and governance inventory.
DO $$
DECLARE v_role text; v_table text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_table IN ARRAY ARRAY['pay03b_subscription_plans', 'pay03b_billing_customers', 'pay03b_business_subscriptions',
      'pay03b_subscription_invoices', 'pay03b_provider_event_receipts', 'pay03b_subscription_transitions',
      'pay03b_subscription_change_requests', 'pay03b_runtime_guard'] LOOP
      IF has_table_privilege(v_role, 'public.' || v_table, 'SELECT') OR has_table_privilege(v_role, 'public.' || v_table, 'INSERT')
         OR has_table_privilege(v_role, 'public.' || v_table, 'UPDATE') THEN
        RAISE EXCEPTION 'PAY03B_SUB_TABLE_EXPOSED: % to %', v_table, v_role;
      END IF;
    END LOOP;
    IF has_function_privilege(v_role, 'public.pay03b_claim_business_subscription_checkout(uuid,text,text,uuid,text,text)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay03b_resolve_tenant_entitlements(uuid,text)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay03b_record_subscription_invoice(uuid,text,text,text,timestamptz,timestamptz,text,bigint,bigint,bigint,text,text,integer,timestamptz,timestamptz,text,text,bigint,bigint,text[],text,text,text,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'PAY03B_SUB_RPC_EXPOSED_TO_%', v_role;
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY['pay03b_subscription_plans', 'pay03b_business_subscriptions', 'pay03b_subscription_invoices'] LOOP
    IF NOT has_table_privilege('service_role', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('service_role', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('service_role', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'PAY03B_SUB_SERVICE_ROLE_WRITE_PRIVILEGE: %', v_table;
    END IF;
  END LOOP;
  IF has_function_privilege('service_role', 'public.pay03b_refresh_paid_coverage(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.pay03b_record_transition(public.pay03b_business_subscriptions,text,uuid,timestamptz,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PAY03B_SUB_INTERNAL_HELPERS_EXPOSED';
  END IF;
  IF (SELECT count(*) FROM public.pay03b_subscription_plans) <> 7
     OR (SELECT count(*) FROM public.pay03b_subscription_plans WHERE pricing_kind <> 'free' AND activation_status <> 'commercially_blocked') <> 0
     OR (SELECT count(*) FROM public.pay03b_subscription_plans WHERE amount_minor IS NOT NULL AND pricing_kind <> 'free') <> 0
     OR (SELECT count(DISTINCT product_code) FROM public.pay03b_subscription_plans) <> 7 THEN
    RAISE EXCEPTION 'PAY03B_SUB_GOVERNANCE_INVENTORY_WRONG';
  END IF;
  -- A paid plan can never be commercially 'approved' here, and a plan version is immutable.
  PERFORM pg_temp.expect_error($q$INSERT INTO public.pay03b_subscription_plans (plan_code, plan_version, product_code, product_version,
    subscription_authority, subscriber_scope, subscription_scope, display_name, target_role, eligible_tenant_category,
    billing_interval, interval_count, pricing_kind, amount_minor, currency, currency_scale, jurisdiction, refund_policy,
    activation_status, created_by) VALUES ('dealer_bogus', 1, 'mkt.dealer.storefront_package', 1, 'pay03b_business_subscriptions',
    'dealer_organization', 'dealer_storefront', 'Bogus', 'dealer', 'x', 'month', 1, 'approved_tariff', 9900, 'USD', 2, 'ZW',
    'none', 'approved', 'smoke')$q$, 'violates check constraint');
  PERFORM pg_temp.expect_error($q$UPDATE public.pay03b_subscription_plans SET display_name = 'Tampered' WHERE plan_code = 'dealer_storefront_package'$q$,
    'PAY03B_PLAN_VERSION_IMMUTABLE');
  PERFORM pg_temp.expect_error($q$DELETE FROM public.pay03b_subscription_plans WHERE plan_code = 'garage_os_plan'$q$,
    'PAY03B_PLAN_VERSION_DELETE_FORBIDDEN');
  RAISE NOTICE 'PAY03B_SUB_SMOKE S1-S2 PASS: least privilege, governance inventory (7 products, none sellable), immutability';
END $$;

-- S3. Governed sandbox plan registration (Owner authorization reference required).
DO $$
DECLARE v_std jsonb; v_prem jsonb; v_base jsonb; v_grace jsonb;
BEGIN
  PERFORM pg_temp.expect_error($q$SELECT public.pay03b_register_sandbox_plan_version('dealer_storefront_sandbox_standard',
    'mkt.dealer.storefront_package', 'dealer_storefront', 'dealer_organization', 10, 'Sandbox Standard', 'sandbox_fixture',
    'month', 1::smallint, 3000, 'JPY', 0::smallint, 'stripe_carup_japan_sandbox', 'price_pay03b_std_fixture',
    '{"dealer.inventory.published_listing_capacity":25}'::jsonb, NULL, NULL, NULL, NULL, 'governed_admin_refund', '', 'owner', 'smoke')$q$,
    'PAY03B_PLAN_REGISTRATION_REQUIRES_OWNER_AUTHORIZATION');
  PERFORM pg_temp.expect_error($q$SELECT public.pay03b_register_sandbox_plan_version('dealer_storefront_sandbox_standard',
    'intel.report.vehicle_history_single', 'dealer_storefront', 'dealer_organization', 10, 'Sandbox Standard', 'sandbox_fixture',
    'month', 1::smallint, 3000, 'JPY', 0::smallint, 'stripe_carup_japan_sandbox', 'price_pay03b_std_fixture',
    '{}'::jsonb, NULL, NULL, NULL, NULL, 'governed_admin_refund', 'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke')$q$,
    'PAY03B_PLAN_REGISTRATION_UNKNOWN_PRODUCT_SCOPE');
  PERFORM pg_temp.expect_error($q$SELECT public.pay03b_register_sandbox_plan_version('dealer_storefront_sandbox_sim',
    'mkt.dealer.storefront_package', 'dealer_storefront', 'dealer_organization', 10, 'Sandbox Sim', 'sandbox_fixture',
    'month', 1::smallint, 3000, 'JPY', 0::smallint, 'pay03b_local_provider_simulator', 'sim_price_std',
    '{}'::jsonb, NULL, NULL, NULL, NULL, 'governed_admin_refund', 'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke')$q$,
    'PAY03B_GATEWAY_NOT_PERMITTED');
  v_base := public.pay03b_register_sandbox_plan_version('dealer_storefront_sandbox_baseline', 'mkt.dealer.storefront_package',
    'dealer_storefront', 'dealer_organization', 0, 'Sandbox Free Baseline', 'free', NULL, NULL, 0, 'JPY', 0::smallint, NULL, NULL,
    '{"dealer.inventory.published_listing_capacity":5}'::jsonb, NULL, NULL, NULL, NULL, 'no_charge_tier', 'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke');
  v_std := public.pay03b_register_sandbox_plan_version('dealer_storefront_sandbox_standard', 'mkt.dealer.storefront_package',
    'dealer_storefront', 'dealer_organization', 10, 'Sandbox Standard', 'sandbox_fixture', 'month', 1::smallint, 3000, 'JPY',
    0::smallint, 'stripe_carup_japan_sandbox', 'price_pay03b_std_fixture', '{"dealer.inventory.published_listing_capacity":25}'::jsonb,
    NULL, NULL, '{"upgrade":"period_end","downgrade":"period_end","proration":"none"}'::jsonb,
    '{"period_end":true,"immediate":false}'::jsonb, 'governed_admin_refund', 'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke');
  v_prem := public.pay03b_register_sandbox_plan_version('dealer_storefront_sandbox_premium', 'mkt.dealer.storefront_package',
    'dealer_storefront', 'dealer_organization', 20, 'Sandbox Premium', 'sandbox_fixture', 'month', 1::smallint, 6000, 'JPY',
    0::smallint, 'stripe_carup_japan_sandbox', 'price_pay03b_prem_fixture', '{"dealer.inventory.published_listing_capacity":100}'::jsonb,
    NULL, NULL, '{"upgrade":"period_end","downgrade":"period_end","proration":"none"}'::jsonb,
    '{"period_end":true,"immediate":true}'::jsonb, 'governed_admin_refund', 'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke');
  v_grace := public.pay03b_register_sandbox_plan_version('dealer_storefront_sandbox_grace', 'mkt.dealer.storefront_package',
    'dealer_storefront', 'dealer_organization', 15, 'Sandbox Standard with Grace', 'sandbox_fixture', 'month', 1::smallint, 3000, 'JPY',
    0::smallint, 'stripe_carup_japan_sandbox', 'price_pay03b_grace_fixture', '{"dealer.inventory.published_listing_capacity":25}'::jsonb,
    NULL, 3, NULL, NULL, 'governed_admin_refund', 'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke');
  IF v_std->>'activation_status' <> 'sandbox_only' OR v_std->>'merchant_of_record' <> 'carup_japan_stripe_sandbox'
     OR v_std->>'jurisdiction' <> 'SANDBOX' OR v_base->>'pricing_kind' <> 'free'
     OR (SELECT activation_status FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_package') <> 'commercially_blocked' THEN
    RAISE EXCEPTION 'PAY03B_SUB_SANDBOX_REGISTRATION_WRONG: %', v_std;
  END IF;
  -- A sandbox price can only belong to one plan.
  PERFORM pg_temp.expect_error($q$SELECT public.pay03b_register_sandbox_plan_version('dealer_storefront_sandbox_dup',
    'mkt.dealer.storefront_package', 'dealer_storefront', 'dealer_organization', 30, 'Dup', 'sandbox_fixture', 'month', 1::smallint,
    3000, 'JPY', 0::smallint, 'stripe_carup_japan_sandbox', 'price_pay03b_std_fixture', '{}'::jsonb, NULL, NULL, NULL, NULL,
    'governed_admin_refund', 'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke')$q$, 'pay03b_unique_provider_price');
  RAISE NOTICE 'PAY03B_SUB_SMOKE S3 PASS: sandbox plans need Owner authorization, governed product scope and a permitted gateway';
END $$;

-- S4-S6. Checkout authority, idempotency, one live subscription, paid-period access.
DO $$
DECLARE
  v_std uuid; v_prem uuid; v_garage uuid; v_free uuid; v_blocked uuid;
  v_claim jsonb; v_claim2 jsonb; v_sub uuid; v_r jsonb; v_e jsonb; v_pay text;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT id INTO v_std FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_sandbox_standard' AND effective_to IS NULL;
  SELECT id INTO v_prem FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_sandbox_premium' AND effective_to IS NULL;
  SELECT id INTO v_garage FROM public.pay03b_subscription_plans WHERE plan_code = 'garage_os_plan';
  SELECT id INTO v_free FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_sandbox_baseline' AND effective_to IS NULL;
  SELECT id INTO v_blocked FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_package';

  -- No subscription: baseline only, no paid access.
  v_e := pg_temp.ent('b3000000-0000-4000-8000-00000000000a');
  IF (v_e->>'access')::boolean OR v_e->>'reason' <> 'no_subscription'
     OR (v_e->'baseline_entitlements'->>'dealer.inventory.published_listing_capacity')::int <> 5 THEN
    RAISE EXCEPTION 'PAY03B_SUB_BASELINE_WRONG: %', v_e;
  END IF;

  -- Authority: staff without billing role, non-members, and cross-organization substitution are refused.
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'sub_dealer_a_staff', %L, 'pay03b_smoke_claim_staff_0001', 'stripe_carup_japan_sandbox')$q$, v_std),
    'PAY03B_BILLING_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'sub_dealer_b_owner', %L, 'pay03b_smoke_claim_other_0001', 'stripe_carup_japan_sandbox')$q$, v_std),
    'PAY03B_BILLING_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000b',
    'org_pay03b_dealer_a', 'sub_two_tenant_admin', %L, 'pay03b_smoke_claim_cross_0001', 'stripe_carup_japan_sandbox')$q$, v_std),
    'PAY03B_ORGANIZATION_AUTHORITY_REFUSED');
  -- Eligibility: governance (unpriced) plans, free plans, wrong subscriber type and unpermitted gateways.
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'sub_dealer_a_owner', %L, 'pay03b_smoke_claim_block_0001', 'stripe_carup_japan_sandbox')$q$, v_blocked),
    'PAY03B_PLAN_NOT_PURCHASABLE');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'sub_dealer_a_owner', %L, 'pay03b_smoke_claim_free_0001', 'stripe_carup_japan_sandbox')$q$, v_free),
    'PAY03B_FREE_PLAN_NEEDS_NO_PAYMENT');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'sub_dealer_a_owner', %L, 'pay03b_smoke_claim_gar_0001', 'stripe_carup_japan_sandbox')$q$, v_garage),
    'PAY03B_PLAN_SUBSCRIBER_MISMATCH');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'sub_dealer_a_owner', %L, 'pay03b_smoke_claim_sim_0001', 'pay03b_local_provider_simulator')$q$, v_std),
    'PAY03B_PROVIDER_NOT_PERMITTED_FOR_PLAN');

  v_claim := public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a', 'org_pay03b_dealer_a',
    'sub_dealer_a_owner', v_std, 'pay03b_smoke_claim_a_0001', 'stripe_carup_japan_sandbox');
  v_sub := (v_claim->'subscription'->>'id')::uuid;
  v_claim2 := public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a', 'org_pay03b_dealer_a',
    'sub_dealer_a_owner', v_std, 'pay03b_smoke_claim_a_0001', 'stripe_carup_japan_sandbox');
  IF (v_claim2->'subscription'->>'id')::uuid <> v_sub OR v_claim->'subscription'->>'status' <> 'incomplete'
     OR v_claim->'subscription'->>'owner_organization_id' <> 'org_pay03b_dealer_a'
     OR (SELECT count(*) FROM public.pay03b_business_subscriptions WHERE owner_tenant_id = 'b3000000-0000-4000-8000-00000000000a') <> 1 THEN
    RAISE EXCEPTION 'PAY03B_SUB_CLAIM_NOT_IDEMPOTENT: %', v_claim2;
  END IF;
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'sub_dealer_a_owner', %L, 'pay03b_smoke_claim_a_0001', 'stripe_carup_japan_sandbox')$q$, v_prem),
    'PAY03B_CHECKOUT_IDEMPOTENCY_CONFLICT');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'sub_dealer_a_owner', %L, 'pay03b_smoke_claim_a_0002', 'stripe_carup_japan_sandbox')$q$, v_prem),
    'PAY03B_SUBSCRIPTION_ALREADY_EXISTS');

  -- Payer = the organization's provider customer; checkout must be a TEST session bound to it.
  PERFORM pg_temp.expect_error($q$SELECT public.pay03b_bind_billing_customer('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'stripe_carup_japan_sandbox', 'cus_pay03bdealerA', 'sub_dealer_a_staff')$q$, 'PAY03B_BILLING_AUTHORITY_REFUSED');
  PERFORM public.pay03b_bind_billing_customer('b3000000-0000-4000-8000-00000000000a', 'org_pay03b_dealer_a',
    'stripe_carup_japan_sandbox', 'cus_pay03bdealerA', 'sub_dealer_a_owner');
  PERFORM pg_temp.expect_error($q$SELECT public.pay03b_bind_billing_customer('b3000000-0000-4000-8000-00000000000a',
    'org_pay03b_dealer_a', 'stripe_carup_japan_sandbox', 'cus_pay03bdealerOTHER', 'sub_dealer_a_owner')$q$, 'PAY03B_BILLING_CUSTOMER_CONFLICT');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_attach_subscription_checkout(%L, 'cs_live_pay03bA', 'cus_pay03bdealerA')$q$, v_sub),
    'PAY03B_TEST_CHECKOUT_REQUIRED');
  PERFORM public.pay03b_attach_subscription_checkout(v_sub, 'cs_test_pay03bA', 'cus_pay03bdealerA');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_attach_subscription_checkout(%L, 'cs_test_pay03bA2', 'cus_pay03bdealerA')$q$, v_sub),
    'PAY03B_CHECKOUT_ATTACH_REFUSED');

  -- Provider says active, but nothing is paid yet: no access (an active flag is not proof of payment).
  v_r := pg_temp.snap(v_sub, 'sub_pay03bA', 'active', 'price_pay03b_std_fixture', v_now - interval '60 days',
    v_now - interval '30 days', false, NULL, NULL, v_now - interval '59 minutes', 'evt_pay03b_sub_a_1');
  v_e := pg_temp.ent('b3000000-0000-4000-8000-00000000000a');
  IF v_r->>'status' <> 'active' OR (v_e->>'access')::boolean OR v_e->>'reason' <> 'no_paid_period' THEN
    RAISE EXCEPTION 'PAY03B_SUB_ACTIVE_FLAG_GRANTED_ACCESS: % / %', v_r, v_e;
  END IF;
  -- Duplicate event changes nothing; an older observation is ignored; another provider subscription is refused.
  IF (pg_temp.snap(v_sub, 'sub_pay03bA', 'active', 'price_pay03b_std_fixture', v_now - interval '60 days', v_now - interval '30 days',
        false, NULL, NULL, v_now - interval '59 minutes', 'evt_pay03b_sub_a_1')->>'duplicate_event')::boolean IS NOT TRUE
     OR (pg_temp.snap(v_sub, 'sub_pay03bA', 'incomplete', 'price_pay03b_std_fixture', v_now - interval '60 days', v_now - interval '30 days',
        false, NULL, NULL, v_now - interval '2 hours', 'evt_pay03b_sub_a_old')->>'stale')::boolean IS NOT TRUE
     OR (SELECT status FROM public.pay03b_business_subscriptions WHERE id = v_sub) <> 'active' THEN
    RAISE EXCEPTION 'PAY03B_SUB_OUT_OF_ORDER_NOT_CONVERGED';
  END IF;
  PERFORM pg_temp.expect_error(format($q$SELECT pg_temp.snap(%L, 'sub_pay03bOTHER', 'active', 'price_pay03b_std_fixture',
    clock_timestamp(), clock_timestamp() + interval '30 days', false, NULL, NULL, clock_timestamp(), NULL)$q$, v_sub),
    'PAY03B_PROVIDER_SUBSCRIPTION_SUBSTITUTION_REFUSED');
  PERFORM pg_temp.expect_error(format($q$SELECT pg_temp.snap(%L, 'sub_pay03bA', 'active', 'price_someone_elses',
    clock_timestamp(), clock_timestamp() + interval '30 days', false, NULL, NULL, clock_timestamp(), NULL)$q$, v_sub),
    'PAY03B_PROVIDER_PRICE_NOT_GOVERNED');

  -- First invoice (period 1, already in the past) and renewal (period 2, ended yesterday) are paid exactly once each.
  v_r := pg_temp.inv(v_sub, 'in_pay03bA1', 'subscription_create', 'price_pay03b_std_fixture', v_now - interval '60 days',
    v_now - interval '30 days', 3000, 3000, 'paid', 'pi_pay03bA1', 'paid', 'evt_pay03b_inv_a_1');
  v_pay := v_r->'payment'->>'reference';
  IF v_pay !~ '^pay03b_inv_' OR v_r->'payment'->>'status' <> 'paid' OR (v_r->'payment'->>'amount')::numeric <> 3000
     OR v_r->'payment'->>'gateway' <> 'stripe_carup_japan_sandbox' OR v_r->'payment'->>'currency' <> 'JPY'
     OR v_r->'payment'->>'pay02_product_code' <> 'mkt.dealer.storefront_package' THEN
    RAISE EXCEPTION 'PAY03B_SUB_CANONICAL_PAYMENT_WRONG: %', v_r;
  END IF;
  IF (pg_temp.inv(v_sub, 'in_pay03bA1', 'subscription_create', 'price_pay03b_std_fixture', v_now - interval '60 days',
      v_now - interval '30 days', 3000, 3000, 'paid', 'pi_pay03bA1', 'paid', 'evt_pay03b_inv_a_1')->>'duplicate_event')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'PAY03B_SUB_INVOICE_EVENT_NOT_DEDUPED';
  END IF;
  PERFORM pg_temp.inv(v_sub, 'in_pay03bA1', 'subscription_create', 'price_pay03b_std_fixture', v_now - interval '60 days',
    v_now - interval '30 days', 3000, 3000, 'paid', 'pi_pay03bA1', 'paid', NULL);
  PERFORM pg_temp.expect_error(format($q$SELECT pg_temp.inv(%L, 'in_pay03bA1dup', 'subscription_cycle', 'price_pay03b_std_fixture',
    %L::timestamptz, %L::timestamptz, 3000, 3000, 'paid', 'pi_pay03bA1dup', 'paid', NULL)$q$, v_sub,
    v_now - interval '60 days', v_now - interval '29 days'), 'PAY03B_DUPLICATE_PERIOD_COLLECTION_REFUSED');
  IF (SELECT count(*) FROM public.payment_transactions WHERE reference LIKE 'pay03b_inv_%' AND pay01a_intent_id = 'pi_pay03bA1') <> 1 THEN
    RAISE EXCEPTION 'PAY03B_SUB_DUPLICATE_CANONICAL_PAYMENT';
  END IF;
  PERFORM pg_temp.inv(v_sub, 'in_pay03bA2', 'subscription_cycle', 'price_pay03b_std_fixture', v_now - interval '30 days',
    v_now - interval '1 day', 3000, 3000, 'paid', 'pi_pay03bA2', 'paid', 'evt_pay03b_inv_a_2');
  v_e := pg_temp.ent('b3000000-0000-4000-8000-00000000000a');
  IF (v_e->>'access')::boolean OR v_e->>'reason' <> 'paid_period_ended'
     OR (SELECT paid_through FROM public.pay03b_business_subscriptions WHERE id = v_sub) <> date_trunc('microseconds', v_now - interval '1 day') THEN
    RAISE EXCEPTION 'PAY03B_SUB_PAID_THROUGH_WRONG: % / %', v_e, (SELECT paid_through FROM public.pay03b_business_subscriptions WHERE id = v_sub);
  END IF;

  -- S9. Failed renewal: invoice open, payment pending (never fabricated), provider past_due, no approved grace.
  v_r := pg_temp.inv(v_sub, 'in_pay03bA3', 'subscription_cycle', 'price_pay03b_std_fixture', v_now - interval '1 day',
    v_now + interval '29 days', 3000, 0, 'open', 'pi_pay03bA3', 'pending', 'evt_pay03b_inv_a_3_failed');
  PERFORM pg_temp.snap(v_sub, 'sub_pay03bA', 'past_due', 'price_pay03b_std_fixture', v_now - interval '1 day',
    v_now + interval '29 days', false, NULL, NULL, v_now - interval '1 minute', 'evt_pay03b_sub_a_pastdue');
  v_e := pg_temp.ent('b3000000-0000-4000-8000-00000000000a');
  IF v_r->'payment'->>'status' <> 'pending' OR (v_e->>'access')::boolean OR v_e->>'reason' <> 'past_due_without_approved_grace'
     OR (SELECT status FROM public.pay03b_business_subscriptions WHERE id = v_sub) <> 'past_due' THEN
    RAISE EXCEPTION 'PAY03B_SUB_FAILED_RENEWAL_WRONG: % / %', v_r, v_e;
  END IF;
  PERFORM pg_temp.expect_error(format($q$SELECT pg_temp.inv(%L, 'in_pay03bA3', 'subscription_cycle', 'price_pay03b_std_fixture',
    clock_timestamp() - interval '1 day', clock_timestamp() + interval '29 days', 3000, 0, 'open', 'pi_pay03bA3', 'paid', NULL)$q$, v_sub),
    'PAY03B_PAYMENT_PAID_WITHOUT_PAID_INVOICE');
  -- Recovery: the retried invoice is paid; access returns for the paid period with the plan's entitlements.
  PERFORM pg_temp.inv(v_sub, 'in_pay03bA3', 'subscription_cycle', 'price_pay03b_std_fixture', v_now - interval '1 day',
    v_now + interval '29 days', 3000, 3000, 'paid', 'pi_pay03bA3', 'paid', 'evt_pay03b_inv_a_3_paid');
  PERFORM pg_temp.snap(v_sub, 'sub_pay03bA', 'active', 'price_pay03b_std_fixture', v_now - interval '1 day',
    v_now + interval '29 days', false, NULL, NULL, v_now, 'evt_pay03b_sub_a_recovered');
  v_e := pg_temp.ent('b3000000-0000-4000-8000-00000000000a');
  IF NOT (v_e->>'access')::boolean OR v_e->>'reason' <> 'paid_period'
     OR (v_e->'subscription_entitlements'->>'dealer.inventory.published_listing_capacity')::int <> 25 THEN
    RAISE EXCEPTION 'PAY03B_SUB_RECOVERY_WRONG: %', v_e;
  END IF;
  -- Cross-tenant isolation: tenant B has no paid entitlements.
  IF (pg_temp.ent('b3000000-0000-4000-8000-00000000000b')->>'access')::boolean THEN
    RAISE EXCEPTION 'PAY03B_SUB_CROSS_TENANT_ENTITLEMENT_LEAK';
  END IF;
  RAISE NOTICE 'PAY03B_SUB_SMOKE S4-S9 PASS: authority, idempotency, one live subscription, paid-period access, renewal, failed renewal, recovery';
END $$;

-- S10-S12. Plan change policy, period-end change, cancellation at period end, immediate cancellation terms.
DO $$
DECLARE
  v_sub uuid; v_std uuid; v_prem uuid; v_req jsonb; v_e jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT id INTO v_sub FROM public.pay03b_business_subscriptions WHERE owner_organization_id = 'org_pay03b_dealer_a';
  SELECT id INTO v_std FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_sandbox_standard' AND effective_to IS NULL;
  SELECT id INTO v_prem FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_sandbox_premium' AND effective_to IS NULL;
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_request_subscription_change(%L, 'sub_dealer_a_staff',
    'plan_change_period_end', %L, 'pay03b_smoke_change_staff_01', NULL)$q$, v_sub, v_prem), 'PAY03B_BILLING_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_request_subscription_change(%L, 'sub_dealer_a_owner',
    'plan_change_immediate', %L, 'pay03b_smoke_change_immed_01', NULL)$q$, v_sub, v_prem), 'PAY03B_UPGRADE_POLICY_REFUSED');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_request_subscription_change(%L, 'sub_dealer_a_owner',
    'cancel_immediately', NULL, 'pay03b_smoke_cancel_immed_01', NULL)$q$, v_sub), 'PAY03B_IMMEDIATE_CANCELLATION_NOT_IN_TERMS');
  v_req := public.pay03b_request_subscription_change(v_sub, 'sub_dealer_a_owner', 'plan_change_period_end', v_prem,
    'pay03b_smoke_change_up_0001', 'Move to premium at renewal');
  IF v_req->'request'->>'status' <> 'requested' OR v_req->'request'->>'requested_by' <> 'sub_dealer_a_owner'
     OR v_req->'request'->>'requested_role' <> 'admin'
     OR (public.pay03b_request_subscription_change(v_sub, 'sub_dealer_a_owner', 'plan_change_period_end', v_prem,
        'pay03b_smoke_change_up_0001', NULL)->>'replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'PAY03B_SUB_CHANGE_REQUEST_WRONG: %', v_req;
  END IF;
  PERFORM public.pay03b_complete_subscription_change((v_req->'request'->>'id')::uuid, 'provider_confirmed', 'provider_item_price_updated');
  -- Provider now bills premium next period (proration none). Entitlements still follow the PAID plan (standard).
  PERFORM pg_temp.snap(v_sub, 'sub_pay03bA', 'active', 'price_pay03b_prem_fixture', v_now - interval '1 day',
    v_now + interval '29 days', false, NULL, NULL, clock_timestamp(), 'evt_pay03b_sub_a_planchange');
  v_e := pg_temp.ent('b3000000-0000-4000-8000-00000000000a');
  IF (SELECT plan_id FROM public.pay03b_business_subscriptions WHERE id = v_sub) <> v_prem
     OR (v_e->'subscription_entitlements'->>'dealer.inventory.published_listing_capacity')::int <> 25 THEN
    RAISE EXCEPTION 'PAY03B_SUB_UNPAID_UPGRADE_GRANTED: %', v_e;
  END IF;
  -- An unauthorized proration invoice never extends access.
  PERFORM pg_temp.inv(v_sub, 'in_pay03bAproration', 'subscription_update', 'price_pay03b_prem_fixture', v_now,
    v_now + interval '29 days', 1500, 1500, 'paid', 'pi_pay03bAproration', 'paid', NULL);
  IF (SELECT anomaly FROM public.pay03b_subscription_invoices WHERE provider_invoice_id = 'in_pay03bAproration') <> 'unauthorized_proration'
     OR (pg_temp.ent('b3000000-0000-4000-8000-00000000000a')->'subscription_entitlements'->>'dealer.inventory.published_listing_capacity')::int <> 25 THEN
    RAISE EXCEPTION 'PAY03B_SUB_UNAUTHORIZED_PRORATION_ACCEPTED';
  END IF;

  -- Cancel at period end: access continues through the paid period; after the provider ends it, access ends.
  v_req := public.pay03b_request_subscription_change(v_sub, 'sub_dealer_a_owner', 'cancel_at_period_end', NULL,
    'pay03b_smoke_cancel_pe_0001', 'Closing the storefront');
  PERFORM pg_temp.snap(v_sub, 'sub_pay03bA', 'active', 'price_pay03b_prem_fixture', v_now - interval '1 day',
    v_now + interval '29 days', true, NULL, NULL, clock_timestamp(), 'evt_pay03b_sub_a_cape');
  IF NOT (pg_temp.ent('b3000000-0000-4000-8000-00000000000a')->>'access')::boolean THEN
    RAISE EXCEPTION 'PAY03B_SUB_PERIOD_END_CANCEL_REVOKED_PAID_ACCESS';
  END IF;
  RAISE NOTICE 'PAY03B_SUB_SMOKE S10-S12 PASS: change authority/policy, entitlement follows paid plan, proration refused, period-end cancellation keeps paid access';
END $$;

-- S13. Refunds and F5 on invoice payments: refund drops coverage; a partial refund holds access until governed resolution.
DO $$
DECLARE
  v_sub uuid; v_pay text; v_e jsonb; v_r jsonb; v_exc uuid; v_res jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT id INTO v_sub FROM public.pay03b_business_subscriptions WHERE owner_organization_id = 'org_pay03b_dealer_a';
  SELECT payment_reference INTO v_pay FROM public.pay03b_subscription_invoices WHERE provider_invoice_id = 'in_pay03bA3';
  -- External partial refund of the current period's invoice (provider dashboard): hold, access suspended.
  v_r := public.pay03b_record_subscription_invoice(v_sub, 'in_pay03bA3', 'subscription_cycle', 'price_pay03b_std_fixture',
    v_now - interval '1 day', v_now + interval '29 days', 'JPY', 3000, 3000, 0, 'paid', 'pi_pay03bA3', 1, NULL,
    clock_timestamp(), 'reconciliation_hold', NULL, 1000, 0, ARRAY['re_pay03bA3part'], 'partial_refund_succeeded',
    'signed_webhook', 'evt_pay03b_inv_a_3_partial', 'charge.refunded');
  v_e := pg_temp.ent('b3000000-0000-4000-8000-00000000000a');
  SELECT id INTO v_exc FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_pay AND status = 'open';
  IF v_r->'payment'->>'status' <> 'reconciliation_hold' OR v_exc IS NULL OR (v_e->>'access')::boolean
     OR v_e->>'reason' <> 'payment_reconciliation_hold' THEN
    RAISE EXCEPTION 'PAY03B_SUB_INVOICE_PARTIAL_REFUND_NOT_HELD: % / %', v_r, v_e;
  END IF;
  -- Provider later shows the partial refund failed; an operator restores with fresh verified evidence.
  v_res := public.pay03b_resolve_payment_reconciliation_exception(v_exc, 'restore_access_provider_unrefunded', 'sub_ops_admin',
    'admin', 'Fresh readback: the dashboard partial refund failed; invoice fully paid.', 'paid', 0, 0, '{}', clock_timestamp());
  v_e := pg_temp.ent('b3000000-0000-4000-8000-00000000000a');
  IF v_res->>'payment_status' <> 'paid' OR v_res->'sync'->>'subscription_id' IS NULL OR NOT (v_e->>'access')::boolean THEN
    RAISE EXCEPTION 'PAY03B_SUB_INVOICE_RESOLUTION_DID_NOT_RESTORE: % / %', v_res, v_e;
  END IF;
  -- A governed full refund of the current invoice: coverage falls back to the previous paid period (ended).
  PERFORM public.pay03b_record_subscription_invoice(v_sub, 'in_pay03bA3', 'subscription_cycle', 'price_pay03b_std_fixture',
    v_now - interval '1 day', v_now + interval '29 days', 'JPY', 3000, 3000, 0, 'paid', 'pi_pay03bA3', 1, NULL,
    clock_timestamp(), 'refunded', 're_pay03bA3full', 3000, 0, ARRAY['re_pay03bA3full'], NULL, 'signed_webhook',
    'evt_pay03b_inv_a_3_refunded', 'charge.refunded');
  v_e := pg_temp.ent('b3000000-0000-4000-8000-00000000000a');
  IF (v_e->>'access')::boolean OR v_e->>'paid_through' IS NULL
     OR (SELECT status FROM public.payment_transactions WHERE reference = v_pay) <> 'refunded' THEN
    RAISE EXCEPTION 'PAY03B_SUB_REFUND_KEPT_ACCESS: %', v_e;
  END IF;
  RAISE NOTICE 'PAY03B_SUB_SMOKE S13 PASS: invoice partial refund holds access, governed restore, full refund ends paid coverage';
END $$;

-- S14-S17. Grace (only when approved), immediate cancellation by terms, admin suspension, member removal.
DO $$
DECLARE
  v_grace uuid; v_prem uuid; v_b uuid; v_c uuid; v_e jsonb; v_now timestamptz := clock_timestamp(); v_req jsonb;
BEGIN
  SELECT id INTO v_grace FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_sandbox_grace' AND effective_to IS NULL;
  SELECT id INTO v_prem FROM public.pay03b_subscription_plans WHERE plan_code = 'dealer_storefront_sandbox_premium' AND effective_to IS NULL;
  -- Dealer B on the grace plan: renewal fails, provider past_due -> approved grace period keeps access for 3 days.
  v_b := (public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000b', 'org_pay03b_dealer_b',
    'sub_dealer_b_owner', v_grace, 'pay03b_smoke_claim_b_0001', 'stripe_carup_japan_sandbox')->'subscription'->>'id')::uuid;
  PERFORM public.pay03b_bind_billing_customer('b3000000-0000-4000-8000-00000000000b', 'org_pay03b_dealer_b', 'stripe_carup_japan_sandbox', 'cus_pay03bdealerB', 'sub_dealer_b_owner');
  PERFORM public.pay03b_attach_subscription_checkout(v_b, 'cs_test_pay03bB', 'cus_pay03bdealerB');
  PERFORM pg_temp.snap(v_b, 'sub_pay03bB', 'active', 'price_pay03b_grace_fixture', v_now - interval '31 days', v_now - interval '1 day',
    false, NULL, NULL, v_now - interval '10 minutes', NULL);
  PERFORM pg_temp.inv(v_b, 'in_pay03bB1', 'subscription_create', 'price_pay03b_grace_fixture', v_now - interval '31 days',
    v_now - interval '1 day', 3000, 3000, 'paid', 'pi_pay03bB1', 'paid', NULL);
  PERFORM pg_temp.inv(v_b, 'in_pay03bB2', 'subscription_cycle', 'price_pay03b_grace_fixture', v_now - interval '1 day',
    v_now + interval '29 days', 3000, 0, 'open', 'pi_pay03bB2', 'pending', NULL);
  PERFORM pg_temp.snap(v_b, 'sub_pay03bB', 'past_due', 'price_pay03b_grace_fixture', v_now - interval '1 day', v_now + interval '29 days',
    false, NULL, NULL, v_now - interval '1 minute', NULL);
  v_e := public.pay03b_resolve_tenant_entitlements('b3000000-0000-4000-8000-00000000000b', 'dealer_storefront');
  IF v_e->>'status' <> 'grace_period' OR NOT (v_e->>'access')::boolean OR v_e->>'reason' <> 'approved_grace_period' THEN
    RAISE EXCEPTION 'PAY03B_SUB_APPROVED_GRACE_WRONG: %', v_e;
  END IF;

  -- Dealer C on premium (immediate cancellation in terms): immediate cancel revokes despite a paid future period.
  v_c := (public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000c', 'org_pay03b_dealer_c',
    'sub_dealer_c_owner', v_prem, 'pay03b_smoke_claim_c_0001', 'stripe_carup_japan_sandbox')->'subscription'->>'id')::uuid;
  PERFORM public.pay03b_bind_billing_customer('b3000000-0000-4000-8000-00000000000c', 'org_pay03b_dealer_c', 'stripe_carup_japan_sandbox', 'cus_pay03bdealerC', 'sub_dealer_c_owner');
  PERFORM public.pay03b_attach_subscription_checkout(v_c, 'cs_test_pay03bC', 'cus_pay03bdealerC');
  PERFORM pg_temp.snap(v_c, 'sub_pay03bC', 'active', 'price_pay03b_prem_fixture', v_now - interval '1 day', v_now + interval '29 days',
    false, NULL, NULL, v_now - interval '10 minutes', NULL);
  PERFORM pg_temp.inv(v_c, 'in_pay03bC1', 'subscription_create', 'price_pay03b_prem_fixture', v_now - interval '1 day',
    v_now + interval '29 days', 6000, 6000, 'paid', 'pi_pay03bC1', 'paid', NULL);
  IF NOT (public.pay03b_resolve_tenant_entitlements('b3000000-0000-4000-8000-00000000000c', 'dealer_storefront')->>'access')::boolean THEN
    RAISE EXCEPTION 'PAY03B_SUB_C_NOT_ENTITLED';
  END IF;
  -- S16. Admin suspension is attributable, never lifted by the provider, and reversible only by an admin.
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_admin_set_subscription_suspension(%L, 'sub_dealer_c_owner', 'suspend',
    'Dealer cannot suspend via admin path', 'pay03b_smoke_admin_bad_01')$q$, v_c), 'PAY03B_ADMIN_AUTHORITY_REFUSED');
  PERFORM public.pay03b_admin_set_subscription_suspension(v_c, 'sub_ops_admin', 'suspend', 'Compliance review of dealer C storefront',
    'pay03b_smoke_admin_susp_01');
  PERFORM pg_temp.snap(v_c, 'sub_pay03bC', 'active', 'price_pay03b_prem_fixture', v_now - interval '1 day', v_now + interval '29 days',
    false, NULL, NULL, v_now - interval '5 minutes', NULL);
  v_e := public.pay03b_resolve_tenant_entitlements('b3000000-0000-4000-8000-00000000000c', 'dealer_storefront');
  IF (v_e->>'access')::boolean OR v_e->>'reason' <> 'admin_suspension' THEN
    RAISE EXCEPTION 'PAY03B_SUB_PROVIDER_LIFTED_ADMIN_SUSPENSION: %', v_e;
  END IF;
  PERFORM public.pay03b_admin_set_subscription_suspension(v_c, 'sub_ops_admin', 'resume', 'Compliance review closed, restoring',
    'pay03b_smoke_admin_res_01');
  IF NOT (public.pay03b_resolve_tenant_entitlements('b3000000-0000-4000-8000-00000000000c', 'dealer_storefront')->>'access')::boolean THEN
    RAISE EXCEPTION 'PAY03B_SUB_ADMIN_RESUME_FAILED';
  END IF;
  v_req := public.pay03b_request_subscription_change(v_c, 'sub_dealer_c_owner', 'cancel_immediately', NULL,
    'pay03b_smoke_cancel_now_c01', 'Immediate cancellation within terms');
  PERFORM pg_temp.snap(v_c, 'sub_pay03bC', 'canceled', 'price_pay03b_prem_fixture', v_now - interval '1 day', v_now + interval '29 days',
    false, v_now, v_now, v_now - interval '1 minute', NULL);
  v_e := public.pay03b_resolve_tenant_entitlements('b3000000-0000-4000-8000-00000000000c', 'dealer_storefront');
  IF (v_e->>'access')::boolean OR v_e->>'reason' <> 'cancelled_immediately' THEN
    RAISE EXCEPTION 'PAY03B_SUB_IMMEDIATE_CANCEL_KEPT_ACCESS: %', v_e;
  END IF;

  -- S17. A removed member loses billing authority; ownership never moves to the user.
  DELETE FROM public.tenant_users WHERE tenant_id = 'b3000000-0000-4000-8000-00000000000b' AND user_id = 'sub_dealer_b_owner';
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_request_subscription_change(%L, 'sub_dealer_b_owner',
    'cancel_at_period_end', NULL, 'pay03b_smoke_removed_0001', NULL)$q$, v_b), 'PAY03B_BILLING_AUTHORITY_REFUSED');
  PERFORM pg_temp.expect_error(format($q$UPDATE public.pay03b_business_subscriptions SET owner_organization_id = 'org_pay03b_dealer_a',
    version = version + 1 WHERE id = %L$q$, v_b), 'PAY03B_SUBSCRIPTION_OWNERSHIP_IMMUTABLE');
  PERFORM pg_temp.expect_error(format($q$DELETE FROM public.pay03b_business_subscriptions WHERE id = %L$q$, v_b), 'PAY03B_SUBSCRIPTION_DELETE_FORBIDDEN');
  PERFORM pg_temp.expect_error($q$UPDATE public.pay03b_subscription_transitions SET cause = 'tampered'$q$, 'PAY03B_HISTORY_APPEND_ONLY');
  PERFORM pg_temp.expect_error($q$DELETE FROM public.pay03b_provider_event_receipts$q$, 'PAY03B_HISTORY_APPEND_ONLY');
  PERFORM pg_temp.expect_error($q$UPDATE public.pay03b_subscription_invoices SET period_end = period_end + interval '1 day'
    WHERE provider_invoice_id = 'in_pay03bB1'$q$, 'PAY03B_INVOICE_IDENTITY_IMMUTABLE');
  PERFORM pg_temp.expect_error($q$UPDATE public.pay03b_subscription_invoices SET provider_status = 'open'
    WHERE provider_invoice_id = 'in_pay03bB1'$q$, 'PAY03B_INVOICE_STATUS_REGRESSION_REFUSED');
  RAISE NOTICE 'PAY03B_SUB_SMOKE S14-S17 PASS: approved grace only, immediate cancel by terms, admin suspension, member removal, immutability';
END $$;

-- S18. The local provider simulator is refused until a disposable database explicitly enables it.
DO $$
DECLARE v_sim jsonb; v_claim jsonb;
BEGIN
  IF public.pay03b_gateway_permitted('pay03b_local_provider_simulator') THEN RAISE EXCEPTION 'PAY03B_SUB_SIMULATOR_ENABLED_BY_DEFAULT'; END IF;
  INSERT INTO public.pay03b_runtime_guard (singleton, local_simulator_enabled, enabled_by, enabled_at, note)
    VALUES (true, true, 'smoke', clock_timestamp(), 'disposable smoke database only');
  v_sim := public.pay03b_register_sandbox_plan_version('dealer_storefront_simulator_standard', 'mkt.dealer.storefront_package',
    'dealer_storefront', 'dealer_organization', 10, 'Simulator Standard', 'sandbox_fixture', 'month', 1::smallint, 3000, 'JPY',
    0::smallint, 'pay03b_local_provider_simulator', 'sim_price_pay03b_std', '{"dealer.inventory.published_listing_capacity":25}'::jsonb,
    NULL, NULL, NULL, NULL, 'governed_admin_refund', 'OWNER-SMOKE-AUTH-0001', 'owner', 'smoke');
  IF v_sim->>'merchant_of_record' <> 'pay03b_local_provider_simulator' OR v_sim->'provider_allowlist'->>0 <> 'pay03b_local_provider_simulator' THEN
    RAISE EXCEPTION 'PAY03B_SUB_SIMULATOR_PLAN_WRONG: %', v_sim;
  END IF;
  -- A simulator plan never accepts a Stripe gateway claim; garages cannot take a dealer plan.
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000c',
    'org_pay03b_dealer_c', 'sub_dealer_c_owner', %L, 'pay03b_smoke_claim_c_strp01', 'stripe_carup_japan_sandbox')$q$, (v_sim->>'id')),
    'PAY03B_PROVIDER_NOT_PERMITTED_FOR_PLAN');
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000d',
    'org_pay03b_garage_d', 'sub_garage_owner', %L, 'pay03b_smoke_claim_d_sim01', 'pay03b_local_provider_simulator')$q$, (v_sim->>'id')),
    'PAY03B_PLAN_SUBSCRIBER_MISMATCH');
  -- Dealer C (whose previous subscription was cancelled) may start a new, simulator-only subscription.
  v_claim := public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000c', 'org_pay03b_dealer_c',
    'sub_dealer_c_owner', (v_sim->>'id')::uuid, 'pay03b_smoke_claim_c_sim01', 'pay03b_local_provider_simulator');
  IF v_claim->'subscription'->>'gateway' <> 'pay03b_local_provider_simulator'
     OR v_claim->'subscription'->>'provider_account_id' <> 'acct_pay03b_local_simulator' THEN
    RAISE EXCEPTION 'PAY03B_SUB_SIMULATOR_CLAIM_WRONG: %', v_claim;
  END IF;
  UPDATE public.pay03b_runtime_guard SET local_simulator_enabled = false WHERE singleton;
  IF public.pay03b_gateway_permitted('pay03b_local_provider_simulator') THEN RAISE EXCEPTION 'PAY03B_SUB_SIMULATOR_NOT_DISABLED'; END IF;
  PERFORM pg_temp.expect_error(format($q$SELECT public.pay03b_claim_business_subscription_checkout('b3000000-0000-4000-8000-00000000000c',
    'org_pay03b_dealer_c', 'sub_dealer_c_owner', %L, 'pay03b_smoke_claim_c_sim01', 'pay03b_local_provider_simulator')$q$, (v_sim->>'id')),
    'PAY03B_PROVIDER_NOT_PERMITTED_FOR_PLAN');
  RAISE NOTICE 'PAY03B_SUB_SMOKE S18 PASS: simulator gateway refused by default, explicit disposable enablement only';
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.payment_transactions WHERE reference LIKE 'pay03b_inv_%') <> 7
     OR EXISTS (SELECT 1 FROM public.payment_transactions WHERE reference LIKE 'pay03b_inv_%' AND gateway <> 'stripe_carup_japan_sandbox')
     OR EXISTS (SELECT pay01a_intent_id FROM public.payment_transactions WHERE pay01a_intent_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'PAY03B_SUB_CANONICAL_LEDGER_INVENTORY_WRONG: %',
      (SELECT count(*) FROM public.payment_transactions WHERE reference LIKE 'pay03b_inv_%');
  END IF;
  RAISE NOTICE 'PAY03B_SUBSCRIPTIONS_POSTGRES_SMOKE_PASS: canonical subscription authority, paid-period entitlements, invoices bound 1:1 to the canonical ledger';
END $$;
