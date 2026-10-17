-- +migrate Up
-- O2/P5 (ported by OC-4D from PR #208) — governed Dealer Compliance decision template.
--
-- `dealer.compliance.decided` is subscribed by Communications and rendered through the governed
-- template registry. Once that registry exists, an unregistered key fails closed
-- (`template_not_registered`), so the policy needs its registry row to deliver at all. The payload
-- the emitter sends is safe structured facts only — the reviewer's free-text reason stays in the
-- dealer decision ledger and is never a template variable here.
--
-- Transactional and in-app only, like the other policy-driven trust notifications.

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  (
    'dealer_compliance_decision_v1',
    'dealer_compliance',
    'dealer',
    'transactional',
    'trust_safety',
    'active',
    '{"source":"o2_p5","legal_authority":"dealer_compliance_decisions"}'::jsonb
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
  'Dealer compliance decision',
  'Your dealer application received a CarUp decision: {{decision}}.',
  '["decision"]'::jsonb,
  '[]'::jsonb,
  'approved',
  '{"source":"o2_p5","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates
WHERE template_key='dealer_compliance_decision_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
DELETE FROM communication_template_versions
WHERE template_id IN (
  SELECT id FROM communication_templates WHERE template_key='dealer_compliance_decision_v1'
)
AND version=1
AND channel='default'
AND language='en'
AND COALESCE(experiment_metadata->>'source','')='o2_p5';

DELETE FROM communication_templates
WHERE template_key='dealer_compliance_decision_v1'
AND COALESCE(metadata->>'source','')='o2_p5';
