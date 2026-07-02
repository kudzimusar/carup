-- +migrate Up
-- =====================================================================================
-- Phase 2 — Vehicle Trust Security Hardening
-- Scope:
--   1. Enable RLS on vehicle_evidence, vehicle_plate_history (vehicle_documents already
--      covered by 20260619201406_production_access_containment.sql).
--   2. Add scoped RLS policies replacing the broad USING(true) policies from M1–M5.
--   3. Change ON DELETE CASCADE to ON DELETE RESTRICT on three provenance/audit FK chains.
--   4. Pin search_path on M1–M5 trigger functions.
--   5. Add proper grants for anon-denied tables.
--
-- Design principles:
--   * ADDITIVE: drops only the named policies, replaces them with scoped policies.
--   * SAFE: uses IF EXISTS + DO-block for all destructive or conditional steps.
--   * Service-role-only tables are locked with REVOKE ALL + ENABLE RLS + no client policy.
--   * Provenance events, AI internals, source records and ingestion state are never
--     exposed to authenticated clients directly — they are API-mediated.
-- =====================================================================================

-- =====================================================================================
-- 1. FIX PROVENANCE CASCADE DELETION RISKS
--    Replace ON DELETE CASCADE with ON DELETE RESTRICT on audit-trail FK chains.
--    Prevents silent loss of provenance when evidence or vehicles are deleted.
-- =====================================================================================

DO $$
DECLARE
  c RECORD;
BEGIN
  -- 1a. evidence_provenance_events.evidence_id → vehicle_evidence(id): CASCADE → RESTRICT
  SELECT conname INTO c
    FROM pg_constraint
    WHERE conrelid = 'evidence_provenance_events'::regclass
      AND confrelid = 'vehicle_evidence'::regclass
      AND contype = 'f'
    LIMIT 1;
  IF c.conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evidence_provenance_events DROP CONSTRAINT %I', c.conname);
  END IF;
  IF to_regclass('evidence_provenance_events') IS NOT NULL
     AND to_regclass('vehicle_evidence') IS NOT NULL THEN
    ALTER TABLE evidence_provenance_events
      ADD CONSTRAINT evidence_provenance_events_evidence_id_fkey
      FOREIGN KEY (evidence_id) REFERENCES vehicle_evidence(id) ON DELETE RESTRICT;
  END IF;

  -- 1b. evidence_sets.vin → vehicles(vin): CASCADE → RESTRICT
  SELECT conname INTO c
    FROM pg_constraint
    WHERE conrelid = 'evidence_sets'::regclass
      AND confrelid = 'vehicles'::regclass
      AND contype = 'f'
      AND conkey = (SELECT ARRAY[attnum] FROM pg_attribute
                    WHERE attrelid = 'evidence_sets'::regclass AND attname = 'vin')
    LIMIT 1;
  IF c.conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evidence_sets DROP CONSTRAINT %I', c.conname);
  END IF;
  IF to_regclass('evidence_sets') IS NOT NULL
     AND to_regclass('vehicles') IS NOT NULL THEN
    ALTER TABLE evidence_sets
      ADD CONSTRAINT evidence_sets_vin_fkey
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE RESTRICT;
  END IF;

  -- 1c. report_versions.vin → vehicles(vin): CASCADE → RESTRICT
  SELECT conname INTO c
    FROM pg_constraint
    WHERE conrelid = 'report_versions'::regclass
      AND confrelid = 'vehicles'::regclass
      AND contype = 'f'
    LIMIT 1;
  IF c.conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE report_versions DROP CONSTRAINT %I', c.conname);
  END IF;
  IF to_regclass('report_versions') IS NOT NULL
     AND to_regclass('vehicles') IS NOT NULL THEN
    ALTER TABLE report_versions
      ADD CONSTRAINT report_versions_vin_fkey
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE RESTRICT;
  END IF;
END $$;

-- =====================================================================================
-- 2. ENABLE RLS ON EXISTING TABLES THAT LACKED IT
--    vehicle_documents was covered by the 20260619 containment migration.
--    vehicle_evidence and vehicle_plate_history were not included there.
-- =====================================================================================

DO $$
BEGIN
  IF to_regclass('vehicle_evidence') IS NOT NULL THEN
    ALTER TABLE vehicle_evidence ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('vehicle_plate_history') IS NOT NULL THEN
    ALTER TABLE vehicle_plate_history ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- vehicle_evidence: drop the broad USING(true) authenticated read policy from
