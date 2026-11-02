-- +migrate Up
-- CARUP-PAY-03B-LR01 Work Unit 01 — F5 cross-cutting payment integrity.
--
-- A refund that conflicts with CarUp's approved full-refund-only policy (typically a PARTIAL refund created
-- directly in the Stripe dashboard) used to make evaluatePay01aProviderSnapshot throw
-- PAY01A_PARTIAL_REFUND_NOT_AUTHORIZED. Nothing was recorded, the canonical payment stayed 'paid', and the paid
-- report and its share links stayed available. This migration makes that evidence a durable reconciliation hold.
--
-- * public.payment_transactions remains the ONLY money ledger. Two values join its status vocabulary. That
--   vocabulary has no CHECK; the RPCs below enforce it. Neither value is 'paid', so every existing read path,
--   all of which test status = 'paid', fails closed:
--     reconciliation_hold  provider refund evidence conflicts with policy. Access is suspended, not revoked. The
--                          hold is sticky: a later provider lookup (even one showing the refund failed) never
--                          lifts it. Only two things end it: a provider-confirmed FULL refund (-> refunded), or an
--                          authorized operator resolution backed by a fresh, verified provider state.
--     partially_refunded   terminal. An operator confirmed the partial refund stands and access is revoked.
-- * public.pay03b_payment_reconciliation_exceptions is the auditable exception AND the operator alert record.
--   Its first-detection evidence is immutable, and a closed exception is immutable.
-- * pay03b_apply_provider_payment_snapshot is the canonical provider-state writer. pay01a_apply_provider_snapshot
--   keeps its exact signature and delegates to it, so no stale caller can clear a hold.
-- * pay02_sync_quote_from_canonical_payment is re-created from 20261101100000 with two bounded branches:
--   reconciliation_hold suspends (refund_suspended, snapshot kept); partially_refunded revokes order and snapshot.
-- * pay01a_begin_refund may begin a refund that completes a held partial refund to the full amount. The payment
--   stays held until the provider confirms the full refund.
-- * Convergence: a first provider observation may move 'pending' straight to refund_pending / refunded /
--   reconciliation_hold, so an out-of-order or late event can never wedge a payment in 'pending'. Every one of
--   those states denies access.
--
-- Applied migrations are never edited. This file must run after 20261101100000.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.payment_transactions') IS NULL
     OR to_regclass('public.pay01a_stripe_event_receipts') IS NULL
     OR to_regprocedure('public.pay01a_apply_provider_snapshot(text,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.pay01a_begin_refund(text,text)') IS NULL
     OR to_regprocedure('public.pay02_sync_quote_from_canonical_payment(text)') IS NULL
     OR to_regprocedure('public.pay03a_complete_report_fulfillment(uuid,text,text,jsonb,text,jsonb)') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'PAY03B_F5_REQUIRES_PAY01A_PAY02_PAY03A_AND_20261101100000';
  END IF;
END $$;

