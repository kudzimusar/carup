-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
-- D8 C18/C19/C20-C22: independently approved buyer-safe full storefront.
-- Keep same research-derived stable slug and never publish private evidence,
-- tax numbers, staff, finance accounts, VINs, source contacts or unreviewed logos.
CREATE TABLE dealer_full_storefront_review_events (
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
 link_id UUID NOT NULL REFERENCES dealer_approved_seed_links(link_id) ON DELETE RESTRICT,
 reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 disposition TEXT NOT NULL CHECK(disposition IN ('PUBLISHED_FULL','RETRACTED')),
 public_name TEXT NOT NULL CHECK(length(btrim(public_name)) BETWEEN 2 AND 180),
 public_city TEXT NOT NULL CHECK(length(btrim(public_city)) BETWEEN 2 AND 100),
 approved_branch_snapshot JSONB NOT NULL CHECK(jsonb_typeof(approved_branch_snapshot)='array'),
 dealer_declared_sections JSONB NOT NULL CHECK(jsonb_typeof(dealer_declared_sections)='object'),
 reviewer_reason TEXT NOT NULL CHECK(length(btrim(reviewer_reason)) BETWEEN 80 AND 3000),
 publication_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (disposition<>'RETRACTED' OR (
   approved_branch_snapshot='[]'::jsonb AND dealer_declared_sections='{}'::jsonb))
);
CREATE INDEX dealer_full_storefront_review_latest ON dealer_full_storefront_review_events(
 seed_dealer_id,publication_reviewed_at DESC,event_id DESC);
ALTER TABLE dealer_full_storefront_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_full_storefront_review_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_full_storefront_review_events TO service_role;
CREATE TRIGGER dealer_full_storefront_review_no_update
 BEFORE UPDATE ON dealer_full_storefront_review_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_full_storefront_review_no_delete
 BEFORE DELETE ON dealer_full_storefront_review_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
COMMENT ON TABLE dealer_full_storefront_review_events IS
 'Frozen separately reviewer-approved public display only. Dealer-declared terms retain their declared status, not legal warranty/lender/payment certification. Current public visibility is further constrained by live canonical policy and tenant state.';

