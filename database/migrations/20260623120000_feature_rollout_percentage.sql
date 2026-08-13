-- +migrate Up
-- Feature governance: deterministic percentage rollout (Milestone G).
--
-- Adds a percentage gate to the runtime rollout overrides so a feature can be
-- exposed to a deterministic, stable fraction of subjects (per feature, per
-- environment) — not per-request randomness. Bucketing is computed SERVER-SIDE
-- from a stable subject id + an optional rotation seed; this migration only
-- persists the two knobs the service reads.
--
--  • rollout_percentage SMALLINT 0–100, DEFAULT 100. Existing rows default to
--    100 (FULL rollout) → NO behavior change on apply: every current override
--    keeps exposing the feature to everyone who already passes role/tenant.
--  • rollout_seed TEXT, NULL by default. Rotating it reshuffles which subjects
--    land in the rollout (used to re-randomise a cohort). Bounded length so the
--    hash input cannot be abused.
--
-- ADDITIVE and REVERSIBLE: only ADD COLUMN IF NOT EXISTS + guarded CHECKs; the
-- existing table, RLS, grants and trigger are untouched. Idempotent and safe to
-- apply more than once.
--
-- STAGING-ONLY until Product Owner approves a production apply (project
-- eoyenigwevnxwwhyhaer). Production must NOT receive this without separate
-- approval. See NAVIGATION_BLUEPRINT_ROLLBACK_RUNBOOK.md.

ALTER TABLE feature_rollout_overrides
  ADD COLUMN IF NOT EXISTS rollout_percentage SMALLINT NOT NULL DEFAULT 100;

ALTER TABLE feature_rollout_overrides
  ADD COLUMN IF NOT EXISTS rollout_seed TEXT;

-- Guarded so re-apply is safe: only add a CHECK constraint that is not already
-- present (ADD CONSTRAINT is not IF NOT EXISTS-aware across PG versions).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feature_rollout_overrides_percentage_valid'
  ) THEN
    ALTER TABLE feature_rollout_overrides
      ADD CONSTRAINT feature_rollout_overrides_percentage_valid
        CHECK (rollout_percentage BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feature_rollout_overrides_seed_len_valid'
  ) THEN
    ALTER TABLE feature_rollout_overrides
      ADD CONSTRAINT feature_rollout_overrides_seed_len_valid
        CHECK (rollout_seed IS NULL OR char_length(rollout_seed) <= 64);
  END IF;
END $$;

-- ── Verification (run after applying) ────────────────────────────────────────
-- select column_name, data_type, column_default
--   from information_schema.columns
--   where table_name = 'feature_rollout_overrides'
--     and column_name in ('rollout_percentage', 'rollout_seed');
-- Expected: rollout_percentage smallint DEFAULT 100; rollout_seed text (nullable).

-- ── Rollback (manual; see runbook) ───────────────────────────────────────────
-- ALTER TABLE feature_rollout_overrides DROP CONSTRAINT IF EXISTS feature_rollout_overrides_seed_len_valid;
-- ALTER TABLE feature_rollout_overrides DROP CONSTRAINT IF EXISTS feature_rollout_overrides_percentage_valid;
-- ALTER TABLE feature_rollout_overrides DROP COLUMN IF EXISTS rollout_seed;
-- ALTER TABLE feature_rollout_overrides DROP COLUMN IF EXISTS rollout_percentage;
