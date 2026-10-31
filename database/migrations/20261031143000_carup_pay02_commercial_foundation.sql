-- +migrate Up
-- CARUP-PAY-02 — Unified Commercial Service Catalogue, Quote Authority & Canonical Payment Convergence
-- Authority: GitHub Issue #247 & Owner Master Long-Run Implementation Directive
-- Additive, idempotent, staging/test foundation only. No production or live-money activation.
-- Reuses `public.payment_transactions` as the sole canonical money ledger.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.payment_transactions') IS NULL
     OR to_regprocedure('public.pay01a_apply_provider_snapshot(text,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PAY02_REQUIRES_CANONICAL_PAY01A_PAYMENT_SCHEMA';
  END IF;
END $$;

-- 1. Versioned Commercial Product Registry
CREATE TABLE IF NOT EXISTS public.pay02_commercial_products (
  product_code text PRIMARY KEY CHECK (product_code ~ '^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$'),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  family text NOT NULL CHECK (family IN (
    'marketplace', 'intelligence', 'subscriptions', 'advertising', 'garage',
    'imports_trade', 'insurance', 'banking_finance', 'adjustments',
    'corporate_finance', 'capital_treasury'
  )),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  commercial_event text NOT NULL CHECK (length(trim(commercial_event)) > 0),
  commercial_category text NOT NULL CHECK (commercial_category IN (
    'category_a_first_party', 'category_b_third_party', 'category_c_corporate_treasury'
  )),
  owning_subsystem text NOT NULL CHECK (length(trim(owning_subsystem)) > 0),
  source_object_type text NOT NULL CHECK (length(trim(source_object_type)) > 0),
  payer_role text NOT NULL CHECK (length(trim(payer_role)) > 0),
  contractual_seller text,
  legal_beneficiary text,
  merchant_of_record text,
  funds_owner text,
  revenue_beneficiary text,
  jurisdiction text NOT NULL CHECK (length(trim(jurisdiction)) > 0),
  permitted_currencies text[] NOT NULL DEFAULT '{}',
  price_authority_type text NOT NULL CHECK (price_authority_type IN (
    'fixed_catalogue', 'recurring_tariff', 'usage_metered', 'contract_quotation',
    'invoice_backed', 'deposit_policy', 'statutory_calculation', 'treasury_entry',
    'unapproved_missing'
  )),
  approved_amount_minor bigint CHECK (approved_amount_minor IS NULL OR approved_amount_minor >= 0),
  approved_currency text,
  currency_scale smallint CHECK (currency_scale IS NULL OR currency_scale IN (0, 2, 3)),
  tax_policy_ref text,
  commission_policy_ref text,
  refund_policy text NOT NULL DEFAULT 'non_refundable_until_approved',
  eligible_providers text[] NOT NULL DEFAULT '{}',
  prohibited_providers text[] NOT NULL DEFAULT '{}',
  required_capabilities text[] NOT NULL DEFAULT '{}',
  fulfillment_contract text NOT NULL CHECK (length(trim(fulfillment_contract)) > 0),
  mobile_channel_policy text NOT NULL CHECK (mobile_channel_policy IN (
    'physical_service_exempt', 'digital_web_only_until_iap',
    'b2b_contract_exempt', 'internal_treasury_prohibited'
  )),
  checkout_prohibited boolean NOT NULL DEFAULT false,
  activation_state text NOT NULL DEFAULT 'blocked' CHECK (activation_state IN (
    'draft', 'reviewed', 'commercially_approved', 'provider_eligible',
    'sandbox_certified', 'staging_certified', 'release_approved', 'active',
    'blocked', 'suspended', 'retired'
  )),
  certification_state text NOT NULL CHECK (certification_state IN (
    'IMPLEMENTED', 'PARTIAL', 'CONCEPT ONLY', 'COMMERCIAL TERMS MISSING',
    'PROVIDER BLOCKED', 'SANDBOX READY', 'PHYSICALLY CERTIFIED', 'RELEASE ELIGIBLE'
  )),
  blocker_class text CHECK (blocker_class IS NULL OR blocker_class IN (
    'SOURCE', 'PRODUCT', 'COMMERCIAL', 'PROVIDER', 'LEGAL/POLICY',
    'ENGINEERING', 'ENVIRONMENT', 'CERTIFICATION', 'OWNER AUTHORITY'
  )),
  blocker_reason text,
  approval_evidence_ref text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Category C (Corporate & Treasury) items are strictly forbidden from Checkout and activation.
  CONSTRAINT pay02_category_c_never_checkout CHECK (
    commercial_category <> 'category_c_corporate_treasury'
    OR (checkout_prohibited = true AND activation_state IN ('blocked', 'draft'))
  ),
  -- PAY-02 foundation strictly forbids live activation states without a separate Owner-approved migration.
  CONSTRAINT pay02_no_live_release_in_foundation CHECK (
    activation_state NOT IN ('release_approved', 'active')
  ),
  -- Fail-closed completeness constraint for any approved or provider/sandbox-eligible product.
  CONSTRAINT pay02_eligible_states_require_complete_authority CHECK (
    activation_state NOT IN ('commercially_approved', 'provider_eligible', 'sandbox_certified', 'staging_certified')
    OR (
      contractual_seller IS NOT NULL
      AND legal_beneficiary IS NOT NULL
      AND merchant_of_record IS NOT NULL
      AND funds_owner IS NOT NULL
      AND revenue_beneficiary IS NOT NULL
      AND cardinality(permitted_currencies) > 0
      AND cardinality(eligible_providers) > 0
      AND approval_evidence_ref IS NOT NULL
      AND approved_by IS NOT NULL
      AND price_authority_type <> 'unapproved_missing'
      AND approved_amount_minor IS NOT NULL
      AND approved_currency IS NOT NULL
      AND currency_scale IS NOT NULL
    )
  )
);

-- 2. Append-Only Product Version Audit History
CREATE TABLE IF NOT EXISTS public.pay02_commercial_product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL REFERENCES public.pay02_commercial_products(product_code),
  version integer NOT NULL CHECK (version >= 1),
  snapshot jsonb NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_code, version)
);

