-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6 — SETTLEMENT RECOVERY / RELEASE FENCE
--
-- Migration 1270 introduced provider-confirmed settlement recovery and 1280 serialized
-- settlement vs refund. A remaining race existed between the provider NOT-RELEASED observation
-- and the recovery write: a release retry could have already received the pending claim and call
-- the provider after recovery observed `captured`.
--
-- This migration closes that race without inventing process-local locking:
--   1. recovery acquires a durable canonical transaction fence BEFORE provider confirmation;
--   2. settlement claim/re-claim fails closed while that fence is active;
--   3. the currently callable durable sandbox provider serializes `released` against the same
--      canonical row and requires the exact settlement operation to remain pending and unfenced;
--   4. provider `released` truth may still reconcile and closes the fence as `completed`;
--   5. provider-confirmed `captured/not-released` closes the fence as `recovered`, after which a
--      stale release request is no longer provider-authorized.
--
-- No live provider is activated here. Any future live adapter remains independently gated and must
-- prove equivalent release/recovery serialization before entering the live provider allowlist.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.escrow_trust_events') IS NULL
     OR to_regclass('public.safetrade_sandbox_payment_intents') IS NULL
     OR to_regprocedure('public.issue164_begin_settlement_atomic(uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.issue164_recover_settlement_atomic(uuid,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] migration 1290 requires settlement recovery 1270 + race hardening 1280';
  END IF;
END
$pre$;

ALTER TABLE public.escrow_trust_sessions
  ADD COLUMN IF NOT EXISTS settlement_recovery_fenced_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_recovery_fence_operation_key text,
  ADD COLUMN IF NOT EXISTS settlement_recovery_fence_actor_id text,
  ADD COLUMN IF NOT EXISTS settlement_recovery_fence_closed_at timestamptz;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.escrow_trust_sessions'::regclass
       AND conname='escrow_trust_settlement_recovery_fence_pair_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_settlement_recovery_fence_pair_chk CHECK (
        (
          settlement_recovery_fenced_at IS NULL
          AND settlement_recovery_fence_operation_key IS NULL
          AND settlement_recovery_fence_actor_id IS NULL
          AND settlement_recovery_fence_closed_at IS NULL
        )
        OR
        (
          settlement_recovery_fenced_at IS NOT NULL
          AND nullif(btrim(settlement_recovery_fence_operation_key),'') IS NOT NULL
          AND nullif(btrim(settlement_recovery_fence_actor_id),'') IS NOT NULL
          AND settlement_recovery_fence_operation_key=settlement_operation_key
          AND (
            settlement_recovery_fence_closed_at IS NULL
            OR settlement_recovery_fence_closed_at>=settlement_recovery_fenced_at
          )
        )
      );
  END IF;
END
$constraints$;

CREATE OR REPLACE FUNCTION public.issue164_begin_settlement_recovery_atomic(
  p_session_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_operation_key text
)
RETURNS public.escrow_trust_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $recovery_fence$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_role text := lower(coalesce(nullif(btrim(p_actor_role),''),'unknown'));
  v_state text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF nullif(btrim(p_actor_id),'') IS NULL OR nullif(btrim(p_operation_key),'') IS NULL THEN
    RAISE EXCEPTION 'settlement recovery fence requires actor and operation key' USING ERRCODE='22023';
  END IF;
  IF v_role NOT IN ('admin','platform_admin','super_admin','reviewer') THEN
    RAISE EXCEPTION 'settlement recovery fence requires reviewer/admin action' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id=p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction intent not found' USING ERRCODE='P0002'; END IF;

  v_state := coalesce(v_tx.settlement_operation_state,
    CASE WHEN v_tx.settlement_operation_key IS NULL THEN NULL ELSE 'pending' END);

  IF v_tx.status<>'release_approved'
     OR v_tx.payment_state<>'captured'
     OR v_tx.settlement_operation_key IS DISTINCT FROM p_operation_key
     OR v_state<>'pending'
     OR v_tx.settlement_seller_id IS DISTINCT FROM v_tx.seller_id
     OR v_tx.settlement_payment_intent_id IS DISTINCT FROM v_tx.payment_intent_id THEN
    RAISE EXCEPTION 'settlement recovery fence does not match the pending attributable operation'
      USING ERRCODE='23514';
  END IF;
  IF v_tx.refund_operation_key IS NOT NULL THEN
    RAISE EXCEPTION 'refund already claimed; settlement recovery fence cannot start'
      USING ERRCODE='23514';
  END IF;

  IF v_tx.settlement_recovery_fenced_at IS NOT NULL THEN
    IF v_tx.settlement_recovery_fence_operation_key IS DISTINCT FROM p_operation_key THEN
      RAISE EXCEPTION 'transaction already has a different settlement recovery fence'
        USING ERRCODE='23505';
    END IF;
    IF v_tx.settlement_recovery_fence_closed_at IS NULL THEN
      RETURN v_tx;
    END IF;
    RAISE EXCEPTION 'settlement recovery fence is already closed' USING ERRCODE='23514';
  END IF;

  UPDATE public.escrow_trust_sessions
     SET settlement_recovery_fenced_at=v_now,
         settlement_recovery_fence_operation_key=p_operation_key,
         settlement_recovery_fence_actor_id=p_actor_id,
         settlement_recovery_fence_closed_at=NULL,
         updated_at=v_now
   WHERE id=v_tx.id
   RETURNING * INTO v_tx;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,'release_approved','release_approved',p_actor_id,v_role,
    'settlement_recovery_fenced',
    jsonb_build_object(
      'settlementOperationKey',p_operation_key,
      'paymentIntentId',v_tx.settlement_payment_intent_id
    ),v_now
  );

  RETURN v_tx;
