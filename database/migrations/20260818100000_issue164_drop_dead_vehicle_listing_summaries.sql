-- +migrate Up
-- =============================================================================
-- ISSUE #164 — CANONICAL VEHICLE TRUTH CLOSURE
-- Remove the dead second listing read model: public.vehicle_listing_summaries
-- =============================================================================
--
-- WHY IT GOES. The table was created by 20260603132036_marketplace_listing_summary_infra.sql
-- as a future materialized listing-card model. The refresh workers were deferred and never
-- written, so it has stood empty ever since while the live read path resolved listings from
-- public.vehicles. It is not merely unused — it is a SECOND declaration of the public listing
-- contract, carrying its own duty_cleared / cid_clear / passport_verified / plate_verified /
-- trust_score columns. Issue #164 exists because CarUp had several competing sources of vehicle
-- truth; leaving a dormant one in the schema invites a future writer to populate it and
-- reintroduce exactly the divergence this programme is closing.
--
-- It is also PUBLICLY READABLE (RLS policy "vehicle listing summaries public read", plus SELECT
-- granted to anon and authenticated), so a populated copy would publish a second, unreconciled
-- set of trust claims straight to anonymous callers.
--
-- MEASURED ON STAGING (ref eoyenigwevnxwwhyhaer, PostgreSQL 17.6) BEFORE AUTHORING:
--   rows 0 · dependent views 0 · inbound foreign keys 0 · triggers 0
--   own objects only: 1 RLS policy, 4 indexes, 1 outbound FK to vehicles(vin)
--
-- ---------------------------------------------------------------------------
-- FAIL-CLOSED BY CONSTRUCTION — this migration REFUSES rather than destroys.
-- ---------------------------------------------------------------------------
-- The product-owner decision is explicit: if a future preflight (production, or any database
-- that has diverged) finds rows or dependencies, STOP — do not delete them. Every guard below
-- therefore RAISEs, which aborts the runner's transaction and leaves the table exactly as it
-- was. A refusal here is a correct outcome, not a failure to be worked around: it means that
-- database has data or dependents this migration was never authorised to remove.
--
--   1. NO CASCADE. The DROP is plain (RESTRICT is the default), so if ANY object depends on the
--      table that the guards did not anticipate, PostgreSQL aborts instead of silently removing
--      the dependent. This is the last line of defence and it must never be relaxed to CASCADE.
--   2. ZERO ROWS. Any row at all aborts. Data is evidence; it is not this migration's to discard.
--   3. NO DEPENDENT VIEWS / FUNCTIONS / INBOUND FOREIGN KEYS.
--   4. NO APPLICATION REFERENCES. Not checkable from SQL — enforced by
--      backend/tests/issue164-dead-listing-summary.test.js, which fails the build if any code
--      path queries the table. See the note on the permission label below.
--   5. CANONICAL STAGING GUARD. Applying is gated by the runner/preflight, which positively
--      identifies the staging ref before this file is applied there. The guards above are what
--      make the file safe on ANY database, including production.
--
-- ON THE ONE NAME-LEVEL REFERENCE THAT REMAINS, deliberately left in place:
--   backend/services/trustGovernance/trustPermissionService.js:30 holds the STRING
--   'vehicle_listing_summaries_refresh' in SUMMARY_FACTS. That is a trust-fact PERMISSION LABEL,
--   not table access — no code reads or writes this relation. Dropping the table cannot break it.
--   The label is now debt (a permission to refresh something that does not exist); it is recorded
--   in the deletion ledger rather than removed here, because changing the governance permission
--   set is a separate reviewed change with its own blast radius.
--
-- Objects belonging TO the table (its policy, its 4 indexes, its outbound FK) are removed by
-- DROP TABLE itself. They are not dependents and do not require CASCADE.
-- =============================================================================

DO $issue164_drop_dead_summary$
DECLARE
  v_oid          oid;
  v_rows         bigint;
  v_views        text;
  v_inbound_fks  text;
  v_functions    text;
