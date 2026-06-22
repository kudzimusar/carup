-- Harden the feature_rollout_overrides updated_at trigger function.
--
-- The Supabase security advisor flagged
-- public.feature_rollout_overrides_touch_updated_at() as having a MUTABLE
-- search_path (function-search-path-mutable). Pin it to a fixed, safe value so
-- the function cannot be influenced by a caller-controlled search_path.
--
-- Follow-up to 20260621120000_feature_rollout_overrides.sql — does NOT rewrite
-- the already-applied migration. Idempotent and order-safe: it only runs when
-- the function exists, and re-applying it is a no-op.
--
-- STAGING-ONLY application (project eoyenigwevnxwwhyhaer). Production must not
-- receive this without separate approval.

DO $$
BEGIN
  IF to_regprocedure('public.feature_rollout_overrides_touch_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.feature_rollout_overrides_touch_updated_at()
      SET search_path = public, pg_temp;
  END IF;
END $$;

-- ── Verification (run after applying; expect proconfig to contain the setting) ─
-- select proname, proconfig
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname = 'feature_rollout_overrides_touch_updated_at';
-- Expected proconfig: {"search_path=public, pg_temp"}
-- Then re-run the Supabase security advisor and confirm the
-- function-search-path-mutable notice for this function is cleared.
--
-- ── Rollback (manual) ─────────────────────────────────────────────────────────
-- ALTER FUNCTION public.feature_rollout_overrides_touch_updated_at() RESET search_path;
