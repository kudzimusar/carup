-- +migrate Up
-- CarUp Communications 2.0 — Phase 5/6/7 product closure foundations.
-- Implementation target: docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md
-- sections 13, 16-23, 26, 28-32 and 35.
--
-- This migration is additive. It stores canonical campaign evidence and creates the
-- private Supabase Storage bucket used by the Phase 5 media service when the storage
-- schema is present. Provider approvals remain external and are never fabricated.

CREATE TABLE IF NOT EXISTS communication_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  campaign_code TEXT NOT NULL,
  name TEXT NOT NULL,
  business_workflow TEXT NOT NULL DEFAULT 'growth',
  classification TEXT NOT NULL DEFAULT 'marketing' CHECK (classification = 'marketing'),
  template_key TEXT NOT NULL REFERENCES communication_templates(template_key) ON DELETE RESTRICT,
  channel TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  segment_definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  send_window_start TIMESTAMPTZ,
  send_window_end TIMESTAMPTZ,
  frequency_cap_count INTEGER NOT NULL DEFAULT 1 CHECK (frequency_cap_count > 0),
  frequency_cap_window_hours INTEGER NOT NULL DEFAULT 168 CHECK (frequency_cap_window_hours > 0),
  experiment_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  promotion_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','running','paused','completed','cancelled')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (send_window_end IS NULL OR send_window_start IS NULL OR send_window_end > send_window_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_communication_campaigns_tenant_code
  ON communication_campaigns (COALESCE(tenant_id, 'platform'), campaign_code);
CREATE INDEX IF NOT EXISTS idx_communication_campaigns_status_window
  ON communication_campaigns (status, send_window_start, send_window_end);
CREATE INDEX IF NOT EXISTS idx_communication_campaigns_template
  ON communication_campaigns (template_key, channel, language);

