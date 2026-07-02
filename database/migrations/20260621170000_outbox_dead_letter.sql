-- +migrate Up
-- =====================================================================================
-- Milestone 6 — Transactional Outbox dead-letter capability
-- Master plan §12.5/§12.6 (infrastructure hardening).
--
-- Design principles:
--   * ADDITIVE & REVERSIBLE. Existing domain_events rows keep their current
--     status values ('pending' | 'processed' | 'failed') and are untouched.
--   * The `status` column is plain TEXT with no CHECK constraint, so introducing
--     the new terminal value 'dead_letter' needs no constraint change.
--   * Adds a single nullable `dead_lettered_at` timestamp + a partial index so
--     operators can query / replay dead-lettered events efficiently.
-- =====================================================================================

-- domain_events may not exist in environments that never ran 011_phase6_schema.sql.
-- Guard the column add so this migration is safe to run independently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'domain_events'
  ) THEN
    ALTER TABLE domain_events
      ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
  END IF;
END
$$;

-- Partial index to quickly find / replay dead-lettered events.
CREATE INDEX IF NOT EXISTS idx_domain_events_dead_letter
  ON domain_events (created_at)
  WHERE status = 'dead_letter';

-- +migrate Down
DROP INDEX IF EXISTS idx_domain_events_dead_letter;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'domain_events'
  ) THEN
    -- Re-classify any dead-lettered rows back to the legacy terminal state so
    -- the column removal does not lose the "this failed permanently" signal.
    UPDATE domain_events SET status = 'failed' WHERE status = 'dead_letter';
    ALTER TABLE domain_events DROP COLUMN IF EXISTS dead_lettered_at;
  END IF;
END
$$;
