-- +migrate Up
-- CA-K3-AUTH-04 (CA-1.0, Phase C) — the PERSISTENT Corporate permission-assignment authority and the DB-trusted evaluator.
--
-- WHAT THIS CLOSES. CERT-03 proved, and the Phase-B headers say, that Phase B validated the SHAPE of a caller-supplied
-- "target_corporate_governance" snapshot but could not authenticate who produced it: a holder of service_role could hand-craft a
-- structurally valid snapshot and mutate membership. Here authority stops being something a caller SAYS and becomes something the
-- database LOOKS UP: a decision is derived, inside the transaction, from ACTIVE and currently-effective permission assignments.
--
--   identity ≠ authority · membership ≠ permission · permission ≠ scope · tenant / legacy role ≠ Corporate authority ·
--   a caller-supplied JSON object ≠ a decision
--
-- WHAT IS ADDED (additive: Phase A and Phase B are NOT rewritten; their objects and ledgers are reused unchanged)
--   corporate_permission_assignments        one row = ONE atomic approved authority: subject · ONE stable capability · internal
--                                           organisational scope · effective period · assurance floor · request/approval lineage ·
--                                           lifecycle state REQUESTED → APPROVED → ACTIVE → SUSPENDED / REVOKED / EXPIRED
--   corporate_permission_assignment_events  append-only lifecycle history, written only by a trigger in the same transaction
--   corporate_permission_assignment_effective  the ONLY rows that can take part in a decision (ACTIVE, inside the window, underlying
--                                           membership ACTIVE and effective, assurance floor satisfiable today)
--   corporate_authority_evaluate(...)       the trusted evaluator (read-only). Each required capability must be covered, on its own,
--                                           by ONE assignment for the exact node: grants are never combined (no cross-grant synthesis)
--   corporate_authority_apply_direct / _request_submit / _request_decide / _request_execute / _request_cancel
--                                           the ONLY entry points service_role may now execute. They take NO decision from the caller:
--                                           they lock and evaluate the persistent authority, build the decision projection themselves,
--                                           and hand it to the unchanged Phase-B procedures, so the Phase-B ledgers record a decision
--                                           (with assignment ids) that was generated from verified authority.
--
-- WHAT IS REVOKED. service_role loses EXECUTE on the five Phase-B snapshot-taking procedures. They remain in the database as the
-- internal layer the wrappers call (owner-only); nothing a client can send reaches them with a hand-written decision any more.
--
-- GOVERNANCE CONTINUITY (the two-independent-governor minimum) is no longer an attestation in the request: for END the database
-- counts the independent governors that would remain, from the same persistent assignments.
--
-- WHAT THIS DOES NOT DO. It creates NO assignment, member, administrator, bootstrap principal or backfill; it reads no users.role,
-- tenant_users, organization_users, legacy bridge state, title or navigation; it adds no route, no grant-administration procedure and
-- no UI (assignments can only be written by the table OWNER, through the lifecycle guard — the governed administration path is a
-- later, separately authorised slice, and it needs an Owner decision on who the first access administrator is, OD-CARBAC-002).
-- Data classification, geography and delegation are not modelled yet: only the two capabilities Phase B needs can be assigned.
-- A2 does not exist: an assignment whose floor is A2_STRONG is stored but inert. Never applied to staging or Production here.
--
-- TIME. PostgreSQL pins now() at the START of the transaction. Every time rule must therefore be judged against the wall clock, and no
-- time rule below the entry points may be judged against an old instant: the assignment and membership windows here use clock_timestamp(),
-- and the entry points refuse to run in a transaction older than corporate_authority_max_transaction_age() (5 s) — which bounds the
-- Phase-B rules that still read now() (the A1 window, the approval and request lifetimes, session expiry) without rewriting Phase B. A
-- caller that holds a transaction open past a deadline and then calls is refused (TRANSACTION_STALE); an assignment whose period has
-- really ended can not authorize inside such a transaction either. Proved on a real server, including a 31-minute real-time run.
--
-- Residual trust, stated plainly: the database proves that the NAMED account currently holds the authority and a live A1 session
-- row; which human is behind that account is still established by the backend's session authentication, and service_role can write
-- user_sessions today. A holder of service_role can therefore still ASSUME THE IDENTITY of an existing governor (by writing a session
-- row for it) — but can no longer manufacture authority: it cannot create a governor, widen a scope or extend a period, and maker/checker
-- still needs two distinct governor identities. Moving session issuance out of service_role's reach is a separate, later slice.

