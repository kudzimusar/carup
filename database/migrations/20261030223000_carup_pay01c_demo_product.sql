-- +migrate Up
-- CARUP-PAY-01C LOCAL/TEST ONLY. Run after PAY-01A migration and ONLY on isolated test DB.
-- One customer demo-order/entitlement projection; public.payment_transactions remains the sole money ledger.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.payment_transactions') IS NULL
     OR to_regprocedure('public.pay01a_apply_provider_snapshot(text,text,text,text,text,text)') IS NULL
  THEN RAISE EXCEPTION 'PAY01C_REQUIRES_FROZEN_PAY01A_CANONICAL_PAYMENT_SCHEMA'; END IF;
END $$;

CREATE TABLE public.pay01c_demo_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id text NOT NULL CHECK (length(trim(buyer_id)) > 0),
  request_key text NOT NULL CHECK (request_key ~ '^pay01c_[A-Za-z0-9_-]{16,89}$'),
  payment_reference text NOT NULL UNIQUE REFERENCES public.payment_transactions(reference),
  product_code text NOT NULL DEFAULT 'vehicle_history_demo'
    CHECK (product_code = 'vehicle_history_demo'),
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, request_key),
  CHECK (revoked_at IS NULL OR granted_at IS NOT NULL)
);
CREATE INDEX pay01c_demo_orders_buyer_created ON public.pay01c_demo_orders(buyer_id, created_at DESC);
ALTER TABLE public.pay01c_demo_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pay01c_demo_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pay01c_demo_orders TO service_role;

-- Claim the existing canonical money row AND the demo-order identity in one PostgreSQL transaction.
-- The approved fixed amount/currency/account are database-authored. No browser payment fields are read.
CREATE FUNCTION public.pay01c_claim_demo_checkout(p_actor_id text, p_request_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_payment public.payment_transactions%ROWTYPE; v_order public.pay01c_demo_orders%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR length(trim(p_actor_id)) = 0 OR p_request_key IS NULL
    OR p_request_key !~ '^pay01c_[A-Za-z0-9_-]{16,89}$' THEN
    RAISE EXCEPTION 'PAY01C_INVALID_DEMO_CLAIM';
  END IF;
  INSERT INTO public.payment_transactions
    (gateway, amount, currency, reference, status, pay01a_actor_id, pay01a_request_key, pay01a_account_id)
  VALUES ('stripe_carup_japan_sandbox', 100, 'JPY', 'pay01a_' || gen_random_uuid()::text,
    'pending', p_actor_id, p_request_key, 'acct_1UVnGaEjgXqvlsJk')
  ON CONFLICT DO NOTHING;
  SELECT * INTO v_payment FROM public.payment_transactions
   WHERE gateway = 'stripe_carup_japan_sandbox'
   AND pay01a_actor_id = p_actor_id AND pay01a_request_key = p_request_key FOR UPDATE;
  IF NOT FOUND OR v_payment.amount <> 100 OR v_payment.currency <> 'JPY'
    OR v_payment.pay01a_account_id <> 'acct_1UVnGaEjgXqvlsJk' THEN
    RAISE EXCEPTION 'PAY01C_CANONICAL_CLAIM_INVALID';
  END IF;
  IF v_payment.pay01a_checkout_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM public.pay01c_demo_orders WHERE payment_reference = v_payment.reference
       AND buyer_id = p_actor_id) THEN
    RAISE EXCEPTION 'PAY01C_CLAIM_REUSE_REFUSED';
  END IF;
  INSERT INTO public.pay01c_demo_orders(buyer_id, request_key, payment_reference)
    VALUES(p_actor_id, p_request_key, v_payment.reference)
  ON CONFLICT DO NOTHING;
  SELECT * INTO v_order FROM public.pay01c_demo_orders
   WHERE buyer_id = p_actor_id AND request_key = p_request_key FOR UPDATE;
  IF NOT FOUND OR v_order.payment_reference IS DISTINCT FROM v_payment.reference THEN
    RAISE EXCEPTION 'PAY01C_ORDER_CLAIM_CONFLICT';
  END IF;
  RETURN to_jsonb(v_payment) || jsonb_build_object('pay01c_order_id', v_order.id);
END $$;

-- Executed ONLY AFTER canonical provider reconciliation. No webhook, redirect or client flag
-- can grant an entitlement without a verified paid payment_transactions row.
CREATE FUNCTION public.pay01c_sync_demo_entitlement(p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_order public.pay01c_demo_orders%ROWTYPE; v_payment public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM public.payment_transactions
    WHERE reference = p_reference AND gateway = 'stripe_carup_japan_sandbox' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY01C_PAYMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_order FROM public.pay01c_demo_orders WHERE payment_reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF; -- Previously accepted PAY-01A/B payment.
  IF v_payment.pay01a_actor_id IS DISTINCT FROM v_order.buyer_id
    OR v_payment.amount <> 100 OR v_payment.currency <> 'JPY'
    OR v_payment.pay01a_account_id <> 'acct_1UVnGaEjgXqvlsJk'
    OR (v_payment.status IN ('paid','refund_pending','refunded')
        AND (v_payment.pay01a_intent_id IS NULL OR v_payment.pay01a_checkout_id IS NULL)) THEN
    RAISE EXCEPTION 'PAY01C_PAYMENT_OWNERSHIP_OR_AUTHORITY_INVALID';
  END IF;
  IF v_payment.status = 'paid' AND v_order.granted_at IS NULL AND v_order.revoked_at IS NULL THEN
    UPDATE public.pay01c_demo_orders SET granted_at = now()
      WHERE id = v_order.id RETURNING * INTO v_order;
  ELSIF v_payment.status = 'refunded' AND v_order.granted_at IS NOT NULL
    AND v_order.revoked_at IS NULL THEN
    UPDATE public.pay01c_demo_orders SET revoked_at = now()
      WHERE id = v_order.id RETURNING * INTO v_order;
  END IF;
  RETURN jsonb_build_object('order_id', v_order.id, 'payment_status', v_payment.status,
    'granted', v_order.granted_at IS NOT NULL, 'revoked', v_order.revoked_at IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION public.pay01c_claim_demo_checkout(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay01c_sync_demo_entitlement(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay01c_claim_demo_checkout(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay01c_sync_demo_entitlement(text) TO service_role;
COMMIT;

-- +migrate Down
-- Financial and fulfillment evidence must be retained. No destructive automatic rollback.
DO $$ BEGIN RAISE EXCEPTION 'PAY01C_RETAIN_PAYMENT_AND_ENTITLEMENT_EVIDENCE'; END $$;
