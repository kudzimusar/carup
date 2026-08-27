-- +migrate Up
-- CarUp Intelligence 1.0 — I2: first-party governed activity ledger.
--
-- This is the SINGLE analytical event store for marketplace behaviour, defined by
-- docs/intelligence/receipts/I1_CANONICAL_METRIC_AND_EVENT_CONTRACT.md (schema_version 1).
--
-- WHAT THIS TABLE IS: an OBSERVATION ledger. A row records that an action occurred.
-- It NEVER manufactures the authoritative business state the action concerns:
--   saved_vehicles       remains authority for current saved state
--   marketplace_inquiries remains authority for inquiries/leads
--   message_threads/messages remain authority for conversation + response
--   vehicles.publication_status / vehicles.status remain authority for lifecycle
--   escrow_trust_sessions / vehicle_reservations remain authority for transactions
--   the trust services remain the ONLY authority for Trust
-- Analytics may count and correlate those states; it may not override them.
--
-- PRIVILEGE DERIVATION: authenticated_user_id, tenant_id and organization_id are
-- INTERNAL-ONLY and are derived SERVER-side (session + the event's OBJECT, never
-- the actor's headers). A client cannot assert its own tenant/seller scope; the
-- ingestion service drops any client-supplied value for these columns.
--
-- PRIVACY: identity columns are internal-only and never appear in an external
-- projection. Sellers receive aggregates ("822 unique shoppers"), never viewer
-- identities; identity becomes visible only through a declared lead workflow,
-- which marketplace_inquiries already models.
--
-- RETENTION (contract §5.5, shipped WITH the ledger — CarUp has historically
-- shipped event tables with a documented retention policy and no job; this
-- migration ships the job's SQL side): raw events are retained 24 months and
-- purged only where a covering certified rollup exists. Erasure tombstones the
-- authenticated_user_id within 30 days of an erasure request; aggregates are
-- unaffected (they carry no direct identifier).
--
-- Idempotent and safe to re-apply. STAGING-ONLY until the Product Owner approves
-- a production apply. DO NOT apply to production from here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS marketplace_activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Contract versioning (§2) ──────────────────────────────────────────────
  schema_version INTEGER NOT NULL DEFAULT 1,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,

  -- ── Time discipline (§5.4) ────────────────────────────────────────────────
  -- occurred_at_client is the RAW client timestamp, preserved verbatim so true
  -- lateness stays computable after clamping. NULL for server-emitted events.
  occurred_at_client TIMESTAMPTZ,
  -- occurred_at is the EFFECTIVE time: clamped for client events, domain-write
  -- time for server-emitted events. It is the retention and rollup clock.
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Actor (§5.1, §5.2) ────────────────────────────────────────────────────
  actor_scope TEXT NOT NULL DEFAULT 'anonymous',
  -- Opaque client-minted device/profile key. NOT derived from any identifier.
  pseudonymous_session_key TEXT,
  -- INTERNAL-ONLY, server-derived. Tombstoned to NULL on erasure.
  authenticated_user_id TEXT,
  -- Marks a row whose authenticated_user_id was erased, so an erased row is
  -- never mistaken for an anonymous one in cohort/uniqueness computations.
  identity_erased_at TIMESTAMPTZ,

  -- ── Scope (§3) — INTERNAL-ONLY, derived from the event's OBJECT ────────────
  tenant_id TEXT,
  organization_id TEXT,

  -- ── Object ────────────────────────────────────────────────────────────────
  listing_id TEXT,
  vehicle_reference TEXT,
  object_type TEXT,
  object_id TEXT,

  -- ── Source ────────────────────────────────────────────────────────────────
  source_surface TEXT,
  source_platform TEXT NOT NULL DEFAULT 'web',
  source_channel TEXT,
  campaign_code TEXT,
  referral_code TEXT,
  -- Rotates on every SPA route transition / native screen focus (contract §3).
  page_view_id TEXT,

  -- ── Integrity ─────────────────────────────────────────────────────────────
  -- Server-computed per event type (§4). UNIQUE: the duplicate suppression is a
  -- DATABASE guarantee, not an application convention, so a retry, a double-fire
  -- or a replayed batch can never inflate a metric.
  idempotency_key TEXT NOT NULL,

  -- ── Governance ────────────────────────────────────────────────────────────
  privacy_class TEXT NOT NULL DEFAULT 'P1',
  -- Stored, never silently dropped; rollups apply the exclusion set of §5.3.
  exclusion_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Per-type allowlisted keys only; the ingestion service DROPS everything else.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Bounded taxonomy (mirrors the service constants and contract §4) ──────
  CONSTRAINT mae_event_type_valid CHECK (event_type IN (
    'marketplace_search_performed',
    'marketplace_search_zero_results',
    'marketplace_listing_impression',
    'marketplace_listing_opened',
    'marketplace_listing_engaged',
    'marketplace_inquiry_started',
    'marketplace_compare_added',
    'marketplace_compare_removed',
    'marketplace_compare_viewed',
    'marketplace_contact_clicked',
    'marketplace_listing_shared',
    'marketplace_listing_saved',
    'marketplace_listing_unsaved',
    'marketplace_inquiry_created',
    'marketplace_inspection_requested',
    'marketplace_reservation_started',
    'marketplace_reservation_completed',
    'marketplace_price_changed',
    'marketplace_listing_created',
    'marketplace_listing_submitted',
    'marketplace_listing_published',
    'marketplace_listing_sold',
    'process_step_recorded'
  )),
  CONSTRAINT mae_actor_scope_valid CHECK (actor_scope IN ('anonymous', 'authenticated', 'system')),
  CONSTRAINT mae_platform_valid CHECK (source_platform IN ('web', 'ios', 'android', 'server')),
  CONSTRAINT mae_surface_valid CHECK (source_surface IS NULL OR source_surface IN (
    'marketplace_list', 'marketplace_detail', 'marketplace_compare', 'dashboard',
    'saved', 'search', 'external_link', 'communications', 'other'
  )),
  CONSTRAINT mae_privacy_class_valid CHECK (privacy_class IN ('P1', 'P2', 'P3', 'P4')),
  CONSTRAINT mae_schema_version_positive CHECK (schema_version >= 1),
  CONSTRAINT mae_event_version_positive CHECK (event_version >= 1),

  -- An authenticated event must carry the derived user id; an anonymous one must
  -- not. This is the structural guarantee behind actor_key (§5.2): the class of a
  -- row cannot drift from its identity content.
  CONSTRAINT mae_actor_identity_coherent CHECK (
    (actor_scope = 'authenticated' AND (authenticated_user_id IS NOT NULL OR identity_erased_at IS NOT NULL))
    OR (actor_scope <> 'authenticated' AND authenticated_user_id IS NULL)
  ),
  -- occurred_at may never be in the future relative to ingestion.
  CONSTRAINT mae_occurred_not_after_received CHECK (occurred_at <= received_at),

  -- Bounded lengths on every textual column: an oversized or adversarial payload
  -- cannot be stored even if the application layer is bypassed.
  CONSTRAINT mae_session_key_len CHECK (pseudonymous_session_key IS NULL OR char_length(pseudonymous_session_key) <= 64),
  CONSTRAINT mae_user_id_len CHECK (authenticated_user_id IS NULL OR char_length(authenticated_user_id) <= 128),
  CONSTRAINT mae_tenant_len CHECK (tenant_id IS NULL OR char_length(tenant_id) <= 128),
  CONSTRAINT mae_org_len CHECK (organization_id IS NULL OR char_length(organization_id) <= 128),
  CONSTRAINT mae_listing_len CHECK (listing_id IS NULL OR char_length(listing_id) <= 128),
  CONSTRAINT mae_vehicle_ref_len CHECK (vehicle_reference IS NULL OR char_length(vehicle_reference) <= 128),
  CONSTRAINT mae_object_type_len CHECK (object_type IS NULL OR char_length(object_type) <= 64),
  CONSTRAINT mae_object_id_len CHECK (object_id IS NULL OR char_length(object_id) <= 128),
  CONSTRAINT mae_channel_len CHECK (source_channel IS NULL OR char_length(source_channel) <= 64),
  CONSTRAINT mae_campaign_len CHECK (campaign_code IS NULL OR char_length(campaign_code) <= 64),
  CONSTRAINT mae_referral_len CHECK (referral_code IS NULL OR char_length(referral_code) <= 64),
  CONSTRAINT mae_page_view_len CHECK (page_view_id IS NULL OR char_length(page_view_id) <= 64),
  CONSTRAINT mae_idempotency_len CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  -- A hard ceiling on the allowlisted metadata document.
  CONSTRAINT mae_metadata_bounded CHECK (pg_column_size(metadata) <= 8192)
);

-- Database-enforced duplicate suppression (contract §5.4).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mae_idempotency_key
  ON marketplace_activity_events (idempotency_key);

-- Rollup-oriented indexes. I4 aggregates by (object, day) and by (type, day);
-- it never dumps raw rows to a stakeholder surface.
CREATE INDEX IF NOT EXISTS idx_mae_listing_occurred
  ON marketplace_activity_events (listing_id, occurred_at DESC)
  WHERE listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mae_type_occurred
  ON marketplace_activity_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mae_tenant_occurred
  ON marketplace_activity_events (tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mae_user_occurred
  ON marketplace_activity_events (authenticated_user_id, occurred_at DESC)
  WHERE authenticated_user_id IS NOT NULL;
-- Funnel/conversion queries stage-link on the session key (contract §5.2 link_key).
CREATE INDEX IF NOT EXISTS idx_mae_session_occurred
  ON marketplace_activity_events (pseudonymous_session_key, occurred_at DESC)
  WHERE pseudonymous_session_key IS NOT NULL;
-- Retention sweep clock.
CREATE INDEX IF NOT EXISTS idx_mae_occurred_at
  ON marketplace_activity_events (occurred_at);

-- ── Access: server-owned, service_role only ─────────────────────────────────
-- The ingestion route writes via the service-role backend client; clients NEVER
-- touch this table directly. RLS is enabled with ZERO policies so anon and
-- authenticated are denied by default even if a grant were reintroduced.
ALTER TABLE marketplace_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_activity_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE marketplace_activity_events FROM anon;
REVOKE ALL ON TABLE marketplace_activity_events FROM authenticated;
REVOKE ALL ON TABLE marketplace_activity_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE marketplace_activity_events TO service_role;

COMMENT ON TABLE marketplace_activity_events IS
  'CarUp Intelligence 1.0 activity ledger (I2). Observation-only: records that an action occurred; never the authoritative business state. Identity/tenancy columns are internal-only and server-derived. Duplicate suppression is enforced by the unique idempotency_key.';

-- ── Erasure (contract §5.5) ─────────────────────────────────────────────────
-- Tombstones a user's identity on their events. The behavioural rows survive so
-- historical aggregates stay reconcilable, but they can no longer be attributed
-- to the person. Aggregates are unaffected (they hold no direct identifier).
CREATE OR REPLACE FUNCTION intelligence_erase_actor(p_user_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_user_id IS NULL OR char_length(p_user_id) = 0 THEN
    RAISE EXCEPTION 'intelligence_erase_actor requires a user id';
  END IF;
  UPDATE marketplace_activity_events
     SET authenticated_user_id = NULL,
         identity_erased_at = now(),
         pseudonymous_session_key = NULL
   WHERE authenticated_user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION intelligence_erase_actor(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION intelligence_erase_actor(TEXT) FROM anon;
REVOKE ALL ON FUNCTION intelligence_erase_actor(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION intelligence_erase_actor(TEXT) TO service_role;

-- ── Retention (contract §5.5) ───────────────────────────────────────────────
-- Purges raw events older than the retention window. p_before is passed by the
-- caller rather than computed from now() so a scheduled run is deterministic and
-- testable, and so the caller can refuse to purge a window whose covering rollup
-- does not yet exist. Returns the number of rows removed.
CREATE OR REPLACE FUNCTION intelligence_purge_activity_events(p_before TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_before IS NULL THEN
    RAISE EXCEPTION 'intelligence_purge_activity_events requires an explicit cutoff';
  END IF;
  -- Refuse a cutoff inside the retention window: a mis-scheduled job must not be
  -- able to delete live data that certified rollups have not yet covered.
  IF p_before > now() - INTERVAL '24 months' THEN
    RAISE EXCEPTION 'refusing to purge inside the 24-month retention window (cutoff=%)', p_before;
  END IF;
  DELETE FROM marketplace_activity_events WHERE occurred_at < p_before;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION intelligence_purge_activity_events(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION intelligence_purge_activity_events(TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION intelligence_purge_activity_events(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION intelligence_purge_activity_events(TIMESTAMPTZ) TO service_role;

-- ── Ingestion observability (plan §110: a dashboard that silently stops counting
-- is a production defect) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence_ingestion_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start TIMESTAMPTZ NOT NULL,
  events_received INTEGER NOT NULL DEFAULT 0,
  events_accepted INTEGER NOT NULL DEFAULT 0,
  events_rejected INTEGER NOT NULL DEFAULT 0,
  events_duplicate INTEGER NOT NULL DEFAULT 0,
  events_flagged INTEGER NOT NULL DEFAULT 0,
  opened_without_context INTEGER NOT NULL DEFAULT 0,
  storage_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iis_window_unique UNIQUE (window_start)
);

ALTER TABLE intelligence_ingestion_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_ingestion_stats FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE intelligence_ingestion_stats FROM anon;
REVOKE ALL ON TABLE intelligence_ingestion_stats FROM authenticated;
REVOKE ALL ON TABLE intelligence_ingestion_stats FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE intelligence_ingestion_stats TO service_role;

COMMENT ON TABLE intelligence_ingestion_stats IS
  'Per-window ingestion counters for the Intelligence activity ledger: received/accepted/rejected/duplicate/flagged plus the opened-without-client-context undercount. Makes silent event loss observable.';

-- ── Rollback (manual; see runbook) ──────────────────────────────────────────
-- DROP FUNCTION IF EXISTS intelligence_purge_activity_events(TIMESTAMPTZ);
-- DROP FUNCTION IF EXISTS intelligence_erase_actor(TEXT);
-- DROP TABLE IF EXISTS intelligence_ingestion_stats;
-- DROP TABLE IF EXISTS marketplace_activity_events;
