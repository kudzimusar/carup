-- ============================================================================
-- user_sessions — align with the token-based auth contract the backend requires
-- ----------------------------------------------------------------------------
-- BLOCKER (staging project eoyenigwevnxwwhyhaer): public.user_sessions has the legacy
-- 003-era columns
--   id, user_id, active_role, active_organization_id, created_at, expires_at,
--   ip_address, user_agent
-- but is MISSING `token` and `is_valid`. backend/services/auth/sessionRow.js
-- (buildSessionRow) always writes both, and backend/middleware/authMiddleware.js looks
-- sessions up by `token` and checks `is_valid`. So POST /api/auth/login reaches credential
-- validation and then returns HTTP 500 ("Could not establish a session. Please try again.")
-- because the INSERT references columns that do not exist.
--
-- AUTHORITATIVE CONTRACT (what the current backend reads/writes):
--   token     TEXT     -- session lookup key (.eq('token', ...)); unique per issued token
--   is_valid  BOOLEAN  -- default true; set false on logout/invalidation
--   + the legacy columns above (buildSessionRow always populates id/active_role/created_at/expires_at)
--
-- This migration is IDEMPOTENT (safe to re-run) and NON-DESTRUCTIVE (no table rebuild, no data
-- loss, no DROP of the table or of the legacy/token columns). It only ADDs the missing columns,
-- a token uniqueness/index, and defensive defaults.
--
-- APPLY PER-ENVIRONMENT (review first): apply to STAGING now via the Supabase SQL editor or
--   psql "$SUPABASE_DB_URL" -f database/migrations/20260617120000_user_sessions_auth_contract_align.sql
-- Apply to production ONLY through the normal migration process. This file hardcodes no
-- connection string and references no specific project — it touches whichever DB it is run against.
--
-- ROLLBACK (only if required — drops just the objects this migration adds; never the table,
-- never the legacy columns, never session data beyond the two added columns):
--   DROP INDEX IF EXISTS uq_user_sessions_token;
--   ALTER TABLE public.user_sessions DROP COLUMN IF EXISTS is_valid;
--   ALTER TABLE public.user_sessions DROP COLUMN IF EXISTS token;
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Fresh databases get a complete, contract-correct table. On the existing staging table this is a
-- no-op (IF NOT EXISTS), and the ALTERs below add the two missing columns.
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_role            TEXT,
  active_organization_id TEXT,
  token                  TEXT,
  is_valid               BOOLEAN DEFAULT true,
  ip_address             TEXT,
  user_agent             TEXT,
  created_at             TEXT NOT NULL DEFAULT now()::text,
  expires_at             TEXT NOT NULL
);

-- 1) Add the token + is_valid columns if missing (additive; existing rows/data untouched).
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS is_valid BOOLEAN DEFAULT true;

-- 2) Ensure is_valid defaults to true even if the column pre-existed without a default.
ALTER TABLE public.user_sessions ALTER COLUMN is_valid SET DEFAULT true;

-- 3) Backfill existing rows. Legacy rows have no token (unreachable by the token lookup), so never
--    fabricate one; only set is_valid where it is NULL (true when a token exists, false otherwise).
UPDATE public.user_sessions
   SET is_valid = COALESCE(is_valid, (token IS NOT NULL))
 WHERE is_valid IS NULL;

-- 4) Defensive defaults for the legacy NOT NULL columns, so any writer that omits them still inserts
--    cleanly (buildSessionRow always provides them; this only adds a default when one is ABSENT and
--    never alters a column that already has a default or any existing data/type).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_sessions'
               AND column_name = 'id' AND column_default IS NULL) THEN
    ALTER TABLE public.user_sessions ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_sessions'
               AND column_name = 'created_at' AND column_default IS NULL AND data_type = 'text') THEN
    ALTER TABLE public.user_sessions ALTER COLUMN created_at SET DEFAULT now()::text;
  END IF;
END $$;

-- 5) Token uniqueness + lookup index. Partial (WHERE token IS NOT NULL) so legacy tokenless rows
--    coexist, while every issued token is unique and indexed for the .eq('token', ...) hot path.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_token
  ON public.user_sessions (token) WHERE token IS NOT NULL;
