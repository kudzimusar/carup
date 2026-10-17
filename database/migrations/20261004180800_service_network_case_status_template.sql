-- +migrate Up
-- OC-5D (F3) — register `service_case_status_v1`, the template the Service Network's four customer-facing
-- case transitions bind (service.case.accepted / .declined / .completed, service.work.started). PR #197
-- bound it in four notification policies and never registered it: wherever the governed registry is
-- applied an unregistered key fails closed (template_not_registered), so every one of those
-- notifications would have dead-lettered and the customer would never have been told.
--
-- In-app only, like the policies. Factual copy: the vehicle and the case's recorded status, nothing
-- further — never the garage's private notes, the request summary, a price or a promise about the work.
-- The variables are exactly the ones the notification service derives from the case event payload
-- (listing_id ← vin, status ← the case status).

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('service_case_status_v1', 'service_network', 'customer', 'transactional', 'service_network', 'active',
   '{"source":"oc5d_service_network","purpose":"service_case_lifecycle"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Your service request was updated',
       'Your service request for vehicle {{listing_id}} is now: {{status}}.',
       '["listing_id","status"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"oc5d_service_network","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates
WHERE template_key='service_case_status_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
DELETE FROM communication_template_versions
WHERE template_id IN (SELECT id FROM communication_templates WHERE template_key='service_case_status_v1')
  AND version=1 AND channel='in_app' AND language='en'
  AND COALESCE(experiment_metadata->>'source','')='oc5d_service_network';
DELETE FROM communication_templates
WHERE template_key='service_case_status_v1' AND COALESCE(metadata->>'source','')='oc5d_service_network';
