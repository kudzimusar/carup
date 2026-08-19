-- +migrate Up
-- =============================================================================
-- ISSUE #164 — CANONICAL VEHICLE TRUTH CLOSURE, PHASE 6
-- Persist the server-resolved listing economics on the EXISTING escrow_trust_sessions
-- transaction authority. This is not a new payment system.
--
-- No backfill is permitted. Existing sessions predate the canonical Phase 4 currency
-- provenance contract, so manufacturing terms for them would turn an old raw value into
-- a new money instruction. New Marketplace sessions are written only after the server
-- resolves a positive listing price and a provenance-backed currency.
--
-- UNAPPLIED until the single guarded Issue #164 staging cutover after Phase 6.
-- =============================================================================

DO $phase6_pre$
BEGIN
  IF to_regclass('public.escrow_trust_sessions') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] escrow_trust_sessions is absent; refusing to create a competing transaction model';
  END IF;
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE EXCEPTION '[issue-164-p6] vehicles is absent';
  END IF;
END
$phase6_pre$;

ALTER TABLE public.escrow_trust_sessions
  ADD COLUMN IF NOT EXISTS listing_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS listing_currency text,
  ADD COLUMN IF NOT EXISTS listing_currency_source text;

DO $phase6_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.escrow_trust_sessions'::regclass
       AND conname = 'escrow_trust_listing_amount_positive_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_listing_amount_positive_chk
      CHECK (listing_amount IS NULL OR listing_amount > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.escrow_trust_sessions'::regclass
       AND conname = 'escrow_trust_listing_currency_provenance_chk'
  ) THEN
    ALTER TABLE public.escrow_trust_sessions
      ADD CONSTRAINT escrow_trust_listing_currency_provenance_chk
      CHECK (
        (listing_currency IS NULL AND listing_currency_source IS NULL)
        OR
        (listing_currency IS NOT NULL
         AND btrim(listing_currency) <> ''
         AND listing_currency_source IS NOT NULL
         AND btrim(listing_currency_source) <> '')
      );
  END IF;
END
$phase6_constraints$;

COMMENT ON COLUMN public.escrow_trust_sessions.listing_amount IS
  'Server-resolved listing amount snapshotted when the transaction intent is created; never client-authored.';
COMMENT ON COLUMN public.escrow_trust_sessions.listing_currency IS
  'Server-resolved listing currency. A value is allowed only with listing_currency_source.';
COMMENT ON COLUMN public.escrow_trust_sessions.listing_currency_source IS
  'Copied from the canonical vehicles.currency_source provenance at transaction-intent creation; never defaulted/backfilled.';

-- Direct browser/database writes remain forbidden. The backend service_role is the
-- transaction writer; authenticated is read-only under the pre-existing participant RLS.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.escrow_trust_sessions FROM anon, authenticated;
GRANT SELECT ON TABLE public.escrow_trust_sessions TO authenticated;

DO $phase6_post$
DECLARE
  v_defaults text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY column_name)
    INTO v_defaults
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'escrow_trust_sessions'
     AND column_name IN ('listing_amount','listing_currency','listing_currency_source')
     AND column_default IS NOT NULL;
  IF v_defaults IS NOT NULL THEN
    RAISE EXCEPTION '[issue-164-p6] transaction term column(s) unexpectedly carry defaults: %', v_defaults;
  END IF;
END
$phase6_post$;

-- +migrate Down
-- Forward programme migration. A down migration would discard transaction snapshots and is
-- deliberately not executable. Reversal, if ever required, must be a separately reviewed data
-- migration after proving no canonical sessions depend on these fields.
