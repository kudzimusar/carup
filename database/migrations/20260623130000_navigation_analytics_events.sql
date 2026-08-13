-- +migrate Up
-- Navigation Intelligence — privacy-minimized navigation analytics (Milestone F).
--
-- Stores ONLY a versioned, enum-bounded navigation telemetry taxonomy. There is
-- NO personal data here by construction: no names, email, phone, VIN, tokens,
-- free text, raw tenant ids, device ids, raw URLs or IP. The backend ingestion
-- allowlist-projects every event to the columns below and DROPS everything else;
-- route patterns are mapped to a REGISTERED feature route / manifest node id (or
-- the constant 'unregistered') — a raw URL is never persisted. `role_category` is
-- a COARSE bucket derived server-side from a trusted session (never a client
-- header). This table powers discovery/funnel aggregates only.
--
-- RETENTION POLICY: raw events are retained for 30 DAYS for operational funnel
-- analysis, then they should be rolled up into pre-aggregated daily counts and
-- the raw rows purged (a scheduled job — out of scope for this migration). The
-- table carries no identity, so even the raw 30-day window cannot re-identify a
-- user. occurred_at is the retention clock.
--
-- Idempotent and safe to apply more than once. STAGING-ONLY until the Product
-- Owner approves a production apply. DO NOT apply to production from here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS navigation_analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Versioned taxonomy: lets us evolve the enum set without losing old rows.
  schema_version INTEGER NOT NULL DEFAULT 1,
  event_type TEXT NOT NULL,
  -- Allowlisted manifest feature id, or NULL when the event is not feature-bound.
  feature_id TEXT,
  -- Bounded manifest node id (NOT a raw identifier).
  node_id TEXT,
  surface TEXT NOT NULL,
  -- Route PATTERNS only: a registered feature route / node id, or 'unregistered'.
  source_route_pattern TEXT,
  destination_route_pattern TEXT,
  platform TEXT NOT NULL,
  -- COARSE role bucket derived from a trusted session server-side (never client).
  role_category TEXT NOT NULL DEFAULT 'anonymous',
  -- Bounded lifecycle / reason code (e.g. 'blocked_role', 'rendered') — no free text.
  lifecycle_or_reason_code TEXT,
  -- Bounded build/version label (e.g. 'web-2026.06.23').
  build_version TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT nav_analytics_event_type_valid CHECK (event_type IN (
    'navigation_surface_opened',
    'navigation_item_impression',
    'navigation_item_selected',
    'navigation_destination_rendered',
    'navigation_destination_blocked',
    'navigation_role_switched',
    'navigation_drawer_opened',
    'navigation_tab_selected',
    'navigation_error'
  )),
  CONSTRAINT nav_analytics_surface_valid CHECK (surface IN (
    'mega_menu', 'mobile_drawer', 'bottom_tabs', 'sidebar',
    'footer', 'command_palette', 'route_guard', 'unknown'
  )),
  CONSTRAINT nav_analytics_platform_valid CHECK (platform IN ('web', 'ios', 'android')),
  CONSTRAINT nav_analytics_role_category_valid CHECK (role_category IN (
    'anonymous', 'owner', 'dealer', 'mechanic', 'insurance',
    'government', 'admin', 'bank'
  )),
  CONSTRAINT nav_analytics_schema_version_positive CHECK (schema_version >= 1),
  -- Bounded lengths: a hard upper bound on every textual column so an oversized /
  -- adversarial payload can never be stored even if the app layer is bypassed.
  CONSTRAINT nav_analytics_feature_id_len CHECK (feature_id IS NULL OR char_length(feature_id) <= 128),
  CONSTRAINT nav_analytics_node_id_len CHECK (node_id IS NULL OR char_length(node_id) <= 128),
  CONSTRAINT nav_analytics_source_len CHECK (source_route_pattern IS NULL OR char_length(source_route_pattern) <= 256),
  CONSTRAINT nav_analytics_dest_len CHECK (destination_route_pattern IS NULL OR char_length(destination_route_pattern) <= 256),
  CONSTRAINT nav_analytics_reason_len CHECK (lifecycle_or_reason_code IS NULL OR char_length(lifecycle_or_reason_code) <= 64),
  CONSTRAINT nav_analytics_build_len CHECK (build_version IS NULL OR char_length(build_version) <= 64)
);

-- Aggregation-oriented indexes (the admin endpoint groups; it never dumps rows).
CREATE INDEX IF NOT EXISTS idx_nav_analytics_occurred_at ON navigation_analytics_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_nav_analytics_feature_id ON navigation_analytics_events (feature_id);
CREATE INDEX IF NOT EXISTS idx_nav_analytics_event_type ON navigation_analytics_events (event_type);
CREATE INDEX IF NOT EXISTS idx_nav_analytics_surface ON navigation_analytics_events (surface);
CREATE INDEX IF NOT EXISTS idx_nav_analytics_platform ON navigation_analytics_events (platform);

-- Server-owned: service_role only. The public ingestion route writes via the
-- service-role backend client; clients NEVER touch this table directly.
ALTER TABLE navigation_analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE navigation_analytics_events FROM anon;
REVOKE ALL ON TABLE navigation_analytics_events FROM authenticated;
GRANT ALL ON TABLE navigation_analytics_events TO service_role;

-- ── Rollback (manual; see runbook) ──────────────────────────────────────────
-- DROP TABLE IF EXISTS navigation_analytics_events;
