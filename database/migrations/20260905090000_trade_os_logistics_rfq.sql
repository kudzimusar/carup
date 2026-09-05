-- +migrate Up
-- =============================================================
-- CarUp Trade OS T3 — Logistics RFQ / "Ship something"
--
-- Procurement demand (`diaspora_import_orders`) answers "I need to buy/find
-- something". A logistics request answers the different question "I already
-- own/bought cargo and need to move it". These tables deliberately keep those
-- authorities separate while allowing an awarded logistics offer to reference
-- a real co-loading container.
--
-- Production activation is NOT authorized by this migration being present in
-- the repository. The Trade OS programme applies new schema to staging first.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.diaspora_logistics_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  requester_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  origin_country TEXT NOT NULL,
  origin_city TEXT,
  origin_location TEXT,
  destination_country TEXT NOT NULL,
  destination_city TEXT,
  destination_location TEXT,
  needed_by TIMESTAMPTZ,
  service_preference TEXT NOT NULL DEFAULT 'flexible' CHECK (
    service_preference IN ('flexible', 'port_to_port', 'door_to_port', 'port_to_door', 'door_to_door')
  ),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'OPEN_FOR_QUOTES', 'AWARDED', 'CLOSED', 'CANCELLED')
  ),
  accepted_quote_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.diaspora_logistics_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logistics_request_id UUID NOT NULL REFERENCES public.diaspora_logistics_requests(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  cargo_category TEXT NOT NULL CHECK (
    cargo_category IN (
      'vehicle', 'parts', 'household', 'furniture_appliances', 'boxes',
      'machinery_equipment', 'pallet_crate', 'general', 'other'
    )
  ),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  length_value NUMERIC(12, 3),
  width_value NUMERIC(12, 3),
  height_value NUMERIC(12, 3),
  dimension_unit TEXT CHECK (dimension_unit IS NULL OR dimension_unit IN ('cm', 'm')),
  estimated_volume_cbm NUMERIC(12, 3) CHECK (estimated_volume_cbm IS NULL OR estimated_volume_cbm > 0),
  estimated_weight_kg NUMERIC(12, 3) CHECK (estimated_weight_kg IS NULL OR estimated_weight_kg > 0),
  measurement_basis TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (
    measurement_basis IN ('CALCULATED', 'PROVIDED', 'UNKNOWN')
  ),
  linked_vehicle_vin TEXT REFERENCES public.vehicles(vin) ON DELETE SET NULL,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(logistics_request_id, line_number)
);