END
$recovery_fence$;

REVOKE ALL ON FUNCTION public.issue164_begin_settlement_recovery_atomic(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_begin_settlement_recovery_atomic(uuid,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue164_begin_settlement_atomic(
  p_session_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_operation_key text
)
RETURNS public.escrow_trust_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $claim$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_res public.vehicle_reservations%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_role text := lower(coalesce(nullif(btrim(p_actor_role),''),'unknown'));
  v_now timestamptz := clock_timestamp();
  v_reason text := 'settlement_operation_claimed';
BEGIN
  IF nullif(btrim(p_actor_id),'') IS NULL OR nullif(btrim(p_operation_key),'') IS NULL THEN
    RAISE EXCEPTION 'settlement actor and operation key required' USING ERRCODE='22023';
  END IF;
  IF v_role NOT IN ('admin','platform_admin','super_admin','reviewer') THEN
    RAISE EXCEPTION 'settlement claim requires reviewer/admin action' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id=p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction intent not found' USING ERRCODE='P0002'; END IF;

  IF v_tx.settlement_recovery_fenced_at IS NOT NULL
     AND v_tx.settlement_recovery_fence_closed_at IS NULL THEN
    RAISE EXCEPTION 'settlement recovery in progress; release retry blocked'
      USING ERRCODE='23514';
  END IF;

  IF v_tx.status<>'release_approved' THEN
    RAISE EXCEPTION 'transaction must be release_approved before settlement claim' USING ERRCODE='23514';
  END IF;
  IF v_tx.payment_state<>'captured'
     OR nullif(btrim(v_tx.payment_intent_id),'') IS NULL
     OR nullif(btrim(v_tx.payment_provider),'') IS NULL THEN
    RAISE EXCEPTION 'settlement requires attributable captured provider funds' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_res
    FROM public.vehicle_reservations
   WHERE transaction_intent_id=v_tx.id AND status='active'
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active canonical reservation required before settlement claim' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_vehicle
    FROM public.vehicles
   WHERE vin=v_tx.vin
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle not found' USING ERRCODE='P0002'; END IF;
  IF v_vehicle.current_seller_id IS DISTINCT FROM v_tx.seller_id THEN
    RAISE EXCEPTION 'seller changed before settlement claim; manual reconciliation required'
      USING ERRCODE='23514';
  END IF;

  IF v_tx.settlement_operation_key IS NOT NULL THEN
    IF v_tx.settlement_operation_key IS DISTINCT FROM p_operation_key
       OR v_tx.settlement_seller_id IS DISTINCT FROM v_tx.seller_id
       OR v_tx.settlement_payment_intent_id IS DISTINCT FROM v_tx.payment_intent_id THEN
      RAISE EXCEPTION 'transaction already has a different settlement operation claim'
        USING ERRCODE='23505';
    END IF;
    IF coalesce(v_tx.settlement_operation_state,'pending')='completed' THEN
      RAISE EXCEPTION 'settlement operation is already completed' USING ERRCODE='23514';
    END IF;
    IF coalesce(v_tx.settlement_operation_state,'pending')='pending' THEN
      RETURN v_tx;
    END IF;
    v_reason := 'settlement_operation_reclaimed';
    UPDATE public.escrow_trust_sessions
       SET settlement_operation_state='pending',
           settlement_operation_started_at=v_now,
           settlement_operation_actor_id=p_actor_id,
           updated_at=v_now
     WHERE id=v_tx.id
     RETURNING * INTO v_tx;
  ELSE
    UPDATE public.escrow_trust_sessions
       SET settlement_operation_key=p_operation_key,
           settlement_operation_state='pending',
           settlement_operation_started_at=v_now,
           settlement_operation_actor_id=p_actor_id,
           settlement_seller_id=v_tx.seller_id,
           settlement_payment_intent_id=v_tx.payment_intent_id,
           updated_at=v_now
     WHERE id=v_tx.id
     RETURNING * INTO v_tx;
  END IF;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,'release_approved','release_approved',p_actor_id,v_role,v_reason,
    jsonb_build_object(
      'settlementOperationKey',v_tx.settlement_operation_key,
      'settlementOperationState',v_tx.settlement_operation_state,
      'sellerId',v_tx.settlement_seller_id,
      'paymentIntentId',v_tx.settlement_payment_intent_id
    ),v_now
  );

  RETURN v_tx;
END
$claim$;

REVOKE ALL ON FUNCTION public.issue164_begin_settlement_atomic(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_begin_settlement_atomic(uuid,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue164_recover_settlement_atomic(
  p_session_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_operation_key text,
  p_provider_status text,
  p_confirmation_reference text
)
RETURNS public.escrow_trust_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $recover$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_role text := lower(coalesce(nullif(btrim(p_actor_role),''),'unknown'));
  v_status text := lower(coalesce(nullif(btrim(p_provider_status),''),'unknown'));
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_role NOT IN ('admin','platform_admin','super_admin','reviewer') THEN
    RAISE EXCEPTION 'settlement recovery requires reviewer/admin action' USING ERRCODE='42501';
  END IF;
  IF nullif(btrim(p_actor_id),'') IS NULL
     OR nullif(btrim(p_operation_key),'') IS NULL
     OR nullif(btrim(p_confirmation_reference),'') IS NULL THEN
    RAISE EXCEPTION 'settlement recovery requires actor, operation key and provider confirmation reference'
      USING ERRCODE='22023';
  END IF;
  IF v_status<>'captured' THEN
    RAISE EXCEPTION 'settlement recovery requires provider-confirmed captured/not-released state'
      USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id=p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction intent not found' USING ERRCODE='P0002'; END IF;

  IF v_tx.status<>'release_approved'
     OR v_tx.payment_state<>'captured'
     OR v_tx.settlement_operation_key IS DISTINCT FROM p_operation_key
     OR coalesce(v_tx.settlement_operation_state,'pending')<>'pending'
     OR v_tx.settlement_seller_id IS DISTINCT FROM v_tx.seller_id
     OR v_tx.settlement_payment_intent_id IS DISTINCT FROM v_tx.payment_intent_id
     OR v_tx.settlement_recovery_fenced_at IS NULL
     OR v_tx.settlement_recovery_fence_operation_key IS DISTINCT FROM p_operation_key
     OR v_tx.settlement_recovery_fence_closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'settlement recovery does not match the fenced pending attributable operation'
      USING ERRCODE='23514';
  END IF;

  UPDATE public.escrow_trust_sessions
     SET settlement_operation_state='recovered',
         settlement_recovery_confirmed_at=v_now,
         settlement_recovery_provider_status='captured',
         settlement_recovery_reference=btrim(p_confirmation_reference),
         settlement_recovery_actor_id=p_actor_id,
         settlement_recovery_fence_closed_at=v_now,
         updated_at=v_now
   WHERE id=v_tx.id
   RETURNING * INTO v_tx;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,'release_approved','release_approved',p_actor_id,v_role,
    'settlement_operation_recovered',
    jsonb_build_object(
      'settlementOperationKey',v_tx.settlement_operation_key,
      'providerStatus','captured',
      'confirmationReference',btrim(p_confirmation_reference),
      'recoveryFencedAt',v_tx.settlement_recovery_fenced_at
    ),v_now
  );

  RETURN v_tx;
END
$recover$;

REVOKE ALL ON FUNCTION public.issue164_recover_settlement_atomic(uuid,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_recover_settlement_atomic(uuid,text,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue164_sandbox_release_recovery_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $sandbox_release_guard$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
BEGIN
  IF NEW.status='released' AND OLD.status IS DISTINCT FROM 'released' THEN
    SELECT * INTO v_tx
      FROM public.escrow_trust_sessions
     WHERE id=NEW.transaction_intent_id
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sandbox release has no canonical transaction' USING ERRCODE='23514';
    END IF;
    IF v_tx.status<>'release_approved'
       OR coalesce(v_tx.settlement_operation_state,
         CASE WHEN v_tx.settlement_operation_key IS NULL THEN NULL ELSE 'pending' END)<>'pending'
       OR v_tx.settlement_payment_intent_id IS DISTINCT FROM NEW.intent_id
       OR v_tx.payment_intent_id IS DISTINCT FROM NEW.intent_id
       OR v_tx.refund_operation_key IS NOT NULL THEN
      RAISE EXCEPTION 'sandbox release lacks a pending attributable settlement operation'
        USING ERRCODE='23514';
    END IF;
    IF v_tx.settlement_recovery_fenced_at IS NOT NULL
       AND v_tx.settlement_recovery_fence_closed_at IS NULL THEN
      RAISE EXCEPTION 'settlement recovery in progress; sandbox release blocked'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END
$sandbox_release_guard$;

DROP TRIGGER IF EXISTS issue164_sandbox_release_recovery_guard_trg
  ON public.safetrade_sandbox_payment_intents;
CREATE TRIGGER issue164_sandbox_release_recovery_guard_trg
BEFORE UPDATE ON public.safetrade_sandbox_payment_intents
FOR EACH ROW EXECUTE FUNCTION public.issue164_sandbox_release_recovery_guard();

CREATE OR REPLACE FUNCTION public.issue164_settlement_recovery_fence_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $fence_guard$
BEGIN
  IF OLD.settlement_recovery_fenced_at IS NULL THEN RETURN NEW; END IF;

  IF NEW.settlement_recovery_fenced_at IS DISTINCT FROM OLD.settlement_recovery_fenced_at
     OR NEW.settlement_recovery_fence_operation_key IS DISTINCT FROM OLD.settlement_recovery_fence_operation_key
     OR NEW.settlement_recovery_fence_actor_id IS DISTINCT FROM OLD.settlement_recovery_fence_actor_id THEN
    RAISE EXCEPTION 'settlement recovery fence provenance is immutable' USING ERRCODE='23514';
  END IF;

  IF OLD.settlement_recovery_fence_closed_at IS NOT NULL
     AND NEW.settlement_recovery_fence_closed_at IS DISTINCT FROM OLD.settlement_recovery_fence_closed_at THEN
    RAISE EXCEPTION 'closed settlement recovery fence is immutable' USING ERRCODE='23514';
  END IF;

  IF OLD.settlement_recovery_fence_closed_at IS NULL THEN
    IF NEW.status='settled' THEN
      NEW.settlement_recovery_fence_closed_at := coalesce(NEW.settlement_recovery_fence_closed_at,clock_timestamp());
    ELSIF NEW.settlement_recovery_fence_closed_at IS NOT NULL
          AND NEW.settlement_operation_state IS DISTINCT FROM 'recovered' THEN
      RAISE EXCEPTION 'settlement recovery fence may close only on recovered or settled truth'
        USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN NEW;
END
$fence_guard$;

DROP TRIGGER IF EXISTS issue164_settlement_recovery_fence_guard_trg
  ON public.escrow_trust_sessions;
CREATE TRIGGER issue164_settlement_recovery_fence_guard_trg
BEFORE UPDATE ON public.escrow_trust_sessions
FOR EACH ROW EXECUTE FUNCTION public.issue164_settlement_recovery_fence_guard();

DO $post$
DECLARE
  v_begin_definition text;
  v_claim_definition text;
  v_recover_definition text;
  v_sandbox_guard_definition text;
  v_bad_grants integer;
BEGIN
  SELECT pg_get_functiondef('public.issue164_begin_settlement_recovery_atomic(uuid,text,text,text)'::regprocedure)
    INTO v_begin_definition;
  SELECT pg_get_functiondef('public.issue164_begin_settlement_atomic(uuid,text,text,text)'::regprocedure)
    INTO v_claim_definition;
  SELECT pg_get_functiondef('public.issue164_recover_settlement_atomic(uuid,text,text,text,text,text)'::regprocedure)
    INTO v_recover_definition;
  SELECT pg_get_functiondef('public.issue164_sandbox_release_recovery_guard()'::regprocedure)
    INTO v_sandbox_guard_definition;

  IF v_begin_definition !~* 'settlement_recovery_fenced_at'
     OR v_claim_definition !~* 'settlement recovery in progress; release retry blocked'
     OR v_recover_definition !~* 'settlement_recovery_fence_closed_at'
     OR v_sandbox_guard_definition !~* 'sandbox release blocked'
     OR v_sandbox_guard_definition !~* 'pending attributable settlement operation' THEN
    RAISE EXCEPTION '[issue-164-p6] settlement recovery fence postcondition failed';
  END IF;

  SELECT count(*) INTO v_bad_grants
    FROM information_schema.role_routine_grants
   WHERE routine_schema='public'
     AND routine_name IN (
       'issue164_begin_settlement_recovery_atomic',
       'issue164_begin_settlement_atomic',
       'issue164_recover_settlement_atomic'
     )
     AND grantee IN ('PUBLIC','anon','authenticated');
  IF v_bad_grants<>0 THEN
    RAISE EXCEPTION '[issue-164-p6] settlement recovery fence RPC exposed to browser roles';
  END IF;
END
$post$;

-- +migrate Down
-- Forward-only. Recovery-fence and provider-operation provenance are audit evidence and are not discarded.
