-- +migrate Up
-- =============================================================
-- Trade OS T2/T3 — register the sourcing and logistics lifecycle templates in the GOVERNED registry.
--
-- The notification policies for diaspora.rfq.* and diaspora.logistics.* bind templateKey
-- 'rfq_update_v1' / 'logistics_update_v1', but those keys existed only as in-code compatibility
-- mirrors (communicationTemplateService.js). The governed registry fails CLOSED for an
-- unregistered key once the registry relation exists — deliberately, so ungoverned copy can never
-- ship — which means on any environment with the Communications 2.0 schema every T2 sourcing and
-- T3 logistics lifecycle notification dead-letters at render time. Measured on staging: 60 queued
-- diaspora.logistics.* events, and a registry containing only 'container_booking_update'.
--
-- Wording is bounded exactly like the container template it mirrors: the notification reports the
-- recorded lifecycle status of a request/offer and nothing further — never payment, customs,
-- carrier acceptance or shipment claims.
-- =============================================================

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('rfq_update_v1', 'marketplace', 'customer', 'transactional', 'diaspora', 'active', '{"purpose":"sourcing_lifecycle"}'::jsonb),
  ('logistics_update_v1', 'container_logistics', 'customer', 'transactional', 'logistics', 'active', '{"purpose":"logistics_lifecycle"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Sourcing request {{reference}}',
       'Sourcing request {{reference}} update: {{status}}. Route: {{route}}.',
       '["reference","status","route"]'::jsonb, '[]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='rfq_update_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Shipping request {{reference}}',
       'Shipping request {{reference}} update: {{status}}. Route: {{route}}.',
       '["reference","status","route"]'::jsonb, '[]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='logistics_update_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
-- No destructive rollback: retiring a governed template is its own reviewed decision
-- (set status rather than deleting history).