CREATE TABLE IF NOT EXISTS public.diaspora_logistics_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logistics_request_id UUID NOT NULL REFERENCES public.diaspora_logistics_requests(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  service_mode TEXT NOT NULL DEFAULT 'other' CHECK (
    service_mode IN ('shared_container', 'lcl', 'fcl', 'road', 'multimodal', 'other')
  ),
  compatible_container_id UUID REFERENCES public.diaspora_container_shipments(id) ON DELETE SET NULL,
  freight_amount NUMERIC(12, 2) CHECK (freight_amount IS NULL OR freight_amount >= 0),
  handling_amount NUMERIC(12, 2) CHECK (handling_amount IS NULL OR handling_amount >= 0),
  origin_charges NUMERIC(12, 2) CHECK (origin_charges IS NULL OR origin_charges >= 0),
  destination_charges NUMERIC(12, 2) CHECK (destination_charges IS NULL OR destination_charges >= 0),
  documentation_fees NUMERIC(12, 2) CHECK (documentation_fees IS NULL OR documentation_fees >= 0),
  optional_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  transit_days INTEGER CHECK (transit_days IS NULL OR transit_days > 0),
  valid_until TIMESTAMPTZ,
  pickup_included BOOLEAN,
  delivery_included BOOLEAN,
  inclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
  conditions TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED')
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE public.diaspora_logistics_requests
  DROP CONSTRAINT IF EXISTS diaspora_logistics_requests_accepted_quote_fk;
ALTER TABLE public.diaspora_logistics_requests
  ADD CONSTRAINT diaspora_logistics_requests_accepted_quote_fk
  FOREIGN KEY (accepted_quote_id) REFERENCES public.diaspora_logistics_quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_diaspora_logistics_requests_requester
  ON public.diaspora_logistics_requests(requester_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_diaspora_logistics_requests_marketplace
  ON public.diaspora_logistics_requests(status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_diaspora_logistics_items_request
  ON public.diaspora_logistics_request_items(logistics_request_id, line_number)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_diaspora_logistics_quotes_request
  ON public.diaspora_logistics_quotes(logistics_request_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_diaspora_logistics_quotes_provider
  ON public.diaspora_logistics_quotes(provider_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Atomic award: one selected submitted logistics quote, sibling offers rejected,
-- request stamped AWARDED, and critical audit written in the same transaction.
CREATE OR REPLACE FUNCTION public.diaspora_accept_logistics_quote_atomic(
  p_request_id uuid,
  p_quote_id uuid,
  p_actor_id text,
  p_actor_is_privileged boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.diaspora_logistics_requests%ROWTYPE;
  v_quote public.diaspora_logistics_quotes%ROWTYPE;
  v_seal text;
  v_ts timestamptz := now();
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/UNAUTHENTICATED';
  END IF;

  SELECT * INTO v_request
    FROM public.diaspora_logistics_requests
    WHERE id = p_request_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_LOGISTICS/NOT_FOUND_REQUEST'; END IF;

  IF NOT (p_actor_is_privileged OR v_request.requester_id = p_actor_id OR v_request.created_by = p_actor_id) THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/FORBIDDEN';
  END IF;

  IF v_request.accepted_quote_id IS NOT NULL THEN
    IF v_request.accepted_quote_id = p_quote_id THEN
      SELECT * INTO v_quote FROM public.diaspora_logistics_quotes WHERE id = p_quote_id;
      RETURN jsonb_build_object('request', to_jsonb(v_request), 'acceptedQuote', to_jsonb(v_quote), 'idempotentReplay', true);
    END IF;
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/ALREADY_ACCEPTED_DIFFERENT';
  END IF;

  SELECT * INTO v_quote
    FROM public.diaspora_logistics_quotes
    WHERE id = p_quote_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIASPORA_LOGISTICS/NOT_FOUND_QUOTE'; END IF;
  IF v_quote.logistics_request_id <> p_request_id THEN RAISE EXCEPTION 'DIASPORA_LOGISTICS/QUOTE_NOT_IN_REQUEST'; END IF;
  IF v_quote.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'DIASPORA_LOGISTICS/NOT_SUBMITTED'; END IF;
  IF v_quote.provider_id = p_actor_id THEN RAISE EXCEPTION 'DIASPORA_LOGISTICS/SELF_AWARD'; END IF;

  UPDATE public.diaspora_logistics_quotes
    SET status = 'ACCEPTED', updated_by = p_actor_id, updated_at = v_ts
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

  UPDATE public.diaspora_logistics_quotes
    SET status = 'REJECTED', updated_by = p_actor_id, updated_at = v_ts
    WHERE logistics_request_id = p_request_id
      AND id <> p_quote_id
      AND status = 'SUBMITTED'
      AND deleted_at IS NULL;

  UPDATE public.diaspora_logistics_requests
    SET accepted_quote_id = p_quote_id,
        status = 'AWARDED',
        updated_by = p_actor_id,
        updated_at = v_ts
    WHERE id = p_request_id
    RETURNING * INTO v_request;

  v_seal := encode(digest(
    COALESCE(p_actor_id, 'system') || '|LOGISTICS_QUOTE_ACCEPTED|diaspora_logistics_quote|'
      || p_quote_id::text || '|' || v_ts::text,
    'sha256'), 'hex');

  INSERT INTO public.diaspora_import_audit_log (
    import_order_id, tenant_id, actor_id, action, resource_type, resource_id,
    previous_state, new_state, metadata, cryptographic_seal
  ) VALUES (
    NULL, v_request.tenant_id, p_actor_id, 'LOGISTICS_QUOTE_ACCEPTED',
    'diaspora_logistics_quote', p_quote_id::text, NULL, to_jsonb(v_quote),
    jsonb_build_object('logisticsRequestId', p_request_id::text), v_seal
  );

  RETURN jsonb_build_object('request', to_jsonb(v_request), 'acceptedQuote', to_jsonb(v_quote), 'idempotentReplay', false);
END;
$$;

-- Backend-only, exactly like the sibling atomic mutation RPCs. Supabase applies direct EXECUTE
-- grants to the API roles on a NEW function, so revoking PUBLIC alone leaves anon and
-- authenticated able to call it — measured on staging, where this function came out with
-- anon EXECUTE true while diaspora_accept_quote_atomic and
-- diaspora_approve_cargo_reservation_atomic were both false. The named revokes below are the
-- canonical fix from 20260621094000_diaspora_h7_rpc_execute_grants.sql.
REVOKE ALL ON FUNCTION public.diaspora_accept_logistics_quote_atomic(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diaspora_accept_logistics_quote_atomic(uuid, uuid, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.diaspora_accept_logistics_quote_atomic(uuid, uuid, text, boolean) FROM authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.diaspora_accept_logistics_quote_atomic(uuid, uuid, text, boolean) TO service_role;
  END IF;
END;
$grant$;

-- Row Level Security. Every sibling Diaspora trade table has carried RLS since
-- 013_diaspora_trade_schema.sql; these three were created without it, which would have left the
-- whole logistics demand book — requester ids, tenant ids and linked vehicle VINs — readable with
-- the anon key. That is exactly the exposure the T3 marketplace projection exists to prevent at
-- the API layer, so leaving the table itself open would have made that projection decorative.
--
-- Only the platform-admin policy from the sibling convention is created. CarUp authenticates
-- through its own backend rather than Supabase Auth, so `auth.uid()` is never populated for an
-- ordinary CarUp user; owner-scoped policies keyed on it could never match and would be
-- misleading rather than protective. With RLS on and no such policy, direct anon/authenticated
-- access reads nothing, and every legitimate read continues to arrive through the service_role
-- backend, which applies the authorization these tables are actually governed by.
ALTER TABLE public.diaspora_logistics_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_logistics_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_logistics_quotes ENABLE ROW LEVEL SECURITY;

DO $rls$
DECLARE
  target TEXT;
BEGIN
  IF to_regprocedure('public.is_diaspora_platform_admin()') IS NULL THEN
    RAISE NOTICE 'is_diaspora_platform_admin() absent; RLS stays enabled with no policy (deny-all to anon).';
    RETURN;
  END IF;
  FOREACH target IN ARRAY ARRAY[
    'diaspora_logistics_requests',
    'diaspora_logistics_request_items',
    'diaspora_logistics_quotes'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS diaspora_platform_admin_access ON public.%I', target);
    EXECUTE format(
      'CREATE POLICY diaspora_platform_admin_access ON public.%I FOR ALL USING (is_diaspora_platform_admin()) WITH CHECK (is_diaspora_platform_admin())',
      target);
  END LOOP;
END;
$rls$;

-- +migrate Down
DROP FUNCTION IF EXISTS public.diaspora_accept_logistics_quote_atomic(uuid, uuid, text, boolean);
ALTER TABLE IF EXISTS public.diaspora_logistics_requests
  DROP CONSTRAINT IF EXISTS diaspora_logistics_requests_accepted_quote_fk;
DROP TABLE IF EXISTS public.diaspora_logistics_quotes;
DROP TABLE IF EXISTS public.diaspora_logistics_request_items;
DROP TABLE IF EXISTS public.diaspora_logistics_requests;
