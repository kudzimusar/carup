-- +migrate Up
-- =============================================================
-- Trade OS T11-CAP-05 — shipment observations, and the history of estimate revisions.
--
-- An observation is something a provider or an operator SAYS about a shipment: a revised estimate, a
-- port event, a position. It is an INPUT, not a fact CarUp has verified, and it must never be able to
-- rewrite the shipment. So this is append-only evidence with a small, closed state machine:
--
--     RECEIVED  ──►  ACCEPTED  ──►  SUPERSEDED
--        └────────►  REJECTED
--
-- What was observed — the provider, its event id, the kind, the time, the content — can never change
-- once recorded. Only the decision about it can, once. An accepted observation is never edited or
-- deleted; a later one supersedes it and the history stays.
--
-- What it does NOT do. It has no foreign key to the movement timeline and writes nothing to
-- `diaspora_shipments`. T11 remains the only authority for what a shipment is doing, and for its own
-- recorded estimate; an accepted ESTIMATE REVISION is shown BESIDE that estimate (current vs original),
-- never written over it.
--
-- Idempotency is a constraint, not a hope: one provider event can be recorded once.
--
-- Additive: no existing table or column is touched.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.diaspora_shipment_observations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  shipment_id        UUID NOT NULL REFERENCES public.diaspora_shipments(id) ON DELETE CASCADE,
  leg_id             UUID REFERENCES public.diaspora_shipment_legs(id) ON DELETE SET NULL,
  provider_id        TEXT NOT NULL,
  provider_event_id  TEXT NOT NULL,
  kind               TEXT NOT NULL,
  observed_at        TIMESTAMPTZ NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_reference   TEXT,
  status             TEXT NOT NULL DEFAULT 'RECEIVED',
  decided_by         TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  decision_reason    TEXT,
  created_by         TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT diaspora_shipment_observations_kind_chk CHECK (
    kind IN ('ETA_REVISION', 'VESSEL_IDENTITY', 'SCHEDULE', 'PORT_EVENT', 'AIS_POSITION', 'EXCEPTION')
  ),
  CONSTRAINT diaspora_shipment_observations_status_chk CHECK (
    status IN ('RECEIVED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')
  ),
  -- A decision is made once, by someone, when an observation leaves RECEIVED — and only then.
  CONSTRAINT diaspora_shipment_observations_decision_chk CHECK (
    (status = 'RECEIVED' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status <> 'RECEIVED' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  ),
  -- An estimate revision must carry an estimate. COALESCE matters: jsonb_typeof of a MISSING key is
  -- NULL, and a CHECK that evaluates to NULL passes — which would let a revision with no date through.
  CONSTRAINT diaspora_shipment_observations_eta_payload_chk CHECK (
    kind <> 'ETA_REVISION' OR COALESCE(jsonb_typeof(payload -> 'estimated_arrival'), '') = 'string'
  ),
  CONSTRAINT diaspora_shipment_observations_source_reference_chk CHECK (
    source_reference IS NULL OR char_length(source_reference) <= 500
  ),
  -- One provider event is recorded once. The same event id from a different provider is a different event.
  CONSTRAINT uq_shipment_observation_provider_event UNIQUE (provider_id, provider_event_id)
);

-- The current estimate is read from the latest accepted revision of a shipment.
CREATE INDEX IF NOT EXISTS idx_shipment_observations_eta
  ON public.diaspora_shipment_observations (shipment_id, observed_at)
  WHERE kind = 'ETA_REVISION' AND status IN ('ACCEPTED', 'SUPERSEDED');

CREATE OR REPLACE FUNCTION public.carup_shipment_observation_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shipment_id       IS DISTINCT FROM OLD.shipment_id
     OR NEW.leg_id            IS DISTINCT FROM OLD.leg_id
     OR NEW.provider_id       IS DISTINCT FROM OLD.provider_id
     OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     OR NEW.kind              IS DISTINCT FROM OLD.kind
     OR NEW.observed_at       IS DISTINCT FROM OLD.observed_at
     OR NEW.received_at       IS DISTINCT FROM OLD.received_at
     OR NEW.payload           IS DISTINCT FROM OLD.payload
     OR NEW.source_reference  IS DISTINCT FROM OLD.source_reference
     OR NEW.created_by        IS DISTINCT FROM OLD.created_by
     OR NEW.created_at        IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'diaspora_shipment_observations is append-only: what was observed, by whom, and when it was recorded cannot be rewritten (immutable). Record a new observation instead.';
  END IF;

  -- The decision is made once. After it, who decided and why are part of the record.
  IF OLD.status <> 'RECEIVED'
     AND (NEW.decided_by IS DISTINCT FROM OLD.decided_by
          OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
          OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason) THEN
    RAISE EXCEPTION
      'diaspora_shipment_observations: a decision cannot be rewritten once made (immutable).';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'RECEIVED' AND NEW.status IN ('ACCEPTED', 'REJECTED'))
              OR (OLD.status = 'ACCEPTED' AND NEW.status = 'SUPERSEDED')) THEN
    RAISE EXCEPTION
      'diaspora_shipment_observations: % -> % is not a permitted status transition.', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipment_observation_guard ON public.diaspora_shipment_observations;
CREATE TRIGGER trg_shipment_observation_guard
  BEFORE UPDATE ON public.diaspora_shipment_observations
  FOR EACH ROW EXECUTE FUNCTION public.carup_shipment_observation_guard();

-- Evidence is not erasable. A mistaken observation is superseded by a later one, and the history stays.
CREATE OR REPLACE FUNCTION public.carup_shipment_observation_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'diaspora_shipment_observations cannot be deleted: evidence that can be erased is not evidence. Supersede an observation with a later one.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipment_observation_no_delete ON public.diaspora_shipment_observations;
CREATE TRIGGER trg_shipment_observation_no_delete
  BEFORE DELETE ON public.diaspora_shipment_observations
  FOR EACH ROW EXECUTE FUNCTION public.carup_shipment_observation_no_delete();

-- The browser cannot reach the table at all; the triggers above are the second line.
ALTER TABLE public.diaspora_shipment_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_shipment_observations FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.diaspora_shipment_observations FROM anon, authenticated;

COMMENT ON TABLE public.diaspora_shipment_observations IS
  'T11-CAP-05 observations and estimate-revision history. INPUTS, not verified facts: append-only, '
  'idempotent per (provider, event id), with a closed RECEIVED/ACCEPTED/REJECTED/SUPERSEDED machine. '
  'Writes nothing to diaspora_shipments and has no link to the movement timeline — T11 stays the only '
  'authority for movement and for its own recorded estimate.';

-- +migrate Down
DROP TRIGGER IF EXISTS trg_shipment_observation_no_delete ON public.diaspora_shipment_observations;
DROP TRIGGER IF EXISTS trg_shipment_observation_guard ON public.diaspora_shipment_observations;
DROP FUNCTION IF EXISTS public.carup_shipment_observation_no_delete();
DROP FUNCTION IF EXISTS public.carup_shipment_observation_guard();
DROP TABLE IF EXISTS public.diaspora_shipment_observations;
