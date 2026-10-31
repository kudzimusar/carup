-- CARUP-PAY-03A isolated ephemeral PostgreSQL smoke test:
-- Verifies:
-- 1. `public.vehicles` and `public.report_versions` existence, RLS, and ACLs.
-- 2. End-to-end PAY-02 quote -> canonical `payment_transactions` + `pay02_report_orders` claim (`pay02_claim_quote_checkout`).
-- 3. Provider verification (`pay01a_attach_checkout` + `pay01a_apply_provider_snapshot('paid')`) + `pay02_sync_quote_from_canonical_payment`.
-- 4. Atomic report fulfillment (`pay03a_complete_report_fulfillment`) creating exactly one `report_versions` row and marking quote `fulfilled`.
-- 5. Concurrency/idempotent replay of `pay03a_complete_report_fulfillment` returning the exact same `report_version_id` without creating a second version.
-- 6. Immutability of `report_versions` content and `pay02_report_orders.report_version_id` binding.
-- 7. Governed refund (`refund_pending` -> `refunded`) suspending and then revoking both `pay02_report_orders` and `report_versions.revoked = true`.
DO $$
DECLARE
  v_role text;
  v_quote jsonb;
  v_quote_id uuid;
  v_claim jsonb;
  v_order_id uuid;
  v_payment_ref text;
  v_sync jsonb;
  v_fulfill_1 jsonb;
  v_fulfill_2 jsonb;
  v_report_ver_id uuid;
