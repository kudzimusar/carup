-- +migrate Up
-- Communications 2.0 — bind the two owner-created Meta WhatsApp templates to the governed registry.
--
-- Migrations 315–323 deliberately shipped these two governed rows with
-- provider_template_reference NULL, because the Meta-side templates did not exist yet:
--
--   * conversation_reply_whatsapp_v1 (service) carries
--     experiment_metadata.provider_approval_status = 'pending_configuration', which is exactly
--     this binding waiting to happen. Business-initiated WhatsApp fails closed without it.
--   * carup_reengagement_v1 (marketing) shipped in_app and email versions only, so a WhatsApp
--     marketing campaign resolves no approved version and is refused at approval time.
--
-- The owner has since created and Meta has approved both templates. This migration records the
-- provider references; it does not create templates, change copy, or enable any send.
--
-- The two references are deliberately different templates. carup_conversation_reply is a UTILITY
-- template and may never carry marketing content; carup_reengagement_v1 is the MARKETING template
-- and is the only one a campaign may use. The campaign path resolves the reference from the
-- campaign's own governed template, so binding them separately is what keeps that boundary real.
--
-- The two provider references carry DIFFERENT language tags, and that is not a typo. Read from the
-- provider on 2026-08-13, Meta registers carup_conversation_reply under en_US and
-- carup_reengagement_v1 under en. A provider reference is name|language and must match the account
-- exactly, so binding the marketing template as |en_US would produce a row that looks correct in the
-- ledger and fails at send time with "template does not exist". The reference follows the provider;
-- the provider is not reshaped to make the two look tidy.

UPDATE communication_template_versions v
SET provider_template_reference = 'carup_conversation_reply|en_US',
    experiment_metadata = COALESCE(v.experiment_metadata, '{}'::jsonb)
      || jsonb_build_object(
           'provider_approval_status', 'approved',
           'provider_bound_by', 'migration:20260813060000'
         )
FROM communication_templates t
WHERE v.template_id = t.id
  AND t.template_key = 'conversation_reply_whatsapp_v1'
  AND v.version = 1
  AND v.channel = 'whatsapp'
  AND v.language = 'en'
  AND v.provider_template_reference IS NULL;

-- The marketing WhatsApp version. Copy mirrors the approved in_app/email control exactly, so the
-- canonical CarUp message record says the same thing the provider template says. Required
-- variables stay empty: the campaign path sends no body parameters, so a template expecting them
-- would be rejected by Meta at send time rather than silently delivering something else.
-- The reference is carup_reengagement_v1|en because that is the language Meta has it under.
INSERT INTO communication_template_versions (
  template_id, version, channel, language, subject_template, body_template,
  required_variables, optional_variables, provider_template_reference,
  cta_definitions, legal_footer_rules, approval_status, approved_by, approved_at,
  experiment_metadata
)
SELECT
  t.id, 1, 'whatsapp', 'en',
  'A CarUp update for you',
  'There is something new in CarUp that may be relevant to you. Open CarUp to continue. You can change marketing preferences at any time.',
  '[]'::jsonb,
  '["first_name","campaign_name","campaign_code"]'::jsonb,
  'carup_reengagement_v1|en',
  '[]'::jsonb,
  jsonb_build_object('preference_controls_required', true),
  'approved',
  'migration:20260813060000',
  now(),
  jsonb_build_object(
    'communications_2_phase', 7,
    'variant', 'control',
    'migration_owner', '20260813060000',
    'provider_approval_status', 'approved'
  )
FROM communication_templates t
WHERE t.template_key = 'carup_reengagement_v1'
  AND t.classification = 'marketing'
  AND NOT EXISTS (
    SELECT 1 FROM communication_template_versions v
    WHERE v.template_id = t.id AND v.version = 1 AND v.channel = 'whatsapp' AND v.language = 'en'
  );

-- +migrate Down
-- Unbind only what this migration bound. A reference set by any other means survives.
--
-- The parentheses are load-bearing: `-` binds tighter than `||`, so without them
-- `a || b - 'provider_bound_by'` deletes the key from the freshly built object (where it does not
-- exist) and leaves the real marker in place — Down would then match again on a later run and
-- clear a reference someone else had set.
UPDATE communication_template_versions v
SET provider_template_reference = NULL,
    experiment_metadata = (
      COALESCE(v.experiment_metadata, '{}'::jsonb)
        || jsonb_build_object('provider_approval_status', 'pending_configuration')
    ) - 'provider_bound_by'
FROM communication_templates t
WHERE v.template_id = t.id
  AND t.template_key = 'conversation_reply_whatsapp_v1'
  AND v.experiment_metadata ->> 'provider_bound_by' = 'migration:20260813060000';

DELETE FROM communication_template_versions
WHERE approved_by = 'migration:20260813060000'
  AND experiment_metadata ->> 'migration_owner' = '20260813060000';
