-- +migrate Up
-- E2/E4 — opaque authenticated Reply-To routing tokens.
--
-- Outbound conversational Email uses a Reply-To of the form
--     conversation+<opaque-token>@mail.carup.dev
-- so a recipient's reply lands back on the EXACT canonical thread and participant.
--
-- Why a table rather than a self-describing signed token:
--   * an email local part is limited to 64 octets (RFC 5321), and an encrypted/signed payload
--     carrying thread+participant+expiry does not fit once base64url-encoded;
--   * the directive forbids exposing a raw trustable thread ID in the address.
-- A short random opaque handle solves both: nothing about the conversation is derivable from
-- the address, and resolution is an indexed lookup that revalidates live DB invariants.
--
-- Only a SHA-256 hash of the token is stored, so a database read cannot be replayed as a routing
-- credential. Unlike auth action tokens these are NOT single-use — a correspondent may reply many
-- times — but they are expiring, revocable and rotatable.

CREATE TABLE IF NOT EXISTS public.email_reply_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  version        integer NOT NULL DEFAULT 1,
  tenant_id      text NOT NULL,
  thread_id      uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.message_participants(id) ON DELETE CASCADE,
  binding_id     uuid REFERENCES public.conversation_channel_bindings(id) ON DELETE SET NULL,
  channel        text NOT NULL DEFAULT 'email',
  provider       text NOT NULL DEFAULT 'resend',
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  rotated_from   uuid REFERENCES public.email_reply_tokens(id) ON DELETE SET NULL,
  last_used_at   timestamptz,
  use_count      integer NOT NULL DEFAULT 0,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_reply_tokens IS
  'E4: opaque authenticated Reply-To routing handles for conversational Email. Stores only a SHA-256 hash; the raw token appears solely in the Reply-To address. Resolution must still revalidate live thread/participant/binding invariants.';

CREATE INDEX IF NOT EXISTS idx_email_reply_tokens_hash ON public.email_reply_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_email_reply_tokens_thread ON public.email_reply_tokens (thread_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_email_reply_tokens_live ON public.email_reply_tokens (expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.email_reply_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_reply_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_reply_tokens FROM anon, authenticated;

-- Durable outbound RFC Message-ID lookup (E2/E4).
--
-- An inbound reply carries In-Reply-To / References containing the RFC Message-ID of the outbound
-- message it answers. Resolving that back to the canonical message must be an indexed equality
-- lookup, and it must be unique per provider so two attempts cannot both claim one RFC id.
--
-- Deliberately scoped to the real Email transports. A blanket unique index would fail against
-- existing data: the in_app fake adapter emits a CONSTANT placeholder id ('in_app_in_app_null',
-- 187 rows at time of writing), which is not a provider message id at all. Constraining channels
-- that never carry a real RFC id buys nothing and would break the migration.
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_attempts_provider_message
  ON public.message_delivery_attempts (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL AND provider IN ('resend', 'brevo');

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_provider_request
  ON public.message_delivery_attempts (provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

-- Canonical suppression state (E5). Provider unsubscribe/complaint must reconcile INTO CarUp
-- rather than living only inside Brevo/Resend.
CREATE TABLE IF NOT EXISTS public.communication_suppressions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL DEFAULT 'platform',
  channel      text NOT NULL DEFAULT 'email',
  address      text NOT NULL,
  user_id      text,
  scope        text NOT NULL DEFAULT 'marketing'
                 CHECK (scope IN ('marketing', 'transactional', 'all')),
  reason       text NOT NULL
                 CHECK (reason IN ('unsubscribe', 'complaint', 'hard_bounce', 'manual', 'provider_suppression')),
  source       text NOT NULL DEFAULT 'provider_webhook',
  provider     text,
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  suppressed_at timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, address, scope)
);

COMMENT ON TABLE public.communication_suppressions IS
  'E5: canonical CarUp suppression state. Provider unsubscribe/complaint/hard-bounce reconciles here; CarUp consent remains authoritative over provider list state.';

CREATE INDEX IF NOT EXISTS idx_suppressions_address ON public.communication_suppressions (channel, address) WHERE released_at IS NULL;

ALTER TABLE public.communication_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_suppressions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.communication_suppressions FROM anon, authenticated;

-- +migrate Down
DROP TABLE IF EXISTS public.communication_suppressions;
DROP INDEX IF EXISTS idx_delivery_attempts_provider_request;
DROP INDEX IF EXISTS uq_delivery_attempts_provider_message;
DROP TABLE IF EXISTS public.email_reply_tokens;
