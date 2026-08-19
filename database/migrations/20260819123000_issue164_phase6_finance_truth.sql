-- +migrate Up
-- =============================================================================
-- ISSUE #164 PHASE 6A — FINANCE REQUEST / DECISION TRUTH
--
-- Historical finance rows may already contain auto-generated APR/payment decisions with no
-- provenance, so this migration does NOT pretend to backfill a lender source after the fact.
-- It makes APR/payment nullable for honest Pending requests and installs a forward trigger:
-- every NEW terminal lender decision must carry an attributable server-recorded source/time,
-- and Approved/Disbursed decisions must carry actual positive terms.
-- =============================================================================
DO $pre$
BEGIN
  IF to_regclass('public.finance_applications') IS NULL THEN
    RAISE NOTICE '[issue-164-p6] finance_applications absent; nothing to harden';
    RETURN;
  END IF;
END
$pre$;

ALTER TABLE public.finance_applications
  ALTER COLUMN monthly_payment DROP NOT NULL,
  ALTER COLUMN apr DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS requested_currency text,
  ADD COLUMN IF NOT EXISTS requested_currency_source text,
  ADD COLUMN IF NOT EXISTS decision_source text,
  ADD COLUMN IF NOT EXISTS decision_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.finance_applications'::regclass
       AND conname='finance_requested_currency_pair_chk'
  ) THEN
    ALTER TABLE public.finance_applications
      ADD CONSTRAINT finance_requested_currency_pair_chk CHECK (
        (requested_currency IS NULL AND requested_currency_source IS NULL)
        OR
        (nullif(btrim(requested_currency),'') IS NOT NULL
         AND nullif(btrim(requested_currency_source),'') IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.finance_applications'::regclass
       AND conname='finance_terms_positive_chk'
  ) THEN
    ALTER TABLE public.finance_applications
      ADD CONSTRAINT finance_terms_positive_chk CHECK (
        (monthly_payment IS NULL OR monthly_payment>0)
        AND (apr IS NULL OR apr>=0)
      );
  END IF;
END
$constraints$;

CREATE OR REPLACE FUNCTION public.issue164_finance_decision_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $guard$
DECLARE
  v_terminal boolean := NEW.status IN ('Approved','Rejected','Disbursed');
  v_new_decision boolean := TG_OP='INSERT'
    OR (TG_OP='UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND v_terminal);
BEGIN
  -- A requested amount is a user assertion, but its denomination comes from the governed listing.
  -- New Phase 6 writes must therefore persist the currency and its source together.
  IF TG_OP='INSERT' AND (
    nullif(btrim(NEW.requested_currency),'') IS NULL
    OR nullif(btrim(NEW.requested_currency_source),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'new finance request requires listing currency provenance' USING ERRCODE='23514';
  END IF;

  IF v_new_decision AND v_terminal THEN
    IF nullif(btrim(NEW.decision_source),'') IS NULL OR NEW.decision_recorded_at IS NULL THEN
      RAISE EXCEPTION 'terminal finance decision requires attributable decision source and time'
        USING ERRCODE='23514';
    END IF;
    IF NEW.status IN ('Approved','Disbursed')
       AND (NEW.monthly_payment IS NULL OR NEW.monthly_payment<=0 OR NEW.apr IS NULL OR NEW.apr<0) THEN
      RAISE EXCEPTION 'approved/disbursed finance decision requires real APR and monthly payment terms'
        USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN NEW;
END
$guard$;

DROP TRIGGER IF EXISTS issue164_finance_decision_guard_trg ON public.finance_applications;
CREATE TRIGGER issue164_finance_decision_guard_trg
BEFORE INSERT OR UPDATE ON public.finance_applications
FOR EACH ROW EXECUTE FUNCTION public.issue164_finance_decision_guard();

COMMENT ON COLUMN public.finance_applications.requested_currency IS
  'Listing currency captured with the applicant request; never silently defaulted.';
COMMENT ON COLUMN public.finance_applications.requested_currency_source IS
  'Canonical vehicles.currency_source copied with requested_currency.';
COMMENT ON COLUMN public.finance_applications.decision_source IS
  'Server-attributed lender/platform source for a terminal finance decision. Historical null means unknown, not implicitly approved by CarUp.';

-- +migrate Down
-- Forward-only. Historical/decision provenance is not discarded by rollback.
