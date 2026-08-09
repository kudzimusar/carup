-- =============================================================
-- API-ROLE WRITE HARDENING — close live-verified PostgREST exposure
-- =============================================================
-- The database-compatibility audit (2026-08-09) live-verified on staging:
--   · mechanic_work_orders, mechanic_parts, vehicle_ownership_history have
--     RLS DISABLED and anon/authenticated hold FULL DML via default grants —
--     directly writable through PostgREST with the anon key, bypassing every
--     application-layer tenant check. PR #139 makes these tables product-
--     active, raising the materiality.
--   · vehicle_evidence grants INSERT/UPDATE to anon AND authenticated
--     (015_vehicle_evidence_timeline.sql:58-59); the 20260624120000 hardening
--     scoped the SELECT policy but never revoked the write grants.
--   · vehicles grants FULL DML to anon/authenticated, and the permissive
--     tenant_vehicles_isolation policy's `tenant_id IS NULL` branch makes
--     private-seller rows anon-WRITABLE via REST.
-- This migration is WRITE-side only. It deliberately does NOT change any
-- SELECT posture: the `vehicles_public_read USING (true)` read policy is a
-- product decision tracked under Issue #101 (anon browses public vehicles
-- directly, per 20260620232827) and is left for that program to adjudicate.
-- The backend exclusively uses the service-role client for all these tables
-- (audit-verified), so no product path loses access.

-- +migrate Up

-- Tables that had no row security at all: enable RLS with zero policies
-- (default-deny for API roles; service_role bypasses RLS).
ALTER TABLE mechanic_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE mechanic_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_ownership_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mechanic_work_orders FROM anon, authenticated;
REVOKE ALL ON mechanic_parts FROM anon, authenticated;
REVOKE ALL ON vehicle_ownership_history FROM anon, authenticated;
GRANT ALL ON mechanic_work_orders TO service_role;
GRANT ALL ON mechanic_parts TO service_role;
GRANT ALL ON vehicle_ownership_history TO service_role;

-- Evidence: the scoped SELECT policy stands; API-role writes were never
-- legitimate (every upload flows through the backend).
REVOKE INSERT, UPDATE, DELETE ON vehicle_evidence FROM anon, authenticated;

-- Vehicles: revoke API-role WRITES only. The web anon client's sole consumer
-- is dead code (audit-verified); every legitimate write goes through the
-- backend service-role client.
REVOKE INSERT, UPDATE, DELETE ON vehicles FROM anon, authenticated;

-- +migrate Down
-- Restoring broad API-role grants would recreate the exposure this migration
-- exists to close; reversal is a deliberate operator action:
--   GRANT INSERT, UPDATE, DELETE ON vehicles TO anon, authenticated;
--   GRANT INSERT, UPDATE ON vehicle_evidence TO authenticated;
--   ALTER TABLE mechanic_work_orders DISABLE ROW LEVEL SECURITY; (etc.)
