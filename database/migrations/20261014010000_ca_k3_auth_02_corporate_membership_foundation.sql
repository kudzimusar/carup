-- +migrate Up
-- CA-K3-AUTH-02 (CA-1.0, Phase A) — the INTERNAL Corporate organisation and membership truth source.
--
-- Answers exactly one question: "does this CarUp account hold a valid internal Corporate membership,
-- and of which accepted internal organisational node?" It does NOT answer what the person may do.
--
--   identity ≠ authority · account ≠ Corporate membership · membership ≠ permission ·
--   permission ≠ scope · tenant membership ≠ Corporate membership · assurance ≠ permission
--
-- An ACTIVE membership grants ZERO Corporate capability by itself. There is no permission, role,
-- capability or grant column here, and none is to be added by this table: permission assignment is a
-- separate, later authority.
--
-- Deliberately separate from — and referencing none of — users.role, user_sessions, tenants,
-- tenant_users, the legacy organizations / organization_users tables, and the
-- legacy_admin_compatibility_bridge. NOTHING in this file reads, writes or backfills any of them, and no
-- real Corporate member is created: the only rows are the accepted organisational reference nodes.
--
-- Authorities: CA-ORG-01 (taxonomy, hierarchy, stable ids), CA-RBAC-01 (membership vs permission vs scope),
-- CA-BU-01 / CA-K3-01-R1 (the four accepted management Business Units; legal status NOT asserted).
-- Applied to staging only by the controlled staging runner, never by this change; never to Production here.

DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'CA-K3-AUTH-02 requires public.users';
  END IF;
END $$;

-- ── Internal organisation nodes ────────────────────────────────────────────────────────────────────
-- A dedicated internal namespace. External participants (dealerships, garages, banks, ...) are never nodes
-- here, whatever tenant membership, portal or API they have.

CREATE TABLE IF NOT EXISTS public.corporate_org_nodes (
  -- A stable, human-meaningful, immutable code (BU_MARKETPLACE, ...), never a generated surrogate: the
  -- four accepted Business Unit ids are fixed by CA-ORG-01 and later authority refers to them by name.
  node_id            TEXT PRIMARY KEY CHECK (node_id ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  entity_type        TEXT NOT NULL CHECK (entity_type IN
                       ('CORPORATE_PARENT', 'LEGAL_ENTITY', 'SUBSIDIARY', 'BUSINESS_UNIT',
                        'CORPORATE_FUNCTION', 'DEPARTMENT', 'TEAM')),
  parent_node_id     TEXT REFERENCES public.corporate_org_nodes(node_id) ON DELETE RESTRICT,
  display_name       TEXT NOT NULL CHECK (BTRIM(display_name) <> ''),
  -- LEGAL_ENTITY and SUBSIDIARY exist only on legal evidence held outside route / product structure.
  -- The type merely being available asserts nothing: no such node is created here.
  legal_evidence_ref TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT corporate_org_nodes_root_has_no_parent
    CHECK ((entity_type = 'CORPORATE_PARENT') = (parent_node_id IS NULL)),
  CONSTRAINT corporate_org_nodes_not_own_parent
    CHECK (parent_node_id IS DISTINCT FROM node_id),
  CONSTRAINT corporate_org_nodes_legal_types_need_evidence
    CHECK (entity_type NOT IN ('LEGAL_ENTITY', 'SUBSIDIARY')
           OR (legal_evidence_ref IS NOT NULL AND BTRIM(legal_evidence_ref) <> ''))
);

-- One consolidated management root.
CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_org_nodes_single_root
  ON public.corporate_org_nodes ((TRUE)) WHERE entity_type = 'CORPORATE_PARENT';
CREATE INDEX IF NOT EXISTS idx_corporate_org_nodes_parent
  ON public.corporate_org_nodes (parent_node_id);

-- The CA-ORG-01 §3 eligible-parent matrix, enforced where the row is written. Corporate Functions are
-- peers that SERVE Business Units: a CORPORATE_FUNCTION is never required to sit under (or may sit under) a
-- BUSINESS_UNIT. Identity and place in the hierarchy never change after creation (so no cycle can form),
-- and a node is never deleted: only its display name may be corrected.
CREATE OR REPLACE FUNCTION public.corporate_org_nodes_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent_type TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CORPORATE_ORG_NODE_DELETE_FORBIDDEN' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.node_id IS DISTINCT FROM OLD.node_id
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
       OR NEW.parent_node_id IS DISTINCT FROM OLD.parent_node_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'CORPORATE_ORG_NODE_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_node_id IS NOT NULL THEN
    SELECT entity_type INTO v_parent_type FROM public.corporate_org_nodes WHERE node_id = NEW.parent_node_id;
    IF v_parent_type IS NULL THEN
      RAISE EXCEPTION 'CORPORATE_ORG_NODE_PARENT_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NOT (CASE NEW.entity_type
              WHEN 'LEGAL_ENTITY'       THEN v_parent_type IN ('CORPORATE_PARENT', 'LEGAL_ENTITY', 'SUBSIDIARY')
              WHEN 'SUBSIDIARY'         THEN v_parent_type IN ('CORPORATE_PARENT', 'LEGAL_ENTITY')
              WHEN 'BUSINESS_UNIT'      THEN v_parent_type IN ('CORPORATE_PARENT', 'LEGAL_ENTITY', 'SUBSIDIARY')
              WHEN 'CORPORATE_FUNCTION' THEN v_parent_type IN ('CORPORATE_PARENT', 'LEGAL_ENTITY', 'SUBSIDIARY')
              WHEN 'DEPARTMENT'         THEN v_parent_type IN ('BUSINESS_UNIT', 'CORPORATE_FUNCTION', 'LEGAL_ENTITY', 'SUBSIDIARY')
              WHEN 'TEAM'               THEN v_parent_type IN ('DEPARTMENT', 'BUSINESS_UNIT', 'CORPORATE_FUNCTION')
              ELSE FALSE
            END) THEN
      RAISE EXCEPTION 'CORPORATE_ORG_NODE_PARENT_TYPE_NOT_ELIGIBLE' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS corporate_org_nodes_guard ON public.corporate_org_nodes;
