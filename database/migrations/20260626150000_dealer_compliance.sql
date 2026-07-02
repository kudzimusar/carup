-- +migrate Up
-- =====================================================================================
-- Workstream B — Dealer Compliance & Trust
--
-- Persists a dealer's identity, business evidence, and a structured compliance review
-- so that buyers can trust who they are dealing with, and so the platform can restrict,
-- suspend, or reinstate a dealer with a full, immutable audit trail.
--
-- Honesty rules enforced structurally:
--   * A dealer carries EIGHT independent lifecycle statuses that are NEVER collapsed into
--     a single "approved" flag: identity_status, business_evidence_status,
--     compliance_review_state, active_state, restriction_state, suspension_state,
--     investigation_state and (separately) an expiry_date. A passed compliance review does
--     not by itself make a suspended dealer publishable.
--   * Every governance decision (approve/reject requirement, request more info, restrict,
--     suspend, reinstate, set expiry) is written to an APPEND-ONLY decision ledger
--     (governance_block_mutation) — a decision cannot be edited or deleted after the fact;
--     a reversal is a NEW decision row.
--   * Compliance documents are ON DELETE RESTRICT — evidence backing a decision cannot be
--     silently removed.
--   * Buyers never read this privileged surface directly; the service exposes only a
--     narrow buyer-safe summary (status + completeness band), never private documents,
--     contacts, or internal notes.
--
-- Depends on: governance_block_mutation() from 20260621160000_governance_disputes_corrections.sql
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) dealer_profiles — one row per dealer (a verified business identity)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id                TEXT,
  legal_name               TEXT,
  trading_name             TEXT,
  registration_number      TEXT,
  tax_id                   TEXT,
  physical_address         TEXT,
  responsible_person       TEXT,
  operating_country        TEXT,
  -- EIGHT independent lifecycle statuses. These MUST NOT be collapsed into one flag.
  identity_status          TEXT NOT NULL DEFAULT 'unverified'
                             CHECK (identity_status IN ('unverified', 'pending', 'verified', 'rejected')),
  business_evidence_status TEXT NOT NULL DEFAULT 'incomplete'
                             CHECK (business_evidence_status IN ('incomplete', 'complete')),
  compliance_review_state  TEXT NOT NULL DEFAULT 'not_started'
                             CHECK (compliance_review_state IN ('not_started', 'in_review', 'passed', 'failed')),
  active_state             TEXT NOT NULL DEFAULT 'inactive'
                             CHECK (active_state IN ('active', 'inactive')),
  restriction_state        TEXT NOT NULL DEFAULT 'none'
                             CHECK (restriction_state IN ('none', 'restricted')),
  suspension_state         TEXT NOT NULL DEFAULT 'none'
                             CHECK (suspension_state IN ('none', 'suspended')),
  investigation_state      TEXT NOT NULL DEFAULT 'none'
                             CHECK (investigation_state IN ('none', 'under_investigation')),
  listing_limit            INT NOT NULL DEFAULT 0,
  expiry_date              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dealer_profiles IS
  'Dealer business identity + eight independent compliance lifecycle statuses (never collapsed). Privileged surface; buyers read only the narrow safe summary.';

CREATE INDEX IF NOT EXISTS idx_dealer_profiles_user ON dealer_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_dealer_profiles_tenant ON dealer_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_profiles_review_state ON dealer_profiles(compliance_review_state);

-- -------------------------------------------------------------------------------------
-- 2) dealer_branches — physical branches of a dealer
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer_branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id   UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE CASCADE,
  name        TEXT,
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dealer_branches IS 'Physical branches of a dealer. Cascade-deleted with the dealer profile.';

CREATE INDEX IF NOT EXISTS idx_dealer_branches_dealer ON dealer_branches(dealer_id);

-- -------------------------------------------------------------------------------------
-- 3) dealer_compliance_documents — uploaded evidence (metadata only; file_ref points out)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer_compliance_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: evidence backing a compliance decision must not be silently removed.
  dealer_id   UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
  doc_type    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('present', 'pending', 'verified', 'rejected', 'expired', 'missing')),
  file_ref    TEXT,
  expiry_date TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dealer_compliance_documents IS
  'Compliance evidence metadata (file stored elsewhere via file_ref). ON DELETE RESTRICT so evidence cannot be silently removed.';

CREATE INDEX IF NOT EXISTS idx_dealer_documents_dealer ON dealer_compliance_documents(dealer_id);

-- -------------------------------------------------------------------------------------
-- 4) dealer_compliance_requirements — the checklist the dealer must satisfy
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer_compliance_requirements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id       UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'required'
                    CHECK (status IN ('required', 'present', 'pending', 'verified', 'rejected', 'expired', 'missing', 'not_applicable')),
  is_blocking     BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dealer_compliance_requirements IS
  'Per-dealer compliance checklist. A blocking requirement that is not verified prevents publication.';

CREATE INDEX IF NOT EXISTS idx_dealer_requirements_dealer ON dealer_compliance_requirements(dealer_id);

-- -------------------------------------------------------------------------------------
-- 5) dealer_compliance_decisions — APPEND-ONLY governance ledger
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer_compliance_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: a dealer with a decision history cannot be hard-deleted out from under it.
  dealer_id       UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
  decision        TEXT NOT NULL
                    CHECK (decision IN ('approve_requirement', 'reject_requirement', 'request_more_info',
                                        'restrict', 'suspend', 'reinstate', 'set_expiry')),
  requirement_key TEXT,
  actor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role      TEXT,
  reason          TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dealer_compliance_decisions IS
  'Append-only ledger of every dealer governance decision. Immutable (governance_block_mutation); a reversal is a NEW row.';

