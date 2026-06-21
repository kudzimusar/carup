# Diaspora Phase 10 Trade Graph — Design (workflow-produced, durable, PARTIAL)

> Source: workflow wf_ac6f5c85-12f (graph-schema + projection designs complete; queries, AI/API,
> and synthesis were interrupted by the session limit and must be completed on resume).
> Postgres-first node/edge tables; event-derived & rebuildable; relational tables remain authoritative;
> no graph write bypasses the domain-event source; AI never creates edges.


---

## A. Graph storage schema design

Perfect. I have all the context needed. Now I'll provide the complete Phase 10 Trade Graph Storage Schema design:

---

## PHASE 10 — TRADE GRAPH STORAGE SCHEMA DESIGN

### Overview

This design introduces a **Postgres-first graph projection layer** for Phase 10 (Trade Graph Intelligence). The schema is additive, event-sourced from `domain_events` table (011_phase6_schema.sql), audit-aware via `diaspora_import_audit_log`, and integrated with the AI boundary pattern (diasporaAiCommandService.js). No separate graph DB; all nodes and edges are derived, versioned, tenant-scoped, and soft-deleted. RLS reuses the `diaspora_trade_os_can_access_row()` function from 20260611061849.

---

### 1. TABLES

#### 1.1 `trade_graph_nodes` (canonical entity projection)

```sql
CREATE TABLE IF NOT EXISTS public.trade_graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  node_type text NOT NULL,              -- 'user', 'trade_profile', 'import_order', 'quote', 'stock_item', ...
  entity_type text NOT NULL,            -- Fully qualified entity (directive §53 list)
  entity_id uuid NOT NULL,              -- PK from authoritative table (diaspora_import_orders.id, etc.)
  is_current boolean NOT NULL DEFAULT true,  -- Soft-delete flag; only current=true queried in normal flow
  is_valid boolean NOT NULL DEFAULT true,    -- Deleted_at semantics: invalid if authoritative row deleted
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000,  -- [0.0, 1.0]: projection certainty
  data jsonb NOT NULL DEFAULT '{}'::jsonb,  -- Denormalized snapshot for neighborhood queries (avoid joins)
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT trade_graph_nodes_node_type_chk
    CHECK (node_type IN ('user','tenant','trade_profile','buyer','seller','import_order','quote','stock_item','supply_doc','buyer_order','rfq','container','reservation','shipment','dispute','delivery','reputation_event','drive_file','ai_command','workbook_batch','payment_milestone','compliance_review','document')),
  CONSTRAINT trade_graph_nodes_entity_type_matches_node_type
    CHECK (entity_type = node_type OR entity_type ~ ('^' || node_type || '_.*')),
  CONSTRAINT trade_graph_nodes_dedup
    UNIQUE (tenant_id, node_type, entity_id) WHERE is_current IS TRUE AND deleted_at IS NULL
);

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
```

**Dedup Strategy:** `(tenant_id, node_type, entity_id)` unique constraint (only for current, non-deleted rows) prevents duplicate nodes. Old versions remain in the table (soft-delete via `deleted_at` and `is_current=false`) for audit/replay.

---

#### 1.2 `trade_graph_edges` (relationship projection)

```sql
CREATE TABLE IF NOT EXISTS public.trade_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_node_id uuid NOT NULL REFERENCES public.trade_graph_nodes(id) ON DELETE RESTRICT,
  target_node_id uuid NOT NULL REFERENCES public.trade_graph_nodes(id) ON DELETE RESTRICT,
  edge_type text NOT NULL,             -- 'owns', 'participates_in', 'quotes', 'approves', 'creates', ...
  source_event_ref uuid,               -- Reference to domain_events.id that created this edge
  is_valid boolean NOT NULL DEFAULT true,
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000,  -- [0.0, 1.0]
  policy_version text NOT NULL DEFAULT 'trade-graph-policy-v1',  -- Versioned inference rules
  valid_from timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  valid_until timestamptz,             -- Time-bounded edge (null = indefinite)
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,  -- edge-specific context (amount, reason, etc.)
  CONSTRAINT trade_graph_edges_dedup
    UNIQUE (tenant_id, source_node_id, target_node_id, edge_type, source_event_ref) WHERE deleted_at IS NULL,
  CONSTRAINT trade_graph_edges_no_self_loops
    CHECK (source_node_id <> target_node_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_tenant_source
  ON public.trade_graph_edges (tenant_id, source_node_id, edge_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_tenant_target
  ON public.trade_graph_edges (tenant_id, target_node_id, edge_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_source_target
  ON public.trade_graph_edges (source_node_id, target_node_id)
  WHERE deleted_at IS NULL AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now());

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_event_ref
  ON public.trade_graph_edges (source_event_ref, tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_valid_temporal
  ON public.trade_graph_edges (valid_from, valid_until)
  WHERE deleted_at IS NULL AND is_valid IS TRUE;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_confidence
  ON public.trade_graph_edges (tenant_id, confidence DESC)
  WHERE deleted_at IS NULL AND is_valid IS TRUE;
```

**Dedup Strategy:** `(tenant_id, source_node_id, target_node_id, edge_type, source_event_ref)` unique constraint (only for non-deleted rows) ensures no duplicate edges from the same event. Multiple edges between the same nodes with different `edge_type` or `source_event_ref` are permitted (e.g., buyer of an order AND approved that order).

**No AI-generated edges:** The `source_event_ref` must be set and reference an authoritative `domain_events` row. AI commands never write edges directly; they propose actions that get audited and persisted via domain services.

---

#### 1.3 `trade_graph_projection_checkpoints` (idempotency & rebuild tracking)

```sql
CREATE TABLE IF NOT EXISTS public.trade_graph_projection_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  last_event_id uuid,                  -- Last domain_events.id consumed for this tenant
  last_event_created_at timestamptz,
  projection_version text NOT NULL DEFAULT 'trade-graph-projection-v1',
  dead_letter_count integer NOT NULL DEFAULT 0,  -- Unrecoverable events
  replay_count integer NOT NULL DEFAULT 0,
  next_replay_required boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT trade_graph_projection_checkpoints_dedup
    UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_projection_checkpoints_last_event
  ON public.trade_graph_projection_checkpoints (last_event_created_at DESC)
  WHERE tenant_id IS NOT NULL;
```

**Purpose:** Tracks idempotent event consumption per tenant. On service restart, consumer resumes from `last_event_id`. Dead-letter events are recorded for admin visibility. Rebuild can be triggered by setting `next_replay_required = true`.

---

#### 1.4 `trade_graph_materialized_summaries` (optional, for heavy queries)

```sql
CREATE TABLE IF NOT EXISTS public.trade_graph_materialized_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL REFERENCES public.trade_graph_nodes(id) ON DELETE CASCADE,
  summary_type text NOT NULL,          -- 'neighborhood', 'path_metrics', 'reputation_aggregate'
  in_degree integer NOT NULL DEFAULT 0,
  out_degree integer NOT NULL DEFAULT 0,
  highest_confidence_neighbors jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{node_id, edge_type, confidence}, ...]
  path_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {shortest_to_X: N, ...}
  aggregated_reputation numeric(5,2),
  last_computed_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  valid_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now(),
  CONSTRAINT trade_graph_materialized_summaries_dedup
    UNIQUE (tenant_id, node_id, summary_type) WHERE valid_until IS NULL OR valid_until > now()
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_materialized_summaries_validity
  ON public.trade_graph_materialized_summaries (tenant_id, valid_until DESC)
  WHERE valid_until IS NULL OR valid_until > now();
```

**Purpose:** Optional pre-computed summaries for frequently-accessed neighborhoods or path metrics. Computed by an admin batch job, invalidated on edge changes. Not required for core functionality.

---

### 2. CONSTRAINTS & UNIQUE INDEXES

| Constraint | Table | Purpose |
|-----------|-------|---------|
| `trade_graph_nodes_dedup` | nodes | Prevent duplicate (tenant, type, entity_id) tuples when `is_current=true` and `deleted_at IS NULL` |
| `trade_graph_edges_dedup` | edges | Prevent duplicate (tenant, source, target, type, event_ref) tuples when `deleted_at IS NULL` |
| `trade_graph_edges_no_self_loops` | edges | Enforce acyclic assumption (adjustable per use case) |
| `trade_graph_projection_checkpoints_dedup` | checkpoints | One checkpoint per tenant |
| `trade_graph_node_type_chk` | nodes | Explicit allowlist matching directive §53 entity list |

---

### 3. ROW LEVEL SECURITY (RLS)

All three tables use the **tenant-scoped RLS pattern** from 20260611061849:

```sql
-- Enable RLS
ALTER TABLE public.trade_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_projection_checkpoints ENABLE ROW LEVEL SECURITY;

-- Reuse diaspora_trade_os_can_access_row() helper (defined in 20260611061849)
-- For nodes: check tenant_id
DROP POLICY IF EXISTS trade_graph_nodes_tenant_access ON public.trade_graph_nodes;
CREATE POLICY trade_graph_nodes_tenant_access
  ON public.trade_graph_nodes
  FOR ALL
  TO authenticated
  USING (
    public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL)
    OR EXISTS (SELECT 1 FROM public.diaspora_trade_os_is_platform_admin())
  )
  WITH CHECK (
    public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL)
    OR public.diaspora_trade_os_is_platform_admin()
  );

-- For edges: check tenant_id
DROP POLICY IF EXISTS trade_graph_edges_tenant_access ON public.trade_graph_edges;
CREATE POLICY trade_graph_edges_tenant_access
  ON public.trade_graph_edges
  FOR ALL
  TO authenticated
  USING (
    public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL)
    OR public.diaspora_trade_os_is_platform_admin()
  )
  WITH CHECK (
    public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL)
    OR public.diaspora_trade_os_is_platform_admin()
  );

-- For checkpoints: tenant member or admin only (append-only)
DROP POLICY IF EXISTS trade_graph_projection_checkpoints_tenant_access ON public.trade_graph_projection_checkpoints;
CREATE POLICY trade_graph_projection_checkpoints_tenant_access
  ON public.trade_graph_projection_checkpoints
  FOR SELECT
  TO authenticated
  USING (
    public.diaspora_trade_os_is_tenant_member(
      public.diaspora_trade_os_current_user_id(),
      tenant_id
    )
    OR public.diaspora_trade_os_is_platform_admin()
  );
```

**No direct writes to checkpoints via RLS:** checkpoint mutations happen only via service-role RPCs (projection service).

---

### 4. GRANTS (REVOKE PUBLIC, GRANT service_role + authenticated)

```sql
-- Nodes
REVOKE ALL ON TABLE public.trade_graph_nodes FROM PUBLIC;
DO $nodes_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE public.trade_graph_nodes TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.trade_graph_nodes TO service_role;
  END IF;
END;
$nodes_grant$;

-- Edges
REVOKE ALL ON TABLE public.trade_graph_edges FROM PUBLIC;
DO $edges_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE public.trade_graph_edges TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.trade_graph_edges TO service_role;
  END IF;
END;
$edges_grant$;

-- Checkpoints (append-only for authenticated; full for service_role)
REVOKE ALL ON TABLE public.trade_graph_projection_checkpoints FROM PUBLIC;
DO $checkpoints_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE public.trade_graph_projection_checkpoints TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.trade_graph_projection_checkpoints TO service_role;
  END IF;
END;
$checkpoints_grant$;

-- Materialized summaries (read-only for authenticated; write for service_role)
REVOKE ALL ON TABLE public.trade_graph_materialized_summaries FROM PUBLIC;
DO $summaries_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE public.trade_graph_materialized_summaries TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.trade_graph_materialized_summaries TO service_role;
  END IF;
END;
$summaries_grant$;
```

---

### 5. SOFT-DELETE SEMANTICS

Both nodes and edges support **logical deletion** without data loss:

- **Nodes:** `deleted_at IS NOT NULL` marks deletion; `is_current=false` marks superseded versions (from replays). Queries filter by `deleted_at IS NULL AND is_current=true` by default.
- **Edges:** `deleted_at IS NOT NULL` marks revoked relationships. Temporal validity (`valid_until`) allows time-bounded edges (e.g., lease expiry, quote expiration).

**Audit Trail:** Every node/edge change is logged via:
1. **Event source:** The originating `domain_events` row (immutable, source of truth).
2. **Audit log:** If the mutation was triggered by a user action, `diaspora_import_audit_log` captures actor/action/previous/new state.
3. **Graph checkpoint:** Projection version and last-consumed-event for replays.

---

### 6. MIGRATION FILE

**Filename:** `20260621140000_diaspora_phase10_trade_graph.sql`

```sql
-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Phase 10: Trade Graph Storage Schema
--
-- Event-sourced graph projection layer for trade intelligence.
-- Nodes = authoritative entities (immutable copies); Edges = inferred relationships
-- from domain_events. No AI mutations; all edges derive from domain events. RLS via
-- diaspora_trade_os_can_access_row() from Phase 1B (20260611061849).
--
-- Additive, reversible, idempotent. Soft-delete semantics (deleted_at, is_current).
-- All writes by service_role (projection service); authenticated reads only via RLS.
-- NOT applied to production by this program.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Updated-at trigger helper (reuse Phase 1B) ──
-- (Assumes public.set_diaspora_trade_os_updated_at() exists from 20260611061849)

-- ── Table: trade_graph_nodes (entity projection snapshot) ──
CREATE TABLE IF NOT EXISTS public.trade_graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  node_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  is_valid boolean NOT NULL DEFAULT true,
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT trade_graph_nodes_node_type_chk
    CHECK (node_type IN ('user','tenant','trade_profile','buyer','seller','import_order','quote','stock_item','supply_doc','buyer_order','rfq','container','reservation','shipment','dispute','delivery','reputation_event','drive_file','ai_command','workbook_batch','payment_milestone','compliance_review','document')),
  CONSTRAINT trade_graph_nodes_dedup
    UNIQUE (tenant_id, node_type, entity_id) WHERE is_current IS TRUE AND deleted_at IS NULL
);

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

-- ── Table: trade_graph_edges (relationship projection) ──
CREATE TABLE IF NOT EXISTS public.trade_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_node_id uuid NOT NULL REFERENCES public.trade_graph_nodes(id) ON DELETE RESTRICT,
  target_node_id uuid NOT NULL REFERENCES public.trade_graph_nodes(id) ON DELETE RESTRICT,
  edge_type text NOT NULL,
  source_event_ref uuid,
  is_valid boolean NOT NULL DEFAULT true,
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000,
  policy_version text NOT NULL DEFAULT 'trade-graph-policy-v1',
  valid_from timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT trade_graph_edges_dedup
    UNIQUE (tenant_id, source_node_id, target_node_id, edge_type, source_event_ref) WHERE deleted_at IS NULL,
  CONSTRAINT trade_graph_edges_no_self_loops
    CHECK (source_node_id <> target_node_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_tenant_source
  ON public.trade_graph_edges (tenant_id, source_node_id, edge_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_tenant_target
  ON public.trade_graph_edges (tenant_id, target_node_id, edge_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_source_target
  ON public.trade_graph_edges (source_node_id, target_node_id)
  WHERE deleted_at IS NULL AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now());

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_event_ref
  ON public.trade_graph_edges (source_event_ref, tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_valid_temporal
  ON public.trade_graph_edges (valid_from, valid_until)
  WHERE deleted_at IS NULL AND is_valid IS TRUE;

CREATE INDEX IF NOT EXISTS idx_trade_graph_edges_confidence
  ON public.trade_graph_edges (tenant_id, confidence DESC)
  WHERE deleted_at IS NULL AND is_valid IS TRUE;

-- ── Table: trade_graph_projection_checkpoints (idempotency & rebuild) ──
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
  CONSTRAINT trade_graph_projection_checkpoints_dedup
    UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_projection_checkpoints_last_event
  ON public.trade_graph_projection_checkpoints (last_event_created_at DESC)
  WHERE tenant_id IS NOT NULL;

-- ── Table: trade_graph_materialized_summaries (optional pre-computed stats) ──
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
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT trade_graph_materialized_summaries_dedup
    UNIQUE (tenant_id, node_id, summary_type) WHERE valid_until IS NULL OR valid_until > now()
);

CREATE INDEX IF NOT EXISTS idx_trade_graph_materialized_summaries_validity
  ON public.trade_graph_materialized_summaries (tenant_id, valid_until DESC)
  WHERE valid_until IS NULL OR valid_until > now();

-- ── Updated-at triggers ──
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

DROP TRIGGER IF EXISTS set_trade_graph_summaries_updated_at ON public.trade_graph_materialized_summaries;
CREATE TRIGGER set_trade_graph_summaries_updated_at
  BEFORE UPDATE ON public.trade_graph_materialized_summaries
  FOR EACH ROW EXECUTE FUNCTION public.set_diaspora_trade_os_updated_at();

-- ── Row Level Security ──
ALTER TABLE public.trade_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_projection_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_graph_materialized_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_graph_nodes_tenant_access ON public.trade_graph_nodes;
CREATE POLICY trade_graph_nodes_tenant_access
  ON public.trade_graph_nodes
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL) OR public.diaspora_trade_os_is_platform_admin())
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL) OR public.diaspora_trade_os_is_platform_admin());

DROP POLICY IF EXISTS trade_graph_edges_tenant_access ON public.trade_graph_edges;
CREATE POLICY trade_graph_edges_tenant_access
  ON public.trade_graph_edges
  FOR ALL
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL) OR public.diaspora_trade_os_is_platform_admin())
  WITH CHECK (public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL) OR public.diaspora_trade_os_is_platform_admin());

DROP POLICY IF EXISTS trade_graph_projection_checkpoints_tenant_access ON public.trade_graph_projection_checkpoints;
CREATE POLICY trade_graph_projection_checkpoints_tenant_access
  ON public.trade_graph_projection_checkpoints
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_is_tenant_member(public.diaspora_trade_os_current_user_id(), tenant_id) OR public.diaspora_trade_os_is_platform_admin());

DROP POLICY IF EXISTS trade_graph_materialized_summaries_tenant_access ON public.trade_graph_materialized_summaries;
CREATE POLICY trade_graph_materialized_summaries_tenant_access
  ON public.trade_graph_materialized_summaries
  FOR SELECT
  TO authenticated
  USING (public.diaspora_trade_os_can_access_row(tenant_id, NULL, NULL) OR public.diaspora_trade_os_is_platform_admin());

-- ── Grants (REVOKE PUBLIC + GRANT authenticated/service_role) ──
REVOKE ALL ON TABLE public.trade_graph_nodes FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_edges FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_projection_checkpoints FROM PUBLIC;
REVOKE ALL ON TABLE public.trade_graph_materialized_summaries FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE public.trade_graph_nodes TO authenticated;
    GRANT SELECT ON TABLE public.trade_graph_edges TO authenticated;
    GRANT SELECT ON TABLE public.trade_graph_projection_checkpoints TO authenticated;
    GRANT SELECT ON TABLE public.trade_graph_materialized_summaries TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.trade_graph_nodes TO service_role;
    GRANT ALL ON TABLE public.trade_graph_edges TO service_role;
    GRANT ALL ON TABLE public.trade_graph_projection_checkpoints TO service_role;
    GRANT ALL ON TABLE public.trade_graph_materialized_summaries TO service_role;
  END IF;
END;
$grants$;

-- +migrate Down
DROP TABLE IF EXISTS public.trade_graph_materialized_summaries CASCADE;
DROP TABLE IF EXISTS public.trade_graph_projection_checkpoints CASCADE;
DROP TABLE IF EXISTS public.trade_graph_edges CASCADE;
DROP TABLE IF EXISTS public.trade_graph_nodes CASCADE;
```

