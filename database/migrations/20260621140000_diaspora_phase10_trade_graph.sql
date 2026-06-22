-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Phase 10: Trade Graph Storage Schema
--
-- Event-sourced, Postgres-first graph projection layer for trade intelligence.
--   * Nodes  = projected snapshots of authoritative entities (NOT the source of truth).
--   * Edges  = relationships DERIVED from domain_events (011_phase6_schema.sql) and the
--              diaspora_import_audit_log (013) secondary projection source.
--   * The graph is DERIVED and REBUILDABLE: relational tables remain authoritative; node/edge
--     writes happen ONLY from the projection service (service_role) driven by domain events.
--     AI and the frontend NEVER create edges — every edge carries a source_event_ref to an
--     authoritative domain_events.id (soft reference, no FK, so the graph stays rebuildable).
--   * Idempotent projection: dedup constraints + a per-tenant checkpoint + a processed-events
--     ledger guarantee that replaying the same events yields the same graph.
--   * Tenant-partitioned with RLS reusing diaspora_trade_os_can_access_row() / _is_platform_admin()
--     / _is_tenant_member() from Phase 1B (20260611061849). REVOKE PUBLIC; authenticated may only
--     SELECT; service_role performs all writes.
--   * Rebuild is admin-only, rate-limited, auditable (trade_graph_rebuilds + SECURITY DEFINER RPC).
--
-- Gated at the application layer behind env flag DIASPORA_TRADE_GRAPH (default OFF). This migration
-- is additive, reversible (-- +migrate Down), and idempotent. NOT applied to any DB by this program.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Reuses public.set_diaspora_trade_os_updated_at() and the RLS helper functions from Phase 1B
-- (20260611061849_diaspora_trade_os_phase1b_foundation.sql). They are assumed to exist.

-- ── Table: trade_graph_nodes (entity projection snapshot) ────────────────────
CREATE TABLE IF NOT EXISTS public.trade_graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  node_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  is_valid boolean NOT NULL DEFAULT true,
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  projection_version text NOT NULL DEFAULT 'trade-graph-projection-v1',
  source_event_ref uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT trade_graph_nodes_node_type_chk
    CHECK (node_type IN (
      'USER','TENANT','TRADE_PROFILE','BUYER','SELLER','BUYER_ORDER','SELLER_STOCK_ITEM','RFQ',
      'ACCEPTED_QUOTE','SUPPLY_DOCUMENT','CONTAINER','CARGO_RESERVATION','SHIPMENT','DOCUMENT',
      'COMPLIANCE_REVIEW','PAYMENT_MILESTONE','REPUTATION_RECORD','SAFETRADE_TRANSACTION',
      'SAFETRADE_MILESTONE','SAFETRADE_DISPUTE','DRIVE_FILE','AI_COMMAND','WORKBOOK_BATCH'
    )),
  CONSTRAINT trade_graph_nodes_confidence_chk
    CHECK (confidence >= 0 AND confidence <= 1)
);

-- Dedup: at most one current, non-deleted node per (tenant, type, entity). Superseded versions
-- remain (is_current=false / deleted_at set) for audit + replay.
CREATE UNIQUE INDEX IF NOT EXISTS trade_graph_nodes_dedup
  ON public.trade_graph_nodes (tenant_id, node_type, entity_id)
  WHERE is_current IS TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_nodes_tenant_current
  ON public.trade_graph_nodes (tenant_id, is_current, created_at DESC)
  WHERE is_current IS TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_nodes_type_tenant
  ON public.trade_graph_nodes (node_type, tenant_id, is_valid)
  WHERE is_current IS TRUE;

CREATE INDEX IF NOT EXISTS idx_trade_graph_nodes_entity_lookup
  ON public.trade_graph_nodes (entity_id, tenant_id)
  WHERE is_current IS TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_nodes_confidence
  ON public.trade_graph_nodes (tenant_id, confidence DESC)
  WHERE is_current IS TRUE AND is_valid IS TRUE;

