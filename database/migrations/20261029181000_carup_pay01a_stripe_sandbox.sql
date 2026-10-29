-- +migrate Up
-- PAY-01A. Additive LOCAL/TEST-only direct merchant extension of EXISTING payment_transactions.
-- No SafeTrade session, ownership or escrow mutation. Do not apply to production.
-- This migration creates an event receipt index, NOT another payment or settlement ledger.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.payment_transactions') IS NULL THEN
    RAISE EXCEPTION 'PAY01A: canonical payment_transactions table is missing';
  END IF;
END $$;

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS pay01a_actor_id text,
  ADD COLUMN IF NOT EXISTS pay01a_request_key text,
  ADD COLUMN IF NOT EXISTS pay01a_account_id text,
  ADD COLUMN IF NOT EXISTS pay01a_checkout_id text,
  ADD COLUMN IF NOT EXISTS pay01a_intent_id text,
  ADD COLUMN IF NOT EXISTS pay01a_refund_id text;

CREATE UNIQUE INDEX IF NOT EXISTS pay01a_unique_actor_request
  ON public.payment_transactions (pay01a_actor_id, pay01a_request_key)
  WHERE gateway = 'stripe_carup_japan_sandbox';
CREATE UNIQUE INDEX IF NOT EXISTS pay01a_unique_checkout
  ON public.payment_transactions (pay01a_checkout_id)
  WHERE pay01a_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pay01a_unique_intent
  ON public.payment_transactions (pay01a_intent_id)
  WHERE pay01a_intent_id IS NOT NULL;