BEGIN
  v_oid := to_regclass('public.vehicle_listing_summaries');

  -- Absent already (fresh database, or a prior apply): nothing to do, and nothing to refuse.
  IF v_oid IS NULL THEN
    RAISE NOTICE '[issue-164] public.vehicle_listing_summaries is absent; nothing to drop.';
    RETURN;
  END IF;

  -- GUARD 2 — zero rows. Counted, not estimated: pg_class.reltuples is a planner statistic and
  -- can read 0 for a populated table that has not been analysed.
  EXECUTE 'SELECT count(*) FROM public.vehicle_listing_summaries' INTO v_rows;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      '[issue-164] REFUSING to drop public.vehicle_listing_summaries: % row(s) present. '
      'The decision is to stop, not to delete data. Reconcile those rows against the canonical '
      'listing read model first, then re-run.', v_rows;
  END IF;

  -- GUARD 3a — dependent views (including materialized views).
  SELECT string_agg(DISTINCT dependent.relname, ', ' ORDER BY dependent.relname)
    INTO v_views
    FROM pg_depend d
    JOIN pg_rewrite r  ON r.oid = d.objid
    JOIN pg_class dependent ON dependent.oid = r.ev_class
   WHERE d.refobjid = v_oid
     AND d.refclassid = 'pg_class'::regclass
     AND dependent.oid <> v_oid;

  IF v_views IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-164] REFUSING to drop public.vehicle_listing_summaries: dependent view(s) exist: %. '
      'Removing them implicitly is not authorised; stop and reconcile instead.', v_views;
  END IF;

  -- GUARD 3b — inbound foreign keys (another table pointing AT this one). Outbound FKs are the
  -- table's own and are removed with it.
  SELECT string_agg(conrelid::regclass::text || '.' || conname, ', ' ORDER BY conrelid::regclass::text || '.' || conname)
    INTO v_inbound_fks
    FROM pg_constraint
   WHERE confrelid = v_oid;

  IF v_inbound_fks IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-164] REFUSING to drop public.vehicle_listing_summaries: inbound foreign key(s) reference it: %. '
      'Rows elsewhere depend on this relation.', v_inbound_fks;
  END IF;

  -- GUARD 3c — functions/procedures naming the table in their body. Advisory by nature (a
  -- function body is text and PostgreSQL records no hard dependency on it), which is exactly why
  -- it must refuse rather than warn: a governed job that refreshes this table would live here.
  SELECT string_agg(DISTINCT p.oid::regprocedure::text, ', ')
    INTO v_functions
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prokind IN ('f', 'p')
     AND p.prosrc ILIKE '%vehicle_listing_summaries%';

  IF v_functions IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-164] REFUSING to drop public.vehicle_listing_summaries: routine(s) reference it: %. '
      'Retire the routine first.', v_functions;
  END IF;

  -- All guards satisfied. NO CASCADE: if anything unanticipated still depends on the table,
  -- PostgreSQL aborts here and the transaction rolls back with the table intact.
  EXECUTE 'DROP TABLE public.vehicle_listing_summaries';

  RAISE NOTICE '[issue-164] dropped public.vehicle_listing_summaries (0 rows, no dependents).';
END
$issue164_drop_dead_summary$;

-- Postcondition: prove the relation is gone. If DROP silently did nothing the migration must not
-- report success.
DO $issue164_drop_dead_summary_verify$
BEGIN
  IF to_regclass('public.vehicle_listing_summaries') IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164] postcondition failed: public.vehicle_listing_summaries still exists.';
  END IF;
END
$issue164_drop_dead_summary_verify$;

-- +migrate Down
-- Deliberately NOT executable.
--
-- Recreating the table would restore a second, publicly-readable declaration of the listing
-- contract — the divergence this migration exists to remove — and it would come back EMPTY, so a
-- rollback restores the shape without restoring any data (there was none). The forward-only
-- reversal, if the materialized read model is ever genuinely wanted, is a NEW migration that
-- creates it deliberately alongside the refresh workers that were never written, derived from the
-- canonical fact model rather than carrying its own duplicate boolean columns.
--
-- The original definition is preserved in 20260603132036_marketplace_listing_summary_infra.sql.
SELECT 1;
