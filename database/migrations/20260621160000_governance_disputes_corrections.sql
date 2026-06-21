-- +migrate Up
-- =====================================================================================
-- Milestone 5 — Governance, Review, Disputes & Corrections (master plan §11)
--
-- The human-accountability spine for the trust system:
--   * review_tasks       — the single review queue across evidence/identity/AI/disclosure
--   * review_decisions   — append-only record of every reviewer decision (who/what/why)
--   * disputes           — seller/owner dispute lifecycle with a response deadline
--   * dispute_events     — append-only dispute timeline
--   * trust_change_log   — the ONLY governed path that records a trust change
--
-- Invariants (master plan §11.2, §2.2):
--   * AI raw confidence NEVER becomes a trust value directly — only a governed decision,
--     captured in trust_change_log, may change trust.
--   * review_decisions / dispute_events are immutable (append-only) — UPDATE/DELETE blocked.
--   * Nothing here is exposed to anon; authenticated gets SELECT under RLS.
--
-- Does NOT recreate trust_audit_events or trust_fact_requests (owned by prior migrations).
-- Additive + reversible.
-- =====================================================================================

-- NOTE: gen_random_uuid() is in core Postgres (pgcrypto NOT required) — consistent with the
-- other five program migrations. (Removed an unnecessary CREATE EXTENSION pgcrypto that broke
-- portability to non-Supabase Postgres; harmless on Supabase but unneeded.)

-- -------------------------------------------------------------------------------------
-- 0) Immutability trigger function (append-only tables block UPDATE/DELETE)
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION governance_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Append-only table %: % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$;

-- -------------------------------------------------------------------------------------
-- 1) review_tasks — unified review queue
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type     TEXT NOT NULL CHECK (task_type IN (
                  'evidence_verification','vehicle_identity','ai_low_confidence',
                  'temporal_finding','disclosure_conflict','source_disagreement',
                  'seller_dispute','correction_request','privacy_removal')),
  target_type   TEXT,
  target_id     TEXT,
  vin           TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                  'open','in_review','resolved','escalated')),
  assigned_to   TEXT,
  priority      TEXT,
  due_at        TIMESTAMPTZ,
  decision_id   UUID,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_tasks_status ON review_tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_tasks_type ON review_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_review_tasks_vin ON review_tasks(vin);
CREATE INDEX IF NOT EXISTS idx_review_tasks_target ON review_tasks(target_type, target_id);

-- -------------------------------------------------------------------------------------
-- 2) review_decisions — append-only reviewer accountability
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_decisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_task_id      UUID,
  target_type         TEXT,
  target_id           TEXT,
  vin                 TEXT,
  reviewer_id         TEXT,
  reviewer_role       TEXT,
  decision            TEXT NOT NULL CHECK (decision IN (
                        'confirm','reject','amend','request_more','inconclusive',
                        'publish','unpublish','supersede','escalate')),
  notes               TEXT,
  policy_version      TEXT,
  before_state        JSONB,
  after_state         JSONB,
  correlation_id      TEXT,
  conflict_of_interest BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_decisions_task ON review_decisions(review_task_id);
CREATE INDEX IF NOT EXISTS idx_review_decisions_target ON review_decisions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_review_decisions_vin ON review_decisions(vin);
CREATE INDEX IF NOT EXISTS idx_review_decisions_reviewer ON review_decisions(reviewer_id);

DROP TRIGGER IF EXISTS review_decisions_no_update ON review_decisions;
CREATE TRIGGER review_decisions_no_update
  BEFORE UPDATE ON review_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS review_decisions_no_delete ON review_decisions;
CREATE TRIGGER review_decisions_no_delete
  BEFORE DELETE ON review_decisions
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- -------------------------------------------------------------------------------------
-- 3) disputes — seller/owner dispute lifecycle
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disputes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin               TEXT,
  subject_type      TEXT,
  subject_id        TEXT,
  raised_by         TEXT,
  raised_by_role    TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                      'open','responded','independent_review','resolved','appealed')),
  response_deadline TIMESTAMPTZ,
  assigned_reviewer TEXT,
  resolution        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disputes_vin ON disputes(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_subject ON disputes(subject_type, subject_id);

-- -------------------------------------------------------------------------------------
-- 4) dispute_events — append-only dispute timeline
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispute_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  UUID,
  event_type  TEXT,
  actor_id    TEXT,
  actor_role  TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dispute_events_dispute ON dispute_events(dispute_id, created_at);

DROP TRIGGER IF EXISTS dispute_events_no_update ON dispute_events;
CREATE TRIGGER dispute_events_no_update
  BEFORE UPDATE ON dispute_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
DROP TRIGGER IF EXISTS dispute_events_no_delete ON dispute_events;
CREATE TRIGGER dispute_events_no_delete
  BEFORE DELETE ON dispute_events
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- -------------------------------------------------------------------------------------
-- 5) trust_change_log — the ONLY governed path that records a trust change
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trust_change_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                TEXT,
  rule               TEXT,
  evidence_ids       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  previous_value     JSONB,
  new_value          JSONB,
  approved_by        TEXT,
  approved_by_role   TEXT,
  review_decision_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trust_change_log_vin ON trust_change_log(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_change_log_decision ON trust_change_log(review_decision_id);

-- -------------------------------------------------------------------------------------
-- 6) RLS + grants — never anon; authenticated read under RLS; writes via service_role.
-- -------------------------------------------------------------------------------------
ALTER TABLE IF EXISTS review_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dispute_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS trust_change_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE review_tasks FROM anon;
REVOKE ALL ON TABLE review_decisions FROM anon;
REVOKE ALL ON TABLE disputes FROM anon;
REVOKE ALL ON TABLE dispute_events FROM anon;
REVOKE ALL ON TABLE trust_change_log FROM anon;

GRANT SELECT ON TABLE review_tasks TO authenticated;
GRANT SELECT ON TABLE review_decisions TO authenticated;
GRANT SELECT ON TABLE disputes TO authenticated;
GRANT SELECT ON TABLE dispute_events TO authenticated;
GRANT SELECT ON TABLE trust_change_log TO authenticated;

DROP POLICY IF EXISTS "review tasks authenticated read" ON review_tasks;
CREATE POLICY "review tasks authenticated read" ON review_tasks FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "review decisions authenticated read" ON review_decisions;
CREATE POLICY "review decisions authenticated read" ON review_decisions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "disputes authenticated read" ON disputes;
CREATE POLICY "disputes authenticated read" ON disputes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "dispute events authenticated read" ON dispute_events;
CREATE POLICY "dispute events authenticated read" ON dispute_events FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "trust change log authenticated read" ON trust_change_log;
CREATE POLICY "trust change log authenticated read" ON trust_change_log FOR SELECT TO authenticated USING (true);

-- +migrate Down
DROP TRIGGER IF EXISTS dispute_events_no_delete ON dispute_events;
DROP TRIGGER IF EXISTS dispute_events_no_update ON dispute_events;
DROP TRIGGER IF EXISTS review_decisions_no_delete ON review_decisions;
DROP TRIGGER IF EXISTS review_decisions_no_update ON review_decisions;
DROP TABLE IF EXISTS trust_change_log;
DROP TABLE IF EXISTS dispute_events;
DROP TABLE IF EXISTS disputes;
DROP TABLE IF EXISTS review_decisions;
DROP TABLE IF EXISTS review_tasks;
DROP FUNCTION IF EXISTS governance_block_mutation();
