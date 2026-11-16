-- =============================================================
-- SERVICE NETWORK FOUNDATION 1.0 — O4: deterministic domain-event identity
-- =============================================================
-- Service Network emits six case-lifecycle events through the canonical
-- domain_events outbox. Until now none of them carried a dedupe_key, so
-- `idx_domain_events_dedupe_key` — a PARTIAL unique index over NOT NULL keys —
-- exempted every one of them by construction, and a replayed emit inserted a
-- second row with the same meaning.
--
-- That is not a theoretical replay. `eventPayload()` stamps a fresh `occurredAt`
-- on every emit, so two emits of the same transition are never byte-identical and
-- nothing downstream could have collapsed them. Two 'service.case.accepted' rows
-- for one case become two notifications to the same customer for one acceptance.
--
-- IDENTITY. Each of these is a once-per-case transition: a case is requested once,
-- accepted once, completed once. The identity is therefore the case, scoped by the
-- event type, which keeps `accepted` and `completed` for the same case as distinct
-- rows while making a replay of either recover the row that already exists.
--
-- CONTRACT AGREEMENT. The key format below MUST equal the one produced by
-- `deterministicEventIdentity()` in backend/services/eventBus/eventBusService.js:
--
--     `${eventType}:${serviceCaseId}`
--
-- backend/tests/service-network-o1-o10-obligations.test.js pins the two together by
-- parsing this file, because a silent divergence would turn idempotent recovery
-- into an unrecoverable insert failure: the application would look a row up by a
-- key the database never wrote.
--
-- FORWARD-ONLY and ADDITIVE. Every existing branch of the function is reproduced
-- here byte-for-byte; this migration only appends a branch. A NULL key stays NULL,
-- and rows written before this migration keep their exemption from the index.
-- +migrate Up
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

-- Re-asserted so applying this package to an environment that somehow lacks the trigger is correct.
DROP TRIGGER IF EXISTS trg_domain_events_communication_dedupe
  ON public.domain_events;
CREATE TRIGGER trg_domain_events_communication_dedupe
  BEFORE INSERT ON public.domain_events
  FOR EACH ROW
  EXECUTE FUNCTION public.communication_domain_event_dedupe_key();

-- +migrate Down
-- Reverts to the pre-Service-Network function body. Existing Service Network dedupe_key values are
-- deliberately left in place: removing them would re-open the duplicate window for rows already
-- written, and a key that no longer gets derived is inert rather than harmful.
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
