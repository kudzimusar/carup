-- +migrate Up
-- =============================================================
-- O2 — concurrency-safe, ACTOR-SCOPED evidence upload idempotency.
--
-- `withUploadIdempotency` was check-then-act: an in-memory map, then a lookup, then an insert. Two
-- concurrent retries of the same workbook row could both miss and both insert, so the deduplication
-- proved SEQUENTIALLY was not a guarantee at a mutation boundary that receives concurrent retries.
-- A lock cannot be held across those steps; the database is the only place the race can be settled.
--
-- J-2 — THE KEY IS SCOPED TO THE ACTOR THAT SUPPLIED IT.
--
-- This index was first written as a bare UNIQUE (idempotency_key). The upload endpoint accepts a
-- CLIENT-supplied key, so a global collision domain let one actor's raw key decide another's
-- upload: measured on real PostgreSQL, a second actor reusing the string "SHARED" was told
-- `deduped: true` and handed the FIRST actor's evidence id and VIN, and three distinct legitimate
-- uploads collapsed to one row. A key that is unique in practice (the workbook mints
-- `workbook-evidence:<batch>:<row>:<index>`) does not make a global namespace safe — the contract
-- must be enforced here, not assumed of every present and future producer.
--
-- CarUp's own convention for a client/service supplied key is already SCOPED, and this now follows
-- it rather than diverging from the precedent it cites:
--   * diaspora_stock_ledger            (stock_item_id, idempotency_key)
--   * diaspora_workbook_import_batches (tenant_id, uploaded_by, idempotency_key)
--   * diaspora_usage_reservation       (tenant_id, feature_key, idempotency_key)
--
-- Scope = (uploaded_by, idempotency_key):
--   * the same actor retrying the same operation is deduplicated by the database;
--   * the same actor reusing one key for a DIFFERENT vehicle collides here, and the application
--     turns that into an explicit 409 rather than silently returning the other vehicle's evidence;
--   * a different actor's identical raw key is an independent namespace and suppresses nothing.
--
-- Additive: existing rows keep idempotency_key NULL and are unaffected, and the partial predicate
-- leaves ordinary keyless uploads unconstrained, so legitimate evidence history — many rows per
-- vehicle, per class, per subtype — still accumulates freely.
--
-- NOT APPLIED ANYWHERE BY THIS CLOSURE. No staging or production apply is performed or authorized
-- here; the apply is a separate, independently gated Product Owner decision. Until it is applied
-- and verified, database-enforced concurrent deduplication is NOT in force on any deployment.
-- =============================================================

ALTER TABLE public.vehicle_evidence
  ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN public.vehicle_evidence.idempotency_key IS
  'Client/service supplied upload key. (uploaded_by, idempotency_key) is unique so a retry by the same actor is de-duplicated, while another actor''s identical key is an independent namespace.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_evidence_idempotency_key
  ON public.vehicle_evidence (uploaded_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND uploaded_by IS NOT NULL;
