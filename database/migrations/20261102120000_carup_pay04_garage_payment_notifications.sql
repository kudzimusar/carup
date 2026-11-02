-- +migrate Up
-- =============================================================
-- CARUP-PAY-04-LR01 — a once-only identity for the two garage-payment notifications PAY-04 adds:
--   garage.payment.confirmed  the garage's payment PROVIDER confirmed money that now counts on the invoice
--   garage.payment.refunded   the provider confirmed the garage's refund of that money
--
-- Like T11-CAP-08 (20260922090000), this is a SEPARATE trigger and NOT another branch in
-- communication_domain_event_dedupe_key(): every lineage that re-stated that shared function had to know every earlier
-- branch, and the last writer won. A dedicated function, bound by its own trigger and fired only for these two event
-- types, cannot remove anyone else's branch and cannot be removed by theirs, in whatever order migrations apply.
--
-- The identity is the event type plus the producer's `notificationKey` (`<entity>:<recipient>`), the same field the
-- JS registry (eventBusService DETERMINISTIC_EVENT_IDENTITY_FIELDS / PAY04_DEDUPED_EVENTS) names; a test pins both.
-- The wording uses the existing governed template garage_commercial_update_v1 (a bounded headline, no amount).
-- Additive: one function, one trigger. Re-applying it changes nothing.
-- =============================================================

CREATE OR REPLACE FUNCTION public.pay04_garage_payment_event_dedupe_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  v_key := NULLIF(btrim(NEW.payload ->> 'notificationKey'), '');
  IF v_key IS NOT NULL THEN
    NEW.dedupe_key := NEW.event_type || ':' || v_key;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pay04_garage_payment_event_dedupe_key() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_domain_events_pay04_garage_payment_dedupe ON public.domain_events;
CREATE TRIGGER trg_domain_events_pay04_garage_payment_dedupe
  BEFORE INSERT ON public.domain_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('garage.payment.confirmed', 'garage.payment.refunded'))
  EXECUTE FUNCTION public.pay04_garage_payment_event_dedupe_key();

-- +migrate Down
-- Removes only what this migration added; dedupe keys already written stay (an underived key is inert).
DROP TRIGGER IF EXISTS trg_domain_events_pay04_garage_payment_dedupe ON public.domain_events;
DROP FUNCTION IF EXISTS public.pay04_garage_payment_event_dedupe_key();
