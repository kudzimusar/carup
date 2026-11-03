/** D7 C16: canonical organization_users + tenant_users membership; never
 * a parallel staff auth table. Invitation records are only transaction audit.
 * A staff invitation confers no global role, owner, seller or company authority.
 */
import {supabase} from '../../db/supabase.js';
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
import {requireClaimantSession} from './dealerClaimApplicationService.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function deny(code,status=400){return Object.assign(new Error(code),{statusCode:status});}
function validateId(id){if(typeof id!=='string'||!UUID.test(id))throw deny('INVALID_STAFF_INVITATION_ID');return id;}
export async function listCanonicalDealerStaff(actor){
  const owner=await requireApprovedOwnerWorkspace(actor);
  const [members,invites]=await Promise.all([
    supabase.from('tenant_users').select('user_id,role,joined_at')
      .eq('tenant_id',owner.tenant_id).order('joined_at',{ascending:true}).limit(100),
    supabase.from('dealer_staff_invitation_records')
      .select('invite_id,invited_user_id,requested_role,status,created_at,expires_at')
      .eq('dealer_profile_id',owner.dealer_profile_id)
      .eq('tenant_id',owner.tenant_id).order('created_at',{ascending:false}).limit(100),
  ]);
  if(members.error||invites.error)throw deny('CANONICAL_STAFF_READ_UNAVAILABLE',503);
  return {
    tenant_id:owner.tenant_id,
    members:(members.data||[]).map(m=>({
      user_id:m.user_id,role:m.role,joined_at:m.joined_at,
      belongs_to_canonical_tenant:true,
      owner_grant_requires_independent_legal_activation:true,
    })),
    invitations:invites.data||[],
    staff_listing_authority:false,
    branch_role_scope_not_configured:true,
  };
}
export async function inviteDealerStaff(actor,payload={}){
  const owner=await requireApprovedOwnerWorkspace(actor);
  const staffId=typeof payload.invited_user_id==='string'?
    payload.invited_user_id.trim():'';
  if(staffId.length<2||staffId.length>255||staffId===actor.userId)
    throw deny('EXISTING_DISTINCT_STAFF_USER_ID_REQUIRED');
  if(Object.hasOwn(payload,'role')&&payload.role!=='member')
    throw deny('ONLY_LIMITED_MEMBER_INVITATIONS_ALLOWED');
  if(payload.tenant_id||payload.organization_id||payload.dealer_profile_id)
    throw deny('CLIENT_AUTHORITY_IDENTIFIERS_NOT_ACCEPTED');
  const {data,error}=await supabase.rpc('dealer_invite_existing_staff_account',{
    p_profile_id:owner.dealer_profile_id,
    p_owner_id:actor.userId,p_invited_user_id:staffId,
  });
  if(error)throw deny('CANONICAL_STAFF_INVITATION_REFUSED',409);
  return data;
}
export async function listOwnDealerStaffInvitations(actor){
  const userId=requireClaimantSession(actor);
  const {data,error}=await supabase.from('dealer_staff_invitation_records')
    .select('invite_id,requested_role,status,created_at,expires_at,organization_id')
    .eq('invited_user_id',userId).order('created_at',{ascending:false}).limit(50);
  if(error)throw deny('OWN_STAFF_INVITATIONS_UNAVAILABLE',503);
  return (data||[]).map(x=>({
    ...x,owner_rights_granted:false,vehicle_seller_rights_granted:false,
  }));
}
export async function acceptDealerStaffInvitation(actor,id){
  const userId=requireClaimantSession(actor);
  validateId(id);
  const {data,error}=await supabase.rpc('dealer_accept_staff_invitation',{
    p_invite_id:id,p_invited_actor_id:userId,
  });
  if(error)throw deny('STAFF_INVITATION_ACCEPTANCE_REFUSED',409);
  return data;
}
export async function revokeDealerStaffInvitation(actor,id){
  const owner=await requireApprovedOwnerWorkspace(actor);
  validateId(id);
  const {data,error}=await supabase.rpc('dealer_revoke_staff_invitation',{
    p_invite_id:id,p_owner_id:owner.actor_id,
  });
  if(error)throw deny('CANONICAL_STAFF_REVOCATION_REFUSED',409);
  return data;
}
