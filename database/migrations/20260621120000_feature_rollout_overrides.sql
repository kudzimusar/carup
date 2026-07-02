-- Feature governance: runtime rollout overrides.
--
-- Backend-persisted, server-owned overrides that overlay the static feature
-- manifest (shared/navigation/feature-manifest.json) at runtime. An override can
-- DISABLE / restrict a feature or set a permitted lifecycle/role/tenant/time
-- window; it can NEVER grant access broader than the immutable static policy
-- (enforced in the service layer). Service-role only — never client-writable.
--
-- Idempotent and safe to apply more than once. STAGING-ONLY until Product Owner
-- approves a production apply (see NAVIGATION_BLUEPRINT_ROLLBACK_RUNBOOK.md).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS feature_rollout_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  -- NULL lifecycle_state => keep the feature's static default lifecycle.
  lifecycle_state TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_roles TEXT[],
  allowed_tenant_ids TEXT[] NOT NULL DEFAULT '{}',
  denied_tenant_ids TEXT[] NOT NULL DEFAULT '{}',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  beta_message TEXT,
  reason TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT feature_rollout_overrides_env_valid
    CHECK (environment IN ('development', 'staging', 'production')),
  CONSTRAINT feature_rollout_overrides_lifecycle_valid
    CHECK (lifecycle_state IS NULL OR lifecycle_state IN
      ('active', 'beta', 'planned', 'hidden', 'disabled', 'deprecated')),
  CONSTRAINT feature_rollout_overrides_window_valid
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT feature_rollout_overrides_version_positive
    CHECK (version >= 1)
);

-- One override row per feature per environment (optimistic concurrency on top).
CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_rollout_overrides_feature_env
  ON feature_rollout_overrides (feature_id, environment);

CREATE INDEX IF NOT EXISTS idx_feature_rollout_overrides_feature
  ON feature_rollout_overrides (feature_id);
CREATE INDEX IF NOT EXISTS idx_feature_rollout_overrides_environment
  ON feature_rollout_overrides (environment);
CREATE INDEX IF NOT EXISTS idx_feature_rollout_overrides_updated_at
  ON feature_rollout_overrides (updated_at);

-- Keep updated_at fresh on UPDATE.
CREATE OR REPLACE FUNCTION feature_rollout_overrides_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feature_rollout_overrides_touch ON feature_rollout_overrides;
CREATE TRIGGER trg_feature_rollout_overrides_touch
  BEFORE UPDATE ON feature_rollout_overrides
  FOR EACH ROW EXECUTE FUNCTION feature_rollout_overrides_touch_updated_at();

-- Server-owned: service_role only. No anon/authenticated client access.
ALTER TABLE feature_rollout_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE feature_rollout_overrides FROM anon;
REVOKE ALL ON TABLE feature_rollout_overrides FROM authenticated;
GRANT ALL ON TABLE feature_rollout_overrides TO service_role;

-- ── Rollback (manual; see runbook) ──────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_feature_rollout_overrides_touch ON feature_rollout_overrides;
-- DROP FUNCTION IF EXISTS feature_rollout_overrides_touch_updated_at();
-- DROP TABLE IF EXISTS feature_rollout_overrides;
