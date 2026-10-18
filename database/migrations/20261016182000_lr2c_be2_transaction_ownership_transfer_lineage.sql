-- +migrate Up
-- =============================================================================
-- OC-NATIVE-LR2-C-BE2 — durable transaction -> ownership-transfer lineage
--
-- Adds the missing exact FK from canonical Marketplace transaction intent to the governed
-- ownership-transfer object. Historical transfers are deliberately NOT backfilled: a VIN, party
-- pair or timestamp is not transaction identity authority.
-- =============================================================================

ALTER TABLE public.vehicle_ownership_transfers
  ADD COLUMN IF NOT EXISTS transaction_intent_id UUID;

DO $be2_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.vehicle_ownership_transfers'::regclass
       AND conname = 'vehicle_ownership_transfers_transaction_intent_id_fkey'
  ) THEN
    ALTER TABLE public.vehicle_ownership_transfers
      ADD CONSTRAINT vehicle_ownership_transfers_transaction_intent_id_fkey
      FOREIGN KEY (transaction_intent_id)
      REFERENCES public.escrow_trust_sessions(id)
      ON DELETE RESTRICT;
  END IF;
END
$be2_fk$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_ownership_transfer_transaction_intent
  ON public.vehicle_ownership_transfers(transaction_intent_id)
  WHERE transaction_intent_id IS NOT NULL;

COMMENT ON COLUMN public.vehicle_ownership_transfers.transaction_intent_id IS
  'Exact canonical Marketplace transaction lineage. NULL means no durable transaction relationship was recorded; never infer from VIN, parties, state or timestamps.';

CREATE OR REPLACE FUNCTION public.passport_begin_ownership_transfer_from_transaction_atomic(
  p_transaction_intent_id UUID,
  p_actor_id TEXT,
  p_actor_role TEXT,
  p_idempotency_key TEXT
)
RETURNS public.vehicle_ownership_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $be2_begin$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_existing public.vehicle_ownership_transfers%ROWTYPE;
  v_transfer public.vehicle_ownership_transfers%ROWTYPE;
  v_privileged BOOLEAN := lower(coalesce(p_actor_role,'')) IN ('admin','government','reviewer','platform_admin','super_admin');
