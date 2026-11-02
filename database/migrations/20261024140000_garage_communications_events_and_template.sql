-- GARAGE-1.0 — Garage lifecycle events through the EXISTING Communications authority.
--
-- Nothing here is a Garage notification system. Communications already owns templates, policies,
-- queues, channels and delivery. This migration only:
--   1. registers one governed in-app template (`garage_commercial_update_v1`) whose copy is a bounded
--      factual headline — never an amount, a price, a promise or private notes;
--   2. extends the deterministic dedupe identity so a replayed emit cannot notify the same person twice.
--
-- The dedupe function is REPRODUCED from 20261004180600 (Service Network O4) branch for branch and
-- only appended to. For the Garage events the identity is `notificationKey`, which the producer builds
-- as `<entity id>:<recipient>`: an estimate can legitimately notify two people (the registered owner
-- and the person who asked), and those must not collapse into one.
-- +migrate Up

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('garage_commercial_update_v1', 'service_network', 'customer', 'transactional', 'service_network', 'active',
   '{"source":"garage_1_0_final","purpose":"garage_customer_lifecycle"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'An update on your service request',
       '{{headline}} (vehicle {{listing_id}}). Open CarUp to see the details.',
       '["listing_id","headline"]'::jsonb, '[]'::jsonb, 'approved',
       '{"source":"garage_1_0_final","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates
WHERE template_key = 'garage_commercial_update_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inquiry_id TEXT;
  v_fingerprint TEXT;
  v_recipient TEXT;
  v_service_case_id TEXT;
  v_notification_key TEXT;
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
  ELSIF NEW.event_type IN (
    'service.case.requested',
    'service.case.accepted',
    'service.case.declined',
    'service.case.cancelled',
    'service.case.completed',
    'service.work.started'
  ) THEN
    -- Service Network (O4). Same rule as the Trust branch above: no case id means no identity, and
    -- a NULL key keeps the row insertable rather than losing a governed lifecycle event over a
    -- missing idempotency hint. The producer never emits without a case.
    v_service_case_id := NULLIF(NEW.payload ->> 'serviceCaseId', '');
    IF v_service_case_id IS NOT NULL THEN
      NEW.dedupe_key := NEW.event_type || ':' || v_service_case_id;
    END IF;
  ELSIF NEW.event_type IN (
    'garage.estimate.sent',
    'garage.invoice.issued',
    'garage.payment.recorded',
    'garage.appointment.confirmed',
    'garage.appointment.declined',
    'garage.appointment.cancelled'
  ) THEN
    -- Garage 1.0: once per (entity, recipient). No key means no identity, and a NULL key keeps the
    -- row insertable rather than losing a customer notification over a missing idempotency hint.
    v_notification_key := NULLIF(NEW.payload ->> 'notificationKey', '');
    IF v_notification_key IS NOT NULL THEN
      NEW.dedupe_key := NEW.event_type || ':' || v_notification_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_domain_events_communication_dedupe ON public.domain_events;
CREATE TRIGGER trg_domain_events_communication_dedupe
  BEFORE INSERT ON public.domain_events
  FOR EACH ROW
  EXECUTE FUNCTION public.communication_domain_event_dedupe_key();

REVOKE ALL ON FUNCTION public.communication_domain_event_dedupe_key() FROM PUBLIC, anon, authenticated;

-- +migrate Down
-- Restores the Service Network O4 body. Dedupe keys already written are left in place (inert).
CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inquiry_id TEXT;
  v_fingerprint TEXT;
  v_recipient TEXT;
  v_service_case_id TEXT;
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
  ELSIF NEW.event_type IN (
    'service.case.requested',
    'service.case.accepted',
    'service.case.declined',
    'service.case.cancelled',
    'service.case.completed',
    'service.work.started'
  ) THEN
    -- Service Network (O4). Same rule as the Trust branch above: no case id means no identity, and
    -- a NULL key keeps the row insertable rather than losing a governed lifecycle event over a
    -- missing idempotency hint. The producer never emits without a case.
    v_service_case_id := NULLIF(NEW.payload ->> 'serviceCaseId', '');
    IF v_service_case_id IS NOT NULL THEN
      NEW.dedupe_key := NEW.event_type || ':' || v_service_case_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.communication_domain_event_dedupe_key() FROM PUBLIC, anon, authenticated;

DELETE FROM communication_template_versions
WHERE template_id IN (SELECT id FROM communication_templates WHERE template_key='garage_commercial_update_v1')
  AND version=1 AND channel='in_app' AND language='en'
  AND COALESCE(experiment_metadata->>'source','')='garage_1_0_final';
DELETE FROM communication_templates
WHERE template_key='garage_commercial_update_v1' AND COALESCE(metadata->>'source','')='garage_1_0_final';
