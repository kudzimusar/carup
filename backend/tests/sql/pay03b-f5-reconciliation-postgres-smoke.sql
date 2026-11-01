-- CARUP-PAY-03B-LR01 Work Unit 01 — F5 disposable PostgreSQL certification.
-- Runs after the certified PAY-01C / PAY-02 / PAY-03A smokes (which load the segregated synthetic fixtures)
-- and after 20261101120000_carup_pay03b_f5_payment_reconciliation_hold.sql.
--
-- Proves, against the real canonical functions:
--  A. ACLs: no API role can read or write reconciliation exceptions directly; service_role reads only; the
--     internal hold helpers are not executable by any API role.
--  B. A signed-webhook partial refund holds the payment, opens ONE exception with exact evidence, suspends the
--     PAY-03A order (refund_suspended) without revoking the snapshot, and blocks fulfillment/delivery.
--  C. Replay of the same event changes nothing; later readbacks (including "refund failed" and the legacy
--     PAY-01A writer) never lift the hold; stale lower states are refused.
--  D. Operator resolution requires: a real platform admin, a reason, a fresh verified provider state that
--     matches the outcome, and a resolver who is not the payer. Restore re-entitles atomically.
--  E. A provider-confirmed full refund supersedes the exception and revokes order + snapshot.
--  F. "Revoke final" ends in partially_refunded: order and snapshot revoked, never reactivated by later reads.
--  G. A first observation can converge pending -> reconciliation_hold / refunded (out-of-order events).
--  H. A held payment's refund actor may begin completing the refund without lowering the hold.
--  I. Cross-reference event replay is refused; closed exceptions are immutable; deletion is refused.
--  J. Unrelated payments and the certified PAY-03A refunded payment are untouched.

DO $$
BEGIN
  IF current_database() <> 'pay01c_sandbox_ci' THEN
    RAISE EXCEPTION 'PAY03B_DB_IDENTITY_REFUSED: %', current_database();
  END IF;
  IF (SELECT count(*) FROM public.vehicles WHERE vin IN ('WBA3A5C51DF358101', 'JTDBR32E820112202')) <> 2 THEN
    RAISE EXCEPTION 'PAY03B_F5_REQUIRES_SEGREGATED_SYNTHETIC_FIXTURES';
  END IF;
END $$;