---

### 7. INTEGRATION POINTS (Existing Patterns)

**Event Outbox (domain_events):** Projection service subscribes to `domain_events` (via eventWorker.js) and emits:
- `TRADE_GRAPH_NODE_PROJECTED` — when a new/updated node is written
- `TRADE_GRAPH_EDGE_PROJECTED` — when a new/updated edge is written
- `TRADE_GRAPH_PROJECTION_REPLAY_TRIGGERED` — for checkpoint recovery

**Audit Source (diaspora_import_audit_log):** High-risk mutations (e.g., user-initiated graph queries for regulatory export, admin replay) are logged with `resource_type='trade_graph_projection'`, allowing forensic reconstruction.

**AI Boundary (diasporaAiCommandService.js):** AI commands that propose graph mutations (e.g., "connect seller to buyer order") create a command record with `execution_status=DRAFT` → `AWAITING_CONFIRMATION` → executed via an RPC that writes the nodes/edges AND the audit record atomically.

---

### 8. BUILDABLE COLUMN DETAIL SUMMARY

| Table | Column | Type | Constraint | Notes |
|-------|--------|------|-----------|-------|
| nodes | id | uuid PK | gen_random_uuid() | |
| | tenant_id | uuid | NOT NULL | RLS scoped |
| | node_type | text | CHECK in allowlist | Per directive §53 |
| | entity_id | uuid | NOT NULL | FK to authoritative table PK |
| | is_current | boolean | NOT NULL DEFAULT true | Soft-delete; only current=true in queries |
| | is_valid | boolean | NOT NULL DEFAULT true | Authoritative row still exists |
| | confidence | numeric(5,4) | NOT NULL DEFAULT 1.0 | [0.0, 1.0] |
| | data | jsonb | NOT NULL DEFAULT '{}' | Denormalized snapshot |
| | deleted_at | timestamptz | NULL | Soft-delete marker |
| | created_at, updated_at | timestamptz | NOT NULL DEFAULT now() | Updated via trigger |
| | | | UNIQUE (tenant_id, node_type, entity_id) | Only current non-deleted rows |
| edges | id | uuid PK | gen_random_uuid() | |
| | tenant_id | uuid | NOT NULL | RLS scoped |
| | source_node_id, target_node_id | uuid | FK to nodes | |
| | edge_type | text | NOT NULL | Relationship type (user-defined) |
| | source_event_ref | uuid | NULL | References domain_events.id |
| | is_valid, confidence, policy_version | (see above) | | Immutable after creation |
| | valid_from, valid_until | timestamptz | NOT NULL, NULL | Time-bounded edges |
| | deleted_at | timestamptz | NULL | Soft-delete marker |
| | metadata | jsonb | NOT NULL DEFAULT '{}' | Edge-specific context |
| | | | UNIQUE (tenant, source, target, type, event_ref) | Only non-deleted rows |
| | | | CHECK source <> target | No self-loops |
| checkpoints | id, tenant_id, last_event_id | uuid, uuid, uuid | | Idempotency tracking |
| | projection_version, dead_letter_count | text, int | | Versioning & replay auditing |
| | next_replay_required | boolean | NOT NULL DEFAULT false | Admin rebuild trigger |
| summaries | id, tenant_id, node_id | uuid, uuid, uuid | | Stats cache |
| | summary_type, in_degree, out_degree | text, int, int | | Neighborhood metrics |
| | valid_until | timestamptz | NULL | Expiry for cache invalidation |

---

### 9. DEPLOYMENT & TESTING

1. **Migration Apply:** Run against staging `eoyenigwevnxwwhyhaer` only.
2. **RLS Validation:** Verify users see only their tenant's nodes/edges via `SELECT count(*) FROM trade_graph_nodes WHERE tenant_id = $1`.
3. **Dedup Test:** Insert duplicate (tenant, type, entity_id) → expect constraint violation.
4. **Event Correlation:** Confirm `source_event_ref` matches a row in `domain_events`.
5. **Soft-Delete Verification:** Mark a node as `deleted_at := now()` → verify RLS filters it out.
6. **Temporal Edge:** Create edges with `valid_until < now()` → verify queries ignore expired edges.

---

### Summary

This Phase 10 schema provides a **tenant-scoped, event-sourced, audit-aware graph storage layer** that:
- Reuses existing infra (RLS helpers, audit, event bus, AI boundary).
- Deduplicates nodes by `(tenant_id, type, entity_id)` and edges by `(tenant_id, source, target, type, event_ref)`.
- Supports soft deletes and temporal validity.
- Is never mutated by AI; all graph changes derive from domain events.
- Indexes for tenant/source/target/type traversal and temporal queries.
- Ready for materialized summaries and recursive CTE-based neighborhood/path queries.

---

## B. Event-driven projection design

Perfect. Now I have enough context. Let me draft the comprehensive event-driven projection design spec:

---

## EVENT-DRIVEN TRADE GRAPH PROJECTION DESIGN SPECIFICATION

### EXECUTIVE SUMMARY

This spec defines the Phase 10 projection system for deriving a `trade_graph_nodes` and `trade_graph_edges` from Postgres `domain_events` (the authoritative outbox) and `diaspora_import_audit_log` (compliance audit source). The system enforces: **idempotent consumption**, **no direct graph write from frontend/AI**, **versioned projections**, **tenant partitioning**, **dead-letter visibility**, and **admin-only rate-limited rebuilds**. Implementation is **Postgres-native**: nodes/edges are stored as relational tables (not a separate graph DB); a dedicated `diasporaTradeGraphProjectionService` extends the existing `eventWorker` architecture to consume events, while domain services emit structured events that are never written to the graph directly.

---

### PART 1: DOMAIN MODEL & EVENT SCHEMA

#### 1.1 Canonical Entities (from §53 + 013_diaspora_trade_schema.sql)

Graph nodes represent these domain entities. **Node types** exactly match domain tables:

| Node Type | Source Table | Key Fields | Status Field |
| --- | --- | --- | --- |
| `USER` | users | id, email, created_at | (no status) |
| `TENANT` | tenants | id, name | status |
| `TRADE_PROFILE` | diaspora_trade_profiles | id, user_id, role_type, country | verification_status |
| `BUYER` | diaspora_import_orders (participant role=buyer) | user_id, order_id | verification_status |
| `SELLER` | diaspora_import_orders (participant role=seller) | user_id, order_id | verification_status |
| `BUYER_ORDER` | diaspora_import_orders | id, buyer_id, status | status |
| `SELLER_STOCK_ITEM` | diaspora_stock_items | id, seller_trade_profile_id | publication_status, verification_status |
| `RFQ` | diaspora_import_quotes | id, import_order_id | status |
| `ACCEPTED_QUOTE` | diaspora_import_quotes (status=ACCEPTED) | id, import_order_id, seller_id | status |
| `SUPPLY_DOCUMENT` | diaspora_supply_documents | id, seller_trade_profile_id | verification_status |
| `CONTAINER` | diaspora_container_shipments | id, coordinator_id | status |
| `CARGO_RESERVATION` | diaspora_cargo_reservations | id, import_order_id, container_id | reservation_status |
| `SHIPMENT` | diaspora_shipments | id, import_order_id, container_id | status |
| `DOCUMENT` | diaspora_trade_documents | id, import_order_id, uploaded_by | verification_status |
| `COMPLIANCE_REVIEW` | diaspora_compliance_reviews | id, import_order_id | status |
| `PAYMENT_MILESTONE` | diaspora_payment_milestones | id, import_order_id | status |
| `REPUTATION_RECORD` | diaspora_reputation_records | id, trade_profile_id | verification_status |
| `SAFETRADE_TRANSACTION` | diaspora_safetrade_transactions (Phase 9) | id, import_order_id | status |
| `DRIVE_FILE` | diaspora_drive_files | id, entity_id, connection_id | sync_status |
| `AI_COMMAND` | diaspora_ai_commands | id, requested_by | execution_status |
| `WORKBOOK_BATCH` | diaspora_workbook_import_batches | id, uploaded_by | status |

#### 1.2 Canonical Edge Types (from §54 + design intent)

Edges represent relationships. **Edge source** is always an event (not direct graph write).

| Edge Type | From → To | Meaning | Source Event(s) |
| --- | --- | --- | --- |
| `CREATED_BY` | USER → TRADE_PROFILE, BUYER_ORDER, etc. | Actor created entity | `*_CREATED` domain events |
| `BELONGS_TO_TENANT` | * → TENANT | Entity scoped to tenant | Domain event with tenant_id |
| `HAS_TRADE_PROFILE` | USER → TRADE_PROFILE | User has profile in country/role | `TRADE_PROFILE_CREATED` |
| `INITIATED_ORDER` | BUYER → BUYER_ORDER | Buyer requests order | `IMPORT_ORDER_CREATED` |
| `QUOTED_ON` | SELLER → RFQ | Seller issued quote | `QUOTE_ISSUED` |
| `ACCEPTED_QUOTE` | BUYER_ORDER → ACCEPTED_QUOTE | Order accepts a quote | `QUOTE_ACCEPTED` |
| `SUPPLIES` | SELLER_STOCK_ITEM → BUYER_ORDER | Stock item fulfills order | `STOCK_RESERVED` (via domain event) |
| `DOCUMENTS` | DOCUMENT → BUYER_ORDER | Document attached to order | `DOCUMENT_UPLOADED` |
| `RESERVES_CONTAINER` | CARGO_RESERVATION → CONTAINER | Reservation books space | `CARGO_RESERVATION_CREATED` |
| `FULFILLS_ORDER` | SHIPMENT → BUYER_ORDER | Shipment carries order | `SHIPMENT_CREATED` |
| `REVIEWS_COMPLIANCE` | COMPLIANCE_REVIEW → BUYER_ORDER | Compliance check for order | `COMPLIANCE_REVIEW_CREATED` |
| `REFERENCES_PROFILE` | REPUTATION_RECORD → TRADE_PROFILE | Rating assigned to profile | `REPUTATION_RECORD_CREATED` |
| `VERIFIES_DOCUMENT` | USER → DOCUMENT | User verified document (reviewer) | `DOCUMENT_VERIFIED` |
| `CONDUCTS_TRANSACTION` | SAFETRADE_TRANSACTION → BUYER_ORDER | SafeTrade governs order flow | `SAFETRADE_TRANSACTION_CREATED` |
| `SYNCED_TO_DRIVE` | DRIVE_FILE → DOCUMENT, BUYER_ORDER | File mirrored to Drive | `DRIVE_FILE_SYNCED` |
| `AI_COMMAND_FOR` | AI_COMMAND → BUYER_ORDER, SELLER_STOCK_ITEM | Command targets entity | `AI_COMMAND_CREATED` |

---

### PART 2: CANONICAL EVENT TYPES & MAPPING

#### 2.1 diasporaEventTypes Enum

Grouped by aggregate root:

```javascript
// backend/constants/diaspora/diasporaEventTypes.js
export const DIASPORA_EVENT_TYPES = Object.freeze({
  // Trade Profiles
  TRADE_PROFILE_CREATED: 'TRADE_PROFILE_CREATED',
  TRADE_PROFILE_UPDATED: 'TRADE_PROFILE_UPDATED',
  TRADE_PROFILE_VERIFIED: 'TRADE_PROFILE_VERIFIED',
  TRADE_PROFILE_FLAGGED: 'TRADE_PROFILE_FLAGGED',
  
  // Buyer Orders (diaspora_import_orders)
  IMPORT_ORDER_CREATED: 'IMPORT_ORDER_CREATED',
  IMPORT_ORDER_STATUS_CHANGED: 'IMPORT_ORDER_STATUS_CHANGED',
  IMPORT_ORDER_PARTICIPANTS_ADDED: 'IMPORT_ORDER_PARTICIPANTS_ADDED',
  IMPORT_ORDER_FLAGGED: 'IMPORT_ORDER_FLAGGED',
  
  // Quotes
  QUOTE_ISSUED: 'QUOTE_ISSUED',
  QUOTE_ACCEPTED: 'QUOTE_ACCEPTED',
  QUOTE_REJECTED: 'QUOTE_REJECTED',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  
  // Stock
  STOCK_ITEM_CREATED: 'STOCK_ITEM_CREATED',
  STOCK_ITEM_UPDATED: 'STOCK_ITEM_UPDATED',
  STOCK_RESERVED: 'STOCK_RESERVED',
  STOCK_RELEASED: 'STOCK_RELEASED',
  STOCK_VERIFICATION_CHANGED: 'STOCK_VERIFICATION_CHANGED',
  
  // Documents
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_VERIFIED: 'DOCUMENT_VERIFIED',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',
  
  // Containers & Cargo
  CONTAINER_CREATED: 'CONTAINER_CREATED',
  CONTAINER_STATUS_CHANGED: 'CONTAINER_STATUS_CHANGED',
  CARGO_RESERVATION_REQUESTED: 'CARGO_RESERVATION_REQUESTED',
  CARGO_RESERVATION_APPROVED: 'CARGO_RESERVATION_APPROVED',
  CARGO_RESERVATION_REJECTED: 'CARGO_RESERVATION_REJECTED',
  
  // Shipments
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  SHIPMENT_STATUS_CHANGED: 'SHIPMENT_STATUS_CHANGED',
  SHIPMENT_STAGE_EVENT: 'SHIPMENT_STAGE_EVENT',
  
  // Compliance & Reputation
  COMPLIANCE_REVIEW_CREATED: 'COMPLIANCE_REVIEW_CREATED',
  COMPLIANCE_REVIEW_UPDATED: 'COMPLIANCE_REVIEW_UPDATED',
  REPUTATION_RECORD_CREATED: 'REPUTATION_RECORD_CREATED',
  REPUTATION_RECORD_FLAGGED: 'REPUTATION_RECORD_FLAGGED',
  
  // Payment Milestones
  PAYMENT_MILESTONE_CREATED: 'PAYMENT_MILESTONE_CREATED',
  PAYMENT_MILESTONE_STATUS_CHANGED: 'PAYMENT_MILESTONE_STATUS_CHANGED',
  
  // SafeTrade (Phase 9)
  SAFETRADE_TRANSACTION_CREATED: 'SAFETRADE_TRANSACTION_CREATED',
  SAFETRADE_TRANSACTION_STATUS_CHANGED: 'SAFETRADE_TRANSACTION_STATUS_CHANGED',
  
  // Drive
  DRIVE_FILE_SYNCED: 'DRIVE_FILE_SYNCED',
  DRIVE_CONNECTION_CREATED: 'DRIVE_CONNECTION_CREATED',
  
  // AI Commands
  AI_COMMAND_CREATED: 'AI_COMMAND_CREATED',
  AI_COMMAND_EXECUTED: 'AI_COMMAND_EXECUTED',
  
  // Workbook
  WORKBOOK_BATCH_IMPORTED: 'WORKBOOK_BATCH_IMPORTED',
});

// Union type for discriminator
export const DIASPORA_EVENT_TYPE_SET = new Set(Object.values(DIASPORA_EVENT_TYPES));
```

