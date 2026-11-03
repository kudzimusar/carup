-- +migrate Up
-- CARUP-DEALER-ONB-001 D6: frozen applicant submission -> independent preliminary
-- review, not dealer licensing, compliance approval or canonical tenant activation.
CREATE TABLE dealer_claim_compliance_submissions (
  submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  claimant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  intake_version INTEGER NOT NULL CHECK(intake_version>=1),
  schema_version TEXT NOT NULL CHECK(schema_version='CARUP_DEALER_INTAKE_1_0'),
  source_row_sha256 TEXT NOT NULL CHECK(source_row_sha256 ~ '^[0-9a-f]{64}$'),
  workbook_sha256 TEXT NOT NULL CHECK(workbook_sha256 ~ '^[0-9a-f]{64}$'),
  -- Exact frozen private applicant declarations, not independently verified facts.
  application_snapshot JSONB NOT NULL CHECK(jsonb_typeof(application_snapshot)='object'),
  snapshot_sha256 TEXT NOT NULL CHECK(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  attestation_version TEXT NOT NULL CHECK(attestation_version='CARUP_DEALER_APPLICANT_DECLARATION_1'),
  applicant_attested BOOLEAN NOT NULL CHECK(applicant_attested=true),
  legal_signatory_independently_verified BOOLEAN NOT NULL DEFAULT false
    CHECK (legal_signatory_independently_verified=false),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(claim_id,intake_version)
);
CREATE INDEX dealer_claim_compliance_submissions_queue
  ON dealer_claim_compliance_submissions(submitted_at DESC);
CREATE TABLE dealer_claim_compliance_review_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL UNIQUE
    REFERENCES dealer_claim_compliance_submissions(submission_id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verdict TEXT NOT NULL CHECK(verdict IN (
    'NEEDS_CORRECTIONS','EVIDENCE_REQUIRED','READY_FOR_REGULATORY_REVIEW')),
  decision_reason TEXT NOT NULL CHECK(length(btrim(decision_reason)) BETWEEN 40 AND 3000),
  independently_verified_legal_compliance BOOLEAN NOT NULL DEFAULT false
    CHECK (independently_verified_legal_compliance=false),
  tenant_activated BOOLEAN NOT NULL DEFAULT false CHECK(tenant_activated=false),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dealer_claim_compliance_submissions IS
 'Immutable snapshots of applicant declarations; privacy acknowledgement and applicant attestation are not an independently checked signatory, licence or activation.';
COMMENT ON TABLE dealer_claim_compliance_review_events IS
 'Immutable maker-checker preliminary findings only; READY_FOR_REGULATORY_REVIEW is NOT compliance approval. Separate legal policy and canonical tenant authority required.';
CREATE TRIGGER dealer_claim_compliance_submissions_no_update
  BEFORE UPDATE ON dealer_claim_compliance_submissions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_claim_compliance_submissions_no_delete
  BEFORE DELETE ON dealer_claim_compliance_submissions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_claim_compliance_review_events_no_update
  BEFORE UPDATE ON dealer_claim_compliance_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_claim_compliance_review_events_no_delete
  BEFORE DELETE ON dealer_claim_compliance_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
ALTER TABLE dealer_claim_compliance_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_claim_compliance_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_claim_compliance_submissions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON dealer_claim_compliance_review_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_claim_compliance_submissions TO service_role;
GRANT SELECT ON dealer_claim_compliance_review_events TO service_role;

CREATE FUNCTION dealer_submit_compliance_application(
 p_claim_id UUID,p_claimant_id TEXT,p_expected_version INTEGER,
 p_attestation_version TEXT,p_attestation_acknowledged BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 c dealer_research_claim_requests%ROWTYPE;
 d dealer_claim_intake_drafts%ROWTYPE;
 v_business JSONB;v_branches JSONB;v_consents JSONB;
 v_declaration JSONB;
 v_id UUID;v_digest TEXT;
BEGIN
 SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id=p_claim_id FOR UPDATE;
 IF NOT FOUND OR c.claimant_user_id<>p_claimant_id OR c.claim_status<>'CLAIM_APPROVED'
   THEN RAISE EXCEPTION 'CLAIM_NOT_APPROVED_FOR_APPLICATION_SUBMISSION'; END IF;
 SELECT * INTO d FROM dealer_claim_intake_drafts
   WHERE claim_id=p_claim_id AND claimant_user_id=p_claimant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_INTAKE_DRAFT_REQUIRED'; END IF;
 IF p_expected_version<>d.submission_version THEN
   RAISE EXCEPTION 'STALE_APPLICATION_VERSION'; END IF;
 IF p_attestation_version<>'CARUP_DEALER_APPLICANT_DECLARATION_1'
   OR p_attestation_acknowledged IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'EXPLICIT_APPLICANT_DECLARATION_REQUIRED'; END IF;
 IF d.schema_version<>'CARUP_DEALER_INTAKE_1_0' OR
  d.content->>'schema'<>'CARUP_DEALER_INTAKE_1_0' OR
  d.content->>'claim_id'<>p_claim_id::TEXT OR
  d.content->>'seed_id'<>c.seed_dealer_id OR
  d.content->>'source_row_sha256'<>d.source_row_sha256 THEN
   RAISE EXCEPTION 'CANONICAL_INTAKE_CONTRACT_REQUIRED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM dealer_research_seed_records r
   WHERE r.seed_dealer_id=c.seed_dealer_id AND
     r.source_row_sha256=d.source_row_sha256) THEN
   RAISE EXCEPTION 'STALE_RESEARCH_SOURCE_VERSION'; END IF;
 v_business:=d.content->'tab_rows'->'BUSINESS';
 v_branches:=d.content->'tab_rows'->'BRANCHES';
 v_consents:=d.content->'tab_rows'->'CONSENTS_DECLARATIONS';
 IF jsonb_typeof(v_business)<>'array' OR jsonb_array_length(v_business)<>1
    OR nullif(btrim(v_business->0->>'legal_name'),'') IS NULL
    OR v_business->0->>'operating_country'<>'ZW'
    OR v_business->0->>'research_confirmation' NOT IN ('YES','CORRECT')
    OR jsonb_typeof(v_branches)<>'array'
    OR jsonb_array_length(v_branches)<1
    OR jsonb_typeof(v_consents)<>'array'
    OR jsonb_array_length(v_consents)<1 THEN
   RAISE EXCEPTION 'COMPLETE_ZW_APPLICATION_AND_SOURCE_CONFIRMATION_REQUIRED';
 END IF;
 v_declaration:=v_consents->0;
 IF nullif(btrim(v_declaration->>'signer_name'),'') IS NULL
    OR nullif(btrim(v_declaration->>'signer_role'),'') IS NULL
    OR v_declaration->>'privacy_acknowledgment'<>'YES' THEN
   RAISE EXCEPTION 'APPLICANT_SIGNER_AND_PRIVACY_DECLARATION_REQUIRED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM dealer_claim_private_evidence e
   WHERE e.claim_id=p_claim_id AND e.uploader_user_id=p_claimant_id
     AND e.scan_state='CLEAN_CLAMAV_AT_UPLOAD'
     AND e.document_class IN ('SIGNATORY_MANDATE','DIRECTOR_AUTHORITY','COMPANY_REGISTRATION')) THEN
   RAISE EXCEPTION 'PRIVATE_ORIGINAL_AUTHORITY_EVIDENCE_REQUIRED'; END IF;
 -- PG canonical JSONB representation is frozen by SHA-256. No source edit or legal approval.
 v_digest:=encode(sha256(convert_to(d.content::TEXT,'UTF8')),'hex');
 INSERT INTO dealer_claim_compliance_submissions(
   claim_id,claimant_user_id,intake_version,schema_version,
   source_row_sha256,workbook_sha256,application_snapshot,snapshot_sha256,
   attestation_version,applicant_attested
 ) VALUES (
   p_claim_id,p_claimant_id,d.submission_version,d.schema_version,
   d.source_row_sha256,d.workbook_sha256,d.content,v_digest,
   p_attestation_version,true
 ) ON CONFLICT(claim_id,intake_version) DO NOTHING
 RETURNING submission_id INTO v_id;
 IF v_id IS NULL THEN
   SELECT submission_id INTO v_id FROM dealer_claim_compliance_submissions
     WHERE claim_id=p_claim_id AND intake_version=d.submission_version
       AND snapshot_sha256=v_digest AND workbook_sha256=d.workbook_sha256;
   IF v_id IS NULL THEN RAISE EXCEPTION 'APPLICATION_SNAPSHOT_VERSION_CONFLICT'; END IF;
 END IF;
 RETURN jsonb_build_object(
   'submission_id',v_id,'claim_id',p_claim_id,'intake_version',d.submission_version,
   'state','SUBMITTED_FOR_PRELIMINARY_INDEPENDENT_REVIEW',
   'candidate_only',true,'compliance_approved',false,'tenant_activated',false,
   'legal_signatory_verified',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_submit_compliance_application(UUID,TEXT,INTEGER,TEXT,BOOLEAN)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_submit_compliance_application(UUID,TEXT,INTEGER,TEXT,BOOLEAN)
  TO service_role;

CREATE FUNCTION dealer_review_compliance_submission(
 p_submission_id UUID,p_reviewer_id TEXT,p_verdict TEXT,p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 s dealer_claim_compliance_submissions%ROWTYPE;
 c dealer_research_claim_requests%ROWTYPE;
 d dealer_claim_intake_drafts%ROWTYPE;
 r users%ROWTYPE;
 v_event_id UUID;
BEGIN
 IF p_verdict NOT IN ('NEEDS_CORRECTIONS','EVIDENCE_REQUIRED','READY_FOR_REGULATORY_REVIEW')
   OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 40 AND 3000 THEN
   RAISE EXCEPTION 'INVALID_PRELIMINARY_REVIEW_FINDING'; END IF;
 SELECT * INTO s FROM dealer_claim_compliance_submissions
   WHERE submission_id=p_submission_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_COMPLIANCE_SUBMISSION'; END IF;
 SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id=s.claim_id FOR UPDATE;
 SELECT * INTO r FROM users WHERE id=p_reviewer_id;
 IF NOT FOUND OR r.role NOT IN ('admin','reviewer','platform_admin','super_admin')
   OR r.is_verified IS DISTINCT FROM true OR r.id=s.claimant_user_id THEN
   RAISE EXCEPTION 'INDEPENDENT_APPLICATION_REVIEWER_REQUIRED'; END IF;
 IF c.claim_status<>'CLAIM_APPROVED' THEN
   RAISE EXCEPTION 'CLAIM_NOT_APPROVED_FOR_CASE_REVIEW'; END IF;
 SELECT * INTO d FROM dealer_claim_intake_drafts
   WHERE claim_id=s.claim_id FOR UPDATE;
 IF NOT FOUND OR d.submission_version<>s.intake_version
   OR d.workbook_sha256<>s.workbook_sha256
   OR encode(sha256(convert_to(d.content::TEXT,'UTF8')),'hex')<>s.snapshot_sha256 THEN
   RAISE EXCEPTION 'STALE_COMPLIANCE_SUBMISSION_NEEDS_REPLACEMENT'; END IF;
 INSERT INTO dealer_claim_compliance_review_events(
    submission_id,reviewer_user_id,verdict,decision_reason
 ) VALUES (p_submission_id,p_reviewer_id,p_verdict,btrim(p_reason))
 RETURNING event_id INTO v_event_id;
 RETURN jsonb_build_object('event_id',v_event_id,'submission_id',p_submission_id,
   'verdict',p_verdict,'preliminary_review_only',true,
   'compliance_approved',false,'tenant_activated',false,
   'eligible_for_regulator_review',p_verdict='READY_FOR_REGULATORY_REVIEW');
END;
$$;
REVOKE ALL ON FUNCTION dealer_review_compliance_submission(UUID,TEXT,TEXT,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_review_compliance_submission(UUID,TEXT,TEXT,TEXT)
 TO service_role;

-- +migrate Down
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM dealer_claim_compliance_submissions)
   OR EXISTS(SELECT 1 FROM dealer_claim_compliance_review_events) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_SUBMITTED_COMPLIANCE_CUSTODY';
 END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_review_compliance_submission(UUID,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS dealer_submit_compliance_application(UUID,TEXT,INTEGER,TEXT,BOOLEAN);
DROP TABLE IF EXISTS dealer_claim_compliance_review_events;
DROP TABLE IF EXISTS dealer_claim_compliance_submissions;
