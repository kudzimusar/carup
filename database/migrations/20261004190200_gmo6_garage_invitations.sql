-- +migrate Up
-- OC-5E GMO-6 (ported from PR #209 6ea23bd8: 20260906180000 + the invitations part of 20260906200000) —
-- inviting a person into ONE garage in ONE role.
--
-- An invitation is a bounded, revocable, single-use offer. Until it is accepted it confers nothing.
-- The table is #209's shape, unchanged, so it applies over an environment that already ran #209's
-- copy (CREATE TABLE IF NOT EXISTS keeps an existing table as it is).
--
-- OC-5E, beyond #209:
--   * the table is RLS-forced and closed to every client role (#209 left it outside its RLS file's
--     reach on this lineage);
--   * acceptance is ONE transaction — `accept_garage_invitation`. #209 claimed the invitation, then
--     inserted the membership in a second call: a failed insert left a spent invitation and no
--     membership, and an existing-membership read that FAILED was treated as "not a member";
--   * F1: an invitation seats a person only in an ACTIVE GARAGE. #209 never read the tenant at
--     acceptance, so a dealership's tenant admin could mint memberships through this path;
--   * the person accepting must be the invited address AND have verified it (SA1): otherwise whoever
--     registers the invitee's address first takes the link. The address is read from the account
--     inside the transaction — never supplied by the caller.

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL OR to_regclass('public.tenant_users') IS NULL OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'GMO-6 requires tenants, tenant_users and users';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_verified_at') THEN
    RAISE EXCEPTION 'GMO-6 requires users.email_verified_at (20260817120000_sa1_auth_action_tokens)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.garage_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('mechanic', 'admin')),
  invited_by_user_id TEXT NOT NULL REFERENCES public.users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id TEXT REFERENCES public.users(id),
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id TEXT REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT garage_invitations_acceptance_coherent CHECK (
    (accepted_at IS NULL AND accepted_by_user_id IS NULL)
    OR (accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL)
  ),
  CONSTRAINT garage_invitations_revocation_coherent CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  ),
  CONSTRAINT garage_invitations_not_both CHECK (
    accepted_at IS NULL OR revoked_at IS NULL
  )
);

-- Two valid tokens for one person is two ways into the garage.
CREATE UNIQUE INDEX IF NOT EXISTS idx_garage_invitations_one_live_per_email
  ON public.garage_invitations (tenant_id, LOWER(invited_email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_garage_invitations_tenant
  ON public.garage_invitations (tenant_id, created_at DESC);

COMMENT ON TABLE public.garage_invitations IS
  'GMO-6 garage invitations. Single-use, expiring, revocable, bound to one active garage and one verified '
  'email. The token is stored hashed; an invitation confers nothing until accepted.';

ALTER TABLE public.garage_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garage_invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.garage_invitations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.garage_invitations TO service_role;

CREATE OR REPLACE FUNCTION public.accept_garage_invitation(
  p_token_hash TEXT,
  p_user_id    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv      public.garage_invitations%ROWTYPE;
  v_tenant   public.tenants%ROWTYPE;
  v_email    TEXT;
  v_verified TIMESTAMPTZ;
  v_member   public.tenant_users%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR BTRIM(p_user_id) = '' THEN
    RAISE EXCEPTION 'GARAGE_INVITATION_ACTOR_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The lock serializes acceptances of this invitation: the second waits, then sees the first's claim.
  SELECT * INTO v_inv FROM public.garage_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GARAGE_INVITATION_INVALID' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'GARAGE_INVITATION_REVOKED' USING ERRCODE = 'check_violation';
  END IF;

  -- A spent invitation is spent. For the person who spent it, it is the no-op it is.
  IF v_inv.accepted_at IS NOT NULL THEN
    IF v_inv.accepted_by_user_id = p_user_id THEN
      SELECT * INTO v_member FROM public.tenant_users WHERE tenant_id = v_inv.tenant_id AND user_id = p_user_id;
      RETURN jsonb_build_object('tenant_id', v_inv.tenant_id, 'role', COALESCE(v_member.role, v_inv.role),
        'membership_id', v_member.id, 'invitation_id', v_inv.id, 'created', FALSE, 'already_member', TRUE, 'claimed', FALSE);
    END IF;
    RAISE EXCEPTION 'GARAGE_INVITATION_USED' USING ERRCODE = 'check_violation';
  END IF;

  IF v_inv.expires_at < NOW() THEN
    RAISE EXCEPTION 'GARAGE_INVITATION_EXPIRED' USING ERRCODE = 'check_violation';
  END IF;

  -- F1: only an ACTIVE GARAGE seats anyone through an invitation.
  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_inv.tenant_id;
  -- Status is read exactly as the active-tenant verifier reads it: absent means the column default, 'active'.
  IF NOT FOUND OR v_tenant.type IS DISTINCT FROM 'garage' OR LOWER(COALESCE(v_tenant.status, 'active')) <> 'active' THEN
    RAISE EXCEPTION 'GARAGE_INVITATION_NOT_AN_ACTIVE_GARAGE' USING ERRCODE = 'check_violation';
  END IF;

  -- The wrong-recipient guard, against the account's OWN address — and that address must be verified.
  SELECT email, email_verified_at INTO v_email, v_verified FROM public.users WHERE id = p_user_id;
  IF NOT FOUND OR v_email IS NULL OR BTRIM(v_email) = '' THEN
    RAISE EXCEPTION 'GARAGE_INVITATION_NO_EMAIL' USING ERRCODE = 'check_violation';
  END IF;
  IF LOWER(BTRIM(v_email)) <> LOWER(BTRIM(v_inv.invited_email)) THEN
    RAISE EXCEPTION 'GARAGE_INVITATION_WRONG_RECIPIENT' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_verified IS NULL THEN
    RAISE EXCEPTION 'GARAGE_INVITATION_EMAIL_UNVERIFIED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Claim and seat in the SAME transaction: a spent invitation always has its member.
  UPDATE public.garage_invitations
     SET accepted_at = NOW(), accepted_by_user_id = p_user_id
   WHERE id = v_inv.id;

  -- A person already in this garage keeps the membership they have (the table is unique on the pair).
  SELECT * INTO v_member FROM public.tenant_users WHERE tenant_id = v_inv.tenant_id AND user_id = p_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object('tenant_id', v_inv.tenant_id, 'role', v_member.role, 'membership_id', v_member.id,
      'invitation_id', v_inv.id, 'created', FALSE, 'already_member', TRUE, 'claimed', TRUE);
  END IF;

  INSERT INTO public.tenant_users (tenant_id, user_id, role)
  VALUES (v_inv.tenant_id, p_user_id, v_inv.role)
  RETURNING * INTO v_member;

  RETURN jsonb_build_object('tenant_id', v_inv.tenant_id, 'role', v_member.role, 'membership_id', v_member.id,
    'invitation_id', v_inv.id, 'created', TRUE, 'already_member', FALSE, 'claimed', TRUE);
END;
$$;

COMMENT ON FUNCTION public.accept_garage_invitation(TEXT, TEXT) IS
  'OC-5E GMO-6: accept a garage invitation in one transaction — lock, refuse revoked/used/expired, F1 (an '
  'active garage only), the account''s own verified email must be the invited one, claim and seat together.';

REVOKE ALL ON FUNCTION public.accept_garage_invitation(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_garage_invitation(TEXT, TEXT) TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS public.accept_garage_invitation(TEXT, TEXT);
DROP TABLE IF EXISTS public.garage_invitations;
