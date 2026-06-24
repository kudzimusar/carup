-- +migrate Up

-- Agent 8 staging activation hardening.
-- Keep the canonical notification queue protected by RLS and ensure the
-- worker claim RPC is callable only by the service role.

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_queue_user_read" ON notification_queue;
CREATE POLICY "notification_queue_user_read" ON notification_queue
  FOR SELECT TO authenticated
  USING (recipient_user_id = (select auth.uid())::text);

REVOKE ALL ON FUNCTION claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION claim_due_communication_notifications(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_due_communication_notifications(TEXT, INTEGER, INTEGER) TO service_role;

DROP POLICY IF EXISTS "message_delivery_attempts_admin_read" ON message_delivery_attempts;
CREATE POLICY "message_delivery_attempts_admin_read" ON message_delivery_attempts
  FOR SELECT TO authenticated
  USING ((select auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','platform_admin','super_admin','support','finance','trust_manager','compliance_manager'));

DROP POLICY IF EXISTS "webhook_logs_admin_read" ON webhook_logs;
CREATE POLICY "webhook_logs_admin_read" ON webhook_logs
  FOR SELECT TO authenticated
  USING ((select auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','platform_admin','super_admin','support','finance','trust_manager','compliance_manager'));

-- +migrate Down

DROP POLICY IF EXISTS "webhook_logs_admin_read" ON webhook_logs;
DROP POLICY IF EXISTS "message_delivery_attempts_admin_read" ON message_delivery_attempts;
DROP POLICY IF EXISTS "notification_queue_user_read" ON notification_queue;
ALTER TABLE notification_queue DISABLE ROW LEVEL SECURITY;
