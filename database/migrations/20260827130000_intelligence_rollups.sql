-- +migrate Up
-- CarUp Intelligence 1.0 — I4: governed daily rollups and read models.
--
-- Rollups are DERIVED state, never authority. Each row is reproducible from the
-- activity ledger plus the authoritative tables it references, and every row
-- carries the calculation_version that produced it, so a metric whose definition
-- changes cannot silently mix old and new arithmetic in one window.
--
-- WHY A TABLE AND NOT A VIEW: the metric contract requires stable, versioned,
-- reconcilable numbers with late-event handling. A view recomputes silently under
-- changing definitions and cannot record WHICH definition produced a number.
--
-- WHY NOT A SECOND SOURCE OF TRUTH: CarUp already dropped `vehicle_listing_summaries`
-- (20260818100000) precisely because a dormant read model invites divergence. These
-- rollups are therefore (a) always recomputable from the ledger, (b) never written
-- by product code, and (c) stamped with the source window they cover, so a stale
-- rollup is DETECTABLE rather than merely wrong.
--
-- COUNTS THAT ARE AUTHORITY READS, NOT EVENT COUNTS: `inquiries` and
-- `net_watchlist` come from marketplace_inquiries and saved_vehicles respectively.
-- The contract makes the authority the displayed number; the ledger only explains
-- how the shopper got there. Keeping them here as snapshot columns is what allows
-- the reconciliation test to assert the two agree.
--
-- Idempotent and safe to re-apply. STAGING-ONLY until the Product Owner approves a
-- production apply. DO NOT apply to production from here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Daily listing metrics ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  listing_id TEXT NOT NULL,
  tenant_id TEXT,

  -- Discovery / engagement (from the activity ledger, exclusions applied)
  impressions INTEGER NOT NULL DEFAULT 0,
  unique_reach INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  unique_viewers INTEGER NOT NULL DEFAULT 0,
  engaged_views INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  unsaves INTEGER NOT NULL DEFAULT 0,
  -- Kept apart because a completed share and an opened share sheet are different
  -- claims; the contract forbids summing them silently.
  shares_confirmed INTEGER NOT NULL DEFAULT 0,
  shares_initiated INTEGER NOT NULL DEFAULT 0,
  compare_adds INTEGER NOT NULL DEFAULT 0,
  contact_clicks INTEGER NOT NULL DEFAULT 0,
  inquiry_starts INTEGER NOT NULL DEFAULT 0,

  -- Authority reads (NOT event counts — see header)
  inquiries INTEGER NOT NULL DEFAULT 0,
  inspections INTEGER NOT NULL DEFAULT 0,
  reservations INTEGER NOT NULL DEFAULT 0,
  net_watchlist INTEGER,

  -- Self-traffic is excluded from every seller-facing number above, and reported
  -- separately so an internal reviewer can still see it.
  self_traffic_views INTEGER NOT NULL DEFAULT 0,

  calculation_version TEXT NOT NULL,
  source_event_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ldm_unique_day UNIQUE (metric_date, listing_id, calculation_version),
  CONSTRAINT ldm_nonnegative CHECK (
    impressions >= 0 AND views >= 0 AND unique_viewers >= 0 AND engaged_views >= 0
    AND saves >= 0 AND unsaves >= 0 AND inquiries >= 0
  ),
  -- A unique count can never exceed its total. A rollup that violated this would
  -- be arithmetically impossible, so the database refuses to store it.
  CONSTRAINT ldm_unique_le_total CHECK (unique_viewers <= views AND unique_reach <= impressions)
);

