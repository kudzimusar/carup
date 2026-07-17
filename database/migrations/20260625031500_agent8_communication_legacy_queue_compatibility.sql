-- +migrate Up

-- Follow-up hardening for installations that already applied Agent 8 before
-- the legacy notification_queue compatibility fixes landed.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_queue'
      AND column_name = 'recipient_id'
  ) THEN
    ALTER TABLE notification_queue ALTER COLUMN recipient_id DROP NOT NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_notification_queue_status_due;
CREATE INDEX IF NOT EXISTS idx_notification_queue_status_due
  ON notification_queue (status, next_attempt_at, scheduled_at, created_at);

-- +migrate Down

DROP INDEX IF EXISTS idx_notification_queue_status_due;
CREATE INDEX IF NOT EXISTS idx_notification_queue_status_due
  ON notification_queue (status, next_attempt_at, scheduled_at, created_at);
