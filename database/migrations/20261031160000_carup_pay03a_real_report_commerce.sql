-- +migrate Up
-- CARUP-PAY-03A (R1) — Real Vehicle History Report Sandbox Commerce, Atomic Report Fulfillment & Entitlement Revocation
-- Authority: GitHub Issue #247 & Moderator CARUP-PAY-03A-R1 Directive
-- Additive, idempotent, non-production test/sandbox migration.
-- Preserves canonical `public.vehicles` and `public.report_versions` ownership, triggers, and RLS.
-- Contains NO synthetic vehicle seeds and NO fallback canonical table replacements.
BEGIN;

-- 1. Explicit canonical schema dependency checks (R1-A & R1-C).
--    Fails deterministically if PAY-02 foundation tables or canonical vehicle/report tables are absent.
DO $$
BEGIN
  IF to_regclass('public.payment_transactions') IS NULL
     OR to_regclass('public.pay02_commercial_quotes') IS NULL
     OR to_regclass('public.pay02_report_orders') IS NULL THEN
    RAISE EXCEPTION 'PAY03A_REQUIRES_PAY02_FOUNDATION_SCHEMA';
  END IF;

  IF to_regclass('public.vehicles') IS NULL
     OR to_regclass('public.report_versions') IS NULL THEN
    RAISE EXCEPTION 'PAY03A_REQUIRES_CANONICAL_VEHICLE_AND_REPORT_SCHEMA';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.report_versions'::regclass
      AND tgname = 'trg_report_version_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'PAY03A_REQUIRES_CANONICAL_REPORT_VERSION_GUARD';
  END IF;
END $$;

-- 2. Minimal additive PAY-03A commercial snapshot columns on `public.report_versions` (R1-C & R1-D).
--    Distinguishes legacy Milestone 4 report versions (`legacy_version`) from paid PAY-03A
--    commercial snapshots (`pay03a_commercial_snapshot`) bound to `public.pay02_report_orders`.
ALTER TABLE public.report_versions
  ADD COLUMN IF NOT EXISTS report_tier text NOT NULL DEFAULT 'legacy_version'
    CHECK (report_tier IN ('legacy_version', 'pay03a_commercial_snapshot')),
  ADD COLUMN IF NOT EXISTS pay03a_order_id uuid
    REFERENCES public.pay02_report_orders(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_versions_pay03a_order_id
  ON public.report_versions(pay03a_order_id)
  WHERE pay03a_order_id IS NOT NULL;

-- 3. Additive immutability guard for PAY-03A commercial binding columns on `public.report_versions`.
--    Does NOT replace `carup_report_version_guard()` or `trg_report_version_guard`.
CREATE OR REPLACE FUNCTION public.pay03a_report_version_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.report_tier IS DISTINCT FROM OLD.report_tier
     OR NEW.pay03a_order_id IS DISTINCT FROM OLD.pay03a_order_id THEN
    RAISE EXCEPTION 'PAY03A_REPORT_VERSION_COMMERCIAL_BINDING_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pay03a_report_version_binding_guard ON public.report_versions;
CREATE TRIGGER trg_pay03a_report_version_binding_guard
  BEFORE UPDATE ON public.report_versions
  FOR EACH ROW EXECUTE FUNCTION public.pay03a_report_version_binding_guard();

-- Preserve existing table grants on `public.report_versions` while ensuring `service_role` can read/write.
GRANT SELECT, INSERT, UPDATE ON TABLE public.report_versions TO service_role;

-- Additive RESTRICTIVE policy on `public.report_versions`:
-- Legacy report versions (`report_tier = 'legacy_version' AND pay03a_order_id IS NULL`) remain governed
-- by their existing Milestone 4 RLS policies unchanged. Paid commercial snapshots cannot be read directly
-- via PostgREST by `anon` or `authenticated`, enforcing server-side entitlement verification.
DROP POLICY IF EXISTS pay03a_paid_report_entitlement_guard ON public.report_versions;
CREATE POLICY pay03a_paid_report_entitlement_guard
  ON public.report_versions
  AS RESTRICTIVE
  FOR SELECT
  TO anon, authenticated
  USING (
    report_tier = 'legacy_version'
    AND pay03a_order_id IS NULL
  );

-- 4. Upgrade `public.pay02_sync_quote_from_canonical_payment` so refund_pending/refunded
--    also revokes any bound `public.report_versions` snapshot and invalidates share access.
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
        IF v_report_order.report_version_id IS NOT NULL THEN
          UPDATE public.report_versions
            SET revoked = true,
                correction_notice = coalesce(correction_notice, 'Entitlement suspended while refund is pending.')
            WHERE id = v_report_order.report_version_id;
        END IF;
      ELSIF v_payment.status = 'refunded' THEN
        UPDATE public.pay02_report_orders
          SET entitlement_status = 'revoked_refunded',
              revoked_at = coalesce(revoked_at, now()),
              updated_at = now()
          WHERE id = v_report_order.id
          RETURNING * INTO v_report_order;
        IF v_report_order.report_version_id IS NOT NULL THEN
          UPDATE public.report_versions
            SET revoked = true,
                correction_notice = 'Entitlement revoked following governed payment refund.'
            WHERE id = v_report_order.report_version_id;
        END IF;
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
    'report_entitlement_status', v_report_order.entitlement_status,
    'vin', v_report_order.vin
  );
