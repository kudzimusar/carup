-- +migrate Up
-- OC-5R — no-synthetic truth defaults.
--
-- This migration changes FUTURE omission semantics only. It deliberately does not rewrite,
-- backfill, null, verify, or delete any historical trust value. Existing rows remain evidence for
-- the later provenance reconciliation; rows with no canonical provenance already remain
-- unpublished by canonicalTrustService.
--
-- A missing trust assessment means UNKNOWN, never 80 or 50.

DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'trust_score'
     ) THEN
    ALTER TABLE public.vehicles ALTER COLUMN trust_score DROP DEFAULT;
  END IF;

  IF to_regclass('public.diaspora_trade_profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'diaspora_trade_profiles' AND column_name = 'trust_score'
     ) THEN
    ALTER TABLE public.diaspora_trade_profiles ALTER COLUMN trust_score DROP DEFAULT;
    ALTER TABLE public.diaspora_trade_profiles ALTER COLUMN trust_score DROP NOT NULL;
  END IF;
END $$;

-- +migrate Down
-- Re-introducing fabricated trust defaults is intentionally unsupported.
-- Forward-only truth hardening.
