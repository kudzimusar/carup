-- +migrate Up
-- =====================================================================================
-- Vehicle Trust OS — Full Activation: Licensed Insurer Provider (canonical doc §84–99)
--
-- Production-ready insurer onboarding + execution, layered on the shared provider platform
-- (20260703120000_provider_platform.sql) and the shared eligibility framework
-- (20260626160000_eligibility_framework.sql). This migration is ADDITIVE and reversible.
--
-- Separation of concerns (privacy by construction):
--   * PUBLIC vehicle facts live in `vehicles` (unchanged).
--   * PRIVATE underwriting/applicant context is NEVER stored as a public fact. An insurer
--     decision row records only the OUTCOME + a provider reference + owner-facing conditions
--     + validity — never premiums, risk scores, or applicant PII. Consent scope is held in
--     `insurance_consents` and is readable only by the consenting owner + admins + service_role.
--
-- Honesty + safety:
--   * A new insurer profile is fail-closed: active=false, contract_status='none'.
--   * `credential_ref` is a REFERENCE only (env/vault key NAME) — never a secret value.
--   * Decisions are append-only (governance_block_mutation). A policy/eligibility is NEVER
--     recorded as 'eligible' without a confirmed provider_reference (enforced in the service).
--   * Consents are append-only with a one-way revocation (insurance_consent_guard): scope and
--     grant facts are immutable; revoked_at may transition NULL -> timestamp exactly once.
--
-- Depends on: governance_block_mutation() (20260621160000), provider_registry
-- (20260703120000), eligibility_requests (20260626160000), vehicles, users.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 0) One-way consent guard: immutable except a single NULL -> timestamp revocation.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION insurance_consent_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'insurance_consents is append-only: DELETE is not permitted';
  END IF;
  -- UPDATE is permitted ONLY to record a one-way revocation. Every other column is immutable.
  IF NOT (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'insurance_consents is append-only: only a one-way revocation (revoked_at NULL->set) is permitted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.vin IS DISTINCT FROM OLD.vin
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.insurer_profile_id IS DISTINCT FROM OLD.insurer_profile_id
     OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
     OR NEW.scope::text IS DISTINCT FROM OLD.scope::text
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'insurance_consents is append-only: consent facts are immutable (only revoked_at may be set)';
  END IF;
  RETURN NEW;
END;
$$;

-- -------------------------------------------------------------------------------------
-- 1) insurer_profiles — the licensed insurer control-plane record.
--    One profile per registered provider_registry row (capability_type='insurance').
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insurer_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID NOT NULL REFERENCES provider_registry(id) ON DELETE RESTRICT,
  legal_name          TEXT NOT NULL,
  products            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- e.g. ["third_party","comprehensive"]
  regions             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- e.g. ["ZW-HRE","ZW-BYO"]
  contract_status     TEXT NOT NULL DEFAULT 'none'
                        CHECK (contract_status IN ('none','draft','pending','signed','expired','terminated')),
  -- Reference to a secret held OUTSIDE the database (env/vault key NAME). NEVER a secret value.
  credential_ref      TEXT,
  consent_version     TEXT NOT NULL DEFAULT 'insurer-consent-1.0.0',
  -- Minimum data the insurer is contractually permitted to receive. Public vehicle facts only.
  min_data_projection JSONB NOT NULL DEFAULT '{"required":[],"optional":[]}'::jsonb,
  active              BOOLEAN NOT NULL DEFAULT false,       -- fail-closed until explicitly activated
  tenant_id           TEXT,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id)
);
CREATE INDEX IF NOT EXISTS idx_insurer_profiles_provider ON insurer_profiles(provider_id);
CREATE INDEX IF NOT EXISTS idx_insurer_profiles_active ON insurer_profiles(active) WHERE active = true;

