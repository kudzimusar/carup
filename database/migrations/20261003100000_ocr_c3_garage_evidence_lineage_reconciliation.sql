-- +migrate Up
-- OCR 1.0-C3 — reconcile the Garage evidence table with the C3 consumer, whichever lineage built it.
--
-- Two lineages create the same three Garage tables, both with CREATE TABLE IF NOT EXISTS:
--
--   PR #209 (GMO)   20260906090000 / 20260906120000 / 20260906200000
--   OCR 1.0-C3      20260918090000 / 20260918100000 / 20260918110000
--
-- Only C3's definition of garage_application_documents carries `extraction_model`. On any database
-- where the #209 lineage ran first — staging, per the GMO-8 receipt — C3's CREATE is a silent no-op,
-- the column never exists, and every C3 extraction write fails on it, including the OCR-off
-- `unavailable` path. Renaming or rewriting either historical migration would fork the ledger, so
-- this additive, idempotent migration converges BOTH lineages on the shape the consumer writes.
--
-- It also re-asserts the access posture, because which lineage ran decides which RLS migration ran:
-- #209's covers garage_invitations but not PUBLIC; C3's covers PUBLIC but not garage_invitations.
-- Every statement is idempotent, so applying this on either lineage, or on both, converges.

ALTER TABLE public.garage_application_documents ADD COLUMN IF NOT EXISTS extraction_model TEXT;

COMMENT ON COLUMN public.garage_application_documents.extraction_model IS
  'The model canonical Document Intelligence reported for this reading. NULL when no provider '
  'produced a reading (not attempted, unavailable, or a failure that reported none). Never filled '
  'in by the Garage consumer itself.';

ALTER TABLE public.garage_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.garage_application_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_application_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.garage_application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_application_documents FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.garage_applications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.garage_application_decisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.garage_application_documents FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.garage_applications TO service_role;
GRANT ALL ON public.garage_application_decisions TO service_role;
GRANT ALL ON public.garage_application_documents TO service_role;

-- +migrate Down
-- Deliberately a no-op. The Up is additive and idempotent, and its effects cannot be attributed to
-- it alone: on a C3-lineage database `extraction_model` was created by 20260918100000, and on a
-- #209-lineage database the table belongs to the GMO programme. Dropping the column here would
-- break every C3 extraction write, and re-granting browser privileges would reopen the tables this
-- programme closed. Reverting C3 means reverting its consumer code; the column is harmless without it.
SELECT 1;
