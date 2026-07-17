-- +migrate Up
-- =====================================================================================
-- Vehicle Trust OS — Full Activation: Shared Provider Platform (foundation)
--
-- One provider control-plane for government sources, insurers, lenders and escrow
-- providers. The existing sourceVerification / eligibility / escrow services register
-- here and inherit: activation modes, secure credential *references* (never secrets),
-- correlation/idempotency, health + incident state, scheduled reconciliation, immutable
-- request/result/activation history, and global + per-provider kill switches.
--
-- Depends on governance_block_mutation() (20260621160000).
-- Additive + reversible. No plaintext credentials are ever stored here.
-- =====================================================================================

-- The provider registry: one row per configured provider instance.
CREATE TABLE IF NOT EXISTS provider_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key    TEXT NOT NULL,                       -- e.g. 'zimra', 'cvr', 'insurer_acme', 'lender_x', 'escrow_y'
  capability_type TEXT NOT NULL CHECK (capability_type IN ('government_source','insurance','finance','escrow')),
  jurisdiction    TEXT NOT NULL DEFAULT 'ZW',
  display_name    TEXT NOT NULL,
  -- 11 honesty-labelled activation modes. Nothing is 'live' without a real approved provider.
  activation_mode TEXT NOT NULL DEFAULT 'not_configured'
                    CHECK (activation_mode IN ('not_configured','contract_pending','credential_pending',
                            'sandbox','partner_file','manual','pilot_live','live','degraded','unavailable','suspended')),
  contract_status TEXT NOT NULL DEFAULT 'none'
                    CHECK (contract_status IN ('none','draft','pending','signed','expired','terminated')),
  -- Reference to a secret held OUTSIDE the database (e.g. a Vault/Vercel env key NAME). Never a secret value.
  credential_ref  TEXT,
  transport       TEXT NOT NULL DEFAULT 'simulator'
                    CHECK (transport IN ('simulator','official_api','partner_api','signed_webhook','secure_batch_file','manual_verification')),
  endpoint_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,  -- SSRF control: outbound hosts permitted
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,     -- non-secret config (regions, products, limits)
  health_state    TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (health_state IN ('unknown','healthy','degraded','down')),
  incident_state  TEXT NOT NULL DEFAULT 'none'
                    CHECK (incident_state IN ('none','investigating','active','resolved')),
  kill_switch_enabled BOOLEAN NOT NULL DEFAULT true,   -- fail-closed: new calls blocked until explicitly enabled
  rate_limit_per_min  INTEGER NOT NULL DEFAULT 60,
  tenant_id       TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_key, capability_type, jurisdiction)
);
CREATE INDEX IF NOT EXISTS idx_provider_registry_cap ON provider_registry(capability_type, activation_mode);
CREATE INDEX IF NOT EXISTS idx_provider_registry_key ON provider_registry(provider_key);

-- Versioned request/response contracts per provider (schema evolution without rewrites).
CREATE TABLE IF NOT EXISTS provider_contract_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  version       TEXT NOT NULL,
  request_schema  JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, version)
);
CREATE INDEX IF NOT EXISTS idx_provider_contract_provider ON provider_contract_versions(provider_id);

