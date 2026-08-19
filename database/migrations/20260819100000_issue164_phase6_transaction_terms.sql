-- +migrate Up
-- =============================================================================
-- ISSUE #164 — PHASE 6 TRANSACTION LINEAGE + SERVER-RESOLVED LISTING TERMS
-- Extends the EXISTING escrow_trust_sessions authority; does not create a second payment model.
-- No backfill: historical sessions predate canonical inquiry/currency provenance.
-- UNAPPLIED until the single guarded staging cutover after Phase 6.
-- =============================================================================
DO $phase6_pre$
BEGIN
  IF to_regclass('public.escrow_trust_sessions') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] escrow_trust_sessions is absent; refusing competing authority';
  END IF;
  IF to_regclass('public.vehicles') IS NULL OR to_regclass('public.marketplace_inquiries') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] canonical vehicle/inquiry prerequisite is absent';
  END IF;
END
$phase6_pre$;

ALTER TABLE public.escrow_trust_sessions
  ADD COLUMN IF NOT EXISTS inquiry_id uuid,
  ADD COLUMN IF NOT EXISTS listing_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS listing_currency text,
  ADD COLUMN IF NOT EXISTS listing_currency_source text;

DO $phase6_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.escrow_trust_sessions'::regclass AND conname='escrow_trust_inquiry_id_fkey') THEN
    ALTER TABLE public.escrow_trust_sessions ADD CONSTRAINT escrow_trust_inquiry_id_fkey
      FOREIGN KEY (inquiry_id) REFERENCES public.marketplace_inquiries(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.escrow_trust_sessions'::regclass AND conname='escrow_trust_listing_amount_positive_chk') THEN
    ALTER TABLE public.escrow_trust_sessions ADD CONSTRAINT escrow_trust_listing_amount_positive_chk
      CHECK (listing_amount IS NULL OR listing_amount > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.escrow_trust_sessions'::regclass AND conname='escrow_trust_listing_currency_provenance_chk') THEN
    ALTER TABLE public.escrow_trust_sessions ADD CONSTRAINT escrow_trust_listing_currency_provenance_chk CHECK (
      (listing_currency IS NULL AND listing_currency_source IS NULL)
      OR (listing_currency IS NOT NULL AND btrim(listing_currency)<>'' AND listing_currency_source IS NOT NULL AND btrim(listing_currency_source)<>'')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.escrow_trust_sessions'::regclass AND conname='escrow_trust_marketplace_lineage_chk') THEN
    ALTER TABLE public.escrow_trust_sessions ADD CONSTRAINT escrow_trust_marketplace_lineage_chk CHECK (
      (inquiry_id IS NULL AND listing_amount IS NULL AND listing_currency IS NULL AND listing_currency_source IS NULL)
      OR (inquiry_id IS NOT NULL AND listing_amount IS NOT NULL AND listing_currency IS NOT NULL AND listing_currency_source IS NOT NULL)
    );
  END IF;
END
$phase6_constraints$;

COMMENT ON COLUMN public.escrow_trust_sessions.inquiry_id IS 'Canonical buyer-intent lineage for Marketplace transaction sessions; server resolved, never client-authored.';
COMMENT ON COLUMN public.escrow_trust_sessions.listing_amount IS 'Server-resolved listing amount snapshotted at transaction intent creation.';
COMMENT ON COLUMN public.escrow_trust_sessions.listing_currency IS 'Server-resolved listing currency; only valid with listing_currency_source.';
COMMENT ON COLUMN public.escrow_trust_sessions.listing_currency_source IS 'Canonical vehicles.currency_source copied at transaction-intent creation; never defaulted/backfilled.';

REVOKE INSERT, UPDATE, DELETE ON TABLE public.escrow_trust_sessions FROM anon, authenticated;
GRANT SELECT ON TABLE public.escrow_trust_sessions TO authenticated;

DO $phase6_post$
DECLARE v_defaults text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO v_defaults
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='escrow_trust_sessions'
     AND column_name IN ('inquiry_id','listing_amount','listing_currency','listing_currency_source')
     AND column_default IS NOT NULL;
  IF v_defaults IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p6] transaction lineage/term column(s) unexpectedly carry defaults: %', v_defaults;
  END IF;
END
$phase6_post$;

-- +migrate Down
-- Forward-only: reversal would discard transaction lineage/economics and requires a separately reviewed data migration.
