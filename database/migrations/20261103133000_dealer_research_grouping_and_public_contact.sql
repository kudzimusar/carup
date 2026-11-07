-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
-- CARUP-DEALER-ONB-001 D4/D8: business-safe research contact projection and
-- source-grouping review. No parent legal merge, OEM authorization or tenant rights.
CREATE TABLE dealer_research_grouping_review_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  related_seed_dealer_id TEXT REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  review_state TEXT NOT NULL CHECK(review_state IN (
    'POTENTIAL_SAME_PARENT','POTENTIAL_DUPLICATE','CONFIRMED_DISTINCT_RESEARCH',
    'REVIEWED_BRANCH_RELATIONSHIP','UNRESOLVED_GROUPING')),
  legal_parent_verified BOOLEAN NOT NULL DEFAULT false CHECK(legal_parent_verified=false),
  canonical_org_merge_performed BOOLEAN NOT NULL DEFAULT false CHECK(canonical_org_merge_performed=false),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rationale TEXT NOT NULL CHECK(length(btrim(rationale)) BETWEEN 60 AND 3000),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(related_seed_dealer_id IS NULL OR related_seed_dealer_id<>seed_dealer_id)
);
CREATE INDEX dealer_grouping_events_seed
 ON dealer_research_grouping_review_events(seed_dealer_id,reviewed_at DESC);
ALTER TABLE dealer_research_grouping_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_grouping_review_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_research_grouping_review_events TO service_role;
CREATE TRIGGER dealer_grouping_events_immutable_up BEFORE UPDATE ON dealer_research_grouping_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_grouping_events_immutable_del BEFORE DELETE ON dealer_research_grouping_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

CREATE TABLE dealer_research_public_contact_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  source_row_sha256 TEXT NOT NULL CHECK(source_row_sha256 ~ '^[0-9a-f]{64}$'),
  publication_revision INTEGER NOT NULL CHECK(publication_revision>=1),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  public_address TEXT CHECK(length(public_address)<=400),
  public_business_phone TEXT CHECK(length(public_business_phone)<=180),
  public_website TEXT CHECK(length(public_website)<=450),
  public_contact_state TEXT NOT NULL CHECK(public_contact_state IN ('DISPLAY_REVIEWED_FIELDS','RETRACTED')),
  source_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  independent_business_verification BOOLEAN NOT NULL DEFAULT false
    CHECK(independent_business_verification=false),
  logo_rights_approved BOOLEAN NOT NULL DEFAULT false CHECK(logo_rights_approved=false),
  rationale TEXT NOT NULL CHECK(length(btrim(rationale)) BETWEEN 80 AND 3000),
  CHECK(public_contact_state<>'RETRACTED' OR (
    public_address IS NULL AND public_business_phone IS NULL AND public_website IS NULL))
);
CREATE INDEX dealer_contact_events_seed
 ON dealer_research_public_contact_events(seed_dealer_id,source_checked_at DESC,event_id DESC);
ALTER TABLE dealer_research_public_contact_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_public_contact_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_research_public_contact_events TO service_role;
CREATE TRIGGER dealer_contact_events_immutable_up BEFORE UPDATE ON dealer_research_public_contact_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_contact_events_immutable_del BEFORE DELETE ON dealer_research_public_contact_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
COMMENT ON TABLE dealer_research_public_contact_events IS
 'Individually reviewed research-source display fields, not independently verified businesses. Private emails and key principals never copied. No customer-controlled text.';

