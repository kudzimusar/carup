-- +migrate Up
-- OC-5A (RC1 residual finding A) — a work order becomes a GOVERNED service relationship.
--
-- `POST /api/mechanic/work-orders` lets any mechanic with a tenant context open a work order on any
-- existing VIN, naming themselves as the mechanic. Until OC-5A, that self-issued row was enough to write
-- the vehicle's repair ledger AND its canonical odometer. A relationship the mechanic can grant
-- themselves is not a relationship.
--
-- The vehicle's custodian now decides: its registered owner, or — for a dealership-held vehicle with
-- no registered owner — a governed dealer of that dealership (dealerListingAuthority). The decision is
-- made through ONE function, which locks the work order, refuses self-authorization, and writes the
-- trust_audit_events record in the same transaction as the decision, so a decision never stands
-- unaudited and an audit never records a decision that did not happen.
--
-- Existing work orders start 'pending': none of them was ever authorized by anyone, so none of them
-- keeps service authority until the custodian grants it. That is the fail-closed reading of rows that
-- were self-issued.
--
-- Preconditions: mechanic_work_orders (009 / 20260808150000 convergence), vehicles.owner_id
-- (010_phase5_schema.sql), trust_audit_events (20260603233640).

DO $$
BEGIN
  IF to_regclass('public.mechanic_work_orders') IS NULL THEN
    RAISE EXCEPTION 'mechanic_work_orders is absent: 009_phase4_schema.sql must be applied first';
  END IF;
  IF to_regclass('public.trust_audit_events') IS NULL THEN
    RAISE EXCEPTION 'trust_audit_events is absent: 20260603233640 must be applied first';
  END IF;
END $$;

