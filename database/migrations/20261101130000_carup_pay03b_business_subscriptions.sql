-- +migrate Up
-- CARUP-PAY-03B-LR01 Work Units 02-06 — canonical first-party Dealer & Business subscription authority.
--
-- Boundaries (docs/payments/CARUP_PAY_03B_DEALER_BUSINESS_SUBSCRIPTIONS.md):
--  * public.payment_transactions stays the ONLY money ledger: each recurring invoice obligation is bound to exactly
--    one canonical payment row, written only through the shared F5 transition/hold helpers (20261101120000).
--  * Diaspora tenants keep public.diaspora_subscriptions as their ONLY subscription authority (written by
--    syncSubscriptionFromSnapshot). This migration only maps PAY-02 products to Diaspora plan keys; it never
--    creates a second Diaspora subscription row.
--  * Dealer and garage subscriptions belong to the legal organization (public.organizations, PAY-02's declared
--    authority) bound to its operating tenant (public.tenants). Users never own them; billing authority is a
--    tenant_users role (admin, administrator, tenant_admin) re-checked here, inside the database.
--  * No price, tariff, tax, merchant or entitlement value is invented. Governance rows are unpriced and
--    commercially blocked. Paid plans can never be 'approved' in this foundation; sandbox fixtures need an
--    explicit Owner authorization reference and remain 'sandbox_only'.
--  * Access follows PAID periods: a provider 'active' flag never grants anything by itself.
--  * The local provider simulator (gateway 'pay03b_local_provider_simulator') is refused unless a disposable UAT
--    database explicitly enables it in public.pay03b_runtime_guard. No migration enables it.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.payment_transactions') IS NULL
     OR to_regclass('public.pay02_commercial_products') IS NULL
     OR to_regclass('public.organizations') IS NULL
     OR to_regclass('public.tenants') IS NULL
     OR to_regclass('public.tenant_users') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.pay03b_payment_reconciliation_exceptions') IS NULL
     OR to_regprocedure('public.pay03b_payment_transition_target(public.payment_transactions,bigint,text,text,text,bigint,bigint,text[],text,text)') IS NULL
     OR to_regprocedure('public.pay03b_payment_owner_lock(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'tenant_id') THEN
    RAISE EXCEPTION 'PAY03B_SUBSCRIPTIONS_REQUIRE_PAY02_TENANTS_ORGANIZATIONS_AND_F5';
  END IF;
END $$;

-- 0. Disposable-UAT guard for the local provider simulator. No migration ever enables it.
CREATE TABLE IF NOT EXISTS public.pay03b_runtime_guard (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  local_simulator_enabled boolean NOT NULL DEFAULT false,
  enabled_by text,
  enabled_at timestamptz,
  note text
);
ALTER TABLE public.pay03b_runtime_guard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pay03b_runtime_guard FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pay03b_runtime_guard TO service_role;

CREATE OR REPLACE FUNCTION public.pay03b_gateway_permitted(p_gateway text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_gateway = 'stripe_carup_japan_sandbox' THEN true
    WHEN p_gateway = 'pay03b_local_provider_simulator' THEN coalesce(
      (SELECT local_simulator_enabled FROM public.pay03b_runtime_guard WHERE singleton), false)
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.pay03b_gateway_account(p_gateway text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_gateway
    WHEN 'stripe_carup_japan_sandbox' THEN 'acct_1UVnGaEjgXqvlsJk'
    WHEN 'pay03b_local_provider_simulator' THEN 'acct_pay03b_local_simulator'
    ELSE NULL END;
$$;

-- 1. Versioned plan & price governance registry (append-only; one row per approved plan decision).
CREATE TABLE IF NOT EXISTS public.pay03b_subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code text NOT NULL CHECK (plan_code ~ '^[a-z0-9_]{3,64}$'),
  plan_version integer NOT NULL CHECK (plan_version >= 1),
  product_code text NOT NULL REFERENCES public.pay02_commercial_products(product_code),
  product_version integer NOT NULL CHECK (product_version >= 1),
  subscription_authority text NOT NULL CHECK (subscription_authority IN ('pay03b_business_subscriptions', 'diaspora_subscriptions')),
  authority_plan_key text,
  subscriber_scope text NOT NULL CHECK (subscriber_scope IN ('dealer_organization', 'garage_organization', 'diaspora_tenant')),
  subscription_scope text NOT NULL CHECK (subscription_scope ~ '^[a-z0-9_]{3,48}$'),
  tier_rank integer NOT NULL DEFAULT 0,
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  target_role text NOT NULL,
  eligible_tenant_category text NOT NULL,
  billing_interval text CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year')),
  interval_count smallint CHECK (interval_count IS NULL OR interval_count BETWEEN 1 AND 12),
  pricing_kind text NOT NULL CHECK (pricing_kind IN ('free', 'approved_tariff', 'sandbox_fixture', 'contract_quotation', 'unpriced')),
  amount_minor bigint CHECK (amount_minor IS NULL OR (amount_minor >= 0 AND amount_minor <= 9000000000000000)),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  currency_scale smallint CHECK (currency_scale IS NULL OR currency_scale IN (0, 2, 3)),
  jurisdiction text NOT NULL,
  tax_authority_ref text,
  merchant_of_record text,
  provider_allowlist text[] NOT NULL DEFAULT '{}',
  provider_price_ref text,
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(entitlements) = 'object'),
  trial_days integer CHECK (trial_days IS NULL OR trial_days BETWEEN 1 AND 90),
  grace_days integer CHECK (grace_days IS NULL OR grace_days BETWEEN 1 AND 30),
  change_policy jsonb NOT NULL DEFAULT '{"upgrade":"period_end","downgrade":"period_end","proration":"none"}'::jsonb,
  cancellation_policy jsonb NOT NULL DEFAULT '{"period_end":true,"immediate":false}'::jsonb,
  refund_policy text NOT NULL,
  activation_status text NOT NULL CHECK (activation_status IN ('draft', 'commercially_blocked', 'sandbox_only', 'approved', 'retired')),
  blocker_class text CHECK (blocker_class IS NULL OR blocker_class IN (
    'SOURCE', 'PRODUCT', 'COMMERCIAL', 'PROVIDER', 'LEGAL/POLICY', 'ENGINEERING', 'ENVIRONMENT', 'CERTIFICATION', 'OWNER AUTHORITY')),
  blocker_reason text,
  approval_evidence_ref text,
  approved_by text,
  approved_at timestamptz,
  effective_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  effective_to timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (plan_code, plan_version),
  CONSTRAINT pay03b_plan_authority_key CHECK (
    (subscription_authority = 'diaspora_subscriptions') = (authority_plan_key IS NOT NULL)
    AND (subscription_authority = 'diaspora_subscriptions') = (subscriber_scope = 'diaspora_tenant')
  ),
  CONSTRAINT pay03b_plan_change_policy_shape CHECK (
    change_policy->>'upgrade' IN ('period_end', 'immediate_prorated', 'not_allowed')
    AND change_policy->>'downgrade' IN ('period_end', 'not_allowed')
    AND change_policy->>'proration' IN ('none', 'always_invoice')
    AND ((change_policy->>'upgrade' = 'immediate_prorated') = (change_policy->>'proration' = 'always_invoice'))
  ),
  CONSTRAINT pay03b_plan_cancellation_policy_shape CHECK (
    jsonb_typeof(cancellation_policy->'period_end') = 'boolean' AND jsonb_typeof(cancellation_policy->'immediate') = 'boolean'
  ),
  -- Paid plans can never be 'approved' in this foundation; only a free (no-money) tier can be.
  CONSTRAINT pay03b_no_paid_commercial_activation CHECK (activation_status <> 'approved' OR pricing_kind = 'free'),
  CONSTRAINT pay03b_plan_free_shape CHECK (
    pricing_kind <> 'free' OR (coalesce(amount_minor, 0) = 0 AND cardinality(provider_allowlist) = 0
      AND provider_price_ref IS NULL AND billing_interval IS NULL)
  ),
  CONSTRAINT pay03b_plan_unpriced_shape CHECK (
    pricing_kind NOT IN ('unpriced', 'contract_quotation')
    OR (amount_minor IS NULL AND provider_price_ref IS NULL AND activation_status IN ('draft', 'commercially_blocked', 'retired'))
  ),
  CONSTRAINT pay03b_plan_sandbox_fixture_shape CHECK (
    pricing_kind <> 'sandbox_fixture' OR (
      activation_status IN ('sandbox_only', 'retired')
      AND amount_minor IS NOT NULL AND amount_minor > 0 AND currency IS NOT NULL AND currency_scale IS NOT NULL
      AND billing_interval IS NOT NULL AND interval_count IS NOT NULL
      AND merchant_of_record IN ('carup_japan_stripe_sandbox', 'pay03b_local_provider_simulator')
      AND cardinality(provider_allowlist) = 1
      AND provider_allowlist <@ ARRAY['stripe_carup_japan_sandbox', 'pay03b_local_provider_simulator']::text[]
      AND approval_evidence_ref IS NOT NULL AND approved_by IS NOT NULL
      AND subscription_authority = 'pay03b_business_subscriptions')
  ),
  CONSTRAINT pay03b_plan_approved_tariff_never_here CHECK (pricing_kind <> 'approved_tariff'),
  CONSTRAINT pay03b_plan_blocked_is_explained CHECK (
    activation_status <> 'commercially_blocked' OR (blocker_class IS NOT NULL AND length(trim(coalesce(blocker_reason, ''))) > 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS pay03b_one_current_plan_version
  ON public.pay03b_subscription_plans (plan_code) WHERE effective_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pay03b_unique_provider_price
  ON public.pay03b_subscription_plans (provider_price_ref) WHERE provider_price_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pay03b_guard_plan_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY03B_PLAN_VERSION_DELETE_FORBIDDEN'; END IF;
  -- Only retirement may change a version: everything a subscriber agreed to is immutable.
  IF (to_jsonb(NEW) - 'effective_to' - 'activation_status') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to' - 'activation_status')
     OR OLD.effective_to IS NOT NULL
     OR NEW.effective_to IS NULL
     OR NEW.activation_status <> 'retired' THEN
    RAISE EXCEPTION 'PAY03B_PLAN_VERSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay03b_plan_version_guard ON public.pay03b_subscription_plans;
CREATE TRIGGER trg_pay03b_plan_version_guard
  BEFORE UPDATE OR DELETE ON public.pay03b_subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.pay03b_guard_plan_version();

-- Governance inventory for the seven PAY-03B products. No price, merchant, tax or entitlement value is invented.
INSERT INTO public.pay03b_subscription_plans (
  plan_code, plan_version, product_code, product_version, subscription_authority, authority_plan_key,
  subscriber_scope, subscription_scope, tier_rank, display_name, target_role, eligible_tenant_category,
  billing_interval, interval_count, pricing_kind, amount_minor, currency, currency_scale, jurisdiction,
  merchant_of_record, provider_allowlist, entitlements, refund_policy, activation_status, blocker_class,
  blocker_reason, approval_evidence_ref, approved_by, approved_at, created_by)
VALUES
  ('dealer_storefront_package', 1, 'mkt.dealer.storefront_package', 1, 'pay03b_business_subscriptions', NULL,
   'dealer_organization', 'dealer_storefront', 10, 'Dealership Verified Storefront & Inventory Package', 'dealer',
   'dealership organization bound to an active CarUp tenant', 'month', 1, 'unpriced', NULL, NULL, 2, 'ZW',
   NULL, '{}', '{}'::jsonb, 'pro_rata_or_period_end_cancellation_pending_terms', 'commercially_blocked', 'COMMERCIAL',
   'No approved tariff, merchant of record, Zimbabwe collection provider, tax authority or approved entitlement set; no dealer capability is currently gated by payment.',
   NULL, NULL, NULL, 'migration:20261101130000'),
  ('diaspora_free', 1, 'sub.diaspora.free', 1, 'diaspora_subscriptions', 'free',
   'diaspora_tenant', 'diaspora_trade_os', 0, 'Diaspora Trade OS — Free Tier', 'diaspora_member',
   'any Diaspora tenant', NULL, NULL, 'free', 0, 'USD', 2, 'GLOBAL',
   NULL, '{}', '{"authority":"diaspora_subscription_plans","plan_key":"free"}'::jsonb, 'no_charge_tier', 'approved', NULL,
   NULL, 'ADR-001-DIASPORA-FREE-DEFAULT', 'owner_architecture_authority', now(), 'migration:20261101130000'),
  ('diaspora_buyer_pro', 1, 'sub.diaspora.buyer_pro', 1, 'diaspora_subscriptions', 'diaspora_buyer',
   'diaspora_tenant', 'diaspora_trade_os', 10, 'Diaspora Buyer Plan', 'diaspora_buyer',
   'Diaspora buyer tenant', 'month', 1, 'unpriced', NULL, NULL, 0, 'JP',
   NULL, '{}', '{"authority":"diaspora_subscription_plans","plan_key":"diaspora_buyer"}'::jsonb,
   'cancel_at_period_end_or_governed_admin_refund', 'commercially_blocked', 'COMMERCIAL',
   'Recurring tariff not approved; no approved provider allowlist (PAY-02 eligibleProviders is empty).',
   NULL, NULL, NULL, 'migration:20261101130000'),
  ('diaspora_seller_supplier', 1, 'sub.diaspora.seller_supplier', 1, 'diaspora_subscriptions', 'seller',
   'diaspora_tenant', 'diaspora_trade_os', 20, 'Diaspora Seller / Supplier Plan', 'exporter_supplier',
   'Diaspora seller or supplier tenant', 'month', 1, 'unpriced', NULL, NULL, 0, 'JP',
   NULL, '{}', '{"authority":"diaspora_subscription_plans","plan_key":"seller"}'::jsonb,
   'cancel_at_period_end_or_governed_admin_refund', 'commercially_blocked', 'COMMERCIAL',
   'Recurring tariff not approved; no approved provider allowlist. PAY-02 cites PLAN_CATALOG.seller_supplier, whose plan key is seller.',
   NULL, NULL, NULL, 'migration:20261101130000'),
  ('diaspora_trade_pro', 1, 'sub.diaspora.trade_pro', 1, 'diaspora_subscriptions', 'trade_pro',
   'diaspora_tenant', 'diaspora_trade_os', 30, 'Diaspora Trade Pro', 'trade_operator',
   'Diaspora trade operator tenant', 'month', 1, 'unpriced', NULL, NULL, 0, 'JP',
   NULL, '{}', '{"authority":"diaspora_subscription_plans","plan_key":"trade_pro"}'::jsonb,
   'cancel_at_period_end_or_governed_admin_refund', 'commercially_blocked', 'COMMERCIAL',
   'Recurring tariff not approved; no approved provider allowlist.', NULL, NULL, NULL, 'migration:20261101130000'),
  ('diaspora_enterprise_partner', 1, 'sub.diaspora.enterprise_partner', 1, 'diaspora_subscriptions', 'enterprise',
   'diaspora_tenant', 'diaspora_trade_os', 40, 'Diaspora Enterprise Partner', 'enterprise_partner',
   'Enterprise partner under a signed contract', NULL, NULL, 'contract_quotation', NULL, NULL, 2, 'GLOBAL',
   NULL, '{}', '{"authority":"diaspora_subscription_plans","plan_key":"enterprise"}'::jsonb, 'enterprise_msa_terms',
   'commercially_blocked', 'OWNER AUTHORITY',
   'Contract-governed: requires an Owner-approved enterprise quotation, merchant of record and MSA; never a standard monthly rate.',
   NULL, NULL, NULL, 'migration:20261101130000'),
  ('garage_os_plan', 1, 'sub.garage.os_plan', 1, 'pay03b_business_subscriptions', NULL,
   'garage_organization', 'garage_os', 10, 'Garage Business Operating System', 'garage_owner',
   'garage organization bound to an active CarUp tenant', 'month', 1, 'unpriced', NULL, NULL, 2, 'ZW',
   NULL, '{}', '{}'::jsonb, 'cancel_at_period_end', 'commercially_blocked', 'COMMERCIAL',
   'No approved SaaS tariff, merchant of record or Zimbabwe collection provider; PAY-02 names public.garages, which does not exist on this branch (garages are tenants of type garage). Separate from PAY-04 garage-customer payments.',
   NULL, NULL, NULL, 'migration:20261101130000')
ON CONFLICT (plan_code, plan_version) DO NOTHING;

-- 2. One provider customer per paying organization/tenant and gateway (the payer identity, never a user).
CREATE TABLE IF NOT EXISTS public.pay03b_billing_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  owner_organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  gateway text NOT NULL CHECK (gateway IN ('stripe_carup_japan_sandbox', 'pay03b_local_provider_simulator')),
  provider_account_id text NOT NULL,
  provider_customer_id text NOT NULL UNIQUE CHECK (provider_customer_id ~ '^(cus|sim_cus)_[A-Za-z0-9_]+$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_organization_id, gateway)
);

-- 3. Canonical subscription agreement for dealer and garage organizations.
CREATE TABLE IF NOT EXISTS public.pay03b_business_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_reference text NOT NULL UNIQUE CHECK (subscription_reference ~ '^pay03b_sub_[0-9a-f-]{36}$'),
  owner_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  owner_organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  subscription_scope text NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.pay03b_subscription_plans(id),
  product_code text NOT NULL REFERENCES public.pay02_commercial_products(product_code),
  status text NOT NULL DEFAULT 'incomplete' CHECK (status IN (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'grace_period',
    'paused', 'cancelled', 'expired', 'suspended')),
  gateway text NOT NULL CHECK (gateway IN ('stripe_carup_japan_sandbox', 'pay03b_local_provider_simulator')),
  provider_account_id text NOT NULL,
  billing_customer_id uuid REFERENCES public.pay03b_billing_customers(id),
  provider_checkout_id text UNIQUE CHECK (provider_checkout_id IS NULL OR provider_checkout_id ~ '^(cs_test|sim_cs)_[A-Za-z0-9_]+$'),
  provider_subscription_id text UNIQUE CHECK (provider_subscription_id IS NULL OR provider_subscription_id ~ '^(sub|sim_sub)_[A-Za-z0-9_]+$'),
  provider_status text,
  subscribing_actor_id text NOT NULL,
  request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{16,96}$'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  paid_through timestamptz,
  paid_plan_id uuid REFERENCES public.pay03b_subscription_plans(id),
  trial_end timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  ended_at timestamptz,
  cancellation_mode text CHECK (cancellation_mode IS NULL OR cancellation_mode IN ('period_end', 'immediate')),
  suspended_reason text CHECK (suspended_reason IS NULL OR suspended_reason IN (
    'admin_suspension', 'unauthorized_provider_trial', 'provider_unpaid')),
  provider_observed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_tenant_id, request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS pay03b_one_live_subscription_per_tenant_scope
  ON public.pay03b_business_subscriptions (owner_tenant_id, subscription_scope)
  WHERE status NOT IN ('incomplete_expired', 'cancelled', 'expired');
CREATE UNIQUE INDEX IF NOT EXISTS pay03b_one_live_subscription_per_organization_scope
  ON public.pay03b_business_subscriptions (owner_organization_id, subscription_scope)
  WHERE status NOT IN ('incomplete_expired', 'cancelled', 'expired');

CREATE OR REPLACE FUNCTION public.pay03b_guard_business_subscription()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_DELETE_FORBIDDEN'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.subscription_reference IS DISTINCT FROM OLD.subscription_reference
     OR NEW.owner_tenant_id IS DISTINCT FROM OLD.owner_tenant_id
     OR NEW.owner_organization_id IS DISTINCT FROM OLD.owner_organization_id
     OR NEW.subscription_scope IS DISTINCT FROM OLD.subscription_scope
     OR NEW.product_code IS DISTINCT FROM OLD.product_code
     OR NEW.gateway IS DISTINCT FROM OLD.gateway
     OR NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id
     OR NEW.subscribing_actor_id IS DISTINCT FROM OLD.subscribing_actor_id
     OR NEW.request_key IS DISTINCT FROM OLD.request_key
     OR (OLD.provider_checkout_id IS NOT NULL AND NEW.provider_checkout_id IS DISTINCT FROM OLD.provider_checkout_id)
     OR (OLD.provider_subscription_id IS NOT NULL AND NEW.provider_subscription_id IS DISTINCT FROM OLD.provider_subscription_id)
     OR (OLD.billing_customer_id IS NOT NULL AND NEW.billing_customer_id IS DISTINCT FROM OLD.billing_customer_id) THEN
    RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_OWNERSHIP_IMMUTABLE';
  END IF;
  IF OLD.status IN ('incomplete_expired', 'expired') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_TERMINAL';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_VERSION_CONFLICT'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay03b_business_subscription_guard ON public.pay03b_business_subscriptions;
CREATE TRIGGER trg_pay03b_business_subscription_guard
  BEFORE UPDATE OR DELETE ON public.pay03b_business_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.pay03b_guard_business_subscription();

-- 4. Recurring invoice obligations. One canonical payment row per invoice; no duplicate collection per period.
CREATE TABLE IF NOT EXISTS public.pay03b_subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.pay03b_business_subscriptions(id) ON DELETE RESTRICT,
  owner_tenant_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.pay03b_subscription_plans(id),
  gateway text NOT NULL,
  provider_account_id text NOT NULL,
  provider_invoice_id text NOT NULL UNIQUE CHECK (provider_invoice_id ~ '^(in|sim_in)_[A-Za-z0-9_]+$'),
  billing_reason text NOT NULL CHECK (billing_reason IN (
    'subscription_create', 'subscription_cycle', 'subscription_update', 'manual')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK (period_end > period_start),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  currency_scale smallint NOT NULL CHECK (currency_scale IN (0, 2, 3)),
  amount_due_minor bigint NOT NULL CHECK (amount_due_minor >= 0),
  amount_paid_minor bigint NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
  amount_remaining_minor bigint NOT NULL DEFAULT 0 CHECK (amount_remaining_minor >= 0),
  provider_status text NOT NULL CHECK (provider_status IN ('draft', 'open', 'paid', 'uncollectible', 'void')),
  anomaly text CHECK (anomaly IS NULL OR anomaly IN ('amount_mismatch', 'currency_mismatch', 'unexpected_zero_amount', 'unauthorized_proration')),
  payment_reference text UNIQUE REFERENCES public.payment_transactions(reference),
  provider_payment_intent_id text CHECK (provider_payment_intent_id IS NULL OR provider_payment_intent_id ~ '^(pi|sim_pi)_[A-Za-z0-9_]+$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_payment_attempt timestamptz,
  provider_observed_at timestamptz,
  first_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS pay03b_one_recurring_invoice_per_period
  ON public.pay03b_subscription_invoices (subscription_id, period_start)
  WHERE billing_reason IN ('subscription_create', 'subscription_cycle') AND provider_status <> 'void';
CREATE INDEX IF NOT EXISTS pay03b_invoices_by_subscription ON public.pay03b_subscription_invoices (subscription_id, period_end DESC);

CREATE OR REPLACE FUNCTION public.pay03b_guard_subscription_invoice()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY03B_INVOICE_DELETE_FORBIDDEN'; END IF;
  IF NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.owner_tenant_id IS DISTINCT FROM OLD.owner_tenant_id
     OR NEW.provider_invoice_id IS DISTINCT FROM OLD.provider_invoice_id
     OR NEW.gateway IS DISTINCT FROM OLD.gateway
     OR NEW.billing_reason IS DISTINCT FROM OLD.billing_reason
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR (OLD.provider_status <> 'draft' AND NEW.amount_due_minor IS DISTINCT FROM OLD.amount_due_minor)
     OR (OLD.payment_reference IS NOT NULL AND NEW.payment_reference IS DISTINCT FROM OLD.payment_reference)
     OR (OLD.provider_payment_intent_id IS NOT NULL AND NEW.provider_payment_intent_id IS DISTINCT FROM OLD.provider_payment_intent_id) THEN
    RAISE EXCEPTION 'PAY03B_INVOICE_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.provider_status IN ('paid', 'void', 'uncollectible') AND NEW.provider_status IS DISTINCT FROM OLD.provider_status THEN
    RAISE EXCEPTION 'PAY03B_INVOICE_STATUS_REGRESSION_REFUSED';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay03b_subscription_invoice_guard ON public.pay03b_subscription_invoices;
CREATE TRIGGER trg_pay03b_subscription_invoice_guard
  BEFORE UPDATE OR DELETE ON public.pay03b_subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION public.pay03b_guard_subscription_invoice();

-- 5. Provider event receipts for subscription/invoice events (a dedupe index, not a ledger).
CREATE TABLE IF NOT EXISTS public.pay03b_provider_event_receipts (
  event_id text PRIMARY KEY CHECK (event_id ~ '^(evt|sim_evt)_[A-Za-z0-9_]+$'),
  event_type text NOT NULL,
  gateway text NOT NULL,
  subscription_id uuid REFERENCES public.pay03b_business_subscriptions(id),
  invoice_id uuid REFERENCES public.pay03b_subscription_invoices(id),
  resulting_state text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- 6. Append-only lifecycle history and attributable change requests.
CREATE TABLE IF NOT EXISTS public.pay03b_subscription_transitions (
  id bigserial PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES public.pay03b_business_subscriptions(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  from_plan_id uuid,
  to_plan_id uuid,
  paid_through timestamptz,
  cause text NOT NULL,
  actor_id text,
  event_id text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.pay03b_subscription_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.pay03b_business_subscriptions(id) ON DELETE RESTRICT,
  change_type text NOT NULL CHECK (change_type IN (
    'cancel_at_period_end', 'resume', 'cancel_immediately', 'plan_change_period_end', 'plan_change_immediate',
    'admin_suspend', 'admin_resume', 'refund_invoice')),
  target_plan_id uuid REFERENCES public.pay03b_subscription_plans(id),
  invoice_id uuid REFERENCES public.pay03b_subscription_invoices(id),
  requested_by text NOT NULL,
  requested_role text NOT NULL,
  request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{16,96}$'),
  reason text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'provider_confirmed', 'refused', 'failed')),
  outcome_code text,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (subscription_id, request_key)
);

CREATE OR REPLACE FUNCTION public.pay03b_guard_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'PAY03B_HISTORY_APPEND_ONLY';
END $$;
DROP TRIGGER IF EXISTS trg_pay03b_transitions_append_only ON public.pay03b_subscription_transitions;
CREATE TRIGGER trg_pay03b_transitions_append_only
  BEFORE UPDATE OR DELETE ON public.pay03b_subscription_transitions
  FOR EACH ROW EXECUTE FUNCTION public.pay03b_guard_append_only();
DROP TRIGGER IF EXISTS trg_pay03b_receipts_append_only ON public.pay03b_provider_event_receipts;
CREATE TRIGGER trg_pay03b_receipts_append_only
  BEFORE UPDATE OR DELETE ON public.pay03b_provider_event_receipts
  FOR EACH ROW EXECUTE FUNCTION public.pay03b_guard_append_only();

CREATE OR REPLACE FUNCTION public.pay03b_guard_change_request()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAY03B_HISTORY_APPEND_ONLY'; END IF;
  IF OLD.status <> 'requested'
     OR (to_jsonb(NEW) - 'status' - 'outcome_code' - 'completed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'outcome_code' - 'completed_at') THEN
    RAISE EXCEPTION 'PAY03B_CHANGE_REQUEST_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay03b_change_request_guard ON public.pay03b_subscription_change_requests;
CREATE TRIGGER trg_pay03b_change_request_guard
  BEFORE UPDATE OR DELETE ON public.pay03b_subscription_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.pay03b_guard_change_request();

-- 7. Authority helpers.
CREATE OR REPLACE FUNCTION public.pay03b_is_tenant_billing_admin(p_tenant_id uuid, p_actor_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = p_tenant_id AND tu.user_id = trim(p_actor_id)
      AND tu.role IN ('admin', 'administrator', 'tenant_admin'));
$$;

CREATE OR REPLACE FUNCTION public.pay03b_is_platform_admin(p_actor_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = trim(p_actor_id) AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.pay03b_record_transition(
  p_subscription public.pay03b_business_subscriptions, p_to_status text, p_to_plan_id uuid, p_paid_through timestamptz,
  p_cause text, p_actor_id text, p_event_id text)
RETURNS void LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO public.pay03b_subscription_transitions
    (subscription_id, from_status, to_status, from_plan_id, to_plan_id, paid_through, cause, actor_id, event_id)
  VALUES (p_subscription.id, p_subscription.status, p_to_status, p_subscription.plan_id, p_to_plan_id,
          p_paid_through, p_cause, p_actor_id, p_event_id);
$$;

-- Paid-through is DERIVED: the latest period end of a non-anomalous invoice whose canonical payment is 'paid'.
-- A refunded, held, partially refunded, failed or anomalous invoice never extends access.
CREATE OR REPLACE FUNCTION public.pay03b_derive_paid_coverage(p_subscription_id uuid)
RETURNS TABLE (paid_through timestamptz, paid_plan_id uuid)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT i.period_end, i.plan_id
  FROM public.pay03b_subscription_invoices i
  JOIN public.payment_transactions p ON p.reference = i.payment_reference
  WHERE i.subscription_id = p_subscription_id
    AND i.provider_status = 'paid' AND i.anomaly IS NULL
    AND i.amount_paid_minor = i.amount_due_minor AND i.amount_due_minor > 0
    AND p.status = 'paid'
  ORDER BY i.period_end DESC, i.last_observed_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.pay03b_refresh_paid_coverage(p_subscription_id uuid, p_cause text, p_event_id text)
RETURNS public.pay03b_business_subscriptions
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_through timestamptz;
  v_plan uuid;
  v_grace integer;
  v_grace_until timestamptz;
BEGIN
  SELECT * INTO v_sub FROM public.pay03b_business_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  SELECT c.paid_through, c.paid_plan_id INTO v_through, v_plan FROM public.pay03b_derive_paid_coverage(p_subscription_id) c;
  SELECT grace_days INTO v_grace FROM public.pay03b_subscription_plans WHERE id = coalesce(v_plan, v_sub.plan_id);
  -- Grace is only ever the plan's APPROVED grace days after the last paid period, and only while past due.
  v_grace_until := CASE WHEN v_sub.status IN ('past_due', 'grace_period') AND v_grace IS NOT NULL AND v_through IS NOT NULL
                        THEN v_through + make_interval(days => v_grace) ELSE NULL END;
  IF v_sub.paid_through IS DISTINCT FROM v_through OR v_sub.paid_plan_id IS DISTINCT FROM v_plan
     OR v_sub.grace_until IS DISTINCT FROM v_grace_until THEN
    IF v_sub.paid_through IS DISTINCT FROM v_through OR v_sub.paid_plan_id IS DISTINCT FROM v_plan THEN
      PERFORM public.pay03b_record_transition(v_sub, v_sub.status, v_sub.plan_id, v_through, p_cause, NULL, p_event_id);
    END IF;
    UPDATE public.pay03b_business_subscriptions SET
      paid_through = v_through,
      paid_plan_id = v_plan,
      grace_until = v_grace_until,
      version = version + 1, updated_at = clock_timestamp()
    WHERE id = p_subscription_id RETURNING * INTO v_sub;
  END IF;
  RETURN v_sub;
END $$;

-- 8. Entitlement projection (read-only). Provider history and money stay separate from this decision.
CREATE OR REPLACE FUNCTION public.pay03b_subscription_access(p_sub public.pay03b_business_subscriptions, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_plan public.pay03b_subscription_plans%ROWTYPE;
  v_access boolean := false;
  v_reason text;
BEGIN
  SELECT * INTO v_plan FROM public.pay03b_subscription_plans WHERE id = coalesce(p_sub.paid_plan_id, p_sub.plan_id);
  IF p_sub.status = 'suspended' THEN
    v_reason := coalesce(p_sub.suspended_reason, 'suspended');
  ELSIF EXISTS (
    SELECT 1 FROM public.pay03b_subscription_invoices i
    JOIN public.payment_transactions p ON p.reference = i.payment_reference
    WHERE i.subscription_id = p_sub.id AND p.status = 'reconciliation_hold') THEN
    v_reason := 'payment_reconciliation_hold';
  ELSIF p_sub.status IN ('incomplete', 'incomplete_expired', 'expired', 'paused') THEN
    v_reason := 'status_' || p_sub.status;
  ELSIF p_sub.status = 'cancelled' AND coalesce(p_sub.cancellation_mode, 'immediate') = 'immediate' THEN
    v_reason := 'cancelled_immediately';
  ELSIF p_sub.paid_through IS NOT NULL AND p_sub.paid_through > p_at
        AND p_sub.status IN ('active', 'trialing', 'past_due', 'grace_period', 'cancelled') THEN
    v_access := true;
    v_reason := CASE WHEN p_sub.status = 'cancelled' THEN 'paid_through_after_period_end_cancellation' ELSE 'paid_period' END;
  ELSIF p_sub.status IN ('past_due', 'grace_period') AND p_sub.grace_until IS NOT NULL AND p_sub.grace_until > p_at THEN
    v_access := true;
    v_reason := 'approved_grace_period';
  ELSIF p_sub.status = 'trialing' AND v_plan.trial_days IS NOT NULL AND p_sub.trial_end IS NOT NULL AND p_sub.trial_end > p_at THEN
    v_access := true;
    v_reason := 'approved_trial';
  ELSE
    v_reason := CASE WHEN p_sub.status = 'past_due' THEN 'past_due_without_approved_grace'
                     WHEN p_sub.paid_through IS NULL THEN 'no_paid_period'
                     ELSE 'paid_period_ended' END;
  END IF;
  RETURN jsonb_build_object('access', v_access, 'reason', v_reason,
    'plan_id', v_plan.id, 'plan_code', v_plan.plan_code, 'plan_version', v_plan.plan_version,
    'entitlements', CASE WHEN v_access THEN v_plan.entitlements ELSE '{}'::jsonb END);
END $$;

CREATE OR REPLACE FUNCTION public.pay03b_resolve_tenant_entitlements(p_tenant_id uuid, p_subscription_scope text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_eval jsonb;
  v_best jsonb := NULL;
  v_best_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_baseline jsonb;
BEGIN
  SELECT entitlements INTO v_baseline FROM public.pay03b_subscription_plans
    WHERE subscription_scope = p_subscription_scope AND pricing_kind = 'free' AND effective_to IS NULL
      AND activation_status IN ('approved', 'sandbox_only')
    ORDER BY tier_rank ASC LIMIT 1;
  FOR v_sub IN SELECT * FROM public.pay03b_business_subscriptions
                WHERE owner_tenant_id = p_tenant_id AND subscription_scope = p_subscription_scope
                ORDER BY created_at DESC LOOP
    v_eval := public.pay03b_subscription_access(v_sub, clock_timestamp());
    IF v_best IS NULL OR ((v_eval->>'access')::boolean AND NOT (v_best->>'access')::boolean) THEN
      v_best := v_eval;
      v_best_sub := v_sub;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'subscription_scope', p_subscription_scope,
    'subscription_id', v_best_sub.id,
    'status', v_best_sub.status,
    'paid_through', v_best_sub.paid_through,
    'grace_until', v_best_sub.grace_until,
    'access', coalesce((v_best->>'access')::boolean, false),
    'reason', coalesce(v_best->>'reason', 'no_subscription'),
    'plan_code', v_best->>'plan_code',
    'plan_version', (v_best->>'plan_version')::integer,
    'baseline_entitlements', coalesce(v_baseline, '{}'::jsonb),
    'subscription_entitlements', coalesce(v_best->'entitlements', '{}'::jsonb)
  );
END $$;

-- 9. Governed sandbox plan registration (Owner authorization reference required; never 'approved').
CREATE OR REPLACE FUNCTION public.pay03b_register_sandbox_plan_version(
  p_plan_code text, p_product_code text, p_subscription_scope text, p_subscriber_scope text, p_tier_rank integer,
  p_display_name text, p_pricing_kind text, p_billing_interval text, p_interval_count smallint,
  p_amount_minor bigint, p_currency text, p_currency_scale smallint, p_gateway text, p_provider_price_ref text,
  p_entitlements jsonb, p_trial_days integer, p_grace_days integer, p_change_policy jsonb, p_cancellation_policy jsonb,
  p_refund_policy text, p_approval_evidence_ref text, p_approved_by text, p_created_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_governance public.pay03b_subscription_plans%ROWTYPE;
  v_prev public.pay03b_subscription_plans%ROWTYPE;
  v_row public.pay03b_subscription_plans%ROWTYPE;
BEGIN
  IF p_pricing_kind NOT IN ('sandbox_fixture', 'free') THEN RAISE EXCEPTION 'PAY03B_PLAN_REGISTRATION_KIND_REFUSED'; END IF;
  IF p_pricing_kind = 'sandbox_fixture' AND NOT public.pay03b_gateway_permitted(p_gateway) THEN
    RAISE EXCEPTION 'PAY03B_GATEWAY_NOT_PERMITTED';
  END IF;
  IF coalesce(length(trim(p_approval_evidence_ref)), 0) < 8 OR coalesce(length(trim(p_approved_by)), 0) = 0 THEN
    RAISE EXCEPTION 'PAY03B_PLAN_REGISTRATION_REQUIRES_OWNER_AUTHORIZATION';
  END IF;
  -- A sandbox fixture can only extend an existing governed product/scope (never invent a product).
  SELECT * INTO v_governance FROM public.pay03b_subscription_plans
    WHERE product_code = p_product_code AND subscription_scope = p_subscription_scope
      AND subscriber_scope = p_subscriber_scope AND subscription_authority = 'pay03b_business_subscriptions'
    ORDER BY created_at ASC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY03B_PLAN_REGISTRATION_UNKNOWN_PRODUCT_SCOPE'; END IF;
  SELECT * INTO v_prev FROM public.pay03b_subscription_plans WHERE plan_code = p_plan_code AND effective_to IS NULL FOR UPDATE;
  IF FOUND THEN
    UPDATE public.pay03b_subscription_plans SET effective_to = clock_timestamp(), activation_status = 'retired'
      WHERE id = v_prev.id;
  END IF;
  INSERT INTO public.pay03b_subscription_plans (
    plan_code, plan_version, product_code, product_version, subscription_authority, subscriber_scope,
    subscription_scope, tier_rank, display_name, target_role, eligible_tenant_category, billing_interval, interval_count,
    pricing_kind, amount_minor, currency, currency_scale, jurisdiction, merchant_of_record, provider_allowlist,
    provider_price_ref, entitlements, trial_days, grace_days, change_policy, cancellation_policy, refund_policy,
    activation_status, approval_evidence_ref, approved_by, approved_at, created_by)
  VALUES (
    p_plan_code, coalesce(v_prev.plan_version, 0) + 1, p_product_code, v_governance.product_version,
    'pay03b_business_subscriptions', p_subscriber_scope, p_subscription_scope, p_tier_rank, p_display_name,
    v_governance.target_role, v_governance.eligible_tenant_category,
    CASE WHEN p_pricing_kind = 'free' THEN NULL ELSE p_billing_interval END,
    CASE WHEN p_pricing_kind = 'free' THEN NULL ELSE p_interval_count END,
    p_pricing_kind, CASE WHEN p_pricing_kind = 'free' THEN 0 ELSE p_amount_minor END, p_currency, p_currency_scale,
    CASE WHEN p_pricing_kind = 'free' THEN v_governance.jurisdiction ELSE 'SANDBOX' END,
    CASE WHEN p_pricing_kind = 'free' THEN NULL
         WHEN p_gateway = 'stripe_carup_japan_sandbox' THEN 'carup_japan_stripe_sandbox'
         ELSE 'pay03b_local_provider_simulator' END,
    CASE WHEN p_pricing_kind = 'free' THEN '{}'::text[] ELSE ARRAY[p_gateway] END,
    CASE WHEN p_pricing_kind = 'free' THEN NULL ELSE p_provider_price_ref END,
    coalesce(p_entitlements, '{}'::jsonb), p_trial_days, p_grace_days,
    coalesce(p_change_policy, '{"upgrade":"period_end","downgrade":"period_end","proration":"none"}'::jsonb),
    coalesce(p_cancellation_policy, '{"period_end":true,"immediate":false}'::jsonb),
    p_refund_policy, 'sandbox_only', trim(p_approval_evidence_ref), trim(p_approved_by), clock_timestamp(),
    coalesce(p_created_by, 'unknown'))
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

-- 10. Checkout claim: authority, eligibility, idempotency and one-live-subscription, all inside the database.
CREATE OR REPLACE FUNCTION public.pay03b_claim_business_subscription_checkout(
  p_owner_tenant_id uuid, p_owner_organization_id text, p_actor_id text, p_plan_id uuid, p_request_key text,
  p_gateway text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_plan public.pay03b_subscription_plans%ROWTYPE;
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_customer public.pay03b_billing_customers%ROWTYPE;
BEGIN
  IF p_owner_tenant_id IS NULL OR coalesce(length(trim(p_owner_organization_id)), 0) = 0
     OR coalesce(length(trim(p_actor_id)), 0) = 0 OR p_plan_id IS NULL
     OR p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{16,96}$' THEN
    RAISE EXCEPTION 'PAY03B_INVALID_CHECKOUT_CLAIM';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03b_tenant:' || p_owner_tenant_id::text));
  IF NOT public.pay03b_is_tenant_billing_admin(p_owner_tenant_id, p_actor_id) THEN
    RAISE EXCEPTION 'PAY03B_BILLING_AUTHORITY_REFUSED';
  END IF;
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_owner_tenant_id;
  SELECT * INTO v_org FROM public.organizations WHERE id = trim(p_owner_organization_id);
  IF v_tenant.id IS NULL OR v_org.id IS NULL OR v_org.tenant_id IS DISTINCT FROM p_owner_tenant_id
     OR coalesce(v_org.status, 'active') <> 'active' OR coalesce(v_tenant.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'PAY03B_ORGANIZATION_AUTHORITY_REFUSED';
  END IF;
  SELECT * INTO v_plan FROM public.pay03b_subscription_plans WHERE id = p_plan_id;
  IF NOT FOUND OR v_plan.effective_to IS NOT NULL THEN RAISE EXCEPTION 'PAY03B_PLAN_NOT_CURRENT'; END IF;
  IF v_plan.subscription_authority <> 'pay03b_business_subscriptions'
     OR (v_plan.subscriber_scope = 'dealer_organization' AND v_org.type <> 'dealership')
     OR (v_plan.subscriber_scope = 'garage_organization' AND v_org.type <> 'garage') THEN
    RAISE EXCEPTION 'PAY03B_PLAN_SUBSCRIBER_MISMATCH';
  END IF;
  IF v_plan.pricing_kind = 'free' THEN RAISE EXCEPTION 'PAY03B_FREE_PLAN_NEEDS_NO_PAYMENT'; END IF;
  IF v_plan.pricing_kind <> 'sandbox_fixture' OR v_plan.activation_status <> 'sandbox_only' THEN
    RAISE EXCEPTION 'PAY03B_PLAN_NOT_PURCHASABLE';
  END IF;
  IF NOT public.pay03b_gateway_permitted(p_gateway) OR NOT (p_gateway = ANY (v_plan.provider_allowlist))
     OR v_plan.provider_price_ref IS NULL THEN
    RAISE EXCEPTION 'PAY03B_PROVIDER_NOT_PERMITTED_FOR_PLAN';
  END IF;

  SELECT * INTO v_sub FROM public.pay03b_business_subscriptions
    WHERE owner_tenant_id = p_owner_tenant_id AND request_key = p_request_key;
  IF FOUND THEN
    IF v_sub.plan_id <> p_plan_id OR v_sub.owner_organization_id <> trim(p_owner_organization_id)
       OR v_sub.gateway <> p_gateway THEN
      RAISE EXCEPTION 'PAY03B_CHECKOUT_IDEMPOTENCY_CONFLICT';
    END IF;
  ELSE
    BEGIN
      INSERT INTO public.pay03b_business_subscriptions (
        subscription_reference, owner_tenant_id, owner_organization_id, subscription_scope, plan_id, product_code,
        status, gateway, provider_account_id, subscribing_actor_id, request_key)
      VALUES ('pay03b_sub_' || gen_random_uuid()::text, p_owner_tenant_id, trim(p_owner_organization_id),
        v_plan.subscription_scope, v_plan.id, v_plan.product_code, 'incomplete', p_gateway,
        public.pay03b_gateway_account(p_gateway), trim(p_actor_id), p_request_key)
      RETURNING * INTO v_sub;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_ALREADY_EXISTS';
    END;
    INSERT INTO public.pay03b_subscription_transitions
      (subscription_id, from_status, to_status, from_plan_id, to_plan_id, cause, actor_id)
    VALUES (v_sub.id, NULL, 'incomplete', NULL, v_sub.plan_id, 'checkout_claimed', trim(p_actor_id));
  END IF;
  SELECT * INTO v_customer FROM public.pay03b_billing_customers
    WHERE owner_organization_id = trim(p_owner_organization_id) AND gateway = p_gateway;
  RETURN jsonb_build_object(
    'subscription', to_jsonb(v_sub),
    'plan', to_jsonb(v_plan),
    'organization', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'type', v_org.type),
    'provider_customer_id', v_customer.provider_customer_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.pay03b_bind_billing_customer(
  p_owner_tenant_id uuid, p_owner_organization_id text, p_gateway text, p_provider_customer_id text, p_actor_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.pay03b_billing_customers%ROWTYPE;
BEGIN
  IF NOT public.pay03b_gateway_permitted(p_gateway) THEN RAISE EXCEPTION 'PAY03B_GATEWAY_NOT_PERMITTED'; END IF;
  IF NOT public.pay03b_is_tenant_billing_admin(p_owner_tenant_id, p_actor_id) THEN
    RAISE EXCEPTION 'PAY03B_BILLING_AUTHORITY_REFUSED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = trim(p_owner_organization_id) AND tenant_id = p_owner_tenant_id) THEN
    RAISE EXCEPTION 'PAY03B_ORGANIZATION_AUTHORITY_REFUSED';
  END IF;
  INSERT INTO public.pay03b_billing_customers
    (owner_tenant_id, owner_organization_id, gateway, provider_account_id, provider_customer_id, created_by)
  VALUES (p_owner_tenant_id, trim(p_owner_organization_id), p_gateway, public.pay03b_gateway_account(p_gateway),
    p_provider_customer_id, trim(p_actor_id))
  ON CONFLICT (owner_organization_id, gateway) DO NOTHING;
  SELECT * INTO v_row FROM public.pay03b_billing_customers
    WHERE owner_organization_id = trim(p_owner_organization_id) AND gateway = p_gateway;
  IF v_row.provider_customer_id <> p_provider_customer_id OR v_row.owner_tenant_id <> p_owner_tenant_id THEN
    RAISE EXCEPTION 'PAY03B_BILLING_CUSTOMER_CONFLICT';
  END IF;
  RETURN to_jsonb(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.pay03b_attach_subscription_checkout(
  p_subscription_id uuid, p_checkout_id text, p_provider_customer_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_customer public.pay03b_billing_customers%ROWTYPE;
BEGIN
  SELECT * INTO v_sub FROM public.pay03b_business_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR v_sub.status <> 'incomplete' THEN RAISE EXCEPTION 'PAY03B_CHECKOUT_ATTACH_REFUSED'; END IF;
  SELECT * INTO v_customer FROM public.pay03b_billing_customers
    WHERE owner_organization_id = v_sub.owner_organization_id AND gateway = v_sub.gateway;
  IF NOT FOUND OR v_customer.provider_customer_id <> p_provider_customer_id THEN
    RAISE EXCEPTION 'PAY03B_BILLING_CUSTOMER_CONFLICT';
  END IF;
  IF (v_sub.gateway = 'stripe_carup_japan_sandbox' AND p_checkout_id !~ '^cs_test_[A-Za-z0-9_]+$')
     OR (v_sub.gateway = 'pay03b_local_provider_simulator' AND p_checkout_id !~ '^sim_cs_[A-Za-z0-9_]+$') THEN
    RAISE EXCEPTION 'PAY03B_TEST_CHECKOUT_REQUIRED';
  END IF;
  IF v_sub.provider_checkout_id IS NOT NULL AND v_sub.provider_checkout_id <> p_checkout_id THEN
    RAISE EXCEPTION 'PAY03B_CHECKOUT_ATTACH_REFUSED';
  END IF;
  UPDATE public.pay03b_business_subscriptions SET
    provider_checkout_id = p_checkout_id, billing_customer_id = v_customer.id,
    version = version + 1, updated_at = clock_timestamp()
  WHERE id = p_subscription_id RETURNING * INTO v_sub;
  RETURN to_jsonb(v_sub);
END $$;

-- 11. Provider subscription snapshot (fresh provider read; signed event or readback).
CREATE OR REPLACE FUNCTION public.pay03b_apply_subscription_snapshot(
  p_subscription_id uuid, p_provider_subscription_id text, p_provider_status text, p_price_ref text,
  p_current_period_start timestamptz, p_current_period_end timestamptz, p_cancel_at_period_end boolean,
  p_canceled_at timestamptz, p_ended_at timestamptz, p_trial_end timestamptz, p_observed_at timestamptz,
  p_event_id text DEFAULT NULL, p_event_type text DEFAULT NULL, p_checkout_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_plan public.pay03b_subscription_plans%ROWTYPE;
  v_price_plan public.pay03b_subscription_plans%ROWTYPE;
  v_target text;
  v_reason text;
  v_mode text;
BEGIN
  IF p_observed_at IS NULL OR p_observed_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'PAY03B_PROVIDER_OBSERVATION_TIME_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03b_sub:' || p_subscription_id::text));
  SELECT * INTO v_sub FROM public.pay03b_business_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_NOT_FOUND'; END IF;

  IF p_event_id IS NOT NULL THEN
    IF p_event_type IS NULL THEN RAISE EXCEPTION 'PAY03B_EVENT_IDENTITY_INVALID'; END IF;
    INSERT INTO public.pay03b_provider_event_receipts (event_id, event_type, gateway, subscription_id, resulting_state)
      VALUES (p_event_id, p_event_type, v_sub.gateway, v_sub.id, 'subscription_snapshot')
      ON CONFLICT (event_id) DO NOTHING;
    IF NOT FOUND THEN
      IF (SELECT subscription_id FROM public.pay03b_provider_event_receipts WHERE event_id = p_event_id) IS DISTINCT FROM v_sub.id THEN
        RAISE EXCEPTION 'PAY03B_EVENT_CROSS_SUBSCRIPTION_REPLAY';
      END IF;
      RETURN to_jsonb(v_sub) || jsonb_build_object('duplicate_event', true, 'stale', false);
    END IF;
  END IF;

  -- Checkout abandoned before any provider subscription exists.
  IF p_provider_subscription_id IS NULL THEN
    IF p_checkout_status = 'expired' AND v_sub.status = 'incomplete' AND v_sub.provider_subscription_id IS NULL THEN
      PERFORM public.pay03b_record_transition(v_sub, 'incomplete_expired', v_sub.plan_id, v_sub.paid_through,
        'checkout_expired', NULL, p_event_id);
      UPDATE public.pay03b_business_subscriptions SET status = 'incomplete_expired', provider_observed_at = p_observed_at,
        version = version + 1, updated_at = clock_timestamp() WHERE id = v_sub.id RETURNING * INTO v_sub;
    END IF;
    RETURN to_jsonb(v_sub) || jsonb_build_object('duplicate_event', false, 'stale', false);
  END IF;

  IF (v_sub.gateway = 'stripe_carup_japan_sandbox' AND p_provider_subscription_id !~ '^sub_[A-Za-z0-9_]+$')
     OR (v_sub.gateway = 'pay03b_local_provider_simulator' AND p_provider_subscription_id !~ '^sim_sub_[A-Za-z0-9_]+$') THEN
    RAISE EXCEPTION 'PAY03B_PROVIDER_SUBSCRIPTION_REFERENCE_INVALID';
  END IF;
  IF v_sub.provider_subscription_id IS NOT NULL AND v_sub.provider_subscription_id <> p_provider_subscription_id THEN
    RAISE EXCEPTION 'PAY03B_PROVIDER_SUBSCRIPTION_SUBSTITUTION_REFUSED';
  END IF;
  -- Out-of-order convergence: an older provider observation never overwrites a newer one.
  IF v_sub.provider_observed_at IS NOT NULL AND p_observed_at < v_sub.provider_observed_at THEN
    RETURN to_jsonb(v_sub) || jsonb_build_object('duplicate_event', false, 'stale', true);
  END IF;

  SELECT * INTO v_plan FROM public.pay03b_subscription_plans WHERE id = v_sub.plan_id;
  IF p_price_ref IS NOT NULL AND p_price_ref IS DISTINCT FROM v_plan.provider_price_ref THEN
    SELECT * INTO v_price_plan FROM public.pay03b_subscription_plans WHERE provider_price_ref = p_price_ref;
    IF NOT FOUND OR v_price_plan.subscription_scope <> v_sub.subscription_scope
       OR v_price_plan.subscription_authority <> 'pay03b_business_subscriptions' THEN
      RAISE EXCEPTION 'PAY03B_PROVIDER_PRICE_NOT_GOVERNED';
    END IF;
  ELSE
    v_price_plan := v_plan;
  END IF;

  v_target := CASE p_provider_status
    WHEN 'incomplete' THEN 'incomplete'
    WHEN 'incomplete_expired' THEN 'incomplete_expired'
    WHEN 'trialing' THEN CASE WHEN v_price_plan.trial_days IS NULL THEN 'suspended' ELSE 'trialing' END
    WHEN 'active' THEN 'active'
    WHEN 'past_due' THEN CASE WHEN v_price_plan.grace_days IS NULL THEN 'past_due' ELSE 'grace_period' END
    WHEN 'unpaid' THEN 'suspended'
    WHEN 'canceled' THEN 'cancelled'
    WHEN 'paused' THEN 'paused'
    ELSE NULL END;
  IF v_target IS NULL THEN RAISE EXCEPTION 'PAY03B_PROVIDER_STATUS_UNKNOWN'; END IF;
  v_reason := CASE WHEN p_provider_status = 'trialing' AND v_price_plan.trial_days IS NULL THEN 'unauthorized_provider_trial'
                   WHEN p_provider_status = 'unpaid' THEN 'provider_unpaid' ELSE NULL END;
  -- An administrator suspension is never lifted by a provider observation.
  IF v_sub.suspended_reason = 'admin_suspension' THEN
    v_target := 'suspended';
    v_reason := 'admin_suspension';
  END IF;
  IF v_sub.status IN ('incomplete_expired', 'expired') THEN
    v_target := v_sub.status;
  END IF;
  v_mode := CASE
    WHEN v_target <> 'cancelled' THEN NULL
    WHEN v_sub.cancellation_mode IS NOT NULL THEN v_sub.cancellation_mode
    WHEN v_sub.cancel_at_period_end AND p_ended_at IS NOT NULL AND v_sub.current_period_end IS NOT NULL
         AND p_ended_at >= v_sub.current_period_end - interval '1 minute' THEN 'period_end'
    ELSE 'immediate' END;

  IF v_target IS DISTINCT FROM v_sub.status OR v_price_plan.id IS DISTINCT FROM v_sub.plan_id THEN
    PERFORM public.pay03b_record_transition(v_sub, v_target, v_price_plan.id, v_sub.paid_through,
      'provider_snapshot:' || p_provider_status, NULL, p_event_id);
  END IF;
  UPDATE public.pay03b_business_subscriptions SET
    provider_subscription_id = p_provider_subscription_id,
    provider_status = p_provider_status,
    status = v_target,
    suspended_reason = v_reason,
    plan_id = v_price_plan.id,
    current_period_start = p_current_period_start,
    current_period_end = p_current_period_end,
    cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
    canceled_at = p_canceled_at,
    ended_at = p_ended_at,
    trial_end = p_trial_end,
    cancellation_mode = v_mode,
    provider_observed_at = p_observed_at,
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE id = v_sub.id RETURNING * INTO v_sub;
  v_sub := public.pay03b_refresh_paid_coverage(v_sub.id, 'provider_snapshot', p_event_id);
  RETURN to_jsonb(v_sub) || jsonb_build_object('duplicate_event', false, 'stale', false);
END $$;

-- 12. Recurring invoice + its canonical payment (one row per invoice; refunds/F5 via the shared helpers).
CREATE OR REPLACE FUNCTION public.pay03b_record_subscription_invoice(
  p_subscription_id uuid, p_provider_invoice_id text, p_billing_reason text, p_price_ref text,
  p_period_start timestamptz, p_period_end timestamptz, p_currency text, p_amount_due_minor bigint,
  p_amount_paid_minor bigint, p_amount_remaining_minor bigint, p_provider_status text, p_payment_intent_id text,
  p_attempt_count integer, p_next_payment_attempt timestamptz, p_observed_at timestamptz,
  p_payment_status text DEFAULT NULL, p_refund_id text DEFAULT NULL,
  p_refunded_minor bigint DEFAULT NULL, p_pending_refund_minor bigint DEFAULT NULL, p_refund_ids text[] DEFAULT NULL,
  p_mismatch text DEFAULT NULL, p_detected_via text DEFAULT NULL,
  p_event_id text DEFAULT NULL, p_event_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_plan public.pay03b_subscription_plans%ROWTYPE;
  v_invoice public.pay03b_subscription_invoices%ROWTYPE;
  v_payment public.payment_transactions%ROWTYPE;
  v_anomaly text := NULL;
  v_transition jsonb;
  v_record jsonb := '{}'::jsonb;
  v_target text;
  v_scale smallint;
  v_dup boolean := false;
BEGIN
  IF p_observed_at IS NULL OR p_observed_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'PAY03B_PROVIDER_OBSERVATION_TIME_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03b_sub:' || p_subscription_id::text));
  SELECT * INTO v_sub FROM public.pay03b_business_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR v_sub.provider_subscription_id IS NULL THEN RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_NOT_BOUND'; END IF;
  IF (v_sub.gateway = 'stripe_carup_japan_sandbox' AND (p_provider_invoice_id !~ '^in_[A-Za-z0-9_]+$'
        OR (p_payment_intent_id IS NOT NULL AND p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$')))
     OR (v_sub.gateway = 'pay03b_local_provider_simulator' AND (p_provider_invoice_id !~ '^sim_in_[A-Za-z0-9_]+$'
        OR (p_payment_intent_id IS NOT NULL AND p_payment_intent_id !~ '^sim_pi_[A-Za-z0-9_]+$'))) THEN
    RAISE EXCEPTION 'PAY03B_PROVIDER_INVOICE_REFERENCE_INVALID';
  END IF;
  IF p_billing_reason NOT IN ('subscription_create', 'subscription_cycle', 'subscription_update', 'manual') THEN
    RAISE EXCEPTION 'PAY03B_INVOICE_BILLING_REASON_UNSUPPORTED';
  END IF;

  IF p_event_id IS NOT NULL THEN
    IF p_event_type IS NULL THEN RAISE EXCEPTION 'PAY03B_EVENT_IDENTITY_INVALID'; END IF;
    INSERT INTO public.pay03b_provider_event_receipts (event_id, event_type, gateway, subscription_id, resulting_state)
      VALUES (p_event_id, p_event_type, v_sub.gateway, v_sub.id, 'invoice_snapshot')
      ON CONFLICT (event_id) DO NOTHING;
    IF NOT FOUND THEN
      IF (SELECT subscription_id FROM public.pay03b_provider_event_receipts WHERE event_id = p_event_id) IS DISTINCT FROM v_sub.id THEN
        RAISE EXCEPTION 'PAY03B_EVENT_CROSS_SUBSCRIPTION_REPLAY';
      END IF;
      v_dup := true;
    END IF;
  END IF;
  IF v_dup THEN
    SELECT * INTO v_invoice FROM public.pay03b_subscription_invoices WHERE provider_invoice_id = p_provider_invoice_id;
    RETURN jsonb_build_object('invoice', to_jsonb(v_invoice), 'subscription', to_jsonb(v_sub), 'duplicate_event', true);
  END IF;

  -- The plan billed is the governed plan behind the invoice's price (a scheduled plan change bills the new plan).
  SELECT * INTO v_plan FROM public.pay03b_subscription_plans
    WHERE provider_price_ref = coalesce(p_price_ref, (SELECT provider_price_ref FROM public.pay03b_subscription_plans WHERE id = v_sub.plan_id));
  IF NOT FOUND OR v_plan.subscription_scope <> v_sub.subscription_scope THEN
    RAISE EXCEPTION 'PAY03B_PROVIDER_PRICE_NOT_GOVERNED';
  END IF;
  v_scale := v_plan.currency_scale;
  IF upper(p_currency) <> v_plan.currency THEN
    v_anomaly := 'currency_mismatch';
  ELSIF p_billing_reason IN ('subscription_create', 'subscription_cycle') AND p_amount_due_minor = 0 THEN
    v_anomaly := 'unexpected_zero_amount';
  ELSIF p_billing_reason IN ('subscription_create', 'subscription_cycle') AND p_amount_due_minor <> v_plan.amount_minor THEN
    v_anomaly := 'amount_mismatch';
  ELSIF p_billing_reason = 'subscription_update' AND v_plan.change_policy->>'proration' <> 'always_invoice' THEN
    v_anomaly := 'unauthorized_proration';
  END IF;

  SELECT * INTO v_invoice FROM public.pay03b_subscription_invoices WHERE provider_invoice_id = p_provider_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.pay03b_subscription_invoices (
        subscription_id, owner_tenant_id, plan_id, gateway, provider_account_id, provider_invoice_id, billing_reason,
        period_start, period_end, currency, currency_scale, amount_due_minor, amount_paid_minor, amount_remaining_minor,
        provider_status, anomaly, provider_payment_intent_id, attempt_count, next_payment_attempt, provider_observed_at)
      VALUES (v_sub.id, v_sub.owner_tenant_id, v_plan.id, v_sub.gateway, v_sub.provider_account_id, p_provider_invoice_id,
        p_billing_reason, p_period_start, p_period_end, upper(p_currency), v_scale, p_amount_due_minor,
        coalesce(p_amount_paid_minor, 0), coalesce(p_amount_remaining_minor, 0), p_provider_status, v_anomaly,
        p_payment_intent_id, coalesce(p_attempt_count, 0), p_next_payment_attempt, p_observed_at)
      RETURNING * INTO v_invoice;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PAY03B_DUPLICATE_PERIOD_COLLECTION_REFUSED';
    END;
  ELSIF v_invoice.subscription_id <> v_sub.id THEN
    RAISE EXCEPTION 'PAY03B_INVOICE_CROSS_SUBSCRIPTION_REFUSED';
  ELSIF v_invoice.provider_observed_at IS NULL OR p_observed_at >= v_invoice.provider_observed_at THEN
    UPDATE public.pay03b_subscription_invoices SET
      provider_status = CASE WHEN provider_status IN ('paid', 'void', 'uncollectible') THEN provider_status ELSE p_provider_status END,
      amount_paid_minor = greatest(amount_paid_minor, coalesce(p_amount_paid_minor, 0)),
      amount_remaining_minor = coalesce(p_amount_remaining_minor, amount_remaining_minor),
      provider_payment_intent_id = coalesce(provider_payment_intent_id, p_payment_intent_id),
      attempt_count = greatest(attempt_count, coalesce(p_attempt_count, 0)),
      next_payment_attempt = p_next_payment_attempt,
      anomaly = coalesce(anomaly, v_anomaly),
      provider_observed_at = p_observed_at,
      last_observed_at = clock_timestamp()
    WHERE id = v_invoice.id RETURNING * INTO v_invoice;
  END IF;

  -- One canonical payment row per invoice obligation, created once a provider PaymentIntent exists.
  IF v_invoice.provider_payment_intent_id IS NOT NULL AND v_invoice.amount_due_minor > 0 THEN
    IF v_invoice.payment_reference IS NULL THEN
      INSERT INTO public.payment_transactions (
        gateway, amount, currency, reference, status, pay01a_actor_id, pay01a_account_id, pay01a_intent_id,
        pay02_product_code, pay02_product_version, pay02_commercial_category, pay02_funds_owner,
        pay02_legal_beneficiary, pay02_settlement_status)
      VALUES (v_sub.gateway, v_invoice.amount_due_minor::numeric / (10 ^ v_scale)::numeric, v_invoice.currency,
        'pay03b_inv_' || gen_random_uuid()::text, 'pending', 'tenant:' || v_sub.owner_tenant_id::text,
        v_sub.provider_account_id, v_invoice.provider_payment_intent_id, v_plan.product_code, v_plan.product_version,
        'category_a_first_party', 'carup', 'carup', 'not_applicable_sandbox')
      RETURNING * INTO v_payment;
      UPDATE public.pay03b_subscription_invoices SET payment_reference = v_payment.reference WHERE id = v_invoice.id
        RETURNING * INTO v_invoice;
    ELSE
      -- Lock order everywhere: subscription advisory -> payment-reference advisory -> rows.
      PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_invoice.payment_reference));
      SELECT * INTO v_payment FROM public.payment_transactions WHERE reference = v_invoice.payment_reference FOR UPDATE;
    END IF;
    IF v_payment.pay01a_intent_id IS DISTINCT FROM v_invoice.provider_payment_intent_id THEN
      RAISE EXCEPTION 'PAY03B_INVOICE_PAYMENT_BINDING_MISMATCH';
    END IF;
    -- Provider money truth for the invoice's PaymentIntent (fresh read by the caller). A failed attempt stays
    -- 'pending': a failed renewal never fabricates a payment.
    IF p_payment_status IS NOT NULL THEN
      v_transition := public.pay03b_payment_transition_target(
        v_payment, v_invoice.amount_due_minor, p_payment_status, v_invoice.provider_payment_intent_id, p_refund_id,
        p_refunded_minor, p_pending_refund_minor, p_refund_ids, p_mismatch, p_detected_via);
      v_target := v_transition->>'target_status';
      IF v_target = 'paid' AND (v_invoice.provider_status <> 'paid' OR v_invoice.amount_paid_minor <> v_invoice.amount_due_minor) THEN
        RAISE EXCEPTION 'PAY03B_PAYMENT_PAID_WITHOUT_PAID_INVOICE';
      END IF;
      v_record := public.pay03b_record_payment_hold(
        v_payment, v_invoice.amount_due_minor, v_target, p_payment_status, v_invoice.provider_payment_intent_id,
        p_refund_id, p_event_id, p_event_type, p_refunded_minor, p_pending_refund_minor, p_refund_ids, p_mismatch,
        p_detected_via);
      UPDATE public.payment_transactions SET
        status = v_target,
        pay01a_refund_id = CASE WHEN v_target = 'reconciliation_hold' THEN pay01a_refund_id
                                ELSE coalesce(pay01a_refund_id, p_refund_id) END,
        updated_at = now()
      WHERE reference = v_payment.reference RETURNING * INTO v_payment;
    END IF;
    IF v_invoice.provider_status IN ('void', 'uncollectible') AND v_payment.status = 'pending' THEN
      UPDATE public.payment_transactions SET status = 'cancelled', updated_at = now()
        WHERE reference = v_payment.reference RETURNING * INTO v_payment;
    END IF;
  END IF;

  v_sub := public.pay03b_refresh_paid_coverage(v_sub.id, 'invoice_' || v_invoice.provider_status, p_event_id);
  RETURN jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'payment', CASE WHEN v_payment.reference IS NULL THEN NULL ELSE to_jsonb(v_payment) END,
    'subscription', to_jsonb(v_sub),
    'duplicate_event', false) || v_record;
END $$;

-- 13. Attributable subscriber change requests (billing authority re-checked in the database).
CREATE OR REPLACE FUNCTION public.pay03b_request_subscription_change(
  p_subscription_id uuid, p_actor_id text, p_change_type text, p_target_plan_id uuid, p_request_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_plan public.pay03b_subscription_plans%ROWTYPE;
  v_target public.pay03b_subscription_plans%ROWTYPE;
  v_req public.pay03b_subscription_change_requests%ROWTYPE;
  v_role text;
BEGIN
  IF p_change_type NOT IN ('cancel_at_period_end', 'resume', 'cancel_immediately', 'plan_change_period_end', 'plan_change_immediate') THEN
    RAISE EXCEPTION 'PAY03B_CHANGE_TYPE_INVALID';
  END IF;
  SELECT * INTO v_sub FROM public.pay03b_business_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_NOT_FOUND'; END IF;
  IF NOT public.pay03b_is_tenant_billing_admin(v_sub.owner_tenant_id, p_actor_id) THEN
    RAISE EXCEPTION 'PAY03B_BILLING_AUTHORITY_REFUSED';
  END IF;
  SELECT role INTO v_role FROM public.tenant_users WHERE tenant_id = v_sub.owner_tenant_id AND user_id = trim(p_actor_id);
  SELECT * INTO v_req FROM public.pay03b_subscription_change_requests
    WHERE subscription_id = v_sub.id AND request_key = p_request_key;
  IF FOUND THEN
    IF v_req.change_type <> p_change_type OR v_req.target_plan_id IS DISTINCT FROM p_target_plan_id THEN
      RAISE EXCEPTION 'PAY03B_CHANGE_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('request', to_jsonb(v_req), 'subscription', to_jsonb(v_sub), 'replay', true);
  END IF;
  IF v_sub.provider_subscription_id IS NULL OR v_sub.status IN ('incomplete', 'incomplete_expired', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_NOT_CHANGEABLE';
  END IF;
  SELECT * INTO v_plan FROM public.pay03b_subscription_plans WHERE id = v_sub.plan_id;
  IF p_change_type = 'cancel_immediately' AND (v_plan.cancellation_policy->>'immediate')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'PAY03B_IMMEDIATE_CANCELLATION_NOT_IN_TERMS';
  END IF;
  IF p_change_type = 'cancel_at_period_end' AND (v_plan.cancellation_policy->>'period_end')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'PAY03B_PERIOD_END_CANCELLATION_NOT_IN_TERMS';
  END IF;
  IF p_change_type IN ('plan_change_period_end', 'plan_change_immediate') THEN
    SELECT * INTO v_target FROM public.pay03b_subscription_plans WHERE id = p_target_plan_id;
    IF NOT FOUND OR v_target.effective_to IS NOT NULL OR v_target.id = v_plan.id
       OR v_target.subscription_scope <> v_sub.subscription_scope
       OR v_target.pricing_kind <> 'sandbox_fixture' OR v_target.activation_status <> 'sandbox_only'
       OR NOT (v_sub.gateway = ANY (v_target.provider_allowlist)) OR v_target.provider_price_ref IS NULL THEN
      RAISE EXCEPTION 'PAY03B_TARGET_PLAN_NOT_PURCHASABLE';
    END IF;
    IF v_target.tier_rank > v_plan.tier_rank THEN
      IF v_plan.change_policy->>'upgrade' = 'not_allowed'
         OR (p_change_type = 'plan_change_immediate' AND v_plan.change_policy->>'upgrade' <> 'immediate_prorated') THEN
        RAISE EXCEPTION 'PAY03B_UPGRADE_POLICY_REFUSED';
      END IF;
    ELSE
      IF v_plan.change_policy->>'downgrade' = 'not_allowed' OR p_change_type = 'plan_change_immediate' THEN
        RAISE EXCEPTION 'PAY03B_DOWNGRADE_POLICY_REFUSED';
      END IF;
    END IF;
  END IF;
  INSERT INTO public.pay03b_subscription_change_requests
    (subscription_id, change_type, target_plan_id, requested_by, requested_role, request_key, reason)
  VALUES (v_sub.id, p_change_type, p_target_plan_id, trim(p_actor_id), coalesce(v_role, 'tenant_member'), p_request_key, p_reason)
  RETURNING * INTO v_req;
  RETURN jsonb_build_object('request', to_jsonb(v_req), 'subscription', to_jsonb(v_sub),
    'current_plan', to_jsonb(v_plan), 'target_plan', CASE WHEN v_target.id IS NULL THEN NULL ELSE to_jsonb(v_target) END,
    'replay', false);
END $$;

CREATE OR REPLACE FUNCTION public.pay03b_complete_subscription_change(
  p_request_id uuid, p_status text, p_outcome_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req public.pay03b_subscription_change_requests%ROWTYPE;
BEGIN
  IF p_status NOT IN ('provider_confirmed', 'refused', 'failed') THEN RAISE EXCEPTION 'PAY03B_CHANGE_STATUS_INVALID'; END IF;
  SELECT * INTO v_req FROM public.pay03b_subscription_change_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY03B_CHANGE_REQUEST_NOT_FOUND'; END IF;
  IF v_req.status = 'requested' THEN
    UPDATE public.pay03b_subscription_change_requests SET status = p_status, outcome_code = p_outcome_code,
      completed_at = clock_timestamp() WHERE id = p_request_id RETURNING * INTO v_req;
  END IF;
  RETURN to_jsonb(v_req);
END $$;

-- 14. Platform-administrator suspension (verified against public.users; never lifted by the provider).
CREATE OR REPLACE FUNCTION public.pay03b_admin_set_subscription_suspension(
  p_subscription_id uuid, p_actor_id text, p_action text, p_reason text, p_request_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
  v_req public.pay03b_subscription_change_requests%ROWTYPE;
  v_restore text;
BEGIN
  IF p_action NOT IN ('suspend', 'resume') THEN RAISE EXCEPTION 'PAY03B_ADMIN_ACTION_INVALID'; END IF;
  IF NOT public.pay03b_is_platform_admin(p_actor_id) THEN RAISE EXCEPTION 'PAY03B_ADMIN_AUTHORITY_REFUSED'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'PAY03B_ADMIN_REASON_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03b_sub:' || p_subscription_id::text));
  SELECT * INTO v_sub FROM public.pay03b_business_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY03B_SUBSCRIPTION_NOT_FOUND'; END IF;
  SELECT * INTO v_req FROM public.pay03b_subscription_change_requests WHERE subscription_id = v_sub.id AND request_key = p_request_key;
  IF FOUND THEN
    RETURN jsonb_build_object('request', to_jsonb(v_req), 'subscription', to_jsonb(v_sub), 'replay', true);
  END IF;
  INSERT INTO public.pay03b_subscription_change_requests
    (subscription_id, change_type, requested_by, requested_role, request_key, reason, status, outcome_code, completed_at)
  VALUES (v_sub.id, CASE WHEN p_action = 'suspend' THEN 'admin_suspend' ELSE 'admin_resume' END, trim(p_actor_id),
    'platform_admin', p_request_key, trim(p_reason), 'provider_confirmed', 'canonical_admin_action', clock_timestamp())
  RETURNING * INTO v_req;
  IF p_action = 'suspend' THEN
    IF v_sub.suspended_reason = 'admin_suspension' THEN RAISE EXCEPTION 'PAY03B_ALREADY_SUSPENDED'; END IF;
    PERFORM public.pay03b_record_transition(v_sub, 'suspended', v_sub.plan_id, v_sub.paid_through, 'admin_suspend', trim(p_actor_id), NULL);
    UPDATE public.pay03b_business_subscriptions SET status = 'suspended', suspended_reason = 'admin_suspension',
      version = version + 1, updated_at = clock_timestamp() WHERE id = v_sub.id RETURNING * INTO v_sub;
  ELSE
    IF v_sub.suspended_reason IS DISTINCT FROM 'admin_suspension' THEN RAISE EXCEPTION 'PAY03B_NOT_ADMIN_SUSPENDED'; END IF;
    v_restore := CASE v_sub.provider_status
      WHEN 'active' THEN 'active' WHEN 'past_due' THEN 'past_due' WHEN 'canceled' THEN 'cancelled'
      WHEN 'paused' THEN 'paused' WHEN 'incomplete' THEN 'incomplete' ELSE 'suspended' END;
    PERFORM public.pay03b_record_transition(v_sub, v_restore, v_sub.plan_id, v_sub.paid_through, 'admin_resume', trim(p_actor_id), NULL);
    UPDATE public.pay03b_business_subscriptions SET status = v_restore,
      suspended_reason = CASE WHEN v_restore = 'suspended' THEN 'provider_unpaid' ELSE NULL END,
      version = version + 1, updated_at = clock_timestamp() WHERE id = v_sub.id RETURNING * INTO v_sub;
  END IF;
  RETURN jsonb_build_object('request', to_jsonb(v_req), 'subscription', to_jsonb(v_sub), 'replay', false);
END $$;

-- 14a. F5 hooks for invoice payments: same lock order as the invoice writer, coverage re-projected on resolution.
CREATE OR REPLACE FUNCTION public.pay03b_payment_owner_lock(p_reference text)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_subscription uuid;
BEGIN
  SELECT subscription_id INTO v_subscription FROM public.pay03b_subscription_invoices WHERE payment_reference = p_reference;
  IF v_subscription IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('carup_pay03b_sub:' || v_subscription::text));
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.pay03b_after_payment_resolution(p_reference text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_subscription uuid;
  v_sub public.pay03b_business_subscriptions%ROWTYPE;
BEGIN
  SELECT subscription_id INTO v_subscription FROM public.pay03b_subscription_invoices WHERE payment_reference = p_reference;
  IF v_subscription IS NULL THEN RETURN NULL; END IF;
  v_sub := public.pay03b_refresh_paid_coverage(v_subscription, 'reconciliation_resolution', NULL);
  RETURN jsonb_build_object('subscription_id', v_sub.id, 'paid_through', v_sub.paid_through,
    'access', public.pay03b_subscription_access(v_sub, clock_timestamp()));
END $$;
REVOKE ALL ON FUNCTION public.pay03b_payment_owner_lock(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pay03b_after_payment_resolution(text) FROM PUBLIC, anon, authenticated, service_role;

-- 15. RLS and least privilege: no API role reads or writes business financial details directly.
ALTER TABLE public.pay03b_subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay03b_billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay03b_business_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay03b_subscription_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay03b_provider_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay03b_subscription_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay03b_subscription_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pay03b_subscription_plans, public.pay03b_billing_customers,
  public.pay03b_business_subscriptions, public.pay03b_subscription_invoices, public.pay03b_provider_event_receipts,
  public.pay03b_subscription_transitions, public.pay03b_subscription_change_requests
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.pay03b_subscription_transitions_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pay03b_subscription_plans, public.pay03b_billing_customers,
  public.pay03b_business_subscriptions, public.pay03b_subscription_invoices, public.pay03b_provider_event_receipts,
  public.pay03b_subscription_transitions, public.pay03b_subscription_change_requests TO service_role;

REVOKE ALL ON FUNCTION public.pay03b_gateway_permitted(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_gateway_account(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_is_tenant_billing_admin(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_is_platform_admin(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_record_transition(public.pay03b_business_subscriptions,text,uuid,timestamptz,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pay03b_derive_paid_coverage(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pay03b_refresh_paid_coverage(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pay03b_subscription_access(public.pay03b_business_subscriptions,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pay03b_guard_plan_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_guard_business_subscription() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_guard_subscription_invoice() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_guard_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_guard_change_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_resolve_tenant_entitlements(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_register_sandbox_plan_version(text,text,text,text,integer,text,text,text,smallint,bigint,text,smallint,text,text,jsonb,integer,integer,jsonb,jsonb,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_claim_business_subscription_checkout(uuid,text,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_bind_billing_customer(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_attach_subscription_checkout(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_apply_subscription_snapshot(uuid,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_record_subscription_invoice(uuid,text,text,text,timestamptz,timestamptz,text,bigint,bigint,bigint,text,text,integer,timestamptz,timestamptz,text,text,bigint,bigint,text[],text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_request_subscription_change(uuid,text,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_complete_subscription_change(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_admin_set_subscription_suspension(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pay03b_resolve_tenant_entitlements(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_register_sandbox_plan_version(text,text,text,text,integer,text,text,text,smallint,bigint,text,smallint,text,text,jsonb,integer,integer,jsonb,jsonb,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_claim_business_subscription_checkout(uuid,text,text,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_bind_billing_customer(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_attach_subscription_checkout(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_apply_subscription_snapshot(uuid,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_record_subscription_invoice(uuid,text,text,text,timestamptz,timestamptz,text,bigint,bigint,bigint,text,text,integer,timestamptz,timestamptz,text,text,bigint,bigint,text[],text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_request_subscription_change(uuid,text,text,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_complete_subscription_change(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_admin_set_subscription_suspension(uuid,text,text,text,text) TO service_role;

COMMIT;

-- +migrate Down
-- PAY-03B never deletes subscription, invoice or payment evidence in an automatic rollback.
DO $$ BEGIN RAISE EXCEPTION 'PAY03B_RETAIN_SUBSCRIPTION_AND_PAYMENT_EVIDENCE'; END $$;