-- A. ACLs
DO $$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, 'public.pay03b_payment_reconciliation_exceptions', 'SELECT')
       OR has_table_privilege(v_role, 'public.pay03b_payment_reconciliation_exceptions', 'INSERT')
       OR has_table_privilege(v_role, 'public.pay03b_payment_reconciliation_exceptions', 'UPDATE') THEN
      RAISE EXCEPTION 'PAY03B_EXCEPTIONS_EXPOSED_TO_%', v_role;
    END IF;
    IF has_function_privilege(v_role, 'public.pay03b_apply_provider_payment_snapshot(text,text,text,text,text,text,bigint,bigint,text[],text,text)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay03b_resolve_payment_reconciliation_exception(uuid,text,text,text,text,text,bigint,bigint,text[],timestamptz)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay03b_acknowledge_payment_reconciliation_exception(uuid,text,text)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay01a_apply_provider_snapshot(text,text,text,text,text,text)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay01a_begin_refund(text,text)', 'EXECUTE')
       OR has_function_privilege(v_role, 'public.pay02_sync_quote_from_canonical_payment(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'PAY03B_CANONICAL_RPC_EXPOSED_TO_%', v_role;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.pay03b_payment_reconciliation_exceptions', 'SELECT')
     OR has_table_privilege('service_role', 'public.pay03b_payment_reconciliation_exceptions', 'INSERT')
     OR has_table_privilege('service_role', 'public.pay03b_payment_reconciliation_exceptions', 'UPDATE')
     OR has_table_privilege('service_role', 'public.pay03b_payment_reconciliation_exceptions', 'DELETE')
     OR has_table_privilege('service_role', 'public.pay03b_payment_reconciliation_exceptions', 'TRUNCATE') THEN
    RAISE EXCEPTION 'PAY03B_SERVICE_ROLE_EXCEPTION_PRIVILEGES_WRONG';
  END IF;
  IF has_function_privilege('service_role', 'public.pay03b_payment_transition_target(public.payment_transactions,bigint,text,text,text,bigint,bigint,text[],text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.pay03b_record_payment_hold(public.payment_transactions,bigint,text,text,text,text,text,text,bigint,bigint,text[],text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PAY03B_INTERNAL_HOLD_HELPERS_EXPOSED';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.pay03b_apply_provider_payment_snapshot(text,text,text,text,text,text,bigint,bigint,text[],text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.pay03b_resolve_payment_reconciliation_exception(uuid,text,text,text,text,text,bigint,bigint,text[],timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PAY03B_SERVICE_ROLE_RPC_GRANT_MISSING';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pay03b_payment_reconciliation_exceptions'::regclass) THEN
    RAISE EXCEPTION 'PAY03B_EXCEPTIONS_RLS_DISABLED';
  END IF;
END $$;

-- Fixture identities (disposable DB only). Platform admins resolve; a dealer may not; a payer-admin may not
-- resolve their own payment.
INSERT INTO public.users (id, name, email, role, join_date) VALUES
  ('f5_ops_admin', 'F5 Ops Admin [SYNTHETIC]', 'f5.ops.admin@carup-uat.invalid', 'admin', '2026-11-01'),
  ('f5_not_admin', 'F5 Dealer [SYNTHETIC]', 'f5.dealer@carup-uat.invalid', 'dealer', '2026-11-01'),
  ('f5_payer_admin', 'F5 Payer Admin [SYNTHETIC]', 'f5.payer.admin@carup-uat.invalid', 'admin', '2026-11-01')
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION pg_temp.f5_paid_order(p_n integer, p_buyer text, p_vin text, p_fulfill boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_quote jsonb; v_claim jsonb; v_ref text; v_order uuid; v_ful jsonb; v_rv uuid := NULL;
BEGIN
  v_quote := public.pay02_issue_commercial_quote(
    'QT-PAY02-F5' || lpad(p_n::text, 14, '0'), 'intel.report.vehicle_history_single', 1, p_buyer, 'buyer',
    'vehicles', p_vin, 'JPY', 0, 100, 'stripe_carup_japan_sandbox', 'pay03b_f5_quote_' || lpad(p_n::text, 8, '0'));
  v_claim := public.pay02_claim_quote_checkout((v_quote->>'id')::uuid, p_buyer, 'pay03b_f5_claim_' || lpad(p_n::text, 8, '0'));
  v_ref := v_claim->>'reference';
  v_order := (v_claim->>'pay02_report_order_id')::uuid;
  PERFORM public.pay01a_attach_checkout(v_ref, 'cs_test_f5fixture' || p_n);
  PERFORM public.pay03b_apply_provider_payment_snapshot(v_ref, 'paid', 'pi_f5fixture' || p_n, NULL,
    'evt_f5paid' || p_n, 'checkout.session.completed', 0, 0, '{}'::text[], NULL, 'signed_webhook');
  PERFORM public.pay02_sync_quote_from_canonical_payment(v_ref);
  IF p_fulfill THEN
    v_ful := public.pay03a_complete_report_fulfillment(v_order, p_buyer, p_vin,
      jsonb_build_object('schema', 'vehicle_history_report.v1', 'vin', p_vin, 'f5_fixture', p_n),
      'sha256_f5_fixture_' || p_n, '{"lifecycle_source_coverage":0.75}'::jsonb);
    v_rv := (v_ful->>'report_version_id')::uuid;
  END IF;
  RETURN jsonb_build_object('order_id', v_order, 'reference', v_ref, 'intent', 'pi_f5fixture' || p_n,
    'report_version_id', v_rv);
END $$;

CREATE FUNCTION pg_temp.f5_expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_code IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'PAY03B_F5_WRONG_REFUSAL: expected % got %', p_code, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'PAY03B_F5_NOT_REFUSED: expected %', p_code;
END $$;

-- B..D: signed webhook partial refund, sticky hold, governed restore.
DO $$
DECLARE
  v_a jsonb; v_unrelated jsonb; v_r jsonb; v_x public.pay03b_payment_reconciliation_exceptions%ROWTYPE;
  v_ref text; v_order uuid; v_rv uuid; v_sync jsonb; v_res jsonb; v_unrelated_before text;
  v_certified_refunded text;
BEGIN
  SELECT reference INTO v_certified_refunded FROM public.payment_transactions
    WHERE pay01a_actor_id = 'buyer_pay03a_01' AND status = 'refunded' LIMIT 1;
  IF v_certified_refunded IS NULL THEN
    RAISE EXCEPTION 'PAY03B_F5_CERTIFIED_PAY03A_REFUND_FIXTURE_MISSING';
  END IF;

  v_a := pg_temp.f5_paid_order(1, 'f5_buyer_a', 'JTDBR32E820112202', true);
  v_unrelated := pg_temp.f5_paid_order(2, 'f5_buyer_unrelated', 'JTDBR32E820112202', true);
  SELECT md5(t::text) INTO v_unrelated_before FROM public.payment_transactions t WHERE reference = v_unrelated->>'reference';
  v_ref := v_a->>'reference'; v_order := (v_a->>'order_id')::uuid; v_rv := (v_a->>'report_version_id')::uuid;
  IF (SELECT entitlement_status FROM public.pay02_report_orders WHERE id = v_order) <> 'entitled' OR v_rv IS NULL THEN
    RAISE EXCEPTION 'PAY03B_F5_FIXTURE_NOT_ENTITLED';
  END IF;

  -- Evidence must be complete and consistent to hold a payment.
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_apply_provider_payment_snapshot(%L, 'reconciliation_hold',
    'pi_f5fixture1', NULL, NULL, NULL, 30, 0, ARRAY['re_f5part1'], 'partial_refund_pending', 'signed_webhook')$q$, v_ref),
    'PAY03B_RECONCILIATION_EVIDENCE_INVALID');
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_apply_provider_payment_snapshot(%L, 'reconciliation_hold',
    'pi_f5fixture1', NULL, NULL, NULL, 100, 0, ARRAY['re_f5part1'], 'partial_refund_succeeded', 'signed_webhook')$q$, v_ref),
    'PAY03B_RECONCILIATION_EVIDENCE_INVALID');
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_apply_provider_payment_snapshot(%L, 'reconciliation_hold',
    'pi_f5fixture1', NULL, NULL, NULL, 30, 0, '{}'::text[], 'partial_refund_succeeded', 'signed_webhook')$q$, v_ref),
    'PAY03B_RECONCILIATION_EVIDENCE_INVALID');
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_apply_provider_payment_snapshot(%L, 'reconciliation_hold',
    'pi_someoneelse', NULL, NULL, NULL, 30, 0, ARRAY['re_f5part1'], 'partial_refund_succeeded', 'signed_webhook')$q$, v_ref),
    'PAY01A_PAYMENT_INTENT_CHANGE_REFUSED');
  IF (SELECT status FROM public.payment_transactions WHERE reference = v_ref) <> 'paid'
     OR EXISTS (SELECT 1 FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref) THEN
    RAISE EXCEPTION 'PAY03B_F5_REFUSED_EVIDENCE_LEFT_STATE';
  END IF;

  -- B. Signed webhook: external partial refund of 30 succeeded.
  v_r := public.pay03b_apply_provider_payment_snapshot(v_ref, 'reconciliation_hold', 'pi_f5fixture1', NULL,
    'evt_f5partial1', 'charge.refunded', 30, 0, ARRAY['re_f5part1'], 'partial_refund_succeeded', 'signed_webhook');
  SELECT * INTO v_x FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref;
  IF v_r->>'status' <> 'reconciliation_hold' OR v_r->>'reconciliation_exception_event' <> 'opened'
     OR v_x.status <> 'open' OR v_x.prior_payment_status <> 'paid' OR v_x.detected_refunded_minor <> 30
     OR v_x.detected_pending_refund_minor <> 0 OR v_x.detected_refund_ids <> ARRAY['re_f5part1']
     OR v_x.detected_via <> 'signed_webhook' OR v_x.detection_event_id <> 'evt_f5partial1'
     OR v_x.payment_amount_minor <> 100 OR v_x.currency <> 'JPY' OR v_x.provider_payment_intent_id <> 'pi_f5fixture1'
     OR (SELECT pay01a_refund_id FROM public.payment_transactions WHERE reference = v_ref) IS NOT NULL
     OR (SELECT resulting_state FROM public.pay01a_stripe_event_receipts WHERE event_id = 'evt_f5partial1') <> 'reconciliation_hold' THEN
    RAISE EXCEPTION 'PAY03B_F5_HOLD_NOT_RECORDED: % / %', v_r, to_jsonb(v_x);
  END IF;
  v_sync := public.pay02_sync_quote_from_canonical_payment(v_ref);
  IF v_sync->>'report_entitlement_status' <> 'refund_suspended'
     OR (SELECT revoked FROM public.report_versions WHERE id = v_rv) <> false
     OR (SELECT status FROM public.pay02_commercial_quotes WHERE payment_reference = v_ref) <> 'fulfilled' THEN
    RAISE EXCEPTION 'PAY03B_F5_HOLD_DID_NOT_SUSPEND: %', v_sync;
  END IF;
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03a_complete_report_fulfillment(%L::uuid, 'f5_buyer_a',
    'JTDBR32E820112202', '{"schema":"vehicle_history_report.v1"}'::jsonb, 'sha256_f5_after_hold', '{}'::jsonb)$q$, v_order),
    'PAY02_PILOT_ENTITLEMENT_SUSPENDED');

  -- C. Exact replay changes nothing.
  v_r := public.pay03b_apply_provider_payment_snapshot(v_ref, 'reconciliation_hold', 'pi_f5fixture1', NULL,
    'evt_f5partial1', 'charge.refunded', 30, 0, ARRAY['re_f5part1'], 'partial_refund_succeeded', 'signed_webhook');
  IF (v_r->>'duplicate_event')::boolean IS DISTINCT FROM true
     OR (SELECT observation_count FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref) <> 1 THEN
    RAISE EXCEPTION 'PAY03B_F5_REPLAY_NOT_IDEMPOTENT: %', v_r;
  END IF;
  -- C. Provider readback says the refund failed (paid, nothing refunded): the hold is retained, not lifted.
  v_r := public.pay03b_apply_provider_payment_snapshot(v_ref, 'paid', 'pi_f5fixture1', NULL,
    NULL, NULL, 0, 0, '{}'::text[], NULL, 'provider_readback');
  SELECT * INTO v_x FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref;
  IF v_r->>'status' <> 'reconciliation_hold' OR (v_r->>'hold_retained')::boolean IS DISTINCT FROM true
     OR v_x.observation_count <> 2 OR v_x.last_observed_status <> 'paid' OR v_x.last_observed_refunded_minor <> 0
     OR v_x.last_observed_via <> 'provider_readback' OR v_x.detected_refunded_minor <> 30 THEN
    RAISE EXCEPTION 'PAY03B_F5_HOLD_LIFTED_BY_READBACK: % / %', v_r, to_jsonb(v_x);
  END IF;
  -- C. The certified PAY-01A writer cannot lift it either (paid or refund_pending), and stale lower states are refused.
  v_r := public.pay01a_apply_provider_snapshot(v_ref, 'paid', 'pi_f5fixture1', NULL, 'evt_f5legacypaid1', 'payment_intent.succeeded');
  IF v_r->>'status' <> 'reconciliation_hold' THEN RAISE EXCEPTION 'PAY03B_F5_LEGACY_WRITER_LIFTED_HOLD'; END IF;
  v_r := public.pay01a_apply_provider_snapshot(v_ref, 'refund_pending', 'pi_f5fixture1', NULL, NULL, NULL);
  IF v_r->>'status' <> 'reconciliation_hold'
     OR (SELECT last_observed_via FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref) <> 'legacy_snapshot_writer' THEN
    RAISE EXCEPTION 'PAY03B_F5_LEGACY_WRITER_LIFTED_HOLD';
  END IF;
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay01a_apply_provider_snapshot(%L, 'pending', NULL, NULL, NULL, NULL)$q$, v_ref),
    'PAY01A_STATUS_REGRESSION_REFUSED');
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay01a_apply_provider_snapshot(%L, 'reconciliation_hold', 'pi_f5fixture1', NULL, NULL, NULL)$q$, v_ref),
    'PAY01A_STATUS_INVALID');
  v_sync := public.pay02_sync_quote_from_canonical_payment(v_ref);
  IF v_sync->>'report_entitlement_status' <> 'refund_suspended' THEN
    RAISE EXCEPTION 'PAY03B_F5_SYNC_REENTITLED_HELD_PAYMENT: %', v_sync;
  END IF;

  -- D. Resolution governance.
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'restore_access_provider_unrefunded', 'f5_not_admin', 'admin', 'Provider shows the refund failed.', 'paid', 0, 0, '{}', clock_timestamp())$q$, v_x.id),
    'PAY03B_RESOLUTION_AUTHORITY_REFUSED');
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'restore_access_provider_unrefunded', 'f5_ops_admin', 'buyer', 'Provider shows the refund failed.', 'paid', 0, 0, '{}', clock_timestamp())$q$, v_x.id),
    'PAY03B_RESOLUTION_AUTHORITY_REFUSED');
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'restore_access_provider_unrefunded', 'f5_ops_admin', 'admin', 'short', 'paid', 0, 0, '{}', clock_timestamp())$q$, v_x.id),
    'PAY03B_RESOLUTION_NOTE_REQUIRED');
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'restore_access_provider_unrefunded', 'f5_ops_admin', 'admin', 'Provider shows the refund failed.', 'paid', 0, 0, '{}',
    clock_timestamp() - interval '1 hour')$q$, v_x.id),
    'PAY03B_PROVIDER_VERIFICATION_STALE');
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'restore_access_provider_unrefunded', 'f5_ops_admin', 'admin', 'Provider shows the refund failed.', 'reconciliation_hold', 30, 0,
    ARRAY['re_f5part1'], clock_timestamp())$q$, v_x.id),
    'PAY03B_RESTORE_REQUIRES_UNREFUNDED_PROVIDER_STATE');
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'mark_paid', 'f5_ops_admin', 'admin', 'Provider shows the refund failed.', 'paid', 0, 0, '{}', clock_timestamp())$q$, v_x.id),
    'PAY03B_RESOLUTION_INVALID');
  IF (SELECT status FROM public.pay03b_payment_reconciliation_exceptions WHERE id = v_x.id) <> 'open'
     OR (SELECT status FROM public.payment_transactions WHERE reference = v_ref) <> 'reconciliation_hold' THEN
    RAISE EXCEPTION 'PAY03B_F5_REFUSED_RESOLUTION_LEFT_STATE';
  END IF;
  -- Acknowledgement records who saw the alert and resolves nothing.
  PERFORM public.pay03b_acknowledge_payment_reconciliation_exception(v_x.id, 'f5_ops_admin', 'admin');
  IF (SELECT acknowledged_by FROM public.pay03b_payment_reconciliation_exceptions WHERE id = v_x.id) <> 'f5_ops_admin'
     OR (SELECT status FROM public.pay03b_payment_reconciliation_exceptions WHERE id = v_x.id) <> 'open' THEN
    RAISE EXCEPTION 'PAY03B_F5_ACKNOWLEDGEMENT_WRONG';
  END IF;

  v_res := public.pay03b_resolve_payment_reconciliation_exception(v_x.id, 'restore_access_provider_unrefunded',
    'f5_ops_admin', 'admin', 'Fresh provider readback: the external partial refund failed; nothing was refunded.',
    'paid', 0, 0, '{}', clock_timestamp());
  IF v_res->>'payment_status' <> 'paid'
     OR v_res->'sync'->>'report_entitlement_status' <> 'entitled'
     OR (SELECT status FROM public.pay03b_payment_reconciliation_exceptions WHERE id = v_x.id) <> 'resolved'
     OR (SELECT resolved_by FROM public.pay03b_payment_reconciliation_exceptions WHERE id = v_x.id) <> 'f5_ops_admin'
     OR (SELECT revoked FROM public.report_versions WHERE id = v_rv) <> false THEN
    RAISE EXCEPTION 'PAY03B_F5_RESTORE_FAILED: %', v_res;
  END IF;
  -- The bound snapshot is served again (idempotent replay returns the same version).
  IF (public.pay03a_complete_report_fulfillment(v_order, 'f5_buyer_a', 'JTDBR32E820112202',
        '{"schema":"vehicle_history_report.v1"}'::jsonb, 'sha256_f5_replay', '{}'::jsonb)->>'report_version_id')::uuid <> v_rv THEN
    RAISE EXCEPTION 'PAY03B_F5_RESTORED_SNAPSHOT_NOT_SERVED';
  END IF;
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'restore_access_provider_unrefunded', 'f5_ops_admin', 'admin', 'Second resolution attempt must fail.', 'paid', 0, 0, '{}', clock_timestamp())$q$, v_x.id),
    'PAY03B_RECONCILIATION_EXCEPTION_NOT_OPEN');

  -- I. Closed exceptions are immutable and never deleted, even by the table owner.
  PERFORM pg_temp.f5_expect_error(format($q$UPDATE public.pay03b_payment_reconciliation_exceptions SET resolution_note = 'tampered note value' WHERE id = %L$q$, v_x.id),
    'PAY03B_RECONCILIATION_EXCEPTION_CLOSED_IMMUTABLE');
  PERFORM pg_temp.f5_expect_error(format($q$DELETE FROM public.pay03b_payment_reconciliation_exceptions WHERE id = %L$q$, v_x.id),
    'PAY03B_RECONCILIATION_EXCEPTION_DELETE_FORBIDDEN');
  -- I. An event already bound to one payment cannot be replayed against another.
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_apply_provider_payment_snapshot(%L, 'reconciliation_hold',
    'pi_f5fixture2', NULL, 'evt_f5partial1', 'charge.refunded', 30, 0, ARRAY['re_f5part9'], 'partial_refund_succeeded', 'signed_webhook')$q$,
    v_unrelated->>'reference'), 'PAY01A_EVENT_CROSS_REFERENCE_REPLAY');

  -- J. The unrelated payment and the certified PAY-03A refund are untouched.
  IF (SELECT md5(t::text) FROM public.payment_transactions t WHERE reference = v_unrelated->>'reference') <> v_unrelated_before
     OR (SELECT entitlement_status FROM public.pay02_report_orders WHERE id = (v_unrelated->>'order_id')::uuid) <> 'entitled'
     OR (SELECT status FROM public.payment_transactions WHERE reference = v_certified_refunded) <> 'refunded'
     OR EXISTS (SELECT 1 FROM public.pay03b_payment_reconciliation_exceptions
                WHERE payment_reference IN (v_unrelated->>'reference', v_certified_refunded)) THEN
    RAISE EXCEPTION 'PAY03B_F5_UNRELATED_PAYMENT_AFFECTED';
  END IF;
  RAISE NOTICE 'PAY03B_F5_SMOKE B-D,I,J PASS: hold, sticky readback, governed restore, immutability, isolation';
