-- +migrate Up
-- OC-5G — register the six templates live notification policies bind and no migration ever inserted:
-- verification_decision_v1, listing_moderation_v1, evidence_review_v1, seller_authority_v1,
-- vehicle_trust_update_v1 and safetrade_transaction_v1. Wherever the governed registry is applied, an
-- unregistered key fails closed (template_not_registered), the outbox retries and the event
-- dead-letters, so none of these people were ever told:
--   - identity decisions;
--   - listing moderation;
--   - evidence reviews;
--   - seller-authority decisions;
--   - Vehicle Passport trust changes;
--   - all ten SafeTrade stages.
--
-- Channels follow the policies:
--   - The four in-app-only policies (policyChannelsOnly) get an `in_app` version. The registry approves
--     exactly what the policy allows, so an off-policy route fails closed instead of sending.
--   - Vehicle trust and SafeTrade route by preference (in_app or email by policy, widened by the person's
--     own choice), so theirs is `default`. Their email bodies are built by R5/R4; the subject is theirs.
--
-- Copy:
--   - Four are the owning lanes' existing in-code mirrors, verbatim, except one correction. The
--     seller-authority mirror said "was reviewed by CarUp: {{decision}}", and `under_review` is a valid
--     decision, so it read "was reviewed by CarUp: Seller authority under CarUp review".
--   - The two new bodies state governed facts only: the vehicle, and where to look. They make no stage,
--     payment or score claim. R4/R5's rules forbid inventing those, and nothing in the variables maps
--     them safely. Their subjects are the lanes' own R4/R5 headings.
--
-- A version attaches only to a template THIS migration registered. If another lane registered a key
-- first, its registration governs, and nothing here is added beside it.
--
-- Every required variable is one the emitter always feeds, and never a placeholder default
-- (backend/tests/oc5g-policy-template-registry.test.js). No template renders `{{reason}}`: listing
-- moderation carries the moderator's free text in its payload, and it must never reach the owner.

INSERT INTO communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('verification_decision_v1', 'identity_verification', 'account_holder', 'transactional', 'trust_safety', 'active',
   '{"source":"oc5g_policy_templates","lane":"identity_verification","copy":"lane_mirror"}'::jsonb),
  ('listing_moderation_v1', 'marketplace_moderation', 'vehicle_owner', 'transactional', 'marketplace', 'active',
   '{"source":"oc5g_policy_templates","lane":"marketplace_moderation","copy":"lane_mirror"}'::jsonb),
  ('evidence_review_v1', 'evidence_review', 'evidence_submitter', 'transactional', 'trust_safety', 'active',
   '{"source":"oc5g_policy_templates","lane":"evidence_review","copy":"lane_mirror"}'::jsonb),
  ('seller_authority_v1', 'seller_authority', 'seller', 'transactional', 'operations', 'active',
   '{"source":"oc5g_policy_templates","lane":"operations_m2","copy":"lane_mirror_corrected"}'::jsonb),
  ('vehicle_trust_update_v1', 'vehicle_trust', 'vehicle_owner', 'service', 'trust', 'active',
   '{"source":"oc5g_policy_templates","lane":"vehicle_trust","copy":"oc5g_minimal","email_reference":"R5"}'::jsonb),
  ('safetrade_transaction_v1', 'safetrade', 'transaction_party', 'transactional', 'safetrade', 'active',
   '{"source":"oc5g_policy_templates","lane":"safetrade","copy":"oc5g_minimal","email_reference":"R4"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Identity verification decision',
       'Your CarUp identity verification ({{reference}}) has an outcome: {{decision}}. This decision comes from CarUp verification records.',
       '["reference","decision"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"oc5g_policy_templates","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates WHERE template_key='verification_decision_v1'
  AND COALESCE(metadata->>'source', '') = 'oc5g_policy_templates'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Marketplace listing update',
       'Your listing {{listing_id}} received a moderation decision: {{decision}}. Current status: {{status}}.',
       '["listing_id","decision","status"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"oc5g_policy_templates","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates WHERE template_key='listing_moderation_v1'
  AND COALESCE(metadata->>'source', '') = 'oc5g_policy_templates'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Evidence review decision',
       'Evidence {{reference}} for listing {{listing_id}} was reviewed: {{decision}}.',
       '["reference","listing_id","decision"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"oc5g_policy_templates","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates WHERE template_key='evidence_review_v1'
  AND COALESCE(metadata->>'source', '') = 'oc5g_policy_templates'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'in_app', 'en', 'Seller authority decision',
       'CarUp updated the seller authority for vehicle {{listing_id}}: {{decision}}.',
       '["listing_id","decision"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"oc5g_policy_templates","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates WHERE template_key='seller_authority_v1'
  AND COALESCE(metadata->>'source', '') = 'oc5g_policy_templates'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'Your Vehicle Passport was updated',
       'The Vehicle Passport for vehicle {{listing_id}} was updated. Open your vehicle record on CarUp to see what changed.',
       '["listing_id"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"oc5g_policy_templates","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates WHERE template_key='vehicle_trust_update_v1'
  AND COALESCE(metadata->>'source', '') = 'oc5g_policy_templates'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en', 'Your SafeTrade journey',
       'There is an update on your SafeTrade journey for vehicle {{listing_id}}. Open CarUp to see its current stage. Always confirm payment details on CarUp itself, and never send money to someone because a message asked you to.',
       '["listing_id"]'::jsonb, '[]'::jsonb, 'approved', '{"source":"oc5g_policy_templates","compatibility":"fallback_parity"}'::jsonb
FROM communication_templates WHERE template_key='safetrade_transaction_v1'
  AND COALESCE(metadata->>'source', '') = 'oc5g_policy_templates'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
DELETE FROM communication_template_versions
WHERE template_id IN (SELECT id FROM communication_templates WHERE template_key IN (
        'verification_decision_v1', 'listing_moderation_v1', 'evidence_review_v1',
        'seller_authority_v1', 'vehicle_trust_update_v1', 'safetrade_transaction_v1'))
  AND version = 1 AND language = 'en'
  AND COALESCE(experiment_metadata->>'source', '') = 'oc5g_policy_templates';
DELETE FROM communication_templates
WHERE template_key IN (
        'verification_decision_v1', 'listing_moderation_v1', 'evidence_review_v1',
        'seller_authority_v1', 'vehicle_trust_update_v1', 'safetrade_transaction_v1')
  AND COALESCE(metadata->>'source', '') = 'oc5g_policy_templates';