-- 015_vehicle_evidence_timeline.sql, then add a scoped replacement.
DROP POLICY IF EXISTS "vehicle evidence authenticated read" ON vehicle_evidence;
DROP POLICY IF EXISTS "vehicle evidence uploader or admin read" ON vehicle_evidence;
DO $$
BEGIN
  IF to_regclass('vehicle_evidence') IS NOT NULL THEN
    CREATE POLICY "vehicle evidence uploader or admin read"
      ON vehicle_evidence FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND (
          uploaded_by = auth.uid()::text
          OR verified_by = auth.uid()::text
          OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()::text
              AND u.role IN ('admin', 'government', 'reviewer', 'dealer')
          )
        )
      );
  END IF;
END $$;

-- vehicle_plate_history: admin/government only.
-- Plate history contains privacy-sensitive historical registration data.
DROP POLICY IF EXISTS "vehicle plate history admin read" ON vehicle_plate_history;
DO $$
BEGIN
  IF to_regclass('vehicle_plate_history') IS NOT NULL THEN
    REVOKE ALL ON TABLE vehicle_plate_history FROM anon, authenticated;
    GRANT ALL ON TABLE vehicle_plate_history TO service_role;
    CREATE POLICY "vehicle plate history admin read"
      ON vehicle_plate_history FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
  END IF;
END $$;

-- =====================================================================================
-- 3. NARROW M1 POLICIES: evidence_sets + evidence_provenance_events
-- =====================================================================================

-- evidence_sets: owner (uploaded_by evidence in the set) or admin/reviewer/dealer.
DROP POLICY IF EXISTS "evidence sets authenticated read" ON evidence_sets;
DROP POLICY IF EXISTS "evidence sets owner or admin read" ON evidence_sets;
DO $$
BEGIN
  IF to_regclass('evidence_sets') IS NOT NULL THEN
    CREATE POLICY "evidence sets owner or admin read"
      ON evidence_sets FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND (
          created_by = auth.uid()::text
          OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()::text
              AND u.role IN ('admin', 'government', 'reviewer', 'dealer')
          )
        )
      );
  END IF;
END $$;

-- evidence_provenance_events: contains actor IPs and internal request details.
-- Restricted to admin/reviewer only; never exposed to anon or regular users.
DROP POLICY IF EXISTS "provenance authenticated read" ON evidence_provenance_events;
DROP POLICY IF EXISTS "provenance admin or reviewer read" ON evidence_provenance_events;
DO $$
BEGIN
  IF to_regclass('evidence_provenance_events') IS NOT NULL THEN
    REVOKE ALL ON TABLE evidence_provenance_events FROM anon, authenticated;
    GRANT ALL ON TABLE evidence_provenance_events TO service_role;
    CREATE POLICY "provenance admin or reviewer read"
      ON evidence_provenance_events FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
    GRANT SELECT ON TABLE evidence_provenance_events TO authenticated;
  END IF;
END $$;

-- =====================================================================================
-- 4. LOCK DOWN M2 TABLES: service-role only
--    ingestion_jobs, source_records, vehicle_identity_candidates, listing_snapshots
--    hold raw external data, source credentials, internal identity resolution state.
-- =====================================================================================

