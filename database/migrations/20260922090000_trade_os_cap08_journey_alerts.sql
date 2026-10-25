-- +migrate Up
-- =============================================================
-- Trade OS T11-CAP-08 — Journey alerts: a database-enforced identity for one alert, and its governed wording.
--
-- Two small, additive things. Neither touches a table's shape, and NEITHER TOUCHES ANY EXISTING FUNCTION.
--
-- 1. ONE ALERT PER (KIND, ORDER, PERSON, OBSERVATION).
--
--    A Journey alert is produced by consuming T11's `DIASPORA_SHIPMENT_<STAGE>` events. The event worker
--    re-runs EVERY handler of an event when any one of them throws, so a handler that told two people
--    before failing on the third runs again for all three. Without a database identity that is two
--    duplicate notices; with one, the retry recovers the existing alert and completes only the missing one.
--
--    `communication_domain_event_dedupe_key()` already derives an identity, but only for the event types it
--    lists — and `idx_domain_events_dedupe_key` is a PARTIAL unique index over NOT NULL keys, so an event
--    type it does not list has a NULL key and is exempt by construction.
--
--    WHY THIS IS A SEPARATE TRIGGER AND NOT ANOTHER BRANCH IN THAT FUNCTION. Every programme that has added a
--    branch there re-stated the WHOLE function, so the last writer wins and each must know every earlier
--    branch. That is not hypothetical: Email 1.0 re-stated it and regressed Service Network's O4 branch on a
--    live database (`service.case.*`), and a branch added here from this lineage would have removed it again —
--    this lineage cannot see O4. An earlier-dated migration is also overwritten by any later re-statement.
--    A dedicated function bound by its own trigger, fired only for the two Journey event types, cannot remove
--    anyone else's branch and cannot be removed by theirs, whatever order the migrations apply in.
--
--    The key is the event type and the `alertKey` the notifier builds. The JS registry in eventBusService.js
--    (DETERMINISTIC_EVENT_IDENTITY_FIELDS) must name the same field, and a test pins them. No `alertKey`
--    means no identity: the key stays NULL and the row is insertable — losing an alert is a worse outcome than
--    repeating one, and the notifier never emits without a key.
--
-- 2. THE WORDING IS GOVERNED.
--
--    The governed registry fails CLOSED for an unregistered template key, so a Journey alert bound to an
--    unregistered key would dead-letter at render time. `logistics_update_v1` is registered but says
--    "Shipping request … update", the wrong noun for a shipment's journey. `journey_update_v1` carries the
--    notifier's sentence as the body, under the shipment's reference. It says only what the shipment
--    authority recorded — the notifier owns the sentence, and each one names what it is NOT.
--
-- Additive: one new function, one new trigger that fires only for two event types, and two INSERTs guarded by
-- ON CONFLICT DO NOTHING. Re-applying it changes nothing.
-- =============================================================

CREATE OR REPLACE FUNCTION public.communication_journey_alert_dedupe_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_alert_key TEXT;
BEGIN
  -- One alert per (kind, order, person, observation): the notifier builds the key, the event type is part
  -- of the identity, and a missing key leaves the row insertable.
  v_alert_key := NULLIF(btrim(NEW.payload ->> 'alertKey'), '');
  IF v_alert_key IS NOT NULL THEN
    NEW.dedupe_key := NEW.event_type || ':' || v_alert_key;
  END IF;
  RETURN NEW;
END;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default; a trigger function needs no caller.
REVOKE ALL ON FUNCTION public.communication_journey_alert_dedupe_key()
  FROM PUBLIC, anon, authenticated;

-- The WHEN clause is the whole scope of this trigger: for every other event type it does not run at all.
DROP TRIGGER IF EXISTS trg_domain_events_journey_alert_dedupe ON public.domain_events;
CREATE TRIGGER trg_domain_events_journey_alert_dedupe
  BEFORE INSERT ON public.domain_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('diaspora.journey.alert', 'diaspora.journey.exception'))
  EXECUTE FUNCTION public.communication_journey_alert_dedupe_key();

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('journey_update_v1', 'container_logistics', 'customer', 'transactional', 'logistics', 'active', '{"purpose":"journey_alert"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Your shipment {{reference}}',
       '{{status}}',
       '["reference","status"]'::jsonb, '[]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='journey_update_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
-- Removes only what this migration added. The shared dedupe function was never touched, so there is nothing to
-- restore in it. Alerts already written keep their dedupe_key (a key that is no longer derived is inert, and
-- removing them would re-open the duplicate window for rows already written).
DROP TRIGGER IF EXISTS trg_domain_events_journey_alert_dedupe ON public.domain_events;
DROP FUNCTION IF EXISTS public.communication_journey_alert_dedupe_key();
-- The governed template is not deleted: retiring a template is its own reviewed decision (set `status`
-- rather than removing history), and an alert already queued against it must still render.