#### 2.2 Event → Node/Edge Projection Mapping Table

Central mapping registry: **no hardcoded if-else chains in the projector**.

```javascript
// backend/services/diaspora/diasporaTradeGraphProjectionMappings.js
import { DIASPORA_EVENT_TYPES } from '../../constants/diaspora/diasporaEventTypes.js';

export const EVENT_PROJECTION_MAP = Object.freeze({
  // Trade Profile created → create TRADE_PROFILE node + USER edge
  [DIASPORA_EVENT_TYPES.TRADE_PROFILE_CREATED]: {
    nodeOperations: [
      {
        operation: 'CREATE_OR_UPDATE_NODE',
        nodeType: 'TRADE_PROFILE',
        idSelector: (e) => e.payload.trade_profile_id,
        attributes: {
          userId: (e) => e.payload.user_id,
          roleType: (e) => e.payload.role_type,
          country: (e) => e.payload.country,
          city: (e) => e.payload.city,
          verificationStatus: (e) => e.payload.verification_status,
          trustScore: (e) => e.payload.trust_score ?? 50,
        },
      },
    ],
    edgeOperations: [
      {
        operation: 'CREATE_EDGE',
        edgeType: 'HAS_TRADE_PROFILE',
        fromNodeType: 'USER',
        fromId: (e) => e.payload.user_id,
        toNodeType: 'TRADE_PROFILE',
        toId: (e) => e.payload.trade_profile_id,
      },
      {
        operation: 'CREATE_EDGE',
        edgeType: 'BELONGS_TO_TENANT',
        fromNodeType: 'TRADE_PROFILE',
        fromId: (e) => e.payload.trade_profile_id,
        toNodeType: 'TENANT',
        toId: (e) => e.tenant_id,
      },
      {
        operation: 'CREATE_EDGE',
        edgeType: 'CREATED_BY',
        fromNodeType: 'USER',
        fromId: (e) => e.payload.created_by,
        toNodeType: 'TRADE_PROFILE',
        toId: (e) => e.payload.trade_profile_id,
      },
    ],
  },
  
  [DIASPORA_EVENT_TYPES.IMPORT_ORDER_CREATED]: {
    nodeOperations: [
      {
        operation: 'CREATE_OR_UPDATE_NODE',
        nodeType: 'BUYER_ORDER',
        idSelector: (e) => e.payload.order_id,
        attributes: {
          buyerId: (e) => e.payload.buyer_id,
          status: (e) => e.payload.status,
          orderType: (e) => e.payload.order_type,
          originCountry: (e) => e.payload.origin_country,
          destinationCountry: (e) => e.payload.destination_country,
        },
      },
    ],
    edgeOperations: [
      {
        operation: 'CREATE_EDGE',
        edgeType: 'INITIATED_ORDER',
        fromNodeType: 'BUYER',
        fromId: (e) => e.payload.buyer_id,
        toNodeType: 'BUYER_ORDER',
        toId: (e) => e.payload.order_id,
      },
      {
        operation: 'CREATE_EDGE',
        edgeType: 'BELONGS_TO_TENANT',
        fromNodeType: 'BUYER_ORDER',
        fromId: (e) => e.payload.order_id,
        toNodeType: 'TENANT',
        toId: (e) => e.tenant_id,
      },
    ],
  },
  
  [DIASPORA_EVENT_TYPES.QUOTE_ISSUED]: {
    nodeOperations: [
      {
        operation: 'CREATE_OR_UPDATE_NODE',
        nodeType: 'RFQ',
        idSelector: (e) => e.payload.quote_id,
        attributes: {
          importOrderId: (e) => e.payload.order_id,
          sellerId: (e) => e.payload.seller_id,
          status: (e) => e.payload.status,
          amount: (e) => e.payload.quote_amount,
          currency: (e) => e.payload.quote_currency,
        },
      },
    ],
    edgeOperations: [
      {
        operation: 'CREATE_EDGE',
        edgeType: 'QUOTED_ON',
        fromNodeType: 'SELLER',
        fromId: (e) => e.payload.seller_id,
        toNodeType: 'RFQ',
        toId: (e) => e.payload.quote_id,
      },
    ],
  },
  
  [DIASPORA_EVENT_TYPES.QUOTE_ACCEPTED]: {
    nodeOperations: [
      {
        operation: 'CREATE_OR_UPDATE_NODE',
        nodeType: 'ACCEPTED_QUOTE',
        idSelector: (e) => e.payload.quote_id,
        attributes: {
          quoteId: (e) => e.payload.quote_id,
          importOrderId: (e) => e.payload.order_id,
          sellerId: (e) => e.payload.seller_id,
          status: (e) => 'ACCEPTED',
        },
      },
    ],
    edgeOperations: [
      {
        operation: 'CREATE_EDGE',
        edgeType: 'ACCEPTED_QUOTE',
        fromNodeType: 'BUYER_ORDER',
        fromId: (e) => e.payload.order_id,
        toNodeType: 'ACCEPTED_QUOTE',
        toId: (e) => e.payload.quote_id,
      },
    ],
  },
  
  [DIASPORA_EVENT_TYPES.DOCUMENT_UPLOADED]: {
    nodeOperations: [
      {
        operation: 'CREATE_OR_UPDATE_NODE',
        nodeType: 'DOCUMENT',
        idSelector: (e) => e.payload.document_id,
        attributes: {
          importOrderId: (e) => e.payload.order_id,
          documentType: (e) => e.payload.document_type,
          uploadedBy: (e) => e.payload.uploaded_by,
          verificationStatus: (e) => e.payload.verification_status,
        },
      },
    ],
    edgeOperations: [
      {
        operation: 'CREATE_EDGE',
        edgeType: 'DOCUMENTS',
        fromNodeType: 'DOCUMENT',
        fromId: (e) => e.payload.document_id,
        toNodeType: 'BUYER_ORDER',
        toId: (e) => e.payload.order_id,
      },
    ],
  },
  
  // ... additional mappings for stock, containers, shipments, compliance, reputation, etc.
});
```

---

### PART 3: PROJECTION SERVICE ARCHITECTURE

#### 3.1 Module: `diasporaTradeGraphProjectionService.js`

The core service extends the singleton `eventWorker` architecture with graph-specific logic.

