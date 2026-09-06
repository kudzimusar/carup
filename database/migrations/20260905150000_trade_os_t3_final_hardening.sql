-- +migrate Up
-- =============================================================
-- CarUp Trade OS T3 — final adversarial hardening
--
-- Forward-only reconciliation for defects found after the first T3 staging
-- certification. Production activation remains separately owner-authorized.
--
-- 1) Quote commercial terms become immutable once an offer leaves DRAFT.
--    This closes a stale edit/withdraw race against the atomic award RPC.
-- 2) An expired SUBMITTED offer cannot transition to ACCEPTED.
-- 3) One logistics request may have at most one live REQUESTED/APPROVED
--    container reservation, closing a concurrent request-space duplication race.
-- =============================================================

CREATE OR REPLACE FUNCTION public.guard_diaspora_logistics_quote_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Once submitted, commercial terms are frozen. The only legitimate changes
  -- are lifecycle transitions made by the provider or the atomic award RPC.
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

  -- Lifecycle graph. In particular, ACCEPTED can never be overwritten by a
  -- provider withdrawal that started from a stale SUBMITTED read.
  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'SUBMITTED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/INVALID_QUOTE_TRANSITION';
  ELSIF OLD.status = 'SUBMITTED' AND NEW.status NOT IN ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED') THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/INVALID_QUOTE_TRANSITION';
  ELSIF OLD.status IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/TERMINAL_QUOTE_STATE';
  END IF;

  -- Validity is an authoritative commercial boundary. A quote that has passed
  -- its stated validity time may remain recorded as SUBMITTED for history, but
  -- it cannot become the awarded offer.
  IF OLD.status = 'SUBMITTED'
     AND NEW.status = 'ACCEPTED'
     AND OLD.valid_until IS NOT NULL
     AND OLD.valid_until <= now()
  THEN
    RAISE EXCEPTION 'DIASPORA_LOGISTICS/EXPIRED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_diaspora_logistics_quote_transition
  ON public.diaspora_logistics_quotes;
CREATE TRIGGER trg_guard_diaspora_logistics_quote_transition
BEFORE UPDATE ON public.diaspora_logistics_quotes
FOR EACH ROW
EXECUTE FUNCTION public.guard_diaspora_logistics_quote_transition();

-- The request-space service already performs an idempotent read-before-write,
-- but two simultaneous calls could both observe no row and insert duplicates.
-- The database is the final authority: at most one LIVE reservation can exist
-- for one logistics request. Rejected/cancelled rows deliberately do not block
-- a later legitimate retry.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_cargo_reservation_live_logistics_request
  ON public.diaspora_cargo_reservations ((metadata->>'logistics_request_id'))
  WHERE deleted_at IS NULL
    AND reservation_status IN ('REQUESTED', 'APPROVED')
    AND COALESCE(metadata->>'logistics_request_id', '') <> '';

-- +migrate Down
DROP INDEX IF EXISTS public.uq_diaspora_cargo_reservation_live_logistics_request;
DROP TRIGGER IF EXISTS trg_guard_diaspora_logistics_quote_transition
  ON public.diaspora_logistics_quotes;
DROP FUNCTION IF EXISTS public.guard_diaspora_logistics_quote_transition();