END $$;

-- E. Pending partial refund, then the provider confirms the full refund: superseded, revoked.
DO $$
DECLARE v_c jsonb; v_ref text; v_r jsonb; v_x public.pay03b_payment_reconciliation_exceptions%ROWTYPE; v_sync jsonb;
BEGIN
  v_c := pg_temp.f5_paid_order(3, 'f5_buyer_c', 'JTDBR32E820112202', true);
  v_ref := v_c->>'reference';
  v_r := public.pay03b_apply_provider_payment_snapshot(v_ref, 'reconciliation_hold', 'pi_f5fixture3', NULL,
    'evt_f5pending3', 'refund.created', 0, 40, ARRAY['re_f5pend3'], 'partial_refund_pending', 'signed_webhook');
  IF v_r->>'status' <> 'reconciliation_hold' THEN RAISE EXCEPTION 'PAY03B_F5_PENDING_PARTIAL_NOT_HELD'; END IF;
  v_sync := public.pay02_sync_quote_from_canonical_payment(v_ref);
  IF v_sync->>'report_entitlement_status' <> 'refund_suspended' THEN RAISE EXCEPTION 'PAY03B_F5_PENDING_PARTIAL_NOT_SUSPENDED'; END IF;
  -- Out of order: the full-refund confirmation may arrive with any refund ordering.
  v_r := public.pay03b_apply_provider_payment_snapshot(v_ref, 'refunded', 'pi_f5fixture3', 're_f5pend3',
    'evt_f5full3', 'charge.refunded', 100, 0, ARRAY['re_f5pend3', 're_f5rest3'], NULL, 'signed_webhook');
  SELECT * INTO v_x FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref;
  v_sync := public.pay02_sync_quote_from_canonical_payment(v_ref);
  IF v_r->>'status' <> 'refunded' OR v_r->>'reconciliation_exception_event' <> 'superseded'
     OR v_x.status <> 'superseded' OR v_x.resolution <> 'superseded_provider_full_refund'
     OR v_x.resolved_role <> 'provider_confirmation'
     OR v_sync->>'quote_status' <> 'refunded' OR v_sync->>'report_entitlement_status' <> 'revoked_refunded'
     OR (SELECT revoked FROM public.report_versions WHERE id = (v_c->>'report_version_id')::uuid) <> true THEN
    RAISE EXCEPTION 'PAY03B_F5_FULL_REFUND_DID_NOT_SUPERSEDE: % / % / %', v_r, to_jsonb(v_x), v_sync;
  END IF;
  -- A refunded payment never reactivates.
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_apply_provider_payment_snapshot(%L, 'paid', 'pi_f5fixture3',
    NULL, NULL, NULL, 0, 0, '{}'::text[], NULL, 'provider_readback')$q$, v_ref), 'PAY01A_STATUS_REGRESSION_REFUSED');
  RAISE NOTICE 'PAY03B_F5_SMOKE E PASS: pending partial held, provider full refund supersedes and revokes';
