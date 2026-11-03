/**
 * CARUP-PAY-05-R1 — the bounded changes R1 makes to functions the frozen PAY-05 migration defines. Every replaced function
 * in migration 20261104100000 is the PAY-05 text plus exactly these hunks (backend/tests/pay05-r1-function-drift.test.js).
 */
export const R1_HUNKS = {
  pay05_guard_integration: [
    [`     OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
     OR (OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at`,
     `     OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
     -- PAY-05-R1: a reviewed settlement currency is written once, by verification, and a verified integration has one
     OR NEW.test_auth_email IS DISTINCT FROM OLD.test_auth_email
     OR (OLD.currency_evidence IS NOT NULL AND NEW.currency_evidence IS DISTINCT FROM OLD.currency_evidence)
     OR (OLD.currency_evidence IS NULL AND NEW.currency_evidence IS NOT NULL AND NEW.status <> 'verified')
     OR (OLD.status = 'pending_verification' AND NEW.status = 'verified' AND NEW.currency_evidence IS NULL)
     OR (OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at`],
  ],
  pay05_guard_paynow_transaction: [
    [`     OR (OLD.attached_after_close AND NOT NEW.attached_after_close)
`,
     `     OR (OLD.attached_after_close AND NOT NEW.attached_after_close)
     -- PAY-05-R1: the status-update generation only moves forward
     OR NEW.status_update_generation < OLD.status_update_generation
`],
    [`             OR (OLD.initiation_state = 'unknown' AND NEW.initiation_state IN ('attached', 'traced_absent'))
`,
     `             -- PAY-05-R1: Paynow's refusal may arrive after a concurrent trace attempt marked the request unknown (ICR-M8)
             OR (OLD.initiation_state = 'unknown' AND NEW.initiation_state IN ('attached', 'traced_absent', 'refused'))
`],
  ],
  pay05_assert_independent_reviewer: [
    [`     OR EXISTS (SELECT 1 FROM public.pay05_merchant_integrations WHERE merchant_account_id = p_acct.id AND registered_by = trim(p_actor_id)) THEN
`,
     `     OR EXISTS (SELECT 1 FROM public.pay05_merchant_integrations WHERE merchant_account_id = p_acct.id AND registered_by = trim(p_actor_id))
     -- PAY-05-R1: a person who ever worked at this garage, though removed since: the workforce record outlives the membership (ICR-S3)
     OR EXISTS (SELECT 1 FROM public.garage_workforce_profiles WHERE tenant_id = p_acct.tenant_id AND user_id = trim(p_actor_id)) THEN
`],
  ],
  pay05_verified_integration: [
    [`     AND public.pay05_mode_permitted(i.mode)
`,
     `     AND public.pay05_mode_permitted(i.mode)
     -- PAY-05-R1: only a reviewed merchant+currency configuration binds a currency (ICR-P1); Paynow itself reports none
     AND i.currency_evidence->>'settlement_currency' = i.currency
`],
  ],
  pay04_invoice_money: [
    [`    SELECT COALESCE(sum(CASE
             WHEN (p.status IN ('pending', 'refund_pending', 'reconciliation_hold')
`,
     `    SELECT COALESCE(sum(CASE
             -- PAY-05-R1: money settled outside CarUp can never count here again, so it holds no room (ICR-M3)
             WHEN public.pay05_settled_off_platform(c.id) THEN 0
             WHEN (p.status IN ('pending', 'refund_pending', 'reconciliation_hold')
`],
  ],
  pay04_reproject_garage_collection: [
    [`  v_current := public.pay04_collection_allocated(v_c.id);
  -- money an operator settled OFF the platform never starts counting here, even if room appears later
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q WHERE q.collection_id = v_c.id
               AND q.discrepancy_type = 'unallocated_provider_money' AND q.status = 'resolved' AND q.resolution = 'settled_off_platform') THEN
`,
     `  -- PAY-05-R1: Paynow money counts only while Paynow's own latest evaluated word is a matching Paid CarUp applied. Closing a
  -- review or a canonical row still reading 'paid' never re-counts money Paynow reversed (ICR-M1).
  IF v_c.gateway = 'paynow_zimbabwe' AND public.pay05_latest_provider_status(v_c.id) IS DISTINCT FROM 'paid' THEN
    v_target := 0;
  END IF;
  v_current := public.pay04_collection_allocated(v_c.id);
  -- money an operator settled OFF the platform never starts counting here, even if room appears later
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies q WHERE q.collection_id = v_c.id
               AND q.discrepancy_type = 'unallocated_provider_money' AND q.status = 'resolved' AND q.resolution = 'settled_off_platform')
     -- PAY-05-R1: for every settled Paynow review type (ICR-M1)
     OR public.pay05_settled_off_platform(v_c.id) THEN
`],
    [`  v_actor text;
BEGIN
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id;
`,
     `  v_actor text;
  v_other uuid;
BEGIN
  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = p_collection_id;
`],
    [`  PERFORM set_config('carup.pay04_writer', '', true);
  RETURN jsonb_build_object('counted_target', v_target, 'allocated', v_alloc, 'delta', v_delta, 'unallocated', v_unallocated,
`,
     `  PERFORM set_config('carup.pay04_writer', '', true);
  -- PAY-05-R1: room this just gave up may be what other Paynow money on the invoice is waiting for: it counts now, oldest first,
  -- only into the room there is (PFR-M4). The invoice lock is held, so the shared lock order holds. Settled money stays capped.
  IF v_delta < 0 AND v_c.gateway = 'paynow_zimbabwe' AND v_inv.status = 'issued' THEN
    FOR v_other IN SELECT q.collection_id FROM public.pay04_garage_payment_discrepancies q
                     JOIN public.pay04_garage_collections o ON o.id = q.collection_id
                    WHERE o.invoice_id = v_inv.id AND o.id <> v_c.id AND o.gateway = 'paynow_zimbabwe'
                      AND q.discrepancy_type = 'unallocated_provider_money' AND q.status = 'open'
                    ORDER BY q.first_detected_at, q.collection_id LOOP
      PERFORM public.pay04_reproject_garage_collection(v_other, 'room_freed', NULL);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('counted_target', v_target, 'allocated', v_alloc, 'delta', v_delta, 'unallocated', v_unallocated,
`],
  ],
  pay04_resolve_garage_payment_discrepancy: [
    [`  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = v_d.collection_id;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_d.payment_reference;
`,
     `  SELECT * INTO v_c FROM public.pay04_garage_collections WHERE id = v_d.collection_id;
  -- PAY-05-R1: nor a person who worked at this garage, though removed since (PFR-L10)
  IF v_c.gateway = 'paynow_zimbabwe' AND public.pay05_worked_at_garage(v_c.tenant_id, p_actor_id) THEN
    RAISE EXCEPTION 'PAY04_RESOLUTION_SELF_DEALING_REFUSED';
  END IF;
  SELECT * INTO v_p FROM public.payment_transactions WHERE reference = v_d.payment_reference;
`],
    [`       AND NOT (v_c.gateway = 'paynow_zimbabwe' AND v_d.discrepancy_type IN ('amount_mismatch', 'provider_status_unrecognized')) THEN
`,
     `       -- PAY-05-R1: and a dispute or an unverifiable currency, which then never count: the exit when Paynow says nothing more (ICR-M4, P1)
       AND NOT (v_c.gateway = 'paynow_zimbabwe' AND v_d.discrepancy_type IN ('amount_mismatch', 'provider_status_unrecognized',
                                                                             'provider_disputed', 'currency_mismatch')) THEN
`],
    [`      RAISE EXCEPTION 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER';
    END IF;
`,
     `      RAISE EXCEPTION 'PAY05_DISPUTE_NOT_RESOLVED_BY_PROVIDER';
    END IF;
    -- PAY-05-R1: "corrected" means Paynow corrected it: its own latest word is a matching Paid CarUp applied (ICR-M1)
    IF v_c.gateway = 'paynow_zimbabwe' AND public.pay05_latest_provider_status(v_d.collection_id) IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'PAY05_CORRECTION_NOT_CONFIRMED_BY_PROVIDER';
    END IF;
`],
    [`    IF v_d.discrepancy_type NOT IN ('refund_after_resolution', 'provider_status_unrecognized', 'provider_refund_unquantified',
                                    'provider_paid_after_close') THEN RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID'; END IF;
`,
     `    IF v_d.discrepancy_type NOT IN ('refund_after_resolution', 'provider_status_unrecognized', 'provider_refund_unquantified',
                                    'provider_paid_after_close')
       -- PAY-05-R1: a dispute Paynow has since closed may be reviewed and closed; it never counts (ICR-M4)
       AND NOT (v_c.gateway = 'paynow_zimbabwe' AND v_d.discrepancy_type = 'provider_disputed'
                AND public.pay05_latest_provider_status(v_d.collection_id) IN
                    ('cancelled', 'failed', 'refunded', 'review:cancelled', 'review:failed', 'review:refunded')) THEN
      RAISE EXCEPTION 'PAY04_RESOLUTION_INVALID';
    END IF;
`],
  ],
  pay05_register_paynow_merchant: [
    [`    IF (v_item->>'currency') = ANY (v_currencies) THEN RAISE EXCEPTION 'PAY05_DUPLICATE_CURRENCY'; END IF;
`,
     `    IF (v_item->>'currency') = ANY (v_currencies) THEN RAISE EXCEPTION 'PAY05_DUPLICATE_CURRENCY'; END IF;
    -- PAY-05-R1: Paynow test mode authenticates express requests with the merchant's own login e-mail (ICR-P2)
    IF (v_item->>'mode') = 'paynow_test' AND coalesce(v_item->>'test_auth_email', '') !~ '^[^\\s@<>]{1,64}@[^\\s@<>]{1,190}\\.[A-Za-z]{2,24}$' THEN
      RAISE EXCEPTION 'PAY05_TEST_AUTH_EMAIL_REQUIRED';
    END IF;
`],
    [`  FOR v_item IN SELECT value FROM jsonb_array_elements(p_integrations) LOOP
    BEGIN
      INSERT INTO public.pay05_merchant_integrations (
        tenant_id, merchant_account_id, mode, currency, integration_id, methods, credential_ciphertext, credential_iv,
        credential_tag, credential_key_version, credential_fingerprint, status, registered_by, registered_role)
      VALUES (p_tenant_id, v_acct.id, v_item->>'mode', v_item->>'currency', v_item->>'integration_id',
        ARRAY(SELECT DISTINCT jsonb_array_elements_text(v_item->'methods') ORDER BY 1), v_item->>'ciphertext', v_item->>'iv',
        v_item->>'tag', (v_item->>'key_version')::smallint, v_item->>'fingerprint', 'pending_verification', trim(p_actor_id),
        'garage_admin')
      RETURNING * INTO v_int;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PAY05_INTEGRATION_ALREADY_REGISTERED';
    END;
`,
     `  FOR v_item IN SELECT value FROM jsonb_array_elements(p_integrations) LOOP
    -- PAY-05-R1: an ID is reserved only with the key proved by an authenticated Paynow reply; another garage's verified ID stays
    -- theirs after a disconnect (ICR-M11); a rejected ID cools down for everyone; every refusal reads the same (ICR-S2)
    IF coalesce(v_item->'probe'->>'result', '') <> 'authenticated'
       OR coalesce(v_item->'probe'->>'credential_fingerprint', '') <> coalesce(v_item->>'fingerprint', '')
       OR EXISTS (SELECT 1 FROM public.pay05_merchant_integrations i
                   WHERE i.mode = v_item->>'mode' AND i.integration_id = v_item->>'integration_id'
                     AND ((i.tenant_id <> p_tenant_id AND i.verified_at IS NOT NULL)
                          OR (i.status = 'rejected' AND i.closed_at > clock_timestamp() - interval '1 hour'))) THEN
      RAISE EXCEPTION 'PAY05_INTEGRATION_NOT_ACCEPTED';
    END IF;
    BEGIN
      INSERT INTO public.pay05_merchant_integrations (
        tenant_id, merchant_account_id, mode, currency, integration_id, methods, credential_ciphertext, credential_iv,
        credential_tag, credential_key_version, credential_fingerprint, status, registered_by, registered_role, test_auth_email)
      VALUES (p_tenant_id, v_acct.id, v_item->>'mode', v_item->>'currency', v_item->>'integration_id',
        ARRAY(SELECT DISTINCT jsonb_array_elements_text(v_item->'methods') ORDER BY 1), v_item->>'ciphertext', v_item->>'iv',
        v_item->>'tag', (v_item->>'key_version')::smallint, v_item->>'fingerprint', 'pending_verification', trim(p_actor_id),
        'garage_admin', CASE WHEN v_item->>'mode' = 'paynow_test' THEN v_item->>'test_auth_email' END)
      RETURNING * INTO v_int;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PAY05_INTEGRATION_NOT_ACCEPTED';
    END;
`],
  ],
  pay05_verify_paynow_merchant: [
    [`DECLARE v_acct public.pay04_garage_merchant_accounts%ROWTYPE; v_int public.pay05_merchant_integrations%ROWTYPE; v_count integer := 0;
`,
     `DECLARE v_acct public.pay04_garage_merchant_accounts%ROWTYPE; v_int public.pay05_merchant_integrations%ROWTYPE; v_count integer := 0; v_currency jsonb;
`],
    [`    UPDATE public.pay05_merchant_integrations SET status = 'verified', verified_by = trim(p_actor_id), verified_role = p_actor_role,
      verified_at = clock_timestamp(), verification_evidence = jsonb_build_object('credential_probe', p_evidence->'credential_probes'->v_int.id::text,
        'note', btrim(p_note))
     WHERE id = v_int.id RETURNING * INTO v_int;
`,
     `    -- PAY-05-R1: each integration's own settlement currency, reviewed in the merchant's Paynow account, must be this
    -- integration's currency; Paynow's API reports none and CarUp never converts (ICR-P1). A real mode also needs the fee
    -- handling attested: a fee-inclusive amount would make every payment an amount review (ICR-P3).
    v_currency := p_evidence->'currency_evidence'->v_int.id::text;
    IF coalesce(v_currency->>'settlement_currency', '') = '' OR char_length(btrim(coalesce(v_currency->>'reference', ''))) NOT BETWEEN 10 AND 200
       OR (v_int.mode <> 'simulator' AND v_currency->>'fee_handling' IS DISTINCT FROM 'amount_excludes_customer_fees') THEN
      RAISE EXCEPTION 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE';
    END IF;
    IF v_currency->>'settlement_currency' <> v_int.currency THEN RAISE EXCEPTION 'PAY05_CURRENCY_EVIDENCE_MISMATCH'; END IF;
    UPDATE public.pay05_merchant_integrations SET status = 'verified', verified_by = trim(p_actor_id), verified_role = p_actor_role,
      verified_at = clock_timestamp(), verification_evidence = jsonb_build_object('credential_probe', p_evidence->'credential_probes'->v_int.id::text,
        'note', btrim(p_note)),
      currency_evidence = jsonb_build_object('settlement_currency', v_currency->>'settlement_currency', 'reference', btrim(v_currency->>'reference'),
        'fee_handling', v_currency->>'fee_handling', 'reviewed_by', trim(p_actor_id), 'reviewed_at', clock_timestamp())
     WHERE id = v_int.id RETURNING * INTO v_int;
`],
  ],
  pay05_mark_paynow_initiation: [
    [`  IF v_tx.initiation_state <> 'sending' THEN RAISE EXCEPTION 'PAY05_INITIATION_STATE_INVALID' USING DETAIL = v_tx.initiation_state; END IF;
`,
     `  -- PAY-05-R1: Paynow's refusal may arrive after a concurrent trace attempt marked the request unknown (ICR-M8)
  IF v_tx.initiation_state NOT IN ('sending', 'unknown') THEN RAISE EXCEPTION 'PAY05_INITIATION_STATE_INVALID' USING DETAIL = v_tx.initiation_state; END IF;
`],
  ],
  pay05_apply_paynow_observation: [
    [`  v_disc jsonb := NULL;
  v_amount numeric;
BEGIN
  IF p_via NOT IN ('status_update', 'poll', 'trace', 'otp_reply') THEN RAISE EXCEPTION 'PAY05_OBSERVATION_SOURCE_INVALID'; END IF;
`,
     `  v_disc jsonb := NULL;
  v_amount numeric;
  v_settled boolean;
  v_money_seen boolean;
  v_last public.pay05_paynow_observations%ROWTYPE;
BEGIN
  IF p_via NOT IN ('status_update', 'poll', 'trace', 'otp_reply') THEN RAISE EXCEPTION 'PAY05_OBSERVATION_SOURCE_INVALID'; END IF;
`],
    [`  -- What this read may do (independent review D1, D3a). Paynow is read outside any lock, so arrival order is not
  -- Paynow's order: a read that started before the latest read CarUp evaluated is superseded; a pre-payment status after
  -- money is a lagging read (stale regression); after an operator settled the money outside CarUp, or once the payment
  -- is closed, a non-money status changes nothing. Each is recorded, never applied.
  IF v_tx.settled_off_platform_at IS NOT NULL THEN
    v_ignored := 'after_settlement';
  ELSIF p_read_ticket IS NOT NULL AND v_tx.last_read_ticket IS NOT NULL AND p_read_ticket < v_tx.last_read_ticket THEN
    v_ignored := 'superseded';
`,
     `  -- What this read may do (independent review D1, D3a). Paynow is read outside any lock, so arrival order is not
  -- Paynow's order: a read that started before the latest read CarUp evaluated is superseded; a pre-payment status after
  -- money is a lagging read (stale regression); after an operator settled the money outside CarUp, or once the payment
  -- is closed, a non-money status changes nothing. Each is recorded, never applied.
  -- PAY-05-R1: a ticket orders when CarUp asked, not when Paynow answered, so a word that moves the payment forward is never
  -- superseded (ICR-M7). After a settlement only a repeat of the settled evidence is recorded-only: anything else from Paynow
  -- is evaluated below, and money is reviewed, never allocated (ICR-M3).
  v_settled := v_tx.settled_off_platform_at IS NOT NULL;
  SELECT * INTO v_last FROM public.pay05_paynow_observations
   WHERE collection_id = v_c.id AND outcome IN ('applied', 'review') ORDER BY seq DESC LIMIT 1;
  v_money_seen := EXISTS (SELECT 1 FROM public.pay05_paynow_observations
                           WHERE collection_id = v_c.id AND outcome IN ('applied', 'review')
                             AND provider_status IN ('paid', 'awaiting_delivery', 'delivered', 'disputed'));
  -- PAY-05-R1: a status update CarUp already recorded, read again and showing nothing new, writes no row and starts no new
  -- generation (PFR-M3). It is still a read: an older one in flight must not pass it, and its time is shown.
  IF p_via = 'status_update' AND p_provider_status = v_tx.provider_status AND p_amount_minor IS NOT DISTINCT FROM v_last.amount_minor
     AND EXISTS (SELECT 1 FROM public.pay05_paynow_observations WHERE collection_id = v_c.id AND message_hash = p_message_hash) THEN
    UPDATE public.pay05_paynow_transactions SET last_read_at = clock_timestamp(), last_status_update_hash = p_message_hash,
      last_read_ticket = CASE WHEN p_read_ticket IS NULL THEN last_read_ticket ELSE greatest(coalesce(last_read_ticket, p_read_ticket), p_read_ticket) END,
      updated_at = clock_timestamp()
     WHERE collection_id = v_c.id;
    RETURN jsonb_build_object('applied', false, 'unchanged', true, 'provider_status', v_tx.provider_status, 'payment_status', v_p.status);
  END IF;
  IF p_read_ticket IS NOT NULL AND v_tx.last_read_ticket IS NOT NULL AND p_read_ticket < v_tx.last_read_ticket
     AND (public.pay05_paynow_money_rank(p_provider_status) <= public.pay05_paynow_money_rank(v_tx.provider_status)
          -- PAY-05-R1: an unrecognised word, or Cancelled or Failed after money, is the newer read's answer and has no place in the
          -- order above: only a newer read moves past it. An older read's Paid never overrides it (PFR-H1).
          OR (public.pay05_paynow_money_rank(v_tx.provider_status) = 0
              AND (v_tx.provider_status = 'unrecognized' OR v_money_seen))) THEN
    v_ignored := 'superseded';
`],
    [`    v_ignored := 'stale_regression';
  ELSIF v_p.status = 'cancelled' AND NOT v_money THEN
    v_ignored := 'after_close';
  END IF;
`,
     `    v_ignored := 'stale_regression';
  ELSIF v_settled AND (p_provider_status IN ('created', 'sent')
                       OR (p_provider_status = v_last.provider_status AND p_amount_minor IS NOT DISTINCT FROM v_last.amount_minor)) THEN
    v_ignored := 'after_settlement';
  -- PAY-05-R1: a Refunded on a closed payment always tells the operator, whether or not CarUp saw the money (PFR-L2)
  ELSIF v_p.status = 'cancelled' AND NOT v_money AND p_provider_status <> 'refunded' THEN
    v_ignored := 'after_close';
  -- PAY-05-R1: the same report again after an operator closed its review is recorded only: a re-read neither reopens the
  -- review nor takes the room back (ICR-M10); a different report is evaluated
  ELSIF v_last.outcome = 'review' AND p_provider_status = v_last.provider_status AND p_amount_minor IS NOT DISTINCT FROM v_last.amount_minor
        AND NOT EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies
                         WHERE collection_id = v_c.id AND status = 'open' AND discrepancy_type <> 'unallocated_provider_money') THEN
    v_ignored := 'after_review';
  END IF;
`],
    [`    IF v_money AND p_amount_minor IS DISTINCT FROM v_c.amount_minor THEN
      v_branch := 'amount_mismatch';
    ELSIF v_money AND v_p.status = 'cancelled' THEN
      v_branch := 'paid_after_close';
    ELSIF p_provider_status = 'disputed' THEN
      v_branch := 'disputed';
    ELSE
`,
     `    -- PAY-05-R1: money after a close or a settlement is late money whatever its amount (ICR-M3, M9); Disputed is a dispute
    -- whatever its amount (ICR-M5); an unverifiable currency never reaches an allocation (ICR-P1); Cancelled or Failed after
    -- Paynow reported money is a review, not an applied close (ICR-M4); a refund of a closed payment tells the operator.
    IF v_money AND (v_p.status = 'cancelled' OR (v_settled AND p_provider_status <> 'disputed')) THEN
      v_branch := 'paid_after_close';
    ELSIF p_provider_status = 'disputed' THEN
      v_branch := 'disputed';
    ELSIF v_money AND NOT public.pay05_collection_currency_bound(v_c.id) THEN
      v_branch := 'currency_unverified';
    ELSIF v_money AND p_amount_minor IS DISTINCT FROM v_c.amount_minor THEN
      v_branch := 'amount_mismatch';
    ELSIF p_provider_status IN ('cancelled', 'failed') AND v_money_seen THEN
      v_branch := 'unrecognized';
    ELSIF p_provider_status = 'refunded' AND v_p.status = 'cancelled' THEN
      v_branch := 'refund_after_close';
    ELSE
`],
    [`  IF v_ignored IS NOT NULL THEN
    RETURN jsonb_build_object('applied', false, 'ignored', v_ignored, 'observation_id', v_obs, 'provider_status', v_tx.provider_status,
      'payment_status', v_p.status);
  END IF;
`,
     `  -- PAY-05-R1: each recorded status update advances the collection's generation, which is part of the next update's identity
  -- (ICR-M2); the message counts as seen unless its confirming read was not evaluated, in which case a resend must read again
  IF p_via = 'status_update' THEN
    UPDATE public.pay05_paynow_transactions SET status_update_generation = status_update_generation + 1,
      last_status_update_hash = CASE WHEN coalesce(v_ignored, '') IN ('superseded', 'stale_regression') THEN last_status_update_hash ELSE p_message_hash END,
      updated_at = clock_timestamp()
     WHERE collection_id = v_c.id RETURNING * INTO v_tx;
  END IF;
  IF v_ignored IS NOT NULL THEN
    -- PAY-05-R1: a read that repeats what CarUp holds is still the newest read (PFR-H1) and the time Paynow was last read
    -- (PFR-L5). An older or lagging read is neither.
    IF v_ignored NOT IN ('superseded', 'stale_regression') THEN
      UPDATE public.pay05_paynow_transactions SET last_read_at = clock_timestamp(),
        last_read_ticket = CASE WHEN p_read_ticket IS NULL THEN last_read_ticket ELSE greatest(coalesce(last_read_ticket, p_read_ticket), p_read_ticket) END,
        updated_at = clock_timestamp()
       WHERE collection_id = v_c.id RETURNING * INTO v_tx;
    END IF;
    RETURN jsonb_build_object('applied', false, 'ignored', v_ignored, 'observation_id', v_obs, 'provider_status', v_tx.provider_status,
      'payment_status', v_p.status);
  END IF;
`],
    [`    paynow_reference = coalesce(paynow_reference, left(p_paynow_reference, 64)),
    last_status_update_hash = coalesce(p_message_hash, last_status_update_hash),
    last_read_ticket`,
     `    paynow_reference = coalesce(paynow_reference, left(p_paynow_reference, 64)),
    last_read_at = clock_timestamp(),
    last_read_ticket`],
    [`  INSERT INTO public.pay05_paynow_observations (tenant_id, collection_id, event_id, via, provider_status, raw_status, amount_minor,
    paynow_reference, read_ticket, outcome)
  VALUES (v_c.tenant_id, v_c.id, p_event_id, p_via, p_provider_status, left(p_raw_status, 160), p_amount_minor, left(p_paynow_reference, 64),
    p_read_ticket, coalesce(v_ignored, CASE WHEN v_branch = 'snapshot' THEN 'applied' ELSE 'review' END))
`,
     `  INSERT INTO public.pay05_paynow_observations (tenant_id, collection_id, event_id, via, provider_status, raw_status, amount_minor,
    paynow_reference, read_ticket, outcome, message_hash)
  VALUES (v_c.tenant_id, v_c.id, p_event_id, p_via, p_provider_status, left(p_raw_status, 160), p_amount_minor, left(p_paynow_reference, 64),
    p_read_ticket, coalesce(v_ignored, CASE WHEN v_branch = 'snapshot' THEN 'applied' ELSE 'review' END), p_message_hash)
`],
    [`    v_disc := public.pay04_record_discrepancy(v_c, 'provider_paid_after_close', v_amount,
      jsonb_build_object('observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id,
                         'payment_status', v_p.status, 'attached_after_close', v_tx.attached_after_close), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'refused', 'paid_after_close', 'discrepancy', v_disc);
`,
     `    v_disc := public.pay04_record_discrepancy(v_c, 'provider_paid_after_close', v_amount,
      jsonb_build_object('observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id,
                         'payment_status', v_p.status, 'attached_after_close', v_tx.attached_after_close,
                         'observed_amount_minor', p_amount_minor, 'after_settlement', v_settled), v_via, p_event_id);
    -- PAY-05-R1: evidence that disagrees with what was settled stops whatever part of it still counted
    v_result := jsonb_build_object('applied', false, 'refused', 'paid_after_close', 'discrepancy', v_disc,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_paid_after_close', NULL));
  ELSIF v_branch = 'currency_unverified' THEN
    -- PAY-05-R1: this integration has no reviewed settlement currency: the money is recorded for an operator, never allocated
    v_disc := public.pay04_record_discrepancy(v_c, 'currency_mismatch', v_amount,
      jsonb_build_object('reason', 'currency_configuration_unverified', 'observed_status', p_provider_status,
                         'observed_amount_minor', p_amount_minor, 'via', p_via, 'event_id', p_event_id), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'refused', 'currency_unverified', 'discrepancy', v_disc,
      'projection', public.pay04_reproject_garage_collection(v_c.id, 'provider_mismatch', NULL));
  ELSIF v_branch = 'refund_after_close' THEN
    -- PAY-05-R1: Paynow refunded money that CarUp had recorded as late money: the payment stays closed, the operator is told
    v_disc := public.pay04_record_discrepancy(v_c, 'provider_refund_unquantified', v_amount,
      jsonb_build_object('observed_status', p_provider_status, 'observed_amount_minor', p_amount_minor, 'via', p_via,
                         'event_id', p_event_id, 'payment_status', v_p.status), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'review', 'provider_refund_unquantified', 'discrepancy', v_disc);
`],
    [`      jsonb_build_object('observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id,
                         'payment_status', v_p.status), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'review', 'provider_disputed', 'discrepancy', v_disc,
`,
     `      jsonb_build_object('observed_status', p_provider_status, 'via', p_via, 'event_id', p_event_id,
                         'payment_status', v_p.status, 'observed_amount_minor', p_amount_minor), v_via, p_event_id);
    v_result := jsonb_build_object('applied', false, 'review', 'provider_disputed', 'discrepancy', v_disc,
`],
    [`    -- a Refunded whose amount did not parse is still the whole transaction refunded (independent review D3b): Paynow's
    -- "Refunded" names no refund amount, so the operator review below confirms it either way
    v_result := public.pay04_apply_garage_provider_snapshot(
      v_c.id, v_snapshot, v_c.provider_payment_id, NULL, NULL, NULL,
      CASE WHEN v_snapshot = 'refunded' THEN coalesce(p_amount_minor, v_c.amount_minor) ELSE p_amount_minor END,
      v_c.currency, v_acct.merchant_reference,
      CASE WHEN v_snapshot = 'refunded' THEN v_c.amount_minor ELSE NULL END,
      CASE WHEN v_snapshot = 'refunded' THEN 0 ELSE NULL END, NULL, NULL, v_via);
    IF v_snapshot = 'refunded' THEN
`,
     `    -- a Refunded whose amount did not parse is still the whole transaction refunded (independent review D3b): Paynow's
    -- "Refunded" names no refund amount, so the operator review below confirms it either way
    -- PAY-05-R1: and so is a Refunded with another figure: it applies in full and the figure is only evidence (ICR-M6)
    v_result := public.pay04_apply_garage_provider_snapshot(
      v_c.id, v_snapshot, v_c.provider_payment_id, NULL, NULL, NULL,
      CASE WHEN v_snapshot = 'refunded' THEN v_c.amount_minor ELSE p_amount_minor END,
      v_c.currency, v_acct.merchant_reference,
      CASE WHEN v_snapshot = 'refunded' THEN v_c.amount_minor ELSE NULL END,
      CASE WHEN v_snapshot = 'refunded' THEN 0 ELSE NULL END, NULL, NULL, v_via);
    -- PAY-05-R1: an observation recorded as applied really was: anything else aborts, nothing half-recorded (ICR-M6)
    IF (v_result->>'applied')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'PAY05_OBSERVATION_NOT_APPLIED' USING DETAIL = coalesce(v_result->>'refused', 'unknown');
    END IF;
    -- PAY-05-R1: one refund review per collection: an acknowledged one does not reopen on every re-read (ICR-M10)
    IF v_snapshot = 'refunded' AND NOT EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies
                                                WHERE collection_id = v_c.id AND discrepancy_type = 'provider_refund_unquantified' AND status = 'resolved') THEN
`],
  ],
  pay05_release_paynow_hold: [
    [`  IF v_p.status <> 'pending' THEN RAISE EXCEPTION 'PAY05_HOLD_NOT_RELEASABLE' USING DETAIL = v_p.status; END IF;
`,
     `  IF v_p.status <> 'pending' THEN RAISE EXCEPTION 'PAY05_HOLD_NOT_RELEASABLE' USING DETAIL = v_p.status; END IF;
  -- PAY-05-R1: never while a review of this payment is open (ICR-M4, W6)
  IF EXISTS (SELECT 1 FROM public.pay04_garage_payment_discrepancies WHERE collection_id = v_c.id AND status = 'open') THEN
    RAISE EXCEPTION 'PAY05_HOLD_NOT_RELEASABLE' USING DETAIL = 'review_open';
  END IF;
`],
    // PAY-05-R1: the latest read of any kind, including one recorded only because it repeats a word whose review closed (PFR-H2)
    [`    SELECT * INTO v_obs FROM public.pay05_paynow_observations
     WHERE collection_id = v_c.id AND outcome IN ('applied', 'review') ORDER BY seq DESC LIMIT 1;
`,
     `    -- PAY-05-R1: the latest read of any kind, including one recorded only because it repeats a word whose review closed (PFR-H2)
    SELECT * INTO v_obs FROM public.pay05_paynow_observations
     WHERE collection_id = v_c.id AND outcome IN ('applied', 'review', 'after_review') ORDER BY seq DESC LIMIT 1;
`],
    [`v_obs.provider_status NOT IN ('created', 'sent') THEN
`,
     `v_obs.provider_status NOT IN ('created', 'sent', 'cancelled', 'failed', 'unrecognized') THEN
`],
    // PAY-05-R1: a person who worked at this garage, though removed since (PFR-L10)
    [`  IF public.pay03b_payment_payer_conflict(v_probe.payment_reference, trim(p_actor_id)) THEN RAISE EXCEPTION 'PAY05_RELEASE_SELF_DEALING_REFUSED'; END IF;
`,
     `  -- PAY-05-R1: nor a person who worked at this garage, though removed since (PFR-L10)
  IF public.pay03b_payment_payer_conflict(v_probe.payment_reference, trim(p_actor_id)) OR public.pay05_worked_at_garage(v_probe.tenant_id, p_actor_id) THEN
    RAISE EXCEPTION 'PAY05_RELEASE_SELF_DEALING_REFUSED';
  END IF;
`],
  ],
  // every read attempt is timed, so a read that fails keeps its pace (PFR-L13)
  pay05_begin_paynow_read: [
    [`    RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND';
  END IF;
  RETURN nextval('public.pay05_paynow_read_ticket_seq');
`,
     `    RAISE EXCEPTION 'PAY05_COLLECTION_NOT_FOUND';
  END IF;
  -- PAY-05-R1: every attempt is timed, so reads that fail keep their pace (PFR-L13)
  UPDATE public.pay05_paynow_transactions SET last_read_attempt_at = clock_timestamp() WHERE collection_id = p_collection_id;
  RETURN nextval('public.pay05_paynow_read_ticket_seq');
`],
  ],
};

/** Functions PAY-04 defined and PAY-05 did not redefine: the same rule, against the PAY-04 text. */
export const R1_PAY04_HUNKS = {
  pay04_guard_invoice_void: [
    [`          WHERE c.invoice_id = OLD.id AND p.status IN ('paid', 'partially_refunded')) THEN
`,
     `          WHERE c.invoice_id = OLD.id AND p.status IN ('paid', 'partially_refunded')
            -- PAY-05-R1: a Paynow row still reading paid that no longer counts holds nothing, once settled or once Paynow's latest
            -- word is not Paid (PFR-L9). Open reviews stay reserved, and refuse below. Later money is never counted on a void invoice.
            AND NOT (c.gateway = 'paynow_zimbabwe' AND public.pay04_collection_allocated(c.id) = 0
                     AND (public.pay05_settled_off_platform(c.id) OR public.pay05_latest_provider_status(c.id) IS DISTINCT FROM 'paid'))) THEN
`],
  ],
};