BEGIN
  IF current_database() NOT IN ('pay02_foundation_ci', 'pay01c_sandbox_ci', 'pay03a_commerce_ci') THEN
    RAISE EXCEPTION 'PAY03A_DB_IDENTITY_REFUSED: %', current_database();
  END IF;

  -- 1. Verify seeded real vehicles exist in `public.vehicles`.
  IF (SELECT count(*) FROM public.vehicles WHERE vin = 'WBA3A5C51DF358101') <> 1 THEN
    RAISE EXCEPTION 'PAY03A_SEEDED_VEHICLE_MISSING';
  END IF;

  -- 2. Verify RLS and ACLs on `public.report_versions` and `public.pay03a_complete_report_fulfillment`.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.report_versions'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'PAY03A_RLS_DISABLED_ON_REPORT_VERSIONS';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, 'public.report_versions', 'INSERT')
       OR has_table_privilege(v_role, 'public.report_versions', 'UPDATE')
       OR has_table_privilege(v_role, 'public.report_versions', 'DELETE') THEN
      RAISE EXCEPTION 'PAY03A_UNAUTHORIZED_REPORT_VERSIONS_WRITE_%', v_role;
    END IF;
    IF has_function_privilege(v_role, 'public.pay03a_complete_report_fulfillment(uuid,text,text,jsonb,text,jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'PAY03A_UNAUTHORIZED_FULFILLMENT_RPC_GRANT_%', v_role;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('service_role', 'public.pay03a_complete_report_fulfillment(uuid,text,text,jsonb,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PAY03A_SERVICE_ROLE_FULFILLMENT_GRANT_MISSING';
  END IF;

  -- 3. Issue server-authorized PAY-02 quote for real vehicle `WBA3A5C51DF358101`.
  v_quote := public.pay02_issue_commercial_quote(
    'QT-PAY02-03A0000000000001',
    'intel.report.vehicle_history_single',
    1,
    'buyer_pay03a_01',
    'buyer',
    'vehicles',
    'WBA3A5C51DF358101',
    'JPY',
    0,
    100,
    'stripe_carup_japan_sandbox',
    'pay03a_quote_idem_key_0001'
  );
  v_quote_id := (v_quote->>'id')::uuid;

  -- 4. Claim canonical payment + `pay02_report_orders` row.
  v_claim := public.pay02_claim_quote_checkout(
    v_quote_id,
    'buyer_pay03a_01',
    'pay03a_claim_idem_key_0001'
  );
  v_payment_ref := v_claim->>'reference';
  v_order_id := (v_claim->>'pay02_report_order_id')::uuid;

  IF v_payment_ref IS NULL OR v_order_id IS NULL THEN
    RAISE EXCEPTION 'PAY03A_CLAIM_CHECKOUT_FAILED: %', v_claim;
  END IF;

  -- 4a. Unpaid order cannot be fulfilled via `pay03a_complete_report_fulfillment`.
  BEGIN
    PERFORM public.pay03a_complete_report_fulfillment(
      v_order_id,
      'buyer_pay03a_01',
      'WBA3A5C51DF358101',
      '{"schema":"vehicle_history_report.v1","vin":"WBA3A5C51DF358101"}'::jsonb,
      'sha256_unpaid_attempt',
      '{"lifecycle_source_coverage":0.75}'::jsonb
    );
    RAISE EXCEPTION 'PAY03A_UNPAID_FULFILLMENT_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY02_PILOT_ENTITLEMENT_NOT_ACTIVE' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 5. Attach Stripe Checkout session & apply verified `paid` snapshot.
  PERFORM public.pay01a_attach_checkout(v_payment_ref, 'cs_test_pay03a_fixture_01');
  PERFORM public.pay01a_apply_provider_snapshot(
    v_payment_ref,
    'paid',
    'pi_test_pay03a_fixture_01',
    NULL,
    'evt_pay03a_paid_01',
    'checkout.session.completed'
  );
  v_sync := public.pay02_sync_quote_from_canonical_payment(v_payment_ref);
  IF v_sync->>'quote_status' <> 'paid_verified'
     OR v_sync->>'report_entitlement_status' <> 'entitled'
     OR v_sync->>'vin' <> 'WBA3A5C51DF358101' THEN
    RAISE EXCEPTION 'PAY03A_PAID_SYNC_FAILED: %', v_sync;
  END IF;

  -- 5a. Foreign buyer cannot fulfill another buyer's order.
  BEGIN
    PERFORM public.pay03a_complete_report_fulfillment(
      v_order_id,
      'foreign_buyer_attacker_99',
      'WBA3A5C51DF358101',
      '{"schema":"vehicle_history_report.v1","vin":"WBA3A5C51DF358101"}'::jsonb,
      'sha256_foreign_attempt',
      '{"lifecycle_source_coverage":0.75}'::jsonb
    );
    RAISE EXCEPTION 'PAY03A_FOREIGN_BUYER_FULFILLMENT_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY02_PILOT_ORDER_CORRELATION_MISMATCH' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 6. First fulfillment binds a new `report_versions` snapshot and marks quote `fulfilled`.
  v_fulfill_1 := public.pay03a_complete_report_fulfillment(
    v_order_id,
    'buyer_pay03a_01',
    'WBA3A5C51DF358101',
    '{"schema":"vehicle_history_report.v1","vin":"WBA3A5C51DF358101","audience":"buyer"}'::jsonb,
    'sha256_pay03a_verified_report_001',
    '{"lifecycle_source_coverage":0.75,"source_diversity":3}'::jsonb
  );
  v_report_ver_id := (v_fulfill_1->>'report_version_id')::uuid;

  IF v_report_ver_id IS NULL
     OR (v_fulfill_1->>'idempotent_replay')::boolean <> false
     OR (v_fulfill_1->>'quote_status') <> 'fulfilled'
     OR (SELECT status FROM public.pay02_commercial_quotes WHERE id = v_quote_id) <> 'fulfilled'
     OR (SELECT report_version_id FROM public.pay02_report_orders WHERE id = v_order_id) <> v_report_ver_id THEN
    RAISE EXCEPTION 'PAY03A_FIRST_FULFILLMENT_FAILED: %', v_fulfill_1;
  END IF;

  -- 7. Second/concurrent fulfillment call returns the exact same `report_version_id` without creating a duplicate row.
  v_fulfill_2 := public.pay03a_complete_report_fulfillment(
    v_order_id,
    'buyer_pay03a_01',
    'WBA3A5C51DF358101',
    '{"schema":"vehicle_history_report.v1","vin":"WBA3A5C51DF358101","audience":"buyer"}'::jsonb,
    'sha256_pay03a_verified_report_001',
    '{"lifecycle_source_coverage":0.75,"source_diversity":3}'::jsonb
  );

  IF (v_fulfill_2->>'report_version_id')::uuid <> v_report_ver_id
     OR (v_fulfill_2->>'idempotent_replay')::boolean <> true
     OR (SELECT count(*) FROM public.report_versions WHERE vin = 'WBA3A5C51DF358101') <> 1 THEN
    RAISE EXCEPTION 'PAY03A_IDEMPOTENT_FULFILLMENT_REPLAY_FAILED: %', v_fulfill_2;
  END IF;

  -- 8. Verify `report_versions` payload immutability and `pay02_report_orders.report_version_id` binding immutability.
  BEGIN
    UPDATE public.report_versions
      SET payload = '{"tampered":true}'::jsonb
      WHERE id = v_report_ver_id;
    RAISE EXCEPTION 'PAY03A_REPORT_PAYLOAD_MUTATION_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('report_versions content is immutable' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.pay02_report_orders
      SET report_version_id = gen_random_uuid()
      WHERE id = v_order_id;
    RAISE EXCEPTION 'PAY03A_REPORT_VERSION_REBIND_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY02_REPORT_VERSION_BINDING_IMMUTABLE' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 9. Issue share token on `report_versions`, then verify `refund_pending` and `refunded` revoke both order and share snapshot.
  UPDATE public.report_versions
    SET share_token = 'share_tok_pay03a_smoke_001',
        share_expires_at = now() + interval '7 days'
    WHERE id = v_report_ver_id;

  PERFORM public.pay01a_apply_provider_snapshot(
    v_payment_ref,
    'refund_pending',
    'pi_test_pay03a_fixture_01',
    're_test_pay03a_fixture_01',
    'evt_pay03a_refund_pending_01',
    'refund.updated'
  );
  v_sync := public.pay02_sync_quote_from_canonical_payment(v_payment_ref);
  IF v_sync->>'report_entitlement_status' <> 'refund_suspended'
     OR (SELECT revoked FROM public.report_versions WHERE id = v_report_ver_id) <> true THEN
    RAISE EXCEPTION 'PAY03A_REFUND_PENDING_SUSPENSION_FAILED: %', v_sync;
  END IF;

  PERFORM public.pay01a_apply_provider_snapshot(
    v_payment_ref,
    'refunded',
    'pi_test_pay03a_fixture_01',
    're_test_pay03a_fixture_01',
    'evt_pay03a_refunded_01',
    'charge.refunded'
  );
  v_sync := public.pay02_sync_quote_from_canonical_payment(v_payment_ref);
  IF v_sync->>'quote_status' <> 'refunded'
     OR v_sync->>'report_entitlement_status' <> 'revoked_refunded'
     OR (SELECT revoked FROM public.report_versions WHERE id = v_report_ver_id) <> true
     OR (SELECT revoked_at FROM public.pay02_report_orders WHERE id = v_order_id) IS NULL THEN
    RAISE EXCEPTION 'PAY03A_REFUND_REVOCATION_FAILED: %', v_sync;
  END IF;

  -- 10. Fulfilling a refunded order must fail closed.
  BEGIN
    PERFORM public.pay03a_complete_report_fulfillment(
      v_order_id,
      'buyer_pay03a_01',
      'WBA3A5C51DF358101',
      '{"schema":"vehicle_history_report.v1","vin":"WBA3A5C51DF358101","audience":"buyer"}'::jsonb,
      'sha256_pay03a_verified_report_001',
      '{"lifecycle_source_coverage":0.75}'::jsonb
    );
    RAISE EXCEPTION 'PAY03A_REFUNDED_ORDER_FULFILLMENT_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY02_PILOT_ENTITLEMENT_REVOKED_ON_REFUND' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PAY03A_POSTGRES_SMOKE_PASS: Real vehicle source authority, quote/order/payment claim, atomic report fulfillment, idempotent replay, immutability guards, and refund revocation verified';
END $$;
