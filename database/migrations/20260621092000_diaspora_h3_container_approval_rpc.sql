-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Hardening H3: serialized container approval RPC
--
-- Reservation approval locks the container row with SELECT ... FOR UPDATE, so two
-- concurrent approvals serialize on the same row and cannot both pass against an
-- old capacity snapshot. Approved volume (and weight where configured) is
-- recomputed inside the transaction; overfill is rejected; cached capacity fields
-- and ready-to-close/full flags are updated; a critical audit row is written.
--
-- Additive, backwards-compatible. NOT applied to production by this program.
-- =============================================================

CREATE OR REPLACE FUNCTION public.diaspora_approve_cargo_reservation_atomic(
  p_reservation_id uuid,
  p_actor_id text,
  p_actor_is_privileged boolean,
  p_actor_tenant_role text,
  p_actor_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.diaspora_cargo_reservations%ROWTYPE;
  v_container public.diaspora_container_shipments%ROWTYPE;
  v_used numeric;
  v_used_weight numeric;
  v_total numeric;
  v_total_weight numeric;
  v_projected numeric;
  v_available numeric;
  v_fill numeric;
  v_ready boolean;
  v_full boolean;
  v_can_review boolean;
  v_seal text;
  v_ts timestamptz := now();
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'DIASPORA_CONTAINER/UNAUTHENTICATED'; END IF;

  -- 1. Resolve the reservation, then lock the container (the contended resource) and the reservation.
  SELECT * INTO v_res FROM public.diaspora_cargo_reservations
    WHERE id = p_reservation_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_CONTAINER/NOT_FOUND_RESERVATION'; END IF;

  SELECT * INTO v_container FROM public.diaspora_container_shipments
    WHERE id = v_res.container_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_CONTAINER/NOT_FOUND_CONTAINER'; END IF;

  SELECT * INTO v_res FROM public.diaspora_cargo_reservations
    WHERE id = p_reservation_id AND deleted_at IS NULL FOR UPDATE;

  -- 2. Authority: platform admin/reviewer, or tenant admin of the container's tenant.
  v_can_review := p_actor_is_privileged
    OR (lower(COALESCE(p_actor_tenant_role,'')) IN ('admin','administrator','tenant_admin')
        AND p_actor_tenant_id IS NOT NULL AND p_actor_tenant_id = v_container.tenant_id);
  IF NOT v_can_review THEN RAISE EXCEPTION 'DIASPORA_CONTAINER/FORBIDDEN'; END IF;

  -- 3. State.
  IF v_res.reservation_status <> 'REQUESTED' THEN RAISE EXCEPTION 'DIASPORA_CONTAINER/NOT_REQUESTED: %', v_res.reservation_status; END IF;

  -- 4. Authoritative capacity recompute inside the locked transaction.
  SELECT COALESCE(SUM(estimated_volume), 0) INTO v_used FROM public.diaspora_cargo_reservations
    WHERE container_id = v_container.id AND reservation_status = 'APPROVED' AND deleted_at IS NULL;
  v_total := COALESCE(v_container.total_capacity_volume, 0);
  v_projected := round((v_used + COALESCE(v_res.estimated_volume, 0))::numeric, 3);
  IF v_projected > v_total THEN
    RAISE EXCEPTION 'DIASPORA_CONTAINER/OVERFILL: projected % total %', v_projected, v_total;
  END IF;

  v_total_weight := NULLIF(v_container.metadata->>'total_capacity_weight','')::numeric;
  IF v_total_weight IS NOT NULL AND v_res.estimated_weight IS NOT NULL THEN
    SELECT COALESCE(SUM(estimated_weight), 0) INTO v_used_weight FROM public.diaspora_cargo_reservations
      WHERE container_id = v_container.id AND reservation_status = 'APPROVED' AND deleted_at IS NULL;
    IF round((v_used_weight + v_res.estimated_weight)::numeric, 3) > v_total_weight THEN
      RAISE EXCEPTION 'DIASPORA_CONTAINER/WEIGHT_OVERFILL';
    END IF;
  END IF;

  -- 5. Approve the reservation.
  UPDATE public.diaspora_cargo_reservations
    SET reservation_status = 'APPROVED', reviewed_by = p_actor_id, reviewed_at = v_ts, updated_by = p_actor_id, updated_at = v_ts
    WHERE id = p_reservation_id RETURNING * INTO v_res;

  -- 6. Update cached container capacity + flags.
  v_available := round(GREATEST(v_total - v_projected, 0)::numeric, 3);
  v_fill := CASE WHEN v_total > 0 THEN round((v_projected / v_total)::numeric, 3) ELSE 0 END;
  v_ready := v_fill >= 0.90;
  v_full := v_fill >= 0.98;
  UPDATE public.diaspora_container_shipments
    SET used_capacity_volume = v_projected,
        available_capacity_volume = v_available,
        metadata = jsonb_set(COALESCE(v_container.metadata, '{}'::jsonb), '{capacity}',
          jsonb_build_object('fillPercent', v_fill, 'readyToClose', v_ready, 'full', v_full), true),
        updated_by = p_actor_id, updated_at = v_ts
    WHERE id = v_container.id RETURNING * INTO v_container;

  -- 7. Critical audit.
  v_seal := encode(digest(
    COALESCE(p_actor_id,'system') || '|CARGO_RESERVATION_APPROVED|diaspora_cargo_reservation|' || p_reservation_id::text || '|' || v_ts::text,
    'sha256'), 'hex');
  INSERT INTO public.diaspora_import_audit_log (
    import_order_id, tenant_id, actor_id, action, resource_type, resource_id, new_state, metadata, cryptographic_seal
  ) VALUES (
    v_res.import_order_id, v_res.tenant_id, p_actor_id, 'CARGO_RESERVATION_APPROVED', 'diaspora_cargo_reservation', p_reservation_id::text,
    to_jsonb(v_res), jsonb_build_object('usedVolume', v_projected, 'availableVolume', v_available, 'fillPercent', v_fill), v_seal
  );

  RETURN jsonb_build_object(
    'reservation', to_jsonb(v_res),
    'capacity', jsonb_build_object('totalVolume', v_total, 'usedVolume', v_projected, 'availableVolume', v_available, 'fillPercent', v_fill, 'readyToClose', v_ready, 'full', v_full, 'overfilled', false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.diaspora_approve_cargo_reservation_atomic(uuid, text, boolean, text, uuid) FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_approve_cargo_reservation_atomic(uuid, text, boolean, text, uuid) TO service_role;
  END IF;
END;
$grant$;

-- +migrate Down
DROP FUNCTION IF EXISTS public.diaspora_approve_cargo_reservation_atomic(uuid, text, boolean, text, uuid);
