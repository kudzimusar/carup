-- +migrate Up
-- O2-X4: explicit biometric consent as a governed, append-only identity-domain ledger.
--
-- Consent is an EVENT HISTORY, never a boolean on the user row: each grant and each
-- withdrawal is its own immutable row carrying the purposes, the exact consent-text version
-- the person saw, the policy version, and the actor/source. The CURRENT consent is derived
-- from the latest row per user. No biometric provider call may occur without an active
-- granted row — enforced in the identity service, pinned by tests.
--
-- Data minimisation: this table holds consent facts only. No biometric templates, embeddings
-- or media — CarUp's biometric storage rule is assessment + provenance + consent + decision.

CREATE TABLE IF NOT EXISTS public.identity_biometric_consents (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seq                  bigserial NOT NULL,
  user_id              text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id           uuid,
  status               text NOT NULL CHECK (status IN ('granted', 'withdrawn')),
  purposes             jsonb NOT NULL,
  policy_version       text NOT NULL,
  consent_text_version text NOT NULL,
  source               text NOT NULL,
  actor_kind           text NOT NULL CHECK (actor_kind IN ('user', 'system')),
  actor_user_id        text,
  supersedes_id        text REFERENCES public.identity_biometric_consents(id),
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_biometric_consent_actor CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL) OR actor_kind = 'system'
  )
);

CREATE INDEX IF NOT EXISTS idx_identity_biometric_consents_user
  ON public.identity_biometric_consents (user_id, seq DESC);

CREATE OR REPLACE FUNCTION public.identity_biometric_consents_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'identity_biometric_consents is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_identity_biometric_consents_append_only ON public.identity_biometric_consents;
CREATE TRIGGER trg_identity_biometric_consents_append_only
  BEFORE UPDATE OR DELETE ON public.identity_biometric_consents
  FOR EACH ROW EXECUTE FUNCTION public.identity_biometric_consents_append_only();

COMMENT ON TABLE public.identity_biometric_consents IS
  'Append-only biometric-consent ledger. Withdrawal is a new row; history is never erased. No biometric media/templates are ever stored here or anywhere in CarUp.';

ALTER TABLE public.identity_biometric_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_biometric_consents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_biometric_consents FROM anon, authenticated;
GRANT ALL ON public.identity_biometric_consents TO service_role;

-- +migrate Down
DROP TRIGGER IF EXISTS trg_identity_biometric_consents_append_only ON public.identity_biometric_consents;
DROP FUNCTION IF EXISTS public.identity_biometric_consents_append_only();
DROP TABLE IF EXISTS public.identity_biometric_consents;
