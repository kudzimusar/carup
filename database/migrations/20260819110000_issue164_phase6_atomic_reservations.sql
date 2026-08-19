-- +migrate Up
-- =============================================================================
-- ISSUE #164 — PHASE 6: SERVER-AUTHORITATIVE, BUYER-BOUND RESERVATIONS
--
-- A reservation is a child state of the EXISTING escrow_trust_sessions transaction intent.
-- It is not a second transaction model. Creation is one PostgreSQL transaction: lock the
-- canonical intent + vehicle, validate buyer/inquiry/terms/state, arbitrate any existing
-- reservation, insert the reservation, update the vehicle's listing-state cache, and enqueue
-- the VEHICLE_RESERVED outbox event. No browser/database role can write this table directly.
--
-- UNAPPLIED until the single guarded Issue #164 staging cutover after Phase 6.
-- =============================================================================

DO $p6_res_pre$
BEGIN
  IF to_regclass('public.vehicles') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.escrow_trust_sessions') IS NULL
     OR to_regclass('public.marketplace_inquiries') IS NULL
     OR to_regclass('public.domain_events') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] reservation prerequisites are absent; refusing to create a parallel/incomplete authority';
  END IF;
END
$p6_res_pre$;

CREATE TABLE IF NOT EXISTS public.vehicle_reservations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                   text NOT NULL REFERENCES public.vehicles(vin) ON DELETE RESTRICT,
  transaction_intent_id uuid NOT NULL REFERENCES public.escrow_trust_sessions(id) ON DELETE RESTRICT,
  inquiry_id            uuid NOT NULL REFERENCES public.marketplace_inquiries(id) ON DELETE RESTRICT,
  buyer_id              text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  seller_id             text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status                 text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','expired','cancelled','completed')),
  reserved_at            timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  idempotency_key        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_reservations_distinct_participants_chk CHECK (buyer_id <> seller_id),
  CONSTRAINT vehicle_reservations_expiry_chk CHECK (expires_at > reserved_at),
  CONSTRAINT vehicle_reservations_idem_uniq UNIQUE (idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_reservations_one_active_per_vin
  ON public.vehicle_reservations(vin) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_buyer
  ON public.vehicle_reservations(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_intent
  ON public.vehicle_reservations(transaction_intent_id);

ALTER TABLE public.vehicle_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vehicle_reservations FROM anon, authenticated;
GRANT ALL ON TABLE public.vehicle_reservations TO service_role;

-- These are MATERIALIZED LISTING-STATE CACHE fields. vehicle_reservations is the authority.
-- They exist so public/listing reads can publish server-known state without React guessing.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS reserved_at timestamptz,
  ADD COLUMN IF NOT EXISTS reserved_until timestamptz,
  ADD COLUMN IF NOT EXISTS active_reservation_id uuid;

DO $p6_res_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.vehicles'::regclass
       AND conname = 'vehicles_active_reservation_id_fkey'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_active_reservation_id_fkey
      FOREIGN KEY (active_reservation_id) REFERENCES public.vehicle_reservations(id) ON DELETE SET NULL;
  END IF;
END
$p6_res_fk$;

CREATE OR REPLACE FUNCTION public.issue164_reserve_vehicle_atomic(
  p_transaction_intent_id uuid,
  p_actor_id text,
  p_idempotency_key text
)
RETURNS TABLE (
  reservation_id uuid,
  vin text,
  transaction_intent_id uuid,
  inquiry_id uuid,
  status text,
  reserved_at timestamptz,
  expires_at timestamptz,
  idempotent_replay boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $issue164_reserve$
DECLARE
  v_tx public.escrow_trust_sessions%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_inquiry public.marketplace_inquiries%ROWTYPE;
  v_existing public.vehicle_reservations%ROWTYPE;
  v_created public.vehicle_reservations%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := clock_timestamp() + interval '7 days';
BEGIN
  IF p_transaction_intent_id IS NULL OR nullif(btrim(p_actor_id), '') IS NULL
     OR nullif(btrim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'transaction intent, authenticated actor and idempotency key are required'
      USING ERRCODE = '22023';
  END IF;

  -- The intent lock serializes retries/competing actions on one canonical transaction.
  SELECT * INTO v_tx
    FROM public.escrow_trust_sessions
   WHERE id = p_transaction_intent_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction intent not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_tx.buyer_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'reservation actor is not the transaction buyer' USING ERRCODE = '42501';
  END IF;
  IF v_tx.seller_id IS NULL OR v_tx.seller_id = p_actor_id THEN
    RAISE EXCEPTION 'transaction counterparty is unresolved or self-referential' USING ERRCODE = '23514';
  END IF;
  IF v_tx.status <> 'eligible' THEN
    RAISE EXCEPTION 'transaction intent is not eligible for reservation (status=%)', v_tx.status
      USING ERRCODE = '23514';
  END IF;
  IF v_tx.listing_amount IS NULL OR v_tx.listing_amount <= 0
     OR nullif(btrim(v_tx.listing_currency), '') IS NULL
     OR nullif(btrim(v_tx.listing_currency_source), '') IS NULL THEN
    RAISE EXCEPTION 'transaction intent has no provenance-backed listing economics'
      USING ERRCODE = '23514';
  END IF;

  -- Phase 6 sequence is explicit: buyer inquiry -> resolved participants -> transaction intent -> reservation.
  SELECT * INTO v_inquiry
    FROM public.marketplace_inquiries
   WHERE listing_id = v_tx.vin
     AND buyer_id = p_actor_id
     AND inquiry_type = 'vehicle_purchase_interest'
     AND risk_status = 'clear'
     AND status IN ('new','assigned','contacted','qualified')
     AND seller_id = v_tx.seller_id
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no current clear purchase inquiry binds this buyer, seller and listing'
      USING ERRCODE = '23514';
  END IF;

  -- A replay returns the original reservation byte-for-byte in time; it never extends the clock.
  SELECT * INTO v_existing
    FROM public.vehicle_reservations
   WHERE idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.transaction_intent_id <> p_transaction_intent_id
       OR v_existing.buyer_id <> p_actor_id THEN
      RAISE EXCEPTION 'idempotency key is bound to a different reservation'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.vin, v_existing.transaction_intent_id,
      v_existing.inquiry_id, v_existing.status, v_existing.reserved_at, v_existing.expires_at, true;
    RETURN;
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE vehicles.vin = v_tx.vin FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle not found' USING ERRCODE = 'P0002';
  END IF;
  IF lower(coalesce(v_vehicle.publication_status, '')) <> 'published' THEN
    RAISE EXCEPTION 'listing is not published' USING ERRCODE = '23514';
  END IF;

  -- Serialize on the vehicle row, then expire an elapsed canonical reservation if one exists.
  SELECT * INTO v_existing
    FROM public.vehicle_reservations
   WHERE vehicle_reservations.vin = v_tx.vin
     AND vehicle_reservations.status = 'active'
   LIMIT 1
   FOR UPDATE;
  IF FOUND AND v_existing.expires_at <= v_now THEN
    UPDATE public.vehicle_reservations
       SET status = 'expired', updated_at = v_now
     WHERE id = v_existing.id;
    v_existing := NULL;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.buyer_id = p_actor_id
       AND v_existing.transaction_intent_id = p_transaction_intent_id THEN
      -- Same transaction, different retry token: return the existing hold, never extend it.
      RETURN QUERY SELECT v_existing.id, v_existing.vin, v_existing.transaction_intent_id,
        v_existing.inquiry_id, v_existing.status, v_existing.reserved_at, v_existing.expires_at, true;
      RETURN;
    END IF;
    RAISE EXCEPTION 'vehicle already has an active reservation' USING ERRCODE = '23505';
  END IF;

  -- A legacy Reserved cache with no canonical reservation is ambiguous. Fail closed rather than steal it.
  IF lower(coalesce(v_vehicle.status, '')) = 'reserved' THEN
    RAISE EXCEPTION 'legacy reserved vehicle has no canonical reservation; operator reconciliation required'
      USING ERRCODE = '23514';
  END IF;
  IF lower(coalesce(v_vehicle.status, '')) NOT IN ('available','active') THEN
    RAISE EXCEPTION 'vehicle is not available for reservation (status=%)', v_vehicle.status
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.vehicle_reservations (
    vin, transaction_intent_id, inquiry_id, buyer_id, seller_id,
    status, reserved_at, expires_at, idempotency_key, created_at, updated_at
  ) VALUES (
    v_tx.vin, v_tx.id, v_inquiry.id, p_actor_id, v_tx.seller_id,
    'active', v_now, v_expires, p_idempotency_key, v_now, v_now
  ) RETURNING * INTO v_created;

  UPDATE public.vehicles
     SET status = 'Reserved',
         reserved_at = v_created.reserved_at,
         reserved_until = v_created.expires_at,
         active_reservation_id = v_created.id
   WHERE vehicles.vin = v_tx.vin;

  -- Transactional outbox: the event cannot exist without the reservation/cache update and vice versa.
  INSERT INTO public.domain_events (event_type, payload, status, attempts, tenant_id)
  VALUES (
    'VEHICLE_RESERVED',
    jsonb_build_object(
      'vin', v_tx.vin,
      'reservationId', v_created.id,
      'transactionIntentId', v_tx.id,
      'buyerId', p_actor_id,
      'sellerId', v_tx.seller_id,
      'durationDays', 7,
      'expiresAt', v_created.expires_at,
      'price', v_tx.listing_amount,
      'currency', v_tx.listing_currency
    ),
    'pending', 0, v_vehicle.tenant_id
  );

  RETURN QUERY SELECT v_created.id, v_created.vin, v_created.transaction_intent_id,
    v_created.inquiry_id, v_created.status, v_created.reserved_at, v_created.expires_at, false;
END
$issue164_reserve$;

REVOKE ALL ON FUNCTION public.issue164_reserve_vehicle_atomic(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue164_reserve_vehicle_atomic(uuid,text,text) TO service_role;

-- +migrate Down
-- Forward-only programme migration. Dropping the reservation authority would orphan materialized
-- vehicle reservation caches and destroy transaction lineage. Any reversal requires a separately
-- reviewed data migration after proving zero canonical reservations depend on it.
