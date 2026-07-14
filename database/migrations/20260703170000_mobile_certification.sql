-- +migrate Up
-- =====================================================================================
-- Vehicle Trust OS — Full Activation: Native Mobile Certification evidence (canonical §132-154, §167)
--
-- Persists the results of certifying release-grade native builds of the offline evidence
-- capture/upload workflow (the durable upload queue in mobile/store/uploadQueueStore.ts).
-- Two tables:
--   * mobile_certification_runs    — one row per (platform, device_model, os_version, build)
--                                    certification attempt. MUTABLE only for status lifecycle
--                                    (pending -> running -> passed/failed/blocked) + completion.
--   * mobile_certification_results — APPEND-ONLY per-check outcome ledger. Once a check result
--                                    is recorded it can never be updated or deleted (a device
--                                    certification record is audit evidence — immutable like the
--                                    other governed/decision histories in this program).
--
-- evidence_ref stores a Supabase Storage PATH ONLY (private bucket, signed short-lived access) —
-- never a public URL and never the bytes. Screenshots/traces live in Storage; this column points.
--
-- Depends on:
--   * governance_block_mutation()  (20260621160000_governance_disputes_corrections.sql)
--   * users(id, role)              (pre-existing production schema) for the admin-read RLS policy
--
-- Additive + reversible. Indexed FKs, tenant ownership, RLS, least-privilege grants,
-- append-only guard on the results ledger. No plaintext secrets. No device bytes.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) mobile_certification_runs — one certification attempt per device/OS/build
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mobile_certification_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      TEXT NOT NULL CHECK (platform IN ('android','ios')),
  device_model  TEXT NOT NULL,                       -- e.g. 'Pixel 6a', 'Galaxy A14', 'iPhone 13'
  os_version    TEXT NOT NULL,                        -- e.g. 'Android 14', 'iOS 17.5'
  build_type    TEXT NOT NULL CHECK (build_type IN ('debug','release')),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','passed','failed','blocked')),
  tenant_id     TEXT,                                 -- tenant ownership (nullable for platform-global runs)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mobile_cert_runs_platform ON mobile_certification_runs(platform, status);
CREATE INDEX IF NOT EXISTS idx_mobile_cert_runs_tenant ON mobile_certification_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mobile_cert_runs_created ON mobile_certification_runs(created_at DESC);

-- -------------------------------------------------------------------------------------
-- 2) mobile_certification_results — APPEND-ONLY per-check ledger (audit evidence)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mobile_certification_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES mobile_certification_runs(id) ON DELETE RESTRICT,
  check_key     TEXT NOT NULL,                        -- e.g. 'offline_queue_persist_restart', 'idempotency_dedupe'
  result        TEXT NOT NULL CHECK (result IN ('pass','fail','skip')),
  detail        TEXT,                                 -- human-readable outcome / defect note
  evidence_ref  TEXT,                                 -- Supabase Storage PATH ONLY (private bucket). Never a URL/bytes.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indexed FK (query results by run) + a check-key index for matrix aggregation.
CREATE INDEX IF NOT EXISTS idx_mobile_cert_results_run ON mobile_certification_results(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mobile_cert_results_check ON mobile_certification_results(check_key);
CREATE INDEX IF NOT EXISTS idx_mobile_cert_results_result ON mobile_certification_results(result);

-- Append-only enforcement: a recorded certification result is immutable audit evidence.
DROP TRIGGER IF EXISTS mobile_cert_results_no_update ON mobile_certification_results;
CREATE TRIGGER mobile_cert_results_no_update
  BEFORE UPDATE ON mobile_certification_results
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS mobile_cert_results_no_delete ON mobile_certification_results;
CREATE TRIGGER mobile_cert_results_no_delete
  BEFORE DELETE ON mobile_certification_results
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- -------------------------------------------------------------------------------------
-- 3) RLS + least-privilege grants — service_role writes; admin/government read only.
--    No anon access at all. Certification evidence is not a public surface.
-- -------------------------------------------------------------------------------------
ALTER TABLE mobile_certification_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_certification_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE mobile_certification_runs, mobile_certification_results FROM anon;
GRANT ALL ON TABLE mobile_certification_runs, mobile_certification_results TO service_role;
GRANT SELECT ON TABLE mobile_certification_runs, mobile_certification_results TO authenticated;

DROP POLICY IF EXISTS "mobile_cert_runs admin read" ON mobile_certification_runs;
CREATE POLICY "mobile_cert_runs admin read" ON mobile_certification_runs FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));

DROP POLICY IF EXISTS "mobile_cert_results admin read" ON mobile_certification_results;
CREATE POLICY "mobile_cert_results admin read" ON mobile_certification_results FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));

-- +migrate Down
DROP TRIGGER IF EXISTS mobile_cert_results_no_update ON mobile_certification_results;
DROP TRIGGER IF EXISTS mobile_cert_results_no_delete ON mobile_certification_results;
DROP POLICY IF EXISTS "mobile_cert_results admin read" ON mobile_certification_results;
DROP POLICY IF EXISTS "mobile_cert_runs admin read" ON mobile_certification_runs;
DROP TABLE IF EXISTS mobile_certification_results;
DROP TABLE IF EXISTS mobile_certification_runs;
