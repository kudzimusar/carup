-- +migrate Up
-- =============================================================
-- Trade OS T11.1 — the movement timeline is append-only STRUCTURALLY, not by convention.
--
-- The T11.0 audit found that nothing in the codebase updates or deletes a stage event — which is a
-- statement about today's callers, not a property of the data. A timeline whose immutability depends
-- on everybody continuing to behave is one that will eventually be rewritten by somebody fixing a
-- typo, and a movement history that can be edited afterwards is not evidence of anything.
--
-- This reuses the guard pattern already established in the repository (`carup_report_version_guard`
-- on `report_versions`) rather than inventing a competing ledger.
--
-- What may still change: `deleted_at` and `updated_by`/`updated_at`, so a mistaken event can be
-- SUPERSEDED and attributed rather than erased. Everything that says what happened — the shipment,
-- the stage, when it happened, where, who recorded it, and the note — is frozen at insert.
--
-- The correction path is therefore the same one T8 and T9 use: a new event, not an edit.
-- =============================================================

CREATE OR REPLACE FUNCTION public.carup_shipment_stage_event_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shipment_id     IS DISTINCT FROM OLD.shipment_id
     OR NEW.import_order_id IS DISTINCT FROM OLD.import_order_id
     OR NEW.stage        IS DISTINCT FROM OLD.stage
     OR NEW.event_time   IS DISTINCT FROM OLD.event_time
     OR NEW.location     IS DISTINCT FROM OLD.location
     OR NEW.notes        IS DISTINCT FROM OLD.notes
     OR NEW.metadata     IS DISTINCT FROM OLD.metadata
     OR NEW.created_by   IS DISTINCT FROM OLD.created_by
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'diaspora_shipment_stage_events is append-only: what happened, when, where and who recorded it cannot be rewritten. Record a new event instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipment_stage_event_guard ON public.diaspora_shipment_stage_events;
CREATE TRIGGER trg_shipment_stage_event_guard
  BEFORE UPDATE ON public.diaspora_shipment_stage_events
  FOR EACH ROW EXECUTE FUNCTION public.carup_shipment_stage_event_guard();

-- A DELETE erases the fact entirely, which no correction ever needs to do. Soft-delete via
-- `deleted_at` remains available and stays attributable.
CREATE OR REPLACE FUNCTION public.carup_shipment_stage_event_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'diaspora_shipment_stage_events cannot be deleted: a movement history that can be erased is not evidence. Set deleted_at to supersede an event.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipment_stage_event_no_delete ON public.diaspora_shipment_stage_events;
CREATE TRIGGER trg_shipment_stage_event_no_delete
  BEFORE DELETE ON public.diaspora_shipment_stage_events
  FOR EACH ROW EXECUTE FUNCTION public.carup_shipment_stage_event_no_delete();

-- And the browser cannot reach the table at all. The triggers above are the second line; this is the
-- first, and matches the posture of every table T9 and T10 created.
ALTER TABLE public.diaspora_shipment_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diaspora_shipment_stage_events FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.diaspora_shipment_stage_events FROM anon, authenticated;

COMMENT ON TABLE public.diaspora_shipment_stage_events IS
  'T11 movement timeline. APPEND-ONLY, enforced by trigger: a correction is a new event, never an '
  'edit. Only deleted_at/updated_by/updated_at may change, so a mistaken event is superseded and '
  'attributed rather than erased.';

-- +migrate Down
DROP TRIGGER IF EXISTS trg_shipment_stage_event_no_delete ON public.diaspora_shipment_stage_events;
DROP TRIGGER IF EXISTS trg_shipment_stage_event_guard ON public.diaspora_shipment_stage_events;
DROP FUNCTION IF EXISTS public.carup_shipment_stage_event_no_delete();
DROP FUNCTION IF EXISTS public.carup_shipment_stage_event_guard();
