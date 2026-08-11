-- +migrate Up
-- CarUp Communications 2.0 — additive canonical conversation extensions.
-- Implementation target: docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md,
-- sections 7, 8, 11-14, 15, 25-26, 28-32.
--
-- This migration intentionally evolves the proven message_threads/messages/provider
-- runtime instead of creating a parallel messaging silo. Production application is
-- separately owner-gated; this file is safe to review/deploy to staging first.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS business_workflow TEXT;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS funnel_stage TEXT;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS conversion_status TEXT;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS assigned_user_id TEXT;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS last_outbound_at TIMESTAMPTZ;

UPDATE message_threads
SET business_workflow = COALESCE(
  business_workflow,
  CASE thread_type
    WHEN 'marketplace_inquiry' THEN 'marketplace'
    WHEN 'finance' THEN 'finance'
    WHEN 'escrow' THEN 'safepay'
    WHEN 'import' THEN 'diaspora_import'
    WHEN 'container' THEN 'container_logistics'
    WHEN 'referral' THEN 'referral'
    WHEN 'trust_safety' THEN 'trust_safety'
    ELSE thread_type
  END
)
WHERE business_workflow IS NULL;

ALTER TABLE message_participants ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{"read":true,"send":true}'::jsonb;
ALTER TABLE message_participants ADD COLUMN IF NOT EXISTS stakeholder_role TEXT;
ALTER TABLE message_participants ADD COLUMN IF NOT EXISTS notification_policy JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE message_participants ADD COLUMN IF NOT EXISTS channel_preference_override TEXT;

UPDATE message_participants
SET stakeholder_role = COALESCE(stakeholder_role, role)
WHERE stakeholder_role IS NULL;

-- Legacy compatibility: every historical primary_user_id becomes an explicit
-- participant. primary_user_id remains temporarily as a projection/backward-compat
-- field; it is no longer the final authorization model.
INSERT INTO message_participants (
  thread_id, participant_type, user_id, role, stakeholder_role,
  display_name, joined_at, permissions, metadata
)
SELECT
  mt.id,
  'user',
  mt.primary_user_id,
  'legacy_primary',
  'legacy_primary',
  NULL,
  COALESCE(mt.created_at, now()),
  '{"read":true,"send":true}'::jsonb,
  jsonb_build_object('communications_2_backfill', true)
FROM message_threads mt
WHERE mt.primary_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM message_participants mp
    WHERE mp.thread_id = mt.id
      AND mp.user_id = mt.primary_user_id
      AND mp.left_at IS NULL
  );