-- Both historical shapes (006 and 009) converge here; neither column below is added if present.
ALTER TABLE public.mechanic_work_orders ADD COLUMN IF NOT EXISTS mechanic_id TEXT;
ALTER TABLE public.mechanic_work_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.mechanic_work_orders ADD COLUMN IF NOT EXISTS owner_authorization TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.mechanic_work_orders ADD COLUMN IF NOT EXISTS owner_authorized_by TEXT;
ALTER TABLE public.mechanic_work_orders ADD COLUMN IF NOT EXISTS owner_authorized_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mechanic_work_orders_owner_authorization_check'
                   AND conrelid = 'public.mechanic_work_orders'::regclass) THEN
    ALTER TABLE public.mechanic_work_orders ADD CONSTRAINT mechanic_work_orders_owner_authorization_check
      CHECK (owner_authorization IN ('pending', 'authorized', 'declined', 'revoked'));
  END IF;
  -- A decision names who made it and when; 'pending' names nobody.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mechanic_work_orders_owner_authorization_provenance'
                   AND conrelid = 'public.mechanic_work_orders'::regclass) THEN
    ALTER TABLE public.mechanic_work_orders ADD CONSTRAINT mechanic_work_orders_owner_authorization_provenance
      CHECK ((owner_authorization = 'pending') = (owner_authorized_by IS NULL AND owner_authorized_at IS NULL));
  END IF;
  -- The mechanic assigned to the work can never be the one who authorized it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mechanic_work_orders_no_self_authorization'
                   AND conrelid = 'public.mechanic_work_orders'::regclass) THEN
    ALTER TABLE public.mechanic_work_orders ADD CONSTRAINT mechanic_work_orders_no_self_authorization
      CHECK (owner_authorized_by IS NULL OR mechanic_id IS NULL OR owner_authorized_by <> mechanic_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mechanic_work_orders_vin_mechanic ON public.mechanic_work_orders (vin, mechanic_id);

COMMENT ON COLUMN public.mechanic_work_orders.owner_authorization IS
  'The vehicle custodian''s decision on this work order (pending | authorized | declined | revoked). Only an '
  'authorized, open work order is a service relationship (backend/services/partsentry/partsentryServiceAuthority.js). '
  'Changed only through mechanic_work_order_decide_authorization().';

-- p_basis says WHY the actor may decide: 'owner' is re-proven here, under the lock, against
-- vehicles.owner_id; 'dealer' and 'platform' were proven by the caller's governed check (Dealer
-- authority needs its own reads) and are recorded as the basis in the audit row.
CREATE OR REPLACE FUNCTION public.mechanic_work_order_decide_authorization(
  p_work_order_id UUID,
  p_vin TEXT,
  p_actor_id TEXT,
  p_actor_role TEXT,
  p_actor_tenant_id TEXT,
  p_basis TEXT,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.mechanic_work_orders%ROWTYPE;
  v_owner TEXT;
  v_previous TEXT;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('authorized', 'declined', 'revoked') THEN
    RAISE EXCEPTION 'work order authorization: % is not a decision', coalesce(p_decision, 'NULL') USING ERRCODE = '22023';
  END IF;
  IF p_basis IS NULL OR p_basis NOT IN ('owner', 'dealer', 'platform') THEN
    RAISE EXCEPTION 'work order authorization: % is not a decision basis', coalesce(p_basis, 'NULL') USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'work order authorization requires an actor' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.mechanic_work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.vin IS DISTINCT FROM p_vin THEN
    RAISE EXCEPTION 'work order not found for this vehicle' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.mechanic_id IS NOT NULL AND v_order.mechanic_id = p_actor_id THEN
    RAISE EXCEPTION 'the mechanic assigned to a work order cannot authorize it' USING ERRCODE = '42501';
  END IF;
  IF p_basis = 'owner' THEN
    SELECT owner_id INTO v_owner FROM public.vehicles WHERE vin = p_vin FOR SHARE;
    IF v_owner IS NULL OR v_owner <> p_actor_id THEN
      RAISE EXCEPTION 'only the registered owner may decide on the owner''s basis' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_previous := v_order.owner_authorization;
  -- pending → authorized | declined; authorized → revoked; declined → authorized (the owner changed
  -- their mind before any work). A revoked order is final: new work needs a new work order.
  IF NOT ((v_previous = 'pending' AND p_decision IN ('authorized', 'declined'))
       OR (v_previous = 'authorized' AND p_decision = 'revoked')
       OR (v_previous = 'declined' AND p_decision = 'authorized')) THEN
    RAISE EXCEPTION 'work order authorization cannot move from % to %', v_previous, p_decision USING ERRCODE = '55000';
  END IF;

  UPDATE public.mechanic_work_orders
     SET owner_authorization = p_decision,
         owner_authorized_by = p_actor_id,
         owner_authorized_at = now(),
         updated_at = now()
   WHERE id = p_work_order_id
  RETURNING * INTO v_order;

  INSERT INTO public.trust_audit_events
    (event_type, vin, trust_fact, previous_value, new_value, actor_user_id, actor_role, actor_tenant_id, actor_type, source_route, reason)
  VALUES
    ('WORK_ORDER_OWNER_AUTHORIZATION', p_vin, 'service_relationship',
     jsonb_build_object('work_order_id', p_work_order_id, 'owner_authorization', v_previous),
     jsonb_build_object('work_order_id', p_work_order_id, 'owner_authorization', p_decision, 'basis', p_basis,
                        'mechanic_id', v_order.mechanic_id, 'tenant_id', v_order.tenant_id),
     p_actor_id, p_actor_role, p_actor_tenant_id, 'user', '/api/vehicles/:vin/work-orders/:id/authorization', p_reason);

  RETURN jsonb_build_object(
    'id', v_order.id, 'vin', v_order.vin, 'tenant_id', v_order.tenant_id, 'mechanic_id', v_order.mechanic_id,
    'status', v_order.status, 'owner_authorization', v_order.owner_authorization,
    'owner_authorized_by', v_order.owner_authorized_by, 'owner_authorized_at', v_order.owner_authorized_at,
    'previous_owner_authorization', v_previous);
END;
$$;

REVOKE ALL ON FUNCTION public.mechanic_work_order_decide_authorization(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.mechanic_work_order_decide_authorization(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.mechanic_work_order_decide_authorization(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.mechanic_work_order_decide_authorization(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role';
  END IF;
END $$;

-- +migrate Down
DROP FUNCTION IF EXISTS public.mechanic_work_order_decide_authorization(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP INDEX IF EXISTS public.idx_mechanic_work_orders_vin_mechanic;
ALTER TABLE public.mechanic_work_orders DROP CONSTRAINT IF EXISTS mechanic_work_orders_no_self_authorization;
ALTER TABLE public.mechanic_work_orders DROP CONSTRAINT IF EXISTS mechanic_work_orders_owner_authorization_provenance;
ALTER TABLE public.mechanic_work_orders DROP CONSTRAINT IF EXISTS mechanic_work_orders_owner_authorization_check;
ALTER TABLE public.mechanic_work_orders DROP COLUMN IF EXISTS owner_authorized_at;
ALTER TABLE public.mechanic_work_orders DROP COLUMN IF EXISTS owner_authorized_by;
ALTER TABLE public.mechanic_work_orders DROP COLUMN IF EXISTS owner_authorization;
