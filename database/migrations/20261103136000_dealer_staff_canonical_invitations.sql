-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
-- CARUP DEALER D7 C16: existing-CarUp-account staff invitation; no ghost
-- accounts, global role changes, owner role delegation or parallel tenant auth.
CREATE TABLE dealer_staff_invitation_records (
 invite_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 dealer_profile_id UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 invited_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 requested_role TEXT NOT NULL DEFAULT 'member' CHECK(requested_role='member'),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REVOKED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '7 days'),
 accepted_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ,
 CHECK(invited_by<>invited_user_id),
 CHECK(expires_at>created_at),
 CHECK(
  (status='PENDING' AND accepted_at IS NULL AND revoked_at IS NULL) OR
  (status='ACCEPTED' AND accepted_at IS NOT NULL AND revoked_at IS NULL) OR
  (status='REVOKED' AND revoked_at IS NOT NULL)
 )
);
CREATE UNIQUE INDEX dealer_staff_current_invitation
 ON dealer_staff_invitation_records(dealer_profile_id,invited_user_id)
 WHERE status IN ('PENDING','ACCEPTED');
CREATE TABLE dealer_staff_invitation_events (
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 invite_id UUID NOT NULL REFERENCES dealer_staff_invitation_records(invite_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('INVITED','ACCEPTED','REVOKED')),
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 canonical_member_role TEXT CHECK(canonical_member_role='member')
);
ALTER TABLE dealer_staff_invitation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_staff_invitation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_staff_invitation_records,dealer_staff_invitation_events
 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_staff_invitation_records,dealer_staff_invitation_events
 TO service_role;
CREATE TRIGGER dealer_staff_events_no_update BEFORE UPDATE ON dealer_staff_invitation_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_staff_events_no_delete BEFORE DELETE ON dealer_staff_invitation_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- All staff operations share the canonical legal/business/membership eligibility.
CREATE FUNCTION dealer_assert_staff_owner(
 p_profile_id UUID,p_actor_id TEXT
) RETURNS dealer_approved_seed_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 d dealer_profiles%ROWTYPE;
 l dealer_approved_seed_links%ROWTYPE;
 t tenants%ROWTYPE;
 m tenant_users%ROWTYPE;
 legal dealer_legal_application_reviews%ROWTYPE;
 policy dealer_country_legal_policy_authority%ROWTYPE;
 owner users%ROWTYPE;
BEGIN
 SELECT * INTO d FROM dealer_profiles WHERE id=p_profile_id;
 SELECT * INTO l FROM dealer_approved_seed_links
  WHERE dealer_profile_id=p_profile_id AND claimant_user_id=p_actor_id
    AND operating_status='ACTIVE';
 SELECT * INTO owner FROM users WHERE id=p_actor_id;
 SELECT * INTO t FROM tenants WHERE id=l.tenant_id;
 SELECT * INTO m FROM tenant_users WHERE tenant_id=l.tenant_id AND user_id=p_actor_id;
 SELECT * INTO legal FROM dealer_legal_application_reviews WHERE legal_review_id=l.legal_review_id;
 SELECT * INTO policy FROM dealer_country_legal_policy_authority WHERE
  country_code=legal.country_code AND policy_version=legal.policy_version;
 IF d.id IS NULL OR l.link_id IS NULL OR t.id IS NULL OR m.user_id IS NULL OR
   owner.id IS NULL OR owner.is_verified IS DISTINCT FROM true OR
   d.user_id<>p_actor_id OR d.tenant_id<>l.tenant_id::TEXT OR
   d.active_state<>'active' OR d.identity_status<>'verified' OR
   d.compliance_review_state<>'passed' OR d.restriction_state<>'none' OR
   d.suspension_state<>'none' OR d.investigation_state<>'none' OR
   coalesce(d.expiry_date,'epoch'::timestamptz)<=now() OR
   t.type<>'dealership' OR t.status<>'active' OR m.role<>'dealer' OR
   coalesce(policy.policy_state,'')<>'APPROVED' OR
   coalesce(policy.effective_at,'infinity'::timestamptz)>now() OR
   coalesce(policy.expires_at,'epoch'::timestamptz)<=now() OR
   coalesce(legal.legal_expires_at,'epoch'::timestamptz)<=now() THEN
   RAISE EXCEPTION 'VERIFIED_CANONICAL_LEGAL_OWNER_REQUIRED_FOR_STAFF';
 END IF;
 RETURN l;
