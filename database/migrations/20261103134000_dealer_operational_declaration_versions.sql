-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
-- CARUP DEALERSHIP 1.0 D7 C13 C20 C21 C22: versioned private
-- applicant/operator declarations. This is not a legal, finance, licence,
-- public publication, warranty verification or merchant authority table.
-- Canonical dealer_profile/tenant_users/dealer_approved_seed_links stay owner.
CREATE TABLE dealer_operational_declaration_events (
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 dealer_profile_id UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 section TEXT NOT NULL CHECK(section IN (
  'BUSINESS_OVERVIEW','BUYER_ASSURANCE','FINANCE_TERMS',
  'SOURCING','WARRANTY_AFTERSALES','SERVICE_CAPABILITIES')),
 section_version INTEGER NOT NULL CHECK(section_version>=1),
 declared_values JSONB NOT NULL CHECK(jsonb_typeof(declared_values)='object'),
 content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 publication_approved BOOLEAN NOT NULL DEFAULT false CHECK(publication_approved=false),
 independent_legal_verification BOOLEAN NOT NULL DEFAULT false CHECK(independent_legal_verification=false),
 UNIQUE(dealer_profile_id,section,section_version)
);
CREATE INDEX dealer_operational_declarations_latest
 ON dealer_operational_declaration_events(dealer_profile_id,section,section_version DESC);
ALTER TABLE dealer_operational_declaration_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_operational_declaration_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_operational_declaration_events TO service_role;
CREATE TRIGGER dealer_operational_declaration_no_update
 BEFORE UPDATE ON dealer_operational_declaration_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_operational_declaration_no_delete
 BEFORE DELETE ON dealer_operational_declaration_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
COMMENT ON TABLE dealer_operational_declaration_events IS
 'Private versioned truthful owner declarations; contents are not independently verified, public, priced, approved warranties, staff rights or legal compliance.';

