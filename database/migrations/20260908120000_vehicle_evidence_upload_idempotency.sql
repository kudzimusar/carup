-- +migrate Up
-- =============================================================
-- O2 H-round (G-5) — concurrency-safe evidence upload idempotency.
--
-- `withUploadIdempotency` was check-then-act: an in-memory map, then a metadata lookup, then an
-- insert. Two concurrent retries of the same workbook row could both miss and both insert, so the
-- deduplication that the F-round proved SEQUENTIALLY was not a guarantee at a mutation boundary
-- that can receive concurrent retries. A lock cannot be held across those steps; the database is
-- the only place the race can be settled.
--
-- Additive and scoped, following the existing repo precedent
-- (20260620120000_diaspora_phase3_stock_ledger_idempotency.sql):
--   * existing rows keep idempotency_key NULL and are unaffected;
--   * the partial unique index constrains ONLY rows that actually carry a key, so legitimate
--     evidence history — many rows per vehicle, per class, per subtype — stays unconstrained;
--   * the key is already unique per (batch, workbook row, evidence index), so no legitimate
--     distinct upload collides with another.
--
-- NOT APPLIED ANYWHERE BY THIS CLOSURE. No staging or production apply is performed or
-- authorized here; the apply is a separate, independently gated Product Owner decision.
-- =============================================================

ALTER TABLE public.vehicle_evidence
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- One evidence row per supplied key. Partial, so the ~all-NULL existing corpus is untouched and
-- ordinary uploads (which carry no key) can still repeat as often as the vehicle's history needs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_evidence_idempotency_key
  ON public.vehicle_evidence (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