END;
$$;
REVOKE ALL ON FUNCTION dealer_assert_staff_owner(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_assert_staff_owner(UUID,TEXT) TO service_role;

CREATE FUNCTION dealer_invite_existing_staff_account(
 p_profile_id UUID,p_owner_id TEXT,p_invited_user_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 l dealer_approved_seed_links%ROWTYPE;
 invited users%ROWTYPE;
 existing dealer_staff_invitation_records%ROWTYPE;
 v_id UUID;
BEGIN
 -- Membership/active legal policy verified in one database transaction.
 PERFORM 1 FROM dealer_profiles WHERE id=p_profile_id FOR UPDATE;
 l:=dealer_assert_staff_owner(p_profile_id,p_owner_id);
 SELECT * INTO invited FROM users WHERE id=p_invited_user_id;
 IF NOT FOUND OR invited.is_verified IS DISTINCT FROM true OR
  p_invited_user_id=p_owner_id OR
  invited.role<>'member' THEN
  RAISE EXCEPTION 'VERIFIED_EXISTING_STAFF_ACCOUNT_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM tenant_users WHERE tenant_id=l.tenant_id
    AND user_id=p_invited_user_id) OR
  EXISTS(SELECT 1 FROM organization_users WHERE organization_id=l.organization_id
    AND user_id=p_invited_user_id) THEN
   RAISE EXCEPTION 'STAFF_ALREADY_CANONICAL_MEMBER'; END IF;
 SELECT * INTO existing FROM dealer_staff_invitation_records
  WHERE dealer_profile_id=p_profile_id AND invited_user_id=p_invited_user_id
   AND status IN ('PENDING','ACCEPTED') FOR UPDATE;
 IF FOUND THEN
  IF existing.status='PENDING' AND existing.expires_at>now() AND
   existing.tenant_id=l.tenant_id AND existing.organization_id=l.organization_id THEN
    RETURN jsonb_build_object('invite_id',existing.invite_id,
      'status','PENDING','idempotent',true,'permissions_granted',false);
  END IF;
  RAISE EXCEPTION 'STAFF_INVITATION_EXISTING_OR_EXPIRED';
 END IF;
 INSERT INTO dealer_staff_invitation_records(dealer_profile_id,tenant_id,
  organization_id,invited_user_id,invited_by)
 VALUES (p_profile_id,l.tenant_id,l.organization_id,p_invited_user_id,p_owner_id)
 RETURNING invite_id INTO v_id;
 INSERT INTO dealer_staff_invitation_events(invite_id,actor_user_id,action)
 VALUES(v_id,p_owner_id,'INVITED');
 RETURN jsonb_build_object('invite_id',v_id,'status','PENDING',
  'idempotent',false,'permissions_granted',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_invite_existing_staff_account(UUID,TEXT,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_invite_existing_staff_account(UUID,TEXT,TEXT)
 TO service_role;

CREATE FUNCTION dealer_accept_staff_invitation(
 p_invite_id UUID,p_invited_actor_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 i dealer_staff_invitation_records%ROWTYPE;
 l dealer_approved_seed_links%ROWTYPE;
 invited users%ROWTYPE;
 v_role_id TEXT;v_member_id TEXT;
BEGIN
 SELECT * INTO i FROM dealer_staff_invitation_records WHERE invite_id=p_invite_id FOR UPDATE;
 IF NOT FOUND OR i.invited_user_id<>p_invited_actor_id THEN
   RAISE EXCEPTION 'OWN_STAFF_INVITATION_REQUIRED'; END IF;
 IF i.status='ACCEPTED' THEN
   IF EXISTS(SELECT 1 FROM tenant_users WHERE tenant_id=i.tenant_id
      AND user_id=p_invited_actor_id AND role='member') THEN
    RETURN jsonb_build_object('invite_id',p_invite_id,'status','ACCEPTED',
      'idempotent',true,'canonical_member_created',true,'role','member');
   END IF;
   RAISE EXCEPTION 'STAFF_MEMBERSHIP_DRIFT_REQUIRES_INDEPENDENT_REPAIR';
 END IF;
 IF i.status<>'PENDING' OR i.expires_at<=now() THEN
   RAISE EXCEPTION 'STAFF_INVITATION_EXPIRED_OR_REVOKED'; END IF;
 SELECT * INTO invited FROM users WHERE id=p_invited_actor_id;
 IF NOT FOUND OR invited.is_verified IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'VERIFIED_INVITED_STAFF_SESSION_REQUIRED'; END IF;
 l:=dealer_assert_staff_owner(i.dealer_profile_id,i.invited_by);
 IF l.tenant_id<>i.tenant_id OR l.organization_id<>i.organization_id THEN
   RAISE EXCEPTION 'STAFF_INVITATION_TENANT_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM tenant_users WHERE tenant_id=i.tenant_id
   AND user_id=p_invited_actor_id) THEN
   RAISE EXCEPTION 'STAFF_ALREADY_CANONICAL_MEMBER'; END IF;
 v_role_id:='dealer_staff_role_'||lower(replace(l.seed_dealer_id,'-','_'));
 v_member_id:='dealer_staff_member_'||replace(i.invite_id::TEXT,'-','');
 INSERT INTO organization_roles(id,organization_id,name,level,description)
 VALUES(v_role_id,l.organization_id,'Dealer staff',10,
  'Limited canonical dealership staff only; no signatory, owner or reviewer powers')
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO organization_users(id,organization_id,user_id,role_id,status,joined_at)
 VALUES(v_member_id,l.organization_id,p_invited_actor_id,v_role_id,'active',now()::TEXT);
 INSERT INTO tenant_users(tenant_id,user_id,role)
 VALUES(i.tenant_id,p_invited_actor_id,'member');
 UPDATE dealer_staff_invitation_records
 SET status='ACCEPTED',accepted_at=now() WHERE invite_id=p_invite_id;
 INSERT INTO dealer_staff_invitation_events(invite_id,actor_user_id,action,canonical_member_role)
 VALUES(p_invite_id,p_invited_actor_id,'ACCEPTED','member');
 RETURN jsonb_build_object('invite_id',p_invite_id,'status','ACCEPTED',
   'idempotent',false,'canonical_member_created',true,'role','member',
   'owner_role_granted',false,'vehicle_seller_authority_granted',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_accept_staff_invitation(UUID,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_accept_staff_invitation(UUID,TEXT) TO service_role;

CREATE FUNCTION dealer_revoke_staff_invitation(
 p_invite_id UUID,p_owner_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 i dealer_staff_invitation_records%ROWTYPE;
 l dealer_approved_seed_links%ROWTYPE;
 v_member_id TEXT;
BEGIN
 SELECT * INTO i FROM dealer_staff_invitation_records WHERE invite_id=p_invite_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_STAFF_INVITATION'; END IF;
 l:=dealer_assert_staff_owner(i.dealer_profile_id,p_owner_id);
 IF l.tenant_id<>i.tenant_id OR l.organization_id<>i.organization_id OR
   i.invited_by<>p_owner_id THEN
   RAISE EXCEPTION 'ONLY_CANONICAL_ORIGINAL_OWNER_MAY_REVOKE_STAFF'; END IF;
 IF i.status='REVOKED' THEN
   RETURN jsonb_build_object('invite_id',p_invite_id,'status','REVOKED',
     'idempotent',true,'member_access_revoked',true);
 END IF;
 IF i.status='ACCEPTED' THEN
   v_member_id:='dealer_staff_member_'||replace(i.invite_id::TEXT,'-','');
   DELETE FROM organization_users WHERE id=v_member_id
     AND organization_id=i.organization_id AND user_id=i.invited_user_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_ORGANIZATION_MEMBERSHIP_DRIFT'; END IF;
   DELETE FROM tenant_users WHERE tenant_id=i.tenant_id
     AND user_id=i.invited_user_id AND role='member';
   IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_TENANT_MEMBERSHIP_DRIFT'; END IF;
 END IF;
 UPDATE dealer_staff_invitation_records SET status='REVOKED',revoked_at=now()
  WHERE invite_id=p_invite_id;
 INSERT INTO dealer_staff_invitation_events(invite_id,actor_user_id,action)
 VALUES(p_invite_id,p_owner_id,'REVOKED');
 RETURN jsonb_build_object('invite_id',p_invite_id,'status','REVOKED',
   'idempotent',false,'member_access_revoked',true);
END;
$$;
REVOKE ALL ON FUNCTION dealer_revoke_staff_invitation(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_revoke_staff_invitation(UUID,TEXT) TO service_role;

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM dealer_staff_invitation_records)
    OR EXISTS(SELECT 1 FROM dealer_staff_invitation_events) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_STAFF_INVITATION_CUSTODY';
 END IF;
END;
$$;
DROP FUNCTION IF EXISTS dealer_revoke_staff_invitation(UUID,TEXT);
DROP FUNCTION IF EXISTS dealer_accept_staff_invitation(UUID,TEXT);
DROP FUNCTION IF EXISTS dealer_invite_existing_staff_account(UUID,TEXT,TEXT);
DROP FUNCTION IF EXISTS dealer_assert_staff_owner(UUID,TEXT);
DROP TABLE IF EXISTS dealer_staff_invitation_events;
DROP TABLE IF EXISTS dealer_staff_invitation_records;
