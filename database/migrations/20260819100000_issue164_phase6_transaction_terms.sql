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

-- Transaction rows and their audit/provider-event rows contain counterparties, economics and provider
-- lineage. CarUp does not mint a Supabase JWT for browser callers; participant reads are backend
-- service-role projections. Close every historical direct browser grant at the FIRST Phase 6
-- migration, not several migrations later. The event tables are conditional here because reduced
-- migration harnesses may omit them; staging's historical schema contains both.
REVOKE ALL ON TABLE public.escrow_trust_sessions FROM anon, authenticated;
GRANT ALL ON TABLE public.escrow_trust_sessions TO service_role;

DO $phase6_transaction_grants$
BEGIN
  IF to_regclass('public.escrow_trust_events') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.escrow_trust_events FROM anon, authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.escrow_trust_events TO service_role';
  END IF;
  IF to_regclass('public.escrow_trust_webhook_events') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.escrow_trust_webhook_events FROM anon, authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.escrow_trust_webhook_events TO service_role';
  END IF;
END
$phase6_transaction_grants$;

DO $phase6_post$
DECLARE
  v_defaults text;
  v_direct_grants text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO v_defaults
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='escrow_trust_sessions'
     AND column_name IN ('inquiry_id','listing_amount','listing_currency','listing_currency_source')
     AND column_default IS NOT NULL;
  IF v_defaults IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p6] transaction lineage/term column(s) unexpectedly carry defaults: %', v_defaults;
  END IF;

  SELECT string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ' ORDER BY table_name,grantee,privilege_type)
    INTO v_direct_grants
    FROM information_schema.role_table_grants
   WHERE table_schema='public'
     AND table_name IN ('escrow_trust_sessions','escrow_trust_events','escrow_trust_webhook_events')
     AND grantee IN ('anon','authenticated');
  IF v_direct_grants IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p6] direct transaction-table grants remain: %',v_direct_grants;
  END IF;
END
$phase6_post$;

-- +migrate Down
-- Forward-only: reversal would discard transaction lineage/economics and requires a separately reviewed data migration.
