-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
SET LOCAL carup.dealer_migration_txn = 'on';
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2: SET LOCAL is a silent no-op outside a transaction block, so a migration
  -- run statement by statement in autocommit (plain `psql -f`) would lose its lock_timeout and
  -- could apply half-way. Refuse, and end the session so the client cannot run the remaining
  -- statements. Apply with backend/scripts/dealership/applyDealerMigrations.mjs or
  -- `psql -1 -v ON_ERROR_STOP=1` (one transaction per migration section).
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: use the dealership migration runner or psql -1 -v ON_ERROR_STOP=1';
    BEGIN
      PERFORM pg_terminate_backend(pg_backend_pid());
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION';
  END IF;
END
$txnguard$;
-- CARUP-DEALER-ONB-001 D3/D6 — independent claim-review custody and private
-- applicant draft read-model. This does NOT create a second organization, tenant,
-- staff, VIN or payment authority. Existing canonical activation remains separate.
ALTER TABLE dealer_research_claim_requests
  DROP CONSTRAINT IF EXISTS dealer_research_claim_requests_claim_status_check;
ALTER TABLE dealer_research_claim_requests
  ADD CONSTRAINT dealer_research_claim_requests_claim_status_check
  CHECK (claim_status IN (
    'AWAITING_DOCUMENTARY_EVIDENCE','CLAIM_APPROVED','CLAIM_REJECTED',
    'CLAIM_DISPUTED','CLAIM_APPEALED','CLAIM_REVOKED'
  ));
COMMENT ON COLUMN dealer_research_claim_requests.claim_status IS
  'Only independent governed claim-review RPC can transition statuses. CLAIM_APPROVED
   allows private application prefill, NOT a dealer operation, verified badge or tenant.';
