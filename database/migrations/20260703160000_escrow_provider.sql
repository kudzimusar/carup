-- +migrate Up
-- =====================================================================================
-- Vehicle Trust OS — Full Activation: Regulated REAL-MONEY Escrow Provider extension
-- (canonical doc §115–130).
--
-- Extends the trust-gated escrow lifecycle (20260626180000_escrow_trust_sessions) and the
-- shared provider platform (20260703120000_provider_platform) with the regulatory control
-- surface a real-money escrow provider requires BEFORE any real funds may ever move:
--
--   * escrow_provider_config       — per-provider jurisdiction / currency / caps / fees /
--                                    settlement terms / KYC-KYB requirement / pilot allowlist /
--                                    sandbox↔live separation / credential REFERENCE / kill switch.
--   * escrow_kyc_kyb_states        — per-subject (buyer/seller/dealer) KYC-KYB gate state; only
--                                    an evidence REFERENCE (Storage path), never documents/PII.
--   * escrow_reconciliation_ledger — APPEND-ONLY external↔internal money-movement ledger.
--   * escrow_dual_control_approvals— APPEND-ONLY two-distinct-approver record for a sensitive
--                                    manual release/refund.
--
-- NO real funds move without an approved provider, signed contracts, KYC/AML, settlement and
-- real credentials. Sandbox funds are always labelled sandbox and NEVER represented as real
-- money. Money history is immutable (append-only + governance_block_mutation). Additive +
-- reversible. No plaintext credentials or PII are ever stored here.
--
-- Depends on: governance_block_mutation() (20260621160000), provider_registry
-- (20260703120000), escrow_trust_sessions (20260626180000), users (base schema).
-- =====================================================================================

-- 1) Per-provider escrow configuration (control-plane; one active row per provider+jurisdiction+currency).
CREATE TABLE IF NOT EXISTS escrow_provider_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id           UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  jurisdiction          TEXT NOT NULL DEFAULT 'ZW',
  currency              TEXT NOT NULL,
  min_amount_cents      BIGINT NOT NULL DEFAULT 0 CHECK (min_amount_cents >= 0),
  max_amount_cents      BIGINT NOT NULL CHECK (max_amount_cents > 0),
  fee_schedule          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- non-secret fee model (bps, flat, tiers)
  settlement_terms      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- payout rail, settlement window, hold periods
  kyc_kyb_required      BOOLEAN NOT NULL DEFAULT true,        -- fail-closed: KYC/KYB required by default
  pilot_allowlist       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- user/tenant ids permitted during a pilot
  sandbox_live_separation BOOLEAN NOT NULL DEFAULT true,      -- sandbox funds NEVER represented as real money
  -- Reference to a secret held OUTSIDE the database (env/vault key NAME). NEVER a secret value.
  credential_ref        TEXT,
  kill_switch_enabled   BOOLEAN NOT NULL DEFAULT true,        -- fail-closed: no new escrow until explicitly enabled
  active                BOOLEAN NOT NULL DEFAULT false,       -- fail-closed: inactive until governance activates
  created_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (max_amount_cents >= min_amount_cents),
  UNIQUE (provider_id, jurisdiction, currency)
);
CREATE INDEX IF NOT EXISTS idx_escrow_provider_config_provider ON escrow_provider_config(provider_id);
CREATE INDEX IF NOT EXISTS idx_escrow_provider_config_active ON escrow_provider_config(active) WHERE active = true;

-- 2) Per-subject KYC/KYB gate state. evidence_ref is a Storage path ONLY (never documents/PII).
CREATE TABLE IF NOT EXISTS escrow_kyc_kyb_states (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('buyer','seller','dealer')),
  subject_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id   UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  status        TEXT NOT NULL DEFAULT 'not_started'
                  CHECK (status IN ('not_started','pending','approved','rejected','expired')),
  evidence_ref  TEXT,                                          -- private Storage path reference ONLY
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject_type, subject_id, provider_id)               -- idempotent: one state per subject+provider
);
CREATE INDEX IF NOT EXISTS idx_escrow_kyc_provider ON escrow_kyc_kyb_states(provider_id);
CREATE INDEX IF NOT EXISTS idx_escrow_kyc_subject ON escrow_kyc_kyb_states(subject_id);
CREATE INDEX IF NOT EXISTS idx_escrow_kyc_status ON escrow_kyc_kyb_states(status);

