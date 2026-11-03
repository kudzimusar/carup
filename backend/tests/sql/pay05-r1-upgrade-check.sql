-- CARUP-PAY-05-R1 upgrade path: what R1 does with rows PAY-05 wrote. Nothing counted is taken away by the migration, and an
-- integration verified without per-currency evidence fails closed from now on.
DO $$
DECLARE c uuid; c2 uuid; v_acct uuid; v_ref text; v_pid text;
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN RAISE EXCEPTION 'PAY05_R1_DB_IDENTITY_REFUSED: %', current_database(); END IF;
  SELECT c0.id INTO c FROM pay04_garage_collections c0 WHERE c0.idempotency_key = 'r1u-key-0000001';
  SELECT c0.id, c0.merchant_account_id, c0.payment_reference, c0.provider_payment_id INTO c2, v_acct, v_ref, v_pid FROM pay04_garage_collections c0 WHERE c0.idempotency_key = 'r1u-key-0000002';
  IF pay04_collection_allocated(c) <> 40 THEN RAISE EXCEPTION 'PAY05_R1_UPGRADE: money PAY-05 counted must still count'; END IF;
  IF (SELECT count(*) FROM pay04_garage_provider_receipts WHERE collection_id = c AND status = 'issued') <> 1 THEN RAISE EXCEPTION 'PAY05_R1_UPGRADE: its receipt stands'; END IF;
  IF (SELECT status_update_generation FROM pay05_paynow_transactions WHERE collection_id = c) <> 0 THEN RAISE EXCEPTION 'PAY05_R1_UPGRADE: generation starts at zero'; END IF;
  IF pay05_verified_integration(v_acct, 'USD') IS NOT NULL THEN RAISE EXCEPTION 'PAY05_R1_UPGRADE: no currency evidence must mean not verified'; END IF;
  UPDATE pay05_runtime_guard SET paynow_simulator_enabled = true, paynow_available = true WHERE singleton;
  -- the in-flight request's money is a currency review, never an allocation
  PERFORM pay05_apply_paynow_observation(c2, 'poll', NULL, 'paid', 'Paid', 4000, v_ref, '9510', v_pid);
  IF pay04_collection_allocated(c2) <> 0 OR NOT EXISTS (SELECT 1 FROM pay04_garage_payment_discrepancies WHERE collection_id = c2 AND discrepancy_type = 'currency_mismatch' AND status = 'open') THEN
    RAISE EXCEPTION 'PAY05_R1_UPGRADE: in-flight money on an unreviewed integration must be a review';
  END IF;
  UPDATE pay05_runtime_guard SET paynow_simulator_enabled = false WHERE singleton;
  RAISE NOTICE 'PAY05_R1_UPGRADE_CHECK_PASS';
END $$;
