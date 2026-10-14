-- +migrate Up
-- CA-K3-AUTH-03 (CA-1.0, Phase B core) — the GOVERNED MUTATION boundary for Corporate membership.
--
-- Phase A (20261014010000, accepted and frozen — NOT revised here) made the backend role READ-ONLY on the three
-- membership tables and recorded every change as an append-only lifecycle event. Phase B adds the one narrow,
-- governed way to change a membership, without re-granting any table DML to service_role:
--
--   corporate_membership_requests         immutable facts of each governed request (append-only; INSERT only)
--   corporate_membership_request_steps    append-only decisions / outcomes of each request
--   five SECURITY DEFINER procedures      the ONLY write interface; EXECUTE granted to service_role alone
--   two views                             request status (latest step) and the authorization epoch
--
-- LIFECYCLE   PENDING → ACTIVE → SUSPENDED → ACTIVE → ENDED   (ENDED terminal; a later relationship is a NEW membership)
--   CREATE    only ever as PENDING; one authorized administrator; actor ≠ subject; reason + reference mandatory.
--   ACTIVATE  PENDING→ACTIVE   authority-INCREASING: request → independent checker approves → execute (consume once).
--   RESTORE   SUSPENDED→ACTIVE authority-INCREASING: same.
--   SUSPEND   ACTIVE→SUSPENDED authority-reducing: one authorized administrator, immediately.
--   END       →ENDED           authority-reducing: one authorized administrator, subject to governance-loss protection.
--
-- WHAT IS ENFORCED HERE, AT THE DATABASE (not only in the service, and never in UI behaviour)
--   · actor ≠ subject on every operation (also: the Phase-A no_self_provenance CHECK on the membership row itself);
--   · maker ≠ checker, and the checker is not the subject; only a requester or the approving checker may execute;
--   · an approval is bound (sha256 digest + explicit subject / membership / organisation node / transition) to the exact
--     request, and to the membership's exact lifecycle position (expected_event_seq): a membership that changed since the
--     request makes the approval STALE; an approval older than the approval TTL EXPIRES; both are RECORDED, not dropped;
--   · an approval is CONSUMED exactly once: unique partial indexes allow one decision and one terminal step per request;
--   · every executed request corresponds to EXACTLY ONE Phase-A lifecycle event (result_event_seq = expected_event_seq + 1,
--     same actor, same transition), checked by the step trigger — if that cannot be proven the whole call rolls back;
--   · A1 (recent password re-authentication) is re-proven from the actor's OWN user_sessions row, never from a parameter;
--   · the target-governance decision snapshot must be well-formed, fresh, granted by `target_corporate_governance`
--     (never the legacy compatibility bridge), name the membership-management capability, cover the organisation node,
--     and bind this actor and subject; a missing, malformed, stale or non-target-source-labelled decision is refused.
--     Producer authenticity is NOT established by this Phase-B snapshot check; persistent grant authority is required before routing.
--   · END of a governance-bearing membership needs a governance-continuity attestation (at least two independent
--     governors would remain); a security-compromise SUSPEND needs the identity to hold NO live session at that instant.
--
-- WHAT THIS DOES NOT DO: it grants no permission, creates no member, mutates no users.role / tenant_users /
-- organization_users / organizations row (it READS users and user_sessions only), changes no Phase-A object, and routes
-- nothing: the procedures are reachable only by the backend service role, from a non-routed service.
--
-- The write token (carup.corporate_governance_write) stops accidental direct INSERTs by an owner-level session; it is a
-- guard rail, not a security boundary — the boundary is that service_role holds no INSERT/UPDATE/DELETE/TRUNCATE.

DO $$
BEGIN
  IF to_regclass('public.corporate_org_nodes') IS NULL
     OR to_regclass('public.corporate_memberships') IS NULL
     OR to_regclass('public.corporate_membership_events') IS NULL
     OR to_regprocedure('public.corporate_custody_truncate_guard()') IS NULL THEN
    RAISE EXCEPTION 'CA-K3-AUTH-03 requires the accepted Phase-A migration 20261014010000 (corporate_org_nodes, corporate_memberships, corporate_membership_events)';
  END IF;
  IF to_regclass('public.users') IS NULL OR to_regclass('public.user_sessions') IS NULL THEN
    RAISE EXCEPTION 'CA-K3-AUTH-03 requires public.users and public.user_sessions';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user_sessions'
         AND column_name IN ('is_valid', 'expires_at', 'step_up_at', 'step_up_method')) <> 4 THEN
    RAISE EXCEPTION 'CA-K3-AUTH-03 requires the O2-X3 session assurance columns (user_sessions.step_up_at / step_up_method)';
  END IF;
END $$;

-- ── Policy constants (one place; tests pin them against the application constants) ───────────────────────────
CREATE OR REPLACE FUNCTION public.corporate_governance_policy()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'request_ttl_seconds',       259200,   -- an unapproved/unexecuted request lapses after 72 h
    'approval_ttl_seconds',      1800,     -- an approval must be executed within 30 min
    'a1_ttl_seconds',            900,      -- == STEP_UP_TTL_MS.sensitive_action (15 min) in authenticationAssuranceService.js
    'decision_max_age_seconds',  300,      -- a governance decision snapshot is good for 5 min
    'clock_skew_seconds',        60,
    'min_independent_governors', 2,         -- OWNER-AUTHORIZED bootstrap policy: TWO-HUMAN MINIMUM
    'decision_contract',         'carup.corporate_governance_decision.v1',
    'decision_source',           'target_corporate_governance',
    'capability_membership_manage', 'corporate.people.membership.manage',
    'capability_session_revoke',    'corporate.people.session.revoke',
    'assurance_class',           'A1_RECENT_REAUTH'
  );
$$;

