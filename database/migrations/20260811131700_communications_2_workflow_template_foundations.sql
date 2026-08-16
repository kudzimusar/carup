-- +migrate Up
-- Communications 2.0 reusable workflow + governed template foundations.
-- Implementation target: docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md,
-- sections 7.1, 9, 12, 15-23, 28 Phase 3 and Phase 6.

ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS conversation_type TEXT;
UPDATE message_threads SET conversation_type = COALESCE(conversation_type, thread_type) WHERE conversation_type IS NULL;
CREATE INDEX IF NOT EXISTS idx_message_threads_conversation_type ON message_threads (conversation_type, updated_at DESC);

-- Initial professional registry entries. Provider template references remain NULL
-- until the relevant provider separately approves/assigns one; no provider approval
-- is fabricated by this migration.
INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('marketplace_availability_reply', 'marketplace', 'buyer', 'transactional', 'marketplace', 'active', '{"purpose":"availability_response"}'::jsonb),
  ('dealer_lead_acknowledgement', 'dealer', 'buyer', 'transactional', 'dealer_sales', 'active', '{"purpose":"lead_acknowledgement"}'::jsonb),
  ('garage_booking_confirmation', 'garage', 'vehicle_owner', 'transactional', 'garage_service', 'active', '{"purpose":"booking_confirmation"}'::jsonb),
  ('insurance_document_request', 'insurance', 'vehicle_owner', 'service', 'insurance', 'active', '{"purpose":"document_request"}'::jsonb),
  ('finance_document_request', 'finance', 'applicant', 'service', 'finance', 'active', '{"purpose":"document_request","regulated_human_review":true}'::jsonb),
  ('parts_quote_ready', 'parts', 'buyer', 'transactional', 'parts', 'active', '{"purpose":"quote_ready"}'::jsonb),
  ('diaspora_shipment_update', 'diaspora_import', 'customer', 'transactional', 'diaspora', 'active', '{"purpose":"shipment_milestone"}'::jsonb),
  ('container_booking_update', 'container_logistics', 'customer', 'transactional', 'logistics', 'active', '{"purpose":"booking_update"}'::jsonb),
  ('government_case_status', 'government_public_service', 'citizen', 'service', 'public_services', 'active', '{"purpose":"case_status","official_branding_requires_authorization":true}'::jsonb),
  ('referral_conversion_update', 'referral', 'referrer', 'transactional', 'growth', 'active', '{"purpose":"referral_outcome"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Vehicle availability',
       '{{vehicle}} — {{availability}}. Reply here to keep the Marketplace conversation and listing context together.',
       '["vehicle","availability"]'::jsonb, '["seller_name"]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='marketplace_availability_reply'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Your dealer enquiry',
       '{{dealer}} received your enquiry about {{vehicle}}. {{representative}} can continue with you in this CarUp conversation.',
       '["dealer","vehicle"]'::jsonb, '["representative"]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='dealer_lead_acknowledgement'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Service booking confirmed',
       '{{garage}} confirmed your {{vehicle}} booking for {{appointment_time}}. Reference: {{reference}}.',
       '["garage","vehicle","appointment_time","reference"]'::jsonb, '[]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='garage_booking_confirmation'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'email', 'en', 'Documents needed for {{reference}}',
       'To continue your insurance request {{reference}}, please provide: {{document_list}}. Use the secure CarUp link in this conversation when available.',
       '["reference","document_list"]'::jsonb, '["insurer"]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='insurance_document_request'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'email', 'en', 'Finance application {{reference}} — documents required',
       'Your finance application {{reference}} requires: {{document_list}}. This message does not represent an approval or lending decision.',
       '["reference","document_list"]'::jsonb, '["lender"]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='finance_document_request'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Parts quote ready',
       'Your quote for {{part}} for {{vehicle}} is ready: {{quote_reference}}. Confirm compatibility details in CarUp before ordering.',
       '["part","vehicle","quote_reference"]'::jsonb, '["price"]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='parts_quote_ready'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Shipment update {{reference}}',
       '{{reference}} is now at {{milestone}}. Continue here for documents, exceptions and next steps.',
       '["reference","milestone"]'::jsonb, '["eta"]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='diaspora_shipment_update'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Container booking {{reference}}',
       'Container booking {{reference}} status: {{status}}. Route: {{route}}.',
       '["reference","status","route"]'::jsonb, '["departure_date"]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='container_booking_update'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Case {{reference}} status',
       'Case {{reference}} status: {{status}}. Authority: {{authority}}. Official branding is shown only when authorized.',
       '["reference","status","authority"]'::jsonb, '["next_action"]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='government_case_status'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template, required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Referral {{reference}} update',
       'Referral {{reference}} status: {{status}}. Any reward remains subject to the recorded CarUp referral terms and successful conversion.',
       '["reference","status"]'::jsonb, '["reward"]'::jsonb, 'approved', '{}'::jsonb
FROM communication_templates WHERE template_key='referral_conversion_update'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
DELETE FROM communication_template_versions
WHERE template_id IN (
  SELECT id FROM communication_templates WHERE template_key IN (
    'marketplace_availability_reply','dealer_lead_acknowledgement','garage_booking_confirmation',
    'insurance_document_request','finance_document_request','parts_quote_ready',
    'diaspora_shipment_update','container_booking_update','government_case_status','referral_conversion_update'
  )
) AND version=1;

DELETE FROM communication_templates WHERE template_key IN (
  'marketplace_availability_reply','dealer_lead_acknowledgement','garage_booking_confirmation',
  'insurance_document_request','finance_document_request','parts_quote_ready',
  'diaspora_shipment_update','container_booking_update','government_case_status','referral_conversion_update'
);

DROP INDEX IF EXISTS idx_message_threads_conversation_type;
ALTER TABLE message_threads DROP COLUMN IF EXISTS conversation_type;
