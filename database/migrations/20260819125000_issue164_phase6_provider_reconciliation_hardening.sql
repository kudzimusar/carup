-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6 — PROVIDER RECONCILIATION HARDENING
--
-- Replaces only the already-authored Phase 6 provider-state RPC. The previous body updated
-- `v_tx` before writing its escrow_trust_event, which meant the audit row could lose the true
-- from-state. This version captures `v_from_status` before mutation and uses it mechanically.
--
-- It also closes a reservation deadlock: an explicit provider `failed`/`cancelled` result before
-- funds are held may release the canonical reservation. That is provider truth, not a browser clock.
-- A captured/held payment still cannot be made Available by timeout or by a human client.
--
-- No legal ownership mutation exists here. Settlement may close the listing/reservation cache;
-- title/owner transfer remains a separate governed fact.
-- UNAPPLIED until the single guarded staging truth cutover after Phase 6.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.escrow_trust_events') IS NULL
     OR to_regclass('public.escrow_trust_webhook_events') IS NULL
     OR to_regclass('public.vehicle_reservations') IS NULL
     OR to_regclass('public.vehicles') IS NULL
     OR to_regclass('public.domain_events') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] provider reconciliation prerequisites absent';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.issue164_record_payment_state_atomic(
  p_session_id uuid,
  p_provider text,
  p_intent_id text,
  p_normalized_status text,
  p_provider_event_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS public.escrow_trust_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $reconcile$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_res public.vehicle_reservations%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_from_status text;
  v_next_status text;
  v_event_type text;
