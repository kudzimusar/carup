-- +migrate Up
-- O2-X6 (ported by OC-5C from PR #208 3b4a5598, which emitted these events and never registered their
-- templates) — the three semantic People events reach the person through the GOVERNED template
-- registry. Wherever the registry is applied an unregistered key fails closed (template_not_registered),
-- so each policy ships its registration. Copy is factual transactional copy owned by its domain; the
-- variables are safe structured facts — a subject-facing status label and applicant guidance
-- (identity), requirement labels (dealer), the vehicle reference (seller). No reviewer free text, no
-- evidence links, never the internal 'compromised' state or a takeover reason code.
-- Transactional and in-app only, like the other policy-driven trust notifications.

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('identity_lifecycle_v1', 'identity_lifecycle', 'account_holder', 'transactional', 'trust_safety', 'active',
   '{"source":"o2_x6","legal_authority":"identity_lifecycle_events"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'Your CarUp identity status changed', 'Your identity status is now: {{status}}. {{summary}}',
       '["status","summary"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"o2_x6","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates
WHERE template_key='identity_lifecycle_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('dealer_evidence_required_v1', 'dealer_compliance', 'dealer', 'transactional', 'trust_safety', 'active',
   '{"source":"o2_x6","legal_authority":"dealer_compliance_requirements"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'Your dealer application still needs items', 'To continue your dealer application, CarUp still needs: {{summary}}.',
       '["summary"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"o2_x6","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates
WHERE template_key='dealer_evidence_required_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('seller_authority_superseded_v1', 'seller_authority', 'seller', 'transactional', 'trust_safety', 'active',
   '{"source":"o2_x6","legal_authority":"vehicle_seller_authority"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'Seller authority ended', 'Your seller authority for vehicle {{listing_id}} ended because ownership transferred. No action is needed.',
       '["listing_id"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"o2_x6","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates
WHERE template_key='seller_authority_superseded_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
DELETE FROM communication_template_versions
WHERE template_id IN (SELECT id FROM communication_templates WHERE template_key='identity_lifecycle_v1')
  AND version=1 AND channel='default' AND language='en'
  AND COALESCE(experiment_metadata->>'source','')='o2_x6';
DELETE FROM communication_templates
WHERE template_key='identity_lifecycle_v1' AND COALESCE(metadata->>'source','')='o2_x6';

DELETE FROM communication_template_versions
WHERE template_id IN (SELECT id FROM communication_templates WHERE template_key='dealer_evidence_required_v1')
  AND version=1 AND channel='default' AND language='en'
  AND COALESCE(experiment_metadata->>'source','')='o2_x6';
DELETE FROM communication_templates
WHERE template_key='dealer_evidence_required_v1' AND COALESCE(metadata->>'source','')='o2_x6';

DELETE FROM communication_template_versions
WHERE template_id IN (SELECT id FROM communication_templates WHERE template_key='seller_authority_superseded_v1')
  AND version=1 AND channel='default' AND language='en'
  AND COALESCE(experiment_metadata->>'source','')='o2_x6';
DELETE FROM communication_templates
WHERE template_key='seller_authority_superseded_v1' AND COALESCE(metadata->>'source','')='o2_x6';
