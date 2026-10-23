-- GARAGE-1.0-OPS03 â€” appointments + workshop scheduling + capacity foundation.
-- Planning authority only: Service Cases remain engagement authority; mechanic work orders and
-- work_order_assignments remain execution authority.
-- +migrate Up

CREATE TABLE IF NOT EXISTS garage_branch_scheduling_settings (
  branch_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scheduling_enabled BOOLEAN NOT NULL,
  max_concurrent_appointments INTEGER NOT NULL CHECK (max_concurrent_appointments BETWEEN 1 AND 100),
  slot_interval_minutes INTEGER NOT NULL CHECK (
    slot_interval_minutes BETWEEN 5 AND 240
    AND 1440 % slot_interval_minutes = 0
  ),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_ops03_settings_branch_tenant_fk
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES garage_branches(id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (branch_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS garage_workforce_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  workforce_profile_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  effective_from DATE NOT NULL,
  effective_until DATE,
  created_by_user_id TEXT N¶»§q«^