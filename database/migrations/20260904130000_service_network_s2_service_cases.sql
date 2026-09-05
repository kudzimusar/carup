-- =============================================================
-- SERVICE NETWORK FOUNDATION 1.0 — S2: Canonical Service Case
-- (docs/service-network-foundation, S0 freeze §4.1)
-- =============================================================
-- A Service Case is the durable orchestration record for ONE service
-- engagement. It orchestrates; it does not replace authorities
-- (Invariant 2): the vehicle stays canonical, Communications still owns
-- conversation, work orders still own execution state, Trust is untouched.
--
-- Idempotent bridge (plan §10.3): a marketplace inquiry must not create
-- two cases under retry. `source_inquiry_id` carries a partial UNIQUE
-- index so the DATABASE — not application convention — enforces it.
--
-- Append-only `service_case_events` records every transition, mirroring
-- the vehicle_ownership_transfer_events shape: history is never rewritten
-- (Invariant 12).
--
-- RLS posture (S0 template): service-role-only, FORCE RLS, zero policies.

-- +migrate Up

CREATE TABLE IF NOT EXISTS service_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT throughout: service history is the point of this table. Deleting a
  -- vehicle or a tenant must not silently erase what happened to it (plan §24.3 —
  -- no brittle cross-domain cascade that can delete history).
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE RESTRICT,
  garage_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id UUID,
  requester_user_id TEXT REFERENCES users(id),
  source_inquiry_id TEXT,
  source_channel TEXT NOT NULL DEFAULT 'unknown',
  conversation_thread_id TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','accepted','active','completed','declined','cancelled')),
  service_category TEXT,
  request_summary TEXT,
  decline_reason_code TEXT,
  cancellation_reason_code TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  accepted_by_user_id TEXT REFERENCES users(id),
  created_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Branch integrity as a DATABASE guarantee: a branch may only be attached together
  -- with its owning tenant, so Garage B's branch cannot appear on Garage A's case.
  CONSTRAINT service_cases_branch_within_tenant
    FOREIGN KEY (branch_id, garage_tenant_id)
    REFERENCES garage_branches(id, tenant_id) ON DELETE RESTRICT
);

-- The idempotent marketplace bridge: one case per originating inquiry.
-- Partial so the many cases with no inquiry origin never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_cases_source_inquiry
  ON service_cases(source_inquiry_id)
  WHERE source_inquiry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_cases_garage_tenant
  ON service_cases(garage_tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_service_cases_vin ON service_cases(vin);
CREATE INDEX IF NOT EXISTS idx_service_cases_requester ON service_cases(requester_user_id);

-- Append-only transition history.
CREATE TABLE IF NOT EXISTS service_case_events (
  id BIGSERIAL PRIMARY KEY,
  -- RESTRICT: a case cannot be deleted out from under its own recorded history.
  service_case_id UUID NOT NULL REFERENCES service_cases(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_user_id TEXT REFERENCES users(id),
  actor_tenant_id UUID,
  -- Safe structured metadata only: never private free text, never secrets.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_case_events_case
  ON service_case_events(service_case_id, created_at, id);

-- History is append-only: block UPDATE and DELETE at the database, so a
-- future code path cannot quietly rewrite a case's recorded history.
CREATE OR REPLACE FUNCTION service_case_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'service_case_events is append-only (attempted %)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS trg_service_case_events_append_only ON service_case_events;
CREATE TRIGGER trg_service_case_events_append_only
  BEFORE UPDATE OR DELETE ON service_case_events
  FOR EACH ROW EXECUTE FUNCTION service_case_events_append_only();

ALTER TABLE service_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_cases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE service_cases FROM PUBLIC, anon, authenticated;
-- No DELETE: cancellation is a real state, never a deletion (plan §7.7).
GRANT SELECT, INSERT, UPDATE ON TABLE service_cases TO service_role;

ALTER TABLE service_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_case_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE service_case_events FROM PUBLIC, anon, authenticated;
-- Append-only: no UPDATE and no DELETE, enforced by grant AND by trigger.
GRANT SELECT, INSERT ON TABLE service_case_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE service_case_events_id_seq TO service_role;
REVOKE ALL ON SEQUENCE service_case_events_id_seq FROM PUBLIC, anon, authenticated;

-- +migrate Down
DROP TRIGGER IF EXISTS trg_service_case_events_append_only ON service_case_events;
DROP FUNCTION IF EXISTS service_case_events_append_only();
DROP TABLE IF EXISTS service_case_events;
DROP TABLE IF EXISTS service_cases;
