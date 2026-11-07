-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
-- CARUP-DEALER-ONB-001 D6/C08-C12: THE canonical approved legal-dealer bridge.
-- No production country policy is preapproved. Operator/legal policy authority
-- is a separate controlled database process, not a self-service API or payment.
CREATE TABLE dealer_country_legal_policy_authority (
  country_code TEXT NOT NULL CHECK(country_code ~ '^[A-Z]{2}$'),
  policy_version TEXT NOT NULL,
  policy_state TEXT NOT NULL CHECK(policy_state IN ('DRAFT','APPROVED','SUSPENDED','WITHDRAWN')),
  approval_evidence_sha256 TEXT CHECK(approval_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(country_code,policy_version),
  CHECK (policy_state<>'APPROVED' OR (
    approval_evidence_sha256 IS NOT NULL AND effective_at IS NOT NULL
    AND expires_at IS NOT NULL AND approved_by IS NOT NULL))
);
-- Published draft by default; a legal officer must independently approve policy.
INSERT INTO dealer_country_legal_policy_authority(country_code,policy_version,policy_state)
VALUES('ZW','CARUP_DEALER_ZW_DRAFT_2026_11_03','DRAFT') ON CONFLICT DO NOTHING;
ALTER TABLE dealer_country_legal_policy_authority ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_country_legal_policy_authority FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_country_legal_policy_authority TO service_role;
COMMENT ON TABLE dealer_country_legal_policy_authority IS
 'Approval controlled outside Dealer API; no approved country policies created by migration. A draft cannot certify real dealers. Never infer approval from research labels.';

CREATE TABLE dealer_legal_application_reviews (
  legal_review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL UNIQUE REFERENCES dealer_claim_compliance_submissions(submission_id) ON DELETE RESTRICT,
  claimant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  country_code TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  company_registration_evidence_id UUID NOT NULL REFERENCES dealer_claim_private_evidence(evidence_id) ON DELETE RESTRICT,
  signatory_evidence_id UUID NOT NULL REFERENCES dealer_claim_private_evidence(evidence_id) ON DELETE RESTRICT,
  verified_issuer TEXT NOT NULL CHECK(length(btrim(verified_issuer)) BETWEEN 3 AND 180),
  reviewed_registration_number TEXT NOT NULL CHECK(length(btrim(reviewed_registration_number)) BETWEEN 2 AND 180),
  approved_scope TEXT NOT NULL CHECK(approved_scope IN ('BRANCH','PARENT_ORGANIZATION')),
  legal_expires_at TIMESTAMPTZ NOT NULL,
  legal_review_reason TEXT NOT NULL CHECK(length(btrim(legal_review_reason)) BETWEEN 80 AND 3000),
  verdict TEXT NOT NULL CHECK(verdict='COMPLIANCE_APPROVED'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(country_code,policy_version)
    REFERENCES dealer_country_legal_policy_authority(country_code,policy_version) ON DELETE RESTRICT,
  CHECK (claimant_user_id<>reviewer_user_id)
);
CREATE TRIGGER dealer_legal_application_reviews_no_update BEFORE UPDATE
 ON dealer_legal_application_reviews FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_legal_application_reviews_no_delete BEFORE DELETE
 ON dealer_legal_application_reviews FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
ALTER TABLE dealer_legal_application_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_legal_application_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_legal_application_reviews TO service_role;

-- One verified legal claim may create ONE canonical organization/tenant,
-- NEVER a second parallel organization. Existing unrelated organizations are
-- not reassigned or silently merged by name/domain/address/phone.
CREATE TABLE dealer_approved_seed_links (
  link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_dealer_id TEXT NOT NULL UNIQUE REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  claim_id UUID NOT NULL UNIQUE REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  submission_id UUID NOT NULL UNIQUE REFERENCES dealer_claim_compliance_submissions(submission_id) ON DELETE RESTRICT,
  legal_review_id UUID NOT NULL UNIQUE REFERENCES dealer_legal_application_reviews(legal_review_id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  dealer_profile_id UUID NOT NULL UNIQUE REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
  claimant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operating_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK(operating_status IN ('ACTIVE','SUSPENDED','WITHDRAWN')),
  activated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(claim_id,tenant_id,claimant_user_id)
);
CREATE INDEX dealer_approved_seed_links_claimant ON dealer_approved_seed_links(claimant_user_id,operating_status);
ALTER TABLE dealer_approved_seed_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_approved_seed_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_approved_seed_links TO service_role;

CREATE OR REPLACE FUNCTION dealer_record_legal_application_approval(
 p_submission_id UUID,p_reviewer_id TEXT,p_policy_version TEXT,
 p_company_evidence_id UUID,p_signatory_evidence_id UUID,
 p_issuer TEXT,p_registration_number TEXT,p_scope TEXT,
 p_expires_at TIMESTAMPTZ,p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 s dealer_claim_compliance_submissions%ROWTYPE;
 c dealer_research_claim_requests%ROWTYPE;
 p dealer_country_legal_policy_authority%ROWTYPE;
 r users%ROWTYPE;
 pr dealer_claim_compliance_review_events%ROWTYPE;
 eb dealer_claim_private_evidence%ROWTYPE;
 es dealer_claim_private_evidence%ROWTYPE;
 v_id UUID;
 v_business JSONB;
BEGIN
 SELECT * INTO s FROM dealer_claim_compliance_submissions
  WHERE submission_id=p_submission_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_APPLICATION_NOT_FOUND'; END IF;
 SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id=s.claim_id FOR UPDATE;
 IF NOT FOUND OR c.claim_status<>'CLAIM_APPROVED' OR
  c.claimant_user_id<>s.claimant_user_id THEN
  RAISE EXCEPTION 'LEGAL_CLAIM_NOT_APPROVED'; END IF;
 SELECT * INTO r FROM users WHERE id=p_reviewer_id;
 IF NOT FOUND OR r.is_verified IS DISTINCT FROM true OR
    r.role NOT IN ('admin','reviewer','platform_admin','super_admin') OR
    r.id=s.claimant_user_id THEN
   RAISE EXCEPTION 'INDEPENDENT_LEGAL_REVIEWER_REQUIRED'; END IF;
 SELECT * INTO pr FROM dealer_claim_compliance_review_events
  WHERE submission_id=p_submission_id;
 IF NOT FOUND OR pr.verdict<>'READY_FOR_REGULATORY_REVIEW' OR
    pr.reviewer_user_id=p_reviewer_id THEN
   RAISE EXCEPTION 'SEPARATE_PRELIMINARY_REVIEW_REQUIRED'; END IF;
 v_business:=s.application_snapshot->'tab_rows'->'BUSINESS'->0;
 IF v_business IS NULL OR coalesce(v_business->>'operating_country','')<>'ZW' OR
   coalesce(v_business->>'research_confirmation','') NOT IN ('YES','CORRECT') OR
   nullif(btrim(v_business->>'legal_name'),'') IS NULL THEN
   RAISE EXCEPTION 'LEGAL_APPLICATION_IDENTITY_INCOMPLETE'; END IF;
 SELECT * INTO p FROM dealer_country_legal_policy_authority
  WHERE country_code='ZW' AND policy_version=p_policy_version FOR SHARE;
 IF NOT FOUND OR p.policy_state<>'APPROVED' OR p.effective_at>now() OR
   p.expires_at<=now() OR p.approval_evidence_sha256 IS NULL THEN
   RAISE EXCEPTION 'APPROVED_CURRENT_COUNTRY_POLICY_REQUIRED'; END IF;
 IF p.approved_by=p_reviewer_id THEN
   RAISE EXCEPTION 'COUNTRY_POLICY_OWNER_CANNOT_SELF_CERTIFY_CASE'; END IF;
 IF p_scope IS DISTINCT FROM c.claimed_scope OR
   length(btrim(coalesce(p_issuer,''))) NOT BETWEEN 3 AND 180 OR
   length(btrim(coalesce(p_registration_number,''))) NOT BETWEEN 2 AND 180 OR
   length(btrim(coalesce(p_reason,''))) NOT BETWEEN 80 AND 3000 OR
   p_expires_at IS NULL OR p_expires_at<=now() OR
   p_expires_at>p.expires_at THEN
   RAISE EXCEPTION 'LEGAL_EVIDENCE_SCOPE_EXPIRY_OR_REASON_INVALID'; END IF;
 IF coalesce(v_business->>'registration_number','')<>p_registration_number THEN
   RAISE EXCEPTION 'LEGAL_REGISTRATION_NUMBER_MISMATCH'; END IF;
 SELECT * INTO eb FROM dealer_claim_private_evidence WHERE
   evidence_id=p_company_evidence_id AND claim_id=c.claim_id AND
   uploader_user_id=c.claimant_user_id AND
   document_class='COMPANY_REGISTRATION' AND scan_state='CLEAN_CLAMAV_AT_UPLOAD';
 SELECT * INTO es FROM dealer_claim_private_evidence WHERE
   evidence_id=p_signatory_evidence_id AND claim_id=c.claim_id AND
   uploader_user_id=c.claimant_user_id AND
   document_class IN ('SIGNATORY_MANDATE','DIRECTOR_AUTHORITY') AND
   scan_state='CLEAN_CLAMAV_AT_UPLOAD';
 IF eb.evidence_id IS NULL OR es.evidence_id IS NULL OR
   eb.evidence_id=es.evidence_id THEN
   RAISE EXCEPTION 'TWO_INDEPENDENT_ORIGINAL_AUTHORITY_DOCUMENTS_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM dealer_claim_compliance_submissions
   WHERE claim_id=c.claim_id AND submitted_at>s.submitted_at) THEN
   RAISE EXCEPTION 'OUTDATED_APPLICATION_CANNOT_BE_APPROVED'; END IF;
 IF EXISTS(SELECT 1 FROM dealer_research_claim_requests
   WHERE seed_dealer_id=c.seed_dealer_id AND claim_id<>c.claim_id
   AND claim_status NOT IN ('CLAIM_REJECTED','CLAIM_REVOKED')) THEN
   RAISE EXCEPTION 'COMPETING_LIVE_CLAIMS_REQUIRE_RESOLUTION'; END IF;
 INSERT INTO dealer_legal_application_reviews(
  submission_id,claimant_user_id,reviewer_user_id,country_code,policy_version,
  company_registration_evidence_id,signatory_evidence_id,
  verified_issuer,reviewed_registration_number,approved_scope,legal_expires_at,
  legal_review_reason,verdict)
 VALUES (s.submission_id,c.claimant_user_id,p_reviewer_id,'ZW',p_policy_version,
  p_company_evidence_id,p_signatory_evidence_id,btrim(p_issuer),
  btrim(p_registration_number),p_scope,p_expires_at,btrim(p_reason),'COMPLIANCE_APPROVED')
 ON CONFLICT (submission_id) DO NOTHING RETURNING legal_review_id INTO v_id;
 IF v_id IS NULL THEN
   SELECT legal_review_id INTO v_id FROM dealer_legal_application_reviews
     WHERE submission_id=s.submission_id AND reviewer_user_id=p_reviewer_id AND
       policy_version=p_policy_version AND
       company_registration_evidence_id=p_company_evidence_id AND
       signatory_evidence_id=p_signatory_evidence_id AND
       reviewed_registration_number=p_registration_number AND
       legal_expires_at=p_expires_at;
   IF v_id IS NULL THEN RAISE EXCEPTION 'LEGAL_DECISION_ALREADY_RECORDED'; END IF;
 END IF;
 RETURN jsonb_build_object('legal_review_id',v_id,'submission_id',s.submission_id,
   'policy_version',p_policy_version,'legal_review_recorded',true,
   'tenant_activated',false,'public_verified',false,'stock_authorized',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_legal_application_approval(
 UUID,TEXT,TEXT,UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_legal_application_approval(
 UUID,TEXT,TEXT,UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION dealer_activate_approved_legal_claim(
 p_legal_review_id UUID,p_approver_id TEXT,p_activation_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 l dealer_legal_application_reviews%ROWTYPE;
 s dealer_claim_compliance_submissions%ROWTYPE;
 c dealer_research_claim_requests%ROWTYPE;
 p dealer_country_legal_policy_authority%ROWTYPE;
 r users%ROWTYPE;
 v_link dealer_approved_seed_links%ROWTYPE;
 v_tenant UUID;v_profile UUID;v_organization TEXT;v_org_role TEXT;v_member TEXT;
 v_name TEXT;v_branch JSONB;v_branch_id UUID;
 v_prev RECORD;
BEGIN
 IF length(btrim(coalesce(p_activation_reason,''))) NOT BETWEEN 80 AND 3000 THEN
   RAISE EXCEPTION 'ACTIVATION_REASON_REQUIRED'; END IF;
 SELECT * INTO l FROM dealer_legal_application_reviews
   WHERE legal_review_id=p_legal_review_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_REVIEW_NOT_FOUND'; END IF;
 SELECT * INTO s FROM dealer_claim_compliance_submissions
   WHERE submission_id=l.submission_id FOR UPDATE;
 SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id=s.claim_id FOR UPDATE;
 SELECT * INTO r FROM users WHERE id=p_approver_id;
 IF NOT FOUND OR r.role NOT IN ('admin','reviewer','platform_admin','super_admin') OR
   r.is_verified IS DISTINCT FROM true OR r.id=s.claimant_user_id OR
   r.id=l.reviewer_user_id THEN RAISE EXCEPTION 'SEPARATE_ACTIVATION_APPROVER_REQUIRED'; END IF;
 IF c.claim_status<>'CLAIM_APPROVED' OR c.claimant_user_id<>s.claimant_user_id THEN
   RAISE EXCEPTION 'CLAIM_AUTHORITY_EXPIRED'; END IF;
 SELECT * INTO p FROM dealer_country_legal_policy_authority
  WHERE country_code=l.country_code AND policy_version=l.policy_version FOR SHARE;
 IF NOT FOUND OR p.policy_state<>'APPROVED' OR p.effective_at>now() OR
    p.expires_at<=now() OR l.legal_expires_at<=now() OR
    p.approved_by=p_approver_id THEN
   RAISE EXCEPTION 'LIVE_COUNTRY_LEGAL_POLICY_REQUIRED'; END IF;
 SELECT * INTO v_link FROM dealer_approved_seed_links WHERE claim_id=c.claim_id FOR UPDATE;
 IF FOUND THEN
   IF v_link.operating_status<>'ACTIVE' OR v_link.legal_review_id<>l.legal_review_id
     THEN RAISE EXCEPTION 'ACTIVATION_EXISTS_OR_SUSPENDED'; END IF;
   RETURN jsonb_build_object('idempotent',true,'organization_id',v_link.organization_id,
     'tenant_id',v_link.tenant_id,'dealer_profile_id',v_link.dealer_profile_id,
     'owner_membership_recorded',true,'vehicle_listing_authority_granted',false,
     'public_verified_badge_granted',false,'payment_entitlement_granted',false);
 END IF;
 IF EXISTS(SELECT 1 FROM dealer_approved_seed_links WHERE seed_dealer_id=c.seed_dealer_id) THEN
   RAISE EXCEPTION 'SEED_ALREADY_BOUND_TO_DIFFERENT_APPROVED_ENTITY'; END IF;
 IF EXISTS(SELECT 1 FROM dealer_claim_compliance_submissions
   WHERE claim_id=c.claim_id AND submitted_at>s.submitted_at) THEN
   RAISE EXCEPTION 'STALE_LEGAL_APPLICATION_CANNOT_ACTIVATE'; END IF;
 IF EXISTS(SELECT 1 FROM dealer_research_claim_requests
   WHERE seed_dealer_id=c.seed_dealer_id AND claim_id<>c.claim_id
   AND claim_status NOT IN ('CLAIM_REJECTED','CLAIM_REVOKED')) THEN
   RAISE EXCEPTION 'COMPETING_LIVE_CLAIM'; END IF;
 v_name:=btrim(s.application_snapshot->'tab_rows'->'BUSINESS'->0->>'legal_name');
 v_branch:=s.application_snapshot->'tab_rows'->'BRANCHES'->0;
 IF v_name IS NULL OR v_name='' OR v_branch IS NULL OR
    nullif(btrim(v_branch->>'branch_name'),'') IS NULL THEN
   RAISE EXCEPTION 'CANNOT_ACTIVATE_WITHOUT_LEGAL_COMPANY_AND_BRANCH'; END IF;
 v_organization:='dealer_org_'||lower(replace(c.seed_dealer_id,'-','_'));
 v_org_role:='dealer_owner_role_'||lower(replace(c.seed_dealer_id,'-','_'));
 v_member:='dealer_owner_user_'||lower(replace(c.seed_dealer_id,'-','_'));
 -- Do NOT seize an organization by matching its trading name, email or website.
 IF EXISTS(SELECT 1 FROM organizations WHERE id=v_organization) THEN
   RAISE EXCEPTION 'PREEXISTING_ORGANIZATION_NEEDS_MANUAL_LEGAL_RECONCILIATION'; END IF;
 IF (SELECT count(*) FROM dealer_profiles WHERE user_id=c.claimant_user_id)>1 THEN
   RAISE EXCEPTION 'AMBIGUOUS_PREEXISTING_DEALER_PROFILES'; END IF;
 SELECT * INTO v_prev FROM dealer_profiles
   WHERE user_id=c.claimant_user_id FOR UPDATE;
 IF FOUND AND (v_prev.tenant_id IS NOT NULL OR
   v_prev.identity_status<>'unverified' OR
   v_prev.compliance_review_state NOT IN ('not_started','in_review') OR
   v_prev.active_state<>'inactive' OR
   v_prev.restriction_state<>'none' OR
   v_prev.suspension_state<>'none' OR
   v_prev.investigation_state<>'none') THEN
   RAISE EXCEPTION 'PREEXISTING_DEALER_REQUIRES_INDEPENDENT_RECONCILIATION';
 END IF;
 INSERT INTO tenants(name,type,status) VALUES(v_name,'dealership','active')
   RETURNING id INTO v_tenant;
 INSERT INTO organizations(id,name,type,created_at,status,tenant_id)
   VALUES(v_organization,v_name,'dealership',now()::text,'active',v_tenant);
 INSERT INTO organization_roles(id,organization_id,name,level,description)
   VALUES(v_org_role,v_organization,'Dealer legal owner',100,
     'Independently approved legal dealership membership only');
 INSERT INTO organization_users(id,organization_id,user_id,role_id,status,joined_at)
   VALUES(v_member,v_organization,c.claimant_user_id,v_org_role,'active',now()::text);
 INSERT INTO tenant_users(tenant_id,user_id,role)
   VALUES(v_tenant,c.claimant_user_id,'dealer');
 -- Keep the applicant's canonical user.role unchanged. Verified tenant membership
 -- and server-computed permissions, not a self-assigned global role, are the grant.
 IF v_prev.id IS NOT NULL THEN
   UPDATE dealer_profiles SET tenant_id=v_tenant::text,legal_name=v_name,
    trading_name=nullif(btrim(s.application_snapshot->'tab_rows'->'BUSINESS'->0->>'trading_name'),''),
    operating_country=l.country_code,
    registration_number=l.reviewed_registration_number,identity_status='verified',
    business_evidence_status='complete',compliance_review_state='passed',
    active_state='active',restriction_state='none',suspension_state='none',
    investigation_state='none',listing_limit=0,expiry_date=l.legal_expires_at,
    updated_at=now()
    WHERE id=v_prev.id RETURNING id INTO v_profile;
 ELSE
   INSERT INTO dealer_profiles(
    user_id,tenant_id,legal_name,trading_name,operating_country,
    registration_number,identity_status,business_evidence_status,
    compliance_review_state,active_state,restriction_state,suspension_state,
    investigation_state,listing_limit,expiry_date)
   VALUES(c.claimant_user_id,v_tenant::text,v_name,
    nullif(btrim(s.application_snapshot->'tab_rows'->'BUSINESS'->0->>'trading_name'),''),
    l.country_code,l.reviewed_registration_number,'verified','complete','passed',
    'active','none','none','none',0,l.legal_expires_at)
   RETURNING id INTO v_profile;
 END IF;
 INSERT INTO dealer_branches(dealer_id,name,address) VALUES(v_profile,
   nullif(btrim(v_branch->>'branch_name'),''),
   nullif(btrim(v_branch->>'physical_address'),'')) RETURNING id INTO v_branch_id;
 INSERT INTO dealer_approved_seed_links(seed_dealer_id,claim_id,submission_id,
  legal_review_id,organization_id,tenant_id,dealer_profile_id,
  claimant_user_id,activated_by)
 VALUES(c.seed_dealer_id,c.claim_id,s.submission_id,l.legal_review_id,
  v_organization,v_tenant,v_profile,c.claimant_user_id,p_approver_id);
 RETURN jsonb_build_object('idempotent',false,
  'seed_dealer_id',c.seed_dealer_id,'organization_id',v_organization,
  'tenant_id',v_tenant,'dealer_profile_id',v_profile,
  'initial_branch_id',v_branch_id,'owner_membership_recorded',true,
  'vehicle_listing_authority_granted',false,'public_verified_badge_granted',false,
  'payment_entitlement_granted',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_activate_approved_legal_claim(UUID,TEXT,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_activate_approved_legal_claim(UUID,TEXT,TEXT) TO service_role;

-- New claimant revocation immediately suspends the managed dealer operations;
-- canonical legacy dealers without seed links are untouched.
CREATE OR REPLACE FUNCTION dealer_suspend_revoked_seed_claim()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v dealer_approved_seed_links%ROWTYPE;
BEGIN
 IF NEW.claim_status NOT IN ('CLAIM_REVOKED','CLAIM_DISPUTED','CLAIM_REJECTED')
   OR NEW.claim_status=OLD.claim_status THEN RETURN NEW; END IF;
 SELECT * INTO v FROM dealer_approved_seed_links WHERE claim_id=NEW.claim_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 -- R6 DBA #4 lock order (docs/dealership/R6_DBA_OPERATIONS_AND_LOCK_ORDER.md): tenants →
 -- dealer_profiles → published programme vehicles (ascending VIN) → dealer_approved_seed_links,
 -- the same order as the governed lifecycle decision and the canonical vehicle write guard.
 PERFORM 1 FROM tenants WHERE id=v.tenant_id FOR NO KEY UPDATE;
 PERFORM 1 FROM dealer_profiles WHERE id=v.dealer_profile_id FOR NO KEY UPDATE;
 PERFORM 1 FROM vehicles WHERE tenant_id=v.tenant_id AND publication_status='published'
   ORDER BY vin FOR NO KEY UPDATE;
 SELECT * INTO v FROM dealer_approved_seed_links WHERE link_id=v.link_id FOR UPDATE;
 UPDATE dealer_approved_seed_links SET operating_status='SUSPENDED' WHERE link_id=v.link_id;
 UPDATE dealer_profiles SET active_state='inactive',
   suspension_state='suspended',updated_at=now() WHERE id=v.dealer_profile_id;
 UPDATE tenants SET status='suspended',updated_at=now() WHERE id=v.tenant_id;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS dealer_claim_approved_operating_revocation ON dealer_research_claim_requests;
CREATE TRIGGER dealer_claim_approved_operating_revocation
AFTER UPDATE OF claim_status ON dealer_research_claim_requests
FOR EACH ROW EXECUTE FUNCTION dealer_suspend_revoked_seed_claim();

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM dealer_approved_seed_links) OR
    EXISTS(SELECT 1 FROM dealer_legal_application_reviews) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_LEGAL_ACTIVATION_CUSTODY';
 END IF;
 -- R6 DBA review 2 #5: a country policy decision (anything beyond the DRAFT row this
 -- migration seeds itself) is governance custody; dropping the table would erase it.
 IF EXISTS(SELECT 1 FROM dealer_country_legal_policy_authority
           WHERE NOT (country_code='ZW' AND policy_version='CARUP_DEALER_ZW_DRAFT_2026_11_03'
                      AND policy_state='DRAFT')) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_COUNTRY_POLICY_CUSTODY';
 END IF;
END;
$$;
DROP TRIGGER IF EXISTS dealer_claim_approved_operating_revocation ON dealer_research_claim_requests;
DROP FUNCTION IF EXISTS dealer_suspend_revoked_seed_claim();
DROP FUNCTION IF EXISTS dealer_activate_approved_legal_claim(UUID,TEXT,TEXT);
DROP FUNCTION IF EXISTS dealer_record_legal_application_approval(UUID,TEXT,TEXT,UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT);
DROP TABLE IF EXISTS dealer_approved_seed_links;
DROP TABLE IF EXISTS dealer_legal_application_reviews;
DROP TABLE IF EXISTS dealer_country_legal_policy_authority;