END $$;

-- 5. Atomic, Concurrency-Safe Report Fulfillment RPC (`public.pay03a_complete_report_fulfillment`)
CREATE OR REPLACE FUNCTION public.pay03a_complete_report_fulfillment(
  p_order_id uuid,
  p_buyer_id text,
  p_vin text,
  p_payload jsonb,
  p_content_hash text,
  p_completeness jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.pay02_report_orders%ROWTYPE;
  v_quote public.pay02_commercial_quotes%ROWTYPE;
  v_payment public.payment_transactions%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_report_ver public.report_versions%ROWTYPE;
  v_prev_max_ver integer;
  v_next_ver integer;
  v_generated_by text;
BEGIN
  IF p_order_id IS NULL
     OR coalesce(length(trim(p_buyer_id)), 0) = 0
     OR coalesce(length(trim(p_vin)), 0) = 0
     OR p_payload IS NULL
     OR coalesce(length(trim(p_content_hash)), 0) = 0 THEN
    RAISE EXCEPTION 'PAY03A_INVALID_FULFILLMENT_PARAMETERS';
  END IF;

  SELECT * INTO v_order FROM public.pay02_report_orders
    WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE';
  END IF;

  SELECT * INTO v_quote FROM public.pay02_commercial_quotes
    WHERE id = v_order.quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY02_PILOT_QUOTE_NOT_FOUND';
  END IF;

  SELECT * INTO v_payment FROM public.payment_transactions
    WHERE reference = v_order.payment_reference FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY02_PILOT_CANONICAL_PAYMENT_MISSING';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles
    WHERE vin = trim(p_vin) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY02_PILOT_VEHICLE_RECORD_NOT_FOUND';
  END IF;

  -- Mandatory non-null bidirectional cross-reference checks
  IF v_order.buyer_id <> trim(p_buyer_id)
     OR v_quote.payer_id <> trim(p_buyer_id)
     OR v_payment.pay01a_actor_id <> trim(p_buyer_id)
     OR v_order.vin <> trim(p_vin)
     OR v_quote.source_object_type <> 'vehicles'
     OR v_quote.source_object_id <> trim(p_vin)
     OR v_order.product_code <> 'intel.report.vehicle_history_single'
     OR v_quote.product_code <> 'intel.report.vehicle_history_single'
     OR v_order.product_version <> v_quote.product_version
     OR v_order.quote_id IS NULL
     OR v_order.quote_id <> v_quote.id
     OR v_quote.payment_reference IS NULL
     OR v_order.payment_reference IS NULL
     OR v_quote.payment_reference <> v_payment.reference
     OR v_order.payment_reference <> v_payment.reference THEN
    RAISE EXCEPTION 'PAY02_PILOT_ORDER_CORRELATION_MISMATCH';
  END IF;

  IF v_payment.gateway <> 'stripe_carup_japan_sandbox'
     OR v_payment.pay01a_account_id IS DISTINCT FROM 'acct_1UVnGaEjgXqvlsJk'
     OR v_payment.pay02_quote_id IS NULL
     OR v_payment.pay02_quote_id <> v_quote.id
     OR v_payment.amount <> v_quote.total_minor
     OR v_payment.currency <> v_quote.currency THEN
    RAISE EXCEPTION 'PAY02_PILOT_CANONICAL_PAYMENT_MISMATCH';
  END IF;

  IF v_payment.status = 'refund_pending' OR v_order.entitlement_status = 'refund_suspended' THEN
    RAISE EXCEPTION 'PAY02_PILOT_ENTITLEMENT_SUSPENDED_ON_REFUND_PENDING';
  END IF;

  IF v_payment.status = 'refunded'
     OR v_order.entitlement_status = 'revoked_refunded'
     OR v_order.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'PAY02_PILOT_ENTITLEMENT_REVOKED_ON_REFUND';
  END IF;

  IF v_payment.status <> 'paid'
     OR v_payment.pay01a_checkout_id IS NULL
     OR v_payment.pay01a_intent_id IS NULL
     OR v_order.entitlement_status <> 'entitled'
     OR v_order.granted_at IS NULL THEN
    RAISE EXCEPTION 'PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE';
  END IF;

  -- Idempotent replay: if a concurrent call already bound `report_version_id`, return that exact version
  IF v_order.report_version_id IS NOT NULL THEN
    SELECT * INTO v_report_ver FROM public.report_versions
      WHERE id = v_order.report_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PAY03A_BOUND_REPORT_VERSION_MISSING';
    END IF;
    IF v_report_ver.revoked THEN
      RAISE EXCEPTION 'PAY02_PILOT_ENTITLEMENT_REVOKED_ON_REFUND';
    END IF;
    IF v_quote.status <> 'fulfilled' THEN
      UPDATE public.pay02_commercial_quotes
        SET status = 'fulfilled', updated_at = now()
        WHERE id = v_quote.id
        RETURNING * INTO v_quote;
    END IF;
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'quote_id', v_quote.id,
      'quote_status', v_quote.status,
      'payment_reference', v_payment.reference,
      'report_version_id', v_report_ver.id,
      'report_version_number', v_report_ver.version,
      'report_content_hash', v_report_ver.content_hash,
      'completeness_summary', v_report_ver.completeness,
      'payload', v_report_ver.payload,
      'report_tier', v_report_ver.report_tier,
      'idempotent_replay', true
    );
  END IF;

  SELECT coalesce(max(version), 0) INTO v_prev_max_ver
    FROM public.report_versions
    WHERE vin = trim(p_vin);
  v_next_ver := v_prev_max_ver + 1;

  v_generated_by := NULL;
  IF to_regclass('public.users') IS NOT NULL THEN
    SELECT id INTO v_generated_by FROM public.users WHERE id = trim(p_buyer_id);
  END IF;

  INSERT INTO public.report_versions (
    vin, version, generated_at, generated_by, payload, content_hash, completeness,
    supersedes_version, report_tier, pay03a_order_id
  ) VALUES (
    trim(p_vin), v_next_ver, now(), v_generated_by, p_payload, trim(p_content_hash),
    coalesce(p_completeness, '{}'::jsonb),
    CASE WHEN v_prev_max_ver > 0 THEN v_prev_max_ver ELSE NULL END,
    'pay03a_commercial_snapshot',
    v_order.id
  )
  RETURNING * INTO v_report_ver;

  UPDATE public.pay02_report_orders
    SET report_version_id = v_report_ver.id,
        report_version_number = v_report_ver.version,
        report_content_hash = v_report_ver.content_hash,
        completeness_summary = v_report_ver.completeness,
        updated_at = now()
    WHERE id = v_order.id AND report_version_id IS NULL
    RETURNING * INTO v_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY03A_ORDER_FULFILLMENT_BIND_FAILED';
  END IF;

  UPDATE public.pay02_commercial_quotes
    SET status = 'fulfilled',
        updated_at = now()
    WHERE id = v_quote.id
    RETURNING * INTO v_quote;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY03A_QUOTE_FULFILLMENT_UPDATE_FAILED';
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'quote_id', v_quote.id,
    'quote_status', v_quote.status,
    'payment_reference', v_payment.reference,
    'report_version_id', v_report_ver.id,
    'report_version_number', v_report_ver.version,
    'report_content_hash', v_report_ver.content_hash,
    'completeness_summary', v_report_ver.completeness,
    'payload', v_report_ver.payload,
    'report_tier', v_report_ver.report_tier,
    'idempotent_replay', false
  );
END $$;

REVOKE ALL ON FUNCTION public.pay02_sync_quote_from_canonical_payment(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03a_complete_report_fulfillment(uuid, text, text, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pay02_sync_quote_from_canonical_payment(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03a_complete_report_fulfillment(uuid, text, text, jsonb, text, jsonb) TO service_role;

COMMIT;

-- +migrate Down
DO $$ BEGIN RAISE EXCEPTION 'PAY03A_RETAIN_REPORT_COMMERCE_AND_AUDIT_EVIDENCE'; END $$;