CREATE INDEX IF NOT EXISTS idx_ldm_listing_date ON listing_daily_metrics (listing_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_ldm_date ON listing_daily_metrics (metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_ldm_tenant_date ON listing_daily_metrics (tenant_id, metric_date DESC) WHERE tenant_id IS NOT NULL;

-- ── Daily seller metrics ────────────────────────────────────────────────────
-- Seller grain is NOT a sum of listing rows for unique counts: one shopper who
-- viewed three of a seller's cars is one person, not three. The rollup writer
-- computes uniques across the seller's whole inventory.
CREATE TABLE IF NOT EXISTS seller_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  seller_user_id TEXT NOT NULL,
  tenant_id TEXT,
  active_listings INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  unique_viewers INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  unsaves INTEGER NOT NULL DEFAULT 0,
  shares_confirmed INTEGER NOT NULL DEFAULT 0,
  inquiry_starts INTEGER NOT NULL DEFAULT 0,
  inquiries INTEGER NOT NULL DEFAULT 0,
  inspections INTEGER NOT NULL DEFAULT 0,
  reservations INTEGER NOT NULL DEFAULT 0,
  calculation_version TEXT NOT NULL,
  source_event_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sdm_unique_day UNIQUE (metric_date, seller_user_id, calculation_version),
  CONSTRAINT sdm_unique_le_total CHECK (unique_viewers <= views)
);

CREATE INDEX IF NOT EXISTS idx_sdm_seller_date ON seller_daily_metrics (seller_user_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_sdm_date ON seller_daily_metrics (metric_date DESC);

-- ── Daily tenant metrics (dealer/organization grain) ────────────────────────
CREATE TABLE IF NOT EXISTS tenant_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  tenant_id TEXT NOT NULL,
  active_listings INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  unique_viewers INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  shares_confirmed INTEGER NOT NULL DEFAULT 0,
  inquiries INTEGER NOT NULL DEFAULT 0,
  inspections INTEGER NOT NULL DEFAULT 0,
  reservations INTEGER NOT NULL DEFAULT 0,
  calculation_version TEXT NOT NULL,
  source_event_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tdm_unique_day UNIQUE (metric_date, tenant_id, calculation_version),
  CONSTRAINT tdm_unique_le_total CHECK (unique_viewers <= views)
);

CREATE INDEX IF NOT EXISTS idx_tdm_tenant_date ON tenant_daily_metrics (tenant_id, metric_date DESC);

-- ── Daily platform metrics (CarUp internal) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  searches INTEGER NOT NULL DEFAULT 0,
  zero_result_searches INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  unique_shoppers INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  unsaves INTEGER NOT NULL DEFAULT 0,
  shares_confirmed INTEGER NOT NULL DEFAULT 0,
  inquiry_starts INTEGER NOT NULL DEFAULT 0,
  inquiries INTEGER NOT NULL DEFAULT 0,
  inspections INTEGER NOT NULL DEFAULT 0,
  reservations INTEGER NOT NULL DEFAULT 0,
  active_listings INTEGER NOT NULL DEFAULT 0,
  calculation_version TEXT NOT NULL,
  source_event_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pdm_unique_day UNIQUE (metric_date, calculation_version)
);

CREATE INDEX IF NOT EXISTS idx_pdm_date ON platform_daily_metrics (metric_date DESC);

-- ── Rollup run ledger ───────────────────────────────────────────────────────
-- Makes staleness DETECTABLE: a dashboard reading a rollup can ask when the
-- covering window was last computed and say "as of" honestly, instead of
-- presenting an old number as current.
CREATE TABLE IF NOT EXISTS intelligence_rollup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  calculation_version TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  events_scanned INTEGER NOT NULL DEFAULT 0,
  listings_written INTEGER NOT NULL DEFAULT 0,
  sellers_written INTEGER NOT NULL DEFAULT 0,
  tenants_written INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  CONSTRAINT irr_status_valid CHECK (status IN ('running', 'completed', 'failed')),
  CONSTRAINT irr_unique_run UNIQUE (metric_date, calculation_version, started_at)
);

CREATE INDEX IF NOT EXISTS idx_irr_date ON intelligence_rollup_runs (metric_date DESC, started_at DESC);

-- ── Access: server-owned, service_role only ─────────────────────────────────
-- Rollups contain per-listing and per-tenant commercial performance. A client
-- reading them directly would bypass the audience scoping that I5 enforces, so
-- every client role is denied and reads go through authorized projections.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'listing_daily_metrics', 'seller_daily_metrics', 'tenant_daily_metrics',
    'platform_daily_metrics', 'intelligence_rollup_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO service_role', t);
  END LOOP;
END $$;

COMMENT ON TABLE listing_daily_metrics IS
  'CarUp Intelligence I4 daily listing rollup. DERIVED, never authority: reproducible from marketplace_activity_events plus the authoritative inquiry/save tables. Every row carries the calculation_version that produced it. inquiries/net_watchlist are authority reads, not event counts.';
COMMENT ON TABLE intelligence_rollup_runs IS
  'Per-window rollup execution ledger. Lets a surface state how fresh a number is instead of presenting a stale rollup as current.';

-- ── Rollback (manual; see runbook) ──────────────────────────────────────────
-- DROP TABLE IF EXISTS intelligence_rollup_runs;
-- DROP TABLE IF EXISTS platform_daily_metrics;
-- DROP TABLE IF EXISTS tenant_daily_metrics;
-- DROP TABLE IF EXISTS seller_daily_metrics;
-- DROP TABLE IF EXISTS listing_daily_metrics;
