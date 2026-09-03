-- +migrate Up
-- O2-X5: Dealer onboarding extensions — additive only.
--
-- 1) dealer_compliance_documents gains EXTRACTION-CANDIDATE columns: what OCR proposed about a
--    company document, kept strictly separate from the document's compliance `status` (which
--    only recordDecision moves) and from dealer-profile truth (which only the dealer confirms).
--    The X2 law applies verbatim: machine candidates never become truth by themselves.
--
-- 2) dealer_workbook_mapping_confirmations — the human-confirmed semantic column mapping for a
--    dealer workbook, BOUND to the exact workbook bytes (checksum), template/sheet, user and
--    mapping version. A changed workbook produces a different checksum, so a stale confirmation
--    can never be silently reused. This complements (never replaces) the existing
--    diaspora_workbook_import_confirmations execution-token discipline.

ALTER TABLE dealer_compliance_documents
  ADD COLUMN IF NOT EXISTS extraction_candidates JSONB,
  ADD COLUMN IF NOT EXISTS extraction_provider TEXT,
  ADD COLUMN IF NOT EXISTS extraction_confidence NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.dealer_workbook_mapping_confirmations (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seq               bigserial NOT NULL,
  user_id           text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dealer_id         uuid NOT NULL REFERENCES dealer_profiles(id) ON DELETE CASCADE,
  template_type     text NOT NULL,
  sheet_name        text NOT NULL,
  workbook_checksum text NOT NULL,
  mapping           jsonb NOT NULL,
  mapping_version   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_workbook_mapping_confirmations_lookup
  ON public.dealer_workbook_mapping_confirmations (user_id, workbook_checksum, template_type, sheet_name, seq DESC);

COMMENT ON TABLE public.dealer_workbook_mapping_confirmations IS
  'Human-confirmed semantic column mappings for dealer workbook migration, bound to workbook checksum + template/sheet. Advisory-AI proposals never execute imports; the existing dry-run/confirm/execute chain remains the import authority.';

ALTER TABLE public.dealer_workbook_mapping_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_workbook_mapping_confirmations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.dealer_workbook_mapping_confirmations FROM anon, authenticated;
GRANT ALL ON public.dealer_workbook_mapping_confirmations TO service_role;

-- +migrate Down
DROP TABLE IF EXISTS public.dealer_workbook_mapping_confirmations;
ALTER TABLE dealer_compliance_documents
  DROP COLUMN IF EXISTS extracted_at,
  DROP COLUMN IF EXISTS extraction_confidence,
  DROP COLUMN IF EXISTS extraction_provider,
  DROP COLUMN IF EXISTS extraction_candidates;
