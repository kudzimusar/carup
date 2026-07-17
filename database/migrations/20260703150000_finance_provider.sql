-- +migrate Up
-- =====================================================================================
-- Vehicle Trust OS — Full Activation: Regulated Lender (Finance) Provider Workflow
-- Canonical goal §101-113 ("Finance"): a production-ready lender workflow that EXTENDS the
-- existing shared eligibility framework (20260626160000) and provider platform
-- (20260703120000). It adds:
--   • lender_profiles            — regulated-lender configuration (products, eligibility
--                                  rules, consent + retention terms, contract + credential
--                                  REFERENCE only). Never a secret value.
--   • finance_consents           — applicant consent ledger with retention controls
--                                  (revocation + deletion-request stamps). Core consent
--                                  fields are immutable (content guard); rows are never
--                                  hard-deleted (append/retention semantics).
--   • finance_provider_decisions — append-only lender decision history. Snapshots ONLY the
--                                  trust/evidence/fraud/publication/dealer gate context —
--                                  NEVER raw applicant / affordability / income / credit
--                                  data. Immutable (governance_block_mutation).
--
-- Privacy invariant (canonical §112): NO applicant, affordability, income or credit data
-- exists in ANY public passport or general Partner API projection. This migration stores no
-- such data at all, exposes nothing to `anon`, and grants only tightly-scoped RLS reads.
--
-- Depends on: governance_block_mutation() (20260621160000), provider_registry
-- (20260703120000), eligibility_requests + users + vehicles.
-- Additive, marker-aware and reversible. No plaintext credentials are ever stored here.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) lender_profiles — one row per configured regulated lender (control-plane config).
--    Contains NO applicant data. Binds a provider_registry row (finance capability) to the
--    lender's legal identity, product catalogue, eligibility rules and consent/retention
--    terms. `credential_ref` names WHERE a secret lives (env/vault) — never the secret.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lender_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  legal_name        TEXT NOT NULL,
  products          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- offered finance products (non-secret)
  eligibility_rules JSONB NOT NULL DEFAULT '{}'::jsonb,   -- coarse rule config (min term, jurisdictions...)
  consent_terms     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- consent version + scope requirements
  retention_terms   JSONB NOT NULL DEFAULT '{}'::jsonb,   -- retention window + deletion process reference
  contract_status   TEXT NOT NULL DEFAULT 'none'
                      CHECK (contract_status IN ('none','draft','pending','signed','expired','terminated')),
  credential_ref    TEXT,                                 -- reference (env key NAME) only — never a secret
  active            BOOLEAN NOT NULL DEFAULT false,        -- fail-closed: inactive until explicitly enabled
  tenant_id         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, legal_name)
);
CREATE INDEX IF NOT EXISTS idx_lender_profiles_provider ON lender_profiles(provider_id);
CREATE INDEX IF NOT EXISTS idx_lender_profiles_active ON lender_profiles(active) WHERE active = true;