CREATE OR REPLACE FUNCTION public.pay02_prevent_version_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'PAY02_PRODUCT_VERSION_HISTORY_IMMUTABLE';
END $$;

DROP TRIGGER IF EXISTS trg_pay02_product_version_immutable ON public.pay02_commercial_product_versions;
CREATE TRIGGER trg_pay02_product_version_immutable
  BEFORE UPDATE OR DELETE ON public.pay02_commercial_product_versions
  FOR EACH ROW EXECUTE FUNCTION public.pay02_prevent_version_history_mutation();

-- 3. Commercial Activation Governance Proposals
CREATE TABLE IF NOT EXISTS public.pay02_activation_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL REFERENCES public.pay02_commercial_products(product_code),
  product_version integer NOT NULL CHECK (product_version >= 1),
  from_state text NOT NULL,
  proposed_state text NOT NULL CHECK (proposed_state IN (
    'draft', 'reviewed', 'commercially_approved', 'provider_eligible',
    'sandbox_certified', 'staging_certified', 'blocked', 'suspended', 'retired'
  )),
  proposed_amount_minor bigint CHECK (proposed_amount_minor IS NULL OR proposed_amount_minor >= 0),
  proposed_currency text,
  approval_evidence_ref text,
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 10),
  proposer_id text NOT NULL CHECK (length(trim(proposer_id)) > 0),
  proposer_role text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  reviewer_id text,
  reviewer_role text,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT pay02_proposal_separation_of_duties CHECK (
    status = 'pending_review'
    OR (reviewer_id IS NOT NULL AND reviewer_id <> proposer_id)
  )
);

