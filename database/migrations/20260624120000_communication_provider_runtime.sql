-- +migrate Up

-- Agent 8 provider runtime and durable delivery claim support.
-- Additive only: preserves existing notification_queue rows and works whether
-- notification_queue.id is UUID/TEXT or legacy BIGSERIAL.

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_provider_message
  ON message_delivery_attempts (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_queue_processing_lock
  ON notification_queue (status, locked_at)
  WHERE status = 'processing';

DO $$
DECLARE
  id_type TEXT;
  id_default TEXT;
BEGIN
  SELECT data_type, column_default
  INTO id_type, id_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'notification_queue'
    AND column_name = 'id';

  IF id_type = 'text' AND id_default IS NULL THEN
    ALTER TABLE notification_queue ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  ELSIF id_type = 'uuid' AND id_default IS NULL THEN
    ALTER TABLE notification_queue ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION claim_due_communication_notifications(
  p_worker_id TEXT,
  p_batch_limit INTEGER DEFAULT 10,
  p_stale_after_seconds INTEGER DEFAULT 900
)
RETURNS SETOF notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due_rows AS (
    SELECT id
    FROM notification_queue
    WHERE (
      (
        lower(status) IN ('queued', 'retry_scheduled')
        AND COALESCE(next_attempt_at, scheduled_at::timestamptz, created_at::timestamptz, now()) <= now()
      )
      OR (
        lower(status) = 'processing'
        AND locked_at IS NOT NULL
        AND locked_at < now() - make_interval(secs => GREATEST(p_stale_after_seconds, 1))
      )
    )
    AND dead_lettered_at IS NULL
    ORDER BY COALESCE(next_attempt_at, scheduled_at::timestamptz, created_at::timestamptz, now()) ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_batch_limit, 1)
  )
  UPDATE notification_queue nq
  SET
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker_id,
    attempt_count = COALESCE(nq.attempt_count, 0) + 1,
    updated_at = now()
  FROM due_rows
  WHERE nq.id = due_rows.id
  RETURNING nq.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_due_communication_notifications(TEXT, INTEGER, INTEGER) TO service_role;
