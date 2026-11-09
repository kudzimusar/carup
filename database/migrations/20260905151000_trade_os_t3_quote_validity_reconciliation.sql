-- +migrate Up
-- T3 follow-up: the UI captures `valid_until` as a calendar date, not a timestamp.
-- Treat that date as inclusive and refuse an already-past date at submission as well as award.
-- This replaces only the guard function installed by 20260905150000; the trigger keeps pointing at
-- the same function name. Production remains separately owner-authorized.

CREATE OR REPLACE FUNCTION public.guard_diaspora_logistics_quote_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today_utc date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.service_mode IS DISTINCT FROM OLD.service_mode
       OR NEW.compatible_container_id IS DISTINCT FROM OLD.compatible_container_id
       OR NEW.freight_amount IS DISTINCT FROM OLD.freight_amount
       OR NEW.handling_amount IS DISTINCT FROM OLD.handling_amount
       OR NEW.origin_charges IS DISTINCT FROM OLD.origin_charges
       OR NEW.destination_charges IS DISTINCT FROM OLD.destination_charges
       OR NEW.documentation_fees IS DISTINCT FROM OLD.documentation_fees
       OR NEW.optional_services IS DISTINCT FROM OLD.optional_services
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.transit_days IS DISTINCT FROM OLD.transit_days
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.pickup_included IS DISTINCT FROM OLD.pickup_included
       OR NEW.delivery_included IS DISTINCT FROM OLD.delivery_included
       OR NEW.inclusions IS DISTINCT FROM OLD.inclusions
       OR NEW.exclusions IS DISTINCT FROM OLD.exclusions
       OR NEW.conditions IS DISTINCT FROM OLD.conditions
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.provider_tenant_id IS DISTINCT FROM OLD.provider_tenant_id
       OR NEW.logistics_request_id IS DISTINCT FROM OLD.logistics_request_id
    THEN
      RAISE EXCEPTION 'DIASPORA_LOGISTICS/IMMUTABLE_SUBMITTED_QUOTE';
    END IF;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'SUBMITTED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/INVALID_QUOTE_TRANSITION';
  ELSIF OLD.status = 'SUBMITTED' AND NEW.status NOT IN ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED') THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/INVALID_QUOTE_TRANSITION';
  ELSIF OLD.status IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/TERMINAL_QUOTE_STATE';
  END IF;

  IF OLD.status = 'DRAFT'
     AND NEW.status = 'SUBMITTED'
     AND NEW.valid_until IS NOT NULL
     AND NEW.valid_until::date < v_today_utc
  THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/EXPIRED';
  END IF;

  IF OLD.status = 'SUBMITTED'
     AND NEW.status = 'ACCEPTED'
     AND OLD.valid_until IS NOT NULL
     AND OLD.valid_until::date < v_today_utc
  THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/EXPIRED';
  END IF;

  RETURN NEW;
END;
$$;

-- +migrate Down
-- Deliberately no destructive rollback body: this migration tightens the guard semantics installed
-- immediately before it, and reverting to the timestamp-midnight interpretation would reintroduce
-- the defect. A future rollback must replace the function with a deliberately reviewed definition.
