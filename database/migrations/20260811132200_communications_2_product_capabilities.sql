-- +migrate Up
-- Communications 2.0 product capability closure:
-- governed business-initiated WhatsApp template contract.
--
-- Provider approval is intentionally NOT fabricated here. CarUp owns the governed
-- template semantics; Meta's approved template name/language is configured later in
-- provider_template_reference after external approval.

INSERT INTO communication_templates (
  template_key, business_workflow, stakeholder_audience, classification,
  owner_team, status, metadata
)
VALUES (
  'conversation_reply_whatsapp_v1',
  'communications',
  'conversation_participant',
  'service',
  'communications',
  'active',
  jsonb_build_object(
    'communications_2_capability', 'business_initiated_whatsapp',
    'meta_approval_required', true,
    'provider_approval_status', 'pending_configuration',
    'migration_owner', '20260811132200'
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
  t.id,
  1,
  'whatsapp',
  'en',
  NULL,
  '{{message}}',
  '["message"]'::jsonb,
  '[]'::jsonb,
  NULL,
  '[]'::jsonb,
  '{}'::jsonb,
  'approved',
  'migration:20260811132200',
  now(),
  jsonb_build_object(
    'communications_2_capability', 'business_initiated_whatsapp',
    'meta_approval_required', true,
    'provider_approval_status', 'pending_configuration',
    'migration_owner', '20260811132200'
  )
FROM communication_templates t
WHERE t.template_key='conversation_reply_whatsapp_v1'
  AND NOT EXISTS (
    SELECT 1
    FROM communication_template_versions v
    WHERE v.template_id=t.id
      AND v.version=1
      AND v.channel='whatsapp'
      AND v.language='en'
  );

-- +migrate Down
DELETE FROM communication_template_versions
WHERE approved_by='migration:20260811132200'
  AND experiment_metadata ->> 'migration_owner'='20260811132200';

DELETE FROM communication_templates t
WHERE t.template_key='conversation_reply_whatsapp_v1'
  AND t.metadata ->> 'migration_owner'='20260811132200'
  AND NOT EXISTS (
    SELECT 1 FROM communication_template_versions v WHERE v.template_id=t.id
  );
