-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6 — PAYMENT RACE / IDEMPOTENCY HARDENING
--
-- Ordered after migration 1260. This remains service-role-only synthetic-provider / canonical
-- transaction infrastructure and is UNAPPLIED until the guarded staging cutover.
--
-- Closes the fresh Phase 6 certification findings:
--   1. sandbox idempotency replay is bound to the same action + intent/transaction;
--   2. concurrent sandbox retries serialize before their replay lookup;
--   3. refund is DB-claimed before provider.refund(), mutually exclusive with settlement claim;
--   4. payout/refund claim provenance remains immutable after terminal reconciliation.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.safetrade_sandbox_payment_intents') IS NULL
     OR to_regclass('public.safetrade_sandbox_payment_operations') IS NULL
     OR to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.escrow_trust_events') IS NULL
     OR to_regprocedure('public.issue164_sandbox_payment_action_atomic(text,text,uuid,text,numeric,text,text,text,text)') IS NULL
     OR to_regprocedure('public.issue164_begin_settlement_atomic(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] migration 1270 requires payment-operation hardening 1260';
  END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- Durable sandbox operation: globally serialize mutating synthetic-provider operations. This is
-- intentionally conservative: sandbox is test/staging infrastructure, so correctness and replay
-- determinism outrank throughput. The table lock makes an identical concurrent retry observe the
-- committed operation row before evaluating provider state.
-- -----------------------------------------------------------------------------
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
  v_existing_action text;
  v_existing_intent_id text;
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
    LOCK TABLE public.safetrade_sandbox_payment_operations IN SHARE ROW EXCLUSIVE MODE;

    SELECT action,intent_id,result
      INTO v_existing_action,v_existing_intent_id,v_existing_result
      FROM public.safetrade_sandbox_payment_operations
     WHERE idempotency_key=p_idempotency_key;
    IF FOUND THEN
      IF v_existing_action IS DISTINCT FROM p_action THEN
        RAISE EXCEPTION 'sandbox idempotency key already belongs to a different action'
          USING ERRCODE='23514';
      END IF;

      IF p_action='create' THEN
        SELECT * INTO v_intent
          FROM public.safetrade_sandbox_payment_intents
         WHERE intent_id=v_existing_intent_id;
        IF NOT FOUND
           OR v_intent.transaction_intent_id IS DISTINCT FROM p_transaction_intent_id
           OR v_intent.amount IS DISTINCT FROM p_amount
           OR upper(v_intent.currency) IS DISTINCT FROM upper(btrim(p_currency))
           OR v_intent.payer_id IS DISTINCT FROM p_payer_id
           OR v_intent.payee_id IS DISTINCT FROM p_payee_id
           OR v_intent.tenant_id IS DISTINCT FROM p_tenant_id THEN
          RAISE EXCEPTION 'sandbox idempotency key already belongs to different create terms'
            USING ERRCODE='23514';
        END IF;
      ELSIF v_existing_intent_id IS DISTINCT FROM p_intent_id THEN
        RAISE EXCEPTION 'sandbox idempotency key already belongs to a different intent'
          USING ERRCODE='23514';
      END IF;

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
       OR v_intent.payee_id IS DISTINCT FROM p_payee_id
       OR v_intent.tenant_id IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'sandbox transaction already bound to different provider intent terms'
        USING ERRCODE='23514';
    END IF;

    v_result := jsonb_build_object(
      'provider','sandbox','intentId',v_intent.intent_id,'status',v_intent.status,
      'amount',v_intent.amount,'currency',v_intent.currency,'live',false,'idempotentReplay',false
    );
    INSERT INTO public.safetrade_sandbox_payment_operations(idempotency_key,intent_id,action,result,created_at)
    VALUES(p_idempotency_key,v_intent.intent_id,'create',v_result,v_now);
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
-- Refund operation claim. This is the PostgreSQL serialization point BEFORE provider.refund().
-- Release and refund claims are mutually exclusive on the locked canonical transaction row.
-- -----------------------------------------------------------------------------
ALTER TABLE public.escrow_trust_sessions
  ADD COLUMN IF NOT EXISTS refund_operation_key text,
  ADD COLUMN IF NOT EXISTS refund_operation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_operation_actor_id text,
  ADD COLUMN IF NOT EXISTS refund_payment_intent_id text;

DO $refund_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.escrow_trust_sessions'::regclass
       AND conname='escrow_trust_refund_claim_pair_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_refund_claim_pair_chk CHECK (
        (refund_operation_key IS NULL
          AND refund_operation_started_at IS NULL
          AND refund_operation_actor_id IS NULL
          AND refund_payment_intent_id IS NULL)
        OR
        (nullif(btrim(refund_operation_key),'') IS NOT NULL
          AND refund_operation_started_at IS NOT NULL
          AND nullif(btrim(refund_operation_actor_id),'') IS NOT NULL
          AND nullif(btrim(refund_payment_intent_id),'') IS NOT NULL)
      );
  END IF;