CREATE INDEX IF NOT EXISTS idx_message_participants_active_user_thread
  ON message_participants (user_id, thread_id) WHERE user_id IS NOT NULL AND left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_message_participants_active_thread_role
  ON message_participants (thread_id, stakeholder_role) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_message_threads_workflow_updated
  ON message_threads (business_workflow, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_threads_funnel
  ON message_threads (business_workflow, funnel_stage, conversion_status);

CREATE TABLE IF NOT EXISTS conversation_channel_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES message_participants(id) ON DELETE CASCADE,
  channel_identity_id UUID NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  provider TEXT,
  external_conversation_id TEXT,
  routing_purpose TEXT NOT NULL DEFAULT 'transactional',
  can_send BOOLEAN NOT NULL DEFAULT TRUE,
  can_receive BOOLEAN NOT NULL DEFAULT TRUE,
  transactional_consent BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  last_outbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_inbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_channel_binding_unique
  ON conversation_channel_bindings (thread_id, participant_id, channel_identity_id, channel, COALESCE(provider, 'default'));
CREATE INDEX IF NOT EXISTS idx_conversation_channel_binding_identity
  ON conversation_channel_bindings (channel_identity_id, channel, provider, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_channel_binding_thread
  ON conversation_channel_bindings (thread_id, participant_id, is_primary DESC, last_used_at DESC);

CREATE TABLE IF NOT EXISTS message_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  part_index INTEGER NOT NULL DEFAULT 0 CHECK (part_index >= 0),
  part_type TEXT NOT NULL CHECK (part_type IN (
    'text','image','audio','video','document','location','contact','structured_card','button','quick_reply','quote','system_event'
  )),
  text_content TEXT,
  storage_key TEXT,
  source_url TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  original BOOLEAN NOT NULL DEFAULT TRUE,
  derived_from_part_id UUID REFERENCES message_parts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_parts_position ON message_parts (message_id, part_index);
CREATE INDEX IF NOT EXISTS idx_message_parts_type ON message_parts (part_type, created_at DESC);

CREATE TABLE IF NOT EXISTS communication_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,
  business_workflow TEXT NOT NULL,
  stakeholder_audience TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('security','transactional','service','marketing')),
  owner_team TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communication_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES communication_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  channel TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  subject_template TEXT,
  body_template TEXT NOT NULL,
  required_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  optional_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_template_reference TEXT,
  cta_definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  legal_footer_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft','approved','rejected','retired')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  experiment_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_communication_template_version_unique
  ON communication_template_versions (template_id, version, channel, language);

CREATE TABLE IF NOT EXISTS communication_brand_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_key TEXT NOT NULL UNIQUE,
  owner_type TEXT NOT NULL DEFAULT 'carup',
  owner_id TEXT,
  asset_type TEXT NOT NULL,
  storage_key TEXT,
  public_url TEXT,
  alt_text TEXT,
  authorized BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  participant_id UUID REFERENCES message_participants(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  business_workflow TEXT,
  funnel_stage TEXT,
  acquisition_source TEXT,
  referral_code TEXT,
  campaign_code TEXT,
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_events_thread_time ON conversation_events (thread_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_events_workflow_type ON conversation_events (business_workflow, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_events_attribution ON conversation_events (campaign_code, referral_code, occurred_at DESC);

CREATE TABLE IF NOT EXISTS message_derivations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  source_message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  derivation_type TEXT NOT NULL CHECK (derivation_type IN (
    'summary','translation','transcript','intent','entity_extraction','suggested_reply','image_classification','document_extraction','next_best_action'
  )),
  source_language TEXT,
  target_language TEXT,
  model_provider TEXT,
  model_name TEXT,
  model_version TEXT,
  output_text TEXT,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  human_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_derivations_thread ON message_derivations (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_derivations_source ON message_derivations (source_message_id, derivation_type);

-- Participant authorization helper avoids recursive RLS when a participant asks to
-- read the participant set for a conversation. Fixed search_path + SECURITY DEFINER
-- keeps the helper narrow and auditable.
CREATE OR REPLACE FUNCTION public.communication_is_thread_participant(p_thread_id UUID, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.message_participants mp
    WHERE mp.thread_id = p_thread_id
      AND mp.user_id = p_user_id
      AND mp.left_at IS NULL
      AND COALESCE((mp.permissions ->> 'read')::boolean, TRUE) = TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.communication_is_thread_participant(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_is_thread_participant(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "message_threads_user_read" ON message_threads;
CREATE POLICY "message_threads_participant_read" ON message_threads
  FOR SELECT TO authenticated
  USING (
    primary_user_id = (select auth.uid())::text
    OR public.communication_is_thread_participant(id, (select auth.uid())::text)
  );

DROP POLICY IF EXISTS "messages_user_read" ON messages;
CREATE POLICY "messages_participant_read" ON messages
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

DROP POLICY IF EXISTS "message_participants_user_read" ON message_participants;
CREATE POLICY "message_participants_thread_read" ON message_participants
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

ALTER TABLE conversation_channel_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_brand_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_derivations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversation_channel_bindings_participant_read" ON conversation_channel_bindings
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

CREATE POLICY "message_parts_participant_read" ON message_parts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = message_parts.message_id
      AND public.communication_is_thread_participant(m.thread_id, (select auth.uid())::text)
  ));

CREATE POLICY "conversation_events_participant_read" ON conversation_events
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

CREATE POLICY "message_derivations_participant_read" ON message_derivations
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

CREATE POLICY "communication_templates_authenticated_read" ON communication_templates
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "communication_template_versions_authenticated_read" ON communication_template_versions
  FOR SELECT TO authenticated USING (approval_status = 'approved');
CREATE POLICY "communication_brand_assets_authenticated_read" ON communication_brand_assets
  FOR SELECT TO authenticated USING (active = TRUE AND authorized = TRUE);

-- +migrate Down
DROP POLICY IF EXISTS "communication_brand_assets_authenticated_read" ON communication_brand_assets;
DROP POLICY IF EXISTS "communication_template_versions_authenticated_read" ON communication_template_versions;
DROP POLICY IF EXISTS "communication_templates_authenticated_read" ON communication_templates;
DROP POLICY IF EXISTS "message_derivations_participant_read" ON message_derivations;
DROP POLICY IF EXISTS "conversation_events_participant_read" ON conversation_events;
DROP POLICY IF EXISTS "message_parts_participant_read" ON message_parts;
DROP POLICY IF EXISTS "conversation_channel_bindings_participant_read" ON conversation_channel_bindings;

DROP TABLE IF EXISTS message_derivations;
DROP TABLE IF EXISTS conversation_events;
DROP TABLE IF EXISTS communication_brand_assets;
DROP TABLE IF EXISTS communication_template_versions;
DROP TABLE IF EXISTS communication_templates;
DROP TABLE IF EXISTS message_parts;
DROP TABLE IF EXISTS conversation_channel_bindings;

DROP POLICY IF EXISTS "message_participants_thread_read" ON message_participants;
DROP POLICY IF EXISTS "messages_participant_read" ON messages;
DROP POLICY IF EXISTS "message_threads_participant_read" ON message_threads;

CREATE POLICY "message_threads_user_read" ON message_threads
  FOR SELECT TO authenticated
  USING (primary_user_id = (select auth.uid())::text);
CREATE POLICY "messages_user_read" ON messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM message_threads mt
    WHERE mt.id = messages.thread_id AND mt.primary_user_id = (select auth.uid())::text
  ));
CREATE POLICY "message_participants_user_read" ON message_participants
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid())::text);

DROP FUNCTION IF EXISTS public.communication_is_thread_participant(UUID, TEXT);

DROP INDEX IF EXISTS idx_message_threads_funnel;
DROP INDEX IF EXISTS idx_message_threads_workflow_updated;
DROP INDEX IF EXISTS idx_message_participants_active_thread_role;
DROP INDEX IF EXISTS idx_message_participants_active_user_thread;

ALTER TABLE message_participants DROP COLUMN IF EXISTS channel_preference_override;
ALTER TABLE message_participants DROP COLUMN IF EXISTS notification_policy;
ALTER TABLE message_participants DROP COLUMN IF EXISTS stakeholder_role;
ALTER TABLE message_participants DROP COLUMN IF EXISTS permissions;

ALTER TABLE message_threads DROP COLUMN IF EXISTS last_outbound_at;
ALTER TABLE message_threads DROP COLUMN IF EXISTS last_inbound_at;
ALTER TABLE message_threads DROP COLUMN IF EXISTS assigned_user_id;
ALTER TABLE message_threads DROP COLUMN IF EXISTS conversion_status;
ALTER TABLE message_threads DROP COLUMN IF EXISTS funnel_stage;
ALTER TABLE message_threads DROP COLUMN IF EXISTS business_workflow;
