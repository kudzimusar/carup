-- +migrate Up
-- OC-5F (ported from PR #213 61341c23, 20260928133000) — the seller funnel's governed compare stage.
-- A derived rollup field only: marketplace_activity_events remains the event authority and the
-- Seller projection remains service-mediated. rollup@2 writes it; rollup@1 rows read it as 0.
--
-- Re-stamped into OC-5F's range: #213's stamp sorted ahead of 18 migrations already on this lineage
-- (OC-5 ports land after RC1's newest migration, in phase order).
--
-- OC-5F, beyond #213: the table is REQUIRED, not assumed. #213 wrote `ALTER TABLE IF EXISTS`, so on a
-- database without the Intelligence tables Up did nothing and raised nothing — and the production
-- runner records a migration's prefix as applied either way. A silent no-op recorded as applied is
-- how a later deploy of rollup@2 finds the column missing. So a missing table stops here, loudly.
-- (Staging already has this column: #213's gate applied the SQL directly, recording no ledger row.
-- Every statement below is idempotent.)

DO $oc5f_pre$
BEGIN
  IF to_regclass('public.seller_daily_metrics') IS NULL THEN
    RAISE EXCEPTION '[OC-5F] seller_daily_metrics is missing — apply the Intelligence rollup tables (20260827130000) first';
  END IF;
END
$oc5f_pre$;

ALTER TABLE public.seller_daily_metrics
  ADD COLUMN IF NOT EXISTS compare_adds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.seller_daily_metrics
  DROP CONSTRAINT IF EXISTS sdm_compare_adds_nonnegative;

ALTER TABLE public.seller_daily_metrics
  ADD CONSTRAINT sdm_compare_adds_nonnegative CHECK (compare_adds >= 0);

-- +migrate Down
ALTER TABLE IF EXISTS public.seller_daily_metrics
  DROP CONSTRAINT IF EXISTS sdm_compare_adds_nonnegative,
  DROP COLUMN IF EXISTS compare_adds;
