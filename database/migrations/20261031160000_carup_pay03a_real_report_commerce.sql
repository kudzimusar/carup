-- +migrate Up
-- CARUP-PAY-03A — Real Vehicle History Report Sandbox Commerce, Atomic Report Fulfillment & Entitlement Revocation
-- Authority: GitHub Issue #247 & Moderator CARUP-PAY-03A Directive
-- Additive, idempotent, non-production test/sandbox migration.
-- Reuses `public.payment_transactions`, `public.pay02_commercial_quotes`, `public.pay02_report_orders`, and `public.report_versions`.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.payment_transactions') IS NULL
     OR to_regclass('public.pay02_commercial_quotes') IS NULL
     OR to_regclass('public.pay02_report_orders') IS NULL THEN
    RAISE EXCEPTION 'PAY03A_REQUIRES_PAY02_FOUNDATION_SCHEMA';
  END IF;
END $$;

-- 1. Ensure canonical vehicle and report snapshot tables exist in isolated test DBs.
CREATE TABLE IF NOT EXISTS public.vehicles (
  vin text PRIMARY KEY,
  make text NOT NULL,
  model text NOT NULL,
  generation text,
  trim text,
  year integer NOT NULL,
  color text,
  mileage integer NOT NULL DEFAULT 0,
  fuel_type text,
  drivetrain text,
  transmission text,
  import_source text,
  duty_paid boolean DEFAULT false,
  police_verified boolean DEFAULT false,
  status text DEFAULT 'Available',
  trust_score real DEFAULT 80.0,
  price real NOT NULL DEFAULT 0,
  currency text DEFAULT 'USD',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin text NOT NULL REFERENCES public.vehicles(vin) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  completeness jsonb NOT NULL DEFAULT '{}'::jsonb,
  share_token text UNIQUE,
  share_expires_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  correction_notice text,
  supersedes_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vin, version)
);

CREATE INDEX IF NOT EXISTS idx_report_versions_vin ON public.report_versions(vin, version DESC);
CREATE INDEX IF NOT EXISTS idx_report_versions_share ON public.report_versions(share_token) WHERE share_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.carup_report_version_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.vin IS DISTINCT FROM OLD.vin THEN
    RAISE EXCEPTION 'report_versions content is immutable; only share/revocation/correction fields may change';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_report_version_guard ON public.report_versions;
CREATE TRIGGER trg_report_version_guard
  BEFORE UPDATE ON public.report_versions
  FOR EACH ROW EXECUTE FUNCTION public.carup_report_version_guard();

ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.report_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.report_versions TO service_role;

-- 2. Seed deterministic real test vehicles in isolated test DBs if not already present.
INSERT INTO public.vehicles (
  vin, make, model, generation, trim, year, color, mileage,
  fuel_type, drivetrain, transmission, import_source, duty_paid, police_verified,
  status, trust_score, price, currency
) VALUES
  (
    'WBA3A5C51DF358101', 'BMW', '320i', 'F30', 'M Sport', 2019, 'Alpine White', 54200,
    'Petrol', 'RWD', 'Automatic', 'Japan (Yokohama)', true, true,
    'Available', 91.5, 16800, 'USD'
  ),
  (
    'JTDBR32E820112202', 'Toyota', 'Hilux', 'AN120', 'GD-6 Double Cab', 2021, 'Silver Metallic', 68400,
    'Diesel', '4WD', 'Automatic', 'Japan (Nagoya)', true, true,
    'Available', 94.0, 34500, 'USD'
  ),
  (
    'DBA-GRS204-0005303', 'Toyota', 'Crown Athlete', 'S200', '3.5G Package', 2016, 'Pearl Black', 81900,
    'Petrol', 'RWD', 'Automatic', 'Japan (Osaka)', false, true,
    'In Transit', 86.0, 12900, 'USD'
  )
ON CONFLICT (vin) DO NOTHING;

-- 3. Upgrade `public.pay02_sync_quote_from_canonical_payment` so refund_pending/refunded
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

-- 4. Atomic, Concurrency-Safe Report Fulfillment RPC (`public.pay03a_complete_report_fulfillment`)
--    Enforces Section 7.2, 7.3 & 7.4:
--    - Locks `pay02_report_orders`, `pay02_commercial_quotes`, and `payment_transactions` `FOR UPDATE`.
--    - Verifies all mandatory non-null bidirectional correlations (`quote_id`, `payment_reference`,
--      `buyer_id`, `vin`, `product_code`, `product_version`, `pay01a_account_id`, `amount`, `currency`).
--    - If `report_version_id` is already bound on `pay02_report_orders`, returns the existing version
--      with `idempotent_replay = true` without inserting a duplicate `report_versions` row!
--    - Otherwise, serializes on `vehicles(vin) FOR UPDATE`, inserts the single `report_versions` row,
--      binds `report_version_id` on `pay02_report_orders`, marks `pay02_commercial_quotes.status = 'fulfilled'`,
--      and returns the bound snapshot.
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

  -- Mandatory non-null bidirectional cross-reference checks (Section 7.2)
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

  -- Idempotent replay: if a concurrent call already bound `report_version_id`, return that exact version!
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
      'idempotent_replay', true
    );
  END IF;

  SELECT coalesce(max(version), 0) INTO v_prev_max_ver
    FROM public.report_versions
    WHERE vin = trim(p_vin);
  v_next_ver := v_prev_max_ver + 1;

  INSERT INTO public.report_versions (
    vin, version, generated_at, generated_by, payload, content_hash, completeness, supersedes_version
  ) VALUES (
    trim(p_vin), v_next_ver, now(), NULL, p_payload, trim(p_content_hash),
    coalesce(p_completeness, '{}'::jsonb),
    CASE WHEN v_prev_max_ver > 0 THEN v_prev_max_ver ELSE NULL END
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
