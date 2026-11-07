-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Session-scoped, exactly as 20261103141000.
SET lock_timeout = '3s';
-- CARUP-DEALER-ONB-001 C14 D7: private canonical branch operating declarations.
-- No GPS coordinate or dealer-entered schedule establishes public verification.
ALTER TABLE dealer_branches
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS opening_hours_text TEXT,
  ADD COLUMN IF NOT EXISTS operating_details_updated_at TIMESTAMPTZ;
-- R6 DBA #7: these CHECKs are deliberately NOT split into NOT VALID + VALIDATE. Both constrain
-- only the columns added just above, which are NULL on every existing row, so validation cannot
-- fail; and ADD COLUMN already holds ACCESS EXCLUSIVE on dealer_branches until this migration's
-- transaction commits, so an in-transaction VALIDATE would not shorten any lock (it only helps
-- in a separate transaction). lock_timeout above bounds the wait for that lock instead.
ALTER TABLE dealer_branches
  ADD CONSTRAINT dealer_branch_gps_pair_valid
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR
    (latitude IS NOT NULL AND longitude IS NOT NULL
     AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );
ALTER TABLE dealer_branches
  ADD CONSTRAINT dealer_branch_hours_text_valid
  CHECK(opening_hours_text IS NULL OR length(btrim(opening_hours_text)) BETWEEN 1 AND 350);
COMMENT ON COLUMN dealer_branches.latitude IS 'Private dealer-declared coordinate; independently verified public location NOT inferred';
COMMENT ON COLUMN dealer_branches.longitude IS 'Private dealer-declared coordinate; independently verified public location NOT inferred';
COMMENT ON COLUMN dealer_branches.opening_hours_text IS 'Private dealer-declared schedule, never an open-now assertion';

-- +migrate Down
-- Protect user business data; rollback cannot silently discard declarations.
DO $$
BEGIN
 IF EXISTS(
   SELECT 1 FROM dealer_branches WHERE
     latitude IS NOT NULL OR longitude IS NOT NULL OR
     opening_hours_text IS NOT NULL OR operating_details_updated_at IS NOT NULL
 ) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_BRANCH_OPERATING_DETAILS';
 END IF;
END;
$$;
ALTER TABLE dealer_branches
  DROP CONSTRAINT IF EXISTS dealer_branch_hours_text_valid,
  DROP CONSTRAINT IF EXISTS dealer_branch_gps_pair_valid;
ALTER TABLE dealer_branches
  DROP COLUMN IF EXISTS operating_details_updated_at,
  DROP COLUMN IF EXISTS opening_hours_text,
  DROP COLUMN IF EXISTS longitude,
  DROP COLUMN IF EXISTS latitude;