CREATE FUNCTION dealer_review_full_storefront_publication(
 p_seed_id TEXT,p_reviewer_id TEXT,p_disposition TEXT,
 p_branch_ids UUID[],p_section_keys TEXT[],p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 reviewer users%ROWTYPE;
 link dealer_approved_seed_links%ROWTYPE;
 d dealer_profiles%ROWTYPE;
 t tenants%ROWTYPE;
 legal dealer_legal_application_reviews%ROWTYPE;
 policy dealer_country_legal_policy_authority%ROWTYPE;
 source_public dealer_research_public_profiles%ROWTYPE;
 c dealer_research_claim_requests%ROWTYPE;
 v_branches JSONB:='[]'::jsonb;
 v_sections JSONB:='{}'::jsonb;
 v_name TEXT;v_event UUID;
 v_key TEXT;v_count INTEGER;
BEGIN
 IF p_disposition NOT IN ('PUBLISHED_FULL','RETRACTED') OR
   length(btrim(coalesce(p_reason,''))) NOT BETWEEN 80 AND 3000 THEN
   RAISE EXCEPTION 'INVALID_FULL_STOREFRONT_REVIEW'; END IF;
 SELECT * INTO reviewer FROM users WHERE id=p_reviewer_id;
 IF NOT FOUND OR reviewer.role NOT IN ('admin','reviewer','platform_admin','super_admin')
   OR reviewer.is_verified IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'INDEPENDENT_PUBLIC_STOREFRONT_REVIEWER_REQUIRED'; END IF;
 SELECT * INTO source_public FROM dealer_research_public_profiles
   WHERE seed_dealer_id=p_seed_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUBLISHED_RESEARCH_IDENTITY_REQUIRED'; END IF;
 SELECT * INTO link FROM dealer_approved_seed_links WHERE seed_dealer_id=p_seed_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPROVED_LEGAL_DEALER_LINK_REQUIRED'; END IF;
 SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id=link.claim_id;
 SELECT * INTO d FROM dealer_profiles WHERE id=link.dealer_profile_id FOR UPDATE;
 SELECT * INTO t FROM tenants WHERE id=link.tenant_id;
 SELECT * INTO legal FROM dealer_legal_application_reviews WHERE legal_review_id=link.legal_review_id;
 SELECT * INTO policy FROM dealer_country_legal_policy_authority
   WHERE country_code=legal.country_code AND policy_version=legal.policy_version;
 IF reviewer.id=link.claimant_user_id OR reviewer.id=legal.reviewer_user_id OR
   reviewer.id=link.activated_by THEN
   RAISE EXCEPTION 'SEPARATE_PUBLIC_REVIEWER_REQUIRED'; END IF;
 v_name:=coalesce(nullif(btrim(d.trading_name),''),nullif(btrim(d.legal_name),''));
 IF v_name IS NULL THEN RAISE EXCEPTION 'VERIFIED_LEGAL_DISPLAY_NAME_REQUIRED'; END IF;
 IF p_disposition='PUBLISHED_FULL' THEN
   IF source_public.publication_status<>'PRELISTED_UNCLAIMED' OR
     link.operating_status<>'ACTIVE' OR
     c.claim_status<>'CLAIM_APPROVED' OR
     t.type<>'dealership' OR t.status<>'active' OR
     d.identity_status<>'verified' OR d.compliance_review_state<>'passed' OR
     d.active_state<>'active' OR d.restriction_state<>'none' OR
     d.suspension_state<>'none' OR d.investigation_state<>'none' OR
     coalesce(d.expiry_date,'epoch'::timestamptz)<=now() OR
     policy.policy_state<>'APPROVED' OR policy.effective_at>now() OR
     policy.expires_at<=now() OR legal.legal_expires_at<=now() OR
     NOT EXISTS(SELECT 1 FROM tenant_users m
       WHERE m.tenant_id=link.tenant_id AND m.user_id=link.claimant_user_id
         AND m.role IN ('dealer','admin')) THEN
     RAISE EXCEPTION 'LEGAL_DEALER_AND_RESEARCH_PUBLICATION_GATES_REQUIRED'; END IF;
   IF coalesce(array_length(p_branch_ids,1),0)<1 OR
      coalesce(array_length(p_branch_ids,1),0)>100 THEN
     RAISE EXCEPTION 'REVIEWED_PUBLIC_BRANCH_IDS_REQUIRED'; END IF;
   SELECT count(*) INTO v_count FROM (
     SELECT DISTINCT x FROM unnest(p_branch_ids) x
   ) AS requested;
   IF v_count<>array_length(p_branch_ids,1) THEN
     RAISE EXCEPTION 'DUPLICATE_REVIEWED_BRANCH_IDS'; END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object(
      'branch_id',b.id,'name',b.name,'address',b.address)
      ORDER BY b.id),'[]'::jsonb) INTO v_branches
     FROM dealer_branches b
     WHERE b.dealer_id=d.id AND b.id=ANY(p_branch_ids);
   IF jsonb_array_length(v_branches)<>array_length(p_branch_ids,1) OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(v_branches) b
        WHERE nullif(btrim(b->>'name'),'') IS NULL OR
              nullif(btrim(b->>'address'),'') IS NULL) THEN
     RAISE EXCEPTION 'REVIEWED_BRANCH_AUTHORITY_OR_ADDRESS_REQUIRED'; END IF;
   IF coalesce(array_length(p_section_keys,1),0)>6 THEN
     RAISE EXCEPTION 'TOO_MANY_PUBLIC_DECLARATION_SECTIONS'; END IF;
   FOR v_key IN SELECT DISTINCT unnest(coalesce(p_section_keys,ARRAY[]::text[])) LOOP
     IF v_key NOT IN ('BUSINESS_OVERVIEW','BUYER_ASSURANCE','FINANCE_TERMS',
       'SOURCING','WARRANTY_AFTERSALES','SERVICE_CAPABILITIES') THEN
       RAISE EXCEPTION 'INVALID_PUBLIC_SECTION'; END IF;
     -- Each section comes from immutable privately recorded canonical-owner
     -- declarations, selected by an INDEPENDENT PUBLICATION REVIEWER.
     SELECT v_sections || jsonb_build_object(v_key,e.declared_values)
     INTO v_sections FROM dealer_operational_declaration_events e
     WHERE e.dealer_profile_id=d.id AND e.tenant_id=link.tenant_id
       AND e.section=v_key ORDER BY e.section_version DESC LIMIT 1;
     IF NOT FOUND THEN RAISE EXCEPTION 'PUBLIC_SECTION_NOT_RECORDED'; END IF;
   END LOOP;
 ELSE
   -- Revocation of an old full storefront is always allowed by a separate
   -- reviewer even when claim or business operation has just been suspended.
   IF coalesce(array_length(p_branch_ids,1),0)>0 OR
      coalesce(array_length(p_section_keys,1),0)>0 THEN
     RAISE EXCEPTION 'FULL_PUBLIC_RETRACTION_CANNOT_ADD_DISPLAY_FIELDS'; END IF;
 END IF;
 INSERT INTO dealer_full_storefront_review_events(
   seed_dealer_id,link_id,reviewer_user_id,disposition,public_name,
   public_city,approved_branch_snapshot,dealer_declared_sections,reviewer_reason
 ) VALUES(p_seed_id,link.link_id,p_reviewer_id,p_disposition,v_name,
   source_public.public_city,v_branches,v_sections,btrim(p_reason))
 RETURNING event_id INTO v_event;
 RETURN jsonb_build_object('event_id',v_event,'seed_dealer_id',p_seed_id,
   'disposition',p_disposition,'public_full_approved',p_disposition='PUBLISHED_FULL',
   'verified_legal_business_only',true,'stock_verified',false,
   'logo_rights_approved',false,'merchant_or_subscription_approved',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_review_full_storefront_publication(TEXT,TEXT,TEXT,UUID[],TEXT[],TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_review_full_storefront_publication(TEXT,TEXT,TEXT,UUID[],TEXT[],TEXT)
 TO service_role;

-- Live fail-closed projection: suspensions, policy expiry, claim revocation,
-- prelisting suppression or membership removal immediately remove FULL status.
-- Only explicitly reviewed, buyer-safe snapshot columns are surfaced.
CREATE VIEW dealer_full_storefront_current WITH (security_barrier=true) AS
SELECT e.seed_dealer_id, p.public_slug, e.public_name,e.public_city,
  e.approved_branch_snapshot,e.dealer_declared_sections,
  e.publication_reviewed_at,e.event_id AS publication_event_id
FROM (
 SELECT DISTINCT ON(seed_dealer_id) *
 FROM dealer_full_storefront_review_events
 ORDER BY seed_dealer_id,publication_reviewed_at DESC,event_id DESC
) e
JOIN dealer_approved_seed_links l ON l.link_id=e.link_id AND l.operating_status='ACTIVE'
JOIN dealer_research_claim_requests c
 ON c.claim_id=l.claim_id AND c.claim_status='CLAIM_APPROVED'
JOIN dealer_profiles d ON d.id=l.dealer_profile_id
JOIN tenants t ON t.id=l.tenant_id
JOIN dealer_legal_application_reviews legal ON legal.legal_review_id=l.legal_review_id
JOIN dealer_country_legal_policy_authority policy ON
  policy.country_code=legal.country_code AND policy.policy_version=legal.policy_version
JOIN dealer_research_public_profiles p ON p.seed_dealer_id=e.seed_dealer_id
WHERE e.disposition='PUBLISHED_FULL'
  -- Security review #1: an approval older than the latest research takedown never revives by itself.
  AND NOT EXISTS(SELECT 1 FROM dealer_research_publication_events t
    WHERE t.seed_dealer_id=e.seed_dealer_id AND t.decision IN ('SUPPRESSED','UNDER_DISPUTE','DUPLICATE')
      AND t.recorded_at>=e.publication_reviewed_at)
  AND p.publication_status='PRELISTED_UNCLAIMED'
  AND t.type='dealership' AND t.status='active'
  AND d.identity_status='verified' AND d.compliance_review_state='passed'
  AND d.active_state='active' AND d.restriction_state='none'
  AND d.suspension_state='none' AND d.investigation_state='none'
  AND coalesce(d.expiry_date,'epoch'::timestamptz)>now()
  AND legal.legal_expires_at>now()
  AND policy.policy_state='APPROVED'
  AND policy.effective_at<=now() AND policy.expires_at>now()
  AND EXISTS(SELECT 1 FROM tenant_users m WHERE
    m.tenant_id=l.tenant_id AND m.user_id=l.claimant_user_id
    AND m.role IN ('dealer','admin'));
REVOKE ALL ON dealer_full_storefront_current FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_full_storefront_current TO service_role;
COMMENT ON VIEW dealer_full_storefront_current IS
 'Private-service-role read projection only: display-reviewed company facts, branches and dealer-declared sections; no private custody, payment, seller/VIN authorization or OEM badge.';

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM dealer_full_storefront_review_events) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_PUBLIC_STORE_FRONT_CUSTODY';
 END IF;
END;
$$;
DROP VIEW IF EXISTS dealer_full_storefront_current;
DROP FUNCTION IF EXISTS dealer_review_full_storefront_publication(TEXT,TEXT,TEXT,UUID[],TEXT[],TEXT);
DROP TABLE IF EXISTS dealer_full_storefront_review_events;
