-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6A — ATOMIC MARKETPLACE TRANSACTION INTENT
--
-- The application resolves canonical Trust gates; PostgreSQL independently locks and verifies the
-- current seller, purchase inquiry, publication and listing economics before persisting the intent.
-- Session + immutable audit event are one transaction. Re-evaluation of a pre-payment intent is
-- also atomic and keeps the same stable intent id/idempotency key.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.escrow_trust_events') IS NULL
     OR to_regclass('public.marketplace_inquiries') IS NULL
     OR to_regclass('public.vehicles') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] transaction intent prerequisites absent';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.issue164_upsert_transaction_intent_atomic(
  p_vin text,
  p_buyer_id text,
  p_seller_id text,
  p_inquiry_id uuid,
  p_listing_snapshot_hash text,
  p_listing_amount numeric,
  p_listing_currency text,
  p_listing_currency_source text,
  p_gate_allowed boolean,
  p_gate_reasons jsonb,
  p_idempotency_key text
)
RETURNS public.escrow_trust_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $intent$
DECLARE
  v_vehicle public.vehicles%ROWTYPE;
  v_inquiry public.marketplace_inquiries%ROWTYPE;
  v_existing public.escrow_trust_sessions%ROWTYPE;
  v_created public.escrow_trust_sessions%ROWTYPE;
  v_next_status text := CASE WHEN p_gate_allowed IS TRUE THEN 'eligible' ELSE 'failed' END;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF nullif(btrim(p_vin),'') IS NULL
     OR nullif(btrim(p_buyer_id),'') IS NULL
     OR nullif(btrim(p_seller_id),'') IS NULL
     OR p_inquiry_id IS NULL
     OR nullif(btrim(p_listing_snapshot_hash),'') IS NULL
     OR p_listing_amount IS NULL OR p_listing_amount<=0
     OR nullif(btrim(p_listing_currency),'') IS NULL
     OR nullif(btrim(p_listing_currency_source),'') IS NULL
     OR nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'complete server-resolved transaction lineage is required' USING ERRCODE='22023';
  END IF;
  IF p_buyer_id=p_seller_id THEN
    RAISE EXCEPTION 'buyer and seller must be distinct' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_vehicle
    FROM public.vehicles
   WHERE vin=p_vin
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing not found' USING ERRCODE='P0002'; END IF;

  -- Phase 4 seller semantics: current_seller_id is the seller relationship. owner_id is not read.
  IF nullif(btrim(v_vehicle.current_seller_id),'') IS NULL
     OR v_vehicle.current_seller_id IS DISTINCT FROM p_seller_id THEN
    RAISE EXCEPTION 'current seller changed or is not governed' USING ERRCODE='23514';
  END IF;
  IF lower(coalesce(v_vehicle.publication_status,''))<>'published' THEN
    RAISE EXCEPTION 'listing is not published' USING ERRCODE='23514';
  END IF;
  IF v_vehicle.price IS NULL OR v_vehicle.price::numeric IS DISTINCT FROM p_listing_amount THEN
    RAISE EXCEPTION 'listing amount changed during transaction intent creation' USING ERRCODE='23514';
  END IF;
  IF nullif(btrim(v_vehicle.currency),'') IS NULL
     OR upper(btrim(v_vehicle.currency)) IS DISTINCT FROM upper(btrim(p_listing_currency)) THEN
    RAISE EXCEPTION 'listing currency changed during transaction intent creation' USING ERRCODE='23514';
  END IF;
  IF nullif(btrim(v_vehicle.currency_source),'') IS NULL
     OR v_vehicle.currency_source IS DISTINCT FROM p_listing_currency_source THEN
    RAISE EXCEPTION 'listing currency provenance changed during transaction intent creation'
      USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_inquiry
    FROM public.marketplace_inquiries
   WHERE id=p_inquiry_id
     AND listing_id=p_vin
     AND buyer_id=p_buyer_id
     AND seller_id=p_seller_id
     AND inquiry_type='vehicle_purchase_interest'
     AND risk_status='clear'
     AND status IN ('new','assigned','contacted','qualified')
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'current clear purchase inquiry required' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_existing
    FROM public.escrow_trust_sessions
   WHERE idempotency_key=p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.vin IS DISTINCT FROM p_vin
       OR v_existing.buyer_id IS DISTINCT FROM p_buyer_id
       OR v_existing.seller_id IS DISTINCT FROM p_seller_id
       OR v_existing.inquiry_id IS DISTINCT FROM p_inquiry_id
       OR v_existing.listing_snapshot_hash IS DISTINCT FROM p_listing_snapshot_hash
       OR v_existing.listing_amount IS DISTINCT FROM p_listing_amount
       OR upper(v_existing.listing_currency) IS DISTINCT FROM upper(p_listing_currency)
       OR v_existing.listing_currency_source IS DISTINCT FROM p_listing_currency_source THEN
      RAISE EXCEPTION 'idempotency key is bound to different transaction truth' USING ERRCODE='23505';
    END IF;

    -- Eligibility can legitimately change while the immutable listing snapshot does not (for example
    -- a fraud review resolves). Before payment starts the SAME intent is re-evaluated rather than
    -- minting a second transaction. Once initiated, this function never rewinds it; later actions
    -- re-check gates independently.
    IF v_existing.status IN ('eligible','failed')
       AND (
         v_existing.status IS DISTINCT FROM v_next_status
         OR coalesce(v_existing.gate_reasons,'[]'::jsonb) IS DISTINCT FROM coalesce(p_gate_reasons,'[]'::jsonb)
       ) THEN
      UPDATE public.escrow_trust_sessions
         SET status=v_next_status,
             gate_reasons=coalesce(p_gate_reasons,'[]'::jsonb),
             updated_at=v_now
       WHERE id=v_existing.id
       RETURNING * INTO v_existing;

      INSERT INTO public.escrow_trust_events(
        session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
      ) VALUES(
        v_existing.id,
        CASE WHEN v_next_status='eligible' THEN 'failed' ELSE 'eligible' END,
        v_next_status,
        p_buyer_id,'buyer','eligibility_re_evaluated',
        jsonb_build_object('gate_reasons',coalesce(p_gate_reasons,'[]'::jsonb)),v_now
      );
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO public.escrow_trust_sessions(
    vin,tenant_id,inquiry_id,buyer_id,seller_id,status,listing_snapshot_hash,gate_reasons,
    idempotency_key,listing_amount,listing_currency,listing_currency_source,created_at,updated_at
  ) VALUES(
    p_vin,v_vehicle.tenant_id,p_inquiry_id,p_buyer_id,p_seller_id,v_next_status,
    p_listing_snapshot_hash,coalesce(p_gate_reasons,'[]'::jsonb),p_idempotency_key,
    p_listing_amount,upper(btrim(p_listing_currency)),p_listing_currency_source,v_now,v_now
  ) RETURNING * INTO v_created;

  INSERT INTO public.escrow_trust_events(
    session_id,from_status,to_status,actor_id,actor_role,reason,payload,created_at
  ) VALUES(
    v_created.id,'pending_eligibility',v_next_status,p_buyer_id,'buyer','initial_eligibility_evaluated',
    jsonb_build_object(
      'inquiry_id',p_inquiry_id,
      'gate_reasons',coalesce(p_gate_reasons,'[]'::jsonb),
      'listing_snapshot_hash',p_listing_snapshot_hash
    ),v_now
  );

  RETURN v_created;
END
$intent$;

REVOKE ALL ON FUNCTION public.issue164_upsert_transaction_intent_atomic(text,text,text,uuid,text,numeric,text,text,boolean,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_upsert_transaction_intent_atomic(text,text,text,uuid,text,numeric,text,text,boolean,jsonb,text)
  TO service_role;

-- +migrate Down
-- Forward-only. Transaction intent/audit history is not discarded by rollback.
