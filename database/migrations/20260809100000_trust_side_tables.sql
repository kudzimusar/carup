-- =============================================================
-- TRUST SIDE TABLES — create two tables the runtime already writes
-- =============================================================
-- The database-compatibility audit (2026-08-09) live-verified that BOTH of
-- these tables are ABSENT on staging while the runtime writes them:
--   · trust_score_history — trustGraphService.recordTrustScoreHistory inserts
--     on every trust-score change inside a try/catch whose comment admits
--     "Table may not exist yet"; every change has therefore been silently
--     unrecorded.
--   · rolling_integrity_checkpoints — blockchainService.addEvent upserts
--     (onConflict 'vin') every 10th ledger event and verifyLedger reads it;
--     the upsert requires a unique index on vin.
-- Both are internal service-role surfaces: RLS enabled with zero policies
-- (default-deny for API roles), explicit REVOKE from anon/authenticated.

-- +migrate Up

CREATE TABLE IF NOT EXISTS trust_score_history (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  previous_score REAL,
  new_score REAL,
  trigger_event TEXT,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trust_score_history_entity
  ON trust_score_history(entity_type, entity_id, "timestamp");

CREATE TABLE IF NOT EXISTS rolling_integrity_checkpoints (
  vin TEXT PRIMARY KEY REFERENCES vehicles(vin) ON DELETE CASCADE,
  last_verified_event_id BIGINT,
  rolling_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL
);

ALTER TABLE trust_score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rolling_integrity_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON trust_score_history FROM anon, authenticated;
REVOKE ALL ON rolling_integrity_checkpoints FROM anon, authenticated;
GRANT ALL ON trust_score_history TO service_role;
GRANT ALL ON rolling_integrity_checkpoints TO service_role;
GRANT USAGE, SELECT ON SEQUENCE trust_score_history_id_seq TO service_role;

-- +migrate Down
DROP TABLE IF EXISTS rolling_integrity_checkpoints;
DROP TABLE IF EXISTS trust_score_history;