CREATE INDEX IF NOT EXISTS idx_dealer_decisions_dealer ON dealer_compliance_decisions(dealer_id, created_at DESC);

-- Append-only: a governance decision is a historical fact. No UPDATE, no DELETE.
DROP TRIGGER IF EXISTS dealer_decisions_no_update ON dealer_compliance_decisions;
CREATE TRIGGER dealer_decisions_no_update
  BEFORE UPDATE ON dealer_compliance_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS dealer_decisions_no_delete ON dealer_compliance_decisions;
CREATE TRIGGER dealer_decisions_no_delete
  BEFORE DELETE ON dealer_compliance_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- =====================================================================================
-- Row Level Security
--   * service_role: full access (the API gateway runs as service_role).
--   * a dealer reads/updates only their OWN profile + child rows (user_id = auth.uid()).
--   * admin/government/reviewer read all (oversight).
--   * buyers/anon get NOTHING here — they read only the buyer-safe summary the service builds.
-- =====================================================================================

-- dealer_profiles -----------------------------------------------------------------
ALTER TABLE dealer_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dealer_profiles FROM anon;
GRANT ALL ON TABLE dealer_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE dealer_profiles TO authenticated;

DROP POLICY IF EXISTS "dealer_profiles owner read" ON dealer_profiles;
CREATE POLICY "dealer_profiles owner read"
  ON dealer_profiles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid()::text);

DROP POLICY IF EXISTS "dealer_profiles owner update" ON dealer_profiles;
CREATE POLICY "dealer_profiles owner update"
  ON dealer_profiles FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "dealer_profiles owner insert" ON dealer_profiles;
CREATE POLICY "dealer_profiles owner insert"
  ON dealer_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid()::text);

DROP POLICY IF EXISTS "dealer_profiles oversight read" ON dealer_profiles;
CREATE POLICY "dealer_profiles oversight read"
  ON dealer_profiles FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
        AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

-- dealer_branches -----------------------------------------------------------------
ALTER TABLE dealer_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dealer_branches FROM anon;
GRANT ALL ON TABLE dealer_branches TO service_role;
GRANT SELECT, INSERT ON TABLE dealer_branches TO authenticated;

DROP POLICY IF EXISTS "dealer_branches owner read" ON dealer_branches;
CREATE POLICY "dealer_branches owner read"
  ON dealer_branches FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM dealer_profiles d
      WHERE d.id = dealer_branches.dealer_id AND d.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "dealer_branches oversight read" ON dealer_branches;
CREATE POLICY "dealer_branches oversight read"
  ON dealer_branches FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

-- dealer_compliance_documents -----------------------------------------------------
ALTER TABLE dealer_compliance_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dealer_compliance_documents FROM anon;
GRANT ALL ON TABLE dealer_compliance_documents TO service_role;
GRANT SELECT, INSERT ON TABLE dealer_compliance_documents TO authenticated;

DROP POLICY IF EXISTS "dealer_documents owner read" ON dealer_compliance_documents;
CREATE POLICY "dealer_documents owner read"
  ON dealer_compliance_documents FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM dealer_profiles d
      WHERE d.id = dealer_compliance_documents.dealer_id AND d.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "dealer_documents oversight read" ON dealer_compliance_documents;
CREATE POLICY "dealer_documents oversight read"
  ON dealer_compliance_documents FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

-- dealer_compliance_requirements --------------------------------------------------
ALTER TABLE dealer_compliance_requirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dealer_compliance_requirements FROM anon;
GRANT ALL ON TABLE dealer_compliance_requirements TO service_role;
GRANT SELECT ON TABLE dealer_compliance_requirements TO authenticated;

DROP POLICY IF EXISTS "dealer_requirements owner read" ON dealer_compliance_requirements;
CREATE POLICY "dealer_requirements owner read"
  ON dealer_compliance_requirements FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM dealer_profiles d
      WHERE d.id = dealer_compliance_requirements.dealer_id AND d.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "dealer_requirements oversight read" ON dealer_compliance_requirements;
CREATE POLICY "dealer_requirements oversight read"
  ON dealer_compliance_requirements FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

-- dealer_compliance_decisions -----------------------------------------------------
ALTER TABLE dealer_compliance_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dealer_compliance_decisions FROM anon;
GRANT ALL ON TABLE dealer_compliance_decisions TO service_role;
GRANT SELECT ON TABLE dealer_compliance_decisions TO authenticated;

DROP POLICY IF EXISTS "dealer_decisions owner read" ON dealer_compliance_decisions;
CREATE POLICY "dealer_decisions owner read"
  ON dealer_compliance_decisions FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM dealer_profiles d
      WHERE d.id = dealer_compliance_decisions.dealer_id AND d.user_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "dealer_decisions oversight read" ON dealer_compliance_decisions;
CREATE POLICY "dealer_decisions oversight read"
  ON dealer_compliance_decisions FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

-- +migrate Down
DROP TRIGGER IF EXISTS dealer_decisions_no_update ON dealer_compliance_decisions;
DROP TRIGGER IF EXISTS dealer_decisions_no_delete ON dealer_compliance_decisions;
DROP TABLE IF EXISTS dealer_compliance_decisions;
DROP TABLE IF EXISTS dealer_compliance_requirements;
DROP TABLE IF EXISTS dealer_compliance_documents;
DROP TABLE IF EXISTS dealer_branches;
DROP TABLE IF EXISTS dealer_profiles;