DO $$
BEGIN
  IF to_regclass('public.corporate_org_nodes') IS NULL
     OR to_regclass('public.corporate_memberships') IS NULL
     OR to_regclass('public.corporate_membership_events') IS NULL
     OR to_regclass('public.corporate_membership_requests') IS NULL
     OR to_regclass('public.corporate_membership_request_steps') IS NULL
     OR to_regprocedure('public.corporate_custody_truncate_guard()') IS NULL
     OR to_regprocedure('public.corporate_governance_policy()') IS NULL
     OR to_regprocedure('public.corporate_governance_check_decision(jsonb, text, text, text, boolean, boolean)') IS NULL
     OR to_regprocedure('public.corporate_membership_apply_direct(text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, text, jsonb, jsonb)') IS NULL
     OR to_regprocedure('public.corporate_membership_request_submit(text, uuid, text, text, text, text, jsonb)') IS NULL
     OR to_regprocedure('public.corporate_membership_request_decide(uuid, text, text, text, text, text, uuid, text, text, text, jsonb)') IS NULL
     OR to_regprocedure('public.corporate_membership_request_execute(uuid, text, text, text, jsonb)') IS NULL
     OR to_regprocedure('public.corporate_membership_request_cancel(uuid, text, text, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'CA-K3-AUTH-04 requires the accepted Phase-A (20261014010000) and Phase-B (20261014020000) migrations';
  END IF;
END $$;

-- ── The assignable capability vocabulary ───────────────────────────────────────────────────────────────────────
-- Canonical names from CA-RBAC-01 §6.2 (<plane>.<domain>.<resource>.<action>). Only what runtime evaluation needs TODAY can be
-- assigned: assigning any other capability would need data-classification / geography semantics that are not modelled here.
CREATE OR REPLACE FUNCTION public.corporate_authority_grantable_capabilities()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY['corporate.people.membership.manage', 'corporate.people.session.revoke']::text[];
$$;

-- How old a transaction may be when a governed call reaches its authority check. A legitimate call is one RPC in its own short transaction
-- (milliseconds); lock waits count, so a call that queued for seconds behind a revocation is asked to retry rather than judged against a stale clock.
CREATE OR REPLACE FUNCTION public.corporate_authority_max_transaction_age()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT interval '5 seconds';
$$;

-- Does a scope (explicit nodes, optionally their descendants) cover THIS node? Explicit nodes only unless include_descendants is
-- part of the grant (CA-RBAC-01 §10.1); a parent never crosses into siblings, and nothing is inherited upward.
CREATE OR REPLACE FUNCTION public.corporate_authority_scope_covers(p_scope text[], p_include_descendants boolean, p_node text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_node IS NOT NULL AND p_scope IS NOT NULL AND (
    p_node = ANY (p_scope)
    OR (COALESCE(p_include_descendants, FALSE) AND EXISTS (
         WITH RECURSIVE up(node_id, parent_node_id, depth) AS (
           SELECT n.node_id, n.parent_node_id, 0 FROM public.corporate_org_nodes n WHERE n.node_id = p_node
           UNION ALL
           SELECT n.node_id, n.parent_node_id, up.depth + 1
             FROM public.corporate_org_nodes n JOIN up ON n.node_id = up.parent_node_id WHERE up.depth < 16)
         SELECT 1 FROM up WHERE up.node_id = ANY (p_scope)))
  );
$$;

-- ── The permission assignment: ONE atomic approved authority ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.corporate_permission_assignments (
  assignment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id      TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  -- The underlying Corporate membership. Permission is persisted SEPARATELY from membership, but it only ever works while that
  -- membership is ACTIVE and effective: end or suspend the membership and every assignment that rests on it stops, at once.
  membership_id        UUID NOT NULL REFERENCES public.corporate_memberships(membership_id) ON DELETE RESTRICT,
  capability           TEXT NOT NULL CHECK (capability = ANY (public.corporate_authority_grantable_capabilities())),
  -- Internal organisational scope. include_descendants must be explicit; there is no GLOBAL and no wildcard.
  scope_node_ids       TEXT[] NOT NULL,
  include_descendants  BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from       TIMESTAMPTZ NOT NULL,
  -- No open-ended privileged assignment: the end of the period is always explicit (CA-RBAC-01 safe default: no indefinite authority).
  effective_until      TIMESTAMPTZ NOT NULL,
  -- The assurance FLOOR this one grant demands. A1 is the lowest the governance capabilities allow; A2_STRONG does not exist yet,
  -- so an A2 assignment can be recorded but can never authorize (the evaluator never downgrades a floor).
  assurance_floor      TEXT NOT NULL CHECK (assurance_floor IN ('A1_RECENT_REAUTH', 'A2_STRONG')),
  -- Request / approval lineage (immutable once written).
  requested_by_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_reason       TEXT NOT NULL CHECK (BTRIM(request_reason) <> '' AND length(request_reason) <= 2000),
  request_reference    TEXT NOT NULL CHECK (BTRIM(request_reference) <> '' AND length(request_reference) <= 300),
  approved_by_user_id  TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at          TIMESTAMPTZ,
  activated_by_user_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  activated_at         TIMESTAMPTZ,
  -- The lifecycle (the only mutable part) and the provenance of its latest change.
  state                TEXT NOT NULL CHECK (state IN ('REQUESTED', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_kind      TEXT NOT NULL CHECK (updated_by_kind IN ('USER', 'SYSTEM')),
  updated_by_user_id   TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_reason       TEXT NOT NULL CHECK (BTRIM(updated_reason) <> '' AND length(updated_reason) <= 2000),
  updated_reference    TEXT CHECK (updated_reference IS NULL OR length(updated_reference) <= 300),
  CONSTRAINT corporate_permission_assignments_event_anchor UNIQUE (assignment_id, subject_user_id, capability),
  CONSTRAINT corporate_permission_assignments_window_ordered CHECK (effective_until > effective_from),
  CONSTRAINT corporate_permission_assignments_scope_shape CHECK (cardinality(scope_node_ids) BETWEEN 1 AND 16),
  CONSTRAINT corporate_permission_assignments_updated_actor_coherent CHECK ((updated_by_kind = 'USER') = (updated_by_user_id IS NOT NULL)),
  -- Nobody approves their own request, nobody approves or activates access for themselves.
  CONSTRAINT corporate_permission_assignments_no_self_grant
    CHECK (approved_by_user_id IS DISTINCT FROM subject_user_id AND approved_by_user_id IS DISTINCT FROM requested_by_user_id
           AND activated_by_user_id IS DISTINCT FROM subject_user_id),
  CONSTRAINT corporate_permission_assignments_lineage_pairs
    CHECK ((approved_by_user_id IS NULL) = (approved_at IS NULL) AND (activated_by_user_id IS NULL) = (activated_at IS NULL)
           AND (activated_by_user_id IS NULL OR approved_by_user_id IS NOT NULL)),
  -- A grant that is, or has been, in force carries the lineage that put it there.
  CONSTRAINT corporate_permission_assignments_lineage_shape CHECK (
       (state = 'REQUESTED' AND approved_by_user_id IS NULL AND activated_by_user_id IS NULL)
    OR (state = 'APPROVED'  AND approved_by_user_id IS NOT NULL AND activated_by_user_id IS NULL)
    OR (state IN ('ACTIVE', 'SUSPENDED') AND approved_by_user_id IS NOT NULL AND activated_by_user_id IS NOT NULL)
    OR (state IN ('REVOKED', 'EXPIRED'))),
  -- (the floor column itself admits only A1 or A2: the governance capabilities need at least A1 — CA-RBAC-01 §15.2, access changes are A1 minimum)
  CONSTRAINT corporate_permission_assignments_floor_is_not_ordinary CHECK (assurance_floor <> 'A0_STANDARD')
);
CREATE INDEX IF NOT EXISTS idx_corporate_permission_assignments_subject ON public.corporate_permission_assignments (subject_user_id, capability);
CREATE INDEX IF NOT EXISTS idx_corporate_permission_assignments_membership ON public.corporate_permission_assignments (membership_id);
CREATE INDEX IF NOT EXISTS idx_corporate_permission_assignments_active ON public.corporate_permission_assignments (capability) WHERE state = 'ACTIVE';

-- Append-only lifecycle history (the Phase-A pattern: written by a trigger, in the same transaction, by no one else).
CREATE TABLE IF NOT EXISTS public.corporate_permission_assignment_events (
  event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID NOT NULL,
  event_seq       INTEGER NOT NULL CHECK (event_seq >= 1),
  subject_user_id TEXT NOT NULL,
  capability      TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('REQUESTED', 'TRANSITIONED')),
  from_state      TEXT CHECK (from_state IN ('REQUESTED', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  to_state        TEXT NOT NULL CHECK (to_state IN ('REQUESTED', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('USER', 'SYSTEM')),
  actor_user_id   TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  reason          TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
  reference       TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT corporate_permission_assignment_events_assignment_fk
    FOREIGN KEY (assignment_id, subject_user_id, capability)
    REFERENCES public.corporate_permission_assignments (assignment_id, subject_user_id, capability) ON DELETE RESTRICT,
  CONSTRAINT corporate_permission_assignment_events_one_per_seq UNIQUE (assignment_id, event_seq),
  CONSTRAINT corporate_permission_assignment_events_actor_coherent CHECK ((actor_kind = 'USER') = (actor_user_id IS NOT NULL)),
  -- Only the passing of an effective period is something a system may record; every other change is a person's.
  CONSTRAINT corporate_permission_assignment_events_system_only_expiry CHECK (actor_kind = 'USER' OR to_state = 'EXPIRED'),
  CONSTRAINT corporate_permission_assignment_events_requested_shape
    CHECK (event_type <> 'REQUESTED' OR (event_seq = 1 AND from_state IS NULL AND to_state = 'REQUESTED')),
  CONSTRAINT corporate_permission_assignment_events_change_shape
    CHECK (event_type = 'REQUESTED' OR (event_seq > 1 AND from_state IS NOT NULL AND from_state <> to_state)),
  CONSTRAINT corporate_permission_assignment_events_legal_transition
    CHECK (event_type <> 'TRANSITIONED'
           OR (from_state = 'REQUESTED' AND to_state IN ('APPROVED', 'REVOKED'))
           OR (from_state = 'APPROVED'  AND to_state IN ('ACTIVE', 'REVOKED', 'EXPIRED'))
           OR (from_state = 'ACTIVE'    AND to_state IN ('SUSPENDED', 'REVOKED', 'EXPIRED'))
           OR (from_state = 'SUSPENDED' AND to_state IN ('ACTIVE', 'REVOKED', 'EXPIRED')))
);
CREATE INDEX IF NOT EXISTS idx_corporate_permission_assignment_events_subject ON public.corporate_permission_assignment_events (subject_user_id, occurred_at);

-- ── Guards ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- The lifecycle guard. Nothing about WHAT a grant is can change after it is requested; only its state moves, along legal edges, with
-- the lineage each edge needs. It is written so that the table OWNER cannot skip a state, self-approve, or resurrect a grant.
CREATE OR REPLACE FUNCTION public.corporate_permission_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_m  public.corporate_memberships%ROWTYPE;
  v_n  text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_DELETE_FORBIDDEN' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'REQUESTED' OR NEW.approved_by_user_id IS NOT NULL OR NEW.activated_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_MUST_START_REQUESTED' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.updated_by_kind <> 'USER' OR NEW.updated_by_user_id IS DISTINCT FROM NEW.requested_by_user_id THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_REQUEST_PROVENANCE' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_m FROM public.corporate_memberships WHERE membership_id = NEW.membership_id;
    IF NOT FOUND OR v_m.user_id IS DISTINCT FROM NEW.subject_user_id THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_MEMBERSHIP_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_m.state = 'ENDED' THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_MEMBERSHIP_ENDED' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(NEW.scope_node_ids) AS x) <> cardinality(NEW.scope_node_ids) THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_SCOPE_DUPLICATE' USING ERRCODE = 'check_violation';
    END IF;
    FOR v_n IN SELECT x FROM unnest(NEW.scope_node_ids) AS x WHERE x IS NULL OR NOT EXISTS (SELECT 1 FROM public.corporate_org_nodes n WHERE n.node_id = x) LOOP
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_SCOPE_NODE_UNKNOWN' USING ERRCODE = 'foreign_key_violation';
    END LOOP;
    IF NEW.effective_until <= now() THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_WINDOW_ALREADY_ENDED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: what the grant IS never changes.
  IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
     OR NEW.membership_id IS DISTINCT FROM OLD.membership_id OR NEW.capability IS DISTINCT FROM OLD.capability
     OR NEW.scope_node_ids IS DISTINCT FROM OLD.scope_node_ids OR NEW.include_descendants IS DISTINCT FROM OLD.include_descendants
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.effective_until IS DISTINCT FROM OLD.effective_until
     OR NEW.assurance_floor IS DISTINCT FROM OLD.assurance_floor OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.request_reason IS DISTINCT FROM OLD.request_reason
     OR NEW.request_reference IS DISTINCT FROM OLD.request_reference THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_GRANT_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state IN ('REVOKED', 'EXPIRED') THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_TERMINAL' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    -- A statement that changes nothing is not an event. Anything else without a state change is refused: provenance is never rewritten.
    IF NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.activated_by_user_id IS DISTINCT FROM OLD.activated_by_user_id OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
       OR NEW.updated_by_kind IS DISTINCT FROM OLD.updated_by_kind OR NEW.updated_by_user_id IS DISTINCT FROM OLD.updated_by_user_id
       OR NEW.updated_reason IS DISTINCT FROM OLD.updated_reason OR NEW.updated_reference IS DISTINCT FROM OLD.updated_reference THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_PROVENANCE_IS_NOT_REWRITTEN' USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;

  IF NOT ((OLD.state = 'REQUESTED' AND NEW.state IN ('APPROVED', 'REVOKED'))
       OR (OLD.state = 'APPROVED'  AND NEW.state IN ('ACTIVE', 'REVOKED', 'EXPIRED'))
       OR (OLD.state = 'ACTIVE'    AND NEW.state IN ('SUSPENDED', 'REVOKED', 'EXPIRED'))
       OR (OLD.state = 'SUSPENDED' AND NEW.state IN ('ACTIVE', 'REVOKED', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_TRANSITION_NOT_ALLOWED' USING ERRCODE = 'check_violation';
  END IF;
  -- Lineage that already exists is never rewritten; the guard itself writes the lineage of the edge being taken.
  IF (OLD.approved_by_user_id IS NOT NULL AND (NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id OR NEW.approved_at IS DISTINCT FROM OLD.approved_at))
     OR (OLD.activated_by_user_id IS NOT NULL AND (NEW.activated_by_user_id IS DISTINCT FROM OLD.activated_by_user_id OR NEW.activated_at IS DISTINCT FROM OLD.activated_at)) THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_LINEAGE_IS_NOT_REWRITTEN' USING ERRCODE = 'restrict_violation';
  END IF;
  -- Every change is somebody's: a person (never the subject), except the mere passing of the effective period.
  IF NEW.updated_by_kind = 'SYSTEM' AND NEW.state <> 'EXPIRED' THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_ONLY_A_PERSON_CHANGES_A_GRANT' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.updated_by_user_id IS NOT DISTINCT FROM NEW.subject_user_id THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_NO_SELF_ACTION' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'APPROVED' THEN
    -- The approver is the actor of this edge: an independent person (the CHECK refuses the requester and the subject).
    NEW.approved_by_user_id := NEW.updated_by_user_id;
    NEW.approved_at := now();
  ELSIF NEW.state = 'ACTIVE' THEN
    IF OLD.state = 'APPROVED' THEN
      NEW.activated_by_user_id := NEW.updated_by_user_id;
      NEW.activated_at := now();
    END IF;
    -- Authority-increasing edges need a live footing: the membership underneath must be ACTIVE and the period not over.
    SELECT * INTO v_m FROM public.corporate_memberships WHERE membership_id = NEW.membership_id;
    IF NOT FOUND OR v_m.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_MEMBERSHIP_NOT_ACTIVE' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.effective_until <= now() THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_WINDOW_ENDED' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.state = 'EXPIRED' THEN
    IF now() < NEW.effective_until THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_NOT_YET_EXPIRED' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.corporate_permission_assignment_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_a public.corporate_permission_assignments%ROWTYPE;
  v_previous public.corporate_permission_assignment_events%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_EVENT_APPEND_ONLY' USING ERRCODE = 'restrict_violation';
  END IF;
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_EVENT_ONLY_VIA_ASSIGNMENT_CHANGE' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO v_a FROM public.corporate_permission_assignments WHERE assignment_id = NEW.assignment_id;
  IF NOT FOUND OR NEW.to_state IS DISTINCT FROM v_a.state THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_EVENT_NOT_CURRENT' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_previous FROM public.corporate_permission_assignment_events WHERE assignment_id = NEW.assignment_id ORDER BY event_seq DESC LIMIT 1;
  IF NOT FOUND THEN
    IF NEW.event_seq <> 1 OR NEW.event_type <> 'REQUESTED' THEN
      RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_EVENT_CHAIN_BROKEN' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.event_seq <> v_previous.event_seq + 1 OR NEW.event_type = 'REQUESTED' OR NEW.from_state IS DISTINCT FROM v_previous.to_state THEN
    RAISE EXCEPTION 'CORPORATE_ASSIGNMENT_EVENT_CHAIN_BROKEN' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- The ONLY writer of events: an AFTER ROW trigger in the same transaction. No EXCEPTION handler, by design — if the event cannot be
-- written, the change that caused it does not happen.
CREATE OR REPLACE FUNCTION public.corporate_permission_assignment_events_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.corporate_permission_assignment_events
      (assignment_id, event_seq, subject_user_id, capability, event_type, from_state, to_state, actor_kind, actor_user_id, reason, reference)
    VALUES (NEW.assignment_id, 1, NEW.subject_user_id, NEW.capability, 'REQUESTED', NULL, NEW.state,
            NEW.updated_by_kind, NEW.updated_by_user_id, NEW.updated_reason, NEW.updated_reference);
    RETURN NULL;
  END IF;
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NULL;   -- the guard let a no-op through unchanged; there is nothing to record
  END IF;
  SELECT COALESCE(MAX(event_seq), 0) + 1 INTO v_seq FROM public.corporate_permission_assignment_events WHERE assignment_id = NEW.assignment_id;
  INSERT INTO public.corporate_permission_assignment_events
    (assignment_id, event_seq, subject_user_id, capability, event_type, from_state, to_state, actor_kind, actor_user_id, reason, reference)
  VALUES (NEW.assignment_id, v_seq, NEW.subject_user_id, NEW.capability, 'TRANSITIONED', OLD.state, NEW.state,
          NEW.updated_by_kind, NEW.updated_by_user_id, NEW.updated_reason, NEW.updated_reference);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS corporate_permission_assignments_guard ON public.corporate_permission_assignments;
CREATE TRIGGER corporate_permission_assignments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.corporate_permission_assignments
  FOR EACH ROW EXECUTE FUNCTION public.corporate_permission_assignments_guard();
DROP TRIGGER IF EXISTS corporate_permission_assignments_no_truncate ON public.corporate_permission_assignments;
CREATE TRIGGER corporate_permission_assignments_no_truncate
  BEFORE TRUNCATE ON public.corporate_permission_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION public.corporate_custody_truncate_guard();
DROP TRIGGER IF EXISTS corporate_permission_assignment_events_guard ON public.corporate_permission_assignment_events;
CREATE TRIGGER corporate_permission_assignment_events_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.corporate_permission_assignment_events
  FOR EACH ROW EXECUTE FUNCTION public.corporate_permission_assignment_events_guard();
DROP TRIGGER IF EXISTS corporate_permission_assignment_events_no_truncate ON public.corporate_permission_assignment_events;
CREATE TRIGGER corporate_permission_assignment_events_no_truncate
  BEFORE TRUNCATE ON public.corporate_permission_assignment_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.corporate_custody_truncate_guard();
DROP TRIGGER IF EXISTS corporate_permission_assignments_record_event ON public.corporate_permission_assignments;
CREATE TRIGGER corporate_permission_assignments_record_event
  AFTER INSERT OR UPDATE ON public.corporate_permission_assignments
  FOR EACH ROW EXECUTE FUNCTION public.corporate_permission_assignment_events_record();

-- ── The rows that can take part in a decision — and only those ───────────────────────────────────────────────────
-- ACTIVE · inside its effective period (judged against the WALL CLOCK, never the transaction start) · the underlying membership is the subject's own, ACTIVE and effective · and the floor is one
-- this platform can satisfy today (A1). An A2_STRONG floor is inert until a strong authenticator exists AND this view is deliberately
-- revised. REQUESTED / APPROVED / SUSPENDED / REVOKED / EXPIRED rows are simply not here.
CREATE OR REPLACE VIEW public.corporate_permission_assignment_effective WITH (security_invoker = true) AS
  SELECT a.assignment_id, a.subject_user_id, a.membership_id, a.capability, a.scope_node_ids, a.include_descendants,
         a.effective_from, a.effective_until, a.assurance_floor, a.approved_by_user_id, a.activated_by_user_id,
         m.org_node_id AS membership_org_node_id
    FROM public.corporate_permission_assignments a
    JOIN public.corporate_memberships m ON m.membership_id = a.membership_id AND m.user_id = a.subject_user_id
   WHERE a.state = 'ACTIVE'
     AND a.effective_from <= clock_timestamp() AND clock_timestamp() < a.effective_until
     AND m.state = 'ACTIVE' AND m.effective_from <= clock_timestamp() AND (m.effective_until IS NULL OR clock_timestamp() < m.effective_until)
     AND a.assurance_floor = 'A1_RECENT_REAUTH';

-- ── The trusted evaluator (read-only) ──────────────────────────────────────────────────────────────────────────
-- Derives a decision for (actor, subject, node, capabilities) from the persistent authority. Every required capability must be covered
-- by ONE assignment on its own — there is no union of scopes, no intersection invented across grants, no inheritance from a title, a
-- legacy role or a tenant. Anything it cannot read or does not find is a denial. It is deliberately NOT actor≠subject-aware: that rule
-- lives in the unchanged Phase-B procedures (ACTOR_IS_SUBJECT), so a 'granted' preview never means "may act on their own membership".
--
-- For END (p_need_continuity) it also COUNTS the independent governors that would remain, from the same rows. The result is a decision
-- projection in the Phase-B contract plus a provenance block naming the assignments relied on; the Phase-B ledgers store it.
CREATE OR REPLACE FUNCTION public.corporate_authority_evaluate(
  p_actor_user_id text,
  p_subject_user_id text,
  p_org_node_id text,
  p_capabilities text[],
  p_need_continuity boolean DEFAULT FALSE,
  p_target_membership_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE   -- reads the wall clock (clock_timestamp), never the transaction start; it still writes nothing and runs in a READ ONLY transaction
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_manage text := v_policy->>'capability_membership_manage';
  v_now timestamptz := clock_timestamp();
  v_caps text[];
  v_cap text;
  c record;
  v_reason text;
  v_rank integer;
  v_best_rank integer;
  v_best_reason text;
  v_best_id uuid;
  v_granted boolean;
  v_provenance jsonb := '[]'::jsonb;
  v_denials jsonb := '[]'::jsonb;
  v_risk text[];
  v_holds boolean := FALSE;
  v_remaining integer;
  v_projection jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' OR p_subject_user_id IS NULL OR btrim(p_subject_user_id) = ''
     OR p_org_node_id IS NULL OR btrim(p_org_node_id) = '' OR p_capabilities IS NULL OR cardinality(p_capabilities) = 0 THEN
    RETURN jsonb_build_object('decision', 'denied', 'denials', jsonb_build_array(jsonb_build_object('capability', NULL, 'reason', 'INPUT_INVALID')));
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_caps FROM unnest(p_capabilities) AS x;

  FOREACH v_cap IN ARRAY v_caps LOOP
    IF v_cap IS NULL OR NOT (v_cap = ANY (public.corporate_authority_grantable_capabilities())) THEN
      v_denials := v_denials || jsonb_build_array(jsonb_build_object('capability', v_cap, 'reason', 'CAPABILITY_NOT_EVALUABLE'));
      CONTINUE;
    END IF;
    v_granted := FALSE; v_best_rank := -1; v_best_reason := 'NO_ASSIGNMENT'; v_best_id := NULL;
    FOR c IN
      SELECT a.*, m.state AS m_state, m.user_id AS m_user, m.effective_from AS m_from, m.effective_until AS m_until
        FROM public.corporate_permission_assignments a
        LEFT JOIN public.corporate_memberships m ON m.membership_id = a.membership_id
       WHERE a.subject_user_id = p_actor_user_id AND a.capability = v_cap
       ORDER BY a.assignment_id
    LOOP
      -- Ordered checks; the first that fails is this assignment's reason. The assignment that got FURTHEST names the denial.
      IF c.state <> 'ACTIVE' THEN
        v_reason := 'STATE_' || c.state; v_rank := 0;
      ELSIF NOT (c.effective_from <= v_now AND v_now < c.effective_until) THEN
        v_reason := 'OUT_OF_WINDOW'; v_rank := 1;
      ELSIF NOT public.corporate_authority_scope_covers(c.scope_node_ids, c.include_descendants, p_org_node_id) THEN
        v_reason := 'OUT_OF_SCOPE'; v_rank := 2;
      ELSIF c.m_state IS DISTINCT FROM 'ACTIVE' OR c.m_user IS DISTINCT FROM c.subject_user_id
            OR NOT (c.m_from <= v_now AND (c.m_until IS NULL OR v_now < c.m_until)) THEN
        v_reason := 'MEMBERSHIP_NOT_EFFECTIVE'; v_rank := 3;
      ELSIF c.assurance_floor IS DISTINCT FROM 'A1_RECENT_REAUTH' THEN
        v_reason := 'ASSURANCE_FLOOR_UNMET'; v_rank := 4;
      ELSE
        v_granted := TRUE;
        v_provenance := v_provenance || jsonb_build_array(jsonb_build_object(
          'capability', v_cap, 'assignment_id', c.assignment_id, 'membership_id', c.membership_id,
          'scope_node_ids', to_jsonb(c.scope_node_ids), 'include_descendants', c.include_descendants,
          'effective_from', c.effective_from, 'effective_until', c.effective_until, 'assurance_floor', c.assurance_floor,
          'approved_by_user_id', c.approved_by_user_id, 'activated_by_user_id', c.activated_by_user_id));
        EXIT;
      END IF;
      IF v_rank > v_best_rank THEN v_best_rank := v_rank; v_best_reason := v_reason; v_best_id := c.assignment_id; END IF;
    END LOOP;
    IF NOT v_granted THEN
      v_denials := v_denials || jsonb_build_array(jsonb_build_object('capability', v_cap, 'reason', v_best_reason, 'assignment_id', v_best_id));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_denials) > 0 THEN
    RETURN jsonb_build_object('decision', 'denied', 'denials', v_denials);
  END IF;

  v_projection := jsonb_build_object(
    'contract', v_policy->>'decision_contract',
    'decision', 'granted',
    'source', v_policy->>'decision_source',
    'evaluator', jsonb_build_object('name', 'corporate_authority_evaluate', 'version', '1'),
    'decided_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor_user_id', p_actor_user_id,
    'subject_user_id', p_subject_user_id,
    'capabilities', to_jsonb(v_caps),
    'scope', jsonb_build_object('kind', 'ORG_NODES', 'org_node_ids', jsonb_build_array(p_org_node_id)),
    'assurance', jsonb_build_object('class', v_policy->>'assurance_class', 'server_proven', TRUE),
    'provenance', jsonb_build_object('derivation', 'persistent_assignments', 'assignments', v_provenance));

  IF p_need_continuity THEN
    IF p_target_membership_id IS NULL THEN
      RETURN jsonb_build_object('decision', 'denied', 'denials', jsonb_build_array(jsonb_build_object('capability', v_manage, 'reason', 'CONTINUITY_TARGET_REQUIRED')));
    END IF;
    -- The governance the subject carries THROUGH THIS MEMBERSHIP: the nodes its currently-effective manage assignments cover. Ending the
    -- membership ends exactly those assignments' effect; assignments resting on the subject's other memberships are not at risk.
    SELECT array_agg(DISTINCT n.node_id) INTO v_risk
      FROM public.corporate_permission_assignment_effective g
      CROSS JOIN public.corporate_org_nodes n
     WHERE g.subject_user_id = p_subject_user_id AND g.membership_id = p_target_membership_id AND g.capability = v_manage
       AND public.corporate_authority_scope_covers(g.scope_node_ids, g.include_descendants, n.node_id);
    v_holds := v_risk IS NOT NULL AND cardinality(v_risk) > 0;
    IF v_holds THEN
      SELECT min(q.cnt)::integer INTO v_remaining FROM (
        SELECT (SELECT count(DISTINCT g2.subject_user_id)
                  FROM public.corporate_permission_assignment_effective g2
                 WHERE g2.capability = v_manage AND g2.subject_user_id <> p_subject_user_id
                   AND public.corporate_authority_scope_covers(g2.scope_node_ids, g2.include_descendants, rn.node_id)) AS cnt
          FROM unnest(v_risk) AS rn(node_id)) q;
    ELSE
      SELECT count(DISTINCT g2.subject_user_id)::integer INTO v_remaining
        FROM public.corporate_permission_assignment_effective g2
       WHERE g2.capability = v_manage AND g2.subject_user_id <> p_subject_user_id
         AND public.corporate_authority_scope_covers(g2.scope_node_ids, g2.include_descendants, p_org_node_id);
    END IF;
    IF v_remaining IS NULL THEN
      RETURN jsonb_build_object('decision', 'denied', 'denials', jsonb_build_array(jsonb_build_object('capability', v_manage, 'reason', 'CONTINUITY_UNREADABLE')));
    END IF;
    v_projection := v_projection || jsonb_build_object('governance_continuity',
      jsonb_build_object('subject_holds_governance_authority', v_holds, 'remaining_independent_governors', v_remaining));
  END IF;
  RETURN v_projection;
END;
$$;

-- Lock what a decision rests on, in ONE global order, so that a concurrent revocation / suspension / end either happens before this
-- decision (and is seen by it) or waits until it has committed — and so that two administrators acting on each other cannot deadlock:
-- assignments first (SHARE, by id), then memberships (by id; the target FOR UPDATE when the call changes it, everything else SHARE).
-- Row locks need more than SELECT, which is another reason service_role cannot do this itself.
CREATE OR REPLACE FUNCTION public.corporate_authority_require(
  p_actor_user_id text,
  p_subject_user_id text,
  p_org_node_id text,
  p_capabilities text[],
  p_need_continuity boolean,
  p_target_membership_id uuid,
  p_target_for_update boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_manage text := (public.corporate_governance_policy())->>'capability_membership_manage';
  r record;
  v_decision jsonb;
BEGIN
  PERFORM 1 FROM public.corporate_permission_assignments a
   WHERE (a.subject_user_id = p_actor_user_id AND a.capability = ANY (p_capabilities))
      OR (p_need_continuity AND ((a.subject_user_id = p_subject_user_id AND a.membership_id = p_target_membership_id AND a.capability = v_manage)
                                 OR (a.capability = v_manage AND a.state = 'ACTIVE')))
   ORDER BY a.assignment_id
   FOR SHARE;

  FOR r IN
    SELECT x.membership_id, bool_or(x.is_target) AS is_target
      FROM (
        SELECT a.membership_id, FALSE AS is_target FROM public.corporate_permission_assignments a
         WHERE (a.subject_user_id = p_actor_user_id AND a.capability = ANY (p_capabilities))
            OR (p_need_continuity AND ((a.subject_user_id = p_subject_user_id AND a.membership_id = p_target_membership_id AND a.capability = v_manage)
                                       OR (a.capability = v_manage AND a.state = 'ACTIVE')))
        UNION ALL
        SELECT p_target_membership_id, COALESCE(p_target_for_update, FALSE) WHERE p_target_membership_id IS NOT NULL
      ) x
     GROUP BY x.membership_id
     ORDER BY x.membership_id
  LOOP
    IF r.is_target THEN
      PERFORM 1 FROM public.corporate_memberships WHERE membership_id = r.membership_id FOR UPDATE;
    ELSE
      PERFORM 1 FROM public.corporate_memberships WHERE membership_id = r.membership_id FOR SHARE;
    END IF;
  END LOOP;

  -- Judged AFTER the locks, so time spent queueing counts. now() is the transaction START: if it is older than the bound, every Phase-B time rule the
  -- procedure below is about to apply (A1 window, approval / request lifetime, session expiry) would be judged against an old instant.
  IF clock_timestamp() - now() > public.corporate_authority_max_transaction_age() THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/TRANSACTION_STALE' USING DETAIL = 'a governed call must run in a fresh transaction: time rules are judged against the transaction start';
  END IF;

  v_decision := public.corporate_authority_evaluate(p_actor_user_id, p_subject_user_id, p_org_node_id, p_capabilities, p_need_continuity, p_target_membership_id);
  IF v_decision->>'decision' IS DISTINCT FROM 'granted' THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/AUTHORITY_DENIED' USING DETAIL = COALESCE((v_decision->'denials')::text, '[]');
  END IF;
  RETURN v_decision;
END;
$$;

-- ── The entry points service_role may execute: no decision comes from the caller ──────────────────────────────────
-- Each resolves the (actor, subject, node) the governed Phase-B procedure will itself use, requires persistent authority for exactly
-- that, and passes the decision it generated. If the tuple cannot be resolved (unknown membership / request / operation, missing
-- actor) NO decision is passed: the governed procedure refuses on its own validations and, if it ever reached the decision check,
-- on a missing decision — never on one the caller supplied.
CREATE OR REPLACE FUNCTION public.corporate_authority_apply_direct(
  p_operation text,
  p_actor_user_id text,
  p_actor_session_id text,
  p_subject_user_id text,
  p_org_node_id text,
  p_membership_id uuid,
  p_reason text,
  p_reference text,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_classification text,
  p_session_revocation jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_subject text;
  v_node text;
  v_caps text[];
  v_decision jsonb := NULL;
  v_result jsonb;
BEGIN
  IF p_operation = 'CREATE' THEN
    v_subject := p_subject_user_id; v_node := p_org_node_id;
  ELSIF p_operation IN ('SUSPEND', 'END') AND p_membership_id IS NOT NULL THEN
    SELECT user_id, org_node_id INTO v_subject, v_node FROM public.corporate_memberships WHERE membership_id = p_membership_id;
  END IF;
  IF v_subject IS NOT NULL AND v_node IS NOT NULL AND p_actor_user_id IS NOT NULL AND btrim(p_actor_user_id) <> ''
     AND EXISTS (SELECT 1 FROM public.corporate_org_nodes WHERE node_id = v_node) THEN
    v_caps := CASE WHEN COALESCE(p_classification, 'ROUTINE') = 'SECURITY_COMPROMISE'
                   THEN ARRAY[v_policy->>'capability_membership_manage', v_policy->>'capability_session_revoke']
                   ELSE ARRAY[v_policy->>'capability_membership_manage'] END;
    v_decision := public.corporate_authority_require(p_actor_user_id, v_subject, v_node, v_caps, p_operation = 'END',
                                                     CASE WHEN p_operation = 'CREATE' THEN NULL ELSE p_membership_id END, TRUE);
  END IF;
  v_result := public.corporate_membership_apply_direct(p_operation, p_actor_user_id, p_actor_session_id, p_subject_user_id, p_org_node_id,
                p_membership_id, p_reason, p_reference, p_effective_from, p_effective_until, p_classification, p_session_revocation, v_decision);
  RETURN v_result || jsonb_build_object('authority', v_decision->'provenance');
END;
$$;

CREATE OR REPLACE FUNCTION public.corporate_authority_request_submit(
  p_operation text,
  p_membership_id uuid,
  p_requester_user_id text,
  p_requester_session_id text,
  p_reason text,
  p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_subject text;
  v_node text;
  v_decision jsonb := NULL;
  v_result jsonb;
BEGIN
  IF p_membership_id IS NOT NULL THEN
    SELECT user_id, org_node_id INTO v_subject, v_node FROM public.corporate_memberships WHERE membership_id = p_membership_id;
  END IF;
  IF v_subject IS NOT NULL AND p_requester_user_id IS NOT NULL AND btrim(p_requester_user_id) <> '' THEN
    v_decision := public.corporate_authority_require(p_requester_user_id, v_subject, v_node, ARRAY[v_policy->>'capability_membership_manage'], FALSE, p_membership_id, FALSE);
  END IF;
  v_result := public.corporate_membership_request_submit(p_operation, p_membership_id, p_requester_user_id, p_requester_session_id, p_reason, p_reference, v_decision);
  RETURN v_result || jsonb_build_object('authority', v_decision->'provenance');
END;
$$;

CREATE OR REPLACE FUNCTION public.corporate_authority_request_decide(
  p_request_id uuid,
  p_checker_user_id text,
  p_checker_session_id text,
  p_decision text,
  p_reason text,
  p_expected_subject_user_id text,
  p_expected_membership_id uuid,
  p_expected_org_node_id text,
  p_expected_operation text,
  p_expected_binding_digest text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_req record;
  v_decision jsonb := NULL;
  v_result jsonb;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT subject_user_id, org_node_id, membership_id INTO v_req FROM public.corporate_membership_requests WHERE request_id = p_request_id;
  END IF;
  IF v_req.subject_user_id IS NOT NULL AND p_checker_user_id IS NOT NULL AND btrim(p_checker_user_id) <> '' THEN
    v_decision := public.corporate_authority_require(p_checker_user_id, v_req.subject_user_id, v_req.org_node_id, ARRAY[v_policy->>'capability_membership_manage'], FALSE, v_req.membership_id, FALSE);
  END IF;
  v_result := public.corporate_membership_request_decide(p_request_id, p_checker_user_id, p_checker_session_id, p_decision, p_reason,
                p_expected_subject_user_id, p_expected_membership_id, p_expected_org_node_id, p_expected_operation, p_expected_binding_digest, v_decision);
  RETURN v_result || jsonb_build_object('authority', v_decision->'provenance');
END;
$$;

CREATE OR REPLACE FUNCTION public.corporate_authority_request_execute(
  p_request_id uuid,
  p_executor_user_id text,
  p_executor_session_id text,
  p_expected_binding_digest text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_req record;
  v_decision jsonb := NULL;
  v_result jsonb;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT subject_user_id, org_node_id, membership_id INTO v_req FROM public.corporate_membership_requests WHERE request_id = p_request_id;
  END IF;
  IF v_req.subject_user_id IS NOT NULL AND p_executor_user_id IS NOT NULL AND btrim(p_executor_user_id) <> '' THEN
    v_decision := public.corporate_authority_require(p_executor_user_id, v_req.subject_user_id, v_req.org_node_id, ARRAY[v_policy->>'capability_membership_manage'], FALSE, v_req.membership_id, TRUE);
  END IF;
  v_result := public.corporate_membership_request_execute(p_request_id, p_executor_user_id, p_executor_session_id, p_expected_binding_digest, v_decision);
  RETURN v_result || jsonb_build_object('authority', v_decision->'provenance');
END;
$$;

CREATE OR REPLACE FUNCTION public.corporate_authority_request_cancel(
  p_request_id uuid,
  p_actor_user_id text,
  p_actor_session_id text,
  p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_req record;
  v_decision jsonb := NULL;
  v_result jsonb;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT subject_user_id, org_node_id, membership_id INTO v_req FROM public.corporate_membership_requests WHERE request_id = p_request_id;
  END IF;
  IF v_req.subject_user_id IS NOT NULL AND p_actor_user_id IS NOT NULL AND btrim(p_actor_user_id) <> '' THEN
    v_decision := public.corporate_authority_require(p_actor_user_id, v_req.subject_user_id, v_req.org_node_id, ARRAY[v_policy->>'capability_membership_manage'], FALSE, v_req.membership_id, FALSE);
  END IF;
  v_result := public.corporate_membership_request_cancel(p_request_id, p_actor_user_id, p_actor_session_id, p_reason, v_decision);
  RETURN v_result || jsonb_build_object('authority', v_decision->'provenance');
END;
$$;

COMMENT ON TABLE public.corporate_permission_assignments IS
  'CA-K3-AUTH-04 persistent Corporate permission assignment: ONE atomic approved authority (subject, one stable capability, internal org scope, '
  'effective period, assurance floor, approval lineage, lifecycle state). Only ACTIVE + effective assignments over an ACTIVE membership authorize anything. '
  'Written only by the table owner through the lifecycle guard; service_role is read-only. Never derived from users.role, tenant_users, organization_users, titles or the legacy bridge.';
COMMENT ON TABLE public.corporate_permission_assignment_events IS
  'CA-K3-AUTH-04 append-only lifecycle history of corporate_permission_assignments: one immutable row per request or change, written only by a trigger.';
COMMENT ON FUNCTION public.corporate_authority_evaluate(text, text, text, text[], boolean, uuid) IS
  'CA-K3-AUTH-04 trusted evaluator: derives a Corporate governance decision from persistent assignments. Each capability must be covered by ONE assignment on its own.';

-- ── Privileges ───────────────────────────────────────────────────────────────────────────────────────────────────
-- REVOKE ALL first: Supabase's default privileges give service_role / anon / authenticated ALL on every NEW table and function.
ALTER TABLE public.corporate_permission_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_permission_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corporate_permission_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.corporate_permission_assignments TO service_role;

ALTER TABLE public.corporate_permission_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_permission_assignment_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corporate_permission_assignment_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.corporate_permission_assignment_events TO service_role;

REVOKE ALL ON TABLE public.corporate_permission_assignment_effective FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.corporate_permission_assignment_effective TO service_role;

REVOKE ALL ON FUNCTION public.corporate_authority_grantable_capabilities() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_authority_scope_covers(text[], boolean, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_authority_max_transaction_age() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_permission_assignments_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_permission_assignment_events_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_permission_assignment_events_record() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_authority_require(text, text, text, text[], boolean, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_authority_evaluate(text, text, text, text[], boolean, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_authority_apply_direct(text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_authority_request_submit(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_authority_request_decide(uuid, text, text, text, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_authority_request_execute(uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_authority_request_cancel(uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- The structural closure: the snapshot-taking Phase-B procedures are no longer reachable by the backend role at all.
REVOKE ALL ON FUNCTION public.corporate_membership_apply_direct(text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_request_submit(text, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_request_decide(uuid, text, text, text, text, text, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_request_execute(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_request_cancel(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- What the backend role may execute: the five authority-gated entry points and the read-only evaluator (a preview: the entry points
-- evaluate again, themselves, inside the transaction).
GRANT EXECUTE ON FUNCTION public.corporate_authority_evaluate(text, text, text, text[], boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_apply_direct(text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_submit(text, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_decide(uuid, text, text, text, text, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_execute(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_authority_request_cancel(uuid, text, text, text) TO service_role;

-- +migrate Down
-- Phase C only. Phase B and Phase A are left exactly as they were — including, deliberately, the Phase-B privileges: Down RESTORES
-- service_role's EXECUTE on the five snapshot-taking procedures, so the decision-authenticity limitation returns with it. (Down must
-- run BEFORE Phase B's Down: the wrappers call the Phase-B procedures.)
GRANT EXECUTE ON FUNCTION public.corporate_membership_apply_direct(text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_membership_request_submit(text, uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_membership_request_decide(uuid, text, text, text, text, text, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_membership_request_execute(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_membership_request_cancel(uuid, text, text, text, jsonb) TO service_role;
DROP FUNCTION IF EXISTS public.corporate_authority_request_cancel(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.corporate_authority_request_execute(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.corporate_authority_request_decide(uuid, text, text, text, text, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.corporate_authority_request_submit(text, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.corporate_authority_apply_direct(text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, text, jsonb);
DROP FUNCTION IF EXISTS public.corporate_authority_require(text, text, text, text[], boolean, uuid, boolean);
DROP FUNCTION IF EXISTS public.corporate_authority_evaluate(text, text, text, text[], boolean, uuid);
DROP VIEW IF EXISTS public.corporate_permission_assignment_effective;
DROP TABLE IF EXISTS public.corporate_permission_assignment_events;
DROP TABLE IF EXISTS public.corporate_permission_assignments;
DROP FUNCTION IF EXISTS public.corporate_permission_assignment_events_record();
DROP FUNCTION IF EXISTS public.corporate_permission_assignment_events_guard();
DROP FUNCTION IF EXISTS public.corporate_permission_assignments_guard();
DROP FUNCTION IF EXISTS public.corporate_authority_scope_covers(text[], boolean, text);
DROP FUNCTION IF EXISTS public.corporate_authority_max_transaction_age();
DROP FUNCTION IF EXISTS public.corporate_authority_grantable_capabilities();