-- ── Table: trade_graph_edges (relationship projection) ───────────────────────
CREATE TABLE IF NOT EXISTS public.trade_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_node_id uuid NOT NULL REFERENCES public.trade_graph_nodes(id) ON DELETE RESTRICT,
  target_node_id uuid NOT NULL REFERENCES public.trade_graph_nodes(id) ON DELETE RESTRICT,
  edge_type text NOT NULL,
  source_event_ref uuid,
  -- Soft reference to the domain_events.id that REVOKED this edge (set when a revoke event soft-deletes
  -- it: STOCK_RELEASED, QUOTE_REJECTED/EXPIRED, CARGO_RESERVATION_REJECTED, DOCUMENT_REJECTED, ...). No FK
  -- so the graph stays rebuildable. NULL while the edge is live.
  revoked_event_ref uuid,
  is_valid boolean NOT NULL DEFAULT true,
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000,
  policy_version text NOT NULL DEFAULT 'trade-graph-policy-v1',
  valid_from timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT trade_graph_edges_edge_type_chk
    CHECK (edge_type IN (
      'CREATED_BY','BELONGS_TO_TENANT','HAS_TRADE_PROFILE','INITIATED_ORDER','QUOTED_ON',
      'ACCEPTED_QUOTE','SUPPLIES','DOCUMENTS','RESERVES_CONTAINER','FULFILLS_ORDER',
      'REVIEWS_COMPLIANCE','REFERENCES_PROFILE','VERIFIES_DOCUMENT','CONDUCTS_TRANSACTION',
      'HAS_MILESTONE','RAISED_DISPUTE','SYNCED_TO_DRIVE','AI_COMMAND_FOR','PAYS_MILESTONE'
    )),
  CONSTRAINT trade_graph_edges_confidence_chk
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT trade_graph_edges_no_self_loops
    CHECK (source_node_id <> target_node_id)
);

