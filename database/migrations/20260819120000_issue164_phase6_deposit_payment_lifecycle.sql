-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6A — DEPOSIT ELIGIBILITY + PROVIDER-NEUTRAL PAYMENT LIFECYCLE
--
-- Extends escrow_trust_sessions, the existing canonical transaction intent. It does NOT
-- create a Marketplace-specific payment architecture. Provider operations are performed
-- through the existing SafeTrade PaymentProvider abstraction; this migration persists the
-- normalized result and owns atomic reservation/listing side effects.
--
-- New canonical lifecycle states are provider-neutral:
--   eligible -> initiated -> funds_held -> inspection_pending -> release_approved
--            -> settled
--   disputed / refunded / cancelled / failed are explicit branches.
--
-- Historical funded_sandbox/released_sandbox/refunded_sandbox values remain allowed so this
-- forward migration never rewrites existing rows merely to rename them. New Phase 6 code does
-- not write those legacy values.
--
-- UNAPPLIED until the single guarded staging truth cutover after Phase 6 source/schema closure.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.escrow_trust_events') IS NULL
     OR to_regclass('public.escrow_trust_webhook_events') IS NULL
     OR to_regclass('public.vehicle_reservations') IS NULL
     OR to_regclass('public.vehicles') IS NULL
     OR to_regclass('public.domain_events') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] canonical transaction/reservation prerequisites absent';
  END IF;
END
$pre$;

ALTER TABLE public.escrow_trust_sessions
  ADD COLUMN IF NOT EXISTS deposit_eligibility text NOT NULL DEFAULT 'not_evaluated',
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS deposit_currency text,
  ADD COLUMN IF NOT EXISTS deposit_policy_version text,
  ADD COLUMN IF NOT EXISTS deposit_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_provider_mode text,
  ADD COLUMN IF NOT EXISTS payment_intent_id text,
  ADD COLUMN IF NOT EXISTS payment_state text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS payment_idempotency_key text,
  ADD COLUMN IF NOT EXISTS payment_reconciled_at timestamptz;