CREATE TABLE IF NOT EXISTS dealer_claim_private_evidence (
  evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  uploader_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document_class TEXT NOT NULL CHECK (document_class IN (
    'COMPANY_REGISTRATION','DIRECTOR_AUTHORITY','SIGNATORY_MANDATE',
    'BRANCH_AUTHORITY','PARENT_COMPANY_AUTHORITY'
  )),
  storage_bucket TEXT NOT NULL DEFAULT 'ocr-documents' CHECK (storage_bucket='ocr-documents'),
  storage_path TEXT NOT NULL UNIQUE CHECK (storage_path ~ '^dealership-claims/[0-9a-f-]+/[0-9a-f-]+[.](jpg|png|pdf)$'),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  file_bytes INTEGER NOT NULL CHECK (file_bytes BETWEEN 32 AND 6291456),
  scan_state TEXT NOT NULL CHECK (scan_state='CLEAN_CLAMAV_AT_UPLOAD'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(claim_id,content_sha256)
);
COMMENT ON TABLE dealer_claim_private_evidence IS
  'Private raw-original evidence in the canonical ocr-documents bucket. Upload requires
   proven session, object ownership, magic validation and real free ClamAV clean verdict.
   Applicant cannot mark verified and no public or signed link is stored here.';
CREATE INDEX IF NOT EXISTS dealer_claim_private_evidence_claim
 ON dealer_claim_private_evidence(claim_id,created_at);
CREATE TABLE IF NOT EXISTS dealer_claim_review_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  evidence_id UUID REFERENCES dealer_claim_private_evidence(evidence_id) ON DELETE RESTRICT,
  verdict TEXT NOT NULL CHECK (verdict IN ('CLAIM_APPROVED','CLAIM_REJECTED','CLAIM_DISPUTED','CLAIM_REVOKED')),
  reviewed_issuer TEXT,
  verified_legal_scope TEXT,
  review_reason TEXT NOT NULL CHECK (length(btrim(review_reason)) BETWEEN 40 AND 3000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dealer_claim_review_events_claim ON dealer_claim_review_events(claim_id,created_at DESC);
CREATE TABLE IF NOT EXISTS dealer_claim_appeals (
  appeal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  appellant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  appeal_reason TEXT NOT NULL CHECK (length(btrim(appeal_reason)) BETWEEN 40 AND 3000),
  status TEXT NOT NULL DEFAULT 'PENDING_INDEPENDENT_APPEAL_REVIEW'
    CHECK (status IN ('PENDING_INDEPENDENT_APPEAL_REVIEW','REVIEWED_BY_INDEPENDENT_REVIEWER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (claim_id,appellant_user_id)
);
CREATE TABLE IF NOT EXISTS dealer_claim_intake_drafts (
  claim_id UUID PRIMARY KEY REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  claimant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL CHECK (schema_version='CARUP_DEALER_INTAKE_1_0'),
  source_row_sha256 TEXT NOT NULL CHECK (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  workbook_sha256 TEXT NOT NULL CHECK (workbook_sha256 ~ '^[0-9a-f]{64}$'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content)='object'),
  submission_version INTEGER NOT NULL DEFAULT 1 CHECK (submission_version >= 1),
  state TEXT NOT NULL DEFAULT 'CANDIDATE_AWAITING_COMPLIANCE'
    CHECK (state='CANDIDATE_AWAITING_COMPLIANCE'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dealer_claim_intake_drafts IS
  'Private submitted multi-sheet application candidates. No direct writes to verified
   legal entity, canonical tenant, VIN, payment, licence or publication authorities.';
CREATE TABLE IF NOT EXISTS dealer_claim_intake_receipts (
  receipt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES dealer_research_claim_requests(claim_id) ON DELETE RESTRICT,
  claimant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  workbook_sha256 TEXT NOT NULL CHECK (workbook_sha256 ~ '^[0-9a-f]{64}$'),
  version INTEGER NOT NULL CHECK (version>=1),
  summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (claim_id, workbook_sha256)
);

ALTER TABLE dealer_claim_private_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_claim_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_claim_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_claim_intake_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_claim_intake_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_claim_private_evidence,dealer_claim_review_events,
 dealer_claim_appeals,dealer_claim_intake_drafts,dealer_claim_intake_receipts
 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON dealer_claim_private_evidence TO service_role;
GRANT SELECT ON dealer_claim_review_events TO service_role;
GRANT SELECT,INSERT ON dealer_claim_appeals TO service_role;
GRANT SELECT ON dealer_claim_intake_drafts,dealer_claim_intake_receipts TO service_role;

-- Append-only review and receipt proof. Correction is a new review or import receipt.
CREATE TRIGGER dealer_claim_review_events_no_update BEFORE UPDATE ON dealer_claim_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_claim_review_events_no_delete BEFORE DELETE ON dealer_claim_review_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_claim_receipts_no_update BEFORE UPDATE ON dealer_claim_intake_receipts
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_claim_receipts_no_delete BEFORE DELETE ON dealer_claim_intake_receipts
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- Only service_role invokes this DB-atomic independent decision, after the API
-- verifies the reviewer's OWN password (recent step-up, never from request role).
CREATE OR REPLACE FUNCTION dealer_record_independent_claim_review(
 p_claim_id UUID,p_reviewer_id TEXT,p_verdict TEXT,p_reason TEXT,
 p_evidence_id UUID DEFAULT NULL,p_issuer TEXT DEFAULT NULL,p_scope TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 c dealer_research_claim_requests%ROWTYPE;
 r users%ROWTYPE;
 e dealer_claim_private_evidence%ROWTYPE;
 v_other_claims INTEGER;
BEGIN
 IF p_verdict NOT IN ('CLAIM_APPROVED','CLAIM_REJECTED','CLAIM_DISPUTED','CLAIM_REVOKED')
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 40 AND 3000 THEN
   RAISE EXCEPTION 'INVALID_INDEPENDENT_CLAIM_VERDICT';
 END IF;
 SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id=p_claim_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_DEALER_CLAIM'; END IF;
 SELECT * INTO r FROM users WHERE id=p_reviewer_id;
 IF NOT FOUND OR r.role NOT IN ('admin','reviewer','platform_admin','super_admin')
    OR r.is_verified IS DISTINCT FROM true OR r.id=c.claimant_user_id THEN
   RAISE EXCEPTION 'INDEPENDENT_REVIEWER_REQUIRED';
 END IF;
 IF c.claim_status IN ('CLAIM_REVOKED','CLAIM_REJECTED') AND p_verdict<>'CLAIM_DISPUTED' THEN
   RAISE EXCEPTION 'TERMINAL_CLAIM_REVIEW'; END IF;
 IF p_verdict='CLAIM_APPROVED' THEN
   IF c.claim_status NOT IN ('AWAITING_DOCUMENTARY_EVIDENCE','CLAIM_DISPUTED','CLAIM_APPEALED')
     THEN RAISE EXCEPTION 'CLAIM_NOT_ELIGIBLE_FOR_APPROVAL'; END IF;
   IF p_evidence_id IS NULL OR length(btrim(coalesce(p_issuer,'')))<3 OR
     length(btrim(coalesce(p_scope,'')))<3 THEN
     RAISE EXCEPTION 'INDEPENDENT_EVIDENCE_ISSUER_SCOPE_REQUIRED'; END IF;
   SELECT * INTO e FROM dealer_claim_private_evidence
    WHERE evidence_id=p_evidence_id AND claim_id=p_claim_id
      AND uploader_user_id=c.claimant_user_id AND scan_state='CLEAN_CLAMAV_AT_UPLOAD';
   IF NOT FOUND THEN RAISE EXCEPTION 'VALID_ORIGINAL_DOCUMENT_REQUIRED'; END IF;
   IF p_scope<>c.claimed_scope THEN RAISE EXCEPTION 'CLAIM_SCOPE_MISMATCH'; END IF;
   -- Reject competing pending OR approved claims for the same research identity.
   SELECT count(*) INTO v_other_claims FROM dealer_research_claim_requests
    WHERE seed_dealer_id=c.seed_dealer_id AND claim_id<>p_claim_id
      AND claim_status NOT IN ('CLAIM_REJECTED','CLAIM_REVOKED');
   IF v_other_claims>0 THEN RAISE EXCEPTION 'COMPETING_CLAIMS_REQUIRE_RESOLUTION'; END IF;
 END IF;
 IF p_verdict='CLAIM_REVOKED' AND c.claim_status<>'CLAIM_APPROVED'
   THEN RAISE EXCEPTION 'ONLY_APPROVED_CLAIM_CAN_BE_REVOKED'; END IF;
 INSERT INTO dealer_claim_review_events
  (claim_id,reviewer_user_id,evidence_id,verdict,reviewed_issuer,verified_legal_scope,review_reason)
 VALUES (p_claim_id,p_reviewer_id,p_evidence_id,p_verdict,
   nullif(btrim(p_issuer),''),nullif(btrim(p_scope),''),btrim(p_reason));
 UPDATE dealer_research_claim_requests SET claim_status=p_verdict WHERE claim_id=p_claim_id;
 UPDATE dealer_claim_appeals SET status='REVIEWED_BY_INDEPENDENT_REVIEWER'
  WHERE claim_id=p_claim_id AND status='PENDING_INDEPENDENT_APPEAL_REVIEW';
 RETURN jsonb_build_object('claim_id',p_claim_id,'status',p_verdict,
  'dealer_operational',false,'tenant_activated',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_independent_claim_review(UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_independent_claim_review(UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT)
 TO service_role;

-- Applicant-owned appeal, DB-atomic and never grants authority on its own.
CREATE OR REPLACE FUNCTION dealer_request_claim_appeal(
 p_claim_id UUID,p_appellant_id TEXT,p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE c dealer_research_claim_requests%ROWTYPE; v_appeal UUID;
BEGIN
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 40 AND 3000
   THEN RAISE EXCEPTION 'INVALID_APPEAL_REASON'; END IF;
 SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id=p_claim_id FOR UPDATE;
 IF NOT FOUND OR c.claimant_user_id<>p_appellant_id
   THEN RAISE EXCEPTION 'CLAIM_NOT_OWNED'; END IF;
 IF c.claim_status NOT IN ('CLAIM_REJECTED','CLAIM_DISPUTED','CLAIM_REVOKED')
   THEN RAISE EXCEPTION 'CLAIM_NOT_APPEAL_ELIGIBLE'; END IF;
 INSERT INTO dealer_claim_appeals (claim_id,appellant_user_id,appeal_reason)
 VALUES (p_claim_id,p_appellant_id,btrim(p_reason))
 RETURNING appeal_id INTO v_appeal;
 UPDATE dealer_research_claim_requests SET claim_status='CLAIM_APPEALED'
  WHERE claim_id=p_claim_id;
 RETURN jsonb_build_object('appeal_id',v_appeal,'claim_id',p_claim_id,
   'status','PENDING_INDEPENDENT_APPEAL_REVIEW','authority_granted',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_request_claim_appeal(UUID,TEXT,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_request_claim_appeal(UUID,TEXT,TEXT) TO service_role;

-- Atomic claim-scoped idempotent intake replacement + receipt. Existing separate
-- legal and compliance authorities remain untouched until a different approved transition.
CREATE OR REPLACE FUNCTION dealer_save_claim_intake_draft(
 p_claim_id UUID,p_claimant_id TEXT,p_schema_version TEXT,p_source_sha TEXT,
 p_workbook_sha TEXT,p_content JSONB,p_summary JSONB,
 p_expected_version INTEGER DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE c dealer_research_claim_requests%ROWTYPE;
  existing dealer_claim_intake_drafts%ROWTYPE; v INTEGER;
BEGIN
 SELECT * INTO c FROM dealer_research_claim_requests WHERE claim_id=p_claim_id FOR UPDATE;
 IF NOT FOUND OR c.claimant_user_id<>p_claimant_id OR c.claim_status<>'CLAIM_APPROVED' THEN
   RAISE EXCEPTION 'CLAIM_APPROVAL_AND_OWNERSHIP_REQUIRED'; END IF;
 IF p_schema_version<>'CARUP_DEALER_INTAKE_1_0' OR
   p_source_sha !~ '^[0-9a-f]{64}$' OR p_workbook_sha !~ '^[0-9a-f]{64}$'
   OR jsonb_typeof(p_content)<>'object' OR jsonb_typeof(p_summary)<>'object'
   THEN RAISE EXCEPTION 'INVALID_CLAIM_INTAKE'; END IF;
 IF NOT EXISTS (SELECT 1 FROM dealer_research_seed_records
  WHERE seed_dealer_id=c.seed_dealer_id AND source_row_sha256=p_source_sha)
  THEN RAISE EXCEPTION 'RESEARCH_SOURCE_VERSION_CONFLICT'; END IF;
 SELECT * INTO existing FROM dealer_claim_intake_drafts WHERE claim_id=p_claim_id FOR UPDATE;
 IF FOUND THEN
   IF existing.workbook_sha256=p_workbook_sha THEN
     RETURN jsonb_build_object('claim_id',p_claim_id,'version',existing.submission_version,
       'duplicate',true,'state',existing.state);
   END IF;
   IF existing.submission_version<>p_expected_version THEN
     RAISE EXCEPTION 'STALE_INTAKE_VERSION'; END IF;
   v:=existing.submission_version+1;
   UPDATE dealer_claim_intake_drafts SET workbook_sha256=p_workbook_sha,
    content=p_content,source_row_sha256=p_source_sha,
    submission_version=v,updated_at=now() WHERE claim_id=p_claim_id;
 ELSE
   IF p_expected_version<>0 THEN RAISE EXCEPTION 'STALE_INTAKE_VERSION'; END IF;
   v:=1;
   INSERT INTO dealer_claim_intake_drafts
     (claim_id,claimant_user_id,schema_version,source_row_sha256,
      workbook_sha256,content,submission_version)
   VALUES (p_claim_id,p_claimant_id,p_schema_version,p_source_sha,
    p_workbook_sha,p_content,v);
 END IF;
 INSERT INTO dealer_claim_intake_receipts
  (claim_id,claimant_user_id,workbook_sha256,version,summary)
 VALUES (p_claim_id,p_claimant_id,p_workbook_sha,v,p_summary)
 ON CONFLICT(claim_id,workbook_sha256) DO NOTHING;
 RETURN jsonb_build_object('claim_id',p_claim_id,'version',v,'duplicate',false,
  'state','CANDIDATE_AWAITING_COMPLIANCE','applied_to_legal_entities',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_save_claim_intake_draft(UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,INTEGER)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_save_claim_intake_draft(UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,INTEGER)
 TO service_role;

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
SET LOCAL carup.dealer_migration_txn = 'on';
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2: SET LOCAL is a silent no-op outside a transaction block, so a migration
  -- run statement by statement in autocommit (plain `psql -f`) would lose its lock_timeout and
  -- could apply half-way. Refuse, and end the session so the client cannot run the remaining
  -- statements. Apply with backend/scripts/dealership/applyDealerMigrations.mjs or
  -- `psql -1 -v ON_ERROR_STOP=1` (one transaction per migration section).
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM 'on' THEN
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: use the dealership migration runner or psql -1 -v ON_ERROR_STOP=1';
    BEGIN
      PERFORM pg_terminate_backend(pg_backend_pid());
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION';
  END IF;
END
$txnguard$;
-- A rollback to the historical single pending-only claim status must fail closed
-- while any reviewed/appealed/revoked claim remains in custody. Operators must
-- migrate the legal records deliberately; never silently rewrite claim truth.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dealer_research_claim_requests
    WHERE claim_status <> 'AWAITING_DOCUMENTARY_EVIDENCE'
  ) THEN
    RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_REVIEWED_CLAIMS';
  END IF;
  -- R6 DBA review 2 #5: an AWAITING claim can already hold a claimant's private documentary
  -- evidence, saved intake drafts or workbook receipts; dropping those tables destroys them.
  IF to_regclass('public.dealer_claim_private_evidence') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM dealer_claim_private_evidence)
       OR EXISTS (SELECT 1 FROM dealer_claim_intake_drafts)
       OR EXISTS (SELECT 1 FROM dealer_claim_intake_receipts)
       OR EXISTS (SELECT 1 FROM dealer_claim_review_events)
       OR EXISTS (SELECT 1 FROM dealer_claim_appeals) THEN
      RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_CLAIM_EVIDENCE_OR_INTAKE_CUSTODY';
    END IF;
  END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_request_claim_appeal(UUID,TEXT,TEXT);
DROP FUNCTION IF EXISTS dealer_save_claim_intake_draft(UUID,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,INTEGER);
DROP FUNCTION IF EXISTS dealer_record_independent_claim_review(UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT);
DROP TABLE IF EXISTS dealer_claim_intake_receipts;
DROP TABLE IF EXISTS dealer_claim_intake_drafts;
DROP TABLE IF EXISTS dealer_claim_appeals;
DROP TABLE IF EXISTS dealer_claim_review_events;
DROP TABLE IF EXISTS dealer_claim_private_evidence;
ALTER TABLE dealer_research_claim_requests DROP CONSTRAINT IF EXISTS dealer_research_claim_requests_claim_status_check;
ALTER TABLE dealer_research_claim_requests ADD CONSTRAINT dealer_research_claim_requests_claim_status_check
 CHECK (claim_status='AWAITING_DOCUMENTARY_EVIDENCE');
