-- +migrate Up
-- SLA contracts for the communication Command Center (plan §10). Additive and backward-compatible:
-- reuses the existing message_threads.sla_due_at and only ADDS columns (IF NOT EXISTS) for the
-- first-response / next-response / resolution targets, pause/resume state, and a business-hours
-- timezone policy. A separate communication_sla_policies table holds reusable per-tenant targets.
-- No column is dropped or retyped; existing rows keep working with the columns defaulting to NULL.

ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS first_response_due_at TIMESTAMPTZ;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS next_response_due_at TIMESTAMPTZ;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS sla_paused_at TIMESTAMPTZ;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS sla_pause_reason TEXT;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS sla_paused_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS sla_business_timezone TEXT;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS sla_policy_id UUID;

CREATE INDEX IF NOT EXISTS idx_message_threads_first_response_due ON message_threads (first_response_due_at);
CREATE INDEX IF NOT EXISTS idx_message_threads_resolution_due ON message_threads (resolution_due_at);

-- Reusable per-tenant SLA policy targets (minutes) + business-hours window. Optional — a thread may
-- carry inline due-at columns without referencing a policy.
CREATE TABLE IF NOT EXISTS communication_sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  name TEXT NOT NULL,
  channel TEXT,
  priority TEXT,
  first_response_minutes INTEGER,
  next_response_minutes INTEGER,
  resolution_minutes INTEGER,
  business_timezone TEXT NOT NULL DEFAULT 'UTC',
  business_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_sla_policies_tenant ON communication_sla_policies (tenant_id, active);

-- RLS (hardened, #6): identical model to communication_audit_events. The backend service_role selects
-- policies for SLA computation (bypasses RLS); these tenant-aware policies guard any DIRECT client and
-- carry NO role-only wildcard. Global (tenant_id NULL) default policies are visible only to platform
-- operators here — the backend still reads them for every tenant's threads via service_role.
ALTER TABLE communication_sla_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "communication_sla_policies_admin_read" ON communication_sla_policies;  -- remove role-only leak
DROP POLICY IF EXISTS "communication_sla_policies_platform_read" ON communication_sla_policies;
CREATE POLICY "communication_sla_policies_platform_read" ON communication_sla_policies
  FOR SELECT
  USING ((select auth.jwt() -> 'app_metadata' ->> 'role') IN ('platform_admin','super_admin'));

DROP POLICY IF EXISTS "communication_sla_policies_tenant_read" ON communication_sla_policies;
CREATE POLICY "communication_sla_policies_tenant_read" ON communication_sla_policies
  FOR SELECT
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    AND (select auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','support','finance','trust_manager','compliance_manager','marketplace_manager')
  );

-- +migrate Down
DROP POLICY IF EXISTS "communication_sla_policies_admin_read" ON communication_sla_policies;
DROP POLICY IF EXISTS "communication_sla_policies_platform_read" ON communication_sla_policies;
DROP POLICY IF EXISTS "communication_sla_policies_tenant_read" ON communication_sla_policies;
DROP TABLE IF EXISTS communication_sla_policies;
DROP INDEX IF EXISTS idx_message_threads_first_response_due;
DROP INDEX IF EXISTS idx_message_threads_resolution_due;
ALTER TABLE message_threads DROP COLUMN IF EXISTS first_response_due_at;
ALTER TABLE message_threads DROP COLUMN IF EXISTS next_response_due_at;
ALTER TABLE message_threads DROP COLUMN IF EXISTS resolution_due_at;
ALTER TABLE message_threads DROP COLUMN IF EXISTS first_response_at;
ALTER TABLE message_threads DROP COLUMN IF EXISTS sla_paused_at;
ALTER TABLE message_threads DROP COLUMN IF EXISTS sla_pause_reason;
ALTER TABLE message_threads DROP COLUMN IF EXISTS sla_paused_seconds;
ALTER TABLE message_threads DROP COLUMN IF EXISTS sla_business_timezone;
ALTER TABLE message_threads DROP COLUMN IF EXISTS sla_policy_id;
