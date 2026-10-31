-- +migrate Up
-- CARUP-PAY-02 — Unified Commercial Service Catalogue, Quote Authority & Canonical Payment Convergence (R1)
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

-- 1. Versioned Commercial Product Registry (All 66 Catalogue Definitions)
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
  approved_amount_minor bigint CHECK (
    approved_amount_minor IS NULL
    OR (approved_amount_minor >= 0 AND approved_amount_minor <= 9000000000000000)
  ),
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

CREATE OR REPLACE FUNCTION public.pay02_guard_product_identity_and_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAY02_PRODUCT_DELETE_FORBIDDEN';
  END IF;
  IF NEW.product_code IS DISTINCT FROM OLD.product_code
     OR NEW.commercial_category IS DISTINCT FROM OLD.commercial_category
     OR NEW.family IS DISTINCT FROM OLD.family THEN
    RAISE EXCEPTION 'PAY02_PRODUCT_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.current_version < OLD.current_version THEN
    RAISE EXCEPTION 'PAY02_PRODUCT_VERSION_REGRESSION_REFUSED';
  END IF;
  IF (
       NEW.approved_amount_minor IS DISTINCT FROM OLD.approved_amount_minor
       OR NEW.approved_currency IS DISTINCT FROM OLD.approved_currency
       OR NEW.price_authority_type IS DISTINCT FROM OLD.price_authority_type
       OR NEW.activation_state IS DISTINCT FROM OLD.activation_state
     )
     AND NEW.current_version <= OLD.current_version THEN
    RAISE EXCEPTION 'PAY02_COMMERCIAL_TERM_CHANGE_REQUIRES_NEW_VERSION';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pay02_product_identity_immutable ON public.pay02_commercial_products;
CREATE TRIGGER trg_pay02_product_identity_immutable
  BEFORE UPDATE OR DELETE ON public.pay02_commercial_products
  FOR EACH ROW EXECUTE FUNCTION public.pay02_guard_product_identity_and_version();

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
  proposed_amount_minor bigint CHECK (
    proposed_amount_minor IS NULL
    OR (proposed_amount_minor >= 0 AND proposed_amount_minor <= 9000000000000000)
  ),
  proposed_currency text,
  approval_evidence_ref text,
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 10),
  proposer_id text NOT NULL CHECK (length(trim(proposer_id)) > 0),
  proposer_role text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  resulting_version integer,
  effect_status text NOT NULL DEFAULT 'pending_review' CHECK (effect_status IN (
    'pending_review', 'effective_in_sandbox_catalogue', 'rejected_no_state_change'
  )),
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

CREATE OR REPLACE FUNCTION public.pay02_guard_proposal_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAY02_PROPOSAL_DELETE_FORBIDDEN';
  END IF;
  IF OLD.status <> 'pending_review' THEN
    RAISE EXCEPTION 'PAY02_PROPOSAL_ALREADY_DECIDED';
  END IF;
  IF NEW.product_code IS DISTINCT FROM OLD.product_code
     OR NEW.product_version IS DISTINCT FROM OLD.product_version
     OR NEW.from_state IS DISTINCT FROM OLD.from_state
     OR NEW.proposed_state IS DISTINCT FROM OLD.proposed_state
     OR NEW.proposer_id IS DISTINCT FROM OLD.proposer_id THEN
    RAISE EXCEPTION 'PAY02_PROPOSAL_CORE_TERMS_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pay02_proposal_immutability ON public.pay02_activation_proposals;
CREATE TRIGGER trg_pay02_proposal_immutability
  BEFORE UPDATE OR DELETE ON public.pay02_activation_proposals
  FOR EACH ROW EXECUTE FUNCTION public.pay02_guard_proposal_mutation();

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
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0 AND subtotal_minor <= 9000000000000000),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0 AND tax_minor <= 9000000000000000),
  platform_fee_minor bigint NOT NULL DEFAULT 0 CHECK (platform_fee_minor >= 0 AND platform_fee_minor <= 9000000000000000),
  third_party_minor bigint NOT NULL DEFAULT 0 CHECK (third_party_minor >= 0 AND third_party_minor <= 9000000000000000),
  total_minor bigint NOT NULL CHECK (
    total_minor > 0
    AND total_minor <= 9000000000000000
    AND total_minor = subtotal_minor + tax_minor
  ),
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

-- 5. First Real Product Order & Entitlement Authority (`intel.report.vehicle_history_single`)
-- Separates: (a) pre-purchase vehicle/VIN in `public.vehicles`, (b) paid report order in `public.pay02_report_orders`,
-- and (c) generated report snapshot in `public.report_versions` created only after provider-verified payment.
CREATE TABLE IF NOT EXISTS public.pay02_report_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL DEFAULT 'intel.report.vehicle_history_single'
    REFERENCES public.pay02_commercial_products(product_code),
  product_version integer NOT NULL CHECK (product_version >= 1),
  buyer_id text NOT NULL CHECK (length(trim(buyer_id)) > 0),
  quote_id uuid NOT NULL UNIQUE REFERENCES public.pay02_commercial_quotes(id),
  vehicle_id text NOT NULL CHECK (length(trim(vehicle_id)) > 0),
  vin text NOT NULL CHECK (length(trim(vin)) > 0),
  payment_reference text NOT NULL UNIQUE REFERENCES public.payment_transactions(reference),
  entitlement_status text NOT NULL DEFAULT 'awaiting_payment' CHECK (entitlement_status IN (
    'awaiting_payment', 'entitled', 'refund_suspended', 'revoked_refunded', 'expired'
  )),
  report_version_id uuid,
  report_version_number integer,
  report_content_hash text,
  completeness_summary jsonb,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.pay02_guard_report_order_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAY02_REPORT_ORDER_DELETE_FORBIDDEN';
  END IF;
  IF NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.vin IS DISTINCT FROM OLD.vin
     OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN
    RAISE EXCEPTION 'PAY02_REPORT_ORDER_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.report_version_id IS NOT NULL AND NEW.report_version_id IS DISTINCT FROM OLD.report_version_id THEN
    RAISE EXCEPTION 'PAY02_REPORT_VERSION_BINDING_IMMUTABLE';
  END IF;
  IF OLD.entitlement_status = 'revoked_refunded' AND NEW.entitlement_status <> 'revoked_refunded' THEN
    RAISE EXCEPTION 'PAY02_REVOKED_REPORT_ORDER_CANNOT_REOPEN';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pay02_report_order_immutability ON public.pay02_report_orders;
CREATE TRIGGER trg_pay02_report_order_immutability
  BEFORE UPDATE OR DELETE ON public.pay02_report_orders
  FOR EACH ROW EXECUTE FUNCTION public.pay02_guard_report_order_mutation();

-- 6. Multi-Party Obligation Allocations
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
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 9000000000000000),
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

-- 7. Additive Extension of Canonical `public.payment_transactions` (No Second Money Ledger)
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

-- 8. Row-Level Security & Least-Privilege Grants
ALTER TABLE public.pay02_commercial_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay02_commercial_product_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay02_activation_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay02_commercial_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay02_report_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay02_obligation_allocations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pay02_commercial_products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pay02_commercial_product_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pay02_activation_proposals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pay02_commercial_quotes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pay02_report_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pay02_obligation_allocations FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.pay02_commercial_products TO service_role;
GRANT SELECT, INSERT ON TABLE public.pay02_commercial_product_versions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pay02_activation_proposals TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pay02_commercial_quotes TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pay02_report_orders TO service_role;
GRANT SELECT, INSERT ON TABLE public.pay02_obligation_allocations TO service_role;

