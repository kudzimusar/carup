-- +migrate Up
-- =============================================================
-- CarUp Diaspora Trade OS — Hardening H6: OAuth state nonce store
--
-- Backs one-time, replay-protected, expiring OAuth state for Drive authorization.
-- A nonce is issued at /drive/google/authorize and consumed at the callback via a
-- conditional update (consumed_at IS NULL), so a replayed or expired state is
-- rejected. No token material is stored here — only state metadata.
--
-- Additive, backwards-compatible. NOT applied to production by this program.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.diaspora_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce text NOT NULL,
  provider text NOT NULL DEFAULT 'google',
  user_id text NOT NULL,
  tenant_id uuid,
  issued_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT diaspora_oauth_states_nonce_unique UNIQUE (nonce)
);

CREATE INDEX IF NOT EXISTS idx_diaspora_oauth_states_user ON public.diaspora_oauth_states (user_id, provider);
CREATE INDEX IF NOT EXISTS idx_diaspora_oauth_states_expiry ON public.diaspora_oauth_states (expires_at);

-- Service-role only (backend); RLS on with no public policy denies anon/authenticated direct access.
ALTER TABLE public.diaspora_oauth_states ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.diaspora_oauth_states IS
  'One-time, expiring OAuth state nonces for Diaspora Drive authorization. Consumed via conditional update; never stores tokens.';

-- +migrate Down
DROP TABLE IF EXISTS public.diaspora_oauth_states;
