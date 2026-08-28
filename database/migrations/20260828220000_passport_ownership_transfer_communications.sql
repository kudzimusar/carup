-- +migrate Up
-- Passport V16 — governed ownership-transfer communication template.
-- The policy is transactional and in-app only until canonical recipient-address
-- enrichment exists for policy-driven notifications.

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  (
    'ownership_transfer_v1',
    'vehicle_ownership',
    'vehicle_owner',
    'transactional',
    'trust_safety',
    'active',
    '{"source":"passport_v16","legal_authority":"vehicle_ownership_transfers"}'::jsonb
  )
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (
    template_id, version, channel, language, subject_template, body_template,
    required_variables, optional_variables, approval_status, experiment_metadata
  )
SELECT
  id,
  1,
  'default',
  'en',
  'Vehicle ownership transfer update',
  'Ownership transfer for {{listing_id}} is {{status}}. Reference: {{reference}}. CarUp changes legal ownership only after governed completion.',
  '["listing_id","status","reference"]'::jsonb,
  '[]'::jsonb,
  'approved',
  '{"source":"passport_v16","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates
WHERE template_key='ownership_transfer_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
DELETE FROM communication_template_versions
WHERE template_id IN (
  SELECT id FROM communication_templates WHERE template_key='ownership_transfer_v1'
)
AND version=1
AND channel='default'
AND language='en'
AND COALESCE(experiment_metadata->>'source','')='passport_v16';

DELETE FROM communication_templates
WHERE template_key='ownership_transfer_v1'
AND COALESCE(metadata->>'source','')='passport_v16';
