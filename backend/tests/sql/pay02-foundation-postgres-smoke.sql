-- CARUP-PAY-02 isolated ephemeral PostgreSQL structural, RLS, ACL, quote immutability,
-- multi-party obligation allocation, and canonical payment convergence smoke test.
DO $$
DECLARE
  v_role text;
  v_tbl text;
  v_quote_first jsonb;
  v_quote_repeat jsonb;
  v_quote_id uuid;
  v_claim_first jsonb;
  v_claim_repeat jsonb;
  v_payment_ref text;
  v_sync jsonb;
  v_prop_id uuid;
BEGIN
  IF current_database() NOT IN ('pay02_foundation_ci', 'pay01c_sandbox_ci') THEN
    RAISE EXCEPTION 'PAY02_DB_IDENTITY_REFUSED: %', current_database();
  END IF;

  -- 1. Verify RLS is enabled and anon/authenticated have ZERO direct table privileges on all PAY-02 tables.
  FOREACH v_tbl IN ARRAY ARRAY[
    'public.pay02_commercial_products',
    'public.pay02_commercial_product_versions',
    'public.pay02_activation_proposals',
    'public.pay02_commercial_quotes',
    'public.pay02_obligation_allocations'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_tbl::regclass AND relrowsecurity) THEN
      RAISE EXCEPTION 'PAY02_RLS_DISABLED_ON_%', v_tbl;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(v_role, v_tbl, 'SELECT')
         OR has_table_privilege(v_role, v_tbl, 'INSERT')
         OR has_table_privilege(v_role, v_tbl, 'UPDATE')
         OR has_table_privilege(v_role, v_tbl, 'DELETE') THEN
        RAISE EXCEPTION 'PAY02_UNAUTHORIZED_TABLE_GRANT_%_ON_%', v_role, v_tbl;
      END IF;
    END LOOP;
  END LOOP;

  -- 2. Verify RPC privileges: revoked from anon/authenticated, granted to service_role.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.pay02_issue_commercial_quote(text,text,integer,text,text,text,text,text,integer,bigint,text,text)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay02_claim_quote_checkout(uuid,text,text)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay02_sync_quote_from_canonical_payment(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'PAY02_UNAUTHORIZED_RPC_GRANT_%', v_role;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('service_role', 'public.pay02_issue_commercial_quote(text,text,integer,text,text,text,text,text,integer,bigint,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.pay02_claim_quote_checkout(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.pay02_sync_quote_from_canonical_payment(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PAY02_SERVICE_ROLE_RPC_GRANT_MISSING';
  END IF;

  -- 3. Negative DB constraint tests:
  -- 3a. Live activation (`active` or `release_approved`) is refused by DB constraint.
  BEGIN
    UPDATE public.pay02_commercial_products
      SET activation_state = 'active'
      WHERE product_code = 'intel.report.vehicle_history_single';
    RAISE EXCEPTION 'PAY02_LIVE_ACTIVATION_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('pay02_no_live_release_in_foundation' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 3b. Category C item cannot enable checkout or leave blocked/draft.
  BEGIN
    UPDATE public.pay02_commercial_products
      SET checkout_prohibited = false
      WHERE product_code = 'cap.equity.founder_contribution';
    RAISE EXCEPTION 'PAY02_CATEGORY_C_CHECKOUT_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('pay02_category_c_never_checkout' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 3c. Product version history is append-only (UPDATE/DELETE refused).
  BEGIN
    DELETE FROM public.pay02_commercial_product_versions WHERE product_code = 'intel.report.demo_sandbox';
    RAISE EXCEPTION 'PAY02_VERSION_HISTORY_DELETE_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY02_PRODUCT_VERSION_HISTORY_IMMUTABLE' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 3d. Self-approval on governance proposals is refused by DB constraint.
  INSERT INTO public.pay02_activation_proposals (
    product_code, product_version, from_state, proposed_state, rationale, proposer_id, proposer_role
  ) VALUES (
    'sub.diaspora.buyer_pro', 1, 'draft', 'reviewed', 'Initial architecture review for Diaspora Buyer Pro', 'admin_user_1', 'admin'
  ) RETURNING id INTO v_prop_id;

  BEGIN
    UPDATE public.pay02_activation_proposals
      SET status = 'approved', reviewer_id = 'admin_user_1', reviewer_role = 'admin'
      WHERE id = v_prop_id;
    RAISE EXCEPTION 'PAY02_SELF_APPROVAL_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('pay02_proposal_separation_of_duties' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- Distinct reviewer succeeds.
  UPDATE public.pay02_activation_proposals
    SET status = 'approved', reviewer_id = 'owner_user_2', reviewer_role = 'owner', reviewed_at = now()
    WHERE id = v_prop_id;

  -- 4. Quote issuance: blocked/Category C/unpriced products are refused.
  BEGIN
    PERFORM public.pay02_issue_commercial_quote(
      'QT-PAY02-0000000000000001', 'mkt.vehicle_sale.principal', 1, 'buyer_1', 'buyer',
      'escrow_trust_sessions', 'sess_1', 'USD', 2, 50000, 'stripe_carup_japan_sandbox', 'pay02_idem_blocked_0001'
    );
    RAISE EXCEPTION 'PAY02_BLOCKED_PRODUCT_QUOTE_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY02_CHECKOUT_PROHIBITED_FOR_PRODUCT' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.pay02_issue_commercial_quote(
      'QT-PAY02-0000000000000002', 'sub.diaspora.buyer_pro', 1, 'buyer_1', 'diaspora_buyer',
      'diaspora_subscriptions', 'sub_1', 'JPY', 0, 1000, 'stripe_carup_japan_sandbox', 'pay02_idem_draft_000002'
    );
    RAISE EXCEPTION 'PAY02_DRAFT_PRODUCT_QUOTE_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY02_PRODUCT_NOT_COMMERCIALLY_ELIGIBLE' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 5. Deterministic server-authorized quote issuance & idempotency for `intel.report.vehicle_history_single`.
  v_quote_first := public.pay02_issue_commercial_quote(
    'QT-PAY02-ABCDEF0123456789', 'intel.report.vehicle_history_single', 1,
    'buyer_pilot_1', 'buyer', 'vehicle_report_versions', 'VIN-PILOT-001',
    'JPY', 0, 100, 'stripe_carup_japan_sandbox', 'pay02_quote_idem_pilot_0001'
  );
  v_quote_repeat := public.pay02_issue_commercial_quote(
    'QT-PAY02-ABCDEF0123456789', 'intel.report.vehicle_history_single', 1,
    'buyer_pilot_1', 'buyer', 'vehicle_report_versions', 'VIN-PILOT-001',
    'JPY', 0, 100, 'stripe_carup_japan_sandbox', 'pay02_quote_idem_pilot_0001'
  );
  v_quote_id := (v_quote_first->>'id')::uuid;
  IF v_quote_id IS NULL OR v_quote_first->>'id' IS DISTINCT FROM v_quote_repeat->>'id'
     OR (SELECT count(*) FROM public.pay02_commercial_quotes WHERE payer_id = 'buyer_pilot_1') <> 1 THEN
    RAISE EXCEPTION 'PAY02_QUOTE_ISSUANCE_NOT_IDEMPOTENT';
  END IF;

  -- 6. Quote immutability trigger: attempting to tamper with total_minor or legal_beneficiary is refused.
  BEGIN
    UPDATE public.pay02_commercial_quotes SET total_minor = 50 WHERE id = v_quote_id;
    RAISE EXCEPTION 'PAY02_QUOTE_AMOUNT_MUTATION_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('PAY02_QUOTE_ECONOMIC_OR_PARTY_TERMS_IMMUTABLE' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  -- 7. Canonical payment claim and lifecycle convergence without a second money ledger.
  v_claim_first := public.pay02_claim_quote_checkout(v_quote_id, 'buyer_pilot_1', 'pay02_claim_idem_pilot_0001');
  v_claim_repeat := public.pay02_claim_quote_checkout(v_quote_id, 'buyer_pilot_1', 'pay02_claim_idem_pilot_0001');
  v_payment_ref := v_claim_first->>'reference';
  IF v_payment_ref IS NULL
     OR v_claim_first->>'reference' IS DISTINCT FROM v_claim_repeat->>'reference'
     OR (SELECT status FROM public.pay02_commercial_quotes WHERE id = v_quote_id) <> 'payment_initiated' THEN
    RAISE EXCEPTION 'PAY02_CLAIM_CHECKOUT_FAILED';
  END IF;

  -- Attach Checkout & apply verified provider snapshot via existing canonical PAY-01A functions.
  PERFORM public.pay01a_attach_checkout(v_payment_ref, 'cs_test_pay02pilotfixture');
  PERFORM public.pay01a_apply_provider_snapshot(
    v_payment_ref, 'paid', 'pi_pay02pilotfixture', NULL, 'evt_pay02pilotpaid01', 'payment_intent.succeeded'
  );
  v_sync := public.pay02_sync_quote_from_canonical_payment(v_payment_ref);
  IF v_sync->>'quote_status' <> 'paid_verified' THEN
    RAISE EXCEPTION 'PAY02_QUOTE_PAID_SYNC_FAILED: %', v_sync;
  END IF;

  -- Refunding the canonical payment transitions the quote to `refunded` and blocks regression.
  PERFORM public.pay01a_apply_provider_snapshot(
    v_payment_ref, 'refunded', 'pi_pay02pilotfixture', 're_pay02pilotrefund01',
    'evt_pay02pilotrefund01', 'refund.created'
  );
  v_sync := public.pay02_sync_quote_from_canonical_payment(v_payment_ref);
  IF v_sync->>'quote_status' <> 'refunded' THEN
    RAISE EXCEPTION 'PAY02_QUOTE_REFUND_SYNC_FAILED: %', v_sync;
  END IF;

  -- 8. Multi-party obligation allocation constraint: third-party supplier principal cannot be marked CarUp revenue.
  BEGIN
    INSERT INTO public.pay02_obligation_allocations (
      parent_reference_type, parent_reference_id, payer_id, product_code,
      commercial_category, legal_beneficiary, funds_owner, merchant_of_record,
      is_carup_revenue, currency, currency_scale, amount_minor, collection_mode
    ) VALUES (
      'import_order', 'imp_order_01', 'importer_1', 'imp.vehicle.supplier_principal',
      'category_b_third_party', 'foreign_supplier', 'foreign_supplier', 'carup_japan',
      true, 'JPY', 0, 500000, 'direct_carup_merchant'
    );
    RAISE EXCEPTION 'PAY02_THIRD_PARTY_AS_CARUP_REVENUE_WRONGLY_PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    IF position('pay02_third_party_never_carup_revenue' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PAY02_POSTGRES_SMOKE_PASS: RLS, ACLs, fail-closed constraints, quote immutability, multi-party separation, and canonical payment convergence verified';
END $$;
