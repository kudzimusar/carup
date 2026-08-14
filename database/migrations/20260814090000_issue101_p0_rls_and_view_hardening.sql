-- +migrate Up
-- =============================================================================
-- ISSUE #101 — P0 HARDENING: the 14 RLS-disabled tables (B2) and the
--              evidence_sources_public write/bypass exposure (B3-P0)
-- =============================================================================
--
-- MEASURED PRODUCTION EVIDENCE THIS CLOSES (three probes, all read-only):
--   run 31749657530  14 public tables have RLS DISABLED with anon+authenticated
--                    holding full DML — the only EFFECTIVE_EXPOSURE_CONFIRMED set.
--   run 31759906271  anon/authenticated have rolcanlogin=false and rolbypassrls=false,
--                    so the DB itself is not directly reachable by them; and
--                    evidence_sources_public is is_updatable=YES / is_insertable_into=YES,
--                    owner=postgres, security_invoker NOT set, over a base table with
--                    RLS on and ZERO policies.
--   run 31764853958  all 14 tables AND evidence_sources_public are SCHEMA_ADVERTISED and
--                    ANON_DATA_API_REACHABLE + AUTHENTICATED_DATA_API_REACHABLE.
--                    The Data API is the path those roles CAN use.
--
-- TWO CONTROLS ARE REQUIRED PER TABLE, NOT ONE. Enabling RLS closes ordinary
-- SELECT/INSERT/UPDATE/DELETE for anon/authenticated, but RLS NEVER governs TRUNCATE —
-- and all 14 carry the TRUNCATE bit for both roles. REVOKE is the only TRUNCATE control.
-- Both run in ONE transaction so no window exists where one is applied without the other.
--
-- FORCE ROW LEVEL SECURITY is deliberately OMITTED everywhere. It constrains the TABLE
-- OWNER, not ordinary roles; relforcerowsecurity is false on all 183 production tables
-- today, and changing that is a separate decision with its own blast radius.
--
-- service_role is explicitly re-granted on every object touched. It already holds these
-- privileges; stating them makes the migration self-evidently non-breaking for the
-- backend, which reaches Postgres exclusively through the service-role client
-- (backend/db/supabase.js).
--
-- NO TABLE IS DROPPED. NO ROW IS READ, WRITTEN OR REWRITTEN. Catalog changes only.
--
-- Per-table classification is INDEPENDENT and evidence-backed. There is no blanket
-- policy model: exactly ONE of the 14 keeps a read surface, because exactly one has a
-- documented public-read intent in its own migration.

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION 0 — service_role MUST bypass RLS.  FAIL-LOUD, BEFORE ANY CHANGE.
-- ─────────────────────────────────────────────────────────────────────────────
-- Enabling RLS on fourteen tables is non-breaking for the backend ONLY because
-- service_role bypasses RLS — the backend reaches Postgres exclusively through the
-- service-role client. Production run 31759906271 measured rolbypassrls = true for
-- service_role, and that measurement is why this migration is expected to pass. It is
-- NOT a substitute for re-asserting the fact at execution time, against whatever
-- database is actually in front of us.
--
-- This runs FIRST. If it raises, the surrounding transaction aborts and NOT ONE table
-- is left partially hardened.
DO $issue101_precondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname = 'service_role' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION
      '[issue-101-p0] service_role is absent or lacks BYPASSRLS; enabling RLS would break every backend write. Refusing to apply any security change.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$issue101_precondition$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION 1 — every target object MUST already exist.  FAIL-LOUD.
-- ─────────────────────────────────────────────────────────────────────────────
-- Dependency reality, verified on origin/main: only SIX of the fourteen are created by
-- a migration —
--   004_add_tamper_proofing.sql .................. performance_telemetry,
--                                                  signature_verification_logs,
--                                                  system_failures
--   006_domain1.sql .............................. dealer_promotions
--   011_phase6_schema.sql ........................ currency_rates
--   20260621120000_vehicle_life_evidence_taxonomy_provenance.sql
--                                                  evidence_class_taxonomy,
--                                                  evidence_sources,
--                                                  evidence_sources_public (view)
-- The other EIGHT — the five registry tables and the three OCR children — are created
-- OUT-OF-BAND by scripts/deploy-missing-schemas.js and by no migration at all. A
-- migration-order assertion therefore cannot cover them; a runtime precondition can,
-- and does. Naming the missing objects explicitly is the difference between a
-- diagnosable failure and a confusing one.
DO $issue101_targets$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(name ORDER BY name) INTO v_missing
    FROM unnest(ARRAY[
      'cid_clearance_records','currency_rates','cvr_ownership_records','dealer_promotions',
      'evidence_class_taxonomy','ocr_customs_declarations','ocr_national_ids',
      'ocr_registration_books','performance_telemetry','signature_verification_logs',
      'system_failures','vid_inspections','zimra_declarations','zinara_licensing_records',
      'evidence_sources','evidence_sources_public'
    ]) AS name
   WHERE to_regclass('public.' || name) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-101-p0] target object(s) absent: %. The five registry and three OCR tables are created out-of-band by scripts/deploy-missing-schemas.js, which must run first. Refusing to apply a partial hardening.',
      array_to_string(v_missing, ', ')
      USING ERRCODE = 'undefined_table';
  END IF;
