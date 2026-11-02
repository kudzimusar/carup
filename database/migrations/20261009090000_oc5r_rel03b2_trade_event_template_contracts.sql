-- +migrate Up
-- OC-5R-REL-03B-2 — split warehouse, loading and shipment-exception communication contracts.
--
-- Historical T9/T10 events carry reference + headline and no route. T7 shipment exceptions carry
-- reference + stage. They were incorrectly bound to logistics_update_v1, whose T3 contract must
-- remain reference + status + route. These new templates repeat only facts already persisted in
-- the domain event and deliberately make no price, payment, customs-clearance, departure or Trust
-- claim.

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('warehouse_intake_update_v1', 'container_logistics', 'customer', 'transactional', 'logistics', 'active', '{"purpose":"warehouse_intake_update","trade_os_phase":"T9"}'::jsonb),
  ('container_loading_update_v1', 'container_logistics', 'customer', 'transactional', 'logistics', 'active', '{"purpose":"container_loading_update","trade_os_phase":"T10"}'::jsonb),
  ('shipment_exception_v1', 'diaspora_import', 'customer', 'transactional', 'diaspora', 'active', '{"purpose":"shipment_exception","trade_os_phase":"T7"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Warehouse intake {{reference}}',
       '{{headline}} Reference: {{reference}}.',
       '["reference","headline"]'::jsonb, '[]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='warehouse_intake_update_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Container loading {{reference}}',
       '{{headline}} Reference: {{reference}}.',
       '["reference","headline"]'::jsonb, '[]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='container_loading_update_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Shipment exception {{reference}}',
       'Shipment {{reference}} stage: {{stage}}.',
       '["reference","stage"]'::jsonb, '[]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='shipment_exception_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
-- No destructive rollback: retiring an approved governed template is a separately reviewed action.
