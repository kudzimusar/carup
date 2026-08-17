-- +migrate Up
-- SA1C — generic secure auth action token primitive (CarUp custom auth, Path A).
--
-- CarUp authenticates with its own backend (public.users.password_hash -> public.user_sessions);
-- Supabase Auth is NOT used and auth.users is empty. This migration adds the missing primitive
-- behind password recovery / email verification WITHOUT creating a second user or session
-- authority: it references public.users and never issues a session.
--
-- Design invariants:
--   * raw bearer tokens are NEVER stored — only a SHA-256 hash of the token;
--   * single use, short expiry, purpose-bound, user-bound, revocable;
--   * consumption is atomic (a single conditional UPDATE ... RETURNING), so a replayed or
--     concurrent request cannot consume the same token twice.

CREATE TABLE IF NOT EXISTS public.auth_action_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purpose       text NOT NULL CHECK (purpose IN (
                  'password_reset',
                  'email_verification',
                  'email_change',
                  'reauthentication'
                )),
  -- SHA-256 hex of the raw token. Unique so a hash collision or duplicate insert cannot create
  -- two live tokens that answer to the same secret.
  token_hash    text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  requested_ip  text,
  user_agent    text,
  -- For email_change this carries the pending new address; never a secret.
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    text,
  source        text NOT NULL DEFAULT 'api'
);

COMMENT ON TABLE public.auth_action_tokens IS
  'SA1C: single-use, purpose-bound auth action tokens (password reset, email verification). Stores only a SHA-256 hash of the token; the raw token exists solely inside the one-time link sent to the user.';
COMMENT ON COLUMN public.auth_action_tokens.token_hash IS
  'SHA-256 hex digest of the raw token. The raw token is never persisted or logged.';

-- Lookup path for redemption.
CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_hash ON public.auth_action_tokens (token_hash);
-- Supersede/revoke path: find a user's live tokens for a purpose.
CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user_purpose
  ON public.auth_action_tokens (user_id, purpose, expires_at DESC);
-- Cheap sweep of still-live tokens for expiry housekeeping.
CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_live
  ON public.auth_action_tokens (expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

-- Deny-all by default: only the service role (which bypasses RLS) may touch these rows. There is
-- deliberately no policy for anon/authenticated — no browser client should ever read this table.
ALTER TABLE public.auth_action_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_action_tokens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.auth_action_tokens FROM anon, authenticated;

-- SA1F — additive email verification state.
--
-- NOTE: public.users.is_verified already exists and means IDENTITY/KYC verification (it is
-- surfaced as userContext.isVerified by authMiddleware). Email verification is a separate
-- concern and gets its own column rather than overloading that flag.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

COMMENT ON COLUMN public.users.email_verified_at IS
  'SA1F: when this account''s email address was verified. NULL = unverified. Accounts that existed before SA1 were grandfathered as verified at migration time so no current user is locked out; is_verified remains the separate identity/KYC flag.';

-- GRANDFATHERING (deliberate, documented): every account that existed before this migration is
-- treated as email-verified. Email verification applies to NEW signups only. Doing otherwise
-- would instantly mark the entire existing user base unverified and risk locking them out of
-- capabilities they already had.
UPDATE public.users
   SET email_verified_at = COALESCE(created_at, now())
 WHERE email_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_verified_at ON public.users (email_verified_at);

-- SA1H/SA1I — governed auth+security Email templates.
--
-- classification='security' places these at P0 in the send-priority ladder
-- (backend/config/emailProviderQuota.js), above conversational/transactional/service/marketing.
-- body_template holds the canonical PLAIN-TEXT meaning, which is what is stored on the canonical
-- message and shown in the inbox; the branded HTML is rendered at send time from
-- backend/services/communication/authEmailTemplates.js keyed by auth_template_key, so the HTML
-- has exactly one source of truth and the queue payload stays small.
INSERT INTO public.communication_templates
  (template_key, business_workflow, stakeholder_audience, classification, owner_team, status, metadata)
VALUES
  ('auth_password_reset_v1', 'authentication', 'customer', 'security', 'security', 'active',
   '{"sa1":true,"auth_template_key":"reset_password","priority":"P0"}'::jsonb),
  ('auth_password_changed_v1', 'authentication', 'customer', 'security', 'security', 'active',
   '{"sa1":true,"auth_template_key":"password_changed","priority":"P0"}'::jsonb),
  ('auth_email_verification_v1', 'authentication', 'customer', 'security', 'security', 'active',
   '{"sa1":true,"auth_template_key":"confirm_signup","priority":"P0"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO public.communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en',
       'Reset your CarUp password',
       'A password reset was requested for your CarUp account. Open this link to choose a new password: {{action_url}}. This link can be used once and expires shortly. If you did not request this, you can safely ignore this email — no changes have been made to your account.',
       '["action_url"]'::jsonb, '[]'::jsonb, 'approved',
       '{"sa1":true,"auth_template_key":"reset_password"}'::jsonb
FROM public.communication_templates WHERE template_key='auth_password_reset_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO public.communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en',
       'Your CarUp password was changed',
       'The password for your CarUp account was changed. If this was you, no further action is needed. If you did not make this change, secure your account immediately and contact CarUp support.',
       '[]'::jsonb, '[]'::jsonb, 'approved',
       '{"sa1":true,"auth_template_key":"password_changed"}'::jsonb
FROM public.communication_templates WHERE template_key='auth_password_changed_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

INSERT INTO public.communication_template_versions
  (template_id, version, channel, language, subject_template, body_template,
   required_variables, optional_variables, approval_status, experiment_metadata)
SELECT id, 1, 'default', 'en',
       'Confirm your CarUp account',
       'Welcome to CarUp. Confirm this email address to activate your account: {{action_url}}. This link can be used once and expires shortly. If you did not create a CarUp account, you can safely ignore this email.',
       '["action_url"]'::jsonb, '[]'::jsonb, 'approved',
       '{"sa1":true,"auth_template_key":"confirm_signup"}'::jsonb
FROM public.communication_templates WHERE template_key='auth_email_verification_v1'
ON CONFLICT (template_id, version, channel, language) DO NOTHING;

-- +migrate Down
-- Reversible only in the structural sense: dropping auth_action_tokens discards any live
-- reset/verification tokens (users simply request a new link). email_verified_at is deliberately
-- NOT dropped by default — it carries the grandfathering decision for the pre-SA1 user base, and
-- destroying it would silently mark every existing account unverified on re-apply.

DELETE FROM public.communication_template_versions
 WHERE template_id IN (
   SELECT id FROM public.communication_templates
    WHERE template_key IN ('auth_password_reset_v1','auth_password_changed_v1','auth_email_verification_v1')
 );

DELETE FROM public.communication_templates
 WHERE template_key IN ('auth_password_reset_v1','auth_password_changed_v1','auth_email_verification_v1');

DROP INDEX IF EXISTS idx_users_email_verified_at;
DROP TABLE IF EXISTS public.auth_action_tokens;