CREATE FUNCTION dealer_record_research_grouping_review(
 p_seed_id TEXT,p_related_seed_id TEXT,p_reviewer_id TEXT,p_state TEXT,p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_user users%ROWTYPE;v_event UUID;
BEGIN
 SELECT * INTO v_user FROM users WHERE id=p_reviewer_id;
 IF NOT FOUND OR v_user.role NOT IN ('admin','reviewer','platform_admin','super_admin')
    OR v_user.is_verified IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'INDEPENDENT_GROUP_REVIEWER_REQUIRED'; END IF;
 IF p_state NOT IN ('POTENTIAL_SAME_PARENT','POTENTIAL_DUPLICATE','CONFIRMED_DISTINCT_RESEARCH',
    'REVIEWED_BRANCH_RELATIONSHIP','UNRESOLVED_GROUPING')
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 60 AND 3000 THEN
   RAISE EXCEPTION 'INVALID_GROUPING_CASE'; END IF;
 IF p_related_seed_id=p_seed_id THEN RAISE EXCEPTION 'SELF_GROUPING_REFUSED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM dealer_research_seed_records WHERE seed_dealer_id=p_seed_id)
    OR (p_related_seed_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM dealer_research_seed_records WHERE seed_dealer_id=p_related_seed_id)) THEN
   RAISE EXCEPTION 'UNKNOWN_RESEARCH_GROUP_MEMBER'; END IF;
 IF p_state IN ('POTENTIAL_SAME_PARENT','POTENTIAL_DUPLICATE','REVIEWED_BRANCH_RELATIONSHIP',
    'CONFIRMED_DISTINCT_RESEARCH') AND p_related_seed_id IS NULL THEN
   RAISE EXCEPTION 'RELATED_SOURCE_ID_REQUIRED'; END IF;
 INSERT INTO dealer_research_grouping_review_events(
  seed_dealer_id,related_seed_dealer_id,reviewer_user_id,review_state,rationale)
 VALUES(p_seed_id,p_related_seed_id,p_reviewer_id,p_state,btrim(p_reason))
 RETURNING event_id INTO v_event;
 RETURN jsonb_build_object('event_id',v_event,'grouping_status',p_state,
   'related_seed_dealer_id',p_related_seed_id,
   'legal_parent_verified',false,'canonical_organization_merged',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_research_grouping_review(TEXT,TEXT,TEXT,TEXT,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_research_grouping_review(TEXT,TEXT,TEXT,TEXT,TEXT)
 TO service_role;

CREATE FUNCTION dealer_record_research_contact_review(
 p_seed_id TEXT,p_reviewer_id TEXT,p_reason TEXT,
 p_display_address BOOLEAN,p_display_phone BOOLEAN,p_display_website BOOLEAN,
 p_retract BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 v_user users%ROWTYPE;v_source dealer_research_seed_records%ROWTYPE;
 v_profile dealer_research_public_profiles%ROWTYPE;
 v_address TEXT;v_phone TEXT;v_website TEXT;v_event UUID;
BEGIN
 SELECT * INTO v_user FROM users WHERE id=p_reviewer_id;
 IF NOT FOUND OR v_user.role NOT IN ('admin','reviewer','platform_admin','super_admin')
     OR v_user.is_verified IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'INDEPENDENT_PUBLIC_CONTACT_REVIEWER_REQUIRED'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 80 AND 3000 THEN
   RAISE EXCEPTION 'DOCUMENTED_CONTACT_SOURCE_REVIEW_REQUIRED'; END IF;
 SELECT * INTO v_source FROM dealer_research_seed_records
   WHERE seed_dealer_id=p_seed_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_RESEARCH_SEED'; END IF;
 SELECT * INTO v_profile FROM dealer_research_public_profiles
   WHERE seed_dealer_id=p_seed_id FOR UPDATE;
 IF NOT FOUND OR (NOT p_retract AND v_profile.publication_status<>'PRELISTED_UNCLAIMED') THEN
   RAISE EXCEPTION 'PUBLICATION_ELIGIBILITY_REQUIRED'; END IF;
 IF p_retract AND (coalesce(p_display_address,false) OR coalesce(p_display_phone,false)
    OR coalesce(p_display_website,false)) THEN RAISE EXCEPTION 'RETRACTION_MUST_HIDE_ALL_FIELDS'; END IF;
 IF NOT p_retract THEN
   IF p_display_address IS TRUE THEN
     v_address:=nullif(btrim(v_source.source_snapshot->>'Physical Address'),'');
     IF v_address IS NULL OR length(v_address)>400 THEN
       RAISE EXCEPTION 'SOURCE_ADDRESS_UNAVAILABLE_FOR_PUBLIC_REVIEW'; END IF;
   END IF;
   IF p_display_phone IS TRUE THEN
     v_phone:=nullif(btrim(v_source.source_snapshot->>'Phone / WhatsApp'),'');
     IF v_phone IS NULL OR length(v_phone)>180 THEN
       RAISE EXCEPTION 'SOURCE_PHONE_UNAVAILABLE_FOR_PUBLIC_REVIEW'; END IF;
   END IF;
   IF p_display_website IS TRUE THEN
     v_website:=nullif(btrim(v_source.source_snapshot->>'Website / Source URL'),'');
     IF v_website IS NULL OR length(v_website)>450 OR
        v_website !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+([/:?#][A-Za-z0-9._~:/?#@!$&''()*+,;=%-]*)?$'
        OR v_website ~ '[[:cntrl:][:space:]]' THEN
       RAISE EXCEPTION 'UNSAFE_SOURCE_WEBSITE_URL'; END IF;
   END IF;
 END IF;
 INSERT INTO dealer_research_public_contact_events(
   seed_dealer_id,source_row_sha256,publication_revision,reviewer_user_id,
   public_address,public_business_phone,public_website,public_contact_state,rationale)
 VALUES(p_seed_id,v_source.source_row_sha256,v_profile.revision,p_reviewer_id,
    v_address,v_phone,v_website,
    CASE WHEN p_retract THEN 'RETRACTED' ELSE 'DISPLAY_REVIEWED_FIELDS' END,
    btrim(p_reason))
 RETURNING event_id INTO v_event;
 RETURN jsonb_build_object('event_id',v_event,'seed_dealer_id',p_seed_id,
    'public_contact_state',CASE WHEN p_retract THEN 'RETRACTED' ELSE 'DISPLAY_REVIEWED_FIELDS' END,
    'business_verified',false,'logo_rights_approved',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_research_contact_review(TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_research_contact_review(TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN)
 TO service_role;

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM dealer_research_grouping_review_events)
   OR EXISTS(SELECT 1 FROM dealer_research_public_contact_events) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_SOURCE_PUBLICATION_CUSTODY';
 END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_record_research_contact_review(TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN);
DROP FUNCTION IF EXISTS dealer_record_research_grouping_review(TEXT,TEXT,TEXT,TEXT,TEXT);
DROP TABLE IF EXISTS dealer_research_public_contact_events;
DROP TABLE IF EXISTS dealer_research_grouping_review_events;
