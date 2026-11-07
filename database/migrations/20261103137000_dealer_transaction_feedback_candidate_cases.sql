-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Session-scoped, exactly as 20261103141000.
SET lock_timeout = '3s';
-- CARUP-DEALER-ONB-001 C23 D8: buyer-linked complaint and feedback candidates.
-- Canonical transaction remains escrow_trust_sessions; this is a private case
-- and moderation ledger, NOT payment, settlement, buyer verification or review stars.
DO $$
BEGIN
 IF to_regclass('public.escrow_trust_sessions') IS NULL OR
   to_regclass('public.dealer_approved_seed_links') IS NULL THEN
   RAISE EXCEPTION 'CANONICAL_DEALER_AND_TRANSACTION_LINEAGE_REQUIRED';
 END IF;
END;
$$;
CREATE TABLE dealer_transaction_feedback_cases(
 case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
 transaction_intent_id UUID NOT NULL REFERENCES escrow_trust_sessions(id) ON DELETE RESTRICT,
 buyer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 case_type TEXT NOT NULL CHECK(case_type IN ('BUYER_COMPLAINT','REVIEW_CANDIDATE')),
 statement TEXT NOT NULL CHECK(length(btrim(statement)) BETWEEN 40 AND 2000),
 statement_sha256 TEXT NOT NULL CHECK(statement_sha256 ~ '^[a-f0-9]{64}$'),
 submitted_rating INTEGER CHECK(submitted_rating BETWEEN 1 AND 5),
 canonical_transaction_state_at_submission TEXT NOT NULL,
 transaction_verified_for_public_review BOOLEAN NOT NULL DEFAULT false
   CHECK(transaction_verified_for_public_review=false),
 public_review_eligible BOOLEAN NOT NULL DEFAULT false
   CHECK(public_review_eligible=false),
 source_class TEXT NOT NULL DEFAULT 'UNQUALIFIED_OR_SANDBOX_CANONICAL_INTENT'
   CHECK(source_class='UNQUALIFIED_OR_SANDBOX_CANONICAL_INTENT'),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(transaction_intent_id,buyer_user_id,case_type),
 CHECK((case_type='BUYER_COMPLAINT' AND submitted_rating IS NULL) OR
   (case_type='REVIEW_CANDIDATE' AND submitted_rating IS NOT NULL))
);
CREATE INDEX dealer_feedback_private_buyer
 ON dealer_transaction_feedback_cases(buyer_user_id,submitted_at DESC);
CREATE INDEX dealer_feedback_private_seed
 ON dealer_transaction_feedback_cases(seed_dealer_id,submitted_at DESC);
