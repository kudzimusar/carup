-- +migrate Up
-- E7/F2 — enforce "one canonical send intent -> at most one provider send" in the DATABASE.
--
-- Found during E7 Brevo certification: notification_queue.dedupe_key had no unique constraint.
-- Deduplication was enforced only in application code (queueNotification does a findOne on
-- dedupe_key before inserting), which is a read-then-write with no locking. Two concurrent
-- campaign executions — or a retried worker invocation racing itself — could therefore both pass
-- the check and insert, producing two notifications for one canonical intent and, downstream, two
-- real provider sends to the same recipient.
--
-- That is precisely the invariant the governing directive requires, so it is now guaranteed by the
-- database rather than by timing.
--
-- Partial index: a large number of legacy rows carry a NULL dedupe_key (187 at time of writing)
-- and are outside this contract. Verified beforehand that zero duplicate non-null dedupe_key
-- values exist, so this cannot fail against live data.

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_queue_dedupe_key
  ON public.notification_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON INDEX public.uq_notification_queue_dedupe_key IS
  'E7/F2: one canonical send intent -> at most one queued notification. Partial because legacy rows may carry a NULL dedupe_key.';

-- +migrate Down
DROP INDEX IF EXISTS public.uq_notification_queue_dedupe_key;