DO $$
DECLARE
  tbl text;
  tbl_list text[] := ARRAY[
    'ingestion_jobs',
    'source_records',
    'vehicle_identity_candidates',
    'listing_snapshots'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbl_list LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tbl);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', tbl);
    END IF;
  END LOOP;

  -- Drop the broad policies that were created by M2 migration
  IF to_regclass('ingestion_jobs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ingestion jobs authenticated read" ON ingestion_jobs;
  END IF;
  IF to_regclass('source_records') IS NOT NULL THEN
    DROP POLICY IF EXISTS "source records authenticated read" ON source_records;
  END IF;
  IF to_regclass('vehicle_identity_candidates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "identity candidates authenticated read" ON vehicle_identity_candidates;
  END IF;
  IF to_regclass('listing_snapshots') IS NOT NULL THEN
    DROP POLICY IF EXISTS "listing snapshots authenticated read" ON listing_snapshots;
  END IF;
END $$;

-- =====================================================================================
-- 5. NARROW M3 POLICIES: AI jobs, observations, temporal, disclosure
-- =====================================================================================

-- ai_analysis_jobs: internal processing state — service-role only.
DO $$
BEGIN
  IF to_regclass('ai_analysis_jobs') IS NOT NULL THEN
    ALTER TABLE ai_analysis_jobs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE ai_analysis_jobs FROM anon, authenticated;
    GRANT ALL ON TABLE ai_analysis_jobs TO service_role;
    DROP POLICY IF EXISTS "ai jobs authenticated read" ON ai_analysis_jobs;
  END IF;
END $$;

-- ai_observations: raw AI output — admin/reviewer only, never anon.
DROP POLICY IF EXISTS "ai obs authenticated read" ON ai_observations;
DROP POLICY IF EXISTS "ai observations admin or reviewer read" ON ai_observations;
DO $$
BEGIN
  IF to_regclass('ai_observations') IS NOT NULL THEN
    REVOKE SELECT ON TABLE ai_observations FROM anon, authenticated;
    GRANT ALL ON TABLE ai_observations TO service_role;
    CREATE POLICY "ai observations admin or reviewer read"
      ON ai_observations FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
    GRANT SELECT ON TABLE ai_observations TO authenticated;
  END IF;
END $$;

-- temporal_findings: internal AI timeline comparisons — admin/reviewer only.
DROP POLICY IF EXISTS "temporal findings authenticated read" ON temporal_findings;
DROP POLICY IF EXISTS "temporal findings admin or reviewer read" ON temporal_findings;
DO $$
BEGIN
  IF to_regclass('temporal_findings') IS NOT NULL THEN
    REVOKE SELECT ON TABLE temporal_findings FROM anon, authenticated;
    GRANT ALL ON TABLE temporal_findings TO service_role;
    CREATE POLICY "temporal findings admin or reviewer read"
      ON temporal_findings FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
    GRANT SELECT ON TABLE temporal_findings TO authenticated;
  END IF;
END $$;

-- disclosure_claims: admin/reviewer only.
-- Public-safe disclosure language is surfaced via the report service, not raw claims.
DROP POLICY IF EXISTS "disclosure claims authenticated read" ON disclosure_claims;
DROP POLICY IF EXISTS "disclosure claims owner or admin read" ON disclosure_claims;
DO $$
BEGIN
  IF to_regclass('disclosure_claims') IS NOT NULL THEN
    REVOKE SELECT ON TABLE disclosure_claims FROM anon, authenticated;
    GRANT ALL ON TABLE disclosure_claims TO service_role;
    CREATE POLICY "disclosure claims admin or reviewer read"
      ON disclosure_claims FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
    GRANT SELECT ON TABLE disclosure_claims TO authenticated;
  END IF;
END $$;

-- disclosure_conflicts: admin/reviewer only — never exposed to buyers or owners.
DROP POLICY IF EXISTS "disclosure conflicts authenticated read" ON disclosure_conflicts;
DROP POLICY IF EXISTS "disclosure conflicts admin or reviewer read" ON disclosure_conflicts;
DO $$
BEGIN
  IF to_regclass('disclosure_conflicts') IS NOT NULL THEN
    REVOKE SELECT ON TABLE disclosure_conflicts FROM anon, authenticated;
    GRANT ALL ON TABLE disclosure_conflicts TO service_role;
    CREATE POLICY "disclosure conflicts admin or reviewer read"
      ON disclosure_conflicts FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
    GRANT SELECT ON TABLE disclosure_conflicts TO authenticated;
  END IF;
END $$;

-- =====================================================================================
-- 6. NARROW M4 POLICY: report_versions
--    Three separate policies: public share token, owner, admin.
-- =====================================================================================

DROP POLICY IF EXISTS "report versions authenticated read" ON report_versions;
DROP POLICY IF EXISTS "report versions public share" ON report_versions;
DROP POLICY IF EXISTS "report versions owner read" ON report_versions;
DROP POLICY IF EXISTS "report versions admin read" ON report_versions;
DO $$
BEGIN
  IF to_regclass('report_versions') IS NOT NULL THEN
    -- Public can read non-revoked, non-expired reports via share token.
    CREATE POLICY "report versions public share"
      ON report_versions FOR SELECT TO anon, authenticated
      USING (
        share_token IS NOT NULL
        AND revoked = false
        AND (share_expires_at IS NULL OR share_expires_at > NOW())
      );

    -- Owner reads their vehicle's versions.
    CREATE POLICY "report versions owner read"
      ON report_versions FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM vehicle_ownership_history voh
          WHERE voh.vin = report_versions.vin
            AND voh.new_owner_id = auth.uid()::text
        )
      );

    -- Admin/reviewer reads all.
    CREATE POLICY "report versions admin read"
      ON report_versions FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
  END IF;
