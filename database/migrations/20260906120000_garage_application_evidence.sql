-- +migrate Up
-- GMO-2 — business-presence evidence for a garage application.
--
-- PO-2 item 9 asks for "at least one credible business-presence evidence source", and PO-2
-- explicitly forbids requiring formal company incorporation. So this catalogue is deliberately
-- broad: a Zimbabwe garage that has traded for fifteen years from a yard in Mbare may have a
-- council licence, or a lease, or only a photograph of its own signage. All of those are credible
-- presence signals. Which ones are good ENOUGH is the reviewer's judgment in GMO-3, not a schema
-- decision here.
--
-- OCR output lives on this row as CANDIDATES and nothing else. There is no column on this table
-- that can approve anything, and no column the application's status reads. That separation is the
-- point: extraction assists a person filling in a form, it never becomes authority.

CREATE TABLE IF NOT EXISTS public.garage_application_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.garage_applications(id) ON DELETE CASCADE,
  uploaded_by_user_id TEXT NOT NULL REFERENCES public.users(id),

  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'premises_photo',            -- the workshop itself
    'signage_photo',             -- the name board over the door
    'utility_bill',              -- a bill at the operating address
    'lease_or_title',            -- lease, rental agreement or title deed
    'council_or_trade_licence',  -- local authority / shop licence
    'company_registration',      -- PERMITTED, never required (PO-2)
    'tax_document',
    'bank_or_mobile_money_statement',
    'other'
  )),
  -- What the applicant says this is, when they choose 'other' or want to add context.
  description TEXT,

  file_ref TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),

  -- The six truthful extraction states. `not_attempted` and `unavailable` are DIFFERENT facts:
  -- one means nobody has tried, the other means CarUp cannot try. Collapsing them is how an
  -- applicant ends up believing the system rejected their document when it never read it.
  extraction_state TEXT NOT NULL DEFAULT 'not_attempted' CHECK (extraction_state IN (
    'not_attempted', 'unavailable', 'failed', 'low_confidence', 'awaiting_confirmation', 'confirmed'
  )),
  extraction_candidates JSONB,
  extraction_provider TEXT,
  extraction_confidence NUMERIC(4,3) CHECK (extraction_confidence IS NULL
    OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
  extracted_at TIMESTAMPTZ,
  -- Why extraction could not run or did not succeed, in words a person can act on.
  extraction_note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Withdrawing a wrong upload must not erase that it happened: a reviewer who saw a document
  -- yesterday needs to know it was pulled, not find a gap where their reasoning used to be.
  removed_at TIMESTAMPTZ,
  removed_by_user_id TEXT REFERENCES public.users(id),

  -- A state that names a provider result must carry the provider result.
  CONSTRAINT garage_application_documents_extraction_coherent CHECK (
    (extraction_state IN ('not_attempted', 'unavailable') AND extracted_at IS NULL)
    OR (extraction_state IN ('failed', 'low_confidence', 'awaiting_confirmation', 'confirmed')
        AND extracted_at IS NOT NULL)
  ),
  -- Candidates only exist where extraction actually produced some.
  CONSTRAINT garage_application_documents_candidates_need_extraction CHECK (
    extraction_candidates IS NULL
    OR extraction_state IN ('low_confidence', 'awaiting_confirmation', 'confirmed')
  ),
  CONSTRAINT garage_application_documents_removal_coherent CHECK (
    (removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_garage_application_documents_application
  ON public.garage_application_documents (application_id, created_at DESC);

-- The submission gate counts LIVE evidence, so the read that decides it must be cheap and exact.
CREATE INDEX IF NOT EXISTS idx_garage_application_documents_live
  ON public.garage_application_documents (application_id)
  WHERE removed_at IS NULL;

COMMENT ON TABLE public.garage_application_documents IS
  'GMO-2 business-presence evidence. Extraction output is candidate data for a human to confirm; '
  'no column here confers authority, and no status on garage_applications is derived from it.';
COMMENT ON COLUMN public.garage_application_documents.extraction_state IS
  'not_attempted | unavailable | failed | low_confidence | awaiting_confirmation | confirmed. '
  'OCR failure is never an application decision.';