CREATE FUNCTION dealer_record_operational_declaration(
 p_profile_id UUID,p_tenant_id UUID,p_actor_id TEXT,p_section TEXT,
 p_expected_version INTEGER,p_values JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 d dealer_profiles%ROWTYPE;
 l dealer_approved_seed_links%ROWTYPE;
 m tenant_users%ROWTYPE;
 t tenants%ROWTYPE;
 law dealer_legal_application_reviews%ROWTYPE;
 policy dealer_country_legal_policy_authority%ROWTYPE;
 latest dealer_operational_declaration_events%ROWTYPE;
 v_sha TEXT;v_id UUID;v_version INTEGER;v_valid TEXT[];v_key TEXT;
BEGIN
 IF p_section NOT IN ('BUSINESS_OVERVIEW','BUYER_ASSURANCE','FINANCE_TERMS',
  'SOURCING','WARRANTY_AFTERSALES','SERVICE_CAPABILITIES') OR
  p_expected_version IS NULL OR p_expected_version<0 OR
  jsonb_typeof(p_values)<>'object' OR p_values='{}'::jsonb OR
  length(p_values::text)>6500 THEN
  RAISE EXCEPTION 'INVALID_DEALER_OPERATION_DECLARATION';
 END IF;
 SELECT * INTO d FROM dealer_profiles WHERE id=p_profile_id FOR UPDATE;
 SELECT * INTO l FROM dealer_approved_seed_links
  WHERE dealer_profile_id=p_profile_id AND tenant_id=p_tenant_id
    AND claimant_user_id=p_actor_id AND operating_status='ACTIVE';
 SELECT * INTO t FROM tenants WHERE id=p_tenant_id;
 SELECT * INTO m FROM tenant_users
  WHERE tenant_id=p_tenant_id AND user_id=p_actor_id;
 SELECT * INTO law FROM dealer_legal_application_reviews
  WHERE legal_review_id=l.legal_review_id;
 SELECT * INTO policy FROM dealer_country_legal_policy_authority
  WHERE country_code=law.country_code AND policy_version=law.policy_version;
 IF d.id IS NULL OR l.link_id IS NULL OR t.id IS NULL OR m.user_id IS NULL OR
  d.user_id<>p_actor_id OR d.tenant_id<>p_tenant_id::text OR
  t.type<>'dealership' OR t.status<>'active' OR
  m.role NOT IN ('dealer','admin') OR
  d.active_state<>'active' OR d.identity_status<>'verified' OR
  d.compliance_review_state<>'passed' OR
  d.restriction_state<>'none' OR d.suspension_state<>'none' OR
  d.investigation_state<>'none' OR coalesce(d.expiry_date,'epoch'::timestamptz)<=now() OR
  coalesce(policy.policy_state,'')<>'APPROVED' OR
  coalesce(policy.effective_at,'infinity'::timestamptz)>now() OR
  coalesce(policy.expires_at,'epoch'::timestamptz)<=now() OR
  coalesce(law.legal_expires_at,'epoch'::timestamptz)<=now() THEN
  RAISE EXCEPTION 'ACTIVE_CANONICAL_DEALER_OWNER_AND_POLICY_REQUIRED';
 END IF;
 v_valid:=CASE p_section
 WHEN 'BUSINESS_OVERVIEW' THEN ARRAY['public_description','trading_name','declared_contact_email','opening_hours_note']
 WHEN 'BUYER_ASSURANCE' THEN ARRAY['inspection_rights','cancellation_policy','refund_policy','dispute_resolution']
 WHEN 'FINANCE_TERMS' THEN ARRAY['deposit_terms','accepted_payment_methods','finance_partner_disclosure','currency_disclosure']
 WHEN 'SOURCING' THEN ARRAY['sourcing_channels','import_duty_disclosure','customs_handling']
 WHEN 'WARRANTY_AFTERSALES' THEN ARRAY['warranty_scope','warranty_exclusions','repair_support','spare_parts_support']
 WHEN 'SERVICE_CAPABILITIES' THEN ARRAY['workshop_services','inspection_services','buyer_support_hours']
 END;
 FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
  IF NOT v_key=ANY(v_valid) OR
    jsonb_typeof(p_values->v_key)<>'string' OR
    length(btrim(p_values->>v_key))>750 OR
    length(btrim(p_values->>v_key))=0 OR
    (p_values->>v_key) ~ '[[:cntrl:]]' OR
    (p_values->>v_key) ~ '<[A-Za-z/!]' THEN
    RAISE EXCEPTION 'UNAPPROVED_OPERATION_FIELD_OR_UNSAFE_TEXT';
  END IF;
 END LOOP;
 SELECT * INTO latest FROM dealer_operational_declaration_events
  WHERE dealer_profile_id=p_profile_id AND section=p_section
  ORDER BY section_version DESC LIMIT 1;
 v_sha:=encode(sha256(convert_to(p_values::text,'UTF8')),'hex');
 IF latest.event_id IS NOT NULL AND latest.content_sha256=v_sha THEN
  RETURN jsonb_build_object('event_id',latest.event_id,'section',p_section,
   'version',latest.section_version,'idempotent',true,
   'private_declaration_only',true,'public_approved',false);
 END IF;
 IF coalesce(latest.section_version,0)<>p_expected_version THEN
  RAISE EXCEPTION 'STALE_OPERATION_SECTION_VERSION';
 END IF;
 v_version:=p_expected_version+1;
 INSERT INTO dealer_operational_declaration_events(
  dealer_profile_id,tenant_id,actor_user_id,section,section_version,
  declared_values,content_sha256
 ) VALUES (p_profile_id,p_tenant_id,p_actor_id,p_section,v_version,p_values,v_sha)
 RETURNING event_id INTO v_id;
 RETURN jsonb_build_object('event_id',v_id,'section',p_section,'version',v_version,
  'idempotent',false,'private_declaration_only',true,'public_approved',false,
  'staff_rights_issued',false,'payment_entitlement_issued',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_operational_declaration(UUID,UUID,TEXT,TEXT,INTEGER,JSONB)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_operational_declaration(UUID,UUID,TEXT,TEXT,INTEGER,JSONB)
 TO service_role;

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM dealer_operational_declaration_events) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_DEALER_DECLARATION_CUSTODY';
 END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_record_operational_declaration(UUID,UUID,TEXT,TEXT,INTEGER,JSONB);
DROP TABLE IF EXISTS dealer_operational_declaration_events;
