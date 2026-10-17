-- +migrate Up
-- =============================================================
-- O2-X5A — concurrency-safe, ACTOR-SCOPED evidence upload idempotency.
-- (Ported by OC-5C from PR #208 20260908120000 as a CANDIDATE; Down added.)
--
-- NOT APPLIED ANYWHERE. This file lives in database/migration-candidates/, which no runner applies.
-- Promoting it into database/migrations (and applying it to staging, then production) is a separate
-- Product Owner decision. Until it is applied and verified on a deployment, database-enforced
-- concurrent deduplication is NOT in force there; sequential deduplication works through the
-- actor-scoped lookup, and the writer falls back to the pre-migration row shape (42703 only).
--
-- Why a database constraint: `withUploadIdempotency` is check-then-act (a per-process map, a lookup,
-- then an insert). Two concurrent first uploads by the same actor can both miss and both insert; a
-- lock cannot be held across those steps, so the database is the only place that race is settled.
--
-- THE KEY IS SCOPED TO THE ACTOR that supplied it — (uploaded_by, idempotency_key). The upload
-- endpoint accepts a CLIENT-supplied key, so a global namespace would let one actor's raw string
-- decide another's upload (#208 J-2 measured a second actor reusing "SHARED" being handed the first
-- actor's evidence id and VIN). CarUp's existing convention for a client-supplied key is already
-- scoped (diaspora_stock_ledger, diaspora_workbook_import_batches, diaspora_usage_reservation).
--
-- Additive: existing rows keep idempotency_key NULL, and the partial predicate leaves keyless uploads
-- unconstrained, so legitimate evidence history (many rows per vehicle, class, subtype) still
-- accumulates freely.
-- =============================================================

ALTER TABLE public.vehicle_evidence
  ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN public.vehicle_evidence.idempotency_key IS
  'Client-supplied upload key. (uploaded_by, idempotency_key) is unique so a retry by the same actor is de-duplicated, while another actor''s identical key is an independent namespace.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_evidence_idempotency_key
  ON public.vehicle_evidence (uploaded_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND uploaded_by IS NOT NULL;

-- +migrate Down
DROP INDEX IF EXISTS public.uq_vehicle_evidence_idempotency_key;
ALTER TABLE public.vehicle_evidence DROP COLUMN IF EXISTS idempotency_key;
