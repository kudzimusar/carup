-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
-- CARUP-DEALER-ONB-001 D5: local OCR observations are PRIVATE APPEND-ONLY
-- candidate evidence, never verified facts, company roles or dealer compliance.
CREATE TABLE dealer_claim_document_ocr_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  evidence_id UUID NOT NULL REFERENCES dealer_claim_private_evidence(evidence_id) ON DELETE RESTRICT,
  claimant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document_class TEXT NOT NULL CHECK (document_class IN
    ('COMPANY_REGISTRATION','DIRECTOR_AUTHORITY','SIGNATORY_MANDATE',
     'BRANCH_AUTHORITY','PARENT_COMPANY_AUTHORITY')),
  evidence_sha256 TEXT NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  extractor_id TEXT NOT NULL CHECK (extractor_id='LOCAL_TESSERACT_V1'),
  schema_version TEXT NOT NULL DEFAULT 'CARUP_DEALER_OCR_CANDIDATE_1_0'
    CHECK (schema_version='CARUP_DEALER_OCR_CANDIDATE_1_0'),
  extraction_state TEXT NOT NULL CHECK (extraction_state IN
    ('PROVIDER_NOT_ENABLED','PROVIDER_UNAVAILABLE','UNREADABLE','CANDIDATE_REVIEW')),
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extracted_fields)='object'),
  review_flags TEXT[] NOT NULL DEFAULT '{}',
  pages_processed INTEGER NOT NULL CHECK (pages_processed BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(evidence_id,extractor_id,extraction_state,evidence_sha256)
);
COMMENT ON TABLE dealer_claim_document_ocr_events IS
 'Private append-only, field-provenanced observations only. Confidence is unknown,
  OCR output is not a legal certificate and cannot authorize publication,
  dealer compliance, company claim approval or tenant activation.';
CREATE INDEX dealer_claim_document_ocr_events_claim
  ON dealer_claim_document_ocr_events(claim_id,created_at DESC);
ALTER TABLE dealer_claim_document_ocr_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_claim_document_ocr_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_claim_document_ocr_events TO service_role;
CREATE TRIGGER dealer_claim_document_ocr_events_no_update
  BEFORE UPDATE ON dealer_claim_document_ocr_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_claim_document_ocr_events_no_delete
  BEFORE DELETE ON dealer_claim_document_ocr_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