-- 9. Atomic Governance Proposal Review & Version Transition RPC (R1-C)
CREATE OR REPLACE FUNCTION public.pay02_review_activation_proposal(
  p_proposal_id uuid,
  p_reviewer_id text,
  p_reviewer_role text,
  p_decision text,
  p_review_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prop public.pay02_activation_proposals%ROWTYPE;
  v_prod public.pay02_commercial_products%ROWTYPE;
  v_next_version integer;
BEGIN
  IF p_proposal_id IS NULL OR coalesce(length(trim(p_reviewer_id)), 0) = 0 THEN
    RAISE EXCEPTION 'PAY02_GOVERNANCE_AUTH_REQUIRED';
  END IF;
  IF lower(coalesce(p_reviewer_role, '')) NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'PAY02_GOVERNANCE_REVIEW_ROLE_FORBIDDEN';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'PAY02_INVALID_REVIEW_DECISION';
  END IF;

  SELECT * INTO v_prop FROM public.pay02_activation_proposals
    WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY02_PROPOSAL_NOT_FOUND';
  END IF;
  IF v_prop.status <> 'pending_review' THEN
    RAISE EXCEPTION 'PAY02_PROPOSAL_ALREADY_DECIDED';
  END IF;
  IF v_prop.proposer_id = trim(p_reviewer_id) THEN
    RAISE EXCEPTION 'PAY02_SELF_APPROVAL_FORBIDDEN';
  END IF;
  IF v_prop.proposed_state IN ('release_approved', 'active') THEN
    RAISE EXCEPTION 'PAY02_LIVE_RELEASE_REQUIRES_SEPARATE_OWNER_AUTHORITY';
  END IF;

  SELECT * INTO v_prod FROM public.pay02_commercial_products
    WHERE product_code = v_prop.product_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY02_PRODUCT_UNKNOWN';
  END IF;
  IF v_prod.current_version <> v_prop.product_version
     OR v_prod.activation_state <> v_prop.from_state THEN
    RAISE EXCEPTION 'PAY02_STALE_PROPOSAL_VERSION_CONFLICT';
  END IF;

  IF p_decision = 'rejected' THEN
    UPDATE public.pay02_activation_proposals
      SET status = 'rejected',
          effect_status = 'rejected_no_state_change',
          reviewer_id = trim(p_reviewer_id),
          reviewer_role = lower(trim(p_reviewer_role)),
          review_notes = nullif(trim(coalesce(p_review_notes, '')), ''),
          reviewed_at = now()
      WHERE id = v_prop.id
      RETURNING * INTO v_prop;
    RETURN to_jsonb(v_prop);
  END IF;

  -- Approval path: verify structured approval evidence reference for quote-eligible states
  IF v_prop.proposed_state IN ('commercially_approved', 'provider_eligible', 'sandbox_certified', 'staging_certified') THEN
    IF coalesce(v_prop.approval_evidence_ref, v_prod.approval_evidence_ref, '') !~ '^(ISSUE-[0-9]+|PR#[0-9]+|OWNER-AUTH|GARAGE-1\.0)[A-Za-z0-9_#-]{4,96}$' THEN
      RAISE EXCEPTION 'PAY02_STRUCTURED_APPROVAL_EVIDENCE_REQUIRED';
    END IF;
  END IF;

  v_next_version := v_prod.current_version + 1;

  UPDATE public.pay02_commercial_products
    SET current_version = v_next_version,
        activation_state = v_prop.proposed_state,
        approved_amount_minor = coalesce(v_prop.proposed_amount_minor, approved_amount_minor),
        approved_currency = coalesce(v_prop.proposed_currency, approved_currency),
        price_authority_type = CASE
          WHEN v_prop.proposed_amount_minor IS NOT NULL AND price_authority_type = 'unapproved_missing'
          THEN 'fixed_catalogue'
          ELSE price_authority_type
        END,
        approval_evidence_ref = coalesce(v_prop.approval_evidence_ref, approval_evidence_ref),
        approved_by = trim(p_reviewer_id),
        approved_at = now(),
        updated_at = now()
    WHERE product_code = v_prod.product_code
    RETURNING * INTO v_prod;

  INSERT INTO public.pay02_commercial_product_versions (product_code, version, snapshot, recorded_by)
    VALUES (v_prod.product_code, v_next_version, to_jsonb(v_prod), trim(p_reviewer_id));

  UPDATE public.pay02_activation_proposals
    SET status = 'approved',
        resulting_version = v_next_version,
        effect_status = 'effective_in_sandbox_catalogue',
        reviewer_id = trim(p_reviewer_id),
        reviewer_role = lower(trim(p_reviewer_role)),
        review_notes = nullif(trim(coalesce(p_review_notes, '')), ''),
        reviewed_at = now()
    WHERE id = v_prop.id
    RETURNING * INTO v_prop;

  RETURN to_jsonb(v_prop) || jsonb_build_object(
    'effective_product_version', v_prod.current_version,
    'effective_activation_state', v_prod.activation_state,
    'effective_amount_minor', v_prod.approved_amount_minor,
    'effective_currency', v_prod.approved_currency,
    'live_commercial_active', false
  );
END $$;

-- 10. Atomic Server-Authorized Quote & Canonical Payment Convergence RPCs (R1-B & R1-E)
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
  v_inserted_id uuid;
BEGIN
  IF coalesce(length(trim(p_payer_id)), 0) = 0
     OR coalesce(length(trim(p_source_object_id)), 0) = 0
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,96}$' THEN
    RAISE EXCEPTION 'PAY02_INVALID_QUOTE_REQUEST';
  END IF;

  IF p_total_minor <= 0 OR p_total_minor > 9000000000000000 THEN
    RAISE EXCEPTION 'PAY02_AMOUNT_OUT_OF_SAFE_BOUNDS';
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

  IF v_prod.activation_state IN ('retired', 'suspended', 'blocked', 'draft', 'reviewed')
     OR v_prod.activation_state NOT IN ('commercially_approved', 'provider_eligible', 'sandbox_certified', 'staging_certified') THEN
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
    CASE WHEN v_prod.product_code IN ('imp.sourcing.verification_fee', 'mkt.sourcing.concierge_fee') THEN v_prod.approved_amount_minor ELSE 0 END,
    CASE WHEN v_prod.commercial_category = 'category_b_third_party' THEN v_prod.approved_amount_minor ELSE 0 END,
    v_prod.approved_amount_minor,
    v_prod.price_authority_type || ':v' || v_prod.current_version || ':' || coalesce(v_prod.approval_evidence_ref, 'none'),
    p_selected_provider, p_idempotency_key,
    'issued', now() + interval '30 minutes'
  )
  ON CONFLICT (payer_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;

  SELECT * INTO v_quote FROM public.pay02_commercial_quotes
    WHERE payer_id = trim(p_payer_id) AND idempotency_key = p_idempotency_key
    FOR UPDATE;
  IF NOT FOUND
     OR v_quote.product_code <> p_product_code
     OR v_quote.product_version <> p_product_version
     OR v_quote.source_object_type <> p_source_object_type
     OR v_quote.source_object_id <> trim(p_source_object_id)
     OR v_quote.currency <> p_currency
     OR v_quote.total_minor <> p_total_minor
     OR v_quote.selected_provider <> p_selected_provider THEN
    RAISE EXCEPTION 'PAY02_QUOTE_IDEMPOTENCY_CONFLICT';
  END IF;

  RETURN to_jsonb(v_quote) || jsonb_build_object(
    'idempotent_replay', (v_inserted_id IS NULL)
  );
END $$;

-- Claims a canonical `public.payment_transactions` row (and for `intel.report.vehicle_history_single`,
-- a `public.pay02_report_orders` row) for an issued PAY-02 quote without creating a second money ledger.
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
  v_report_order public.pay02_report_orders%ROWTYPE;
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

  IF v_quote.product_code = 'intel.report.vehicle_history_single' THEN
    INSERT INTO public.pay02_report_orders (
      product_code, product_version, buyer_id, quote_id,
      vehicle_id, vin, payment_reference, entitlement_status
    ) VALUES (
      v_quote.product_code, v_quote.product_version, v_quote.payer_id, v_quote.id,
      v_quote.source_object_id, v_quote.source_object_id, v_payment.reference, 'awaiting_payment'
    )
    ON CONFLICT (quote_id) DO NOTHING;

    SELECT * INTO v_report_order FROM public.pay02_report_orders
      WHERE quote_id = v_quote.id FOR UPDATE;
  END IF;

  RETURN to_jsonb(v_payment) || jsonb_build_object(
    'pay02_quote_id', v_quote.id,
    'quote_number', v_quote.quote_number,
    'quote_status', v_quote.status,
    'pay02_report_order_id', v_report_order.id
  );
END $$;

-- Synchronizes quote state and report-order entitlement strictly from the verified canonical `public.payment_transactions` row.
CREATE OR REPLACE FUNCTION public.pay02_sync_quote_from_canonical_payment(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_payment public.payment_transactions%ROWTYPE;
  v_quote public.pay02_commercial_quotes%ROWTYPE;
  v_report_order public.pay02_report_orders%ROWTYPE;
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
     OR v_payment.currency <> v_quote.currency
     OR v_payment.pay02_quote_id IS DISTINCT FROM v_quote.id THEN
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

  IF v_quote.product_code = 'intel.report.vehicle_history_single' THEN
    SELECT * INTO v_report_order FROM public.pay02_report_orders
      WHERE quote_id = v_quote.id AND payment_reference = v_payment.reference
      FOR UPDATE;
    IF FOUND THEN
      IF v_payment.status = 'paid' AND v_report_order.entitlement_status <> 'revoked_refunded' THEN
        UPDATE public.pay02_report_orders
          SET entitlement_status = 'entitled',
              granted_at = coalesce(granted_at, now()),
              updated_at = now()
          WHERE id = v_report_order.id
          RETURNING * INTO v_report_order;
      ELSIF v_payment.status = 'refund_pending' AND v_report_order.entitlement_status <> 'revoked_refunded' THEN
        UPDATE public.pay02_report_orders
          SET entitlement_status = 'refund_suspended',
              updated_at = now()
          WHERE id = v_report_order.id
          RETURNING * INTO v_report_order;
      ELSIF v_payment.status = 'refunded' THEN
        UPDATE public.pay02_report_orders
          SET entitlement_status = 'revoked_refunded',
              revoked_at = coalesce(revoked_at, now()),
              updated_at = now()
          WHERE id = v_report_order.id
          RETURNING * INTO v_report_order;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'quote_id', v_quote.id,
    'quote_number', v_quote.quote_number,
    'quote_status', v_quote.status,
    'payment_reference', v_payment.reference,
    'payment_status', v_payment.status,
    'report_order_id', v_report_order.id,
    'entitlement_status', v_report_order.entitlement_status
  );
END $$;

REVOKE ALL ON FUNCTION public.pay02_review_activation_proposal(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay02_issue_commercial_quote(text,text,integer,text,text,text,text,text,integer,bigint,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay02_claim_quote_checkout(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay02_sync_quote_from_canonical_payment(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pay02_review_activation_proposal(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay02_issue_commercial_quote(text,text,integer,text,text,text,text,text,integer,bigint,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay02_claim_quote_checkout(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay02_sync_quote_from_canonical_payment(text) TO service_role;

-- 11. Seed All 66 Controlling Commercial Catalogue Definitions across All 11 Families (R1-A)
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
    'mkt.vehicle_sale.principal', 1, 'marketplace',
    'Marketplace Vehicle Purchase Principal',
    'buyer_vehicle_purchase_settlement', 'category_b_third_party',
    'marketplace_safetrade', 'escrow_trust_sessions', 'buyer',
    'vehicle_seller_or_dealer', 'vehicle_seller_or_dealer', NULL, 'buyer_until_release_then_seller', 'vehicle_seller_or_dealer',
    'ZW', ARRAY['USD'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'governed_by_safetrade_dispute_and_escrow_terms',
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
    'vehicle_seller_or_dealer', 'vehicle_seller_or_buyer_refundable', NULL, 'buyer_custodial_deposit', 'not_carup_operating_revenue',
    'ZW', ARRAY['USD'], 'deposit_policy', NULL, 'USD', 2,
    NULL, NULL,
    'refundable_on_reservation_cancellation_or_failed_inspection_per_policy',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY['authorize_hold', 'capture', 'refund', 'regulated_escrow'],
    'issue164_record_deposit_payment_event_atomic', 'physical_service_exempt', false,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Source contains USD 500 MARKETPLACE_DEPOSIT_POLICY, but live custodial deposit collection requires licensed ZW provider and Owner commercial approval (PAY-05/PAY-08).',
    NULL, NULL
  ),
  (
    'mkt.auction.participation_deposit', 1, 'marketplace',
    'Auction Bidder Participation Deposit & Fee',
    'auction_bidder_deposit', 'category_b_third_party',
    'marketplace_auctions', 'auctions', 'buyer',
    'carup_or_auction_partner', 'buyer_refundable_or_auction_operator', NULL, 'buyer_custodial_deposit', NULL,
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'non_refundable_until_approved',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY['authorize_hold', 'refund'],
    'auction_bid_eligibility_gate', 'physical_service_exempt', false,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Auction deposit hold/release workflow and commercial terms are not yet implemented.',
    NULL, NULL
  ),
  (
    'mkt.listing.publication_fee', 1, 'marketplace',
    'Marketplace Vehicle Listing Publication Fee',
    'seller_listing_publication', 'category_a_first_party',
    'marketplace_listings', 'vehicles', 'seller',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD', 'ZWG'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'non_refundable_once_published',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'vehicle_listing_publication_gate', 'digital_web_only_until_iap', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Standard listing publication is currently free; paid listing tariff is not approved by Owner.',
    NULL, NULL
  ),
  (
    'mkt.listing.boost', 1, 'marketplace',
    'Featured & Boosted Vehicle Listing Placement',
    'listing_visibility_boost', 'category_a_first_party',
    'marketplace_promotions', 'vehicles', 'seller',
    'carup', 'carup', 'carup_japan', 'carup', 'carup',
    'JP', ARRAY['JPY', 'USD'], 'unapproved_missing', NULL, NULL, 0,
    NULL, NULL,
    'refundable_if_boost_not_delivered_or_revoked',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'listing_boost_window_activation_and_expiry', 'digital_web_only_until_iap', false,
    'draft', 'PARTIAL', 'COMMERCIAL',
    'Requires deterministic boost window expiry scheduler and Owner-approved boost tariff (PAY-03).',
    NULL, NULL
  ),
  (
    'mkt.dealer.storefront_package', 1, 'marketplace',
    'Dealership Verified Storefront & Inventory Package',
    'dealer_storefront_subscription', 'category_a_first_party',
    'dealer_operations', 'organizations', 'dealer',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'pro_rata_or_period_end_cancellation_pending_terms',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'dealer_tenant_entitlement_grant', 'b2b_contract_exempt', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Pricing.tsx displays mock $99/mo; requires reconciled dealer entitlement table and approved commercial tariff (PAY-03).',
    NULL, NULL
  ),
  (
    'mkt.sourcing.concierge_fee', 1, 'marketplace',
    'Local Vehicle Concierge Sourcing Fee',
    'local_vehicle_sourcing_engagement', 'category_a_first_party',
    'marketplace_sourcing', 'leads', 'buyer',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'non_refundable_until_approved',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'sourcing_case_assignment', 'physical_service_exempt', false,
    'blocked', 'CONCEPT ONLY', 'COMMERCIAL',
    'No approved local concierge fee tariff or service SLA contract.',
    NULL, NULL
  ),
  (
    'mkt.inspection.verification_service', 1, 'marketplace',
    'Pre-Purchase Physical Vehicle Inspection & Verification',
    'pre_purchase_inspection_booking', 'category_a_first_party',
    'vehicle_verification', 'vehicles', 'buyer',
    'carup', 'carup_or_inspector_partner', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'refundable_before_inspector_dispatch',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'inspection_order_and_evidence_capture', 'physical_service_exempt', false,
    'blocked', 'PARTIAL', 'COMMERCIAL',
    'Evidence ingestion exists; paid inspection booking tariff and inspector dispatch SLA require approval.',
    NULL, NULL
  ),
  (
    'mkt.delivery.local_transport', 1, 'marketplace',
    'Local Vehicle Delivery & Handover Transport',
    'local_vehicle_delivery', 'category_b_third_party',
    'marketplace_logistics', 'escrow_trust_sessions', 'buyer',
    'transport_carrier', 'transport_carrier', NULL, 'transport_carrier', 'transport_carrier',
    'ZW', ARRAY['USD'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'carrier_cancellation_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY['collect_payment'],
    'delivery_handover_confirmation', 'physical_service_exempt', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Local delivery carrier quotation and dispatch authority not yet implemented.',
    NULL, NULL
  ),
  (
    'mkt.warranty.extended_protection', 1, 'marketplace',
    'Optional Mechanical Breakdown & Extended Warranty',
    'extended_warranty_purchase', 'category_b_third_party',
    'insurance_warranty', 'insurance_policies', 'buyer',
    'licensed_warranty_underwriter', 'licensed_warranty_underwriter', NULL, 'licensed_warranty_underwriter', 'licensed_warranty_underwriter',
    'ZW', ARRAY['USD'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'statutory_cooling_off_per_underwriter',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY['collect_payment'],
    'underwriter_policy_issuance', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Requires contracted licensed warranty underwriter and regulated premium collection authority (PAY-07).',
    NULL, NULL
  ),
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
    'vehicle_history_reports', 'vehicles', 'buyer',
    'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan',
    'JP', ARRAY['JPY'], 'fixed_catalogue', 100, 'JPY', 0,
    'jct_pending_owner_commercial_signoff', 'none_first_party',
    'full_refund_revokes_report_entitlement_and_share_links',
    ARRAY['stripe_carup_japan_sandbox'], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund', 'retrieve_status', 'webhook_verify', 'webhook_replay_resistant'],
    'pay02_grant_vehicle_report_entitlement', 'digital_web_only_until_iap', false,
    'provider_eligible', 'SANDBOX READY', 'COMMERCIAL',
    'Selected as PAY-02-PILOT / PAY-03A first real CarUp product candidate. Real report assembly (`assembleReport`/`generateReportVersion`) exists in source; live retail price and customer terms require Owner commercial approval before staging/live release.',
    'ISSUE-247-PAY02-PILOT-SANDBOX-FIXTURE', 'pay02_moderator_sandbox_fixture'
  ),
  (
    'intel.passport.verification_certificate', 1, 'intelligence',
    'CarUp Vehicle Passport & Ownership Verification Certificate',
    'vehicle_passport_certificate_issuance', 'category_a_first_party',
    'vehicle_passport', 'vehicles', 'owner',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD', 'JPY'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'non_refundable_until_approved',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'passport_certificate_snapshot', 'digital_web_only_until_iap', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Passport read path is operational; paid certificate tariff and terms are not yet defined.',
    NULL, NULL
  ),
  (
    'intel.valuation.ai_assessment', 1, 'intelligence',
    'AI-Assisted Vehicle Condition & Valuation Report',
    'ai_condition_valuation_request', 'category_a_first_party',
    'vehicle_intelligence_ai', 'vehicles', 'buyer',
    'carup', 'carup', NULL, 'carup', 'carup',
    'JP', ARRAY['JPY', 'USD'], 'unapproved_missing', NULL, NULL, 0,
    NULL, NULL,
    'non_refundable_until_approved',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'ai_assessment_delivery', 'digital_web_only_until_iap', false,
    'draft', 'PARTIAL', 'COMMERCIAL',
    'Requires approved valuation provenance disclaimer and commercial pricing.',
    NULL, NULL
  ),
  (
    'intel.api.partner_usage', 1, 'intelligence',
    'Enterprise & Partner Vehicle Intelligence API Access',
    'partner_api_metered_billing', 'category_a_first_party',
    'partner_api', 'partner_api_keys', 'enterprise_partner',
    'carup', 'carup', NULL, 'carup', 'carup',
    'GLOBAL', ARRAY['USD', 'JPY'], 'usage_metered', NULL, NULL, 2,
    NULL, NULL,
    'b2b_master_service_agreement',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment'],
    'partner_api_quota_and_key_activation', 'b2b_contract_exempt', false,
    'blocked', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Partner API routes exist, but metered rate cards and B2B billing agreements are not approved.',
    NULL, NULL
  ),
  (
    'sub.diaspora.free', 1, 'subscriptions',
    'Diaspora Trade OS — Free Tier',
    'diaspora_free_tier_enrollment', 'category_a_first_party',
    'diaspora_billing', 'diaspora_subscriptions', 'diaspora_member',
    'carup', 'carup', 'carup_japan', 'carup', 'carup',
    'GLOBAL', ARRAY['USD', 'JPY'], 'fixed_catalogue', 0, 'USD', 2,
    'no_charge_tier', 'none_first_party',
    'no_charge_tier',
    ARRAY[]::text[], ARRAY[]::text[],
    ARRAY[]::text[],
    'resolveEffectiveEntitlements_free_default', 'b2b_contract_exempt', true,
    'draft', 'IMPLEMENTED', NULL,
    'Zero-cost default entitlement tier; requires no payment collection.',
    'ADR-001-DIASPORA-FREE-DEFAULT', 'owner_architecture_authority'
  ),
  (
    'sub.diaspora.buyer_pro', 1, 'subscriptions',
    'Diaspora Buyer Plan Subscription',
    'diaspora_buyer_subscription_renewal', 'category_a_first_party',
    'diaspora_billing', 'diaspora_subscriptions', 'diaspora_buyer',
    'carup', 'carup', 'carup_japan', 'carup', 'carup',
    'JP', ARRAY['JPY', 'USD'], 'unapproved_missing', NULL, NULL, 0,
    NULL, 'none_first_party',
    'cancel_at_period_end_or_governed_admin_refund',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund', 'webhook_verify', 'webhook_replay_resistant'],
    'syncSubscriptionFromSnapshot', 'digital_web_only_until_iap', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Entitlement sync and event ledger exist in source (`PLAN_CATALOG.diaspora_buyer`), but recurring tariff is not yet approved and `Pricing.tsx` displays disconnected mock prices.',
    NULL, NULL
  ),
  (
    'sub.diaspora.seller_supplier', 1, 'subscriptions',
    'Diaspora Seller / Supplier Plan Subscription',
    'diaspora_seller_supplier_subscription', 'category_a_first_party',
    'diaspora_billing', 'diaspora_subscriptions', 'exporter_supplier',
    'carup', 'carup', 'carup_japan', 'carup', 'carup',
    'JP', ARRAY['JPY', 'USD'], 'unapproved_missing', NULL, NULL, 0,
    NULL, 'none_first_party',
    'cancel_at_period_end_or_governed_admin_refund',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund', 'webhook_verify', 'webhook_replay_resistant'],
    'syncSubscriptionFromSnapshot', 'b2b_contract_exempt', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Entitlement catalog `PLAN_CATALOG.seller_supplier` exists; commercial recurring tariff requires Owner approval.',
    NULL, NULL
  ),
  (
    'sub.diaspora.trade_pro', 1, 'subscriptions',
    'Diaspora Trade Pro Subscription',
    'diaspora_trade_pro_subscription', 'category_a_first_party',
    'diaspora_billing', 'diaspora_subscriptions', 'trade_operator',
    'carup', 'carup', 'carup_japan', 'carup', 'carup',
    'JP', ARRAY['JPY', 'USD'], 'unapproved_missing', NULL, NULL, 0,
    NULL, 'none_first_party',
    'cancel_at_period_end_or_governed_admin_refund',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund', 'webhook_verify', 'webhook_replay_resistant'],
    'syncSubscriptionFromSnapshot', 'b2b_contract_exempt', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Entitlement catalog `PLAN_CATALOG.trade_pro` exists; commercial recurring tariff requires Owner approval.',
    NULL, NULL
  ),
  (
    'sub.diaspora.enterprise_partner', 1, 'subscriptions',
    'Diaspora Enterprise Partner Plan',
    'diaspora_enterprise_contract_subscription', 'category_a_first_party',
    'diaspora_billing', 'diaspora_subscriptions', 'enterprise_partner',
    'carup', 'carup', NULL, 'carup', 'carup',
    'GLOBAL', ARRAY['USD', 'JPY'], 'contract_quotation', NULL, NULL, 2,
    NULL, 'none_first_party',
    'enterprise_msa_terms',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment'],
    'syncSubscriptionFromSnapshot', 'b2b_contract_exempt', false,
    'blocked', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Requires bespoke enterprise contract quotation and Owner signoff.',
    NULL, NULL
  ),
  (
    'sub.garage.os_plan', 1, 'subscriptions',
    'Garage 1.0 Business Operating System Subscription',
    'garage_os_saas_subscription', 'category_a_first_party',
    'garage_operations', 'garages', 'garage_owner',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD', 'ZWG'], 'unapproved_missing', NULL, NULL, 2,
    NULL, 'none_first_party',
    'cancel_at_period_end',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment'],
    'garage_os_subscription_entitlement', 'b2b_contract_exempt', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Pricing.tsx displays mock $49/mo; requires approved SaaS tariff and ZW collection provider (PAY-03/PAY-05).',
    NULL, NULL
  ),
  (
    'adv.dealer.promotion_campaign', 1, 'advertising',
    'Dealer Promotional Discount & Featured Campaign',
    'dealer_promotion_campaign_purchase', 'category_a_first_party',
    'dealer_promotions', 'dealer_promotions', 'dealer',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'refundable_before_campaign_start',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'dealer_promotion_window_activation', 'b2b_contract_exempt', false,
    'draft', 'PARTIAL', 'COMMERCIAL',
    'CRUD route exists in promotionsRoutes.js, but impression delivery measurement and pricing are not yet implemented.',
    NULL, NULL
  ),
  (
    'adv.search.sponsored_placement', 1, 'advertising',
    'Search & Category Sponsored Placement',
    'sponsored_search_slot_booking', 'category_a_first_party',
    'marketplace_search', 'vehicles', 'dealer',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'non_refundable_until_approved',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment'],
    'sponsored_search_ranking_slot', 'b2b_contract_exempt', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Sponsored search inventory allocation and measurement do not exist yet.',
    NULL, NULL
  ),
  (
    'adv.banner.display_campaign', 1, 'advertising',
    'Supplier & Partner Display Banner Campaign',
    'display_banner_ad_booking', 'category_a_first_party',
    'partner_advertising', 'organizations', 'advertiser',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'non_refundable_until_approved',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment'],
    'banner_ad_serving_contract', 'b2b_contract_exempt', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Ad-serving inventory and impression metering are not implemented.',
    NULL, NULL
  ),
  (
    'adv.leads.qualified_buyer_lead', 1, 'advertising',
    'Verified Buyer Inquiry & Qualified Lead Package',
    'qualified_lead_purchase', 'category_a_first_party',
    'dealer_leads', 'leads', 'dealer',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'invalid_lead_credit_policy_pending',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment'],
    'lead_unlock_entitlement', 'b2b_contract_exempt', false,
    'draft', 'PARTIAL', 'COMMERCIAL',
    'Lead capture exists (`public.leads`); per-lead commercial pricing is not approved.',
    NULL, NULL
  ),
  (
    'adv.referral.commission_reward', 1, 'advertising',
    'Referral Programme Conversion Commission & Reward',
    'referral_conversion_payout_obligation', 'category_c_corporate_treasury',
    'referral_engine', 'referral_conversions', 'carup',
    'referrer_affiliate', 'referrer_affiliate', NULL, 'carup_until_approved_payout', 'referrer_affiliate',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    'withholding_tax_review_required', NULL,
    'clawback_on_cancelled_or_refunded_order',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    'referral_reward_payable_settlement', 'internal_treasury_prohibited', true,
    'blocked', 'PARTIAL', 'COMMERCIAL',
    'Referral attribution is implemented, but commission schedule and disbursement rail require Owner approval (PAY-09).',
    NULL, NULL
  ),
  (
    'adv.credits.prepaid_wallet', 1, 'advertising',
    'Prepaid Advertising Credit Bundle',
    'prepaid_ad_credit_topup', 'category_a_first_party',
    'advertising_credits', 'organizations', 'dealer',
    'carup', 'carup', NULL, 'carup_deferred_revenue_liability', 'carup_upon_ad_consumption',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'unused_credit_refund_terms_pending',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'ad_credit_ledger_grant', 'b2b_contract_exempt', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Deferred-revenue credit ledger and ad consumption metering do not exist yet.',
    NULL, NULL
  ),
  (
    'gar.invoice.customer_payment', 1, 'garage',
    'Garage 1.0 Customer Service Invoice Payment',
    'garage_invoice_payment', 'category_b_third_party',
    'garage_ops07', 'garage_invoices', 'vehicle_owner_customer',
    'garage_business_tenant', 'garage_business_tenant', NULL, 'garage_business_tenant', 'garage_business_tenant',
    'ZW', ARRAY['USD', 'ZWG'], 'invoice_backed', NULL, NULL, 2,
    'garage_tenant_invoice_tax_lines', NULL,
    'garage_tenant_invoice_adjustment_policy',
    ARRAY['garage_recorded_external'], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY['collect_payment'],
    'garage_ops07_invoice_allocation_and_receipt', 'physical_service_exempt', false,
    'blocked', 'IMPLEMENTED', 'PROVIDER',
    'Off-platform external recording (`source=garage_recorded_external`) is IMPLEMENTED and certified on Garage 1.0 (69e12e219). CarUp provider-confirmed gateway collection remains BLOCKED pending PAY-04 and ZW merchant settlement authority.',
    'GARAGE-1.0-CUTOVER-01-69e12e219-EXTERNAL-ONLY', 'owner_garage_1_0_authority'
  ),
  (
    'gar.appointment.booking_deposit', 1, 'garage',
    'Garage Service Appointment Booking Deposit',
    'garage_appointment_deposit', 'category_b_third_party',
    'garage_ops03', 'garage_appointments', 'vehicle_owner_customer',
    'garage_business_tenant', 'garage_business_tenant', NULL, 'garage_business_tenant', 'garage_business_tenant',
    'ZW', ARRAY['USD', 'ZWG'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'garage_appointment_cancellation_policy',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY['collect_payment', 'refund'],
    'garage_appointment_deposit_credit_to_invoice', 'physical_service_exempt', false,
    'blocked', 'COMMERCIAL TERMS MISSING', 'PROVIDER',
    'Appointments (OPS03) exist; deposit collection requires PAY-04 invoice credit integration and ZW provider authority.',
    NULL, NULL
  ),
  (
    'gar.work_order.diagnostic_fee', 1, 'garage',
    'Workshop Diagnostic & Estimate Inspection Fee',
    'garage_diagnostic_fee', 'category_b_third_party',
    'garage_ops04', 'garage_estimates', 'vehicle_owner_customer',
    'garage_business_tenant', 'garage_business_tenant', NULL, 'garage_business_tenant', 'garage_business_tenant',
    'ZW', ARRAY['USD', 'ZWG'], 'invoice_backed', NULL, NULL, 2,
    NULL, NULL,
    'waived_or_credited_per_garage_policy',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY['collect_payment'],
    'garage_ops07_invoice_line_settlement', 'physical_service_exempt', false,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Billed as a line item on Garage OPS07 invoices; gateway collection awaits PAY-04.',
    NULL, NULL
  ),
  (
    'gar.parts.retail_sale', 1, 'garage',
    'Automotive Parts Counter & PartsEntry Sale',
    'parts_retail_or_workshop_sale', 'category_b_third_party',
    'garage_ops06_parts', 'parts', 'vehicle_owner_or_garage',
    'parts_supplier_or_garage', 'parts_supplier_or_garage', NULL, 'parts_supplier_or_garage', 'parts_supplier_or_garage',
    'ZW', ARRAY['USD', 'ZWG'], 'invoice_backed', NULL, NULL, 2,
    NULL, NULL,
    'parts_return_and_restock_movement_policy',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY['collect_payment', 'refund'],
    'garage_ops06_stock_consumption_and_invoice', 'physical_service_exempt', false,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Workshop parts consumption (OPS06) and invoicing (OPS07) exist; standalone e-commerce parts checkout and supplier procurement are not yet built (PAY-04).',
    NULL, NULL
  ),
  (
    'gar.fleet.scheduled_maintenance', 1, 'garage',
    'Corporate Fleet Scheduled Maintenance Account Billing',
    'fleet_maintenance_statement_settlement', 'category_b_third_party',
    'garage_operations', 'garage_invoices', 'fleet_operator',
    'garage_business_tenant', 'garage_business_tenant', NULL, 'garage_business_tenant', 'garage_business_tenant',
    'ZW', ARRAY['USD'], 'invoice_backed', NULL, NULL, 2,
    NULL, NULL,
    'b2b_fleet_service_agreement',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY['collect_payment'],
    'fleet_consolidated_invoice_settlement', 'b2b_contract_exempt', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Multi-vehicle B2B fleet account statement aggregation is not yet implemented.',
    NULL, NULL
  ),
  (
    'gar.towing.breakdown_dispatch', 1, 'garage',
    'Roadside Breakdown & Towing Dispatch Service',
    'roadside_towing_dispatch', 'category_b_third_party',
    'service_network', 'mechanic_work_orders', 'vehicle_owner_customer',
    'towing_or_garage_operator', 'towing_or_garage_operator', NULL, 'towing_or_garage_operator', 'towing_or_garage_operator',
    'ZW', ARRAY['USD'], 'unapproved_missing', NULL, NULL, 2,
    NULL, NULL,
    'refundable_if_dispatch_cancelled_before_en_route',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY['collect_payment'],
    'towing_dispatch_completion', 'physical_service_exempt', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Roadside dispatch workflow and distance tariff authority do not exist yet.',
    NULL, NULL
  ),
  (
    'gar.warranty.authorized_repair', 1, 'garage',
    'Warranty-Authorized Workshop Repair Claim Settlement',
    'warranty_repair_insurer_reimbursement', 'category_b_third_party',
    'garage_operations', 'garage_invoices', 'insurer_or_warranty_provider',
    'garage_business_tenant', 'garage_business_tenant', NULL, 'insurer_until_settled_to_garage', 'garage_business_tenant',
    'ZW', ARRAY['USD'], 'invoice_backed', NULL, NULL, 2,
    NULL, NULL,
    'insurer_audit_adjustment',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY[]::text[],
    'insurer_to_garage_claim_settlement', 'b2b_contract_exempt', true,
    'blocked', 'CONCEPT ONLY', 'PROVIDER',
    'Requires insurer-authorized repair order and B2B claim settlement integration (PAY-04/PAY-07).',
    NULL, NULL
  ),
  (
    'imp.vehicle.supplier_principal', 1, 'imports_trade',
    'Foreign Vehicle Supplier Purchase Principal (FOB/CIF)',
    'import_supplier_vehicle_principal', 'category_b_third_party',
    'diaspora_trade_os', 'diaspora_import_orders', 'importer_buyer',
    'foreign_vehicle_exporter_supplier', 'foreign_vehicle_exporter_supplier', NULL, 'foreign_vehicle_exporter_supplier', 'foreign_vehicle_exporter_supplier',
    'JP', ARRAY['JPY', 'USD', 'GBP'], 'contract_quotation', NULL, NULL, 0,
    'export_zero_rated_or_supplier_invoice', 'separate_carup_fee_component',
    'governed_by_supplier_proforma_and_safetrade_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY['regulated_escrow', 'payout_to_seller'],
    'diaspora_supplier_principal_milestone_verification', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'PROVIDER',
    'Third-party exporter principal (`cost_stage=GOODS`, `revenue_class=PASS_THROUGH_COST`) must never be collected as CarUp first-party revenue. Requires verified bank/escrow settlement rail (PAY-06/PAY-08).',
    NULL, NULL
  ),
  (
    'imp.milestone.payment_tranche', 1, 'imports_trade',
    'Import Order Scheduled Payment Milestone Tranche',
    'import_order_payment_milestone', 'category_b_third_party',
    'diaspora_trade_os', 'diaspora_payment_milestones', 'importer_buyer',
    'designated_milestone_counterparty', 'designated_milestone_counterparty', NULL, 'designated_milestone_counterparty', 'designated_milestone_counterparty',
    'GLOBAL', ARRAY['USD', 'JPY', 'GBP', 'ZAR'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'milestone_contract_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY['collect_payment'],
    'diaspora_payment_milestone_evidence_reconciliation', 'physical_service_exempt', false,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Milestone tracking (`diaspora_payment_milestones`) is implemented; each milestone must allocate to its specific legal beneficiary rather than a single CarUp charge (PAY-06).',
    NULL, NULL
  ),
  (
    'imp.sourcing.verification_fee', 1, 'imports_trade',
    'CarUp Export Vehicle Sourcing & Pre-Shipment Verification Fee',
    'carup_export_sourcing_service_fee', 'category_a_first_party',
    'diaspora_trade_os', 'diaspora_trade_charge_components', 'importer_buyer',
    'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan', 'carup_japan',
    'JP', ARRAY['JPY', 'USD'], 'unapproved_missing', NULL, NULL, 0,
    NULL, 'none_first_party',
    'refundable_before_origin_inspection_execution',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'diaspora_carup_service_fee_acknowledgment', 'physical_service_exempt', false,
    'draft', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Represented in T6 `diaspora_trade_charge_components` (`cost_stage=CARUP`, `revenue_class=CARUP_SERVICE_FEE`), pending Owner tariff approval (PAY-06).',
    NULL, NULL
  ),
  (
    'imp.export.documentation_charge', 1, 'imports_trade',
    'Origin Export Certificate, Deregistration & JEVIC/QISJ Inspection Charge',
    'export_documentation_and_origin_compliance', 'category_b_third_party',
    'diaspora_trade_os', 'diaspora_trade_charge_components', 'importer_buyer',
    'origin_export_agent_or_inspection_body', 'origin_export_agent_or_inspection_body', NULL, 'origin_export_agent_or_inspection_body', 'origin_export_agent_or_inspection_body',
    'JP', ARRAY['JPY', 'USD'], 'contract_quotation', NULL, NULL, 0,
    NULL, NULL,
    'non_refundable_once_ lodged_with_authority',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    't8_export_document_evidence_binding', 'physical_service_exempt', true,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Third-party origin agent/authority fee (`cost_stage=EXPORT`); requires PAY-06 multi-party obligation settlement.',
    NULL, NULL
  ),
  (
    'imp.freight.ocean_carriage', 1, 'imports_trade',
    'Ocean Freight & Main Carriage (RoRo / Container)',
    'ocean_freight_settlement', 'category_b_third_party',
    'diaspora_logistics', 'diaspora_logistics_quotes', 'importer_buyer',
    'shipping_line_or_freight_forwarder', 'shipping_line_or_freight_forwarder', NULL, 'shipping_line_or_freight_forwarder', 'shipping_line_or_freight_forwarder',
    'GLOBAL', ARRAY['USD', 'JPY'], 'contract_quotation', NULL, NULL, 2,
    'international_freight_tax_rules', NULL,
    'carrier_bill_of_lading_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    'bill_of_lading_release_confirmation', 'physical_service_exempt', true,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Logistics RFQ and T6 `MAIN_CARRIAGE` component exist; freight settlement is a third-party carrier obligation (PAY-06).',
    NULL, NULL
  ),
  (
    'imp.container.shared_slot_reservation', 1, 'imports_trade',
    'Shared Container Consolidation Slot Reservation',
    'shared_container_slot_booking', 'category_b_third_party',
    'diaspora_container_sharing', 'diaspora_container_reservations', 'importer_buyer',
    'consolidation_operator_or_forwarder', 'consolidation_operator_or_forwarder', NULL, 'consolidation_operator_or_forwarder', 'consolidation_operator_or_forwarder',
    'GLOBAL', ARRAY['USD', 'JPY'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'container_slot_cancellation_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY['collect_payment', 'refund'],
    'container_slot_allocation_and_loading_gate', 'physical_service_exempt', false,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Container reservation and T6 shared-capacity allocation exist; requires multi-party consolidator settlement authority (PAY-06).',
    NULL, NULL
  ),
  (
    'imp.insurance.marine_cargo', 1, 'imports_trade',
    'Marine Cargo Transit Insurance Premium',
    'marine_cargo_insurance_binding', 'category_b_third_party',
    'diaspora_trade_os', 'diaspora_trade_charge_components', 'importer_buyer',
    'licensed_marine_insurer', 'licensed_marine_insurer', NULL, 'licensed_marine_insurer', 'licensed_marine_insurer',
    'GLOBAL', ARRAY['USD', 'JPY'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'marine_insurer_certificate_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    'marine_insurance_certificate_evidence', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Requires licensed marine insurer integration or external certificate evidence (PAY-06/PAY-07).',
    NULL, NULL
  ),
  (
    'imp.customs.duties_and_taxes', 1, 'imports_trade',
    'ZIMRA & Destination Customs Duties, Excise, VAT & Surtax',
    'customs_statutory_duty_settlement', 'category_b_third_party',
    'diaspora_customs_t12', 'diaspora_customs_declarations', 'importer_buyer',
    'statutory_customs_authority_zimra', 'statutory_customs_authority_zimra', NULL, 'statutory_customs_authority_zimra', 'statutory_customs_authority_zimra',
    'ZW', ARRAY['USD', 'ZWG'], 'statutory_calculation', NULL, NULL, 2,
    'zimra_customs_assessment_notice', 'none_statutory_pass_through',
    'statutory_customs_rebate_or_appeal_only',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    't12_customs_clearance_receipt_verification', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Government duties (`revenue_class=GOVERNMENT_DUTY`) belong to ZIMRA/statutory authority and must never be collected as CarUp merchant sales (PAY-06).',
    NULL, NULL
  ),
  (
    'imp.clearing.forwarding_agency', 1, 'imports_trade',
    'Customs Clearing & Forwarding Agency Fee',
    'clearing_agent_service_settlement', 'category_b_third_party',
    'diaspora_customs_t12', 'diaspora_customs_declarations', 'importer_buyer',
    'licensed_clearing_agent', 'licensed_clearing_agent', NULL, 'licensed_clearing_agent', 'licensed_clearing_agent',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'clearing_agency_engagement_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY[]::text[],
    't12_clearing_completion_milestone', 'physical_service_exempt', true,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Third-party clearing agent obligation (`cost_stage=CLEARING`); requires PAY-06 partner settlement integration.',
    NULL, NULL
  ),
  (
    'imp.port.demurrage_and_storage', 1, 'imports_trade',
    'Port Terminal Handling, Storage & Demurrage Charges',
    'port_storage_or_demurrage_settlement', 'category_b_third_party',
    'diaspora_logistics', 'diaspora_trade_charge_components', 'importer_buyer',
    'port_terminal_operator', 'port_terminal_operator', NULL, 'port_terminal_operator', 'port_terminal_operator',
    'GLOBAL', ARRAY['USD', 'ZAR'], 'invoice_backed', NULL, NULL, 2,
    NULL, NULL,
    'port_tariff_non_refundable',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY[]::text[],
    'port_release_order_evidence', 'physical_service_exempt', true,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Contingent third-party port/terminal charge (`cost_stage=DESTINATION_PORT`/`EXCEPTIONS`); requires PAY-06 invoice evidence.',
    NULL, NULL
  ),
  (
    'imp.inland.cross_border_delivery', 1, 'imports_trade',
    'Inland Cross-Border Carrier & Final Delivery Charge',
    'inland_haulage_settlement', 'category_b_third_party',
    'diaspora_logistics', 'diaspora_shipment_legs', 'importer_buyer',
    'inland_transport_carrier', 'inland_transport_carrier', NULL, 'inland_transport_carrier', 'inland_transport_carrier',
    'ZW', ARRAY['USD', 'ZAR'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'carrier_haulage_contract_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY[]::text[],
    'cap04_shipment_leg_arrival_confirmation', 'physical_service_exempt', true,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Shipment legs (CAP-04) and T6 `INLAND`/`FINAL_DELIVERY` stages exist; carrier settlement requires PAY-06.',
    NULL, NULL
  ),
  (
    'ins.policy.motor_premium', 1, 'insurance',
    'Motor Vehicle Insurance Policy Premium (ZINARA/Third-Party/Comprehensive)',
    'motor_insurance_policy_premium_collection', 'category_b_third_party',
    'insurance_provider_platform', 'insurance_policies', 'policyholder_vehicle_owner',
    'licensed_insurer_provider', 'licensed_insurer_provider', NULL, 'licensed_insurer_provider', 'licensed_insurer_provider',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    'statutory_stamp_duty_and_insurance_levy', 'requires_licensed_broker_or_introducer_agreement',
    'insurer_policy_cancellation_schedule',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    'insurer_bound_policy_certificate', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Illustrative quote math in `insuranceService.js` is not an insurer-authorized quote. Premium collection requires a signed contract in `provider_registry` (`capability_type=insurance`) and licensed collection authority (PAY-07).',
    NULL, NULL
  ),
  (
    'ins.claim.deductible_excess', 1, 'insurance',
    'Insurance Claim Policyholder Deductible / Excess Obligation',
    'insurance_claim_excess_payment', 'category_b_third_party',
    'insurance_claims', 'claims', 'policyholder_vehicle_owner',
    'licensed_insurer_or_repair_garage', 'licensed_insurer_or_repair_garage', NULL, 'licensed_insurer_or_repair_garage', 'licensed_insurer_or_repair_garage',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'subrogation_recovery_per_insurer',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox'],
    ARRAY[]::text[],
    'claim_excess_clearance_acknowledgment', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Requires insurer claim adjudication authority and contracted collection arrangement (PAY-07).',
    NULL, NULL
  ),
  (
    'ins.claim.settlement_payout', 1, 'insurance',
    'Insurer-Owned Claim Settlement Disbursement',
    'insurance_claim_payout_disbursement', 'category_b_third_party',
    'insurance_claims', 'claims', 'licensed_insurer_provider',
    'policyholder_or_repair_garage', 'policyholder_or_repair_garage', NULL, 'licensed_insurer_provider', 'policyholder_or_repair_garage',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'not_applicable_insurer_disbursement',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    'insurer_disbursement_evidence_recording', 'internal_treasury_prohibited', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Claim payouts are disbursed by the licensed insurer; CarUp only records verified insurer evidence (PAY-07).',
    NULL, NULL
  ),
  (
    'ins.referral.platform_commission', 1, 'insurance',
    'CarUp Insurer Introducer & Risk-Intelligence Fee',
    'insurer_b2b_introducer_fee_invoice', 'category_a_first_party',
    'insurance_provider_platform', 'provider_registry', 'licensed_insurer_provider',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD'], 'contract_quotation', NULL, NULL, 2,
    NULL, 'b2b_insurer_agreement_required',
    'b2b_contract_terms',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY[]::text[],
    'corporate_receivable_invoice_settlement', 'b2b_contract_exempt', true,
    'blocked', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Requires signed B2B insurer introducer/data agreement and approved fee schedule (PAY-07/PAY-09).',
    NULL, NULL
  ),
  (
    'fin.loan.origination_fee', 1, 'banking_finance',
    'Lender Vehicle Loan Origination & Facility Fee',
    'lender_loan_origination_charge', 'category_b_third_party',
    'finance_provider_platform', 'finance_applications', 'borrower_applicant',
    'licensed_bank_or_lender', 'licensed_bank_or_lender', NULL, 'licensed_bank_or_lender', 'licensed_bank_or_lender',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    'financial_services_duty_per_lender', NULL,
    'lender_facility_letter_terms',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    'lender_facility_origination_confirmation', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Lender origination fees belong to the licensed bank/lender in `provider_registry` (`capability_type=finance`) (PAY-07).',
    NULL, NULL
  ),
  (
    'fin.loan.principal_disbursement', 1, 'banking_finance',
    'Lender Vehicle, Import or Dealer Inventory Loan Disbursement',
    'lender_loan_principal_disbursement', 'category_b_third_party',
    'finance_provider_platform', 'finance_applications', 'licensed_bank_or_lender',
    'vehicle_seller_or_dealer', 'vehicle_seller_or_dealer', NULL, 'licensed_bank_or_lender', 'vehicle_seller_or_dealer',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'not_applicable_lender_disbursement',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    'issue164_finance_decision_and_disbursement_evidence', 'internal_treasury_prohibited', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'A workflow status of `Disbursed` is not bank transfer proof. Requires verified lender disbursement evidence (PAY-07).',
    NULL, NULL
  ),
  (
    'fin.loan.instalment_repayment', 1, 'banking_finance',
    'Borrower Loan Instalment & Interest Repayment',
    'borrower_loan_repayment', 'category_b_third_party',
    'vehicle_finance_obligations', 'vehicle_finance_obligations', 'borrower_vehicle_owner',
    'licensed_bank_or_lender', 'licensed_bank_or_lender', NULL, 'licensed_bank_or_lender', 'licensed_bank_or_lender',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'lender_repayment_reconciliation',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    'lender_repayment_and_lien_clearance_authority', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'CarUp is not a licensed deposit-taking or loan-servicing bank; repayments belong to the lender of record (PAY-07).',
    NULL, NULL
  ),
  (
    'fin.loan.late_penalty_charge', 1, 'banking_finance',
    'Lender-Assessed Arrears & Late Payment Penalty',
    'lender_late_penalty_assessment', 'category_b_third_party',
    'vehicle_finance_obligations', 'vehicle_finance_obligations', 'borrower_vehicle_owner',
    'licensed_bank_or_lender', 'licensed_bank_or_lender', NULL, 'licensed_bank_or_lender', 'licensed_bank_or_lender',
    'ZW', ARRAY['USD', 'ZWG'], 'contract_quotation', NULL, NULL, 2,
    NULL, NULL,
    'lender_waiver_authority_only',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'garage_recorded_external'],
    ARRAY[]::text[],
    'lender_statement_adjustment', 'physical_service_exempt', true,
    'blocked', 'PROVIDER BLOCKED', 'LEGAL/POLICY',
    'Lender-owned penalty charge; CarUp cannot assess or collect unlicensed lending interest/penalties (PAY-07).',
    NULL, NULL
  ),
  (
    'fin.referral.lender_commission', 1, 'banking_finance',
    'CarUp Lender Lead-Introducer & Collateral Valuation Fee',
    'lender_b2b_introducer_fee_invoice', 'category_a_first_party',
    'finance_provider_platform', 'provider_registry', 'licensed_bank_or_lender',
    'carup', 'carup', NULL, 'carup', 'carup',
    'ZW', ARRAY['USD'], 'contract_quotation', NULL, NULL, 2,
    NULL, 'b2b_lender_introducer_contract_required',
    'b2b_contract_terms',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY[]::text[],
    'corporate_receivable_invoice_settlement', 'b2b_contract_exempt', true,
    'blocked', 'COMMERCIAL TERMS MISSING', 'COMMERCIAL',
    'Requires signed B2B bank/lender introducer contract and approved fee schedule (PAY-07/PAY-09).',
    NULL, NULL
  ),
  (
    'adj.order.refund_reversal', 1, 'adjustments',
    'Governed Customer Payment Refund & Entitlement Reversal',
    'customer_payment_refund', 'category_a_first_party',
    'canonical_payment_authority', 'payment_transactions', 'carup_merchant_refund_to_buyer',
    'carup_japan', 'original_authenticated_buyer', 'carup_japan', 'original_authenticated_buyer', 'negative_revenue_adjustment',
    'JP', ARRAY['JPY'], 'invoice_backed', 100, 'JPY', 0,
    'reverses_original_tax_snapshot', 'none_first_party',
    'idempotent_full_refund_with_entitlement_revocation',
    ARRAY['stripe_carup_japan_sandbox'], ARRAY['garage_recorded_external'],
    ARRAY['refund', 'retrieve_status', 'webhook_verify'],
    'pay01c_sync_demo_entitlement_revocation', 'digital_web_only_until_iap', true,
    'sandbox_certified', 'PHYSICALLY CERTIFIED', 'OWNER AUTHORITY',
    'Certified in Stripe Japan sandbox (PAY-01B/01C). Live refund operations remain blocked until live product release.',
    'PR#246-2c4057a22-PR#248-61014be11', 'owner_sandbox_authority'
  ),
  (
    'adj.order.chargeback_dispute', 1, 'adjustments',
    'Provider Chargeback, Dispute Hold & Representment Adjustment',
    'provider_chargeback_dispute', 'category_a_first_party',
    'canonical_payment_authority', 'payment_transactions', 'card_network_or_psp_dispute',
    'carup', 'disputing_cardholder_or_carup_on_win', 'carup_japan', 'disputed_hold_at_provider', 'contingent_on_dispute_outcome',
    'GLOBAL', ARRAY['JPY', 'USD'], 'invoice_backed', NULL, NULL, 0,
    NULL, NULL,
    'immediate_entitlement_suspension_on_dispute_open',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY['webhook_verify', 'retrieve_status'],
    'dispute_entitlement_freeze_and_audit_escalation', 'internal_treasury_prohibited', true,
    'draft', 'PARTIAL', 'ENGINEERING',
    'Dispute state tracking and evidence bundle workflow to be expanded in PAY-10.',
    NULL, NULL
  ),
  (
    'adj.invoice.supplemental_adjustment', 1, 'adjustments',
    'Supplemental Invoice, Under-Collection or Overpayment Credit Note',
    'commercial_obligation_adjustment', 'category_a_first_party',
    'commercial_quote_authority', 'pay02_commercial_quotes', 'customer_or_partner',
    'carup_or_designated_seller', 'carup_or_designated_beneficiary', NULL, 'designated_party_per_replacement_quote', 'designated_party_per_replacement_quote',
    'GLOBAL', ARRAY['JPY', 'USD', 'ZWG'], 'invoice_backed', NULL, NULL, 2,
    NULL, NULL,
    'governed_by_replacement_quote_chain',
    ARRAY[]::text[], ARRAY[]::text[],
    ARRAY[]::text[],
    'replacement_quote_audit_lineage', 'b2b_contract_exempt', true,
    'draft', 'IMPLEMENTED', NULL,
    'Implemented as immutable replacement quote lineage in PAY-02; live settlement remains gated per product.',
    NULL, NULL
  ),
  (
    'corp.ap.infrastructure_cloud', 1, 'corporate_finance',
    'Cloud, Database, Edge Hosting & AI Model Usage Payables',
    'corporate_vendor_payable_settlement', 'category_c_corporate_treasury',
    'corporate_admin_finance', 'organizations', 'carup_corporate_treasury',
    'cloud_or_ai_infrastructure_vendor', 'cloud_or_ai_infrastructure_vendor', NULL, 'carup_corporate_treasury', 'not_revenue_corporate_expense',
    'GLOBAL', ARRAY['USD', 'JPY'], 'invoice_backed', NULL, NULL, 2,
    'reverse_charge_or_vendor_tax_invoice', NULL,
    'vendor_sla_credit_only',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[],
    'corporate_ap_invoice_approval_and_reconciliation', 'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Category C corporate payable; strictly prohibited from customer Checkout. Governed under PAY-09.',
    NULL, NULL
  ),
  (
    'corp.ap.communications_provider', 1, 'corporate_finance',
    'WhatsApp/Meta, SMS & Transactional Email Provider Payables',
    'communications_transport_payable', 'category_c_corporate_treasury',
    'communications_2_0', 'communication_audit_events', 'carup_corporate_treasury',
    'communications_transport_vendor', 'communications_transport_vendor', NULL, 'carup_corporate_treasury', 'not_revenue_corporate_expense',
    'GLOBAL', ARRAY['USD', 'JPY'], 'invoice_backed', NULL, NULL, 2,
    NULL, NULL,
    'not_applicable_corporate_payable',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[],
    'corporate_ap_invoice_approval_and_reconciliation', 'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Category C corporate payable; strictly prohibited from customer Checkout. Governed under PAY-09.',
    NULL, NULL
  ),
  (
    'corp.ap.psp_processing_fees', 1, 'corporate_finance',
    'Payment Service Provider Processing, FX & Settlement Fees',
    'psp_fee_deduction_or_invoice', 'category_c_corporate_treasury',
    'canonical_payment_authority', 'payment_transactions', 'carup_corporate_treasury',
    'payment_service_provider', 'payment_service_provider', NULL, 'payment_service_provider', 'not_revenue_psp_cost_of_sales',
    'GLOBAL', ARRAY['JPY', 'USD', 'ZWG'], 'invoice_backed', NULL, NULL, 0,
    NULL, NULL,
    'psp_fee_retention_policy',
    ARRAY[]::text[], ARRAY['garage_recorded_external'],
    ARRAY[]::text[],
    'settlement_net_vs_gross_reconciliation', 'internal_treasury_prohibited', true,
    'blocked', 'PARTIAL', 'PROVIDER',
    'Category C PSP fee accounting; reconciled against provider balance transactions in PAY-09/PAY-10.',
    NULL, NULL
  ),
  (
    'corp.ap.payroll_and_contractors', 1, 'corporate_finance',
    'Employee Payroll, Contractor & Professional Service Disbursements',
    'corporate_payroll_or_contractor_disbursement', 'category_c_corporate_treasury',
    'corporate_admin_people', 'users', 'carup_corporate_treasury',
    'employee_or_professional_contractor', 'employee_or_professional_contractor', NULL, 'carup_corporate_treasury', 'not_revenue_corporate_expense',
    'GLOBAL', ARRAY['USD', 'JPY', 'ZWG'], 'invoice_backed', NULL, NULL, 2,
    'paye_and_withholding_tax_compliance', NULL,
    'not_applicable_corporate_payable',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[],
    'corporate_payroll_approval_and_bank_reconciliation', 'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Category C corporate disbursement; never exposed via customer Checkout (PAY-09).',
    NULL, NULL
  ),
  (
    'corp.tax.statutory_remittance', 1, 'corporate_finance',
    'Corporate Tax, VAT/JCT & Statutory Remittances',
    'corporate_tax_remittance', 'category_c_corporate_treasury',
    'corporate_admin_finance', 'organizations', 'carup_corporate_treasury',
    'tax_authority_nta_or_zimra', 'tax_authority_nta_or_zimra', NULL, 'tax_authority_nta_or_zimra', 'not_revenue_tax_liability_settlement',
    'GLOBAL', ARRAY['JPY', 'USD', 'ZWG'], 'statutory_calculation', NULL, NULL, 2,
    'statutory_tax_return_filing', NULL,
    'statutory_tax_credit_only',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[],
    'tax_remittance_receipt_reconciliation', 'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'PRODUCT',
    'Category C statutory remittance; never exposed via customer Checkout (PAY-09).',
    NULL, NULL
  ),
  (
    'cap.equity.founder_contribution', 1, 'capital_treasury',
    'Founder & Shareholder Equity Capital Contribution',
    'equity_capital_contribution', 'category_c_corporate_treasury',
    'corporate_treasury', 'organizations', 'founder_or_shareholder',
    'carup_corporate_entity', 'carup_corporate_treasury', NULL, 'carup_corporate_treasury', 'not_revenue_balance_sheet_equity',
    'GLOBAL', ARRAY['USD', 'JPY'], 'treasury_entry', NULL, NULL, 2,
    'capital_contribution_non_operating', NULL,
    'prohibited_capital_movement',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[],
    'board_resolution_and_bank_treasury_receipt', 'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'OWNER AUTHORITY',
    'Category C capital contribution; strictly prohibited from product Checkout and operating revenue reports (PAY-09).',
    NULL, NULL
  ),
  (
    'cap.equity.shareholder_distribution', 1, 'capital_treasury',
    'Shareholder Dividend & Equity Distribution',
    'shareholder_dividend_distribution', 'category_c_corporate_treasury',
    'corporate_treasury', 'organizations', 'carup_corporate_treasury',
    'shareholder', 'shareholder', NULL, 'carup_corporate_treasury', 'not_revenue_equity_distribution',
    'GLOBAL', ARRAY['USD', 'JPY'], 'treasury_entry', NULL, NULL, 2,
    'dividend_withholding_tax', NULL,
    'prohibited_capital_movement',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[],
    'board_resolution_and_bank_treasury_disbursement', 'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'OWNER AUTHORITY',
    'Category C equity distribution; strictly prohibited from product Checkout (PAY-09).',
    NULL, NULL
  ),
  (
    'cap.debt.corporate_facility', 1, 'capital_treasury',
    'Corporate Debt Facility Drawdown & Principal Repayment',
    'corporate_debt_drawdown_or_repayment', 'category_c_corporate_treasury',
    'corporate_treasury', 'organizations', 'corporate_lender_or_carup_treasury',
    'corporate_lender', 'carup_treasury_or_corporate_lender', NULL, 'carup_corporate_treasury', 'not_revenue_balance_sheet_debt',
    'GLOBAL', ARRAY['USD', 'JPY'], 'treasury_entry', NULL, NULL, 2,
    'corporate_interest_deductibility_rules', NULL,
    'prohibited_capital_movement',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[],
    'loan_agreement_and_treasury_reconciliation', 'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'OWNER AUTHORITY',
    'Category C corporate debt movement; never operating revenue or product Checkout (PAY-09).',
    NULL, NULL
  ),
  (
    'cap.jv.joint_venture_funding', 1, 'capital_treasury',
    'Joint-Venture & Strategic Partner Capital Allocation',
    'joint_venture_capital_transfer', 'category_c_corporate_treasury',
    'corporate_treasury', 'organizations', 'jv_partner_or_carup_treasury',
    'jv_counterparty', 'jv_vehicle_or_treasury_account', NULL, 'jv_designated_custody_account', 'not_revenue_jv_capital',
    'GLOBAL', ARRAY['USD', 'JPY'], 'treasury_entry', NULL, NULL, 2,
    'jv_agreement_tax_treatment', NULL,
    'prohibited_capital_movement',
    ARRAY[]::text[], ARRAY['stripe_carup_japan_sandbox', 'paynow_zimbabwe', 'garage_recorded_external'],
    ARRAY[]::text[],
    'jv_governance_and_bank_reconciliation', 'internal_treasury_prohibited', true,
    'blocked', 'CONCEPT ONLY', 'OWNER AUTHORITY',
    'Category C joint-venture capital movement; strictly prohibited from product Checkout (PAY-09).',
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
