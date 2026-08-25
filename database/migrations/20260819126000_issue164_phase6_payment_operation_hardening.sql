-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6 — DURABLE SANDBOX PROVIDER + SETTLEMENT OPERATION CLAIM
--
-- Closes three payment-edge gaps without creating a second transaction architecture:
--  1. Marketplace sandbox provider state is durable/shared across serverless instances.
--  2. Sandbox operations retain provider-side idempotency after process restart.
--  3. Provider release is preceded by a DB-atomic settlement claim so a later dispute/seller edit
--     cannot make CarUp deny an attributable payout that was already approved and sent.
--
-- The sandbox tables are synthetic provider state only. They are service-role only, never public,
-- never legal escrow, and never proof of real money. Production/live provider activation remains
-- separately gated. This migration remains UNAPPLIED until the guarded staging cutover.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.escrow_trust_events') IS NULL
     OR to_regclass('public.vehicle_reservations') IS NULL
     OR to_regclass('public.vehicles') IS NULL
     OR to_regclass('public.escrow_trust_webhook_events') IS NULL
     OR to_regclass('public.domain_events') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] payment operation hardening prerequisites absent';
  END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- Durable synthetic provider ledger. This is deliberately distinct from the canonical CarUp
-- transaction row: the sandbox behaves like a provider with its own state, but persists that state
-- in PostgreSQL so Vercel worker/process turnover cannot orphan a linked payment intent.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.safetrade_sandbox_payment_intents (
  intent_id text PRIMARY KEY,
  transaction_intent_id uuid NOT NULL UNIQUE
    REFERENCES public.escrow_trust_sessions(id) ON DELETE RESTRICT,
  create_idempotency_key text NOT NULL UNIQUE,
  tenant_id text,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (nullif(btrim(currency),'') IS NOT NULL),
  payer_id text NOT NULL CHECK (nullif(btrim(payer_id),'') IS NOT NULL),
  payee_id text NOT NULL CHECK (nullif(btrim(payee_id),'') IS NOT NULL),
  status text NOT NULL CHECK (status IN (
    'requires_authorization','authorized','captured','released','refunded',
    'partially_refunded','cancelled'
  )),
  captured_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (captured_amount >= 0),
  refunded_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  hold_ref text,
  capture_ref text,
  release_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.safetrade_sandbox_payment_operations (
  idempotency_key text PRIMARY KEY,
  intent_id text NOT NULL
    REFERENCES public.safetrade_sandbox_payment_intents(intent_id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('create','authorize','capture','release','refund','partial_refund','cancel')),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.safetrade_sandbox_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safetrade_sandbox_payment_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.safetrade_sandbox_payment_intents FROM anon,authenticated;
REVOKE ALL ON TABLE public.safetrade_sandbox_payment_operations FROM anon,authenticated;
GRANT ALL ON TABLE public.safetrade_sandbox_payment_intents TO service_role;
GRANT ALL ON TABLE public.safetrade_sandbox_payment_operations TO service_role;

-- One atomic synthetic-provider operation surface. The PaymentProvider adapter calls this through
-- service_role. Mutations are serialized on the provider intent row and replayed from the durable
-- operation ledger by idempotency key.
CREATE OR REPLACE FUNCTION public.issue164_sandbox_payment_action_atomic(
  p_action text,
  p_intent_id text,
  p_transaction_intent_id uuid,
  p_idempotency_key text,
  p_amount numeric,
  p_currency text,
  p_payer_id text,
  p_payee_id text,
  p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $sandbox$
DECLARE
  v_intent public.safetrade_sandbox_payment_intents%ROWTYPE;
  v_existing_result jsonb;
  v_result jsonb;
  v_intent_id text;
  v_ref text;
  v_delta numeric(14,2);
  v_new_refunded numeric(14,2);
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_action NOT IN ('create','authorize','capture','release','refund','partial_refund','cancel','retrieve') THEN
    RAISE EXCEPTION 'unsupported sandbox payment action' USING ERRCODE='22023';
  END IF;

  IF p_action<>'retrieve' AND nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'sandbox mutating action requires idempotency key' USING ERRCODE='22023';
  END IF;

  IF p_action<>'retrieve' THEN
    SELECT result INTO v_existing_result
      FROM public.safetrade_sandbox_payment_operations
     WHERE idempotency_key=p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing_result || jsonb_build_object('idempotentReplay',true);
    END IF;
  END IF;

  IF p_action='create' THEN
    IF p_transaction_intent_id IS NULL
       OR p_amount IS NULL OR p_amount<=0
       OR nullif(btrim(p_currency),'') IS NULL
       OR nullif(btrim(p_payer_id),'') IS NULL
       OR nullif(btrim(p_payee_id),'') IS NULL THEN
      RAISE EXCEPTION 'sandbox intent requires transaction, positive amount, currency, payer and payee'
        USING ERRCODE='22023';
    END IF;
    IF p_payer_id=p_payee_id THEN
      RAISE EXCEPTION 'sandbox payer and payee must differ' USING ERRCODE='23514';
    END IF;

    v_intent_id := 'sbx_pi_' || substr(md5(p_idempotency_key),1,24);

    INSERT INTO public.safetrade_sandbox_payment_intents(
      intent_id,transaction_intent_id,create_idempotency_key,tenant_id,amount,currency,
      payer_id,payee_id,status,captured_amount,refunded_amount,created_at,updated_at
    ) VALUES(
      v_intent_id,p_transaction_intent_id,p_idempotency_key,p_tenant_id,p_amount,upper(btrim(p_currency)),
      p_payer_id,p_payee_id,'requires_authorization',0,0,v_now,v_now
    )
    ON CONFLICT (transaction_intent_id) DO NOTHING;

    SELECT * INTO v_intent
      FROM public.safetrade_sandbox_payment_intents
     WHERE transaction_intent_id=p_transaction_intent_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sandbox intent persistence failed' USING ERRCODE='23514'; END IF;
    IF v_intent.create_idempotency_key IS DISTINCT FROM p_idempotency_key
       OR v_intent.amount IS DISTINCT FROM p_amount
       OR upper(v_intent.currency) IS DISTINCT FROM upper(btrim(p_currency))
       OR v_intent.payer_id IS DISTINCT FROM p_payer_id
       OR v_intent.payee_id IS DISTINCT FROM p_payee_id THEN
      RAISE EXCEPTION 'sandbox transaction already bound to different provider intent terms'
        USING ERRCODE='23514';
    END IF;

    v_result := jsonb_build_object(
      'provider','sandbox','intentId',v_intent.intent_id,'status',v_intent.status,
      'amount',v_intent.amount,'currency',v_intent.currency,'live',false,'idempotentReplay',false
    );
    INSERT INTO public.safetrade_sandbox_payment_operations(idempotency_key,intent_id,action,result,created_at)
    VALUES(p_idempotency_key,v_intent.intent_id,'create',v_result,v_now)
    ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN v_result;
  END IF;

  IF nullif(btrim(p_intent_id),'') IS NULL THEN
    RAISE EXCEPTION 'sandbox intent id required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_intent
    FROM public.safetrade_sandbox_payment_intents
   WHERE intent_id=p_intent_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'intent not found' USING ERRCODE='P0002'; END IF;

  IF p_action='retrieve' THEN
    RETURN jsonb_build_object(
      'provider','sandbox','intentId',v_intent.intent_id,'status',v_intent.status,
      'amount',v_intent.amount,'capturedAmount',v_intent.captured_amount,
      'refundedAmount',v_intent.refunded_amount,'live',false
    );
  ELSIF p_action='authorize' THEN
    IF v_intent.status<>'requires_authorization' THEN
      RAISE EXCEPTION 'cannot authorize from %',v_intent.status USING ERRCODE='23514';
    END IF;
    v_ref := 'sbx_hold_' || substr(md5(p_idempotency_key),1,16);
    UPDATE public.safetrade_sandbox_payment_intents
       SET status='authorized',hold_ref=v_ref,updated_at=v_now
     WHERE intent_id=v_intent.intent_id
     RETURNING * INTO v_intent;
    v_result := jsonb_build_object(
      'provider','sandbox','intentId',v_intent.intent_id,'status',v_intent.status,
      'holdRef',v_intent.hold_ref,'live',false,'idempotentReplay',false
    );
  ELSIF p_action='capture' THEN
    IF v_intent.status<>'authorized' THEN
      RAISE EXCEPTION 'cannot capture from %',v_intent.status USING ERRCODE='23514';
    END IF;
    v_delta := coalesce(p_amount,v_intent.amount);
    IF v_delta<=0 OR v_delta>v_intent.amount THEN
      RAISE EXCEPTION 'capture amount outside authorized amount' USING ERRCODE='23514';
    END IF;
    v_ref := 'sbx_cap_' || substr(md5(p_idempotency_key),1,16);
    UPDATE public.safetrade_sandbox_payment_intents
       SET status='captured',captured_amount=v_delta,capture_ref=v_ref,updated_at=v_now
     WHERE intent_id=v_intent.intent_id
     RETURNING * INTO v_intent;
    v_result := jsonb_build_object(
      'provider','sandbox','intentId',v_intent.intent_id,'status',v_intent.status,
      'captureRef',v_intent.capture_ref,'capturedAmount',v_intent.captured_amount,
      'live',false,'idempotentReplay',false
    );
  ELSIF p_action='release' THEN
    IF v_intent.status<>'captured' THEN
      RAISE EXCEPTION 'cannot release from %',v_intent.status USING ERRCODE='23514';
    END IF;
    v_ref := 'sbx_rel_' || substr(md5(p_idempotency_key),1,16);
    UPDATE public.safetrade_sandbox_payment_intents
       SET status='released',release_ref=v_ref,updated_at=v_now
     WHERE intent_id=v_intent.intent_id
     RETURNING * INTO v_intent;
    v_result := jsonb_build_object(
      'provider','sandbox','intentId',v_intent.intent_id,'status',v_intent.status,
      'releaseRef',v_intent.release_ref,'live',false,'idempotentReplay',false
    );
  ELSIF p_action='refund' THEN
    IF v_intent.status NOT IN ('captured','released') THEN
      RAISE EXCEPTION 'cannot refund from %',v_intent.status USING ERRCODE='23514';
    END IF;
    v_delta := CASE WHEN v_intent.captured_amount>0 THEN v_intent.captured_amount ELSE v_intent.amount END;
    v_ref := 'sbx_ref_' || substr(md5(p_idempotency_key),1,16);
    UPDATE public.safetrade_sandbox_payment_intents
       SET status='refunded',refunded_amount=v_delta,updated_at=v_now
     WHERE intent_id=v_intent.intent_id
     RETURNING * INTO v_intent;
    v_result := jsonb_build_object(
      'provider','sandbox','intentId',v_intent.intent_id,'status',v_intent.status,
      'refundRef',v_ref,'refundedAmount',v_intent.refunded_amount,
      'live',false,'idempotentReplay',false
    );
  ELSIF p_action='partial_refund' THEN
    IF v_intent.status NOT IN ('captured','released','partially_refunded') THEN
      RAISE EXCEPTION 'cannot partial-refund from %',v_intent.status USING ERRCODE='23514';
    END IF;
    v_delta := p_amount;
    IF v_delta IS NULL OR v_delta<=0 THEN
      RAISE EXCEPTION 'partial refund amount must be positive' USING ERRCODE='22023';
    END IF;
    v_new_refunded := v_intent.refunded_amount + v_delta;
    IF v_new_refunded>v_intent.captured_amount THEN
      RAISE EXCEPTION 'partial refund exceeds captured amount' USING ERRCODE='23514';
    END IF;
    v_ref := 'sbx_ref_' || substr(md5(p_idempotency_key),1,16);
    UPDATE public.safetrade_sandbox_payment_intents
       SET status=CASE WHEN v_new_refunded>=captured_amount THEN 'refunded' ELSE 'partially_refunded' END,
           refunded_amount=v_new_refunded,updated_at=v_now
     WHERE intent_id=v_intent.intent_id
     RETURNING * INTO v_intent;
    v_result := jsonb_build_object(
      'provider','sandbox','intentId',v_intent.intent_id,'status',v_intent.status,
      'refundRef',v_ref,'refundedAmount',v_intent.refunded_amount,
      'remainingAmount',v_intent.captured_amount-v_intent.refunded_amount,
      'live',false,'idempotentReplay',false
    );
  ELSE -- cancel
    IF v_intent.status NOT IN ('requires_authorization','authorized') THEN
      RAISE EXCEPTION 'cannot cancel from %',v_intent.status USING ERRCODE='23514';
    END IF;
    UPDATE public.safetrade_sandbox_payment_intents
       SET status='cancelled',updated_at=v_now
     WHERE intent_id=v_intent.intent_id
     RETURNING * INTO v_intent;
    v_result := jsonb_build_object(
      'provider','sandbox','intentId',v_intent.intent_id,'status',v_intent.status,
      'live',false,'idempotentReplay',false
    );
  END IF;

  INSERT INTO public.safetrade_sandbox_payment_operations(idempotency_key,intent_id,action,result,created_at)
  VALUES(p_idempotency_key,v_intent.intent_id,p_action,v_result,v_now);
  RETURN v_result;
END
$sandbox$;

REVOKE ALL ON FUNCTION public.issue164_sandbox_payment_action_atomic(text,text,uuid,text,numeric,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_sandbox_payment_action_atomic(text,text,uuid,text,numeric,text,text,text,text)
  TO service_role;

-- -----------------------------------------------------------------------------
-- Settlement operation claim. This is the DB serialization point BEFORE provider release.
-- It snapshots the exact approved seller/payment lineage. Once claimed, human status rewrites are
-- frozen until the provider release is durably reconciled; retries use the same operation key.
-- -----------------------------------------------------------------------------
ALTER TABLE public.escrow_trust_sessions
  ADD COLUMN IF NOT EXISTS settlement_operation_key text,
  ADD COLUMN IF NOT EXISTS settlement_operation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_operation_actor_id text,
  ADD COLUMN IF NOT EXISTS settlement_seller_id text,
  ADD COLUMN IF NOT EXISTS settlement_payment_intent_id text;

DO $claim_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.escrow_trust_sessions'::regclass
       AND conname='escrow_trust_settlement_claim_pair_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_settlement_claim_pair_chk CHECK (
        (settlement_operation_key IS NULL
          AND settlement_operation_started_at IS NULL
          AND settlement_operation_actor_id IS NULL
          AND settlement_seller_id IS NULL
          AND settlement_payment_intent_id IS NULL)
        OR
        (nullif(btrim(settlement_operation_key),'') IS NOT NULL
          AND settlement_operation_started_at IS NOT NULL
          AND nullif(btrim(settlement_operation_actor_id),'') IS NOT NULL
          AND nullif(btrim(settlement_seller_id),'') IS NOT NULL
          AND nullif(btrim(settlement_payment_intent_id),'') IS NOT NULL)
      );
  END IF;
END
$claim_constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_trust_settlement_operation_key
  ON public.escrow_trust_sessions(settlement_operation_key)
  WHERE settlement_operation_key IS NOT NULL;

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

  IF v_tx.settlement_operation_key IS NOT NULL THEN
    IF v_tx.settlement_operation_key=p_operation_key
       AND v_tx.settlement_seller_id=v_tx.seller_id
       AND v_tx.settlement_payment_intent_id=v_tx.payment_intent_id THEN
      RETURN v_tx;
    END IF;
    RAISE EXCEPTION 'transaction already has a different settlement operation claim'
      USING ERRCODE='23505';
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

  UPDATE public.escrow_trust_sessions
     SET settlement_operation_key=p_operation_key,
         settlement_operation_started_at=v_now,
         settlement_operation_actor_id=p_actor_id,
         settlement_seller_id=v_tx.seller_id,
         settlement_payment_intent_id=v_tx.payment_intent_id,
         updated_at=v_now
   WHERE id=v_tx.id
   RETURNING * INTO v_tx;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,'release_approved','release_approved',p_actor_id,v_role,
    'settlement_operation_claimed',
    jsonb_build_object(
      'settlementOperationKey',p_operation_key,
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

-- Prevent service-layer races from rewriting a release-approved transaction after the payout claim.
-- Provider reconciliation may advance exactly to settled; the claim fields themselves are immutable.
CREATE OR REPLACE FUNCTION public.issue164_settlement_claim_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $guard$
BEGIN
  IF OLD.settlement_operation_key IS NOT NULL AND OLD.status='release_approved' THEN
    IF NEW.settlement_operation_key IS DISTINCT FROM OLD.settlement_operation_key
       OR NEW.settlement_operation_started_at IS DISTINCT FROM OLD.settlement_operation_started_at
       OR NEW.settlement_operation_actor_id IS DISTINCT FROM OLD.settlement_operation_actor_id
       OR NEW.settlement_seller_id IS DISTINCT FROM OLD.settlement_seller_id
       OR NEW.settlement_payment_intent_id IS DISTINCT FROM OLD.settlement_payment_intent_id THEN
      RAISE EXCEPTION 'settlement operation claim is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status<>'settled' THEN
      RAISE EXCEPTION 'settlement operation already claimed; provider reconciliation required'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END
$guard$;

DROP TRIGGER IF EXISTS issue164_settlement_claim_guard_trg ON public.escrow_trust_sessions;
CREATE TRIGGER issue164_settlement_claim_guard_trg
BEFORE UPDATE ON public.escrow_trust_sessions
FOR EACH ROW EXECUTE FUNCTION public.issue164_settlement_claim_guard();

-- -----------------------------------------------------------------------------
-- Replace provider reconciliation so an attributable `released` result reconciles against the
-- durable settlement claim rather than re-checking mutable seller state AFTER provider money moved.
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

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.escrow_trust_webhook_events WHERE idempotency_key=p_idempotency_key
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
   WHERE transaction_intent_id=v_tx.id AND status='active'
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF v_next_status IN ('funds_held','settled') AND v_res.id IS NULL THEN
    RAISE EXCEPTION 'active canonical reservation required for money state %',v_next_status
      USING ERRCODE='23514';
  END IF;

  IF v_next_status='settled' THEN
    IF nullif(btrim(v_tx.settlement_operation_key),'') IS NULL
       OR v_tx.settlement_seller_id IS DISTINCT FROM v_tx.seller_id
       OR v_tx.settlement_payment_intent_id IS DISTINCT FROM v_tx.payment_intent_id THEN
      RAISE EXCEPTION 'payment release lacks attributable settlement operation claim'
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
    UPDATE public.vehicle_reservations SET status='completed',updated_at=v_now WHERE id=v_res.id;
    UPDATE public.vehicles
       SET status='Sold',reserved_at=NULL,reserved_until=NULL,active_reservation_id=NULL
     WHERE vin=v_tx.vin AND active_reservation_id=v_res.id;
  ELSIF v_next_status IN ('refunded','cancelled','failed') AND v_res.id IS NOT NULL THEN
    UPDATE public.vehicle_reservations SET status='cancelled',updated_at=v_now WHERE id=v_res.id;
    UPDATE public.vehicles
       SET status=CASE WHEN lower(coalesce(status,''))='reserved' THEN 'Available' ELSE status END,
           reserved_at=NULL,reserved_until=NULL,active_reservation_id=NULL
     WHERE vin=v_tx.vin AND active_reservation_id=v_res.id;
  END IF;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,v_from_status,v_next_status,NULL,'provider','payment_reconciled',
    jsonb_build_object(
      'provider',btrim(p_provider),
      'normalized_status',p_normalized_status,
      'provider_event_id',p_provider_event_id,
      'settlementOperationKey',CASE WHEN p_normalized_status='released' THEN v_tx.settlement_operation_key ELSE NULL END
    ),v_now
  );

  v_event_type := CASE p_normalized_status
    WHEN 'captured' THEN 'MARKETPLACE_FUNDS_HELD'
    WHEN 'released' THEN 'MARKETPLACE_TRANSACTION_SETTLED'
    WHEN 'refunded' THEN 'MARKETPLACE_TRANSACTION_REFUNDED'
    WHEN 'cancelled' THEN 'MARKETPLACE_TRANSACTION_CANCELLED'
    WHEN 'failed' THEN 'MARKETPLACE_PAYMENT_FAILED'
    ELSE 'MARKETPLACE_PAYMENT_RECONCILED'
  END;

  IF v_next_status IS DISTINCT FROM v_from_status
     OR p_normalized_status IN ('captured','released','refunded','cancelled','failed') THEN
    INSERT INTO public.domain_events(event_type,payload,status,attempts,tenant_id)
    VALUES(
      v_event_type,
      jsonb_build_object(
        'transactionIntentId',v_tx.id,
        'vin',v_tx.vin,
        'paymentState',p_normalized_status,
        'provider',btrim(p_provider),
        'settlementOperationKey',CASE WHEN p_normalized_status='released' THEN v_tx.settlement_operation_key ELSE NULL END
      ),'pending',0,v_tx.tenant_id
    );
  END IF;

  RETURN v_tx;
END
$reconcile$;

REVOKE ALL ON FUNCTION public.issue164_record_payment_state_atomic(uuid,text,text,text,text,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_record_payment_state_atomic(uuid,text,text,text,text,text,jsonb)
  TO service_role;

DO $post$
DECLARE
  v_definition text;
  v_bad_grants integer;
BEGIN
  SELECT pg_get_functiondef('public.issue164_record_payment_state_atomic(uuid,text,text,text,text,text,jsonb)'::regprocedure)
    INTO v_definition;
  IF v_definition ~* '\mowner_id\M|vehicle_ownership_history' THEN
    RAISE EXCEPTION '[issue-164-p6] provider reconciliation attempted to own legal vehicle title';
  END IF;
  SELECT count(*) INTO v_bad_grants
    FROM information_schema.role_table_grants
   WHERE table_schema='public'
     AND table_name IN ('safetrade_sandbox_payment_intents','safetrade_sandbox_payment_operations')
     AND grantee IN ('anon','authenticated');
  IF v_bad_grants<>0 THEN
    RAISE EXCEPTION '[issue-164-p6] sandbox provider ledger exposed to browser roles';
  END IF;
END
$post$;

-- +migrate Down
-- Forward-only. Synthetic provider/audit state and settlement claims are not discarded by rollback.
