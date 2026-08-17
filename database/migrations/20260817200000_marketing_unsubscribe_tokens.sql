-- +migrate Up
-- E5/E7 — a real, functional unsubscribe action for governed marketing Email.
--
-- Found during E7 physical certification: a governed marketing message reached a human inbox and
-- rendered, but carried NO actionable unsubscribe control. The body asserted "use the unsubscribe
-- link" while containing no link, no HTML part, and no List-Unsubscribe header, and the send went
-- through Brevo's TRANSACTIONAL endpoint, which injects no footer of its own. There was therefore
-- no way for a recipient to stop marketing Email from the message itself — a compliance defect
-- (CAN-SPAM / GDPR / RFC 8058), not a cosmetic one.
--
-- CarUp remains the canonical consent authority: the unsubscribe action resolves HERE and mutates
-- CarUp's own consent + suppression state. It never manages the recipient inside Brevo.
--
-- Token design deliberately differs from auth_action_tokens (single-use, minutes-long): an
-- unsubscribe link lives in an inbox forever and RFC 8058 one-click POST may be replayed by the
-- mail client, so this token is multi-use and idempotent, but still opaque, hash-only at rest,
-- purpose-bound, and revocable.

CREATE TABLE IF NOT EXISTS public.marketing_unsubscribe_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       text NOT NULL UNIQUE,
  tenant_id        text NOT NULL DEFAULT 'platform',
  channel          text NOT NULL DEFAULT 'email',
  address          text NOT NULL,
  user_id          text,
  identity_id      uuid REFERENCES public.channel_identities (id) ON DELETE SET NULL,
  scope            text NOT NULL DEFAULT 'marketing'
                     CHECK (scope IN ('marketing', 'transactional', 'all')),
  campaign_id      uuid,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  use_count        integer NOT NULL DEFAULT 0,
  last_used_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketing_unsubscribe_tokens IS
  'E5/E7: opaque, hash-only, purpose-bound unsubscribe handles. Multi-use and idempotent because RFC 8058 one-click POST may be replayed by the mail client. The raw token exists only inside the delivered Email.';

COMMENT ON COLUMN public.marketing_unsubscribe_tokens.token_hash IS
  'SHA-256 of the raw token. The raw value is never stored, so a database disclosure cannot forge an unsubscribe.';

CREATE INDEX IF NOT EXISTS idx_marketing_unsub_tokens_address
  ON public.marketing_unsubscribe_tokens (channel, address)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_unsub_tokens_campaign
  ON public.marketing_unsubscribe_tokens (campaign_id)
  WHERE campaign_id IS NOT NULL;

ALTER TABLE public.marketing_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_unsubscribe_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_unsubscribe_tokens FROM anon, authenticated;

-- +migrate Down
DROP INDEX IF EXISTS public.idx_marketing_unsub_tokens_campaign;
DROP INDEX IF EXISTS public.idx_marketing_unsub_tokens_address;
DROP TABLE IF EXISTS public.marketing_unsubscribe_tokens;
