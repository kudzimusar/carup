-- +migrate Up
-- =============================================================
-- Trade OS T11-CAP-04 — shipment legs: which vessel, on which voyage, between which ports.
--
-- CarUp's shipment record carries one carrier, one origin port and one destination port. It has
-- nowhere to say WHICH VESSEL, nor to represent a journey that changes vessel. This adds that, and
-- only that: an ordered list of DECLARED legs under a shipment. A single-vessel journey is one leg.
--
-- What a leg is NOT. It is not a record that anything sailed or arrived. Movement belongs to T11
-- alone — the shipment's observed departure and arrival and its append-only timeline — and a second
-- place to assert "it sailed" would be a second lifecycle that could disagree with the first. So this
-- table deliberately has NO observed/actual/status column of any kind; a test enforces that
-- structurally. Per-leg observed movement, if it is ever needed, enters through an observation that
-- T11 accepts (CAP-05) rather than through a column here.
--
-- What may change. The plan fields (vessel, voyage, ports, planned departure, estimated arrival) can
-- be corrected, attributed through the audit log. What cannot: which journey a leg belongs to, its
-- position in that journey, who declared it, and when. To change those, supersede the leg
-- (`deleted_at`) and declare a new one — the same correction path T8, T9 and the T11 timeline use.
--
-- Additive: no existing table or column is touched.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.diaspora_shipment_legs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  shipment_id             UUID NOT NULL REFERENCES public.diaspora_shipments(id) ON DELETE CASCADE,
  leg_sequence            INTEGER NOT NULL,
  carrier_name            TEXT,
  vessel_name             TEXT,
  voyage_ref              TEXT,
  imo                     TEXT,
  mmsi                    TEXT,
  port_of_loading         TEXT,
  port_of_discharge       TEXT,
  planned_departure_date  TIMESTAMPTZ,
  estimated_arrival_date  TIMESTAMPTZ,
  source                  TEXT NOT NULL DEFAULT 'OPERATOR_DECLARED',
  source_reference        TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by              TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by              TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,

  CONSTRAINT diaspora_shipment_legs_sequence_chk CHECK (leg_sequence >= 1),
  -- An IMO number is seven digits. (The check digit is validated by the service; the database
  -- refuses anything that is not even shaped like one.)
  CONSTRAINT diaspora_shipment_legs_imo_chk CHECK (imo IS NULL OR imo ~ '^[0-9]{7}$'),
  CONSTRAINT diaspora_shipment_legs_mmsi_chk CHECK (mmsi IS NULL OR mmsi ~ '^[0-9]{9}$'),
  -- Where the declaration came from. A new kind of source is a deliberate migration, not a free string.
  CONSTRAINT diaspora_shipment_legs_source_chk CHECK (source IN ('OPERATOR_DECLARED', 'DOCUMENT', 'CARRIER', 'PROVIDER')),
  CONSTRAINT diaspora_shipment_legs_source_reference_chk CHECK (source_reference IS NULL OR char_length(source_reference) <= 500),
  -- A leg that identifies nothing is not a leg.
  CONSTRAINT diaspora_shipment_legs_identify_chk CHECK (
    NULLIF(btrim(vessel_name), '') IS NOT NULL
    OR NULLIF(btrim(carrier_name), '') IS NOT NULL
    OR NULLIF(btrim(port_of_loading), '') IS NOT NULL
    OR NULLIF(btrim(port_of_discharge), '') IS NOT NULL
  )
);

-- One live leg per position in a journey. A superseded leg keeps its row and frees its position.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_leg_live_sequence
  ON public.diaspora_shipment_legs (shipment_id, leg_sequence)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shipment_legs_shipment
  ON public.diaspora_shipment_legs (shipment_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.carup_shipment_leg_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shipment_id  IS DISTINCT FROM OLD.shipment_id
     OR NEW.leg_sequence IS DISTINCT FROM OLD.leg_sequence
     OR NEW.created_by   IS DISTINCT FROM OLD.created_by
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'diaspora_shipment_legs: a leg cannot be moved to another journey, re-ordered, or have its author or declaration time rewritten (immutable). Supersede it with a new leg instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipment_leg_guard ON public.diaspora_shipment_legs;
CREATE TRIGGER trg_shipment_leg_guard
  BEFORE UPDATE ON public.diaspora_shipment_legs
  FOR EACH ROW EXECUTE FUNCTION public.carup_shipment_leg_guard();

-- A DELETE erases the declaration entirely, which no correction ever needs. Soft-delete via
-- `deleted_at` stays available and stays attributable.
CREATE OR REPLACE FUNCTION public.carup_shipment_leg_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'diaspora_shipment_legs cannot be deleted: a journey whose legs can be erased cannot be audited. Set deleted_at to supersede a leg.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipment_leg_no_delete ON public.diaspora_shipment_legs;
CREATE TRIGGER trg_shipment_leg_no_delete
  BEFORE DELETE ON public.diaspora_shipment_legs
  FOR EACH ROW EXECUTE FUNCTION public.carup_shipment_leg_no_delete();

-- The browser cannot reach the table at all; the triggers above are the second line. Same posture as
-- every table T9, T10 and T11 created.
ALTER TABLE public.diaspora_shipment_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_shipment_legs FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.diaspora_shipment_legs FROM anon, authenticated;

COMMENT ON TABLE public.diaspora_shipment_legs IS
  'T11-CAP-04 declared vessel/route legs under a shipment. DECLARED, not observed: no column here can '
  'assert that anything sailed or arrived — movement is T11''s alone. Plan fields are correctable; '
  'shipment, position, author and declaration time are immutable (supersede, do not edit).';

-- +migrate Down
DROP TRIGGER IF EXISTS trg_shipment_leg_no_delete ON public.diaspora_shipment_legs;
DROP TRIGGER IF EXISTS trg_shipment_leg_guard ON public.diaspora_shipment_legs;
DROP FUNCTION IF EXISTS public.carup_shipment_leg_no_delete();
DROP FUNCTION IF EXISTS public.carup_shipment_leg_guard();
DROP TABLE IF EXISTS public.diaspora_shipment_legs;
