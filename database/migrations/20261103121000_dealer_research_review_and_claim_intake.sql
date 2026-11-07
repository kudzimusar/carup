-- +migrate Up
-- CARUP-DEALER-ONB-001 D1/D2: reviewer-authorized research publication and initial claims.
-- The source seed table contains unreviewed private research; it is NEVER publicly exposed.
-- This projection contains only explicitly reviewed fields, no raw contacts, affiliation badges,
-- licence claims, stock counts or verification decision. Claims give NO dealer roles.

CREATE TABLE IF NOT EXISTS dealer_research_publication_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  decision TEXT NOT NULL CHECK (decision IN
    ('PRELISTED_UNCLAIMED','WITHHELD','SUPPRESSED','DUPLICATE','UNDER_DISPUTE')),
  reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  review_reason TEXT NOT NULL CHECK (length(btrim(review_reason)) >= 25),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seed_dealer_id, revision)
);
CREATE TABLE IF NOT EXISTS dealer_research_public_profiles (
  seed_dealer_id TEXT PRIMARY KEY REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  public_slug TEXT NOT NULL UNIQUE,
  public_name TEXT NOT NULL,
  public_city TEXT NOT NULL,
  public_research_category TEXT NOT NULL,
  source_attribution TEXT NOT NULL DEFAULT 'Zimbabwe Car Dealers & Automotive Companies Database',
  publication_status TEXT NOT NULL CHECK (publication_status IN
    ('PRELISTED_UNCLAIMED','WITHHELD','SUPPRESSED','DUPLICATE','UNDER_DISPUTE')),
  review_event_id UUID NOT NULL REFERENCES dealer_research_publication_events(event_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  reviewed_at TIMESTAMPTZ NOT NULL,
  CHECK (public_slug = lower(seed_dealer_id)),
  CHECK (length(btrim(public_name)) > 1),
  CHECK (length(btrim(public_city)) > 1)
);
CREATE INDEX IF NOT EXISTS idx_dealer_research_public_status
  ON dealer_research_public_profiles(publication_status, public_city, public_name);

CREATE TABLE IF NOT EXISTS dealer_research_claim_requests (
  claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  claimant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claimed_scope TEXT NOT NULL CHECK (claimed_scope IN ('BRANCH','PARENT_ORGANIZATION')),
  representative_relationship TEXT NOT NULL CHECK (representative_relationship IN
    ('LEGAL_OWNER','DIRECTOR','AUTHORIZED_REPRESENTATIVE','BRANCH_MANAGER','PARENT_DELEGATE')),
  asserted_legal_business_name TEXT NOT NULL CHECK (length(btrim(asserted_legal_business_name)) BETWEEN 2 AND 180),
  claim_statement TEXT NOT NULL CHECK (length(btrim(claim_statement)) BETWEEN 30 AND 2000),
  claim_status TEXT NOT NULL DEFAULT 'AWAITING_DOCUMENTARY_EVIDENCE'
    CHECK (claim_status = 'AWAITING_DOCUMENTARY_EVIDENCE'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seed_dealer_id, claimant_user_id)
);
COMMENT ON TABLE dealer_research_claim_requests IS
  'Claim intake only. No independent evidence/reviewer approval, tenant grants or roles. Approval is intentionally impossible in this version until the governed documentary review authority is integrated.';

-- Zero direct end-user access, including to contact-rich source candidates and claims.
ALTER TABLE dealer_research_publication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_research_public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_research_claim_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_publication_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON dealer_research_public_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON dealer_research_claim_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON dealer_research_publication_events, dealer_research_public_profiles, dealer_research_claim_requests TO service_role;
GRANT INSERT ON dealer_research_claim_requests TO service_role;

-- Append-only custody for the independent research-publication decision ledger.
DROP TRIGGER IF EXISTS dealer_research_publication_events_no_update ON dealer_research_publication_events;
CREATE TRIGGER dealer_research_publication_events_no_update
  BEFORE UPDATE ON dealer_research_publication_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS dealer_research_publication_events_no_delete ON dealer_research_publication_events;
CREATE TRIGGER dealer_research_publication_events_no_delete
  BEFORE DELETE ON dealer_research_publication_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- One DB-atomic publication decision; only service_role may EXECUTE, after proven
-- authenticated reviewer request. DB re-checks actor privilege and source custody.
CREATE OR REPLACE FUNCTION dealer_record_research_publication_review(
  p_seed_dealer_id TEXT, p_reviewer_id TEXT, p_decision TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source dealer_research_seed_records%ROWTYPE;
  v_reviewer users%ROWTYPE;
  v_rev INTEGER;
  v_event_id UUID;
  v_name TEXT;
  v_city TEXT;
  v_category TEXT;
BEGIN
  IF p_decision NOT IN
    ('PRELISTED_UNCLAIMED','WITHHELD','SUPPRESSED','DUPLICATE','UNDER_DISPUTE') OR
    length(btrim(coalesce(p_reason,''))) < 25 THEN
    RAISE EXCEPTION 'INVALID_DEALER_PUBLICATION_DECISION';
  END IF;
  SELECT * INTO v_reviewer FROM users WHERE id = p_reviewer_id;
  IF NOT FOUND OR v_reviewer.role NOT IN ('admin','reviewer','platform_admin','super_admin')
    OR v_reviewer.is_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INDEPENDENT_REVIEWER_AUTHORITY_REQUIRED';
  END IF;
  SELECT * INTO v_source FROM dealer_research_seed_records
    WHERE seed_dealer_id = p_seed_dealer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_RESEARCH_SEED'; END IF;
  IF v_source.public_profile_state <> 'NOT_PUBLISHED'
    OR v_source.publication_eligibility <> 'PENDING_HUMAN_SOURCE_ELIGIBILITY' THEN
    RAISE EXCEPTION 'RESEARCH_SEED_STATE_CONFLICT';
  END IF;
  v_name := btrim(coalesce(v_source.source_snapshot->>'Dealer / Company Name',''));
  v_city := btrim(coalesce(v_source.source_snapshot->>'City / Town',''));
  IF length(v_name) < 2 OR length(v_city) < 2 THEN
    RAISE EXCEPTION 'UNSAFE_RESEARCH_PUBLIC_FACTS';
  END IF;
  -- Low-assertion, generic category; no unverified OEM/franchise/official language.
  v_category := CASE
    WHEN v_source.proposed_source_category LIKE 'Importer%' THEN 'Vehicle imports (research category)'
    WHEN v_source.proposed_source_category LIKE 'Assembler%' THEN 'Automotive assembly (research category)'
    WHEN v_source.proposed_source_category LIKE 'Marketplace%' THEN 'Automotive marketplace (research category)'
    WHEN v_source.proposed_source_category LIKE 'Dealer and service%' THEN 'Vehicle sales and services (research category)'
    WHEN v_source.proposed_source_category LIKE 'Commercial%' THEN 'Commercial vehicles (research category)'
    ELSE 'Vehicle sales (research category)' END;
  SELECT coalesce(max(revision),0)+1 INTO v_rev
    FROM dealer_research_publication_events
    WHERE seed_dealer_id = p_seed_dealer_id;
  INSERT INTO dealer_research_publication_events
    (seed_dealer_id,revision,decision,reviewer_id,review_reason)
    VALUES (p_seed_dealer_id,v_rev,p_decision,p_reviewer_id,btrim(p_reason))
    RETURNING event_id INTO v_event_id;
  INSERT INTO dealer_research_public_profiles
    (seed_dealer_id,public_slug,public_name,public_city,public_research_category,
      publication_status,review_event_id,revision,reviewed_at)
    VALUES (p_seed_dealer_id,lower(p_seed_dealer_id),v_name,v_city,v_category,
      p_decision,v_event_id,v_rev,now())
    ON CONFLICT (seed_dealer_id) DO UPDATE SET
      public_name=excluded.public_name, public_city=excluded.public_city,
      public_research_category=excluded.public_research_category,
      publication_status=excluded.publication_status,
      review_event_id=excluded.review_event_id, revision=excluded.revision, reviewed_at=excluded.reviewed_at;
  RETURN jsonb_build_object('seed_dealer_id',p_seed_dealer_id,'decision',p_decision,'revision',v_rev,
    'public', p_decision = 'PRELISTED_UNCLAIMED');
END;
$$;
REVOKE ALL ON FUNCTION dealer_record_research_publication_review(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_record_research_publication_review(TEXT,TEXT,TEXT,TEXT) TO service_role;

-- +migrate Down
-- R6 DBA #6: claims are business records and the publication ledger is append-only. Rollback is
-- refused while any exist, before any DDL; dispose of them explicitly, or fix forward.
DO $$
BEGIN
  IF to_regclass('public.dealer_research_claim_requests') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM dealer_research_claim_requests) THEN
      RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_DEALER_CLAIM_REQUESTS';
    END IF;
  END IF;
  IF to_regclass('public.dealer_research_publication_events') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM dealer_research_publication_events)
       OR EXISTS (SELECT 1 FROM dealer_research_public_profiles) THEN
      RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_RESEARCH_PUBLICATION_LEDGER';
    END IF;
  END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_record_research_publication_review(TEXT,TEXT,TEXT,TEXT);
DROP TABLE IF EXISTS dealer_research_claim_requests;
DROP TABLE IF EXISTS dealer_research_public_profiles;
DROP TABLE IF EXISTS dealer_research_publication_events;