END
$refund_constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_trust_refund_operation_key
  ON public.escrow_trust_sessions(refund_operation_key)
  WHERE refund_operation_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue164_begin_refund_atomic(
  p_session_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_operation_key text
)
RETURNS public.escrow_trust_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $refund_claim$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_role text := lower(coalesce(nullif(btrim(p_actor_role),''),'unknown'));
  v_now timestamptz := clock_timestamp();
BEGIN
  IF nullif(btrim(p_actor_id),'') IS NULL OR nullif(btrim(p_operation_key),'') IS NULL THEN
    RAISE EXCEPTION 'refund actor and operation key required' USING ERRCODE='22023';
  END IF;
  IF v_role NOT IN ('admin','platform_admin','super_admin','reviewer') THEN
    RAISE EXCEPTION 'refund claim requires reviewer/admin action' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id=p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction intent not found' USING ERRCODE='P0002'; END IF;

  IF v_tx.settlement_operation_key IS NOT NULL THEN
    RAISE EXCEPTION 'settlement already claimed; provider release must be reconciled first'
      USING ERRCODE='23514';
  END IF;

  IF v_tx.refund_operation_key IS NOT NULL THEN
    IF v_tx.refund_operation_key=p_operation_key
       AND v_tx.refund_payment_intent_id=v_tx.payment_intent_id THEN
      RETURN v_tx;
    END IF;
    RAISE EXCEPTION 'transaction already has a different refund operation claim'
      USING ERRCODE='23505';
  END IF;

  IF v_tx.status NOT IN ('funds_held','inspection_pending','release_approved','disputed') THEN
    RAISE EXCEPTION 'transaction status does not permit refund claim' USING ERRCODE='23514';
  END IF;
  IF v_tx.payment_state<>'captured'
     OR nullif(btrim(v_tx.payment_intent_id),'') IS NULL
     OR nullif(btrim(v_tx.payment_provider),'') IS NULL THEN
    RAISE EXCEPTION 'refund requires attributable captured provider funds' USING ERRCODE='23514';
  END IF;

  UPDATE public.escrow_trust_sessions
     SET refund_operation_key=p_operation_key,
         refund_operation_started_at=v_now,
         refund_operation_actor_id=p_actor_id,
         refund_payment_intent_id=v_tx.payment_intent_id,
         updated_at=v_now
   WHERE id=v_tx.id
   RETURNING * INTO v_tx;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_tx.id,v_tx.status,v_tx.status,p_actor_id,v_role,'refund_operation_claimed',
    jsonb_build_object(
      'refundOperationKey',p_operation_key,
      'paymentIntentId',v_tx.refund_payment_intent_id
    ),v_now
  );

  RETURN v_tx;
END
$refund_claim$;

