-- +migrate Up
-- Public correction/removal requests do not confer business ownership, modify a research
-- publication, or trigger automatic suppression. All disposition is independent review.
CREATE TABLE IF NOT EXISTS dealer_research_correction_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_dealer_id TEXT NOT NULL REFERENCES dealer_research_seed_records(seed_dealer_id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('CORRECTION','REMOVAL','BUSINESS_CLOSED','IDENTITY_DISPUTE')),
  request_summary TEXT NOT NULL CHECK (length(btrim(request_summary)) BETWEEN 30 AND 2000),
  contact_email TEXT CHECK (contact_email IS NULL OR length(contact_email) BETWEEN 3 AND 200),
  status TEXT NOT NULL DEFAULT 'PENDING_HUMAN_REVIEW'
    CHECK (status = 'PENDING_HUMAN_REVIEW'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dealer_research_correction_requests IS
  'Private requested correction/takedown queue; cannot self-revoke or assume ownership. Public source projection is affected only by an independent publication review.';
ALTER TABLE dealer_research_correction_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_correction_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON dealer_research_correction_requests TO service_role;
CREATE INDEX IF NOT EXISTS idx_dealer_research_correction_queue
  ON dealer_research_correction_requests (seed_dealer_id,created_at DESC);
-- +migrate Down
-- R6 DBA #6: a public correction/takedown request is a third party's record. Rollback is refused
-- while any exist, before any DDL; dispose of them explicitly, or fix forward.
DO $$
BEGIN
  IF to_regclass('public.dealer_research_correction_requests') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM dealer_research_correction_requests) THEN
      RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_RESEARCH_CORRECTION_REQUESTS';
    END IF;
  END IF;
END;
$$;
DROP TABLE IF EXISTS dealer_research_correction_requests;
