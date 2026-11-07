-- +migrate Up
-- CARUP-DEALER-ONB-001 D1/D4: RESEARCH CANDIDATES ONLY.
-- Never treat one seed row as a legal organization, dealership tenant, seller or verified branch.
-- This additive private table has NO public/anon/authenticated read policies or public projection.
CREATE TABLE IF NOT EXISTS dealer_research_seed_records (
  seed_dealer_id            TEXT PRIMARY KEY
    CHECK (seed_dealer_id ~ '^ZW-DEAL-[0-9]{4}$'),
  source_workbook_sha256    TEXT NOT NULL
    CHECK (source_workbook_sha256 ~ '^[0-9a-f]{64}$'),
  original_source_row      INTEGER NOT NULL
    CHECK (original_source_row BETWEEN 8 AND 111),
  source_row_sha256         TEXT NOT NULL
    CHECK (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  source_snapshot          JSONB NOT NULL,
  proposed_source_category TEXT,
  grouping_review          TEXT NOT NULL DEFAULT 'UNREVIEWED_PARENT_BRANCH_MATCH',
  publication_eligibility  TEXT NOT NULL DEFAULT 'PENDING_HUMAN_SOURCE_ELIGIBILITY',
  claim_lifecycle          TEXT NOT NULL DEFAULT 'UNCLAIMED_NO_APPROVED_CLAIM',
  logo_rights_status       TEXT NOT NULL DEFAULT 'PLACEHOLDER_UNTIL_RIGHTS_REVIEW',
  public_profile_state     TEXT NOT NULL DEFAULT 'NOT_PUBLISHED',
  candidate_record_state   TEXT NOT NULL DEFAULT 'RESEARCH_ONLY_NOT_LEGAL_ENTITY',
  imported_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(source_snapshot) = 'object'),
  CHECK (publication_eligibility = 'PENDING_HUMAN_SOURCE_ELIGIBILITY'),
  CHECK (public_profile_state = 'NOT_PUBLISHED'),
  CHECK (candidate_record_state = 'RESEARCH_ONLY_NOT_LEGAL_ENTITY')
);
COMMENT ON TABLE dealer_research_seed_records IS
  'Private immutable research seed snapshots, NOT canonical legal entities or published dealer profiles; contains RESTRICTED unreviewed contact and source claims. Separate reviewer-governed public projection required.';
CREATE INDEX IF NOT EXISTS idx_dealer_research_seed_workbook
  ON dealer_research_seed_records (source_workbook_sha256, original_source_row);
ALTER TABLE dealer_research_seed_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_research_seed_records FROM PUBLIC;
REVOKE ALL ON dealer_research_seed_records FROM anon;
REVOKE ALL ON dealer_research_seed_records FROM authenticated;
GRANT SELECT, INSERT ON dealer_research_seed_records TO service_role;
-- Deliberately no RLS policy for visitor or dealer, no public view, no update privilege.
-- A correction/identity-review flow must be introduced separately with audit custody.
-- +migrate Down
-- R6 DBA #6: imported research snapshots are custody (source row hashes, provenance). Rollback is
-- refused while any exist, before any DDL; dispose of them explicitly, or fix forward.
DO $$
BEGIN
  IF to_regclass('public.dealer_research_seed_records') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM dealer_research_seed_records) THEN
      RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_RESEARCH_SEED_CUSTODY';
    END IF;
  END IF;
END;
$$;
DROP TABLE IF EXISTS dealer_research_seed_records;