-- Dedup: no duplicate edge from the same source event between the same nodes of the same type.
CREATE UNIQUE INDEX IF NOT EXISTS trade_graph_edges_dedup
  ON public.trade_graph_edges (tenant_id, source_node_id, target_node_id, edge_type, source_event_ref)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_tenant_source
  ON public.trade_graph_edges (tenant_id, source_node_id, edge_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_tenant_target
  ON public.trade_graph_edges (tenant_id, target_node_id, edge_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_source_target
  ON public.trade_graph_edges (source_node_id, target_node_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_event_ref
  ON public.trade_graph_edges (source_event_ref, tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_valid_temporal
  ON public.trade_graph_edges (valid_from, valid_until)
  WHERE deleted_at IS NULL AND is_valid IS TRUE;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_confidence
  ON public.trade_graph_edges (tenant_id, confidence DESC)
  WHERE deleted_at IS NULL AND is_valid IS TRUE;

-- ── Table: trade_graph_projection_checkpoints (idempotency & rebuild tracking) ─
CREATE TABLE IF NOT EXISTS public.trade_graph_projection_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  last_event_id uuid,
  last_event_created_at timestamptz,
  projection_version text NOT NULL DEFAULT 'trade-graph-projection-v1',
  dead_letter_count integer NOT NULL DEFAULT 0,
  replay_count integer NOT NULL DEFAULT 0,
  next_replay_required boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT trade_graph_projection_checkpoints_dedup UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_projection_checkpoints_last_event
  ON public.trade_graph_projection_checkpoints (last_event_created_at DESC)
  WHERE tenant_id IS NOT NULL;

-- ── Table: trade_graph_processed_events (per-event idempotency ledger) ────────
CREATE TABLE IF NOT EXISTS public.trade_graph_processed_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  tenant_id uuid,
  projection_version text NOT NULL DEFAULT 'trade-graph-projection-v1',
  projected_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT trade_graph_processed_events_dedup UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_processed_events_tenant
  ON public.trade_graph_processed_events (tenant_id, projected_at DESC);

-- ── Table: trade_graph_dead_letters (projection failures, operator visibility) ─
CREATE TABLE IF NOT EXISTS public.trade_graph_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  tenant_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  error_stack text,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  last_retry_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT trade_graph_dead_letters_dedup UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_dead_letters_tenant
  ON public.trade_graph_dead_letters (tenant_id, created_at DESC);

-- ── Table: trade_graph_rebuilds (admin-only, rate-limited, auditable) ────────
CREATE TABLE IF NOT EXISTS public.trade_graph_rebuilds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  initiated_by text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING',
  started_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  completed_at timestamptz,
  nodes_rebuilt integer,
  edges_rebuilt integer,
  events_processed integer,
  events_failed integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT trade_graph_rebuilds_status_chk
    CHECK (status IN ('RUNNING','COMPLETED','FAILED','RATE_LIMITED'))
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_rebuilds_tenant
  ON public.trade_graph_rebuilds (tenant_id, created_at DESC);

-- ── Table: trade_graph_materialized_summaries (optional pre-computed stats) ───
CREATE TABLE IF NOT EXISTS public.trade_graph_materialized_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL REFERENCES public.trade_graph_nodes(id) ON DELETE CASCADE,
  summary_type text NOT NULL,
  in_degree integer NOT NULL DEFAULT 0,
  out_degree integer NOT NULL DEFAULT 0,
  highest_confidence_neighbors jsonb NOT NULL DEFAULT '[]'::jsonb,
  path_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  aggregated_reputation numeric(5,2),
  last_computed_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  valid_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS trade_graph_materialized_summaries_dedup
  ON public.trade_graph_materialized_summaries (tenant_id, node_id, summary_type)
  WHERE valid_until IS NULL OR valid_until > timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_trade_graph_materialized_summaries_validity
  ON public.trade_graph_materialized_summaries (tenant_id, valid_until DESC);

-- ── Updated-at triggers (reuse Phase 1B helper) ──────────────────────────────
DROP TRIGGER IF EXISTS set_trade_graph_nodes_updated_at ON public.trade_graph_nodes;
CREATE TRIGGER set_trade_graph_nodes_updated_at
  BEFORE UPDATE ON public.trade_graph_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_trade_graph_edges_updated_at ON public.trade_graph_edges;
CREATE TRIGGER set_trade_graph_edges_updated_at
  BEFORE UPDATE ON public.trade_graph_edges
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_trade_graph_checkpoints_updated_at ON public.trade_graph_projection_checkpoints;
CREATE TRIGGER set_trade_graph_checkpoints_updated_at
  BEFORE UPDATE ON public.trade_graph_projection_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_trade_graph_dead_letters_updated_at ON public.trade_graph_dead_letters;
CREATE TRIGGER set_trade_graph_dead_letters_updated_at
  BEFORE UPDATE ON public.trade_graph_dead_letters
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_trade_graph_rebuilds_updated_at ON public.trade_graph_rebuilds;
CREATE TRIGGER set_trade_graph_rebuilds_updated_at
  BEFORE UPDATE ON public.trade_graph_rebuilds
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

DROP TRIGGER IF EXISTS set_trade_graph_summaries_updated_at ON public.trade_graph_materialized_summaries;
CREATE TRIGGER set_trade_graph_summaries_updated_at
  BEFORE UPDATE ON public.trade_graph_materialized_summaries
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

-- ── Row Level Security (tenant-scoped; reuse Phase 1B helpers) ────────────────
ALTER TABLE public.trade_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_projection_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_rebuilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_materialized_summaries ENABLE ROW LEVEL SECURITY;

-- Nodes/edges/summaries: authenticated tenant members + admins may READ via RLS; the projection
-- service writes as service_role (which bypasses RLS), so no INSERT/UPDATE policy is granted to
-- authenticated — this enforces "no direct graph writes from frontend/AI" at the DB layer.
DROP POLICY IF EXISTS trade_graph_nodes_tenant_read ON public.trade_graph_nodes;
CREATE POLICY trade_graph_nodes_tenant_read
  ON public.trade_graph_nodes
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL));

DROP POLICY IF EXISTS trade_graph_edges_tenant_read ON public.trade_graph_edges;
CREATE POLICY trade_graph_edges_tenant_read
  ON public.trade_graph_edges
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL));

DROP POLICY IF EXISTS trade_graph_materialized_summaries_tenant_read ON public.trade_graph_materialized_summaries;
CREATE POLICY trade_graph_materialized_summaries_tenant_read
  ON public.trade_graph_materialized_summaries
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL));