CREATE TRIGGER corporate_org_nodes_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.corporate_org_nodes
  FOR EACH ROW EXECUTE FUNCTION public.corporate_org_nodes_guard();

-- ── Corporate memberships ──────────────────────────────────────────────────────────────────────────
-- One row = one person's relationship to ONE internal node. A person may hold several (a home unit plus
-- matrix placements); that is a later policy, not constrained here beyond "one live row per person per node".

CREATE TABLE IF NOT EXISTS public.corporate_memberships (
  membership_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  org_node_id        TEXT NOT NULL REFERENCES public.corporate_org_nodes(node_id) ON DELETE RESTRICT,
  -- Exactly four lifecycle states. PENDING and SUSPENDED confer nothing; ENDED confers nothing and is kept.
  state              TEXT NOT NULL CHECK (state IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED')),
  effective_from     TIMESTAMPTZ NOT NULL,
  effective_until    TIMESTAMPTZ,
  -- Creation provenance (immutable): who or what created the relationship, and why.
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_kind    TEXT NOT NULL CHECK (created_by_kind IN ('USER', 'SYSTEM')),
  created_by_user_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  created_reason     TEXT NOT NULL CHECK (BTRIM(created_reason) <> ''),
  created_reference  TEXT,
  -- Change provenance: the latest change, who or what made it, and why.
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_kind    TEXT NOT NULL CHECK (updated_by_kind IN ('USER', 'SYSTEM')),
  updated_by_user_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_reason     TEXT NOT NULL CHECK (BTRIM(updated_reason) <> ''),
  CONSTRAINT corporate_memberships_window_ordered
    CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT corporate_memberships_created_actor_coherent
    CHECK ((created_by_kind = 'USER') = (created_by_user_id IS NOT NULL)),
  CONSTRAINT corporate_memberships_updated_actor_coherent
    CHECK ((updated_by_kind = 'USER') = (updated_by_user_id IS NOT NULL)),
  -- Nobody creates or changes their OWN membership: identity is not authority, and a person is not their
  -- own approver. A SYSTEM actor (a controlled, separately authorised procedure) carries no user id.
  CONSTRAINT corporate_memberships_no_self_provenance
    CHECK (created_by_user_id IS DISTINCT FROM user_id AND updated_by_user_id IS DISTINCT FROM user_id)
);

-- At most one live (not ENDED) row per person per node; an ENDED row never blocks a fresh relationship.
CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_memberships_one_live_per_user_node
  ON public.corporate_memberships (user_id, org_node_id) WHERE state <> 'ENDED';
CREATE INDEX IF NOT EXISTS idx_corporate_memberships_user
  ON public.corporate_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_corporate_memberships_node
  ON public.corporate_memberships (org_node_id);

-- Identity and creation provenance never change; ENDED is terminal (a new relationship is a new row);
-- legal moves are PENDING → ACTIVE | ENDED, ACTIVE → SUSPENDED | ENDED, SUSPENDED → ACTIVE | ENDED;
-- rows are never deleted. Lifecycle is NEVER encoded by touching users.role.
CREATE OR REPLACE FUNCTION public.corporate_memberships_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CORPORATE_MEMBERSHIP_DELETE_FORBIDDEN' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.org_node_id IS DISTINCT FROM OLD.org_node_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by_kind IS DISTINCT FROM OLD.created_by_kind
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_reason IS DISTINCT FROM OLD.created_reason
     OR NEW.created_reference IS DISTINCT FROM OLD.created_reference THEN
    RAISE EXCEPTION 'CORPORATE_MEMBERSHIP_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.state = 'ENDED' THEN
    RAISE EXCEPTION 'CORPORATE_MEMBERSHIP_ENDED_IS_TERMINAL' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'PENDING'   AND NEW.state IN ('ACTIVE', 'ENDED'))
    OR (OLD.state = 'ACTIVE'    AND NEW.state IN ('SUSPENDED', 'ENDED'))
    OR (OLD.state = 'SUSPENDED' AND NEW.state IN ('ACTIVE', 'ENDED'))
  ) THEN
    RAISE EXCEPTION 'CORPORATE_MEMBERSHIP_TRANSITION_NOT_ALLOWED' USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS corporate_memberships_guard ON public.corporate_memberships;
