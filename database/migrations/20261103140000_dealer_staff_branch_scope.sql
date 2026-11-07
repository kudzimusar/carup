-- +migrate Up
-- R6 DBA #7: never queue indefinitely behind long transactions on canonical tables (fail with
-- 55P03 after 3 s instead; re-run the migration). Transaction-scoped (SET LOCAL): never leaks into a later migration.
SET LOCAL lock_timeout = '3s';
-- CARUP-DEALER-ONB-001 D7 C16: branch-specific, owner-approved staff operations.
-- Canonical tenant_users and organization_users are necessary but NOT
-- sufficient. No parallel membership, no global dealer role, no seller,
-- financial, compliance-review or merchant permissions.
CREATE TABLE dealer_staff_branch_scopes (
  scope_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id UUID NOT NULL REFERENCES dealer_staff_invitation_records(invite_id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES dealer_branches(id) ON DELETE RESTRICT,
  permission TEXT NOT NULL CHECK(permission IN ('VIEW_BRANCH','EDIT_BRANCH_DETAILS')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
  granted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  grant_reason TEXT NOT NULL CHECK(length(trim(grant_reason)) BETWEEN 16 AND 1000),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CHECK((status='ACTIVE' AND revoked_at IS NULL) OR
        (status='REVOKED' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX dealer_staff_one_active_branch_scope
 ON dealer_staff_branch_scopes(invite_id,branch_id,permission)
 WHERE status='ACTIVE';
CREATE INDEX dealer_staff_scope_by_invite ON dealer_staff_branch_scopes(invite_id,status);

CREATE TABLE dealer_staff_branch_scope_events (
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_id UUID NOT NULL REFERENCES dealer_staff_branch_scopes(scope_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 event_type TEXT NOT NULL CHECK(event_type IN
   ('GRANTED','REVOKED_BY_OWNER','AUTO_REVOKED_ON_INVITATION','BRANCH_DETAILS_EDITED')),
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER dealer_staff_branch_scope_events_no_update
 BEFORE UPDATE ON dealer_staff_branch_scope_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_staff_branch_scope_events_no_delete
 BEFORE DELETE ON dealer_staff_branch_scope_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
ALTER TABLE dealer_staff_branch_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_staff_branch_scope_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_staff_branch_scopes,dealer_staff_branch_scope_events
 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_staff_branch_scopes,dealer_staff_branch_scope_events TO service_role;

-- The original owner must still have a currently valid legal policy and
-- both canonical memberships; every candidate staff membership is verified
-- atomically after locking the invitation against concurrent revocation.
CREATE FUNCTION dealer_grant_staff_branch_scope(
 p_invite_id UUID,p_branch_id UUID,p_permission TEXT,p_owner_id TEXT,p_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=public,pg_temp AS $$
DECLARE
 i dealer_staff_invitation_records%ROWTYPE;
 l dealer_approved_seed_links%ROWTYPE;
 existing dealer_staff_branch_scopes%ROWTYPE;
 new_scope UUID;
BEGIN
 IF p_permission IS NULL OR p_permission NOT IN
  ('VIEW_BRANCH','EDIT_BRANCH_DETAILS') THEN
   RAISE EXCEPTION 'UNRECOGNIZED_STAFF_BRANCH_PERMISSION'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 16 AND 1000 THEN
   RAISE EXCEPTION 'BRANCH_SCOPE_REASON_REQUIRED'; END IF;
 SELECT * INTO i FROM dealer_staff_invitation_records
   WHERE invite_id=p_invite_id FOR UPDATE;
 IF NOT FOUND OR i.invited_by<>p_owner_id OR i.status<>'ACCEPTED' THEN
   RAISE EXCEPTION 'ACCEPTED_ORIGINAL_OWNER_STAFF_INVITATION_REQUIRED'; END IF;
 l:=dealer_assert_staff_owner(i.dealer_profile_id,p_owner_id);
 IF l.tenant_id<>i.tenant_id OR l.organization_id<>i.organization_id OR
    NOT EXISTS(SELECT 1 FROM dealer_branches WHERE id=p_branch_id
      AND dealer_id=i.dealer_profile_id) OR
    NOT EXISTS(SELECT 1 FROM tenant_users WHERE tenant_id=i.tenant_id
      AND user_id=i.invited_user_id AND role='member') OR
    NOT EXISTS(SELECT 1 FROM organization_users WHERE
      organization_id=i.organization_id AND user_id=i.invited_user_id
      AND status='active') THEN
   RAISE EXCEPTION 'CANONICAL_STAFF_BRANCH_LINKAGE_REQUIRED'; END IF;
 SELECT * INTO existing FROM dealer_staff_branch_scopes
  WHERE invite_id=p_invite_id AND branch_id=p_branch_id
   AND permission=p_permission AND status='ACTIVE' FOR UPDATE;
 IF FOUND THEN
   RETURN jsonb_build_object('scope_id',existing.scope_id,'status','ACTIVE',
     'permission',p_permission,'idempotent',true,'seller_rights_granted',false);
 END IF;
 INSERT INTO dealer_staff_branch_scopes(
   invite_id,branch_id,permission,granted_by,grant_reason)
 VALUES(p_invite_id,p_branch_id,p_permission,p_owner_id,trim(p_reason))
 RETURNING scope_id INTO new_scope;
 INSERT INTO dealer_staff_branch_scope_events(scope_id,actor_user_id,event_type)
 VALUES(new_scope,p_owner_id,'GRANTED');
 RETURN jsonb_build_object('scope_id',new_scope,'status','ACTIVE',
   'permission',p_permission,'idempotent',false,
   'seller_rights_granted',false,'finance_rights_granted',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_grant_staff_branch_scope(UUID,UUID,TEXT,TEXT,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_grant_staff_branch_scope(UUID,UUID,TEXT,TEXT,TEXT)
 TO service_role;

CREATE FUNCTION dealer_revoke_staff_branch_scope(
 p_scope_id UUID,p_owner_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=public,pg_temp AS $$
DECLARE
 s dealer_staff_branch_scopes%ROWTYPE;
 i dealer_staff_invitation_records%ROWTYPE;
 l dealer_approved_seed_links%ROWTYPE;
BEGIN
 SELECT * INTO s FROM dealer_staff_branch_scopes
  WHERE scope_id=p_scope_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_STAFF_BRANCH_SCOPE'; END IF;
 SELECT * INTO i FROM dealer_staff_invitation_records
  WHERE invite_id=s.invite_id FOR UPDATE;
 l:=dealer_assert_staff_owner(i.dealer_profile_id,p_owner_id);
 IF i.invited_by<>p_owner_id OR l.tenant_id<>i.tenant_id OR
    l.organization_id<>i.organization_id THEN
   RAISE EXCEPTION 'ONLY_ORIGINAL_OWNER_CAN_REVOKE_BRANCH_SCOPE'; END IF;
 IF s.status='REVOKED' THEN
   RETURN jsonb_build_object('scope_id',p_scope_id,'status','REVOKED',
     'idempotent',true);
 END IF;
 UPDATE dealer_staff_branch_scopes SET status='REVOKED',revoked_at=now()
  WHERE scope_id=p_scope_id;
 INSERT INTO dealer_staff_branch_scope_events(scope_id,actor_user_id,event_type)
 VALUES(p_scope_id,p_owner_id,'REVOKED_BY_OWNER');
 RETURN jsonb_build_object('scope_id',p_scope_id,'status','REVOKED',
    'idempotent',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_revoke_staff_branch_scope(UUID,TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_revoke_staff_branch_scope(UUID,TEXT) TO service_role;

-- Staff sees ONLY explicitly delegated branches, and only while their
-- actual member + organization custody and the owner's current legal
-- approval are still valid. The route must pass p_actor from a signed session.
CREATE FUNCTION dealer_list_my_staff_branches(p_actor_id TEXT)
 RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=public,pg_temp AS $$
DECLARE
 item RECORD;
 authorized dealer_approved_seed_links%ROWTYPE;
 response JSONB:='[]'::jsonb;
BEGIN
 IF p_actor_id IS NULL OR length(trim(p_actor_id))=0 THEN
   RAISE EXCEPTION 'CANONICAL_SIGNED_STAFF_SESSION_REQUIRED'; END IF;
 FOR item IN
  SELECT s.scope_id,s.branch_id,s.permission,i.invited_by,
   i.dealer_profile_id,i.tenant_id,i.organization_id,i.invited_user_id,
   b.name,b.address,b.latitude,b.longitude,b.opening_hours_text
  FROM dealer_staff_branch_scopes s
  JOIN dealer_staff_invitation_records i ON i.invite_id=s.invite_id
  JOIN dealer_branches b ON b.id=s.branch_id AND b.dealer_id=i.dealer_profile_id
  WHERE i.invited_user_id=p_actor_id AND i.status='ACCEPTED'
    AND s.status='ACTIVE'
    AND EXISTS(SELECT 1 FROM tenant_users t
      WHERE t.tenant_id=i.tenant_id AND t.user_id=p_actor_id AND t.role='member')
    AND EXISTS(SELECT 1 FROM organization_users o
      WHERE o.organization_id=i.organization_id AND o.user_id=p_actor_id
      AND o.status='active')
  ORDER BY b.name,s.permission
 LOOP
  authorized:=dealer_assert_staff_owner(item.dealer_profile_id,item.invited_by);
  IF authorized.tenant_id<>item.tenant_id OR
    authorized.organization_id<>item.organization_id THEN
    RAISE EXCEPTION 'STAFF_BRANCH_LEGAL_TENANT_MISMATCH'; END IF;
  response:=response||jsonb_build_array(jsonb_build_object(
   'scope_id',item.scope_id,'branch_id',item.branch_id,
   'permission',item.permission,'name',item.name,'address',item.address,
   'latitude',item.latitude,'longitude',item.longitude,
   'opening_hours_text',item.opening_hours_text,
   'owner_rights',false,'listing_rights',false,'finance_rights',false));
 END LOOP;
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION dealer_list_my_staff_branches(TEXT)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_list_my_staff_branches(TEXT) TO service_role;

-- This edit never bypasses the owner's review gate for public disclosure.
-- It modifies PRIVATE canonical branch details; a separate public reviewer
-- must approve a new full-storefront snapshot.
CREATE FUNCTION dealer_edit_my_staff_branch(
 p_actor_id TEXT,p_scope_id UUID,p_name TEXT,p_address TEXT,
 p_latitude NUMERIC,p_longitude NUMERIC,p_hours TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=public,pg_temp AS $$
DECLARE
 s dealer_staff_branch_scopes%ROWTYPE;
 i dealer_staff_invitation_records%ROWTYPE;
 l dealer_approved_seed_links%ROWTYPE;
 updated dealer_branches%ROWTYPE;
BEGIN
 SELECT * INTO s FROM dealer_staff_branch_scopes WHERE scope_id=p_scope_id FOR UPDATE;
 IF NOT FOUND OR s.status<>'ACTIVE' OR
   s.permission<>'EDIT_BRANCH_DETAILS' THEN
   RAISE EXCEPTION 'STAFF_BRANCH_EDIT_SCOPE_REQUIRED'; END IF;
 SELECT * INTO i FROM dealer_staff_invitation_records
  WHERE invite_id=s.invite_id FOR UPDATE;
 IF NOT FOUND OR i.status<>'ACCEPTED' OR i.invited_user_id<>p_actor_id OR
   NOT EXISTS(SELECT 1 FROM tenant_users WHERE tenant_id=i.tenant_id
      AND user_id=p_actor_id AND role='member') OR
   NOT EXISTS(SELECT 1 FROM organization_users WHERE
      organization_id=i.organization_id AND user_id=p_actor_id AND status='active') THEN
   RAISE EXCEPTION 'CANONICAL_ACTIVE_STAFF_MEMBERSHIP_REQUIRED'; END IF;
 l:=dealer_assert_staff_owner(i.dealer_profile_id,i.invited_by);
 IF l.tenant_id<>i.tenant_id OR l.organization_id<>i.organization_id THEN
   RAISE EXCEPTION 'STAFF_BRANCH_ACTIVE_LEGAL_OWNER_REQUIRED'; END IF;
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 180 OR
   p_address IS NULL OR length(trim(p_address)) NOT BETWEEN 3 AND 500 OR
   (p_latitude IS NULL)<>(p_longitude IS NULL) OR
   (p_latitude IS NOT NULL AND p_latitude NOT BETWEEN -90 AND 90) OR
   (p_longitude IS NOT NULL AND p_longitude NOT BETWEEN -180 AND 180) OR
   (p_hours IS NOT NULL AND length(p_hours)>2000) THEN
   RAISE EXCEPTION 'STAFF_BRANCH_DETAILS_INVALID'; END IF;
 UPDATE dealer_branches
  SET name=trim(p_name),address=trim(p_address),
   latitude=p_latitude,longitude=p_longitude,
   opening_hours_text=p_hours,operating_details_updated_at=now()
  WHERE id=s.branch_id AND dealer_id=i.dealer_profile_id
  RETURNING * INTO updated;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_BRANCH_NOT_IN_CANONICAL_DEALER'; END IF;
 INSERT INTO dealer_staff_branch_scope_events(scope_id,actor_user_id,event_type)
 VALUES(s.scope_id,p_actor_id,'BRANCH_DETAILS_EDITED');
 RETURN jsonb_build_object('branch_id',updated.id,
   'name',updated.name,'address',updated.address,
   'opening_hours_text',updated.opening_hours_text,
   'private_declaration_only',true,'public_snapshot_unchanged',true,
   'seller_rights_granted',false);
END;
$$;
REVOKE ALL ON FUNCTION dealer_edit_my_staff_branch(
 TEXT,UUID,TEXT,TEXT,NUMERIC,NUMERIC,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_edit_my_staff_branch(
 TEXT,UUID,TEXT,TEXT,NUMERIC,NUMERIC,TEXT) TO service_role;

-- Revocation of a canonical staff invitation automatically withdraws every
-- active branch scope in the SAME DB transaction, before the route replies.
CREATE FUNCTION dealer_revoke_branch_scopes_with_invitation()
 RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=public,pg_temp AS $$
DECLARE
 item RECORD;
BEGIN
 IF OLD.status='ACCEPTED' AND NEW.status='REVOKED' THEN
  FOR item IN UPDATE dealer_staff_branch_scopes SET status='REVOKED',
      revoked_at=now()
    WHERE invite_id=NEW.invite_id AND status='ACTIVE'
    RETURNING scope_id
  LOOP
   INSERT INTO dealer_staff_branch_scope_events(scope_id,actor_user_id,event_type)
   VALUES(item.scope_id,NEW.invited_by,'AUTO_REVOKED_ON_INVITATION');
  END LOOP;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER dealer_branch_scopes_revoke_on_invitation
 AFTER UPDATE OF status ON dealer_staff_invitation_records
 FOR EACH ROW EXECUTE FUNCTION dealer_revoke_branch_scopes_with_invitation();

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM dealer_staff_branch_scopes)
  OR EXISTS(SELECT 1 FROM dealer_staff_branch_scope_events) THEN
   RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_BRANCH_PERMISSION_CUSTODY';
 END IF;
END;
$$;
DROP TRIGGER IF EXISTS dealer_branch_scopes_revoke_on_invitation ON dealer_staff_invitation_records;
DROP FUNCTION IF EXISTS dealer_revoke_branch_scopes_with_invitation();
DROP FUNCTION IF EXISTS dealer_edit_my_staff_branch(TEXT,UUID,TEXT,TEXT,NUMERIC,NUMERIC,TEXT);
DROP FUNCTION IF EXISTS dealer_list_my_staff_branches(TEXT);
DROP FUNCTION IF EXISTS dealer_revoke_staff_branch_scope(UUID,TEXT);
DROP FUNCTION IF EXISTS dealer_grant_staff_branch_scope(UUID,UUID,TEXT,TEXT,TEXT);
DROP TABLE IF EXISTS dealer_staff_branch_scope_events;
DROP TABLE IF EXISTS dealer_staff_branch_scopes;