-- -------------------------------------------------------------------------------------
-- 2) insurance_consents — append-only consent ledger (one-way revocation).
--    The private link between a vehicle owner and an insurer's permitted data scope.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insurance_consents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                 TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  insurer_profile_id  UUID REFERENCES insurer_profiles(id) ON DELETE RESTRICT,
  consent_version     TEXT NOT NULL,
  scope               JSONB NOT NULL DEFAULT '{"fields":[]}'::jsonb,  -- fields the owner authorises to share
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insurance_consents_vin ON insurance_consents(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_consents_user ON insurance_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_insurance_consents_insurer ON insurance_consents(insurer_profile_id);
CREATE INDEX IF NOT EXISTS idx_insurance_consents_active ON insurance_consents(vin, insurer_profile_id) WHERE revoked_at IS NULL;

-- -------------------------------------------------------------------------------------
-- 3) insurance_provider_decisions — append-only insurer outcome ledger.
--    Extends the eligibility decision surface for the insurer capability. Stores ONLY the
--    outcome + provider reference + owner-facing conditions + validity. No underwriting data.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insurance_provider_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable link to the shared eligibility request; ON DELETE RESTRICT preserves the ledger.
  eligibility_request_id UUID REFERENCES eligibility_requests(id) ON DELETE RESTRICT,
  insurer_provider_id   UUID NOT NULL REFERENCES insurer_profiles(id) ON DELETE RESTRICT,
  vin                   TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  outcome               TEXT NOT NULL
                          CHECK (outcome IN ('eligible','conditional','manual_review','declined','unavailable','expired','failed')),
  -- Honesty label: which activation mode produced this outcome (sandbox/pilot_live/live/...).
  mode                  TEXT NOT NULL DEFAULT 'sandbox',
  provider_reference    TEXT,
  conditions            JSONB NOT NULL DEFAULT '[]'::jsonb,
  validity_until        TIMESTAMPTZ,
  correlation_id        TEXT,
  source                TEXT NOT NULL DEFAULT 'sync' CHECK (source IN ('sync','webhook','manual')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ins_decisions_request ON insurance_provider_decisions(eligibility_request_id);
CREATE INDEX IF NOT EXISTS idx_ins_decisions_insurer ON insurance_provider_decisions(insurer_provider_id);
CREATE INDEX IF NOT EXISTS idx_ins_decisions_vin ON insurance_provider_decisions(vin, created_at DESC);

-- -------------------------------------------------------------------------------------
-- 4) Append-only enforcement.
-- -------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS insurance_consent_guard_upd ON insurance_consents;
CREATE TRIGGER insurance_consent_guard_upd BEFORE UPDATE ON insurance_consents
  FOR EACH ROW EXECUTE FUNCTION insurance_consent_guard();
DROP TRIGGER IF EXISTS insurance_consent_guard_del ON insurance_consents;
CREATE TRIGGER insurance_consent_guard_del BEFORE DELETE ON insurance_consents
  FOR EACH ROW EXECUTE FUNCTION insurance_consent_guard();

DROP TRIGGER IF EXISTS ins_decisions_no_update ON insurance_provider_decisions;
CREATE TRIGGER ins_decisions_no_update BEFORE UPDATE ON insurance_provider_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS ins_decisions_no_delete ON insurance_provider_decisions;
CREATE TRIGGER ins_decisions_no_delete BEFORE DELETE ON insurance_provider_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- -------------------------------------------------------------------------------------
-- 5) RLS. service_role full; admin/government read all; the vehicle OWNER (and the
--    consenting user) may read their own consents + decision outcomes. NO anon. No
--    applicant/underwriting data is exposed publicly (there is none stored here).
-- -------------------------------------------------------------------------------------
ALTER TABLE insurer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_provider_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE insurer_profiles, insurance_consents, insurance_provider_decisions FROM anon;
GRANT ALL ON TABLE insurer_profiles, insurance_consents, insurance_provider_decisions TO service_role;
GRANT SELECT ON TABLE insurer_profiles, insurance_consents, insurance_provider_decisions TO authenticated;

-- insurer_profiles: control-plane — admin/government only.
DROP POLICY IF EXISTS "insurer_profiles admin read" ON insurer_profiles;
CREATE POLICY "insurer_profiles admin read" ON insurer_profiles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));

-- insurance_consents: admin/government read all; consenting user + vehicle owner read own.
DROP POLICY IF EXISTS "insurance_consents privileged read" ON insurance_consents;
CREATE POLICY "insurance_consents privileged read" ON insurance_consents FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));
DROP POLICY IF EXISTS "insurance_consents owner read" ON insurance_consents;
CREATE POLICY "insurance_consents owner read" ON insurance_consents FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (
    user_id = auth.uid()::text OR
    EXISTS (SELECT 1 FROM vehicles v WHERE v.vin = insurance_consents.vin AND v.owner_id = auth.uid()::text)));

-- insurance_provider_decisions: admin/government read all; vehicle owner reads own outcomes.
DROP POLICY IF EXISTS "insurance_decisions privileged read" ON insurance_provider_decisions;
CREATE POLICY "insurance_decisions privileged read" ON insurance_provider_decisions FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid()::text AND u.role IN ('admin','government')));
DROP POLICY IF EXISTS "insurance_decisions owner read" ON insurance_provider_decisions;
CREATE POLICY "insurance_decisions owner read" ON insurance_provider_decisions FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM vehicles v WHERE v.vin = insurance_provider_decisions.vin AND v.owner_id = auth.uid()::text));

-- +migrate Down
DROP TRIGGER IF EXISTS ins_decisions_no_update ON insurance_provider_decisions;
DROP TRIGGER IF EXISTS ins_decisions_no_delete ON insurance_provider_decisions;
DROP TRIGGER IF EXISTS insurance_consent_guard_upd ON insurance_consents;
DROP TRIGGER IF EXISTS insurance_consent_guard_del ON insurance_consents;
DROP TABLE IF EXISTS insurance_provider_decisions;
DROP TABLE IF EXISTS insurance_consents;
DROP TABLE IF EXISTS insurer_profiles;
DROP FUNCTION IF EXISTS insurance_consent_guard();
