-- +migrate Up
-- OC-LAUNCH-WEB-LR1-R15 — a human reply on WhatsApp or Telegram must not be starved by old queue work.
--
-- claim_due_communication_notifications() claimed strictly oldest-due first. On staging that put
-- 1,188 historical rows (984 in_app + 204 null-channel, oldest 2026-09-04) ahead of a Command Center
-- reply queued on 2026-10-12, so the reply could only be sent by first draining every one of them.
--
-- This redefines ONLY the claim order. Due WhatsApp/Telegram admin replies — a human answering a
-- customer inside a conversation — form priority class 0; everything else is class 1. Within each
-- class the original oldest-due order is unchanged. Nothing else changes: the same eligibility
-- (queued / retry_scheduled and due, or processing with a stale lock), the same dead-letter
-- exclusion, FOR UPDATE SKIP LOCKED, the same batch limit, the same attempt_count increment and the
-- same grants. No queue row is touched by this migration.
--
-- The class is deliberately narrow: notification_type = 'admin_reply' on 'whatsapp' or 'telegram'.
-- Other WhatsApp/Telegram notifications, email, push and in-app keep plain oldest-due order.

CREATE OR REPLACE FUNCTION public.claim_due_communication_notifications(
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
    ORDER BY
      CASE
        WHEN notification_type = 'admin_reply' AND channel IN ('whatsapp', 'telegram') THEN 0
        ELSE 1
      END ASC,
      COALESCE(next_attempt_at, scheduled_at::timestamptz, created_at::timestamptz, now()) ASC
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

REVOKE ALL ON FUNCTION public.claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_communication_notifications(TEXT, INTEGER, INTEGER) TO service_role;

-- +migrate Down
-- Restores the strictly oldest-due claim order of 20260624120000_communication_provider_runtime.sql.
CREATE OR REPLACE FUNCTION public.claim_due_communication_notifications(
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

REVOKE ALL ON FUNCTION public.claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_communication_notifications(TEXT, INTEGER, INTEGER) TO service_role;
