-- +migrate Up
-- CarUp Communications 2.0 delivery-state invariant.
-- Implementation target: docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md,
-- sections 7.7, 25, 27, 29 and 31.
--
-- Provider callbacks can arrive out of order. Once a message/notification/attempt
-- is physically confirmed delivered (or read where supported), a later weaker
-- 'sent' or contradictory failure callback must not erase that stronger receipt.
-- This lives at the database boundary so every existing/future provider path gets
-- the same protection, including the already-proven WhatsApp/Telegram runtime.

CREATE OR REPLACE FUNCTION public.communication_delivery_success_rank(p_status TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(COALESCE(p_status, ''))
    WHEN 'queued' THEN 10
    WHEN 'processing' THEN 20
    WHEN 'sent' THEN 30
    WHEN 'accepted' THEN 30
    WHEN 'delivered' THEN 40
    WHEN 'read' THEN 50
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.communication_preserve_monotonic_delivery_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  old_rank INTEGER;
  new_rank INTEGER;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  old_rank := public.communication_delivery_success_rank(OLD.status);
  new_rank := public.communication_delivery_success_rank(NEW.status);

  -- A later weaker success callback may never regress a stronger success state.
  IF old_rank IS NOT NULL AND new_rank IS NOT NULL AND new_rank < old_rank THEN
    NEW.status := OLD.status;
    RETURN NEW;
  END IF;

  -- Physical delivery/read is authoritative over a later provider failure. A
  -- send can still legitimately become failed/undelivered before delivery.
  IF old_rank IS NOT NULL AND old_rank >= 40 AND lower(COALESCE(NEW.status, '')) IN ('failed', 'dead_letter') THEN
    NEW.status := OLD.status;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_monotonic_delivery_status ON messages;
CREATE TRIGGER trg_messages_monotonic_delivery_status
  BEFORE UPDATE OF status ON messages
  FOR EACH ROW EXECUTE FUNCTION public.communication_preserve_monotonic_delivery_status();

DROP TRIGGER IF EXISTS trg_notification_queue_monotonic_delivery_status ON notification_queue;
CREATE TRIGGER trg_notification_queue_monotonic_delivery_status
  BEFORE UPDATE OF status ON notification_queue
  FOR EACH ROW EXECUTE FUNCTION public.communication_preserve_monotonic_delivery_status();

DROP TRIGGER IF EXISTS trg_message_delivery_attempts_monotonic_delivery_status ON message_delivery_attempts;
CREATE TRIGGER trg_message_delivery_attempts_monotonic_delivery_status
  BEFORE UPDATE OF status ON message_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION public.communication_preserve_monotonic_delivery_status();

-- +migrate Down
DROP TRIGGER IF EXISTS trg_message_delivery_attempts_monotonic_delivery_status ON message_delivery_attempts;
DROP TRIGGER IF EXISTS trg_notification_queue_monotonic_delivery_status ON notification_queue;
DROP TRIGGER IF EXISTS trg_messages_monotonic_delivery_status ON messages;
DROP FUNCTION IF EXISTS public.communication_preserve_monotonic_delivery_status();
DROP FUNCTION IF EXISTS public.communication_delivery_success_rank(TEXT);