-- 3) APPEND-ONLY reconciliation ledger: external provider amount vs internal escrow amount.
CREATE TABLE IF NOT EXISTS escrow_reconciliation_ledger (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID REFERENCES escrow_trust_sessions(id) ON DELETE RESTRICT,
  provider_id          UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  external_txn_ref     TEXT,
  internal_amount_cents BIGINT,
  external_amount_cents BIGINT,
  matched              BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_escrow_recon_ledger_session ON escrow_reconciliation_ledger(session_id);
CREATE INDEX IF NOT EXISTS idx_escrow_recon_ledger_provider ON escrow_reconciliation_ledger(provider_id, created_at DESC);
-- Idempotent recording per external transaction reference (a provider txn is booked once).
CREATE UNIQUE INDEX IF NOT EXISTS uq_escrow_recon_ledger_ext
  ON escrow_reconciliation_ledger(provider_id, external_txn_ref) WHERE external_txn_ref IS NOT NULL;

-- 4) APPEND-ONLY dual-control approvals for a sensitive manual release/refund.
--    A CHECK enforces two DISTINCT, non-null approvers at the schema level.
CREATE TABLE IF NOT EXISTS escrow_dual_control_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES escrow_trust_sessions(id) ON DELETE RESTRICT,
  action        TEXT NOT NULL CHECK (action IN ('release','refund')),
  approver_1_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approver_2_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (approver_1_id <> approver_2_id)                       -- two DISTINCT approvers required
);
CREATE INDEX IF NOT EXISTS idx_escrow_dual_control_session ON escrow_dual_control_approvals(session_id, created_at DESC);

-- Append-only enforcement on money history (ledger + dual-control approvals): block UPDATE + DELETE.
DROP TRIGGER IF EXISTS escrow_recon_ledger_no_update ON escrow_reconciliation_ledger;
CREATE TRIGGER escrow_recon_ledger_no_update BEFORE UPDATE ON escrow_reconciliation_ledger
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS escrow_recon_ledger_no_delete ON escrow_reconciliation_ledger;
CREATE TRIGGER escrow_recon_ledger_no_delete BEFORE DELETE ON escrow_reconciliation_ledger
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS escrow_dual_control_no_update ON escrow_dual_control_approvals;
CREATE TRIGGER escrow_dual_control_no_update BEFORE UPDATE ON escrow_dual_control_approvals
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS escrow_dual_control_no_delete ON escrow_dual_control_approvals;
CREATE TRIGGER escrow_dual_control_no_delete BEFORE DELETE ON escrow_dual_control_approvals
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- RLS: service_role full; admin/government read control-plane + money history; participants read
-- their own KYC / dual-control rows. No anon; no general authenticated writes.
ALTER TABLE escrow_provider_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_kyc_kyb_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_reconciliation_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_dual_control_approvals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE escrow_provider_config, escrow_kyc_kyb_states,
  escrow_reconciliation_ledger, escrow_dual_control_approvals FROM anon;
GRANT ALL ON TABLE escrow_provider_config, escrow_kyc_kyb_states,
  escrow_reconciliation_ledger, escrow_dual_control_approvals TO service_role;
GRANT SELECT ON TABLE escrow_provider_config, escrow_kyc_kyb_states,
  escrow_reconciliation_ledger, escrow_dual_control_approvals TO authenticated;

-- provider config: admin/government only.
DROP POLICY IF EXISTS "escrow_provider_config admin read" ON escrow_provider_config;
CREATE POLICY "escrow_provider_config admin read" ON escrow_provider_config FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));

-- KYC/KYB: admin/government + the subject themselves.
DROP POLICY IF EXISTS "escrow_kyc admin read" ON escrow_kyc_kyb_states;
CREATE POLICY "escrow_kyc admin read" ON escrow_kyc_kyb_states FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));
DROP POLICY IF EXISTS "escrow_kyc subject read" ON escrow_kyc_kyb_states;
CREATE POLICY "escrow_kyc subject read" ON escrow_kyc_kyb_states FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND subject_id = auth.uid()::text);

-- reconciliation ledger: admin/government only (money integrity view).
DROP POLICY IF EXISTS "escrow_recon admin read" ON escrow_reconciliation_ledger;
CREATE POLICY "escrow_recon admin read" ON escrow_reconciliation_ledger FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));

-- dual-control approvals: admin/government + the session participants (buyer/seller).
DROP POLICY IF EXISTS "escrow_dual_control admin read" ON escrow_dual_control_approvals;
CREATE POLICY "escrow_dual_control admin read" ON escrow_dual_control_approvals FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));
DROP POLICY IF EXISTS "escrow_dual_control participant read" ON escrow_dual_control_approvals;
CREATE POLICY "escrow_dual_control participant read" ON escrow_dual_control_approvals FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM escrow_trust_sessions s WHERE s.id = escrow_dual_control_approvals.session_id
      AND (s.buyer_id = auth.uid()::text OR s.seller_id = auth.uid()::text)));

-- +migrate Down
DROP TRIGGER IF EXISTS escrow_dual_control_no_delete ON escrow_dual_control_approvals;
DROP TRIGGER IF EXISTS escrow_dual_control_no_update ON escrow_dual_control_approvals;
DROP TRIGGER IF EXISTS escrow_recon_ledger_no_delete ON escrow_reconciliation_ledger;
DROP TRIGGER IF EXISTS escrow_recon_ledger_no_update ON escrow_reconciliation_ledger;
DROP TABLE IF EXISTS escrow_dual_control_approvals;
DROP TABLE IF EXISTS escrow_reconciliation_ledger;
DROP TABLE IF EXISTS escrow_kyc_kyb_states;
DROP TABLE IF EXISTS escrow_provider_config;
