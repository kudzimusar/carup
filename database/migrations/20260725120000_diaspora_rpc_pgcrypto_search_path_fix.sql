-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — pgcrypto search_path fix for the atomic RPCs (compensating, additive).
--
-- The atomic mutation RPCs (H1 stock movement, H2 quote acceptance, H3 container approval, and the
-- SafeTrade transition/milestone RPCs) compute an integrity seal with `encode(digest(..., 'sha256'),
-- 'hex')`. `digest()` comes from the pgcrypto extension. On Supabase, pgcrypto is installed in the
-- `extensions` schema (NOT `public`), but these functions pin `search_path = public[, pg_temp]`, so
-- `digest()` cannot be resolved and every call fails with SQLSTATE 42883
-- ("function digest(text, unknown) does not exist"). This only surfaced on the real staging database:
-- the embedded-Postgres proof harnesses install pgcrypto into `public`, where the bare name resolves.
--
-- The migrations that created these functions (#7/#8/#9/#13) are already applied to staging, so this
-- does NOT edit their bytes. It additively re-pins each function's search_path to include `extensions`
-- (a trusted, Supabase-managed schema; a non-existent `extensions` schema on vanilla Postgres is
-- simply ignored, so this is safe everywhere). Function bodies are unchanged; the service_role-only
-- EXECUTE posture from #11 is preserved (ALTER ... SET search_path does not touch ACLs).
-- =============================================================

DO $pgcrypto_fix$
DECLARE
  r record;
  fns text[] := ARRAY[
    'diaspora_append_stock_movement_atomic',
    'diaspora_accept_quote_atomic',
    'diaspora_approve_cargo_reservation_atomic',
    'diaspora_safetrade_transition_atomic',
    'diaspora_safetrade_record_milestone_atomic'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(fns)
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', r.sig);
  END LOOP;
END
$pgcrypto_fix$;

-- +migrate Down
-- Reversing would restore the broken search_path (RPCs would fail on Supabase). Intentionally no
-- destructive down (mirrors the hardening-migration convention); restore-from-backup if ever needed.
