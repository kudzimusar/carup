-- CARUP-PAY-03A (R1) isolated ephemeral PostgreSQL smoke test:
-- Verifies:
-- 1. R1-A: Deployable migration `20261031160000_carup_pay03a_real_report_commerce.sql` did NOT manufacture
--    synthetic `WBA3A5C51DF358101`, `JTDBR32E820112202`, or `DBA-GRS204-0005303` vehicle rows, and
--    preserved pre-existing canonical `public.vehicles` records (`VIN74329849204928`).
-- 2. R1-C: Canonical `public.report_versions` trigger (`trg_report_version_guard`), FK (`ON DELETE RESTRICT`),
--    RLS policies, and `authenticated` read access for legacy report versions (`report_tier = 'legacy_version'`)
--    remain intact before and after PAY-03A.
-- 3. R1-A: Segregated disposable-test fixture (`fixtures/pay03a-synthetic-vehicle-fixtures.sql`) loads
--    explicitly marked synthetic fixture vehicles and lifecycle evidence only in `pay01c_sandbox_ci`.
-- 4. End-to-end PAY-02 quote -> canonical `payment_transactions` + `pay02_report_orders` claim (`pay02_claim_quote_checkout`).
-- 5. Provider verification (`pay01a_attach_checkout` + `pay01a_apply_provider_snapshot('paid')`) + `pay02_sync_quote_from_canonical_payment`.
-- 6. Atomic report fulfillment (`pay03a_complete_report_fulfillment`) creating one `report_versions` row with
--    `report_tier = 'pay03a_commercial_snapshot'` and `pay03a_order_id = v_order_id`.
-- 7. R1-C & R1-D: Restrictive RLS policy (`pay03a_paid_report_entitlement_guard`) blocks direct PostgREST
--    table reads of paid snapshots by `anon`/`authenticated` while preserving legacy report reads.
-- 8. Concurrency/idempotent replay of `pay03a_complete_report_fulfillment` and immutability of content & binding.
-- 9. Governed refund (`refund_pending` -> `refunded`) suspending and revoking both `pay02_report_orders` and `report_versions.revoked = true`.

-- Step A: Pre-fixture checks (prove deployable migration did not insert synthetic vehicles and legacy reports work)
DO $$
DECLARE
  v_legacy_ver_id uuid;
  v_legacy_visible_count integer;
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY03A_DB_IDENTITY_REFUSED: %', current_database();
  END IF;

  -- R1-A: Deployable migration must NOT have inserted synthetic fixture VINs
  IF (SELECT count(*) FROM public.vehicles WHERE vin IN ('WBA3A5C51DF358101', 'JTDBR32E820112202', 'DBA-GRS204-0005303')) <> 0 THEN
    RAISE EXCEPTION 'PAY03A_DEPLOYABLE_MIGRATION_MANUFACTURED_SYNTHETIC_VEHICLES';
  END IF;

  -- Pre-existing canonical vehicle from `supabase_schema.sql` must remain intact
  IF (SELECT count(*) FROM public.vehicles WHERE vin = 'VIN74329849204928') <> 1 THEN
    RAISE EXCEPTION 'PAY03A_EXISTING_CANONICAL_VEHICLE_MISSING';
  END IF;

  -- R1-C: Canonical `trg_report_version_guard` and additive `trg_pay03a_report_version_binding_guard` must both exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.report_versions'::regclass AND tgname = 'trg_report_version_guard'
  ) THEN
    RAISE EXCEPTION 'PAY03A_CANONICAL_REPORT_VERSION_GUARD_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.report_versions'::regclass AND tgname = 'trg_pay03a_report_version_binding_guard'
  ) THEN
    RAISE EXCEPTION 'PAY03A_COMMERCIAL_BINDING_GUARD_MISSING';
  END IF;

  -- R1-C: Insert a legacy report version (`report_tier = 'legacy_version'`, `pay03a_order_id IS NULL`)
  -- with a share token and verify `authenticated` role retains SELECT privilege and RLS visibility on legacy shares.
  IF NOT has_table_privilege('authenticated', 'public.report_versions', 'SELECT') THEN
    RAISE EXCEPTION 'PAY03A_LEGACY_AUTHENTICATED_SELECT_GRANT_BROKEN';
  END IF;

  INSERT INTO public.report_versions (
    vin, version, generated_by, payload, content_hash, completeness, share_token, share_expires_at
  ) VALUES (
    'VIN74329849204928',
    1,
    'u1',
    '{"schema":"vehicle_history_report.v1","vin":"VIN74329849204928"}'::jsonb,
    'sha256_legacy_v1',
    '{"identity_coverage":1}'::jsonb,
    'legacy_share_token_smoke_001',
    now() + interval '7 days'
  )
  RETURNING id INTO v_legacy_ver_id;

  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_legacy_visible_count
    FROM public.report_versions
    WHERE id = v_legacy_ver_id;
  RESET ROLE;

  IF v_legacy_visible_count <> 1 THEN
    RAISE EXCEPTION 'PAY03A_LEGACY_REPORT_RLS_VISIBILITY_BROKEN: %', v_legacy_visible_count;
  END IF;
