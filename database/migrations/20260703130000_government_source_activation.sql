-- +migrate Up
-- =====================================================================================
-- Vehicle Trust OS — Full Activation: Government Source Activation Layer
--
-- Adds the per-source activation configuration and the append-only batch-import ledger
-- for the five Zimbabwe registries (ZIMRA, CVR, ZINARA, VID, CID). This layer sits on top
-- of the shared provider platform (20260703120000_provider_platform.sql): each government
-- source is a `provider_registry` row of capability_type='government_source', and this
-- migration records HOW that provider is wired (transport, required identifiers, expected
-- fields, privacy constraints) plus every secure batch-file import as an immutable event.
--
-- Honesty + safety rules enforced structurally:
--   * A config row references a real provider_registry row (ON DELETE RESTRICT) — a source
--     can never be "configured" without an underlying governed provider.
--   * source_key is constrained to the five sanctioned registries.
--   * batch imports are APPEND-ONLY (governance_block_mutation) and store only a Storage
--     PATH REFERENCE (file_ref) + checksum + row_count — never the file contents/PII.
--   * RLS: service_role writes; admin/government read only. No anon, no general writes.
--
-- Depends on:
--   * provider_registry              (20260703120000_provider_platform.sql)
--   * governance_block_mutation()    (20260621160000_governance_disputes_corrections.sql)
--   * users(id)                      (pre-existing)
-- Additive + reversible. No plaintext credentials or provider payloads are stored here.
-- =====================================================================================

-- Per-source activation configuration. Mutable (active toggles; transport swaps as a source
-- moves sandbox -> partner_file -> pilot -> live), so NOT append-only. One config per
-- (provider_id, source_key).
CREATE TABLE IF NOT EXISTS government_source_config (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  source_key           TEXT NOT NULL CHECK (source_key IN ('zimra','cvr','zinara','vid','cid')),
  transport            TEXT NOT NULL DEFAULT 'simulator'
                         CHECK (transport IN ('simulator','official_api','partner_api',
                                 'signed_webhook','secure_batch_file','manual_verification')),
  -- Identifiers the source needs to answer a query (e.g. ["vin","chassis"]). Structural doc.
  required_identifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Minimum-semantics fields the source is expected to return (§76-80 of the activation goal).
  expected_fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Privacy/legal constraints: which returned fields are privileged-only vs buyer-safe, etc.
  privacy_constraints  JSONB NOT NULL DEFAULT '{}'::jsonb,
  active               BOOLEAN NOT NULL DEFAULT false,
  tenant_id            TEXT,
  created_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_gov_source_config_provider ON government_source_config(provider_id);
CREATE INDEX IF NOT EXISTS idx_gov_source_config_source ON government_source_config(source_key, active);

-- Append-only ledger of secure batch/file imports. A status transition (pending ->
-- processing -> imported/rejected) is recorded as a NEW immutable row referencing the same
-- file_ref — the table is never UPDATEd or DELETEd. Stores a Storage PATH ONLY, never the
-- file bytes or any registry PII.
CREATE TABLE IF NOT EXISTS government_source_batch_imports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  source_key    TEXT NOT NULL CHECK (source_key IN ('zimra','cvr','zinara','vid','cid')),
  file_ref      TEXT NOT NULL,                       -- private Storage path reference, NOT contents
  checksum      TEXT,                                -- integrity of the referenced file
  row_count     INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','imported','rejected')),
  detail        TEXT,
  imported_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  tenant_id     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gov_batch_provider ON government_source_batch_imports(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_batch_source ON government_source_batch_imports(source_key, status);
CREATE INDEX IF NOT EXISTS idx_gov_batch_file_ref ON government_source_batch_imports(file_ref);

-- Append-only enforcement: a batch-import record is a historical fact.
DROP TRIGGER IF EXISTS gov_batch_no_update ON government_source_batch_imports;
CREATE TRIGGER gov_batch_no_update BEFORE UPDATE ON government_source_batch_imports
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS gov_batch_no_delete ON government_source_batch_imports;
CREATE TRIGGER gov_batch_no_delete BEFORE DELETE ON government_source_batch_imports
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- RLS: control-plane is service_role + admin/government read only.
ALTER TABLE government_source_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE government_source_batch_imports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE government_source_config, government_source_batch_imports FROM anon;
GRANT ALL ON TABLE government_source_config, government_source_batch_imports TO service_role;
GRANT SELECT ON TABLE government_source_config, government_source_batch_imports TO authenticated;

DROP POLICY IF EXISTS "gov_source_config admin read" ON government_source_config;
CREATE POLICY "gov_source_config admin read" ON government_source_config FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));

DROP POLICY IF EXISTS "gov_batch admin read" ON government_source_batch_imports;
CREATE POLICY "gov_batch admin read" ON government_source_batch_imports FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));

-- +migrate Down
DROP TRIGGER IF EXISTS gov_batch_no_update ON government_source_batch_imports;
DROP TRIGGER IF EXISTS gov_batch_no_delete ON government_source_batch_imports;
DROP TABLE IF EXISTS government_source_batch_imports;
DROP TABLE IF EXISTS government_source_config;