-- 4. Immutable Server-Authorized Commercial Quotes
CREATE TABLE IF NOT EXISTS public.pay02_commercial_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL UNIQUE CHECK (quote_number ~ '^QT-PAY02-[A-Z0-9]{16}$'),
  product_code text NOT NULL REFERENCES public.pay02_commercial_products(product_code),
  product_version integer NOT NULL CHECK (product_version >= 1),
  commercial_category text NOT NULL CHECK (commercial_category IN (
    'category_a_first_party', 'category_b_third_party'
  )),
  owning_subsystem text NOT NULL,
  source_object_type text NOT NULL,
  source_object_id text NOT NULL CHECK (length(trim(source_object_id)) > 0),
  payer_id text NOT NULL CHECK (length(trim(payer_id)) > 0),
  payer_role text NOT NULL,
  contractual_seller text NOT NULL,
  legal_beneficiary text NOT NULL,
  merchant_of_record text NOT NULL,
  funds_owner text NOT NULL,
  revenue_beneficiary text NOT NULL,
  jurisdiction text NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  currency_scale smallint NOT NULL CHECK (currency_scale IN (0, 2, 3)),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  platform_fee_minor bigint NOT NULL DEFAULT 0 CHECK (platform_fee_minor >= 0),
  third_party_minor bigint NOT NULL DEFAULT 0 CHECK (third_party_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor > 0 AND total_minor = subtotal_minor + tax_minor),
  pricing_provenance text NOT NULL,
  selected_provider text NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,96}$'),
  payment_reference text UNIQUE REFERENCES public.payment_transactions(reference),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN (
    'issued', 'accepted', 'payment_initiated', 'paid_verified',
    'fulfilled', 'cancelled', 'expired', 'refunded'
  )),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payer_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION public.pay02_guard_quote_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAY02_QUOTE_DELETE_FORBIDDEN';
  END IF;
  IF NEW.quote_number IS DISTINCT FROM OLD.quote_number
     OR NEW.product_code IS DISTINCT FROM OLD.product_code
     OR NEW.product_version IS DISTINCT FROM OLD.product_version
     OR NEW.commercial_category IS DISTINCT FROM OLD.commercial_category
     OR NEW.source_object_type IS DISTINCT FROM OLD.source_object_type
     OR NEW.source_object_id IS DISTINCT FROM OLD.source_object_id
     OR NEW.payer_id IS DISTINCT FROM OLD.payer_id
     OR NEW.contractual_seller IS DISTINCT FROM OLD.contractual_seller
     OR NEW.legal_beneficiary IS DISTINCT FROM OLD.legal_beneficiary
     OR NEW.merchant_of_record IS DISTINCT FROM OLD.merchant_of_record
     OR NEW.funds_owner IS DISTINCT FROM OLD.funds_owner
     OR NEW.revenue_beneficiary IS DISTINCT FROM OLD.revenue_beneficiary
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.currency_scale IS DISTINCT FROM OLD.currency_scale
     OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
     OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor
     OR NEW.platform_fee_minor IS DISTINCT FROM OLD.platform_fee_minor
     OR NEW.third_party_minor IS DISTINCT FROM OLD.third_party_minor
     OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
     OR NEW.selected_provider IS DISTINCT FROM OLD.selected_provider
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'PAY02_QUOTE_ECONOMIC_OR_PARTY_TERMS_IMMUTABLE';
  END IF;
  IF OLD.payment_reference IS NOT NULL AND NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN
    RAISE EXCEPTION 'PAY02_QUOTE_PAYMENT_REFERENCE_IMMUTABLE';
  END IF;
  IF OLD.status = 'refunded' AND NEW.status <> 'refunded' THEN
    RAISE EXCEPTION 'PAY02_QUOTE_STATUS_REGRESSION_REFUSED';
  END IF;
  IF OLD.status IN ('paid_verified', 'fulfilled') AND NEW.status IN ('issued', 'accepted', 'payment_initiated', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'PAY02_QUOTE_STATUS_REGRESSION_REFUSED';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pay02_quote_immutability ON public.pay02_commercial_quotes;
CREATE TRIGGER trg_pay02_quote_immutability
  BEFORE UPDATE OR DELETE ON public.pay02_commercial_quotes
  FOR EACH ROW EXECUTE FUNCTION public.pay02_guard_quote_immutability();

-- 5. Multi-Party Obligation Allocations
CREATE TABLE IF NOT EXISTS public.pay02_obligation_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_reference_type text NOT NULL CHECK (parent_reference_type IN ('import_order', 'marketplace_session', 'garage_invoice')),
  parent_reference_id text NOT NULL CHECK (length(trim(parent_reference_id)) > 0),
  payer_id text NOT NULL CHECK (length(trim(payer_id)) > 0),
  product_code text NOT NULL REFERENCES public.pay02_commercial_products(product_code),
  commercial_category text NOT NULL CHECK (commercial_category IN ('category_a_first_party', 'category_b_third_party')),
  legal_beneficiary text NOT NULL,
  funds_owner text NOT NULL,
  merchant_of_record text,
  is_carup_revenue boolean NOT NULL DEFAULT false,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  currency_scale smallint NOT NULL CHECK (currency_scale IN (0, 2, 3)),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  collection_mode text NOT NULL CHECK (collection_mode IN (
    'direct_carup_merchant', 'regulated_partner_blocked', 'external_declared'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Third-party obligations can NEVER be recorded as CarUp revenue or collected under CarUp Japan direct merchant.
  CONSTRAINT pay02_third_party_never_carup_revenue CHECK (
    (commercial_category = 'category_a_first_party' AND is_carup_revenue = true)
    OR (
      commercial_category = 'category_b_third_party'
      AND is_carup_revenue = false
      AND collection_mode <> 'direct_carup_merchant'
      AND coalesce(merchant_of_record, '') <> 'carup_japan'
    )
  )
);

-- 6. Additive Extension of Canonical `public.payment_transactions` (No Second Money Ledger)
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS pay02_quote_id uuid REFERENCES public.pay02_commercial_quotes(id),
  ADD COLUMN IF NOT EXISTS pay02_product_code text REFERENCES public.pay02_commercial_products(product_code),
  ADD COLUMN IF NOT EXISTS pay02_product_version integer,
  ADD COLUMN IF NOT EXISTS pay02_commercial_category text,
  ADD COLUMN IF NOT EXISTS pay02_funds_owner text,
  ADD COLUMN IF NOT EXISTS pay02_legal_beneficiary text,
  ADD COLUMN IF NOT EXISTS pay02_settlement_status text DEFAULT 'unsettled'
    CHECK (pay02_settlement_status IN ('unsettled', 'settlement_pending', 'settled', 'not_applicable_sandbox', 'reversed'));

CREATE UNIQUE INDEX IF NOT EXISTS pay02_unique_payment_quote
  ON public.payment_transactions (pay02_quote_id)
  WHERE pay02_quote_id IS NOT NULL;

-- 7. Row-Level Security & Least-Privilege Grants
ALTER TABLE public.pay02_commercial_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay02_commercial_product_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay02_activation_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay02_commercial_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay02_obligation_allocations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pay02_commercial_products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pay02_commercial_product_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pay02_activation_proposals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pay02_commercial_quotes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pay02_obligation_allocations FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.pay02_commercial_products TO service_role;
GRANT SELECT, INSERT ON TABLE public.pay02_commercial_product_versions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pay02_activation_proposals TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pay02_commercial_quotes TO service_role;
GRANT SELECT, INSERT ON TABLE public.pay02_obligation_allocations TO service_role;

-- 8. Atomic Server-Authorized Quote & Canonical Payment Convergence RPCs
CREATE OR REPLACE FUNCTION public.pay02_issue_commercial_quote(
  p_quote_number text,
  p_product_code text,
  p_product_version integer,
  p_payer_id text,
  p_payer_role text,
  p_source_object_type text,
  p_source_object_id text,
  p_currency text,
  p_currency_scale integer,
  p_total_minor bigint,
  p_selected_provider text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prod public.pay02_commercial_products%ROWTYPE;
  v_quote public.pay02_commercial_quotes%ROWTYPE;
BEGIN
  IF coalesce(length(trim(p_payer_id)), 0) = 0
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,96}$' THEN
    RAISE EXCEPTION 'PAY02_INVALID_QUOTE_REQUEST';
  END IF;

  SELECT * INTO v_prod FROM public.pay02_commercial_products
    WHERE product_code = p_product_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY02_PRODUCT_UNKNOWN';
  END IF;

  IF v_prod.commercial_category = 'category_c_corporate_treasury'
     OR v_prod.checkout_prohibited = true THEN
    RAISE EXCEPTION 'PAY02_CHECKOUT_PROHIBITED_FOR_PRODUCT';
  END IF;

  IF v_prod.activation_state NOT IN ('commercially_approved', 'provider_eligible', 'sandbox_certified', 'staging_certified') THEN
    RAISE EXCEPTION 'PAY02_PRODUCT_NOT_COMMERCIALLY_ELIGIBLE';
  END IF;

  IF v_prod.current_version <> p_product_version
     OR v_prod.source_object_type <> p_source_object_type
     OR v_prod.approved_currency <> p_currency
     OR v_prod.currency_scale <> p_currency_scale
     OR v_prod.approved_amount_minor <> p_total_minor
     OR NOT (p_selected_provider = ANY(v_prod.eligible_providers))
     OR (p_selected_provider = ANY(v_prod.prohibited_providers)) THEN
    RAISE EXCEPTION 'PAY02_QUOTE_AUTHORITY_MISMATCH';
  END IF;

  INSERT INTO public.pay02_commercial_quotes (
    quote_number, product_code, product_version, commercial_category,
    owning_subsystem, source_object_type, source_object_id,
    payer_id, payer_role, contractual_seller, legal_beneficiary,
    merchant_of_record, funds_owner, revenue_beneficiary,
    jurisdiction, currency, currency_scale,
    subtotal_minor, tax_minor, platform_fee_minor, third_party_minor, total_minor,
    pricing_provenance, selected_provider, idempotency_key,
    status, expires_at
  ) VALUES (
    p_quote_number, v_prod.product_code, v_prod.current_version, v_prod.commercial_category,
    v_prod.owning_subsystem, v_prod.source_object_type, trim(p_source_object_id),
    trim(p_payer_id), trim(p_payer_role), v_prod.contractual_seller, v_prod.legal_beneficiary,
    v_prod.merchant_of_record, v_prod.funds_owner, v_prod.revenue_beneficiary,
    v_prod.jurisdiction, v_prod.approved_currency, v_prod.currency_scale,
    v_prod.approved_amount_minor, 0,
    CASE WHEN v_prod.commercial_category = 'category_a_first_party' THEN v_prod.approved_amount_minor ELSE 0 END,
    CASE WHEN v_prod.commercial_category = 'category_b_third_party' THEN v_prod.approved_amount_minor ELSE 0 END,
    v_prod.approved_amount_minor,
    v_prod.price_authority_type || ':v' || v_prod.current_version || ':' || coalesce(v_prod.approval_evidence_ref, 'none'),
    p_selected_provider, p_idempotency_key,
    'issued', now() + interval '30 minutes'
  )
  ON CONFLICT (payer_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_quote FROM public.pay02_commercial_quotes
    WHERE payer_id = trim(p_payer_id) AND idempotency_key = p_idempotency_key
    FOR UPDATE;
  IF NOT FOUND OR v_quote.product_code <> p_product_code OR v_quote.total_minor <> p_total_minor THEN
    RAISE EXCEPTION 'PAY02_QUOTE_IDEMPOTENCY_CONFLICT';
  END IF;

  RETURN to_jsonb(v_quote);
END $$;

-- Claims a canonical `public.payment_transactions` row for an issued PAY-02 quote without creating a second money ledger.
CREATE OR REPLACE FUNCTION public.pay02_claim_quote_checkout(
  p_quote_id uuid,
  p_actor_id text,
  p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_quote public.pay02_commercial_quotes%ROWTYPE;
  v_payment public.payment_transactions%ROWTYPE;
BEGIN
  IF p_quote_id IS NULL OR coalesce(length(trim(p_actor_id)), 0) = 0
     OR p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{16,96}$' THEN
    RAISE EXCEPTION 'PAY02_INVALID_CHECKOUT_CLAIM';
  END IF;

  SELECT * INTO v_quote FROM public.pay02_commercial_quotes
    WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.payer_id <> trim(p_actor_id) THEN
    RAISE EXCEPTION 'PAY02_QUOTE_OWNERSHIP_REFUSED';
  END IF;
  IF v_quote.status IN ('cancelled', 'expired', 'refunded') OR v_quote.expires_at <= now() THEN
    RAISE EXCEPTION 'PAY02_QUOTE_EXPIRED_OR_CLOSED';
  END IF;
  IF v_quote.selected_provider <> 'stripe_carup_japan_sandbox'
     OR v_quote.merchant_of_record <> 'carup_japan'
     OR v_quote.currency <> 'JPY'
     OR v_quote.total_minor <> 100 THEN
    RAISE EXCEPTION 'PAY02_PROVIDER_NOT_ELIGIBLE_FOR_SANDBOX_CLAIM';
  END IF;

  INSERT INTO public.payment_transactions (
    gateway, amount, currency, reference, status,
    pay01a_actor_id, pay01a_request_key, pay01a_account_id,
    pay02_quote_id, pay02_product_code, pay02_product_version,
    pay02_commercial_category, pay02_funds_owner, pay02_legal_beneficiary,
    pay02_settlement_status
  ) VALUES (
    'stripe_carup_japan_sandbox', v_quote.total_minor, v_quote.currency,
    'pay01a_' || gen_random_uuid()::text, 'pending',
    v_quote.payer_id, p_request_key, 'acct_1UVnGaEjgXqvlsJk',
    v_quote.id, v_quote.product_code, v_quote.product_version,
    v_quote.commercial_category, v_quote.funds_owner, v_quote.legal_beneficiary,
    'not_applicable_sandbox'
  )
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_payment FROM public.payment_transactions
    WHERE gateway = 'stripe_carup_japan_sandbox'
      AND pay01a_actor_id = v_quote.payer_id
      AND pay01a_request_key = p_request_key
    FOR UPDATE;
  IF NOT FOUND OR v_payment.pay02_quote_id IS DISTINCT FROM v_quote.id THEN
    RAISE EXCEPTION 'PAY02_CANONICAL_PAYMENT_CLAIM_CONFLICT';
  END IF;

  IF v_quote.payment_reference IS NULL THEN
    UPDATE public.pay02_commercial_quotes
      SET payment_reference = v_payment.reference,
          status = 'payment_initiated',
          accepted_at = coalesce(accepted_at, now()),
          updated_at = now()
      WHERE id = v_quote.id
      RETURNING * INTO v_quote;
  END IF;

  RETURN to_jsonb(v_payment) || jsonb_build_object(
    'pay02_quote_id', v_quote.id,
    'quote_number', v_quote.quote_number,
    'quote_status', v_quote.status
  );
END $$;

-- Synchronizes quote state strictly from the verified canonical `public.payment_transactions` row.
CREATE OR REPLACE FUNCTION public.pay02_sync_quote_from_canonical_payment(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_payment public.payment_transactions%ROWTYPE;
  v_quote public.pay02_commercial_quotes%ROWTYPE;
  v_target_status text;
BEGIN
  SELECT * INTO v_payment FROM public.payment_transactions
    WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY02_CANONICAL_PAYMENT_NOT_FOUND';
  END IF;

  SELECT * INTO v_quote FROM public.pay02_commercial_quotes
    WHERE payment_reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_payment.pay01a_actor_id IS DISTINCT FROM v_quote.payer_id
     OR v_payment.amount <> v_quote.total_minor
     OR v_payment.currency <> v_quote.currency THEN
    RAISE EXCEPTION 'PAY02_CANONICAL_QUOTE_RECONCILIATION_MISMATCH';
  END IF;

  IF v_payment.status = 'paid' THEN
    IF v_payment.pay01a_checkout_id IS NULL OR v_payment.pay01a_intent_id IS NULL THEN
      RAISE EXCEPTION 'PAY02_PAID_REQUIRES_PROVIDER_EVIDENCE';
    END IF;
    v_target_status := CASE WHEN v_quote.status = 'fulfilled' THEN 'fulfilled' ELSE 'paid_verified' END;
  ELSIF v_payment.status = 'refunded' THEN
    v_target_status := 'refunded';
  ELSIF v_payment.status = 'cancelled' THEN
    v_target_status := 'cancelled';
  ELSE
    v_target_status := v_quote.status;
  END IF;

  IF v_target_status IS DISTINCT FROM v_quote.status THEN
    UPDATE public.pay02_commercial_quotes
      SET status = v_target_status, updated_at = now()
      WHERE id = v_quote.id
      RETURNING * INTO v_quote;
  END IF;

  RETURN jsonb_build_object(
    'quote_id', v_quote.id,
    'quote_number', v_quote.quote_number,
    'quote_status', v_quote.status,
    'payment_reference', v_payment.reference,
    'payment_status', v_payment.status
  );
END $$;

REVOKE ALL ON FUNCTION public.pay02_issue_commercial_quote(text,text,integer,text,text,text,text,text,integer,bigint,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay02_claim_quote_checkout(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay02_sync_quote_from_canonical_payment(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pay02_issue_commercial_quote(text,text,integer,text,text,text,text,text,integer,bigint,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay02_claim_quote_checkout(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay02_sync_quote_from_canonical_payment(text) TO service_role;

-- 9. Seed Controlling Commercial Catalogue Foundations across Mandatory Families
INSERT INTO public.pay02_commercial_products (
  product_code, current_version, family, title, commercial_event, commercial_category,
  owning_subsystem, source_object_type, payer_role, contractual_seller, legal_beneficiary,
  merchant_of_record, funds_owner, revenue_beneficiary, jurisdiction, permitted_currencies,
  price_authority_type, approved_amount_minor, approved_currency, currency_scale,
  tax_policy_ref, commission_policy_ref, refund_policy, eligible_providers, prohibited_providers,
  required_capabilities, fulfillment_contract, mobile_channel_policy, checkout_prohibited,
  activation_state, certification_state, blocker_class, blocker_reason, approval_evidence_ref, approved_by
) VALUES
  (
    'intel.report.demo_sandbox', 1, 'intelligence',
    'CarUp Vehicle History Report — Demo Edition (Sandbox Only)',
    'sandbox_synthetic_demo_report_purchase', 'category_a_first_party',
    'pay01c_demo_sandbox', 'pay01c_demo_orders', 'buyer',
    'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan',
    'JP', ARRAY['JPY'], 'fixed_catalogue', 100, 'JPY', 0,
    'sandbox_test_only_no_tax_claim', 'none_first_party',
    'full_admin_sandbox_refund_revokes_entitlement',
    ARRAY['stripe_carup_japan_sandbox'], ARRAY['paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY['collect_payment', 'refund', 'retrieve_status', 'webhook_verify', 'webhook_replay_resistant'],
    'pay01c_sync_demo_entitlement', 'digital_web_only_until_iap', false,
    'sandbox_certified', 'PHYSICALLY CERTIFIED', 'OWNER AUTHORITY',
    'Test-only synthetic demonstration (JPY 100). Never eligible for live commercial release.',
    'PR#248-61014be1127fada3e69f7169d0999352fd3584fe', 'owner_sandbox_authority'
  ),
  (
    'intel.report.vehicle_history_single', 1, 'intelligence',
    'CarUp Canonical Vehicle History & Provenance Report (Single VIN)',
    'buyer_vehicle_history_report_purchase', 'category_a_first_party',
    'vehicle_history_reports', 'vehicle_report_versions', 'buyer',
    'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan',
    'JP', ARRAY['JPY'], 'fixed_catalogue', 100, 'JPY', 0,
    'jct_pending_owner_commercial_signoff', 'none_first_party',
    'full_refund_revokes_report_entitlement_and_share_links',
    ARRAY['stripe_carup_japan_sandbox'], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund', 'retrieve_status', 'webhook_verify', 'webhook_replay_resistant'],
    'pay02_grant_vehicle_report_entitlement', 'digital_web_only_until_iap', false,
    'provider_eligible', 'SANDBOX READY', 'COMMERCIAL',
    'Selected PAY-02-PILOT candidate; uses JPY 100 sandbox fixture for test verification while commercial retail price awaits Owner approval.',
    'ISSUE-247-PAY02-PILOT-SANDBOX-FIXTURE', 'pay02_moderator_sandbox_fixture'
  ),
  (
    'mkt.vehicle_sale.principal', 1, 'marketplace',
    'Marketplace Vehicle Purchase Principal',
    'buyer_vehicle_purchase_settlement', 'category_b_third_party',
    'marketplace_safetrade', 'escrow_trust_sessions', 'buyer',
    'vehicle_seller_or_dealer', 'vehicle_seller_or_dealer', NULL,
    'buyer_until_release_then_seller', 'vehicle_seller_or_dealer',
    'ZW', ARRAY['USD'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL, 'governed_by_safetrade_dispute_and_escrow_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY['regulated_escrow', 'delayed_release', 'payout_to_seller'],
    'passport_ownership_transfer_after_regulated_settlement', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'PROVIDER',
    'Requires licensed escrow/settlement provider with delayed release and seller payout authority in ZW (PAY-08).',
    NULL, NULL
  ),
  (
    'mkt.reservation.deposit', 1, 'marketplace',
    'Marketplace Vehicle Reservation Deposit',
    'buyer_vehicle_reservation_deposit', 'category_b_third_party',
    'marketplace_safetrade', 'vehicle_reservations', 'buyer',
    'vehicle_seller_or_dealer', 'vehicle_seller_or_buyer_refundable', NULL,
    'buyer_custodial_deposit', 'not_carup_operating_revenue',
    'ZW', ARRAY['USD'], 'deposit_policy', NULL, 'USD', 2,
    NULL, NULL, 'refundable_on_reservation_cancellation_or_failed_inspection_per_policy',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY['authorize_hold', 'capture', 'refund', 'regulated_escrow'],
    'issue164_record_deposit_payment_event_atomic', 'physical_service_exempt', false,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Requires licensed ZW deposit/escrow provider and Owner commercial approval (PAY-05/PAY-08).',
    NULL, NULL
  ),
  (
    'sub.diaspora.buyer_pro', 1, 'subscriptions',
    'Diaspora Buyer Plan Subscription',
    'diaspora_buyer_subscription_renewal', 'category_a_first_party',
    'diaspora_billing', 'diaspora_subscriptions', 'diaspora_buyer',
    'carup', 'carup', 'carup_japan', 'carup', 'carup',
    'JP', ARRAY['JPY', 'USD'], 'unapproved_missing', NULL, NULL, 0,
    NULL, 'none_first_party', 'cancel_at_period_end_or_governed_admin_refund',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund', 'webhook_verify', 'webhook_replay_resistant'],
    'syncSubscriptionFromSnapshot', 'digital_web_only_until_iap', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Entitlement sync exists (`PLAN_CATALOG.diaspora_buyer`); recurring tariff awaits Owner approval (PAY-03).',
    NULL, NULL
  ),
  (
    'gar.invoice.customer_payment', 1, 'garage',
    'Garage 1.0 Customer Service Invoice Payment',
    'garage_invoice_payment', 'category_b_third_party',
    'garage_ops07', 'garage_invoices', 'vehicle_owner_customer',
    'garage_business_tenant', 'garage_business_tenant', NULL,
    'garage_business_tenant', 'garage_business_tenant',
    'ZW', ARRAY['USD', 'ZWG'], 'invoice_backed', NULL, NULL, 2,
    'garage_tenant_invoice_tax_lines', NULL, 'garage_tenant_invoice_adjustment_policy',
    ARRAY['garage_recorded_external'], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY['collect_payment'], 'garage_ops07_invoice_allocation_and_receipt',
    'physical_service_exempt', false,
    'blocked', 'IMPLEMENTED', 'PROVIDER',
    'Off-platform external recording (`source=garage_recorded_external`) is IMPLEMENTED; gateway collection awaits PAY-04.',
    'GARAGE-1.0-CUTOVER-01-69e12e219-EXTERNAL-ONLY', 'owner_garage_1_0_authority'
  ),
  (
    'imp.vehicle.supplier_principal', 1, 'imports_trade',
    'Foreign Vehicle Supplier Purchase Principal (FOB/CIF)',
    'import_supplier_vehicle_principal', 'category_b_third_party',
    'diaspora_trade_os', 'diaspora_import_orders', 'importer_buyer',
    'foreign_vehicle_exporter_supplier', 'foreign_vehicle_exporter_supplier', NULL,
    'foreign_vehicle_exporter_supplier', 'foreign_vehicle_exporter_supplier',
    'JP', ARRAY['JPY', 'USD', 'GBP'], 'contract_quotation', NULL, NULL, 0,
    'export_zero_rated_or_supplier_invoice', 'separate_carup_fee_component',
    'governed_by_supplier_proforma_and_safetrade_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY['regulated_escrow', 'payout_to_seller'],
    'diaspora_supplier_principal_milestone_verification', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'PROVIDER',
    'Third-party exporter principal (`cost_stage=GOODS`) must never be collected as CarUp first-party revenue (PAY-06).',
    NULL, NULL
  ),
  (
    'imp.sourcing.verification_fee', 1, 'imports_trade',
    'CarUp Export Vehicle Sourcing & Pre-Shipment Verification Fee',
    'carup_export_sourcing_service_fee', 'category_a_first_party',
    'diaspora_trade_os', 'diaspora_trade_charge_components', 'importer_buyer',
    'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan',
    'JP', ARRAY['JPY', 'USD'], 'unapproved_missing', NULL, NULL, 0,
    NULL, 'none_first_party', 'refundable_before_origin_inspection_execution',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'], 'diaspora_carup_service_fee_acknowledgment',
    'physical_service_exempt', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'CarUp first-party import service fee (`cost_stage=CARUP`, `revenue_class=CARUP_SERVICE_FEE`), pending Owner tariff approval.',
    NULL, NULL
  ),
  (
    'imp.customs.duties_and_taxes', 1, 'imports_trade',
    'ZIMRA & Destination Customs Duties, Excise, VAT & Surtax',
    'customs_statutory_duty_settlement', 'category_b_third_party',
    'diaspora_customs_t12', 'diaspora_customs_declarations', 'importer_buyer',
    'statutory_customs_authority_zimra', 'statutory_customs_authority_zimra', NULL,
    'statutory_customs_authority_zimra', 'statutory_customs_authority_zimra',
    'ZW', ARRAY['USD', 'ZWG'], 'statutory_calculation', NULL, NULL, 2,
    'zimra_customs_assessment_notice', 'none_statutory_pass_through',
    'statutory_customs_rebate_or_appeal_only',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[], 't12_customs_clearance_receipt_verification', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Statutory government duties belong to ZIMRA and must never be collected as CarUp merchant sales.',
    NULL, NULL
  ),
  (
    'ins.policy.motor_premium', 1, 'insurance',
    'Motor Vehicle Insurance Policy Premium (ZINARA/Third-Party/Comprehensive)',
    'motor_insurance_policy_premium_collection', 'category_b_third_party',
    'insurance_provider_platform', 'insurance_policies', 'policyholder_vehicle_owner',
    'licensed_insurer_provider', 'licensed_insurer_provider', NULL,
    'licensed_insurer_provider', 'licensed_insurer_provider',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    'statutory_stamp_duty_and_insurance_levy', 'requires_licensed_broker_or_introducer_agreement',
    'insurer_policy_cancellation_schedule',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[], 'insurer_bound_policy_certificate', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Requires signed insurer contract in `provider_registry` (`capability_type=insurance`) (PAY-07).',
    NULL, NULL
  ),
  (
    'fin.loan.principal_disbursement', 1, 'banking_finance',
    'Lender Vehicle, Import or Dealer Inventory Loan Disbursement',
    'lender_loan_principal_disbursement', 'category_b_third_party',
    'finance_provider_platform', 'finance_applications', 'licensed_bank_or_lender',
    'vehicle_seller_or_dealer', 'vehicle_seller_or_dealer', NULL,
    'licensed_bank_or_lender', 'vehicle_seller_or_dealer',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL, 'not_applicable_lender_disbursement',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[], 'issue164_finance_decision_and_disbursement_evidence',
    'internal_treasury_prohibited', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Requires verified bank/lender disbursement evidence (PAY-07).',
    NULL, NULL
  ),
  (
    'corp.ap.infrastructure_cloud', 1, 'corporate_finance',
    'Cloud, Database, Edge Hosting & AI Model Usage Payables',
    'corporate_vendor_payable_settlement', 'category_c_corporate_treasury',
    'corporate_admin_finance', 'organizations', 'carup_corporate_treasury',
    'cloud_or_ai_infrastructure_vendor', 'cloud_or_ai_infrastructure_vendor', NULL,
    'carup_corporate_treasury', 'not_revenue_corporate_expense',
    'GLOBAL', ARRAY['USD', 'JPY'], 'invoice_backed', NULL, NULL, 2,
    'reverse_charge_or_vendor_tax_invoice', NULL, 'vendor_sla_credit_only',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[], 'corporate_ap_invoice_approval_and_reconciliation',
    'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Category C corporate payable; strictly prohibited from customer Checkout (PAY-09).',
    NULL, NULL
  ),
  (
    'cap.equity.founder_contribution', 1, 'capital_treasury',
    'Founder & Shareholder Equity Capital Contribution',
    'equity_capital_contribution', 'category_c_corporate_treasury',
    'corporate_treasury', 'organizations', 'founder_or_shareholder',
    'carup_corporate_entity', 'carup_corporate_treasury', NULL,
    'carup_corporate_treasury', 'not_revenue_balance_sheet_equity',
    'GLOBAL', ARRAY['USD', 'JPY'], 'treasury_entry', NULL, NULL, 2,
    'capital_contribution_non_operating', NULL, 'prohibited_capital_movement',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[], 'board_resolution_and_bank_treasury_receipt',
    'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'OWNER AUTHORITY',
    'Category C capital contribution; strictly prohibited from product Checkout and operating revenue reports (PAY-09).',
    NULL, NULL
  )
ON CONFLICT (product_code) DO NOTHING;

INSERT INTO public.pay02_commercial_product_versions (product_code, version, snapshot, recorded_by)
SELECT product_code, current_version, to_jsonb(pay02_commercial_products.*), 'pay02_initial_seed'
FROM public.pay02_commercial_products
ON CONFLICT (product_code, version) DO NOTHING;

COMMIT;

-- +migrate Down
-- PAY-02 preserves all commercial quote, governance, and canonical payment audit evidence.
-- Automatic destructive rollback is refused; requires a separately reviewed data-retention plan.
DO $$ BEGIN RAISE EXCEPTION 'PAY02_RETAIN_COMMERCIAL_AUTHORITY_AND_AUDIT_EVIDENCE'; END $$;
