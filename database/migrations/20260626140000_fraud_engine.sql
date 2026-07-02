-- +migrate Up
-- =====================================================================================
-- Workstream A — Advanced Duplicate + Fraud Detection Engine
--
-- Persists, as governance-grade evidence, every fraud/duplicate signal the engine raises
-- for a vehicle, the open investigation case those signals roll up into, and the
-- append-only history of everything that ever happened to that case (evaluations,
-- reviewer actions, resolutions).
--
-- Honesty / governance rules enforced structurally:
--   * fraud_signals is APPEND-ONLY (governance_block_mutation): a signal is a historical
--     statement of what the engine observed at a point in time. A re-evaluation inserts
--     NEW rows; it never edits or deletes the prior assessment.
--   * fraud_case_events and fraud_case_resolutions are APPEND-ONLY: the investigation
--     trail (who did what, when, and WHY) can never be rewritten after the fact.
--   * fraud_cases is the ONE mutable surface — only its status / counters / block flag
--     move as an investigation progresses; every transition is mirrored by an append-only
--     fraud_case_events row.
--   * An 'identity_merge_approved' resolution records INTENT only. Passports are never
--     auto-merged here; the merge itself is a separate explicitly-governed action.
--   * raw signal evidence (reason_codes / evidence_refs / related_identities) lives in
--     these privileged tables only (RLS service-role write; admin/government/reviewer
--     read). Buyers never read fraud internals directly.
--
-- Depends on: governance_block_mutation() from 20260621160000_governance_disputes_corrections.sql
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1) fraud_signals — append-only ledger of every signal the engine raises
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_signals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                 TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  tenant_id           TEXT,
  -- The detector that fired. Constrained to the 18 sanctioned codes; an unknown code is
  -- never silently stored.
  signal_code         TEXT NOT NULL CHECK (signal_code IN (
                        'duplicate_vin',
                        'duplicate_chassis',
                        'near_match_vin',
                        'duplicate_engine',
                        'duplicate_registration',
                        'temp_plate_reuse',
                        'evidence_checksum_reuse',
                        'perceptual_hash_reuse',
                        'conflicting_make_model_year',
                        'source_identity_conflict',
                        'odometer_reversal',
                        'impossible_mileage',
                        'rapid_relisting_churn',
                        'cross_seller_same_vehicle',
                        'seller_identity_mismatch',
                        'repeated_rejected_evidence',
                        'cid_high_risk',
                        'import_registration_conflict')),
  severity            TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  confidence          NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- Machine-readable reasons backing the signal (e.g. ['vin_exact_match','other_vin:XXX']).
  reason_codes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Pointers to the evidence the signal was derived from (vins, evidence ids, checksums).
  evidence_refs       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Identities (sellers/owners/sources) implicated — used by case triage, never auto-merged.
  related_identities  JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_action  TEXT,
  -- Whether this signal, on its own, should block listing publication.
  blocks_publication  BOOLEAN NOT NULL DEFAULT false,
  -- Whether this signal demands human review before any automated decision.
  requires_review     BOOLEAN NOT NULL DEFAULT false,
  -- Rule pack version that produced the signal (audit / reproducibility).
  rule_version        TEXT NOT NULL DEFAULT 'fraud-rules-1.0.0',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE fraud_signals IS 'Append-only ledger of duplicate/fraud signals raised by the fraud engine. Re-evaluation inserts new rows; rows are never edited or deleted.';
COMMENT ON COLUMN fraud_signals.signal_code IS 'Sanctioned detector code (one of 18). CHECK-constrained so an unknown code is never stored.';
COMMENT ON COLUMN fraud_signals.blocks_publication IS 'TRUE if this signal alone justifies blocking listing publication.';
COMMENT ON COLUMN fraud_signals.related_identities IS 'Implicated seller/owner/source identities. Informs triage only — never triggers an automatic passport merge.';

CREATE INDEX IF NOT EXISTS idx_fraud_signals_vin ON fraud_signals(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_code ON fraud_signals(signal_code);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_tenant ON fraud_signals(tenant_id);

-- Append-only: a raised signal is a historical fact. No UPDATE, no DELETE.
DROP TRIGGER IF EXISTS fraud_signals_no_update ON fraud_signals;
CREATE TRIGGER fraud_signals_no_update
  BEFORE UPDATE ON fraud_signals
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS fraud_signals_no_delete ON fraud_signals;
CREATE TRIGGER fraud_signals_no_delete
  BEFORE DELETE ON fraud_signals
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- -------------------------------------------------------------------------------------
-- 2) fraud_cases — one open investigation per vehicle (the ONE mutable surface)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_cases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                 TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  tenant_id           TEXT,
  highest_severity    TEXT CHECK (highest_severity IS NULL OR highest_severity IN ('low', 'medium', 'high', 'critical')),
  open_signal_count   INT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  blocks_publication  BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE fraud_cases IS 'Investigation case rolling up fraud_signals for a vehicle. Mutable for status/counters/block flag only; every transition is mirrored in fraud_case_events.';
COMMENT ON COLUMN fraud_cases.blocks_publication IS 'TRUE while any open signal blocks publication; gates the listing publication lifecycle.';

CREATE INDEX IF NOT EXISTS idx_fraud_cases_vin ON fraud_cases(vin);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_tenant ON fraud_cases(tenant_id);
-- Partial index for the active investigation queue (the hot path for reviewers).
CREATE INDEX IF NOT EXISTS idx_fraud_cases_open ON fraud_cases(status)
  WHERE status IN ('open', 'investigating');

