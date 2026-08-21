-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6 — PROVIDER-CONFIRMED SETTLEMENT RECOVERY
--
-- A settlement claim intentionally freezes human state before provider release. If a release call
-- fails ambiguously, the claim must NOT be blindly cleared: the provider may still have moved money.
-- Recovery is permitted only after the bound provider authoritatively confirms the intent remains
-- CAPTURED (therefore not released). The original claim identity is preserved as audit history.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.escrow_trust_events') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] settlement recovery prerequisites absent';
  END IF;
END
$pre$;

ALTER TABLE public.escrow_trust_sessions
  ADD COLUMN IF NOT EXISTS settlement_operation_state text,
  ADD COLUMN IF NOT EXISTS settlement_recovery_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_recovery_provider_status text,
  ADD COLUMN IF NOT EXISTS settlement_recovery_reference text,
  ADD COLUMN IF NOT EXISTS settlement_recovery_actor_id text;

-- Compatibility for any database where 1260 was applied before this migration was authored.
UPDATE public.escrow_trust_sessions
   SET settlement_operation_state='pending'
 WHERE settlement_operation_key IS NOT NULL
   AND settlement_operation_state IS NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.escrow_trust_sessions'::regclass
       AND conname='escrow_trust_settlement_operation_state_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_settlement_operation_state_chk CHECK (
        (settlement_operation_key IS NULL AND settlement_operation_state IS NULL)
        OR
        (settlement_operation_key IS NOT NULL
         AND settlement_operation_state IN ('pending','recovered','completed'))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.escrow_trust_sessions'::regclass
       AND conname='escrow_trust_settlement_recovery_truth_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_settlement_recovery_truth_chk CHECK (
        settlement_operation_state IS DISTINCT FROM 'recovered'
        OR (
          settlement_recovery_confirmed_at IS NOT NULL
          AND settlement_recovery_provider_status='captured'
          AND nullif(btrim(settlement_recovery_reference),'') IS NOT NULL
          AND nullif(btrim(settlement_recovery_actor_id),'') IS NOT NULL
        )
      );
  END IF;
END
$constraints$;

-- Claim/re-claim settlement. A recovered operation can be retried with the SAME provider
-- idempotency key, but only after revalidating current seller/payment/reservation truth.
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
    -- Recovered means the provider definitively confirmed NOT RELEASED. The same idempotency key can
    -- be retried, but current seller/reservation/payment truth was revalidated above first.
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

-- Mark a pending settlement operation recovered only from provider-confirmed CAPTURED state.
-- The claim identity is retained; no blind delete/clear path exists.
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
     OR v_tx.settlement_payment_intent_id IS DISTINCT FROM v_tx.payment_intent_id THEN
    RAISE EXCEPTION 'settlement recovery does not match the pending attributable operation'
      USING ERRCODE='23514';
  END IF;

  UPDATE public.escrow_trust_sessions
     SET settlement_operation_state='recovered',
         settlement_recovery_confirmed_at=v_now,
         settlement_recovery_provider_status='captured',
         settlement_recovery_reference=btrim(p_confirmation_reference),
         settlement_recovery_actor_id=p_actor_id,
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
      'confirmationReference',btrim(p_confirmation_reference)
    ),v_now
  );

  RETURN v_tx;
END
$recover$;

REVOKE ALL ON FUNCTION public.issue164_recover_settlement_atomic(uuid,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_recover_settlement_atomic(uuid,text,text,text,text,text)
  TO service_role;

-- Replace the 1260 guard. Pending claims freeze human state; provider settlement marks the claim
-- completed. A provider-confirmed recovered claim reopens governance/refund and may later be
-- re-claimed with the same release idempotency key after fresh validation.
CREATE OR REPLACE FUNCTION public.issue164_settlement_claim_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $guard$
DECLARE
  v_old_state text := coalesce(OLD.settlement_operation_state,
    CASE WHEN OLD.settlement_operation_key IS NULL THEN NULL ELSE 'pending' END);
  v_new_state text := coalesce(NEW.settlement_operation_state,
    CASE WHEN NEW.settlement_operation_key IS NULL THEN NULL ELSE 'pending' END);
BEGIN
  IF OLD.settlement_operation_key IS NULL THEN RETURN NEW; END IF;

  IF NEW.settlement_operation_key IS DISTINCT FROM OLD.settlement_operation_key
     OR NEW.settlement_seller_id IS DISTINCT FROM OLD.settlement_seller_id
     OR NEW.settlement_payment_intent_id IS DISTINCT FROM OLD.settlement_payment_intent_id THEN
    RAISE EXCEPTION 'settlement operation claim identity is immutable' USING ERRCODE='23514';
  END IF;

  IF v_old_state='pending' THEN
    IF NEW.status='settled' THEN
      NEW.settlement_operation_state := 'completed';
      RETURN NEW;
    END IF;
    IF v_new_state='recovered' AND NEW.status='release_approved' THEN
      RETURN NEW;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status OR v_new_state IS DISTINCT FROM v_old_state THEN
      RAISE EXCEPTION 'settlement operation already claimed; provider reconciliation or confirmed recovery required'
        USING ERRCODE='23514';
    END IF;
  ELSIF v_old_state='recovered' THEN
    IF v_new_state='pending' AND NEW.status='release_approved' THEN
      RETURN NEW;
    END IF;
    -- Once provider truth confirmed NOT RELEASED, ordinary governed state/refund paths may resume.
    IF v_new_state IS DISTINCT FROM 'recovered' THEN
      RAISE EXCEPTION 'recovered settlement claim may only be re-claimed by settlement function'
        USING ERRCODE='23514';
    END IF;
  ELSIF v_old_state='completed' THEN
    IF NEW.status IS DISTINCT FROM 'settled' OR v_new_state IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'completed settlement claim is immutable' USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN NEW;
END
$guard$;

DROP TRIGGER IF EXISTS issue164_settlement_claim_guard_trg ON public.escrow_trust_sessions;
CREATE TRIGGER issue164_settlement_claim_guard_trg
BEFORE UPDATE ON public.escrow_trust_sessions
FOR EACH ROW EXECUTE FUNCTION public.issue164_settlement_claim_guard();

REVOKE ALL ON FUNCTION public.issue164_settlement_claim_guard() FROM PUBLIC, anon, authenticated;

DO $post$
DECLARE
  v_bad_grants integer;
BEGIN
  SELECT count(*) INTO v_bad_grants
    FROM information_schema.routine_privileges
   WHERE routine_schema='public'
     AND routine_name IN ('issue164_begin_settlement_atomic','issue164_recover_settlement_atomic')
     AND grantee IN ('PUBLIC','anon','authenticated')
     AND privilege_type='EXECUTE';
  IF v_bad_grants<>0 THEN
    RAISE EXCEPTION '[issue-164-p6] settlement claim/recovery function exposed to browser roles';
  END IF;
END
$post$;

-- +migrate Down
-- Forward-only. Settlement claim/recovery provenance is audit evidence and is not discarded.
