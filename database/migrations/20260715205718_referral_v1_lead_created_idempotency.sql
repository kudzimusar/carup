-- +migrate Up
-- Referral V1 Stage 4: within one tenant, one marketplace inquiry may create
-- at most one inquiry-derived qualifiable local-marketplace referral lead,
-- even under concurrent retries.
--
-- Compatibility:
--   * Additive partial unique index only; no table/column rewrites.
--   * Scoped to inquiry-derived leads only. Manual/non-inquiry local leads are
--     intentionally not covered by this index.
--   * Before applying to staging, verify the conflict check below returns 0 rows:
--       SELECT tenant_id, metadata->>'source_inquiry_id' AS source_inquiry_id, COUNT(*)
--       FROM referral_events
--       WHERE event_type = 'local_marketplace.lead_created'
--         AND subject_type = 'local_marketplace_lead'
--         AND metadata ? 'source_inquiry_id'
--         AND NULLIF(metadata->>'source_inquiry_id', '') IS NOT NULL
--       GROUP BY tenant_id, metadata->>'source_inquiry_id'
--       HAVING COUNT(*) > 1;
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_referral_events_unique_marketplace_inquiry_lead;

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_events_unique_marketplace_inquiry_lead
  ON referral_events (tenant_id, (metadata->>'source_inquiry_id'))
  WHERE event_type = 'local_marketplace.lead_created'
    AND subject_type = 'local_marketplace_lead'
    AND metadata ? 'source_inquiry_id'
    AND NULLIF(metadata->>'source_inquiry_id', '') IS NOT NULL;

-- +migrate Down
DROP INDEX IF EXISTS idx_referral_events_unique_marketplace_inquiry_lead;
