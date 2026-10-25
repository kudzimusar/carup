-- +migrate Up
-- =============================================================
-- Trade OS T11-CAP-08 — Journey alerts: a database-enforced identity for one alert, and its governed wording.
--
-- Two small, additive things. Neither touches a table's shape.
--
-- 1. ONE ALERT PER (KIND, ORDER, PERSON, OBSERVATION).
--
--    A Journey alert is produced by consuming T11's `DIASPORA_SHIPMENT_<STAGE>` events. The event worker
--    re-runs EVERY handler of an event when any one of them throws, so a handler that told two people
--    before failing on the third runs again for all three. Without a database identity that is two
--    duplicate notices; with one, the retry recovers the existing alert and completes only the missing one.
--
--    `communication_domain_event_dedupe_key()` already derives an identity, but only for the event types it
--    lists, and `idx_domain_events_dedupe_key` is a PARTIAL unique index over NOT NULL keys — so an event
--    type it does not list has a NULL key and is exempt from the index by construction. This adds the two
--    Journey alert types, keyed by the `alertKey` the notifier builds. The three existing branches are
--    carried over BYTE-FOR-BYTE from 20260826120000_email_1_0_hardening.sql; a PGlite check runs the same
--    inputs through the old and new function and requires identical answers. The JS registry in
--    eventBusService.js (DETERMINISTIC_EVENT_IDENTITY_FIELDS) must name the same field, and a test pins them.
--
--    No `alertKey` means no identity: the key stays NULL and the row is insertable. Losing an alert is a
--    worse outcome than repeating one, and the notifier never emits without a key.
--
-- 2. THE WORDING IS GOVERNED.
--
--    The governed registry fails CLOSED for an unregistered template key, so a Journey alert bound to an
--    unregistered key would dead-letter at render time. `logistics_update_v1` is registered but says
--    "Shipping request … update", which is the wrong noun for a shipment's journey. `journey_update_v1`
--    carries the notifier's sentence as the body, under the shipment's reference. It says only what the
--    shipment authority recorded — the notifier owns the sentence, and each one names what it is NOT.
--
-- Additive: CREATE OR REPLACE of one function with a strict superset of its behaviour, and two INSERTs
-- guarded by ON CONFLICT DO NOTHING.
-- =============================================================

CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inquiry_id TEXT;
  v_fingerprint TEXT;
  v_recipient TEXT;
  v_alert_key TEXT;
BEGIN
  IF NEW.event_type = 'marketplace.inquiry.created' THEN
    v_inquiry_id := NULLIF(NEW.payload ->> 'inquiryId', '');
    IF v_inquiry_id IS NOT NULL THEN
      NEW.dedupe_key := 'marketplace.inquiry.created:' || v_inquiry_id;
    END IF;
  ELSIF NEW.event_type = 'user.email.verified' THEN
    -- R1. One verification per account means one welcome work item per account; a replayed emit
    -- must recover the existing row rather than create a second piece of pending work.
    v_recipient := NULLIF(NEW.payload ->> 'recipientUserId', '');
    IF v_recipient IS NOT NULL THEN
      NEW.dedupe_key := 'user.email.verified:' || v_recipient;
    END IF;
  ELSIF NEW.event_type = 'vehicle.trust.presentation_changed' THEN
    -- No fingerprint means no identity. Leaving dedupe_key NULL keeps the row insertable rather
    -- than rejecting a Trust announcement over a missing idempotency hint — losing the event is a
    -- worse outcome than repeating it, and the producer will not emit without a fingerprint anyway.
    v_fingerprint := NULLIF(NEW.payload ->> 'presentation_fingerprint', '');
    IF v_fingerprint IS NOT NULL THEN
      NEW.dedupe_key := 'vehicle.trust.presentation_changed:' || v_fingerprint;
    END IF;
  ELSIF NEW.event_type IN ('diaspora.journey.alert', 'diaspora.journey.exception') THEN
    -- T11-CAP-08. One alert per (kind, order, person, observation): the notifier builds the key, the
    -- event type is part of the identity, and a missing key leaves the row insertable.
    v_alert_key := NULLIF(btrim(NEW.payload ->> 'alertKey'), '');
    IF v_alert_key IS NOT NULL THEN
      NEW.dedupe_key := NEW.event_type || ':' || v_alert_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Revoked again after the CREATE OR REPLACE, as the function it replaces was: CREATE FUNCTION grants
-- EXECUTE to PUBLIC by default, and this package must also be correct against a database where the
-- function does not yet pre-exist. The trigger itself is unchanged and already installed.
REVOKE ALL ON FUNCTION public.communication_domain_event_dedupe_key()
  FROM PUBLIC, anon, authenticated;

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
-- Restores the function exactly as 20260826120000_email_1_0_hardening.sql left it.
CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inquiry_id TEXT;
  v_fingerprint TEXT;
  v_recipient TEXT;
BEGIN
  IF NEW.event_type = 'marketplace.inquiry.created' THEN
    v_inquiry_id := NULLIF(NEW.payload ->> 'inquiryId', '');
    IF v_inquiry_id IS NOT NULL THEN
      NEW.dedupe_key := 'marketplace.inquiry.created:' || v_inquiry_id;
    END IF;
  ELSIF NEW.event_type = 'user.email.verified' THEN
    v_recipient := NULLIF(NEW.payload ->> 'recipientUserId', '');
    IF v_recipient IS NOT NULL THEN
      NEW.dedupe_key := 'user.email.verified:' || v_recipient;
    END IF;
  ELSIF NEW.event_type = 'vehicle.trust.presentation_changed' THEN
    v_fingerprint := NULLIF(NEW.payload ->> 'presentation_fingerprint', '');
    IF v_fingerprint IS NOT NULL THEN
      NEW.dedupe_key := 'vehicle.trust.presentation_changed:' || v_fingerprint;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.communication_domain_event_dedupe_key()
  FROM PUBLIC, anon, authenticated;
-- The governed template is not deleted: retiring a template is its own reviewed decision (set `status`
-- rather than removing history), and an alert already queued against it must still render.
