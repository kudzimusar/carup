-- PAY-01C isolated ephemeral PostgreSQL structural and transactional smoke test.
-- NO Stripe call, no shared database, no real user or payment.
DO $$
DECLARE
  v_first jsonb; v_repeat jsonb; v_ref text; v_order uuid; v_granted timestamptz;
  v_snapshot jsonb; v_state jsonb; v_role text;
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY01C_DB_IDENTITY_REFUSED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.pay01c_demo_orders'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'PAY01C_RLS_DISABLED';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, 'public.pay01c_demo_orders', 'SELECT')
       OR has_table_privilege(v_role, 'public.pay01c_demo_orders', 'INSERT')
       OR has_function_privilege(v_role, 'public.pay01c_claim_demo_checkout(text,text)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay01c_sync_demo_entitlement(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'PAY01C_UNAUTHORIZED_GRANT_%', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.pay01c_claim_demo_checkout(text,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.pay01c_sync_demo_entitlement(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PAY01C_RPC_GRANT_MISSING';
  END IF;

  v_first := public.pay01c_claim_demo_checkout('fixture-buyer', 'pay01c_abcdefghijklmnopqrstuvwx');
  v_repeat := public.pay01c_claim_demo_checkout('fixture-buyer', 'pay01c_abcdefghijklmnopqrstuvwx');
  v_ref := v_first->>'reference';
  v_order := (v_first->>'pay01c_order_id')::uuid;
  IF v_ref IS NULL OR v_order IS NULL OR v_first->>'reference' IS DISTINCT FROM v_repeat->>'reference'
    OR v_first->>'pay01c_order_id' IS DISTINCT FROM v_repeat->>'pay01c_order_id'
    OR (SELECT count(*) FROM public.pay01c_demo_orders) <> 1
    OR (SELECT count(*) FROM public.payment_transactions) <> 1 THEN
    RAISE EXCEPTION 'PAY01C_ATOMIC_CLAIM_NOT_IDEMPOTENT';
  END IF;
  IF (v_first->>'amount')::numeric <> 100 OR v_first->>'currency' <> 'JPY'
    OR v_first->>'pay01a_account_id' <> 'acct_1UVnGaEjgXqvlsJk' THEN
    RAISE EXCEPTION 'PAY01C_CANONICAL_PRICE_MISMATCH';
  END IF;

  -- No entitlement until the canonical payment has been verified and marked paid.
  v_state := public.pay01c_sync_demo_entitlement(v_ref);
  IF v_state->>'granted' <> 'false' THEN RAISE EXCEPTION 'PAY01C_PREPAYMENT_GRANT'; END IF;
  PERFORM public.pay01a_attach_checkout(v_ref, 'cs_test_pay01cfixture');
  v_snapshot := public.pay01a_apply_provider_snapshot(
    v_ref, 'paid', 'pi_pay01cfixture', NULL, 'evt_pay01cfixturepaid', 'payment_intent.succeeded');
  IF v_snapshot->>'status' <> 'paid' THEN RAISE EXCEPTION 'PAY01C_PAYMENT_NOT_PAID'; END IF;
  v_state := public.pay01c_sync_demo_entitlement(v_ref);
  SELECT granted_at INTO v_granted FROM public.pay01c_demo_orders WHERE id = v_order;
  IF v_state->>'granted' <> 'true' OR v_granted IS NULL THEN RAISE EXCEPTION 'PAY01C_GRANT_MISSING'; END IF;
  PERFORM public.pay01c_sync_demo_entitlement(v_ref);
  IF (SELECT granted_at FROM public.pay01c_demo_orders WHERE id = v_order) IS DISTINCT FROM v_granted THEN
    RAISE EXCEPTION 'PAY01C_DUPLICATE_GRANT';
  END IF;
  v_snapshot := public.pay01a_apply_provider_snapshot(
    v_ref, 'paid', 'pi_pay01cfixture', NULL, 'evt_pay01cfixturepaid', 'payment_intent.succeeded');
  IF v_snapshot->>'duplicate_event' <> 'true' THEN
    RAISE EXCEPTION 'PAY01C_DUPLICATE_EVENT_NOT_DEDUPED';
  END IF;

  PERFORM public.pay01a_apply_provider_snapshot(
    v_ref, 'refunded', 'pi_pay01cfixture', 're_pay01cfixture',
    'evt_pay01cfixturerefund', 'refund.created');
  v_state := public.pay01c_sync_demo_entitlement(v_ref);
  IF v_state->>'revoked' <> 'true'
    OR (SELECT revoked_at FROM public.pay01c_demo_orders WHERE id = v_order) IS NULL
    OR (SELECT status FROM public.payment_transactions WHERE reference = v_ref) <> 'refunded' THEN
    RAISE EXCEPTION 'PAY01C_REFUND_REVOCATION_FAILED';
  END IF;
  PERFORM public.pay01c_sync_demo_entitlement(v_ref);
  IF (SELECT granted_at FROM public.pay01c_demo_orders WHERE id = v_order) IS DISTINCT FROM v_granted
    OR (SELECT count(*) FROM public.pay01a_stripe_event_receipts WHERE reference = v_ref) <> 2 THEN
    RAISE EXCEPTION 'PAY01C_DUPLICATE_FINANCIAL_EFFECT';
  END IF;

  BEGIN
    PERFORM public.pay01a_apply_provider_snapshot(
      v_ref, 'paid', 'pi_pay01cfixture', NULL,
      'evt_pay01cfixturelate', 'payment_intent.succeeded');
    RAISE EXCEPTION 'PAY01C_LATE_PAID_EVENT_INCORRECTLY_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'PAY01C_LATE_PAID_EVENT_INCORRECTLY_ACCEPTED' THEN RAISE; END IF;
    IF position('PAY01A_STATUS_REGRESSION_REFUSED' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.payment_transactions WHERE reference = v_ref) <> 'refunded'
    OR (SELECT revoked_at IS NOT NULL FROM public.pay01c_demo_orders WHERE id = v_order) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PAY01C_OUT_OF_ORDER_REGRESSION';
  END IF;
  RAISE NOTICE 'PAY01C_POSTGRES_SMOKE_PASS: isolated claim, RLS, idempotency, refund and monotonic entitlement';
END $$;