END
$issue101_targets$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B2a  GOVERNMENT / REGISTRY EVIDENCE — service-role only, no policy
-- ─────────────────────────────────────────────────────────────────────────────
-- Readers: backend/services/trustGraph/trustGraphService.js (service-role client).
-- Writers: backend/services/document-intelligence/documentIntelligenceService.js.
-- No anon/authenticated consumer exists anywhere in web/, mobile/ or shared/.
-- Default-deny is the intended end state, so no policy is created.
ALTER TABLE public.zimra_declarations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cvr_ownership_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vid_inspections          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cid_clearance_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zinara_licensing_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.zimra_declarations       FROM anon, authenticated;
REVOKE ALL ON TABLE public.cvr_ownership_records    FROM anon, authenticated;
REVOKE ALL ON TABLE public.vid_inspections          FROM anon, authenticated;
REVOKE ALL ON TABLE public.cid_clearance_records    FROM anon, authenticated;
REVOKE ALL ON TABLE public.zinara_licensing_records FROM anon, authenticated;

GRANT ALL ON TABLE public.zimra_declarations       TO service_role;
GRANT ALL ON TABLE public.cvr_ownership_records    TO service_role;
GRANT ALL ON TABLE public.vid_inspections          TO service_role;
GRANT ALL ON TABLE public.cid_clearance_records    TO service_role;
GRANT ALL ON TABLE public.zinara_licensing_records TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B2b  OCR STRUCTURED EXTRACTIONS — ingestion-only / sensitive-private, no policy
-- ─────────────────────────────────────────────────────────────────────────────
-- ocr_national_ids holds RAW IDENTITY (national_id_number, date_of_birth, names,
-- place_of_birth, sex). All three are WRITE-ONLY in the application: the only
-- references are three INSERTs in documentIntelligenceService.js. There is no SELECT
-- path at all, so no read is preserved. The parent ocr_documents is already correct;
-- these three children were the leak, and they carry the most sensitive columns.
ALTER TABLE public.ocr_national_ids         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_registration_books   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_customs_declarations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ocr_national_ids         FROM anon, authenticated;
REVOKE ALL ON TABLE public.ocr_registration_books   FROM anon, authenticated;
REVOKE ALL ON TABLE public.ocr_customs_declarations FROM anon, authenticated;

GRANT ALL ON TABLE public.ocr_national_ids         TO service_role;
GRANT ALL ON TABLE public.ocr_registration_books   TO service_role;
GRANT ALL ON TABLE public.ocr_customs_declarations TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B2c  OPERATIONAL / OBSERVABILITY — administrative, service-role only, no policy
-- ─────────────────────────────────────────────────────────────────────────────
-- Zero application references on origin/main. signature_verification_logs is
-- security-relevant: it records ECDSA verification outcomes and references public_keys.
ALTER TABLE public.signature_verification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_telemetry       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_failures             ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.signature_verification_logs FROM anon, authenticated;
REVOKE ALL ON TABLE public.performance_telemetry       FROM anon, authenticated;
REVOKE ALL ON TABLE public.system_failures             FROM anon, authenticated;

GRANT ALL ON TABLE public.signature_verification_logs TO service_role;
GRANT ALL ON TABLE public.performance_telemetry       TO service_role;
GRANT ALL ON TABLE public.system_failures             TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B2d-1  currency_rates — service-role only; the "public" rate read is an Express
--        surface (GET /api/payments/rates via the service-role client), NOT PostgREST
-- ─────────────────────────────────────────────────────────────────────────────
-- backend/services/payment/paymentRouter.js reads this into live payment computation
-- and into the escrow slippage guard. anon UPDATE on an FX rate is an integrity break.
-- No PostgREST consumer exists in web/, mobile/ or shared/, so no read is pre-granted.
ALTER TABLE public.currency_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.currency_rates FROM anon, authenticated;
GRANT ALL ON TABLE public.currency_rates TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B2d-2  evidence_class_taxonomy — THE ONE INTENTIONAL PUBLIC READ OF THE FOURTEEN
-- ─────────────────────────────────────────────────────────────────────────────
-- 20260621120000_vehicle_life_evidence_taxonomy_provenance.sql states it outright:
--   "-- Taxonomy is public catalog data."
--   GRANT SELECT ON TABLE evidence_class_taxonomy TO anon, authenticated;
-- That migration granted SELECT but never enabled RLS, so the default ACL's write bits
-- came along uninvited. Enabling RLS WITHOUT the policy in the same statement block
-- would silently return ZERO ROWS to a designed public surface — RLS-on with no
-- applicable policy is default-deny and does NOT error. The policy is therefore
-- mandatory here, and USING (true) preserves today's read behaviour exactly.
ALTER TABLE public.evidence_class_taxonomy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evidence_class_taxonomy FROM anon, authenticated;
GRANT SELECT ON TABLE public.evidence_class_taxonomy TO anon, authenticated;
GRANT ALL    ON TABLE public.evidence_class_taxonomy TO service_role;

