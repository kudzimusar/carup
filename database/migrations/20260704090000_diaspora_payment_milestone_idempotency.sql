-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — payment milestone idempotency
--
-- Additive, backwards-compatible. Adds an idempotency key to the existing
-- diaspora_payment_milestones table so repeated milestone-creation submissions
-- (UI retries, double form submits) do not duplicate a financial milestone
-- row for the same import order. Mirrors the diaspora_stock_ledger
-- idempotency pattern (20260620120000).
--
-- NOT applied to production by this program. Not yet applied to staging
-- either: the Supabase MCP connector available this loop is scoped to an
-- unrelated project (see DIASPORA_TRADE_OS_FINAL_COMPLETION_GOAL_LOOP.md,
-- EB-1) and cannot reach carup-staging (eoyenigwevnxwwhyhaer). Apply steps
-- are listed in the program PR once EB-1 is resolved.
-- =============================================================

ALTER TABLE public.diaspora_payment_milestones
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- One milestone per (import_order_id, idempotency_key) when a key is supplied.
CREATE UNIQUE INDEX IF NOT EXISTS idx_diaspora_payment_milestones_idempotency
  ON public.diaspora_payment_milestones (import_order_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.diaspora_payment_milestones.idempotency_key IS
  'Client/service supplied key; (import_order_id, idempotency_key) is unique so retried milestone creations are de-duplicated.';

-- +migrate Down
-- Rollback / remediation notes:
--   Safe to drop the additive index and column. No data loss for existing
--   milestone rows, which are unaffected (idempotency_key stays NULL for them).
DROP INDEX IF EXISTS public.idx_diaspora_payment_milestones_idempotency;
ALTER TABLE public.diaspora_payment_milestones
  DROP COLUMN IF EXISTS idempotency_key;
