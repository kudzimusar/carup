-- +migrate Up
-- O2-X5 (ported by OC-5C from PR #208 20260903220000, re-timestamped into the OC-5C range) —
-- dealer_workbook_mapping_confirmations: the human-confirmed semantic column mapping for a dealer
-- workbook, BOUND to the exact workbook bytes (checksum), template/sheet, user and mapping version. A
-- changed workbook produces a different checksum, so a stale confirmation can never be silently
-- reused. This complements (never replaces) the existing diaspora workbook confirmation/execution
-- discipline: the dry run, its blockers and the confirm/execute chain remain the import authority.
--
-- Not ported: #208's extraction-candidate columns on dealer_compliance_documents — company-document
-- OCR is deferred on this lineage, so nothing would write them.
-- References are RESTRICT, not CASCADE: a confirmation is the record of what a person approved for an
-- import, and history is not erased by deleting its subject (the X3 identity-history decision).

CREATE TABLE IF NOT EXISTS public.dealer_workbook_mapping_confirmations (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seq               bigserial NOT NULL,
  user_id           text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  dealer_id         uuid NOT NULL REFERENCES public.dealer_profiles(id) ON DELETE RESTRICT,
  template_type     text NOT NULL,
  sheet_name        text NOT NULL,
  workbook_checksum text NOT NULL CHECK (workbook_checksum ~ '^[0-9a-f]{64}$'),
  mapping           jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'array'),
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
