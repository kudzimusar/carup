-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6A — ATOMIC HUMAN/SERVER TRANSACTION ACTIONS
--
-- A client requests an ACTION. The server maps that action to one fixed status and calls this
-- service-role-only function. Provider-confirmed money states are deliberately absent from this
-- function; they are accepted only by issue164_record_payment_state_atomic.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.escrow_trust_events') IS NULL
     OR to_regclass('public.vehicle_reservations') IS NULL
     OR to_regclass('public.vehicles') IS NULL
     OR to_regclass('public.domain_events') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] transaction action prerequisites absent';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.issue164_transition_session_atomic(
  p_session_id uuid,
  p_to_status text,
  p_actor_id text,
  p_actor_role text,
  p_reason text DEFAULT NULL,
  p_gate_allowed boolean DEFAULT NULL
)
RETURNS public.escrow_trust_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $transition$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_res public.vehicle_reservations%ROWTYPE;
  v_from text;
  v_role text := lower(coalesce(nullif(btrim(p_actor_role),''),'unknown'));
  v_is_privileged boolean;
  v_is_participant boolean;
  v_valid boolean := false;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_to_status NOT IN ('initiated','inspection_pending','release_approved','disputed','cancelled','failed') THEN
    RAISE EXCEPTION 'status % is not a human/server action target',p_to_status USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_actor_id),'') IS NULL THEN
    RAISE EXCEPTION 'authenticated/system actor required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id=p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction intent not found' USING ERRCODE='P0002'; END IF;

  v_from := v_tx.status;
  IF v_from=p_to_status THEN RETURN v_tx; END IF;

  v_is_privileged := v_role IN ('admin','platform_admin','super_admin','reviewer','system');
  v_is_participant := p_actor_id=v_tx.buyer_id OR p_actor_id=v_tx.seller_id;

  -- Structural transition graph. Provider states (funds_held/settled/refunded) never appear as
  -- targets here; that is the central separation this function enforces.
  v_valid := CASE v_from
    WHEN 'eligible' THEN p_to_status IN ('initiated','cancelled','failed')
    WHEN 'initiated' THEN p_to_status IN ('cancelled','failed')
    WHEN 'funds_held' THEN p_to_status IN ('inspection_pending','disputed')
    WHEN 'inspection_pending' THEN p_to_status IN ('release_approved','disputed')
    WHEN 'release_approved' THEN p_to_status='disputed'
    WHEN 'disputed' THEN p_to_status='cancelled'
    -- historical compatibility rows can enter the provider-neutral continuation without rewrite
    WHEN 'funded_sandbox' THEN p_to_status IN ('inspection_pending','disputed')
    ELSE false
  END;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'invalid transaction action: % -> %',v_from,p_to_status USING ERRCODE='23514';
  END IF;

  IF p_to_status='initiated' THEN
    IF p_actor_id IS DISTINCT FROM v_tx.buyer_id THEN
      RAISE EXCEPTION 'only the transaction buyer may initiate payment' USING ERRCODE='42501';
    END IF;
    IF p_gate_allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'current transaction gates do not permit initiation' USING ERRCODE='23514';
    END IF;
  ELSIF p_to_status='inspection_pending' THEN
    IF NOT v_is_privileged THEN
      RAISE EXCEPTION 'inspection transition requires privileged server/reviewer action' USING ERRCODE='42501';
    END IF;
  ELSIF p_to_status='release_approved' THEN
    IF NOT v_is_privileged THEN
      RAISE EXCEPTION 'release approval requires reviewer/admin action' USING ERRCODE='42501';
    END IF;
    IF p_gate_allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'current transaction gates do not permit release approval' USING ERRCODE='23514';
    END IF;
  ELSIF p_to_status='failed' THEN
    IF NOT v_is_privileged THEN
      RAISE EXCEPTION 'failure transition requires system/admin action' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NOT (v_is_participant OR v_is_privileged) THEN
      RAISE EXCEPTION 'actor is not a transaction participant' USING ERRCODE='42501';
    END IF;
  END IF;

  -- Cancellation after a provider intent exists must be reconciled through PaymentProvider.cancel().
  -- Otherwise the DB could say cancelled while the provider still holds an authorization.
  IF p_to_status='cancelled' AND v_tx.payment_intent_id IS NOT NULL THEN
    RAISE EXCEPTION 'provider-linked transaction must be cancelled through the payment provider'
      USING ERRCODE='23514';
  END IF;

  UPDATE public.escrow_trust_sessions
     SET status=p_to_status,updated_at=v_now
   WHERE id=v_tx.id
   RETURNING * INTO v_tx;

  -- A pre-payment cancellation releases the canonical reservation atomically. No later cleanup job
  -- is required to make the listing available again.
  IF p_to_status='cancelled' THEN
    SELECT * INTO v_res
      FROM public.vehicle_reservations
     WHERE transaction_intent_id=v_tx.id AND status='active'
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.vehicle_reservations SET status='cancelled',updated_at=v_now WHERE id=v_res.id;
      UPDATE public.vehicles
         SET status='Available',reserved_at=NULL,reserved_until=NULL,active_reservation_id=NULL
       WHERE vin=v_tx.vin AND active_reservation_id=v_res.id;
    END IF;
  END IF;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,v_from,p_to_status,p_actor_id,v_role,left(p_reason,500),NULL,v_now
  );

  INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
  VALUES(
    CASE p_to_status
      WHEN 'initiated' THEN 'MARKETPLACE_PAYMENT_INITIATED'
      WHEN 'inspection_pending' THEN 'MARKETPLACE_INSPECTION_PENDING'
      WHEN 'release_approved' THEN 'MARKETPLACE_RELEASE_APPROVED'
      WHEN 'disputed' THEN 'MARKETPLACE_TRANSACTION_DISPUTED'
      WHEN 'cancelled' THEN 'MARKETPLACE_TRANSACTION_CANCELLED'
      ELSE 'MARKETPLACE_TRANSACTION_FAILED'
    END,
    jsonb_build_object(
      'transactionIntentId',v_tx.id,
      'vin',v_tx.vin,
      'fromStatus',v_from,
      'toStatus',p_to_status
    ),
    'pending',0,v_tx.tenant_id
  );

  RETURN v_tx;
END
$transition$;

REVOKE ALL ON FUNCTION public.issue164_transition_session_atomic(uuid,text,text,text,text,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_transition_session_atomic(uuid,text,text,text,text,boolean)
  TO service_role;

-- +migrate Down
-- Forward-only. Transaction/audit state is not deleted by rollback.