END $$;

-- Step B: Explicitly load segregated synthetic test fixtures (disposable test DB only)
\ir fixtures/pay03a-synthetic-vehicle-fixtures.sql

-- Step C: Verify PAY-03A quote, claim, atomic fulfillment, restrictive RLS on paid snapshots, and refund revocation
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
  v_paid_client_visible integer;
BEGIN
  -- 1. Verify synthetic fixture vehicles and evidence were loaded by the fixture script.
  IF (SELECT count(*) FROM public.vehicles WHERE vin = 'WBA3A5C51DF358101') <> 1
     OR (SELECT count(*) FROM public.vehicle_evidence WHERE vin = 'WBA3A5C51DF358101') <> 2
     OR (SELECT count(*) FROM public.vehicle_evidence WHERE vin = 'DBA-GRS204-0005303') <> 0 THEN
    RAISE EXCEPTION 'PAY03A_SYNTHETIC_FIXTURE_STATE_UNEXPECTED';
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

  -- 3. Issue server-authorized PAY-02 quote for fixture vehicle `WBA3A5C51DF358101`.
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

  -- 6. First fulfillment binds a new `report_versions` snapshot (`report_tier = 'pay03a_commercial_snapshot'`) and marks quote `fulfilled`.
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
     OR (v_fulfill_1->>'report_tier') <> 'pay03a_commercial_snapshot'
     OR (SELECT status FROM public.pay02_commercial_quotes WHERE id = v_quote_id) <> 'fulfilled'
     OR (SELECT report_version_id FROM public.pay02_report_orders WHERE id = v_order_id) <> v_report_ver_id
     OR (SELECT pay03a_order_id FROM public.report_versions WHERE id = v_report_ver_id) <> v_order_id THEN
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

  -- 8. Verify `report_versions` payload immutability, commercial binding immutability, and `pay02_report_orders.report_version_id` immutability.
  BEGIN
    UPDATE public.report_versions
      SET payload = '{"tampered":true}'::jsonb
      WHERE id = v_report_ver_id;
    RAISE EXCEPTION 'PAY03A_REPORT_PAYLOAD_MUTATION_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('report_versions content is immutable' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.report_versions
      SET report_tier = 'legacy_version'
      WHERE id = v_report_ver_id;
    RAISE EXCEPTION 'PAY03A_REPORT_TIER_DOWNGRADE_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY03A_REPORT_VERSION_COMMERCIAL_BINDING_IMMUTABLE' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.pay02_report_orders
      SET report_version_id = gen_random_uuid()
      WHERE id = v_order_id;
    RAISE EXCEPTION 'PAY03A_REPORT_VERSION_REBIND_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY02_REPORT_VERSION_BINDING_IMMUTABLE' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 9. Issue share token on `report_versions`. Verify `authenticated` cannot bypass backend entitlement check
  --    by reading the paid snapshot directly from `public.report_versions` via PostgREST (`pay03a_paid_report_entitlement_guard`).
  UPDATE public.report_versions
    SET share_token = 'pay03a_shr_smoke_001',
        share_expires_at = now() + interval '7 days'
    WHERE id = v_report_ver_id;

  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_paid_client_visible
    FROM public.report_versions
    WHERE id = v_report_ver_id;
  RESET ROLE;

  IF v_paid_client_visible <> 0 THEN
    RAISE EXCEPTION 'PAY03A_PAID_SNAPSHOT_DIRECT_CLIENT_BYPASS_PERMITTED: %', v_paid_client_visible;
  END IF;

  -- 10. Verify `refund_pending` and `refunded` revoke both order and share snapshot.
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

  -- 11. Fulfilling a refunded order must fail closed.
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

  RAISE NOTICE 'PAY03A_POSTGRES_SMOKE_PASS: Canonical vehicle/report schema preserved, synthetic fixtures segregated, atomic report fulfillment, idempotent replay, restrictive RLS, and refund revocation verified';
END $$;