DROP POLICY IF EXISTS evidence_class_taxonomy_public_read ON public.evidence_class_taxonomy;
CREATE POLICY evidence_class_taxonomy_public_read
  ON public.evidence_class_taxonomy
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- B2d-3  dealer_promotions — tenant-scoped, service-mediated, no policy
-- ─────────────────────────────────────────────────────────────────────────────
-- backend/routes/promotionsRoutes.js gates both routes with authorizeRole(['dealer',
-- 'admin']) and scopes by organization_id in application code, executed by the
-- service-role client. No PostgREST consumer exists, so no policy is created.
ALTER TABLE public.dealer_promotions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_promotions FROM anon, authenticated;
GRANT ALL ON TABLE public.dealer_promotions TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B3-P0  evidence_sources_public — close the write path and the owner-rights bypass
-- ─────────────────────────────────────────────────────────────────────────────
-- Measured: is_updatable=YES, is_insertable_into=YES, owner=postgres, security_invoker
-- NOT set, over base evidence_sources which has RLS ON and ZERO policies. The base
-- table's own migration already did the right thing —
--   ALTER TABLE evidence_sources ENABLE ROW LEVEL SECURITY;
--   REVOKE ALL ON TABLE evidence_sources FROM anon, authenticated;
--   GRANT SELECT ON evidence_sources_public TO anon, authenticated;
-- — but the view's DML bits arrived from the DEFAULT ACL, and because the view runs
-- with owner rights those writes are rewritten against the base table and are NOT
-- constrained by the base RLS (relforcerowsecurity is false). So the base protection
-- exists and is currently bypassable through the view.
--
-- REMEDY, in dependency order so no window of broken reads exists:
--   1. grant the caller exactly what the view projects, at the BASE table, so the read
--      keeps working once the view stops using owner rights. Column-level GRANT
--      reproduces the view's allowlist precisely: contact_reference and
--      credential_reference — the two columns the view exists to hide — are NOT granted
--      and remain unreachable even by a direct base-table query.
--   2. add the row policy that mirrors the view's own WHERE active = true.
--   3. flip the view to security_invoker so reads are evaluated AS THE CALLER and the
--      base-table RLS provably applies, instead of being bypassed.
--   4. strip every DML bit from the view and re-grant SELECT only.
-- Ordering matters: setting security_invoker BEFORE granting base access would make the
-- view silently return ZERO ROWS rather than error.

-- 1. base-table column allowlist, identical to the view's projection
GRANT SELECT (id, code, display_name, source_type, organization, country,
              verification_status, trust_tier, permitted_evidence_classes, active)
  ON TABLE public.evidence_sources TO anon, authenticated;
GRANT ALL ON TABLE public.evidence_sources TO service_role;

-- 2. row policy mirroring the view's WHERE clause
DROP POLICY IF EXISTS evidence_sources_public_read ON public.evidence_sources;
CREATE POLICY evidence_sources_public_read
  ON public.evidence_sources
  FOR SELECT TO anon, authenticated
  USING (active = true);

-- 3. reads now execute as the caller; base RLS applies
ALTER VIEW public.evidence_sources_public SET (security_invoker = true);

-- 4. read-only view surface
REVOKE ALL ON TABLE public.evidence_sources_public FROM anon, authenticated;
GRANT SELECT ON TABLE public.evidence_sources_public TO anon, authenticated;
GRANT ALL    ON TABLE public.evidence_sources_public TO service_role;

-- +migrate Down
-- Restoring the previous posture would re-open the exposures this migration exists to
-- close, so reversal is a DELIBERATE OPERATOR ACTION rather than an executable Down.
-- The reverse shape, for reference only:
--   ALTER VIEW public.evidence_sources_public RESET (security_invoker);
--   DROP POLICY IF EXISTS evidence_sources_public_read ON public.evidence_sources;
--   DROP POLICY IF EXISTS evidence_class_taxonomy_public_read ON public.evidence_class_taxonomy;
--   ALTER TABLE public.<each of the 14> DISABLE ROW LEVEL SECURITY;
--   GRANT ALL ON TABLE public.<each> TO anon, authenticated;   -- re-opens the exposure
-- Capture the pre-change grant matrix from the read-only inventory probe BEFORE applying,
-- and use that receipt as the rollback source of truth. Forward-fix is preferred: every
-- statement above is catalog-only and individually reversible with a targeted GRANT.
SELECT 1;