END $$;

-- F. Operator-confirmed final partial refund: partially_refunded, revoked, never reactivated.
DO $$
DECLARE v_d jsonb; v_ref text; v_r jsonb; v_x uuid; v_res jsonb;
BEGIN
  v_d := pg_temp.f5_paid_order(4, 'f5_payer_admin', 'WBA3A5C51DF358101', true);
  v_ref := v_d->>'reference';
  v_r := public.pay03b_apply_provider_payment_snapshot(v_ref, 'reconciliation_hold', 'pi_f5fixture4', NULL,
    NULL, NULL, 30, 0, ARRAY['re_f5part4'], 'partial_refund_succeeded', 'provider_readback');
  SELECT id INTO v_x FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref AND status = 'open';
  -- The payer, even as a platform admin, cannot resolve their own payment.
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'revoke_access_partial_refund_final', 'f5_payer_admin', 'admin', 'Partial refund stands; revoke access.', 'reconciliation_hold',
    30, 0, ARRAY['re_f5part4'], clock_timestamp())$q$, v_x), 'PAY03B_RESOLUTION_SELF_DEALING_REFUSED');
  -- Revoke-final requires a settled partial refund.
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay03b_resolve_payment_reconciliation_exception(%L::uuid,
    'revoke_access_partial_refund_final', 'f5_ops_admin', 'admin', 'Partial refund stands; revoke access.', 'reconciliation_hold',
    30, 70, ARRAY['re_f5part4', 're_f5rest4'], clock_timestamp())$q$, v_x), 'PAY03B_REVOKE_FINAL_REQUIRES_SETTLED_PARTIAL_REFUND');
  v_res := public.pay03b_resolve_payment_reconciliation_exception(v_x, 'revoke_access_partial_refund_final',
    'f5_ops_admin', 'admin', 'Customer accepted the 30 JPY goodwill refund; access is permanently revoked.',
    'reconciliation_hold', 30, 0, ARRAY['re_f5part4'], clock_timestamp());
  IF v_res->>'payment_status' <> 'partially_refunded'
     OR v_res->'sync'->>'report_entitlement_status' <> 'revoked_refunded'
     OR (SELECT revoked FROM public.report_versions WHERE id = (v_d->>'report_version_id')::uuid) <> true
     OR (SELECT correction_notice FROM public.report_versions WHERE id = (v_d->>'report_version_id')::uuid)
          NOT LIKE '%operator-confirmed partial refund%' THEN
    RAISE EXCEPTION 'PAY03B_F5_REVOKE_FINAL_FAILED: %', v_res;
  END IF;
  -- Later observations never reactivate it; a provider-confirmed full refund is still recorded truthfully.
  v_r := public.pay03b_apply_provider_payment_snapshot(v_ref, 'paid', 'pi_f5fixture4', NULL, NULL, NULL, 0, 0, '{}'::text[], NULL, 'provider_readback');
  IF v_r->>'status' <> 'partially_refunded' OR (v_r->>'hold_retained')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PAY03B_F5_FINAL_REVOCATION_REACTIVATED: %', v_r;
  END IF;
  IF public.pay02_sync_quote_from_canonical_payment(v_ref)->>'report_entitlement_status' <> 'revoked_refunded' THEN
    RAISE EXCEPTION 'PAY03B_F5_FINAL_REVOCATION_REENTITLED';
  END IF;
  v_r := public.pay03b_apply_provider_payment_snapshot(v_ref, 'refunded', 'pi_f5fixture4', 're_f5part4', NULL, NULL, 100, 0,
    ARRAY['re_f5part4', 're_f5rest4'], NULL, 'provider_readback');
  IF v_r->>'status' <> 'refunded'
     OR (SELECT count(*) FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref) <> 1 THEN
    RAISE EXCEPTION 'PAY03B_F5_FINAL_THEN_FULL_REFUND_WRONG: %', v_r;
  END IF;
  RAISE NOTICE 'PAY03B_F5_SMOKE F PASS: self-dealing refused, settled partial required, final revocation permanent';
