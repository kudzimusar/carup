-- +migrate Up
-- =============================================================
-- Trade OS T9.5 — warehouse intake evidence goes through T8, not around it.
--
-- A condition photo taken at the receiving bay is a DOCUMENT. It has an uploader, a time, bytes in
-- governed storage, and a verification state that must stay separate from its existence. T8 already
-- owns all of that, and T8.1 built the generic subject binding precisely so a new authoritative
-- object could own documents without a new table.
--
-- So this migration adds ONE value to the governed subject vocabulary. It creates no table, no
-- column, no store, and no second upload path. The alternative — `warehouse_photos` — would have
-- forked evidence into a place where "presence is not verification" is not enforced, which is the
-- exact failure T8 exists to prevent.
--
-- The direction stays one-way and load-bearing:
--
--     the photo SUPPORTS the receiver's observation. The photo does not CREATE it.
--
-- An intake row is complete and true with no image attached, and an image attached to an intake
-- proves only that somebody uploaded a file.
-- =============================================================

ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_subject_vocabulary;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_subject_vocabulary CHECK (
    subject_type IS NULL OR subject_type IN (
      'import_order', 'logistics_request', 'container_booking', 'trade_order', 'warehouse_intake'
    )
  );

COMMENT ON CONSTRAINT trade_document_subject_vocabulary ON public.diaspora_trade_documents IS
  'T8.1 governed subject vocabulary, extended by T9.5 with warehouse_intake. Bounded on purpose: a '
  'free-text subject_type is how a shadow entity gets invented later without anybody deciding to.';

-- +migrate Down
ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_subject_vocabulary;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_subject_vocabulary CHECK (
    subject_type IS NULL OR subject_type IN (
      'import_order', 'logistics_request', 'container_booking', 'trade_order'
    )
  );