-- Immutable provider event receipt claims; payment_transactions remains sole money state.
CREATE TABLE IF NOT EXISTS public.pay01a_stripe_event_receipts (
  event_id text PRIMARY KEY,
  reference text NOT NULL REFERENCES public.payment_transactions(reference),
  event_type text NOT NULL,
  resulting_state text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pay01a_stripe_event_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pay01a_stripe_event_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.pay01a_stripe_event_receipts TO service_role;

-- Existing payment_transactions is backend-owned. No direct customer-money update privilege.
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_transactions FROM anon, authenticated;
GRANT SELECT ON public.payment_transactions TO service_role;

CREATE OR REPLACE FUNCTION public.pay01a_claim_checkout(p_actor_id text, p_request_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.payment_transactions%ROWTYPE;
BEGIN
  IF coalesce(length(trim(p_actor_id)), 0) = 0
    OR p_request_key !~ '^[A-Za-z0-9_-]{16,96}$'
    OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'PAY01A_INVALID_CLAIM';
  END IF;
  INSERT INTO public.payment_transactions
    (gateway, amount, currency, reference, status,
     pay01a_actor_id, pay01a_request_key, pay01a_account_id)
  VALUES
    ('stripe_carup_japan_sandbox', 100, 'JPY', 'pay01a_' || gen_random_uuid()::text, 'pending',
     p_actor_id, p_request_key, 'acct_1UVnGaEjgXqvlsJk')
  ON CONFLICT DO NOTHING;
  SELECT * INTO v_row FROM public.payment_transactions
    WHERE gateway = 'stripe_carup_japan_sandbox'
      AND pay01a_actor_id = p_actor_id AND pay01a_request_key = p_request_key
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY01A_CLAIM_FAILED'; END IF;
  IF v_row.amount <> 100 OR v_row.currency <> 'JPY'
    OR v_row.pay01a_account_id <> 'acct_1UVnGaEjgXqvlsJk' THEN
    RAISE EXCEPTION 'PAY01A_CLAIM_MISMATCH';
  END IF;
  RETURN to_jsonb(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.pay01a_attach_checkout(p_reference text, p_checkout_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.payment_transactions%ROWTYPE;
BEGIN
  IF p_checkout_id IS NULL OR p_checkout_id !~ '^cs_test_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'PAY01A_TEST_CHECKOUT_REQUIRED';
  END IF;
  SELECT * INTO v_row FROM public.payment_transactions
    WHERE reference = p_reference AND gateway = 'stripe_carup_japan_sandbox'
    FOR UPDATE;
  IF NOT FOUND OR v_row.pay01a_account_id <> 'acct_1UVnGaEjgXqvlsJk'
    OR (v_row.pay01a_checkout_id IS NOT NULL AND v_row.pay01a_checkout_id <> p_checkout_id) THEN
    RAISE EXCEPTION 'PAY01A_CHECKOUT_ATTACH_REFUSED';
  END IF;
  UPDATE public.payment_transactions
    SET pay01a_checkout_id = p_checkout_id, updated_at = now()
    WHERE reference = p_reference RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.pay01a_apply_provider_snapshot(
  p_reference text, p_status text, p_intent_id text, p_refund_id text,
  p_event_id text DEFAULT NULL, p_event_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.payment_transactions%ROWTYPE;
  v_dup boolean := false;
  v_event_reference text;
BEGIN
  IF p_status NOT IN ('pending', 'paid', 'cancelled', 'refund_pending', 'refunded') THEN
    RAISE EXCEPTION 'PAY01A_STATUS_INVALID';
  END IF;
  SELECT * INTO v_row FROM public.payment_transactions
    WHERE reference = p_reference AND gateway = 'stripe_carup_japan_sandbox'
    FOR UPDATE;
  IF NOT FOUND OR v_row.pay01a_account_id <> 'acct_1UVnGaEjgXqvlsJk'
    OR v_row.pay01a_checkout_id IS NULL OR v_row.amount <> 100 OR v_row.currency <> 'JPY' THEN
    RAISE EXCEPTION 'PAY01A_CANONICAL_PAYMENT_INVALID';
  END IF;

  -- A late/old event must never lower paid/refunded authority.
  IF NOT (
    (v_row.status = 'pending' AND p_status IN ('pending', 'paid', 'cancelled'))
    OR (v_row.status = 'paid' AND p_status IN ('paid', 'refund_pending', 'refunded'))
    OR (v_row.status = 'refund_pending' AND p_status IN ('paid', 'refund_pending', 'refunded'))
    OR (v_row.status = 'refunded' AND p_status = 'refunded')
    OR (v_row.status = 'cancelled' AND p_status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'PAY01A_STATUS_REGRESSION_REFUSED';
  END IF;
  IF p_status IN ('paid', 'refund_pending', 'refunded') AND
    (p_intent_id IS NULL OR p_intent_id !~ '^pi_[A-Za-z0-9_]+$') THEN
    RAISE EXCEPTION 'PAY01A_PAYMENT_INTENT_REQUIRED';
  END IF;
  IF v_row.pay01a_intent_id IS NOT NULL AND
    p_intent_id IS DISTINCT FROM v_row.pay01a_intent_id THEN
    RAISE EXCEPTION 'PAY01A_PAYMENT_INTENT_CHANGE_REFUSED';
  END IF;
  IF p_refund_id IS NOT NULL AND p_refund_id !~ '^re_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'PAY01A_REFUND_REFERENCE_INVALID';
  END IF;
  IF v_row.pay01a_refund_id IS NOT NULL AND
    p_refund_id IS NOT NULL AND p_refund_id <> v_row.pay01a_refund_id THEN
    RAISE EXCEPTION 'PAY01A_REFUND_REFERENCE_CHANGE_REFUSED';
  END IF;
  IF p_event_id IS NOT NULL THEN
    IF p_event_id !~ '^evt_[A-Za-z0-9_]+$' OR p_event_type IS NULL THEN
      RAISE EXCEPTION 'PAY01A_EVENT_IDENTITY_INVALID';
    END IF;
    INSERT INTO public.pay01a_stripe_event_receipts
      (event_id, reference, event_type, resulting_state)
    VALUES (p_event_id, p_reference, p_event_type, p_status)
    ON CONFLICT (event_id) DO NOTHING;
    IF NOT FOUND THEN
      SELECT reference INTO v_event_reference FROM public.pay01a_stripe_event_receipts
        WHERE event_id = p_event_id;
      IF v_event_reference IS DISTINCT FROM p_reference THEN
        RAISE EXCEPTION 'PAY01A_EVENT_CROSS_REFERENCE_REPLAY';
      END IF;
      v_dup := true;
    END IF;
  END IF;
  IF NOT v_dup THEN
    UPDATE public.payment_transactions SET
      status = p_status,
      pay01a_intent_id = coalesce(pay01a_intent_id, p_intent_id),
      pay01a_refund_id = coalesce(pay01a_refund_id, p_refund_id),
      updated_at = now()
    WHERE reference = p_reference
    RETURNING * INTO v_row;
  END IF;
  RETURN to_jsonb(v_row) || jsonb_build_object('duplicate_event', v_dup);
END $$;

CREATE OR REPLACE FUNCTION public.pay01a_begin_refund(p_reference text, p_actor_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.payment_transactions
    WHERE reference = p_reference AND gateway = 'stripe_carup_japan_sandbox'
    FOR UPDATE;
  IF NOT FOUND OR v_row.pay01a_actor_id IS DISTINCT FROM p_actor_id
    OR v_row.pay01a_account_id <> 'acct_1UVnGaEjgXqvlsJk'
    OR v_row.pay01a_intent_id IS NULL OR v_row.status NOT IN ('paid', 'refund_pending') THEN
    RAISE EXCEPTION 'PAY01A_REFUND_AUTHORITY_REFUSED';
  END IF;
  UPDATE public.payment_transactions SET status = 'refund_pending', updated_at = now()
    WHERE reference = p_reference RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

REVOKE ALL ON FUNCTION public.pay01a_claim_checkout(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay01a_attach_checkout(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay01a_apply_provider_snapshot(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay01a_begin_refund(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay01a_claim_checkout(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay01a_attach_checkout(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay01a_apply_provider_snapshot(text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay01a_begin_refund(text,text) TO service_role;

COMMIT;

-- +migrate Down
-- PAY-01A never deletes canonical money evidence in an automatic rollback.
-- Before any reverse migration, require an independently reviewed data-retention plan.
DO $$ BEGIN RAISE EXCEPTION 'PAY01A down migration requires manual evidence retention review'; END $$;
