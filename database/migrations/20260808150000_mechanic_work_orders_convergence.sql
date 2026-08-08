-- =============================================================
-- MECHANIC WORK ORDERS / PARTS SCHEMA CONVERGENCE
-- =============================================================
-- Two divergent historical shapes exist for mechanic_work_orders and
-- mechanic_parts:
--   * 006_domain1.sql      — organization_id TEXT NOT NULL, customer_name NOT NULL,
--                            issue_description, no tenant/mechanic/cost columns.
--   * 009_phase4_schema.sql — tenant_id UUID NOT NULL, customer_id, mechanic_id,
--                            description, labor_cost, total_cost, no organization_id
--                            and no customer_name.
-- The backend (backend/routes/workOrdersRoutes.js, backend/routes/partsRoutes.js)
-- writes the phase-4 column names. This migration converges BOTH historical
-- shapes onto a superset additively, so it is idempotent regardless of which
-- CREATE TABLE IF NOT EXISTS won in a given environment.

-- +migrate Up

-- ── mechanic_work_orders: add every column the backend write path uses ──
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS customer_id TEXT;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS mechanic_id TEXT;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS labor_cost NUMERIC DEFAULT 0;
ALTER TABLE mechanic_work_orders ADD COLUMN IF NOT EXISTS total_cost NUMERIC DEFAULT 0;

-- Legacy 006 shape declared organization_id / customer_name NOT NULL; the
-- phase-4 write path does not populate organization_id, so inserts would fail
-- on that shape. Drop the constraints only where they exist so this is a
-- no-op on the phase-4 shape.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mechanic_work_orders'
      AND column_name = 'organization_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE mechanic_work_orders ALTER COLUMN organization_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mechanic_work_orders'
      AND column_name = 'customer_name'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE mechanic_work_orders ALTER COLUMN customer_name DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mechanic_work_orders_tenant ON mechanic_work_orders(tenant_id);

-- ── mechanic_parts: same additive convergence ──
ALTER TABLE mechanic_parts ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE mechanic_parts ADD COLUMN IF NOT EXISTS min_stock INTEGER DEFAULT 0;
ALTER TABLE mechanic_parts ADD COLUMN IF NOT EXISTS supplier TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mechanic_parts'
      AND column_name = 'organization_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE mechanic_parts ALTER COLUMN organization_id DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mechanic_parts_tenant ON mechanic_parts(tenant_id);

-- +migrate Down
-- Intentional no-op: this migration is purely additive convergence of two
-- divergent historical table shapes. Dropping the added columns would destroy
-- live work-order data on the phase-4 shape (where they are original columns)
-- and re-adding NOT NULL constraints could not be satisfied by rows written
-- while the constraint was absent. Roll forward instead.