END $$;

-- =====================================================================================
-- 7. NARROW M5 POLICIES: review tasks, decisions, disputes, dispute events, trust log
-- =====================================================================================

-- review_tasks: admin/government/reviewer only — contains internal reviewer assignments.
DROP POLICY IF EXISTS "review tasks authenticated read" ON review_tasks;
DROP POLICY IF EXISTS "review tasks admin or reviewer read" ON review_tasks;
DO $$
BEGIN
  IF to_regclass('review_tasks') IS NOT NULL THEN
    REVOKE SELECT ON TABLE review_tasks FROM anon, authenticated;
    GRANT ALL ON TABLE review_tasks TO service_role;
    CREATE POLICY "review tasks admin or reviewer read"
      ON review_tasks FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
    GRANT SELECT ON TABLE review_tasks TO authenticated;
  END IF;
END $$;

-- review_decisions: admin/reviewer only — contains reviewer identity and rationale.
DROP POLICY IF EXISTS "review decisions authenticated read" ON review_decisions;
DROP POLICY IF EXISTS "review decisions admin or reviewer read" ON review_decisions;
DO $$
BEGIN
  IF to_regclass('review_decisions') IS NOT NULL THEN
    REVOKE SELECT ON TABLE review_decisions FROM anon, authenticated;
    GRANT ALL ON TABLE review_decisions TO service_role;
    CREATE POLICY "review decisions admin or reviewer read"
      ON review_decisions FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
    GRANT SELECT ON TABLE review_decisions TO authenticated;
  END IF;
END $$;

-- disputes: raiser sees their own; admin/reviewer sees all; anon never.
DROP POLICY IF EXISTS "disputes authenticated read" ON disputes;
DROP POLICY IF EXISTS "disputes raiser read" ON disputes;
DO $$
BEGIN
  IF to_regclass('disputes') IS NOT NULL THEN
    REVOKE SELECT ON TABLE disputes FROM anon, authenticated;
    GRANT ALL ON TABLE disputes TO service_role;
    CREATE POLICY "disputes raiser read"
      ON disputes FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND (
          raised_by = auth.uid()::text
          OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = auth.uid()::text
              AND u.role IN ('admin', 'government', 'reviewer')
          )
        )
      );
    GRANT SELECT ON TABLE disputes TO authenticated;
  END IF;
END $$;

-- dispute_events: append-only log scoped to the parent dispute's raiser or admin.
DROP POLICY IF EXISTS "dispute events authenticated read" ON dispute_events;
DROP POLICY IF EXISTS "dispute events via dispute read" ON dispute_events;
DO $$
BEGIN
  IF to_regclass('dispute_events') IS NOT NULL
     AND to_regclass('disputes') IS NOT NULL THEN
    REVOKE SELECT ON TABLE dispute_events FROM anon, authenticated;
    GRANT ALL ON TABLE dispute_events TO service_role;
    CREATE POLICY "dispute events via dispute read"
      ON dispute_events FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM disputes d
          WHERE d.id = dispute_events.dispute_id
            AND (
              d.raised_by = auth.uid()::text
              OR EXISTS (
                SELECT 1 FROM users u
                WHERE u.id = auth.uid()::text
                  AND u.role IN ('admin', 'government', 'reviewer')
              )
            )
        )
      );
    GRANT SELECT ON TABLE dispute_events TO authenticated;
  END IF;
END $$;

-- trust_change_log: admin/reviewer only — internal trust mutation records.
DROP POLICY IF EXISTS "trust change log authenticated read" ON trust_change_log;
DROP POLICY IF EXISTS "trust change log admin or reviewer read" ON trust_change_log;
DO $$
BEGIN
  IF to_regclass('trust_change_log') IS NOT NULL THEN
    REVOKE SELECT ON TABLE trust_change_log FROM anon, authenticated;
    GRANT ALL ON TABLE trust_change_log TO service_role;
    CREATE POLICY "trust change log admin or reviewer read"
      ON trust_change_log FOR SELECT TO authenticated
      USING (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()::text
            AND u.role IN ('admin', 'government', 'reviewer')
        )
      );
    GRANT SELECT ON TABLE trust_change_log TO authenticated;
  END IF;
END $$;