```javascript
// backend/services/diaspora/diasporaTradeGraphProjectionService.js

import { logger } from '../../utils/logger.js';
import { supabase } from '../../db/supabase.js';
import { metricsHub } from '../metrics.js';
import { EVENT_PROJECTION_MAP } from './diasporaTradeGraphProjectionMappings.js';
import { DIASPORA_EVENT_TYPE_SET } from '../../constants/diaspora/diasporaEventTypes.js';

export class DiasporaTradeGraphProjectionService {
  constructor() {
    this.eventProcessedSet = new Set(); // in-memory dedup for this session
  }

  /**
   * Projection Consumer: called by eventWorker for each domain_events record.
   * Idempotent: dedup by event_id; never mutate the graph without consulting EVENT_PROJECTION_MAP.
   * 
   * @param {object} eventPayload - payload from domain_events.payload JSONB
   * @param {object} pgClient - raw PG client from eventWorker transaction
   * @param {string} tenantId - from domain_events.tenant_id
   * @param {string} eventId - from domain_events.id (dedup key)
   * @param {string} eventType - from domain_events.event_type
   */
  async projectEvent(eventPayload, pgClient, tenantId, eventId, eventType) {
    // Dedup: check processed_events table for prior success
    const existing = await pgClient.query(
      `SELECT id FROM trade_graph_processed_events WHERE event_id = $1`,
      [eventId]
    );
    if (existing.rows.length > 0) {
      logger.info('GRAPH', `Event ${eventId} already projected (idempotent skip).`, { eventId, eventType });
      return { idempotentReplay: true };
    }

    // Discard unknown event types
    if (!DIASPORA_EVENT_TYPE_SET.has(eventType)) {
      logger.warn('GRAPH', `Unmapped event type: ${eventType}. Skipping projection.`, { eventId, eventType });
      return { skipped: true, reason: 'unmapped_event_type' };
    }

    const mapping = EVENT_PROJECTION_MAP[eventType];
    if (!mapping) {
      logger.warn('GRAPH', `No projection mapping for ${eventType}.`, { eventId });
      return { skipped: true, reason: 'no_mapping' };
    }

    let nodeResults = [];
    let edgeResults = [];
    const startMs = Date.now();

    try {
      // Execute node operations (idempotent upsert)
      if (mapping.nodeOperations) {
        for (const nodeOp of mapping.nodeOperations) {
          const result = await this.executeNodeOperation(nodeOp, eventPayload, pgClient, tenantId);
          nodeResults.push(result);
        }
      }

      // Execute edge operations (create if not exists)
      if (mapping.edgeOperations) {
        for (const edgeOp of mapping.edgeOperations) {
          const result = await this.executeEdgeOperation(edgeOp, eventPayload, pgClient, tenantId);
          edgeResults.push(result);
        }
      }

      // Mark event as processed (idempotent guard)
      await pgClient.query(
        `INSERT INTO trade_graph_processed_events (event_id, event_type, tenant_id, projection_version, projected_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, eventType, tenantId, 1] // version 1 for now; bump when schema changes
      );

      const elapsedMs = Date.now() - startMs;
      logger.info('GRAPH', `Projected ${eventType} in ${elapsedMs}ms`, {
        eventId,
        eventType,
        nodesCreated: nodeResults.length,
        edgesCreated: edgeResults.length,
        durationMs: elapsedMs,
        tenantId,
      });

      metricsHub.recordGraphProjection(eventType, elapsedMs, 'success');

      return { success: true, nodes: nodeResults, edges: edgeResults, durationMs: elapsedMs };

    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      logger.error('GRAPH', `Projection failed for ${eventType}: ${err.message}`, {
        eventId,
        eventType,
        error: err,
        durationMs: elapsedMs,
      });

      metricsHub.recordGraphProjection(eventType, elapsedMs, 'failure');

      // Write dead-letter record for visibility
      await this.writeDeadLetter(eventId, eventType, tenantId, eventPayload, err, pgClient);

      throw err; // Let eventWorker handle retry/final failure
    }
  }

  /**
   * Execute a node operation (CREATE_OR_UPDATE_NODE).
   * Upsert into trade_graph_nodes: idempotent by (tenant_id, node_type, node_id).
   */
  async executeNodeOperation(op, eventPayload, pgClient, tenantId) {
    if (op.operation !== 'CREATE_OR_UPDATE_NODE') throw new Error(`Unknown node operation: ${op.operation}`);

    const nodeId = op.idSelector(eventPayload);
    const nodeType = op.nodeType;

    // Build attributes object from selector functions
    const attributes = {};
    if (op.attributes) {
      for (const [key, selector] of Object.entries(op.attributes)) {
        attributes[key] = typeof selector === 'function' ? selector(eventPayload) : selector;
      }
    }

    const result = await pgClient.query(
      `INSERT INTO trade_graph_nodes (tenant_id, node_type, node_id, attributes, projected_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (tenant_id, node_type, node_id) DO UPDATE
         SET attributes = COALESCE(EXCLUDED.attributes, trade_graph_nodes.attributes),
             projected_at = NOW()
       RETURNING id`,
      [tenantId, nodeType, nodeId, JSON.stringify(attributes)]
    );

    return { nodeType, nodeId, id: result.rows[0].id };
  }

  /**
   * Execute an edge operation (CREATE_EDGE).
   * Insert into trade_graph_edges: idempotent by (tenant_id, from_node_id, edge_type, to_node_id).
   */
  async executeEdgeOperation(op, eventPayload, pgClient, tenantId) {
    if (op.operation !== 'CREATE_EDGE') throw new Error(`Unknown edge operation: ${op.operation}`);

    const edgeType = op.edgeType;
    const fromId = op.fromId(eventPayload);
    const toId = op.toId(eventPayload);
    const fromNodeType = op.fromNodeType;
    const toNodeType = op.toNodeType;

    const result = await pgClient.query(
      `INSERT INTO trade_graph_edges 
       (tenant_id, from_node_type, from_node_id, edge_type, to_node_type, to_node_id, attributes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '{}', NOW())
       ON CONFLICT (tenant_id, from_node_id, edge_type, to_node_id) DO NOTHING
       RETURNING id`,
      [tenantId, fromNodeType, fromId, edgeType, toNodeType, toId]
    );

    return { 
      edgeType, 
      from: `${fromNodeType}:${fromId}`, 
      to: `${toNodeType}:${toId}`,
      created: result.rows.length > 0,
      id: result.rows[0]?.id,
    };
  }

  /**
   * Write a dead-letter record for failed projections.
   * Visible to operators for debugging and manual intervention.
   */
  async writeDeadLetter(eventId, eventType, tenantId, eventPayload, error, pgClient) {
    await pgClient.query(
      `INSERT INTO trade_graph_dead_letters (event_id, event_type, tenant_id, payload, error_message, error_stack, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (event_id) DO UPDATE
         SET error_message = EXCLUDED.error_message,
             error_stack = EXCLUDED.error_stack,
             retry_count = retry_count + 1`,
      [eventId, eventType, tenantId, JSON.stringify(eventPayload), error.message, error.stack]
    );
  }

  /**
   * Admin command: rebuild the entire trade graph for a tenant.
   * Rate-limited, auditable, and only for platform admins.
   * Deletes prior graph and replays all domain_events in order.
   */
  async rebuildTenantGraph(tenantId, options = {}) {
    const { userId = 'system', reason = 'manual_admin_rebuild' } = options;
    const startMs = Date.now();

    const client = await supabase.rpc('get_raw_pg_client'); // hypothetical; adjust per your setup
    try {
      await client.query('BEGIN');

      // Guard: rate limiting (no rebuild within 1 hour of last rebuild for same tenant)
      const lastRebuild = await client.query(
        `SELECT created_at FROM trade_graph_rebuilds 
         WHERE tenant_id = $1 AND status = 'COMPLETED'
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId]
      );
      if (lastRebuild.rows.length > 0) {
        const lastTime = new Date(lastRebuild.rows[0].created_at);
        const msSinceLastRebuild = Date.now() - lastTime;
        if (msSinceLastRebuild < 3600000) { // 1 hour
          throw new Error(`Rebuild already run within the last hour. Next allowed: ${new Date(lastTime.getTime() + 3600000).toISOString()}`);
        }
      }

      // Audit: record the rebuild intent
      const rebuildId = await client.query(
        `INSERT INTO trade_graph_rebuilds (tenant_id, initiated_by, reason, status, started_at)
         VALUES ($1, $2, $3, 'RUNNING', NOW())
         RETURNING id`,
        [tenantId, userId, reason]
      );

      // Clear prior projection state for this tenant
      await client.query(`DELETE FROM trade_graph_nodes WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM trade_graph_edges WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM trade_graph_processed_events WHERE tenant_id = $1`, [tenantId]);

      // Replay all events in order, tenant-scoped
      const events = await client.query(
        `SELECT id, event_type, payload, tenant_id, created_at FROM domain_events
         WHERE tenant_id = $1 AND status IN ('processed', 'pending')
         ORDER BY created_at ASC`,
        [tenantId]
      );

      let successCount = 0;
      let failCount = 0;

      for (const event of events.rows) {
        try {
          await this.projectEvent(event.payload, client, event.tenant_id, event.id, event.event_type);
          successCount++;
        } catch (err) {
          failCount++;
          logger.error('GRAPH', `Rebuild: event ${event.id} failed: ${err.message}`, { eventId: event.id, eventType: event.event_type });
        }
      }

      // Mark rebuild as complete
      await client.query(
        `UPDATE trade_graph_rebuilds SET status = 'COMPLETED', completed_at = NOW(), nodes_rebuilt = $1, events_failed = $2
         WHERE id = $3`,
        [successCount, failCount, rebuildId.rows[0].id]
      );

      await client.query('COMMIT');

      const elapsedMs = Date.now() - startMs;
      logger.info('GRAPH', `Rebuild completed for tenant ${tenantId}: ${successCount} events, ${failCount} failures in ${elapsedMs}ms`, {
        tenantId,
        successCount,
        failCount,
        durationMs: elapsedMs,
      });

      metricsHub.recordGraphRebuild(tenantId, successCount, failCount, elapsedMs);

      return { 
        success: true, 
        tenantId, 
        eventsProcessed: successCount, 
        eventsFailed: failCount, 
        durationMs: elapsedMs,
      };

    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('GRAPH', `Rebuild failed for tenant ${tenantId}: ${err.message}`, { tenantId, error: err });
      throw err;
    } finally {
      client.release();
    }
  }
}

// Singleton instance
export const diasporaTradeGraphProjection = new DiasporaTradeGraphProjectionService();
```

#### 3.2 Integration with eventWorker

The projection service is registered as a subscriber in the existing `eventWorker`:

```javascript
// In backend/server.js or backend/services/eventBus/eventWorker.js (initialization)

import { diasporaTradeGraphProjection } from '../services/diaspora/diasporaTradeGraphProjectionService.js';
import { DIASPORA_EVENT_TYPE_SET } from '../constants/diaspora/diasporaEventTypes.js';

// Subscribe to all diaspora trade events
for (const eventType of DIASPORA_EVENT_TYPE_SET) {
  eventWorker.subscribe(eventType, async (eventPayload, pgClient, tenantId) => {
    const eventId = eventPayload.event_id || eventPayload.id; // adjust per your domain_events shape
    await diasporaTradeGraphProjection.projectEvent(
      eventPayload,
      pgClient,
      tenantId,
      eventId,
      eventType
    );
  });
}
```

---

### PART 4: DATABASE SCHEMA (MIGRATIONS)

#### 4.1 Trade Graph Nodes & Edges Tables

```sql
-- YYYYMMDDHHMMSS_trade_graph_nodes_edges.sql

-- +migrate Up

-- Trade graph nodes (derived from domain entities)
CREATE TABLE IF NOT EXISTS trade_graph_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL, -- USER, TRADE_PROFILE, BUYER_ORDER, SELLER_STOCK_ITEM, etc.
  node_id TEXT NOT NULL, -- foreign key value (user.id, order.id, etc.)
  attributes JSONB NOT NULL DEFAULT '{}', -- node metadata (status, roles, scores, etc.)
  projected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, node_type, node_id),
  CHECK (node_type IN (
    'USER', 'TENANT', 'TRADE_PROFILE', 'BUYER', 'SELLER', 'BUYER_ORDER',
    'SELLER_STOCK_ITEM', 'RFQ', 'ACCEPTED_QUOTE', 'SUPPLY_DOCUMENT',
    'CONTAINER', 'CARGO_RESERVATION', 'SHIPMENT', 'DOCUMENT',
    'COMPLIANCE_REVIEW', 'PAYMENT_MILESTONE', 'REPUTATION_RECORD',
    'SAFETRADE_TRANSACTION', 'DRIVE_FILE', 'AI_COMMAND', 'WORKBOOK_BATCH'
  ))
);

CREATE INDEX idx_trade_graph_nodes_tenant ON trade_graph_nodes(tenant_id);
CREATE INDEX idx_trade_graph_nodes_type ON trade_graph_nodes(node_type);
CREATE INDEX idx_trade_graph_nodes_projected ON trade_graph_nodes(projected_at DESC);

-- Trade graph edges (relationships between nodes)
CREATE TABLE IF NOT EXISTS trade_graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_node_type TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  to_node_type TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}', -- edge metadata (weights, evidence, timestamps)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, from_node_id, edge_type, to_node_id),
  CHECK (edge_type IN (
    'CREATED_BY', 'BELONGS_TO_TENANT', 'HAS_TRADE_PROFILE', 'INITIATED_ORDER',
    'QUOTED_ON', 'ACCEPTED_QUOTE', 'SUPPLIES', 'DOCUMENTS', 'RESERVES_CONTAINER',
    'FULFILLS_ORDER', 'REVIEWS_COMPLIANCE', 'REFERENCES_PROFILE', 'VERIFIES_DOCUMENT',
    'CONDUCTS_TRANSACTION', 'SYNCED_TO_DRIVE', 'AI_COMMAND_FOR'
  ))
);

CREATE INDEX idx_trade_graph_edges_tenant ON trade_graph_edges(tenant_id);
CREATE INDEX idx_trade_graph_edges_from ON trade_graph_edges(tenant_id, from_node_id, edge_type);
CREATE INDEX idx_trade_graph_edges_to ON trade_graph_edges(tenant_id, to_node_id);
CREATE INDEX idx_trade_graph_edges_created ON trade_graph_edges(created_at DESC);

-- Processed events: idempotent dedup
CREATE TABLE IF NOT EXISTS trade_graph_processed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  tenant_id UUID,
  projection_version INTEGER NOT NULL DEFAULT 1,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trade_graph_processed_tenant ON trade_graph_processed_events(tenant_id);

-- Dead-letter queue for projection failures
CREATE TABLE IF NOT EXISTS trade_graph_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  tenant_id UUID,
  payload JSONB NOT NULL,
  error_message TEXT,
  error_stack TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_retry_at TIMESTAMPTZ
);

CREATE INDEX idx_trade_graph_dead_letters_tenant ON trade_graph_dead_letters(tenant_id);
CREATE INDEX idx_trade_graph_dead_letters_created ON trade_graph_dead_letters(created_at DESC);

-- Rebuild audit trail (admin-only, rate-limited)
CREATE TABLE IF NOT EXISTS trade_graph_rebuilds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  initiated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  nodes_rebuilt INTEGER,
  events_failed INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trade_graph_rebuilds_tenant ON trade_graph_rebuilds(tenant_id, created_at DESC);

-- RLS: All graph tables scoped to tenant + service_role only
ALTER TABLE trade_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_graph_processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_graph_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_graph_rebuilds ENABLE ROW LEVEL SECURITY;

-- Platform admin only for rebuild operations
CREATE POLICY diaspora_graph_rebuild_admin ON trade_graph_rebuilds
  FOR ALL USING (
    EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' IN ('admin', 'platform_admin'))
  );

-- Service role grant (projector runs as service_role)
GRANT SELECT, INSERT, UPDATE, DELETE ON trade_graph_nodes, trade_graph_edges,
  trade_graph_processed_events, trade_graph_dead_letters, trade_graph_rebuilds
TO service_role;

-- +migrate Down

DROP INDEX IF EXISTS idx_trade_graph_rebuilds_tenant;
DROP INDEX IF EXISTS idx_trade_graph_dead_letters_created;
DROP INDEX IF EXISTS idx_trade_graph_dead_letters_tenant;
DROP INDEX IF EXISTS idx_trade_graph_processed_tenant;
DROP INDEX IF EXISTS idx_trade_graph_edges_created;
DROP INDEX IF EXISTS idx_trade_graph_edges_to;
DROP INDEX IF EXISTS idx_trade_graph_edges_from;
DROP INDEX IF EXISTS idx_trade_graph_edges_tenant;
DROP INDEX IF EXISTS idx_trade_graph_nodes_projected;
DROP INDEX IF EXISTS idx_trade_graph_nodes_type;
DROP INDEX IF EXISTS idx_trade_graph_nodes_tenant;

DROP TABLE IF EXISTS trade_graph_rebuilds CASCADE;
DROP TABLE IF EXISTS trade_graph_dead_letters CASCADE;
DROP TABLE IF EXISTS trade_graph_processed_events CASCADE;
DROP TABLE IF EXISTS trade_graph_edges CASCADE;
DROP TABLE IF EXISTS trade_graph_nodes CASCADE;
```

---

### PART 5: EVENT EMISSION FROM DOMAIN SERVICES

#### 5.1 Pattern: Structured Event Emission

All domain services that mutate state MUST emit structured domain events via `emitDomainEvent()` (existing in `eventBusService.js`). AI commands and frontends never write to `domain_events` directly.

**Example from `diasporaTradeProfileService.js`:**

```javascript
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { DIASPORA_EVENT_TYPES } from '../../constants/diaspora/diasporaEventTypes.js';

export async function createTradeProfile(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);

  const row = {
    tenant_id: context.tenantId,
    user_id: context.id,
    role_type: payload.role_type,
    country: payload.country,
    city: payload.city,
    verification_status: 'PENDING_REVIEW',
    trust_score: 50,
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from('diaspora_trade_profiles').insert(row).select().single();
  if (error) throw new ValidationError(`Failed: ${error.message}`);

  // Emit structured event for graph projection
  await emitDomainEvent(
    null, // pgClient; null here = use Supabase fallback (could be passed if in transaction)
    DIASPORA_EVENT_TYPES.TRADE_PROFILE_CREATED,
    {
      trade_profile_id: data.id,
      user_id: data.user_id,
      role_type: data.role_type,
      country: data.country,
      city: data.city,
      verification_status: data.verification_status,
      trust_score: data.trust_score,
      created_by: data.created_by,
    },
    context.tenantId
  );

  await appendAudit(client, {
    actorId: context.id,
    tenantId: data.tenant_id,
    action: 'TRADE_PROFILE_CREATED',
    resourceType: 'diaspora_trade_profile',
    resourceId: data.id,
    newState: data,
    req: options.req || null,
  });

  return data;
}
```

**Example from `diasporaImportOrderService.js` (order creation):**

```javascript
export async function createImportOrder(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);

  const row = {
    tenant_id: context.tenantId,
    buyer_id: context.id,
    order_type: payload.order_type || 'vehicle',
    origin_country: payload.origin_country,
    status: IMPORT_ORDER_STATUSES.IMPORT_REQUESTED,
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from('diaspora_import_orders').insert(row).select().single();
  if (error) throw new ValidationError(`Failed: ${error.message}`);

  // Emit event
  await emitDomainEvent(
    null,
    DIASPORA_EVENT_TYPES.IMPORT_ORDER_CREATED,
    {
      order_id: data.id,
      buyer_id: data.buyer_id,
      order_type: data.order_type,
      origin_country: data.origin_country,
      status: data.status,
    },
    context.tenantId
  );

  await appendAudit(client, { /* ... */ });
  return data;
}

export async function transitionImportOrder(orderId, nextStatus, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  
  const previous = await getImportOrder(orderId, context, options);
  
  // Validate transition
  if (!IMPORT_ORDER_TRANSITIONS[previous.status]?.includes(nextStatus)) {
    throw new ValidationError(`Illegal transition: ${previous.status} -> ${nextStatus}`);
  }

  const { data, error } = await client.from('diaspora_import_orders')
    .update({ status: nextStatus, updated_by: context.id, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new ValidationError(`Failed: ${error.message}`);

  // Emit status change event
  await emitDomainEvent(
    null,
    DIASPORA_EVENT_TYPES.IMPORT_ORDER_STATUS_CHANGED,
    {
      order_id: data.id,
      previous_status: previous.status,
      status: nextStatus,
      buyer_id: data.buyer_id,
    },
    context.tenantId
  );

  await appendAudit(client, { /* ... */ });
  return data;
}
```

#### 5.2 Forbidden: Direct Graph Writes

Frontend code **never** writes to `trade_graph_nodes` or `trade_graph_edges`.
AI service (`diasporaAiCommandService.js`) **never** writes to `trade_graph_*` tables; only generates domain events via domain services.

**Code smell to prevent:**
```javascript
// FORBIDDEN: direct graph mutation
❌ await supabase.from('trade_graph_nodes').insert({ ... });
❌ await supabase.from('trade_graph_edges').insert({ ... });

// CORRECT: emit domain event (service layer only)
✓ await emitDomainEvent(null, DIASPORA_EVENT_TYPES.STOCK_ITEM_CREATED, { ... }, tenantId);
```

---

### PART 6: DECISION: EXTEND eventWorker vs DEDICATED PROJECTOR

**Decision: EXTEND eventWorker (existing singleton).**

**Rationale:**
1. **Reuse existing infrastructure**: `eventWorker` already has singleton polling, `FOR UPDATE SKIP LOCKED` concurrency safety, retry logic, metrics, logging.
2. **Single outbox consumer pattern**: All subscribers (graph projection, notifications, AI preprocessing, etc.) share the same transactional event stream; no race conditions.
3. **Simpler deployment**: No separate service/deployment boundary for the projector.
4. **Idempotency via same transaction**: Projection dedup (`trade_graph_processed_events`) is written in the same ACID transaction as the projection itself.

**Alternative (rejected):** A dedicated `diasporaGraphProjector` microservice would add operational complexity (separate startup, health checks, Kafka/RabbitMQ coupling) without clear benefit for this scale.

---

### PART 7: API & ADMIN ENDPOINTS

#### 7.1 Projection Status & Rebuild

```javascript
// backend/routes/diasporaGraphRoutes.js

import express from 'express';
import { diasporaTradeGraphProjection } from '../services/diaspora/diasporaTradeGraphProjectionService.js';
import { authorizeRole } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * GET /api/diaspora/graph/health
 * Check projection health (dedup table size, dead-letter count, last rebuild).
 */
router.get('/health', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('trade_graph_processed_events')
      .select('count', { count: 'exact' });
    const { data: deadLetters, error: dlErr } = await supabase
      .from('trade_graph_dead_letters')
      .select('count', { count: 'exact' });
    const { data: lastRebuild } = await supabase
      .from('trade_graph_rebuilds')
      .select('completed_at, nodes_rebuilt, events_failed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    res.json({
      status: 'healthy',
      projectedEventsCount: data?.count || 0,
      deadLettersCount: deadLetters?.count || 0,
      lastRebuild: lastRebuild || null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/diaspora/graph/dead-letters
 * List projection dead letters (admin only).
 */
router.get('/dead-letters', authorizeRole(['admin', 'platform_admin', 'reviewer']), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('trade_graph_dead_letters')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/diaspora/graph/rebuild-tenant
 * Trigger a full graph rebuild for a tenant (admin only, rate-limited).
 */
router.post('/rebuild-tenant', authorizeRole(['admin', 'platform_admin']), async (req, res, next) => {
  try {
    const { tenantId, reason } = req.body;
    if (!tenantId) return res.status(400).json({ error: 'tenantId required' });

    const result = await diasporaTradeGraphProjection.rebuildTenantGraph(tenantId, {
      userId: req.user?.id || 'system',
      reason: reason || 'admin_manual_rebuild',
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
```

---

### PART 8: GUARANTEES & NON-NEGOTIABLES

1. **No AI or Frontend Graph Writes**: `domain_events` is the sole entry point for graph mutations. Frontend may emit events only through domain service APIs (which emit events).

2. **Idempotent Projection**: Event processed by event_id; dedup table prevents duplicate nodes/edges. Safe for eventWorker retry.

3. **Tenant Partitioning**: Every node/edge is scoped to `tenant_id`. RLS prevents cross-tenant leakage.

4. **Dead-Letter Visibility**: Failed projections → `trade_graph_dead_letters` for operator inspection and manual recovery.

5. **Versioned Projection**: `trade_graph_processed_events.projection_version` allows schema migrations without losing history. Rebuild bumps version, replays with new logic.

6. **Audit Trail**: Graph rebuilds are recorded in `trade_graph_rebuilds` with actor, reason, start/end times, success/failure counts.

7. **Postgres-Native Graph**: No separate graph DB. CTEs enable recursive queries; materialized views provide performance. All data lives in single Postgres instance.

---

### PART 9: IMPLEMENTATION CHECKLIST

- [ ] Define `diasporaEventTypes.js` enum with all event types (§2.1).
- [ ] Create `diasporaTradeGraphProjectionMappings.js` with full mapping table (§2.2).
- [ ] Implement `diasporaTradeGraphProjectionService.js` with `projectEvent()`, `rebuildTenantGraph()`, dead-letter handling (§3.1).
- [ ] Write migration: `trade_graph_nodes`, `trade_graph_edges`, `trade_graph_processed_events`, `trade_graph_dead_letters`, `trade_graph_rebuilds` tables + indexes + RLS (§4.1).
- [ ] Update `eventWorker` to subscribe to all DIASPORA_EVENT_TYPE_SET (§3.2).
- [ ] Emit `DIASPORA_EVENT_TYPES.*` from all domain services: trade profiles, orders, quotes, stock, documents, containers, shipments, compliance, reputation, etc. (§5.1).
- [ ] Add API routes for `/graph/health`, `/graph/dead-letters`, `/graph/rebuild-tenant` (§7.1).
- [ ] Add test: idempotent projection, dedup, edge creation, dead-letter on failure, rebuild (unit + integration).
- [ ] Verify: no direct INSERT/UPDATE to `trade_graph_*` outside projector (code review guard).
- [ ] Document in API docs: graph schema, event types, rebuild procedure.

---

### FILE PATHS & MODULE LOCATIONS

| Module | Path |
| --- | --- |
| Event type enum | `/backend/constants/diaspora/diasporaEventTypes.js` |
| Projection mappings | `/backend/services/diaspora/diasporaTradeGraphProjectionMappings.js` |
| Projection service | `/backend/services/diaspora/diasporaTradeGraphProjectionService.js` |
| Graph routes | `/backend/routes/diasporaGraphRoutes.js` |
| Migration | `/database/migrations/YYYYMMDDHHMMSS_trade_graph_nodes_edges.sql` |
| Event bus (existing) | `/backend/services/eventBus/eventBusService.js` (reuse) |
| Event worker (existing) | `/backend/services/eventBus/eventWorker.js` (extend) |
| Domain services | `/backend/services/diaspora/diaspora*Service.js` (emit events) |

---

### DEPLOYMENT & OPERATIONAL NOTES

1. **Staging First**: Deploy migration + projection service to staging (`eoyenigwevnxwwhyhaer`) before production.
2. **Backfill**: After migration, manually trigger `POST /api/diaspora/graph/rebuild-tenant` for each existing tenant to bootstrap the graph.
3. **Monitoring**: Track `metricsHub.recordGraphProjection()` calls; alert on dead-letter growth.
4. **Rate Limiting**: Rebuild endpoint is limited to once per hour per tenant (enforced in `rebuildTenantGraph`).
5. **Versioning**: When mappings change, increment `projection_version` in `trade_graph_processed_events` to force selective replay.

---

## C. Explainable queries design — PENDING (session limit; redo on resume)

## D. AI-ready context + redaction + intelligence + dashboard API — PENDING (session limit; redo on resume)

## E. Synthesis (build-ready ordered spec) — PENDING (session limit; redo on resume)