END $$;

-- G/H. First observation convergence and refund completion from a hold.
DO $$
DECLARE v_claim jsonb; v_quote jsonb; v_ref text; v_r jsonb; v_e jsonb; v_e_ref text;
BEGIN
  -- G. A payment never seen as paid (lost completion webhook) is first observed already partially refunded.
  v_quote := public.pay02_issue_commercial_quote('QT-PAY02-F500000000000005', 'intel.report.vehicle_history_single', 1,
    'f5_buyer_g', 'buyer', 'vehicles', 'JTDBR32E820112202', 'JPY', 0, 100, 'stripe_carup_japan_sandbox', 'pay03b_f5_quote_00000005');
  v_claim := public.pay02_claim_quote_checkout((v_quote->>'id')::uuid, 'f5_buyer_g', 'pay03b_f5_claim_00000005');
  v_ref := v_claim->>'reference';
  PERFORM public.pay01a_attach_checkout(v_ref, 'cs_test_f5fixture5');
  v_r := public.pay03b_apply_provider_payment_snapshot(v_ref, 'reconciliation_hold', 'pi_f5fixture5', NULL,
    'evt_f5first5', 'charge.refunded', 25, 0, ARRAY['re_f5part5'], 'partial_refund_succeeded', 'signed_webhook');
  IF v_r->>'status' <> 'reconciliation_hold'
     OR (SELECT prior_payment_status FROM public.pay03b_payment_reconciliation_exceptions WHERE payment_reference = v_ref) <> 'pending'
     OR public.pay02_sync_quote_from_canonical_payment(v_ref)->>'report_entitlement_status' = 'entitled' THEN
    RAISE EXCEPTION 'PAY03B_F5_FIRST_OBSERVATION_NOT_HELD: %', v_r;
  END IF;
  -- H. The payer-side refund authority may begin completing the refund; the hold is not lowered.
  v_r := public.pay01a_begin_refund(v_ref, 'f5_buyer_g');
  IF v_r->>'status' <> 'reconciliation_hold' OR (v_r->>'reconciliation_hold')::boolean IS DISTINCT FROM true
     OR (SELECT status FROM public.payment_transactions WHERE reference = v_ref) <> 'reconciliation_hold' THEN
    RAISE EXCEPTION 'PAY03B_F5_BEGIN_REFUND_LOWERED_HOLD: %', v_r;
  END IF;
  PERFORM pg_temp.f5_expect_error(format($q$SELECT public.pay01a_begin_refund(%L, 'f5_someone_else')$q$, v_ref),
    'PAY01A_REFUND_AUTHORITY_REFUSED');

  -- G. A pending payment first observed fully refunded converges to refunded (no access ever granted).
  v_quote := public.pay02_issue_commercial_quote('QT-PAY02-F500000000000006', 'intel.report.vehicle_history_single', 1,
    'f5_buyer_h', 'buyer', 'vehicles', 'JTDBR32E820112202', 'JPY', 0, 100, 'stripe_carup_japan_sandbox', 'pay03b_f5_quote_00000006');
  v_claim := public.pay02_claim_quote_checkout((v_quote->>'id')::uuid, 'f5_buyer_h', 'pay03b_f5_claim_00000006');
  v_e_ref := v_claim->>'reference';
  PERFORM public.pay01a_attach_checkout(v_e_ref, 'cs_test_f5fixture6');
  v_e := public.pay03b_apply_provider_payment_snapshot(v_e_ref, 'refunded', 'pi_f5fixture6', 're_f5full6',
    'evt_f5first6', 'charge.refunded', 100, 0, ARRAY['re_f5full6'], NULL, 'signed_webhook');
  IF v_e->>'status' <> 'refunded'
     OR public.pay02_sync_quote_from_canonical_payment(v_e_ref)->>'report_entitlement_status' <> 'revoked_refunded'
     OR (SELECT granted_at FROM public.pay02_report_orders WHERE payment_reference = v_e_ref) IS NOT NULL THEN
    RAISE EXCEPTION 'PAY03B_F5_PENDING_TO_REFUNDED_DID_NOT_CONVERGE: %', v_e;
  END IF;
  RAISE NOTICE 'PAY03B_F5_SMOKE G-H PASS: first-observation convergence, refund completion keeps the hold';
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.pay03b_payment_reconciliation_exceptions) <> 4
     OR (SELECT count(*) FROM public.pay03b_payment_reconciliation_exceptions WHERE status = 'open') <> 1 THEN
    RAISE EXCEPTION 'PAY03B_F5_EXCEPTION_INVENTORY_WRONG: % total, % open',
      (SELECT count(*) FROM public.pay03b_payment_reconciliation_exceptions),
      (SELECT count(*) FROM public.pay03b_payment_reconciliation_exceptions WHERE status = 'open');
  END IF;
  RAISE NOTICE 'PAY03B_F5_POSTGRES_SMOKE_PASS: partial-refund reconciliation hold, governed resolution, convergence and isolation';
END $$;