-- Append-only request attempt log (correlation + idempotency + outcome). Money/gov history is immutable.
CREATE TABLE IF NOT EXISTS provider_request_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id      UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  capability_type  TEXT NOT NULL,
  correlation_id   TEXT NOT NULL,
  idempotency_key  TEXT,
  vin              TEXT,
  request_ref      TEXT,
  mode             TEXT NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('ok','mismatch','no_record','high_risk','unavailable','timeout','rate_limited','malformed','invalid_signature','duplicate','circuit_open','error')),
  attempt          INTEGER NOT NULL DEFAULT 1,
  latency_ms       INTEGER,
  error_category   TEXT,
  tenant_id        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_provider_attempts_provider ON provider_request_attempts(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_attempts_corr ON provider_request_attempts(correlation_id);
CREATE INDEX IF NOT EXISTS idx_provider_attempts_idem ON provider_request_attempts(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Provider health checks (time series) + incidents.
CREATE TABLE IF NOT EXISTS provider_health_checks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID NOT NULL REFERENCES provider_registry(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('healthy','degraded','down')),
  latency_ms   INTEGER,
  detail       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_health_provider ON provider_health_checks(provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_incidents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  severity     TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status       TEXT NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating','active','mitigated','resolved')),
  summary      TEXT NOT NULL,
  opened_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_provider_incidents_provider ON provider_incidents(provider_id, opened_at DESC);

-- Scheduled reconciliation jobs + unmatched-event queue (financial/governed integrity).
CREATE TABLE IF NOT EXISTS reconciliation_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  capability_type TEXT NOT NULL,
  window_start  TIMESTAMPTZ,
  window_end    TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','partial','failed')),
  matched_count   INTEGER NOT NULL DEFAULT 0,
  mismatch_count  INTEGER NOT NULL DEFAULT 0,
  report_ref    TEXT,                                   -- Storage path reference (private bucket)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recon_jobs_provider ON reconciliation_jobs(provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_mismatches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES reconciliation_jobs(id) ON DELETE RESTRICT,
  provider_id   UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  external_ref  TEXT,
  internal_ref  TEXT,
  mismatch_type TEXT NOT NULL,
  detail        JSONB,
  resolution    TEXT NOT NULL DEFAULT 'open' CHECK (resolution IN ('open','investigating','resolved','written_off')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recon_mismatch_job ON reconciliation_mismatches(job_id);
CREATE INDEX IF NOT EXISTS idx_recon_mismatch_open ON reconciliation_mismatches(resolution) WHERE resolution = 'open';

-- Append-only activation/suspension history (who changed a provider's mode + why).
CREATE TABLE IF NOT EXISTS provider_activation_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  from_mode     TEXT,
  to_mode       TEXT NOT NULL,
  reason        TEXT,
  actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_activation_provider ON provider_activation_history(provider_id, created_at DESC);

-- Append-only enforcement on immutable histories.
DROP TRIGGER IF EXISTS provider_attempts_no_update ON provider_request_attempts;
CREATE TRIGGER provider_attempts_no_update BEFORE UPDATE ON provider_request_attempts FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS provider_attempts_no_delete ON provider_request_attempts;
CREATE TRIGGER provider_attempts_no_delete BEFORE DELETE ON provider_request_attempts FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS provider_activation_no_update ON provider_activation_history;
CREATE TRIGGER provider_activation_no_update BEFORE UPDATE ON provider_activation_history FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS provider_activation_no_delete ON provider_activation_history;
CREATE TRIGGER provider_activation_no_delete BEFORE DELETE ON provider_activation_history FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- RLS: control-plane is service-role + admin/government only. No anon, no general authenticated writes.
ALTER TABLE provider_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_request_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_mismatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_activation_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE provider_registry, provider_contract_versions, provider_request_attempts,
  provider_health_checks, provider_incidents, reconciliation_jobs, reconciliation_mismatches,
  provider_activation_history FROM anon;
GRANT ALL ON TABLE provider_registry, provider_contract_versions, provider_request_attempts,
  provider_health_checks, provider_incidents, reconciliation_jobs, reconciliation_mismatches,
  provider_activation_history TO service_role;
GRANT SELECT ON TABLE provider_registry, provider_request_attempts, provider_incidents,
  reconciliation_jobs, reconciliation_mismatches, provider_activation_history TO authenticated;

DROP POLICY IF EXISTS "provider_registry admin read" ON provider_registry;
CREATE POLICY "provider_registry admin read" ON provider_registry FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));
DROP POLICY IF EXISTS "provider_attempts admin read" ON provider_request_attempts;
CREATE POLICY "provider_attempts admin read" ON provider_request_attempts FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));

-- +migrate Down
DROP TRIGGER IF EXISTS provider_attempts_no_update ON provider_request_attempts;
DROP TRIGGER IF EXISTS provider_attempts_no_delete ON provider_request_attempts;
DROP TRIGGER IF EXISTS provider_activation_no_update ON provider_activation_history;
DROP TRIGGER IF EXISTS provider_activation_no_delete ON provider_activation_history;
DROP TABLE IF EXISTS reconciliation_mismatches;
DROP TABLE IF EXISTS reconciliation_jobs;
DROP TABLE IF EXISTS provider_activation_history;
DROP TABLE IF EXISTS provider_incidents;
DROP TABLE IF EXISTS provider_health_checks;
DROP TABLE IF EXISTS provider_request_attempts;
DROP TABLE IF EXISTS provider_contract_versions;
DROP TABLE IF EXISTS provider_registry;
