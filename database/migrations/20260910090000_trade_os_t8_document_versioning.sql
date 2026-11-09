-- +migrate Up
-- =============================================================
-- Trade OS T8.4 — replacing a document must never destroy the one it replaced.
--
-- There was no versioning at all: a corrected invoice could only be added as an unrelated second
-- row, or the first overwritten. Neither can answer the question an audit actually asks —
-- "what did we hold at the time?" — and the second destroys evidence.
--
-- The model is a LINEAGE, not an in-place edit. A replacement is a NEW row pointing back at the one
-- it supersedes; the superseded row keeps its own verification status, its reviewer, its timestamps
-- and its attribution, and is simply no longer current.
--
-- What this deliberately does NOT do: it does not carry a verification forward. If V1 was VERIFIED,
-- V2 starts UPLOADED like any other upload — a replacement is a new claim, and inheriting the
-- verdict of a document nobody has looked at is the presence→verified collapse wearing a new hat.
-- =============================================================

ALTER TABLE public.diaspora_trade_documents
  ADD COLUMN IF NOT EXISTS version                integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_document_id uuid    NULL REFERENCES public.diaspora_trade_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at          timestamptz NULL,
  ADD COLUMN IF NOT EXISTS superseded_by          text    NULL;

COMMENT ON COLUMN public.diaspora_trade_documents.version IS
  'T8.4 lineage position. 1 for an original; each replacement is its predecessor + 1.';
COMMENT ON COLUMN public.diaspora_trade_documents.supersedes_document_id IS
  'T8.4: the document THIS row replaces. NULL for an original.';
COMMENT ON COLUMN public.diaspora_trade_documents.superseded_at IS
  'T8.4: when this row stopped being current. NULL means CURRENT. The row itself is never edited '
  'or deleted when replaced — its verification, reviewer and timestamps stay exactly as they were.';

ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_no_self_supersede;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_no_self_supersede CHECK (
    supersedes_document_id IS NULL OR supersedes_document_id <> id
  );

ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_version_positive;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_version_positive CHECK (version >= 1);

-- A superseded row must say WHEN. "Replaced by someone, at some point" is not a lineage.
ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_supersession_dated;
ALTER TABLE public.diaspora_trade_documents
  ADD CONSTRAINT trade_document_supersession_dated CHECK (
    (superseded_at IS NULL AND superseded_by IS NULL) OR superseded_at IS NOT NULL
  );

-- Concurrency: two replacements racing for the same predecessor would both look current and the
-- lineage would fork. Exactly one row may claim to supersede any given document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_document_single_successor
  ON public.diaspora_trade_documents (supersedes_document_id)
  WHERE supersedes_document_id IS NOT NULL AND deleted_at IS NULL;

-- The common read: the CURRENT documents of one transaction.
CREATE INDEX IF NOT EXISTS idx_trade_documents_current
  ON public.diaspora_trade_documents (subject_type, subject_id)
  WHERE deleted_at IS NULL AND superseded_at IS NULL;

-- +migrate Down
DROP INDEX IF EXISTS public.idx_trade_documents_current;
DROP INDEX IF EXISTS public.uq_trade_document_single_successor;
ALTER TABLE public.diaspora_trade_documents
  DROP CONSTRAINT IF EXISTS trade_document_supersession_dated,
  DROP CONSTRAINT IF EXISTS trade_document_version_positive,
  DROP CONSTRAINT IF EXISTS trade_document_no_self_supersede;
ALTER TABLE public.diaspora_trade_documents
  DROP COLUMN IF EXISTS superseded_by,
  DROP COLUMN IF EXISTS superseded_at,
  DROP COLUMN IF EXISTS supersedes_document_id,
  DROP COLUMN IF EXISTS version;
