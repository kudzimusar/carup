-- +migrate Up
-- =============================================================================
-- Diaspora ledger #25 — atomic quota release (Issue #127).
--
-- `releaseUsage` performed a read-modify-write across two tables with no lock:
--
--   1. read the reservation and check its status
--   2. read the meter
--   3. write used_count = max(used - amount, 0)
--   4. write the reservation status to RELEASED
--
-- Two releases of the same reservation racing each other both pass step 1 (neither
-- has flipped the status yet), both read the same used_count at step 2, and both
-- write the same decremented value at step 3. The meter loses `amount` once but is
-- charged for it twice — remaining quota is INFLATED, and a tenant can consume
-- more than their plan allows. Interleaving with a concurrent reserve() on the same
-- (tenant, feature, period) corrupts the meter the same way.
--
-- This RPC makes the whole sequence one transaction under a row lock:
--
--   · the reservation row is taken FOR UPDATE first, so a second caller blocks
--     until the first commits and then observes RELEASED — an idempotent no-op
--     rather than a second decrement;
--   · the meter row is taken FOR UPDATE, so a concurrent reserve or release on the
--     same meter serialises instead of interleaving;
--   · the decrement uses GREATEST(used_count - amount, 0), so used_count can never
--     go negative even if the data were already inconsistent;
--   · the audit row is written inside the same transaction, so a released
--     reservation cannot exist without its audit record.
--
-- Tenant and feature-key scoping are preserved: the meter is located by the
-- reservation's OWN tenant_id, feature_key and period_start, never by caller input,
-- so a caller cannot release against another tenant's meter.
--
-- Additive. Ledgers #21–#24 are untouched. service_role-only EXECUTE, search_path
-- pinned to include `extensions` so pgcrypto's digest() resolves for the audit seal
-- exactly as ledger #18 established.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.diaspora_release_usage_atomic(
  p_reservation_id uuid,
  p_actor_id text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_res public.diaspora_usage_reservations%ROWTYPE;
  v_meter public.diaspora_usage_meters%ROWTYPE;
  v_before integer;
  v_after integer;
  v_seal text;
  v_ts timestamptz := now();
BEGIN
  -- 1. Lock the reservation. A concurrent release blocks here and, once this
  --    transaction commits, sees RELEASED — so it decrements nothing.
  SELECT * INTO v_res FROM public.diaspora_usage_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/RESERVATION_NOT_FOUND';
  END IF;

  IF v_res.status = 'RELEASED' THEN
    RETURN jsonb_build_object(
      'reservationId', p_reservation_id, 'status', 'RELEASED',
      'idempotentReplay', true, 'meterBefore', NULL, 'meterAfter', NULL);
  END IF;

  IF v_res.status = 'COMMITTED' THEN
    -- Committed work was really consumed. Releasing it would hand back quota for
    -- something that actually happened.
    RAISE EXCEPTION 'DIASPORA_ENTITLEMENT/CANNOT_RELEASE_COMMITTED';
  END IF;

  -- 2. Lock the meter, located by the RESERVATION's own scope — never by caller
  --    input, so a caller cannot decrement another tenant's meter.
  SELECT * INTO v_meter FROM public.diaspora_usage_meters
    WHERE tenant_id = v_res.tenant_id
      AND feature_key = v_res.feature_key
      AND period_start = v_res.period_start
    FOR UPDATE;

  IF FOUND THEN
    v_before := v_meter.used_count;
    -- GREATEST floors at zero: even pre-existing inconsistency cannot produce a
    -- negative meter, which would read as free quota.
    v_after := GREATEST(v_meter.used_count - COALESCE(v_res.amount, 0), 0);
    UPDATE public.diaspora_usage_meters
       SET used_count = v_after, updated_at = v_ts
     WHERE id = v_meter.id;
  ELSE
    -- No meter for this period is legitimate (nothing was ever counted). Releasing
    -- is then purely a status transition.
    v_before := NULL;
    v_after := NULL;
  END IF;

  -- 3. Flip the reservation in the SAME transaction as the decrement.
  UPDATE public.diaspora_usage_reservations
     SET status = 'RELEASED', updated_at = v_ts
   WHERE id = p_reservation_id
   RETURNING * INTO v_res;

  -- 4. Audit inside the transaction, so a released reservation cannot exist
  --    without its record.
  v_seal := encode(digest(
    COALESCE(p_actor_id, 'system') || '|ENTITLEMENT_USAGE_RELEASED|diaspora_usage_reservation|'
      || p_reservation_id::text || '|' || v_ts::text,
    'sha256'), 'hex');
  INSERT INTO public.diaspora_import_audit_log (
    tenant_id, actor_id, action, resource_type, resource_id,
    previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    v_res.tenant_id, p_actor_id, 'ENTITLEMENT_USAGE_RELEASED',
    'diaspora_usage_reservation', p_reservation_id::text,
    jsonb_build_object('status', 'RESERVED', 'meterUsed', v_before),
    jsonb_build_object('status', 'RELEASED', 'meterUsed', v_after),
    jsonb_build_object(
      'featureKey', v_res.feature_key,
      'amount', v_res.amount,
      'correlationId', p_correlation_id),
    v_seal
  );

  RETURN jsonb_build_object(
    'reservationId', p_reservation_id,
    'status', 'RELEASED',
    'idempotentReplay', false,
    'meterBefore', v_before,
    'meterAfter', v_after,
    'reservation', to_jsonb(v_res));
END;
$$;

REVOKE ALL ON FUNCTION public.diaspora_release_usage_atomic(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_release_usage_atomic(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.diaspora_release_usage_atomic(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diaspora_release_usage_atomic(uuid, text, text) TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS public.diaspora_release_usage_atomic(uuid, text, text);
