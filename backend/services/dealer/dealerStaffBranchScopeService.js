/**
 * CARUP-DEALER-ONB-001 D7 C16: real branch-scoped operational permissions
 * layered ON TOP of existing canonical tenant + organization membership.
 *
 * Scope events are private, append-only SQL custody. A member may read/edit
 * only a branch explicitly assigned by the independent legal owner, while the
 * owner's real legal/policy authority remains active. This NEVER creates
 * seller, finance, company-owner, reviewer or public publication authority.
 */
import {supabase} from '../../db/supabase.js';
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
import {requireClaimantSession} from './dealerClaimApplicationService.js';
import {parsePrivateBranchDetails} from './dealerBranchDetailsValidation.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION=new Set(['VIEW_BRANCH','EDIT_BRANCH_DETAILS']);
const deny=(code,status=403)=>Object.assign(new Error(code),{code,statusCode:status});
const validUUID=(v,code)=>typeof v==='string'&&UUID.test(v)?v:(()=>{throw deny(code,400)})();
const scoped=(row)=>Object.freeze({
  scope_id:row.scope_id,branch_id:row.branch_id,
  permission:row.permission,name:row.name,address:row.address,
  latitude:row.latitude,longitude:row.longitude,
  opening_hours_text:row.opening_hours_text,
  owner_rights:false,listing_rights:false,finance_rights:false,
});
export async function listMyStaffBranches(actor,{db=supabase}={}){
  const actorId=requireClaimantSession(actor);
  const {data,error}=await db.rpc('dealer_list_my_staff_branches',{
    p_actor_id:actorId,
  });
  if(error||!Array.isArray(data))throw deny('SCOPED_BRANCH_READ_UNAVAILABLE',503);
  // SQL membership and legal-policy checks must still be the sole authority.
  if(data.some(row=>!UUID.test(String(row.scope_id||''))||
    !UUID.test(String(row.branch_id||''))||!PERMISSION.has(row.permission)||
    row.owner_rights!==false||row.listing_rights!==false||
    row.finance_rights!==false))
    throw deny('INVALID_CANONICAL_BRANCH_SCOPE_RECEIPT',503);
  return Object.freeze({
    branches:data.map(scoped),
    canonical_scope:'CURRENT_ACTIVE_ACCEPTED_INVITATION_AND_TENANT_MEMBER',
    commercial_or_vehicle_publish_rights:false,
    real_personal_identity_not_exposed:true,
  });
}
export async function listMyOwnerStaffBranchScopes(actor,{db=supabase}={}){
  const owner=await requireApprovedOwnerWorkspace(actor);
  const invitations=await db.from('dealer_staff_invitation_records')
    .select('invite_id').eq('dealer_profile_id',owner.dealer_profile_id)
    .eq('tenant_id',owner.tenant_id).limit(100);
  if(invitations.error||!Array.isArray(invitations.data))
    throw deny('CANONICAL_STAFF_INVITES_UNAVAILABLE',503);
  const ids=invitations.data.map(x=>x.invite_id).filter(id=>UUID.test(String(id)));
  if(!ids.length)return {scopes:[],owner_tenant_id:owner.tenant_id};
  const granted=await db.from('dealer_staff_branch_scopes')
    .select('scope_id,invite_id,branch_id,permission,status,granted_at,revoked_at')
    .in('invite_id',ids).order('granted_at',{ascending:false}).limit(300);
  if(granted.error||!Array.isArray(granted.data))
    throw deny('CANONICAL_BRANCH_SCOPE_LEDGER_UNAVAILABLE',503);
  if(granted.data.some(x=>!ids.includes(x.invite_id)))
    throw deny('CROSS_TENANT_BRANCH_SCOPE_LEAK_REFUSED');
  return Object.freeze({
    owner_tenant_id:owner.tenant_id,
    scopes:granted.data,
    separate_branch_authority:true,
    canonical_membership_source:'tenant_users+organization_users',
  });
}
export async function grantMyStaffBranchScope(actor,payload={}, {db=supabase}={}){
  const owner=await requireApprovedOwnerWorkspace(actor);
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    Object.hasOwn(payload,'tenant_id')||Object.hasOwn(payload,'owner_id')||
    Object.hasOwn(payload,'dealer_profile_id')||Object.hasOwn(payload,'user_id'))
    throw deny('CLIENT_STAFF_BRANCH_AUTHORITY_NOT_ACCEPTED',400);
  const inviteId=validUUID(payload.invite_id,'INVALID_BRANCH_SCOPE_INVITATION');
  const branchId=validUUID(payload.branch_id,'INVALID_BRANCH_SCOPE_BRANCH');
  if(!PERMISSION.has(payload.permission))
    throw deny('INVALID_STAFF_BRANCH_PERMISSION',400);
  const reason=typeof payload.reason==='string'?payload.reason.trim():'';
  if(reason.length<16||reason.length>1000)
    throw deny('STAFF_BRANCH_SCOPE_REASON_REQUIRED',400);
  const {data,error}=await db.rpc('dealer_grant_staff_branch_scope',{
    p_invite_id:inviteId,p_branch_id:branchId,p_permission:payload.permission,
    p_owner_id:owner.actor_id,p_reason:reason,
  });
  if(error)throw deny('CANONICAL_BRANCH_SCOPE_GRANT_REFUSED',409);
  if(!data||!UUID.test(String(data.scope_id||''))||
    data.status!=='ACTIVE'||data.permission!==payload.permission||
    data.seller_rights_granted!==false)
    throw deny('INVALID_BRANCH_GRANT_RECEIPT',503);
  return Object.freeze({...data,owner_role_granted:false});
}
export async function revokeMyStaffBranchScope(actor,scopeId,{db=supabase}={}){
  const owner=await requireApprovedOwnerWorkspace(actor);
  const id=validUUID(scopeId,'INVALID_STAFF_BRANCH_SCOPE_ID');
  const {data,error}=await db.rpc('dealer_revoke_staff_branch_scope',{
    p_scope_id:id,p_owner_id:owner.actor_id,
  });
  if(error)throw deny('CANONICAL_BRANCH_SCOPE_REVOCATION_REFUSED',409);
  if(!data||data.status!=='REVOKED'||data.scope_id!==id)
    throw deny('INVALID_BRANCH_REVOKE_RECEIPT',503);
  return Object.freeze({...data,member_role_unmodified:true});
}
export async function editMyStaffBranch(actor,scopeId,payload={}, {db=supabase}={}){
  const actorId=requireClaimantSession(actor);
  const id=validUUID(scopeId,'INVALID_STAFF_BRANCH_SCOPE_ID');
  const details=parsePrivateBranchDetails(payload);
  const {data,error}=await db.rpc('dealer_edit_my_staff_branch',{
    p_actor_id:actorId,p_scope_id:id,p_name:details.name,
    p_address:details.address,p_latitude:details.latitude,
    p_longitude:details.longitude,p_hours:details.opening_hours_text,
  });
  if(error)throw deny('STAFF_BRANCH_EDIT_NOT_AUTHORIZED',409);
  if(!data||!UUID.test(String(data.branch_id||''))||
    data.private_declaration_only!==true||data.public_snapshot_unchanged!==true||
    data.seller_rights_granted!==false)
    throw deny('STAFF_BRANCH_EDIT_RECEIPT_INVALID',503);
  return Object.freeze(data);
}