BEGIN
  IF p_transaction_intent_id IS NULL
     OR nullif(btrim(p_actor_id),'') IS NULL
     OR nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'transaction intent, authenticated actor and idempotency key are required'
      USING ERRCODE='22023';
  END IF;

  SELECT *
    INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id = p_transaction_intent_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction intent not found' USING ERRCODE='P0002';
  END IF;

  IF nullif(btrim(v_tx.vin),'') IS NULL
     OR nullif(btrim(v_tx.buyer_id),'') IS NULL
     OR nullif(btrim(v_tx.seller_id),'') IS NULL
     OR v_tx.buyer_id = v_tx.seller_id THEN
    RAISE EXCEPTION 'transaction intent lacks complete canonical participant lineage'
      USING ERRCODE='23514';
  END IF;

  -- Possession of an intent id is never authority. The actor must be a canonical transaction
  -- participant or existing governance. The existing transfer RPC below then independently keeps
  -- the stricter current-owner-or-governance initiation rule.
  IF p_actor_id NOT IN (v_tx.buyer_id, v_tx.seller_id) AND NOT v_privileged THEN
    RAISE EXCEPTION 'actor is not a transaction participant or governance reviewer'
      USING ERRCODE='42501';
  END IF;

  SELECT *
    INTO v_vehicle
    FROM public.vehicles
   WHERE vin = v_tx.vin
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction vehicle not found' USING ERRCODE='P0002';
  END IF;

  IF nullif(btrim(v_vehicle.owner_id),'') IS NULL THEN
    RAISE EXCEPTION 'governed current owner is required before transfer' USING ERRCODE='23514';
  END IF;

  -- The transaction's seller lineage must still be the canonical legal owner. A stale Marketplace
  -- seller or a transaction for a previously-owned VIN cannot be rebound to current ownership.
  IF v_vehicle.owner_id IS DISTINCT FROM v_tx.seller_id THEN
    RAISE EXCEPTION 'transaction seller is not the canonical current vehicle owner'
      USING ERRCODE='23514';
  END IF;

  -- Never attach a legacy/unlinked transfer merely because its idempotency key happens to match.
  SELECT *
    INTO v_existing
    FROM public.vehicle_ownership_transfers
   WHERE idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.transaction_intent_id IS NULL THEN
      RAISE EXCEPTION 'idempotency key belongs to a transfer with no durable transaction lineage'
        USING ERRCODE='23505';
    END IF;
    IF v_existing.transaction_intent_id IS DISTINCT FROM p_transaction_intent_id
       OR v_existing.vin IS DISTINCT FROM v_tx.vin
       OR v_existing.incoming_owner_id IS DISTINCT FROM v_tx.buyer_id
       OR v_existing.previous_owner_id IS DISTINCT FROM v_tx.seller_id THEN
      RAISE EXCEPTION 'idempotency key is bound to different transaction-transfer truth'
        USING ERRCODE='23505';
    END IF;
    RETURN v_existing;
  END IF;

  -- The exact transaction FK is the idempotency authority for lineage itself.
  SELECT *
    INTO v_existing
    FROM public.vehicle_ownership_transfers
   WHERE transaction_intent_id = p_transaction_intent_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.vin IS DISTINCT FROM v_tx.vin
       OR v_existing.incoming_owner_id IS DISTINCT FROM v_tx.buyer_id
       OR v_existing.previous_owner_id IS DISTINCT FROM v_tx.seller_id THEN
      RAISE EXCEPTION 'stored transaction-transfer lineage conflicts with canonical transaction truth'
        USING ERRCODE='23514';
    END IF;
    RETURN v_existing;
  END IF;

  -- Reuse the existing governed transfer initiation state machine. VIN and incoming owner are
  -- server-derived from the exact transaction; no client-supplied ownership truth reaches it.
  SELECT *
    INTO v_transfer
    FROM public.passport_begin_ownership_transfer_atomic(
      v_tx.vin,
      v_tx.buyer_id,
      p_actor_id,
      p_actor_role,
      p_idempotency_key
    );

  IF v_transfer.transaction_intent_id IS NOT NULL THEN
    IF v_transfer.transaction_intent_id IS DISTINCT FROM p_transaction_intent_id THEN
      RAISE EXCEPTION 'ownership transfer is already bound to another transaction intent'
        USING ERRCODE='23505';
    END IF;
    RETURN v_transfer;
  END IF;

  UPDATE public.vehicle_ownership_transfers
     SET transaction_intent_id = p_transaction_intent_id
   WHERE id = v_transfer.id
     AND transaction_intent_id IS NULL
   RETURNING * INTO v_transfer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ownership transfer lineage could not be bound atomically'
      USING ERRCODE='23505';
  END IF;

  RETURN v_transfer;
END
$be2_begin$;

REVOKE ALL ON FUNCTION public.passport_begin_ownership_transfer_from_transaction_atomic(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.passport_begin_ownership_transfer_from_transaction_atomic(uuid,text,text,text)
  TO service_role;

DO $be2_post$
DECLARE
  v_nullable TEXT;
  v_fk_count INTEGER;
  v_unique_count INTEGER;
BEGIN
  SELECT is_nullable
    INTO v_nullable
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='vehicle_ownership_transfers'
     AND column_name='transaction_intent_id';

  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '[BE2] transaction_intent_id must remain nullable for truthful legacy history';
  END IF;

  SELECT count(*)::int
    INTO v_fk_count
    FROM pg_constraint
   WHERE conrelid='public.vehicle_ownership_transfers'::regclass
     AND conname='vehicle_ownership_transfers_transaction_intent_id_fkey'
     AND contype='f';

  IF v_fk_count <> 1 THEN
    RAISE EXCEPTION '[BE2] transaction_intent_id FK authority is missing';
  END IF;

  SELECT count(*)::int
    INTO v_unique_count
    FROM pg_indexes
   WHERE schemaname='public'
     AND tablename='vehicle_ownership_transfers'
     AND indexname='uq_vehicle_ownership_transfer_transaction_intent'
     AND indexdef ILIKE '%UNIQUE%'
     AND indexdef ILIKE '%WHERE (transaction_intent_id IS NOT NULL)%';

  IF v_unique_count <> 1 THEN
    RAISE EXCEPTION '[BE2] unique non-null transaction lineage authority is missing';
  END IF;
END
$be2_post$;

-- +migrate Down
-- Forward-only. Removing this column would destroy durable transaction/ownership provenance.
SELECT 1;
