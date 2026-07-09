-- +migrate Up
-- Communication audit trail. The existing auditLogger writes vehicle/trust-shaped rows
-- (trust_audit_events / organization_audit_logs) that cannot express communication events, so this
-- adds a dedicated, additive append-only table + indexes + RLS. No existing table is altered.
-- (Command Center plan §8; issue #107.) Every material communication mutation writes one row here:
-- inbound receipt, AI classification/draft, assignment, reassignment, escalation, reply, internal
-- note, queue claim, delivery attempt, delivery receipt, retry/cancel/dead-letter, resolve/reopen,
-- identity linking, preference/consent change, mark-read, and provider smoke tests.

CREATE TABLE IF NOT EXISTS communication_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  thread_id UUID,
  message_id UUID,
  -- TEXT (not UUID): the live notification_queue.id is BIGSERIAL and message_delivery_attempts
  -- .notification_id is TEXT, so a UUID column could not hold a legacy numeric queue id (e.g. 8).
  notification_id TEXT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('agent','admin','system','worker','ai','customer','platform')),
  actor_id TEXT,
  channel TEXT,
  summary TEXT,
  correlation_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_audit_thread_created ON communication_audit_events (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_audit_tenant_created ON communication_audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_audit_event_type ON communication_audit_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_audit_correlation ON communication_audit_events (correlation_id);

-- RLS (hardened, #6): the backend service_role does all append/read (bypasses RLS) and the app layer
-- (resolveListScope) enforces tenant scope. The old policy authorized on ROLE NAME ONLY — a support
-- user in tenant A could read tenant B's audit trail. These policies are tenant-aware defense-in-depth
-- for any DIRECT client and deliberately have NO role-only wildcard:
--   • platform operators (platform_admin/super_admin) inspect globally — explicit + SEPARATE policy;
--   • a tenant-bound role reads ONLY rows whose tenant_id equals its own app_metadata.tenant_id claim;
--   • anon, tenantless roles, and cross-tenant reads are denied (platform/tenant-null rows are never
--     visible to a tenant role, and a caller with no tenant claim matches nothing → fail-closed).
ALTER TABLE communication_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "communication_audit_admin_read" ON communication_audit_events;  -- remove role-only leak
DROP POLICY IF EXISTS "communication_audit_platform_read" ON communication_audit_events;
CREATE POLICY "communication_audit_platform_read" ON communication_audit_events
  FOR SELECT
  USING ((select auth.jwt() -> 'app_metadata' ->> 'role') IN ('platform_admin','super_admin'));

DROP POLICY IF EXISTS "communication_audit_tenant_read" ON communication_audit_events;
CREATE POLICY "communication_audit_tenant_read" ON communication_audit_events
  FOR SELECT
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    AND (select auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin','support','finance','trust_manager','compliance_manager','marketplace_manager')
  );

-- Table privileges: no anon access; authenticated may SELECT (RLS above filters to the caller's tenant
-- / platform scope); the backend service_role appends + reads (and bypasses RLS). Append-only: no
-- UPDATE/DELETE is granted to anyone (the audit trail is immutable from the API).
REVOKE ALL ON communication_audit_events FROM anon;
GRANT SELECT ON communication_audit_events TO authenticated;
GRANT SELECT, INSERT ON communication_audit_events TO service_role;

-- +migrate Down
DROP POLICY IF EXISTS "communication_audit_admin_read" ON communication_audit_events;
DROP POLICY IF EXISTS "communication_audit_platform_read" ON communication_audit_events;
DROP POLICY IF EXISTS "communication_audit_tenant_read" ON communication_audit_events;
DROP TABLE IF EXISTS communication_audit_events;