-- updated_at maintenance (UPDATE is permitted here — this is the mutable surface).
CREATE OR REPLACE FUNCTION fraud_cases_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS fraud_cases_set_updated_at ON fraud_cases;
CREATE TRIGGER fraud_cases_set_updated_at
  BEFORE UPDATE ON fraud_cases
  FOR EACH ROW EXECUTE FUNCTION fraud_cases_touch_updated_at();

-- -------------------------------------------------------------------------------------
-- 3) fraud_case_events — append-only investigation trail
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_case_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES fraud_cases(id) ON DELETE RESTRICT,
  tenant_id           TEXT,
  event_type          TEXT NOT NULL,
  -- Actor preserved for audit even if the user is later removed (SET NULL, not RESTRICT).
  actor_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role          TEXT,
  reason              TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE fraud_case_events IS 'Append-only trail of everything that happened to a fraud case (evaluations, status changes, reviewer actions). Carries actor + reason for governance.';

CREATE INDEX IF NOT EXISTS idx_fraud_case_events_case ON fraud_case_events(case_id, created_at DESC);

DROP TRIGGER IF EXISTS fraud_case_events_no_update ON fraud_case_events;
CREATE TRIGGER fraud_case_events_no_update
  BEFORE UPDATE ON fraud_case_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS fraud_case_events_no_delete ON fraud_case_events;
CREATE TRIGGER fraud_case_events_no_delete
  BEFORE DELETE ON fraud_case_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- -------------------------------------------------------------------------------------
-- 4) fraud_case_resolutions — append-only record of how a case was closed
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_case_resolutions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES fraud_cases(id) ON DELETE RESTRICT,
  tenant_id           TEXT,
  resolution          TEXT NOT NULL CHECK (resolution IN (
                        'false_positive',
                        'confirmed_duplicate',
                        'blocked',
                        'released',
                        'identity_merge_approved')),
  actor_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role          TEXT,
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE fraud_case_resolutions IS 'Append-only resolutions for a fraud case. identity_merge_approved records intent ONLY; the passport merge is a separate governed action.';

CREATE INDEX IF NOT EXISTS idx_fraud_case_resolutions_case ON fraud_case_resolutions(case_id, created_at DESC);

DROP TRIGGER IF EXISTS fraud_case_resolutions_no_update ON fraud_case_resolutions;
CREATE TRIGGER fraud_case_resolutions_no_update
  BEFORE UPDATE ON fraud_case_resolutions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS fraud_case_resolutions_no_delete ON fraud_case_resolutions;
CREATE TRIGGER fraud_case_resolutions_no_delete
  BEFORE DELETE ON fraud_case_resolutions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- -------------------------------------------------------------------------------------
-- 5) RLS — service-role writes; admin/government/reviewer read. Buyers get NOTHING here.
-- -------------------------------------------------------------------------------------
ALTER TABLE fraud_signals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_cases            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_case_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_case_resolutions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE fraud_signals          FROM anon;
REVOKE ALL ON TABLE fraud_cases            FROM anon;
REVOKE ALL ON TABLE fraud_case_events      FROM anon;
REVOKE ALL ON TABLE fraud_case_resolutions FROM anon;

GRANT ALL ON TABLE fraud_signals          TO service_role;
GRANT ALL ON TABLE fraud_cases            TO service_role;
GRANT ALL ON TABLE fraud_case_events      TO service_role;
GRANT ALL ON TABLE fraud_case_resolutions TO service_role;

GRANT SELECT ON TABLE fraud_signals          TO authenticated;
GRANT SELECT ON TABLE fraud_cases            TO authenticated;
GRANT SELECT ON TABLE fraud_case_events      TO authenticated;
GRANT SELECT ON TABLE fraud_case_resolutions TO authenticated;

DROP POLICY IF EXISTS "fraud_signals privileged read" ON fraud_signals;
CREATE POLICY "fraud_signals privileged read"
  ON fraud_signals FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
        AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

DROP POLICY IF EXISTS "fraud_cases privileged read" ON fraud_cases;
CREATE POLICY "fraud_cases privileged read"
  ON fraud_cases FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
        AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

DROP POLICY IF EXISTS "fraud_case_events privileged read" ON fraud_case_events;
CREATE POLICY "fraud_case_events privileged read"
  ON fraud_case_events FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
        AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

DROP POLICY IF EXISTS "fraud_case_resolutions privileged read" ON fraud_case_resolutions;
CREATE POLICY "fraud_case_resolutions privileged read"
  ON fraud_case_resolutions FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
        AND u.role IN ('admin', 'government', 'reviewer')
    )
  );

-- +migrate Down
DROP TRIGGER IF EXISTS fraud_case_resolutions_no_update ON fraud_case_resolutions;
DROP TRIGGER IF EXISTS fraud_case_resolutions_no_delete ON fraud_case_resolutions;
DROP TABLE IF EXISTS fraud_case_resolutions;
DROP TRIGGER IF EXISTS fraud_case_events_no_update ON fraud_case_events;
DROP TRIGGER IF EXISTS fraud_case_events_no_delete ON fraud_case_events;
DROP TABLE IF EXISTS fraud_case_events;
DROP TRIGGER IF EXISTS fraud_cases_set_updated_at ON fraud_cases;
DROP TABLE IF EXISTS fraud_cases;
DROP FUNCTION IF EXISTS fraud_cases_touch_updated_at();
DROP TRIGGER IF EXISTS fraud_signals_no_update ON fraud_signals;
DROP TRIGGER IF EXISTS fraud_signals_no_delete ON fraud_signals;
DROP TABLE IF EXISTS fraud_signals;