REVOKE ALL ON FUNCTION public.issue164_begin_refund_atomic(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_begin_refund_atomic(uuid,text,text,text)
  TO service_role;

-- Strengthen the existing claim guard. Claim lineage is immutable for the lifetime of the row,
-- including after settled/refunded. While pending, settlement may reconcile provider truth to
-- settled (or refunded if the provider independently reports a refund); a refund claim may reconcile
-- only to refunded. A row can never carry both operation claims.
CREATE OR REPLACE FUNCTION public.issue164_settlement_claim_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $guard$
BEGIN
  IF NEW.settlement_operation_key IS NOT NULL AND NEW.refund_operation_key IS NOT NULL THEN
    RAISE EXCEPTION 'settlement and refund operation claims are mutually exclusive'
      USING ERRCODE='23514';
  END IF;

  IF OLD.settlement_operation_key IS NOT NULL THEN
    IF NEW.settlement_operation_key IS DISTINCT FROM OLD.settlement_operation_key
       OR NEW.settlement_operation_started_at IS DISTINCT FROM OLD.settlement_operation_started_at
       OR NEW.settlement_operation_actor_id IS DISTINCT FROM OLD.settlement_operation_actor_id
       OR NEW.settlement_seller_id IS DISTINCT FROM OLD.settlement_seller_id
       OR NEW.settlement_payment_intent_id IS DISTINCT FROM OLD.settlement_payment_intent_id THEN
      RAISE EXCEPTION 'settlement operation claim is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.status='release_approved'
       AND NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('settled','refunded') THEN
      RAISE EXCEPTION 'settlement operation already claimed; provider reconciliation required'
        USING ERRCODE='23514';
    END IF;
  END IF;

  IF OLD.refund_operation_key IS NOT NULL THEN
    IF NEW.refund_operation_key IS DISTINCT FROM OLD.refund_operation_key
       OR NEW.refund_operation_started_at IS DISTINCT FROM OLD.refund_operation_started_at
       OR NEW.refund_operation_actor_id IS DISTINCT FROM OLD.refund_operation_actor_id
       OR NEW.refund_payment_intent_id IS DISTINCT FROM OLD.refund_payment_intent_id THEN
      RAISE EXCEPTION 'refund operation claim is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status<>'refunded' THEN
      RAISE EXCEPTION 'refund operation already claimed; provider reconciliation required'
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

DO $post$
DECLARE
  v_sandbox_definition text;
  v_refund_definition text;
  v_guard_definition text;
  v_bad_grants integer;
BEGIN
  SELECT pg_get_functiondef('public.issue164_sandbox_payment_action_atomic(text,text,uuid,text,numeric,text,text,text,text)'::regprocedure)
    INTO v_sandbox_definition;
  IF v_sandbox_definition !~* 'LOCK TABLE public\.safetrade_sandbox_payment_operations'
     OR v_sandbox_definition !~* 'different action'
     OR v_sandbox_definition !~* 'different intent' THEN
    RAISE EXCEPTION '[issue-164-p6] sandbox replay serialization/binding postcondition failed';
  END IF;

  SELECT pg_get_functiondef('public.issue164_begin_refund_atomic(uuid,text,text,text)'::regprocedure)
    INTO v_refund_definition;
  IF v_refund_definition !~* 'settlement already claimed' THEN
    RAISE EXCEPTION '[issue-164-p6] refund/release mutual exclusion postcondition failed';
  END IF;

  SELECT pg_get_functiondef('public.issue164_settlement_claim_guard()'::regprocedure)
    INTO v_guard_definition;
  IF v_guard_definition !~* 'settlement operation claim is immutable'
     OR v_guard_definition !~* 'refund operation claim is immutable' THEN
    RAISE EXCEPTION '[issue-164-p6] operation-claim immutability postcondition failed';
  END IF;

  SELECT count(*) INTO v_bad_grants
    FROM information_schema.role_routine_grants
   WHERE routine_schema='public'
     AND routine_name='issue164_begin_refund_atomic'
     AND grantee IN ('PUBLIC','anon','authenticated');
  IF v_bad_grants<>0 THEN
    RAISE EXCEPTION '[issue-164-p6] refund claim RPC exposed to browser roles';
  END IF;
END
$post$;

-- +migrate Down
-- Forward-only. Provider-operation and refund-claim provenance is not discarded by rollback.
