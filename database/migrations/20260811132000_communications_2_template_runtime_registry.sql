-- +migrate Up
-- Communications 2.0 runtime template registry migration.
-- Implementation target: docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md,
-- sections 12, 25, 28 Phase 3, 29 and 31.
--
-- Migrate the existing proven in-code notification strings into approved governed
-- DB versions verbatim. Runtime can therefore prefer the DB registry after this
-- migration without changing provider-visible copy during the compatibility cutover.

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('message_acknowledgement_v1', 'support', 'customer', 'transactional', 'support', 'active', '{"compatibility_source":"legacy_template_service"}'::jsonb),
  ('human_handoff_v1', 'support', 'customer', 'service', 'support', 'active', '{"compatibility_source":"legacy_template_service","human_review":true}'::jsonb),
  ('marketplace_inquiry_received_v1', 'marketplace', 'buyer', 'transactional', 'marketplace', 'active', '{"compatibility_source":"legacy_template_service"}'::jsonb),
  ('listing_shared_v1', 'marketplace', 'customer', 'marketing', 'growth', 'active', '{"compatibility_source":"legacy_template_service"}'::jsonb),
  ('escrow_status_v1', 'safepay', 'customer', 'transactional', 'safepay', 'active', '{"compatibility_source":"legacy_template_service","high_risk":true}'::jsonb),
  ('finance_status_v1', 'finance', 'applicant', 'transactional', 'finance', 'active', '{"compatibility_source":"legacy_template_service","high_risk":true}'::jsonb),
  ('support_resolved_v1', 'support', 'customer', 'service', 'support', 'active', '{"compatibility_source":"legacy_template_service"}'::jsonb),
  ('delivery_failure_fallback_v1', 'support', 'customer', 'transactional', 'communications', 'active', '{"compatibility_source":"legacy_template_service"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'CarUp received your message',
       'CarUp received your message about {{topic}}. We will keep this thread updated.',
       '["topic"]'::jsonb, '[]'::jsonb, 'approved', '{"compatibility":"verbatim"}'::jsonb
FROM communication_templates WHERE template_key='message_acknowledgement_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'A CarUp specialist is reviewing this',
       'A CarUp {{team}} specialist has been asked to review this thread. Reference: {{reference}}.',
       '["team","reference"]'::jsonb, '[]'::jsonb, 'approved', '{"compatibility":"verbatim"}'::jsonb
FROM communication_templates WHERE template_key='human_handoff_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'Marketplace inquiry received',
       'Your marketplace inquiry for {{listing_id}} was received. CarUp will notify the relevant seller or team.',
       '["listing_id"]'::jsonb, '[]'::jsonb, 'approved', '{"compatibility":"verbatim"}'::jsonb
FROM communication_templates WHERE template_key='marketplace_inquiry_received_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'CarUp listing shared',
       '{{share_text}} {{share_url}}',
       '["share_text","share_url"]'::jsonb, '[]'::jsonb, 'approved', '{"compatibility":"verbatim"}'::jsonb
FROM communication_templates WHERE template_key='listing_shared_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'SafePay escrow update',
       'SafePay escrow {{escrow_id}} is now {{status}}. This status comes from CarUp backend records.',
       '["escrow_id","status"]'::jsonb, '[]'::jsonb, 'approved', '{"compatibility":"verbatim"}'::jsonb
FROM communication_templates WHERE template_key='escrow_status_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'Finance application update',
       'Finance application {{application_id}} status: {{status}}. This update comes from CarUp backend records.',
       '["application_id","status"]'::jsonb, '[]'::jsonb, 'approved', '{"compatibility":"verbatim"}'::jsonb
FROM communication_templates WHERE template_key='finance_status_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'CarUp support thread resolved',
       'Thread {{reference}} was marked resolved: {{summary}}',
       '["reference","summary"]'::jsonb, '[]'::jsonb, 'approved', '{"compatibility":"verbatim"}'::jsonb
FROM communication_templates WHERE template_key='support_resolved_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'CarUp delivery fallback',
       'We could not deliver the previous message through {{failed_channel}}, so we are using this permitted fallback channel.',
       '["failed_channel"]'::jsonb, '[]'::jsonb, 'approved', '{"compatibility":"verbatim"}'::jsonb
FROM communication_templates WHERE template_key='delivery_failure_fallback_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
-- Remove only versions that this migration can positively identify as its own.
-- Pre-existing rows with the same key/version survive rollback.
DELETE FROM communication_template_versions
WHERE template_id IN (
  SELECT id FROM communication_templates WHERE template_key IN (
    'message_acknowledgement_v1','human_handoff_v1','marketplace_inquiry_received_v1','listing_shared_v1',
    'escrow_status_v1','finance_status_v1','support_resolved_v1','delivery_failure_fallback_v1'
  )
)
AND version=1
AND channel='default'
AND language='en'
AND COALESCE(experiment_metadata->>'compatibility','')='verbatim';

DELETE FROM communication_templates
WHERE template_key IN (
  'message_acknowledgement_v1','human_handoff_v1','marketplace_inquiry_received_v1','listing_shared_v1',
  'escrow_status_v1','finance_status_v1','support_resolved_v1','delivery_failure_fallback_v1'
)
AND COALESCE(metadata->>'compatibility_source','')='legacy_template_service';