-- 1. Durable reconciliation exception (also the operator alert record).
CREATE TABLE IF NOT EXISTS public.pay03b_payment_reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_reference text NOT NULL REFERENCES public.payment_transactions(reference),
  exception_type text NOT NULL CHECK (exception_type IN ('partial_refund_policy_conflict')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'superseded')),
  severity text NOT NULL DEFAULT 'high' CHECK (severity IN ('high', 'critical')),
  gateway text NOT NULL CHECK (length(trim(gateway)) > 0),
  provider_account_id text NOT NULL CHECK (length(trim(provider_account_id)) > 0),
  provider_payment_intent_id text NOT NULL CHECK (provider_payment_intent_id ~ '^(pi|sim_pi)_[A-Za-z0-9_]+$'),
  payment_amount_minor bigint NOT NULL CHECK (payment_amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  prior_payment_status text NOT NULL CHECK (prior_payment_status IN ('pending', 'paid', 'refund_pending')),
  -- First-detection evidence (immutable).
  mismatch text NOT NULL CHECK (mismatch IN ('partial_refund_succeeded', 'partial_refund_pending')),
  detected_refunded_minor bigint NOT NULL CHECK (detected_refunded_minor >= 0),
  detected_pending_refund_minor bigint NOT NULL CHECK (detected_pending_refund_minor >= 0),
  detected_refund_ids text[] NOT NULL CHECK (cardinality(detected_refund_ids) > 0),
  detected_via text NOT NULL CHECK (detected_via IN ('signed_webhook', 'provider_readback')),
  detection_event_id text CHECK (detection_event_id IS NULL OR detection_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  detection_event_type text,
  first_detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Latest observation (moves while the exception is open).
  observation_count integer NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
  last_observed_status text NOT NULL CHECK (last_observed_status IN ('paid', 'refund_pending', 'reconciliation_hold')),
  last_observed_refunded_minor bigint CHECK (last_observed_refunded_minor IS NULL OR last_observed_refunded_minor >= 0),
  last_observed_pending_refund_minor bigint CHECK (last_observed_pending_refund_minor IS NULL OR last_observed_pending_refund_minor >= 0),
  last_observed_refund_ids text[],
  last_observed_via text NOT NULL CHECK (last_observed_via IN ('signed_webhook', 'provider_readback', 'legacy_snapshot_writer')),
  last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Operator alert acknowledgement (does not resolve anything).
  acknowledged_by text,
  acknowledged_role text,
  acknowledged_at timestamptz,
  -- Closure.
  resolution text CHECK (resolution IS NULL OR resolution IN (
    'restore_access_provider_unrefunded', 'revoke_access_partial_refund_final', 'superseded_provider_full_refund'
  )),
  resolved_by text,
  resolved_role text,
  resolution_note text,
  resolution_evidence jsonb,
  resolved_at timestamptz,
  CONSTRAINT pay03b_exception_open_has_no_resolution CHECK ((status = 'open') = (resolution IS NULL)),
  CONSTRAINT pay03b_exception_resolution_matches_status CHECK (
    status = 'open'
    OR (status = 'superseded' AND resolution = 'superseded_provider_full_refund')
    OR (status = 'resolved' AND resolution IN ('restore_access_provider_unrefunded', 'revoke_access_partial_refund_final'))
  ),
  CONSTRAINT pay03b_exception_closure_is_attributed CHECK (
    status = 'open'
    OR (resolved_by IS NOT NULL AND resolved_role IS NOT NULL AND resolved_at IS NOT NULL
        AND resolution_evidence IS NOT NULL AND length(trim(coalesce(resolution_note, ''))) >= 10)
  ),
  CONSTRAINT pay03b_exception_acknowledgement_complete CHECK (
    (acknowledged_at IS NULL) = (acknowledged_by IS NULL) AND (acknowledged_at IS NULL) = (acknowledged_role IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS pay03b_one_open_reconciliation_exception_per_payment
  ON public.pay03b_payment_reconciliation_exceptions (payment_reference)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS pay03b_reconciliation_exceptions_open_by_time
  ON public.pay03b_payment_reconciliation_exceptions (status, first_detected_at DESC);

CREATE OR REPLACE FUNCTION public.pay03b_guard_reconciliation_exception()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAY03B_RECONCILIATION_EXCEPTION_DELETE_FORBIDDEN';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'PAY03B_RECONCILIATION_EXCEPTION_CLOSED_IMMUTABLE';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
     OR NEW.exception_type IS DISTINCT FROM OLD.exception_type
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.gateway IS DISTINCT FROM OLD.gateway
     OR NEW.provider_account_id IS DISTINCT FROM OLD.provider_account_id
     OR NEW.provider_payment_intent_id IS DISTINCT FROM OLD.provider_payment_intent_id
     OR NEW.payment_amount_minor IS DISTINCT FROM OLD.payment_amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.prior_payment_status IS DISTINCT FROM OLD.prior_payment_status
     OR NEW.mismatch IS DISTINCT FROM OLD.mismatch
     OR NEW.detected_refunded_minor IS DISTINCT FROM OLD.detected_refunded_minor
     OR NEW.detected_pending_refund_minor IS DISTINCT FROM OLD.detected_pending_refund_minor
     OR NEW.detected_refund_ids IS DISTINCT FROM OLD.detected_refund_ids
     OR NEW.detected_via IS DISTINCT FROM OLD.detected_via
     OR NEW.detection_event_id IS DISTINCT FROM OLD.detection_event_id
     OR NEW.detection_event_type IS DISTINCT FROM OLD.detection_event_type
     OR NEW.first_detected_at IS DISTINCT FROM OLD.first_detected_at THEN
    RAISE EXCEPTION 'PAY03B_RECONCILIATION_EVIDENCE_IMMUTABLE';
  END IF;
  IF NEW.observation_count < OLD.observation_count OR NEW.last_observed_at < OLD.last_observed_at THEN
    RAISE EXCEPTION 'PAY03B_RECONCILIATION_OBSERVATION_REGRESSION';
  END IF;
  IF OLD.acknowledged_at IS NOT NULL AND (
       NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
       OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by
       OR NEW.acknowledged_role IS DISTINCT FROM OLD.acknowledged_role) THEN
    RAISE EXCEPTION 'PAY03B_RECONCILIATION_ACKNOWLEDGEMENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pay03b_reconciliation_exception_guard ON public.pay03b_payment_reconciliation_exceptions;
CREATE TRIGGER trg_pay03b_reconciliation_exception_guard
  BEFORE UPDATE OR DELETE ON public.pay03b_payment_reconciliation_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.pay03b_guard_reconciliation_exception();

ALTER TABLE public.pay03b_payment_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pay03b_payment_reconciliation_exceptions FROM PUBLIC, anon, authenticated, service_role;
-- Read-only for the backend. Every write goes through the SECURITY DEFINER functions below.
GRANT SELECT ON TABLE public.pay03b_payment_reconciliation_exceptions TO service_role;

-- 2. Shared hold/exception logic for any canonical Stripe-sandbox payment row, in two internal steps so a writer
--    can validate and compute the target, de-duplicate the provider event, and only then record anything.
--    Neither function is granted to any API role: only SECURITY DEFINER writers that already hold the
--    per-reference advisory lock and the row lock call them.
CREATE OR REPLACE FUNCTION public.pay03b_payment_transition_target(
  p_row public.payment_transactions,
  p_amount_minor bigint,
  p_status text,
  p_intent_id text,
  p_refund_id text,
  p_refunded_minor bigint,
  p_pending_refund_minor bigint,
  p_refund_ids text[],
  p_mismatch text,
  p_detected_via text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_target text := p_status;
  v_retained boolean := false;
  v_ref text;
  v_intent_pattern text;
  v_refund_pattern text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded', 'reconciliation_hold') THEN
    RAISE EXCEPTION 'PAY01A_STATUS_INVALID';
  END IF;
  IF p_detected_via IS NOT NULL AND p_detected_via NOT IN ('signed_webhook', 'provider_readback') THEN
    RAISE EXCEPTION 'PAY03B_DETECTION_SOURCE_INVALID';
  END IF;

  -- A held or finally-revoked payment never returns to an access-granting state from a provider observation;
  -- only a provider-confirmed full refund (or the operator resolution RPC) moves it.
  IF p_row.status = 'reconciliation_hold' THEN
    IF p_status = 'refunded' THEN
      v_target := 'refunded';
    ELSIF p_status IN ('paid', 'refund_pending', 'reconciliation_hold') THEN
      v_target := 'reconciliation_hold';
      v_retained := p_status <> 'reconciliation_hold';
    ELSE
      RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
    END IF;
  ELSIF p_row.status = 'partially_refunded' THEN
    IF p_status = 'refunded' THEN
      v_target := 'refunded';
    ELSIF p_status IN ('paid', 'refund_pending', 'reconciliation_hold') THEN
      v_target := 'partially_refunded';
      v_retained := true;
    ELSE
      RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
    END IF;
  ELSIF NOT (
    (p_row.status = 'pending' AND p_status IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded', 'reconciliation_hold'))
    OR (p_row.status = 'paid' AND p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold'))
    OR (p_row.status = 'refund_pending' AND p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold'))
    OR (p_row.status = 'refunded' AND p_status = 'refunded')
    OR (p_row.status = 'cancelled' AND p_status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
  END IF;

  -- Provider identifier shapes are bound to the payment's gateway (the local UAT simulator never passes as Stripe).
  v_intent_pattern := CASE WHEN p_row.gateway = 'pay03b_local_provider_simulator' THEN '^sim_pi_[A-Za-z0-9_]+$'
                           ELSE '^pi_[A-Za-z0-9_]+$' END;
  v_refund_pattern := CASE WHEN p_row.gateway = 'pay03b_local_provider_simulator' THEN '^sim_re_[A-Za-z0-9_]+$'
                           ELSE '^(re|pyr)_[A-Za-z0-9_]+$' END;
  -- Leaving a hold (or a final partial refund) for 'refunded' requires the provider's full-refund evidence: a caller
  -- without amounts (for example the legacy PAY-01A writer) cannot close an exception as a "provider full refund".
  IF p_row.status IN ('reconciliation_hold', 'partially_refunded') AND v_target = 'refunded'
     AND (p_refunded_minor IS DISTINCT FROM p_amount_minor OR coalesce(p_pending_refund_minor, 0) <> 0) THEN
    RAISE EXCEPTION 'PAY03B_FULL_REFUND_EVIDENCE_REQUIRED';
  END IF;

  IF p_status IN ('paid', 'refund_pending', 'refunded', 'reconciliation_hold') AND
    (p_intent_id IS NULL OR p_intent_id !~ v_intent_pattern) THEN
    RAISE EXCEPTION 'PAY01A_PAYMENT_INTENT_REQUIRED';
  END IF;
  IF p_row.pay01a_intent_id IS NOT NULL AND p_intent_id IS NOT NULL
     AND p_intent_id IS DISTINCT FROM p_row.pay01a_intent_id THEN
    RAISE EXCEPTION 'PAY01A_PAYMENT_INTENT_CHANGE_REFUSED';
  END IF;
  IF p_refund_id IS NOT NULL AND p_refund_id !~ v_refund_pattern THEN
    RAISE EXCEPTION 'PAY01A_REFUND_REFERENCE_INVALID';
  END IF;
  IF p_row.pay01a_refund_id IS NOT NULL AND p_refund_id IS NOT NULL AND p_refund_id <> p_row.pay01a_refund_id THEN
    RAISE EXCEPTION 'PAY01A_REFUND_REFERENCE_CHANGE_REFUSED';
  END IF;

  -- Policy-conflict evidence must be complete and internally consistent before it can hold a payment.
  IF p_status = 'reconciliation_hold' THEN
    IF p_mismatch IS NULL OR p_mismatch NOT IN ('partial_refund_succeeded', 'partial_refund_pending')
       OR p_amount_minor IS NULL OR p_amount_minor <= 0
       OR p_refunded_minor IS NULL OR p_pending_refund_minor IS NULL
       OR p_refunded_minor < 0 OR p_pending_refund_minor < 0
       OR p_refunded_minor + p_pending_refund_minor > p_amount_minor
       OR (p_mismatch = 'partial_refund_succeeded'
           AND (p_refunded_minor <= 0 OR p_refunded_minor >= p_amount_minor))
       OR (p_mismatch = 'partial_refund_pending'
           AND (p_refunded_minor <> 0 OR p_pending_refund_minor <= 0 OR p_pending_refund_minor >= p_amount_minor))
       OR p_refund_ids IS NULL OR cardinality(p_refund_ids) = 0
       OR p_detected_via IS NULL
       OR p_refund_id IS NOT NULL THEN
      RAISE EXCEPTION 'PAY03B_RECONCILIATION_EVIDENCE_INVALID';
    END IF;
    FOREACH v_ref IN ARRAY p_refund_ids LOOP
      IF v_ref IS NULL OR v_ref !~ v_refund_pattern THEN
        RAISE EXCEPTION 'PAY03B_RECONCILIATION_EVIDENCE_INVALID';
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('target_status', v_target, 'hold_retained', v_retained);
END $$;

CREATE OR REPLACE FUNCTION public.pay03b_record_payment_hold(
  p_row public.payment_transactions,
  p_amount_minor bigint,
  p_target text,
  p_status text,
  p_intent_id text,
  p_refund_id text,
  p_event_id text,
  p_event_type text,
  p_refunded_minor bigint,
  p_pending_refund_minor bigint,
  p_refund_ids text[],
  p_mismatch text,
  p_detected_via text
)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_exception public.pay03b_payment_reconciliation_exceptions%ROWTYPE;
  v_exception_event text := NULL;
BEGIN
  IF p_target = 'reconciliation_hold' THEN
    SELECT * INTO v_exception FROM public.pay03b_payment_reconciliation_exceptions
      WHERE payment_reference = p_row.reference AND status = 'open'
      FOR UPDATE;
    IF NOT FOUND THEN
      IF p_row.status = 'reconciliation_hold' OR p_status <> 'reconciliation_hold' THEN
        RAISE EXCEPTION 'PAY03B_HOLD_WITHOUT_OPEN_EXCEPTION';
      END IF;
      INSERT INTO public.pay03b_payment_reconciliation_exceptions (
        payment_reference, exception_type, gateway, provider_account_id, provider_payment_intent_id,
        payment_amount_minor, currency, prior_payment_status, mismatch,
        detected_refunded_minor, detected_pending_refund_minor, detected_refund_ids, detected_via,
        detection_event_id, detection_event_type,
        last_observed_status, last_observed_refunded_minor, last_observed_pending_refund_minor,
        last_observed_refund_ids, last_observed_via
      ) VALUES (
        p_row.reference, 'partial_refund_policy_conflict', p_row.gateway, p_row.pay01a_account_id, p_intent_id,
        p_amount_minor, upper(p_row.currency), p_row.status, p_mismatch,
        p_refunded_minor, p_pending_refund_minor, p_refund_ids, p_detected_via,
        p_event_id, p_event_type,
        'reconciliation_hold', p_refunded_minor, p_pending_refund_minor,
        p_refund_ids, p_detected_via
      ) RETURNING * INTO v_exception;
      v_exception_event := 'opened';
    ELSE
      UPDATE public.pay03b_payment_reconciliation_exceptions SET
        observation_count = observation_count + 1,
        last_observed_status = p_status,
        last_observed_refunded_minor = CASE WHEN p_refunded_minor IS NULL THEN last_observed_refunded_minor ELSE p_refunded_minor END,
        last_observed_pending_refund_minor = CASE WHEN p_pending_refund_minor IS NULL THEN last_observed_pending_refund_minor ELSE p_pending_refund_minor END,
        last_observed_refund_ids = CASE WHEN p_refund_ids IS NULL THEN last_observed_refund_ids ELSE p_refund_ids END,
        last_observed_via = coalesce(p_detected_via, 'legacy_snapshot_writer'),
        last_observed_at = greatest(last_observed_at, clock_timestamp())
      WHERE id = v_exception.id
      RETURNING * INTO v_exception;
      v_exception_event := 'observed';
    END IF;
  ELSIF p_target = 'refunded' AND p_row.status = 'reconciliation_hold' THEN
    UPDATE public.pay03b_payment_reconciliation_exceptions SET
      status = 'superseded',
      resolution = 'superseded_provider_full_refund',
      resolved_by = 'provider:' || p_row.gateway,
      resolved_role = 'provider_confirmation',
      resolution_note = 'Provider confirmed a full refund of the held payment; access remains revoked.',
      resolution_evidence = jsonb_build_object(
        'event_id', p_event_id, 'event_type', p_event_type, 'refund_id', p_refund_id,
        'refunded_minor', p_refunded_minor, 'refund_ids', to_jsonb(coalesce(p_refund_ids, '{}'::text[])),
        'detected_via', coalesce(p_detected_via, 'legacy_snapshot_writer')),
      resolved_at = clock_timestamp()
    WHERE payment_reference = p_row.reference AND status = 'open'
    RETURNING * INTO v_exception;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PAY03B_HOLD_WITHOUT_OPEN_EXCEPTION';
    END IF;
    v_exception_event := 'superseded';
  END IF;
  RETURN jsonb_build_object(
    'reconciliation_exception_id', v_exception.id,
    'reconciliation_exception_event', v_exception_event);
END $$;

REVOKE ALL ON FUNCTION public.pay03b_payment_transition_target(public.payment_transactions,bigint,text,text,text,bigint,bigint,text[],text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pay03b_record_payment_hold(public.payment_transactions,bigint,text,text,text,text,text,text,bigint,bigint,text[],text,text)
  FROM PUBLIC, anon, authenticated, service_role;

-- 3. Canonical provider-state writer for PAY-01A Checkout payments (JPY 100, CarUp Japan sandbox account).
CREATE OR REPLACE FUNCTION public.pay03b_apply_provider_payment_snapshot(
  p_reference text,
  p_status text,
  p_intent_id text,
  p_refund_id text,
  p_event_id text DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_refunded_minor bigint DEFAULT NULL,
  p_pending_refund_minor bigint DEFAULT NULL,
  p_refund_ids text[] DEFAULT NULL,
  p_mismatch text DEFAULT NULL,
  p_detected_via text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.payment_transactions%ROWTYPE;
  v_event_reference text;
  v_transition jsonb;
  v_target text;
  v_record jsonb;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded', 'reconciliation_hold') THEN
    RAISE EXCEPTION 'PAY01A_STATUS_INVALID';
  END IF;
  -- F8 lock order: the per-reference advisory lock shared with the PAY-02 sync and PAY-03A fulfillment, then the row.
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || coalesce(p_reference, '')));
  SELECT * INTO v_row FROM public.payment_transactions
    WHERE reference = p_reference AND gateway = 'stripe_carup_japan_sandbox'
    FOR UPDATE;
  IF NOT FOUND OR v_row.pay01a_account_id <> 'acct_1UVnGaEjgXqvlsJk'
    OR v_row.pay01a_checkout_id IS NULL OR v_row.amount <> 100 OR v_row.currency <> 'JPY' THEN
    RAISE EXCEPTION 'PAY01A_CANONICAL_PAYMENT_INVALID';
  END IF;

  -- 1) validate and compute (no writes); 2) claim the provider event once; 3) record and apply.
  v_transition := public.pay03b_payment_transition_target(
    v_row, 100, p_status, p_intent_id, p_refund_id,
    p_refunded_minor, p_pending_refund_minor, p_refund_ids, p_mismatch, p_detected_via);
  v_target := v_transition->>'target_status';

  IF p_event_id IS NOT NULL THEN
    IF p_event_id !~ '^evt_[A-Za-z0-9_]+$' OR p_event_type IS NULL THEN
      RAISE EXCEPTION 'PAY01A_EVENT_IDENTITY_INVALID';
    END IF;
    INSERT INTO public.pay01a_stripe_event_receipts
      (event_id, reference, event_type, resulting_state)
    VALUES (p_event_id, p_reference, p_event_type, v_target)
    ON CONFLICT (event_id) DO NOTHING;
    IF NOT FOUND THEN
      SELECT reference INTO v_event_reference FROM public.pay01a_stripe_event_receipts
        WHERE event_id = p_event_id;
      IF v_event_reference IS DISTINCT FROM p_reference THEN
        RAISE EXCEPTION 'PAY01A_EVENT_CROSS_REFERENCE_REPLAY';
      END IF;
      -- A replayed event changes nothing (not even the exception's observation count).
      RETURN to_jsonb(v_row) || jsonb_build_object(
        'duplicate_event', true, 'hold_retained', false,
        'reconciliation_exception_id', NULL, 'reconciliation_exception_event', NULL);
    END IF;
  END IF;

  v_record := public.pay03b_record_payment_hold(
    v_row, 100, v_target, p_status, p_intent_id, p_refund_id, p_event_id, p_event_type,
    p_refunded_minor, p_pending_refund_minor, p_refund_ids, p_mismatch, p_detected_via);

  IF v_row.status IN ('reconciliation_hold', 'partially_refunded') AND v_target IS DISTINCT FROM v_row.status THEN
    PERFORM set_config('carup.pay03b_hold_release', 'on', true);
  END IF;
  UPDATE public.payment_transactions SET
    status = v_target,
    pay01a_intent_id = coalesce(pay01a_intent_id, p_intent_id),
    pay01a_refund_id = CASE WHEN v_target = 'reconciliation_hold' THEN pay01a_refund_id
                            ELSE coalesce(pay01a_refund_id, p_refund_id) END,
    updated_at = now()
  WHERE reference = p_reference
  RETURNING * INTO v_row;
  PERFORM set_config('carup.pay03b_hold_release', '', true);
  RETURN to_jsonb(v_row)
    || jsonb_build_object('duplicate_event', false, 'hold_retained', (v_transition->>'hold_retained')::boolean)
    || v_record;
END $$;

-- 4. The certified PAY-01A writer keeps its signature and vocabulary and delegates, so no caller can clear a hold.
CREATE OR REPLACE FUNCTION public.pay01a_apply_provider_snapshot(
  p_reference text, p_status text, p_intent_id text, p_refund_id text,
  p_event_id text DEFAULT NULL, p_event_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status NOT IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded') THEN
    RAISE EXCEPTION 'PAY01A_STATUS_INVALID';
  END IF;
  RETURN public.pay03b_apply_provider_payment_snapshot(
    p_reference, p_status, p_intent_id, p_refund_id, p_event_id, p_event_type,
    NULL, NULL, NULL, NULL, NULL);
END $$;

-- 5. Refund authority: a held payment may be completed to the full amount by its refund actor, but the hold is
--    never lowered here. Only the provider-confirmed full refund ends it.
CREATE OR REPLACE FUNCTION public.pay01a_begin_refund(p_reference text, p_actor_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.payment_transactions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || coalesce(p_reference, '')));
  SELECT * INTO v_row FROM public.payment_transactions
    WHERE reference = p_reference AND gateway = 'stripe_carup_japan_sandbox'
    FOR UPDATE;
  IF NOT FOUND OR v_row.pay01a_actor_id IS DISTINCT FROM p_actor_id
    OR v_row.pay01a_account_id <> 'acct_1UVnGaEjgXqvlsJk'
    OR v_row.pay01a_intent_id IS NULL
    OR v_row.status NOT IN ('paid', 'refund_pending', 'reconciliation_hold') THEN
    RAISE EXCEPTION 'PAY01A_REFUND_AUTHORITY_REFUSED';
  END IF;
  IF v_row.status = 'reconciliation_hold' THEN
    RETURN to_jsonb(v_row) || jsonb_build_object('reconciliation_hold', true);
  END IF;
  UPDATE public.payment_transactions SET status = 'refund_pending', updated_at = now()
    WHERE reference = p_reference RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

-- 6a. Extension hooks for payments owned by other canonical objects (PAY-03B subscription invoices replace them).
--     owner_lock runs BEFORE the payment-reference advisory lock so every writer shares one lock order;
--     after_resolution re-projects the owner's entitlements in the same transaction.
CREATE OR REPLACE FUNCTION public.pay03b_payment_owner_lock(p_reference text)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RETURN;
END $$;
CREATE OR REPLACE FUNCTION public.pay03b_after_payment_resolution(p_reference text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.pay03b_payment_owner_lock(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pay03b_after_payment_resolution(text) FROM PUBLIC, anon, authenticated, service_role;

-- R5: is the would-be resolver the payer? PAY-01A payments record the paying user; PAY-03B extends this for invoices.
CREATE OR REPLACE FUNCTION public.pay03b_payment_payer_conflict(p_reference text, p_actor_id text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.payment_transactions WHERE reference = p_reference AND pay01a_actor_id = p_actor_id);
$$;
REVOKE ALL ON FUNCTION public.pay03b_payment_payer_conflict(text,text) FROM PUBLIC, anon, authenticated, service_role;

-- R11: a held or finally revoked payment can only leave that state through a governed writer, which marks its own
-- UPDATE with a transaction-local flag. Any other UPDATE (including a direct service-role write) is refused.
CREATE OR REPLACE FUNCTION public.pay03b_guard_payment_hold_release()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status IN ('reconciliation_hold', 'partially_refunded') AND NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(current_setting('carup.pay03b_hold_release', true), '') <> 'on' THEN
    RAISE EXCEPTION 'PAY03B_HOLD_RELEASE_REQUIRES_GOVERNED_PATH';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pay03b_guard_payment_hold_release ON public.payment_transactions;
CREATE TRIGGER trg_pay03b_guard_payment_hold_release
  BEFORE UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.pay03b_guard_payment_hold_release();
REVOKE ALL ON FUNCTION public.pay03b_guard_payment_hold_release() FROM PUBLIC, anon, authenticated;

-- 6. Operator resolution. Requires an existing platform administrator (verified against public.users, not just
--    the caller's claim), a written reason, separation from the payer, and a provider state verified within the
--    last 10 minutes that justifies the outcome. Entitlements are re-projected in the same transaction.
CREATE OR REPLACE FUNCTION public.pay03b_resolve_payment_reconciliation_exception(
  p_exception_id uuid,
  p_resolution text,
  p_actor_id text,
  p_actor_role text,
  p_note text,
  p_verified_status text,
  p_verified_refunded_minor bigint,
  p_verified_pending_refund_minor bigint,
  p_verified_refund_ids text[],
  p_verified_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ref text;
  v_row public.payment_transactions%ROWTYPE;
  v_exception public.pay03b_payment_reconciliation_exceptions%ROWTYPE;
  v_new_status text;
  v_sync jsonb := NULL;
BEGIN
  IF p_resolution IS NULL OR p_resolution NOT IN ('restore_access_provider_unrefunded', 'revoke_access_partial_refund_final') THEN
    RAISE EXCEPTION 'PAY03B_RESOLUTION_INVALID';
  END IF;
  IF coalesce(length(trim(p_actor_id)), 0) = 0 OR p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'super_admin')
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = trim(p_actor_id) AND role = 'admin') THEN
    RAISE EXCEPTION 'PAY03B_RESOLUTION_AUTHORITY_REFUSED';
  END IF;
  IF length(trim(coalesce(p_note, ''))) < 10 THEN
    RAISE EXCEPTION 'PAY03B_RESOLUTION_NOTE_REQUIRED';
  END IF;
  IF p_verified_at IS NULL
     OR p_verified_at > clock_timestamp() + interval '1 minute'
     OR p_verified_at < clock_timestamp() - interval '10 minutes' THEN
    RAISE EXCEPTION 'PAY03B_PROVIDER_VERIFICATION_STALE';
  END IF;

  SELECT payment_reference INTO v_ref FROM public.pay03b_payment_reconciliation_exceptions WHERE id = p_exception_id;
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'PAY03B_RECONCILIATION_EXCEPTION_NOT_FOUND';
  END IF;
  PERFORM public.pay03b_payment_owner_lock(v_ref);
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || v_ref));
  SELECT * INTO v_row FROM public.payment_transactions WHERE reference = v_ref FOR UPDATE;
  SELECT * INTO v_exception FROM public.pay03b_payment_reconciliation_exceptions WHERE id = p_exception_id FOR UPDATE;
  IF v_exception.status <> 'open' THEN
    RAISE EXCEPTION 'PAY03B_RECONCILIATION_EXCEPTION_NOT_OPEN';
  END IF;
  IF v_row.status <> 'reconciliation_hold' THEN
    RAISE EXCEPTION 'PAY03B_PAYMENT_NOT_HELD';
  END IF;
  IF public.pay03b_payment_payer_conflict(v_ref, trim(p_actor_id)) THEN
    RAISE EXCEPTION 'PAY03B_RESOLUTION_SELF_DEALING_REFUSED';
  END IF;
  -- R10: the verification must be at least as new as the latest provider observation of this exception;
  -- otherwise a refund observed after the operator's read would be overwritten by stale evidence.
  IF v_exception.last_observed_at > p_verified_at THEN
    RAISE EXCEPTION 'PAY03B_PROVIDER_VERIFICATION_SUPERSEDED';
  END IF;

  IF p_resolution = 'restore_access_provider_unrefunded' THEN
    IF p_verified_status IS DISTINCT FROM 'paid'
       OR p_verified_refunded_minor IS DISTINCT FROM 0
       OR p_verified_pending_refund_minor IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'PAY03B_RESTORE_REQUIRES_UNREFUNDED_PROVIDER_STATE';
    END IF;
    v_new_status := 'paid';
  ELSE
    IF p_verified_status IS DISTINCT FROM 'reconciliation_hold'
       OR p_verified_refunded_minor IS NULL
       OR p_verified_refunded_minor <= 0
       OR p_verified_refunded_minor >= v_exception.payment_amount_minor
       OR p_verified_pending_refund_minor IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'PAY03B_REVOKE_FINAL_REQUIRES_SETTLED_PARTIAL_REFUND';
    END IF;
    v_new_status := 'partially_refunded';
  END IF;

  UPDATE public.pay03b_payment_reconciliation_exceptions SET
    status = 'resolved',
    resolution = p_resolution,
    resolved_by = trim(p_actor_id),
    resolved_role = p_actor_role,
    resolution_note = trim(p_note),
    resolution_evidence = jsonb_build_object(
      'verified_status', p_verified_status,
      'verified_refunded_minor', p_verified_refunded_minor,
      'verified_pending_refund_minor', p_verified_pending_refund_minor,
      'verified_refund_ids', to_jsonb(coalesce(p_verified_refund_ids, '{}'::text[])),
      'verified_at', p_verified_at,
      'resulting_payment_status', v_new_status),
    resolved_at = clock_timestamp()
  WHERE id = p_exception_id
  RETURNING * INTO v_exception;

  PERFORM set_config('carup.pay03b_hold_release', 'on', true);
  UPDATE public.payment_transactions SET status = v_new_status, updated_at = now()
    WHERE reference = v_ref RETURNING * INTO v_row;
  PERFORM set_config('carup.pay03b_hold_release', '', true);

  -- Re-project PAY-02/PAY-03A entitlements in the same transaction: money and access never disagree.
  IF EXISTS (SELECT 1 FROM public.pay02_commercial_quotes WHERE payment_reference = v_ref) THEN
    v_sync := public.pay02_sync_quote_from_canonical_payment(v_ref);
  ELSE
    v_sync := public.pay03b_after_payment_resolution(v_ref);
  END IF;

  RETURN jsonb_build_object(
    'exception', to_jsonb(v_exception),
    'payment_reference', v_ref,
    'payment_status', v_row.status,
    'sync', v_sync
  );
END $$;

-- 7. Operator alert acknowledgement (records who has seen the alert; resolves nothing).
CREATE OR REPLACE FUNCTION public.pay03b_acknowledge_payment_reconciliation_exception(
  p_exception_id uuid, p_actor_id text, p_actor_role text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_exception public.pay03b_payment_reconciliation_exceptions%ROWTYPE;
BEGIN
  IF coalesce(length(trim(p_actor_id)), 0) = 0 OR p_actor_role IS NULL OR p_actor_role NOT IN ('admin', 'super_admin')
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = trim(p_actor_id) AND role = 'admin') THEN
    RAISE EXCEPTION 'PAY03B_RESOLUTION_AUTHORITY_REFUSED';
  END IF;
  SELECT * INTO v_exception FROM public.pay03b_payment_reconciliation_exceptions
    WHERE id = p_exception_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAY03B_RECONCILIATION_EXCEPTION_NOT_FOUND';
  END IF;
  IF v_exception.status = 'open' AND v_exception.acknowledged_at IS NULL THEN
    UPDATE public.pay03b_payment_reconciliation_exceptions SET
      acknowledged_by = trim(p_actor_id), acknowledged_role = p_actor_role, acknowledged_at = clock_timestamp()
    WHERE id = p_exception_id RETURNING * INTO v_exception;
  END IF;
  RETURN to_jsonb(v_exception);
END $$;

-- 8. PAY-02/PAY-03A entitlement projection: re-created from 20261101100000 with two bounded F5 branches.
CREATE OR REPLACE FUNCTION public.pay02_sync_quote_from_canonical_payment(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_payment public.payment_transactions%ROWTYPE;
  v_quote public.pay02_commercial_quotes%ROWTYPE;
  v_report_order public.pay02_report_orders%ROWTYPE;
  v_target_status text;
BEGIN
  -- F8: same per-reference advisory lock as pay03a_complete_report_fulfillment, taken before any row lock.
  PERFORM pg_advisory_xact_lock(hashtext('carup_pay03a_ref:' || coalesce(p_reference, '')));
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
      ELSIF v_payment.status IN ('refund_pending', 'reconciliation_hold')
            AND v_report_order.entitlement_status <> 'revoked_refunded' THEN
        UPDATE public.pay02_report_orders
          SET entitlement_status = 'refund_suspended',
              updated_at = now()
          WHERE id = v_report_order.id
          RETURNING * INTO v_report_order;
        -- F4: no report_versions revocation here. Revocation is one-way; a refund that fails or is cancelled
        -- (refund_pending -> paid) must restore access. Every read path already refuses refund_pending /
        -- refund_suspended. The snapshot is revoked only when the payment is actually 'refunded'.
        -- PAY-03B F5: a reconciliation hold suspends the same way; it is revoked only if it ends in a confirmed
        -- full refund or an operator-confirmed final partial refund.
      ELSIF v_payment.status IN ('refunded', 'partially_refunded') THEN
        UPDATE public.pay02_report_orders
          SET entitlement_status = 'revoked_refunded',
              revoked_at = coalesce(revoked_at, now()),
              updated_at = now()
          WHERE id = v_report_order.id
          RETURNING * INTO v_report_order;
        IF v_report_order.report_version_id IS NOT NULL THEN
          UPDATE public.report_versions
            SET revoked = true,
                correction_notice = CASE WHEN v_payment.status = 'partially_refunded'
                  THEN 'Entitlement revoked following an operator-confirmed partial refund (payment reconciliation).'
                  ELSE 'Entitlement revoked following governed payment refund.' END
            WHERE id = v_report_order.report_version_id
              AND revoked IS DISTINCT FROM true;
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

REVOKE ALL ON FUNCTION public.pay03b_apply_provider_payment_snapshot(text,text,text,text,text,text,bigint,bigint,text[],text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay01a_apply_provider_snapshot(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay01a_begin_refund(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_resolve_payment_reconciliation_exception(uuid,text,text,text,text,text,bigint,bigint,text[],timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_acknowledge_payment_reconciliation_exception(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay02_sync_quote_from_canonical_payment(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay03b_guard_reconciliation_exception() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay03b_apply_provider_payment_snapshot(text,text,text,text,text,text,bigint,bigint,text[],text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay01a_apply_provider_snapshot(text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay01a_begin_refund(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_resolve_payment_reconciliation_exception(uuid,text,text,text,text,text,bigint,bigint,text[],timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay03b_acknowledge_payment_reconciliation_exception(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay02_sync_quote_from_canonical_payment(text) TO service_role;

COMMIT;

-- +migrate Down
-- PAY-03B F5 never deletes reconciliation evidence or re-opens a revoked entitlement in an automatic rollback.
DO $$ BEGIN RAISE EXCEPTION 'PAY03B_F5_RETAIN_RECONCILIATION_EVIDENCE'; END $$;
