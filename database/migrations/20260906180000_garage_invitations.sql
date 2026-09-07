-- +migrate Up
-- GMO-6 — inviting a mechanic into a garage.
--
-- An invitation is a bounded, revocable, single-use offer to join ONE garage in ONE role. It is not
-- a membership: accepting it creates the membership, and until then it confers nothing.
--
-- The token is stored as a SHA-256 hash and never in the clear, matching `service_capability_grants`
-- (see `hashCapabilityToken` in serviceLinkService). Anyone reading this table — including a
-- database backup or a leaked query result — learns who was invited, never how to accept.
--
-- `invited_email` is the wrong-recipient guard. A link that anyone holding it could redeem is a
-- link that puts a stranger inside a garage's private customer list; acceptance requires the
-- authenticated person's own address to match the one invited.

CREATE TABLE IF NOT EXISTS public.garage_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Who was invited, and the address the acceptance is checked against.
  invited_email TEXT NOT NULL,
  invited_name TEXT,

  -- The role they will hold IN this garage. Never a platform role.
  role TEXT NOT NULL CHECK (role IN ('mechanic', 'admin')),

  invited_by_user_id TEXT NOT NULL REFERENCES public.users(id),

  -- SHA-256 of the raw token. The raw token exists only in the message sent to the invitee.
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,

  -- Single use. Once accepted, this invitation is spent.
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id TEXT REFERENCES public.users(id),

  revoked_at TIMESTAMPTZ,
  revoked_by_user_id TEXT REFERENCES public.users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- An acceptance records both when and by whom, or neither. A half-recorded acceptance is a
  -- membership nobody can attribute.
  CONSTRAINT garage_invitations_acceptance_coherent CHECK (
    (accepted_at IS NULL AND accepted_by_user_id IS NULL)
    OR (accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL)
  ),
  CONSTRAINT garage_invitations_revocation_coherent CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  ),
  -- An invitation cannot be both accepted and revoked. Whichever happened first is the truth, and
  -- the service refuses the second — this stops a race from recording an incoherent history.
  CONSTRAINT garage_invitations_not_both CHECK (
    accepted_at IS NULL OR revoked_at IS NULL
  )
);

-- One live invitation per person per garage. Re-inviting someone who already has a pending
-- invitation must reuse or replace it rather than filling their inbox with valid tokens, each of
-- which is a separate way into the garage.
CREATE UNIQUE INDEX IF NOT EXISTS idx_garage_invitations_one_live_per_email
  ON public.garage_invitations (tenant_id, LOWER(invited_email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_garage_invitations_tenant
  ON public.garage_invitations (tenant_id, created_at DESC);

COMMENT ON TABLE public.garage_invitations IS
  'GMO-6 mechanic invitations. Single-use, expiring, revocable, bound to one tenant and one email. '
  'The token is stored hashed; an invitation confers nothing until accepted.';
COMMENT ON COLUMN public.garage_invitations.invited_email IS
  'The wrong-recipient guard: acceptance requires the authenticated person''s own address to match.';
