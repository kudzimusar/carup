-- =============================================================
-- SERVICE NETWORK FOUNDATION 1.0 — S4: Work order convergence
-- and mechanic assignment
-- (docs/service-network-foundation, S0 freeze §4.2; plan §6.3, §6.4)
-- =============================================================
-- The plan is explicit: do NOT create a second work-order table. The existing
-- mechanic_work_orders authority is evolved ADDITIVELY, in the style of
-- 20260808150000_mechanic_work_orders_convergence.sql, so legacy rows from both
-- historical shapes keep working and the three existing consumers
-- (owner service history, mechanic dashboard, trustGraph timeline) are undisturbed.
--
-- Every column added here is nullable. No existing column is renamed, retyped or
-- repurposed, and the status CHECK is deliberately NOT mutated — the Title-Case
-- vocabulary ('In Progress'/'Completed'/'Cancelled') stays exactly as the DB and
-- the web tests already pin it. Terminal-state immutability is enforced in the
-- service layer, not by rewriting a constraint other consumers depend on.
--
-- Mechanic assignment becomes a durable, attributable history instead of the
-- "creator is the mechanic" conflation: mechanic_work_orders.mechanic_id is kept
-- for compatibility but stops being the final authority (plan §6.4).

-- +migrate Up

-- ── additive convergence columns on the EXISTING authority ──
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS service_case_id UUID;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS service_category TEXT;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS cancellation_reason_code TEXT;
-- Money: never assume USD. Absent cost stays absent (NULL), never rendered as zero.
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS currency TEXT;

-- The Service Case link is explicit and idempotent: at most ONE work order per
-- case in Foundation 1.0, enforced by the database rather than by convention.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mechanic_work_orders_service_case
  ON mechanic_work_orders(service_case_id)
  WHERE service_case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mechanic_work_orders_branch
  ON mechanic_work_orders(branch_id) WHERE branch_id IS NOT NULL;

-- Branch integrity at the database, mirroring service_cases: a work order may only
-- carry a branch belonging to its own tenant. MATCH SIMPLE means legacy rows with a
-- NULL tenant_id or branch_id are unaffected, so this stays additive.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mechanic_work_orders_branch_within_tenant'
  ) THEN
    ALTER TABLE mechanic_work_orders
      ADD CONSTRAINT mechanic_work_orders_branch_within_tenant
      FOREIGN KEY (branch_id, tenant_id)
      REFERENCES garage_branches(id, tenant_id) ON DELETE RESTRICT;
  END IF;
END $$;

-- The Service Case link becomes real referential integrity, not just a column.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mechanic_work_orders_service_case_fk'
  ) THEN
    ALTER TABLE mechanic_work_orders
      ADD CONSTRAINT mechanic_work_orders_service_case_fk
      FOREIGN KEY (service_case_id) REFERENCES service_cases(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ── durable mechanic assignment history ──
CREATE TABLE IF NOT EXISTS work_order_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL,
  -- RESTRICT: who worked on what is history, not disposable bookkeeping.
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  mechanic_user_id TEXT NOT NULL REFERENCES users(id),
  assigned_by_user_id TEXT NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  unassigned_by_user_id TEXT REFERENCES users(id),
  unassign_reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most ONE live assignment per work order: a second concurrent assign must
-- lose the race at the database rather than produce two "current" mechanics.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_order_assignments_live
  ON work_order_assignments(work_order_id)
  WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_order_assignments_mechanic
  ON work_order_assignments(mechanic_user_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_order_assignments_tenant
  ON work_order_assignments(tenant_id);

ALTER TABLE work_order_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE work_order_assignments FROM PUBLIC, anon, authenticated;
-- No DELETE: unassignment closes a row (unassigned_at); history is retained.
GRANT SELECT, INSERT, UPDATE ON TABLE work_order_assignments TO service_role;

-- +migrate Down
ALTER TABLE mechanic_work_orders DROP CONSTRAINT IF EXISTS mechanic_work_orders_service_case_fk;
ALTER TABLE mechanic_work_orders DROP CONSTRAINT IF EXISTS mechanic_work_orders_branch_within_tenant;
DROP TABLE IF EXISTS work_order_assignments;
DROP INDEX IF EXISTS uq_mechanic_work_orders_service_case;
DROP INDEX IF EXISTS idx_mechanic_work_orders_branch;
ALTER TABLE mechanic_work_orders DROP COLUMN IF EXISTS currency;
ALTER TABLE mechanic_work_orders DROP COLUMN IF EXISTS cancellation_reason_code;
ALTER TABLE mechanic_work_orders DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE mechanic_work_orders DROP COLUMN IF EXISTS completed_at;
ALTER TABLE mechanic_work_orders DROP COLUMN IF EXISTS service_category;
ALTER TABLE mechanic_work_orders DROP COLUMN IF EXISTS branch_id;
ALTER TABLE mechanic_work_orders DROP COLUMN IF EXISTS service_case_id;
