-- +migrate Up

-- Agent 8 staging activation performance hardening.
-- Cover communication foreign keys used by delivery, receipt lookup, and
-- admin audit views without changing existing records.

CREATE INDEX IF NOT EXISTS idx_messages_sender_participant ON messages (sender_participant_id);
CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages (in_reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_recipient_id ON notification_queue (recipient_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_recipient_identity ON notification_queue (recipient_identity_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_message ON notification_queue (message_id);

-- +migrate Down

DROP INDEX IF EXISTS idx_notification_queue_message;
DROP INDEX IF EXISTS idx_notification_queue_recipient_identity;
DROP INDEX IF EXISTS idx_notification_queue_recipient_id;
DROP INDEX IF EXISTS idx_messages_in_reply_to;
DROP INDEX IF EXISTS idx_messages_sender_participant;
