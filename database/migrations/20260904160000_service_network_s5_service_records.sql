-- =============================================================
-- SERVICE NETWORK FOUNDATION 1.0 — S5: Service records, mileage
-- observations, PartSentry and Evidence binding
-- (docs/service-network-foundation; plan §7.5, §12, §13, §13.1)
-- =============================================================
-- A service record is what a garage actually DID on a work order. It is a
-- source record; it is not a Passport projection and it is not Trust.
--
-- MILEAGE AUTHORITY (plan §13.1, S0 adjudication). The canonical odometer
-- column vehicles.mileage has exactly ONE application writer today —
-- partsentryService.addRepairLog, which applies a monotonic guard and then
-- overwrites. That behaviour is pinned by existing tests and by the golden
-- vehicle specs. Service Network therefore adds NO second canonical-mileage
-- writer. A mileage reading taken during service is recorded HERE as an
-- OBSERVATION, with its own provenance, and never mutates vehicles.mileage.
-- Foundation 1.0 deliberately leaves canonical odometer resolution where it is.
--
-- PARTS AND EVIDENCE stay with their authorities: parts are PartSentry rows
-- (partsentry_logs, written by partsentryService) and evidence rows are the
-- Evidence authority's. This migration only records governed REFERENCES to
-- them, so nothing is duplicated and nothing is re-implemented.

-- +migrate Up

CREATE TABLE IF NOT EXISTS service_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL,
  service_case_id UUID REFERENCES service_cases(id) ON DELETE SET NULL,
  -- RESTRICT: what a garage did to a vehicle is history. Deleting the tenant or the
  -- vehicle must be an explicit, blocked-until-decided act, never a silent erasure.
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  -- What was done. Private free text: never projected into a public surface.
  work_performed TEXT,
  service_category TEXT,
  -- Provenance strength (plan §6.6). A superset of the Passport SERVICE_AUTHORITIES
  -- vocabulary — extended, never forked. 'unknown' is honest, not a placeholder.
  service_authority TEXT NOT NULL DEFAULT 'unknown'
    CHECK (service_authority IN (
      'owner_declared','garage_stated','mechanic_attributed',
      'professional_governed','evidence_backed','partner_record','unknown'
    )),
  -- Money: explicit currency, and absent cost stays absent (never zero).
  total_cost NUMERIC,
  currency TEXT,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
  performed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_records_cost_needs_currency
    CHECK (total_cost IS NULL OR currency IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_service_records_work_order ON service_records(work_order_id);
CREATE INDEX IF NOT EXISTS idx_service_records_vin ON service_records(vin);
CREATE INDEX IF NOT EXISTS idx_service_records_tenant ON service_records(tenant_id);

-- ── mileage OBSERVATIONS (never a canonical odometer write) ──
CREATE TABLE IF NOT EXISTS service_mileage_observations (
  id BIGSERIAL PRIMARY KEY,
  service_record_id UUID NOT NULL REFERENCES service_records(id) ON DELETE RESTRICT,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  observed_mileage INTEGER NOT NULL CHECK (observed_mileage >= 0),
  observation_source TEXT NOT NULL DEFAULT 'garage_stated'
    CHECK (observation_source IN ('garage_stated','mechanic_attributed','evidence_backed','owner_declared')),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  observed_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_mileage_observations_vin
  ON service_mileage_observations(vin, observed_at DESC);

-- ── governed REFERENCES to the parts and evidence authorities ──
CREATE TABLE IF NOT EXISTS service_record_parts (
  id BIGSERIAL PRIMARY KEY,
  service_record_id UUID NOT NULL REFERENCES service_records(id) ON DELETE RESTRICT,
  -- PartSentry owns the part record itself; this is only the link.
  partsentry_log_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_record_id, partsentry_log_id)
);

CREATE TABLE IF NOT EXISTS service_record_evidence (
  id BIGSERIAL PRIMARY KEY,
  service_record_id UUID NOT NULL REFERENCES service_records(id) ON DELETE RESTRICT,
  -- Evidence authority owns the evidence row; this is only the link.
  evidence_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_record_id, evidence_id)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_records','service_mileage_observations','service_record_parts','service_record_evidence']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC, anon, authenticated', t);
    -- No DELETE anywhere in this set: a service record is corrected or superseded
    -- (plan §26), never destroyed.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO service_role', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE service_mileage_observations_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE service_record_parts_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE service_record_evidence_id_seq TO service_role;
REVOKE ALL ON SEQUENCE service_mileage_observations_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE service_record_parts_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE service_record_evidence_id_seq FROM PUBLIC, anon, authenticated;

-- +migrate Down
DROP TABLE IF EXISTS service_record_evidence;
DROP TABLE IF EXISTS service_record_parts;
DROP TABLE IF EXISTS service_mileage_observations;
DROP TABLE IF EXISTS service_records;
