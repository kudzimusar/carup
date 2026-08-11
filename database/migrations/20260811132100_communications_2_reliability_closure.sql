-- +migrate Up
-- CarUp Communications 2.0 reliability closure.
-- Implementation target: docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md,
-- sections 6 (channel orchestration), 7.7, 25, 27, 29, 31 and 32.
--
-- Marketplace inquiry creation and its canonical communication outbox event must
-- commit atomically and retries must not create duplicate semantic events.
-- Existing historical domain events are left untouched: the nullable dedupe_key is
-- populated only for new Marketplace inquiry events by a BEFORE INSERT trigger.

ALTER TABLE public.domain_events
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_events_dedupe_key
  ON public.domain_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.communication_domain_event_dedupe_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inquiry_id TEXT;
BEGIN
  IF NEW.event_type = 'marketplace.inquiry.created' THEN
    v_inquiry_id := NULLIF(NEW.payload ->> 'inquiryId', '');
    IF v_inquiry_id IS NOT NULL THEN
      NEW.dedupe_key := 'marketplace.inquiry.created:' || v_inquiry_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_domain_events_communication_dedupe
  ON public.domain_events;
CREATE TRIGGER trg_domain_events_communication_dedupe
  BEFORE INSERT ON public.domain_events
  FOR EACH ROW
  EXECUTE FUNCTION public.communication_domain_event_dedupe_key();

CREATE OR REPLACE FUNCTION public.communication_marketplace_inquiry_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'inquiryId', NEW.id::text,
    'listingId', NEW.listing_id,
    'inquiry_type', NEW.inquiry_type,
    'recipientUserId', COALESCE(NEW.seller_id, NEW.buyer_id),
    'buyerId', NEW.buyer_id,
    'sellerId', NEW.seller_id,
    'source_channel', NEW.source_channel,
    'referral_code', NEW.referral_code,
    'campaign_code', NEW.campaign_code
  ));

  INSERT INTO public.domain_events (
    event_type,
    payload,
    status,
    attempts,
    tenant_id
  )
  VALUES (
    'marketplace.inquiry.created',
    v_payload,
    'pending',
    0,
    NEW.seller_tenant_id
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.communication_marketplace_inquiry_outbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_marketplace_inquiry_outbox() TO service_role;

DROP TRIGGER IF EXISTS trg_marketplace_inquiry_communication_outbox
  ON public.marketplace_inquiries;
CREATE TRIGGER trg_marketplace_inquiry_communication_outbox
  AFTER INSERT ON public.marketplace_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.communication_marketplace_inquiry_outbox();

-- +migrate Down
DROP TRIGGER IF EXISTS trg_marketplace_inquiry_communication_outbox
  ON public.marketplace_inquiries;
DROP FUNCTION IF EXISTS public.communication_marketplace_inquiry_outbox();
DROP TRIGGER IF EXISTS trg_domain_events_communication_dedupe
  ON public.domain_events;
DROP FUNCTION IF EXISTS public.communication_domain_event_dedupe_key();
DROP INDEX IF EXISTS public.idx_domain_events_dedupe_key;
ALTER TABLE public.domain_events DROP COLUMN IF EXISTS dedupe_key;