-- -------------------------------------------------------------------------------------
-- 2) finance_consents — applicant consent ledger + retention controls.
--    A consent grant is one row. Core consent fields (vin/applicant/version/scope/granted_at)
--    are immutable; only the retention-lifecycle stamps revoked_at / deletion_requested_at
--    may be set later (revocation + right-to-erasure request). Rows are never hard-deleted
--    (append/retention semantics) — actual purge is a separate, documented retention job.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_consents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                 TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  applicant_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consent_version     TEXT NOT NULL,
  scope               JSONB NOT NULL DEFAULT '{}'::jsonb,  -- what the applicant authorised (non-sensitive scope descriptor)
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ,                         -- retention control: consent withdrawn
  deletion_requested_at TIMESTAMPTZ,                       -- retention control: right-to-erasure requested
  tenant_id           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_finance_consents_vin ON finance_consents(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_consents_applicant ON finance_consents(applicant_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_consents_active ON finance_consents(vin, applicant_user_id)
  WHERE revoked_at IS NULL AND deletion_requested_at IS NULL;

-- -------------------------------------------------------------------------------------
-- 3) finance_provider_decisions — append-only lender decision history.
--    decision_inputs_snapshot captures ONLY the gate context (trust/evidence/fraud/
--    publication/dealer) at decision time — NEVER raw applicant/affordability/income/credit
--    data. Immutable (governance_block_mutation). Links to the eligibility_request that
--    drove it (RESTRICT: a decision's request can never be silently removed).
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_provider_decisions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eligibility_request_id UUID REFERENCES eligibility_requests(id) ON DELETE RESTRICT,
  lender_provider_id     UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  consent_id             UUID REFERENCES finance_consents(id) ON DELETE RESTRICT,
  vin                    TEXT REFERENCES vehicles(vin) ON DELETE RESTRICT,
  mode                   TEXT NOT NULL DEFAULT 'sandbox',
  outcome                TEXT NOT NULL CHECK (outcome IN
                           ('potentially_eligible','conditional','manual_review','declined',
                            'unavailable','expired','failed')),
  conditions             JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_reference     TEXT,
  -- Gate snapshot ONLY. A CHECK forbids the obvious sensitive keys from ever landing here.
  decision_inputs_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
                           CHECK (
                             NOT (decision_inputs_snapshot ? 'income')
                             AND NOT (decision_inputs_snapshot ? 'monthly_income')
                             AND NOT (decision_inputs_snapshot ? 'credit_score')
                             AND NOT (decision_inputs_snapshot ? 'affordability')
                             AND NOT (decision_inputs_snapshot ? 'monthly_debts')
                             AND NOT (decision_inputs_snapshot ? 'ssn')
                           ),
  correlation_id         TEXT,
  error_category         TEXT,
  validity_until         TIMESTAMPTZ,
  decision_version       TEXT NOT NULL DEFAULT 'finance-dec-1.0.0',
  actor                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fin_dec_request ON finance_provider_decisions(eligibility_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_dec_provider ON finance_provider_decisions(lender_provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_dec_vin ON finance_provider_decisions(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_dec_consent ON finance_provider_decisions(consent_id);

-- -------------------------------------------------------------------------------------
-- Immutability + retention enforcement
-- -------------------------------------------------------------------------------------
-- finance_provider_decisions: strictly append-only (no UPDATE, no DELETE).
DROP TRIGGER IF EXISTS fin_dec_no_update ON finance_provider_decisions;
CREATE TRIGGER fin_dec_no_update BEFORE UPDATE ON finance_provider_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS fin_dec_no_delete ON finance_provider_decisions;
CREATE TRIGGER fin_dec_no_delete BEFORE DELETE ON finance_provider_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- finance_consents: core consent content is immutable; only retention-lifecycle stamps
-- (revoked_at, deletion_requested_at) may change. No hard DELETE (retention/audit).
CREATE OR REPLACE FUNCTION carup_finance_consent_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance_consents is append-only; request erasure via deletion_requested_at instead of DELETE';
  END IF;
  IF NEW.vin IS DISTINCT FROM OLD.vin
     OR NEW.applicant_user_id IS DISTINCT FROM OLD.applicant_user_id
     OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
    RAISE EXCEPTION 'finance_consents core content is immutable; only revoked_at/deletion_requested_at may be updated';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_finance_consent_guard_update ON finance_consents;
CREATE TRIGGER trg_finance_consent_guard_update BEFORE UPDATE ON finance_consents
  FOR EACH ROW EXECUTE FUNCTION carup_finance_consent_guard();
DROP TRIGGER IF EXISTS trg_finance_consent_no_delete ON finance_consents;
CREATE TRIGGER trg_finance_consent_no_delete BEFORE DELETE ON finance_consents
  FOR EACH ROW EXECUTE FUNCTION carup_finance_consent_guard();

-- -------------------------------------------------------------------------------------
-- RLS — private underwriting surface. No anon. service_role full. Admin reads all.
-- Applicant (owner / requester) reads only their own consent + decisions. There is NO
-- public or general-authenticated projection of any applicant/credit/decision detail —
-- coarse public availability is derived in the service layer, never from these tables.
-- -------------------------------------------------------------------------------------
ALTER TABLE lender_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_provider_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE lender_profiles, finance_consents, finance_provider_decisions FROM anon;
GRANT ALL ON TABLE lender_profiles, finance_consents, finance_provider_decisions TO service_role;
GRANT SELECT ON TABLE finance_consents, finance_provider_decisions TO authenticated;

-- lender_profiles: admin/government control-plane read only (no applicant data, still private config).
DROP POLICY IF EXISTS "lender_profiles admin read" ON lender_profiles;
CREATE POLICY "lender_profiles admin read" ON lender_profiles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));

-- finance_consents: admin read all; applicant reads own (as consenter or vehicle owner).
DROP POLICY IF EXISTS "finance_consents admin read" ON finance_consents;
CREATE POLICY "finance_consents admin read" ON finance_consents FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));
DROP POLICY IF EXISTS "finance_consents applicant read" ON finance_consents;
CREATE POLICY "finance_consents applicant read" ON finance_consents FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (
    applicant_user_id = auth.uid()::text OR
    EXISTS (SELECT 1 FROM vehicles v WHERE v.vin = finance_consents.vin AND v.owner_id = auth.uid()::text)));

-- finance_provider_decisions: admin read all; applicant reads decisions for their own vehicle
-- or their own eligibility request. NEVER exposed to buyers, dealers-at-large or Partner API.
DROP POLICY IF EXISTS "finance_decisions admin read" ON finance_provider_decisions;
CREATE POLICY "finance_decisions admin read" ON finance_provider_decisions FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));
DROP POLICY IF EXISTS "finance_decisions applicant read" ON finance_provider_decisions;
CREATE POLICY "finance_decisions applicant read" ON finance_provider_decisions FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM vehicles v WHERE v.vin = finance_provider_decisions.vin AND v.owner_id = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM eligibility_requests er
               WHERE er.id = finance_provider_decisions.eligibility_request_id
                 AND er.requested_by = auth.uid()::text)));

-- +migrate Down
DROP TRIGGER IF EXISTS trg_finance_consent_guard_update ON finance_consents;
DROP TRIGGER IF EXISTS trg_finance_consent_no_delete ON finance_consents;
DROP TRIGGER IF EXISTS fin_dec_no_update ON finance_provider_decisions;
DROP TRIGGER IF EXISTS fin_dec_no_delete ON finance_provider_decisions;
DROP FUNCTION IF EXISTS carup_finance_consent_guard();
DROP TABLE IF EXISTS finance_provider_decisions;
DROP TABLE IF EXISTS finance_consents;
DROP TABLE IF EXISTS lender_profiles;