BEGIN
  IF p_normalized_status NOT IN (
    'requires_authorization','authorized','captured','released','refunded',
    'partially_refunded','cancelled','failed','unknown'
  ) THEN
    RAISE EXCEPTION 'unsupported normalized payment status' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_provider),'') IS NULL OR nullif(btrim(p_intent_id),'') IS NULL THEN
    RAISE EXCEPTION 'provider and payment intent are required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id=p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction intent not found' USING ERRCODE='P0002'; END IF;
  IF v_tx.payment_provider IS DISTINCT FROM p_provider
     OR v_tx.payment_intent_id IS DISTINCT FROM p_intent_id THEN
    RAISE EXCEPTION 'provider event does not match transaction payment intent' USING ERRCODE='23514';
  END IF;

  -- Both provider event id and reconciliation idempotency are replay fences. They are tested under
  -- the transaction row lock so two concurrent deliveries converge on one durable transition.
  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.escrow_trust_webhook_events
     WHERE idempotency_key=p_idempotency_key
  ) THEN
    RETURN v_tx;
  END IF;
  IF p_provider_event_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.escrow_trust_webhook_events
     WHERE provider=p_provider AND provider_event_id=p_provider_event_id
  ) THEN
    RETURN v_tx;
  END IF;

  v_from_status := v_tx.status;
  v_next_status := CASE p_normalized_status
    WHEN 'captured' THEN 'funds_held'
    WHEN 'released' THEN 'settled'
    WHEN 'refunded' THEN 'refunded'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'failed' THEN 'failed'
    ELSE v_from_status
  END;

  -- Structural provider-state authority. A provider may confirm its own money state but may not
  -- skip CarUp's transaction lifecycle. Polls for authorization/unknown do not move CarUp status.
  IF v_next_status='funds_held' AND v_from_status<>'initiated' THEN
    RAISE EXCEPTION 'captured payment requires initiated transaction' USING ERRCODE='23514';
  ELSIF v_next_status='settled' AND v_from_status<>'release_approved' THEN
    RAISE EXCEPTION 'payment release requires release_approved transaction' USING ERRCODE='23514';
  ELSIF v_next_status='refunded'
        AND v_from_status NOT IN ('funds_held','inspection_pending','release_approved','disputed') THEN
    RAISE EXCEPTION 'refund is not valid from transaction status %',v_from_status USING ERRCODE='23514';
  ELSIF v_next_status IN ('cancelled','failed')
        AND v_from_status NOT IN ('eligible','initiated') THEN
    RAISE EXCEPTION 'provider % is not valid from transaction status %',p_normalized_status,v_from_status
      USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_res
    FROM public.vehicle_reservations
   WHERE transaction_intent_id=v_tx.id
     AND status='active'
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  -- The reservation had to be active + unexpired when the provider intent was linked. After that
  -- point the seven-day clock is an availability timer, not authority to erase an attributable
  -- provider hold. If capture/release arrives after that clock (or the clock crosses between the
  -- provider call and this RPC), reconcile provider truth against the still-active reservation.
  -- Missing/cancelled/expired reservation state still fails closed.
  IF v_next_status IN ('funds_held','settled') THEN
    IF v_res.id IS NULL THEN
      RAISE EXCEPTION 'active canonical reservation required for money state %',v_next_status
        USING ERRCODE='23514';
    END IF;
  END IF;

  IF v_next_status='settled' THEN
    SELECT * INTO v_vehicle
      FROM public.vehicles
     WHERE vin=v_tx.vin
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'vehicle not found' USING ERRCODE='P0002'; END IF;
    IF v_vehicle.current_seller_id IS DISTINCT FROM v_tx.seller_id THEN
      RAISE EXCEPTION 'seller changed before settlement; manual reconciliation required'
        USING ERRCODE='23514';
    END IF;
  END IF;

  INSERT INTO public.escrow_trust_webhook_events(
    session_id,event_type,signature_valid,replay_detected,idempotency_key,payload,
    provider,provider_event_id,normalized_status,reconciled_at,created_at
  ) VALUES(
    v_tx.id,'payment_reconciliation',true,false,p_idempotency_key,coalesce(p_payload,'{}'::jsonb),
    btrim(p_provider),p_provider_event_id,p_normalized_status,v_now,v_now
  );

  UPDATE public.escrow_trust_sessions
     SET status=v_next_status,
         payment_state=p_normalized_status,
         payment_reconciled_at=v_now,
         updated_at=v_now
   WHERE id=v_tx.id
   RETURNING * INTO v_tx;

  IF v_next_status='settled' AND v_res.id IS NOT NULL THEN
    UPDATE public.vehicle_reservations
       SET status='completed',updated_at=v_now
     WHERE id=v_res.id;
    UPDATE public.vehicles
       SET status='Sold',reserved_at=NULL,reserved_until=NULL,active_reservation_id=NULL
     WHERE vin=v_tx.vin AND active_reservation_id=v_res.id;
  ELSIF v_next_status IN ('refunded','cancelled','failed') AND v_res.id IS NOT NULL THEN
    UPDATE public.vehicle_reservations
       SET status='cancelled',updated_at=v_now
     WHERE id=v_res.id;
    UPDATE public.vehicles
       SET status=CASE WHEN lower(coalesce(status,''))='reserved' THEN 'Available' ELSE status END,
           reserved_at=NULL,reserved_until=NULL,active_reservation_id=NULL
     WHERE vin=v_tx.vin AND active_reservation_id=v_res.id;
  END IF;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,
    v_from_status,
    v_next_status,
    NULL,
    'provider',
    'payment_reconciled',
    jsonb_build_object(
      'provider',btrim(p_provider),
      'normalized_status',p_normalized_status,
      'provider_event_id',p_provider_event_id
    ),
    v_now
  );

  v_event_type := CASE p_normalized_status
    WHEN 'captured' THEN 'MARKETPLACE_FUNDS_HELD'
    WHEN 'released' THEN 'MARKETPLACE_TRANSACTION_SETTLED'
    WHEN 'refunded' THEN 'MARKETPLACE_TRANSACTION_REFUNDED'
    WHEN 'cancelled' THEN 'MARKETPLACE_TRANSACTION_CANCELLED'
    WHEN 'failed' THEN 'MARKETPLACE_PAYMENT_FAILED'
    ELSE 'MARKETPLACE_PAYMENT_RECONCILED'
  END;

  -- A status poll that merely confirms the same nonterminal provider state still belongs in the
  -- reconciliation ledger above, but it need not flood the domain outbox. State-changing or terminal
  -- provider results get one domain event.
  IF v_next_status IS DISTINCT FROM v_from_status
     OR p_normalized_status IN ('captured','released','refunded','cancelled','failed') THEN
    INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
    VALUES(
      v_event_type,
      jsonb_build_object(
        'transactionIntentId',v_tx.id,
        'vin',v_tx.vin,
        'paymentState',p_normalized_status,
        'provider',btrim(p_provider)
      ),
      'pending',0,v_tx.tenant_id
    );
  END IF;

  RETURN v_tx;
END
$reconcile$;

REVOKE ALL ON FUNCTION public.issue164_record_payment_state_atomic(uuid,text,text,text,text,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_record_payment_state_atomic(uuid,text,text,text,text,text,jsonb)
  TO service_role;

-- Source-level/postcondition guard: provider reconciliation never owns legal title columns.
DO $post$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.issue164_record_payment_state_atomic(uuid,text,text,text,text,text,jsonb)'::regprocedure)
    INTO v_definition;
  IF v_definition ~* '\mowner_id\M|vehicle_ownership_history' THEN
    RAISE EXCEPTION '[issue-164-p6] provider reconciliation attempted to own legal vehicle title';
  END IF;
END
$post$;

-- +migrate Down
-- Forward-only. This function governs audited financial reconciliation and is not safely downgraded.
