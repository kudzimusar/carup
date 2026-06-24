-- +migrate Up
-- =====================================================================================
-- Milestone 2 — External Source Ingestion Framework (master plan §6)
--
-- Builds durable historical-evidence acquisition on top of the M1 source registry and
-- provenance model. Idempotent, reversible, additive.
--   * ingestion_jobs              durable job state machine (retry / quarantine / DLQ)
--   * source_records              raw + normalized external records, dedupe-keyed
--   * vehicle_identity_candidates ambiguous-match human resolution queue (§6.4)
--   * listing_snapshots           immutable, versioned listing captures (§6.5)
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) Ingestion jobs — durable state machine (master plan §6.2)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  adapter_id      TEXT NOT NULL,
  job_type        TEXT NOT NULL DEFAULT 'poll'
                    CHECK (job_type IN ('poll','webhook','backfill','reprocess')),
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','succeeded','partial',
                                      'failed_retryable','failed_terminal',
                                      'quarantined','dead_letter')),
  idempotency_key TEXT UNIQUE,
  cursor          TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_retry_at   TIMESTAMPTZ,
  last_error      TEXT,
  stats           JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source ON ingestion_jobs(source_id);

-- -------------------------------------------------------------------------------------
-- 2) Source records — raw + normalized, idempotent per (source, source_record_id) §6.2
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_job_id  UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
  source_id         UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  source_record_id  TEXT NOT NULL,
  record_hash       TEXT,
  raw_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'received'
                      CHECK (status IN ('received','quarantined','mapped','imported',
                                        'duplicate','needs_identity_review','failed')),
  quarantine_reason TEXT,
  vehicle_vin       TEXT REFERENCES vehicles(vin) ON DELETE SET NULL,
  identity_confidence NUMERIC,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_source_records_job ON source_records(ingestion_job_id);
CREATE INDEX IF NOT EXISTS idx_source_records_status ON source_records(status);
CREATE INDEX IF NOT EXISTS idx_source_records_vin ON source_records(vehicle_vin);

-- -------------------------------------------------------------------------------------
-- 3) Vehicle identity candidates — human resolution queue (master plan §6.4)
--    Ambiguous matches NEVER silently attach; they wait for a reviewer.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_identity_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id UUID NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
  candidate_vin   TEXT REFERENCES vehicles(vin) ON DELETE SET NULL,
  match_method    TEXT NOT NULL CHECK (match_method IN (
                    'vin','chassis','plate','engine','source_vehicle_id',
                    'auction_lot','make_model_year','visual')),
  confidence      NUMERIC NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','rejected','superseded')),
  resolved_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_candidates_record ON vehicle_identity_candidates(source_record_id);
CREATE INDEX IF NOT EXISTS idx_identity_candidates_status ON vehicle_identity_candidates(status, confidence DESC);

-- -------------------------------------------------------------------------------------
-- 4) Listing snapshots — immutable, versioned (master plan §6.5)
--    Each capture is a new row; "current" = highest version per (source, source_record_id).
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  source_record_id    TEXT,
  vin                 TEXT REFERENCES vehicles(vin) ON DELETE SET NULL,
  listing_url         TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title               TEXT,
  description         TEXT,
  price               NUMERIC,
  currency            TEXT,
  advertised_mileage  NUMERIC,
  mileage_unit        TEXT,
  claimed_condition   TEXT,
  claimed_accident_status TEXT,
  image_refs          JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, source_record_id, version)
);

CREATE INDEX IF NOT EXISTS idx_listing_snapshots_vin ON listing_snapshots(vin, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_record ON listing_snapshots(source_id, source_record_id, version DESC);

-- Append-only enforcement for listing snapshots (immutable captures) — master plan §6.5.
CREATE OR REPLACE FUNCTION carup_listing_snapshot_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'listing_snapshots is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listing_snapshot_no_update ON listing_snapshots;
CREATE TRIGGER trg_listing_snapshot_no_update
  BEFORE UPDATE ON listing_snapshots
  FOR EACH ROW EXECUTE FUNCTION carup_listing_snapshot_block_mutation();

DROP TRIGGER IF EXISTS trg_listing_snapshot_no_delete ON listing_snapshots;
CREATE TRIGGER trg_listing_snapshot_no_delete
  BEFORE DELETE ON listing_snapshots
  FOR EACH ROW EXECUTE FUNCTION carup_listing_snapshot_block_mutation();

-- -------------------------------------------------------------------------------------
-- 5) RLS + grants — ingestion data is operational; never exposed to anon.
-- -------------------------------------------------------------------------------------
ALTER TABLE IF EXISTS ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS vehicle_identity_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS listing_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ingestion_jobs FROM anon;
REVOKE ALL ON TABLE source_records FROM anon;
REVOKE ALL ON TABLE vehicle_identity_candidates FROM anon;
-- Listing snapshots: a public-safe summary may surface in reports later via the service
-- allowlist, but the raw table is not exposed to anon here.
REVOKE ALL ON TABLE listing_snapshots FROM anon;

GRANT SELECT ON TABLE ingestion_jobs TO authenticated;
GRANT SELECT ON TABLE source_records TO authenticated;
GRANT SELECT ON TABLE vehicle_identity_candidates TO authenticated;
GRANT SELECT ON TABLE listing_snapshots TO authenticated;

DROP POLICY IF EXISTS "ingestion jobs authenticated read" ON ingestion_jobs;
CREATE POLICY "ingestion jobs authenticated read" ON ingestion_jobs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "source records authenticated read" ON source_records;
CREATE POLICY "source records authenticated read" ON source_records FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "identity candidates authenticated read" ON vehicle_identity_candidates;
CREATE POLICY "identity candidates authenticated read" ON vehicle_identity_candidates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "listing snapshots authenticated read" ON listing_snapshots;
CREATE POLICY "listing snapshots authenticated read" ON listing_snapshots FOR SELECT TO authenticated USING (true);

-- +migrate Down

DROP TRIGGER IF EXISTS trg_listing_snapshot_no_delete ON listing_snapshots;
DROP TRIGGER IF EXISTS trg_listing_snapshot_no_update ON listing_snapshots;
DROP FUNCTION IF EXISTS carup_listing_snapshot_block_mutation();
DROP TABLE IF EXISTS listing_snapshots;
DROP TABLE IF EXISTS vehicle_identity_candidates;
DROP TABLE IF EXISTS source_records;
DROP TABLE IF EXISTS ingestion_jobs;