CREATE TABLE dealer_transaction_feedback_review_events(
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id UUID NOT NULL UNIQUE REFERENCES dealer_transaction_feedback_cases(case_id) ON DELETE RESTRICT,
 reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 finding TEXT NOT NULL CHECK(finding IN (
   'NEEDS_BUYER_EVIDENCE','REFERRED_TO_CANONICAL_DISPUTE',
   'NOT_ELIGIBLE_FOR_PUBLIC_REVIEW')),
 rationale TEXT NOT NULL CHECK(length(btrim(rationale)) BETWEEN 80 AND 3000),
 verified_transaction_represented BOOLEAN NOT NULL DEFAULT false
   CHECK(verified_transaction_represented=false),
 public_review_published BOOLEAN NOT NULL DEFAULT false
   CHECK(public_review_published=false),
 payment_or_dispute_status_modified BOOLEAN NOT NULL DEFAULT false
   CHECK(payment_or_dispute_status_modified=false),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER dealer_transaction_feedback_cases_no_update
 BEFORE UPDATE ON dealer_transaction_feedback_cases FOR EACH ROW
 EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_transaction_feedback_cases_no_delete
 BEFORE DELETE ON dealer_transaction_feedback_cases FOR EACH ROW
 EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_transaction_feedback_review_events_no_update
 BEFORE UPDATE ON dealer_transaction_feedback_review_events FOR EACH ROW
 EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_transaction_feedback_review_events_no_delete
 BEFORE DELETE ON dealer_transaction_feedback_review_events FOR EACH ROW
 EXECUTE FUNCTION governance_block_mutation();
ALTER TABLE dealer_transaction_feedback_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_transaction_feedback_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_transaction_feedback_cases FROM PUBLIC,anon,authenticated;
REVOKE ALL ON dealer_transaction_feedback_review_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_transaction_feedback_cases TO service_role;
GRANT SELECT ON dealer_transaction_feedback_review_events TO service_role;
COMMENT ON TABLE dealer_transaction_feedback_cases IS
 'Private buyer case with exact canonical transaction FK, not a verified purchase/review, never public. A sandbox release cannot become a five-star verified rating.';
CREATE FUNCTION dealer_record_transaction_feedback_case(
 p_seed_dealer_id TEXT,p_transaction_id UUID,p_buyer_id TEXT,
 p_type TEXT,p_statement TEXT,p_rating INTEGER DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 v_tx escrow_trust_sessions%ROWTYPE;
 v_link dealer_approved_seed_links%ROWTYPE;
 v_digest TEXT;
 v_record dealer_transaction_feedback_cases%ROWTYPE;
 v_id UUID;
BEGIN
 IF p_type NOT IN ('BUYER_COMPLAINT','REVIEW_CANDIDATE') OR
   length(btrim(coalesce(p_statement,''))) NOT BETWEEN 40 AND 2000 OR
   (p_type='BUYER_COMPLAINT' AND p_rating IS NOT NULL) OR
   (p_type='REVIEW_CANDIDATE' AND (p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5)) THEN
   RAISE EXCEPTION 'INVALID_BUYER_FEEDBACK_CANDIDATE';
 END IF;
 SELECT * INTO v_tx FROM escrow_trust_sessions
   WHERE id=p_transaction_id FOR SHARE;
 IF NOT FOUND OR v_tx.buyer_id IS DISTINCT FROM p_buyer_id THEN
   RAISE EXCEPTION 'EXACT_CANONICAL_TRANSACTION_BUYER_REQUIRED'; END IF;
 IF p_type='REVIEW_CANDIDATE' AND v_tx.status<>'released_sandbox' THEN
   RAISE EXCEPTION 'REVIEW_CANDIDATE_REQUIRES_CANONICAL_RELEASE_EVIDENCE'; END IF;
 SELECT * INTO v_link FROM dealer_approved_seed_links
   WHERE seed_dealer_id=p_seed_dealer_id;
 IF NOT FOUND OR v_tx.tenant_id IS DISTINCT FROM v_link.tenant_id::TEXT THEN
   RAISE EXCEPTION 'EXACT_TRANSACTION_DEALER_TENANT_REQUIRED'; END IF;
 -- Historical complaints remain possible after dealership suspension.
 v_digest:=encode(sha256(convert_to(btrim(p_statement),'UTF8')),'hex');
 INSERT INTO dealer_transaction_feedback_cases(
   seed_dealer_id,transaction_intent_id,buyer_user_id,
   case_type,statement,statement_sha256,submitted_rating,
   canonical_transaction_state_at_submission)
 VALUES(p_seed_dealer_id,p_transaction_id,p_buyer_id,p_type,
   btrim(p_statement),v_digest,p_rating,v_tx.status)
 ON CONFLICT(transaction_intent_id,buyer_user_id,case_type) DO NOTHING
 RETURNING case_id INTO v_id;
 IF v_id IS NULL THEN
   SELECT * INTO v_record FROM dealer_transaction_feedback_cases
   WHERE transaction_intent_id=p_transaction_id AND buyer_user_id=p_buyer_id
     AND case_type=p_type FOR SHARE;
   IF NOT FOUND OR v_record.statement_sha256<>v_digest OR
     v_record.submitted_rating IS DISTINCT FROM p_rating OR
     v_record.seed_dealer_id<>p_seed_dealer_id THEN
     RAISE EXCEPTION 'FEEDBACK_CASE_ALREADY_SUBMITTED_WITH_DIFFERENT_CONTENT';
   END IF;
   v_id:=v_record.case_id;
 END IF;
 RETURN jsonb_build_object('case_id',v_id,'case_type',p_type,
   'state','PRIVATE_CASE_AWAITING_INDEPENDENT_REVIEW',
   'verified_purchase',false,'public_review_eligible',false,
   'dealer_complaint_count_published',false,'payment_changed',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_transaction_feedback_case(TEXT,UUID,TEXT,TEXT,TEXT,INTEGER)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_transaction_feedback_case(TEXT,UUID,TEXT,TEXT,TEXT,INTEGER)
 TO service_role;

CREATE FUNCTION dealer_record_transaction_feedback_finding(
 p_case_id UUID,p_reviewer_id TEXT,p_finding TEXT,p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE c dealer_transaction_feedback_cases%ROWTYPE;
 r users%ROWTYPE;v_event UUID;
BEGIN
 IF p_finding NOT IN ('NEEDS_BUYER_EVIDENCE','REFERRED_TO_CANONICAL_DISPUTE',
 'NOT_ELIGIBLE_FOR_PUBLIC_REVIEW') OR
 length(btrim(coalesce(p_reason,''))) NOT BETWEEN 80 AND 3000 THEN
   RAISE EXCEPTION 'INVALID_BUYER_CASE_REVIEW_FINDING'; END IF;
 SELECT * INTO c FROM dealer_transaction_feedback_cases
   WHERE case_id=p_case_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUYER_CASE_NOT_FOUND'; END IF;
 SELECT * INTO r FROM users WHERE id=p_reviewer_id;
 IF NOT FOUND OR r.role NOT IN ('admin','reviewer','platform_admin','super_admin')
   OR r.is_verified IS DISTINCT FROM true OR
   r.id=c.buyer_user_id THEN
   RAISE EXCEPTION 'INDEPENDENT_BUYER_CASE_REVIEWER_REQUIRED'; END IF;
 -- An independent platform reviewer may not be the dealership legal owner.
 -- Buyer consent and legal company authority are separate maker/checker roles.
 -- Even an owner granted a platform review role cannot judge their own case.
 IF EXISTS(SELECT 1 FROM dealer_approved_seed_links owner_link
    WHERE owner_link.seed_dealer_id=c.seed_dealer_id
      AND owner_link.claimant_user_id=p_reviewer_id) THEN
   RAISE EXCEPTION 'DEALER_CANNOT_REVIEW_OWN_BUYER_CASE';
 END IF;
 INSERT INTO dealer_transaction_feedback_review_events(
   case_id,reviewer_user_id,finding,rationale)
 VALUES(p_case_id,p_reviewer_id,p_finding,btrim(p_reason))
 RETURNING event_id INTO v_event;
 RETURN jsonb_build_object('event_id',v_event,'finding',p_finding,
   'public_verified_review',false,
   'canonical_dispute_case_modified',false,
   'provider_payment_status_modified',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_transaction_feedback_finding(UUID,TEXT,TEXT,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_transaction_feedback_finding(UUID,TEXT,TEXT,TEXT)
 TO service_role;

-- +migrate Down
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM dealer_transaction_feedback_cases) OR
   EXISTS(SELECT 1 FROM dealer_transaction_feedback_review_events) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_BUYER_FEEDBACK_CUSTODY';
 END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_record_transaction_feedback_finding(UUID,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS dealer_record_transaction_feedback_case(TEXT,UUID,TEXT,TEXT,TEXT,INTEGER);
DROP TABLE IF EXISTS dealer_transaction_feedback_review_events;
DROP TABLE IF EXISTS dealer_transaction_feedback_cases;
