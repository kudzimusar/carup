-- +migrate Up
-- =====================================================================================
-- Milestone 4 — Buyer-facing Vehicle History Report versioning + sharing (master plan §10.5)
--
-- Immutable, versioned report snapshots with expiring share links and correction notices.
-- The report PAYLOAD is assembled by reportService from public-safe data; this table stores
-- the versioned snapshot so a shared report is stable and a correction is traceable.
-- Additive + reversible.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS report_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin             TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  version         INTEGER NOT NULL DEFAULT 1,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- the public-safe assembled report
  content_hash    TEXT,
  completeness    JSONB NOT NULL DEFAULT '{}'::jsonb,
  share_token     TEXT UNIQUE,
  share_expires_at TIMESTAMPTZ,
  revoked         BOOLEAN NOT NULL DEFAULT false,
  correction_notice TEXT,
  supersedes_version INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vin, version)
);

CREATE INDEX IF NOT EXISTS idx_report_versions_vin ON report_versions(vin, version DESC);
CREATE INDEX IF NOT EXISTS idx_report_versions_share ON report_versions(share_token) WHERE share_token IS NOT NULL;

-- Report snapshots are append-only in content; only share/revocation/correction columns may
-- change. Block content mutation to keep shared versions stable + auditable (master plan §10.8).
CREATE OR REPLACE FUNCTION carup_report_version_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.vin IS DISTINCT FROM OLD.vin THEN
    RAISE EXCEPTION 'report_versions content is immutable; only share/revocation/correction fields may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_version_guard ON report_versions;
CREATE TRIGGER trg_report_version_guard
  BEFORE UPDATE ON report_versions
  FOR EACH ROW EXECUTE FUNCTION carup_report_version_guard();

ALTER TABLE IF EXISTS report_versions ENABLE ROW LEVEL SECURITY;
-- Shared-report access is mediated by the API (share token validation); the raw table is not
-- exposed to anon. Authenticated users may read; service_role writes.
REVOKE ALL ON TABLE report_versions FROM anon;
GRANT SELECT ON TABLE report_versions TO authenticated;
DROP POLICY IF EXISTS "report versions authenticated read" ON report_versions;
CREATE POLICY "report versions authenticated read" ON report_versions FOR SELECT TO authenticated USING (true);

-- +migrate Down
DROP TRIGGER IF EXISTS trg_report_version_guard ON report_versions;
DROP FUNCTION IF EXISTS carup_report_version_guard();
DROP TABLE IF EXISTS report_versions;