DROP POLICY IF EXISTS trade_graph_projection_checkpoints_tenant_read ON public.trade_graph_projection_checkpoints;
CREATE POLICY trade_graph_projection_checkpoints_tenant_read
  ON public.trade_graph_projection_checkpoints
  FOR SELECT
  TO authenticated
  USING (
    public.diaspora_trade_os_is_tenant_member(public.diaspora_trade_os_current_user_id(), tenant_id)
    OR public.diaspora_trade_os_is_platform_admin()
  );

-- Operator surfaces (processed events, dead letters, rebuild audit): platform admins only.
DROP POLICY IF EXISTS trade_graph_processed_events_admin_read ON public.trade_graph_processed_events;
CREATE POLICY trade_graph_processed_events_admin_read
  ON public.trade_graph_processed_events
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_is_platform_admin());

DROP POLICY IF EXISTS trade_graph_dead_letters_admin_read ON public.trade_graph_dead_letters;
CREATE POLICY trade_graph_dead_letters_admin_read
  ON public.trade_graph_dead_letters
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_is_platform_admin());

DROP POLICY IF EXISTS trade_graph_rebuilds_admin_read ON public.trade_graph_rebuilds;
CREATE POLICY trade_graph_rebuilds_admin_read
  ON public.trade_graph_rebuilds
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_is_platform_admin());

-- ── Grants (REVOKE PUBLIC + GRANT authenticated SELECT / service_role ALL) ────
REVOKE ALL ON TABLE public.trade_graph_nodes FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_edges FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_projection_checkpoints FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_processed_events FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_dead_letters FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_rebuilds FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_materialized_summaries FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE public.trade_graph_nodes TO authenticated;
    GRANT SELECT ON TABLE public.trade_graph_edges TO authenticated;
    GRANT SELECT ON TABLE public.trade_graph_projection_checkpoints TO authenticated;
    GRANT SELECT ON TABLE public.trade_graph_processed_events TO authenticated;
    GRANT SELECT ON TABLE public.trade_graph_dead_letters TO authenticated;
    GRANT SELECT ON TABLE public.trade_graph_rebuilds TO authenticated;
    GRANT SELECT ON TABLE public.trade_graph_materialized_summaries TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.trade_graph_nodes TO service_role;
    GRANT ALL ON TABLE public.trade_graph_edges TO service_role;
    GRANT ALL ON TABLE public.trade_graph_projection_checkpoints TO service_role;
    GRANT ALL ON TABLE public.trade_graph_processed_events TO service_role;
    GRANT ALL ON TABLE public.trade_graph_dead_letters TO service_role;
    GRANT ALL ON TABLE public.trade_graph_rebuilds TO service_role;
    GRANT ALL ON TABLE public.trade_graph_materialized_summaries TO service_role;
  END IF;
END;
$grants$;

-- ── Projection / rebuild RPCs (SECURITY DEFINER, search_path pinned) ─────────
-- These are the ONLY supported entry points for checkpoint advancement and admin rebuild
-- bookkeeping. They are SECURITY DEFINER with SET search_path='public' and are granted EXECUTE
-- to service_role ONLY (mirrors the H7 pattern in 20260621094000). The projection service calls
-- them as service_role; authenticated/anon cannot execute them, so neither AI nor the frontend
-- can advance the projection or trigger a rebuild directly.

CREATE OR REPLACE FUNCTION public.trade_graph_record_checkpoint(
  p_tenant_id uuid,
  p_last_event_id uuid,
  p_last_event_created_at timestamptz,
  p_projection_version text DEFAULT 'trade-graph-projection-v1'
)
RETURNS public.trade_graph_projection_checkpoints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.trade_graph_projection_checkpoints;
BEGIN
  INSERT INTO public.trade_graph_projection_checkpoints AS c
    (tenant_id, last_event_id, last_event_created_at, projection_version)
  VALUES (p_tenant_id, p_last_event_id, p_last_event_created_at, p_projection_version)
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_event_id = EXCLUDED.last_event_id,
        last_event_created_at = EXCLUDED.last_event_created_at,
        projection_version = EXCLUDED.projection_version,
        updated_at = timezone('utc'::text, now())
  RETURNING c.* INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.trade_graph_request_rebuild(
  p_tenant_id uuid,
  p_initiated_by text,
  p_reason text,
  p_min_interval_seconds integer DEFAULT 3600
)
RETURNS public.trade_graph_rebuilds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last timestamptz;
  v_row public.trade_graph_rebuilds;