-- =====================================================================================
-- 8. PIN search_path ON M1–M5 TRIGGER FUNCTIONS
-- =====================================================================================

DO $$
BEGIN
  IF to_regprocedure('carup_provenance_block_mutation()') IS NOT NULL THEN
    ALTER FUNCTION carup_provenance_block_mutation() SET search_path = public, pg_temp;
  END IF;
  IF to_regprocedure('carup_listing_snapshot_block_mutation()') IS NOT NULL THEN
    ALTER FUNCTION carup_listing_snapshot_block_mutation() SET search_path = public, pg_temp;
  END IF;
  IF to_regprocedure('carup_report_version_guard()') IS NOT NULL THEN
    ALTER FUNCTION carup_report_version_guard() SET search_path = public, pg_temp;
  END IF;
  IF to_regprocedure('governance_block_mutation()') IS NOT NULL THEN
    ALTER FUNCTION governance_block_mutation() SET search_path = public, pg_temp;
  END IF;
END $$;

-- +migrate Down
-- Roll back to the broad M1–M5 policies (for isolated rollback testing only).
-- IMPORTANT: rolling back to USING(true) policies is a security regression.
-- Never apply the Down section to production.

-- Restore CASCADE FKs
DO $$
DECLARE
  c RECORD;
BEGIN
  -- evidence_provenance_events
  SELECT conname INTO c
    FROM pg_constraint
    WHERE conrelid = 'evidence_provenance_events'::regclass
      AND confrelid = 'vehicle_evidence'::regclass
      AND contype = 'f'
    LIMIT 1;
  IF c.conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evidence_provenance_events DROP CONSTRAINT %I', c.conname);
  END IF;
  IF to_regclass('evidence_provenance_events') IS NOT NULL
     AND to_regclass('vehicle_evidence') IS NOT NULL THEN
    ALTER TABLE evidence_provenance_events
      ADD CONSTRAINT evidence_provenance_events_evidence_id_fkey
      FOREIGN KEY (evidence_id) REFERENCES vehicle_evidence(id) ON DELETE CASCADE;
  END IF;
  -- evidence_sets
  SELECT conname INTO c
    FROM pg_constraint
    WHERE conrelid = 'evidence_sets'::regclass
      AND confrelid = 'vehicles'::regclass
      AND contype = 'f'
    LIMIT 1;
  IF c.conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evidence_sets DROP CONSTRAINT %I', c.conname);
  END IF;
  IF to_regclass('evidence_sets') IS NOT NULL THEN
    ALTER TABLE evidence_sets
      ADD CONSTRAINT evidence_sets_vin_fkey
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE;
  END IF;
  -- report_versions
  SELECT conname INTO c
    FROM pg_constraint
    WHERE conrelid = 'report_versions'::regclass
      AND confrelid = 'vehicles'::regclass
      AND contype = 'f'
    LIMIT 1;
  IF c.conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE report_versions DROP CONSTRAINT %I', c.conname);
  END IF;
  IF to_regclass('report_versions') IS NOT NULL THEN
    ALTER TABLE report_versions
      ADD CONSTRAINT report_versions_vin_fkey
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE;
  END IF;
END $$;

-- Restore RLS state on vehicle_evidence (re-enable the broad 015 policy)
DO $$
BEGIN
  IF to_regclass('vehicle_evidence') IS NOT NULL THEN
    DROP POLICY IF EXISTS "vehicle evidence uploader or admin read" ON vehicle_evidence;
    CREATE POLICY "vehicle evidence authenticated read"
      ON vehicle_evidence FOR SELECT TO authenticated USING (true);
  END IF;
  IF to_regclass('vehicle_plate_history') IS NOT NULL THEN
    ALTER TABLE vehicle_plate_history DISABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "vehicle plate history admin read" ON vehicle_plate_history;
    GRANT SELECT ON TABLE vehicle_plate_history TO authenticated;
  END IF;
END $$;