CREATE TRIGGER corporate_memberships_guard
  BEFORE UPDATE OR DELETE ON public.corporate_memberships
  FOR EACH ROW EXECUTE FUNCTION public.corporate_memberships_guard();

COMMENT ON TABLE public.corporate_org_nodes IS
  'CA-K3-AUTH-02 internal Corporate organisation nodes (CA-ORG-01). Not tenants, not external organisations. '
  'LEGAL_ENTITY / SUBSIDIARY require legal evidence; business units are management constructs whose legal status is not asserted.';
COMMENT ON TABLE public.corporate_memberships IS
  'CA-K3-AUTH-02 internal Corporate membership truth source. A relationship between a CarUp account and ONE internal '
  'node. ACTIVE membership grants ZERO Corporate capability: it is only a prerequisite for a future, separate permission '
  'assignment. Never derived from users.role, tenant_users, organization_users or the legacy admin compatibility bridge.';

-- ── Accepted reference nodes (organisation only — NO members, NO legal status asserted) ────────────────
INSERT INTO public.corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES
  ('CARUP_CORPORATE', 'CORPORATE_PARENT', NULL, 'CarUp Corporate')
ON CONFLICT (node_id) DO NOTHING;

INSERT INTO public.corporate_org_nodes (node_id, entity_type, parent_node_id, display_name) VALUES
  ('BU_MARKETPLACE',         'BUSINESS_UNIT', 'CARUP_CORPORATE', 'Marketplace & Vehicle Commerce'),
  ('BU_SERVICE_NETWORK',     'BUSINESS_UNIT', 'CARUP_CORPORATE', 'Garage, Service & Parts'),
  ('BU_FINANCIAL_SERVICES',  'BUSINESS_UNIT', 'CARUP_CORPORATE', 'Finance, Payments & Insurance'),
  ('BU_DIASPORA_TRADE',      'BUSINESS_UNIT', 'CARUP_CORPORATE', 'Diaspora Trade & Logistics')
ON CONFLICT (node_id) DO NOTHING;

-- ── Closed to every client role; the backend (service_role) reads and writes, and cannot delete ─────────
ALTER TABLE public.corporate_org_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_org_nodes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corporate_org_nodes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.corporate_org_nodes TO service_role;

ALTER TABLE public.corporate_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_memberships FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corporate_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.corporate_memberships TO service_role;

REVOKE ALL ON FUNCTION public.corporate_org_nodes_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.corporate_memberships_guard() FROM PUBLIC, anon, authenticated;

-- +migrate Down
DROP TABLE IF EXISTS public.corporate_memberships;
DROP TABLE IF EXISTS public.corporate_org_nodes;
DROP FUNCTION IF EXISTS public.corporate_memberships_guard();
DROP FUNCTION IF EXISTS public.corporate_org_nodes_guard();
