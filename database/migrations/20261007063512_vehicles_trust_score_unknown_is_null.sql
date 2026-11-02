-- +migrate Up
-- =============================================================================
-- OC-5R-DB2B-4 — "UNKNOWN TRUST IS NOT 80"
-- Remove the schema default that manufactures a Trust score for a vehicle nobody has evaluated.
-- FORWARD-ONLY. SCHEMA-ONLY. NO EXISTING VALUE IS READ, REWRITTEN OR NULLED.
-- =============================================================================
--
-- THE DEFECT. public.vehicles.trust_score is `real NULL DEFAULT 80.0`. An INSERT that names no
-- trust_score stores 80.0, which at the column level is indistinguishable from an evaluation that
-- happened to return 80. Staging carried six such rows (no trust_calculation_version, no
-- trust_evaluated_at, no band, no history): the 80 was a schema artefact, not a judgement. Issue #164
-- deliberately left the default in place as an open finding, because removing it and rewriting rows
-- were never one decision. This file makes ONLY the first.
--
-- THE CONTRACT AFTER THIS MIGRATION.
--   unknown Trust          -> NULL (canonicalTrustService classifies a row without
--                             trust_calculation_version as `unversioned` and never publishes it)
--   canonical evaluation   -> numeric score + trust_calculation_version + trust_evaluated_at
-- backend/server.js already inserts an explicit `trust_score: null` for new listings; this removes the
-- last path by which an omitted column could still become 80.
--
-- WHAT IT REFUSES TO DO. It updates no row. Production may hold hand-set trust_score values that are the
-- only surviving copy of a human judgement (issue #164 §7), and a hand-set 80.0 without a provenance stamp
-- cannot be told apart from a default-generated one by any predicate over this table. Correcting a row is a
-- separate, record-pinned, environment-scoped act with its own receipt — never part of the shared lineage.
--
-- SAFETY. Metadata-only (no table rewrite). No view, trigger or function depends on the default and no test
-- asserts it. Re-running is harmless: dropping an absent default is a no-op.
ALTER TABLE public.vehicles
  ALTER COLUMN trust_score DROP DEFAULT;

DO $$
DECLARE
  v_default text;
  v_nullable text;
BEGIN
  SELECT coalesce(column_default, ''), is_nullable
    INTO v_default, v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'trust_score';
  IF v_default <> '' OR v_nullable <> 'YES' THEN
    RAISE EXCEPTION '[oc5r-db2b-4] vehicles.trust_score must be nullable with no default (default=%, nullable=%)',
      v_default, v_nullable USING ERRCODE = 'check_violation';
  END IF;
END
$$;

-- +migrate Down
ALTER TABLE public.vehicles
  ALTER COLUMN trust_score SET DEFAULT 80.0;
