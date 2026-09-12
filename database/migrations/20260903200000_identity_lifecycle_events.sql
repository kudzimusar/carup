-- +migrate Up
-- O2-X3: the CURRENT identity lifecycle, as an append-only identity-domain ledger.
--
-- Phase 7C verification_sessions remain the immutable HISTORICAL proof ("approved at time T,
-- using evidence E, by reviewer R"). This table answers the different question "what is this
-- person's identity lifecycle NOW" (verified / reverification_required / suspended / compromised
-- / disputed / revoked / recovered) without ever rewriting a historical decision: the current
-- state is derived from the LATEST row here, and when no row exists it falls back to the
-- historical approval. Every transition carries subject, both states, reason, trigger, actor,
-- policy version and an evidence reference — no unexplained booleans.

CREATE TABLE IF NOT EXISTS public.identity_lifecycle_events (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- Monotonic order within the ledger: two events can share a created_at millisecond, and
  -- "current state" must never depend on a random-uuid tie-break.
  seq                bigserial NOT NULL,
  user_id            text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  previous_state     text NOT NULL,
  next_state         text NOT NULL CHECK (next_state IN (
                       'verified', 'reverification_required', 'suspended',
                       'compromised', 'disputed', 'revoked', 'recovered'
                     )),
  reason_code        text NOT NULL,
  trigger_source     text NOT NULL CHECK (trigger_source IN (
                       'reviewer_action', 'verification_approved', 'account_recovery',
                       'security_event', 'material_identity_change', 'document_expiry_sweep'
                     )),
  actor_kind         text NOT NULL CHECK (actor_kind IN ('user', 'system')),
  actor_user_id      text,
  actor_role         text,
  policy_version     text NOT NULL,
  evidence_reference text,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_lifecycle_actor CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL) OR actor_kind = 'system'
  )
);

CREATE INDEX IF NOT EXISTS idx_identity_lifecycle_events_user
  ON public.identity_lifecycle_events (user_id, seq DESC);

-- Append-only is the contract, enforced in the database rather than promised in prose: history
-- may be added to, never edited or erased — the same discipline as the trust audit ledger.
CREATE OR REPLACE FUNCTION public.identity_lifecycle_events_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'identity_lifecycle_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_identity_lifecycle_events_append_only ON public.identity_lifecycle_events;
CREATE TRIGGER trg_identity_lifecycle_events_append_only
  BEFORE UPDATE OR DELETE ON public.identity_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.identity_lifecycle_events_append_only();

COMMENT ON TABLE public.identity_lifecycle_events IS
  'Append-only CURRENT identity lifecycle ledger. Historical verification decisions live in verification_sessions and are never rewritten.';

ALTER TABLE public.identity_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_lifecycle_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_lifecycle_events FROM anon, authenticated;
GRANT ALL ON public.identity_lifecycle_events TO service_role;

-- +migrate Down
DROP TRIGGER IF EXISTS trg_identity_lifecycle_events_append_only ON public.identity_lifecycle_events;
DROP FUNCTION IF EXISTS public.identity_lifecycle_events_append_only();
DROP TABLE IF EXISTS public.identity_lifecycle_events;