-- Restore broad M1 policies
DO $$
BEGIN
  IF to_regclass('evidence_sets') IS NOT NULL THEN
    DROP POLICY IF EXISTS "evidence sets owner or admin read" ON evidence_sets;
    CREATE POLICY "evidence sets authenticated read"
      ON evidence_sets FOR SELECT TO authenticated USING (true);
  END IF;
  IF to_regclass('evidence_provenance_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS "provenance admin or reviewer read" ON evidence_provenance_events;
    GRANT SELECT ON TABLE evidence_provenance_events TO authenticated;
    CREATE POLICY "provenance authenticated read"
      ON evidence_provenance_events FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Restore broad M2 policies
DO $$
DECLARE
  tbl text;
  tbl_list text[] := ARRAY['ingestion_jobs','source_records','vehicle_identity_candidates','listing_snapshots'];
BEGIN
  FOREACH tbl IN ARRAY tbl_list LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', tbl);
      EXECUTE format('CREATE POLICY "' || tbl || ' authenticated read" ON public.%I FOR SELECT TO authenticated USING (true)', tbl);
    END IF;
  END LOOP;
END $$;

-- Restore broad M3–M5 policies
DO $$
BEGIN
  IF to_regclass('ai_analysis_jobs') IS NOT NULL THEN
    GRANT SELECT ON TABLE ai_analysis_jobs TO authenticated;
    CREATE POLICY "ai jobs authenticated read" ON ai_analysis_jobs FOR SELECT TO authenticated USING (true);
  END IF;
  IF to_regclass('ai_observations') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ai observations admin or reviewer read" ON ai_observations;
    CREATE POLICY "ai obs authenticated read" ON ai_observations FOR SELECT TO authenticated USING (true);
    GRANT SELECT ON TABLE ai_observations TO anon;
  END IF;
  IF to_regclass('temporal_findings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "temporal findings admin or reviewer read" ON temporal_findings;
    CREATE POLICY "temporal findings authenticated read" ON temporal_findings FOR SELECT TO authenticated USING (true);
    GRANT SELECT ON TABLE temporal_findings TO anon;
  END IF;
  IF to_regclass('disclosure_claims') IS NOT NULL THEN
    DROP POLICY IF EXISTS "disclosure claims admin or reviewer read" ON disclosure_claims;
    CREATE POLICY "disclosure claims authenticated read" ON disclosure_claims FOR SELECT TO authenticated USING (true);
    GRANT SELECT ON TABLE disclosure_claims TO anon;
  END IF;
  IF to_regclass('disclosure_conflicts') IS NOT NULL THEN
    DROP POLICY IF EXISTS "disclosure conflicts admin or reviewer read" ON disclosure_conflicts;
    CREATE POLICY "disclosure conflicts authenticated read" ON disclosure_conflicts FOR SELECT TO authenticated USING (true);
    GRANT SELECT ON TABLE disclosure_conflicts TO anon;
  END IF;
  IF to_regclass('report_versions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "report versions public share" ON report_versions;
    DROP POLICY IF EXISTS "report versions owner read" ON report_versions;
    DROP POLICY IF EXISTS "report versions admin read" ON report_versions;
    GRANT SELECT ON TABLE report_versions TO authenticated;
    CREATE POLICY "report versions authenticated read" ON report_versions FOR SELECT TO authenticated USING (true);
  END IF;
  IF to_regclass('review_tasks') IS NOT NULL THEN
    DROP POLICY IF EXISTS "review tasks admin or reviewer read" ON review_tasks;
    GRANT SELECT ON TABLE review_tasks TO authenticated;
    CREATE POLICY "review tasks authenticated read" ON review_tasks FOR SELECT TO authenticated USING (true);
  END IF;
  IF to_regclass('review_decisions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "review decisions admin or reviewer read" ON review_decisions;
    GRANT SELECT ON TABLE review_decisions TO authenticated;
    CREATE POLICY "review decisions authenticated read" ON review_decisions FOR SELECT TO authenticated USING (true);
  END IF;
  IF to_regclass('disputes') IS NOT NULL THEN
    DROP POLICY IF EXISTS "disputes raiser read" ON disputes;
    GRANT SELECT ON TABLE disputes TO authenticated;
    CREATE POLICY "disputes authenticated read" ON disputes FOR SELECT TO authenticated USING (true);
    GRANT SELECT ON TABLE disputes TO anon;
  END IF;
  IF to_regclass('dispute_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS "dispute events via dispute read" ON dispute_events;
    GRANT SELECT ON TABLE dispute_events TO authenticated;
    CREATE POLICY "dispute events authenticated read" ON dispute_events FOR SELECT TO authenticated USING (true);
    GRANT SELECT ON TABLE dispute_events TO anon;
  END IF;
  IF to_regclass('trust_change_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS "trust change log admin or reviewer read" ON trust_change_log;
    GRANT SELECT ON TABLE trust_change_log TO authenticated;
    CREATE POLICY "trust change log authenticated read" ON trust_change_log FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
