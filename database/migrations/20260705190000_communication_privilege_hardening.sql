-- +migrate Up
-- Supabase projects may carry default grants for the authenticated role. Reset privileges explicitly
-- so the audit trail remains append-only and SLA policy writes remain backend-service-only.

REVOKE ALL ON communication_audit_events FROM anon;
REVOKE ALL ON communication_audit_events FROM authenticated;
GRANT SELECT ON communication_audit_events TO authenticated;
GRANT SELECT, INSERT ON communication_audit_events TO service_role;

REVOKE ALL ON communication_sla_policies FROM anon;
REVOKE ALL ON communication_sla_policies FROM authenticated;
GRANT SELECT ON communication_sla_policies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON communication_sla_policies TO service_role;

-- +migrate Down
-- Intentionally no-op: rollback must not restore unsafe authenticated write privileges.