CREATE OR REPLACE FUNCTION dealer_record_candidate_document_extraction(
  p_claim_id UUID,p_evidence_id UUID,p_claimant_id TEXT,
  p_evidence_sha TEXT,p_state TEXT,p_fields JSONB,p_pages INTEGER,
  p_flags TEXT[],p_engine TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
  c dealer_research_claim_requests%ROWTYPE;
  e dealer_claim_private_evidence%ROWTYPE;
  k TEXT; v JSONB;
  recorded dealer_claim_document_ocr_events%ROWTYPE;
BEGIN
  SELECT * INTO c FROM dealer_research_claim_requests
   WHERE claim_id=p_claim_id FOR UPDATE;
  IF NOT FOUND OR c.claimant_user_id<>p_claimant_id OR
    c.claim_status NOT IN ('AWAITING_DOCUMENTARY_EVIDENCE',
       'CLAIM_APPROVED','CLAIM_DISPUTED','CLAIM_APPEALED') THEN
    RAISE EXCEPTION 'CANDIDATE_CLAIM_OWNERSHIP_REQUIRED';
  END IF;
  SELECT * INTO e FROM dealer_claim_private_evidence
    WHERE evidence_id=p_evidence_id AND claim_id=p_claim_id
      AND uploader_user_id=p_claimant_id AND
      scan_state='CLEAN_CLAMAV_AT_UPLOAD';
  IF NOT FOUND OR e.content_sha256<>p_evidence_sha OR
     p_engine<>'LOCAL_TESSERACT_V1' OR
     p_state NOT IN ('PROVIDER_NOT_ENABLED','PROVIDER_UNAVAILABLE',
       'UNREADABLE','CANDIDATE_REVIEW') OR
     p_pages NOT BETWEEN 0 AND 5 OR
     jsonb_typeof(p_fields)<>'object' OR
     p_flags IS NULL OR cardinality(p_flags)>25 THEN
    RAISE EXCEPTION 'INVALID_OR_UNOWNED_OCR_ORIGINAL';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_flags) AS f WHERE
      length(f) NOT BETWEEN 2 AND 80 OR f !~ '^[A-Z0-9_]+$') THEN
    RAISE EXCEPTION 'INVALID_OCR_REVIEW_FLAG';
  END IF;
  IF p_state<>'CANDIDATE_REVIEW' AND p_fields<>'{}'::jsonb THEN
    RAISE EXCEPTION 'UNAVAILABLE_OCR_CANNOT_HAVE_FIELDS';
  END IF;
  IF p_state='CANDIDATE_REVIEW' AND (p_fields='{}'::jsonb OR p_pages=0) THEN
    RAISE EXCEPTION 'CANDIDATE_REQUIRES_OBSERVED_PAGE_FIELDS';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_fields))>7 THEN
    RAISE EXCEPTION 'UNQUALIFIED_OCR_FIELDS';
  END IF;
  FOR k,v IN SELECT * FROM jsonb_each(p_fields)
  LOOP
    IF k NOT IN ('legal_name','registration_number','registration_issuer',
       'tax_reference','physical_address','issued_at','expires_at') OR
       jsonb_typeof(v)<>'object' OR
       NOT (v ? 'value') OR NOT (v ? 'page') OR
       NOT (v ? 'source') OR NOT (v ? 'confidence') OR
       v->>'source'<>'OBSERVED_LOCAL_OCR' OR
       v->'confidence'<>'null'::jsonb OR
       jsonb_typeof(v->'value')<>'string' OR
       length(v->>'value') NOT BETWEEN 2 AND 180 OR
       jsonb_typeof(v->'page')<>'number' OR
       (v->>'page')::integer NOT BETWEEN 1 AND greatest(p_pages,1) THEN
      RAISE EXCEPTION 'UNQUALIFIED_OCR_FIELD';
    END IF;
  END LOOP;
  INSERT INTO dealer_claim_document_ocr_events(
    claim_id,evidence_id,claimant_user_id,document_class,evidence_sha256,
    extractor_id,extraction_state,extracted_fields,review_flags,pages_processed
  ) VALUES (
    p_claim_id,p_evidence_id,p_claimant_id,e.document_class,p_evidence_sha,
    p_engine,p_state,p_fields,p_flags,p_pages
  ) ON CONFLICT(evidence_id,extractor_id,extraction_state,evidence_sha256)
    DO NOTHING;
  SELECT * INTO recorded FROM dealer_claim_document_ocr_events
    WHERE evidence_id=p_evidence_id AND extractor_id=p_engine
      AND extraction_state=p_state AND evidence_sha256=p_evidence_sha;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR_AUDIT_RECORD_UNAVAILABLE'; END IF;
  RETURN jsonb_build_object(
    'event_id',recorded.event_id,'claim_id',p_claim_id,
    'evidence_id',p_evidence_id,'state',recorded.extraction_state,
    'pages_processed',recorded.pages_processed,'schema_version',
      recorded.schema_version,'candidate_only',true,
    'verified',false,'legal_approval',false,'tenant_activated',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_candidate_document_extraction(
 UUID,UUID,TEXT,TEXT,TEXT,JSONB,INTEGER,TEXT[],TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_candidate_document_extraction(
 UUID,UUID,TEXT,TEXT,TEXT,JSONB,INTEGER,TEXT[],TEXT)
 TO service_role;

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dealer_claim_document_ocr_events) THEN
    RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_OCR_CUSTODY';
  END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_record_candidate_document_extraction(
 UUID,UUID,TEXT,TEXT,TEXT,JSONB,INTEGER,TEXT[],TEXT);
DROP TABLE IF EXISTS dealer_claim_document_ocr_events;
