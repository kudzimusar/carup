-- +migrate Up
-- ============================================================================
-- Marketplace v1 — buyer-intent capture (inquiries + listing reports)
-- ----------------------------------------------------------------------------
-- Postgres / Supabase. Idempotent (to_regclass + IF NOT EXISTS guards).
-- service_role-only writes; RLS enabled; anon/authenticated REVOKED. The backend
-- Express gateway uses the service_role key and enforces authorization in the
-- service layer (marketplaceInquiryService / marketplaceModerationService).
--
-- Apply via the project's Supabase migration path (scripts/run-sql.js or
-- scripts/deploy-migration-*.js). NOT applied automatically by this PR.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.marketplace_listing_reports;
--   DROP TABLE IF EXISTS public.marketplace_inquiries;
-- ============================================================================

-- ---- marketplace_inquiries -------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.marketplace_inquiries') IS NULL THEN
    CREATE TABLE public.marketplace_inquiries (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id       TEXT,
      listing_type     TEXT NOT NULL DEFAULT 'vehicle',
      buyer_id         TEXT,
      guest_name       TEXT,
      guest_email      TEXT,
      guest_phone      TEXT,
      seller_id        TEXT,
      seller_tenant_id TEXT,
      inquiry_type     TEXT NOT NULL,
      message          TEXT,
      referral_code    TEXT,
      campaign_code    TEXT,
      source_channel   TEXT NOT NULL DEFAULT 'web',
      status           TEXT NOT NULL DEFAULT 'new',
      risk_status      TEXT NOT NULL DEFAULT 'clear',
      assigned_operator TEXT,
      country          TEXT,
      metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT marketplace_inquiries_type_check CHECK (inquiry_type IN (
        'vehicle_purchase_interest','vehicle_inspection_request','part_quote_request',
        'garage_service_request','import_quote_request','container_space_interest',
        'dealer_stock_request','sell_my_car_request','trade_in_request',
        'diaspora_vehicle_request','diaspora_parts_request','family_purchase_support'
      )),
      CONSTRAINT marketplace_inquiries_status_check CHECK (status IN (
        'new','assigned','contacted','qualified','closed','spam','rejected'
      )),
      CONSTRAINT marketplace_inquiries_channel_check CHECK (source_channel IN (
        'web','mobile','whatsapp','telegram','facebook','qr','operator'
      )),
      CONSTRAINT marketplace_inquiries_risk_check CHECK (risk_status IN (
        'clear','watch','flagged','blocked'
      ))
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mpi_listing       ON public.marketplace_inquiries(listing_id);
CREATE INDEX IF NOT EXISTS idx_mpi_seller        ON public.marketplace_inquiries(seller_id);
CREATE INDEX IF NOT EXISTS idx_mpi_seller_tenant ON public.marketplace_inquiries(seller_tenant_id);
CREATE INDEX IF NOT EXISTS idx_mpi_status        ON public.marketplace_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_mpi_type          ON public.marketplace_inquiries(inquiry_type);
CREATE INDEX IF NOT EXISTS idx_mpi_created       ON public.marketplace_inquiries(created_at DESC);

ALTER TABLE public.marketplace_inquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_inquiries FROM anon, authenticated;
GRANT ALL ON public.marketplace_inquiries TO service_role;

-- ---- marketplace_listing_reports -------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.marketplace_listing_reports') IS NULL THEN
    CREATE TABLE public.marketplace_listing_reports (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id    TEXT NOT NULL,
      reporter_id   TEXT,
      guest_email   TEXT,
      reason_code   TEXT NOT NULL DEFAULT 'other',
      details       TEXT,
      status        TEXT NOT NULL DEFAULT 'new',
      source_channel TEXT NOT NULL DEFAULT 'web',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT marketplace_listing_reports_reason_check CHECK (reason_code IN (
        'scam_suspected','misleading_price','off_platform_payment','wrong_details',
        'duplicate','prohibited_item','other'
      )),
      CONSTRAINT marketplace_listing_reports_status_check CHECK (status IN (
        'new','reviewing','actioned','dismissed'
      ))
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mlr_listing ON public.marketplace_listing_reports(listing_id);
CREATE INDEX IF NOT EXISTS idx_mlr_status  ON public.marketplace_listing_reports(status);
CREATE INDEX IF NOT EXISTS idx_mlr_created ON public.marketplace_listing_reports(created_at DESC);

ALTER TABLE public.marketplace_listing_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_listing_reports FROM anon, authenticated;
GRANT ALL ON public.marketplace_listing_reports TO service_role;
