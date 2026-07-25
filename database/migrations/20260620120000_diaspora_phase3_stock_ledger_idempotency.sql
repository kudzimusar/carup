-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS Phase 3 — stock ledger idempotency
--
-- Additive, backwards-compatible. Adds an idempotency key to the existing
-- diaspora_stock_ledger so repeated movement submissions (UI retries, AI
-- command re-runs, workbook re-imports) do not duplicate ledger entries.
--
-- NOT applied to production by this program. Staging apply steps are listed in
-- the program PR. Existing rows keep idempotency_key NULL; the partial unique
-- index only constrains rows where a key is supplied.
-- =============================================================

ALTER TABLE public.diaspora_stock_ledger
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- One movement per (stock_item, idempotency_key) when a key is supplied.
CREATE UNIQUE INDEX IF NOT EXISTS idx_diaspora_stock_ledger_idempotency
  ON public.diaspora_stock_ledger (stock_item_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Helps balance/history queries per item ordered by time.
CREATE INDEX IF NOT EXISTS idx_diaspora_stock_ledger_item_time
  ON public.diaspora_stock_ledger (stock_item_id, created_at DESC);

COMMENT ON COLUMN public.diaspora_stock_ledger.idempotency_key IS
  'Client/service supplied key; (stock_item_id, idempotency_key) is unique so retried movements are de-duplicated.';

-- +migrate Down
-- Rollback / remediation notes:
--   Safe to drop the additive index and column. No data loss for stock balances,
--   which live on diaspora_stock_items and in the immutable ledger rows.
DROP INDEX IF EXISTS public.idx_diaspora_stock_ledger_idempotency;
DROP INDEX IF EXISTS public.idx_diaspora_stock_ledger_item_time;
ALTER TABLE public.diaspora_stock_ledger
  DROP COLUMN IF EXISTS idempotency_key;