CREATE TABLE IF NOT EXISTS communication_campaign_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES communication_campaigns(id) ON DELETE CASCADE,
  tenant_id TEXT,
  user_id TEXT NOT NULL,
  participant_id UUID REFERENCES message_participants(id) ON DELETE SET NULL,
  thread_id UUID REFERENCES message_threads(id) ON DELETE SET NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  notification_id TEXT,
  channel TEXT NOT NULL,
  variant_key TEXT NOT NULL DEFAULT 'control',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','suppressed','sent','delivered','read','failed','converted','cancelled')),
  suppression_reason TEXT,
  provider_message_id TEXT,
  cost_amount NUMERIC,
  cost_currency TEXT,
  conversion_value NUMERIC,
  conversion_currency TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_communication_campaign_deliveries_campaign_status
  ON communication_campaign_deliveries (campaign_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communication_campaign_deliveries_user_frequency
  ON communication_campaign_deliveries (user_id, created_at DESC)
  WHERE status NOT IN ('suppressed','cancelled');
CREATE INDEX IF NOT EXISTS idx_communication_campaign_deliveries_thread
  ON communication_campaign_deliveries (thread_id, message_id);
CREATE INDEX IF NOT EXISTS idx_communication_campaign_deliveries_conversion
  ON communication_campaign_deliveries (campaign_id, converted_at DESC)
  WHERE converted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_communication_campaign_delivery_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  mapped_status TEXT;
BEGIN
  mapped_status := CASE NEW.status
    WHEN 'sent' THEN 'sent'
    WHEN 'delivered' THEN 'delivered'
    WHEN 'read' THEN 'read'
    WHEN 'failed' THEN 'failed'
    WHEN 'dead_letter' THEN 'failed'
    WHEN 'suppressed' THEN 'suppressed'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE NULL
  END;
  IF mapped_status IS NULL THEN RETURN NEW; END IF;

  UPDATE public.communication_campaign_deliveries
  SET status = CASE
        WHEN status='converted' THEN 'converted'
        WHEN mapped_status='failed' AND status IN ('delivered','read') THEN status
        ELSE mapped_status
      END,
      sent_at = CASE WHEN mapped_status IN ('sent','delivered','read') THEN COALESCE(sent_at, now()) ELSE sent_at END,
      delivered_at = CASE WHEN mapped_status IN ('delivered','read') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
      read_at = CASE WHEN mapped_status='read' THEN COALESCE(read_at, now()) ELSE read_at END,
      suppression_reason = CASE
        WHEN mapped_status='suppressed' THEN COALESCE(suppression_reason, NEW.metadata ->> 'suppression_reason', 'notification_suppressed')
        ELSE suppression_reason
      END,
      updated_at = now()
  WHERE notification_id = NEW.id::text;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notification_queue_campaign_delivery_status ON notification_queue;
CREATE TRIGGER trg_notification_queue_campaign_delivery_status
AFTER UPDATE OF status ON notification_queue
FOR EACH ROW
EXECUTE FUNCTION public.sync_communication_campaign_delivery_status();

ALTER TABLE communication_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_campaign_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE communication_campaigns FROM anon, authenticated;
REVOKE ALL ON TABLE communication_campaign_deliveries FROM anon, authenticated;

INSERT INTO communication_templates (
  template_key, business_workflow, stakeholder_audience, classification,
  owner_team, status, metadata
)
VALUES (
  'carup_reengagement_v1',
  'growth',
  'consented_user',
  'marketing',
  'growth',
  'active',
  jsonb_build_object(
    'purpose', 'consented_reengagement',
    'communications_2_phase', 7,
    'frequency_cap_required', true,
    'marketing_consent_required', true,
    'migration_owner', '20260811132300'
  )
)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions (
  template_id, version, channel, language, subject_template, body_template,
  required_variables, optional_variables, provider_template_reference,
  cta_definitions, legal_footer_rules, approval_status, approved_by, approved_at,
  experiment_metadata
)
SELECT
  t.id, 1, 'in_app', 'en',
  'A CarUp update for you',
  'There is something new in CarUp that may be relevant to you. Open CarUp to continue. You can change marketing preferences at any time.',
  '[]'::jsonb,
  '["first_name","campaign_name","campaign_code"]'::jsonb,
  NULL,
  '[]'::jsonb,
  jsonb_build_object('preference_controls_required', true),
  'approved',
  'migration:20260811132300',
  now(),
  jsonb_build_object('communications_2_phase', 7, 'variant', 'control', 'migration_owner', '20260811132300')
FROM communication_templates t
WHERE t.template_key='carup_reengagement_v1'
  AND NOT EXISTS (
    SELECT 1 FROM communication_template_versions v
    WHERE v.template_id=t.id AND v.version=1 AND v.channel='in_app' AND v.language='en'
  );

INSERT INTO communication_template_versions (
  template_id, version, channel, language, subject_template, body_template,
  required_variables, optional_variables, provider_template_reference,
  cta_definitions, legal_footer_rules, approval_status, approved_by, approved_at,
  experiment_metadata
)
SELECT
  t.id, 1, 'email', 'en',
  'A CarUp update for you',
  'There is something new in CarUp that may be relevant to you. Open CarUp to continue. You can change marketing preferences at any time.',
  '[]'::jsonb,
  '["first_name","campaign_name","campaign_code"]'::jsonb,
  NULL,
  '[]'::jsonb,
  jsonb_build_object('preference_controls_required', true),
  'approved',
  'migration:20260811132300',
  now(),
  jsonb_build_object('communications_2_phase', 7, 'variant', 'control', 'migration_owner', '20260811132300')
FROM communication_templates t
WHERE t.template_key='carup_reengagement_v1'
  AND NOT EXISTS (
    SELECT 1 FROM communication_template_versions v
    WHERE v.template_id=t.id AND v.version=1 AND v.channel='email' AND v.language='en'
  );

-- Supabase Storage is not present in disposable PostgreSQL CI, so bucket creation
-- is conditional. On canonical Supabase staging this creates/locks the private
-- communication-media bucket used only through signed upload/download grants.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'carup-communication-media',
      'carup-communication-media',
      FALSE,
      104857600,
      ARRAY[
        'image/jpeg','image/png','image/webp','image/gif',
        'audio/mpeg','audio/mp4','audio/ogg','audio/webm','audio/wav','audio/x-wav',
        'video/mp4','video/webm','video/quicktime',
        'application/pdf','text/plain','text/csv',
        'application/msword','application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]::text[]
    )
    ON CONFLICT (id) DO UPDATE SET
      public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

-- +migrate Down
DROP TRIGGER IF EXISTS trg_notification_queue_campaign_delivery_status ON notification_queue;
DROP FUNCTION IF EXISTS public.sync_communication_campaign_delivery_status();

DROP TABLE IF EXISTS communication_campaign_deliveries;
DROP TABLE IF EXISTS communication_campaigns;

DELETE FROM communication_template_versions
WHERE approved_by='migration:20260811132300'
  AND experiment_metadata ->> 'migration_owner'='20260811132300';

DELETE FROM communication_templates t
WHERE t.template_key='carup_reengagement_v1'
  AND t.metadata ->> 'migration_owner'='20260811132300'
  AND NOT EXISTS (SELECT 1 FROM communication_template_versions v WHERE v.template_id=t.id);

-- Delete the migration bucket only when empty. If user artifacts exist, retain the
-- private bucket so rollback never destroys communication evidence.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='carup-communication-media') THEN
      IF to_regclass('storage.objects') IS NULL THEN
        DELETE FROM storage.buckets WHERE id='carup-communication-media';
      ELSIF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='carup-communication-media') THEN
        DELETE FROM storage.buckets WHERE id='carup-communication-media';
      END IF;
    END IF;
  END IF;
END $$;
