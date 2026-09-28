-- +migrate Up
-- Seller remediation Phase N: complete the explicitly planned Seller funnel with a governed
-- compare stage. This is a derived rollup field only; marketplace_activity_events remains the
-- event authority and the Seller projection remains service-mediated.
ALTER TABLE IF EXISTS public.seller_daily_metrics
  ADD COLUMN IF NOT EXISTS compare_adds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.seller_daily_metrics
  DROP CONSTRAINT IF EXISTS sdm_compare_adds_nonnegative;

ALTER TABLE IF EXISTS public.seller_daily_metrics
  ADD CONSTRAINT sdm_compare_adds_nonnegative CHECK (compare_adds >= 0);

-- +migrate Down
ALTER TABLE IF EXISTS public.seller_daily_metrics
  DROP CONSTRAINT IF EXISTS sdm_compare_adds_nonnegative,
  DROP COLUMN IF EXISTS compare_adds;