BEGIN
  -- Rate limit: refuse a new rebuild within p_min_interval_seconds of the last COMPLETED one.
  SELECT max(completed_at) INTO v_last
  FROM public.trade_graph_rebuilds
  WHERE tenant_id = p_tenant_id AND status = 'COMPLETED';

  IF v_last IS NOT NULL
     AND v_last > (timezone('utc'::text, now()) - make_interval(secs => p_min_interval_seconds)) THEN
    INSERT INTO public.trade_graph_rebuilds (tenant_id, initiated_by, reason, status, completed_at)
    VALUES (p_tenant_id, p_initiated_by, p_reason, 'RATE_LIMITED', timezone('utc'::text, now()))
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  INSERT INTO public.trade_graph_rebuilds (tenant_id, initiated_by, reason, status)
  VALUES (p_tenant_id, p_initiated_by, p_reason, 'RUNNING')
  RETURNING * INTO v_row;

  -- Flag the checkpoint for replay; the projection service performs the actual replay.
  UPDATE public.trade_graph_projection_checkpoints
    SET next_replay_required = true,
        replay_count = replay_count + 1,
        updated_at = timezone('utc'::text, now())
  WHERE tenant_id = p_tenant_id;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.trade_graph_record_checkpoint(uuid, uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trade_graph_record_checkpoint(uuid, uuid, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.trade_graph_record_checkpoint(uuid, uuid, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trade_graph_record_checkpoint(uuid, uuid, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.trade_graph_request_rebuild(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trade_graph_request_rebuild(uuid, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.trade_graph_request_rebuild(uuid, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trade_graph_request_rebuild(uuid, text, text, integer) TO service_role;

-- ── Comments ─────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.trade_graph_nodes
  IS 'Phase 10 derived graph nodes. Projected snapshots of authoritative entities; NEVER the source of truth. Service-role writes only; authenticated read via RLS.';
COMMENT ON TABLE public.trade_graph_edges
  IS 'Phase 10 derived graph edges. Each edge derives from a domain event (source_event_ref). AI/frontend never author edges.';
COMMENT ON COLUMN public.trade_graph_edges.source_event_ref
  IS 'Soft reference to domain_events.id that produced this edge. No FK, so the graph remains fully rebuildable from the outbox.';
COMMENT ON COLUMN public.trade_graph_edges.revoked_event_ref
  IS 'Soft reference to domain_events.id that REVOKED (soft-deleted) this edge (e.g. STOCK_RELEASED, QUOTE_REJECTED/EXPIRED, CARGO_RESERVATION_REJECTED, DOCUMENT_REJECTED). NULL while live. The row is never hard-deleted, so audit/replay keep history; traversals exclude deleted_at IS NOT NULL edges.';
COMMENT ON TABLE public.trade_graph_projection_checkpoints
  IS 'Per-tenant idempotent projection checkpoint. next_replay_required drives admin rebuilds.';
COMMENT ON TABLE public.trade_graph_rebuilds
  IS 'Admin-only, rate-limited, auditable graph rebuild history.';
COMMENT ON FUNCTION public.trade_graph_record_checkpoint(uuid, uuid, timestamptz, text)
  IS 'Service-role-only: advance the per-tenant projection checkpoint idempotently.';
COMMENT ON FUNCTION public.trade_graph_request_rebuild(uuid, text, text, integer)
  IS 'Service-role-only: rate-limited admin rebuild request; flags the checkpoint for replay.';

-- +migrate Down
DROP FUNCTION IF EXISTS public.trade_graph_request_rebuild(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.trade_graph_record_checkpoint(uuid, uuid, timestamptz, text);
DROP TABLE IF EXISTS public.trade_graph_materialized_summaries CASCADE;
DROP TABLE IF EXISTS public.trade_graph_rebuilds CASCADE;
DROP TABLE IF EXISTS public.trade_graph_dead_letters CASCADE;
DROP TABLE IF EXISTS public.trade_graph_processed_events CASCADE;
DROP TABLE IF EXISTS public.trade_graph_projection_checkpoints CASCADE;
DROP TABLE IF EXISTS public.trade_graph_edges CASCADE;
DROP TABLE IF EXISTS public.trade_graph_nodes CASCADE;