DO $session_constraints$
BEGIN
  ALTER TABLE public.escrow_trust_sessions
    DROP CONSTRAINT IF EXISTS escrow_trust_sessions_status_check;
  ALTER TABLE public.escrow_trust_sessions
    ADD CONSTRAINT escrow_trust_sessions_status_check CHECK (status IN (
      'not_requested','pending_eligibility','eligible','initiated',
      'funds_held','inspection_pending','release_approved','settled',
      'disputed','refunded','cancelled','failed',
      -- historical compatibility only
      'funded_sandbox','released_sandbox','refunded_sandbox'
    ));

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.escrow_trust_sessions'::regclass
       AND conname='escrow_trust_deposit_eligibility_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_deposit_eligibility_chk
      CHECK (deposit_eligibility IN ('not_evaluated','eligible','ineligible'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.escrow_trust_sessions'::regclass
       AND conname='escrow_trust_deposit_pair_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_deposit_pair_chk CHECK (
        (deposit_eligibility <> 'eligible'
          AND deposit_amount IS NULL
          AND deposit_currency IS NULL
          AND deposit_policy_version IS NULL)
        OR
        (deposit_eligibility = 'eligible'
          AND deposit_amount IS NOT NULL AND deposit_amount > 0
          AND nullif(btrim(deposit_currency),'') IS NOT NULL
          AND nullif(btrim(deposit_policy_version),'') IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.escrow_trust_sessions'::regclass
       AND conname='escrow_trust_payment_state_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_payment_state_chk CHECK (payment_state IN (
        'not_started','requires_authorization','authorized','captured','released',
        'refunded','partially_refunded','cancelled','failed','unknown'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.escrow_trust_sessions'::regclass
       AND conname='escrow_trust_payment_link_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_payment_link_chk CHECK (
        (payment_intent_id IS NULL
          AND payment_provider IS NULL
          AND payment_provider_mode IS NULL
          AND payment_idempotency_key IS NULL
          AND payment_state='not_started')
        OR
        (payment_intent_id IS NOT NULL
          AND nullif(btrim(payment_provider),'') IS NOT NULL
          AND payment_provider_mode IN ('sandbox','test','live')
          AND nullif(btrim(payment_idempotency_key),'') IS NOT NULL
          AND payment_state<>'not_started')
      );
  END IF;
END
$session_constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_trust_payment_intent
  ON public.escrow_trust_sessions(payment_provider,payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_trust_payment_idempotency
  ON public.escrow_trust_sessions(payment_idempotency_key)
  WHERE payment_idempotency_key IS NOT NULL;

ALTER TABLE public.escrow_trust_webhook_events
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_event_id text,
  ADD COLUMN IF NOT EXISTS normalized_status text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_trust_provider_event
  ON public.escrow_trust_webhook_events(provider,provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

-- Revoke direct browser writes after widening. Backend service_role remains the only writer.
REVOKE INSERT,UPDATE,DELETE ON TABLE public.escrow_trust_sessions FROM anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.escrow_trust_webhook_events FROM anon,authenticated;
GRANT ALL ON TABLE public.escrow_trust_sessions,public.escrow_trust_webhook_events TO service_role;

-- -----------------------------------------------------------------------------
-- Deposit eligibility persistence.
-- The application computes canonical Trust/seller/snapshot gates; PostgreSQL independently proves
-- that the transaction still owns an ACTIVE, unexpired canonical reservation before recording an
-- eligible deposit. A browser cannot call this function: service_role only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue164_set_deposit_eligibility_atomic(
  p_session_id uuid,
  p_actor_id text,
  p_eligibility text,
  p_amount numeric,
  p_currency text,
  p_policy_version text,
  p_reasons jsonb DEFAULT '[]'::jsonb
)
RETURNS public.escrow_trust_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $deposit$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_res public.vehicle_reservations%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_eligibility NOT IN ('eligible','ineligible') THEN
    RAISE EXCEPTION 'deposit eligibility must be eligible or ineligible' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_actor_id),'') IS NULL THEN
    RAISE EXCEPTION 'authenticated actor required' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(coalesce(p_reasons,'[]'::jsonb))<>'array' THEN
    RAISE EXCEPTION 'deposit reasons must be a JSON array' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id=p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction intent not found' USING ERRCODE='P0002'; END IF;
  IF v_tx.buyer_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'deposit actor is not transaction buyer' USING ERRCODE='42501';
  END IF;
  IF v_tx.status NOT IN ('eligible','initiated') THEN
    RAISE EXCEPTION 'transaction is not deposit-evaluable from status %',v_tx.status USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_res
    FROM public.vehicle_reservations
   WHERE transaction_intent_id=v_tx.id
     AND status='active'
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND AND v_res.expires_at<=v_now THEN
    -- The clock alone may release only a pre-payment hold. Once a provider intent exists, CarUp
    -- must cancel/reconcile the provider first; exposing the vehicle as Available here could permit
    -- a second buyer while an authorization is still live.
    IF v_tx.payment_intent_id IS NOT NULL THEN
      RAISE EXCEPTION 'expired reservation has a linked payment intent; provider reconciliation required'
        USING ERRCODE='23514';
    END IF;
    UPDATE public.vehicle_reservations
       SET status='expired',updated_at=v_now
     WHERE id=v_res.id;
    UPDATE public.vehicles
       SET status=CASE WHEN lower(coalesce(status,''))='reserved' THEN 'Available' ELSE status END,
           reserved_at=NULL,reserved_until=NULL,active_reservation_id=NULL
     WHERE vin=v_tx.vin AND active_reservation_id=v_res.id;
    v_res:=NULL;
  END IF;

  IF p_eligibility='eligible' THEN
    IF v_res.id IS NULL
       OR v_res.buyer_id IS DISTINCT FROM v_tx.buyer_id
       OR v_res.seller_id IS DISTINCT FROM v_tx.seller_id
       OR v_res.inquiry_id IS DISTINCT FROM v_tx.inquiry_id THEN
      RAISE EXCEPTION 'active canonical reservation required for deposit eligibility'
        USING ERRCODE='23514';
    END IF;
    IF p_amount IS NULL OR p_amount<=0
       OR nullif(btrim(p_currency),'') IS NULL
       OR nullif(btrim(p_policy_version),'') IS NULL THEN
      RAISE EXCEPTION 'eligible deposit requires positive amount, currency and policy version'
        USING ERRCODE='22023';
    END IF;
  END IF;

  UPDATE public.escrow_trust_sessions
     SET deposit_eligibility=p_eligibility,
         deposit_amount=CASE WHEN p_eligibility='eligible' THEN p_amount ELSE NULL END,
         deposit_currency=CASE WHEN p_eligibility='eligible' THEN upper(btrim(p_currency)) ELSE NULL END,
         deposit_policy_version=CASE WHEN p_eligibility='eligible' THEN btrim(p_policy_version) ELSE NULL END,
         deposit_reasons=coalesce(p_reasons,'[]'::jsonb),
         updated_at=v_now
   WHERE id=v_tx.id
   RETURNING * INTO v_tx;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,v_tx.status,v_tx.status,p_actor_id,'buyer','deposit_eligibility_evaluated',
    jsonb_build_object(
      'deposit_eligibility',p_eligibility,
      'amount',CASE WHEN p_eligibility='eligible' THEN p_amount ELSE NULL END,
      'currency',CASE WHEN p_eligibility='eligible' THEN upper(btrim(p_currency)) ELSE NULL END,
      'policy_version',CASE WHEN p_eligibility='eligible' THEN btrim(p_policy_version) ELSE NULL END,
      'reasons',coalesce(p_reasons,'[]'::jsonb)
    ),v_now
  );

  RETURN v_tx;
END
$deposit$;

REVOKE ALL ON FUNCTION public.issue164_set_deposit_eligibility_atomic(uuid,text,text,numeric,text,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_set_deposit_eligibility_atomic(uuid,text,text,numeric,text,text,jsonb)
  TO service_role;

-- -----------------------------------------------------------------------------
-- Link a provider intent. Provider selection/capability checks happen through PaymentProvider;
-- PostgreSQL only accepts the normalized, idempotent result after proving deposit eligibility and
-- the active reservation still exist.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue164_link_payment_intent_atomic(
  p_session_id uuid,
  p_actor_id text,
  p_provider text,
  p_provider_mode text,
  p_intent_id text,
  p_payment_state text,
  p_idempotency_key text
)
RETURNS public.escrow_trust_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $link$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_res public.vehicle_reservations%ROWTYPE;
  v_from_status text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_provider_mode NOT IN ('sandbox','test','live')
     OR nullif(btrim(p_provider),'') IS NULL
     OR nullif(btrim(p_intent_id),'') IS NULL
     OR nullif(btrim(p_idempotency_key),'') IS NULL
     OR p_payment_state NOT IN ('requires_authorization','authorized') THEN
    RAISE EXCEPTION 'invalid provider intent linkage' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id=p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction intent not found' USING ERRCODE='P0002'; END IF;
  IF v_tx.buyer_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'payment actor is not transaction buyer' USING ERRCODE='42501';
  END IF;
  IF v_tx.status NOT IN ('eligible','initiated') THEN
    RAISE EXCEPTION 'payment intent cannot be linked from transaction status %',v_tx.status USING ERRCODE='23514';
  END IF;
  IF v_tx.deposit_eligibility<>'eligible'
     OR v_tx.deposit_amount IS NULL
     OR v_tx.deposit_currency IS NULL THEN
    RAISE EXCEPTION 'deposit is not eligible' USING ERRCODE='23514';
  END IF;

  IF v_tx.payment_intent_id IS NOT NULL THEN
    IF v_tx.payment_idempotency_key=p_idempotency_key
       AND v_tx.payment_provider=p_provider
       AND v_tx.payment_intent_id=p_intent_id THEN
      RETURN v_tx;
    END IF;
    RAISE EXCEPTION 'transaction already linked to a different payment intent' USING ERRCODE='23505';
  END IF;

  SELECT * INTO v_res
    FROM public.vehicle_reservations
   WHERE transaction_intent_id=v_tx.id
     AND status='active'
     AND expires_at>v_now
   ORDER BY created_at DESC
   LIMIT 1
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active canonical reservation required before payment intent'
      USING ERRCODE='23514';
  END IF;

  v_from_status := v_tx.status;
  UPDATE public.escrow_trust_sessions
     SET status='initiated',
         payment_provider=btrim(p_provider),
         payment_provider_mode=p_provider_mode,
         payment_intent_id=btrim(p_intent_id),
         payment_state=p_payment_state,
         payment_idempotency_key=btrim(p_idempotency_key),
         updated_at=v_now
   WHERE id=v_tx.id
   RETURNING * INTO v_tx;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,v_from_status,'initiated',p_actor_id,'buyer','payment_intent_linked',
    jsonb_build_object(
      'provider',p_provider,
      'provider_mode',p_provider_mode,
      'payment_state',p_payment_state,
      'live',p_provider_mode='live'
    ),v_now
  );

  RETURN v_tx;
END
$link$;

REVOKE ALL ON FUNCTION public.issue164_link_payment_intent_atomic(uuid,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_link_payment_intent_atomic(uuid,text,text,text,text,text,text)
  TO service_role;

-- -----------------------------------------------------------------------------
-- Reconcile provider state and atomically reconcile the reservation/listing cache.
-- This function does NOT transfer legal ownership. Payment settlement is not registry/title proof.
-- On release it marks the listing Sold and the reservation completed; owner_id/ownership_history are
-- deliberately untouched until a separately governed ownership-transfer record exists.
-- -----------------------------------------------------------------------------
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

  -- Structural transition guard independent of application code.
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

  IF v_next_status IN ('funds_held','settled') THEN
    IF v_res.id IS NULL OR v_res.expires_at<=v_now THEN
      RAISE EXCEPTION 'active canonical reservation required for money state %',v_next_status
        USING ERRCODE='23514';
    END IF;
  END IF;

  IF v_next_status='settled' THEN
    SELECT * INTO v_vehicle FROM public.vehicles WHERE vin=v_tx.vin FOR UPDATE;
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
    NULL,'provider','payment_reconciled',
    jsonb_build_object(
      'provider',btrim(p_provider),
      'normalized_status',p_normalized_status,
      'provider_event_id',p_provider_event_id
    ),v_now
  );

  IF v_next_status IS DISTINCT FROM v_from_status
     OR p_normalized_status IN ('captured','released','refunded','cancelled','failed') THEN
    INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
    VALUES(
      CASE p_normalized_status
        WHEN 'captured' THEN 'MARKETPLACE_FUNDS_HELD'
        WHEN 'released' THEN 'MARKETPLACE_TRANSACTION_SETTLED'
        WHEN 'refunded' THEN 'MARKETPLACE_TRANSACTION_REFUNDED'
        WHEN 'cancelled' THEN 'MARKETPLACE_TRANSACTION_CANCELLED'
        WHEN 'failed' THEN 'MARKETPLACE_PAYMENT_FAILED'
        ELSE 'MARKETPLACE_PAYMENT_RECONCILED'
      END,
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

-- Postconditions: no financial/provider field may have a business-looking default. Only explicit
-- absence/lifecycle markers are allowed to default. Deposit amount/currency/policy and provider
-- identity/intent/idempotency remain NULL until a server action records them.
DO $post$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(column_name,', ' ORDER BY column_name)
    INTO v_bad
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='escrow_trust_sessions'
     AND column_name IN (
       'deposit_amount','deposit_currency','deposit_policy_version',
       'payment_provider','payment_provider_mode','payment_intent_id','payment_idempotency_key'
     )
     AND column_default IS NOT NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p6] provider/deposit fact column(s) unexpectedly defaulted: %',v_bad;
  END IF;
END
$post$;

-- +migrate Down
-- Forward-only: payment/reservation lineage is auditable financial state. Reversal requires a
-- separately reviewed data migration and must never discard provider reconciliation history.
