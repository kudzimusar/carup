-- +migrate Up

-- Agent 8 Omnichannel Communication Engine.
-- Additive only: extends the existing notification_queue and domain_events runtime
-- model; does not replace legacy outbox_events.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS message_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  thread_key TEXT NOT NULL,
  thread_type TEXT NOT NULL CHECK (thread_type IN ('support','marketplace_inquiry','referral','escrow','finance','import','container','trust_safety','feedback','complaint','account','general')),
  subject_type TEXT,
  subject_id TEXT,
  primary_user_id TEXT,
  primary_channel TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','awaiting_ai','awaiting_human','assigned','awaiting_user','escalated','resolved','closed','spam')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  ai_mode TEXT NOT NULL DEFAULT 'enabled' CHECK (ai_mode IN ('enabled','draft_only','disabled','human_only')),
  assignment_type TEXT,
  assigned_admin_id TEXT,
  assigned_team TEXT,
  referral_code_id TEXT,
  referral_campaign_id TEXT,
  marketplace_listing_id TEXT,
  escrow_id TEXT,
  financing_application_id TEXT,
  last_message_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  sla_due_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_threads_tenant_key
  ON message_threads (COALESCE(tenant_id, 'platform'), thread_key);
CREATE INDEX IF NOT EXISTS idx_message_threads_user_updated ON message_threads (primary_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_threads_status_priority_sla ON message_threads (status, priority, sla_due_at);
CREATE INDEX IF NOT EXISTS idx_message_threads_assignee_status ON message_threads (assigned_admin_id, status);
CREATE INDEX IF NOT EXISTS idx_message_threads_subject ON message_threads (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_marketplace ON message_threads (marketplace_listing_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_referral_campaign ON message_threads (referral_campaign_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_escrow ON message_threads (escrow_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_finance ON message_threads (financing_application_id);

CREATE TABLE IF NOT EXISTS channel_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  user_id TEXT,
  channel TEXT NOT NULL,
  provider TEXT,
  external_id TEXT NOT NULL,
  normalized_address TEXT,
  display_name TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown','implied_transactional','opted_in','opted_out','revoked')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_identities_unique
  ON channel_identities (COALESCE(tenant_id, 'platform'), channel, COALESCE(provider, 'default'), external_id);
CREATE INDEX IF NOT EXISTS idx_channel_identities_user ON channel_identities (user_id, channel);
CREATE INDEX IF NOT EXISTS idx_channel_identities_address ON channel_identities (normalized_address);

CREATE TABLE IF NOT EXISTS message_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  participant_type TEXT NOT NULL CHECK (participant_type IN ('user','admin','agent','system','external_contact','business')),
  user_id TEXT,
  admin_id TEXT,
  external_identity_id UUID REFERENCES channel_identities(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  display_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  last_read_at TIMESTAMPTZ,
  notification_muted BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_message_participants_thread ON message_participants (thread_id);
CREATE INDEX IF NOT EXISTS idx_message_participants_user ON message_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_message_participants_admin ON message_participants (admin_id);
CREATE INDEX IF NOT EXISTS idx_message_participants_identity ON message_participants (external_identity_id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  tenant_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound','internal','system')),
  message_type TEXT NOT NULL DEFAULT 'text',
  sender_participant_id UUID REFERENCES message_participants(id) ON DELETE SET NULL,
  sender_user_id TEXT,
  channel TEXT NOT NULL,
  provider TEXT,
  provider_message_id TEXT,
  client_message_id TEXT,
  in_reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  content_text TEXT,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  attachment_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
  language TEXT,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  ai_run_id TEXT,
  human_approved BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','queued','processing','sent','delivered','read','failed','dead_letter','suppressed')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_provider_message
  ON messages (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tenant_client
  ON messages (COALESCE(tenant_id, 'platform'), client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender_user ON messages (sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_participant ON messages (sender_participant_id);
CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages (in_reply_to_message_id);

ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS recipient_user_id TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS recipient_identity_id UUID REFERENCES channel_identities(id) ON DELETE SET NULL;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES message_threads(id) ON DELETE SET NULL;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS event_id TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS notification_type TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS template_key TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS last_error_code TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS last_error_message TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS read BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_channel_check;
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_status_check;
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_channel_agent8_check;
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_status_agent8_check;
ALTER TABLE notification_queue ALTER COLUMN status SET DEFAULT 'queued';
ALTER TABLE notification_queue
  ADD CONSTRAINT notification_queue_channel_agent8_check CHECK (
    channel IS NULL OR channel IN (
      'whatsapp','telegram','email','sms','instagram','facebook','web_chat','mobile_chat','in_app','push',
      'SMS','WHATSAPP','TELEGRAM','EMAIL','PUSH','IN_APP'
    )
  );
ALTER TABLE notification_queue
  ADD CONSTRAINT notification_queue_status_agent8_check CHECK (
    status IN (
      'queued','processing','sent','delivered','failed','retry_scheduled','dead_letter','cancelled','suppressed',
      'QUEUED','SENT','FAILED','DEAD_LETTER'
    )
  );

UPDATE notification_queue SET recipient_user_id = COALESCE(recipient_user_id, recipient_id) WHERE recipient_user_id IS NULL;
UPDATE notification_queue SET notification_type = COALESCE(notification_type, type, 'general') WHERE notification_type IS NULL;
UPDATE notification_queue SET dedupe_key = COALESCE(dedupe_key, id::text) WHERE dedupe_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_dedupe ON notification_queue (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notification_queue_status_due
  ON notification_queue (status, COALESCE(next_attempt_at, scheduled_at::timestamptz, created_at::timestamptz));
CREATE INDEX IF NOT EXISTS idx_notification_queue_recipient_created ON notification_queue (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_queue_recipient_id ON notification_queue (recipient_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_recipient_identity ON notification_queue (recipient_identity_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_thread ON notification_queue (thread_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_message ON notification_queue (message_id);

CREATE TABLE IF NOT EXISTS message_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id TEXT NOT NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  attempt_number INTEGER NOT NULL,
  provider TEXT NOT NULL,
  channel TEXT NOT NULL,
  provider_request_id TEXT,
  provider_message_id TEXT,
  request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_notification ON message_delivery_attempts (notification_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_message ON message_delivery_attempts (message_id);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  provider TEXT NOT NULL,
  channel TEXT NOT NULL,
  provider_event_id TEXT,
  dedupe_key TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_redacted JSONB,
  headers_redacted JSONB,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','duplicate','failed','rejected')),
  message_count INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  correlation_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_logs_dedupe ON webhook_logs (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_provider_received ON webhook_logs (provider, received_at DESC);

CREATE TABLE IF NOT EXISTS communication_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  tenant_id TEXT,
  transactional_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  preferred_channel TEXT,
  fallback_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone TEXT,
  language TEXT,
  consent_source TEXT,
  consent_version TEXT,
  consented_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_preferences_user_tenant
  ON communication_preferences (user_id, COALESCE(tenant_id, 'platform'));

CREATE TABLE IF NOT EXISTS communication_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  reason_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','normal','high','urgent')),
  source TEXT NOT NULL,
  assigned_team TEXT,
  assigned_admin_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','resolved','cancelled')),
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_escalations_thread ON communication_escalations (thread_id);
CREATE INDEX IF NOT EXISTS idx_comm_escalations_status_due ON communication_escalations (status, due_at);

ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS aggregate_type TEXT;
ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS aggregate_id TEXT;
ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS causation_id TEXT;
ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS locked_by TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_events_dedupe ON domain_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_domain_events_available ON domain_events (status, available_at, created_at);

ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_threads_user_read" ON message_threads;
CREATE POLICY "message_threads_user_read" ON message_threads
  FOR SELECT TO authenticated
  USING (primary_user_id = (select auth.uid())::text);

DROP POLICY IF EXISTS "messages_user_read" ON messages;
CREATE POLICY "messages_user_read" ON messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM message_threads mt
      WHERE mt.id = messages.thread_id AND mt.primary_user_id = (select auth.uid())::text
    )
  );

DROP POLICY IF EXISTS "message_participants_user_read" ON message_participants;
CREATE POLICY "message_participants_user_read" ON message_participants
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid())::text);

DROP POLICY IF EXISTS "channel_identities_user_read" ON channel_identities;
CREATE POLICY "channel_identities_user_read" ON channel_identities
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid())::text);

DROP POLICY IF EXISTS "communication_preferences_user_all" ON communication_preferences;
CREATE POLICY "communication_preferences_user_all" ON communication_preferences
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid())::text)
  WITH CHECK (user_id = (select auth.uid())::text);

DROP POLICY IF EXISTS "notification_queue_user_read" ON notification_queue;
CREATE POLICY "notification_queue_user_read" ON notification_queue
  FOR SELECT TO authenticated
  USING (recipient_user_id = (select auth.uid())::text);

DROP POLICY IF EXISTS "communication_escalations_admin_read" ON communication_escalations;
CREATE POLICY "communication_escalations_admin_read" ON communication_escalations
  FOR SELECT TO authenticated
  USING ((select auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','platform_admin','super_admin','support','finance','trust_manager','compliance_manager'));

DROP POLICY IF EXISTS "message_delivery_attempts_admin_read" ON message_delivery_attempts;
CREATE POLICY "message_delivery_attempts_admin_read" ON message_delivery_attempts
  FOR SELECT TO authenticated
  USING ((select auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','platform_admin','super_admin','support','finance','trust_manager','compliance_manager'));

DROP POLICY IF EXISTS "webhook_logs_admin_read" ON webhook_logs;
CREATE POLICY "webhook_logs_admin_read" ON webhook_logs
  FOR SELECT TO authenticated
  USING ((select auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','platform_admin','super_admin','support','finance','trust_manager','compliance_manager'));

-- Backend service_role bypasses RLS. No direct anon grants are added; new public
-- tables are intentionally accessed through Express APIs.

-- +migrate Down
DROP POLICY IF EXISTS "webhook_logs_admin_read" ON webhook_logs;
DROP POLICY IF EXISTS "message_delivery_attempts_admin_read" ON message_delivery_attempts;
DROP POLICY IF EXISTS "communication_escalations_admin_read" ON communication_escalations;
DROP POLICY IF EXISTS "communication_preferences_user_all" ON communication_preferences;
DROP POLICY IF EXISTS "notification_queue_user_read" ON notification_queue;
DROP POLICY IF EXISTS "channel_identities_user_read" ON channel_identities;
DROP POLICY IF EXISTS "message_participants_user_read" ON message_participants;
DROP POLICY IF EXISTS "messages_user_read" ON messages;
DROP POLICY IF EXISTS "message_threads_user_read" ON message_threads;

DROP INDEX IF EXISTS idx_domain_events_available;
DROP INDEX IF EXISTS idx_domain_events_dedupe;
DROP TABLE IF EXISTS communication_escalations;
DROP TABLE IF EXISTS communication_preferences;
DROP TABLE IF EXISTS webhook_logs;
DROP TABLE IF EXISTS message_delivery_attempts;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS message_participants;
DROP TABLE IF EXISTS channel_identities;
DROP TABLE IF EXISTS message_threads;
