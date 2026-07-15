-- +migrate Up
-- Referral V1 Stage 4: one marketplace inquiry may create at most one
-- qualifiable local-marketplace referral lead, even under concurrent retries.
--
-- Compatibility:
--   * Additive partial unique index only; no table/column rewrites.
--   * Before applying to staging, verify the conflict check below returns 0 rows:
--       SELECT subject_id, COUNT(*)
--       FROM referral_events
--       WHERE event_type = 'local_marketplace.lead_created'
--         AND subject_type = 'local_marketplace_lead'
--         AND subject_id IS NOT NULL
--       GROUP BY subject_id
--       HAVING COUNT(*) > 1;
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_referral_events_unique_local_marketplace_lead_subject;

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_events_unique_local_marketplace_lead_subject
  ON referral_events (subject_type, subject_id)
  WHERE event_type = 'local_marketplace.lead_created'
    AND subject_type = 'local_marketplace_lead'
    AND subject_id IS NOT NULL;

-- +migrate Down
DROP INDEX IF EXISTS idx_referral_events_unique_local_marketplace_lead_subject;