-- The binding digest: ties an approval to the exact request, subject, membership, node, transition and lifecycle position.
CREATE OR REPLACE FUNCTION public.corporate_governance_binding_digest(
  p_request_id uuid, p_membership_id uuid, p_subject text, p_node text,
  p_operation text, p_from_state text, p_to_state text, p_expected_seq integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT encode(sha256(convert_to(
    'CMR1|' || p_request_id::text || '|' || p_membership_id::text || '|' || p_subject || '|' || p_node || '|'
    || p_operation || '|' || COALESCE(p_from_state, '-') || '|' || p_to_state || '|' || COALESCE(p_expected_seq::text, '-'),
    'UTF8')), 'hex');
$$;

-- A1, re-proven from the actor's OWN session row. Fails closed on anything it cannot read.
CREATE OR REPLACE FUNCTION public.corporate_governance_assert_a1(p_session_id text, p_user_id text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row  public.user_sessions%ROWTYPE;
  v_step timestamptz;
  v_exp  timestamptz;
  v_policy jsonb := public.corporate_governance_policy();
  v_ttl  interval := ((v_policy->>'a1_ttl_seconds')::int) * interval '1 second';
  v_skew interval := ((v_policy->>'clock_skew_seconds')::int) * interval '1 second';
BEGIN
  IF p_session_id IS NULL OR btrim(p_session_id) = '' OR p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ASSURANCE_A1_REQUIRED';
  END IF;
  SELECT * INTO v_row FROM public.user_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_row.user_id IS DISTINCT FROM p_user_id OR v_row.is_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ASSURANCE_SESSION_INVALID';
  END IF;
  BEGIN
    v_exp  := v_row.expires_at::timestamptz;
    v_step := v_row.step_up_at::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ASSURANCE_UNREADABLE';
  END;
  IF v_exp IS NULL OR v_exp <= now() THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ASSURANCE_SESSION_INVALID';
  END IF;
  -- Only a recorded password re-authentication confers A1 today. A strong authenticator does not exist yet, and A2 is NEVER
  -- inferred or emulated here: when one exists its method is added deliberately, after review. Until then: fail closed.
  IF v_row.step_up_method IS DISTINCT FROM 'password_reauth' OR v_step IS NULL THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ASSURANCE_A1_REQUIRED';
  END IF;
  IF v_step > now() + v_skew OR v_step < now() - v_ttl THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ASSURANCE_A1_REQUIRED';
  END IF;
  RETURN v_step;
END;
$$;

-- The target-governance decision snapshot. Every test is written so that NULL / missing means DENY.
CREATE OR REPLACE FUNCTION public.corporate_governance_check_decision(
  p_decision jsonb, p_actor text, p_subject text, p_node text,
  p_need_session_revoke boolean, p_need_continuity boolean)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_decided timestamptz;
  v_max_age interval := ((v_policy->>'decision_max_age_seconds')::int) * interval '1 second';
  v_skew    interval := ((v_policy->>'clock_skew_seconds')::int) * interval '1 second';
  v_holds boolean;
  v_remaining integer;
  v_nodes jsonb;
BEGIN
  IF p_decision IS NULL OR jsonb_typeof(p_decision) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_MISSING';
  END IF;
  IF p_decision->>'contract' IS DISTINCT FROM (v_policy->>'decision_contract') THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_CONTRACT';
  END IF;
  IF p_decision->>'decision' IS DISTINCT FROM 'granted' THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_NOT_GRANTED';
  END IF;
  -- This Phase-B check validates the decision snapshot's declared target-governance source label and contract shape only.
  -- It does not authenticate the producer; persistent grant authority is required before any mutation route is activated.
  IF p_decision->>'source' IS DISTINCT FROM (v_policy->>'decision_source') THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_SOURCE';
  END IF;
  IF jsonb_typeof(p_decision->'evaluator') IS DISTINCT FROM 'object'
     OR btrim(COALESCE(p_decision #>> '{evaluator,name}', '')) = ''
     OR btrim(COALESCE(p_decision #>> '{evaluator,version}', '')) = '' THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_EVALUATOR';
  END IF;
  BEGIN
    v_decided := (p_decision->>'decided_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_MALFORMED';
  END;
  IF v_decided IS NULL OR v_decided < now() - v_max_age OR v_decided > now() + v_skew THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_STALE';
  END IF;
  IF p_decision->>'actor_user_id' IS DISTINCT FROM p_actor OR p_decision->>'subject_user_id' IS DISTINCT FROM p_subject THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_BINDING';
  END IF;
  IF jsonb_typeof(p_decision->'capabilities') IS DISTINCT FROM 'array'
     OR NOT COALESCE((p_decision->'capabilities') ? (v_policy->>'capability_membership_manage'), false) THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_CAPABILITY';
  END IF;
  IF p_need_session_revoke
     AND NOT COALESCE((p_decision->'capabilities') ? (v_policy->>'capability_session_revoke'), false) THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_CAPABILITY';
  END IF;
  v_nodes := p_decision #> '{scope,org_node_ids}';
  IF p_decision #>> '{scope,kind}' IS DISTINCT FROM 'ORG_NODES'
     OR jsonb_typeof(v_nodes) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_nodes) = 0
     OR p_node IS NULL
     OR NOT COALESCE(v_nodes ? p_node, false)
     OR COALESCE(v_nodes ? '*', false)
     OR COALESCE(v_nodes ? 'GLOBAL', false) THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_SCOPE';
  END IF;
  IF p_decision #>> '{assurance,class}' IS DISTINCT FROM (v_policy->>'assurance_class')
     OR p_decision #>> '{assurance,server_proven}' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_ASSURANCE';
  END IF;
  IF p_need_continuity THEN
    IF jsonb_typeof(p_decision #> '{governance_continuity}') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_decision #> '{governance_continuity,subject_holds_governance_authority}') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(p_decision #> '{governance_continuity,remaining_independent_governors}') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_CONTINUITY';
    END IF;
    BEGIN
      v_holds := (p_decision #>> '{governance_continuity,subject_holds_governance_authority}')::boolean;
      v_remaining := (p_decision #>> '{governance_continuity,remaining_independent_governors}')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_CONTINUITY';
    END;
    IF v_holds IS NULL OR v_remaining IS NULL OR v_remaining < 0 THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_CONTINUITY';
    END IF;
    IF v_holds AND v_remaining < ((v_policy->>'min_independent_governors')::int) THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE/GOVERNANCE_CONTINUITY_PROTECTION';
    END IF;
  END IF;
END;
$$;

-- ── The request ledger: immutable facts of each governed request ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.corporate_membership_requests (
  request_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation           TEXT NOT NULL CHECK (operation IN ('CREATE', 'ACTIVATE', 'SUSPEND', 'RESTORE', 'END')),
  approval_required   BOOLEAN NOT NULL,
  membership_id       UUID NOT NULL,
  subject_user_id     TEXT NOT NULL,
  org_node_id         TEXT NOT NULL,
  from_state          TEXT CHECK (from_state IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
  to_state            TEXT NOT NULL CHECK (to_state IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED')),
  -- The membership's latest lifecycle event when the request was made: the exact position an approval is bound to.
  expected_event_seq  INTEGER CHECK (expected_event_seq >= 1),
  classification      TEXT NOT NULL DEFAULT 'ROUTINE' CHECK (classification IN ('ROUTINE', 'SECURITY_COMPROMISE')),
  requester_user_id   TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requester_session_id TEXT NOT NULL CHECK (btrim(requester_session_id) <> ''),
  requester_assurance_class     TEXT NOT NULL CHECK (requester_assurance_class = 'A1_RECENT_REAUTH'),
  requester_assurance_proven_at TIMESTAMPTZ NOT NULL,
  request_reason      TEXT NOT NULL CHECK (btrim(request_reason) <> '' AND length(request_reason) <= 2000),
  request_reference   TEXT NOT NULL CHECK (btrim(request_reference) <> '' AND length(request_reference) <= 300),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  governance_decision JSONB NOT NULL CHECK (jsonb_typeof(governance_decision) = 'object' AND pg_column_size(governance_decision) <= 8192),
  session_revocation  JSONB CHECK (session_revocation IS NULL OR jsonb_typeof(session_revocation) = 'object'),
  binding_digest      TEXT NOT NULL CHECK (binding_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT corporate_membership_requests_membership_fk
    FOREIGN KEY (membership_id, subject_user_id, org_node_id)
    REFERENCES public.corporate_memberships (membership_id, user_id, org_node_id) ON DELETE RESTRICT,
  -- Nobody requests an operation on their OWN membership.
  CONSTRAINT corporate_membership_requests_actor_not_subject CHECK (requester_user_id <> subject_user_id),
  -- Only authority-INCREASING transitions need a checker; the shape of each operation is fixed here.
  CONSTRAINT corporate_membership_requests_operation_shape CHECK (
       (operation = 'CREATE'   AND from_state IS NULL       AND to_state = 'PENDING'   AND NOT approval_required AND expected_event_seq IS NULL)
    OR (operation = 'ACTIVATE' AND from_state = 'PENDING'   AND to_state = 'ACTIVE'    AND approval_required     AND expected_event_seq IS NOT NULL)
    OR (operation = 'SUSPEND'  AND from_state = 'ACTIVE'    AND to_state = 'SUSPENDED' AND NOT approval_required AND expected_event_seq IS NOT NULL)
    OR (operation = 'RESTORE'  AND from_state = 'SUSPENDED' AND to_state = 'ACTIVE'    AND approval_required     AND expected_event_seq IS NOT NULL)
    OR (operation = 'END'      AND from_state IN ('PENDING', 'ACTIVE', 'SUSPENDED') AND to_state = 'ENDED'
                               AND NOT approval_required AND expected_event_seq IS NOT NULL)),
  CONSTRAINT corporate_membership_requests_classification_scope CHECK (classification = 'ROUTINE' OR operation = 'SUSPEND'),
  CONSTRAINT corporate_membership_requests_compromise_revocation CHECK (classification <> 'SECURITY_COMPROMISE' OR session_revocation IS NOT NULL),
  CONSTRAINT corporate_membership_requests_expiry_ordered CHECK (expires_at > requested_at)
);
CREATE INDEX IF NOT EXISTS idx_corporate_membership_requests_subject    ON public.corporate_membership_requests (subject_user_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_corporate_membership_requests_membership ON public.corporate_membership_requests (membership_id);
CREATE INDEX IF NOT EXISTS idx_corporate_membership_requests_requester  ON public.corporate_membership_requests (requester_user_id, requested_at);

-- ── The step ledger: append-only decisions and outcomes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.corporate_membership_request_steps (
  step_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          UUID NOT NULL REFERENCES public.corporate_membership_requests(request_id) ON DELETE RESTRICT,
  step_seq            INTEGER NOT NULL CHECK (step_seq >= 1),
  step_type           TEXT NOT NULL CHECK (step_type IN ('APPROVED', 'REFUSED', 'CANCELLED', 'EXPIRED', 'EXECUTED', 'EXECUTION_REFUSED')),
  actor_user_id       TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_session_id    TEXT NOT NULL CHECK (btrim(actor_session_id) <> ''),
  assurance_class     TEXT NOT NULL CHECK (assurance_class = 'A1_RECENT_REAUTH'),
  assurance_proven_at TIMESTAMPTZ NOT NULL,
  governance_decision JSONB NOT NULL CHECK (jsonb_typeof(governance_decision) = 'object' AND pg_column_size(governance_decision) <= 8192),
  binding_digest      TEXT NOT NULL CHECK (binding_digest ~ '^[0-9a-f]{64}$'),
  outcome_classification TEXT NOT NULL,
  reason              TEXT CHECK (reason IS NULL OR (btrim(reason) <> '' AND length(reason) <= 2000)),
  result_membership_id UUID,
  result_event_seq    INTEGER CHECK (result_event_seq >= 1),
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT corporate_membership_request_steps_one_per_seq UNIQUE (request_id, step_seq),
  -- What each kind of step must carry, and nothing else.
  CONSTRAINT corporate_membership_request_steps_outcome_shape CHECK (
       (step_type = 'APPROVED'          AND outcome_classification = 'APPROVED'               AND reason IS NOT NULL)
    OR (step_type = 'REFUSED'           AND outcome_classification = 'REFUSED_BY_CHECKER'     AND reason IS NOT NULL)
    OR (step_type = 'CANCELLED'         AND outcome_classification = 'CANCELLED_BY_REQUESTER' AND reason IS NOT NULL)
    OR (step_type = 'EXPIRED'           AND outcome_classification IN ('REQUEST_EXPIRED', 'APPROVAL_EXPIRED'))
    OR (step_type = 'EXECUTED'          AND outcome_classification = 'EXECUTED')
    OR (step_type = 'EXECUTION_REFUSED' AND outcome_classification = 'STALE_PRECONDITION')),
  CONSTRAINT corporate_membership_request_steps_result_shape CHECK (
    (step_type = 'EXECUTED' AND result_membership_id IS NOT NULL AND result_event_seq IS NOT NULL)
    OR (step_type <> 'EXECUTED' AND result_membership_id IS NULL AND result_event_seq IS NULL)),
  -- An executed request points at the ONE lifecycle event it produced.
  CONSTRAINT corporate_membership_request_steps_event_fk
    FOREIGN KEY (result_membership_id, result_event_seq)
    REFERENCES public.corporate_membership_events (membership_id, event_seq) ON DELETE RESTRICT
);
-- Structural replay protection. A request has at most ONE decision, and at most ONE terminal step; an approval that has been
-- consumed (EXECUTED) can never be consumed again, whoever asks and however often.
CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_membership_request_steps_one_decision
  ON public.corporate_membership_request_steps (request_id) WHERE step_type IN ('APPROVED', 'REFUSED');
CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_membership_request_steps_one_terminal
  ON public.corporate_membership_request_steps (request_id) WHERE step_type IN ('REFUSED', 'CANCELLED', 'EXPIRED', 'EXECUTED', 'EXECUTION_REFUSED');
-- And one request per lifecycle event: two requests can never claim the same change.
CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_membership_request_steps_one_request_per_event
  ON public.corporate_membership_request_steps (result_membership_id, result_event_seq) WHERE step_type = 'EXECUTED';
CREATE INDEX IF NOT EXISTS idx_corporate_membership_request_steps_actor ON public.corporate_membership_request_steps (actor_user_id, occurred_at);

-- ── Guards ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.corporate_membership_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_m public.corporate_memberships%ROWTYPE;
  v_last integer;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_REQUEST_APPEND_ONLY' USING ERRCODE = 'restrict_violation';
  END IF;
  IF COALESCE(current_setting('carup.corporate_governance_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_REQUEST_ONLY_VIA_GOVERNED_PROCEDURE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.binding_digest IS DISTINCT FROM public.corporate_governance_binding_digest(
       NEW.request_id, NEW.membership_id, NEW.subject_user_id, NEW.org_node_id, NEW.operation, NEW.from_state, NEW.to_state, NEW.expected_event_seq) THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_REQUEST_BINDING_DIGEST' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.expires_at IS DISTINCT FROM NEW.requested_at + (((v_policy->>'request_ttl_seconds')::int) * interval '1 second') THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_REQUEST_EXPIRY' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_m FROM public.corporate_memberships WHERE membership_id = NEW.membership_id;
  SELECT COALESCE(MAX(event_seq), 0) INTO v_last FROM public.corporate_membership_events WHERE membership_id = NEW.membership_id;
  IF NEW.operation = 'CREATE' THEN
    -- The membership has just been created (PENDING, with exactly its creation event) by the same governed call.
    IF v_m.state IS DISTINCT FROM 'PENDING' OR v_last <> 1 THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_REQUEST_CREATE_POSITION' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- The request is recorded BEFORE its change: the membership must be exactly where the request says it is.
    IF v_m.state IS DISTINCT FROM NEW.from_state OR v_last <> NEW.expected_event_seq THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_REQUEST_POSITION' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.corporate_membership_request_steps_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_req  public.corporate_membership_requests%ROWTYPE;
  v_prev public.corporate_membership_request_steps%ROWTYPE;
  v_m    public.corporate_memberships%ROWTYPE;
  v_ev   public.corporate_membership_events%ROWTYPE;
  v_last integer;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_APPEND_ONLY' USING ERRCODE = 'restrict_violation';
  END IF;
  IF COALESCE(current_setting('carup.corporate_governance_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_ONLY_VIA_GOVERNED_PROCEDURE' USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT * INTO v_req FROM public.corporate_membership_requests WHERE request_id = NEW.request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_REQUEST_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT * INTO v_prev FROM public.corporate_membership_request_steps WHERE request_id = NEW.request_id ORDER BY step_seq DESC LIMIT 1;

  IF NEW.step_seq IS DISTINCT FROM COALESCE(v_prev.step_seq, 0) + 1 THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_SEQUENCE' USING ERRCODE = 'check_violation';
  END IF;
  -- Every step carries the request's own digest: an approval cannot be lifted from one request onto another.
  IF NEW.binding_digest IS DISTINCT FROM v_req.binding_digest THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_BINDING' USING ERRCODE = 'check_violation';
  END IF;
  IF v_prev.step_type IN ('REFUSED', 'CANCELLED', 'EXPIRED', 'EXECUTED', 'EXECUTION_REFUSED') THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_AFTER_TERMINAL' USING ERRCODE = 'check_violation';
  END IF;

  -- The only legal orders.
  IF NOT v_req.approval_required THEN
    IF NEW.step_type <> 'EXECUTED' OR v_prev.step_type IS NOT NULL THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_ORDER' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actor_user_id <> v_req.requester_user_id THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_ACTOR' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_prev.step_type IS NULL THEN
    IF NEW.step_type NOT IN ('APPROVED', 'REFUSED', 'CANCELLED', 'EXPIRED') THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_ORDER' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_prev.step_type = 'APPROVED' THEN
    IF NEW.step_type NOT IN ('EXECUTED', 'EXECUTION_REFUSED', 'CANCELLED', 'EXPIRED') THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_ORDER' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_ORDER' USING ERRCODE = 'check_violation';
  END IF;

  -- Who may take each step.
  IF NEW.actor_user_id = v_req.subject_user_id THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_ACTOR_IS_SUBJECT' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.step_type IN ('APPROVED', 'REFUSED') AND NEW.actor_user_id = v_req.requester_user_id THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_MAKER_IS_CHECKER' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.step_type = 'CANCELLED' AND NEW.actor_user_id <> v_req.requester_user_id THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_ACTOR' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.step_type IN ('EXECUTED', 'EXECUTION_REFUSED') AND v_req.approval_required
     AND NEW.actor_user_id NOT IN (v_req.requester_user_id, v_prev.actor_user_id) THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_ACTOR' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.step_type = 'EXECUTED' THEN
    IF v_req.approval_required THEN
      IF NEW.occurred_at - v_prev.occurred_at > (((v_policy->>'approval_ttl_seconds')::int) * interval '1 second') THEN
        RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_APPROVAL_STALE' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.occurred_at > v_req.expires_at THEN
        RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_REQUEST_EXPIRED' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- EXACTLY ONE lifecycle event, produced by this actor, for this transition. If that cannot be shown, nothing is recorded —
    -- and the membership change that preceded it in the same transaction goes with it.
    IF NEW.result_membership_id IS DISTINCT FROM v_req.membership_id THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_RESULT_MEMBERSHIP' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.result_event_seq IS DISTINCT FROM COALESCE(v_req.expected_event_seq, 0) + 1 THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_RESULT_EVENT_COUNT' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(MAX(event_seq), 0) INTO v_last FROM public.corporate_membership_events WHERE membership_id = v_req.membership_id;
    SELECT * INTO v_ev FROM public.corporate_membership_events WHERE membership_id = v_req.membership_id AND event_seq = NEW.result_event_seq;
    SELECT * INTO v_m  FROM public.corporate_memberships WHERE membership_id = v_req.membership_id;
    IF NOT FOUND OR v_last <> NEW.result_event_seq
       OR v_ev.to_state IS DISTINCT FROM v_req.to_state
       OR v_ev.from_state IS DISTINCT FROM v_req.from_state
       OR v_ev.actor_kind IS DISTINCT FROM 'USER'
       OR v_ev.actor_user_id IS DISTINCT FROM NEW.actor_user_id
       OR v_m.state IS DISTINCT FROM v_req.to_state THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_RESULT_EVENT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ev.event_type IS DISTINCT FROM (CASE WHEN v_req.operation = 'CREATE' THEN 'CREATED' ELSE 'TRANSITIONED' END) THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE_STEP_RESULT_EVENT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS corporate_membership_requests_guard ON public.corporate_membership_requests;
CREATE TRIGGER corporate_membership_requests_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.corporate_membership_requests
  FOR EACH ROW EXECUTE FUNCTION public.corporate_membership_requests_guard();
DROP TRIGGER IF EXISTS corporate_membership_requests_no_truncate ON public.corporate_membership_requests;
CREATE TRIGGER corporate_membership_requests_no_truncate
  BEFORE TRUNCATE ON public.corporate_membership_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.corporate_custody_truncate_guard();
DROP TRIGGER IF EXISTS corporate_membership_request_steps_guard ON public.corporate_membership_request_steps;
CREATE TRIGGER corporate_membership_request_steps_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.corporate_membership_request_steps
  FOR EACH ROW EXECUTE FUNCTION public.corporate_membership_request_steps_guard();
DROP TRIGGER IF EXISTS corporate_membership_request_steps_no_truncate ON public.corporate_membership_request_steps;
CREATE TRIGGER corporate_membership_request_steps_no_truncate
  BEFORE TRUNCATE ON public.corporate_membership_request_steps
  FOR EACH STATEMENT EXECUTE FUNCTION public.corporate_custody_truncate_guard();

-- ── Views ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- A request's status is simply its latest step. Nothing here is a second source of truth.
CREATE OR REPLACE VIEW public.corporate_membership_request_status WITH (security_invoker = true) AS
  SELECT r.request_id, r.operation, r.approval_required, r.membership_id, r.subject_user_id, r.org_node_id,
         r.requester_user_id, r.requested_at, r.expires_at,
         COALESCE(s.step_type, 'REQUESTED') AS status,
         s.step_seq AS last_step_seq, s.actor_user_id AS last_actor_user_id, s.occurred_at AS last_step_at,
         s.outcome_classification
    FROM public.corporate_membership_requests r
    LEFT JOIN LATERAL (
      SELECT * FROM public.corporate_membership_request_steps st WHERE st.request_id = r.request_id ORDER BY st.step_seq DESC LIMIT 1
    ) s ON TRUE;

-- The authorization epoch of an account: how many membership lifecycle events it has ever had. Every membership change by ANY
-- path (governed, or an owner-run ceremony) appends exactly one event, so the epoch increases by exactly one per change and
-- can never go down. A cache of Corporate authorization decisions keyed by (account, epoch) is therefore invalidated by every
-- accepted mutation, on every backend instance, with no shared in-process state.
CREATE OR REPLACE VIEW public.corporate_membership_authorization_epoch WITH (security_invoker = true) AS
  SELECT e.user_id, COUNT(*)::bigint AS authorization_epoch, MAX(e.occurred_at) AS last_change_at
    FROM public.corporate_membership_events e
   GROUP BY e.user_id;

-- ── The write interface ─────────────────────────────────────────────────────────────────────────────────────────

-- CREATE / SUSPEND / END — one authorized administrator, executed immediately, recorded as an already-executed request.
CREATE OR REPLACE FUNCTION public.corporate_membership_apply_direct(
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
  p_session_revocation jsonb,
  p_governance_decision jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_request_id uuid := gen_random_uuid();
  v_m public.corporate_memberships%ROWTYPE;
  v_membership_id uuid;
  v_subject text;
  v_node text;
  v_from text;
  v_to text;
  v_last integer;
  v_event_seq integer;
  v_proven timestamptz;
  v_class text := COALESCE(p_classification, 'ROUTINE');
  v_reference text;
  v_digest text;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_ref_in text := btrim(COALESCE(p_reference, ''));
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('CREATE', 'SUSPEND', 'END') THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/OPERATION_NOT_DIRECT';
  END IF;
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_REQUIRED'; END IF;
  IF p_subject_user_id IS NULL OR btrim(p_subject_user_id) = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/SUBJECT_REQUIRED'; END IF;
  IF p_actor_user_id = p_subject_user_id THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_IS_SUBJECT'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REASON_REQUIRED'; END IF;
  IF length(v_reason) > 2000 THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REASON_TOO_LONG'; END IF;
  IF v_ref_in = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REFERENCE_REQUIRED'; END IF;
  IF length(v_ref_in) > 300 THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REFERENCE_TOO_LONG'; END IF;
  IF v_class NOT IN ('ROUTINE', 'SECURITY_COMPROMISE') THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/CLASSIFICATION_INVALID'; END IF;
  IF v_class = 'SECURITY_COMPROMISE' AND p_operation <> 'SUSPEND' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/CLASSIFICATION_NOT_ALLOWED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_user_id) THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_UNKNOWN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_subject_user_id) THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/SUBJECT_UNKNOWN'; END IF;

  v_proven := public.corporate_governance_assert_a1(p_actor_session_id, p_actor_user_id);

  IF p_operation = 'CREATE' THEN
    IF p_membership_id IS NOT NULL THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/BINDING_MISMATCH'; END IF;
    IF p_org_node_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.corporate_org_nodes WHERE node_id = p_org_node_id) THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE/NODE_UNKNOWN';
    END IF;
    v_subject := p_subject_user_id;
    v_node := p_org_node_id;
    -- Serialise creators of the same pair; one live (non-ENDED) membership per account and node.
    PERFORM pg_advisory_xact_lock(hashtextextended('corporate_membership_create|' || v_subject || '|' || v_node, 0));
    IF EXISTS (SELECT 1 FROM public.corporate_memberships WHERE user_id = v_subject AND org_node_id = v_node AND state <> 'ENDED') THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE/MEMBERSHIP_ALREADY_LIVE';
    END IF;
  ELSE
    SELECT * INTO v_m FROM public.corporate_memberships WHERE membership_id = p_membership_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/MEMBERSHIP_NOT_FOUND'; END IF;
    IF v_m.user_id <> p_subject_user_id OR (p_org_node_id IS NOT NULL AND v_m.org_node_id <> p_org_node_id) THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE/BINDING_MISMATCH';
    END IF;
    v_subject := v_m.user_id;
    v_node := v_m.org_node_id;
    v_from := v_m.state;
    IF p_operation = 'SUSPEND' AND v_from <> 'ACTIVE' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ILLEGAL_TRANSITION'; END IF;
    IF p_operation = 'END' AND v_from NOT IN ('PENDING', 'ACTIVE', 'SUSPENDED') THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ILLEGAL_TRANSITION'; END IF;
    SELECT MAX(event_seq) INTO v_last FROM public.corporate_membership_events WHERE membership_id = v_m.membership_id;
  END IF;

  PERFORM public.corporate_governance_check_decision(
    p_governance_decision, p_actor_user_id, v_subject, v_node, v_class = 'SECURITY_COMPROMISE', p_operation = 'END');

  IF v_class = 'SECURITY_COMPROMISE' THEN
    IF p_session_revocation IS NULL OR jsonb_typeof(p_session_revocation) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE/SESSION_REVOCATION_REQUIRED';
    END IF;
    -- "Before leaving the privileged identity usable": at this instant, inside this transaction, the account holds no live session.
    IF EXISTS (SELECT 1 FROM public.user_sessions WHERE user_id = v_subject AND is_valid IS TRUE) THEN
      RAISE EXCEPTION 'CORPORATE_GOVERNANCE/SESSIONS_STILL_VALID';
    END IF;
  END IF;

  v_reference := 'CMR:' || v_request_id::text || ';' || v_ref_in;
  PERFORM set_config('carup.corporate_governance_write', 'on', true);

  IF p_operation = 'CREATE' THEN
    v_membership_id := gen_random_uuid();
    INSERT INTO public.corporate_memberships
      (membership_id, user_id, org_node_id, state, effective_from, effective_until,
       created_by_kind, created_by_user_id, created_reason, created_reference,
       updated_by_kind, updated_by_user_id, updated_reason, updated_reference)
    VALUES
      (v_membership_id, v_subject, v_node, 'PENDING', COALESCE(p_effective_from, now()), p_effective_until,
       'USER', p_actor_user_id, v_reason, v_reference,
       'USER', p_actor_user_id, v_reason, v_reference);
    v_from := NULL;
    v_to := 'PENDING';
    v_last := NULL;
    v_event_seq := 1;
  ELSE
    v_membership_id := v_m.membership_id;
    v_to := CASE p_operation WHEN 'SUSPEND' THEN 'SUSPENDED' ELSE 'ENDED' END;
    v_event_seq := v_last + 1;
  END IF;

  v_digest := public.corporate_governance_binding_digest(v_request_id, v_membership_id, v_subject, v_node, p_operation, v_from, v_to, v_last);

  INSERT INTO public.corporate_membership_requests
    (request_id, operation, approval_required, membership_id, subject_user_id, org_node_id, from_state, to_state,
     expected_event_seq, classification, requester_user_id, requester_session_id, requester_assurance_class,
     requester_assurance_proven_at, request_reason, request_reference, requested_at, expires_at,
     governance_decision, session_revocation, binding_digest)
  VALUES
    (v_request_id, p_operation, false, v_membership_id, v_subject, v_node, v_from, v_to,
     v_last, v_class, p_actor_user_id, p_actor_session_id, 'A1_RECENT_REAUTH',
     v_proven, v_reason, v_ref_in, now(), now() + (((v_policy->>'request_ttl_seconds')::int) * interval '1 second'),
     p_governance_decision, CASE WHEN v_class = 'SECURITY_COMPROMISE' THEN p_session_revocation END, v_digest);

  IF p_operation <> 'CREATE' THEN
    UPDATE public.corporate_memberships
       SET state = v_to,
           updated_by_kind = 'USER', updated_by_user_id = p_actor_user_id,
           updated_reason = v_reason, updated_reference = v_reference
     WHERE membership_id = v_membership_id;
  END IF;

  INSERT INTO public.corporate_membership_request_steps
    (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at,
     governance_decision, binding_digest, outcome_classification, reason, result_membership_id, result_event_seq)
  VALUES
    (v_request_id, 1, 'EXECUTED', p_actor_user_id, p_actor_session_id, 'A1_RECENT_REAUTH', v_proven,
     p_governance_decision, v_digest, 'EXECUTED', NULL, v_membership_id, v_event_seq);

  PERFORM set_config('carup.corporate_governance_write', 'off', true);

  RETURN jsonb_build_object(
    'outcome', 'EXECUTED', 'request_id', v_request_id, 'operation', p_operation,
    'membership_id', v_membership_id, 'subject_user_id', v_subject, 'org_node_id', v_node, 'state', v_to,
    'event_seq', v_event_seq,
    'authorization_epoch', (SELECT COUNT(*) FROM public.corporate_membership_events WHERE user_id = v_subject));
END;
$$;

-- ACTIVATE / RESTORE — the maker's request. Grants nothing: it only records what is being asked, bound to the exact position.
CREATE OR REPLACE FUNCTION public.corporate_membership_request_submit(
  p_operation text,
  p_membership_id uuid,
  p_requester_user_id text,
  p_requester_session_id text,
  p_reason text,
  p_reference text,
  p_governance_decision jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_request_id uuid := gen_random_uuid();
  v_m public.corporate_memberships%ROWTYPE;
  v_from text;
  v_to text;
  v_last integer;
  v_proven timestamptz;
  v_digest text;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_ref text := btrim(COALESCE(p_reference, ''));
  v_expires timestamptz := now() + (((v_policy->>'request_ttl_seconds')::int) * interval '1 second');
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('ACTIVATE', 'RESTORE') THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/OPERATION_NOT_REQUESTABLE'; END IF;
  IF p_requester_user_id IS NULL OR btrim(p_requester_user_id) = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_REQUIRED'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REASON_REQUIRED'; END IF;
  IF length(v_reason) > 2000 THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REASON_TOO_LONG'; END IF;
  IF v_ref = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REFERENCE_REQUIRED'; END IF;
  IF length(v_ref) > 300 THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REFERENCE_TOO_LONG'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_requester_user_id) THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_UNKNOWN'; END IF;

  SELECT * INTO v_m FROM public.corporate_memberships WHERE membership_id = p_membership_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/MEMBERSHIP_NOT_FOUND'; END IF;
  IF p_requester_user_id = v_m.user_id THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_IS_SUBJECT'; END IF;

  v_from := CASE p_operation WHEN 'ACTIVATE' THEN 'PENDING' ELSE 'SUSPENDED' END;
  v_to := 'ACTIVE';
  IF v_m.state <> v_from THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ILLEGAL_TRANSITION'; END IF;

  v_proven := public.corporate_governance_assert_a1(p_requester_session_id, p_requester_user_id);
  PERFORM public.corporate_governance_check_decision(p_governance_decision, p_requester_user_id, v_m.user_id, v_m.org_node_id, false, false);

  SELECT MAX(event_seq) INTO v_last FROM public.corporate_membership_events WHERE membership_id = v_m.membership_id;
  v_digest := public.corporate_governance_binding_digest(v_request_id, v_m.membership_id, v_m.user_id, v_m.org_node_id, p_operation, v_from, v_to, v_last);

  PERFORM set_config('carup.corporate_governance_write', 'on', true);
  INSERT INTO public.corporate_membership_requests
    (request_id, operation, approval_required, membership_id, subject_user_id, org_node_id, from_state, to_state,
     expected_event_seq, classification, requester_user_id, requester_session_id, requester_assurance_class,
     requester_assurance_proven_at, request_reason, request_reference, requested_at, expires_at,
     governance_decision, session_revocation, binding_digest)
  VALUES
    (v_request_id, p_operation, true, v_m.membership_id, v_m.user_id, v_m.org_node_id, v_from, v_to,
     v_last, 'ROUTINE', p_requester_user_id, p_requester_session_id, 'A1_RECENT_REAUTH',
     v_proven, v_reason, v_ref, now(), v_expires,
     p_governance_decision, NULL, v_digest);
  PERFORM set_config('carup.corporate_governance_write', 'off', true);

  RETURN jsonb_build_object(
    'outcome', 'REQUESTED', 'request_id', v_request_id, 'operation', p_operation, 'membership_id', v_m.membership_id,
    'subject_user_id', v_m.user_id, 'org_node_id', v_m.org_node_id, 'expected_event_seq', v_last,
    'binding_digest', v_digest, 'expires_at', v_expires);
END;
$$;

-- The checker's decision. APPROVE does not change the membership; it only records an approval that execute can consume once.
CREATE OR REPLACE FUNCTION public.corporate_membership_request_decide(
  p_request_id uuid,
  p_checker_user_id text,
  p_checker_session_id text,
  p_decision text,
  p_reason text,
  p_expected_subject_user_id text,
  p_expected_membership_id uuid,
  p_expected_org_node_id text,
  p_expected_operation text,
  p_expected_binding_digest text,
  p_governance_decision jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req public.corporate_membership_requests%ROWTYPE;
  v_prev public.corporate_membership_request_steps%ROWTYPE;
  v_proven timestamptz;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_type text;
  v_class text;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('APPROVE', 'REFUSE') THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/DECISION_VALUE_INVALID'; END IF;
  IF p_checker_user_id IS NULL OR btrim(p_checker_user_id) = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_REQUIRED'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REASON_REQUIRED'; END IF;
  IF length(v_reason) > 2000 THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REASON_TOO_LONG'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_checker_user_id) THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_UNKNOWN'; END IF;

  SELECT * INTO v_req FROM public.corporate_membership_requests WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REQUEST_NOT_FOUND'; END IF;
  IF NOT v_req.approval_required THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/NOT_APPROVAL_REQUIRED'; END IF;
  IF p_checker_user_id = v_req.subject_user_id THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_IS_SUBJECT'; END IF;
  IF p_checker_user_id = v_req.requester_user_id THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/MAKER_CHECKER_SAME_ACTOR'; END IF;

  v_proven := public.corporate_governance_assert_a1(p_checker_session_id, p_checker_user_id);
  PERFORM public.corporate_governance_check_decision(p_governance_decision, p_checker_user_id, v_req.subject_user_id, v_req.org_node_id, false, false);

  -- The approval is for EXACTLY this subject, membership, organisation node and transition — and nothing else.
  IF p_expected_subject_user_id IS DISTINCT FROM v_req.subject_user_id
     OR p_expected_membership_id IS DISTINCT FROM v_req.membership_id
     OR p_expected_org_node_id IS DISTINCT FROM v_req.org_node_id
     OR p_expected_operation IS DISTINCT FROM v_req.operation
     OR p_expected_binding_digest IS DISTINCT FROM v_req.binding_digest THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/BINDING_MISMATCH';
  END IF;

  SELECT * INTO v_prev FROM public.corporate_membership_request_steps WHERE request_id = p_request_id ORDER BY step_seq DESC LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REQUEST_NOT_OPEN'; END IF;

  PERFORM set_config('carup.corporate_governance_write', 'on', true);
  IF now() > v_req.expires_at THEN
    INSERT INTO public.corporate_membership_request_steps
      (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at,
       governance_decision, binding_digest, outcome_classification, reason)
    VALUES (p_request_id, 1, 'EXPIRED', p_checker_user_id, p_checker_session_id, 'A1_RECENT_REAUTH', v_proven,
            p_governance_decision, v_req.binding_digest, 'REQUEST_EXPIRED', NULL);
    PERFORM set_config('carup.corporate_governance_write', 'off', true);
    RETURN jsonb_build_object('outcome', 'EXPIRED', 'request_id', p_request_id, 'classification', 'REQUEST_EXPIRED');
  END IF;

  v_type := CASE p_decision WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REFUSED' END;
  v_class := CASE p_decision WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REFUSED_BY_CHECKER' END;
  INSERT INTO public.corporate_membership_request_steps
    (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at,
     governance_decision, binding_digest, outcome_classification, reason)
  VALUES (p_request_id, 1, v_type, p_checker_user_id, p_checker_session_id, 'A1_RECENT_REAUTH', v_proven,
          p_governance_decision, v_req.binding_digest, v_class, v_reason);
  PERFORM set_config('carup.corporate_governance_write', 'off', true);

  RETURN jsonb_build_object('outcome', v_type, 'request_id', p_request_id, 'step_seq', 1, 'classification', v_class);
END;
$$;

-- Consume an approval: apply the change, exactly once.
CREATE OR REPLACE FUNCTION public.corporate_membership_request_execute(
  p_request_id uuid,
  p_executor_user_id text,
  p_executor_session_id text,
  p_expected_binding_digest text,
  p_governance_decision jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy jsonb := public.corporate_governance_policy();
  v_req public.corporate_membership_requests%ROWTYPE;
  v_prev public.corporate_membership_request_steps%ROWTYPE;
  v_m public.corporate_memberships%ROWTYPE;
  v_last integer;
  v_proven timestamptz;
  v_reference text;
BEGIN
  IF p_executor_user_id IS NULL OR btrim(p_executor_user_id) = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_executor_user_id) THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_UNKNOWN'; END IF;

  -- The request row is the serialisation point: two callers cannot both pass the checks below.
  SELECT * INTO v_req FROM public.corporate_membership_requests WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REQUEST_NOT_FOUND'; END IF;
  IF NOT v_req.approval_required THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/NOT_APPROVAL_REQUIRED'; END IF;
  IF p_executor_user_id = v_req.subject_user_id THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_IS_SUBJECT'; END IF;

  v_proven := public.corporate_governance_assert_a1(p_executor_session_id, p_executor_user_id);

  SELECT * INTO v_prev FROM public.corporate_membership_request_steps WHERE request_id = p_request_id ORDER BY step_seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/APPROVAL_REQUIRED'; END IF;
  IF v_prev.step_type = 'EXECUTED' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REQUEST_ALREADY_CONSUMED'; END IF;
  IF v_prev.step_type <> 'APPROVED' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REQUEST_NOT_EXECUTABLE'; END IF;
  IF p_executor_user_id NOT IN (v_req.requester_user_id, v_prev.actor_user_id) THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/EXECUTOR_NOT_PARTY'; END IF;
  IF p_expected_binding_digest IS DISTINCT FROM v_req.binding_digest OR v_prev.binding_digest IS DISTINCT FROM v_req.binding_digest THEN
    RAISE EXCEPTION 'CORPORATE_GOVERNANCE/BINDING_MISMATCH';
  END IF;
  PERFORM public.corporate_governance_check_decision(p_governance_decision, p_executor_user_id, v_req.subject_user_id, v_req.org_node_id, false, false);

  PERFORM set_config('carup.corporate_governance_write', 'on', true);
  -- A stale approval is not a silent failure: it is recorded as the request's terminal outcome.
  IF now() > v_req.expires_at OR now() - v_prev.occurred_at > (((v_policy->>'approval_ttl_seconds')::int) * interval '1 second') THEN
    INSERT INTO public.corporate_membership_request_steps
      (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at,
       governance_decision, binding_digest, outcome_classification, reason)
    VALUES (p_request_id, v_prev.step_seq + 1, 'EXPIRED', p_executor_user_id, p_executor_session_id, 'A1_RECENT_REAUTH', v_proven,
            p_governance_decision, v_req.binding_digest,
            CASE WHEN now() > v_req.expires_at THEN 'REQUEST_EXPIRED' ELSE 'APPROVAL_EXPIRED' END, NULL);
    PERFORM set_config('carup.corporate_governance_write', 'off', true);
    RETURN jsonb_build_object('outcome', 'EXPIRED', 'request_id', p_request_id,
      'classification', CASE WHEN now() > v_req.expires_at THEN 'REQUEST_EXPIRED' ELSE 'APPROVAL_EXPIRED' END);
  END IF;

  SELECT * INTO v_m FROM public.corporate_memberships WHERE membership_id = v_req.membership_id FOR UPDATE;
  SELECT COALESCE(MAX(event_seq), 0) INTO v_last FROM public.corporate_membership_events WHERE membership_id = v_req.membership_id;
  IF NOT FOUND OR v_m.state IS DISTINCT FROM v_req.from_state OR v_last <> v_req.expected_event_seq THEN
    INSERT INTO public.corporate_membership_request_steps
      (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at,
       governance_decision, binding_digest, outcome_classification, reason)
    VALUES (p_request_id, v_prev.step_seq + 1, 'EXECUTION_REFUSED', p_executor_user_id, p_executor_session_id, 'A1_RECENT_REAUTH', v_proven,
            p_governance_decision, v_req.binding_digest, 'STALE_PRECONDITION', NULL);
    PERFORM set_config('carup.corporate_governance_write', 'off', true);
    RETURN jsonb_build_object('outcome', 'REFUSED', 'request_id', p_request_id, 'classification', 'STALE_PRECONDITION');
  END IF;

  v_reference := 'CMR:' || v_req.request_id::text || ';' || v_req.request_reference;
  UPDATE public.corporate_memberships
     SET state = v_req.to_state,
         updated_by_kind = 'USER', updated_by_user_id = p_executor_user_id,
         updated_reason = v_req.request_reason, updated_reference = v_reference
   WHERE membership_id = v_req.membership_id;

  INSERT INTO public.corporate_membership_request_steps
    (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at,
     governance_decision, binding_digest, outcome_classification, reason, result_membership_id, result_event_seq)
  VALUES (p_request_id, v_prev.step_seq + 1, 'EXECUTED', p_executor_user_id, p_executor_session_id, 'A1_RECENT_REAUTH', v_proven,
          p_governance_decision, v_req.binding_digest, 'EXECUTED', NULL, v_req.membership_id, v_req.expected_event_seq + 1);
  PERFORM set_config('carup.corporate_governance_write', 'off', true);

  RETURN jsonb_build_object(
    'outcome', 'EXECUTED', 'request_id', p_request_id, 'operation', v_req.operation,
    'membership_id', v_req.membership_id, 'subject_user_id', v_req.subject_user_id, 'org_node_id', v_req.org_node_id,
    'state', v_req.to_state, 'event_seq', v_req.expected_event_seq + 1,
    'authorization_epoch', (SELECT COUNT(*) FROM public.corporate_membership_events WHERE user_id = v_req.subject_user_id));
END;
$$;

-- The requester withdraws an open or approved-but-unexecuted request.
CREATE OR REPLACE FUNCTION public.corporate_membership_request_cancel(
  p_request_id uuid,
  p_actor_user_id text,
  p_actor_session_id text,
  p_reason text,
  p_governance_decision jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req public.corporate_membership_requests%ROWTYPE;
  v_prev public.corporate_membership_request_steps%ROWTYPE;
  v_proven timestamptz;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_REQUIRED'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REASON_REQUIRED'; END IF;
  IF length(v_reason) > 2000 THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REASON_TOO_LONG'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_user_id) THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ACTOR_UNKNOWN'; END IF;

  SELECT * INTO v_req FROM public.corporate_membership_requests WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REQUEST_NOT_FOUND'; END IF;
  IF NOT v_req.approval_required THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/NOT_APPROVAL_REQUIRED'; END IF;
  IF p_actor_user_id <> v_req.requester_user_id THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/ONLY_REQUESTER_MAY_CANCEL'; END IF;

  v_proven := public.corporate_governance_assert_a1(p_actor_session_id, p_actor_user_id);
  PERFORM public.corporate_governance_check_decision(p_governance_decision, p_actor_user_id, v_req.subject_user_id, v_req.org_node_id, false, false);

  SELECT * INTO v_prev FROM public.corporate_membership_request_steps WHERE request_id = p_request_id ORDER BY step_seq DESC LIMIT 1;
  IF FOUND AND v_prev.step_type <> 'APPROVED' THEN RAISE EXCEPTION 'CORPORATE_GOVERNANCE/REQUEST_NOT_OPEN'; END IF;

  PERFORM set_config('carup.corporate_governance_write', 'on', true);
  INSERT INTO public.corporate_membership_request_steps
    (request_id, step_seq, step_type, actor_user_id, actor_session_id, assurance_class, assurance_proven_at,
     governance_decision, binding_digest, outcome_classification, reason)
  VALUES (p_request_id, COALESCE(v_prev.step_seq, 0) + 1, 'CANCELLED', p_actor_user_id, p_actor_session_id, 'A1_RECENT_REAUTH', v_proven,
          p_governance_decision, v_req.binding_digest, 'CANCELLED_BY_REQUESTER', v_reason);
  PERFORM set_config('carup.corporate_governance_write', 'off', true);

  RETURN jsonb_build_object('outcome', 'CANCELLED', 'request_id', p_request_id, 'classification', 'CANCELLED_BY_REQUESTER');
END;
$$;

-- ── Privileges ───────────────────────────────────────────────────────────────────────────────────────────────
-- As in Phase A: REVOKE ALL FIRST, because Supabase's default privileges hand service_role / anon / authenticated ALL on every
-- NEW public table and function. Then the backend role gets exactly: SELECT on the ledgers and views, and EXECUTE on the five
-- write procedures. It gets no INSERT, UPDATE, DELETE, TRUNCATE, no lock, and no EXECUTE on any guard or helper.
ALTER TABLE public.corporate_membership_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_membership_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corporate_membership_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.corporate_membership_requests TO service_role;

ALTER TABLE public.corporate_membership_request_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_membership_request_steps FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corporate_membership_request_steps FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.corporate_membership_request_steps TO service_role;

REVOKE ALL ON TABLE public.corporate_membership_request_status FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.corporate_membership_request_status TO service_role;
REVOKE ALL ON TABLE public.corporate_membership_authorization_epoch FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.corporate_membership_authorization_epoch TO service_role;

REVOKE ALL ON FUNCTION public.corporate_governance_policy() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_governance_binding_digest(uuid, uuid, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_governance_assert_a1(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_governance_check_decision(jsonb, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_requests_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_request_steps_guard() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.corporate_membership_apply_direct(text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_request_submit(text, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_request_decide(uuid, text, text, text, text, text, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_request_execute(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.corporate_membership_request_cancel(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.corporate_membership_apply_direct(text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_membership_request_submit(text, uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_membership_request_decide(uuid, text, text, text, text, text, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_membership_request_execute(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.corporate_membership_request_cancel(uuid, text, text, text, jsonb) TO service_role;

-- +migrate Down
-- Phase B only: every Phase-A object is left exactly as it was. (Down must run BEFORE Phase A's Down: the ledgers reference
-- the Phase-A tables.)
DROP VIEW IF EXISTS public.corporate_membership_authorization_epoch;
DROP VIEW IF EXISTS public.corporate_membership_request_status;
DROP FUNCTION IF EXISTS public.corporate_membership_request_cancel(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.corporate_membership_request_execute(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.corporate_membership_request_decide(uuid, text, text, text, text, text, uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.corporate_membership_request_submit(text, uuid, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.corporate_membership_apply_direct(text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, text, jsonb, jsonb);
DROP TABLE IF EXISTS public.corporate_membership_request_steps;
DROP TABLE IF EXISTS public.corporate_membership_requests;
DROP FUNCTION IF EXISTS public.corporate_membership_request_steps_guard();
DROP FUNCTION IF EXISTS public.corporate_membership_requests_guard();
DROP FUNCTION IF EXISTS public.corporate_governance_check_decision(jsonb, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.corporate_governance_assert_a1(text, text);
DROP FUNCTION IF EXISTS public.corporate_governance_binding_digest(uuid, uuid, text, text, text, text, text, integer);
DROP FUNCTION IF EXISTS public.corporate_governance_policy();
