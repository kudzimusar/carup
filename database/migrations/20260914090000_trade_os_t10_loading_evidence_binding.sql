-- +migrate Up
-- =============================================================
-- Trade OS T10.5 — loading evidence goes through T8, like everything else.
--
-- A photo of a packed container, a seal close-up, a signed loading sheet: each is a DOCUMENT. It has
-- an uploader, a time, bytes in governed storage, and a verification state that must stay separate
-- from its existence. T8 owns all of that, and T8.1's generic subject binding exists so a new
-- authoritative object can own documents without a new table. T9.5 added `warehouse_intake` the same
-- way; this adds `container_load`.
--
-- One value. No table, no column, no store, no second upload path. The alternative — `loading_photos`
-- — would fork evidence into a place where "presence is not verification" is not enforced.
--
-- The direction stays one-way and load-bearing:
--
--     the photo SUPPORTS the loaded fact. The photo does not CREATE it.
--
-- A load item is complete and true with no image attached, and an image attached to a load proves
-- only that somebody uploaded a file. A container with forty photos and no attributed load line has
-- not been loaded.
-- =============================================================

ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_subject_vocabulary;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_subject_vocabulary CHECK (
    subject_type IS NULL OR subject_type IN (
      'import_order', 'logistics_request', 'container_booking', 'trade_order',
      'warehouse_intake', 'container_load'
    )
  );

COMMENT ON CONSTRAINT trade_document_subject_vocabulary ON public.diaspora_trade_documents IS
  'T8.1 governed subject vocabulary, extended by T9.5 (warehouse_intake) and T10.5 (container_load). '
  'Bounded on purpose: a free-text subject_type is how a shadow entity gets invented later without '
  'anybody deciding to.';

-- +migrate Down
ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_subject_vocabulary;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_subject_vocabulary CHECK (
    subject_type IS NULL OR subject_type IN (
      'import_order', 'logistics_request', 'container_booking', 'trade_order', 'warehouse_intake'
    )
  );
