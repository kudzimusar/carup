-- +migrate Up
-- =============================================================
-- Trade OS T8.1 — a document may belong to any authoritative Trade OS object, not only a purchase.
--
-- The T8.0 audit found the RECORD is the only layer that never generalised. `diaspora_drive_files`
-- already carries `linked_entity_type`/`linked_entity_id`, and `diaspora_trade_document_readiness`
-- already carries `subject_type`/`subject_id` — for the very same domain — while
-- `diaspora_trade_documents` binds to `import_order_id` and nothing else. So a logistics request, a
-- container sailing or a Trade Order could not own a document at all.
--
-- This is ADDITIVE and reversible. Nothing is rewritten: existing procurement rows keep
-- `import_order_id`, and the new binding is nullable. No document is reclassified, no verification
-- is touched, and no history is destroyed.
--
-- What this migration deliberately does NOT do: it does not make any document verified, does not
-- create a checklist, and does not let a file's existence stand for a business fact. Presence and
-- verification remain separate authorities (`diaspora_trade_document_verifications`).
-- =============================================================

ALTER TABLE public.diaspora_trade_documents
  ADD COLUMN IF NOT EXISTS subject_type text NULL,
  ADD COLUMN IF NOT EXISTS subject_id   text NULL;

COMMENT ON COLUMN public.diaspora_trade_documents.subject_type IS
  'T8.1 generic binding: which KIND of authoritative Trade OS object owns this document. Paired '
  'with subject_id. Mutually exclusive with the legacy import_order_id, which procurement rows keep.';
COMMENT ON COLUMN public.diaspora_trade_documents.subject_id IS
  'T8.1 generic binding: the id of the owning object. Text rather than a FK because the owner may '
  'live in any of several authoritative tables; the owning service resolves and authorizes it.';

-- A subject is a PAIR or it is nothing. A type without an id points at every object of that kind,
-- which is not a binding at all.
ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_subject_pairing;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_subject_pairing CHECK (
    (subject_type IS NULL AND subject_id IS NULL)
    OR (subject_type IS NOT NULL AND subject_id IS NOT NULL AND length(btrim(subject_id)) > 0)
  );

-- EXACTLY ONE owner. A document belonging to two things belongs to neither, and the ambiguity would
-- surface later as a document appearing in a workspace it has no business in.
ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_exactly_one_owner;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_exactly_one_owner CHECK (
    num_nonnulls(import_order_id, subject_type) = 1
  );

-- The governed subject vocabulary. Bounded on purpose: a free-text subject_type is how a shadow
-- entity gets invented later without anybody deciding to.
ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_subject_vocabulary;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_subject_vocabulary CHECK (
    subject_type IS NULL OR subject_type IN (
      'import_order', 'logistics_request', 'container_booking', 'trade_order'
    )
  );

CREATE INDEX IF NOT EXISTS idx_trade_documents_subject
  ON public.diaspora_trade_documents (subject_type, subject_id)
  WHERE deleted_at IS NULL AND subject_type IS NOT NULL;

-- Readiness already generalises; its service restricted the vocabulary to two subjects. Container
-- bookings are a real transaction a participant can be asked for a document about.
COMMENT ON COLUMN public.diaspora_trade_document_readiness.subject_type IS
  'T8.1: import_order | logistics_request | container_booking | trade_order.';

-- +migrate Down
DROP INDEX IF EXISTS public.idx_trade_documents_subject;
ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_subject_vocabulary,
  DROP CONSTRAINT IF EXISTS trade_document_exactly_one_owner,
  DROP CONSTRAINT IF EXISTS trade_document_subject_pairing;
ALTER TABLE public.diaspora_trade_documents
  DROP COLUMN IF EXISTS subject_id,
  DROP COLUMN IF EXISTS subject_type;
